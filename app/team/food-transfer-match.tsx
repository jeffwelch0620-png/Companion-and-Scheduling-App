'use client';
import {useEffect,useState} from 'react';
import type {FoodPage} from '../shared/food-contract';
import type {FoodTransfer,TransferDetail} from '../shared/food-transfer';
import {transferPending} from '../shared/food-transfer';
import {destinationPackRatio,type TransferItemMatch} from '../shared/food-transfer-match';
import {has,type RecordOf,type Workspace} from '../shared/types';
import {displayTime} from '../shared/local-time';
const qty=(n:number)=>n>0&&n<0.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
type Send=(action:string,input:Record<string,unknown>,r:FoodTransfer)=>void;
export function MatchedItemFacts({match}:{match:TransferItemMatch}){
 const p=match.item.pack;
 return <p><strong>{match.item.title}</strong> · {match.item.controlNumber} · saved item revision {match.item.revision}. Pack: {p.packCount} × {p.unitQty} {p.unitUOM} / {p.purchaseUnit}. One original dispatch unit equals {qty(match.destinationUnitsPerDispatchUnit)} {p.purchaseUnit}.</p>;
}
export function TransferDestinationMatch({d,w,apiRoot,review,send}:{d:FoodTransfer;w:Pick<Workspace,'location'|'me'>;apiRoot:string;review:TransferDetail['destinationMatchReview'];send:Send}){
 const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[after,setAfter]=useState(''),[reload,setReload]=useState(0);
 const [page,setPage]=useState<FoodPage|null>(null),[selected,setSelected]=useState<RecordOf<'fooditem'>|null>(null),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 const mayMatch=d.status!=='voided'&&d.destinationId===w.location.id&&(has(w.me,'location.manage')||has(w.me,'orders.review'));
 const resetChoice=()=>{setSelected(null);setConfirmed(false)};
 useEffect(()=>{
  if(!open||!mayMatch)return;
  const abort=new AbortController();setPage(null);setSelected(null);setConfirmed(false);setError('');
  const params=new URLSearchParams({locationId:w.location.id,dataset:d.dataset,kind:'fooditem',q:query,after});
  void fetch(apiRoot+'/food?'+params,{signal:abort.signal}).then(async response=>{
   const raw:unknown=await response.json();if(abort.signal.aborted)return;
   if(!raw||typeof raw!=='object')throw new Error('Destination items could not be verified.');
   const value=raw as Partial<FoodPage>&{error?:string};
   if(!response.ok)throw new Error(value.error??'Destination items could not be loaded.');
   if(!Array.isArray(value.records)||(value.next!==null&&typeof value.next!=='string'))throw new Error('Destination items could not be verified.');
   setPage(value as FoodPage);
  }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Destination items could not be loaded.')});return()=>abort.abort();
 },[open,mayMatch,w.location.id,d.dataset,apiRoot,query,after,reload]);
 const candidates=page?.records.filter((r):r is RecordOf<'fooditem'>=>r.kind==='fooditem'&&r.locationId===w.location.id&&r.data.source.dataset===d.dataset)??[];
 const match=d.destinationMatch;
 let ratio:number|null=null,issue='';if(selected){try{ratio=destinationPackRatio(d.dispatch,selected.data)}catch(e){issue=e instanceof Error?e.message:'Check the packs.'}}
 return <section aria-label="Destination item match"><h3>Destination item match</h3>
  {match?<><MatchedItemFacts match={match}/><p>Checked by {match.byName} on {displayTime(match.at,w.location.timezone)}: {match.reason}</p>
   {review!=='current'&&<p className="food-warning">The destination catalog has changed or this item is unavailable. The saved match is historical; a purchasing reviewer should check it again.</p>}
   {d.receipt&&<p>Equivalent quantities using the saved pack: accepted {qty(d.receipt.accepted*match.destinationUnitsPerDispatchUnit)}, rejected {qty(d.receipt.rejected*match.destinationUnitsPerDispatchUnit)}, {d.receipt.complete===false?'pending':'missing'} {qty((d.receipt.complete===false?transferPending(d.dispatch,d.receipt):d.receipt.missing)*match.destinationUnitsPerDispatchUnit)} {match.item.pack.purchaseUnit}. These are transfer quantities, not a physical stock count.</p>}
  </>:<p>No destination catalog item has been matched. The original dispatch quantities remain readable and receiving can continue.</p>}
  <p>A match applies to this transfer only. It does not change either catalog, physical counts, prices or the original dispatch unit.</p>
  {mayMatch&&<><button type="button" onClick={()=>{setOpen(!open);resetChoice()}}>{open?'Close item matching':match?'Review or change destination item':'Match destination item'}</button>
   {open&&<><form className="shared-actions" onSubmit={e=>{e.preventDefault();resetChoice();setQuery(search.trim());setAfter('');setReload(n=>n+1)}}><label className="shared-field">Search this restaurant's items<input value={search} maxLength={100} onChange={e=>{setSearch(e.target.value);resetChoice()}} placeholder="Item name or control number"/></label><button>Search destination items</button></form>
    {error&&<p role="alert">{error}</p>}{!page&&!error&&<p role="status">Loading destination items…</p>}
    {page&&<><p>{page.records.length} shown · {page.total} matching records. Choose the same goods; matching names or compatible units alone do not establish item identity.</p>
     {candidates.map(r=>{let problem='';try{destinationPackRatio(d.dispatch,r.data)}catch(e){problem=e instanceof Error?e.message:'Pack needs review.'}return <div key={r.id}><strong>{r.data.title}</strong> · {r.data.controlNumber} · {r.data.packCount??'?'} × {r.data.unitQty??'?'} {r.data.unitUOM} / {r.data.purchaseUnit}{problem?<p className="shared-muted">{problem}</p>:<button type="button" aria-pressed={selected?.id===r.id} onClick={()=>{setSelected(r);setConfirmed(false)}}>Choose {r.data.title} ({r.data.controlNumber})</button>}</div>})}
     {!candidates.length&&<p>No destination items on this page.</p>}
     <div className="shared-actions">{after&&<button type="button" onClick={()=>{resetChoice();setAfter('')}}>First item page</button>}{page.next&&<button type="button" onClick={()=>{resetChoice();setAfter(page.next!)}}>Next 20 destination items</button>}</div>
    </>}
    {selected&&<form onSubmit={e=>{e.preventDefault();if(!confirmed||ratio===null)return;const f=new FormData(e.currentTarget);send('transfer.match-item',{itemId:selected.id,itemRevision:selected.revision,reason:f.get('reason'),confirmed},d)}}>
     <h4>Check match: {selected.data.title}</h4><p>Original dispatch: {qty(d.dispatch.quantity)} {d.dispatch.item.pack.purchaseUnit}. {ratio!==null&&<>Equivalent to {qty(d.dispatch.quantity*ratio)} {selected.data.purchaseUnit} in the selected destination pack.</>}</p>{issue&&<p role="alert">{issue}</p>}
     <label className="shared-field">Evidence or correction reason<textarea name="reason" required maxLength={1000} onChange={()=>setConfirmed(false)}/></label>
     <label className="food-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that this record describes the same goods and verified both count packs.</label><button className="shared-primary" disabled={!confirmed||ratio===null}>Save destination item match</button>
    </form>}
   </>}
   {match&&<details><summary>Clear an incorrect item match</summary><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);send('transfer.clear-item-match',{reason:f.get('reason')},d)}}><label className="shared-field">Reason for clearing match<textarea name="reason" required maxLength={1000}/></label><button>Clear destination match and retain history</button></form></details>}
  </>}
 </section>;
}
