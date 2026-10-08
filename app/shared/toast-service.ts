import { authenticateWorkspace, boundedJson, requireLocationAdministrator } from './service';
import {restaurantAccessWriteGuard} from './restaurant-access';
import { configuredToast, readConnectedToast } from './toast-connection';
import { AppError, id, object, requireThat } from './validation';
import type { ToastRoster } from './toast-roster';
import { ToastAuthWait } from './toast-auth-cache';

export type ToastSetup={configured:boolean;roster:ToastRoster|null;unmatchedLocation:boolean;nextAttemptAt:string|null};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
// This is an administrator-only read/import-preview route. It cannot create
// memberships, assign capabilities, alter shifts or send employee invitations.
export async function handleToast(request:Request,binding?:D1Database,bindings?:unknown,fetcher:typeof fetch=fetch):Promise<Response> {
  try {
    requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
    const {db,identity,authUserId}=await authenticateWorkspace(request,binding),url=new URL(request.url);
    let locationId:string;
    if(request.method==='POST'){
      requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);
      requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
      const input=object(await boundedJson(request.body,2000));locationId=id(input.locationId);
      requireThat(Object.keys(input).every(k=>k==='locationId'),'Connection settings must be configured on the server.');
    }else locationId=id(url.searchParams.get('locationId'));
    const actor=await requireLocationAdministrator(db,identity,locationId),config=configuredToast(bindings,locationId);
    const view=async():Promise<ToastSetup>=>{
      const rows=await db.batch([
        db.prepare('SELECT restaurant_guid, data FROM toast_rosters WHERE location_id = ?').bind(locationId),
        db.prepare("SELECT started_at FROM integration_attempts WHERE location_id = ? AND provider = 'toast'").bind(locationId),
      ]);
      const saved=rows[0].results[0] as {restaurant_guid:string;data:string}|undefined;
      const attempt=rows[1].results[0] as {started_at:number}|undefined;
      const unmatchedLocation=!!(saved&&config&&saved.restaurant_guid!==config.restaurantGuid);
      return {configured:!!config,roster:saved&&!unmatchedLocation?JSON.parse(saved.data) as ToastRoster:null,unmatchedLocation,nextAttemptAt:attempt?new Date(attempt.started_at+60000).toISOString():null};
    };
    if(request.method==='GET')return json(await view());
    requireThat(config,'Toast has not been connected to this restaurant in JMAX yet.',503);
    const policy=await restaurantAccessWriteGuard(db,identity,locationId);
    const now=Date.now(),attemptId=crypto.randomUUID();
    // One shared attempt per minute prevents double-clicks or another browser
    // from making overlapping requests. Authentication plus reads time out sooner.
    const lease=await db.prepare("INSERT INTO integration_attempts (location_id,provider,token,started_at) VALUES (?,'toast',?,?) ON CONFLICT(location_id,provider) DO UPDATE SET token=excluded.token,started_at=excluded.started_at WHERE integration_attempts.started_at <= ?")
      .bind(locationId,attemptId,now,now-60000).run();
    requireThat(lease.meta.changes,'A Toast refresh was requested recently. Wait a minute before trying again.',429);
    const roster=await readConnectedToast(config,fetcher,db);
    requireThat(roster.employees.length,'Toast returned no employee records. The saved roster has been kept for review.',502);
    // Losing authority during the upstream read cannot save or reveal the roster.
    const refreshed=await authenticateWorkspace(request,binding);
    requireThat(refreshed.authUserId===authUserId,'Restaurant access changed. Refresh before reading Toast again.',409);
    const current=await requireLocationAdministrator(db,refreshed.identity,locationId);
    requireThat(current.member.id===actor.member.id&&current.revision===actor.revision,'Restaurant access changed. Refresh before reading Toast again.',409);
    requireThat(JSON.stringify(configuredToast(bindings,locationId))===JSON.stringify(config),'The connection changed. Refresh before reading Toast again.',409);
    const gate="EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND active=1 AND revision=?) AND EXISTS(SELECT 1 FROM integration_attempts WHERE location_id=? AND provider='toast' AND token=?) AND "+policy.sql;
    const data=JSON.stringify(roster),at=new Date().toISOString();
    const result=await db.batch([
      db.prepare(`INSERT INTO toast_rosters(location_id,restaurant_guid,data,retrieved_at,requested_by) SELECT ?,?,?,?,? WHERE ${gate} ON CONFLICT(location_id) DO UPDATE SET restaurant_guid=excluded.restaurant_guid,data=excluded.data,retrieved_at=excluded.retrieved_at,requested_by=excluded.requested_by`)
        .bind(locationId,config.restaurantGuid,data,roster.retrievedAt,actor.member.id,actor.member.id,authUserId,actor.revision,locationId,attemptId,...policy.values),
      db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,'toast.roster-read',?,?,0 WHERE ${gate}`)
        .bind(attemptId,locationId,actor.member.id,locationId,at,actor.member.id,authUserId,actor.revision,locationId,attemptId,...policy.values),
    ]);
    requireThat(result[0].meta.changes,'Restaurant access or the connection attempt changed. Refresh and try again.',409);
    return json(await view());
  }catch(error){
    // Never echo provider bodies, credentials, roster contents or exception text.
    if(error instanceof ToastAuthWait)return json({error:error.message,nextAttemptAt:error.nextAttemptAt},429);
    if(error instanceof AppError)return json({error:error.message},error.status);
    return json({error:'Toast could not complete this read. The saved roster has not been replaced.'},503);
  }
}
