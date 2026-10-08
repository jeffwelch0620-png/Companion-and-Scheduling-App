import { authenticateWorkspace, boundedJson, requireLocationAdministrator } from './service';
import {restaurantAccessWriteGuard} from './restaurant-access';
import { localInstant, nextDate } from './local-time';
import { AppError, id, object, requireThat } from './validation';
import type { SavedSchedule } from './hotschedules-import';

type Person={id:string;name:string;active:number;schedule_only:number;area:string;revision:number;employment:string};
type Source={id:string;data:string;transferred_at:string|null};
const department=(value:string)=>value==='Manager'?'Executive':value;
const key=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
const clock=(value:string)=>{const m=/^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(value);requireThat(m,'A saved shift needs its time corrected.');return String(Number(m[1])%12+(m[3]==='PM'?12:0)).padStart(2,'0')+':'+m[2];};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});

// Materialize a previously saved, complete roster into the ordinary JMAX
// scheduling tables. The source snapshot remains solely as audit evidence.
// New roster records never claim a login, grant capabilities or training.
export async function handleScheduleTransfer(request:Request,binding?:D1Database):Promise<Response>{
 try{
  requireThat(['GET','POST'].includes(request.method),'Method not allowed.',405);
  const {db,identity,authUserId}=await authenticateWorkspace(request,binding),url=new URL(request.url);
  let input:Record<string,unknown>={};
  if(request.method==='POST'){
   requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from JMAX.',403);
   requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use JSON.',415);
   input=object(await boundedJson(request.body,3000));
   requireThat(Object.keys(input).every(k=>['locationId','sourceId','revision','confirmed'].includes(k)),'Unexpected schedule fields.');
  }
  const locationId=id(request.method==='GET'?url.searchParams.get('locationId'):input.locationId);
  const actor=await requireLocationAdministrator(db,identity,locationId);
  const result=await db.batch([
   db.prepare('SELECT * FROM locations WHERE id=?').bind(locationId),
   db.prepare('SELECT id,data,transferred_at FROM schedule_imports WHERE location_id=? ORDER BY rowid DESC LIMIT 1').bind(locationId),
   db.prepare('SELECT id,name,active,schedule_only,area,revision,employment FROM memberships WHERE location_id=?').bind(locationId),
   db.prepare('SELECT id,owner_id,data FROM records WHERE location_id=? AND kind=?').bind(locationId,'shift'),
   db.prepare('SELECT COUNT(*) AS total FROM records WHERE location_id=? AND archived_at IS NULL').bind(locationId),
  ]);
  const location=result[0].results[0] as {revision:number;timezone:string},source=result[1].results[0] as Source|undefined;
  requireThat(location,'Restaurant not found.',404);
  if(!source||source.transferred_at){
   if(request.method==='POST')requireThat(source?.id===input.sourceId,'This saved week changed. Refresh first.',409);
   return json({pending:false,...(source?{weekStart:(JSON.parse(source.data) as SavedSchedule).weekStart}:{})});
  }
  const week=JSON.parse(source.data) as SavedSchedule,people=result[2].results as Person[];
  requireThat(week.shifts.length>0&&week.shifts.length<=2000,'The saved week needs review.');
  const names=[...new Set(week.shifts.map(s=>s.employee))],conflicts:string[]=[];
  const roster=names.map(name=>{
   const matches=people.filter(p=>key(p.name)===key(name));
   if(matches.length>1||matches.some(p=>!p.active&&!p.schedule_only))conflicts.push(name);
   const shifts=week.shifts.filter(s=>s.employee===name),areas=[...new Set(shifts.map(s=>department(s.schedule)))];
   if(areas.some(a=>!['FOH','BOH','Executive','Management'].includes(a)))conflicts.push(name+' (department)');
   const jobs=[...new Set(shifts.map(s=>/^(dish|dishwasher)$/i.test(s.job)?'Dishwasher':s.job))];
   return {name,existing:matches.length===1?matches[0]:undefined,area:areas[0],jobs};
  });
  if(new Set(names.map(key)).size!==names.length)conflicts.push('Duplicate names with different spelling or capitalization');
  const existing=result[3].results as {id:string;owner_id:string;data:string}[];
  const planned=week.shifts.map(s=>{
   const person=roster.find(p=>p.name===s.employee)!;
   const start=localInstant(s.date,clock(s.start),location.timezone),end=localInstant(s.endsNextDay?nextDate(s.date):s.date,clock(s.end),location.timezone);
   requireThat((Date.parse(end)-Date.parse(start))/60000===s.minutes,'A saved shift crosses a clock change and needs review before moving.');
   if(person.existing&&existing.some(r=>{const d=JSON.parse(r.data);return r.owner_id===person.existing!.id&&!d.cancelled&&d.start<end&&start<d.end;}))conflicts.push(s.employee+' (existing shift)');
   return {...s,start,end,position:/^(dish|dishwasher)$/i.test(s.job)?'Dishwasher':s.job};
  });
  const preview={pending:true,sourceId:source.id,revision:location.revision,weekStart:week.weekStart,weekEnd:week.weekEnd,people:names.length,shifts:planned.length,minutes:week.minutes,newPeople:roster.filter(p=>!p.existing).length,conflicts:[...new Set(conflicts)]};
  if(request.method==='GET')return json(preview);
  requireThat(input.confirmed===true,'Confirm the saved week.');
  requireThat(input.sourceId===source.id&&input.revision===location.revision,'The schedule changed. Refresh and review it again.',409);
  requireThat(!conflicts.length,'Some employee names or shifts need review: '+preview.conflicts.join(', '),409);
  requireThat(Number((result[4].results[0] as {total:number}).total)+planned.length<=3000,'Archive older records before adding this week.',409);
  const token=crypto.randomUUID(),at=new Date().toISOString(),gate='EXISTS(SELECT 1 FROM locations WHERE id=? AND last_command=?)';
  const policy=await restaurantAccessWriteGuard(db,identity,locationId);
  const commands=[db.prepare(`UPDATE locations SET revision=revision+1,last_command=?,week_starts_on=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND active=1 AND revision=?) AND EXISTS(SELECT 1 FROM schedule_imports WHERE id=? AND location_id=? AND transferred_at IS NULL) AND ${policy.sql}`).bind(token,new Date(week.weekStart+'T12:00:00Z').getUTCDay(),locationId,location.revision,actor.member.id,authUserId,actor.revision,source.id,locationId,...policy.values)];
  const owners=new Map<string,string>();
  for(const person of roster){
   const memberId=person.existing?.id??crypto.randomUUID();owners.set(person.name,memberId);
   if(!person.existing)commands.push(db.prepare(`INSERT INTO memberships(id,location_id,name,email,area,position,active,schedule_only,schedule_jobs,employment) SELECT ?,?,?,'',?,?,0,1,?,? WHERE ${gate}`).bind(memberId,locationId,person.name,person.area,person.jobs[0],JSON.stringify(person.jobs),JSON.stringify({status:'onboarding',hireDate:null,endedDate:null,departureReason:null,archivedAt:null}),locationId,token));
  }
  for(const s of planned){
   const memberId=owners.get(s.employee)!;
   const data={personId:memberId,start:s.start,end:s.end,position:s.position,published:true,cancelled:false,importedFrom:{id:source.id,sourceRow:s.sourceRow,meal:s.meal,break:s.break},history:[{actorId:actor.member.id,action:'schedule-added',note:'Existing weekly assignment added to JMAX.',at}]};
   commands.push(db.prepare(`INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) SELECT ?,?,'shift',?,?,1,?,? WHERE ${gate}`).bind(crypto.randomUUID(),locationId,memberId,department(s.schedule),JSON.stringify(data),at,locationId,token));
  }
  commands.push(db.prepare(`UPDATE schedule_imports SET transferred_at=? WHERE id=? AND ${gate}`).bind(at,source.id,locationId,token));
  commands.push(db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,'schedule.transfer',?,?,? WHERE ${gate}`).bind(token,locationId,actor.member.id,source.id,at,location.revision+1,locationId,token));
  const saved=await db.batch(commands);requireThat(saved[0].meta.changes===1,'The schedule changed while saving. Refresh and try again.',409);
  return json({pending:false,weekStart:week.weekStart,shifts:planned.length,people:names.length});
 }catch(e){if(e instanceof AppError)return json({error:e.message},e.status);return json({error:'The saved week could not be added. Refresh before trying again.'},503);}
}
