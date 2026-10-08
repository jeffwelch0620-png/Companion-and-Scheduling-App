import {has,manages,type Member,type RecordOf,type Workspace,type History} from './types';
import type {CommandContext} from './followthrough';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

// Minimal setup facts only: no login email, credentials or employment exit reason.
export type HireCandidate={id:string;name:string;area:string;position:string;revision:number;active:boolean;scheduleOnly:boolean;hireDate:string|null;status:'onboarding'|'active'|'archived'};
export type HireFacts={title:string;employeeName:string;position:string;hireDate:string;schedulerId:string;schedulerName:string;targetDate:string;handoffNote:string};
export type HireCycle={status:'awaiting-ack'|'accepted'|'scheduled'|'cancelled';acknowledgment:{by:string;at:string;note:string}|null;confirmation:{by:string;at:string;note:string;shiftId:string;shiftRevision:number;start:string;end:string;position:string}|null};
export type HireHandoff=HireFacts&HireCycle&{history:History;versions:{at:string;by:string;reason:string;facts:HireFacts;cycle:HireCycle}[]};
const enabled=(m:Member)=>!m.scheduleOnly&&m.position!=='Dishwasher';
export function hireCoordinator(m:Member,area=m.area){return enabled(m)&&(has(m,'location.manage')||manages(m,area,'people.manage'));}
export function hireScheduler(m:Member,area=m.area){return enabled(m)&&(manages(m,area,'schedule.manage')||manages(m,area,'schedule.publish'));}
export function hireReader(r:RecordOf<'hirehandoff'>,m:Member){return r.locationId===m.locationId&&(hireCoordinator(m,r.area)||r.data.schedulerId===m.id&&hireScheduler(m,r.area));}
export function hireCandidateReader(c:HireCandidate,w:Workspace){return hireCoordinator(w.me,c.area)||w.records.some(r=>r.kind==='hirehandoff'&&r.ownerId===c.id&&hireReader(r,w.me));}
const factsOf=(d:HireFacts):HireFacts=>{const {title,employeeName,position,hireDate,schedulerId,schedulerName,targetDate,handoffNote}=d;return {title,employeeName,position,hireDate,schedulerId,schedulerName,targetDate,handoffNote};};
const cycleOf=(d:HireCycle):HireCycle=>({status:d.status,acknowledgment:d.acknowledgment,confirmation:d.confirmation});
const fresh=():HireCycle=>({status:'awaiting-ack',acknowledgment:null,confirmation:null});
export function firstShiftOptions(w:Workspace,r:RecordOf<'hirehandoff'>){return w.records.filter((s):s is RecordOf<'shift'>=>s.kind==='shift'&&s.locationId===r.locationId&&s.ownerId===r.ownerId&&s.area===r.area&&s.data.published&&!s.data.cancelled&&!s.data.releasedAt&&localDate(s.data.start,w.location.timezone)>=r.data.hireDate).sort((a,b)=>a.data.start.localeCompare(b.data.start)||a.id.localeCompare(b.id));}
export function hireEvidence(w:Workspace,r:RecordOf<'hirehandoff'>){
 const person=w.hireCandidates?.find(m=>m.id===r.ownerId),confirmation=r.data.confirmation,shift=confirmation?w.records.find(s=>s.kind==='shift'&&s.id===confirmation.shiftId):undefined;
 const setupCurrent=!!person&&person.status!=='archived'&&person.hireDate===r.data.hireDate&&person.area===r.area;
 const schedulable=setupCurrent&&(person!.active||person!.scheduleOnly);
 const current=!!(schedulable&&confirmation&&shift?.kind==='shift'&&firstShiftOptions(w,r)[0]?.id===shift.id&&shift.ownerId===r.ownerId&&shift.area===r.area&&shift.revision===confirmation.shiftRevision&&shift.data.published&&!shift.data.cancelled&&!shift.data.releasedAt&&shift.data.start===confirmation.start&&shift.data.end===confirmation.end&&shift.data.position===confirmation.position);
 return {person,setupCurrent,schedulable,current,needsReview:r.data.status==='scheduled'&&!current};
}
export function applyHireHandoff(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history,member}=c;
 requireThat(['hirehandoff.create','hirehandoff.correct','hirehandoff.accept','hirehandoff.confirm','hirehandoff.reopen','hirehandoff.cancel','hirehandoff.note'].includes(command.action),'Unknown first-shift handoff action.');
 const fields=(employee:HireCandidate):HireFacts=>{
  requireThat(hireCoordinator(me,employee.area),'Employee follow-up access is required for this department.',403);
  requireThat(employee.revision===input.employeeRevision,'Employee setup changed. Refresh and review it again.',409);
  requireThat(employee.status!=='archived'&&employee.hireDate,'Record the hire date in Employee setup before making this handoff.');
  const scheduler=member(input.schedulerId);requireThat(scheduler.id!==employee.id&&hireScheduler(scheduler,employee.area),'Choose a different current scheduler for this department.');
  const targetDate=calendarDate(input.targetDate,'Target first-shift date');requireThat(targetDate>=employee.hireDate,'The target first shift cannot precede the recorded hire date.');
  return {title:'First shift · '+employee.name,employeeName:employee.name,position:employee.position,hireDate:employee.hireDate,schedulerId:scheduler.id,schedulerName:scheduler.name,targetDate,handoffNote:text(input.handoffNote,'Handoff note',3000)};
 };
 if(command.action==='hirehandoff.create'){
  requireThat(!command.recordId,'Correct the existing handoff instead.');const employee=w.hireCandidates?.find(m=>m.id===input.employeeId);requireThat(employee,'Employee setup not found.',404);
  const f=fields(employee);requireThat(!w.records.some(r=>r.kind==='hirehandoff'&&r.ownerId===employee.id&&(r.data.hireDate===f.hireDate||!['scheduled','cancelled'].includes(r.data.status))),'This hire already has a handoff. Open it to review or correct it.',409);
  create({kind:'hirehandoff',data:{...f,...fresh(),history:[history('assigned','Scheduling responsibility offered. Employee access and schedules are unchanged.')],versions:[]}}, {id:employee.id,locationId:w.location.id,name:employee.name,area:employee.area,position:employee.position,capabilities:[],qualifications:[]});return;
 }
 const r=find('hirehandoff');requireThat(hireReader(r,me),'This handoff is restricted.',403);requireThat(r.data.history.length<200,'This handoff has reached its update limit. Preserve its history for review.');
 const note=text(input.note,'Update or reason',3000);let data:HireHandoff={...r.data,history:[...r.data.history,history(command.action.slice(12),note)]};
 const retain=()=>[...data.versions,{at,by:me.id,reason:note,facts:factsOf(r.data),cycle:cycleOf(r.data)}];
 if(command.action==='hirehandoff.correct'){
  const employee=w.hireCandidates?.find(m=>m.id===r.ownerId);requireThat(employee,'Employee setup is unavailable.',409);const f=fields(employee);
  requireThat(employee.hireDate===r.data.hireDate,'A rehire needs a separate handoff; cancel or retain this earlier hire’s history.');
  data={...data,...f,...fresh(),versions:retain()};save({...r,area:employee.area,data});return;
 }else if(command.action==='hirehandoff.accept'){
  requireThat(me.id===data.schedulerId&&hireScheduler(me,r.area),'Only the named scheduler can accept this handoff.',403);requireThat(data.status==='awaiting-ack','This handoff is not awaiting acknowledgment.');
  requireThat(hireEvidence(w,r).setupCurrent,'The employee setup changed. Have the coordinator review the handoff.',409);requireThat(input.accepted===true,'Confirm that you accept responsibility for arranging the first shift.');
  data={...data,status:'accepted',acknowledgment:{by:me.id,at,note}};
 }else if(command.action==='hirehandoff.confirm'){
  requireThat(me.id===data.schedulerId&&hireScheduler(me,r.area),'Only the named scheduler can confirm the first shift.',403);requireThat(data.status==='accepted'&&data.acknowledgment,'Accept responsibility before confirming a shift.');
  requireThat(hireEvidence(w,r).schedulable,'Employee setup must match this hire and be available to scheduling. Sign-in is enabled separately.',409);
  const shift=firstShiftOptions(w,r)[0];requireThat(shift&&shift.id===input.shiftId,'Review the earliest current published shift for this employee and hire.');requireThat(shift.revision===input.shiftRevision,'The shift changed. Refresh before confirming.',409);
  requireThat(input.checked===true,'Confirm that you checked the published shift and employee.');
  data={...data,status:'scheduled',confirmation:{by:me.id,at,note,shiftId:shift.id,shiftRevision:shift.revision,start:shift.data.start,end:shift.data.end,position:shift.data.position}};
 }else if(command.action==='hirehandoff.reopen'){
  requireThat(['scheduled','cancelled'].includes(data.status),'Only a completed or cancelled handoff needs reopening.');requireThat(hireEvidence(w,r).setupCurrent,'Review the employee’s current hire setup first.',409);
  data={...data,...fresh(),versions:retain()};
 }else if(command.action==='hirehandoff.cancel'){
  requireThat(hireCoordinator(me,r.area),'Only the employee coordinator can cancel this handoff.',403);requireThat(data.status!=='cancelled','This handoff is already cancelled.');data={...data,status:'cancelled',versions:retain()};
 }else requireThat(!['scheduled','cancelled'].includes(data.status),'Reopen this handoff before adding updates.');
 save({...r,data});
}
