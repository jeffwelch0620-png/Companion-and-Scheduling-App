import {handleWorkspace} from './service';
import {AppError,requireThat} from './validation';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {has,type Workspace,type RecordOf} from './types';
import {visible} from './domain';
import {operationsManager,carriedIssues,previousShift} from './operations';

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});

// Read-only boundary for the separately owned close-to-prep module. IDs and
// revisions refer to existing records; this does not copy or submit any counts.
export function managerHandoff(w:Workspace,date:string,department?:string){
 requireThat(operationsManager(w.me),'Manager access is required.',403);
 calendarDate(date,'Business date');
 if(department){requireThat(['FOH','BOH','combined','production'].includes(department),'Choose a department.');requireThat(operationsManager(w.me,department),'Access is required for this department.',403);}
 const records=w.records.filter(r=>r.locationId===w.location.id&&visible(r,w.me,w)&&(!department||r.area===department));
 const scoped={...w,records};
 const entries=records.filter((r):r is RecordOf<'shiftentry'>=>r.kind==='shiftentry'&&r.data.businessDate===date);
 const issues=records.filter((r):r is RecordOf<'managerlog'>=>r.kind==='managerlog');
 const carried=carriedIssues(scoped,date,department);
 const issueIds=new Set([...carried.map(r=>r.id),...entries.flatMap(r=>r.data.issueIds),...issues.filter(r=>r.data.status!=='resolved').map(r=>r.id)]);
 const areas=department?[department]:has(w.me,'location.manage')?[...new Set(records.filter(r=>r.kind==='shiftentry').map(r=>r.area))]:[...new Set([w.me.area,'FOH','BOH'])].filter(area=>['FOH','BOH','combined','production'].includes(area)&&operationsManager(w.me,area));
 const entry=(r:RecordOf<'shiftentry'>)=>({id:r.id,revision:r.revision,store_id:r.locationId,business_date:r.data.businessDate,department:r.area,shift:r.data.shift,author_id:r.ownerId,record_state:r.data.status,submitted_at:r.data.submittedAt||null,readiness:r.data.readiness,shift_summary:r.data.summary,tomorrow_note:r.data.tomorrowNote,issue_ids:r.data.issueIds});
 return {schema_version:'jmax-manager-handoff.v1',store_id:w.location.id,business_date:date,timezone:w.location.timezone,
  department:department??null,opening_carried_issue_ids:carried.map(r=>r.id),
  previous_handoffs:areas.map(area=>previousShift(scoped,date,area)).filter((r):r is RecordOf<'shiftentry'>=>!!r).map(entry),
  shift_entries:entries.map(entry),
  issues:issues.filter(r=>issueIds.has(r.id)).map(r=>({id:r.id,revision:r.revision,store_id:r.locationId,department:r.area,category:r.data.category,summary:r.data.title,detail:r.data.detail,assigned_member_id:r.ownerId,due_at:r.data.due,current_status:r.data.status,accepted_by:r.data.acceptedBy||null,resolution:r.data.resolution,history:r.data.history})),
 };
}

export async function handleOperationsHandoff(request:Request,db:D1Database|undefined){
 if(request.method!=='GET')return json({error:'This handoff is read-only.'},405);
 try{
  const url=new URL(request.url),locationId=url.searchParams.get('locationId');
  requireThat(locationId,'Choose a restaurant.');
  const source=new URL('/api/workspace',url);source.searchParams.set('locationId',locationId);
  const response=await handleWorkspace(new Request(source,{headers:request.headers}),db);
  if(!response.ok)return response;
  const w=await response.json() as Workspace;
  const date=url.searchParams.get('date')??localDate(new Date().toISOString(),w.location.timezone);
  return json(managerHandoff(w,date,url.searchParams.get('department')??undefined));
 }catch(error){return json({error:error instanceof AppError?error.message:'The manager handoff could not be loaded.'},error instanceof AppError?error.status:503);}
}
