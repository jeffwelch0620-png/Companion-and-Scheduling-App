'use client';
import {useEffect,useState} from 'react';
import type {ReturnCreditChoices} from '../shared/food-return-credit';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime} from '../shared/local-time';
import type {Send} from './workspace';
type Props={entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean};
const qty=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
function choices(v:unknown):v is ReturnCreditChoices{
 if(!v||typeof v!=='object')return false;const p=v as Record<string,unknown>;
 return typeof p.revision==='number'&&typeof p.returnRevision==='number'&&typeof p.invoiceUnit==='string'&&typeof p.returnQuantity==='number'&&typeof p.matchedQuantity==='number'&&(p.next===null||typeof p.next==='number')&&Array.isArray(p.entries)&&p.entries.every(e=>e&&typeof e==='object'&&['revision','sequence','quantity','matched','amountCents'].every(k=>typeof e[k]==='number')&&['creditNumber','lineReference','creditDate','sourceNote'].every(k=>typeof e[k]==='string'));
}
export function ReturnCreditPicker({entry,r,w,send,busy,apiRoot}:Props&{apiRoot:string}){
 const [open,setOpen]=useState(false),[cursor,setCursor]=useState({before:0,revision:0}),[page,setPage]=useState<ReturnCreditChoices|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[selected,setSelected]=useState(''),[quantity,setQuantity]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>{if(!open)return;const abort=new AbortController();setPage(null);setError('');setSelected('');setQuantity('');setConfirmed(false);
  const params=new URLSearchParams({locationId:w.location.id,dataset:r.data.source.dataset,recordId:r.id,view:'return-credits',returnRevision:String(entry.revision),before:String(cursor.before),revision:String(cursor.revision)});
  void fetch(`${apiRoot}/food?${params}`,{signal:abort.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value&&typeof value==='object'&&'error'in value&&typeof value.error==='string'?value.error:'Could not read issued credits.');if(!choices(value)||value.returnRevision!==entry.revision)throw Error('Unexpected credit response. Refresh before continuing.');if(!abort.signal.aborted)setPage(value)}).catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort();
 },[open,cursor,refresh,apiRoot,w.location.id,r.id,r.data.source.dataset,entry.revision]);
 const returned=entry.event.supplierReturn;if(!returned||entry.supplierReturnVoided)return null;
 const matched=entry.returnMatched??{entries:0,quantity:0},total=returned.accepted+returned.rejected,unit=returned.receiving.invoice.invoiceUnit,canReview=has(w.me,'location.manage')||has(w.me,'orders.review');
 const credit=page?.entries.find(c=>c.revision===Number(selected)),remaining=page?Math.max(0,page.returnQuantity-page.matchedQuantity):0,limit=credit?Math.min(remaining,Math.max(0,credit.quantity-credit.matched)):0;
 const valid=!!credit&&quantity.trim()!==''&&Number.isFinite(Number(quantity))&&Number(quantity)>0&&Number(quantity)<=limit&&note.trim().length>0&&confirmed;
 return <section aria-label={`Credit matches for return ${returned.returnReference}`}><p><strong>{qty(matched.quantity)} of {qty(total)} {unit} matched to issued credit documents</strong> across {matched.entries} active {matched.entries===1?'match':'matches'}. This links quantities only; it does not verify payment or settle a claim.</p>
  {canReview&&<button disabled={busy} onClick={()=>{setOpen(!open);setCursor({before:0,revision:0})}}>{open?'Close credit matching':'Match an issued credit'}</button>}
  {open&&canReview&&<><h4>Match an existing returned-goods credit</h4><p>Only credits already recorded against this same invoice line appear. A shortage or price-only credit cannot establish a returned-goods match. Record a missing issued credit through the invoice history first.</p>
   {error&&<p role="alert">{error}</p>}{!page&&!error&&<p role="status">Loading issued credits…</p>}
   <button disabled={busy} onClick={()=>{setCursor({before:0,revision:0});setRefresh(refresh+1)}}>Refresh eligible credits</button>
   {page&&<form onSubmit={async e=>{e.preventDefault();if(valid&&await send('fooditem.return-credit',{returnRevision:entry.revision,creditRevision:Number(selected),quantity,note,confirmed},r))setOpen(false)}}><fieldset disabled={busy}>
    <p>Unmatched return quantity: {qty(remaining)} {unit}. Original receiving, returned quantity and issued credit amount will stay unchanged.</p>
    {page.entries.length===0?<p>No eligible issued credits on this page.</p>:<><label className="shared-field">Issued supplier credit<select required value={selected} onChange={e=>{setSelected(e.target.value);setQuantity('');setConfirmed(false)}}><option value="">Choose the checked credit document</option>{page.entries.map(c=><option key={c.revision} value={c.revision} disabled={c.quantity-c.matched<=0}>{c.creditNumber} · line {c.lineReference} · {c.creditDate} · {qty(Math.max(0,c.quantity-c.matched))} {unit} unmatched</option>)}</select></label>
     {credit&&<p className="food-preserve">Credit source: {credit.sourceNote}. Document line amount: {new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(credit.amountCents/100)}. No part of this amount is automatically allocated by the quantity match.</p>}
     <label className="shared-field">Quantity matched ({unit})<input required type="number" min="0" max={limit} step="any" value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirmed(false)}}/></label><p>Up to {qty(limit)} {unit} on this match.</p>
     <label className="shared-field">Matching evidence<textarea required maxLength={1000} value={note} onChange={e=>{setNote(e.target.value);setConfirmed(false)}} placeholder="How the issued credit identifies this return, such as its pickup reference and line"/></label>
     <label className="food-check"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that this issued supplier credit covers the selected physical return and quantity.</label><button className="shared-primary" disabled={!valid}>Save checked credit match</button></>}
    <div className="shared-actions">{cursor.before>0&&<button type="button" onClick={()=>setCursor({before:0,revision:0})}>First credit page</button>}{page.next&&<button type="button" onClick={()=>setCursor({before:page.next!,revision:page.revision})}>More issued credits</button>}</div>
   </fieldset></form>}
  </>}
 </section>;
}
export function ReturnCreditHistory({entry,r,w,send,busy}:Props){
 const [voiding,setVoiding]=useState(false),match=entry.event.returnCredit;if(!match)return null;
 const review=has(w.me,'location.manage')||has(w.me,'orders.review');
 return <div className="food-waste-history"><h4>Return {match.returnReference} ↔ credit {match.creditNumber}, line {match.creditLine}</h4><p><strong>{qty(match.quantity)} {match.invoiceUnit} matched</strong> · {match.vendor} · invoice {match.invoiceNumber}, line {match.invoiceLine}. Return dated {match.returnDate}; credit dated {match.creditDate}.</p><p className="food-preserve">Evidence: {match.note}</p><p>Checked by {personName(w,match.by)} on {displayTime(match.at,w.location.timezone)}. Document association only; no payment, credit approval or stock adjustment.</p>
  {entry.returnCreditVoided?<p><strong>Match voided; original retained.</strong> {personName(w,entry.returnCreditVoided.by)}, {displayTime(entry.returnCreditVoided.at,w.location.timezone)}: {entry.returnCreditVoided.reason}.</p>:review&&<><button disabled={busy} onClick={()=>setVoiding(!voiding)}>{voiding?'Keep this match':'Void incorrect credit match'}</button>{voiding&&<form onSubmit={async e=>{e.preventDefault();await send('fooditem.return-credit-void',{matchRevision:entry.revision,reason:new FormData(e.currentTarget).get('reason')},r)}}><fieldset disabled={busy}><label className="shared-field">Reason for voiding match<textarea required name="reason" maxLength={1000}/></label><p>The original return and issued credit stay recorded. Only their quantity association is corrected.</p><button>Confirm match void</button></fieldset></form>}</>}
 </div>;
}
