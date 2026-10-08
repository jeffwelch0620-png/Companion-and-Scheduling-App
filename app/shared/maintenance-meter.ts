import type {CommandContext} from './followthrough';
import type {RecordOf} from './types';
import {maintenanceFacts,type Maintenance,type MaintenanceFacts} from './maintenance';
import {contactOwner} from './service-contacts';
import {equipmentLinkState} from './equipment';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export type MeterRule={meterRef:string;initialDueHours:number;intervalHours:number;warningHours:number};
export type MeterReading={id:string;date:string;hours:number;evidence:string;note:string;by:string;at:string;plan:MaintenanceFacts;voided:null|{by:string;at:string;reason:string}};
export const maxMeterHours=1_000_000_000;
export function checkedHours(value:unknown,label:string,positive=false){requireThat(typeof value==='number'&&Number.isFinite(value)&&value>=(positive?Number.MIN_VALUE:0)&&value<=maxMeterHours,`Enter ${label} as ${positive?'a positive':'a nonnegative'} number of hours, at most ${maxMeterHours}.`);return value as number;}
export function meterRule(input:Record<string,unknown>):MeterRule|undefined{
 if(input.meterEnabled!==true)return undefined;
 const initialDueHours=checkedHours(input.initialDueHours,'the first due meter reading',true),intervalHours=checkedHours(input.intervalHours,'the service interval',true),warningHours=checkedHours(input.warningHours,'the warning window');
 requireThat(warningHours<=intervalHours,'The hour warning window cannot exceed the service interval.');
 requireThat(initialDueHours+intervalHours<=maxMeterHours&&initialDueHours+intervalHours>initialDueHours,'The checked hour threshold and interval exceed the supported meter range or precision.');
 return {meterRef:text(input.meterRef,'Meter identity and source reference',500),initialDueHours,intervalHours,warningHours};
}
export function meterSchedule(d:Maintenance){
 if(!d.meter)return null;
 const reading=(d.meterReadings??[]).filter(x=>!x.voided).at(-1)??null;
 const service=d.services.filter(s=>!s.voided&&s.meter).sort((a,b)=>b.date.localeCompare(a.date))[0]??null;
 const dueHours=service?.meter?service.meter.hours+d.meter.intervalHours:d.meter.initialDueHours;
 const remaining=reading?dueHours-reading.hours:null,tolerance=Number.EPSILON*Math.max(dueHours,reading?.hours??0)*8;
 const state=remaining===null?'needs-reading':remaining < -tolerance?'overdue':remaining<=tolerance?'due':remaining<=d.meter.warningHours+tolerance?'soon':'upcoming';
 return {reading,service,dueHours,remaining,state};
}
export function meterTiming(rule:MeterRule){return `Meter ${rule.meterRef}: first due at ${rule.initialDueHours} hours, then ${rule.intervalHours} hours after recorded completed service; warning ${rule.warningHours} hours before due.`;}

export function applyMaintenanceMeter(c:CommandContext,r:RecordOf<'maintenance'>,note:string){
 const {w,me,input,command,at,save,history}=c,owner=contactOwner(me),readings=r.data.meterReadings??[];
 requireThat(r.data.meter,'This plan has no checked meter-hour rule.');
 if(command.action==='maintenance.meter-void'){
  requireThat(owner,'An owner or administrator corrects meter evidence.',403);
  const entry=readings.find(x=>x.id===input.readingId);requireThat(entry&&!entry.voided,'Choose an unvoided meter reading.');
  requireThat(!r.data.services.some(s=>!s.voided&&s.meter?.id===entry.id),'This reading supports completed service. Void the incorrect service evidence first.',409);
  requireThat(input.confirmed===true,'Confirm this meter correction. Original evidence stays in history.');
  save({...r,data:{...r.data,meterReadings:readings.map(x=>x===entry?{...x,voided:{by:me.id,at,reason:note}}:x),history:[...r.data.history,history('meter-voided',note)]}});return;
 }
 requireThat(r.data.status==='active','Choose an active maintenance plan.');
 requireThat(owner||me.id===r.data.managerId,'Only the assigned manager or an owner records this meter.',403);
 requireThat(r.data.asset&&equipmentLinkState(w,r.data.asset)==='current','An owner must recheck the plan against current active equipment before recording the meter.',409);
 requireThat(readings.length<100,'This plan reached its meter history limit. Retire it and retain the evidence.');
 requireThat(!readings.some(x=>x.id===command.requestId),'This meter reference already belongs to another observation. Use a new request.',409);
 const date=calendarDate(input.date,'Actual meter reading date');requireThat(date<=localDate(at,w.location.timezone),'Actual meter readings cannot be in the future.');
 const hours=checkedHours(input.hours,'the actual meter reading');requireThat(hours+r.data.meter.intervalHours<=maxMeterHours&&hours+r.data.meter.intervalHours>hours,'This reading exceeds the supported service threshold range or precision.');
 const previous=readings.filter(x=>!x.voided).at(-1);
 requireThat(!previous||date>=previous.date&&hours>=previous.hours,'Record readings in date order without decreasing the meter. Correct mistaken evidence first; a reset or replacement requires a separately checked plan.',409);
 requireThat(!previous||date!==previous.date||hours!==previous.hours,'This dated meter reading is already recorded.',409);
 requireThat(input.checked===true,'Confirm this is the actual reading from the identified equipment meter.');
 const reading:MeterReading={id:command.requestId,date,hours,evidence:text(input.evidence,'Meter reading evidence',2000),note,by:me.id,at,plan:maintenanceFacts(r.data),voided:null};
 save({...r,data:{...r.data,meterReadings:[...readings,reading],history:[...r.data.history,history('meter-recorded',note)]}});
}
