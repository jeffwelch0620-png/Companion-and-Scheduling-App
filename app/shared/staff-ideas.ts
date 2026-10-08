import {has,manages,type Member,type RecordOf,type History} from './types';
import type {CommandContext} from './followthrough';
import {requireThat,text} from './validation';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
export type IdeaOutcome='follow-up'|'implemented'|'declined'|'deferred';
export type IdeaResponse={id:string;by:string;at:string;outcome:IdeaOutcome;note:string;evidence:string;readAt:string|null};
export type StaffIdea={title:string;idea:string;benefit:string;employeeName:string;submittedAt:string;status:'submitted'|'reviewing'|'closed';managerId:string;dueDate:string;responses:IdeaResponse[];history:History};
export function ideaParticipant(m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher';}
export function ideaOwner(m:Member){return ideaParticipant(m)&&has(m,'location.manage');}
export function ideaReviewer(m:Member,area=m.area){return ideaParticipant(m)&&(ideaOwner(m)||manages(m,area,'tasks.manage')||manages(m,area,'people.manage'));}
export function ideaReader(r:RecordOf<'staffidea'>,m:Member){return ideaParticipant(m)&&r.locationId===m.locationId&&(r.ownerId===m.id||ideaReviewer(m,r.area));}
export const ideaOutcomeLabels:Record<IdeaOutcome,string>={'follow-up':'Further follow-up','implemented':'Implementation reported','declined':'Not proceeding','deferred':'Deferred'};
export function applyStaffIdea(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history,member}=c;
 requireThat(ideaParticipant(me),'Staff ideas are not available for this account.',403);
 requireThat(['staffidea.submit','staffidea.assign','staffidea.respond','staffidea.read','staffidea.note','staffidea.reopen'].includes(command.action),'Unknown staff idea action.');
 if(command.action==='staffidea.submit'){
  requireThat(!command.recordId,'Submit a new idea, or add a clarification to the original.');
  requireThat(input.shareConfirmed===true,'Confirm that your name and idea are shared with restaurant owners and authorized managers for your department.');
  create({kind:'staffidea',data:{title:text(input.title,'Idea title',200),idea:text(input.idea,'Your idea',4000),benefit:text(input.benefit??'','Expected benefit',1500,true),employeeName:me.name,submittedAt:at,status:'submitted',managerId:'',dueDate:'',responses:[],history:[history('submitted','Named idea shared for internal review.')]}});return;
 }
 const r=find('staffidea'),d=r.data;
 requireThat(d.history.length<100,'This idea reached its history limit. Keep the record and ask an owner to follow up.');
 if(command.action==='staffidea.read'){
  requireThat(r.ownerId===me.id,'Only the submitting employee records their own read receipt.',403);
  const latest=d.responses.at(-1);requireThat(latest&&latest.id===input.responseId,'The response changed. Read the latest response first.',409);
  requireThat(!latest.readAt,'This response already has your read receipt.',409);requireThat(input.confirmed===true,'Confirm you have read this response.');
  save({...r,data:{...d,responses:d.responses.map(x=>x===latest?{...x,readAt:at}:x),history:[...d.history,history('response-read','Employee confirmed reading the latest response. This is not agreement or approval.')]}});return;
 }
 const note=text(input.note,'Update or reason',3000);let data:StaffIdea={...d,history:[...d.history,history(command.action.slice(10),note)]};
 if(command.action==='staffidea.assign'){
  requireThat(ideaReviewer(me,r.area)&&r.ownerId!==me.id,'An independent authorized reviewer assigns follow-up.',403);
  requireThat(d.status!=='closed','Reopen this idea before assigning more work.');
  const reviewer=member(input.managerId);requireThat(reviewer.locationId===r.locationId&&reviewer.id!==r.ownerId&&ideaReviewer(reviewer,r.area),'Choose an independent current reviewer for this department.');
  requireThat(ideaOwner(me)||reviewer.id===me.id,'A department manager may take responsibility themselves. An owner assigns other reviewers.',403);
  requireThat(input.accepted===true,'Confirm the reviewer assignment and explicit follow-up date.');
  const dueDate=calendarDate(input.dueDate,'Follow-up date');requireThat(dueDate>=localDate(at,w.location.timezone),'Choose today or a future restaurant date.');
  data={...data,status:'reviewing',managerId:reviewer.id,dueDate};
 }else if(command.action==='staffidea.respond'){
  requireThat(d.status==='reviewing'&&d.managerId===me.id&&r.ownerId!==me.id&&ideaReviewer(me,r.area),'Only the assigned current reviewer responds.',403);
  const outcome=input.outcome as IdeaOutcome;requireThat(Object.hasOwn(ideaOutcomeLabels,String(outcome)),'Choose a follow-up outcome.');
  requireThat(input.confirmed===true,'Confirm the response describes the actual decision or work and its limits.');
  const evidence=text(input.evidence??'','Implementation evidence',2000,outcome!=='implemented');
  let dueDate=d.dueDate;if(outcome==='follow-up'){dueDate=calendarDate(input.dueDate,'Next follow-up date');requireThat(dueDate>=localDate(at,w.location.timezone),'Choose today or a future restaurant date.');}
  requireThat(!d.responses.some(x=>x.id===command.requestId),'This response reference already exists.',409);
  data={...data,status:outcome==='follow-up'?'reviewing':'closed',dueDate,responses:[...d.responses,{id:command.requestId,by:me.id,at,outcome,note,evidence,readAt:null}]};
 }else if(command.action==='staffidea.reopen'){
  requireThat(r.ownerId===me.id||ideaOwner(me),'Only the submitter or an owner reopens this idea.',403);
  requireThat(d.status==='closed','This idea is already open.');data={...data,status:'submitted',managerId:'',dueDate:''};
 }else{
  requireThat(d.status!=='closed','Reopen this idea before adding a clarification.');
  requireThat(r.ownerId===me.id||ideaOwner(me)||d.managerId===me.id&&ideaReviewer(me,r.area),'Only the submitter, assigned reviewer or owner adds a clarification.',403);
 }
 save({...r,data});
}
