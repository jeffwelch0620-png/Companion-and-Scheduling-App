import {has,type Member,type RecordOf,type History,type Workspace} from './types';
import type {CommandContext} from './followthrough';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export type ComplianceFacts={title:string;type:'permit'|'inspection';authority:string;reference:string;documentDate:string;dueDate:string|null;evidence:string;sourceUrl:string;summary:string;responsibleId:string;responsibleName:string};
export type ComplianceReview={by:string;at:string;note:string};
export type ComplianceRenewal={previousId:string;previousRevision:number;previousFacts:ComplianceFacts;previousReview:ComplianceReview;currentFacts:ComplianceFacts;currentReview:ComplianceReview;at:string;by:string;note:string};
export type ComplianceRenewalEvent={action:'linked'|'rechecked'|'cleared';at:string;by:string;note:string;link:ComplianceRenewal};
export type Compliance=ComplianceFacts&{renewal?:ComplianceRenewal|null;renewalHistory?:ComplianceRenewalEvent[];status:'needs-review'|'tracking'|'closed';review:ComplianceReview|null;resolution:string;history:History;versions:{at:string;by:string;facts:ComplianceFacts;review:ComplianceReview|null;resolution:string;reason:string}[]};
export function complianceManager(m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher'&&has(m,'location.manage');}
export function complianceReader(r:RecordOf<'compliance'>,m:Member){return r.locationId===m.locationId&&complianceManager(m);}
export function complianceFacts(d:ComplianceFacts):ComplianceFacts{const {title,type,authority,reference,documentDate,dueDate,evidence,sourceUrl,summary,responsibleId,responsibleName}=d;return {title,type,authority,reference,documentDate,dueDate,evidence,sourceUrl,summary,responsibleId,responsibleName};}
export function complianceDue(d:Compliance,today:string){return d.status==='closed'?'closed':!d.dueDate?'no-date':d.dueDate<today?'overdue':d.dueDate===today?'today':'upcoming';}
const authorityKey=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
export function complianceRenewalState(r:RecordOf<'compliance'>,w:Workspace):'none'|'current'|'needs-review'{
 const link=r.data.renewal;if(!link)return 'none';
 const previous=w.records.find((x):x is RecordOf<'compliance'>=>x.kind==='compliance'&&x.id===link.previousId&&x.locationId===r.locationId);
 if(!previous||!r.data.review||!previous.data.review)return 'needs-review';
 return JSON.stringify(complianceFacts(previous.data))===JSON.stringify(link.previousFacts)&&JSON.stringify(previous.data.review)===JSON.stringify(link.previousReview)&&JSON.stringify(complianceFacts(r.data))===JSON.stringify(link.currentFacts)&&JSON.stringify(r.data.review)===JSON.stringify(link.currentReview)?'current':'needs-review';
}
export function complianceRenewalChoices(r:RecordOf<'compliance'>,w:Workspace){
 const records=w.records.filter((x):x is RecordOf<'compliance'>=>x.kind==='compliance'&&x.locationId===r.locationId),byId=new Map(records.map(x=>[x.id,x]));
 const used=new Set(records.filter(x=>x.id!==r.id&&x.data.renewal).map(x=>x.data.renewal!.previousId));
 const createsCycle=(candidate:RecordOf<'compliance'>)=>{const seen=new Set([r.id]);let cursor:RecordOf<'compliance'>|undefined=candidate;while(cursor){if(seen.has(cursor.id))return true;seen.add(cursor.id);cursor=cursor.data.renewal?byId.get(cursor.data.renewal.previousId):undefined;}return false;};
 return records.filter(x=>x.id!==r.id&&x.data.type==='permit'&&!!x.data.review&&x.data.documentDate<r.data.documentDate&&authorityKey(x.data.authority)===authorityKey(r.data.authority)&&(!r.data.renewal||r.data.renewal.previousId===x.id)&&!used.has(x.id)&&!createsCycle(x)).sort((a,b)=>b.data.documentDate.localeCompare(a.data.documentDate)||a.id.localeCompare(b.id));
}
export function applyCompliance(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history,member}=c;
 requireThat(complianceManager(me),'Restaurant owner or administrator access is required.',403);
 requireThat(['compliance.create','compliance.correct','compliance.review','compliance.close','compliance.reopen','compliance.note','compliance.renewal-link','compliance.renewal-clear'].includes(command.action),'Unknown inspection or permit action.');
 const facts=():ComplianceFacts=>{
  requireThat(input.type==='permit'||input.type==='inspection','Choose permit or inspection.');
  const documentDate=calendarDate(input.documentDate,'Source document date'),dueDate=input.dueDate?calendarDate(input.dueDate,'Recorded due date'):null;
  requireThat(documentDate<=localDate(at,w.location.timezone),'An issued document or completed inspection cannot be dated in the future.');
  requireThat(!dueDate||dueDate>=documentDate,'The recorded due date must be on or after the source document date.');
  const sourceUrl=text(input.sourceUrl??'','Source link',2000,true);
  if(sourceUrl){let valid=false;try{const url=new URL(sourceUrl);valid=url.protocol==='https:'&&!url.username&&!url.password;}catch{}requireThat(valid,'Use a full HTTPS source link without a username or password.');}
  const responsible=member(input.responsibleId);requireThat(responsible.locationId===w.location.id&&complianceManager(responsible),'Choose a current restaurant owner or administrator for follow-up.');
  return {title:text(input.title,'Record title',200),type:input.type,authority:text(input.authority,'Issuing or inspecting authority',200),reference:text(input.reference,'Source document reference',200),documentDate,dueDate,evidence:text(input.evidence,'Source location and date evidence',2000),sourceUrl,summary:text(input.summary,'Recorded findings or permit scope',4000),responsibleId:responsible.id,responsibleName:responsible.name};
 };
 if(command.action==='compliance.create'){
  requireThat(!command.recordId,'Use Correct source facts for an existing record.');const f=facts();
  requireThat(!w.records.some(r=>r.kind==='compliance'&&r.data.type===f.type&&r.data.authority.toLowerCase()===f.authority.toLowerCase()&&r.data.reference.toLowerCase()===f.reference.toLowerCase()&&r.data.documentDate===f.documentDate),'This source document is already recorded. Open it and correct its facts if needed.',409);
  create({kind:'compliance',data:{...f,status:'needs-review',review:null,resolution:'',versions:[],history:[history('recorded','Source facts recorded for review. No renewal or compliance approval is implied.')]}});return;
 }
 const r=find('compliance');requireThat(complianceReader(r,me),'This record is restricted.',403);
 requireThat(r.data.history.length<200,'This record has reached its update limit. Preserve its history for owner review.');
 const note=text(input.note,'Update or reason',3000);let data={...r.data,history:[...r.data.history,history(command.action.slice(11),note)]};
 if(command.action==='compliance.renewal-link'){
  requireThat(data.type==='permit'&&data.review,'Check the newer permit against its source before linking an earlier permit.');
  requireThat(input.confirmed===true,'Confirm the renewal relationship against both source documents.');
  requireThat((data.renewalHistory?.length??0)<80,'This permit has reached its renewal-link review limit. Preserve its history for owner review.');
  requireThat(!data.renewal||data.renewal.previousId===input.previousId,'Clear the existing renewal link with a reason before choosing a different earlier permit.');
  const previous=complianceRenewalChoices(r,w).find(x=>x.id===input.previousId);
  requireThat(previous,'Choose a checked earlier permit from this restaurant and authority without another linked successor.',400);
  requireThat(Number.isSafeInteger(input.previousRevision)&&previous.revision===input.previousRevision,'The earlier permit changed. Refresh and review both documents.',409);
  const link:ComplianceRenewal={previousId:previous.id,previousRevision:previous.revision,previousFacts:complianceFacts(previous.data),previousReview:{...previous.data.review!},currentFacts:complianceFacts(data),currentReview:{...data.review},at,by:me.id,note};
  const event:ComplianceRenewalEvent={action:data.renewal?'rechecked':'linked',at,by:me.id,note,link};
  data={...data,renewal:link,renewalHistory:[...(data.renewalHistory??[]),event]};
 }else if(command.action==='compliance.renewal-clear'){
  requireThat(data.renewal,'This permit has no renewal link to clear.');
  data={...data,renewal:null,renewalHistory:[...(data.renewalHistory??[]),{action:'cleared',at,by:me.id,note,link:data.renewal}]};
 }else if(command.action==='compliance.correct'){
  const corrected=facts();requireThat(corrected.type===r.data.type,'Keep the document type; create a separate record for a different type.');
  requireThat(!w.records.some(x=>x.id!==r.id&&x.kind==='compliance'&&x.data.type===corrected.type&&x.data.authority.toLowerCase()===corrected.authority.toLowerCase()&&x.data.reference.toLowerCase()===corrected.reference.toLowerCase()&&x.data.documentDate===corrected.documentDate),'That source document is already recorded.',409);
  data={...data,...corrected,status:'needs-review',review:null,resolution:'',versions:[...data.versions,{at,by:me.id,facts:complianceFacts(r.data),review:r.data.review,resolution:r.data.resolution,reason:note}]};
 }else if(command.action==='compliance.review'){
  requireThat(data.status!=='closed','Reopen the follow-up before reviewing it.');requireThat(input.sourceChecked===true,'Confirm that the current entry was checked against its source.');
  data={...data,status:'tracking',review:{by:me.id,at,note}};
 }else if(command.action==='compliance.close'){
  requireThat(data.status==='tracking'&&data.review,'Check the current entry against its source before closing follow-up.');
  requireThat(input.followUpComplete===true,'Confirm you are closing the internal follow-up, not certifying legal compliance.');
  data={...data,status:'closed',resolution:note};
 }else if(command.action==='compliance.reopen'){
  requireThat(data.status==='closed','Only closed follow-up needs reopening.');data={...data,status:'needs-review',review:null,resolution:''};
 }
 save({...r,data});
}
