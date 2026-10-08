'use client';
import {useEffect,useState} from 'react';
import type {Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import {wasteReasons,type FoodWaste} from '../shared/food-waste';
import type {WasteReport} from '../shared/food-waste-report';
import {WasteExportButton} from './food-waste-export';
import {FoodWasteItems} from './food-waste-items';

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function isReport(v:unknown):v is WasteReport{return object(v)&&Array.isArray(v.entries)&&Array.isArray(v.reasons)&&object(v.totals)&&typeof v.revision==='number'&&(v.next===null||typeof v.next==='number');}
export function WasteCostNote({waste,invalid=false}:{waste:FoodWaste;invalid?:boolean}){
 const cost=waste.cost;
 if(invalid)return <p className="food-warning">Cost needs review: the supporting invoice was voided. This entry is excluded from the known-cost subtotal.</p>;
 if(!cost)return <p className="shared-muted">Cost was not recorded for this older entry. Current prices are not substituted.</p>;
 return <><p><strong>Estimated ingredient cost at entry: {cost.estimatedCents===null?'Not calculable':money(cost.estimatedCents)}</strong>{cost.issues.length?' · '+cost.issues.join(' · '):''}</p>{cost.sku&&<p className="shared-muted">Price basis: {cost.sku.vendor} · {cost.sku.vendorSku} · {cost.sku.price===null?'Price missing':money(cost.sku.price*100)} per {cost.sku.purchaseUnit} · dated {cost.sku.priceUpdatedAt||'unknown'}. {cost.sku.packCount??'?'} × {cost.sku.unitQty??'?'} {cost.sku.unitUOM} per supplier pack.</p>}</>;
}
export function FoodWasteReport({w,apiRoot,dataset}:{w:Workspace;apiRoot:string;dataset:'demo'|'operating'}){
 const today=localDate(new Date().toISOString(),w.location.timezone);
 const [mode,setMode]=useState('entries');
 const [from,setFrom]=useState(today),[through,setThrough]=useState(today),[range,setRange]=useState({from:today,through:today});
 const [cursor,setCursor]=useState<{after:number;revision?:number}>({after:0}),[reload,setReload]=useState(0),[page,setPage]=useState<WasteReport|null>(null),[error,setError]=useState('');
 useEffect(()=>{const abort=new AbortController();setPage(null);setError('');const params=new URLSearchParams({locationId:w.location.id,dataset,view:'waste',...range,after:String(cursor.after),...(cursor.revision===undefined?{}:{revision:String(cursor.revision)})});
  void fetch(`${apiRoot}/food?${params}`,{signal:abort.signal}).then(async response=>{const data:unknown=await response.json();if(!response.ok)throw new Error(object(data)&&typeof data.error==='string'?data.error:'Unable to load waste report.');if(!isReport(data))throw new Error('Unexpected waste report response.');if(!abort.signal.aborted)setPage(data);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Unable to load waste report.');});return()=>abort.abort();
 },[apiRoot,w.location.id,dataset,range,cursor,reload]);
 return <section aria-label="Waste review"><h2>Waste review</h2><p>Recorded waste by restaurant date. Estimates use the supplier price saved with each entry; they are not booked expenses. Unknown costs stay visible and voided entries are excluded from totals.</p>
  <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget),start=String(data.get('from')??''),end=String(data.get('through')??'');setFrom(start);setThrough(end);setRange({from:start,through:end});setCursor({after:0})}}><div className="food-controls"><label className="shared-field">Waste start date<input type="date" name="from" value={from} onChange={e=>setFrom(e.target.value)} required/></label><label className="shared-field">Waste end date<input type="date" name="through" value={through} onChange={e=>setThrough(e.target.value)} required/></label></div><button>Show waste dates</button></form><p className="shared-muted">Up to 31 days · {w.location.timezone} · Date recorded, not a backdated incident date.</p>
  <button onClick={()=>{setCursor({after:0});setReload(n=>n+1)}}>Refresh waste report</button>
  {page&&<WasteExportButton key={w.location.id+':'+w.me.id+':'+dataset+':'+page.from+':'+page.through+':'+page.revision+':'+reload+':'+cursor.after} w={w} apiRoot={apiRoot} dataset={dataset} page={page}/>}
  {error&&<p role="alert" className="food-warning">{error}</p>}{!page&&!error&&<p role="status">Loading waste report…</p>}
  {page&&<><p><strong>Showing {page.from} through {page.through}</strong> · All food items in this restaurant and dataset</p><div className="food-summary"><span>Active entries<strong>{page.totals.active}</strong></span><span>Known estimated subtotal<strong>{page.totals.costed&&page.totals.knownEstimatedCents!==null?money(page.totals.knownEstimatedCents):'No costed total'}</strong></span><span>Entries without usable cost<strong>{page.totals.uncosted}</strong></span><span>Voided entries<strong>{page.totals.voided}</strong></span></div>
   {!!page.totals.uncosted&&<p className="food-warning">The subtotal covers {page.totals.costed} of {page.totals.active} active entries. It is incomplete while other costs need review.</p>}{page.totals.knownEstimatedCents===null&&<p className="food-warning">The combined estimate exceeds the supported range. Narrow the dates.</p>}
   {!page.totals.entries&&<p>No waste entries recorded in these dates. This does not prove no waste occurred.</p>}
   {!!page.reasons.length&&<><h3>By reason</h3><ul>{page.reasons.map(r=><li key={r.reason}>{wasteReasons[r.reason as keyof typeof wasteReasons]??r.reason}: {r.active} active · {r.costed&&r.knownEstimatedCents!==null?money(r.knownEstimatedCents)+' known estimate':'no costed total'} · {r.uncosted} needing cost review · {r.voided} voided</li>)}</ul></>}
   <label className="shared-field">Waste view<select value={mode} onChange={e=>setMode(e.target.value)}><option value="entries">Individual observations</option><option value="items">By item and original pack</option></select></label>
   {mode==='items'?<FoodWasteItems key={w.location.id+':'+dataset+':'+page.from+':'+page.through+':'+page.revision+':'+reload} w={w} apiRoot={apiRoot} dataset={dataset} page={page}/>:<>
   {page.entries.map(e=><article className="food-card" key={e.sequence}><h3>{e.waste.item?.title??e.currentTitle}{e.waste.item?'':' (current catalog name)'}</h3><p>{e.waste.item?.controlNumber} · {displayTime(e.waste.at,w.location.timezone)} · {e.waste.quantity} {e.waste.pack.purchaseUnit} · {wasteReasons[e.waste.reason]??e.waste.reason}</p><p>Pack at entry: {e.waste.pack.packCount??'?'} × {e.waste.pack.unitQty??'?'} {e.waste.pack.unitUOM||'unknown'}{e.waste.item?.storageArea?' · '+e.waste.item.storageArea:''}</p>{e.waste.note&&<p>{e.waste.note}</p>}{e.voided&&<p><strong>Voided — excluded from totals. Original retained.</strong></p>}<WasteCostNote waste={e.waste} invalid={e.priceSourceVoided}/><p className="shared-muted">To correct an entry, find this item in Food inventory and open its source and change history.</p></article>)}
   <div className="shared-actions"><span>{page.entries.length} entries shown · {page.totals.entries} in the selected dates</span>{cursor.after>0&&<button onClick={()=>setCursor({after:0})}>First waste page</button>}{page.next!==null&&<button onClick={()=>setCursor({after:page.next!,revision:page.revision})}>Next 20 waste entries</button>}</div></>}
  </>}
 </section>;
}
