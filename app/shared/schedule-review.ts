import { canScheduleJob, manages, type Member, type RecordOf, type Workspace } from './types';
import { stationAssignmentIssue } from './station-assignment';
import { availabilityConflict, calendarDate } from './schedule-policy';
import { localInstant, nextDate } from './local-time';
import { overlaps } from './validation';

export const canPlan=(me:Member,area:string)=>me.position!=='Dishwasher'&&(manages(me,area,'schedule.manage')||manages(me,area,'schedule.publish')||manages(me,area,'schedule.change'));
export function weekPeriod(w:Workspace,start:string) {
  calendarDate(start,'Week starting');return {start:localInstant(start,'00:00',w.location.timezone),end:localInstant(nextDate(start,7),'00:00',w.location.timezone)};
}
export function weekStaffing(w:Workspace,start:string) {
  const period=weekPeriod(w,start);
  return w.records.filter((r):r is RecordOf<'staffing'>=>r.locationId===w.location.id&&r.kind==='staffing'&&r.data.status==='approved'&&canPlan(w.me,r.area)&&overlaps(r.data,period)).sort((a,b)=>a.id.localeCompare(b.id));
}
export type StaffingGap={start:string;end:string;required:number;scheduled:number};
type Period={start:string;end:string};
const duration=(a:Period,b:Period)=>Math.max(0,Math.min(Date.parse(a.end),Date.parse(b.end))-Math.max(Date.parse(a.start),Date.parse(b.start)))/60000;

function assignmentIssue(w:Workspace,s:RecordOf<'shift'>,shifts:RecordOf<'shift'>[]):string|null {
  const m=w.members.find(m=>m.id===s.ownerId&&m.locationId===w.location.id&&m.area===s.area);
  if(!m)return 'Employee is unavailable in this department.';
  if(!canScheduleJob(m,s.data.position))return 'This job needs scheduling approval.';
  const stationIssue=stationAssignmentIssue(w,m,s.data.position,s.data.stationId);if(stationIssue)return stationIssue;
  if(availabilityConflict(w,m.id,s.data))return 'Conflicts with approved availability.';
  if(w.records.some(r=>r.locationId===w.location.id&&r.kind==='request'&&r.ownerId===m.id&&r.data.type==='time-off'&&r.data.status==='approved'&&overlaps(r.data,s.data)))return 'Conflicts with approved time off.';
  if(shifts.some(other=>other.id!==s.id&&other.ownerId===s.ownerId&&overlaps(other.data,s.data)))return 'Overlaps another shift for this employee.';
  return null;
}
function gaps(need:RecordOf<'staffing'>,shifts:RecordOf<'shift'>[],week:Period):StaffingGap[] {
  const start=Math.max(Date.parse(need.data.start),Date.parse(week.start)),end=Math.min(Date.parse(need.data.end),Date.parse(week.end));
  const valid=shifts.filter(s=>s.area===need.area&&s.data.position===need.data.position&&overlaps(s.data,need.data));
  const boundaries=[...new Set([start,end,...valid.flatMap(s=>[Math.max(start,Date.parse(s.data.start)),Math.min(end,Date.parse(s.data.end))])])].filter(t=>t>=start&&t<=end).sort((a,b)=>a-b);
  const rows:StaffingGap[]=[];
  for(let i=0;i<boundaries.length-1;i++){
    const from=boundaries[i],to=boundaries[i+1];if(to<=from)continue;
    const scheduled=new Set(valid.filter(s=>Date.parse(s.data.start)<=from&&Date.parse(s.data.end)>=to).map(s=>s.ownerId)).size;
    if(scheduled>=need.data.minimum)continue;
    const previous=rows.at(-1),start=new Date(from).toISOString(),end=new Date(to).toISOString();
    if(previous?.end===start&&previous.scheduled===scheduled)previous.end=end;else rows.push({start,end,required:need.data.minimum,scheduled});
  }
  return rows;
}

