import { availabilityConflict, calendarDate, canChangePublished } from './schedule-policy';
import { localClock, localDate, localInstant, nextDate } from './local-time';
import { overlaps } from './validation';
import { canScheduleJob, manages, type Member, type RecordOf, type Workspace } from './types';

export type ShiftTimeInput={date:string;startTime:string;endTime:string;overnight:boolean;startFold:string;endFold:string};
export function shiftPeriod(input:ShiftTimeInput,zone:string,previous?:RecordOf<'shift'>) {
  calendarDate(input.date,'Shift date');
  const endDate=input.overnight?nextDate(input.date):input.date;
  const convert=(day:string,clock:string,fold:string,old?:string)=>old&&day===localDate(old,zone)&&clock===localClock(old,zone)&&!fold?old:localInstant(day,clock,zone,fold);
  const start=convert(input.date,input.startTime,input.startFold,previous?.data.start),end=convert(endDate,input.endTime,input.endFold,previous?.data.end);
  const duration=Date.parse(end)-Date.parse(start);
  if(duration<=0)throw Error('End time must follow start time. For an overnight shift, choose Ends the next day.');
  if(duration>86400000)throw Error('A shift can last no more than 24 hours.');
  return {start,end};
}
export const schedulingJobs=(m:Member)=>[...new Set([...m.scheduleJobs??[],...m.qualifications])].filter(s=>s.trim()).sort((a,b)=>a.localeCompare(b));

// These are saved-data checks, not a guarantee of availability or proficiency.
// The authenticated save still rechecks the current schedule and permissions.
export function shiftCandidateChecks(w:Workspace,m:Member,period:{start:string;end:string},position='',previous?:RecordOf<'shift'>) {
  const blocking:string[]=[],notices:string[]=[];
  if(m.locationId!==w.location.id||!w.members.some(p=>p.id===m.id))blocking.push('Employee is no longer in this restaurant.');
  if(previous?.data.published?!canChangePublished(w,w.me,m.area,period):!manages(w.me,m.area,'schedule.manage'))blocking.push('This shift is outside your scheduling access.');
  if(position&&!canScheduleJob(m,position))blocking.push('This job is not on the employee’s scheduling list.');
  const records=w.records.filter(r=>r.locationId===w.location.id&&r.ownerId===m.id);
  if(records.some(r=>r.kind==='shift'&&r.id!==previous?.id&&!r.data.cancelled&&overlaps(r.data,period)))blocking.push('Overlapping shift');
  if(records.some(r=>r.kind==='request'&&r.data.type==='time-off'&&r.data.status==='approved'&&overlaps(r.data,period)))blocking.push('Approved time off');
  if(availabilityConflict({...w,records},m.id,period))blocking.push('Approved availability conflict');
  if(records.some(r=>r.kind==='request'&&r.data.type==='time-off'&&r.data.status==='pending'&&overlaps(r.data,period)))notices.push('Pending time-off request overlaps');
  if(records.some(r=>r.kind==='availability'&&r.data.status==='pending'&&r.data.startDate<=localDate(period.end,w.location.timezone)&&r.data.endDate>=localDate(period.start,w.location.timezone)))notices.push('Availability changes are awaiting review');
  return {blocking,notices};
}
