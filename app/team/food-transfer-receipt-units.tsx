'use client';
import {useState} from 'react';
import type {FoodTransfer,TransferDetail,TransferReceipt} from '../shared/food-transfer';
import {receiptUnitQuantities} from '../shared/food-transfer-receipt-units';
import {transferFormTimestamp} from '../shared/food-transfer-time';
import {TransferTimeFields} from './food-transfer-parcels';
const qty=(n:number)=>n>0&&n<0.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="shared-field">{label}{children}</label>}
export function ReceiptUnitFacts({receipt}:{receipt:TransferReceipt}){
 const source=receipt.quantitySource;if(!source)return null;const p=source.item.pack;
 return <p className="shared-muted">Entered in checked destination units: {qty(source.accepted)} accepted, {qty(source.rejected)} rejected{receipt.complete===false?'':', '+qty(source.missing)+' missing'} {p.purchaseUnit}. {source.item.title} · {source.item.controlNumber} · item revision {source.item.revision} · {p.packCount} × {p.unitQty} {p.unitUOM} / {p.purchaseUnit}. One original dispatch unit = {qty(source.destinationUnitsPerDispatchUnit)} {p.purchaseUnit}. This saved conversion remains with this check even if the catalog match changes.</p>;
}
export function TransferReceiptForm({d,zone,send,correction=false,review}:{d:FoodTransfer;zone:string;send:(action:string,input:Record<string,unknown>,r:FoodTransfer)=>void;correction?:boolean;review?:TransferDetail['destinationMatchReview']}){
 const [complete,setComplete]=useState(d.receipt?.complete!==false),[error,setError]=useState(''),[basis,setBasis]=useState<'dispatch'|'destination'>('dispatch'),[confirmed,setConfirmed]=useState(false);
 const [values,setValues]=useState({accepted:String(d.receipt?.accepted??0),rejected:String(d.receipt?.rejected??0),missing:String(d.receipt?.missing??0)});
 const original=d.dispatch.item.pack.purchaseUnit,match=d.destinationMatch,canUse=!!match&&review==='current',unit=basis==='destination'&&match?match.item.pack.purchaseUnit:original;
 let converted:ReturnType<typeof receiptUnitQuantities>|undefined,issue='';
 if(basis==='destination')try{converted=receiptUnitQuantities({...values,missing:complete?values.missing:0,quantityBasis:basis},d.dispatch,match)}catch(e){issue=e instanceof Error?e.message:'Review the quantities.'}
 return <details open={!correction}><summary>{correction?'Correct receipt':d.receipt?'Update arrivals or finish check':'Record destination check'}</summary>
  <p>Enter cumulative totals for this entire transfer, including earlier arrivals. Sent: {qty(d.dispatch.quantity)} {original}. {d.receipt&&<>Already recorded in original units: {qty(d.receipt.accepted)} accepted and {qty(d.receipt.rejected)} rejected.</>}</p>
  <p>Keep the check open while more goods are expected. Pending goods are not yet missing. A final check accounts for the full dispatch; excess goods and physical returns need separate review.</p>
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setError('');try{if(!confirmed)throw Error('Check the totals and units before saving.');if(basis==='destination'&&!canUse)throw Error('Recheck the destination item match before using its units.');send(correction?'transfer.correct-receipt':d.receipt?'transfer.check-progress':'transfer.receive',{...values,quantityBasis:basis,missing:complete?values.missing:0,complete,receivedAt:transferFormTimestamp(f,zone),reason:String(f.get('reason')??''),note:String(f.get('note')??''),correctionReason:String(f.get('correctionReason')??''),confirmed},d)}catch(e){setError(e instanceof Error?e.message:'Check the delivery quantities and time.')}}}>
   {error&&<p role="alert" className="food-warning">{error}</p>}
   <div onChange={()=>setConfirmed(false)}>
    {canUse?<Field label="Receiving quantity units"><select value={basis} onChange={e=>{setBasis(e.target.value as typeof basis);setValues({accepted:'',rejected:'',missing:''});setError('')}}><option value="dispatch">Original dispatch units — {original}</option><option value="destination">Checked destination units — {match!.item.pack.purchaseUnit}</option></select></Field>:<p>Use original dispatch units. A current reviewed destination item match is needed to enter destination pack quantities.</p>}
    {basis==='destination'&&match&&<><p>Enter {unit} for {match.item.title}, {match.item.pack.packCount} × {match.item.pack.unitQty} {match.item.pack.unitUOM} per {unit}. The full dispatch equals {qty(d.dispatch.quantity*match.destinationUnitsPerDispatchUnit)} {unit}. Changing units clears entered quantities and confirmation.</p>{converted&&<p role="status">Original-unit preview: accepted {qty(converted.accepted)}, rejected {qty(converted.rejected)}{complete?', missing '+qty(converted.missing):''} {original}. Original dispatch totals are checked when saving; current catalog match is rechecked.</p>}{issue&&<p>{issue}</p>}</>}
    <div className="food-controls"><Field label="Delivery check status"><select value={complete?'final':'open'} onChange={e=>setComplete(e.target.value==='final')}><option value="open">More goods expected — keep open</option><option value="final">Final check — account for full dispatch</option></select></Field>
     {(['accepted','rejected'] as const).map(k=><Field key={k} label={'Total '+k+' '+unit}><input name={k} type="number" required min="0" max="1000000" step="any" value={values[k]} onChange={e=>setValues({...values,[k]:e.target.value})}/></Field>)}
     {complete&&<Field label={'Final missing '+unit}><input name="missing" type="number" required min="0" max="1000000" step="any" value={values.missing} onChange={e=>setValues({...values,missing:e.target.value})}/></Field>}
     <TransferTimeFields zone={zone} label="Delivery check"/><Field label="Reason for rejected or missing goods"><textarea name="reason" maxLength={1000} defaultValue={d.receipt?.reason??''}/></Field><Field label="Destination note"><textarea name="note" maxLength={1000}/></Field>{correction&&<Field label="Correction reason"><textarea name="correctionReason" required maxLength={1000}/></Field>}
    </div>
   </div><label className="food-check"><input type="checkbox" name="confirmed" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I verified the cumulative totals in {basis==='destination'?'the checked destination units and their original-unit conversion':'the original dispatch unit'} and whether this check is open or final.</label><button disabled={!confirmed||!!issue||(basis==='destination'&&!canUse)} className="shared-primary">{correction?'Save receipt correction':complete?'Save final destination check':'Save open delivery check'}</button>
  </form>
 </details>;
}
