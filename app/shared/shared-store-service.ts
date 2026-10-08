import {applyCommand,publicWorkspace} from './domain';
import {operationsManager} from './operations';
import {boundedJson} from './service';
import {AppError,id,object,requireThat,text} from './validation';
import type {Command,CommandResult,Workspace} from './types';
import {sharedStoreActions,type SharedStoreBindings,type SharedStoreConfig,type SharedStoreSnapshot,type SharedStoreMembership,type SharedStoreCommit} from './shared-store-contract';
import {sharedStoreConfig,sharedStoreToken,sharedStoreSessionCookie,sharedFetch,sharedResponse,verifySharedUser,sharedRpc} from './shared-store-transport';

const json=(body:unknown,status=200,cookie?:string)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie, Authorization','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
function sameOrigin(request:Request){requireThat(request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from the shared JMAX app.',403);requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);}
function result(value:unknown):CommandResult {const v=object(value);requireThat(typeof v.recordId==='string'&&Number.isSafeInteger(v.revision)&&Number(v.revision)>0&&Number.isSafeInteger(v.workspaceRevision)&&Number(v.workspaceRevision)>=0,'The shared save response was incomplete. Retry the same request.',503);return {recordId:id(v.recordId),revision:Number(v.revision),workspaceRevision:Number(v.workspaceRevision)};}
async function snapshot(config:SharedStoreConfig,userId:string,locationId:string,fetcher:typeof fetch):Promise<SharedStoreSnapshot>{
 const value=object(await sharedRpc(config,'jmax_shared_workspace',{p_auth_user_id:userId,p_location_id:locationId},fetcher));
 const w=value.workspace as Workspace;requireThat(w?.location?.id===locationId&&w.me?.locationId===locationId&&Array.isArray(w.me.capabilities)&&Array.isArray(w.members)&&Array.isArray(w.records)&&Number.isSafeInteger(value.membershipRevision)&&Number(value.membershipRevision)>0&&Number.isSafeInteger(w.location.revision),'The shared workspace mapping needs review.',503);
 requireThat(operationsManager(w.me)&&!w.me.scheduleOnly,'Manager Log access is not enabled for this restaurant.',403);
 requireThat(w.members.every(m=>m.locationId===locationId)&&w.records.every(r=>r.locationId===locationId&&r.kind==='managerlog'),'The shared workspace returned an unexpected record scope.',503);
 return {workspace:publicWorkspace(w),membershipRevision:Number(value.membershipRevision)};
}
async function memberships(config:SharedStoreConfig,userId:string,fetcher:typeof fetch){
 const value=object(await sharedRpc(config,'jmax_shared_memberships',{p_auth_user_id:userId},fetcher));requireThat(Array.isArray(value.memberships)&&value.memberships.length<=100,'The shared membership response needs review.',503);
 const rows=value.memberships.map((raw:unknown):SharedStoreMembership=>{const m=object(raw);return {id:id(m.id),locationId:id(m.locationId),name:text(m.name,'Name',200),position:text(m.position,'Position',100),locationName:text(m.locationName,'Restaurant',200)}});
 // Require the installed database policy even when an old backend lists valid
 // memberships. A display title or multiple store_roles never grants group scope.
 requireThat(Object.hasOwn(value,'restaurantAccess'),'The shared restaurant-access policy still needs installation.',503);
 if(value.restaurantAccess===null){requireThat(rows.length===0,'The shared restaurant-access proof needs review.',503);return {memberships:rows};}
 const policy=object(value.restaurantAccess);
 requireThat(policy.version===1&&['restaurant','jay','rudd','commissary'].includes(String(policy.kind))&&typeof policy.homeLocationId==='string'&&Number.isSafeInteger(policy.revision)&&Number(policy.revision)>=0,'The shared restaurant-access proof needs review.',503);
 const owner=policy.kind==='jay'||policy.kind==='rudd';
 requireThat(policy.kind!=='commissary'||policy.homeLocationId==='comm','The shared commissary access needs review.',503);
 requireThat(rows.every(m=>owner?['berts','rudds','papa','comm'].includes(m.locationId):m.locationId===policy.homeLocationId)&&new Set(rows.map(m=>m.locationId)).size===rows.length,'No access across these restaurants.',403);
 return {memberships:rows};
}
function command(value:unknown):Command {
 const raw=object(value);requireThat(Object.keys(raw).every(k=>['requestId','locationId','action','recordId','expectedRevision','input'].includes(k)),'Send a command, not a record or identity snapshot.');
 const c:Command={requestId:id(raw.requestId),locationId:id(raw.locationId),action:text(raw.action,'Action',60),input:object(raw.input)};
 requireThat(sharedStoreActions.some(action=>action===c.action),'This shared slice supports creating Manager Log items and adding notes only.');
 const allowed=c.action==='managerlog.create'?['department','ownerId','category','priority','title','detail','due']:['note'];
 requireThat(Object.keys(c.input).every(k=>allowed.includes(k)),'Unexpected fields in this Manager Log command.');
 if(c.action==='managerlog.create')requireThat(raw.recordId===undefined&&raw.expectedRevision===undefined,'A new item receives its record identity from the shared server.');
 else{c.recordId=id(raw.recordId);requireThat(Number.isSafeInteger(raw.expectedRevision)&&Number(raw.expectedRevision)>0,'An exact saved revision is required.');c.expectedRevision=Number(raw.expectedRevision);}
 return c;
}
function errorResponse(error:unknown){if(error instanceof AppError)return json({error:error.message},error.status);return json({error:'The shared service did not confirm the operation. Retrying the same request is safe.'},503);}
export async function handleSharedStore(request:Request,bindings:SharedStoreBindings={},fetcher:typeof fetch=fetch):Promise<Response>{
 try{
  requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
  if(request.method==='POST')sameOrigin(request);
  const config=sharedStoreConfig(bindings),token=sharedStoreToken(request);requireThat(token,'Sign in to the shared app.',401);
  const user=await verifySharedUser(config,token,fetcher),url=new URL(request.url);
  const allowed=await memberships(config,user.id,fetcher);
  if(request.method==='GET'){const location=url.searchParams.get('locationId');if(!location)return json(allowed);const scoped=id(location);requireThat(allowed.memberships.some(m=>m.locationId===scoped),'No Manager Log access to this restaurant.',403);return json((await snapshot(config,user.id,scoped,fetcher)).workspace);}
  const c=command(await boundedJson(request.body,128000)),fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(c)))),n=>n.toString(16).padStart(2,'0')).join('');
  requireThat(allowed.memberships.some(m=>m.locationId===c.locationId),'No Manager Log access to this restaurant.',403);
  const prior=await sharedRpc(config,'jmax_shared_receipt',{p_auth_user_id:user.id,p_location_id:c.locationId,p_request_id:c.requestId,p_fingerprint:fingerprint},fetcher);if(prior!==null)return json(result(prior));
  const {workspace:w,membershipRevision}=await snapshot(config,user.id,c.locationId,fetcher),at=new Date().toISOString();
  const records=applyCommand(w,c,at);requireThat(records.length===1&&records[0].kind==='managerlog'&&records[0].locationId===c.locationId,'Unexpected shared command result.',503);
  const args:SharedStoreCommit={p_auth_user_id:user.id,p_location_id:c.locationId,p_actor_id:w.me.id,p_membership_revision:membershipRevision,p_workspace_revision:w.location.revision,p_request_id:c.requestId,p_fingerprint:fingerprint,p_action:c.action,p_record_id:records[0].id,p_records:records,p_at:at};
  return json(result(await sharedRpc(config,'jmax_shared_commit',args,fetcher)));
 }catch(error){return errorResponse(error)}
}
export async function handleSharedStoreSession(request:Request,bindings:SharedStoreBindings={},fetcher:typeof fetch=fetch):Promise<Response>{
 try{
  requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
  if(request.method==='GET'){
   let config:SharedStoreConfig;try{config=sharedStoreConfig(bindings)}catch{return json({configured:false,signedIn:false,message:'The shared connection is waiting for its server setup. Local review records are separate.'})}
   const token=sharedStoreToken(request);return json(token?{configured:true,signedIn:true,user:await verifySharedUser(config,token,fetcher)}:{configured:true,signedIn:false});
  }
  sameOrigin(request);const input=object(await boundedJson(request.body,6000));
  if(input.action==='sign-out'){requireThat(Object.keys(input).length===1,'Unexpected sign-out fields.');return json({signedIn:false},200,sharedStoreSessionCookie('',0));}
  requireThat(input.action==='sign-in'&&Object.keys(input).every(k=>['action','email','password'].includes(k)),'Use shared account sign-in.');
  const config=sharedStoreConfig(bindings),email=text(input.email,'Email',254).toLowerCase();requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Enter a valid email.');requireThat(typeof input.password==='string'&&input.password.length>0&&input.password.length<=4096,'Enter your password.');
  const response=await sharedFetch(fetcher,config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.publicKey,'Content-Type':'application/json'},body:JSON.stringify({email,password:input.password})});
  if(!response.ok)throw new AppError(response.status===429?429:response.status>=500?503:401,response.status===429?'Too many sign-in attempts. Wait before trying again.':'Shared sign-in was not confirmed. Check your account or try again.');
  const session=object(await sharedResponse(response,64000));requireThat(typeof session.access_token==='string'&&/^[A-Za-z0-9_.-]{16,8192}$/.test(session.access_token)&&Number.isFinite(session.expires_in)&&Number(session.expires_in)>0,'Shared sign-in returned an invalid session.',503);
  const user=await verifySharedUser(config,session.access_token,fetcher);
  // Ensure an approved shared restaurant exists before saving a browser session.
  const allowed=await memberships(config,user.id,fetcher);requireThat(allowed.memberships.length>0,'Your shared sign-in is verified; restaurant access still needs approval.',403);
  return json({signedIn:true,user},200,sharedStoreSessionCookie(session.access_token,Math.min(3600,Math.floor(Number(session.expires_in)))));
 }catch(error){return errorResponse(error)}
}

