'use client';
import { useState } from 'react';
import { personName, manages, type RecordOf, type Workspace } from '../shared/types';
import { displayTime, localClock, localDate, localInstant } from '../shared/local-time';
import type { Send } from './workspace';
import { schedulingJobs } from '../shared/shift-planning';

type Shift=RecordOf<'shift'>;
type Edit={source:Shift;personId:string;position:string;startDay:string;startTime:string;endDay:string;endTime:string;startFold:string;endFold:string};
type Proposal={source:Shift;personId:string;position:string;start:string;end:string};
function edit(r:Shift,zone:string):Edit{return {source:r,personId:r.ownerId,position:r.data.position,startDay:localDate(r.data.start,zone),startTime:localClock(r.data.start,zone),endDay:localDate(r.data.end,zone),endTime:localClock(r.data.end,zone),startFold:'',endFold:''}}
function proposed(e:Edit,zone:string):Proposal{
  const convert=(day:string,time:string,fold:string,previous:string)=>day===localDate(previous,zone)&&time===localClock(previous,zone)&&!fold?previous:localInstant(day,time,zone,fold);
  const start=convert(e.startDay,e.startTime,e.startFold,e.source.data.start),end=convert(e.endDay,e.endTime,e.endFold,e.source.data.end);
  if(Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>86400000)throw new Error('Each shift must end after it starts and last no more than 24 hours.');
  return {source:e.source,personId:e.personId,position:e.position.trim(),start,end};
}
export function ScheduleDraftEditor({w,weekStart,drafts,send,busy,onClose}:{w:Workspace;weekStart:string;drafts:Shift[];send:Send;busy:boolean;onClose:()=>void}){
  const [selected,setSelected]=useState<Shift[]>([]),[edits,setEdits]=useState<Edit[]>([]),[proposals,setProposals]=useState<Proposal[]>([]),[step,setStep]=useState<'select'|'edit'|'review'>('select'),[error,setError]=useState('');
  const stale=selected.some(s=>w.records.find(r=>r.id===s.id)?.revision!==s.revision);
  const name=(personId:string)=>personName(w,personId,'Unavailable employee');
  const update=(i:number,key:Exclude<keyof Edit,'source'>,value:string)=>setEdits(old=>old.map((e,j)=>{if(j!==i)return e;if(key==='personId'){const m=w.members.find(m=>m.id===value),jobs=m?schedulingJobs(m):[];return {...e,personId:value,position:jobs.includes(e.position)?e.position:jobs.length===1?jobs[0]:''}}return {...e,[key]:value}}));
  return <section><div className="shared-heading"><h1>Edit shift drafts</h1><button disabled={busy} onClick={onClose}>Back to week</button></div><p>Week starting {weekStart}</p>
    <p>Review changes to existing drafts together. They stay unpublished until the schedule publisher reviews them.</p>
    {error&&<p className="shared-error" role="alert">{error}</p>}
    {stale&&<p className="shared-error" role="alert">A selected draft changed while you were editing. Return to the week and select the latest drafts.</p>}
    {step==='select'&&<><div className="shared-actions"><button disabled={busy||!drafts.length} onClick={()=>setSelected(drafts.slice(0,100))}>Select up to 100 drafts</button><button disabled={busy||!selected.length} onClick={()=>setSelected([])}>Clear selection</button></div>
      <div className="shared-list">{drafts.map(r=><label className="shared-check" key={r.id}><input type="checkbox" checked={selected.some(s=>s.id===r.id)} disabled={busy||!selected.some(s=>s.id===r.id)&&selected.length>=100} onChange={e=>setSelected(old=>e.target.checked?[...old,r]:old.filter(s=>s.id!==r.id))}/><span><strong>{name(r.ownerId)} · {r.data.position}</strong><br/>{displayTime(r.data.start,w.location.timezone)} → {displayTime(r.data.end,w.location.timezone)}</span></label>)}</div>
      <button className="shared-primary" disabled={busy||stale||!selected.length} onClick={()=>{setEdits(selected.map(r=>edit(r,w.location.timezone)));setError('');setStep('edit')}}>Edit {selected.length} selected drafts</button>
    </>}
    {step==='edit'&&<form onSubmit={e=>{e.preventDefault();try{setProposals(edits.map(e=>{const m=w.members.find(m=>m.id===e.personId);if(!m||!schedulingJobs(m).includes(e.position))throw Error('Choose a current scheduling job for '+name(e.personId)+'.');return proposed(e,w.location.timezone)}));setError('');setStep('review')}catch(error){setError(error instanceof Error?error.message:'Check the shift details.')}}}>
      <fieldset disabled={busy||stale}>{edits.map((e,i)=><fieldset key={e.source.id}><legend>{name(e.source.ownerId)} · {displayTime(e.source.data.start,w.location.timezone)}</legend>
        <div className="shared-grid"><label className="shared-field">Employee<select value={w.members.some(m=>m.id===e.personId)?e.personId:''} onChange={event=>update(i,'personId',event.target.value)} required><option value="">Choose an active employee</option>{w.members.filter(m=>manages(w.me,m.area,'schedule.manage')).map(m=><option key={m.id} value={m.id}>{m.name} · {m.position}</option>)}</select></label><label className="shared-field">Scheduling job<select value={e.position} required onChange={event=>update(i,'position',event.target.value)}><option value="">Choose a scheduling job</option>{(() => {const m=w.members.find(m=>m.id===e.personId),jobs=m?schedulingJobs(m):[];return <>{e.position&&!jobs.includes(e.position)&&<option value={e.position} disabled>{e.position} · job needs review</option>}{jobs.map(q=><option key={q}>{q}</option>)}</>})()}</select></label></div>
        <div className="shared-grid"><label className="shared-field">Start date<input type="date" value={e.startDay} required onInput={event=>update(i,'startDay',event.currentTarget.value)} onChange={event=>update(i,'startDay',event.target.value)}/></label><label className="shared-field">Start time<input type="time" value={e.startTime} required onInput={event=>update(i,'startTime',event.currentTarget.value)} onChange={event=>update(i,'startTime',event.target.value)}/></label><label className="shared-field">End date<input type="date" value={e.endDay} required onInput={event=>update(i,'endDay',event.currentTarget.value)} onChange={event=>update(i,'endDay',event.target.value)}/></label><label className="shared-field">End time<input type="time" value={e.endTime} required onInput={event=>update(i,'endTime',event.currentTarget.value)} onChange={event=>update(i,'endTime',event.target.value)}/></label></div>
        <details><summary>If an hour occurs twice when clocks change</summary><label className="shared-field">Start occurrence<select value={e.startFold} onChange={event=>update(i,'startFold',event.target.value)}><option value="">Keep saved occurrence or choose if needed</option><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label><label className="shared-field">End occurrence<select value={e.endFold} onChange={event=>update(i,'endFold',event.target.value)}><option value="">Keep saved occurrence or choose if needed</option><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label></details>
      </fieldset>)}</fieldset>
      <div className="shared-actions"><button className="shared-primary" disabled={busy||stale}>Review draft changes</button><button type="button" disabled={busy} onClick={()=>setStep('select')}>Change selection</button></div>
    </form>}
    {step==='review'&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await send('shift.save-batch',{weekStart,drafts:proposals.map(p=>({id:p.source.id,revision:p.source.revision,input:{personId:p.personId,position:p.position,start:p.start,end:p.end}})),note:String(f.get('note')??''),confirmed:f.get('confirmed')==='on'}))onClose()}}>
      <h2>Review selected draft changes</h2><p>Existing availability, qualifications and closing duties will be checked. If any change fails, this entire group stays as it was.</p>
      {proposals.map(p=><article key={p.source.id}><strong>{name(p.source.ownerId)} · {p.source.data.position}</strong><p>Before: {displayTime(p.source.data.start,w.location.timezone)} → {displayTime(p.source.data.end,w.location.timezone)}</p><p>After: {name(p.personId)} · {p.position}<br/>{displayTime(p.start,w.location.timezone)} → {displayTime(p.end,w.location.timezone)}</p></article>)}
      <label className="shared-field">Reason for these draft changes<textarea name="note" required maxLength={2000} disabled={busy}/></label><label className="shared-check"><input type="checkbox" name="confirmed" required disabled={busy||stale}/>I reviewed these draft changes and the people affected.</label>
      <div className="shared-actions"><button className="shared-primary" disabled={busy||stale}>Save selected drafts</button><button type="button" disabled={busy} onClick={()=>setStep('edit')}>Back to editing</button></div>
    </form>}
  </section>;
}
