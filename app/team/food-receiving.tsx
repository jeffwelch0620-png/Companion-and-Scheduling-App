'use client';
import {useState} from 'react';
import {ReceivingReplacements} from './food-replacement';
import {ReceivingReturn} from './food-return';
import {parseReceiving} from '../shared/food-receiving';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';

type Props={entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean};
const qty=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function InvoiceReceiving({entry,r,w,send,busy}:Props){
 const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),today=localDate(new Date().toISOString(),w.location.timezone);
 const [input,setInput]=useState({deliveryReference:'',receivedDate:today,accepted:'',rejected:'',rejectionReason:'',note:''});
 const invoice=entry.event.invoiceLine;if(!invoice)return null;
 const used=entry.invoiceReceiving??{entries:0,accepted:0,rejected:0},remaining=Math.max(0,invoice.quantity-used.accepted-used.rejected);
 const update=(key:keyof typeof input,value:string)=>{setInput({...input,[key]:value});setConfirmed(false)};
 let issue='';try{parseReceiving({...input,invoiceRevision:entry.revision,confirmed:true},invoice,used,new Date().toISOString(),w.me.id,w.location.timezone)}catch(e){issue=e instanceof Error?e.message:'Review the delivery quantities.'}
 return <section aria-label={`Receiving for invoice ${invoice.invoiceNumber} line ${invoice.lineReference}`}><h4>Delivery check</h4>
  <div className="food-summary"><span>Accepted <strong>{qty(used.accepted)} {invoice.invoiceUnit}</strong></span><span>Rejected <strong>{qty(used.rejected)} {invoice.invoiceUnit}</strong></span><span>Still unaccounted for <strong>{qty(remaining)} {invoice.invoiceUnit}</strong></span></div>
  <p>{used.entries} active receiving {used.entries===1?'entry':'entries'}. Unaccounted quantity may still be arriving or may need checking. Rejected goods need follow-up; recording them does not create a supplier credit. Physical counts stay as dated observations.</p>
  {entry.invoiceVoided?<p>This invoice is voided; receiving is closed.</p>:remaining>Number.EPSILON*Math.max(1,invoice.quantity)*8?<button disabled={busy} onClick={()=>setOpen(!open)}>{open?'Cancel delivery entry':'Record actual delivery'}</button>:<p><strong>Invoice quantity accounted for.</strong> Check any rejected goods separately.</p>}
  {open&&!entry.invoiceVoided&&<form onSubmit={async e=>{e.preventDefault();if(await send('fooditem.receive',{...input,invoiceRevision:entry.revision,confirmed},r))setOpen(false)}}><fieldset disabled={busy}><h4>Receive against the original invoice</h4>
   <p>Use <strong>{invoice.invoiceUnit}</strong> as shown on invoice {invoice.invoiceNumber}, line {invoice.lineReference}. Original pack: {invoice.sku.packCount??'?'} × {invoice.sku.unitQty??'?'} {invoice.sku.unitUOM} per {invoice.sku.purchaseUnit}. Enter only this delivery, not a running total.</p>
   <div className="food-controls"><label className="shared-field">Delivery reference<input required maxLength={150} value={input.deliveryReference} onChange={e=>update('deliveryReference',e.target.value)} placeholder="Ticket number or unique delivery reference"/></label><label className="shared-field">Delivery date<input required type="date" max={today} value={input.receivedDate} onChange={e=>update('receivedDate',e.target.value)}/></label><label className="shared-field">Accepted quantity ({invoice.invoiceUnit})<input required type="number" min="0" max={remaining} step="any" value={input.accepted} onChange={e=>update('accepted',e.target.value)}/></label><label className="shared-field">Rejected quantity ({invoice.invoiceUnit})<input required type="number" min="0" max={remaining} step="any" value={input.rejected} onChange={e=>update('rejected',e.target.value)}/></label></div>
   <label className="shared-field">Reason for rejected goods<textarea maxLength={1000} required={Number(input.rejected)>0} value={input.rejectionReason} onChange={e=>update('rejectionReason',e.target.value)}/></label><label className="shared-field">Receiving note or source reference<textarea maxLength={1000} value={input.note} onChange={e=>update('note',e.target.value)} placeholder="Condition, delivery note location, or a detail for follow-up"/></label>
   {issue&&<p className="shared-muted">{issue}</p>}<label className="food-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked these delivered quantities in {invoice.invoiceUnit}. Zero means none in that category.</label><button className="shared-primary" disabled={!!issue||!confirmed}>Save delivery check</button>
  </fieldset></form>}
 </section>;
}
export function ReceivingHistory({entry,r,w,send,busy}:Props){
 const [correcting,setCorrecting]=useState(false),receipt=entry.event.receiving;if(!receipt)return null;
 const mayVoid=receipt.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review');
 return <div className="food-waste-history"><h4>Delivery {receipt.deliveryReference} · {receipt.receivedDate}</h4><p>Invoice {receipt.invoice.invoiceNumber} · line {receipt.invoice.lineReference} · {receipt.invoice.sku.vendor}</p>
  <p><strong>{qty(receipt.accepted)} {receipt.invoice.invoiceUnit} accepted · {qty(receipt.rejected)} {receipt.invoice.invoiceUnit} rejected</strong>. Equivalent to {qty(receipt.acceptedSupplierPacks)} accepted and {qty(receipt.rejectedSupplierPacks)} rejected {receipt.invoice.sku.purchaseUnit}.</p>
  <p>Original supplier pack: {receipt.invoice.sku.packCount??'?'} × {receipt.invoice.sku.unitQty??'?'} {receipt.invoice.sku.unitUOM} per {receipt.invoice.sku.purchaseUnit}. Entered by {personName(w,receipt.by)} on {displayTime(receipt.at,w.location.timezone)}.</p>
  {receipt.rejectionReason&&<p>Rejected goods: {receipt.rejectionReason}</p>}{receipt.note&&<p className="food-preserve">{receipt.note}</p>}
  <ReceivingReplacements entry={entry} r={r} w={w} send={send} busy={busy}/>
  <ReceivingReturn entry={entry} r={r} w={w} send={send} busy={busy}/>
  {entry.receivingVoided?<p><strong>Receiving entry voided</strong> by {personName(w,entry.receivingVoided.by)} on {displayTime(entry.receivingVoided.at,w.location.timezone)}: {entry.receivingVoided.reason}. Original retained; excluded from receiving totals.</p>:mayVoid&&<><button disabled={busy||!!entry.receivingReturns?.entries||!!entry.receivingReplacements?.entries} onClick={()=>setCorrecting(!correcting)}>{correcting?'Keep this receiving entry':'Void incorrect receiving entry'}</button>{correcting&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('fooditem.receive-void',{receivingRevision:entry.revision,reason:f.get('reason')},r)}}><fieldset disabled={busy}><p>Use this for a recording error. A later return of goods is a separate event and should not erase the original delivery.</p><label className="shared-field">Reason for voiding receipt<textarea name="reason" required maxLength={1000}/></label><button>Confirm receiving void</button></fieldset></form>}</>}
 </div>;
}
