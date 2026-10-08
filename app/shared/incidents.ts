import { has, type Member, type RecordOf, type History } from './types';
import { operationsManager } from './operations';
import type { CommandContext } from './followthrough';
import { instant, requireThat, text } from './validation';

export const incidentCategories=['Injury','Theft','Building damage','Service interruption','Other safety event'] as const;
export type IncidentFacts={title:string;category:typeof incidentCategories[number];occurredAt:string;place:string;description:string;immediateAction:string};
export type IncidentReview={actorId:string;at:string;note:string};
export type Incident=IncidentFacts&{
  reporterId:string;reporterName:string;status:'open'|'reviewed'|'resolved';
  followUp:{ownerId:string;ownerName:string;due:string;nextStep:string}|null;
  review:IncidentReview|null;resolution:string;history:History;
  versions:{at:string;actorId:string;facts:IncidentFacts;review:IncidentReview|null;resolution:string;reason:string}[];
  contacts:{actorId:string;recordedAt:string;contactedAt:string;ownerId:string;ownerName:string;result:'spoke'|'no-answer';note:string}[];
};
export function incidentReader(r:RecordOf<'incident'>,me:Member){
  return me.locationId===r.locationId&&operationsManager(me)&&(has(me,'location.manage')||r.data.reporterId===me.id);
}
export function incidentFacts(data:IncidentFacts):IncidentFacts{
  const {title,category,occurredAt,place,description,immediateAction}=data;
  return {title,category,occurredAt,place,description,immediateAction};
}
export function applyIncident(c:CommandContext){
  const {w,me,input,command,at,find,create,save,history,member}=c;
  requireThat(operationsManager(me),'Manager access is required.',403);
  const owner=(value:unknown)=>{const m=member(value);requireThat(!m.scheduleOnly&&operationsManager(m)&&has(m,'location.manage'),'Choose a current restaurant owner or administrator.',400);return m;};
  const facts=():IncidentFacts=>{
    requireThat(incidentCategories.some(x=>x===input.category),'Choose an incident category.');
    const occurredAt=instant(input.occurredAt,'When it happened');
    requireThat(Date.parse(occurredAt)<=Date.parse(at),'An incident cannot be recorded in the future.');
    return {title:text(input.title,'Short summary',200),category:input.category as IncidentFacts['category'],occurredAt,place:text(input.place,'Where it happened',200),description:text(input.description,'What happened',6000),immediateAction:text(input.immediateAction,'Immediate action taken',3000)};
  };
  if(command.action==='incident.create'){
    requireThat(!command.recordId,'Use Correct facts for an existing report.');
    create({kind:'incident',data:{...facts(),reporterId:me.id,reporterName:me.name,status:'open',followUp:null,review:null,resolution:'',versions:[],contacts:[],history:[history('recorded','Restricted report saved. No owner call or external notification was sent.')]}});return;
  }
  const r=find('incident');
  requireThat(incidentReader(r,me),'This report is restricted.',403);
  requireThat(r.data.history.length<200,'This report has reached its update limit. Preserve its history for owner review.');
  const note=text(input.note,'Update or reason',3000);
  let data={...r.data,history:[...r.data.history,history(command.action.slice(9),note)]};
  if(command.action==='incident.correct'){
    const corrected=facts();
    requireThat(r.data.contacts.every(call=>Date.parse(call.contactedAt)>=Date.parse(corrected.occurredAt)),'The incident time must precede the recorded owner calls.');
    data={...data,...corrected,status:'open',review:null,resolution:'',versions:[...data.versions,{at,actorId:me.id,facts:incidentFacts(r.data),review:r.data.review,resolution:r.data.resolution,reason:note}]};
  }else if(command.action==='incident.contact'){
    const target=owner(input.ownerId),contactedAt=instant(input.contactedAt,'Call time');
    requireThat(Date.parse(contactedAt)>=Date.parse(r.data.occurredAt)&&Date.parse(contactedAt)<=Date.parse(at),'Call time must be between the incident and now.');
    requireThat(input.result==='spoke'||input.result==='no-answer','Record whether you spoke or there was no answer.');
    data={...data,contacts:[...data.contacts,{actorId:me.id,recordedAt:at,contactedAt,ownerId:target.id,ownerName:target.name,result:input.result,note}]};
  }else if(command.action==='incident.followup'){
    requireThat(has(me,'location.manage'),'A restaurant owner or administrator assigns follow-up.',403);
    requireThat(r.data.status!=='resolved','Reopen this report before assigning follow-up.');
    const target=owner(input.ownerId);
    data={...data,followUp:{ownerId:target.id,ownerName:target.name,due:instant(input.due,'Follow-up due'),nextStep:text(input.nextStep,'Next step',3000)}};
    data.history=[...r.data.history,history('followup',`${note} Assigned to ${target.name}; due ${data.followUp!.due}; next step: ${data.followUp!.nextStep}`)];
  }else if(command.action==='incident.review'){
    requireThat(has(me,'location.manage'),'A restaurant owner or administrator must review this report.',403);
    requireThat(r.data.status!=='resolved','Reopen this report before reviewing it.');
    data={...data,status:'reviewed',review:{actorId:me.id,at,note}};
  }else if(command.action==='incident.resolve'){
    requireThat(has(me,'location.manage'),'A restaurant owner or administrator must resolve this report.',403);
    requireThat(r.data.status==='reviewed'&&r.data.review,'Review the current facts before recording a resolution.');
    data={...data,status:'resolved',resolution:note};
  }else if(command.action==='incident.reopen'){
    requireThat(r.data.status!=='open','This report is already open.');
    data={...data,status:'open',review:null,resolution:''};
  }else requireThat(command.action==='incident.note','Unknown incident action.');
  save({...r,data});
}
