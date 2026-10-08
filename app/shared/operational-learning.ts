import {manages,type Member,type RecordOf,type History,type Workspace,type WorkRecord} from './types';
import type {CommandContext} from './followthrough';
import {equipmentReader} from './equipment';
import {maintenanceReader} from './maintenance';
import {requireThat,text} from './validation';

export type OperationalLearningSource={id:string;revision:number;kind:'task'|'equipment'|'maintenance';title:string;serviceId?:string};
export type OperationalLearningAsset={id:string;revision:number;title:string;assetTag:string};
export type OperationalLearningReview={verdict:'supported'|'uncertain'|'failed';by:string;at:string;evidence:string;note:string;causeStatus:'not-established'|'reported'|'confirmed';cause:string};
export type OperationalLearningFacts={title:string;symptom:string;actionsTaken:string;observedResult:string;uncertainty:string;remainingWork:string;source:OperationalLearningSource;asset?:OperationalLearningAsset};
export type OperationalLearningCase=OperationalLearningFacts&{readSourceState?:'current'|'changed'|'unavailable'|'retired'|'voided';reporterName:string;submittedAt:string;status:'reported'|'reviewed'|'withdrawn';review:OperationalLearningReview|null;versions:{facts:OperationalLearningFacts;review:OperationalLearningReview|null;status:OperationalLearningCase['status'];by:string;at:string;reason:string}[];history:History};
export function operationalLearningParticipant(m:Member){return !m.scheduleOnly;}
export function operationalLearningReviewer(m:Member,area=m.area){return operationalLearningParticipant(m)&&m.position!=='Dishwasher'&&manages(m,area,'tasks.manage');}
export function operationalLearningReader(r:RecordOf<'learningcase'>,m:Member){return operationalLearningParticipant(m)&&r.locationId===m.locationId&&(r.ownerId===m.id||operationalLearningReviewer(m,r.area)||r.data.status==='reviewed'&&m.area===r.area);}
function sourceReader(r:WorkRecord,m:Member){if(r.locationId!==m.locationId)return false;if(r.kind==='task')return m.position==='Dishwasher'?r.ownerId===m.id&&r.area===m.area&&r.data.kind==='task':r.ownerId===m.id||operationalLearningReviewer(m,r.area);if(r.kind==='equipment')return equipmentReader(r,m);if(r.kind==='maintenance')return maintenanceReader(r,m);return false;}
export function operationalLearningSources(w:Workspace,m=w.me){return w.records.filter((r):r is RecordOf<'task'|'equipment'|'maintenance'>=>sourceReader(r,m)&&(r.kind==='task'||(r.kind==='equipment'||r.kind==='maintenance')&&r.data.status==='active'));}
export function operationalLearningSourceState(w:Workspace,r:RecordOf<'learningcase'>):'current'|'changed'|'unavailable'|'retired'|'voided'{
 const source=w.records.find(x=>x.id===r.data.source.id&&x.locationId===r.locationId&&x.kind===r.data.source.kind);
 if(!source)return 'unavailable';if(source.revision!==r.data.source.revision)return 'changed';
 if((source.kind==='maintenance'||source.kind==='equipment')&&source.data.status!=='active')return 'retired';
 if(source.kind==='maintenance'&&r.data.source.serviceId){const service=source.data.services.find(s=>s.id===r.data.source.serviceId);if(!service||service.voided)return 'voided';}
 if(r.data.asset){const asset=w.records.find(x=>x.id===r.data.asset!.id&&x.locationId===r.locationId&&x.kind==='equipment');if(!asset)return 'unavailable';if(asset.kind!=='equipment'||asset.data.status!=='active')return 'retired';if(asset.revision!==r.data.asset.revision)return 'changed';}
 return 'current';
}
export function operationalLearningView(w:Workspace,r:RecordOf<'learningcase'>):RecordOf<'learningcase'>{return {...r,data:{...r.data,readSourceState:operationalLearningSourceState(w,r)}};}
export function operationalLearningFacts(d:OperationalLearningCase):OperationalLearningFacts{const {title,symptom,actionsTaken,observedResult,uncertainty,remainingWork,source,asset}=d;return {title,symptom,actionsTaken,observedResult,uncertainty,remainingWork,source:{...source},...(asset?{asset:{...asset}}:{})};}
export function applyOperationalLearning(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history,notify}=c;
 requireThat(operationalLearningParticipant(me),'Enable this restaurant account before sharing operational reports.',403);
 requireThat(['learningcase.submit','learningcase.revise','learningcase.review','learningcase.withdraw'].includes(command.action),'Unknown operational learning action.');
 const existing=command.action==='learningcase.submit'?null:find('learningcase'),note=command.action==='learningcase.submit'?'Explicit shared operational report. Private conversations are not included.':text(input.note,'Review, correction or withdrawal reason',3000);
 if(existing){requireThat(existing.data.history.length<100,'Retain this case history and submit a new linked report for further events.');requireThat(existing.data.status!=='withdrawn','This case was withdrawn. Retain it and submit a corrected new report.');}
 const archive=(r:RecordOf<'learningcase'>)=>[...r.data.versions,{facts:operationalLearningFacts(r.data),review:r.data.review,status:r.data.status,by:me.id,at,reason:note}];
 if(command.action==='learningcase.withdraw'){
  requireThat(existing&&(existing.ownerId===me.id||operationalLearningReviewer(me,existing.area)),'Only the submitting employee or authorized department manager withdraws this shared report.',403);
  requireThat(input.confirmed===true,'Confirm withdrawal; the dated report and review history remain retained.');
  save({...existing,data:{...existing.data,status:'withdrawn',versions:archive(existing),history:[...existing.data.history,history('withdrawn',note)]}});return;
 }
 if(command.action==='learningcase.review'){
  requireThat(existing&&operationalLearningReviewer(me,existing.area),'An authorized restaurant and department manager reviews this case.',403);
  requireThat(me.id!==existing.ownerId,'A different authorized manager reviews the reported case.',403);
  requireThat(input.confirmed===true,'Confirm this review describes the observed evidence and its limits, not a new approved procedure.');
  const verdict=input.verdict,causeStatus=input.causeStatus??'not-established';requireThat(['supported','uncertain','failed'].includes(String(verdict)),'Choose supported, uncertain or failed.');requireThat(['not-established','reported','confirmed'].includes(String(causeStatus)),'Choose whether the cause is unknown, reported or confirmed.');
  const evidence=text(input.evidence,'Outcome review evidence',2000),cause=text(input.cause??'','Reported or confirmed cause',2000,causeStatus==='not-established');
  requireThat(causeStatus!=='not-established'||!cause,'Leave the cause empty when it is not established.');
  requireThat(operationalLearningSourceState(w,{...existing,data:{...existing.data,asset:undefined}})==='current','The linked work changed. Correct and relink its current evidence before review.',409);
  const source=w.records.find(r=>r.id===existing.data.source.id)!;
  if(verdict==='supported')requireThat(source.kind==='task'&&source.data.phase==='closed'&&source.data.history.some(h=>h.action==='verify'&&h.actorId!==source.ownerId)||source.kind==='maintenance'&&!!existing.data.source.serviceId&&source.data.services.some(s=>s.id===existing.data.source.serviceId&&!s.voided),'A supported outcome needs independently verified completed work or an unvoided recorded maintenance service. Equipment identity alone is not repair evidence.');
  let asset=existing.data.asset;
  if(input.assetId){const found=w.records.find((r):r is RecordOf<'equipment'>=>r.id===input.assetId&&r.kind==='equipment'&&r.locationId===existing.locationId&&r.data.status==='active'&&equipmentReader(r,me));requireThat(found,'Choose checked active equipment in this restaurant.');requireThat(found.revision===input.assetRevision,'The equipment source changed. Refresh before linking this outcome.',409);asset={id:found.id,revision:found.revision,title:found.data.title,assetTag:found.data.assetTag};}
  requireThat(!existing.data.asset||!asset||asset.id===existing.data.asset.id,'A different physical asset needs its own case; do not transfer this machine’s past outcome.');
  requireThat(operationalLearningSourceState(w,{...existing,data:{...existing.data,...(asset?{asset}:{})}})==='current','The linked work or equipment changed. Correct and relink the current evidence before review.',409);
  const review:OperationalLearningReview={verdict:verdict as OperationalLearningReview['verdict'],by:me.id,at,evidence,note,causeStatus:causeStatus as OperationalLearningReview['causeStatus'],cause};
  save({...existing,data:{...existing.data,...(asset?{asset}:{}),status:'reviewed',review,versions:archive(existing),history:[...existing.data.history,history('reviewed-'+verdict,note)]}});notify([existing.ownerId],'Operational report reviewed',existing.data.title+': '+verdict+' — historical evidence, not an approved troubleshooting instruction.',existing.id);return;
 }
 if(existing)requireThat(existing.ownerId===me.id||operationalLearningReviewer(me,existing.area),'Only the submitting employee or authorized department manager corrects this report.',403);
 else requireThat(!command.recordId,'Submit a new shared case or correct the original case.');
 requireThat(input.shareConfirmed===true,'Confirm the operational facts below may be shared with authorized restaurant staff and managers. Private chat is not imported.');
 const source=w.records.find(r=>r.id===input.sourceId&&sourceReader(r,me));requireThat(source&&(source.kind==='task'||source.kind==='maintenance'||source.kind==='equipment'),'Choose your authorized current work or checked equipment.');requireThat(source.revision===input.sourceRevision,'The linked source changed. Refresh and review its current revision.',409);
 requireThat(!existing||source.area===existing.area,'Keep this case with its original department. Submit a separate case for another department.');
 let serviceId:string|undefined,asset:OperationalLearningAsset|undefined=existing?.data.asset;
 if(source.kind==='equipment'||source.kind==='maintenance')requireThat(source.data.status==='active','Choose active checked equipment or maintenance.');
 if(source.kind==='maintenance'){if(input.serviceId){const service=source.data.services.find(s=>s.id===input.serviceId&&!s.voided);requireThat(service,'Choose an unvoided service entry.');serviceId=service.id;}if(source.data.asset){const found=w.records.find((r):r is RecordOf<'equipment'>=>r.kind==='equipment'&&r.id===source.data.asset!.id&&r.locationId===source.locationId&&r.data.status==='active'&&r.revision===source.data.asset!.revision);requireThat(found,'The maintenance equipment changed. Recheck the plan first.',409);asset={id:found.id,revision:found.revision,title:found.data.title,assetTag:found.data.assetTag};}}
 else requireThat(!input.serviceId,'Only maintenance cases can refer to a maintenance service entry.');
 if(source.kind==='equipment')asset={id:source.id,revision:source.revision,title:source.data.title,assetTag:source.data.assetTag};
 requireThat(!existing?.data.asset||!asset||asset.id===existing.data.asset.id,'A different physical asset needs a separate case.');
 const facts:OperationalLearningFacts={title:text(input.title,'Case title',200),symptom:text(input.symptom,'Observed problem',3000),actionsTaken:text(input.actionsTaken??'','Actions actually taken',3000,true),observedResult:text(input.observedResult,'Observed outcome',3000),uncertainty:text(input.uncertainty??'','Remaining uncertainty',2000,true),remainingWork:text(input.remainingWork??'','Unfinished work or next action',2000,true),source:{id:source.id,revision:source.revision,kind:source.kind,title:source.data.title,...(serviceId?{serviceId}:{})},...(asset?{asset}:{})};
 if(existing)save({...existing,data:{...existing.data,...facts,asset,status:'reported',review:null,versions:archive(existing),history:[...existing.data.history,history('corrected',note)]}});
 else create({kind:'learningcase',data:{...facts,reporterName:me.name,submittedAt:at,status:'reported',review:null,versions:[],history:[history('submitted',note)]}},{...me,area:source.area});
}
