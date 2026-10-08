import {has,type Member,type RecordOf,type History} from './types';
import {operationsManager} from './operations';
import type {CommandContext} from './followthrough';
import {requireThat,text,instant} from './validation';
import {localInstant} from './local-time';

export const contactCategories=['Equipment repair','Plumbing','Electrical','HVAC / refrigeration','Internet / utilities','Cleaning / pest control','Other'] as const;
export type ContactFacts={title:string;category:typeof contactCategories[number];contactName:string;phone:string;afterHoursPhone:string;hours:string;instructions:string;sourceRef:string};
export type ServiceContact=ContactFacts&{status:'active'|'retired';verifiedBy:string;verifiedAt:string;retirementNote:string;internal?:{history:History;versions:{facts:ContactFacts;verifiedBy:string;verifiedAt:string;at:string;by:string;reason:string}[]}};
export type ContactAttempt={by:string;recordedAt:string;occurredAt:string;result:'no-answer'|'left-message'|'spoke';note:string;contact:{id:string;revision:number;title:string;contactName:string;phone:string;route:'regular'|'after-hours';verifiedBy:string;verifiedAt:string}};
export function contactOwner(m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher'&&has(m,'location.manage');}
export function contactManager(m:Member){return !m.scheduleOnly&&operationsManager(m);}
export function contactReader(r:RecordOf<'servicecontact'>,m:Member){return r.locationId===m.locationId&&contactManager(m)&&(r.data.status==='active'||contactOwner(m));}
export function contactView(r:RecordOf<'servicecontact'>,m:Member):RecordOf<'servicecontact'>{if(contactOwner(m))return r;const {internal,...data}=r.data;return {...r,data};}
export function phoneLink(value:string){const v=value.trim();if(!/^\+?[\d ()\-.]+$/.test(v))return null;const digits=v.replace(/\D/g,'');return digits.length>=7&&digits.length<=15?'tel:'+(v.startsWith('+')?'+':'')+digits:null;}
export function contactInstant(date:string,clock:string,zone:string,repeated=''){requireThat(/^\d{2}:\d{2}(:[0-5]\d)?$/.test(clock),'Choose a valid call time.');return new Date(Date.parse(localInstant(date,clock.slice(0,5),zone,repeated))+Number(clock.slice(6)||0)*1000).toISOString();}
function phone(value:unknown,label:string,optional=false){const v=text(value??'',label,60,optional);requireThat(optional&&!v||!!phoneLink(v),label+' must contain 7–15 digits with an optional leading +. Put extensions in calling instructions.');return v;}
function facts(d:ContactFacts):ContactFacts{const {title,category,contactName,phone,afterHoursPhone,hours,instructions,sourceRef}=d;return {title,category,contactName,phone,afterHoursPhone,hours,instructions,sourceRef};}
export function applyServiceContact(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history}=c;
 if(command.action==='managerlog.contact'){
  const issue=find('managerlog');requireThat(!me.scheduleOnly&&operationsManager(me,issue.area),'Manager access is required for this department.',403);
  requireThat(issue.data.category==='Maintenance'&&issue.data.status!=='resolved','Choose an open repair request.');
  const contact=w.records.find((r):r is RecordOf<'servicecontact'>=>r.id===input.contactId&&r.kind==='servicecontact'&&contactReader(r,me)&&r.data.status==='active');
  requireThat(contact,'Choose a current contact for this restaurant.');requireThat(input.contactRevision===contact.revision,'This contact changed. Reopen the directory and check its current details.',409);
  requireThat(input.route==='regular'||input.route==='after-hours','Choose the number actually called.');const number=input.route==='regular'?contact.data.phone:contact.data.afterHoursPhone;requireThat(!!phoneLink(number),'That calling number is unavailable.');
  const occurredAt=instant(input.occurredAt,'Contact time'),openedAt=issue.data.history.find(h=>h.action==='created'||h.action==='opened')?.at;requireThat(occurredAt<=at&&(!openedAt||occurredAt>=openedAt),'Contact time must be after this repair was recorded and cannot be in the future.');
  requireThat(['no-answer','left-message','spoke'].includes(String(input.result)),'Choose what actually happened.');requireThat(input.confirmed===true,'Confirm that this is your report of an actual call attempt.');
  const note=text(input.note,'Call outcome and next step',3000),attempts=issue.data.contactAttempts??[];requireThat(attempts.length<200,'This repair has reached its call history limit. Preserve it for review.');
  const attempt:ContactAttempt={by:me.id,recordedAt:at,occurredAt,result:input.result as ContactAttempt['result'],note,contact:{id:contact.id,revision:contact.revision,title:contact.data.title,contactName:contact.data.contactName,phone:number,route:input.route,verifiedBy:contact.data.verifiedBy,verifiedAt:contact.data.verifiedAt}};
  save({...issue,data:{...issue.data,contactAttempts:[...attempts,attempt],history:[...issue.data.history,history('call-reported',`Reported ${attempt.result} with ${contact.data.title}. ${note}`)]}});return;
 }
 requireThat(contactOwner(me),'A restaurant owner or administrator maintains service contacts.',403);
 requireThat(['servicecontact.create','servicecontact.revise','servicecontact.retire'].includes(command.action),'Unknown contact action.');
 const r=command.action==='servicecontact.create'?null:find('servicecontact');
 if(r)requireThat(r.data.internal&&r.data.internal.history.length<200,'This contact reached its update limit. Retire it and preserve its history.');
 const note=text(input.note,'Source check or reason',2000);
 if(command.action==='servicecontact.retire'){
  requireThat(r&&r.data.status==='active','Choose an active contact.');save({...r,data:{...r.data,status:'retired',retirementNote:note,internal:{...r.data.internal!,history:[...r.data.internal!.history,history('retired',note)]}}});return;
 }
 requireThat(input.checked===true,'Confirm that you checked this restaurant’s contact details against the stated source.');
 requireThat(contactCategories.some(v=>v===input.category),'Choose a service category.');
 const d:ContactFacts={title:text(input.title,'Business or service',200),category:input.category as ContactFacts['category'],contactName:text(input.contactName??'','Contact name',200,true),phone:phone(input.phone,'Regular phone'),afterHoursPhone:phone(input.afterHoursPhone,'After-hours phone',true),hours:text(input.hours,'Availability and after-hours coverage',1000),instructions:text(input.instructions??'','Calling instructions',2000,true),sourceRef:text(input.sourceRef,'Checked source reference',2000)};
 requireThat(!w.records.some(other=>other.kind==='servicecontact'&&other.id!==r?.id&&other.locationId===me.locationId&&other.data.status==='active'&&other.data.title.toLowerCase()===d.title.toLowerCase()&&phoneLink(other.data.phone)===phoneLink(d.phone)),'This active contact already exists. Open it to update the details.',409);
 const data:ServiceContact={...d,status:'active',retirementNote:'',verifiedBy:me.id,verifiedAt:at,internal:{history:[...(r?.data.internal?.history??[]),history(r?'reverified':'created',note)],versions:[...(r?.data.internal?.versions??[]),...(r?[{facts:facts(r.data),verifiedBy:r.data.verifiedBy,verifiedAt:r.data.verifiedAt,at,by:me.id,reason:note}]:[])]}};
 if(r)save({...r,data});else {requireThat(!command.recordId,'Open the existing contact to update it.');create({kind:'servicecontact',data});}
}
