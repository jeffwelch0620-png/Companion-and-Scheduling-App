import {publicWorkspace} from './domain';
import {assignedStandardCurrent} from './station-knowledge';
import {correctionPerformer} from './close-correction';
import {personName,type Workspace,type RecordOf} from './types';
import type {ChatSource} from './companion-chat-types';

export function requestsCorrectionNote(question:string){
 return /\b(?:help|draft|write|word|wording|say|put|give)\b[\s\S]{0,120}\bnote\b|\bnote\b[\s\S]{0,80}\b(?:write|say|use|word|draft)\b|\b(?:how|what)\s+(?:do|should|can)\s+(?:i|we)\s+(?:report|record)\b/i.test(question);
}
export function reportsRework(question:string){
 // Quoted proposed wording, hypotheticals and future/negated actions do not
 // establish that the employee performed a correction. This deliberately
 // recognizes direct reports only; it does not infer satisfactory conditions.
 const unquoted=question.replace(/["“][^"”]*["”]/g,'');
 return unquoted.split(/[.!?;\n]/).some(sentence=>{
  // A conditional sentence must stay conditional even when it contains an
  // additional clause. Positive cleanup and an explicitly unfinished step,
  // however, are separate reports: do not erase the cleanup because a later
  // clause says "but I haven't checked underneath".
  if(/^\s*(?:if|unless|when|once|before|suppose|supposing|assuming)\b/i.test(sentence))return false;
  return sentence.split(/\b(?:but|and)\s+(?=(?:(?:i|we)\s+)?(?:(?:still|yet|already)\s+)?(?:haven['’]t|have not|didn['’]t|did not|hadn['’]t|had not|not|never)\b)/i).some(clause=>{
  if(/\b(?:if|unless|when|once|before|suppose|supposing|assuming|would|could|should|will|going to)\b|\bcan\s+i\s+(?:say|write|claim|note)\b/i.test(clause))return false;
  if(/\b(?:not|never|didn['’]t|haven['’]t|hadn['’]t|did not|have not|had not)\b/i.test(clause))return false;
  if(/\b(?:say|write|draft|word|claim|put)\b[\s\S]{0,80}\b(?:that|saying)\b[\s\S]{0,80}\b(?:i|we)\b/i.test(clause))return false;
  const subject="\\b(?:i(?:['’]ve|\\s+have|\\s+had)?|we(?:['’]ve|\\s+have|\\s+had)?)\\s+(?:(?:already|just|now|finally)\\s+)?";
  const cleaned='(?:wiped|cleaned|corrected|fixed|redid|rewiped|recleaned|scrubbed|washed|sanitized|remade|replaced)\\b';
  // Removing debris is a reported correction too. A shared first-person
  // subject can govern the later cleaning verb: "I moved it and cleaned it".
  // Neither report establishes satisfactory conditions or a passed check.
  const removed='(?:removed|cleared)\\s+(?:(?:the|some|all|those|these|remaining)\\s+){0,2}(?:crumbs|debris|dirt|grease|residue|trash|spill|spills|stickiness)\\b';
  const coordinated='(?:removed|cleared|moved|picked up|swept)\\b[^.!?;\\n]{0,100}?\\band\\s+(?:(?:then|already|just|now)\\s+)?'+cleaned;
  const completed='(?:finished|completed)\\s+(?:(?:the|my|this)\\s+)?(?:correction|rework|cleaning|fix|wiping)\\b';
  return new RegExp(subject+'(?:'+cleaned+'|'+removed+'|'+coordinated+'|'+completed+')','i').test(clause);
  });
 });
}

/** Replace only a requested pre-rework correction note with current saved facts.
 * No model call, work mutation, inferred cleaning method or physical inspection.
 * The caller must render the current selected/cited close among its sources. */
export function companionCorrectionNote(raw:Workspace,sources:ChatSource[],question:string,answer:string,at:string,focus?:ChatSource|null):string{
 if(!requestsCorrectionNote(question)||reportsRework(question))return answer;
 const w=publicWorkspace(raw,at);
 if(focus&&!['close','shift'].includes(focus.kind))return answer;
 const cited=sources.filter(s=>s.kind==='close');
 const candidates=w.records.filter((r):r is RecordOf<'close'>=>r.kind==='close'&&r.locationId===w.location.id&&r.data.phase==='correction'&&(focus?.kind==='close'?r.id===focus.id&&r.revision===focus.revision:cited.some(s=>s.id===r.id&&s.revision===r.revision))&&(!focus||focus.kind!=='shift'||r.data.shiftId===focus.id&&w.records.some(s=>s.kind==='shift'&&s.id===focus.id&&s.revision===focus.revision)));
 if(candidates.length!==1)return answer;
 const close=candidates[0],latest=[...close.data.history].reverse().find(h=>h.action==='fix'&&[close.data.managerId,close.data.verifierId].includes(h.actorId)&&Date.parse(h.at)<=Date.parse(at));
 if(!latest)return answer;
 const manager=personName(w,close.data.managerId,'the assigned manager'),performer=personName(w,correctionPerformer(close),'the assigned correction performer');
 const current=assignedStandardCurrent(w,close),method=current&&!!close.data.standard.guide?.steps.length;
 const instructions=!current?`These assignment instructions are no longer current. Ask ${manager} to update them to the current approved version before following a method.`:!method?`The approved guide has no detailed method. Ask ${manager} for the approved correction method before doing the work.`:`Use the linked current approved guide for the correction. If it does not explain this correction, ask ${manager} for the approved method; do not invent cleaning details.`;
 const checks=close.data.verifierId?`${personName(w,close.data.verifierId,'the assigned first checker')} performs the first independent physical check. ${manager} then performs a separate final physical confirmation, even if the first check passes.`:`${manager} performs the independent physical check.`;
 const shift=w.records.find(r=>r.kind==='shift'&&r.id===close.data.shiftId);
 const release=shift?.kind==='shift'&&shift.data.releasedAt?'The shift has a separately recorded manager release; that does not establish that this correction was performed.':'A separate manager release of the shift is still needed after its required closing work and checks are complete. Scheduled end time does not record that release.';
 return `${close.data.standard.title} is still in correction. Latest saved checker instruction: "${latest.note}"\n\nA factual note you can use now:\n"Saved correction remains open; correction and another physical check are still needed."\n\nThis draft describes the pending saved correction; it does not claim cleaning, notification or a new check happened.\n\nNext steps:\n1. ${performer} follows the saved correction instruction. ${instructions}\n2. Once every required condition is actually met, the assigned performer adds a factual condition note and chooses Ready for physical check in the linked closing assignment. Ready is a request, not completion.\n3. ${checks}\n4. ${release}\n\nChat does not save the note, submit Ready, notify anyone, perform a physical check or release a shift.`;
}
