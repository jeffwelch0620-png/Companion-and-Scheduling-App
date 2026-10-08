'use client';
import {useEffect,useRef,useState} from 'react';
import {advanceInvoiceBatch,prepareInvoiceBatch,invoiceBatchLimit,type InvoiceBatch,type InvoiceChoice} from '../shared/invoice-batch';
import type {InvoiceCatalogReview} from '../shared/invoice-catalog-review';
import type {InvoiceFileSource} from '../shared/food-invoice-csv';

export function InvoiceBatchPanel({review,file,choices,apiRoot,disabled,onBusy,onStarted,onChanged}:{review:InvoiceCatalogReview;file:Omit<InvoiceFileSource,'row'>;choices:InvoiceChoice[];apiRoot:string;disabled:boolean;onBusy:(v:boolean)=>void;onStarted:()=>void;onChanged:()=>void}){
 const [sourceNote,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[batch,setBatch]=useState<InvoiceBatch>(),[error,setError]=useState(''),[running,setRunning]=useState(false),[ended,setEnded]=useState(false);
 const active=useRef(false),mounted=useRef(true),lastChoices=useRef(choices);
 useEffect(()=>{if(lastChoices.current!==choices){lastChoices.current=choices;setConfirmed(false)}},[choices]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const run=async(initial:InvoiceBatch)=>{
  if(active.current)return;active.current=true;setRunning(true);onBusy(true);setError('');
  let result=initial;
  try{
   while(mounted.current){
    result=await advanceInvoiceBatch(result,c=>fetch(`${apiRoot}/food`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)}));
    if(!mounted.current)return;
    setBatch(result);
    const remaining=result.lines.find(l=>l.state!=='saved');
    if(!remaining||remaining.state!=='queued')break;
   }
  }finally{
   active.current=false;
   if(mounted.current){setRunning(false);onChanged();if(!result.lines.some(l=>l.state==='uncertain'))onBusy(false)}
  }
 };
 const selected=choices.flatMap(c=>{const entry=review.entries.find(e=>e.row.recordNumber===c.recordNumber),match=entry?.matches.find(m=>m.itemId===c.itemId&&m.skuId===c.skuId);return entry&&match?[{row:entry.row,match}]:[];});
 const uncertain=batch?.lines.some(l=>l.state==='uncertain');
 return <section className="food-card"><h3>Save a reviewed group</h3><p>Select up to {invoiceBatchLimit} lines below. Each line is saved separately in source order. If a save needs attention, the group stops; earlier confirmed saves remain in history. Catalog prices and physical stock stay unchanged.</p>
  {!batch?<form onSubmit={e=>{e.preventDefault();if(active.current||disabled)return;try{const prepared=prepareInvoiceBatch(review,file,choices,sourceNote,confirmed);setBatch(prepared);onStarted();void run(prepared)}catch(e){setError(e instanceof Error?e.message:'Review the selected lines.')}}}><fieldset disabled={disabled||running}>
   <p>{selected.length} selected · ${(selected.reduce((sum,l)=>sum+Math.round(Number(l.row.lineTotal)*100),0)/100).toFixed(2)} net USD</p>
   <ul>{selected.map(l=><li key={l.row.recordNumber}>Record {l.row.recordNumber}: {l.row.invoiceNumber} / {l.row.lineReference} · {l.match.title} ({l.match.controlNumber}) · {l.match.label} · {l.row.quantity} {l.row.invoiceUnit} · ${l.row.lineTotal}</li>)}</ul>
   <label className="shared-field">Group invoice source reference<textarea required maxLength={1000} value={sourceNote} onChange={e=>{setNote(e.target.value);setConfirmed(false)}} placeholder="Where to find this original invoice file and its pages"/></label>
   <p>This reference applies to every selected line; it does not archive the file.</p>
   <label className="food-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>I checked every selected item, supplier pack, unit and net amount against the source invoice.</label>
   <button disabled={!selected.length||!sourceNote.trim()||!confirmed}>Save selected reviewed lines</button>
  </fieldset></form>:<><InvoiceBatchResults batch={batch} running={running}/>{uncertain&&!running&&!ended&&<div><button onClick={()=>void run(batch)}>Retry the same pending line and continue</button><button onClick={()=>{setEnded(true);onBusy(false)}}>End group and review saved lines</button></div>}{!running&&(!uncertain||ended)&&<p>Refresh matches and saved lines before making another selection. Saved source checks will identify completed lines; no unsaved line is silently skipped or retried.</p>}</>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
export function InvoiceBatchResults({batch,running}:{batch:InvoiceBatch;running:boolean}){
 const saved=batch.lines.filter(l=>l.state==='saved').length;
 return <div><p role="status">{saved} of {batch.lines.length} lines confirmed saved.{running?' Saving the next selected line…':''}</p><ul>{batch.lines.map(line=><li key={line.row.recordNumber}>Record {line.row.recordNumber} · {line.row.invoiceNumber} / {line.row.lineReference} · {line.match.title}: <strong>{line.state==='saved'?'Saved':line.state==='uncertain'?'Save not confirmed':line.state==='rejected'?'Needs review':'Not sent'}</strong>{line.message&&<p role="alert">{line.message}</p>}</li>)}</ul></div>;
}
