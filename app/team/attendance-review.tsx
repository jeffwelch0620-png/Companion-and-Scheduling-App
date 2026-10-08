'use client';
import { useState } from 'react';
import { attendanceFactLabels, attendanceNotice, attendancePatterns, attendanceReviewLabel, unknownAttendanceFacts } from '../shared/attendance-review';
import { attendanceTypes } from '../shared/attendance';
import { displayTime } from '../shared/local-time';
import type { AttendanceFacts, RecordOf, Workspace } from '../shared/types';
import type { Send } from './workspace';

export function AttendanceFactFields({facts}:{facts?:AttendanceFacts}){
  const value=facts??unknownAttendanceFacts();
  return <fieldset><legend>Call and coverage details</legend><p className="shared-muted">Record what is known. An unknown detail stays unknown.</p>{(['contact','coverage','emergency'] as const).map(key=><label className="shared-field" key={key}>{key==='contact'?'Manager contact':key==='coverage'?'Shift coverage':'Emergency reported'}<select name={key} defaultValue={value[key]}>{Object.entries(attendanceFactLabels[key]).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>)}</fieldset>;
}
export function AttendanceFactsView({facts}:{facts?:AttendanceFacts}){
  const v=facts??unknownAttendanceFacts();
  return <p>Contact: {attendanceFactLabels.contact[v.contact]}<br/>Coverage: {attendanceFactLabels.coverage[v.coverage]}<br/>Emergency: {attendanceFactLabels.emergency[v.emergency]}</p>;
}
export function AttendanceReviewPanel({w,r,send}:{w:Workspace;r:RecordOf<'attendance'>;send:Send}){
  const [writing,setWriting]=useState(false),notice=attendanceNotice(r.data);
  return <section aria-label="Manager attendance review"><h3>{attendanceReviewLabel(r)}</h3><AttendanceFactsView facts={r.data.facts}/>
    {notice&&<p>{notice.band==='after-start'?'Call reported after the original shift started.':notice.band==='under-four-hours'?'Call reported less than four hours before the original shift.':'Call reported at least four hours before the original shift.'}</p>}
    <p className="shared-muted">For call-outs, the employee must speak with a manager by phone. Releasing a shift alone does not transfer responsibility. Review coverage and any reported emergency individually. Saving here does not call anyone or change the schedule.</p>
    {r.data.review&&<><p><strong>{r.data.review.actorName}</strong> · {displayTime(r.data.review.at,w.location.timezone)}</p><p className="shared-message">{r.data.review.note}</p></>}
    {r.data.status==='recorded'&&!writing&&<button type="button" onClick={()=>setWriting(true)}>{r.data.review?'Reopen review':'Review this entry'}</button>}
    {r.data.status==='recorded'&&writing&&<form aria-label={r.data.review?'Reopen attendance review':'Manager review'} onSubmit={async e=>{e.preventDefault();const note=String(new FormData(e.currentTarget).get('reviewNote')??'');if(await send(r.data.review?'attendance.reopen':'attendance.review',{note},r))setWriting(false)}}>
      <label className="shared-field">{r.data.review?'Reason for reopening':'Manager review and follow-up'}<textarea name="reviewNote" required maxLength={2000} rows={3}/></label><p>No points or automatic penalties. Record your individual review and next step.</p><div className="shared-actions"><button className="shared-primary" type="submit">{r.data.review?'Reopen review':'Save review'}</button><button type="button" onClick={()=>setWriting(false)}>Cancel</button></div>
    </form>}
  </section>;
}
export function AttendancePatterns({w,from,to,onSelect}:{w:Workspace;from:string;to:string;onSelect:(id:string)=>void}){
  const rows=attendancePatterns(w,from,to);
  return <section aria-label="Attendance patterns"><h2>Patterns for manager review</h2><p>Current entries for {from} through {to}, across all attendance types. Multiple notes about one shift count as one shift. These counts are not points, an attendance rate or a disciplinary decision.</p>
    <div className="shared-list">{rows.map(row=><button type="button" key={row.employeeId} onClick={()=>onSelect(row.employeeId)}><span><strong>{row.name}</strong><small>{row.shifts} {row.shifts===1?'shift':'shifts'} · {row.entries} {row.entries===1?'entry':'entries'} · {row.pending} need review</small><small>{Object.entries(row.types).map(([key,n])=>`${attendanceTypes[key as keyof typeof attendanceTypes]}: ${n}`).join(' · ')}</small></span><span>View entries ›</span></button>)}</div>{!rows.length&&<p className="shared-empty">No current attendance entries in this date range.</p>}
  </section>;
}
