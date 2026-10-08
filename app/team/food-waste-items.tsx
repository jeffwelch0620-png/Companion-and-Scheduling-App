'use client';
import {useEffect,useState} from 'react';
import type {Workspace} from '../shared/types';
import type {WasteReport} from '../shared/food-waste-report';
import type {WasteItemGroup,WasteItemReport} from '../shared/food-waste-items';
const qty=(n:number)=>n>0&&n<0.000001?'<0.000001':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export function WasteItemFacts({group:g}:{group:WasteItemGroup}){
 return <article className="food-card"><h3>{g.title}{g.nameBasis==='current catalog fallback'?' (current catalog name)':''}</h3><p>{g.controlNumber}{g.storageArea?' · '+g.storageArea:''}</p><p>Original count pack: {g.pack.packCount??'?'} × {g.pack.unitQty??'?'} {g.pack.unitUOM||'unknown'} / {g.pack.purchaseUnit||'unknown'}.</p><div className="food-summary"><span>Recorded active quantity<strong>{g.activeQuantity===null?'Needs review':qty(g.activeQuantity)+' '+g.pack.purchaseUnit}</strong></span><span>Known estimated subtotal<strong>{g.costed&&g.knownEstimatedCents!==null?money(g.knownEstimatedCents):'No costed total'}</strong></span></div><p>{g.active} active entries · {g.costed} with usable cost · {g.uncosted} needing cost review · {g.voided} voided.</p>{g.uncosted>0&&<p className="food-warning">This subtotal is incomplete. Missing or invalid cost evidence is not treated as zero.</p>}{g.knownEstimatedCents===null&&<p className="food-warning">The combined cost exceeds the supported range. Narrow the dates.</p>}{g.activeQuantity===null&&<p className="food-warning">The combined quantity exceeds the supported range. Narrow the dates.</p>}</article>;
}
export function FoodWasteItems({w,apiRoot,dataset,page}:{w:Workspace;apiRoot:string;dataset:'demo'|'operating';page:WasteReport}){
 const [after,setAfter]=useState(0),[result,setResult]=useState<WasteItemReport|null>(null),[error,setError]=useState('');
 useEffect(()=>{const ctrl=new AbortController();setResult(null);setError('');
  void fetch(apiRoot+'/food?'+new URLSearchParams({locationId:w.location.id,dataset,view:'waste-items',from:page.from,through:page.through,revision:String(page.revision),after:String(after)}),{signal:ctrl.signal}).then(async r=>{
   const data=await r.json() as WasteItemReport&{error?:string};if(ctrl.signal.aborted)return;if(!r.ok)throw Error(data.error??'Unable to load waste by item.');
   if(data.kind!=='waste-items'||data.locationId!==w.location.id||data.dataset!==dataset||data.from!==page.from||data.through!==page.through||data.revision!==page.revision||data.after!==after||!Array.isArray(data.groups))throw Error('Waste item scope could not be verified. Refresh the waste report.');
   setResult(data);
  }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Unable to load waste by item.')});return()=>ctrl.abort();
 },[apiRoot,w.location.id,dataset,page.from,page.through,page.revision,after]);
 return <section aria-label="Waste by item and original pack"><h3>By item and original pack</h3><p>Largest known ingredient-cost subtotals first. Missing costs can change that order. Each row combines only the same item, saved name, storage area and exact count pack; changed packs and unlike units stay separate.</p><p>Voided observations are retained but excluded from quantity and cost totals. This view is based on recorded entries, not proof of all waste or booked expenses.</p>{error&&<p role="alert" className="food-warning">{error} Use Refresh waste report above.</p>}{!result&&!error&&<p role="status">Loading waste by item…</p>}{result&&<>{!result.groups.length&&<p>No item groups in these dates.</p>}{result.groups.map(g=><WasteItemFacts group={g} key={g.sequence}/>)}<div className="shared-actions"><span>{result.groups.length} groups shown · {result.totalGroups} in the applied dates</span>{after>0&&<button type="button" onClick={()=>setAfter(0)}>First item group page</button>}{result.next!==null&&<button type="button" onClick={()=>setAfter(result.next!)}>Next 20 item groups</button>}</div></>}</section>;
}
