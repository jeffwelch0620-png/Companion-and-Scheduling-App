import {authenticateWorkspace,requireLocationAdministrator} from './service';
import {configuredToast,readConnectedToastSchedule} from './toast-connection';
import {calendarDate} from './schedule-policy';
import {AppError,id,requireThat} from './validation';
import {ToastAuthWait} from './toast-auth-cache';

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
// Explicit administrator read of POS planned shifts. No schedule import or
// shift mutation; credentials and restaurant identity are server-controlled.
export async function handleToastSchedule(request:Request,binding?:D1Database,bindings?:unknown,fetcher:typeof fetch=fetch):Promise<Response>{
  try{
    requireThat(request.method==='GET','Method not allowed.',405);
    const {db,identity}=await authenticateWorkspace(request,binding),url=new URL(request.url);
    requireThat([...url.searchParams.keys()].every(k=>['locationId','weekStart'].includes(k)),'Use only the restaurant and week parameters.');
    requireThat(url.searchParams.getAll('locationId').length===1&&url.searchParams.getAll('weekStart').length===1,'Choose one restaurant and week.');
    const locationId=id(url.searchParams.get('locationId')),weekStart=calendarDate(url.searchParams.get('weekStart'),'Week starting');
    const actor=await requireLocationAdministrator(db,identity,locationId),config=configuredToast(bindings,locationId);
    requireThat(config,'The server connection for this restaurant is not configured.',503);
    const location=await db.prepare('SELECT timezone FROM locations WHERE id=?').bind(locationId).first<{timezone:string}>();
    requireThat(location,'Restaurant not found.',404);
    const snapshot=await readConnectedToastSchedule(config,weekStart,location.timezone,fetcher,db);
    const linked=await db.prepare("SELECT a.employee_id,m.id AS memberId,m.name FROM access_reviews a JOIN memberships m ON m.id=a.member_id AND m.location_id=a.location_id WHERE a.location_id=? AND a.restaurant_guid=? AND a.status='applied' AND m.active=1 AND m.schedule_only=0")
      .bind(locationId,config.restaurantGuid).all<{employee_id:string;memberId:string;name:string}>();
    const sourceIds=new Set(snapshot.shifts.map(s=>s.toastEmployeeId));
    const matches=new Map<string,typeof linked.results>();
    for(const row of linked.results){const key=row.employee_id.toLowerCase();matches.set(key,[...(matches.get(key)??[]),row]);}
    // A conflicting identity must remain unmatched, never become whichever row
    // happened to be returned last by the database or selected by the screen.
    const employees=[...matches.entries()].filter(([key,rows])=>sourceIds.has(key)&&rows.length===1).map(([toastEmployeeId,[row]])=>({toastEmployeeId,memberId:row.memberId,name:row.name}));
    const refreshed=await authenticateWorkspace(request,binding);
    requireThat(refreshed.authUserId===identity.authUserId,'Access changed. Refresh before reading this schedule.',409);
    const current=await requireLocationAdministrator(db,refreshed.identity,locationId);
    requireThat(current.member.id===actor.member.id&&current.revision===actor.revision,'Access changed. Refresh before reading this schedule.',409);
    const currentLocation=await db.prepare('SELECT timezone FROM locations WHERE id=?').bind(locationId).first<{timezone:string}>();
    requireThat(currentLocation?.timezone===location.timezone,'The restaurant timezone changed. Refresh before reading this schedule.',409);
    requireThat(JSON.stringify(configuredToast(bindings,locationId))===JSON.stringify(config),'The connection changed. Refresh before reading this schedule.',409);
    return json({locationId,previewOnly:true,source:'toast-labor-scheduled-shifts',snapshot,employees,message:'POS planned shifts only. This does not verify the Sling calendar or change the JMAX schedule.'});
  }catch(error){
    if(error instanceof ToastAuthWait)return json({error:'Toast connection requests are cooling down. Try again later.',nextAttemptAt:error.nextAttemptAt},429);
    if(error instanceof AppError)return json({error:error.message},error.status);
    return json({error:'Toast schedule preview could not be read. The JMAX schedule has not changed.'},503);
  }
}
