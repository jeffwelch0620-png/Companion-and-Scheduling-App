import { canScheduleJob, manages, type Workspace, type RecordOf } from './types';
import { stationAssignmentIssue } from './station-assignment';
import { calendarDate, availabilityConflict } from './schedule-policy';
import { localClock, localDate, localInstant, nextDate } from './local-time';
import { closingForShift } from './publication';
import { requireThat, overlaps, range } from './validation';

export type CopyOptions={sourceWeek:string;targetWeek:string;shiftIds:string[];staffingIds:string[];repeated:string};
export function copySources(w:Workspace,sourceWeek:string){
  calendarDate(sourceWeek,'Source week');const end=nextDate(sourceWeek,7),zone=w.location.timezone;
  const inWeek=(r:RecordOf<'shift'>|RecordOf<'staffing'>)=>w.me.position!=='Dishwasher'&&r.locationId===w.location.id&&manages(w.me,r.area,'schedule.manage')&&localDate(r.data.start,zone)>=sourceWeek&&localDate(r.data.start,zone)<end;
  return {shifts:w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&!r.data.cancelled&&inWeek(r)).sort((a,b)=>a.data.start.localeCompare(b.data.start)||a.id.localeCompare(b.id)),staffing:w.records.filter((r):r is RecordOf<'staffing'>=>r.kind==='staffing'&&r.data.status==='approved'&&inWeek(r)).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function moveWeekTime(value:string,days:number,zone:string,repeated=''){
  try{return localInstant(nextDate(localDate(value,zone),days),localClock(value,zone),zone,repeated)}catch(error){requireThat(false,error instanceof Error?error.message:'Choose valid destination times.')}
}

// The proposal contains new dates and definitions only. Prior completion evidence,
// publication, notices, leadership authority and availability never get copied.
export function weekCopyPlan(w:Workspace,o:CopyOptions){
  calendarDate(o.sourceWeek,'Source week');calendarDate(o.targetWeek,'Destination week');
  const days=(Date.parse(o.targetWeek)-Date.parse(o.sourceWeek))/86400000,zone=w.location.timezone;
  requireThat(Number.isInteger(days)&&days>=7&&days<=364&&days%7===0,'Choose a later week on the same weekday, within 52 weeks.');
  requireThat(['','earlier','later'].includes(o.repeated),'Choose a valid repeated-hour option.');
  requireThat(o.shiftIds.length>0&&o.shiftIds.length<=100&&new Set(o.shiftIds).size===o.shiftIds.length,'Select 1–100 different shifts.');
  requireThat(o.staffingIds.length<=100&&new Set(o.staffingIds).size===o.staffingIds.length,'Select up to 100 different staffing needs.');
  const available=copySources(w,o.sourceWeek),move=(t:string)=>moveWeekTime(t,days,zone,o.repeated);
  const shifts=o.shiftIds.map(id=>{
    const source=available.shifts.find(r=>r.id===id);requireThat(source,'A source shift is unavailable for your department.',403);
    const employee=w.members.find(m=>m.id===source.ownerId&&m.area===source.area);
    requireThat(employee&&canScheduleJob(employee,source.data.position),'A selected employee is inactive or no longer cleared for the station.');
    const stationIssue=stationAssignmentIssue(w,employee,source.data.position,source.data.stationId);requireThat(!stationIssue,stationIssue);
    requireThat(!w.records.some(r=>r.kind==='shift'&&!r.data.cancelled&&r.data.copiedFrom?.id===id&&r.data.copiedFrom.targetWeek===o.targetWeek),'A selected shift has already been copied into that week. Open its existing draft.');
    const period=range({start:move(source.data.start),end:move(source.data.end)},24);
    requireThat(!w.records.some(r=>r.kind==='shift'&&!r.data.cancelled&&r.ownerId===source.ownerId&&overlaps(r.data,period)),`${employee.name} already has a shift during the proposed time.`);
    requireThat(!availabilityConflict(w,employee.id,period)&&!w.records.some(r=>r.kind==='request'&&r.ownerId===employee.id&&r.data.type==='time-off'&&r.data.status==='approved'&&overlaps(r.data,period)),`${employee.name} is unavailable during the proposed time. Adjust the destination schedule or select different shifts.`);
    const closes=closingForShift(w,id).map(c=>{
      requireThat(manages(w.me,c.area,'tasks.manage'),'Copying closing responsibilities requires task-management authority for this department.',403);
      const standard=w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.id===c.data.standardId);
      requireThat(standard?.data.status==='approved'&&standard.revision===c.data.standardRevision,'A source close uses a retired or changed standard. Update its assignment before copying.');
      const due=move(c.data.due);requireThat(due>=period.start&&due<=period.end,'A copied closing due time falls outside the new shift.');
      requireThat(employee.position!=='Dishwasher'&&c.area===source.area&&standard.data.position===source.data.position,'A source close does not match its shift and station.');
      return {source:c,standard,due};
    });
    return {source,employee,...period,closes};
  });
  for(const s of shifts)requireThat(!shifts.some(other=>other!==s&&other.employee.id===s.employee.id&&overlaps(s,other)),`${s.employee.name} would have overlapping copied shifts.`);
  const staffing=o.staffingIds.map(id=>{
    const source=available.staffing.find(r=>r.id===id);requireThat(source,'A selected approved staffing need is unavailable.',403);
    requireThat(!w.records.some(r=>r.kind==='staffing'&&r.data.status!=='retired'&&r.data.copiedFrom?.id===id&&r.data.copiedFrom.targetWeek===o.targetWeek),'A selected staffing need has already been copied into that week.');
    return {source,...range({start:move(source.data.start),end:move(source.data.end)},24)};
  });
  const snapshot=(records:{id:string;revision:number}[])=>records.map(r=>[r.id,r.revision]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const areas=new Set(shifts.map(s=>s.source.area)),people=new Set(shifts.flatMap(s=>[s.employee.id,...s.closes.flatMap(c=>[c.source.data.managerId,...(c.source.data.verifierId?[c.source.data.verifierId]:[])])]));
  const context=w.records.filter(r=>r.locationId===w.location.id&&(r.kind==='shift'&&people.has(r.ownerId)&&!r.data.cancelled||r.kind==='availability'&&people.has(r.ownerId)&&r.data.status==='approved'||r.kind==='request'&&people.has(r.ownerId)&&r.data.type==='time-off'&&r.data.status==='approved'||r.kind==='leadership'&&areas.has(r.area)&&r.data.active));
  const stamp=JSON.stringify({stationSetup:snapshot(w.records.filter(r=>r.kind==='station')),options:o,sources:snapshot([...shifts.map(s=>s.source),...shifts.flatMap(s=>s.closes.flatMap(c=>[c.source,c.standard])),...staffing.map(s=>s.source)]),context:snapshot(context),members:w.members.filter(m=>people.has(m.id)).map(m=>({id:m.id,area:m.area,qualifications:[...m.qualifications].sort(),scheduleJobs:[...(m.scheduleJobs??[])].sort(),capabilities:[...m.capabilities].sort()})).sort((a,b)=>a.id.localeCompare(b.id))});
  return {shifts,staffing,stamp};
}
