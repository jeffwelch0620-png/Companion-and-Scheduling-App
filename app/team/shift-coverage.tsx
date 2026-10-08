'use client';
import { coverageDuties } from '../shared/coverage';
import { canChangePublished } from '../shared/schedule-policy';
import { displayTime, localDate, nextDate } from '../shared/local-time';
import { personName, type CoverageDuty, type RecordOf, type Workspace, type WorkRecord } from '../shared/types';
import type { Send } from './workspace';

function Duties({duties,zone}:{duties:CoverageDuty[];zone:string}) {
  return <><h3>Closing duties that go with this shift</h3>{duties.length?duties.map(d=><article key={d.id}><strong>{d.title} · {d.zone}</strong><p>Due {displayTime(d.due,zone)}</p><ul>{d.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul><small>Version {d.version} · {d.source}</small></article>):<p>No closing duties assigned.</p>}</>;
}

// Consume the server's eligibility projection. Coworkers deliberately cannot see
// the original employee's entire schedule or the other volunteers' identities.
export function CoverageBoard({w,onOpen,start,days=1}:{w:Workspace;onOpen:(r:WorkRecord)=>void;start:string;days?:number}) {
  const end=/^\d{4}-\d{2}-\d{2}$/.test(start)?nextDate(start,days):'';
  const offers=w.records.filter((r):r is RecordOf<'coverage'>=>r.kind==='coverage'&&localDate(r.data.start,w.location.timezone)>=start&&localDate(r.data.start,w.location.timezone)<end).sort((a,b)=>a.data.start.localeCompare(b.data.start));
  const state=(r:RecordOf<'coverage'>)=>r.data.status==='approved'?'Replacement approved':r.data.status!=='open'?r.data.status:r.data.unavailableReason||(r.ownerId===w.me.id?'Your coverage request':r.data.volunteers.some(v=>v.personId===w.me.id)?'You volunteered · awaiting approval':r.data.eligible?'Available to pick up':'Review coverage');
  return <section aria-label="Shift coverage"><h2>Shift coverage</h2><p>The current employee stays responsible until the assigned shift leader approves a replacement.</p>{offers.length?<div className="shared-list">{offers.map(r=><button key={r.id} onClick={()=>onOpen(r)}><span><strong>{r.data.position} · {displayTime(r.data.start,w.location.timezone)}</strong><small>{state(r)}</small></span><em>{r.data.status}</em></button>)}</div>:<p className="shared-empty">No coverage offers on these dates. Open your upcoming published shift to offer it.</p>}</section>;
}

export function OfferShift({w,shift,send,onOpen,now}:{w:Workspace;shift:RecordOf<'shift'>;send:Send;onOpen:(r:WorkRecord)=>void;now:string}) {
  const existing=w.records.find(r=>r.kind==='coverage'&&r.data.shiftId===shift.id&&r.data.status==='open'&&!r.data.unavailableReason);
  if(existing)return <button onClick={()=>onOpen(existing)}>View your coverage offer</button>;
  if(Date.parse(shift.data.start)<=Date.parse(now))return <p>This shift has started. Contact the leader running the shift about coverage.</p>;
  return <details><summary>Offer shift to eligible coworkers</summary><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('coverage.create',{shiftId:shift.id,shiftRevision:shift.revision,note:String(f.get('note')??'')})}}><p>You stay responsible until approval. Coworkers review the times and duties before volunteering.</p><Duties duties={coverageDuties(w,shift.id)} zone={w.location.timezone}/><label className="shared-field">Private note for schedule reviewers<textarea name="note" maxLength={2000}/></label><button className="shared-primary">Offer for coverage</button></form></details>;
}

export function CoverageDetail({w,record:r,send,now}:{w:Workspace;record:RecordOf<'coverage'>;send:Send;now:string}) {
  const me=w.me,zone=w.location.timezone,own=r.ownerId===me.id,volunteered=r.data.volunteers.some(v=>v.personId===me.id);
  const current=r.data.status==='open'&&!r.data.unavailableReason&&Date.parse(r.data.start)>Date.parse(now);
  const reviewers=current&&!own&&canChangePublished(w,me,r.area,r.data);
  const name=(id:string)=>personName(w,id,'Previous employee');
  return <><p>{r.data.position} · {displayTime(r.data.start,zone)} → {displayTime(r.data.end,zone)}</p><p>{r.data.status==='approved'?`Coverage approved${r.data.selectedId?' for '+name(r.data.selectedId):''}.`:`Original employee: ${name(r.ownerId)}. They remain responsible until approval.`}</p><p>Status: {r.data.status}</p>{r.data.unavailableReason&&r.data.status==='open'&&<p role="status">{r.data.unavailableReason}</p>}<Duties duties={r.data.duties} zone={zone}/>{r.data.note&&<p>Private note for schedule reviewers: {r.data.note}</p>}
    {current&&!own&&r.data.eligible&&!volunteered&&<form onSubmit={async e=>{e.preventDefault();await send('coverage.volunteer',{confirmed:new FormData(e.currentTarget).get('confirmed')==='on'},r)}}><label className="shared-check"><input type="checkbox" name="confirmed" required/>I reviewed the times and closing duties and can take this shift.</label><button className="shared-primary">Volunteer for manager approval</button></form>}
    {r.data.status==='open'&&volunteered&&<><p>You volunteered. Wait for approval before treating this as your shift.</p><button onClick={()=>send('coverage.withdraw-volunteer',{},r)}>Withdraw my volunteer offer</button></>}
    {r.data.status==='open'&&own&&<><p>{r.data.volunteers.length} volunteer{r.data.volunteers.length===1?'':'s'} · awaiting the assigned leader’s decision.</p><button onClick={()=>send('coverage.withdraw',{},r)}>Withdraw coverage request</button></>}
    {reviewers&&<>{r.data.volunteers.filter(v=>v.personId!==me.id).length?<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('coverage.approve',{personId:String(f.get('personId')),confirmed:f.get('confirmed')==='on',note:String(f.get('note'))},r)}}><label className="shared-field">Replacement<select name="personId" required defaultValue=""><option value="">Choose a volunteer</option>{r.data.volunteers.filter(v=>v.personId!==me.id).map(v=><option key={v.personId} value={v.personId}>{name(v.personId)}</option>)}</select></label><label className="shared-field">Coverage decision<textarea name="note" required maxLength={2000}/></label><label className="shared-check"><input type="checkbox" name="confirmed" required/>I reviewed the replacement, shift times and inherited closing duties.</label><p>Availability and station clearance are checked again when you approve.</p><button className="shared-primary">Approve replacement and transfer duties</button></form>:<p>Waiting for an eligible coworker to volunteer.</p>}</>}
    {!!r.data.history.length&&<details><summary>Coverage history</summary><ol>{r.data.history.map((h,i)=><li key={i}>{h.action} · {name(h.actorId)} · {displayTime(h.at,zone)}<p>{h.note}</p></li>)}</ol></details>}
  </>;
}
