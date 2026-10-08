'use client';
import {useEffect,useRef,useState} from 'react';
import type {Workspace} from '../shared/types';
import {localDate,displayTime} from '../shared/local-time';
import {transferManifestCsv,type TransferManifest} from '../shared/food-transfer-manifest';
const qty=(n:number)=>n>0&&n<0.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function TransferManifestView({m,onOpen}:{m:TransferManifest;onOpen?:(id:string)=>void}){
 return <section aria-label="Trip manifest snapshot"><h3>{m.dataset==='demo'?'DEMO — ':''}Trip {m.tripReference}</h3><p>{m.restaurant} · {m.direction} · Departures on {m.date} ({m.timezone})</p><p>Snapshot checked {displayTime(m.generatedAt,m.timezone)} · Food revision {m.revision}. This is recorded transport evidence, not a live dispatch instruction or proof that goods were accepted.</p><p>{m.counts.transfers} transfers · {m.counts.parcels} parcels · {m.counts.arrived} with arrival recorded · {m.counts.awaiting} awaiting an arrival record. These are record counts; unlike quantities are not added.</p>
  {!m.entries.length&&<p>No active parcels match this exact trip reference, departure day and direction. Unrecorded parcels cannot appear here.</p>}
  {m.entries.map(e=><article className="food-card" key={e.id}><h4>{e.item.title} · {e.reference}</h4><p>{e.sourceName} → {e.destinationName} · Transfer revision {e.revision}</p><p>Original pack: {e.item.pack.packCount} × {e.item.pack.unitQty} {e.item.pack.unitUOM} / {e.item.pack.purchaseUnit}. Item {e.item.controlNumber}.</p>
   {e.parcels.map(p=><div key={p.id}><strong>Parcel {p.parcelReference}: {qty(p.quantity)} {e.item.pack.purchaseUnit}</strong><p>Departed {displayTime(p.departedAt,m.timezone)} · {p.arrivedAt?'Arrival recorded '+displayTime(p.arrivedAt,m.timezone):'Awaiting arrival record'}</p></div>)}
   <p>Whole transfer dispatch: {qty(e.dispatched)} {e.item.pack.purchaseUnit}. It may include parcels on other trips or days.</p>
   {e.receipt?<p>Whole transfer destination check ({e.receipt.complete===false?'open':'final'}): {qty(e.receipt.accepted)} accepted, {qty(e.receipt.rejected)} rejected, {e.receipt.complete===false?qty(Math.max(0,e.dispatched-e.receipt.accepted-e.receipt.rejected))+' pending':qty(e.receipt.missing)+' missing'} {e.item.pack.purchaseUnit}. Checked {displayTime(e.receipt.receivedAt,m.timezone)}. These cumulative totals are not attributed to this trip's parcels.</p>:<p>No destination receiving check recorded. Parcel arrival does not establish accepted quantity.</p>}
   {onOpen&&<button type="button" onClick={()=>onOpen(e.id)}>Open transfer {e.reference}</button>}
  </article>)}
 </section>;
}
export function TransferManifestPanel({w,apiRoot,dataset,onOpen}:{w:Pick<Workspace,'location'|'me'>;apiRoot:string;dataset:'demo'|'operating';onOpen:(id:string)=>void}){
 const [trip,setTrip]=useState(''),[date,setDate]=useState(()=>localDate(new Date().toISOString(),w.location.timezone)),[view,setView]=useState('outgoing'),[data,setData]=useState<TransferManifest|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const request=useRef<AbortController|null>(null);
 const invalidate=()=>{request.current?.abort();request.current=null;setData(null);setError('');setLoading(false)};
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(){invalidate();const ctrl=new AbortController();request.current=ctrl;setLoading(true);try{const r=await fetch(apiRoot+'/food/transfers?'+new URLSearchParams({locationId:w.location.id,dataset,manifest:'1',trip,date,view}),{signal:ctrl.signal});const value=await r.json() as TransferManifest & {error?:string};if(ctrl.signal.aborted)return;if(!r.ok)throw Error(value.error??'Manifest could not be loaded.');if(value.kind!=='trip-manifest'||value.locationId!==w.location.id||value.dataset!==dataset||value.complete!==true)throw Error('Manifest scope could not be verified.');setData(value);}catch(e){if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Manifest could not be loaded.');}finally{if(!ctrl.signal.aborted)setLoading(false);}}
 function download(){if(!data)return;const url=URL.createObjectURL(new Blob([transferManifestCsv(data)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='JMAX-'+data.dataset+'-trip-'+data.date+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <details><summary>Review a trip manifest</summary><p>Use the exact trip reference, including letter case and spacing, and the parcel departure day in {w.location.timezone}. This gathers recorded active parcels across transfers; voided records are excluded. Refresh before using a saved snapshot.</p>
  <form onSubmit={e=>{e.preventDefault();void load()}}><div className="food-controls"><label className="shared-field">Exact trip reference<input required maxLength={150} value={trip} onChange={e=>{invalidate();setTrip(e.target.value)}}/></label><label className="shared-field">Departure day<input type="date" required value={date} onChange={e=>{invalidate();setDate(e.target.value)}}/></label><label className="shared-field">Direction<select value={view} onChange={e=>{invalidate();setView(e.target.value)}}><option value="outgoing">Outgoing from this restaurant</option><option value="incoming">Incoming to this restaurant</option></select></label></div><button disabled={loading}>{loading?'Loading manifest…':'Load or refresh manifest'}</button></form>
  {error&&<p role="alert">{error}</p>}{data&&<><button type="button" onClick={download} disabled={!data.entries.length}>Download transport CSV snapshot</button><TransferManifestView m={data} onOpen={id=>{invalidate();onOpen(id)}}/></>}
 </details>;
}
