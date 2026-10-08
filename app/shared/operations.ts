import { has, manages, type Member, type RecordOf, type Workspace } from './types';
import type { CommandContext } from './followthrough';
import { requireThat, text, instant } from './validation';
import { localDate, localInstant, nextDate } from './local-time';
import { calendarDate } from './schedule-policy';

export const logCategories = ['Shift handoff', 'Maintenance', 'Guest recovery', 'Food and prep', 'Safety', 'Staffing', 'Other'] as const;
export function operationsManager(me:Member,area?:string) {
  // Whole-store operations does not grant access administration or widen other
  // capability scopes. Commissary production still needs its own membership.
  const storeOperations=has(me,'tasks.manage')&&has(me,'operations.store');
  return me.position!=='Dishwasher' && (has(me,'location.manage') || manages(me,area??me.area,'tasks.manage') || storeOperations&&(area===undefined||['FOH','BOH'].includes(area)));
}
export function meetingReader(r:RecordOf<'meeting'>,me:Member) {
  return me.locationId===r.locationId && me.position!=='Dishwasher' && [r.ownerId,r.data.managerId].includes(me.id);
}
// Reconstruct opening carryover from history, not the issue's latest status.
// A closure day does not erase an issue; it carries to the next actual opening.
export function carriedIssues(w:Workspace,date:string,department?:string) {
  return w.records.filter((r):r is RecordOf<'managerlog'>=>{
    if(r.kind!=='managerlog'||r.locationId!==w.location.id||!operationsManager(w.me,r.area)||department&&r.area!==department)return false;
    let open=false;
    for(const event of r.data.history.filter(h=>localDate(h.at,w.location.timezone)<date).sort((a,b)=>a.at.localeCompare(b.at))){
      if(['created','opened','reopen','reopened'].includes(event.action))open=true;
      if(['resolve','resolved'].includes(event.action))open=false;
    }
    return open;
  });
}
export function previousShift(w:Workspace,date:string,department:string) {
  return w.records.filter((r):r is RecordOf<'shiftentry'>=>r.kind==='shiftentry'&&r.locationId===w.location.id&&r.area===department&&operationsManager(w.me,r.area)&&r.data.businessDate<date&&r.data.shift!=='opening'&&r.data.status==='submitted')
    .sort((a,b)=>b.data.businessDate.localeCompare(a.data.businessDate)||b.data.submittedAt.localeCompare(a.data.submittedAt))[0];
}
export function applyOperations(c:CommandContext) {
  const {w,me,command,input,at,member,find,save,create,history}=c;
  const manager=(value:unknown,area?:string)=>{const m=member(value);requireThat(operationsManager(m,area??m.area),'Choose an authorized manager.',403);return m;};
  if(command.action.startsWith('shiftentry.')) {
    requireThat(operationsManager(me),'Manager access is required.',403);
    const existing=command.recordId?find('shiftentry'):null;
    if(existing)requireThat(operationsManager(me,existing.area),'Access is required for this department.',403);
    if(command.action==='shiftentry.submit'){
      requireThat(existing&&existing.data.status==='draft','Choose a draft shift summary.');
      requireThat(existing.data.summary.trim(),'Write the shift summary before submitting.');
      save({...existing,data:{...existing.data,status:'submitted',submittedAt:at,history:[...existing.data.history,history('submitted','Shift summary submitted.')]}});return;
    }
    requireThat(command.action==='shiftentry.save','Unknown shift-summary action.');
    const department=existing?.area??text(input.department,'Department',40);
    requireThat(['FOH','BOH','combined','production'].includes(department),'Choose a department.');
    requireThat(operationsManager(me,department),'This department is outside your access.',403);
    const businessDate=existing?.data.businessDate??calendarDate(input.businessDate,'Business date');
    requireThat(businessDate<=localDate(at,w.location.timezone),'Shift summaries cannot be submitted for a future business date.');
    const shift=existing?.data.shift??input.shift;
    requireThat(shift==='opening'||shift==='closing'||shift==='production','Choose a shift.');
    requireThat(!w.records.some(r=>r.kind==='shiftentry'&&r.id!==existing?.id&&r.area===department&&r.data.businessDate===businessDate&&r.data.shift===shift),'A summary already exists for this department, date and shift. Open it to continue.',409);
    requireThat(['not-assessed','ready','action-needed'].includes(String(input.readiness)),'Choose a readiness status.');
    requireThat(Array.isArray(input.issueIds)&&input.issueIds.length<=100,'Choose up to 100 related issues.');
    const issueIds=[...new Set(input.issueIds.map(value=>{
      const issue=w.records.find((r):r is RecordOf<'managerlog'>=>r.id===value&&r.kind==='managerlog'&&r.locationId===me.locationId&&r.area===department);
      requireThat(issue,'Linked issues must belong to this restaurant and department.');return issue.id;
    }))];
    const amendment=existing?.data.status==='submitted'?text(input.note,'Reason for correction'):'';
    const data:RecordOf<'shiftentry'>['data']={title:`${department} ${shift} · ${businessDate}`,businessDate,shift,department,status:existing?.data.status??'draft',readiness:input.readiness as RecordOf<'shiftentry'>['data']['readiness'],summary:text(input.summary,'Shift summary',6000),tomorrowNote:text(input.tomorrowNote,'Next shift note',4000,true),issueIds,submittedAt:existing?.data.submittedAt??'',history:[...(existing?.data.history??[]),history(existing?'corrected':'drafted',amendment||'Shift summary saved.')],versions:[...(existing?.data.versions??[]),...(existing?[{at:existing.updatedAt,by:existing.data.history.at(-1)?.actorId??existing.ownerId,summary:existing.data.summary,tomorrowNote:existing.data.tomorrowNote,readiness:existing.data.readiness,issueIds:existing.data.issueIds}]:[])]};
    requireThat(data.versions.length<=100,'This entry has reached its correction history limit.');
    if(existing)save({...existing,data});else create({kind:'shiftentry',data},{...me,area:department});return;
  }
  if(command.action==='managerlog.create') {
    requireThat(operationsManager(me),'Manager access is required.',403);
    const department=text(input.department??me.area,'Department',40);
    requireThat(['FOH','BOH','combined','production'].includes(department),'Choose a department.');
    requireThat(operationsManager(me,department),'This department is outside your access.',403);
    const owner=manager(input.ownerId,department);
    requireThat(logCategories.some(x=>x===input.category),'Choose a category.');
    requireThat(input.priority==='routine'||input.priority==='urgent','Choose a priority.');
    const data:RecordOf<'managerlog'>['data']={title:text(input.title,'Summary',200),detail:text(input.detail,'What happened and next step',4000),category:input.category as typeof logCategories[number],priority:input.priority,due:instant(input.due,'Follow-up due'),status:'open',acceptedBy:'',resolution:'',history:[history('created','Recorded in Manager Log. No phone call, email or text has been sent.')]};
    create({kind:'managerlog',data},{...owner,area:department});return;
  }
  if(command.action.startsWith('managerlog.')) {
    const r=find('managerlog');
    requireThat(operationsManager(me,r.area),'Manager access is required for this department.',403);
    const note=text(input.note,'Update',4000);
    let data={...r.data,history:[...r.data.history,history(command.action.slice(11),note)]};
    if(command.action==='managerlog.accept') {
      requireThat(r.ownerId===me.id && r.data.status!=='resolved','Only the assigned manager can accept an open item.',403);
      data={...data,acceptedBy:me.id,status:'accepted'};
    } else if(command.action==='managerlog.resolve') {
      requireThat(r.data.status!=='resolved','This item is already resolved.');
      requireThat(r.ownerId===me.id||has(me,'location.manage'),'The assigned manager or owner must resolve this item.',403);
      data={...data,status:'resolved',resolution:note};
    } else if(command.action==='managerlog.reopen') {
      requireThat(r.data.status==='resolved','This item is already open.');
      data={...data,status:'open',acceptedBy:'',resolution:''};
    } else if(command.action==='managerlog.reassign') {
      requireThat(r.data.status!=='resolved','Reopen the issue before changing responsibility.');
      const owner=manager(input.ownerId,r.area);
      requireThat(operationsManager(owner,r.area),'Choose a manager for this department.');
      save({...r,ownerId:owner.id,data:{...data,due:instant(input.due,'Follow-up due'),status:'open',acceptedBy:'',history:[...r.data.history,history('reassigned',`${note} Assigned to ${owner.name}.`)]}});return;
    } else requireThat(command.action==='managerlog.note','Unknown Manager Log action.');
    save({...r,data});return;
  }
  if(command.action==='meeting.create') {
    requireThat(has(me,'location.manage'),'A restaurant owner or administrator must set up one-on-ones.',403);
    const target=manager(input.managerId);
    requireThat(target.id!==me.id,'Choose the manager you will meet with.');
    requireThat(!w.records.some(r=>r.kind==='meeting'&&r.ownerId===me.id&&r.data.managerId===target.id&&r.data.status==='active'),'An active one-on-one already exists for this pair. Open it instead.',409);
    requireThat(Number.isInteger(input.cadenceDays)&&Number(input.cadenceDays)>=1&&Number(input.cadenceDays)<=90,'Choose a cadence from 1 to 90 days.');
    const data:RecordOf<'meeting'>['data']={title:`One-on-one with ${target.name}`,managerId:target.id,cadenceDays:Number(input.cadenceDays),due:instant(input.due,'Next meeting'),agenda:text(input.agenda,'Agenda',4000,true),status:'active',actions:[],sessions:[],history:[history('created','Private to the two participants.')]};
    create({kind:'meeting',data});return;
  }
  const r=find('meeting');
  requireThat(meetingReader(r,me),'This meeting is private to its participants.',403);
  requireThat(r.data.status==='active','This meeting series is paused.');
  if(command.action==='meeting.schedule') {
    requireThat(me.id===r.ownerId,'The owner participant manages the cadence.',403);
    requireThat(Number.isInteger(input.cadenceDays)&&Number(input.cadenceDays)>=1&&Number(input.cadenceDays)<=90,'Choose a cadence from 1 to 90 days.');
    save({...r,data:{...r.data,due:instant(input.due,'Next meeting'),cadenceDays:Number(input.cadenceDays),agenda:text(input.agenda,'Agenda',4000,true),history:[...r.data.history,history('rescheduled',text(input.note,'Reason'))]}});return;
  }
  if(command.action==='meeting.action') {
    const owner=member(input.ownerId);requireThat([r.ownerId,r.data.managerId].includes(owner.id),'Choose one of the meeting participants.');
    requireThat(r.data.actions.length<200,'Complete or review existing follow-ups before adding more.');
    save({...r,data:{...r.data,actions:[...r.data.actions,{id:crypto.randomUUID(),title:text(input.title,'Next action',300),ownerId:owner.id,due:instant(input.due,'Action due'),doneAt:''}],history:[...r.data.history,history('action-added',text(input.title,'Next action',300))]}});return;
  }
  if(command.action==='meeting.action-complete') {
    const action=r.data.actions.find(a=>a.id===input.actionId);requireThat(action&&!action.doneAt,'Choose an unfinished action.');
    save({...r,data:{...r.data,actions:r.data.actions.map(a=>a.id===action.id?{...a,doneAt:at}:a),history:[...r.data.history,history('action-completed',action.title)]}});return;
  }
  requireThat(command.action==='meeting.complete','Unknown one-on-one action.');
  const notes=text(input.notes,'Meeting notes',8000);
  const date=localDate(at,w.location.timezone),clock=new Intl.DateTimeFormat('en-GB',{timeZone:w.location.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(r.data.due));
  const due=localInstant(nextDate(date,r.data.cadenceDays),clock,w.location.timezone,'later');
  requireThat(r.data.sessions.length<200,'This series is full. Preserve its history before starting another.');
  save({...r,data:{...r.data,due,sessions:[...r.data.sessions,{at,by:me.id,notes,agenda:r.data.agenda}],history:[...r.data.history,history('completed','Next meeting scheduled; unfinished actions carry forward.')]}});
}
