import { authenticateWorkspace, boundedJson, requireLocationAdministrator } from './service';
import {restaurantAccessWriteGuard} from './restaurant-access';
import { parseHotSchedules, scheduleDate, type SavedSchedule } from './hotschedules-import';
import { AppError, id, object, requireThat, text } from './validation';

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
type Row={id:string;data:string;source_hash:string};
// Imported weeks are private reference records. This endpoint never provisions
// staff, links identities, publishes shifts, sends messages or calls a provider.
export async function handleScheduleImport(request:Request,binding?:D1Database):Promise<Response>{
  try{
    requireThat(['GET','POST'].includes(request.method),'Method not allowed.',405);
    const url=new URL(request.url),{db,identity,authUserId}=await authenticateWorkspace(request,binding);
    let input:Record<string,unknown>={};
    if(request.method==='POST'){
      requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);
      requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
      input=object(await boundedJson(request.body,128000));
      requireThat(Object.keys(input).every(k=>['locationId','action','csv','weekStart','fileName','expectedLatestId','confirmed'].includes(k)),'The import contains unsupported fields.');
    }
    const locationId=id(request.method==='GET'?url.searchParams.get('locationId'):input.locationId);
    const actor=await requireLocationAdministrator(db,identity,locationId);
    const location=await db.prepare('SELECT timezone, revision FROM locations WHERE id=?').bind(locationId).first<{timezone:string;revision:number}>();
    requireThat(location,'Restaurant not found.',404);
    const latest=(week:string)=>db.prepare('SELECT id,data,source_hash FROM schedule_imports WHERE location_id=? AND week_start=? ORDER BY rowid DESC LIMIT 1').bind(locationId,week).first<Row>();
    if(request.method==='GET'){
      const weeks=await db.prepare('SELECT id,week_start AS weekStart,imported_at AS importedAt FROM schedule_imports WHERE rowid IN (SELECT MAX(rowid) FROM schedule_imports WHERE location_id=? GROUP BY week_start) ORDER BY week_start DESC LIMIT 104').bind(locationId).all();
      const requested=url.searchParams.get('weekStart'),week=requested?scheduleDate(requested):weeks.results[0]?.weekStart as string|undefined;
      const row=week?await latest(week):null;
      return json({weeks:weeks.results,saved:row?JSON.parse(row.data):null});
    }
    requireThat(input.action==='preview'||input.action==='save','Choose preview or save.');
    const fileName=text(input.fileName,'Filename',180),csv=text(input.csv,'Weekly roster',100000),week=parseHotSchedules(csv,input.weekStart,fileName);
    const previous=await latest(week.weekStart);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(week)))),b=>b.toString(16).padStart(2,'0')).join('');
    if(input.action==='preview')return json({preview:week,expectedLatestId:previous?.id??null});
    requireThat(input.confirmed===true,'Confirm the restaurant and exact week before saving.');
    if(previous?.source_hash===hash)return json({saved:JSON.parse(previous.data),repeated:true});
    requireThat((previous?.id??null)===input.expectedLatestId,'This week changed after your preview. Preview again before saving.',409);
    const already=await db.prepare('SELECT id FROM schedule_imports WHERE location_id=? AND week_start=? AND source_hash=?').bind(locationId,week.weekStart,hash).first();
    requireThat(!already,'This is an older copy of a week already imported. The newer saved week has been kept.',409);
    const at=new Date().toISOString(),recordId=crypto.randomUUID();
    const saved:SavedSchedule={...week,id:recordId,fileName,importedAt:at,timezone:location.timezone};
    const data=JSON.stringify(saved);requireThat(new TextEncoder().encode(data).byteLength<=800000,'This saved week is too large.',413);
    const gate='EXISTS(SELECT 1 FROM locations WHERE id=? AND last_command=?)';
    const policy=await restaurantAccessWriteGuard(db,identity,locationId);
    const committed=await db.batch([
      db.prepare(`UPDATE locations SET revision=revision+1,last_command=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND active=1 AND revision=?) AND ${policy.sql}`).bind(recordId,locationId,location.revision,actor.member.id,authUserId,actor.revision,...policy.values),
      db.prepare(`INSERT INTO schedule_imports(id,location_id,week_start,source_hash,data,imported_at,imported_by) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(recordId,locationId,week.weekStart,hash,data,at,actor.member.id,locationId,recordId),
      db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,'schedule.import',?,?,? WHERE ${gate}`).bind(recordId,locationId,actor.member.id,recordId,at,location.revision+1,locationId,recordId),
    ]);
    if(!committed[0].meta.changes){const now=await latest(week.weekStart);if(now?.source_hash===hash){await requireLocationAdministrator(db,identity,locationId);return json({saved:JSON.parse(now.data),repeated:true});}throw new AppError(409,'Your workspace changed. Preview this week again before saving.');}
    return json({saved,repeated:false});
  }catch(error){if(error instanceof AppError)return json({error:error.message},error.status);return json({error:'The schedule could not be imported. Refresh to check whether this week was saved before trying again.'},503);}
}
