import { has, manages, personName, type Attendance, type AttendanceType, type Member, type RecordOf, type Workspace } from './types';
import type { CommandContext } from './followthrough';
import { id, instant, requireThat, text } from './validation';
import { parseAttendanceFacts, unknownAttendanceFacts } from './attendance-review';

export const attendanceTypes: Record<AttendanceType,string> = {
  'call-in':'Called in', 'no-show':'No-show', late:'Late arrival', 'left-early':'Left early', other:'Other attendance note',
};
export const canManageAttendance=(me:Member,area=me.area)=>me.position!=='Dishwasher'&&(has(me,'location.manage')||manages(me,area,'people.manage'));
export function attendanceForShift(w:Workspace,shift:RecordOf<'shift'>){
  return w.records.filter((r):r is RecordOf<'attendance'>=>r.kind==='attendance'&&r.locationId===w.location.id&&canManageAttendance(w.me,r.area)&&r.data.shiftId===shift.id&&r.ownerId===shift.ownerId);
}

export function applyAttendance(c:CommandContext){
  const {w,me,command,input,at,find,create,save}=c;
  const existing=command.recordId?find('attendance'):undefined;
  const shift=existing?undefined:w.records.find((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===w.location.id&&r.id===id(input.shiftId));
  requireThat(existing||shift,'Choose a scheduled shift.',404);
  const area=existing?.area??shift!.area,ownerId=existing?.ownerId??shift!.ownerId;
  requireThat(canManageAttendance(me,area),'Attendance requires manager access for this department.',403);
  requireThat(!existing||existing.data.status==='recorded','This entry was voided. Its history is retained.');
  requireThat(!existing||existing.data.history.length<1000,'This entry has reached its history limit.');
  if(command.action==='attendance.review'||command.action==='attendance.reopen'){
    requireThat(existing,'Choose an attendance entry.');
    const reopening=command.action==='attendance.reopen';
    requireThat(reopening?!!existing.data.review:!existing.data.review,reopening?'This entry already needs review.':'This entry is already reviewed. Reopen it to add a new review.',409);
    const note=text(input.note,reopening?'Reason for reopening':'Manager review and follow-up',2000);
    const review=reopening?null:{at,actorId:me.id,actorName:me.name,note};
    save({...existing,data:{...existing.data,review,history:[...existing.data.history,{actorId:me.id,actorName:me.name,at,action:reopening?'reopened':'reviewed',type:existing.data.type,reportedAt:existing.data.reportedAt,note:existing.data.note,changeReason:note,facts:existing.data.facts??unknownAttendanceFacts(),review}]}});
    return;
  }
  if(command.action==='attendance.void'){
    requireThat(existing,'Choose the attendance entry to void.');
    const changeReason=text(input.changeReason,'Reason for voiding this entry');
    save({...existing,data:{...existing.data,status:'voided',history:[...existing.data.history,{actorId:me.id,actorName:me.name,at,action:'voided',type:existing.data.type,reportedAt:existing.data.reportedAt,note:existing.data.note,changeReason,facts:existing.data.facts??unknownAttendanceFacts(),review:existing.data.review??null}]}});
    return;
  }
  requireThat(command.action==='attendance.record'||command.action==='attendance.correct','Unknown attendance action.');
  requireThat(command.action==='attendance.record'?!existing:!!existing,'Choose the correct create or correction action.');
  if(shift){
    requireThat(shift.data.published,'Attendance can only be recorded against a published shift.');
    requireThat(!shift.data.cancelled,'This shift was cancelled. Existing attendance entries remain available in Attendance history.');
    requireThat(Number.isInteger(input.shiftRevision)&&input.shiftRevision===shift.revision,'The shift changed. Reopen it and check the employee and time before saving.',409);
  }
  requireThat(typeof input.type==='string'&&Object.hasOwn(attendanceTypes,input.type),'Choose an attendance type.');
  const type=input.type as AttendanceType,reportedAt=instant(input.reportedAt,'Reported time'),note=text(input.note,'Attendance note');
  requireThat(Date.parse(reportedAt)<=Date.parse(at)+60000,'Reported time cannot be in the future.');
  const shiftId=existing?.data.shiftId??shift!.id;
  requireThat(!w.records.some(r=>r.kind==='attendance'&&r.id!==existing?.id&&r.data.shiftId===shiftId&&r.ownerId===ownerId&&r.data.status==='recorded'&&r.data.type===type),'This attendance type is already recorded for this employee and shift. Open that entry to correct it.',409);
  const changeReason=existing?text(input.changeReason,'Reason for correction'):'';
  const snapshot=existing?.data.shift??{start:shift!.data.start,end:shift!.data.end,position:shift!.data.position};
  requireThat(type!=='no-show'||Date.parse(snapshot.start)<=Date.parse(reportedAt),'A no-show can only be reported once the scheduled shift has started.');
  const facts=input.facts===undefined?existing?.data.facts??unknownAttendanceFacts():parseAttendanceFacts(input.facts);
  const entry={actorId:me.id,actorName:me.name,at,action:existing?'corrected' as const:'recorded' as const,type,reportedAt,note,changeReason,facts,review:null};
  const employeeName=existing?.data.employeeName??personName(w,ownerId);
  const data:Attendance={title:`${employeeName} · ${attendanceTypes[type]}`,employeeName,shiftId,shiftRevision:existing?.data.shiftRevision??shift!.revision,shift:snapshot,type,reportedAt,note,status:'recorded',facts,review:null,history:[...(existing?.data.history??[]),entry]};
  if(existing)save({...existing,data});
  // The shift's employee identity survives later reassignment and archiving.
  // This object supplies record ownership only; it never grants membership.
  else create({kind:'attendance',data},{...me,id:ownerId,area,name:employeeName});
}
