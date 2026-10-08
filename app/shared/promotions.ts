import type {Member,RecordOf,History} from './types';
import type {CommandContext} from './followthrough';
import {guestOwner,guestManager} from './guest-reviews';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export type PromotionFacts={title:string;startsOn:string;endsOn:string;offer:string;conditions:string;staffBrief:string;audience:('FOH'|'BOH')[];managerId:string;managerName:string};
type Statement={by:string;at:string;note:string};
export type Promotion=PromotionFacts&{status:'draft'|'review'|'approved'|'cancelled';approval:{by:string;at:string}|null;withdrawal:Statement|null;acknowledgments:{by:string;at:string;status:'approved'|'cancelled'}[];internal?:{sourceRef:string;comparisonPlan:string;history:History;versions:{at:string;by:string;reason:string;facts:PromotionFacts;sourceRef:string;comparisonPlan:string}[];outcomes:(Statement&{sourceRef:string})[]}};
export const promotionOwner=guestOwner;
export const promotionManager=guestManager;
export function promotionEditor(r:RecordOf<'promotion'>,m:Member){return r.locationId===m.locationId&&(promotionOwner(m)||promotionManager(m)&&r.data.managerId===m.id);}
export function promotionAudience(d:PromotionFacts,m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher'&&d.audience.some(a=>a===m.area);}
export function promotionReader(r:RecordOf<'promotion'>,m:Member){return promotionEditor(r,m)||r.locationId===m.locationId&&!!r.data.approval&&promotionAudience(r.data,m);}
export function promotionView(r:RecordOf<'promotion'>,m:Member):RecordOf<'promotion'>{if(promotionEditor(r,m))return r;const {internal,...data}=r.data;return {...r,data:{...data,acknowledgments:data.acknowledgments.filter(a=>a.by===m.id)}};}
export function promotionPhase(d:Promotion,at:string,zone:string){if(d.status!=='approved')return d.status;const day=localDate(at,zone);return day<d.startsOn?'upcoming':day>d.endsOn?'ended':'active';}
export function promotionNeedsAck(r:RecordOf<'promotion'>,m:Member,at:string,zone:string){return !!r.data.approval&&promotionAudience(r.data,m)&&promotionPhase(r.data,at,zone)!=='ended'&&!r.data.acknowledgments.some(a=>a.by===m.id&&a.status===r.data.status);}
function factsOf(d:PromotionFacts):PromotionFacts{const {title,startsOn,endsOn,offer,conditions,staffBrief,audience,managerId,managerName}=d;return {title,startsOn,endsOn,offer,conditions,staffBrief,audience,managerId,managerName};}
export function applyPromotion(c:CommandContext){
 const {w,me,input,command,at,member,find,create,save,history}=c;
 requireThat(['promotion.create','promotion.correct','promotion.submit','promotion.return','promotion.approve','promotion.cancel','promotion.acknowledge','promotion.outcome'].includes(command.action),'Unknown promotion action.');
 const fields=()=>{
  requireThat(promotionManager(me),'Current manager access is required.',403);
  const manager=member(input.managerId);requireThat(promotionManager(manager),'Choose a current manager in this restaurant.');
  requireThat(promotionOwner(me)||manager.id===me.id,'Only an owner can assign another manager.',403);
  const startsOn=calendarDate(input.startsOn,'Start date'),endsOn=calendarDate(input.endsOn,'End date');requireThat(endsOn>=startsOn,'End date cannot precede the start date.');
  requireThat(Array.isArray(input.audience)&&input.audience.length>0&&input.audience.length<=2&&input.audience.every(a=>a==='FOH'||a==='BOH')&&new Set(input.audience).size===input.audience.length,'Choose FOH, BOH or both for the staff briefing.');
  return {facts:{title:text(input.title,'Promotion title',200),startsOn,endsOn,offer:text(input.offer,'Exact offer',3000),conditions:text(input.conditions,'Conditions and limits',3000),staffBrief:text(input.staffBrief,'Staff briefing',3000),audience:input.audience as PromotionFacts['audience'],managerId:manager.id,managerName:manager.name},sourceRef:text(input.sourceRef,'Source reference',2000),comparisonPlan:text(input.comparisonPlan,'Comparison plan',3000)};
 };
 if(command.action==='promotion.create'){
  requireThat(!command.recordId,'Correct the existing draft instead.');const f=fields();
  create({kind:'promotion',data:{...f.facts,status:'draft',approval:null,withdrawal:null,acknowledgments:[],internal:{sourceRef:f.sourceRef,comparisonPlan:f.comparisonPlan,history:[history('drafted','Proposal saved; owner approval is still required.')],versions:[],outcomes:[]}}},member(f.facts.managerId));return;
 }
 const r=find('promotion'),d=r.data;
 if(command.action==='promotion.acknowledge'){
  requireThat(promotionNeedsAck(r,me,at,w.location.timezone),'There is no current unread briefing for you.',400);requireThat(input.read===true,'Confirm that you read the offer, conditions and any withdrawal notice.');
  requireThat(d.acknowledgments.length<1000,'This briefing has reached its acknowledgment limit. Ask the owner to preserve it for review.');
  save({...r,data:{...d,acknowledgments:[...d.acknowledgments,{by:me.id,at,status:d.status as 'approved'|'cancelled'}]}});return;
 }
 requireThat(promotionEditor(r,me),'This promotion’s planning is restricted to its manager and restaurant owners.',403);
 requireThat(d.internal,'Promotion planning history is unavailable.',409);requireThat(d.internal.history.length<200,'This record has reached its update limit. Preserve it for review.');
 const note=text(input.note,'Update or reason',3000),internal={...d.internal,history:[...d.internal.history,history(command.action.slice(10),note)]};let data:Promotion={...d,internal};
 if(command.action==='promotion.correct'){
  requireThat(['draft','review'].includes(d.status),'Approved offers are fixed. Withdraw this offer and create a new proposal to change its terms.');const f=fields();
  data={...data,...f.facts,status:'draft',internal:{...internal,sourceRef:f.sourceRef,comparisonPlan:f.comparisonPlan,versions:[...internal.versions,{at,by:me.id,reason:note,facts:factsOf(d),sourceRef:internal.sourceRef,comparisonPlan:internal.comparisonPlan}]}};
 }else if(command.action==='promotion.submit'){
  requireThat(d.status==='draft','Only a draft can be sent for review.');requireThat(promotionManager(member(d.managerId)),'Assign a current manager before submitting.');requireThat(input.checked===true,'Confirm the source, dates, exact offer and staff briefing were checked.');data.status='review';
 }else if(command.action==='promotion.return'){
  requireThat(promotionOwner(me),'Only a restaurant owner or administrator can return an offer.',403);requireThat(d.status==='review','Only an offer awaiting review can be returned.');data.status='draft';
 }else if(command.action==='promotion.approve'){
  requireThat(promotionOwner(me),'Only a restaurant owner or administrator can approve an offer.',403);requireThat(d.status==='review','Submit the proposal for owner review first.');
  requireThat(localDate(at,w.location.timezone)<=d.endsOn,'This offer has ended. Correct its dates before approval.');requireThat(promotionManager(member(d.managerId)),'Assign a current manager before approval.');requireThat(input.approved===true,'Confirm approval of this exact offer, dates, conditions and staff briefing.');data={...data,status:'approved',approval:{by:me.id,at}};
 }else if(command.action==='promotion.cancel'){
  requireThat(promotionOwner(me),'Only a restaurant owner or administrator can withdraw or cancel an offer.',403);requireThat(d.status!=='cancelled','This offer is already cancelled.');
  data={...data,status:'cancelled',withdrawal:{by:me.id,at,note}};
 }else if(command.action==='promotion.outcome'){
  requireThat(d.approval&&(d.status==='cancelled'||promotionPhase(d,at,w.location.timezone)==='ended'),'Record the outcome after the approved offer ends or is withdrawn.');requireThat(input.checked===true,'Confirm this is a source-backed observation, with comparison limits stated.');
  data={...data,internal:{...internal,outcomes:[...internal.outcomes,{by:me.id,at,note,sourceRef:text(input.sourceRef,'Outcome source reference',2000)}]}};
 }
 const manager=w.members.find(m=>m.id===data.managerId);save({...r,ownerId:data.managerId,area:manager?.area??r.area,data});
}
