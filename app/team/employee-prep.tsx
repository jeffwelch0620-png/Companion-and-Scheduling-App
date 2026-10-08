'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Workspace,Command} from '../shared/types';
import type {EmployeePrepItem} from '../shared/employee-prep';
import {object} from '../shared/validation';
export function EmployeePrep({w,apiRoot,onBusy}:{w:Workspace;apiRoot:string;onBusy?:(value:boolean)=>void}){
 const [state,setState]=useState<{key:string;items:EmployeePrepItem[];error:string}|null>(null),[refresh,setRefresh]=useState(0),[locked,setLocked]=useState(false),[notice,setNotice]=useState('');
 const scope=apiRoot+':'+w.location.id+':'+w.me.id,key=scope+':'+refresh;
 const lock=useCallback((value:boolean)=>{setLocked(value);onBusy?.(value)},[onBusy]);
 useEffect(()=>()=>onBusy?.(false),[onBusy]);
 useEffect(()=>{const controller=new AbortController();
  void fetch(`${apiRoot}/food/assigned-prep?${new URLSearchParams({locationId:w.location.id})}`,{signal:controller.signal,credentials:'same-origin',cache:'no-store'})
   .then(async r=>{const data=object(await r.json());if(!r.ok)throw new Error(typeof data.error==='string'?data.error:'Assigned prep could not be loaded.');if(data.locationId!==w.location.id||data.dataset!=='operating'||!Array.isArray(data.items))throw new Error('Refresh this restaurant’s prep.');return data.items as EmployeePrepItem[];})
   .then(items=>{if(!controller.signal.aborted)setState({key,items,error:''});}).catch(e=>{if(!controller.signal.aborted)setState({key,items:[],error:e instanceof Error?e.message:'Assigned prep could not be loaded.'});});
  return()=>controller.abort();
 },[apiRoot,w.location.id,w.me.id,key]);
 const current=state?.key===key?state:null;
 return <details id="assigned-prep" className="companion-secondary"><summary>Your assigned prep{current?.items.length?' · '+current.items.length:''}</summary>
  <p>Released work for you at {w.location.name}. Record the actual amount; your manager sees any difference from the plan.</p>
  <button disabled={locked||!current} onClick={()=>{setNotice('');setRefresh(n=>n+1)}}>Refresh prep</button>
  {notice&&<p role="status">{notice}</p>}
  {!current?<p role="status">Loading your released prep…</p>:current.error?<p role="alert">{current.error}</p>:!current.items.length?<p>No unfinished released prep is assigned to you.</p>:current.items.map(item=><article className="companion-item" key={scope+':'+item.planId+':'+item.definitionId}><h3>{item.title}</h3><p>Planned: {item.quantity} {item.unit} · {item.targetDate} · {item.track==='bulk'?'Bulk prep':'Daily prep'}</p>{item.recipe?<EmployeeRecipeCard recipe={item.recipe}/>:<p>{item.recipeNotice}</p>}<PrepReport key={item.planRevision} item={item} w={w} apiRoot={apiRoot} disabled={locked} onBusy={lock} onRefresh={()=>{setNotice('This list changed. Review the refreshed assignment before reporting.');setRefresh(n=>n+1)}} onSaved={()=>{setNotice('Actual prep recorded. Your manager can review the result.');setRefresh(n=>n+1)}}/></article>)}
 </details>;
}
export function EmployeeRecipeCard({recipe}:{recipe:NonNullable<EmployeePrepItem['recipe']>}){
 const ingredients=recipe.ingredients??[];
 return <details><summary>Recipe card · {recipe.title}</summary>{recipe.yieldQty!==null&&<p>Recipe yield: {recipe.yieldQty} {recipe.yieldUOM}</p>}
  <h4>Ingredients for the recipe yield</h4>{ingredients.length?<ul>{ingredients.map((ingredient,i)=><li key={i}>{ingredient.quantity} {ingredient.unit} · {ingredient.name}{ingredient.portionGuidance&&<span> — {ingredient.portionGuidance}</span>}{ingredient.notice&&<p>{ingredient.notice}</p>}</li>)}</ul>:<p>Ingredients are not supplied in this recipe. Ask your manager before starting.</p>}
  {recipe.procedure?<p style={{whiteSpace:'pre-wrap'}}>{recipe.procedure}</p>:<p>Preparation instructions are not available. Ask your manager before starting.</p>}{recipe.equipment&&<p>Equipment: {recipe.equipment}</p>}{recipe.portionNote&&<p>Portion guidance: {recipe.portionNote}</p>}
  <p>Shelf life from recipe source: {recipe.shelfLife||'Not supplied; ask your manager before labeling or storing.'}</p>
 </details>;
}
export function PrepReport({item,w,apiRoot,onSaved,onRefresh,onBusy,disabled=false}:{item:EmployeePrepItem;w:Workspace;apiRoot:string;onSaved:()=>void;onRefresh:()=>void;onBusy:(value:boolean)=>void;disabled?:boolean}){
 const [quantity,setQuantity]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<Command|null>(null),[error,setError]=useState('');
 const inFlight=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 async function save(command:Command){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);setError('');
  try{const response=await fetch(`${apiRoot}/food/workflows`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});const data=object(await response.json());if(!mounted.current)return;
   if(!response.ok){if(response.status<500){setPending(null);onBusy(false);if(response.status===409||response.status===403){onRefresh();return;}}throw new Error(typeof data.error==='string'?data.error:'Prep report could not be saved.');}
   if(typeof data.recordId!=='string'||typeof data.revision!=='number')throw new Error('Save was not confirmed. Retry the same report.');setPending(null);onBusy(false);onSaved();
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Save was not confirmed.');}finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 return <form onSubmit={e=>{e.preventDefault();if(inFlight.current||busy||pending||disabled||quantity==='')return;const command:Command={requestId:crypto.randomUUID(),locationId:w.location.id,recordId:item.planId,expectedRevision:item.planRevision,action:'plan.employee-complete',input:{dataset:'operating',definitionId:item.definitionId,quantity:Number(quantity),note,confirmed:true}};setPending(command);void save(command);}}>
  <fieldset disabled={disabled||busy||!!pending}><label>Actual amount prepared ({item.unit})<input required type="number" min="0" max="1000000" step={item.quantityMode==='whole-portions'?'1':'any'} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>{item.quantityMode==='whole-portions'&&<p>Record whole prepared portion units. Approximate stock counts can include partial units; actual portions cannot.</p>}<label>Shortage or completion note<input maxLength={1000} required={quantity!==''&&Number(quantity)!==item.quantity} value={note} onChange={e=>setNote(e.target.value)}/></label><p>If you could not prepare the planned amount, record what you made (including zero) and explain what is missing. Let your manager know if service is affected.</p><button type="submit">Record actual prep</button></fieldset>
  {busy&&<p role="status">Saving actual prep…</p>}{error&&<p role="alert">{error}</p>}{pending&&!busy&&<><p>The save is not confirmed. Retry this same report before leaving this restaurant or screen.</p><button type="button" onClick={()=>void save(pending)}>Retry the same report</button></>}
 </form>;
}
