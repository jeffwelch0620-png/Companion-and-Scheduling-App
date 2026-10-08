'use client';
import {useState} from 'react';
import {ExtraGoodsReturns} from './food-excess-return';
import {ExtraBillingPicker} from './food-excess-billing';
import {parseExcess} from '../shared/food-excess';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
type Props={entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean};
const qty=(n:number)=>n>0&&n<.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function InvoiceExcess({entry,r,w,send,busy}:Props){
 const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),today=localDate(new Date().toISOString(),w.location.timezone);
 const [input,setInput]=useState({deliveryReference:'',observedDate:today,quantity:'',evidence:'',goodsLocation:''});
 const invoice=entry.event.invoiceLine;if(!invoice||entry.invoiceVoided)return null;
 const used=entry.invoiceReceiving??{entries:0,accepted:0,rejected:0},totals=entry.invoiceExcess??{entries:0,quantity:0};
 const accounted=Math.abs(invoice.quantity-used.accepted-used.rejected)<=Number.EPSILON*Math.max(1,invoice.quantity)*8;
 const update=(key:keyof typeof input,value:string)=>{setInput(v=>({...v,[key]:value}));setConfirmed(false)};
 const values={...input,invoiceRevision:entry.revision,invoiceUnit:invoice.invoiceUnit};
 let issue='';try{parseExcess({...values,confirmed:true},invoice,used,new Date().toISOString(),w.me.id,w.location.timezone)}catch(e){issue=e instanceof Error?e.message:'Review this entry.'}
 return <section className="food-waste-history"><h4>Extra goods beyond this invoice</h4>
  <p>{totals.entries} active extra-goods {totals.entries===1?'entry':'entries'} · {qty(totals.quantity)} {invoice.invoiceUnit} extra. Separate from invoiced acceptance/rejection, physical stock and supplier balances. These are recorded observations, not a supplier settlement.</p>
  <p>{qty(entry.invoiceExcessReturns?.quantity??0)} {invoice.invoiceUnit} of these extra goods have recorded supplier returns. Pickup records are separate from credits or settlement.</p>
  {!accounted?<p>Complete the invoiced quantity checks before recording additional goods. A different or substitute item needs separate review.</p>:<button disabled={busy} onClick={()=>{setOpen(!open);setConfirmed(false)}}>{open?'Close extra goods form':'Record extra goods'}</button>}
  {open&&accounted&&<form onSubmit={async e=>{e.preventDefault();await send('fooditem.excess',{...values,confirmed},r)}}><fieldset disabled={busy}>
   <label className="shared-field">Delivery reference<input required maxLength={150} value={input.deliveryReference} onChange={e=>update('deliveryReference',e.target.value)}/></label>
   <label className="shared-field">Actual delivery date<input required type="date" max={today} value={input.observedDate} onChange={e=>update('observedDate',e.target.value)}/></label>
   <label className="shared-field">Extra quantity ({invoice.invoiceUnit})<input required type="number" min="0" max="1000000" step="any" value={input.quantity} onChange={e=>update('quantity',e.target.value)}/></label>
   <label className="shared-field">Evidence of extra goods<textarea required maxLength={1000} value={input.evidence} onChange={e=>update('evidence',e.target.value)}/></label>
   <label className="shared-field">Where the extra goods are now<textarea required maxLength={1000} value={input.goodsLocation} onChange={e=>update('goodsLocation',e.target.value)}/></label>
   {issue&&<p className="shared-muted">{issue}</p>}<label className="food-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that these are additional goods for this same invoice item, in {invoice.invoiceUnit}, beyond all quantities already recorded.</label>
   <button className="shared-primary" disabled={!!issue||!confirmed}>Save extra goods observation</button>
  </fieldset></form>}
 </section>;
}
export function ExcessHistory({entry,r,w,send,busy,apiRoot='/api'}:Props&{apiRoot?:string}){
 const [correcting,setCorrecting]=useState(false),extra=entry.event.excess;if(!extra)return null;
 const mayVoid=extra.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review');
 return <div className="food-waste-history"><h4>Extra goods · {extra.deliveryReference} · {extra.observedDate}</h4>
  <p>Invoice {extra.invoice.invoiceNumber} · line {extra.invoice.lineReference} · {extra.invoice.sku.vendor}: <strong>{qty(extra.quantity)} {extra.invoice.invoiceUnit} extra</strong> ({qty(extra.supplierPacks)} {extra.invoice.sku.purchaseUnit}).</p>
  <p>Original supplier pack: {extra.invoice.sku.packCount??'?'} × {extra.invoice.sku.unitQty??'?'} {extra.invoice.sku.unitUOM} / {extra.invoice.sku.purchaseUnit}. Invoiced checks at entry: {qty(extra.receivingAtEntry.accepted)} accepted, {qty(extra.receivingAtEntry.rejected)} rejected {extra.invoice.invoiceUnit}.</p>
  <p className="food-preserve">Evidence: {extra.evidence}</p><p className="food-preserve">Goods location reported at entry: {extra.goodsLocation}</p>
  <p>Recorded by {personName(w,extra.by)} on {displayTime(extra.at,w.location.timezone)}. No stock, invoice amount, return or credit adjustment.</p>
  <ExtraGoodsReturns entry={entry} r={r} w={w} send={send} busy={busy}/>
  <ExtraBillingPicker key={w.location.id+':'+w.me.id+':'+r.id+':'+r.revision+':'+entry.revision} entry={entry} r={r} w={w} send={send} busy={busy} apiRoot={apiRoot}/>
  {!!entry.excessBilled?.entries&&<p>Billing matches protect this source. Correct incorrect matches before voiding the extra delivery.</p>}
  {!!entry.excessReturned?.entries&&<p>Actual pickups are linked to this observation. Correct only incorrect linked pickup records before voiding their source.</p>}
  {entry.excessVoided?<p><strong>Extra goods entry voided</strong>: {entry.excessVoided.reason}. Original retained; excluded from active extra totals.</p>:mayVoid&&<><button disabled={busy||!!entry.excessReturned?.entries||!!entry.excessBilled?.entries} onClick={()=>setCorrecting(!correcting)}>{correcting?'Keep this entry':'Void incorrect extra goods entry'}</button>{correcting&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('fooditem.excess-void',{excessRevision:entry.revision,reason:f.get('reason')},r)}}><fieldset disabled={busy}><p>A later pickup or supplier settlement does not erase the actual delivery. Use void only to correct a recording error.</p><label className="shared-field">Reason<textarea name="reason" required maxLength={1000}/></label><button>Confirm extra goods void</button></fieldset></form>}</>}
 </div>;
}
