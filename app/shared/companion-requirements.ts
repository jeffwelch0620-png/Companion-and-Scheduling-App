import {scheduleChangeContext} from './schedule-change-context';
import {displayTime} from './local-time';
import type { ChatSource } from './companion-chat-types';
import { assignedStandardCurrent } from './station-knowledge';
import { personName, type Workspace } from './types';
import { closingRole } from './companion-close-role';
import { buildShiftBrief } from './shift-brief';
import { closingStatus } from './closing-status';

export type InstructionRequirement={id:string;title:string;checks:string[];notice:string;yourRole?:string;currentMethodUnavailable?:boolean};
function makesFinalCheckOptional(answer:string){
 return answer.split(/(?:[.!?](?:\s|$)|\n|[;,]|\bso\b)/i).some(clause=>{
   if(!/\bfinal\b/i.test(clause)||! /\b(check|checks|confirmation|confirm|confirms)\b/i.test(clause))return false;
   if(/\b(still required|always required|required even|regardless)\b/i.test(clause))return false;
   if(/\boptional\b/i.test(clause)&&!/\b(?:not|never)\s+optional\b/i.test(clause))return true;
   if(/\bunnecessary\b|as needed|when needed|\b(?:not required|not needed|no need)\b/i.test(clause))return true;
   if(/\b(?:needed|required|necessary)\s+(?:if|when|unless)\b/i.test(clause))return true;
   if(/\b(skip|omit)\b/i.test(clause)&&!/\b(cannot|can't|must not|do not|don't|never)\b/i.test(clause))return true;
   // Match a condition attached to the check, not to leaving after it or to
   // asking an available manager. "Still required ... do not leave unless"
   // is an unconditional check followed by a legitimate checkout boundary.
   // "When assigned" scopes the requirement to an actual assignment; it
   // does not make an assigned check depend on a problem or failed first check.
   const actionClause=clause.replace(/\bwhen assigned\s*$/i,'');
   if(/\b(check|checks|confirmation|confirm|confirms)\s+(?:(?:is|are|will be|would be|happens|applies|needed|required|necessary|performed|done)\s+)*(?:only\s+)?(?:if|unless|when)\b/i.test(actionClause))return true;
   // A condition acknowledging a completed check does not make performing
   // that check optional. Keep it distinct from a condition on the action.
   const completedCheck=/^\s*(?:if|when)\b.*\b(?:have|has|had)\s+(?:already\s+)?(?:completed|performed|finished|done)\b.*\bfinal\b.*\b(?:check|confirmation)\b/i.test(clause)
     ||/^\s*(?:if|when)\b.*\bfinal\b.*\b(?:check|confirmation)\s+(?:has|had)\s+(?:already\s+)?been\s+(?:completed|performed|finished|done)\b/i.test(clause);
   return /^\s*(?:if|unless|when)\b/i.test(clause)&&!completedCheck&&!/\b(available|availability|still required|always|regardless|even if|even when)\b/i.test(clause);
 });
}
// These labels come from current saved records, never from model text. They
// remain visible when a conversational explanation abbreviates the method.
export function companionRequirements(w:Workspace,sources:ChatSource[]):InstructionRequirement[]{
 const found=new Map<string,InstructionRequirement>();
 const records=sources.flatMap(s=>w.records.filter(r=>r.id===s.id&&r.revision===s.revision));
 for(const r of records.sort((a,b)=>Number(a.kind==='close')-Number(b.kind==='close'))){
   let standard,key=r.id,manager='the responsible manager',checks:string[]|undefined,yourRole:string|undefined;
   if(r.kind==='standard'&&r.data.status==='approved')standard=r.data;
   else if(r.kind==='close'){
     yourRole=closingRole(w,r);
     manager=personName(w,r.data.managerId,'the assigned manager');key=r.data.standardId;
     if(!assignedStandardCurrent(w,r)){found.set('assignment:'+r.id,{id:r.id,title:r.data.standard.title,checks:[],currentMethodUnavailable:true,notice:`This assignment needs current approved instructions. Ask ${manager} to update the assignment before following its method.`});continue;}
     standard=r.data.standard;
     checks=[...(r.data.verifierId?[`${personName(w,r.data.verifierId,'Assigned senior or lead')}: first physical check`]:[]),`${manager}: ${r.data.verifierId?'separate final physical confirmation':'physical check'}`];
   }else if(r.kind==='goal'){
     manager=personName(w,r.data.managerId,'the responsible manager');
     const current=w.records.find(s=>s.kind==='standard'&&s.id===r.data.standardId&&s.revision===r.data.standardRevision&&s.data.status==='approved');
     if(r.data.standardId&&current?.kind!=='standard'){found.set('goal:'+r.id,{id:r.id,title:r.data.title,checks:[],currentMethodUnavailable:true,notice:`This goal does not have current approved instructions. Ask ${manager} for the current version before following a method.`});continue;}
     found.set('goal:'+r.id,{id:r.id,title:r.data.title,checks:[`${manager}: review and confirm the agreed goal outcome`],notice:`The employee reports readiness for this review. Goal completion does not grant station clearance or complete a separate operating check.${current?.kind==='standard'&&!current.data.guide?.steps.length?` Detailed operating steps are missing. Ask ${manager} for the approved method.`:''}`});continue;
   }
   if(!standard)continue;
   checks??=standard.verification==='senior-then-manager'?['Designated capable senior or lead: first physical check','Closing manager: separate final physical confirmation']:['Closing manager: physical check'];
    const useNotice=r.kind==='standard'?'These physical checks apply when this guide is assigned as closing work. A learning goal has its own outcome reviewer.':'';
    found.set(key,{id:key,title:standard.title,checks,yourRole,notice:[useNotice,standard.guide?.steps.length?'':`Detailed operating steps are missing. Ask ${manager} for the approved method.`].filter(Boolean).join(' ')});
 }
 return [...found.values()];
}

