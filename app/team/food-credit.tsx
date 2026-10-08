'use client';
import {useState} from 'react';
import {creditReasons,parseCredit,type CreditReason} from '../shared/food-credit';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';

const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const qty=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
type Props={entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean};
export function InvoiceCredits({entry,r,w,send,busy}:Props){
 const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),today=localDate(new Date().toISOString(),w.location.timezone);
 const [input,setInput]=useState({creditNumber:'',lineReference:'',creditDate:today,reason:'returned' as CreditReason,quantity:'',amount:'',sourceNote:''});
 const line=entry.event.invoiceLine;if(!line)return null;
 const totals=entry.invoiceCredits??{entries:0,amountCents:0,quantity:0},mayReview=has(w.me,'location.manage')||has(w.me,'orders.review');
 const update=(key:keyof typeof input,value:string)=>{setInput({...input,[key]:value});setConfirmed(false)};
 let issue='';try{parseCredit({...input,invoiceRevision:entry.revision,confirmed:true},line,totals,new Date().toISOString(),w.me.id,w.location.timezone)}catch(e){issue=e instanceof Error?e.message:'Review this supplier credit.'}
 return <section aria-label={`Credits for invoice ${line.invoiceNumber} line ${line.lineReference}`}>
  <p><strong>Recorded supplier credits: {dollars(totals.amountCents)}</strong> across {totals.entries} active entries. Uncredited net line amount: {dollars(line.lineTotalCents-totals.amountCents)}. Returned / short quantity credited: {qty(totals.quantity)} of {qty(line.quantity)} {line.invoiceUnit}.</p>
  {totals.entries>0&&<p>Credit details and any corrections appear in this item’s history, including later pages. These are recorded credit documents, not proof of payment or stock movement. Catalog and recipe prices are unchanged; review a supplier price separately if needed.</p>}
  {!entry.invoiceVoided&&mayReview&&<><button disabled={busy||totals.amountCents>=line.lineTotalCents} onClick={()=>setOpen(!open)}>{open?'Close credit form':'Record issued supplier credit'}</button>
   {open&&<form onSubmit={async e=>{e.preventDefault();if(await send('fooditem.credit',{...input,invoiceRevision:entry.revision,confirmed},r))setOpen(false)}}><fieldset disabled={busy}><h4>Record an issued supplier credit</h4>
    <p>Use the supplier’s actual credit document for invoice {line.invoiceNumber}, line {line.lineReference}. A pending request is not an issued credit. Enter positive net amounts excluding tax and freight; credits above the original line value require separate review.</p>
    <div className="food-controls">
     <label className="shared-field">Supplier credit number<input value={input.creditNumber} onChange={e=>update('creditNumber',e.target.value)} maxLength={100} required/></label>
     <label className="shared-field">Credit line reference<input value={input.lineReference} onChange={e=>update('lineReference',e.target.value)} maxLength={100} required/></label>
     <label className="shared-field">Credit date<input type="date" value={input.creditDate} onChange={e=>update('creditDate',e.target.value)} min={line.invoiceDate} max={today} required/></label>
     <label className="shared-field">Credit reason<select value={input.reason} onChange={e=>{setInput({...input,reason:e.target.value as CreditReason,quantity:''});setConfirmed(false)}}>{Object.entries(creditReasons).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     {input.reason!=='price'&&<label className="shared-field">Credited quantity in {line.invoiceUnit}<input type="number" min="0" max={line.quantity-totals.quantity} step="any" value={input.quantity} onChange={e=>update('quantity',e.target.value)} required/></label>}
     <label className="shared-field">Net credit amount (USD)<input type="number" min=".01" step=".01" max={(line.lineTotalCents-totals.amountCents)/100} value={input.amount} onChange={e=>update('amount',e.target.value)} required/></label>
    </div>
    <p>Quantity uses the original invoice unit ({line.invoiceUnit}), even if today’s catalog pack has changed. Saving does not change a physical count, ship a return, contact the supplier or update accounting.</p>
    <label className="shared-field">Credit source reference<textarea value={input.sourceNote} onChange={e=>update('sourceNote',e.target.value)} maxLength={1000} required placeholder="Where to find the supplier credit document, such as its Drive link and page"/></label>
    <p className="shared-muted">The reference does not upload or verify an attachment.</p>
    {issue?<p className="shared-muted">{issue}</p>:<p role="status">After this credit, uncredited net line amount: {dollars(line.lineTotalCents-totals.amountCents-Math.round(Number(input.amount)*100))}.</p>}
    <label className="food-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>I checked this issued supplier credit against its source document.</label>
    <button className="shared-primary" disabled={!!issue||!confirmed}>Save supplier credit</button>
   </fieldset></form>}
  </>}
 </section>;
}
export function CreditHistory({entry,r,w,send,busy}:Props){
 const [voiding,setVoiding]=useState(false),credit=entry.event.invoiceCredit;if(!credit)return null;
 const mayReview=has(w.me,'location.manage')||has(w.me,'orders.review');
 return <div className="food-waste-history"><p><strong>Supplier credit {credit.creditNumber} · line {credit.lineReference} · {credit.creditDate}</strong><br/>{credit.invoice.sku.vendor} · {creditReasons[credit.reason]} · {dollars(credit.amountCents)} net against invoice {credit.invoice.invoiceNumber}, line {credit.invoice.lineReference}.</p>
  <p>{credit.quantity>0?`${qty(credit.quantity)} ${credit.invoice.invoiceUnit} credited, equivalent to ${qty(credit.supplierPackQuantity)} ${credit.invoice.sku.purchaseUnit}.`:'Price-only adjustment; no quantity credited.'} Original supplier pack: {credit.invoice.sku.vendorSku} · {credit.invoice.sku.packCount??'?'} × {credit.invoice.sku.unitQty??'?'} {credit.invoice.sku.unitUOM} / {credit.invoice.sku.purchaseUnit}.</p>
  <p>Source: {credit.sourceNote}. Catalog price and physical count were not changed.</p>
  {!!entry.creditMatched?.entries&&<p>{qty(entry.creditMatched.quantity)} {credit.invoice.invoiceUnit} matched to physical returns across {entry.creditMatched.entries} active matches. Correct incorrect matches before voiding this credit; their details appear in this history.</p>}
  {entry.creditVoided?<p><strong>Credit entry voided — excluded from totals.</strong> Original retained. {personName(w,entry.creditVoided.by)}, {displayTime(entry.creditVoided.at,w.location.timezone)}: {entry.creditVoided.reason}. This does not cancel the supplier’s credit.</p>:mayReview&&<><button disabled={busy||!!entry.creditMatched?.entries} onClick={()=>setVoiding(!voiding)}>{voiding?'Keep credit entry':'Void incorrect credit entry'}</button>{voiding&&<form onSubmit={async e=>{e.preventDefault();await send('fooditem.credit-void',{creditRevision:entry.revision,reason:new FormData(e.currentTarget).get('reason')},r)}}><fieldset disabled={busy}><p>This corrects the JMAX record and retains the original. It does not cancel or change the supplier’s credit.</p><label className="shared-field">Reason for voiding credit<textarea name="reason" maxLength={1000} required/></label><button>Confirm credit void</button></fieldset></form>}</>}
 </div>;
}
