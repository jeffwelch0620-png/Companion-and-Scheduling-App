'use client';
import {ReplacementReturns} from './food-replacement-return';
import {useState} from 'react';
import {foodManager} from '../shared/food';
import {parseReplacement} from '../shared/food-replacement';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
type Props={entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean};
const qty=(n:number)=>n>0&&n<.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function ReceivingReplacements({entry,r,w,send,busy}:Props){
 const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[input,setInput]=useState({deliveryReference:'',receivedDate:localDate(new Date().toISOString(),w.location.timezone),quantity:'',evidence:''});
 const original=entry.event.receiving;if(!original||!foodManager(w.me)||r.locationId!==w.location.id||entry.receivingVoided||original.rejected<=0)return null;
 const used=entry.receivingReplacements??{entries:0,quantity:0},remaining=Math.max(0,original.rejected-used.quantity),fields={...input,receivingRevision:entry.revision,invoiceUnit:original.invoice.invoiceUnit,confirmed};
 let issue='';try{parseReplacement({...fields,confirmed:true},original,used,new Date().toISOString(),w.me.id,w.location.timezone)}catch(e){issue=e instanceof Error?e.message:'Check replacement details.'}
 const change=(key:keyof typeof input,value:string)=>{setInput({...input,[key]:value});setConfirmed(false)};
 return <section aria-label={`Replacements for delivery ${original.deliveryReference}`}><h4>Accepted replacements for rejected goods</h4><p>{qty(used.quantity)} of {qty(original.rejected)} {original.invoice.invoiceUnit} recorded as replaced in {used.entries} active deliveries. {qty(remaining)} {original.invoice.invoiceUnit} has no accepted replacement recorded.</p><p>This records actual arrivals of the same supplier item and pack. It does not place an order, authorize a substitute, resolve a supplier issue or change stock, original receiving, invoice charges or credits. Actual returns of rejected goods remain separate.</p>
 {remaining>0?<button disabled={busy} onClick={()=>{setOpen(!open);setConfirmed(false)}}>{open?'Close replacement entry':'Record accepted replacement'}</button>:<p>All rejected quantity in this delivery has recorded replacements.</p>}
 {open&&remaining>0&&<form onSubmit={async e=>{e.preventDefault();if(!issue&&confirmed&&await send('fooditem.replacement',fields,r)){setOpen(false);setConfirmed(false);setInput({...input,deliveryReference:'',quantity:'',evidence:''})}}}><fieldset disabled={busy}>
 <p>Check supplier {original.invoice.sku.vendor}, code {original.invoice.sku.vendorSku||'not supplied'}, original pack {original.invoice.sku.packCount??'?'} × {original.invoice.sku.unitQty??'?'} {original.invoice.sku.unitUOM} per {original.invoice.sku.purchaseUnit}. For different items or packs, use a separate reviewed workflow.</p>
 <label className="shared-field">Replacement delivery reference<input required maxLength={150} value={input.deliveryReference} onChange={e=>change('deliveryReference',e.target.value)}/></label>
 <label className="shared-field">Replacement delivery date<input type="date" required min={original.receivedDate} max={localDate(new Date().toISOString(),w.location.timezone)} value={input.receivedDate} onChange={e=>change('receivedDate',e.target.value)}/></label>
 <label className="shared-field">Accepted replacement quantity ({original.invoice.invoiceUnit})<input type="number" required min="0" max={remaining} step="any" value={input.quantity} onChange={e=>change('quantity',e.target.value)}/></label>
 <label className="shared-field">Replacement delivery evidence<textarea required maxLength={1000} value={input.evidence} onChange={e=>change('evidence',e.target.value)}/></label>
 <label className="food-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that these replacements arrived and were accepted as the same supplier item and pack, in {original.invoice.invoiceUnit}.</label>{issue&&<p>{issue}</p>}<button className="shared-primary" disabled={!!issue||!confirmed}>Save accepted replacement</button>
 </fieldset></form>}
 </section>;
}
export function ReplacementHistory({entry,r,w,send,busy}:Props){
 const [correcting,setCorrecting]=useState(false),saved=entry.event.replacement;
 if(!saved||!foodManager(w.me)||r.locationId!==w.location.id)return null;
 const mayVoid=saved.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review'),invoice=saved.receiving.invoice;
 return <div className="food-waste-history"><h4>Accepted replacement {saved.deliveryReference} · {saved.receivedDate}</h4><p><strong>{qty(saved.quantity)} {saved.invoiceUnit} accepted as replacement</strong> for rejected delivery {saved.receiving.deliveryReference} on {saved.receiving.receivedDate}. Original invoice {invoice.invoiceNumber}, line {invoice.lineReference}.</p><p>Supplier {invoice.sku.vendor} · code {invoice.sku.vendorSku||'not supplied'}. Original pack {invoice.sku.packCount??'?'} × {invoice.sku.unitQty??'?'} {invoice.sku.unitUOM} per {invoice.sku.purchaseUnit}; {qty(saved.supplierPacks)} equivalent supplier packs.</p><p className="food-preserve">Evidence: {saved.evidence}</p><p>Recorded by {personName(w,saved.by)} on {displayTime(saved.at,w.location.timezone)}. Original rejection, physical count, returns and credits remain separate.</p>
 <ReplacementReturns entry={entry} r={r} w={w} send={send} busy={busy}/>{!!entry.replacementReturned?.entries&&<p>Actual supplier pickups are linked. Correct incorrect pickup records before voiding their replacement source.</p>}
 {entry.replacementVoided?<p><strong>Replacement voided; original retained.</strong> {entry.replacementVoided.reason} · {personName(w,entry.replacementVoided.by)} · {displayTime(entry.replacementVoided.at,w.location.timezone)}</p>:mayVoid&&<><button disabled={busy||!!entry.replacementReturned?.entries} onClick={()=>setCorrecting(!correcting)}>{correcting?'Keep replacement record':'Void incorrect replacement'}</button>{correcting&&<form onSubmit={async e=>{e.preventDefault();await send('fooditem.replacement-void',{replacementRevision:entry.revision,reason:new FormData(e.currentTarget).get('reason')},r)}}><fieldset disabled={busy}><label className="shared-field">Reason for voiding replacement<textarea name="reason" required maxLength={1000}/></label><p>This corrects the arrival record; a later physical return is not a recording error.</p><button>Confirm replacement void</button></fieldset></form>}</>}
 </div>;
}
