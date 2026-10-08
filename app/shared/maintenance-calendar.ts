import {nextDate} from './local-time';

export type CalendarRecurrence={kind:'calendar-days'|'calendar-months'|'calendar-month-end';every:number}|{kind:'calendar-month-weekday';every:number;weekday:number;ordinal:1|2|3|4|-1};
export const maintenanceWeekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] as const;
export const maintenanceOrdinals=[{value:1,label:'First'},{value:2,label:'Second'},{value:3,label:'Third'},{value:4,label:'Fourth'},{value:-1,label:'Last'}] as const;
type Plan={meterOnly?:true;initialDue:string;intervalDays:number;recurrence?:CalendarRecurrence};

// Always calculate from the original anchor. February cannot turn a January
// 31 monthly plan into a permanent day-28 plan, and late work cannot move it.
export function maintenanceOccurrence(plan:Plan,index:number){
 if(!plan.recurrence)return plan.initialDue;
 if(plan.recurrence.kind==='calendar-days'){
  const date=new Date(Date.parse(plan.initialDue+'T12:00:00Z')+index*plan.recurrence.every*86400000);
  return date.toISOString().split('T')[0];
 }
 const date=new Date(plan.initialDue+'T12:00:00Z'),day=date.getUTCDate();
 date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+index*plan.recurrence.every);
 const end=new Date(date);end.setUTCMonth(end.getUTCMonth()+1,0);
 if(plan.recurrence.kind==='calendar-month-end')date.setUTCDate(end.getUTCDate());
 else if(plan.recurrence.kind==='calendar-month-weekday'){
  const {weekday,ordinal}=plan.recurrence;
  const target=ordinal===-1?end.getUTCDate()-(end.getUTCDay()-weekday+7)%7:1+(weekday-date.getUTCDay()+7)%7+(ordinal-1)*7;
  date.setUTCDate(target);
 }else date.setUTCDate(Math.min(day,end.getUTCDate()));
 return date.toISOString().split('T')[0];
}
export function maintenanceDue(plan:Plan,services:{date:string;scheduledDue?:string;voided:unknown}[]){
 if(plan.meterOnly)return '';
 const active=services.filter(s=>!s.voided);
 if(!plan.recurrence){const latest=active.map(s=>s.date).sort().at(-1);return latest?nextDate(latest,plan.intervalDays):plan.initialDue;}
 const covered=new Set(active.map(s=>s.scheduledDue));
 // At most one occurrence per retained service. Stop at the first uncovered
 // occurrence; time passing or later evidence must never hide missed work.
 for(let index=0;index<=active.length;index++){const due=maintenanceOccurrence(plan,index);if(!covered.has(due))return due;}
 return plan.initialDue;
}
export function maintenanceTiming(plan:Plan){
 if(plan.meterOnly)return 'Meter hours only; no calendar due date';
 if(!plan.recurrence)return `${plan.intervalDays} days after the latest recorded service`;
 const {kind,every}=plan.recurrence;
 if(kind==='calendar-days')return `Every ${every} calendar ${every===1?'day':'days'} from ${plan.initialDue}`;
 const cadence=`every ${every} calendar ${every===1?'month':'months'} from ${plan.initialDue}`;
 if(kind==='calendar-month-end')return `Last day of the month; ${cadence}`;
 if(plan.recurrence.kind==='calendar-month-weekday'){const {ordinal,weekday}=plan.recurrence;return `${maintenanceOrdinals.find(o=>o.value===ordinal)?.label} ${maintenanceWeekdays[weekday]} of the month; ${cadence}`;}
 return `Every ${every} calendar ${every===1?'month':'months'} from ${plan.initialDue}; shorter months use their last day`;
}
