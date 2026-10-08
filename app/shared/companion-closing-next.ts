import {publicWorkspace} from './domain';
import {buildShiftBrief} from './shift-brief';
import {closingStatus} from './closing-status';
import {displayTime} from './local-time';
import {closingQuestionIntent} from './workforce-context';
import {assignedStandardCurrent} from './station-knowledge';
import {correctionPerformer,eligibleCorrectionHelper} from './close-correction';
import {reportsRework,requestsCorrectionNote} from './companion-correction-note';
import {personName,type RecordOf,type Workspace} from './types';
import type {ChatSource} from './companion-chat-types';

// Ground checkout explanations in current authorized records. A generated
// sentence cannot turn reported readiness into a physical check or release.
export function companionClosingNext(input:Workspace,sources:ChatSource[],question:string,answer:string,at:string,focus?:ChatSource|null):string|undefined {
 const w=publicWorkspace(input,at),words=question.replace(/’/g,"'");
 const refs=[...sources,...(focus?[focus]:[])];
 const records=w.records.filter(r=>r.locationId===w.location.id&&refs.some(s=>s.id===r.id&&s.revision===r.revision&&s.kind===r.kind)&&(r.kind==='shift'||r.kind==='close'&&r.data.phase!=='cancelled'||r.kind==='task'&&!!r.data.shiftId));
 if(!records.length)return;
 const related=records.map(r=>({id:r.id,revision:r.revision,kind:r.kind,title:r.kind}));
 const walkthrough=/\b(?:walk\s+(?:me\s+)?through|walkthrough|step[ -]by[ -]step|steps|method|instructions)\b/i.test(words);
 const correctionNote=requestsCorrectionNote(words),reportedRework=correctionNote&&reportsRework(words);
 const requestedArtifact=correctionNote||/\b(?:help|draft|write|word|give)\b[\s\S]{0,100}\b(?:request|message|update)\b/i.test(words);
 const managerRecipient=/\b(?:tell|notify|message|contact)\s+(?:(?:the|my|our|assigned|closing)\s+)*(?:manager|supervisor|reviewer|shift lead)\b|\bsend\s+(?:a\s+)?(?:message|note|update)\s+to\s+(?:(?:the|my|our|assigned|closing)\s+)*(?:manager|supervisor|reviewer|shift lead)\b/i.test(words);
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const names=w.members.filter(m=>m.id!==w.me.id).flatMap(m=>{
  const full=m.name.replace(/\s*\([^)]*\)\s*$/,'').trim(),first=full.split(/\s+/)[0];
  return [full,...(first&&w.members.filter(member=>member.name.split(/\s+/)[0]===first).length===1?[first]:[])].filter(Boolean).map(escape);
 });
 const namedRecipient=!!names.length&&new RegExp('\\b(?:tell|notify|message|contact)\\s+(?:'+names.join('|')+')\\b|\\bsend\\s+(?:a\\s+)?(?:message|note|update)\\s+to\\s+(?:'+names.join('|')+')\\b','i').test(words);
 const notification=managerRecipient||namedRecipient;
 const release=/\b(?:checkout|check[ -]?out|check (?:me|us) out|(?:good|okay|ok) to go|(?:can|may) (?:i|we) (?:release|leave|go(?: home)?)|shift(?: time)?(?:'s | (?:is |has )?)(?:over|ended|done|finished)|before (?:i |we )?(?:leave|go))\b/i.test(words);
 const next=/\b(?:last (?:thing|step|check)|remaining|still (?:needed|required|waiting)|what(?:'s| is| happens) next|what (?:is |are )?left|who (?:checks|does|verifies))\b/i.test(words);
 const ready=/\b(?:ready|physical check|bank|tell (?:the |my )?manager)\b/i.test(words);
 // Judge the actual current question. Adding a pronoun such as "Explain it"
 // fabricates closing continuity for a new service or staffing question.
 const directClosing=closingQuestionIntent(words);
 const attachedReceipt=focus?.kind==='task'&&records.some(r=>r.id===focus.id&&r.revision===focus.revision)&&/\b(?:accept|acceptance|accepted|receipt|transfer|ownership|owns?|owner)\b/i.test(words);
 const serviceTopic=/\b(?:servers?|overload(?:ed)?|rotation|floor|tables?|seating|seat|podium|arrivals?|guests?|refills?|pre[ -]?buss?(?:ing)?|meal check|coverage|availability|time off|learning|training|coaching)\b/i.test(words);
 const clearanceAsk=/\b(?:station clearance|train|training|clear|cleared|clearance)\b/i.test(words)&&/\b(?:automatically|every station|new station|grant|give|passing|reading)\b/i.test(words);
 if(clearanceAsk||serviceTopic&&!directClosing&&!attachedReceipt)return;
 const closing=closingQuestionIntent(words,related)||walkthrough&&focus?.kind==='close'&&!serviceTopic;
 const focusedWorkflow=!!focus&&(/\b(?:accept|acceptance|accepted|receipt|transfer|unfinished|finished|remaining|ready|checks?|confirm|checkout|release)\b/i.test(words)||!serviceTopic&&(next||walkthrough||notification));
 const falseFinality=/\b(?:last thing|can leave|good to go|checkout (?:is |has been )?(?:done|finished|complete))\b/i.test(answer);
 if(!release&&!closing&&!((ready||requestedArtifact||focusedWorkflow)&&focus&&records.some(r=>r.id===focus.id&&(r.kind==='close'||r.kind==='task'))))return;
 // An incidental close citation must not override an explicit new service topic.
 if(!release&&!closing&&!requestedArtifact&&!focusedWorkflow&&!/\b(?:bank|tell (?:the |my )?manager)\b/i.test(words))return;
 const anchored=focus?records.find(r=>r.id===focus.id&&r.revision===focus.revision):undefined;
 // An explicit attachment cannot silently fall back to unrelated past citations.
 if(focus&&!anchored)return;
 const currentShiftQuestion=/\b(?:today(?:'s)?|tonight(?:'s)?|current|this)\s+(?:Host\s+)?shift\b/i.test(words)&&!/\b(?:old|prior|previous|another|different|automatically)\b/i.test(words);
 const activeShifts=currentShiftQuestion?records.filter(r=>r.kind==='shift'&&r.data.published&&!r.data.cancelled&&r.data.start<=at&&r.data.end>=at):[];
 const chosen=anchored?[anchored]:activeShifts.length===1?activeShifts:records;
 const shiftIds=new Set(chosen.flatMap(r=>r.kind==='shift'?[r.id]:r.kind==='close'?[r.data.shiftId]:r.kind==='task'&&r.data.shiftId?[r.data.shiftId]:[]));
 const shifts=w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&shiftIds.has(r.id));
 const closes=w.records.filter((r):r is RecordOf<'close'>=>r.kind==='close'&&shiftIds.has(r.data.shiftId)&&r.data.phase!=='cancelled');
 const tasks=w.records.filter((r):r is RecordOf<'task'>=>r.kind==='task'&&!!r.data.shiftId&&shiftIds.has(r.data.shiftId));
 const brief=buildShiftBrief(w,at),name=(id?:string,fallback='the assigned person')=>{const value=id===w.me.id?w.me.name:personName(w,id,fallback);return value.length<=100?value:fallback;};
 const label=(value:string,fallback:string)=>value.length<=160?value:fallback;
 const sections:string[]=[],closeSections:string[]=[],taskSections:string[]=[];
 if(release&&/\b(?:another|different|each|every)\b[\s\S]{0,60}\bshift\b|\bshift\b[\s\S]{0,70}\b(?:automatically|separate for each)\b/i.test(words))sections.push('A saved release applies only to its exact shift. Another shift requires its own manager checkout and recorded release; releasing one shift does not automatically release another.');
 closes.sort((a,b)=>Number(b.id===focus?.id)-Number(a.id===focus?.id));
 tasks.sort((a,b)=>Number(b.id===focus?.id)-Number(a.id===focus?.id));
 if(/\bbank\b/i.test(words))sections.push('These saved records do not confirm bank settlement. Ask the responsible manager to check your bank; chat cannot settle it.');
 if(managerRecipient)sections.push('Chat does not notify the manager or submit readiness. Contact the manager directly about the current pending check or separate shift release; a message does not complete that step.');
 else if(namedRecipient)sections.push('Chat does not notify that named person or submit readiness. Contact the intended recipient directly; a message does not complete work, checks or shift release.');
 for(const r of closes){
  const p=r.data,owner=name(r.ownerId),performer=name(correctionPerformer(r)),manager=name(p.managerId,'the assigned closing manager'),first=name(p.verifierId??p.managerId,'the assigned physical checker');
  const title=label(p.standard.title,'The linked closing assignment');
  const shift=shifts.find(s=>s.id===p.shiftId);
  if(p.phase!=='closed'&&!assignedStandardCurrent(w,r)){
   if(requestedArtifact)sections.push(`Factual draft you can use:\n"This closing assignment remains ${p.phase==='correction'?'in correction':'open'}. Its approved instructions are not current. Please update or replace the assignment instructions before I continue."\nThis draft does not claim work, readiness, notification or a physical check happened.`);
   closeSections.push(`${title}: Current approved instructions are unavailable. ${manager} must update or replace the assignment before its method can be followed. ${owner} remains responsible; this blocker is not permission to mark the work Ready or leave.`);
   continue;
  }
  if(shift&&(!shift.data.published||shift.data.cancelled||shift.data.releasedAt)&&p.phase!=='closed'){
   closeSections.push(`${title}: ${brief.items.find(item=>item.record.id===r.id)?.reason??'The linked shift is not active and published.'} Ask ${manager} to review the assignment before moving it forward.`);
   continue;
  }
  const standard=w.records.find(s=>s.kind==='standard'&&s.id===p.standardId&&s.revision===p.standardRevision);
  if(p.phase!=='closed'&&(standard?.kind!=='standard'||!standard.data.guide?.steps.length)){
   if(requestedArtifact)sections.push(`Factual draft you can use:\n"${title} remains ${p.phase==='correction'?'in correction':'open'}. The current guide has no detailed approved method. Please provide the approved method before I continue."\nThis draft does not claim work is complete or ready, or that a message or physical check happened.`);
   closeSections.push(`${title}: Detailed approved operating steps are missing. Ask ${manager} for the approved method before doing further work. A readiness report does not supply missing instructions. ${first} still performs the required physical check${p.verifierId?`, followed by ${manager}'s separate final physical confirmation`:''}; separate shift checkout also remains required.`);
   continue;
  }
  const helper=p.correction?w.members.find(m=>m.id===p.correction?.personId):undefined;
  if(p.phase==='correction'&&p.correction&&(!helper||!eligibleCorrectionHelper(r,helper))){
   closeSections.push(`${title}: The saved correction helper is no longer available or cleared for this work. ${manager} must review who will correct it. ${owner} remains responsible; readiness and the independent physical checks are still required.`);
   continue;
  }
  const reported=reportedRework&&correctionPerformer(r)===w.me.id&&['open','correction'].includes(p.phase);
  if(reported){
   // Retain the requested model draft only as employee-reported wording. Reject
   // unsupported all-done, inspection, notification and release claims.
   const quoted=[...answer.matchAll(/[“"]([^”"\n]{1,1500})[”"]/g)].map(match=>match[1]).find(text=>/\b(?:cleaned|wiped|removed|corrected|fixed|rework|cleaning)\b/i.test(text));
   const draft=quoted??(answer.trim().length<=600?answer.trim():undefined);
   const allConditionsReported=/\b(?:all|every)\s+(?:(?:the|my|required|closing)\s+)*(?:conditions?|requirements?)\s+(?:(?:are|is|have been)\s+)?(?:met|complete|completed|satisfied)\b/i.test(words)&&!/\b(?:unmet|unfinished|not\s+(?:met|complete|done)|haven['’]t|have not|didn['’]t|did not)\b/i.test(words);
   const unsupported=draft&&(/\b(?:all|every)\b[\s\S]{0,70}\b(?:complete|completed|done|met)\b|\b(?:manager|checker|lead)\b[\s\S]{0,40}\b(?:passed|verified|confirmed|approved)\b|\b(?:i|we|jmax)\s+(?:have\s+|already\s+)?(?:notified|messaged|released)\b|\b(?:shift|checkout|bank)\b[\s\S]{0,35}\b(?:released|settled|complete|completed)\b/i.test(draft)||!allConditionsReported&&/\b(?:ready\s+for\s+(?:(?:a|the|your|another|physical|manager['’]s?)\s+)*(?:check|inspection|confirmation)|(?:work|conditions?|closing)\s+(?:(?:is|are)\s+)?(?:ready|complete|completed|done))\b/i.test(draft));
   if(draft&&!unsupported)sections.push(`Draft based on your reported cleanup, not a verified result:\n${draft}`);
   else sections.push('Your cleanup report can be recorded factually. It does not establish that every required condition is met or that a check passed.');
  }
  if(p.phase==='closed')closeSections.push(`${title}: The saved assignment records its required closing checks complete. That is separate from the shift's manager checkout.`);
  else if(p.phase==='manager-confirmation')closeSections.push(`${title}: The performer has reported ready. ${manager} must perform the ${p.verifierId?'separate final physical confirmation':'physical check'} now. Do not ask the performer to redo completed work unless a checker records a correction. Passing this check does not itself release the shift.`);
  else if(p.phase==='verification')closeSections.push(`${title}: The performer has reported ready. ${first} performs the first physical check${p.verifierId?`, then ${manager} performs a separate final physical confirmation`:''}. Readiness is not a passed check or shift release.`);
  else {
   const work=reported?`${performer} has reported cleanup; the saved assignment still awaits a Ready submission. Confirm every required condition is actually met, then add the factual note and submit Ready in the linked assignment.`:`${performer} must ${p.phase==='correction'?'read the saved correction and finish the approved correction':'finish the assigned conditions using current approved instructions'}, then submit a factual Ready report in the linked assignment.`;
   const steps=walkthrough&&!reported&&standard?.kind==='standard'?standard.data.guide!.steps.map((step,index)=>`${index+1}. ${step}`).join('\n'):'';
   const method=steps?steps.length<=2400?`\n\nApproved steps for this assigned work:\n${steps}`:'\n\nOpen the linked approved guide for the complete operating steps; its full method is too long for this response. Do not treat this workflow summary as the operating method.':'';
   closeSections.push(`${title}: ${work} ${performer!==owner?`${owner} remains responsible for the close; ${performer} is the assigned correction helper. `:''}${first} performs the physical check${p.verifierId?`, followed by ${manager}'s separate final physical confirmation`:''}.${method}`);
  }
  if(['open','correction'].includes(p.phase)){
   const conditions=p.standard.criteria.join('\n');
   sections.push(`Do not submit Ready while any required condition remains unmet. ${conditions.length<1500?'Required conditions:\n'+conditions:'Open the linked assignment for the complete required conditions.'} Add a truthful condition note when submitting readiness; do not claim unmet work is finished.`);
  }
 }
 for(const r of tasks){
  const p=r.data,owner=name(r.ownerId),title=label(p.title,'The linked work assignment');
  // Tasks do not carry a structured checker assignment. The manager of a
  // linked close or a current leadership block does not name this task's checker.
  const checker='an authorized independent manager following this task\'s saved checking direction';
  if(p.phase==='closed')taskSections.push(`${title}: The saved linked work records its required review complete. This does not itself release the shift.`);
  else if(p.phase==='verification')taskSections.push(`${title}: ${owner} has reported the work ready. ${checker} must physically check the completed work and verify it or return a specific correction. The performer must not approve their own work. Separate manager checkout still follows.`);
  else if(p.phase==='acceptance')taskSections.push(`${title}: ${owner} remains the current owner until ${name(p.incomingId,'the incoming employee')} accepts. The incoming employee must review and accept or dispute what is being received. Acceptance records receipt, not completion. Remaining work and an independent manager's check still follow before checkout.`);
  else taskSections.push(`${title}: ${p.closingHandoff?`The incoming employee accepted responsibility; acceptance did not complete the work. `:''}${owner} must ${p.phase==='correction'?'finish the saved correction':'finish the remaining assigned work'}, then report the actual conditions Ready in the linked assignment. ${checker} must independently check the result before separate manager checkout.`);
 }
 sections.push(...(anchored?.kind==='task'?[...taskSections,...closeSections]:[...closeSections,...taskSections]));
 for(const shift of shifts){
  const status=closingStatus(w,shift,{allowProjectedReceipts:true}),owner=name(shift.ownerId,'the assigned employee');
  if(/\bscheduled\b[\s\S]{0,50}\b(?:time|hours|start|end)\b|\bpayroll\b/i.test(words))sections.push(`${owner}'s saved scheduled shift remains ${displayTime(shift.data.start,w.location.timezone)} to ${displayTime(shift.data.end,w.location.timezone)}. Operational checkout and a recorded release do not edit those scheduled hours or payroll. These records do not establish worked time or payroll settlement.`);
  if(shift.data.releasedAt)sections.push(`${owner}'s shift has a saved manager release. This record alone does not establish bank settlement.`);
  else if(!shift.data.published||shift.data.cancelled)sections.push(`${owner}'s linked shift is not active and published. Ask the manager to resolve the assignment; this does not establish checkout or permission to leave.`);
  else if(status.complete)sections.push(`${owner}'s shift has no pending linked closing checks in the authorized saved view, but manager release is not recorded. The responsible manager must perform the separate operational checkout before departure.`);
  else if(status.pendingDishHandoffIds.length)sections.push(`${owner}'s shift is not released. The named incoming Dishwasher must explicitly acknowledge the unfinished work passed forward.${status.pendingTasks.some(r=>r.ownerId===shift.ownerId&&r.data.dishCheckout?.shift==='AM')&&status.tasks.some(r=>r.ownerId===shift.ownerId&&r.data.dishCheckout?.shift==='AM'&&r.data.phase!=='closed')?' This employee’s own checkout must also finish its independent manager check.':''} Incoming acknowledgment transfers responsibility; it does not complete the PM work. After the outgoing employee’s required checkout checks and this acknowledgment, the responsible manager must perform separate operational checkout. The AM employee does not need to wait for accepted PM work to finish.`);
  else sections.push(`${owner}'s shift is not released. Its linked work and required independent checks must finish first; the responsible manager must then perform separate operational checkout. A task's physical check or a closing confirmation is not the last release step.`);
 }
 if(!shifts.length)sections.push('The linked shift release record is not available in this authorized view. Ask the responsible manager to confirm separate operational checkout; do not infer release from readiness or a task check.');
 if(!sections.length)return;
 const included:string[]=[];let length=0;
 for(const section of sections){if(length+section.length+2>5200)break;included.push(section);length+=section.length+2;}
 const omitted=included.length<sections.length?'\n\nThis is a bounded summary of selected current work, not an exhaustive list. Open the linked work to review all remaining assignments.':'';
 return included.join('\n\n')+omitted+'\n\nReadiness alone does not pass any required independent physical check, including a separate final manager confirmation when assigned. For a shift without recorded release, the responsible manager must then perform separate shift checkout. Chat does not save Ready, complete work, perform a physical check, settle a bank or release a shift.';
}
