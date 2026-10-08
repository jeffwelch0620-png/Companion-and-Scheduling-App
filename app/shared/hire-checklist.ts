import type {Member,RecordOf,Workspace,History} from './types';
import type {CommandContext} from './followthrough';
import {hireCoordinator,type HireCandidate} from './hire-handoff';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {object,requireThat,text} from './validation';

export type HireCheck={completedDate:string;evidence:string;at:string;by:string};
export type HireChecklistItem={id:string;label:string;dueDate:string;check:HireCheck|null};
export type HireChecklistFacts={title:string;employeeName:string;position:string;hireDate:string;sourceReference:string;items:HireChecklistItem[]};
export type HireChecklistState=HireChecklistFacts&{status:'open'|'reviewed'|'cancelled';review:{at:string;by:string;note:string}|null};
export type HireChecklist=HireChecklistState&{history:History;versions:{at:string;by:string;reason:string;state:HireChecklistState}[]};
export function hireChecklistReader(r:RecordOf<'hirechecklist'>,me:Member){return r.locationId===me.locationId&&hireCoordinator(me,r.area);}
export function hireChecklistCurrent(w:Workspace,r:RecordOf<'hirechecklist'>){const c=w.hireCandidates?.find(c=>c.id===r.ownerId);return !!c&&c.status!=='archived'&&c.hireDate===r.data.hireDate&&c.area===r.area&&c.position===r.data.position;}
export function hireChecklistProgress(r:RecordOf<'hirechecklist'>,today:string){const checked=r.data.items.filter(i=>i.check).length;return {checked,total:r.data.items.length,overdue:r.data.status==='open'?r.data.items.filter(i=>!i.check&&i.dueDate&&i.dueDate<today).length:0};}
const stateOf=(d:HireChecklist):HireChecklistState=>{const {title,employeeName,position,hireDate,sourceReference,items,status,review}=d;return structuredClone({title,employeeName,position,hireDate,sourceReference,items,status,review});};
export function parseHireChecklistItems(value:unknown):HireChecklistItem[]{
 requireThat(Array.isArray(value)&&value.length>0&&value.length<=30,'Enter between 1 and 30 checklist requirements.');
 const items=value.map(v=>{const i=object(v);return {id:crypto.randomUUID(),label:text(i.label,'Requirement',160),dueDate:i.dueDate?calendarDate(i.dueDate,'Entered due date'):'',check:null};});
 requireThat(new Set(items.map(i=>i.label.toLowerCase().replace(/\s+/g,' '))).size===items.length,'List each requirement only once.');return items;
}
export function applyHireChecklist(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history}=c;
 requireThat(['hirechecklist.create','hirechecklist.revise','hirechecklist.check','hirechecklist.uncheck','hirechecklist.review','hirechecklist.reopen','hirechecklist.cancel'].includes(command.action),'Unknown onboarding checklist action.');
 const fields=(employee:HireCandidate):HireChecklistFacts=>{
  requireThat(hireCoordinator(me,employee.area),'Employee follow-up access is required for this department.',403);
  requireThat(employee.revision===input.employeeRevision,'Employee setup changed. Refresh and review it again.',409);
  requireThat(employee.status!=='archived'&&employee.hireDate,'Record the hire date in Employee setup before making a checklist.');
  requireThat(input.confirmed===true,'Confirm that these requirements were checked against the restaurant’s source.');
  return {title:'Onboarding · '+employee.name,employeeName:employee.name,position:employee.position,hireDate:employee.hireDate,sourceReference:text(input.sourceReference,'Requirements source reference',1000),items:parseHireChecklistItems(input.items)};
 };
 if(command.action==='hirechecklist.create'){
  requireThat(!command.recordId,'Open the existing checklist instead.');const employee=w.hireCandidates?.find(e=>e.id===input.employeeId);requireThat(employee,'Employee setup not found.',404);
  const f=fields(employee);requireThat(!w.records.some(r=>r.kind==='hirechecklist'&&r.ownerId===employee.id&&r.data.hireDate===f.hireDate),'This hire already has a checklist. Open it to review or correct it.',409);
  create({kind:'hirechecklist',data:{...f,status:'open',review:null,history:[history('created','Entered requirements from: '+f.sourceReference)],versions:[]}}, {id:employee.id,locationId:w.location.id,name:employee.name,area:employee.area,position:employee.position,capabilities:[],qualifications:[]});return;
 }
 const r=find('hirechecklist');requireThat(hireChecklistReader(r,me),'This onboarding checklist is restricted.',403);
 requireThat(r.data.history.length<100,'This checklist has reached its update limit. Preserve its history for review.');
 const note=text(input.note,'Evidence or reason',1000),action=command.action.slice(14);
 let d:HireChecklist={...r.data,items:r.data.items.map(i=>({...i})),history:[...r.data.history,history(action,note)]};
 const retain=()=>[...d.versions,{at,by:me.id,reason:note,state:stateOf(r.data)}];
 if(command.action==='hirechecklist.cancel'){
  requireThat(d.status!=='cancelled','This checklist is already cancelled.');d={...d,status:'cancelled',versions:retain()};
 }else if(command.action==='hirechecklist.revise'){
  const employee=w.hireCandidates?.find(e=>e.id===r.ownerId);requireThat(employee,'Employee setup is unavailable.',409);requireThat(employee.hireDate===d.hireDate,'A rehire needs a separate checklist. Retain or cancel this earlier hire’s history.');
  const f=fields(employee);d={...d,...f,status:'open',review:null,versions:retain()};save({...r,area:employee.area,data:d});return;
 }else{
  requireThat(hireChecklistCurrent(w,r),'The current hire, department or position changed. Review the requirements first.',409);
  if(command.action==='hirechecklist.reopen'){
   requireThat(d.status==='reviewed'||d.status==='cancelled','Only reviewed or cancelled checklists need reopening.');d={...d,status:'open',review:null,versions:retain()};
  }else{
   requireThat(d.status==='open','Reopen this checklist before changing its checks.');
   if(command.action==='hirechecklist.review'){
    requireThat(d.items.length>0&&d.items.every(i=>i.check),'Check every entered requirement before reviewing this checklist.');requireThat(input.confirmed===true,'Confirm that you reviewed the recorded checks and their evidence.');
    d={...d,status:'reviewed',review:{at,by:me.id,note}};
   }else{
    const item=d.items.find(i=>i.id===input.itemId);requireThat(item,'Choose a requirement from this checklist.');
    if(command.action==='hirechecklist.check'){
     requireThat(!item.check,'This requirement is already checked. Reopen its check to correct it.');requireThat(input.confirmed===true,'Confirm that you personally checked this requirement.');
     const completedDate=calendarDate(input.completedDate,'Actual completion date');requireThat(completedDate<=localDate(at,w.location.timezone),'An actual completion cannot be dated in the future.');
     item.check={completedDate,evidence:note,at,by:me.id};
    }else{requireThat(item.check,'This requirement is already pending.');d.versions=retain();item.check=null;}
    d.history[d.history.length-1]={...d.history[d.history.length-1],note:item.label+': '+note};
   }
  }
 }
 save({...r,data:d});
}
