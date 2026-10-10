import React,{useState} from 'react';
import {submissionMessage} from './checkout-queue-client.mjs';

// Candidate-only recovery controls. A fresh identity is still required at delivery time.
export function SavedSubmissionReview({entries,busy,onRetry,onDiscard,onClear}){
 const [confirm,setConfirm]=useState(null);
 return <section><h2>Saved submissions for this employee</h2>
  <ul>{entries.map(entry=><li key={entry.requestId} style={{marginBottom:16}}>
   <p>{submissionMessage(entry)}</p><p>{entry.command.input.note}</p>
   <p>Saved {new Date(entry.createdAt).toLocaleString()}. Delivery attempts: {entry.attempts}.</p>
   {!['applied','rejected'].includes(entry.status)&&<button disabled={busy} onClick={()=>onRetry(entry)}>Retry original submission</button>}
   <button disabled={busy} onClick={()=>setConfirm(entry.requestId)}>Discard device copy</button>
   {confirm===entry.requestId&&<div><p>Removing the device copy does not cancel work already received by the server. If delivery was uncertain, check current work with the manager before creating another submission.</p>
    <button disabled={busy} onClick={async()=>{await onDiscard(entry);setConfirm(null);}}>Confirm discard</button> <button onClick={()=>setConfirm(null)}>Keep saved work</button></div>}
  </li>)}</ul>
  <p>Retry sends the original work. Current permissions and any changed assignment are checked again. A saved submission does not pass a check or release a shift.</p>
  <button disabled={busy} onClick={()=>setConfirm('clear')}>Clear this employee’s device data</button>
  {confirm==='clear'&&<div><p>This removes this employee’s saved submissions across locations and cached assignments on this preview device. It cannot cancel a submission already received or sign out a hosted account. Review any uncertain delivery with the manager first.</p>
   <button disabled={busy} onClick={async()=>{await onClear();setConfirm(null);}}>Confirm clear device data</button> <button onClick={()=>setConfirm(null)}>Keep device data</button></div>}
 </section>;
}
