'use client';
import {useEffect,useState} from 'react';
import {approvedCommissaryFoodLocations,verifiedCommissaryFoodContext,type CommissaryFoodContext as Context} from '../shared/commissary-food-context';
import type {WorkspaceMembership} from '../shared/workspace-context';
import {FoodWorkflows} from './food-workflows';
import {FoodTransfers} from './food-transfers';

// This view never loads /workspace for a destination. The Food context exposes
// the signed-in target membership and location, without staff or work records.
export function CommissaryFood({locations:providedLocations,apiRoot,onBusy,busy}:{locations:WorkspaceMembership[];apiRoot:string;onBusy:(value:boolean)=>void;busy:boolean}){
 const locations=approvedCommissaryFoodLocations(providedLocations);
 const [selected,setSelected]=useState(locations[0]?.locationId??''),[view,setView]=useState<'prep'|'transfers'>('prep'),[dataset,setDataset]=useState<'operating'|'demo'>('operating');
 const [context,setContext]=useState<Context|null>(null),[error,setError]=useState(''),[epoch,setEpoch]=useState(0);
 const membership=locations.find(location=>location.locationId===selected);
 const scopedContext=context&&membership&&context.location.id===membership.locationId&&context.me.id===membership.id?context:null;
 useEffect(()=>{
  const controller=new AbortController();setContext(null);setError('');
  if(!membership)return()=>controller.abort();
  void fetch(apiRoot+'/food/workflows?'+new URLSearchParams({locationId:membership.locationId,view:'context'}),{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{const value:unknown=await response.json();if(!response.ok)throw Error(value&&typeof value==='object'&&'error'in value&&typeof value.error==='string'?value.error:'Commissary Food access could not be loaded.');return verifiedCommissaryFoodContext(value,membership)})
   .then(value=>{if(!controller.signal.aborted)setContext(value)})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Commissary Food access could not be loaded.')});
  return()=>controller.abort();
 },[apiRoot,membership?.id,membership?.locationId,epoch]);
 return <section aria-label="Commissary Food work">
  <div className="shared-heading"><div><p className="jmax-eyebrow">Commissary</p><h1>Restaurant Food work</h1><p>Prep, counts and transfers for the approved restaurant. Your main restaurant workspace stays separate.</p></div></div>
  <label className="shared-field">Food destination<select value={membership?selected:''} disabled={busy} onChange={e=>{setContext(null);setError('');setSelected(e.target.value)}}>{!membership&&<option value="">Choose an approved restaurant</option>}{locations.map(location=><option key={location.id} value={location.locationId}>{location.locationName}</option>)}</select></label>
  <div className="food-flow-tabs"><button disabled={busy} aria-pressed={view==='prep'} onClick={()=>setView('prep')}>Prep and counts</button><button disabled={busy} aria-pressed={view==='transfers'} onClick={()=>setView('transfers')}>Transfers</button><button disabled={busy} onClick={()=>setEpoch(value=>value+1)}>Refresh access</button></div>
  {error&&<p role="alert">{error}</p>}{!context&&!error&&membership&&<p role="status">Checking approved Food access…</p>}
  {scopedContext&&membership&&view==='prep'&&<FoodWorkflows key={scopedContext.location.id+':'+scopedContext.me.id+':'+epoch} w={scopedContext} apiRoot={apiRoot} view="prep" commissaryOnly busy={busy} onBusy={onBusy} send={async()=>false} onNavigate={()=>{}}/>}
  {scopedContext&&membership&&view==='transfers'&&<><label className="shared-field">Records<select disabled={busy} value={dataset} onChange={e=>setDataset(e.target.value as typeof dataset)}><option value="operating">Restaurant records</option><option value="demo">Demo / training records</option></select></label>{dataset==='demo'&&<p role="status">Fictional training records. These are separate from restaurant operating records.</p>}<FoodTransfers key={scopedContext.location.id+':'+scopedContext.me.id+':'+dataset+':'+epoch} w={scopedContext} apiRoot={apiRoot} dataset={dataset} commissaryOnly onBusy={onBusy}/></>}
 </section>;
}
