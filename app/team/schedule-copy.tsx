'use client';
import { useMemo, useState } from 'react';
import { personName, type Workspace } from '../shared/types';
import { copySources, weekCopyPlan } from '../shared/week-copy';
import { closingForShift } from '../shared/publication';
import { displayTime, nextDate } from '../shared/local-time';
import type { Send } from './workspace';

export function ScheduleCopy({w,sourceWeek,send,busy,onClose,onCreated}:{w:Workspace;sourceWeek:string;send:Send;busy:boolean;onClose:()=>void;onCreated:(day:string)=>void}){
  const [targetWeek,setTargetWeek]=useState(nextDate(sourceWeek,7)),[shiftIds,setShiftIds]=useState<string[]>([]),[staffingIds,setStaffingIds]=useState<string[]>([]),[repeated,setRepeated]=useState(''),[reviewStamp,setReviewStamp]=useState('');
  const sources=copySources(w,sourceWeek),zone=w.location.timezone;
  const options=useMemo(()=>({sourceWeek,targetWeek,shiftIds,staffingIds,repeated}),[sourceWeek,targetWeek,shiftIds,staffingIds,repeated]);
  const preview=useMemo(()=>{try{return {plan:weekCopyPlan(w,options),error:''}}catch(error){return {plan:null,error:error instanceof Error?error.message:'Review the selected week.'}}},[w,options]);
  const plan=preview.plan,stale=!!reviewStamp&&plan?.stamp!==reviewStamp,name=(id:string)=>personName(w,id,'Unavailable person');
  return <section><div className="shared-heading"><h1>Prepare another week</h1><button disabled={busy} onClick={onClose}>Back to source week</button></div><p>Copy selected shifts from the week starting {sourceWeek}. New shifts stay unpublished. Existing destination shifts are preserved.</p>
    {reviewStamp?<><h2>Review the new drafts</h2><p>{shiftIds.length} shifts · {plan?.shifts.reduce((n,s)=>n+s.closes.length,0)??0} fresh closing assignments · {staffingIds.length} staffing {staffingIds.length===1?'draft':'drafts'}</p><p>Closing checks start over. Proposed reviewers need current authority and leadership for the new dates before publication. Staffing needs require a new approval.</p>
      {stale&&<p role="alert" className="shared-error">The source or destination changed. Go back and review the latest proposal. {preview.error}</p>}
      {plan?.shifts.map(s=><article key={s.source.id}><strong>{s.employee.name} · {s.source.data.position}</strong><p>{displayTime(s.start,zone)} → {displayTime(s.end,zone)}</p>{s.closes.map(c=><p key={c.source.id}>{c.standard.data.title} · v{c.standard.data.version} · due {displayTime(c.due,zone)} · Proposed manager: {name(c.source.data.managerId)}{c.source.data.verifierId?' · First verifier: '+name(c.source.data.verifierId):''}</p>)}</article>)}
      {!!plan?.staffing.length&&<><h3>Staffing needs for approval</h3>{plan.staffing.map(n=><p key={n.source.id}>{n.source.data.title} · {n.source.data.minimum} {n.source.data.position} · {displayTime(n.start,zone)} → {displayTime(n.end,zone)}</p>)}</>}
      <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await send('shift.copy-week',{...options,reviewStamp,confirmed:f.get('confirmed')==='on',note:String(f.get('note')??'')}))onCreated(targetWeek)}}>
        <label className="shared-field">New-week review note<textarea name="note" required maxLength={2000} disabled={busy}/></label><label className="shared-check"><input name="confirmed" type="checkbox" required disabled={busy||stale}/>I reviewed the new dates, people and responsibilities.</label><div className="shared-actions"><button className="shared-primary" disabled={busy||stale}>Create unpublished week</button><button type="button" disabled={busy} onClick={()=>setReviewStamp('')}>Back to selection</button></div>
      </form>
    </>:<><label className="shared-field">Destination week starting<input type="date" value={targetWeek} disabled={busy} onChange={e=>setTargetWeek(e.target.value)}/></label><p>Use the same weekday in a later week. Times stay on the restaurant’s local clock, including overnight shifts.</p>
      <details><summary>Clock-change hour</summary><label className="shared-field">If a copied time occurs twice<select value={repeated} onChange={e=>setRepeated(e.target.value)}><option value="">Choose only if the hour repeats</option><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label><p>This choice applies to repeated start, end and closing times. A nonexistent time must be corrected in the source or omitted from this copy.</p></details>
      <div className="shared-actions"><button disabled={busy||!sources.shifts.length} onClick={()=>setShiftIds(sources.shifts.slice(0,100).map(s=>s.id))}>Select up to 100 source shifts</button><button disabled={busy||!shiftIds.length} onClick={()=>setShiftIds([])}>Clear source selection</button></div>
      {sources.shifts.map(s=><label className="shared-check" key={s.id}><input type="checkbox" aria-label={'Copy '+name(s.ownerId)+' '+displayTime(s.data.start,zone)} checked={shiftIds.includes(s.id)} disabled={busy||!shiftIds.includes(s.id)&&shiftIds.length>=100} onChange={e=>setShiftIds(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/><span><strong>{name(s.ownerId)} · {s.data.position}</strong><br/>{displayTime(s.data.start,zone)} → {displayTime(s.data.end,zone)} · {s.data.published?'Published':'Draft'} · {closingForShift(w,s.id).length} closing assignments</span></label>)}
      {!!sources.staffing.length&&<fieldset><legend>Approved staffing needs to copy as drafts</legend>{sources.staffing.map(n=><label className="shared-check" key={n.id}><input type="checkbox" checked={staffingIds.includes(n.id)} disabled={busy} onChange={e=>setStaffingIds(ids=>e.target.checked?[...ids,n.id]:ids.filter(id=>id!==n.id))}/>{n.data.title} · {n.data.minimum} {n.data.position}</label>)}</fieldset>}
      {!!shiftIds.length&&preview.error&&<p role="alert" className="shared-error">{preview.error}</p>}<button className="shared-primary" disabled={busy||!plan} onClick={()=>setReviewStamp(plan!.stamp)}>Review new week</button>
    </>}
  </section>;
}
