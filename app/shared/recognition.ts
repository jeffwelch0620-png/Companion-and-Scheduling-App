import {has,type Member,type RecordOf,type History} from './types';
import type {CommandContext} from './followthrough';
import {requireThat,text} from './validation';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';

export type RecognitionFacts={title:string;message:string;recipientId:string;recipientName:string;occurredOn:string};
export type Recognition=RecognitionFacts&{authorName:string;submittedAt:string;status:'submitted'|'returned'|'published'|'withdrawn';publication:{by:string;at:string}|null;internal?:{history:History;versions:{by:string;at:string;reason:string;facts:RecognitionFacts}[]}};
export function recognitionParticipant(m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher';}
export function recognitionOwner(m:Member){return recognitionParticipant(m)&&has(m,'location.manage');}
export function recognitionEditor(r:RecordOf<'recognition'>,m:Member){return r.locationId===m.locationId&&recognitionParticipant(m)&&(r.ownerId===m.id||recognitionOwner(m));}
export function recognitionReviewer(r:RecordOf<'recognition'>,m:Member){return recognitionEditor(r,m)&&recognitionOwner(m)&&r.ownerId!==m.id&&r.data.recipientId!==m.id;}
export function recognitionReader(r:RecordOf<'recognition'>,m:Member){return recognitionEditor(r,m)||r.locationId===m.locationId&&recognitionParticipant(m)&&r.data.status==='published'&&!!r.data.publication;}
export function recognitionView(r:RecordOf<'recognition'>,m:Member):RecordOf<'recognition'>{if(recognitionEditor(r,m))return r;const {internal,...data}=r.data;return {...r,data};}
const factsOf=({title,message,recipientId,recipientName,occurredOn}:RecognitionFacts):RecognitionFacts=>({title,message,recipientId,recipientName,occurredOn});
export function applyRecognition(c:CommandContext){
 const {w,me,input,command,at,member,find,create,save,history}=c;
 requireThat(recognitionParticipant(me),'Recognition is not available for this account.',403);
 requireThat(['recognition.submit','recognition.correct','recognition.return','recognition.publish','recognition.withdraw'].includes(command.action),'Unknown recognition action.');
 const facts=()=>{
  const recipient=member(input.recipientId);requireThat(recipient.locationId===me.locationId&&recipient.id!==me.id&&recognitionParticipant(recipient),'Choose another current employee at this restaurant.');
  const occurredOn=calendarDate(input.occurredOn,'Recognition date');requireThat(occurredOn<=localDate(at,w.location.timezone),'The recognition date cannot be in the future at this restaurant.');
  requireThat(input.shareConfirmed===true,'Confirm that your name and this thank-you may appear on this restaurant’s board after owner review.');
  return {title:text(input.title,'Title',200),message:text(input.message,'Thank-you',2000),recipientId:recipient.id,recipientName:recipient.name,occurredOn};
 };
 if(command.action==='recognition.submit'){
  requireThat(!command.recordId,'Correct the original submission instead.');
  create({kind:'recognition',data:{...facts(),authorName:me.name,submittedAt:at,status:'submitted',publication:null,internal:{history:[history('submitted','Named thank-you submitted for owner review.')],versions:[]}}});return;
 }
 const r=find('recognition'),d=r.data;
 requireThat(recognitionEditor(r,me),'Only the author or a restaurant owner can change this recognition.',403);
 requireThat(d.internal,'The retained review history is unavailable.',409);
 requireThat(d.internal.history.length<100,'This record has reached its update limit. Preserve it for review.');
 const note=text(input.note,'Reason or review note',2000),internal={...d.internal,history:[...d.internal.history,history(command.action.slice(12),note)]};let data:Recognition={...d,internal};
 if(command.action==='recognition.correct'){
  requireThat(r.ownerId===me.id,'Only the author can change their thank-you.',403);
  requireThat(d.status==='submitted'||d.status==='returned','Published and withdrawn thank-yous are fixed. Withdraw published recognition and submit a new thank-you to replace it.');
  data={...data,...facts(),status:'submitted',internal:{...internal,versions:[...internal.versions,{by:me.id,at,reason:note,facts:factsOf(d)}]}};
 }else if(command.action==='recognition.return'||command.action==='recognition.publish'){
  requireThat(recognitionReviewer(r,me),'An independent restaurant owner must review this thank-you. Its author and recipient cannot review it.',403);
  requireThat(d.status==='submitted','Only a submitted thank-you is awaiting review.');
  if(command.action==='recognition.publish'){
   const recipient=member(d.recipientId);requireThat(recognitionParticipant(recipient),'The recipient’s access changed. Return this submission for correction.');
   requireThat(input.confirmed===true,'Confirm publication of this exact named thank-you to the restaurant board.');
   data={...data,status:'published',publication:{by:me.id,at}};
  }else data.status='returned';
 }else{
  requireThat(d.status!=='withdrawn','This thank-you is already withdrawn.');
  requireThat(input.confirmed===true,'Confirm withdrawal from review and from the restaurant board.');data.status='withdrawn';
 }
 save({...r,data});
}
