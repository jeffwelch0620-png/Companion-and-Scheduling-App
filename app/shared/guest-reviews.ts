import {has,type Member,type RecordOf,type History} from './types';
import type {CommandContext} from './followthrough';
import {operationsManager} from './operations';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export const guestChannels=['Google','Facebook','In person','Phone','Other'] as const;
export type GuestFacts={title:string;channel:typeof guestChannels[number];reference:string;sourceDate:string;sourceUrl:string;evidence:string;feedback:string;rating:number|null;managerId:string;managerName:string;dueDate:string;ownerNote:string};
export type GuestResponse={by:string;at:string;note:string};
export type GuestState='awaiting-ack'|'in-progress'|'owner-review'|'closed';
export type GuestCycle={status:GuestState;acknowledgment:GuestResponse|null;outcome:GuestResponse|null;closure:GuestResponse|null};
export type GuestReview=GuestFacts&GuestCycle&{history:History;versions:{at:string;by:string;reason:string;facts:GuestFacts;cycle:GuestCycle}[]};
export function guestOwner(m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher'&&has(m,'location.manage');}
export function guestManager(m:Member){return !m.scheduleOnly&&operationsManager(m);}
export function guestReader(r:RecordOf<'guestreview'>,m:Member){return r.locationId===m.locationId&&(guestOwner(m)||guestManager(m)&&r.data.managerId===m.id);}
export function guestFacts(d:GuestFacts):GuestFacts{const {title,channel,reference,sourceDate,sourceUrl,evidence,feedback,rating,managerId,managerName,dueDate,ownerNote}=d;return {title,channel,reference,sourceDate,sourceUrl,evidence,feedback,rating,managerId,managerName,dueDate,ownerNote};}
export function guestCycle(d:GuestCycle):GuestCycle{const {status,acknowledgment,outcome,closure}=d;return {status,acknowledgment,outcome,closure};}
export function sameGuestSource(a:GuestFacts,b:GuestFacts){return a.channel===b.channel&&(a.reference.toLowerCase()===b.reference.toLowerCase()||!!a.sourceUrl&&a.sourceUrl===b.sourceUrl);}
const freshCycle=():GuestCycle=>({status:'awaiting-ack',acknowledgment:null,outcome:null,closure:null});
export function applyGuestReview(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history,member}=c;
 requireThat(guestManager(me),'Guest follow-up requires current manager access.',403);
 requireThat(['guestreview.create','guestreview.correct','guestreview.acknowledge','guestreview.outcome','guestreview.return','guestreview.close','guestreview.reopen','guestreview.note'].includes(command.action),'Unknown guest follow-up action.');
 const facts=():GuestFacts=>{
  requireThat(guestOwner(me),'Only a restaurant owner or administrator can enter or change the source and assignment.',403);
  requireThat(guestChannels.includes(input.channel as GuestFacts['channel']),'Choose the feedback source.');
  const channel=input.channel as GuestFacts['channel'],sourceDate=calendarDate(input.sourceDate,'Feedback date'),dueDate=calendarDate(input.dueDate,'Follow-up due date');
  requireThat(sourceDate<=localDate(at,w.location.timezone),'Guest feedback cannot be dated in the future.');
  requireThat(dueDate>=sourceDate,'Follow-up must be due on or after the feedback date.');
  let sourceUrl=text(input.sourceUrl??'','Source link',2000,true);
  if(sourceUrl){let valid=false;try{const url=new URL(sourceUrl);valid=url.protocol==='https:'&&!url.username&&!url.password;url.hash='';sourceUrl=url.href;}catch{}requireThat(valid,'Use a full HTTPS source link without a username or password.');}
  requireThat(!['Google','Facebook'].includes(channel)||!!sourceUrl,'Include the individual public review link, not just a business page.');
  requireThat(input.rating==null||typeof input.rating==='string'||typeof input.rating==='number','Use a numeric source rating or leave it blank.');
  const rating=input.rating===''||input.rating===null||input.rating===undefined?null:Number(input.rating);
  requireThat(rating===null||Number.isInteger(rating)&&rating>=1&&rating<=5,'Use the source rating from 1 to 5, or leave it blank.');
  const manager=member(input.managerId);requireThat(manager.locationId===w.location.id&&guestManager(manager),'Choose a current manager in this restaurant.');
  requireThat(input.sourceChecked===true,'Confirm the source, restaurant and feedback were checked before assigning.');
  return {title:text(input.title,'Follow-up title',200),channel,reference:text(input.reference,'Review ID or source reference',200),sourceDate,sourceUrl,evidence:text(input.evidence,'Source evidence',2000),feedback:text(input.feedback,'Guest feedback',4000),rating,managerId:manager.id,managerName:manager.name,dueDate,ownerNote:text(input.ownerNote,'Owner handoff note',3000)};
 };
 if(command.action==='guestreview.create'){
  requireThat(!command.recordId,'Correct the existing entry instead.');const f=facts();
  requireThat(!w.records.some(r=>r.kind==='guestreview'&&sameGuestSource(r.data,f)),'This feedback is already recorded. Open its existing follow-up.',409);
  create({kind:'guestreview',data:{...f,...freshCycle(),versions:[],history:[history('assigned','Owner checked the source and assigned internal follow-up. Awaiting the named manager’s acknowledgment.')]}},member(f.managerId));return;
 }
 const r=find('guestreview');requireThat(guestReader(r,me),'This guest follow-up is restricted.',403);
 requireThat(r.data.history.length<200,'This record has reached its update limit. Preserve its history for owner review.');
 const note=text(input.note,'Update or reason',3000),response={by:me.id,at,note};
 let data:GuestReview={...r.data,history:[...r.data.history,history(command.action.slice(12),note)]};
 const retain=()=>[...data.versions,{at,by:me.id,reason:note,facts:guestFacts(r.data),cycle:guestCycle(r.data)}];
 if(command.action==='guestreview.correct'){
  const f=facts();requireThat(!w.records.some(x=>x.kind==='guestreview'&&x.id!==r.id&&sameGuestSource(x.data,f)),'This feedback is already recorded.',409);
  data={...data,...f,...freshCycle(),versions:retain()};
 }else if(command.action==='guestreview.acknowledge'){
  requireThat(me.id===data.managerId,'Only the assigned manager can acknowledge responsibility.',403);
  requireThat(data.status==='awaiting-ack','This assignment is not awaiting acknowledgment.');
  requireThat(input.accepted===true,'Confirm that you have read the handoff and accept responsibility.');
  data={...data,status:'in-progress',acknowledgment:response};
 }else if(command.action==='guestreview.outcome'){
  requireThat(me.id===data.managerId,'Only the assigned manager can submit the outcome.',403);
  requireThat(data.status==='in-progress'&&data.acknowledgment,'Acknowledge the assignment before submitting its outcome.');
  requireThat(input.outcomeConfirmed===true,'Confirm this describes work actually done and any remaining limits.');
  data={...data,status:'owner-review',outcome:response};
 }else if(command.action==='guestreview.close'){
  requireThat(guestOwner(me),'Only a restaurant owner or administrator can close follow-up.',403);
  requireThat(data.status==='owner-review'&&data.outcome,'A manager outcome is required before owner review.');
  requireThat(input.reviewed===true,'Confirm that you reviewed the manager outcome.');
  data={...data,status:'closed',closure:response};
 }else if(command.action==='guestreview.return'||command.action==='guestreview.reopen'){
  requireThat(guestOwner(me),'Only a restaurant owner or administrator can return or reopen follow-up.',403);
  requireThat(data.status===(command.action==='guestreview.return'?'owner-review':'closed'),'This follow-up is not at that step.');
  const manager=member(data.managerId);requireThat(guestManager(manager),'Correct the assignment to a current manager first.');
  data={...data,...freshCycle(),versions:retain()};
 }else{
  requireThat(data.status!=='closed','Reopen closed follow-up before adding updates.');
 }
 const manager=w.members.find(m=>m.id===data.managerId);
 save({...r,ownerId:data.managerId,area:manager?.area??r.area,data});
}
