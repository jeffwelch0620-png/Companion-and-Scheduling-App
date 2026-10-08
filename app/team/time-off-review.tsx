'use client';
import {useState} from 'react';
import type {RecordOf,Workspace} from '../shared/types';
import {timeOffShifts} from '../shared/time-off-impact';
import {canChangePublished} from '../shared/schedule-policy';
import {displayTime} from '../shared/local-time';
import type {Send} from './workspace';

export function TimeOffReview({w,request,send,onError}:{w:Workspace;request:RecordOf<'request'>;send:Send;onError:(message:string)=>void}){
 const shifts=timeOffShifts(w.records,request);
 // Keep the review snapshot fixed until the manager explicitly reloads it.
 const [snapshot,setSnapshot]=useState(()=>shifts.map(s=>({id:s.id,revision:s.revision})));
 const [confirmed,setConfirmed]=useState(false);
 const stale=snapshot.length!==shifts.length||snapshot.some(s=>!shifts.some(current=>current.id===s.id&&current.revision===s.revision));
 const blocked=shifts.some(s=>!!s.data.releasedAt||s.data.published&&!canChangePublished(w,w.me,s.area,s.data));
 return <form onSubmit={async e=>{e.preventDefault();const button=(e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null,approve=button?.value==='approve',data=new FormData(e.currentTarget);if(approve&&(stale||blocked||shifts.length&&!confirmed)){onError('Review the affected shifts and schedule authority before approving.');return}await send('request.review',{approve,note:String(data.get('note')??''),...(approve?{affectedShifts:snapshot}:{})},request)}}>
  <section aria-label="Time-off schedule impact"><h3>What approval changes</h3>{shifts.length?<><p>Approving cancels these entire shifts, even if the requested time off covers only part of a shift.</p><ul>{shifts.map(s=><li key={s.id}><strong>{s.data.position} · {s.data.published?'Published':'Draft'}</strong><br/>{displayTime(s.data.start,w.location.timezone)} → {displayTime(s.data.end,w.location.timezone)}</li>)}</ul><p>A replacement is not assigned automatically. Arrange coverage separately.</p></>:<p>No saved shifts overlap this request.</p>}</section>
  {blocked&&<p role="alert">An affected shift has been checked out or needs its assigned leader to make a published schedule change. Resolve that before approving time off.</p>}
  {stale&&<p role="alert">The affected shifts changed. <button type="button" onClick={()=>{setSnapshot(shifts.map(s=>({id:s.id,revision:s.revision})));setConfirmed(false)}}>Review updated shifts</button></p>}
  {!!shifts.length&&<label className="shared-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the shifts that approval will cancel.</label>}
  <label className="shared-field">Review note<textarea name="note" required maxLength={2000}/></label>
  <div className="shared-actions"><button value="decline">Return / decline</button><button value="approve" className="shared-primary" disabled={stale||blocked||!!shifts.length&&!confirmed}>Approve time off</button></div>
 </form>;
}
