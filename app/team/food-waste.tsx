'use client';
import {useState} from 'react';
import {wasteReasons} from '../shared/food-waste';
import type {FoodHistoryPage} from '../shared/food-contract';
import {personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime} from '../shared/local-time';
import type {Send} from './workspace';
import {WasteCostNote} from './food-waste-report';

export function WasteForm({r,send,busy,onSaved}:{r:RecordOf<'fooditem'>;send:Send;busy:boolean;onSaved:()=>void}){
 const [reason,setReason]=useState('');
 return <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await send('fooditem.waste',{quantity:f.get('quantity'),reason:f.get('reason'),note:f.get('note'),confirmed:f.get('confirmed')==='on'},r))onSaved()}}><fieldset disabled={busy}><h3>Record discarded food</h3>
  <p>Use {r.data.purchaseUnit||'the counting unit'}; fractions are allowed. This records waste separately and keeps the last physical count unchanged. Take a fresh count when you need an updated on-hand quantity. The entry saves the current supplier price and pack basis for an estimate; incomplete or incompatible costs stay unknown.</p>
  <div className="food-controls"><label className="shared-field">Waste quantity in {r.data.purchaseUnit||'counting units'}<input name="quantity" type="number" min="0" max="1000000" step="any" required placeholder="Quantity discarded"/></label>
  <label className="shared-field">Waste reason<select name="reason" value={reason} onChange={e=>setReason(e.target.value)} required><option value="">Choose a reason</option>{Object.entries(wasteReasons).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
  <label className="shared-field">Waste note{reason==='other'?' (required)':''}<textarea name="note" maxLength={1000} required={reason==='other'} placeholder="What happened?"/></label>
  <label className="food-check"><input type="checkbox" name="confirmed" required/>I confirmed the discarded quantity in the stated unit.</label>
  <button className="shared-primary" disabled={!r.data.purchaseUnit}>Save waste entry</button>
 </fieldset></form>;
}

export function WasteHistory({entry,r,w,send,busy}:{entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean}){
 const [correcting,setCorrecting]=useState(false),waste=entry.event.waste;
 if(!waste)return null;
 return <div className="food-waste-history"><p><strong>Waste entry {entry.revision}: {waste.quantity} {waste.pack.purchaseUnit}</strong> · {wasteReasons[waste.reason]} · Pack at entry: {waste.pack.packCount??'?'} × {waste.pack.unitQty??'?'} {waste.pack.unitUOM||'unit unknown'}. Physical count unchanged.</p>
  <WasteCostNote waste={waste} invalid={entry.wastePriceSourceVoided}/>
  {entry.voided?<p><strong>Voided</strong> by {personName(w,entry.voided.by)} on {displayTime(entry.voided.at,w.location.timezone)}: {entry.voided.reason}. Original entry retained.</p>:<><button disabled={busy} onClick={()=>setCorrecting(!correcting)}>{correcting?'Keep this entry':'Void incorrect waste entry'}</button>
  {correcting&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('fooditem.waste-void',{wasteRevision:entry.revision,reason:f.get('reason')},r)}}><fieldset disabled={busy}><p>Void only an incorrect entry. The original stays in history; record the correct quantity separately if needed.</p><label className="shared-field">Reason for voiding waste<textarea name="reason" required maxLength={1000}/></label><button>Confirm void</button></fieldset></form>}</>}
 </div>;
}