// The same projection powers the UI and the final server-side publication check.
// The publisher reviews only published shifts plus the drafts explicitly selected.
export function scheduleReview(w:Workspace,start:string,selected?:string[]) {
  const period=weekPeriod(w,start),scope=w.records.filter(r=>r.locationId===w.location.id&&canPlan(w.me,r.area));
  const shifts=scope.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&!r.data.cancelled&&overlaps(r.data,period));
  const published=shifts.filter(s=>s.data.published),planned=shifts.filter(s=>s.data.published||selected===undefined||selected.includes(s.id));
  const qualifiedPublished=published.filter(s=>!assignmentIssue(w,s,published)),qualifiedPlanned=planned.filter(s=>!assignmentIssue(w,s,planned));
  const staffing=weekStaffing(w,start).map(r=>({record:r,published:gaps(r,qualifiedPublished,period),planned:gaps(r,qualifiedPlanned,period)}));
  const members=w.members.filter(m=>m.locationId===w.location.id&&canPlan(w.me,m.area));
  const hours=members.map(m=>({personId:m.id,name:m.name,area:m.area,publishedMinutes:published.filter(s=>s.ownerId===m.id).reduce((n,s)=>n+duration(s.data,period),0),plannedMinutes:planned.filter(s=>s.ownerId===m.id).reduce((n,s)=>n+duration(s.data,period),0),shifts:planned.filter(s=>s.ownerId===m.id).map(s=>s.id)})).filter(m=>m.shifts.length||m.publishedMinutes).sort((a,b)=>b.plannedMinutes-a.plannedMinutes||a.name.localeCompare(b.name));
  const qualifiedIds=new Set(qualifiedPlanned.map(s=>s.id));
  const issues=planned.filter(s=>!qualifiedIds.has(s.id)).map(s=>({record:s,reason:assignmentIssue(w,s,planned)!}));
  return {period,hours,staffing,issues,publishedGapCount:staffing.reduce((n,s)=>n+s.published.length,0),plannedGapCount:staffing.reduce((n,s)=>n+s.planned.length,0)};
}

// No messages or unrelated notes enter the stamp. Relevant staffing, scheduled
// people, clearance and availability changes require a new review before publish.
export function planningStamp(w:Workspace,start:string,selected:string[]) {
  const period=weekPeriod(w,start),staffing=weekStaffing(w,start);
  const shifts=w.records.filter((r):r is RecordOf<'shift'>=>r.locationId===w.location.id&&r.kind==='shift'&&!r.data.cancelled&&canPlan(w.me,r.area)&&overlaps(r.data,period)&&(r.data.published||selected.includes(r.id))).sort((a,b)=>a.id.localeCompare(b.id));
  const people=w.members.filter(m=>shifts.some(s=>s.ownerId===m.id)).sort((a,b)=>a.id.localeCompare(b.id)).map(m=>({id:m.id,area:m.area,qualifications:[...m.qualifications].sort(),scheduleJobs:[...(m.scheduleJobs??[])].sort()}));
  const restrictions=w.records.filter(r=>r.locationId===w.location.id&&shifts.some(s=>s.ownerId===r.ownerId)&&(r.kind==='availability'&&r.data.status==='approved'||r.kind==='request'&&r.data.type==='time-off'&&r.data.status==='approved')).sort((a,b)=>a.id.localeCompare(b.id));
  const workforce=w.records.filter(r=>r.locationId===w.location.id&&canPlan(w.me,r.area)&&(r.kind==='station'||r.kind==='proficiency')).sort((a,b)=>a.id.localeCompare(b.id)).map(r=>[r.id,r.revision]);
  return JSON.stringify({workforce,staffing:staffing.map(r=>[r.id,r.revision]),shifts:shifts.map(r=>[r.id,r.revision]),people,restrictions:restrictions.map(r=>[r.id,r.revision])});
}
