import {applyMaintenanceCost,type ServiceCost} from './maintenance-cost';
import {type Member,type RecordOf,type History} from './types';
import type {CommandContext} from './followthrough';
import {contactOwner,contactManager,contactReader} from './service-contacts';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {applyMaintenanceMeter,meterRule,meterSchedule,type MeterRule,type MeterReading} from './maintenance-meter';
import {maintenanceDue,maintenanceOccurrence,type CalendarRecurrence} from './maintenance-calendar';
import {requireThat,text} from './validation';
import {equipmentSnapshot,equipmentLinkState,type EquipmentSnapshot} from './equipment';

export type MaintenanceFacts={meterOnly?:true;meter?:MeterRule;asset?:EquipmentSnapshot;title:string;equipment:string;task:string;sourceRef:string;initialDue:string;intervalDays:number;recurrence?:CalendarRecurrence;warningDays:number;managerId:string;managerName:string};
export type MaintenanceService={costHistory?:ServiceCost[];meter?:MeterReading;id:string;date:string;scheduledDue?:string;performedBy:string;evidence:string;note:string;by:string;at:string;plan:MaintenanceFacts;contact:null|{id:string;revision:number;title:string;contactName:string};voided:null|{by:string;at:string;reason:string}};
export type Maintenance=MaintenanceFacts&{meterReadings?:MeterReading[];status:'active'|'retired';checkedBy:string;checkedAt:string;retirementNote:string;services:MaintenanceService[];history:History;versions:{facts:MaintenanceFacts;by:string;at:string;reason:string}[]};
export const maintenanceOwner=contactOwner,maintenanceManager=contactManager;
export function maintenanceReader(r:RecordOf<'maintenance'>,m:Member){return r.locationId===m.locationId&&maintenanceManager(m)&&(r.data.status==='active'||maintenanceOwner(m));}
export function maintenanceFacts(d:MaintenanceFacts):MaintenanceFacts{const {title,equipment,task,sourceRef,initialDue,intervalDays,recurrence,warningDays,managerId,managerName,asset,meter,meterOnly}=d;return {...(meterOnly?{meterOnly:true}:{}),...(meter?{meter:{...meter}}:{}),...(asset?{asset:{...asset,facts:{...asset.facts}}}:{}),title,equipment,task,sourceRef,initialDue,intervalDays,...(recurrence?{recurrence:{...recurrence}}:{}),warningDays,managerId,managerName};}
export function maintenanceSchedule(d:Maintenance,today:string){
 const latest=d.services.filter(s=>!s.voided).sort((a,b)=>b.date.localeCompare(a.date))[0]??null;
 const due=maintenanceDue(d,d.services);
 const days=d.meterOnly?null:Math.round((Date.parse(due+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000);
 const calendarState=days===null?null:days<0?'overdue':days===0?'today':days<=d.warningDays?'soon':'upcoming',meter=meterSchedule(d);
 const rank:Record<string,number>={overdue:5,due:4,today:4,soon:3,'needs-reading':2,upcoming:1};
 const state=d.status==='retired'?'retired':calendarState===null?(meter?.state??'needs-reading'):meter&&rank[meter.state]>rank[calendarState]?meter.state:calendarState;
 return {latest,due,days,state,calendarState,meter};
}
export function applyMaintenance(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history,member}=c;
 requireThat(maintenanceManager(me),'Restaurant manager access is required.',403);
 requireThat(['maintenance.create','maintenance.revise','maintenance.retire','maintenance.service','maintenance.void','maintenance.meter','maintenance.meter-void','maintenance.cost','maintenance.cost-withdraw'].includes(command.action),'Unknown maintenance action.');
 const r=command.action==='maintenance.create'?null:find('maintenance'),note=text(input.note,'Evidence or reason',2000);
 const owner=maintenanceOwner(me),today=localDate(at,w.location.timezone);
 if(command.action==='maintenance.cost'||command.action==='maintenance.cost-withdraw'){requireThat(r,'Choose a maintenance plan.');applyMaintenanceCost(c,r,note);return;}
 if(command.action==='maintenance.meter'||command.action==='maintenance.meter-void'){requireThat(r,'Choose a maintenance plan.');applyMaintenanceMeter(c,r,note);return;}
 if(command.action==='maintenance.service'){
  requireThat(r&&r.data.status==='active','Choose an active maintenance plan.');
  requireThat(!r.data.asset||equipmentLinkState(w,r.data.asset)==='current','The linked equipment changed or is unavailable. An owner must recheck the plan against current active equipment before recording service.',409);
  requireThat(owner||me.id===r.data.managerId,'Only the assigned manager or an owner records this service.',403);
  requireThat(r.data.services.length<100,'This plan has reached its service history limit. An owner can retire it and retain the history.');
  requireThat(!r.data.services.some(s=>s.id===command.requestId),'This service reference already belongs to another entry. Use a new request.',409);
  const date=calendarDate(input.date,'Actual service date');requireThat(date<=today,'Actual service cannot be in the future.');
  const scheduledDue=r.data.recurrence?calendarDate(input.scheduledDue,'Scheduled occurrence'):undefined;
  if(scheduledDue)requireThat(scheduledDue===maintenanceSchedule(r.data,today).due,'This is not the first outstanding scheduled occurrence. Refresh before recording service.',409);
  else requireThat(!input.scheduledDue,'This plan does not use fixed calendar occurrences.');
  requireThat(!r.data.services.some(s=>!s.voided&&s.date===date),'Service is already recorded for this date. An owner can void an incorrect entry before replacing it.',409);
  requireThat(input.completed===true,'Confirm that the entire stated task was completed. Partial work belongs in a repair request.');
  const performedBy=text(input.performedBy,'Who performed the work',200),evidence=text(input.evidence,'Service evidence reference',2000);
  let contact:MaintenanceService['contact']=null;
  if(input.contactId){const found=w.records.find((x):x is RecordOf<'servicecontact'>=>x.kind==='servicecontact'&&x.id===input.contactId&&contactReader(x,me)&&x.data.status==='active');requireThat(found,'Choose a current checked contact for this restaurant.');requireThat(input.contactRevision===found.revision,'This service contact changed. Check its current details.',409);contact={id:found.id,revision:found.revision,title:found.data.title,contactName:found.data.contactName};}
  const meter=r.data.meter?(r.data.meterReadings??[]).find(x=>x.id===input.meterReadingId&&!x.voided):undefined;
  requireThat(!r.data.meter||meter&&meter.date===date,'Choose an actual unvoided meter reading from the service date.');
  requireThat(!!r.data.meter||!input.meterReadingId,'This plan does not use a meter reading.');
  const service:MaintenanceService={...(meter?{meter:{...meter,plan:maintenanceFacts(meter.plan)}}:{}),id:command.requestId,date,...(scheduledDue?{scheduledDue}:{}),performedBy,evidence,note,by:me.id,at,plan:maintenanceFacts(r.data),contact,voided:null};
  save({...r,data:{...r.data,services:[...r.data.services,service],history:[...r.data.history,history('service-recorded',note)]}});return;
 }
 requireThat(owner,'An owner or administrator maintains schedules and corrections.',403);
 if(command.action==='maintenance.void'){
  requireThat(r,'Choose a maintenance plan.');const entry=r.data.services.find(s=>s.id===input.serviceId);requireThat(entry&&!entry.voided,'Choose a service entry that has not been voided.');
  requireThat(input.confirmed===true,'Confirm this evidence correction. Service timing will be recalculated from the remaining entries.');
  save({...r,data:{...r.data,services:r.data.services.map(s=>s===entry?{...s,voided:{by:me.id,at,reason:note}}:s),history:[...r.data.history,history('service-voided',note)]}});return;
 }
 if(command.action==='maintenance.retire'){
  requireThat(r&&r.data.status==='active','Choose an active maintenance plan.');save({...r,data:{...r.data,status:'retired',retirementNote:note,history:[...r.data.history,history('retired',note)]}});return;
 }
 requireThat(!r||r.data.versions.length<100,'This plan reached its source revision limit. Retire it and preserve its history.');
 requireThat(input.checked===true,'Confirm the equipment, task and timing were checked against the stated source.');
 const mode=input.recurrenceKind??'after-service',meterOnly=mode==='meter-only',warningDays=meterOnly?0:input.warningDays;
 if(meterOnly)requireThat(!input.initialDue&&!input.intervalDays&&!input.warningDays&&!input.calendarEvery&&input.calendarWeekday==null&&input.calendarOrdinal==null,'A meter-only plan cannot also contain a calendar date or interval.');
 requireThat(['after-service','calendar-days','calendar-months','calendar-month-end','calendar-month-weekday','meter-only'].includes(String(mode)),'Choose a supported recurrence rule.');
 let recurrence:CalendarRecurrence|undefined;
 const intervalDays=mode==='after-service'?input.intervalDays:0;
 if(mode==='after-service')requireThat(Number.isInteger(intervalDays)&&Number(intervalDays)>=1&&Number(intervalDays)<=3650,'Enter an explicit source interval of 1–3650 days.');
 else if(!meterOnly){
  const every=input.calendarEvery,monthly=mode!=='calendar-days',max=monthly?120:3650;
  requireThat(Number.isInteger(every)&&Number(every)>=1&&Number(every)<=max,`Enter a checked calendar interval of 1–${max} ${monthly?'months':'days'}.`);
  if(mode==='calendar-month-weekday'){
   requireThat(Number.isInteger(input.calendarWeekday)&&Number(input.calendarWeekday)>=0&&Number(input.calendarWeekday)<=6,'Choose a weekday from the checked source.');
   requireThat([-1,1,2,3,4].includes(input.calendarOrdinal as number),'Choose first, second, third, fourth or last from the checked source.');
   recurrence={kind:'calendar-month-weekday',every:Number(every),weekday:Number(input.calendarWeekday),ordinal:input.calendarOrdinal as 1|2|3|4|-1};
  }else recurrence={kind:mode as 'calendar-days'|'calendar-months'|'calendar-month-end',every:Number(every)};
 }
 requireThat(Number.isInteger(warningDays)&&Number(warningDays)>=0&&Number(warningDays)<=365,'Choose a warning window of 0–365 days.');
 const manager=member(input.managerId);requireThat(manager.locationId===me.locationId&&maintenanceManager(manager),'Choose a current restaurant manager.');
 let asset:EquipmentSnapshot|undefined;
 if(input.assetId){const found=w.records.find((x):x is RecordOf<'equipment'>=>x.kind==='equipment'&&x.id===input.assetId&&x.locationId===me.locationId&&x.data.status==='active');requireThat(found,'Choose active checked equipment in this restaurant.');requireThat(found.revision===input.assetRevision,'This equipment changed. Refresh and check its current details.',409);asset=equipmentSnapshot(found);}
 const meter=meterRule(input);requireThat(!meterOnly||meter,'Meter-only timing requires a checked meter-hour rule.');requireThat(!meter||asset,'Link current checked equipment before enabling a meter-hour rule.');
 if(r&&(r.data.services.length||(r.data.meterReadings?.length??0)))requireThat(!!r.data.meterOnly===meterOnly,'Keep the calendar and meter timing mode attached to its evidence. Retire this plan and create a separate checked plan.');
 if(r&&(r.data.services.length||(r.data.meterReadings?.length??0)))requireThat(JSON.stringify(r.data.meter)===JSON.stringify(meter),'Keep the meter rule attached to its evidence. Retire this plan and create a separate checked plan for a different rule.');
 if(r&&(r.data.services.length||(r.data.meterReadings?.length??0)))requireThat(r.data.asset?.id===asset?.id,'Keep the equipment link attached to its service evidence. Use a separate plan for a different asset.');
 const facts:MaintenanceFacts={...(meterOnly?{meterOnly:true}:{}),...(meter?{meter}:{}),...(asset?{asset}:{}),title:text(input.title,'Plan title',200),equipment:text(input.equipment,'Equipment or asset reference',300),task:text(input.task,'Source task and completion requirements',3000),sourceRef:text(input.sourceRef,'Checked source reference',2000),initialDue:meterOnly?'':calendarDate(input.initialDue,'Initial due date'),intervalDays:Number(intervalDays),...(recurrence?{recurrence}:{}),warningDays:Number(warningDays),managerId:manager.id,managerName:manager.name};
 if(recurrence){
  requireThat(maintenanceOccurrence(facts,0)===facts.initialDue,'The first due date must match the checked monthly rule. Choose the actual first occurrence.');
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(maintenanceOccurrence(facts,100)),'Choose a calendar schedule whose service history stays within year 9999.');
 }
 if(r?.data.services.length&&(r.data.recurrence||recurrence))requireThat(JSON.stringify(r.data.recurrence)===JSON.stringify(recurrence)&&r.data.initialDue===facts.initialDue,'Keep the calendar rule and anchor attached to their service evidence. Retire this plan and create a separate plan for a different rule.');
 requireThat(!r||!(r.data.services.length||(r.data.meterReadings?.length??0))||facts.equipment===r.data.equipment&&facts.task===r.data.task,'Keep the equipment and task attached to their service evidence. Retire this plan and create a separate plan for different equipment or work.');
 requireThat(!w.records.some(x=>x.kind==='maintenance'&&x.id!==r?.id&&x.locationId===me.locationId&&x.data.status==='active'&&x.data.equipment.toLowerCase()===facts.equipment.toLowerCase()&&x.data.title.toLowerCase()===facts.title.toLowerCase()),'An active plan already has this title and equipment. Update the existing plan.',409);
 const data:Maintenance={...facts,...(r?.data.meterReadings?{meterReadings:r.data.meterReadings}:{}),status:'active',checkedBy:me.id,checkedAt:at,retirementNote:'',services:r?.data.services??[],history:[...(r?.data.history??[]),history(r?'source-rechecked':'created',note)],versions:[...(r?.data.versions??[]),...(r?[{facts:maintenanceFacts(r.data),by:me.id,at,reason:note}]:[])]};
 if(r)save({...r,data});else{requireThat(!command.recordId,'Open the existing plan to revise it.');create({kind:'maintenance',data});}
}
