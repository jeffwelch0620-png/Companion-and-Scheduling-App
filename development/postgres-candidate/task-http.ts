import {createRemoteJWKSet,jwtVerify} from 'jose';
import type {JWTVerifyGetKey} from 'jose';
import {CommandError,executeTask} from './task-adapter.ts';
import type {Database,TrustedIdentity} from './task-adapter.ts';

type VerifiedSession={subject:string;sessionId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function makeJwtVerifier(options:{issuer:string;audience:string;getKey:JWTVerifyGetKey}) {
 return async(token:string):Promise<VerifiedSession>=>{
  try{
   const {payload}=await jwtVerify(token,async(header,jwt)=>{
    try{return await options.getKey(header,jwt);}
    catch(error){
     if((error as {code?:string}).code==='ERR_JWKS_NO_MATCHING_KEY')throw error;
     throw new CommandError(503,'authentication_service_unavailable');
    }
   },{
    issuer:options.issuer,audience:options.audience,algorithms:['ES256','RS256'],
    requiredClaims:['sub','exp','iat','session_id'],clockTolerance:0
   });
   if(payload.role!=='authenticated'||payload.is_anonymous===true
    ||typeof payload.sub!=='string'||!payload.sub
    ||typeof payload.session_id!=='string'||!uuid.test(payload.session_id))
    throw new CommandError(401,'authentication_required');
   return {subject:payload.sub,sessionId:payload.session_id};
  }catch(error){
   if(error instanceof CommandError)throw error;
   // Credential failures require login. Key-service/network/configuration failures are retryable.
   const code=(error as {code?:string}).code;
   if(code&&['ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    'ERR_JWS_INVALID','ERR_JWT_INVALID','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JOSE_NOT_SUPPORTED',
    'ERR_JWKS_NO_MATCHING_KEY'].includes(code))throw new CommandError(401,'authentication_required');
   throw new CommandError(503,'authentication_service_unavailable');
  }
 };
}
export function supabaseJwtVerifier(projectUrl:string) {
 const base=new URL(projectUrl);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')
  throw new Error('Expected a trusted HTTPS Supabase project origin');
 const issuer=base.origin+'/auth/v1';
 return makeJwtVerifier({issuer,audience:'authenticated',
  getKey:createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'))});
}
const headers={'Content-Type':'application/json','Cache-Control':'private, no-store',
 Vary:'Authorization','X-Content-Type-Options':'nosniff'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
async function body(request:Request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
  throw new CommandError(415,'json_required');
 const reader=request.body?.getReader();if(!reader)throw new CommandError(400,'body_required');
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){const part=await reader.read();if(part.done)break;
   size+=part.value.byteLength;if(size>16384){await reader.cancel();throw new CommandError(413,'body_too_large');}
   chunks.push(part.value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{throw new CommandError(400,'invalid_json');}
}
function result(row:Record<string,unknown>|undefined){
 if(!row||row.result===undefined)throw new Error('missing_database_result');
 return typeof row.result==='string'?JSON.parse(row.result):row.result;
}
export function createTaskHandler(database:Database,verifyToken:(token:string)=>Promise<VerifiedSession>) {
 return async(request:Request):Promise<Response>=>{
  try{
   const url=new URL(request.url);
   const route=/^\/api\/operations\/([a-zA-Z0-9_-]{1,100})\/(commands|week-review|tasks|goals|staffing|publication-review|closes|dish-cycles|overnight|shifts|schedule-viewer|schedule-shifts|schedule-roster|schedule-availability|schedule-requests|schedule-stations|schedule-coverage|schedule-swaps|schedule-leadership)(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
   if(!route)return json({error:{code:'route_not_found'}},404);
   const [,scope,resource,taskId]=route;
   if((resource.startsWith('schedule-')||resource==='goals'||resource==='staffing')&&(taskId||url.searchParams.getAll('after').length>1||url.searchParams.getAll('limit').length>1))
    throw new CommandError(400,'invalid_query');
   if((resource==='commands'||resource==='week-review')&&(request.method!=='POST'||taskId)
    ||resource!=='commands'&&resource!=='week-review'&&request.method!=='GET')return json({error:{code:'method_not_allowed'}},405);
   if(taskId&&!uuid.test(taskId))throw new CommandError(400,'invalid_identifier');
   const auth=request.headers.get('authorization');
   if(!auth?.startsWith('Bearer ')||auth.length>16384)throw new CommandError(401,'authentication_required');
   const session=await verifyToken(auth.slice(7));
   const command=resource==='commands'||resource==='week-review'?await body(request):undefined;
   if(resource==='schedule-viewer'&&url.search)throw new CommandError(400,'invalid_query');
   if([...url.searchParams.keys()].some(k=>!['after','limit'].includes(k))
    ||(resource==='commands'||resource==='week-review')&&url.search||taskId&&url.search)
    throw new CommandError(400,'invalid_query');
   const after=url.searchParams.get('after'),limitText=url.searchParams.get('limit')??'50';
   if(after!==null&&!uuid.test(after)||!/^([1-9]|[1-9][0-9]|100)$/.test(limitText))
    throw new CommandError(400,'invalid_pagination');
   const data=await database.transaction(async connection=>{
    if(resource!=='commands')await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',[]);
    let identity:TrustedIdentity;
    try{identity=result((await connection.query(
     resource==='commands'?'SELECT candidate_operations.resolve_identity($1,$2::uuid,$3) AS result'
      :'SELECT candidate_operations.resolve_identity_read($1,$2::uuid,$3) AS result',
     [session.subject,session.sessionId,scope])).rows[0]) as TrustedIdentity;
    }catch(error){
     // Only the resolver's session failure becomes 401; membership/action denials remain 403.
     const failure=error as {code?:string;message?:string};
     if(failure.code==='42501'&&failure.message==='session_denied')throw new CommandError(401,'authentication_required');
     throw error;
    }
    if(resource==='commands'){
     const sameTransaction:Database={transaction:operation=>operation(connection)};
     return executeTask(sameTransaction,identity,scope,command);
    }
    if(resource==='week-review'){
     const review=command as {weekStart?:unknown;draftIds?:unknown};
     if(!review||typeof review!=='object'||Array.isArray(review)||Object.keys(review).some(k=>!['weekStart','draftIds'].includes(k))||typeof review.weekStart!=='string'||!Array.isArray(review.draftIds)||review.draftIds.length<1||review.draftIds.length>100||review.draftIds.some(id=>typeof id!=='string'||!uuid.test(id)))throw new CommandError(400,'invalid_week_fields');
     return result((await connection.query('SELECT candidate_operations.weekly_review($1,$2::uuid,$3,$4,$5::jsonb) AS result',[identity.subject,identity.membershipId,scope,review.weekStart,JSON.stringify(review.draftIds)])).rows[0]);
    }
    if(resource==='schedule-viewer'){return result((await connection.query('SELECT candidate_operations.schedule_viewer($1,$2::uuid,$3) AS result',[identity.subject,identity.membershipId,scope])).rows[0]);}
    if(resource==='staffing'){
     return result((await connection.query('SELECT candidate_operations.list_staffing($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',[identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
    }
    if(resource==='publication-review'){
     if(!taskId)throw new CommandError(400,'shift_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_publication_review($1,$2::uuid,$3,$4::uuid) AS result',[identity.subject,identity.membershipId,scope,taskId])).rows[0]);
    }
    if(resource==='goals'){
     return result((await connection.query('SELECT candidate_operations.list_goals($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',
      [identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
    }
    if(resource==='schedule-stations'){
     return result((await connection.query('SELECT candidate_operations.list_schedule_stations($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',
      [identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
    }
    if(resource==='schedule-leadership'){
     return result((await connection.query('SELECT candidate_operations.list_schedule_leadership($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',[identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
    }
    if(resource==='schedule-coverage'||resource==='schedule-swaps'){
     return result((await connection.query('SELECT candidate_operations.list_schedule_offers($1,$2::uuid,$3,$4,$5::uuid,$6::integer) AS result',[identity.subject,identity.membershipId,scope,resource==='schedule-coverage'?'coverage':'swap',after,Number(limitText)])).rows[0]);
    }
    if(resource==='schedule-requests'){
     return result((await connection.query('SELECT candidate_operations.list_time_off($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',
      [identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
    }
    if(resource==='schedule-roster'||resource==='schedule-availability'){
     return result((await connection.query('SELECT candidate_operations.list_schedule_context($1,$2::uuid,$3,$4,$5::uuid,$6::integer) AS result',
      [identity.subject,identity.membershipId,scope,resource==='schedule-roster'?'roster':'availability',after,Number(limitText)])).rows[0]);
    }
    if(resource==='schedule-shifts'){
     return result((await connection.query('SELECT candidate_operations.list_schedule_shifts($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',
      [identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
    }
    if(resource==='shifts'){
     if(!taskId)throw new CommandError(400,'shift_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_shift($1,$2::uuid,$3,$4::uuid) AS result',[identity.subject,identity.membershipId,scope,taskId])).rows[0]);
    }
    if(resource==='overnight'){
     if(!taskId)throw new CommandError(400,'overnight_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_overnight($1,$2::uuid,$3,$4::uuid) AS result',[identity.subject,identity.membershipId,scope,taskId])).rows[0]);
    }
    if(resource==='dish-cycles'){
     if(!taskId)throw new CommandError(400,'cycle_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_dish_cycle($1,$2::uuid,$3,$4::uuid) AS result',[identity.subject,identity.membershipId,scope,taskId])).rows[0]);
    }
    if(resource==='closes'){
     if(!taskId)throw new CommandError(400,'closing_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_close($1,$2::uuid,$3,$4::uuid) AS result',[identity.subject,identity.membershipId,scope,taskId])).rows[0]);
    }
    if(taskId)return result((await connection.query(
     'SELECT candidate_operations.read_task($1,$2::uuid,$3,$4::uuid) AS result',
     [identity.subject,identity.membershipId,scope,taskId])).rows[0]);
    return result((await connection.query(
     'SELECT candidate_operations.list_tasks($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',
     [identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
   });
   return json(data);
  }catch(error){
   if(error instanceof CommandError)return json({error:{code:/^[a-z_]+$/.test(error.code)?error.code:'invalid_request'}},error.status);
   const pg=error as {code?:string};
   if(pg.code==='42501')return json({error:{code:'access_denied'}},403);
   if(pg.code?.startsWith('22'))return json({error:{code:'invalid_request'}},400);
   return json({error:{code:'service_unavailable'}},503);
  }
 };
}
