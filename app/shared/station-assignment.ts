import { canScheduleJob, manages, type Member, type RecordOf, type StationSetup, type Workspace } from './types';
import { object, requireThat, text } from './validation';
import { canonicalJobRole } from './job-role';
import { localDate, localInstant, nextDate } from './local-time';
import type { CommandContext } from './followthrough';

export function stationById(w:Workspace,id:string|undefined) {
  return w.records.find((r):r is RecordOf<'station'>=>r.kind==='station'&&r.locationId===w.location.id&&r.id===id);
}
export function stationAssignmentIssue(w:Workspace,person:Member,job:string,stationId?:string|null) {
  if(!stationId)return '';
  const station=stationById(w,stationId),setup=station?.data.setup;
  if(person.locationId!==w.location.id||!station||station.data.status!=='active'||station.area!==person.area)return 'Choose an active station in this employee’s department.';
  if(canonicalJobRole(person.position)==='Dishwasher'||canonicalJobRole(job)==='Dishwasher')return 'Dish uses its scheduling job without station training.';
  if(!setup||!setup.jobs.includes(job))return 'This station is not configured for the selected scheduling job.';
  if(!setup.allJobMembers&&!setup.memberIds.includes(person.id))return 'This employee has not been added to this station’s scheduling list.';
  if(!canScheduleJob(person,job))return 'This employee needs the underlying scheduling job first.';
  return '';
}
export const shiftStationName=(shift:RecordOf<'shift'>)=>shift.data.stationName??shift.data.position;
export const eligibleForStation=(w:Workspace,person:Member,station:RecordOf<'station'>)=>!!station.data.setup?.jobs.some(job=>!stationAssignmentIssue(w,person,job,station.id));
export function selectableStations(w:Workspace,person:Member,job:string) {
  return w.records.filter((r):r is RecordOf<'station'>=>r.kind==='station'&&!stationAssignmentIssue(w,person,job,r.id)).sort((a,b)=>a.data.title.localeCompare(b.data.title));
}
export function readStationSetup(w:Workspace,area:string,input:unknown):StationSetup|undefined {
  if(input===undefined)return undefined;
  const raw=object(input);
  const list=(key:string,max:number)=>{requireThat(Array.isArray(raw[key])&&(raw[key] as unknown[]).length<=max,`Review the station ${key} selection.`);const values=(raw[key] as unknown[]).map(v=>text(v,key,100));requireThat(new Set(values).size===values.length,'Remove duplicate station selections.');return values;};
  const jobs=list('jobs',40),memberIds=list('memberIds',500),standardIds=list('standardIds',40);
  requireThat(raw.allJobMembers===undefined||typeof raw.allJobMembers==='boolean','Choose whether station eligibility follows the scheduling jobs.');
  const allJobMembers=raw.allJobMembers===true;
  requireThat(jobs.every(job=>canonicalJobRole(job)!=='Dishwasher'&&w.members.some(m=>m.area===area&&canScheduleJob(m,job))),'Select existing scheduling jobs for this department; Dish stays separate.');
  requireThat(memberIds.every(id=>w.members.some(m=>m.id===id&&m.area===area&&canonicalJobRole(m.position)!=='Dishwasher'&&jobs.some(job=>canScheduleJob(m,job)))),'Each selected employee must have a matching job in this department.');
  requireThat(standardIds.every(id=>w.records.some(r=>r.kind==='standard'&&r.id===id&&r.locationId===w.location.id&&r.area===area&&r.data.status!=='retired')),'Choose current draft or approved guides for this department.');
  requireThat(Array.isArray(raw.goals)&&raw.goals.length<=5,'Use at most five station goals.');
  const goals=raw.goals.map(value=>{const goal=object(value),standardId=goal.standardId?text(goal.standardId,'Goal guide',100):undefined;
    requireThat(!standardId||standardIds.includes(standardId),'Link a goal only to one of this station’s guides.');
    requireThat(Number.isInteger(goal.dueDays)&&Number(goal.dueDays)>=1&&Number(goal.dueDays)<=90,'Choose a goal due date 1–90 days after the first scheduled shift.');
    return {id:text(goal.id,'Goal template identifier',100),title:text(goal.title,'Goal title',200),definition:text(goal.definition,'Observable goal outcome',2000),dueDays:Number(goal.dueDays),...(standardId?{standardId}:{})};});
  requireThat(new Set(goals.map(g=>g.id)).size===goals.length,'Each station goal needs its own identifier.');
  const managerId=raw.managerId?text(raw.managerId,'Learning reviewer',100):'';
  requireThat(!goals.length||w.members.some(m=>m.id===managerId&&canonicalJobRole(m.position)!=='Dishwasher'&&manages(m,area,'people.manage')),'Choose an authorized manager to review station goals.');
  requireThat(!goals.length||allJobMembers||!memberIds.includes(managerId),'Choose a goal reviewer who is not on this station’s employee scheduling list.');
  return {jobs,memberIds,allJobMembers,standardIds,managerId,goals};
}

// Publication proposes each station goal once per employee/template. The station
// retains receipts even after completed goals are filed out of the active set.
// This does not alter scheduling jobs, clearance, assessment or trainer status.
export function proposeStationGoals(c:CommandContext,shift:RecordOf<'shift'>) {
  if(!shift.data.published||shift.data.cancelled||Date.parse(shift.data.end)<=Date.parse(c.at))return;
  const station=stationById(c.w,shift.data.stationId),setup=station?.data.setup;
  if(!station||station.data.status!=='active'||!setup?.goals.length)return;
  const person=c.member(shift.ownerId),reviewer=c.w.members.find(m=>m.id===setup.managerId);
  requireThat(reviewer&&reviewer.id!==person.id&&manages(reviewer,station.area,'people.manage'),'The station goal reviewer is unavailable. Review the station setup before publishing.');
  const receipts=[...(station.data.issuedGoals??[])];
  for(const template of setup.goals){
    if(receipts.some(r=>r.personId===person.id&&r.templateId===template.id))continue;
    const guide=template.standardId?c.w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.locationId===c.w.location.id&&r.area===station.area&&r.id===template.standardId&&r.data.status==='approved'):undefined;
    // Draft/retired instructions must never be copied into employee learning.
    if(template.standardId&&!guide)continue;
    const goal=c.create({kind:'goal',data:{title:template.title,definition:template.definition,type:'development',managerId:reviewer.id,due:localInstant(nextDate(localDate(shift.data.start,c.w.location.timezone),template.dueDays),'23:59',c.w.location.timezone),phase:'proposed',stationLearning:{stationId:station.id,stationName:station.data.title,templateId:template.id,shiftId:shift.id},...(guide?{standardId:guide.id,standardRevision:guide.revision,standardSource:guide.data.source}:{}),history:[c.history('station-goal-proposed',`Proposed from the published ${station.data.title} shift; review with ${reviewer.name}. No training clearance granted.`)]}},person);
    receipts.push({personId:person.id,templateId:template.id,goalId:goal.id});
    c.notify([person.id,reviewer.id],'Station learning goal proposed',`${station.data.title}: ${template.title}. Open Training to review the goal.`,goal.id);
  }
  if(receipts.length!==(station.data.issuedGoals??[]).length)c.save({...station,data:{...station.data,issuedGoals:receipts}});
}