export function checkedCompanionAnswer(w:Workspace,sources:ChatSource[],question:string,answer:string,at=new Date().toISOString(),focus?:ChatSource|null):string{
 const personalChange=/\bmy\s+(?:next\s+)?shift\b/i.test(question)&&/\b(chang(?:e|ed)|same|different)\b/i.test(question);
 const nextShift=w.records.filter((r):r is import('./types').RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===w.location.id&&r.ownerId===w.me.id&&r.data.published&&!r.data.cancelled&&!r.data.releasedAt&&r.data.end>at).sort((a,b)=>a.data.start.localeCompare(b.data.start))[0];
 const personalSchedule=personalChange||/\bwhen\s+(?:do|am)\s+i\s+(?:work|working)(?:\s+next)?\b/i.test(question);
 if(personalSchedule&&!nextShift)return 'I do not see an upcoming published shift assigned to your own name in the saved schedule. Ask the schedule manager to confirm your assignment.';
 if(personalChange&&nextShift&&sources.some(s=>s.kind==='shift'&&s.id===nextShift.id&&s.revision===nextShift.revision)){
   const change=scheduleChangeContext(nextShift,w.location.timezone);
   return (change.recordedEdit?'The saved record shows this shift was edited on '+change.lastEditLocal+'.':'I can confirm the current shift, but the saved record does not establish whether its hours changed.')+'\n\nYour current published shift is '+displayTime(nextShift.data.start,w.location.timezone)+' to '+displayTime(nextShift.data.end,w.location.timezone)+', '+nextShift.data.position+'.'+(change.recordedEdit?' The earlier hours are not stored in this schedule snapshot, so I cannot verify a before-and-after comparison.':'');
 }
 const roleQuestion=/\bmy\s+(role|responsibilit(?:y|ies)|part)\b|\bwho\s+(?:am|are)\s+i\b/i.test(question);
 const shiftFocus=focus?.kind==='shift'&&sources.some(s=>s.kind==='shift'&&s.id===focus.id&&s.revision===focus.revision)?w.records.find(r=>r.kind==='shift'&&r.locationId===w.location.id&&r.id===focus.id&&r.revision===focus.revision):undefined;
 if(shiftFocus?.kind==='shift'&&!shiftFocus.data.cancelled&&!shiftFocus.data.releasedAt){
   const status=closingStatus(w,shiftFocus,{allowProjectedReceipts:true});
   const readyClaim=answer.split(/(?:[.!?](?:\s|$)|\n)/).some(sentence=>{
     if(/\b(not|cannot|can't|don't|do not|until|after|once)\b/i.test(sentence))return false;
     const ready=/\b(?:is|are|you're|you are)\s+(?:now\s+)?ready\s+for\s+(?:(?:your|the|manager|operational)\s+)*checkout\b/i.test(sentence);
     const release=/\b(?:can|may)\s+(?:now\s+)?(?:release|check out)\b/i.test(sentence)&&!/\bif\b/i.test(sentence);
     return ready||release;
   });
   if(!status.complete&&readyClaim){
     const brief=buildShiftBrief(w,at);
     const pending=[...status.pendingCloses,...status.pendingTasks].map(r=>{
       const item=brief.items.find(item=>item.record.id===r.id);
       return `${r.kind==='close'?r.data.standard.title:r.data.title}: ${item?item.next+'. '+item.reason:'The linked work and its required independent checks are not complete.'}`;
     });
     return `${personName(w,shiftFocus.ownerId,'The assigned employee')} is not ready for operational checkout in the saved record.\n\nStill required on this exact shift:\n${pending.map((item,i)=>`${i+1}. ${item}`).join('\n')}\n\nComplete the linked work and its required independent checks, then have the responsible manager perform the separate checkout. Chat does not complete work, perform a physical check, settle a bank or release the shift.`;
   }
 }
 const closeSources=sources.filter(s=>s.kind==='close'),selected=focus?.kind==='close'?focus:!focus&&closeSources.length===1?closeSources[0]:undefined;
 const close=selected?w.records.find(r=>r.kind==='close'&&r.id===selected.id&&r.revision===selected.revision):undefined;
 if(roleQuestion&&close?.kind==='close'){
   const next=buildShiftBrief(w,at).items.find(item=>item.record.id===close.id),name=(id?:string)=>personName(w,id,'the assigned person');
   const performer=close.data.correction?.personId??close.ownerId;
   const responsibilities=[`${name(close.ownerId)} remains responsible for the close.`,...(performer!==close.ownerId?[`${name(performer)} is assigned to help with the correction.`]:[]),...(close.data.verifierId?[`${name(close.data.verifierId)} performs the first physical check.`]:[]),`${name(close.data.managerId)} performs ${close.data.verifierId?'a separate final physical confirmation, even when the first check passes':'the physical check'}.`];
   const requirement=companionRequirements(w,[selected!])[0];
   return `${close.data.standard.title}: ${closingRole(w,close)}\n\n${next?next.next+'. '+next.reason:'The saved assignment is '+close.data.phase+'. Open it to review the recorded status.'}\n\n${responsibilities.join('\n')}\n\n${requirement?.notice?requirement.notice+'\n\n':''}A question in JMAX does not record readiness or complete a physical check.`;
 }
 const methodQuestion=/\b(method|instructions?|steps?|procedure|walkthrough)\b|\bwalk\s+(?:me\s+)?through\b/i.test(question);
 const goalSource=focus?.kind==='goal'?focus:!focus&&sources.filter(s=>s.kind==='goal').length===1?sources.find(s=>s.kind==='goal'):undefined;
 const goal=goalSource&&sources.some(s=>s.kind==='goal'&&s.id===goalSource.id&&s.revision===goalSource.revision)?w.records.find(r=>r.kind==='goal'&&r.id===goalSource.id&&r.revision===goalSource.revision&&r.locationId===w.location.id):undefined;
 if(goal?.kind==='goal'&&['active','verification'].includes(goal.data.phase)&&/\balready (?:confirms?|confirmed|verified|completed)\b|\bhas (?:confirmed|verified|completed)\b|\bgoal (?:is|has been) (?:complete|completed|verified)\b/i.test(answer)){
   const manager=personName(w,goal.data.managerId,'the assigned reviewing manager');
   return `${goal.data.title} is ${goal.data.phase==='verification'?'awaiting the reviewing manager’s decision':'still in progress'}. The saved record does not show a completed outcome review. ${manager} must review the agreed outcome and either confirm it or return it for more practice. The employee’s readiness report does not complete the goal. Goal completion does not grant station clearance or complete an operating check.`;
 }
 if(methodQuestion&&goal?.kind==='goal'&&['active','verification'].includes(goal.data.phase)){
   const guide=w.records.find(r=>r.kind==='standard'&&r.id===goal.data.standardId&&r.revision===goal.data.standardRevision&&r.locationId===goal.locationId&&r.area===goal.area&&r.data.status==='approved');
   if(guide?.kind==='standard'&&!guide.data.guide?.steps.length){
     const manager=personName(w,goal.data.managerId,'the assigned reviewing manager');
     const criteria=guide.data.criteria.map((item,i)=>`${i+1}. ${item}`).join('\n');
     const feedback=[...goal.data.history].reverse().find(h=>h.actorId===goal.data.managerId&&['coach','fix'].includes(h.action));
     return `${goal.data.title}\n\nThe linked approved guide contains these completion criteria:\n${criteria.length<=2000?criteria:'Read the linked guide for the complete criteria.'}\n\nDetailed step-by-step instructions have not been approved in this guide. Ask ${manager} for the approved method before doing the work. Opening the same guide or asking again will not supply missing steps.`+(feedback?`\n\nLatest saved manager guidance: ${feedback.note}`:'')+`\n\n${goal.data.phase==='verification'?`Your goal is awaiting ${manager}'s outcome review.`:`Record your practice and any questions on this goal. When ready, submit it for ${manager} to review.`} ${manager} confirms the learning outcome. That does not grant station clearance or complete a separate operating check.`;
   }
 }
 const requirements=companionRequirements(w,sources),unavailable=requirements.filter(r=>r.currentMethodUnavailable);
 const conditionalFinal=makesFinalCheckOptional(answer);
 if(!unavailable.length&&requirements.some(r=>r.checks.length>1)&&conditionalFinal){
   // A model must not turn a required final check into an exception-only step.
   // Replace this identified contradiction with current approved source text.
   const sections=requirements.map(r=>{
     const record=w.records.find(s=>s.id===r.id&&(s.kind==='goal'||s.kind==='standard'&&s.data.status==='approved'));
     const standard=record?.kind==='standard'?record.data:undefined,guide=standard?.guide;
     const checks=(record?.kind==='goal'?'Goal outcome review:\n':'Required physical checks, including when the first check passes:\n')+r.checks.map((check,i)=>`${i+1}. ${check}`).join('\n');
     const method=guide?['Before starting: '+guide.preparation.join(' '),'Approved steps for the assigned performer:\n'+guide.steps.map((step,i)=>`${i+1}. ${step}`).join('\n'),'Required result: '+standard!.criteria.join('; '),guide.troubleshooting.length?'If something goes wrong: '+guide.troubleshooting.join(' '):'',guide.escalation?'Get help: '+guide.escalation:''].filter(Boolean).join('\n\n'):r.notice;
     return `${r.title}\n\n${method.length<3200?method:'Open the linked approved guide for the complete preparation, steps and required result.'}\n\n${checks}`;
   });
   const detail=sections.join('\n\n');
   return 'The final manager check is required even when the first check passes.\n\n'+(detail.length<=5200?detail:'Open the linked approved instructions for the full methods and required results. Every saved physical-check requirement shown below still applies.')+'\n\nThese instructions do not record readiness or complete a physical check.';
 }
 if(!methodQuestion||!unavailable.length)return answer;
 // A fluent model answer cannot make an unavailable source actionable. Keep
 // method requests on the exact saved authority boundary; other questions,
 // such as the goal's due date, can still receive ordinary contextual help.
 return 'I cannot give a current method from these saved instructions.\n\n'+unavailable.map(r=>`${r.title}: ${r.notice}`).join('\n\n')+'\n\nYou can open the linked assignment or goal to review its status. This does not complete or cancel the work.';
}
