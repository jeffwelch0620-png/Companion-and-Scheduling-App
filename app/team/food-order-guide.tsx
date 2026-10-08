'use client';
import {useEffect,useRef,useState} from 'react';
import {guideMaxBytes,readOrderGuide,type GuideReview,type GuideStatus} from '../shared/food-order-guide';
const labels:Record<GuideStatus,string>={'source-issue':'Guide needs correction',unmatched:'No exact catalog match',ambiguous:'Multiple catalog matches','unit-conflict':'Purchase unit differs','check-pack':'Identity matched; check pack'};

export function GuideFindings({review,filter='all',offset=0}:{review:GuideReview;filter?:GuideStatus|'all';offset?:number}){
 const entries=review.entries.filter(e=>filter==='all'||e.status===filter).slice(offset,offset+20);
 return <div aria-label="Order-guide findings"><p>{review.table.rows.length} product rows checked; {review.table.sections} section headings and {review.table.blankRows} blank rows excluded. Every product row is checked, including lines with blank or zero old order quantities.</p>
 <p>Matches use supplier and SKU only, ignoring letter case and extra spaces. Descriptions never merge products. Case/each agreement does not verify the contents of a pack.</p>
 {entries.map(e=><article className="food-card" key={e.row}><h4>Row {e.row}: {e.description||'Missing description'}</h4><p><strong>{labels[e.status]}</strong></p><p>{e.section||'No section'} · {e.vendor||'Missing supplier'} · SKU {e.sku||'missing'} · guide unit {e.unit||'missing'}{e.pack?` · guide pack ${e.pack}`:''}</p>
 {e.issues.length>0&&<ul className="food-warning">{e.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
 {e.matches.map(m=><p key={m.itemId+':'+m.skuId}>Catalog: {m.title} ({m.controlNumber}) · {m.pack.purchaseUnit||'unit missing'} · {m.pack.packCount??'?'} × {m.pack.unitQty??'?'} {m.pack.unitUOM||'contents unit missing'}{!m.active?' · Item inactive':''}{!m.available?' · Supplier pack unavailable':''}{m.needsReview?' · Definition needs review':''}</p>)}
 {!e.matches.length&&<p>Reconcile against the shared item definitions and confirmed ordering corrections before adding or replacing an item.</p>}
 <details><summary>Old guide quantities</summary><p>In stock in this file: {e.oldCount||'blank / absent'}. Order in this file: {e.oldOrder||'blank'}. These values do not establish today’s count, a par, or a new order.</p></details></article>)}
 {!entries.length&&<p>No rows in this selection.</p>}</div>;
}

export function FoodOrderGuide({locationId,locationName,dataset,apiRoot,disabled}:{locationId:string;locationName:string;dataset:'demo'|'operating';apiRoot:string;disabled:boolean}){
 const [source,setSource]=useState<{csv:string;fileName:string}|null>(null),[review,setReview]=useState<GuideReview|null>(null),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[reading,setReading]=useState(false),[checking,setChecking]=useState(false),[filter,setFilter]=useState<GuideStatus|'all'>('all'),[offset,setOffset]=useState(0);
 const generation=useRef(0),abort=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>{generation.current++;abort.current?.abort()},[]);
 const invalidate=()=>{generation.current++;abort.current?.abort();setReview(null);setConfirmed(false);setError('');setChecking(false);setReading(false);setOffset(0)};
 const check=async()=>{
  if(!source||!confirmed||disabled)return;
  const current=++generation.current,controller=new AbortController();abort.current?.abort();abort.current=controller;setChecking(true);setReview(null);setError('');
  try{
   const response=await fetch(`${apiRoot}/food/order-guide-review`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({locationId,dataset,...source,confirmed:true})}),raw:unknown=await response.json();
   const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
   if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'Guide review failed.');
   if(value.locationId!==locationId||value.dataset!==dataset||!Array.isArray(value.entries)||!value.table||!value.totals||typeof value.sha256!=='string')throw new Error('Unexpected guide response. Review the file again.');
   if(generation.current===current){setReview(value as GuideReview);setOffset(0);setFilter('all')}
  }catch(e){if(generation.current===current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Guide review failed.')}
  finally{if(generation.current===current)setChecking(false)}
 };
 const total=review?.entries.filter(e=>filter==='all'||e.status===filter).length??0;
 return <details className="food-card"><summary>Review an order guide against food items</summary>
 <p>Use a CSV export of the Bert’s or Rudd’s Simple sheet, with its original headings. The review compares supplier codes and purchase units with this restaurant’s saved Food catalog.</p>
 <p>Old stock, order quantities and guide prices are not imported. Supplier carts, physical counts and target stock levels remain separate.</p>
 <fieldset disabled={disabled||checking}><label className="shared-field">Order-guide CSV<input ref={input} type="file" accept=".csv,text/csv" onChange={async e=>{
  invalidate();setSource(null);const file=e.target.files?.[0],current=generation.current;if(!file)return;setReading(true);
  try{if(file.size>guideMaxBytes)throw new Error('Use a UTF-8 CSV no larger than 256 KiB.');const csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());readOrderGuide(csv);if(generation.current===current)setSource({csv,fileName:file.name})}
  catch(e){if(generation.current===current)setError(e instanceof Error?e.message:'Cannot read guide.')}
  finally{if(generation.current===current)setReading(false)}
 }}/></label>
 {source&&<><p><strong>{source.fileName}</strong> → {locationName} · {dataset==='demo'?'Demo / training':'Actual restaurant definitions'}</p><label className="food-check"><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);setReview(null)}}/>I checked that this guide belongs to {locationName}. Its layout and filename alone do not confirm the restaurant.</label><button type="button" disabled={!confirmed||reading} onClick={()=>void check()}>Compare guide with this catalog</button></>}
 <button type="button" onClick={()=>{invalidate();setSource(null);if(input.current)input.current.value=''}}>Clear guide review</button></fieldset>
 {reading&&<p role="status">Reading the guide…</p>}{checking&&<p role="status">Checking the selected restaurant’s catalog…</p>}{error&&<p role="alert" className="food-warning">{error}</p>}
 {review&&<section aria-label="Order-guide comparison"><h3>{review.fileName}</h3><p role="status">Review complete for {locationName} · {dataset} · {new Date(review.checkedAt).toLocaleString()}. No records changed.</p>
 <label className="shared-field">Show findings<select value={filter} onChange={e=>{setFilter(e.target.value as GuideStatus|'all');setOffset(0)}}><option value="all">All product rows ({review.entries.length})</option>{(Object.keys(labels) as GuideStatus[]).map(s=><option key={s} value={s}>{labels[s]} ({review.totals[s]})</option>)}</select></label>
 <GuideFindings review={review} filter={filter} offset={offset}/>
 <p>Showing {total?offset+1:0}–{Math.min(offset+20,total)} of {total} rows.</p><button type="button" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-20))}>Previous guide rows</button><button type="button" disabled={offset+20>=total} onClick={()=>setOffset(n=>n+20)}>More guide rows</button>
 <p><a download="JMAX-Order-Guide-Review.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(review,null,2))}>Download all findings</a></p><details><summary>Source check</summary><p className="food-preserve">CSV SHA-256: {review.sha256}</p><p>This identifies the uploaded CSV, not the original workbook. Saved Food definitions at catalog revision {review.revision} were checked. Later catalog changes require a new review.</p></details>
 </section>}
 </details>;
}
