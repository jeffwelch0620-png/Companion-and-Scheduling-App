'use client';
import { useState } from 'react';
import { personName, type Workspace, type WorkRecord } from '../shared/types';
import { localDate } from '../shared/local-time';
import { isScheduleRequest, requestStage, requestStatus, requestTitle, type RequestStage, type ScheduleRequestRecord } from '../shared/schedule-requests';

const calendar=(day:string)=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const clock=(minute:number)=>minute===1440?'midnight':`${Math.floor(minute/60)%12||12}${minute%60?':'+String(minute%60).padStart(2,'0'):''}${minute<720?'am':'pm'}`;
function period(record:ScheduleRequestRecord,zone:string) {
  if(record.kind==='availability')return `${calendar(record.data.startDate)} – ${calendar(record.data.endDate)}`;
  const start=localDate(record.data.start,zone),end=localDate(record.data.end,zone);
  const time=(instant:string)=>new Date(instant).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:zone}).replace(':00','').replace(' AM','am').replace(' PM','pm');
  return `${calendar(start)} · ${time(record.data.start)} – ${start===end?'':calendar(end)+' · '}${time(record.data.end)}`;
}

export function ScheduleRequests({w,now,busy,onBack,onTimeOff,onAvailability,onOpen}:{w:Workspace;now:string;busy:boolean;onBack:()=>void;onTimeOff:()=>void;onAvailability:()=>void;onOpen:(record:WorkRecord)=>void}) {
  const [stage,setStage]=useState<RequestStage>('pending'),[query,setQuery]=useState('');
  const requests=w.records.filter(isScheduleRequest);
  const filtered=requests.filter(r=>(personName(w,r.ownerId)+' '+requestTitle(r)).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const stages:RequestStage[]=['pending','approved','history'];
  const counts=Object.fromEntries(stages.map(s=>[s,filtered.filter(r=>requestStage(r,now,w.location.timezone)===s).length]));
  const shown=filtered.filter(r=>requestStage(r,now,w.location.timezone)===stage).sort((a,b)=>stage==='history'?b.updatedAt.localeCompare(a.updatedAt):a.updatedAt.localeCompare(b.updatedAt));
  return <section className="schedule-requests">
    <button className="schedule-back" onClick={onBack}>‹ Back to schedule</button>
    <h1>Time off & availability</h1>
    <div className="request-actions"><button className="shared-primary" disabled={busy} onClick={onTimeOff}>Request time off</button><button disabled={busy} onClick={onAvailability}>Set availability</button></div>
    <div className="schedule-view-toggle request-tabs" aria-label="Request status">{stages.map(s=><button key={s} aria-pressed={stage===s} onClick={()=>setStage(s)}>{s==='pending'?'Pending':s==='approved'?'Approved':'History'} <span>{counts[s]}</span></button>)}</div>
    {requests.length>5&&<label className="request-search"><span className="schedule-sr-only">Find a request or person</span><input type="search" placeholder="Find a request or person…" value={query} onInput={e=>setQuery(e.currentTarget.value)} onChange={e=>setQuery(e.target.value)}/></label>}
    <div className="request-list" aria-live="polite">{shown.map(r=><button key={r.id} className="request-card" disabled={busy} onClick={()=>onOpen(r)}>
      <span className="request-card-top"><strong>{requestTitle(r)}</strong><span className="request-status" data-status={r.data.status}>{requestStatus(r)}</span></span>
      <span className="request-person">{personName(w,r.ownerId)}{r.kind==='request'&&r.data.replacementId?' → '+personName(w,r.data.replacementId):''}</span>
      <span>{period(r,w.location.timezone)}</span>
      {r.kind==='availability'&&<span>{r.data.days.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')} · {r.data.startMinute===0&&r.data.endMinute===1440?'All day':clock(r.data.startMinute)+' – '+clock(r.data.endMinute)}</span>}
      {r.kind==='request'&&r.data.note&&<span className="request-note">{r.data.note}</span>}
      {r.data.decision&&<span className="request-note">{r.data.decision}</span>}
      <span className="request-open">View details <span aria-hidden="true">›</span></span>
    </button>)}{!shown.length&&<div className="request-empty"><strong>{query?'No matching requests':stage==='pending'?'No pending requests':stage==='approved'?'No current approved requests':'No past requests'}</strong><p>{query?'Try another name or clear your search.':stage==='pending'?'New requests will appear here while they wait for approval.':stage==='approved'?'Approved time off and availability will appear here.':'Completed, declined and replaced requests will appear here.'}</p></div>}</div>
  </section>;
}
