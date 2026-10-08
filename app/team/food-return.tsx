'use client';
import {ReturnCreditPicker} from './food-return-credit';
import {useState} from 'react';
import {parseSupplierReturn} from '../shared/food-return';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
type Props={entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean};
const qty=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function ReceivingReturn({entry,r,w,send,busy}:Props){
 const today=localDate(new Date().toISOString(),w.location.timezone),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false);
 const [input,setInput]=useState({returnReference:'',returnDate:today,accepted:'',rejected:'',reason:'',evidence:''});
 const receipt=entry.event.receiving;if(!receipt||entry.receivingVoided)return null;
 const used=entry.receivingReturns??{entries:0,accepted:0,rejected:0},accepted=Math.max(0,receipt.accepted-used.accepted),rejected=Math.max(0,receipt.rejected-used.rejected),unit=receipt.invoice.invoiceUnit;
 const update=(key:keyof typeof input,value:string)=>{setInput({...input,[key]:value});setConfirmed(false)};
 let issue='';try{parseSupplierReturn({...input,receivingRevision:entry.revision,confirmed:true},receipt,used,new Date().toISOString(),w.me.id,w.location.timezone)}catch(e){issue=e instanceof Error?e.message:'Review the returned quantities.'}
 return <section aria-label={`Returns for delivery ${receipt.deliveryReference}`}><h4>Actual supplier returns</h4>
  <p>Returned so far: {qty(used.accepted)} {unit} from accepted goods; {qty(used.rejected)} {unit} from rejected goods. {used.entries} active return {used.entries===1?'entry':'entries'}.</p>
  <p>Returns preserve the original delivery and dated physical counts. An issued supplier credit is recorded separately against its invoice; a return does not prove a credit was issued.</p>
  {!!used.entries&&<p>To correct the original delivery, first review its linked returns. Void only incorrect records; keep actual returns in history.</p>}
  {accepted+rejected>Number.EPSILON*Math.max(1,receipt.invoice.quantity)*8?<button disabled={busy} onClick={()=>setOpen(!open)}>{open?'Cancel return entry':'Record actual supplier return'}</button>:<p>All goods from this delivery have a recorded return.</p>}
  {open&&<form onSubmit={async e=>{e.preventDefault();if(await send('fooditem.return',{...input,receivingRevision:entry.revision,confirmed},r))setOpen(false)}}><fieldset disabled={busy}><h4>Record goods already returned</h4>
   <p>Delivery {receipt.deliveryReference} · invoice {receipt.invoice.invoiceNumber}, line {receipt.invoice.lineReference}. Enter only this return in <strong>{unit}</strong>, not a running total.</p>
   <div className="food-controls"><label className="shared-field">Return reference<input required maxLength={150} value={input.returnReference} onChange={e=>update('returnReference',e.target.value)}/></label><label className="shared-field">Actual return date<input required type="date" min={receipt.receivedDate} max={today} value={input.returnDate} onChange={e=>update('returnDate',e.target.value)}/></label><label className="shared-field">Returned from accepted goods ({unit})<input required type="number" min="0" max={accepted} step="any" value={input.accepted} onChange={e=>update('accepted',e.target.value)}/><small>Up to {qty(accepted)} {unit} from this delivery</small></label><label className="shared-field">Returned from rejected goods ({unit})<input required type="number" min="0" max={rejected} step="any" value={input.rejected} onChange={e=>update('rejected',e.target.value)}/><small>Up to {qty(rejected)} {unit} from this delivery</small></label></div>
   <label className="shared-field">Return reason<textarea required maxLength={1000} value={input.reason} onChange={e=>update('reason',e.target.value)}/></label><label className="shared-field">Return evidence<textarea required maxLength={1000} value={input.evidence} onChange={e=>update('evidence',e.target.value)} placeholder="Pickup receipt, supplier return ticket, or where the actual handoff is documented"/></label>
   {issue&&<p className="shared-muted">{issue}</p>}<label className="food-check"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>These goods were physically returned to the supplier. I checked both quantities in {unit}; zero means none in that category.</label><button className="shared-primary" disabled={!!issue||!confirmed}>Save actual return</button>
  </fieldset></form>}
 </section>;
}
export function SupplierReturnHistory({entry,r,w,send,busy,apiRoot}:Props&{apiRoot:string}){
 const [correcting,setCorrecting]=useState(false),returned=entry.event.supplierReturn;if(!returned)return null;
 const receipt=returned.receiving,invoice=receipt.invoice,mayVoid=returned.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review');
 return <div className="food-waste-history"><h4>Supplier return {returned.returnReference} · {returned.returnDate}</h4>
  <p>{invoice.sku.vendor} · delivery {receipt.deliveryReference} · invoice {invoice.invoiceNumber}, line {invoice.lineReference}</p>
  <p><strong>{qty(returned.accepted)} {invoice.invoiceUnit} returned from accepted goods · {qty(returned.rejected)} {invoice.invoiceUnit} returned from rejected goods</strong>. Equivalent to {qty(returned.acceptedSupplierPacks)} and {qty(returned.rejectedSupplierPacks)} {invoice.sku.purchaseUnit}, respectively.</p>
  <p>Original supplier pack: {invoice.sku.packCount??'?'} × {invoice.sku.unitQty??'?'} {invoice.sku.unitUOM} per {invoice.sku.purchaseUnit}.</p><p className="food-preserve">Reason: {returned.reason}</p><p className="food-preserve">Evidence: {returned.evidence}</p>
  <p>Recorded by {personName(w,returned.by)} on {displayTime(returned.at,w.location.timezone)}. Original receiving quantities, physical counts and supplier credits are unchanged.</p>
  <ReturnCreditPicker entry={entry} r={r} w={w} send={send} busy={busy} apiRoot={apiRoot}/>
  {!!entry.returnMatched?.entries&&<p>Correct any incorrect credit matches before voiding this return.</p>}
  {entry.supplierReturnVoided?<p><strong>Supplier return voided</strong> by {personName(w,entry.supplierReturnVoided.by)} on {displayTime(entry.supplierReturnVoided.at,w.location.timezone)}: {entry.supplierReturnVoided.reason}. Original evidence retained; excluded from return totals.</p>:mayVoid&&<><button disabled={busy||!!entry.returnMatched?.entries} onClick={()=>setCorrecting(!correcting)}>{correcting?'Keep this return':'Void incorrect return entry'}</button>{correcting&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('fooditem.return-void',{returnRevision:entry.revision,reason:f.get('reason')},r)}}><fieldset disabled={busy}><p>Correct a recording error only. This does not reverse an actual supplier pickup or a credit document.</p><label className="shared-field">Reason for voiding return<textarea name="reason" required maxLength={1000}/></label><button>Confirm supplier return void</button></fieldset></form>}</>}
 </div>;
}
