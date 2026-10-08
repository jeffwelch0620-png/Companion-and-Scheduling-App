import { manages, personName, type RecordOf, type Workspace } from './types';
import { localDate } from './local-time';
export type LearningRecord=RecordOf<'goal'>|RecordOf<'development'>;
export function learningNextStep(w:Workspace,r:LearningRecord,at:string){
 const phase=r.data.phase;
 let actorId='',label='',action='Open review';
 const ended=r.kind==='goal'?['closed','declined','cancelled'].includes(phase):['approved','cancelled'].includes(phase);
 const due=r.kind==='goal'?r.data.due:r.data.originalDueDate;
 const overdue=!ended&&(r.kind==='goal'?Date.parse(due)<Date.parse(at):due<localDate(at,w.location.timezone));
 let guide:RecordOf<'standard'>|undefined,stale=false;
 if(r.kind==='goal'){
   guide=w.records.find((s):s is RecordOf<'standard'>=>s.kind==='standard'&&s.id===r.data.standardId&&s.revision===r.data.standardRevision&&s.data.status==='approved'&&s.area===r.area);
   stale=!!r.data.standardId&&!guide&&!ended;
   if(stale){actorId=r.data.managerId;label='Linked guide needs review';action='Review goal';}
   else if(phase==='proposed'){actorId=r.ownerId;label='Awaiting employee choice';action='Choose this goal';}
   else if(phase==='active'){actorId=r.ownerId;label=r.data.history?.at(-1)?.action==='fix'?'More practice requested':'Practice in progress';action='Continue goal';}
   else if(phase==='verification'){actorId=r.data.managerId;label=r.ownerId===w.me.id?'Waiting for '+personName(w,r.data.managerId,'your manager'):'Ready for outcome review';action='Review outcome';}
   else {label=phase==='closed'?'Outcome confirmed':phase==='declined'?'Declined':'Ended';action='View history';}
 }else{
   if(phase==='self-assessment'){actorId=r.ownerId;label='Employee self-assessment';}
   else if(phase==='manager-assessment'){actorId=r.data.managerId;label='Manager assessment';}
   else if(phase==='discussion'){actorId=!r.data.managerDiscussion?r.data.managerId:!r.data.employeeDiscussion?r.ownerId:r.data.managerId;label=!r.data.managerDiscussion?'Record the conversation':!r.data.employeeDiscussion?'Employee response':'Send for final approval';}
   else if(phase==='gm-review'){actorId=r.data.approverId;label='Final approval';}
   else {label=phase==='approved'?'Review completed':'Review ended';action='View history';}
 }
 const actor=w.members.find(m=>m.id===actorId&&!m.scheduleOnly);
 const permission=actor&&(actorId===r.ownerId||manages(actor,r.area,r.kind==='goal'?(r.data.type==='development'?'people.manage':'tasks.manage'):r.data.phase==='gm-review'?'people.approve':'people.manage'));
 return {actorId,label,action,due,overdue,ended,stale,guide,needsMe:!!permission&&actorId===w.me.id,unavailable:!ended&&!permission,canAsk:r.kind==='goal'&&!stale&&['active','verification'].includes(r.data.phase)&&w.me.position!=='Dishwasher'};
}
