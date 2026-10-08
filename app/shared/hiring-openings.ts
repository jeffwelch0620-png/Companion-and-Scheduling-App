import {applyOpeningApplicant,type OpeningApplicant} from './opening-applicants';
import type {Member,RecordOf,History,Workspace} from './types';
import type {CommandContext} from './followthrough';
import {guestOwner,guestManager} from './guest-reviews';
import {calendarDate} from './schedule-policy';
import {requireThat,text} from './validation';
import {hireReader,hireEvidence,hireScheduler} from './hire-handoff';

export type OpeningFacts={title:string;department:'FOH'|'BOH';positions:number;neededOn:string;shiftPlan:string;reason:string;sourceRef:string;managerId:string;managerName:string};
type Approval={by:string;at:string;revision:number};
type Status='draft'|'review'|'open'|'closed';
export type OpeningHireReview={openingApprovalRevision:number;handoffRevision:number;employeeRevision:number;by:string;at:string;note:string};
export type OpeningHireLink={id:string;handoffId:string;employeeId:string;employeeName:string;hireDate:string;department:string;reviews:OpeningHireReview[];released?:{by:string;at:string;note:string}};
export type HiringOpening=OpeningFacts&{status:Status;approval:Approval|null;history:History;versions:{at:string;by:string;note:string;facts:OpeningFacts;status:Status;approval:Approval|null}[];onboarding?:{links:OpeningHireLink[]};applicants?:OpeningApplicant[]};
export const openingOwner=guestOwner;
export const openingManager=guestManager;
export function openingReader(r:RecordOf<'opening'>,m:Member){return r.locationId===m.locationId&&(openingOwner(m)||openingManager(m)&&r.data.managerId===m.id);}
export function openingView(r:RecordOf<'opening'>,m:Member):RecordOf<'opening'>{if(openingOwner(m))return r;const {onboarding,applicants,...data}=r.data;return {...r,data};}
export function openingHireProgress(w:Workspace,r:RecordOf<'opening'>,link:OpeningHireLink){
 if(link.released)return {state:'released',label:'Link released'};
 const review=link.reviews.at(-1),h=w.records.find((x):x is RecordOf<'hirehandoff'>=>x.kind==='hirehandoff'&&x.id===link.handoffId&&x.locationId===r.locationId);
 if(r.data.status!=='open'||!r.data.approval||review?.openingApprovalRevision!==r.data.approval.revision)return {state:'review',label:'Opening approval changed — owner review needed'};
 if(!h||!hireReader(h,w.me))return {state:'review',label:'Handoff unavailable — owner review needed'};
 if(h.ownerId!==link.employeeId||h.data.hireDate!==link.hireDate||h.area!==link.department||h.area!==r.data.department||h.data.status==='cancelled'||!hireEvidence(w,h).setupCurrent)return {state:'review',label:'Hire setup or handoff changed — owner review needed'};
 if(!w.members.some(m=>m.id===h.data.schedulerId&&hireScheduler(m,h.area)))return {state:'review',label:'Scheduler access changed — review the handoff'};
 if(h.data.status==='scheduled')return hireEvidence(w,h).current?{state:'scheduled',label:'Published first shift confirmed'}:{state:'review',label:'Published shift changed — review the handoff'};
 return h.data.status==='accepted'?{state:'accepted',label:'Scheduler arranging first shift'}:{state:'awaiting',label:'Awaiting scheduler acknowledgment'};
}
function applyOpeningHireLink(c:CommandContext,r:RecordOf<'opening'>){
 const {w,me,input,command,at,member,save,history}=c,d=r.data;
 requireThat(openingOwner(me),'Only a restaurant owner or administrator can manage onboarding links.',403);
 const links=d.onboarding?.links??[],note=text(input.note,'Private link review note',3000);
 requireThat(input.checked===true,'Confirm that you checked this onboarding link.');
 let next:OpeningHireLink[];
 if(command.action==='opening.release-handoff'){
  const link=links.find(l=>l.id===input.linkId);requireThat(link&&!link.released,'Choose a current onboarding link.');
  next=links.map(l=>l.id===link.id?{...l,released:{by:me.id,at,note}}:l);
 }else{
  requireThat(d.status==='open'&&d.approval,'Approve the current staffing request before linking or reviewing onboarding.');
  requireThat(openingManager(member(d.managerId)),'Assign a current responsible manager before linking onboarding.');
  const h=w.records.find((x):x is RecordOf<'hirehandoff'>=>x.kind==='hirehandoff'&&x.id===input.handoffId&&x.locationId===r.locationId&&hireReader(x,me));
  requireThat(h,'Choose an accessible first-shift handoff in this restaurant.',404);requireThat(h.revision===input.handoffRevision,'The handoff changed. Refresh and review it again.',409);
  const evidence=hireEvidence(w,h);requireThat(evidence.setupCurrent&&evidence.person,'Review the current hire date and employee setup first.',409);
  requireThat(evidence.person.revision===input.employeeRevision,'Employee setup changed. Refresh and review it again.',409);
  requireThat(h.area===d.department&&h.data.status!=='cancelled','Choose a non-cancelled handoff in the requested department.');
  requireThat(w.members.some(m=>m.id===h.data.schedulerId&&hireScheduler(m,h.area)),'Review the responsible scheduler’s current access first.',409);
  const review:OpeningHireReview={openingApprovalRevision:d.approval.revision,handoffRevision:h.revision,employeeRevision:evidence.person.revision,by:me.id,at,note};
  if(command.action==='opening.review-handoff'){
   const link=links.find(l=>l.id===input.linkId);requireThat(link&&!link.released&&link.handoffId===h.id&&link.employeeId===h.ownerId&&link.hireDate===h.data.hireDate&&link.department===h.area,'Release an incorrect link before choosing a different hire or handoff.');
   next=links.map(l=>l.id===link.id?{...l,reviews:[...l.reviews,review]}:l);
  }else{
   requireThat(links.length<100,'This opening has reached its link history limit. Preserve it for review.');
   requireThat(links.filter(l=>!l.released).length<d.positions,'All requested positions already have an onboarding link. Release an incorrect link or revise the staffing request.');
   requireThat(!w.records.some(x=>x.kind==='opening'&&x.locationId===r.locationId&&x.data.onboarding?.links.some(l=>!l.released&&l.employeeId===h.ownerId&&l.hireDate===h.data.hireDate)),'This hire is already linked to a staffing request. Review and release the earlier link first.',409);
   next=[...links,{id:crypto.randomUUID(),handoffId:h.id,employeeId:h.ownerId,employeeName:h.data.employeeName,hireDate:h.data.hireDate,department:h.area,reviews:[review]}];
  }
 }
 // Applicant identity and the owner's link notes never enter manager-visible history.
 save({...r,data:{...d,onboarding:{links:next},history:[...d.history,history(command.action.slice(8),'Owner updated private onboarding links.')]}});
}
function factsOf(d:OpeningFacts):OpeningFacts{const {title,department,positions,neededOn,shiftPlan,reason,sourceRef,managerId,managerName}=d;return {title,department,positions,neededOn,shiftPlan,reason,sourceRef,managerId,managerName};}
export function applyOpening(c:CommandContext){
 const {w,me,input,command,at,member,find,create,save,history}=c;
 requireThat(command.action.startsWith('opening.applicant-')||['opening.create','opening.revise','opening.submit','opening.return','opening.approve','opening.close','opening.reopen','opening.link-handoff','opening.review-handoff','opening.release-handoff'].includes(command.action),'Unknown hiring opening action.');
 const fields=():OpeningFacts=>{
  requireThat(openingManager(me),'Current manager access is required.',403);
  const manager=member(input.managerId);requireThat(openingManager(manager),'Choose a current manager in this restaurant.');
  requireThat(openingOwner(me)||manager.id===me.id,'Only an owner can assign another manager.',403);
  requireThat(input.department==='FOH'||input.department==='BOH','Choose FOH or BOH.');
  requireThat(typeof input.positions==='number'&&Number.isInteger(input.positions)&&input.positions>=1&&input.positions<=50,'Enter a whole number of positions from 1 to 50.');
  return {title:text(input.title,'Position title',200),department:input.department,positions:input.positions,neededOn:calendarDate(input.neededOn,'Needed by date'),shiftPlan:text(input.shiftPlan,'Shifts and hours needed',3000),reason:text(input.reason,'Staffing need',3000),sourceRef:text(input.sourceRef,'Planning source reference',2000),managerId:manager.id,managerName:manager.name};
 };
 if(command.action==='opening.create'){
  requireThat(!command.recordId,'Revise the existing opening instead.');const facts=fields();
  create({kind:'opening',data:{...facts,status:'draft',approval:null,history:[history('drafted','Staffing need saved; owner approval is required before it is open.')],versions:[]}},member(facts.managerId));return;
 }
 const r=find('opening'),d=r.data;
 requireThat(openingReader(r,me),'This opening is restricted to its responsible manager and restaurant owners.',403);
 if(command.action.startsWith('opening.applicant-')){applyOpeningApplicant(c,r);return;}
 requireThat(d.history.length<100,'This opening has reached its update limit. Preserve it for review.');
 if(['opening.link-handoff','opening.review-handoff','opening.release-handoff'].includes(command.action)){applyOpeningHireLink(c,r);return;}
 const note=text(input.note,'Update or reason',3000);
 let data:HiringOpening={...d,history:[...d.history,history(command.action.slice(8),note)]};
 const snapshot=()=>[...d.versions,{at,by:me.id,note,facts:factsOf(d),status:d.status,approval:d.approval}];
 if(command.action==='opening.revise'){
  requireThat(d.status!=='closed','An owner must reopen this closed request before details can change.');
  const facts=fields();
  requireThat(facts.positions>=(d.onboarding?.links.filter(l=>!l.released).length??0),'An owner must release extra onboarding links before reducing the number of positions.');
  requireThat(d.status!=='open'||input.resetApproval===true,'Confirm that changing this open position removes its approval and returns it to draft.');
  data={...data,...facts,status:'draft',approval:null,versions:snapshot()};
 }else if(command.action==='opening.submit'){
  requireThat(d.status==='draft','Only a draft can be submitted.');requireThat(openingManager(member(d.managerId)),'Assign a current manager before submitting.');
  requireThat(input.checked===true,'Confirm the staffing need, position count, date and shifts were checked.');data.status='review';
 }else if(command.action==='opening.return'){
  requireThat(openingOwner(me),'Only a restaurant owner or administrator can return a request.',403);requireThat(d.status==='review','Only a request awaiting review can be returned.');data.status='draft';
 }else if(command.action==='opening.approve'){
  requireThat(openingOwner(me),'Only a restaurant owner or administrator can approve an opening.',403);requireThat(d.status==='review','Submit the request for owner review first.');
  requireThat(openingManager(member(d.managerId)),'Assign a current manager before approval.');requireThat(input.approved===true,'Confirm approval of this exact staffing need, position count, date and shifts.');
  data={...data,status:'open',approval:{by:me.id,at,revision:r.revision+1}};
 }else if(command.action==='opening.close'){
  requireThat(d.status!=='closed','This opening is already closed.');requireThat(input.confirmed===true,'Confirm that this request should be closed.');data.status='closed';
 }else if(command.action==='opening.reopen'){
  requireThat(openingOwner(me),'Only a restaurant owner or administrator can reopen a request.',403);requireThat(d.status==='closed','Only a closed request can be reopened.');requireThat(input.confirmed===true,'Confirm that this request should return to draft for a new review.');
  data={...data,status:'draft',approval:null,versions:snapshot()};
 }
 const manager=w.members.find(m=>m.id===data.managerId);save({...r,ownerId:data.managerId,area:manager?.area??r.area,data});
}
