'use client';
import {useEffect,useState} from 'react';
import type {Workspace} from '../shared/types';
import type {PrepPlan} from '../shared/food-workflow-model';
import {foodWorkflowPermissions} from '../shared/food-workflow-model';
import {prepProgress} from '../shared/prep-progress';
import {object} from '../shared/validation';
export function PrepProgress({w,apiRoot,onNavigate}:{w:Workspace;apiRoot:string;onNavigate:(tab:string)=>void}){
 const allowed=foodWorkflowPermissions(w.me).managePrep,scope=apiRoot+':'+w.location.id+':'+w.me.id;
 const [refresh,setRefresh]=useState(0),[state,setState]=useState<{scope:string;plans:PrepPlan[];more:boolean;error:string}|null>(null);
 useEffect(()=>{if(!allowed)return;const controller=new AbortController();
  void fetch(`${apiRoot}/food/workflows?${new URLSearchParams({locationId:w.location.id,dataset:'operating'})}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{
   const data=object(await response.json());if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Prep progress could not be loaded.');
   if(!Array.isArray(data.plans)||data.plans.some(p=>p.locationId!==w.location.id||p.dataset!=='operating'))throw new Error('Refresh this restaurant’s prep progress.');
   return {scope,plans:data.plans as PrepPlan[],more:object(data.more).plans===true,error:''};
  }).then(result=>{if(!controller.signal.aborted)setState(result);}).catch(e=>{if(!controller.signal.aborted)setState({scope,plans:[],more:false,error:e instanceof Error?e.message:'Prep progress could not be loaded.'});});
  return()=>controller.abort();
 },[apiRoot,w.location.id,scope,allowed,refresh]);
 if(!allowed)return null;
 const current=state?.scope===scope?state:null,rows=current?prepProgress(current.plans,w.location.id,'operating'):[];
 return <section className="food-flow-panel prep-progress"><h2>Prep follow-through</h2><button onClick={()=>setRefresh(n=>n+1)}>Refresh prep progress</button>
  {!current?<p role="status">Loading recorded prep progress…</p>:current.error?<p role="alert">{current.error}</p>:<>
   {!rows.length&&<p>No unfinished work or reported shortages in the loaded released prep lists.</p>}
   {rows.map(p=><article key={p.id}><h3>{p.date} · {p.track==='bulk'?'Bulk prep':'Daily prep'}</h3><p>{p.remaining} of {p.total} items awaiting completion{p.unassigned?' · '+p.unassigned+' need an assigned person':''}.</p>{p.shortages.map((s,i)=><p key={i}><strong>{s.title}: reported short.</strong> Prepared {s.actual} of {s.planned} {s.unit}. {s.note} Review what still needs making and assign the next step.</p>)}</article>)}
   {current.more&&<p>Only the most recent prep lists are shown. Open Prep production to review the full available history.</p>}
  </>}
  <button onClick={()=>onNavigate('Prep production')}>Review prep production</button>
 </section>;
}
