'use client';
import { useState } from 'react';
import { attendanceForShift, attendanceTypes, canManageAttendance } from '../shared/attendance';
import { displayTime, localClock, localDate, localInstant, nextDate } from '../shared/local-time';
import { attendanceReviewLabel } from '../shared/attendance-review';
import { AttendanceFactFields, AttendanceFactsView, AttendancePatterns, AttendanceReviewPanel } from './attendance-review';
import type { AttendanceType, RecordOf, WorkRecord, Workspace } from '../shared/types';
import type { Send } from './workspace';

type Props={w:Workspace;send:Send;onError:(message:string)=>void};
const val=(f:FormData,key:string)=>String(f.get(key)??'');

function AttendanceForm({w,send,onError,shift,record,now,onCancel}:Props&{shift?:RecordOf<'shift'>;record?:RecordOf<'attendance'>;now:string;onCancel:()=>void}){
  const [type,setType]=useState<AttendanceType>(record?.data.type??'call-in');
  const reported=record?.data.reportedAt??now,zone=w.location.timezone;
  return <form className="attendance-form" aria-label={record?'Correct attendance entry':'Record attendance'} onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{const reportedAt=localInstant(val(f,'date'),val(f,'time'),zone,val(f,'repeated'));
      if(await send(record?'attendance.correct':'attendance.record',{type,reportedAt,note:val(f,'note'),facts:{contact:val(f,'contact'),coverage:val(f,'coverage'),emergency:val(f,'emergency')},...(record?{changeReason:val(f,'changeReason')}:{shiftId:shift!.id,shiftRevision:shift!.revision})},record))onCancel();
    }catch(error){onError(error instanceof Error?error.message:'Check the attendance entry.');}
  }}>
    <label className="shared-field">What happened?<select value={type} onChange={e=>setType(e.target.value as AttendanceType)}>{Object.entries(attendanceTypes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
    <div className="shared-grid"><label className="shared-field">Reported date<input type="date" name="date" required defaultValue={localDate(reported,zone)}/></label><label className="shared-field">Reported time<input type="time" name="time" required defaultValue={localClock(reported,zone)}/></label></div>
    <details><summary>Clock-change options</summary><label className="shared-field">If this time occurs twice<select name="repeated" defaultValue=""><option value="">Choose only if asked</option><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label></details>
    <label className="shared-field">What happened / reason given<textarea name="note" required maxLength={2000} rows={3} defaultValue={record?.data.note??''} placeholder="Record the call, reason given, and relevant follow-up."/></label>
    <AttendanceFactFields facts={record?.data.facts}/>
    {record&&<><label className="shared-field">Reason for correction<textarea name="changeReason" required maxLength={2000} rows={2}/></label><p>Correcting the facts returns this entry to Needs review. Earlier reviews stay in history.</p></>}
    <p className="shared-muted">Saved for managers. The scheduled shift stays in place; arrange coverage separately.</p>
    <div className="shared-actions"><button className="shared-primary" type="submit">{record?'Save correction':'Save attendance'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

export function ShiftAttendance({w,send,onError,shift,now,onOpen}:Props&{shift:RecordOf<'shift'>;now:string;onOpen:(r:WorkRecord)=>void}){
  const [editing,setEditing]=useState(false);
  if(!canManageAttendance(w.me,shift.area)||!shift.data.published)return null;
  const records=attendanceForShift(w,shift);
  return <section className="shift-attendance" aria-label="Shift attendance"><div className="shared-heading"><h3>Attendance</h3>{!editing&&!shift.data.cancelled&&<button type="button" onClick={()=>setEditing(true)}>Record attendance</button>}</div>
    {shift.data.cancelled&&<p className="shared-muted">This shift was cancelled. You can review or correct existing entries.</p>}
    {records.map(r=><button className="attendance-entry-link" key={r.id} type="button" onClick={()=>onOpen(r)}>{attendanceTypes[r.data.type]}{r.data.status==='voided'?' · Voided':''}<small>{displayTime(r.data.reportedAt,w.location.timezone)}</small></button>)}
    {editing&&!shift.data.cancelled&&<AttendanceForm w={w} send={send} onError={onError} shift={shift} now={now} onCancel={()=>setEditing(false)}/>}
  </section>;
}

export function AttendanceDetail({w,send,onError,record:r,now}:Props&{record:RecordOf<'attendance'>;now:string}){
  const [editing,setEditing]=useState(false),zone=w.location.timezone;
  if(!canManageAttendance(w.me,r.area))return null;
  return <div className="attendance-detail"><p className="shared-kicker">{r.data.status==='voided'?'Voided entry':attendanceTypes[r.data.type]}</p><h3>{r.data.employeeName}</h3><p>{r.data.shift.position} · {r.area}</p><p><strong>Original shift</strong><br/>{displayTime(r.data.shift.start,zone)} → {displayTime(r.data.shift.end,zone)}</p><p><strong>Reported</strong><br/>{displayTime(r.data.reportedAt,zone)}</p><p className="shared-message">{r.data.note}</p>
    {!editing&&<AttendanceReviewPanel key={r.id+':'+r.revision} w={w} r={r} send={send}/>}
    {r.data.status==='recorded'&&!editing&&<button type="button" onClick={()=>setEditing(true)}>Correct entry</button>}
    {editing&&<AttendanceForm w={w} send={send} onError={onError} record={r} now={now} onCancel={()=>setEditing(false)}/>}
    {r.data.status==='recorded'&&!editing&&<details className="attendance-void"><summary>Void an entry recorded by mistake</summary><form onSubmit={async e=>{e.preventDefault();await send('attendance.void',{changeReason:val(new FormData(e.currentTarget),'reason')},r)}}><label className="shared-field">Why is this entry being voided?<textarea name="reason" required rows={2} maxLength={2000}/></label><p>The entry and its full history remain available.</p><button type="submit">Void entry</button></form></details>}
    <h3>Entry history</h3><ol className="shared-history">{r.data.history.map((entry,i)=><li key={i}><strong>{{recorded:'Recorded',corrected:'Corrected',voided:'Voided',reviewed:'Reviewed',reopened:'Review reopened'}[entry.action]} · {entry.actorName}</strong><small>{displayTime(entry.at,zone)}</small><span>{attendanceTypes[entry.type]} · Reported {displayTime(entry.reportedAt,zone)}</span><span className="shared-message">{entry.note}</span><AttendanceFactsView facts={entry.facts}/>{entry.changeReason&&<span className="shared-message">{entry.action==='reviewed'?'Review':'Reason'}: {entry.changeReason}</span>}</li>)}</ol>
  </div>;
}

export function AttendanceHistory({w,now,onOpen,onBack}:{w:Workspace;now:string;onOpen:(r:WorkRecord)=>void;onBack:()=>void}){
  const today=localDate(now,w.location.timezone);
  const [employee,setEmployee]=useState('all'),[type,setType]=useState('all'),[from,setFrom]=useState(nextDate(today,-29)),[to,setTo]=useState(today),[status,setStatus]=useState('recorded'),[review,setReview]=useState('all');
  const records=w.records.filter((r):r is RecordOf<'attendance'>=>r.kind==='attendance'&&r.locationId===w.location.id&&canManageAttendance(w.me,r.area));
  const people=[...new Map(records.map(r=>[r.ownerId,r.data.employeeName])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  const invalid=!from||!to||from>to;
  const filtered=invalid?[]:records.filter(r=>{const day=localDate(r.data.shift.start,w.location.timezone);return (employee==='all'||r.ownerId===employee)&&(type==='all'||r.data.type===type)&&(status==='all'||r.data.status===status)&&(review==='all'||review==='reviewed'&&!!r.data.review||review==='pending'&&r.data.status==='recorded'&&!r.data.review)&&day>=from&&day<=to}).sort((a,b)=>b.data.shift.start.localeCompare(a.data.shift.start)||b.updatedAt.localeCompare(a.updatedAt));
  return <section className="attendance-history"><button className="detail-back" onClick={onBack}>‹ Back to schedule</button><div className="shared-heading"><h1>Attendance history</h1><button onClick={onBack}>Record from schedule</button></div><p>Manager records with original shifts and correction history.</p>
    <div className="attendance-filters"><label className="shared-field">Employee<select value={employee} onChange={e=>setEmployee(e.target.value)}><option value="all">All employees</option>{people.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label className="shared-field">Attendance type<select value={type} onChange={e=>setType(e.target.value)}><option value="all">All types</option>{Object.entries(attendanceTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="shared-field">Shift dates from<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="shared-field">Shift dates through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label className="shared-field">Entry status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="recorded">Current entries</option><option value="voided">Voided entries</option><option value="all">All entries</option></select></label></div>
    <label className="shared-field">Review status<select value={review} onChange={e=>setReview(e.target.value)}><option value="all">All review states</option><option value="pending">Needs review</option><option value="reviewed">Reviewed</option></select></label>
    {invalid?<p role="alert">Choose a start and end date, with the end on or after the start.</p>:<AttendancePatterns w={w} from={from} to={to} onSelect={id=>{setEmployee(id);setType('all');setStatus('recorded');setReview('all')}}/>}
    <h2>Attendance entries</h2><p role="status">{filtered.length} {filtered.length===1?'entry':'entries'}</p>
    <div className="shared-list">{filtered.map(r=><button key={r.id} onClick={()=>onOpen(r)}><span><strong>{r.data.employeeName} · {attendanceTypes[r.data.type]}</strong><small>{displayTime(r.data.shift.start,w.location.timezone)} · {r.data.shift.position}</small></span><span>{attendanceReviewLabel(r)} ›</span></button>)}</div>
    {!filtered.length&&!invalid&&<p className="shared-empty">{records.length?'No entries match these filters.':'No attendance entries yet. Open a published shift to record a call-in or another attendance event.'}</p>}
  </section>;
}
