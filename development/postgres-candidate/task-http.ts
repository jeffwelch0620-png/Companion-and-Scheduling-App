import {createRemoteJWKSet,jwtVerify} from 'jose';
import type {JWTVerifyGetKey} from 'jose';
import {CommandError,executeTask,parseCopySelection} from './task-adapter.ts';
import type {Database,TrustedIdentity} from './task-adapter.ts';

type VerifiedSession={subject:string;sessionId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Give a newly encountered remote kid one cooldown window to appear after rotation.
// jose still owns fetch coalescing/cooldown; unknown keys never force a remote reload.
export function withKeyRotationGrace(getKey:JWTVerifyGetKey,{cooldownMs=30000,now=()=>Date.now(),maxUnknownKeys=100}={}):JWTVerifyGetKey{
 if(!Number.isFinite(cooldownMs)||cooldownMs<=0||!Number.isInteger(maxUnknownKeys)||maxUnknownKeys<1)throw Error('Invalid key rotation policy');
 const missing=new Map<string,number>();
 return async(header,jwt)=>{
  const key=JSON.stringify([header.alg,header.kid]);
  try{const result=await getKey(header,jwt);missing.delete(key);return result;}
  catch(error){
   if((error as {code?:string}|null)?.code!=='ERR_JWKS_NO_MATCHING_KEY')throw error;
   if(typeof header.kid!=='string'||!header.kid||header.kid.length>200)throw error;
   const time=now();
   if(!missing.has(key)){
    if(missing.size>=maxUnknownKeys){
     // Reclaim an expired grace slot, otherwise reject excess unknown kids immediately.
     const expired=[...missing].find(([,started])=>time-started>=cooldownMs);
     if(!expired)throw error;missing.delete(expired[0]);
    }
    missing.set(key,time);
   }
   const started=missing.get(key)??time;
   if(time-started<cooldownMs)throw new CommandError(503,'authentication_service_unavailable');
   throw error; // Still unknown after the grace window: credentials are invalid (401).
  }
 };
}
export function makeJwtVerifier(options:{issuer:string;audience:string;getKey:JWTVerifyGetKey}) {
 return async(token:string):Promise<VerifiedSession>=>{
  try{
   const {payload}=await jwtVerify(token,async(header,jwt)=>{
    try{return await options.getKey(header,jwt);}
    catch(error){
     if(error instanceof CommandError||(error as {code?:string}|null)?.code==='ERR_JWKS_NO_MATCHING_KEY')throw error;
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
   const code=(error as {code?:string}|null)?.code;
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
  getKey:withKeyRotationGrace(createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'),{cooldownDuration:30000}),{cooldownMs:30000})});
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
   const route=/^\/api\/operations\/([a-zA-Z0-9_-]{1,100})\/(commands|copy-review|week-review|leave-reviews|tasks|goals|staffing|completed-shifts|shift-corrections|shift-correction-history|attendance|attendance-history|publication-review|cancellation-review|closes|dish-cycles|overnight|shifts|schedule-viewer|schedule-shifts|schedule-roster|schedule-availability|schedule-requests|schedule-stations|schedule-coverage|schedule-swaps|schedule-leadership)(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
   if(!route)return json({error:{code:'route_not_found'}},404);
   const [,scope,resource,taskId]=route;
   if((resource.startsWith('schedule-')||resource==='goals'||resource==='staffing')&&(taskId||url.searchParams.getAll('after').length>1||url.searchParams.getAll('limit').length>1))
    throw new CommandError(400,'invalid_query');
   if(['commands','week-review','copy-review'].includes(resource)&&(request.method!=='POST'||taskId)
    ||!['commands','week-review','copy-review'].includes(resource)&&request.method!=='GET')return json({error:{code:'method_not_allowed'}},405);
   if(taskId&&!uuid.test(taskId))throw new CommandError(400,'invalid_identifier');
   const auth=request.headers.get('authorization');
   if(!auth?.startsWith('Bearer ')||auth.length>16384)throw new CommandError(401,'authentication_required');
   const session=await verifyToken(auth.slice(7));
   const command=['commands','week-review','copy-review'].includes(resource)?await body(request):undefined;
   if(resource==='schedule-viewer'&&url.search)throw new CommandError(400,'invalid_query');
   const queryKeys=resource==='leave-reviews'&&!taskId?['after','limit','from','to','status']:resource==='completed-shifts'&&!taskId?['after','limit','asOf','from','to']:resource==='shift-corrections'&&!taskId?['after','limit','from','to']:resource==='attendance'&&!taskId?['after','limit','from','to','shift']:['after','limit'];
   if([...url.searchParams.keys()].some(k=>!queryKeys.includes(k)||url.searchParams.getAll(k).length>1)
    ||['commands','week-review','copy-review'].includes(resource)&&url.search||taskId&&!['attendance-history','shift-correction-history'].includes(resource)&&url.search)
    throw new CommandError(400,'invalid_query');
   const after=url.searchParams.get('after'),limitText=url.searchParams.get('limit')??'50';
   const correctionAsOf=url.searchParams.get('asOf');
   if(correctionAsOf!==null&&(!/^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(correctionAsOf)||!Number.isFinite(Date.parse(correctionAsOf))||new Date(correctionAsOf.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==correctionAsOf.slice(0,10)))throw new CommandError(400,'invalid_correction_query');
   if(after!==null&&(['attendance-history','shift-correction-history'].includes(resource)?!/^(0|[1-9][0-9]{0,2}|1000)$/.test(after):!uuid.test(after))||!/^([1-9]|[1-9][0-9]|100)$/.test(limitText))
    throw new CommandError(400,'invalid_pagination');
   const from=url.searchParams.get('from'),to=url.searchParams.get('to');
   const attendanceShift=url.searchParams.get('shift');
   if(attendanceShift!==null&&(!uuid.test(attendanceShift)||from!==null||to!==null))throw new CommandError(400,'invalid_attendance_query');
   if((from===null)!==(to===null)||[from,to].some(value=>value!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value))||from!==null&&to!==null&&from>to)throw new CommandError(400,resource==='leave-reviews'?'invalid_leave_review_query':['completed-shifts','shift-corrections'].includes(resource)?'invalid_correction_query':'invalid_attendance_query');
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
    if(resource==='copy-review')return result((await connection.query('SELECT candidate_operations.read_schedule_copy_review($1,$2::uuid,$3,$4::jsonb) AS result',[identity.subject,identity.membershipId,scope,JSON.stringify(parseCopySelection(command))])).rows[0]);
    if(resource==='leave-reviews'){
     return result((await connection.query(taskId?'SELECT candidate_operations.read_leave_review($1,$2::uuid,$3,$4::uuid) AS result':'SELECT candidate_operations.list_leave_reviews($1,$2::uuid,$3,$4::uuid,$5::integer,$6::date,$7::date,$8) AS result',taskId?[identity.subject,identity.membershipId,scope,taskId]:[identity.subject,identity.membershipId,scope,after,Number(limitText),from,to,url.searchParams.get('status')??'pending'])).rows[0]);
    }
    if(resource==='week-review'){
     const review=command as {weekStart?:unknown;draftIds?:unknown};
     if(!review||typeof review!=='object'||Array.isArray(review)||Object.keys(review).some(k=>!['weekStart','draftIds'].includes(k))||typeof review.weekStart!=='string'||!Array.isArray(review.draftIds)||review.draftIds.length<1||review.draftIds.length>100||review.draftIds.some(id=>typeof id!=='string'||!uuid.test(id)))throw new CommandError(400,'invalid_week_fields');
     return result((await connection.query('SELECT candidate_operations.weekly_review($1,$2::uuid,$3,$4,$5::jsonb) AS result',[identity.subject,identity.membershipId,scope,review.weekStart,JSON.stringify(review.draftIds)])).rows[0]);
    }
    if(resource==='shift-correction-history'){
     if(!taskId)throw new CommandError(400,'correction_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_shift_correction_history($1,$2::uuid,$3,$4::uuid,$5::integer,$6::integer) AS result',[identity.subject,identity.membershipId,scope,taskId,Number(after??0),Number(limitText)])).rows[0]);
    }
    if(resource==='shift-corrections'){
     return result((await connection.query(taskId?'SELECT candidate_operations.read_shift_correction($1,$2::uuid,$3,$4::uuid) AS result':'SELECT candidate_operations.list_shift_corrections($1,$2::uuid,$3,$4::uuid,$5::integer,$6::date,$7::date) AS result',taskId?[identity.subject,identity.membershipId,scope,taskId]:[identity.subject,identity.membershipId,scope,after,Number(limitText),from,to])).rows[0]);
    }
    if(resource==='completed-shifts'){
     return result((await connection.query(taskId?'SELECT candidate_operations.read_completed_shift_review($1,$2::uuid,$3,$4::uuid) AS result':'SELECT candidate_operations.list_completed_shifts($1,$2::uuid,$3,$4::uuid,$5::integer,$6::timestamptz,$7::date,$8::date) AS result',taskId?[identity.subject,identity.membershipId,scope,taskId]:[identity.subject,identity.membershipId,scope,after,Number(limitText),correctionAsOf,from,to])).rows[0]);
    }
    if(resource==='attendance-history'){
     if(!taskId)throw new CommandError(400,'attendance_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_attendance_history($1,$2::uuid,$3,$4::uuid,$5::integer,$6::integer) AS result',[identity.subject,identity.membershipId,scope,taskId,Number(after??0),Number(limitText)])).rows[0]);
    }
    if(resource==='attendance'){
     return result((await connection.query(taskId?'SELECT candidate_operations.read_attendance($1,$2::uuid,$3,$4::uuid) AS result':'SELECT candidate_operations.list_attendance($1,$2::uuid,$3,$4::uuid,$5::integer,$6::date,$7::date,$8::uuid) AS result',taskId?[identity.subject,identity.membershipId,scope,taskId]:[identity.subject,identity.membershipId,scope,after,Number(limitText),from,to,attendanceShift])).rows[0]);
    }
    if(resource==='schedule-viewer'){return result((await connection.query('SELECT candidate_operations.schedule_viewer($1,$2::uuid,$3) AS result',[identity.subject,identity.membershipId,scope])).rows[0]);}
    if(resource==='staffing'){
     return result((await connection.query('SELECT candidate_operations.list_staffing($1,$2::uuid,$3,$4::uuid,$5::integer) AS result',[identity.subject,identity.membershipId,scope,after,Number(limitText)])).rows[0]);
    }
    if(resource==='cancellation-review'){
     if(!taskId)throw new CommandError(400,'shift_identifier_required');
     return result((await connection.query('SELECT candidate_operations.read_shift_cancellation_review($1,$2::uuid,$3,$4::uuid) AS result',[identity.subject,identity.membershipId,scope,taskId])).rows[0]);
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
   const pg=error as {code?:string;message?:string};
   if(pg.code==='40001'&&pg.message==='scope_coordination_retry')return json({error:{code:'coordination_retry'}},503);
   if(pg.code==='P0001'&&['phase_conflict','shift_ended','draft_reference_only','correction_source_ineligible'].includes(pg.message??''))return json({error:{code:pg.message}},409);
   if(pg.code==='42501')return json({error:{code:'access_denied'}},403);
   if(pg.code?.startsWith('22'))return json({error:{code:'invalid_request'}},400);
   return json({error:{code:'service_unavailable'}},503);
  }
 };
}
