'use client';
import {useState} from 'react';
import {foodManager} from '../shared/food';
import {parseReplacementReturn} from '../shared/food-replacement-return';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
type Props={entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean};
const qty=(n:number)=>n>0&&n<.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function ReplacementReturns({entry,r,w,send,busy}:Props){
 const today=localDate(new Date().toISOString(),w.location.timezone),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false);
 const [input,setInput]=useState({returnReference:'',returnDate:today,quantity:'',reason:'',evidence:''});
 const extra=entry.event.replacement;if(!extra||entry.replacementVoided||!foodManager(w.me)||r.locationId!==w.location.id)return null;
 const used=entry.replacementReturned??{entries:0,quantity:0},remaining=Math.max(0,extra.quantity-used.quantity),unit=extra.receiving.invoice.invoiceUnit;
 const update=(key:keyof typeof input,value:string)=>{setInput(v=>({...v,[key]:value}));setConfirmed(false)};
 const values={...input,replacementRevision:entry.revision,invoiceUnit:unit};let issue='';
 try{parseReplacementReturn({...values,confirmed:true},extra,used,new Date().toISOString(),w.me.id,w.location.timezone)}catch(e){issue=e instanceof Error?e.message:'Review the pickup.'}
 const available=remaining>Number.EPSILON*extra.quantity*8;
 return <section aria-label={`Returns of replacement goods ${extra.deliveryReference}`}><h4>Actual returns of replacement goods</h4>
  <p>{qty(used.quantity)} {unit} returned in {used.entries} active pickup records; {qty(remaining)} {unit} not recorded as returned. This remainder is not an instruction to return goods or a current inventory balance.</p>
  <p>Record a completed supplier pickup only. This does not reopen the original replacement allowance. Further arrivals, supplier approval, credits and settlement need separate review.</p>
  {available?<button disabled={busy} onClick={()=>{setOpen(!open);setConfirmed(false)}}>{open?'Close pickup form':'Record actual replacement goods return'}</button>:<p>All replacement goods in this observation have recorded returns.</p>}
  {open&&available&&<form onSubmit={async e=>{e.preventDefault();if(!issue&&confirmed&&await send('fooditem.replacement-return',{...values,confirmed},r))setOpen(false)}}><fieldset disabled={busy}>
   <p>Enter only this pickup, not a running total. Up to {qty(remaining)} {unit} from replacement delivery {extra.deliveryReference}.</p>
   <label className="shared-field">Supplier pickup reference<input required maxLength={150} value={input.returnReference} onChange={e=>update('returnReference',e.target.value)}/></label>
   <label className="shared-field">Actual return date<input required type="date" min={extra.receivedDate} max={today} value={input.returnDate} onChange={e=>update('returnDate',e.target.value)}/></label>
   <label className="shared-field">Quantity physically returned ({unit})<input required type="number" min="0" max={remaining} step="any" value={input.quantity} onChange={e=>update('quantity',e.target.value)}/></label>
   <label className="shared-field">Return reason<textarea required maxLength={1000} value={input.reason} onChange={e=>update('reason',e.target.value)}/></label>
   <label className="shared-field">Actual pickup evidence<textarea required maxLength={1000} value={input.evidence} onChange={e=>update('evidence',e.target.value)}/></label>
   {issue&&<p className="shared-muted">{issue}</p>}<label className="food-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>These replacement goods were physically returned to the supplier. I checked the quantity in {unit}.</label>
   <button className="shared-primary" disabled={!!issue||!confirmed}>Save actual pickup record</button>
  </fieldset></form>}
 </section>;
}
export function ReplacementReturnHistory({entry,r,w,send,busy}:Props){
 const [correcting,setCorrecting]=useState(false),pickup=entry.event.replacementReturn;if(!pickup||!foodManager(w.me)||r.locationId!==w.location.id)return null;
 const invoice=pickup.replacement.receiving.invoice,mayVoid=pickup.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review');
 return <div className="food-waste-history"><h4>Replacement goods return · {pickup.returnReference} · {pickup.returnDate}</h4>
  <p><strong>{qty(pickup.quantity)} {invoice.invoiceUnit} physically returned</strong> ({qty(pickup.supplierPacks)} {invoice.sku.purchaseUnit}). {invoice.sku.vendor} · replacement delivery {pickup.replacement.deliveryReference} · invoice {invoice.invoiceNumber}, line {invoice.lineReference}.</p>
  <p>Original pack: {invoice.sku.packCount??'?'} × {invoice.sku.unitQty??'?'} {invoice.sku.unitUOM} / {invoice.sku.purchaseUnit}.</p><p className="food-preserve">Reason: {pickup.reason}</p><p className="food-preserve">Pickup evidence: {pickup.evidence}</p>
  <p>Recorded by {personName(w,pickup.by)} on {displayTime(pickup.at,w.location.timezone)}. Original accepted replacement arrivals, invoice receiving, counts, prices and supplier credits remain unchanged.</p>
  {entry.replacementReturnVoided?<p><strong>Pickup record voided</strong> by {personName(w,entry.replacementReturnVoided.by)} on {displayTime(entry.replacementReturnVoided.at,w.location.timezone)}: {entry.replacementReturnVoided.reason}. Original retained; excluded from active return totals.</p>:mayVoid&&<><button disabled={busy} onClick={()=>setCorrecting(!correcting)}>{correcting?'Keep pickup record':'Void incorrect pickup record'}</button>{correcting&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('fooditem.replacement-return-void',{returnRevision:entry.revision,reason:f.get('reason')},r)}}><fieldset disabled={busy}><p>Correct a recording error only. This does not reverse a physical pickup or supplier settlement.</p><label className="shared-field">Reason<textarea name="reason" required maxLength={1000}/></label><button>Confirm pickup record void</button></fieldset></form>}</>}
 </div>;
}
