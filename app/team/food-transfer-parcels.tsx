'use client';
import {useState} from 'react';
import type {FoodTransfer} from '../shared/food-transfer';
import {parcelTotals,type TransferParcel} from '../shared/food-transfer-parcels';
import {has,type Workspace} from '../shared/types';
import {displayTime,localDate,localClock} from '../shared/local-time';
import {transferFormTimestamp as timestamp} from '../shared/food-transfer-time';
export {transferLocalTimestamp as parcelLocalTimestamp} from '../shared/food-transfer-time';

type Send=(action:string,input:Record<string,unknown>,d:FoodTransfer)=>void;
const qty=(n:number)=>n>0&&n<0.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
const field=(f:FormData,n:string)=>String(f.get(n)??'');
export function TransferTimeFields({zone,label='Restaurant'}:{zone:string;label?:string}){
 const now=new Date().toISOString();
 return <><label className="shared-field">{label} date ({zone})<input type="date" name="date" required defaultValue={localDate(now,zone)}/></label><label className="shared-field">{label} time<input type="time" name="time" step="1" required defaultValue={localClock(now,zone)+':'+now.slice(17,19)}/></label><label className="shared-field">Repeated clock hour<select name="occurrence" defaultValue=""><option value="">Normal time / choose if repeated</option><option value="earlier">First occurrence</option><option value="later">Second occurrence</option></select></label></>;
}
export function ParcelFacts({p,unit,zone}:{p:TransferParcel;unit:string;zone:string}){
 return <><p><strong>Trip {p.tripReference} · Parcel {p.parcelReference}</strong> · {qty(p.quantity)} {unit} · {p.void?'Voided record':p.arrival?'Arrival recorded':'Awaiting arrival record'}</p><p>Departed {displayTime(p.departedAt,zone)} · recorded by {p.recorded.byName}. {p.note}</p>{p.arrival&&<p>Arrived {displayTime(p.arrival.arrivedAt,zone)} · recorded by {p.arrival.byName}. {p.arrival.note}</p>}{p.void&&<p>Voided by {p.void.byName}: {p.void.reason}</p>}</>;
}
export function TransferParcels({d,w,send}:{d:FoodTransfer;w:Pick<Workspace,'location'|'me'>;send:Send}){
 const [error,setError]=useState(''),totals=parcelTotals(d),unit=d.dispatch.item.pack.purchaseUnit,zone=w.location.timezone,source=w.location.id===d.sourceId,destination=w.location.id===d.destinationId,reviewer=has(w.me,'location.manage')||has(w.me,'orders.review'),active=d.status!=='voided';
 function submit(action:string,f:FormData,extra:Record<string,unknown>={}){
  setError('');try{send(action,{...extra,note:field(f,'note'),reason:field(f,'reason'),confirmed:f.get('confirmed')==='on',...(action==='transfer.parcel-depart'?{tripReference:field(f,'trip'),parcelReference:field(f,'parcel'),quantity:field(f,'quantity'),departedAt:timestamp(f,zone)}:action==='transfer.parcel-arrive'?{arrivedAt:timestamp(f,zone)}:{})},d)}catch(e){setError(e instanceof Error?e.message:'Check the parcel fields.')}
 }
 const needsReview=!!d.receipt&&(totals.arrived>d.receipt.accepted+d.receipt.rejected+Number.EPSILON*Math.max(1,d.dispatch.quantity)*8||(d.parcels??[]).some(p=>!p.void&&p.arrival&&p.arrival.arrivedAt>d.receipt!.receivedAt));
 return <section aria-label="Trip and parcel tracking"><h3>Trips and parcels</h3>
  <p>Record each identified parcel once in the original {unit} unit. Use separate parcel references for goods arriving separately. Arrival confirms the entire identified parcel reached this restaurant; check accepted, rejected and missing quantities in the destination check separately.</p>
  <p>These transport records do not change receiving totals, physical counts, prices or payments. Voiding or reopening corrects a record; it does not cancel transport or move goods.</p>
  {error&&<p role="alert" className="food-warning">{error}</p>}
  <div className="food-summary"><span>Assigned to parcels<strong>{qty(totals.departed)} {unit}</strong></span><span>Arrival recorded<strong>{qty(totals.arrived)} {unit}</strong></span><span>Awaiting arrival record<strong>{qty(totals.awaitingArrival)} {unit}</strong></span></div>
  <p>{qty(totals.unassigned)} {unit} of the dispatch have no parcel assignment. No parcel assignment does not mean goods are missing.</p>
  {needsReview&&<p className="food-warning">Parcel arrival evidence is newer than, or exceeds, the last destination check. Reconcile that check explicitly; its saved totals have not changed.</p>}
  {!(d.parcels??[]).length&&<p>No trip or parcel records yet.</p>}
  {(d.parcels??[]).map(p=><article key={p.id} className="food-card"><ParcelFacts p={p} unit={unit} zone={zone}/>
   {active&&!p.void&&destination&&!p.arrival&&<details><summary>Record arrival for {p.parcelReference}</summary><form onSubmit={e=>{e.preventDefault();submit('transfer.parcel-arrive',new FormData(e.currentTarget),{parcelId:p.id})}}><div className="food-controls"><TransferTimeFields zone={zone}/><label className="shared-field">Arrival note<textarea name="note" maxLength={1000}/></label></div><label className="food-check"><input name="confirmed" type="checkbox" required/>The entire identified parcel physically arrived. This does not confirm usable quantity.</label><button>Save parcel arrival</button></form></details>}
   {active&&!p.void&&destination&&p.arrival&&(p.arrival.by===w.me.id||reviewer)&&<details><summary>Reopen incorrect arrival</summary><form onSubmit={e=>{e.preventDefault();submit('transfer.parcel-reopen',new FormData(e.currentTarget),{parcelId:p.id})}}><label className="shared-field">Reason for reopening<textarea name="reason" required maxLength={1000}/></label><button>Reopen arrival record</button></form></details>}
   {active&&!p.void&&source&&!p.arrival&&(p.recorded.by===w.me.id||reviewer)&&<details><summary>Void incorrect parcel record</summary><form onSubmit={e=>{e.preventDefault();submit('transfer.parcel-void',new FormData(e.currentTarget),{parcelId:p.id})}}><label className="shared-field">Reason for voiding<textarea name="reason" required maxLength={1000}/></label><button>Void parcel record</button></form></details>}
  </article>)}
  {active&&source&&totals.unassigned>Number.EPSILON*Math.max(1,d.dispatch.quantity)*8&&(d.parcels??[]).length<50&&<details><summary>Record a parcel departure</summary><form onSubmit={e=>{e.preventDefault();submit('transfer.parcel-depart',new FormData(e.currentTarget))}}><div className="food-controls"><label className="shared-field">Trip reference<input name="trip" required maxLength={150}/></label><label className="shared-field">Parcel reference<input name="parcel" required maxLength={150}/></label><label className="shared-field">Parcel quantity in {unit}<input name="quantity" type="number" min="0.000001" max={totals.unassigned} step="any" required/></label><TransferTimeFields zone={zone}/><label className="shared-field">Departure note<textarea name="note" maxLength={1000}/></label></div><label className="food-check"><input name="confirmed" type="checkbox" required/>This parcel actually left and I checked its quantity in the original dispatch unit.</label><button>Save parcel departure</button></form></details>}
  {(d.parcels??[]).length>=50&&<p className="food-warning">This transfer has reached its 50-parcel record limit, including voided records. Existing arrivals and reasoned corrections remain available.</p>}
 </section>;
}
