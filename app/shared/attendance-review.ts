import type { Attendance, AttendanceFacts, AttendanceType, RecordOf, Workspace } from './types';
import { canManageAttendance } from './attendance';
import { localDate } from './local-time';
import { requireThat } from './validation';

export const attendanceFactLabels = {
  contact:{unknown:'Not recorded',phone:'Spoke with a manager by phone',message:'Text or message only',none:'No contact reported'},
  coverage:{unknown:'Not recorded',confirmed:'Coverage confirmed by manager',uncovered:'No coverage confirmed'},
  emergency:{unknown:'Not recorded',reported:'Emergency reported', 'not-reported':'No emergency reported'},
} as const;
export const unknownAttendanceFacts = ():AttendanceFacts=>({contact:'unknown',coverage:'unknown',emergency:'unknown'});
export function parseAttendanceFacts(value:unknown):AttendanceFacts {
  requireThat(value&&typeof value==='object'&&!Array.isArray(value),'Check the contact, coverage and emergency details.');
  const v=value as Record<string,unknown>;
  for(const key of ['contact','coverage','emergency'] as const)requireThat(typeof v[key]==='string'&&Object.hasOwn(attendanceFactLabels[key],String(v[key])),'Choose a valid '+key+' detail.');
  return {contact:v.contact,coverage:v.coverage,emergency:v.emergency} as AttendanceFacts;
}
// Informational timing only. No disciplinary or emergency classification is inferred.
export function attendanceNotice(data:Attendance) {
  if(data.type!=='call-in')return null;
  const minutes=(Date.parse(data.shift.start)-Date.parse(data.reportedAt))/60000;
  return {minutes,band:minutes<0?'after-start':minutes<240?'under-four-hours':'at-least-four-hours'} as const;
}
export type AttendancePattern = {employeeId:string;name:string;entries:number;shifts:number;pending:number;latest:string;types:Partial<Record<AttendanceType,number>>};
export function attendancePatterns(w:Workspace,from:string,to:string):AttendancePattern[] {
  if(!from||!to||from>to)return [];
  const groups=new Map<string,{row:AttendancePattern;shifts:Set<string>}>();
  for(const r of w.records){
    if(r.kind!=='attendance'||r.locationId!==w.location.id||!canManageAttendance(w.me,r.area)||r.data.status!=='recorded')continue;
    const day=localDate(r.data.shift.start,w.location.timezone);if(day<from||day>to)continue;
    const group=groups.get(r.ownerId)??{row:{employeeId:r.ownerId,name:r.data.employeeName,entries:0,shifts:0,pending:0,latest:day,types:{}},shifts:new Set<string>()};
    group.row.entries++;group.shifts.add(r.data.shiftId);group.row.shifts=group.shifts.size;
    if(!r.data.review)group.row.pending++;
    if(day>group.row.latest)group.row.latest=day;
    group.row.types[r.data.type]=(group.row.types[r.data.type]??0)+1;groups.set(r.ownerId,group);
  }
  return [...groups.values()].map(g=>g.row).sort((a,b)=>a.name.localeCompare(b.name)||a.employeeId.localeCompare(b.employeeId));
}
export function attendanceReviewLabel(r:RecordOf<'attendance'>){return r.data.status==='voided'?'Voided':r.data.review?'Reviewed':'Needs review';}
