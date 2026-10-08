import type {Member,RecordOf,History} from './types';
import type {CommandContext} from './followthrough';
import {guestOwner,guestManager} from './guest-reviews';
import {calendarDate} from './schedule-policy';
import {localInstant,localDate} from './local-time';
import {requireThat,text} from './validation';
import {cateringMenuLines,type CateringMenuLine} from './catering-menu';

export type CateringFacts={title:string;start:string;end:string;venue:string;guests:number;menuRef:string;menuNotes:string;menuLines?:CateringMenuLine[];prepNotes:string;staffingNotes:string;managerId:string;managerName:string;audience:('FOH'|'BOH')[]};
type Publication={by:string;at:string;version:number;facts:CateringFacts};
type Statement={by:string;at:string;summary:string};
export type Catering=CateringFacts&{version:number;status:'draft'|'review'|'published'|'cancelled'|'completed';publication:Publication|null;notice:Statement|null;acknowledgments:{by:string;at:string;noticeKey:string}[];internal?:{sourceRef:string;bookingRef:string;outcomeSource:string;history:History;versions:{by:string;at:string;reason:string;facts:CateringFacts;sourceRef:string;bookingRef:string;version:number;status:Catering['status'];publication:Publication|null}[]}};
export const cateringOwner=guestOwner;
export const cateringManager=guestManager;
export function cateringParticipant(m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher';}
export function cateringEditor(r:RecordOf<'catering'>,m:Member){return r.locationId===m.locationId&&(cateringOwner(m)||cateringManager(m)&&r.data.managerId===m.id);}
export function cateringAudience(d:CateringFacts,m:Member){return cateringParticipant(m)&&d.audience.some(a=>a===m.area);}
export function cateringReader(r:RecordOf<'catering'>,m:Member){return cateringEditor(r,m)||r.locationId===m.locationId&&!!r.data.publication&&cateringAudience(r.data.publication.facts,m);}
export function cateringView(r:RecordOf<'catering'>,m:Member):RecordOf<'catering'>{
 if(cateringEditor(r,m))return r;
 const {internal,...data}=r.data;
 // Pending revisions must not expose new unreviewed event facts to staff.
 return {...r,ownerId:data.publication?.facts.managerId??r.ownerId,data:{...data,...(data.publication?cateringFacts(data.publication.facts):{}),acknowledgments:data.acknowledgments.filter(a=>a.by===m.id)}};
}
export function cateringPhase(d:Catering,now:string){if(d.status==='draft'||d.status==='review')return d.publication?'update-pending':d.status;if(d.status!=='published')return d.status;return now<d.start?'upcoming':now>=d.end?'ended':'in-progress';}
export function cateringNoticeKey(d:Catering){return d.publication?`${d.publication.version}:${d.version}:${d.status}`:'';}
export function cateringNeedsRead(r:RecordOf<'catering'>,m:Member){return !!r.data.publication&&cateringReader(r,m)&&!r.data.acknowledgments.some(a=>a.by===m.id&&a.noticeKey===cateringNoticeKey(r.data));}
export function cateringFacts(d:CateringFacts):CateringFacts{const {title,start,end,venue,guests,menuRef,menuNotes,prepNotes,staffingNotes,managerId,managerName,audience}=d;return {title,start,end,venue,guests,menuRef,menuNotes,menuLines:d.menuLines??[],prepNotes,staffingNotes,managerId,managerName,audience};}
export function cateringOnDate(d:Catering,date:string,zone:string){return localDate(d.start,zone)<=date&&localDate(new Date(Date.parse(d.end)-1).toISOString(),zone)>=date;}
export function applyCatering(c:CommandContext){
 const {w,me,input,command,at,member,find,create,save,history}=c;
 requireThat(cateringParticipant(me),'Catering is not available for this account.',403);
 requireThat(['catering.create','catering.revise','catering.submit','catering.return','catering.publish','catering.cancel','catering.complete','catering.acknowledge'].includes(command.action),'Unknown catering action.');
 const fields=(existing?:Catering)=>{
  requireThat(cateringManager(me),'Current manager access is required.',403);
  const manager=member(input.managerId);requireThat(manager.locationId===me.locationId&&cateringManager(manager),'Choose a current manager at this restaurant.');requireThat(cateringOwner(me)||manager.id===me.id,'Only an owner may assign another event manager.',403);
  const time=(side:'start'|'end')=>{const date=calendarDate(input[side+'Date'],side==='start'?'Start date':'End date'),clock=text(input[side+'Time'],'Local time',5);try{return localInstant(date,clock,w.location.timezone,String(input[side+'Occurrence']??''))}catch(error){requireThat(false,error instanceof Error?error.message:'Choose a valid local time.');}};
  const start=time('start'),end=time('end');requireThat(Date.parse(end)>Date.parse(start)&&Date.parse(end)-Date.parse(start)<=7*86400000,'An event must end after it starts and span no more than seven days.');
  const guests=input.guests;requireThat(typeof guests==='number'&&Number.isInteger(guests)&&guests>0&&guests<=10000,'Enter a whole guest count from 1 to 10,000.');
  requireThat(Array.isArray(input.audience)&&input.audience.length>0&&input.audience.length<=2&&input.audience.every(a=>a==='FOH'||a==='BOH')&&new Set(input.audience).size===input.audience.length,'Choose FOH, BOH or both for the event brief.');
  return {facts:{title:text(input.title,'Event title',200),start,end,venue:text(input.venue,'Service location or pickup point',500),guests,menuRef:text(input.menuRef,'Menu or order reference',1500),menuNotes:text(input.menuNotes,'Menu and service details',3000),menuLines:input.menuLines===undefined?existing?.menuLines??[]:cateringMenuLines(input.menuLines),prepNotes:text(input.prepNotes,'Preparation requirements',3000),staffingNotes:text(input.staffingNotes,'Staffing requirements',3000),managerId:manager.id,managerName:manager.name,audience:input.audience as CateringFacts['audience']},sourceRef:text(input.sourceRef,'Planning source',2000),bookingRef:text(input.bookingRef,'Booking reference',200)};
 };
 if(command.action==='catering.create'){
  requireThat(!command.recordId,'Revise the existing event instead.');const f=fields();create({kind:'catering',data:{...f.facts,version:1,status:'draft',publication:null,notice:null,acknowledgments:[],internal:{sourceRef:f.sourceRef,bookingRef:f.bookingRef,outcomeSource:'',history:[history('drafted','Internal event draft saved. No customer booking or payment was made.')],versions:[]}}},member(f.facts.managerId));return;
 }
 const r=find('catering'),d=r.data;
 if(command.action==='catering.acknowledge'){
  requireThat(cateringNeedsRead(r,me),'There is no unread published event notice for you.');requireThat(input.noticeKey===cateringNoticeKey(d),'This event changed. Read its latest notice first.',409);requireThat(input.read===true,'Confirm you read the event brief and any update or cancellation warning.');requireThat(d.acknowledgments.length<1000,'This event has reached its acknowledgment limit.');
  save({...r,data:{...d,acknowledgments:[...d.acknowledgments,{by:me.id,at,noticeKey:cateringNoticeKey(d)}]}});return;
 }
 requireThat(cateringEditor(r,me),'Only the assigned event manager or restaurant owner can update this event.',403);requireThat(d.internal,'Event planning history is unavailable.',409);requireThat(d.internal.history.length<150,'This event has reached its update limit. Preserve it for review.');
 const note=text(input.note,'Reason or review note',3000),internal={...d.internal,history:[...d.internal.history,history(command.action.slice(9),note)]};let data:Catering={...d,internal};
 if(command.action==='catering.revise'){
  requireThat(!['cancelled','completed'].includes(d.status),'Cancelled and completed events are fixed. Create a new event for further work.');const f=fields(d);
  data={...data,...f.facts,version:d.version+1,status:'draft',internal:{...internal,sourceRef:f.sourceRef,bookingRef:f.bookingRef,versions:[...internal.versions,{by:me.id,at,reason:note,facts:cateringFacts(d),sourceRef:internal.sourceRef,bookingRef:internal.bookingRef,version:d.version,status:d.status,publication:d.publication}]}};
 }else if(command.action==='catering.submit'){
  requireThat(d.status==='draft','Only a draft can be submitted.');requireThat(cateringManager(member(d.managerId)),'Assign a current event manager.');requireThat(input.checked===true,'Confirm the source, event times, menu, preparation and staffing notes were checked.');data.status='review';
 }else if(command.action==='catering.return'){
  requireThat(cateringOwner(me),'Only an owner returns an event brief.',403);requireThat(d.status==='review','Only a submitted brief can be returned.');data.status='draft';
 }else if(command.action==='catering.publish'){
  requireThat(cateringOwner(me),'Only an owner publishes an event brief.',403);requireThat(d.status==='review','Submit this exact brief for review first.');requireThat(Date.parse(d.end)>Date.parse(at),'This event has ended. Correct its dates before publication.');requireThat(cateringManager(member(d.managerId)),'Assign a current event manager.');requireThat(input.confirmed===true,'Confirm publication of this exact event brief. This does not place an order or confirm prep or staffing completion.');
  data={...data,status:'published',publication:{by:me.id,at,version:d.version,facts:cateringFacts(d)}};
 }else if(command.action==='catering.cancel'){
  requireThat(cateringOwner(me),'Only an owner cancels an internal event brief.',403);requireThat(!['cancelled','completed'].includes(d.status),'This event is already terminal.');requireThat(input.confirmed===true,'Confirm cancellation of the internal event brief. Customer and supplier arrangements are separate.');
  data={...data,status:'cancelled',notice:{by:me.id,at,summary:text(input.summary,'Staff cancellation notice',2000)}};
 }else{
  requireThat(d.status==='published','Complete only the current published event brief.');requireThat(Date.parse(at)>=Date.parse(d.end),'Record the completion outcome after the event ends.');requireThat(input.confirmed===true,'Confirm this reports the actual event outcome.');
  data={...data,status:'completed',notice:{by:me.id,at,summary:text(input.summary,'Event outcome for staff',2000)},internal:{...internal,outcomeSource:text(input.outcomeSource,'Completion evidence',2000)}};
 }
 const manager=w.members.find(m=>m.id===data.managerId);save({...r,ownerId:data.managerId,area:manager?.area??r.area,data});
}
