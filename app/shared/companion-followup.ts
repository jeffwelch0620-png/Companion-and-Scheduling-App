import {publicWorkspace} from './domain';
import {canAskAbout} from './companion-focus';
import type {Workspace} from './types';
import type {ChatSource} from './companion-chat-types';

// Re-read the current authorized item for a workflow follow-up. Old answer text
// remains stale; resolving a changed reference never restores revoked access.
export function operationalFollowup(question:string){
 if(/\b(?:another restaurant|different (?:topic|shift|assignment)|instead|switch topic|time off|availability|weekly sales|labor percentage)\b/i.test(question))return false;
 // An explicit topic/day change wins over incidental words such as who, now
 // or next. Those words alone must not attach yesterday's checkout to opening,
 // staffing, training or a new week's plan.
 if(/\b(?:new|different)\s+(?:(?:service|weekly|labor|training|coaching|opening|staffing|planning|prep|inventory|station|method)\s+){0,3}(?:topic|scenario|question|plan)\b|\b(?:planning|opening|training|coaching|staffing|service)\s+is\s+(?:a\s+)?new\s+topic\b|\bnew day\b|\bnext week(?:['’]s)? planning\b/i.test(question))return false;
 if(/\b(?:covering|running|handling)\s+(?:the\s+)?opening\b|\b(?:today|this morning)\b[^.!?]*\b(?:opening|arrival checks)\b|\bhow (?:do|should) (?:i|we) (?:make|cook|prepare)\b/i.test(question))return false;
 if(/\b(?:prep|portions?|ingredients?|released work)\b/i.test(question)&&!/\b(?:closing|close|checkout|physical check|shift release)\b/i.test(question))return false;
 return /\b(?:this|that|it|they|them|those|now|next|still|last|waiting|ready|who|tomorrow(?:['’]s)? list)\b/i.test(question);
}
export function currentFollowupFocus(w:Workspace,question:string,at:string,previous:{focus:ChatSource|null;sources:ChatSource[]}|undefined){
 if(!previous||!operationalFollowup(question))return undefined;
 const refs=previous.focus&&['shift','close','task','goal'].includes(previous.focus.kind)?[previous.focus]:previous.sources.filter(s=>['close','task'].includes(s.kind));
 if(refs.length!==1)return undefined;
 const readable=publicWorkspace(w,at).records;
 const r=readable.find(r=>r.id===refs[0].id);
 if(r&&canAskAbout(r))return {id:r.id,revision:r.revision};
 // A completed close can still have linked work and separate checkout pending.
 // Continue on its freshly authorized parent shift, never another open close.
 if(r?.kind==='close'&&r.data.phase==='closed'){
  const parent=readable.find(p=>p.kind==='shift'&&p.id===r.data.shiftId&&p.locationId===r.locationId&&p.area===r.area&&p.data.published&&canAskAbout(p));
  if(parent)return {id:parent.id,revision:parent.revision};
 }
 return undefined;
}
