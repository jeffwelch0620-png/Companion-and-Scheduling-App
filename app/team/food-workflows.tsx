'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {type Command,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate,nextDate} from '../shared/local-time';
import type {FoodPage,FoodRecord} from '../shared/food-contract';
import type {FoodDataset,FoodWorkflowPage,FoodWorkflowDetail,PrepCount,PrepDefinition,PrepPlan,PrepTrack,PrepWorkflow,PrepQuantityMode} from '../shared/food-workflow-model';
import type {FoodWorkflowView} from '../shared/food-navigation';
import type {Send} from './workspace';
import './food-workflows.css';
import {PrepAdvisor} from './prep-advisor';

type FoodContext=Pick<Workspace,'location'|'me'> & Partial<Pick<Workspace,'members'|'records'|'formerMembers'>>;
const personName=(w:FoodContext,id:string|undefined,fallback='Employee')=>w.me.id===id?w.me.name:w.members?.find(m=>m.id===id)?.name??w.formerMembers?.find(m=>m.id===id)?.name??fallback;
type Props={commissaryOnly?:boolean;initialOrderId?:string;initialDataset?:FoodDataset;w:FoodContext;apiRoot:string;view:FoodWorkflowView;onBusy:(value:boolean)=>void;busy:boolean;send:Send;onNavigate:(tab:string)=>void};
type PrepResult={recordId:string;revision:number;foodRevision:number};
type PrepSend=(action:string,input:Record<string,unknown>,record?:PrepWorkflow)=>Promise<PrepResult|null>;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const trackName=(track:PrepTrack)=>track==='daily'?'Daily prep':'Bulk prep';
const statusName=(status:string)=>({review:'Awaiting review',returned:'Returned for changes',draft:'Draft',approved:'Approved internally',submitted:'Count submitted',released:'Released',completed:'Completed',active:'Active',retired:'Retired'} as Record<string,string>)[status]??status;
class WorkflowError extends Error{constructor(message:string,public status:number){super(message)}}
async function readResponse<T>(response:Response,valid:(value:unknown)=>value is T):Promise<T>{
 const value:unknown=await response.json();
 if(!response.ok)throw new WorkflowError(object(value)&&typeof value.error==='string'?value.error:'The food request could not be completed.',response.status);
 if(!valid(value))throw new Error('The food response could not be verified. Refresh before continuing.');
 return value;
}
const isPage=(value:unknown):value is FoodWorkflowPage=>object(value)&&typeof value.foodRevision==='number'&&['definitions','counts','plans','purchases'].every(key=>Array.isArray(value[key]))&&object(value.permissions)&&object(value.more);
const isFoodPage=(value:unknown):value is FoodPage=>object(value)&&Array.isArray(value.records)&&(value.next===null||typeof value.next==='string');
const isResult=(value:unknown):value is PrepResult=>object(value)&&typeof value.recordId==='string'&&typeof value.revision==='number'&&typeof value.foodRevision==='number';
const isDetail=(value:unknown):value is FoodWorkflowDetail=>object(value)&&object(value.record)&&Array.isArray(value.history)&&(value.next===null||typeof value.next==='number');
function useFoodRead<T>(url:string,valid:(value:unknown)=>value is T,version='',enabled=true){
 const key=url+':'+version;
 const [result,setResult]=useState<{key:string;url:string;value:T|null;error:string}|null>(null);
 useEffect(()=>{
  if(!enabled)return;const controller=new AbortController();
  void fetch(url,{signal:controller.signal,credentials:'same-origin',cache:'no-store'}).then(response=>readResponse(response,valid)).then(value=>{if(!controller.signal.aborted)setResult({key,url,value,error:''})}).catch(error=>{if(!controller.signal.aborted)setResult({key,url,value:null,error:error instanceof Error?error.message:'Could not load Food records.'})});
  return()=>controller.abort();
 },[url,key,valid,enabled]);
 return {value:enabled&&result?.key===key?result.value:null,error:enabled&&result?.key===key?result.error:'',loading:enabled&&result?.key!==key};
}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="shared-field">{label}{children}</label>}
function Status({value}:{value:string}){return <span className="food-flow-status" data-status={value}>{statusName(value)}</span>}
function SourceLine({record}:{record:FoodRecord}){return <small>{record.kind==='fooditem'?`Food item ${record.data.controlNumber}`:`Prep recipe ${record.data.sourceId}`} · catalog version {record.revision} · {record.data.source.label}</small>}

export function FoodWorkflows(props:Props){
 const [dataset,setDataset]=useState<FoodDataset>(props.initialDataset??'operating'),[locked,setLocked]=useState(false);
 const {onBusy}=props;
 const lock=useCallback((value:boolean)=>{setLocked(value);onBusy(value)},[onBusy]);
 return <section className="food-flows">
  <div className="food-flow-heading"><div><p className="jmax-eyebrow">{props.w.location.name} · Food</p><h1>{props.view==='prep'?'Prep production':'Purchasing review'}</h1><p>{props.view==='prep'?'Count what is ready, review what is needed, and follow prep through completion.':'Prepare internal requests from the same counted Food items and supplier packs.'}</p></div></div>
  <div className="food-flow-context"><Field label="Records"><select value={dataset} disabled={locked||props.busy} onChange={e=>setDataset(e.target.value as FoodDataset)}><option value="operating">Restaurant records</option><option value="demo">Demo / training records</option></select></Field>{!props.commissaryOnly&&<div className="food-flow-actions"><button disabled={locked||props.busy} onClick={()=>props.onNavigate('Food inventory')}>Food inventory</button><button disabled={locked||props.busy} onClick={()=>props.onNavigate('Delivery checks')}>Delivery checks</button></div>}</div>
  {dataset==='demo'&&<div className="food-flow-warning" role="status"><strong>Fictional training records.</strong> Changes here remain in this restaurant’s demo dataset. They are not restaurant stock, prep needs or supplier orders.</div>}
  <WorkflowContent key={props.apiRoot+':'+props.w.location.id+':'+props.w.me.id+':'+dataset} {...props} dataset={dataset} onBusy={lock}/>
 </section>;
}

function WorkflowContent({w,apiRoot,view,onBusy,busy:workspaceBusy,send,onNavigate,dataset,initialOrderId,commissaryOnly}:Props&{dataset:FoodDataset}){
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[epoch,setEpoch]=useState(0),[saving,setSaving]=useState(false),[pending,setPending]=useState<Command|null>(null);
 const pendingRef=useRef<Command|null>(null),inFlight=useRef(false);
 const purchaseStamp=(w.records??[]).filter(r=>r.kind==='order').map(r=>r.id+':'+r.revision).join('|');
 const params=new URLSearchParams({locationId:w.location.id,dataset});
 const {value:loaded,error:loadError,loading}=useFoodRead(`${apiRoot}/food/workflows?${params}`,isPage,epoch+':'+purchaseStamp);
 const wrongScope=loaded&&([...loaded.definitions,...loaded.counts,...loaded.plans].some(record=>record.locationId!==w.location.id||record.dataset!==dataset)||loaded.purchases.some(record=>record.locationId!==w.location.id||record.data.food?.dataset!==dataset));
 const page=wrongScope?null:loaded;
 useEffect(()=>()=>onBusy(false),[onBusy]);
 const execute=async(command:Command):Promise<PrepResult|null>=>{
  if(inFlight.current)return null;
  inFlight.current=true;setSaving(true);onBusy(true);setError('');setNotice('');
  try{
   const result=await readResponse(await fetch(`${apiRoot}/food/workflows`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)}),isResult);
   pendingRef.current=null;setPending(null);onBusy(false);setEpoch(n=>n+1);setNotice('Saved to this restaurant’s '+(dataset==='demo'?'training':'operating')+' records.');return result;
  }catch(e){
   if(e instanceof WorkflowError&&e.status<500){pendingRef.current=null;setPending(null);onBusy(false);if(e.status===409)setEpoch(n=>n+1)}
   setError(e instanceof Error?e.message:'Save not confirmed.');return null;
  }finally{inFlight.current=false;setSaving(false)}
 };
 const prepSend:PrepSend=async(action,input,record)=>{
  if(workspaceBusy||pendingRef.current||inFlight.current)return null;
  const command:Command={requestId:crypto.randomUUID(),locationId:w.location.id,action,input:{...input,dataset},...(record?{recordId:record.id,expectedRevision:record.revision}:{})};
  pendingRef.current=command;setPending(command);return execute(command);
 };
 const busy=workspaceBusy||saving||!!pending;
 return <>
  {(error||loadError||wrongScope)&&<p className="food-flow-error" role="alert">{error||loadError||'The response belongs to another restaurant or dataset. Refresh before continuing.'}</p>}{notice&&<p className="food-flow-note" role="status">{notice}</p>}
  {pending&&!saving&&<div className="food-flow-warning"><p>The last save has not been confirmed. Keep this restaurant and dataset open until the same request is resolved.</p><button onClick={()=>void execute(pending)}>Retry the same save</button></div>}
  <div className="food-flow-actions"><button disabled={busy||loading} onClick={()=>setEpoch(n=>n+1)}>Refresh records</button>{loading&&<span role="status">Loading food records…</span>}</div>
  {page&&view==='prep'&&<PrepWorkspace commissaryOnly={commissaryOnly} w={w} apiRoot={apiRoot} dataset={dataset} page={page} send={prepSend} busy={busy||loading} onBusy={onBusy} onUpdated={()=>setEpoch(n=>n+1)}/>}
  {!commissaryOnly&&page&&view==='purchasing'&&<PurchaseWorkspace initialOrderId={initialOrderId} w={w} apiRoot={apiRoot} dataset={dataset} page={page} send={send} busy={busy||loading} onNavigate={onNavigate}/>}
  {dataset==='demo'&&<details className="food-flow-panel"><summary>Practice walkthrough</summary><ol className="food-flow-steps">{view==='prep'?<><li>Choose a fictional Food item or prep recipe and record a reviewed prep unit and par.</li><li>Create a dated evening count. Leave uncounted entries blank; enter zero only when zero was observed.</li><li>Save and submit the count, then preview the next target date. Missing counts or changed definitions block release.</li><li>Release the reviewed plan and record each completed quantity. Open its history to check who did what.</li></>:<><li>Use a fictional Food item with a dated physical count, reviewed par and priced supplier pack in Food inventory.</li><li>Choose the same count date here, add an explicit pack quantity, and save an internal draft.</li><li>Submit it. A different signed-in reviewer can approve it or return it with a reason.</li><li>The requester can edit a returned request and save it back to draft. Approval does not place a supplier order.</li></>}</ol></details>}
 </>;
}

function CanonicalPicker({w,apiRoot,dataset,busy,allowRecipes=false,definition,onSelect}:{w:FoodContext;apiRoot:string;dataset:FoodDataset;busy:boolean;allowRecipes?:boolean;definition?:PrepDefinition;onSelect:(record:FoodRecord)=>void}){
 const [kind,setKind]=useState<'fooditem'|'foodrecipe'>(definition?.foodKind??'fooditem'),[query,setQuery]=useState(definition?.title??''),[after,setAfter]=useState('');
 const params=new URLSearchParams({locationId:w.location.id,dataset,kind,q:query,after});
 const {value:page,error,loading}=useFoodRead(`${apiRoot}/food?${params}`,isFoodPage);
 const records=page?.records.filter(record=>record.locationId===w.location.id&&record.data.source.dataset===dataset&&(!definition||record.id===definition.foodRecordId)&&(record.kind==='fooditem'||record.data.recipeType==='prep'))??[];
 return <div className="food-flow-picker"><fieldset disabled={busy}><div className="food-flow-fields">{allowRecipes&&!definition&&<Field label="Existing Food source"><select value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setAfter('')}}><option value="fooditem">Food item</option><option value="foodrecipe">Prep recipe</option></select></Field>}<Field label={definition?'Find the linked Food source':'Find an existing Food record'}><input type="search" value={query} maxLength={100} placeholder="Name or item code" onChange={e=>{setQuery(e.target.value);setAfter('')}}/></Field></div>{definition&&<p>Select the current version of this same source. Retire this definition before replacing its source or track.</p>}
  {error&&<p role="alert" className="food-flow-error">{error}</p>}{loading&&<p role="status">Reading the shared Food catalog…</p>}
  {records.map(record=><button type="button" className="food-flow-option" key={record.id} onClick={()=>onSelect(record)}><strong>{record.data.title}</strong><SourceLine record={record}/>{record.kind==='fooditem'&&<small>{record.data.storageArea||'Storage area not set'}{record.data.needsReview?' · Mapping needs review':''}{!record.data.active?' · Inactive':''}</small>}</button>)}
  {!loading&&!error&&!records.length&&<p>No matching {kind==='fooditem'?'Food items':'prep recipes'} in this dataset. Review the existing Food catalog before adding a definition.</p>}
  <div className="food-flow-actions">{after&&<button type="button" onClick={()=>setAfter('')}>First records</button>}{page?.next&&<button type="button" onClick={()=>setAfter(page.next!)}>Next catalog records</button>}</div></fieldset></div>;
}

function PrepWorkspace({w,apiRoot,dataset,page,send,busy,onBusy,onUpdated,commissaryOnly}:{commissaryOnly?:boolean;w:FoodContext;apiRoot:string;dataset:FoodDataset;page:FoodWorkflowPage;send:PrepSend;busy:boolean;onBusy:(value:boolean)=>void;onUpdated:()=>void}){
 const [track,setTrack]=useState<PrepTrack>('daily'),[tab,setTab]=useState<'count'|'plan'|'definitions'|'advisor'>('count'),[countDate,setCountDate]=useState(()=>localDate(new Date().toISOString(),w.location.timezone)),[selectedCount,setSelectedCount]=useState(''),[selectedPlan,setSelectedPlan]=useState('');
 const definitions=page.definitions.filter(r=>r.track===track),counts=page.counts.filter(r=>r.track===track),plans=page.plans.filter(r=>r.track===track);
 const count=counts.find(r=>r.id===selectedCount)||counts.find(r=>r.businessDate===countDate),plan=plans.find(r=>r.id===selectedPlan);
 if(!page.permissions.managePrep)return <p className="food-flow-empty">Prep management is not enabled for this restaurant membership.</p>;
 return <>
  <div className="food-flow-tabs" aria-label="Prep track">{(['daily','bulk'] as const).map(value=><button disabled={busy} aria-pressed={track===value} key={value} onClick={()=>{setTrack(value);setSelectedCount('');setSelectedPlan('')}}>{trackName(value)}</button>)}</div>
  <p className="food-flow-note">{track==='daily'?'Daily prep belongs to this restaurant.':'Bulk prep is recorded for this restaurant or production location. Cross-restaurant consolidation is a separate step.'} Completion records prep output; it does not change raw inventory or physical counts.</p>
  <div className="food-flow-tabs" aria-label="Prep work">{([['count','Evening counts'],['plan','Prep plans'],['definitions','Reviewed definitions'],['advisor','Food prep advice']] as const).filter(([value])=>!commissaryOnly||value!=='definitions').map(([value,label])=><button disabled={busy} key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{label}</button>)}</div>
  {tab==='advisor'&&<PrepAdvisor key={apiRoot+':'+w.location.id+':'+w.me.id+':'+dataset} locationId={w.location.id} dataset={dataset} apiRoot={apiRoot} disabled={busy} onBusy={onBusy} onUpdated={onUpdated}/>}
  {!commissaryOnly&&tab==='definitions'&&<><DefinitionEditor key={track+':new'} w={w} apiRoot={apiRoot} dataset={dataset} track={track} busy={busy} send={send}/><div className="food-flow-list">{definitions.map(definition=><DefinitionCard key={definition.id+':'+definition.revision} definition={definition} w={w} apiRoot={apiRoot} dataset={dataset} send={send} busy={busy}/>)}</div>{!definitions.length&&<p className="food-flow-empty">No reviewed {trackName(track).toLowerCase()} definitions yet. Link an existing Food item or prep recipe above. Units and pars start blank.</p>}</>}
  {tab==='count'&&<>
   <div className="food-flow-panel"><h2>{trackName(track)} evening count</h2><p>Use the date the count was actually taken. A blank count remains missing.</p><div className="food-flow-fields"><Field label="Count business date"><input type="date" value={countDate} max={localDate(new Date().toISOString(),w.location.timezone)} disabled={busy} onChange={e=>{setCountDate(e.target.value);setSelectedCount('')}}/></Field><Field label="Open a saved count"><select value={count?.id??''} disabled={busy} onChange={e=>{const selected=counts.find(r=>r.id===e.target.value);setSelectedCount(e.target.value);if(selected)setCountDate(selected.businessDate)}}><option value="">Choose saved count</option>{counts.map(record=><option key={record.id} value={record.id}>{record.businessDate} · {statusName(record.status)}</option>)}</select></Field></div>
    {!count&&<><button className="shared-primary" disabled={busy||!countDate||!definitions.some(r=>r.status==='active')} onClick={async()=>{const result=await send('count.create',{track,businessDate:countDate});if(result)setSelectedCount(result.recordId)}}>Create evening count</button>{!definitions.some(r=>r.status==='active')&&<p>{commissaryOnly?'The restaurant manager needs to review prep definitions before counts can begin.':'Add a reviewed definition before creating a count.'}</p>}</>}
   </div>
   {count&&<CountEditor key={count.id+':'+count.revision} count={count} send={send} busy={busy} w={w} onPlan={()=>{setSelectedCount(count.id);setTab('plan')}}/>}
   {count&&<WorkflowHistory record={count} w={w} apiRoot={apiRoot} dataset={dataset}/>}
   {page.more.counts&&<p className="food-flow-note">The most recent 30 counts are shown. Older saved records remain in history; this list is not a complete count archive.</p>}
  </>}
  {tab==='plan'&&<>
   <PlanGenerator key={track+':'+(count?.id??'')} track={track} counts={counts} plans={plans} initialCountId={count?.status==='submitted'?count.id:''} send={send} busy={busy} onCreated={setSelectedPlan}/>
   <div className="food-flow-panel"><h2>Saved {trackName(track).toLowerCase()} plans</h2><Field label="Target-date plan"><select value={selectedPlan} disabled={busy} onChange={e=>setSelectedPlan(e.target.value)}><option value="">Choose a plan</option>{plans.map(record=><option key={record.id} value={record.id}>{record.targetDate} · {statusName(record.status)}</option>)}</select></Field>{!plans.length&&<p>No prep plans are recorded for this track yet.</p>}</div>
   {plan&&<><PlanCard commissaryOnly={commissaryOnly} key={plan.id+':'+plan.revision} plan={plan} definitions={definitions} currentCount={counts.find(record=>record.id===plan.countId)} w={w} send={send} busy={busy}/><WorkflowHistory record={plan} w={w} apiRoot={apiRoot} dataset={dataset}/></>}
   {page.more.plans&&<p className="food-flow-note">The most recent 30 plans are shown. Older saved plans remain in history; this list is not a complete production archive.</p>}
  </>}
 </>;
}

function DefinitionEditor({w,apiRoot,dataset,track,busy,send,definition,onSaved}:{w:FoodContext;apiRoot:string;dataset:FoodDataset;track:PrepTrack;busy:boolean;send:PrepSend;definition?:PrepDefinition;onSaved?:()=>void}){
 const [selected,setSelected]=useState<FoodRecord|null>(null),[unit,setUnit]=useState(definition?.countUnit??''),[quantityMode,setQuantityMode]=useState<PrepQuantityMode>(definition?.quantityMode??'continuous'),[par,setPar]=useState(definition?String(definition.par):''),[review,setReview]=useState(''),[confirmed,setConfirmed]=useState(false),[open,setOpen]=useState(!!definition);
 const valid=!!selected&&!!unit.trim()&&par!==''&&Number.isFinite(Number(par))&&Number(par)>=0&&(quantityMode!=='whole-portions'||Number.isInteger(Number(par)))&&review.trim().length>0&&confirmed;
 return <details className="food-flow-panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{definition?'Review and update definition':'Add a reviewed prep definition'}</summary><p>Choose the current Food record. Enter the unit staff will count and its reviewed target; no par or conversion is inferred.</p>
  {open&&<form onSubmit={async e=>{e.preventDefault();if(!selected||!valid)return;const result=await send('definition.save',{foodRecordId:selected.id,foodRevision:selected.revision,track,countUnit:unit.trim(),quantityMode,par:Number(par),reviewNote:review,confirmed:true},definition);if(result){setSelected(null);setUnit('');setQuantityMode('continuous');setPar('');setReview('');setConfirmed(false);setOpen(false);onSaved?.()}}}><fieldset disabled={busy}>
   <CanonicalPicker w={w} apiRoot={apiRoot} dataset={dataset} busy={busy} definition={definition} allowRecipes onSelect={record=>{setSelected(record);setConfirmed(false)}}/>
   {selected&&<div className="food-flow-note"><strong>{selected.data.title}</strong><SourceLine record={selected}/></div>}
   <div className="food-flow-fields"><Field label="Reviewed counting unit"><input required maxLength={40} value={unit} placeholder="For example, labeled pans" onChange={e=>{setUnit(e.target.value);setConfirmed(false)}}/></Field><Field label="How this prep is produced"><select value={quantityMode} onChange={e=>{setQuantityMode(e.target.value as PrepQuantityMode);setConfirmed(false)}}><option value="continuous">Measured amount — fractions allowed</option><option value="whole-portions">Whole portion units — for example, ready dressing cups</option></select></Field><Field label="Reviewed par in that unit"><input required type="number" min="0" max="1000000" step={quantityMode==='whole-portions'?'1':'any'} value={par} onChange={e=>{setPar(e.target.value);setConfirmed(false)}}/></Field></div>
   {quantityMode==='whole-portions'&&<p>Stock estimates may include part of a pan or portion. Prep quantities round up to whole units, and actual prepared portions must be whole numbers. This setting does not convert cup sizes or recipe measures.</p>}
   <Field label="Source and reason for this definition"><textarea required maxLength={1000} value={review} onChange={e=>setReview(e.target.value)} placeholder="Who reviewed the unit and par, and what source was checked?"/></Field>
   <label className="food-flow-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the linked Food source, counting unit and par for {w.location.name}.</label>
   <button className="shared-primary" disabled={!valid}>{definition?'Save reviewed update':'Save reviewed definition'}</button>
  </fieldset></form>}
 </details>;
}
function DefinitionCard({definition,w,apiRoot,dataset,send,busy}:{definition:PrepDefinition;w:FoodContext;apiRoot:string;dataset:FoodDataset;send:PrepSend;busy:boolean}){
 const [editing,setEditing]=useState(false),[reason,setReason]=useState('');
 return <article className="food-flow-panel"><div className="food-flow-row"><div><h3>{definition.title}</h3><p>Par {definition.par} {definition.countUnit} · {trackName(definition.track)}</p><small>{definition.quantityMode==='whole-portions'?'Whole prepared portion units':'Measured amounts; fractions allowed'}</small><small>Reviewed by {personName(w,definition.reviewedBy)} · {displayTime(definition.reviewedAt,w.location.timezone)}</small><small>Linked {definition.foodKind==='fooditem'?'Food item':'prep recipe'} version {definition.foodRevision} · definition version {definition.revision}</small></div><Status value={definition.status}/></div><p>{definition.reviewNote}</p>
  {definition.status==='active'&&<><button disabled={busy} onClick={()=>setEditing(!editing)}>{editing?'Close definition editor':'Update reviewed definition'}</button>{editing&&<DefinitionEditor definition={definition} w={w} apiRoot={apiRoot} dataset={dataset} track={definition.track} send={send} busy={busy} onSaved={()=>setEditing(false)}/>}<details><summary>Retire definition</summary><p>Future counts will exclude it. Saved counts and plans keep their source history.</p><Field label="Reason for retirement"><input value={reason} maxLength={1000} disabled={busy} onChange={e=>setReason(e.target.value)}/></Field><button disabled={busy||!reason.trim()} onClick={()=>void send('definition.retire',{reason},definition)}>Retire this definition</button></details></>}
  <WorkflowHistory record={definition} w={w} apiRoot={apiRoot} dataset={dataset}/>
 </article>;
}

function CountEditor({count,send,busy,w,onPlan}:{count:PrepCount;send:PrepSend;busy:boolean;w:FoodContext;onPlan:()=>void}){
 const initial=count.lines.map(line=>({definitionId:line.definitionId,quantity:line.quantity===null?'':String(line.quantity),note:line.note}));
 const [lines,setLines]=useState(initial),[confirmed,setConfirmed]=useState(false),[reason,setReason]=useState('');
 const dirty=JSON.stringify(lines)!==JSON.stringify(initial),missing=lines.filter(line=>line.quantity==='').length;
 const change=(index:number,patch:Partial<typeof lines[number]>)=>{setLines(values=>values.map((line,i)=>i===index?{...line,...patch}:line));setConfirmed(false)};
 return <article className="food-flow-panel"><div className="food-flow-actions"><h2>{count.businessDate} evening count</h2><Status value={count.status}/></div><p>{count.lines.length} definitions · {missing} missing counts · recorded by {personName(w,count.createdBy)}</p>
  <form onSubmit={async e=>{e.preventDefault();await send('count.save',{lines:lines.map(line=>({...line,quantity:line.quantity===''?null:Number(line.quantity)}))},count)}}><fieldset disabled={busy||count.status!=='draft'}><div className="food-flow-list">{count.lines.map((line,index)=><div className="food-flow-row" key={line.definitionId}><div><strong>{line.title}</strong><small>Par {line.par} {line.countUnit} · definition version {line.definitionRevision}</small><small>{lines[index].quantity===''?'Not counted':`Count entered: ${lines[index].quantity} ${line.countUnit}`}</small><Field label={'Count note for '+line.title}><input value={lines[index].note} maxLength={500} onChange={e=>change(index,{note:e.target.value})}/></Field></div><Field label={'Evening count: '+line.title+' ('+line.countUnit+')'}><input type="number" min="0" max="1000000" step="any" value={lines[index].quantity} placeholder="Not counted" onChange={e=>change(index,{quantity:e.target.value})}/></Field></div>)}</div>{count.status==='draft'&&<button className="shared-primary" disabled={!dirty}>Save count changes</button>}</fieldset></form>
  {count.status==='draft'?<><label className="food-flow-check"><input type="checkbox" disabled={busy||dirty} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed these saved evening counts, including any entries still marked missing.</label>{dirty&&<p className="food-flow-note">Save the count changes before submitting this snapshot.</p>}{missing>0&&<p className="food-flow-warning">{missing} {missing===1?'entry is':'entries are'} uncounted. A submitted count can preserve that missing information, but its prep plan cannot be released until the gaps are resolved.</p>}<button disabled={busy||dirty||!confirmed} onClick={()=>void send('count.submit',{confirmed:true},count)}>Submit reviewed count</button></>:<><button className="shared-primary" disabled={busy} onClick={onPlan}>Preview a prep plan</button></>}{<details><summary>{count.status==='draft'?'Refresh count definitions':'Reopen count for correction'}</summary><p>Current definitions will be checked. Changed source versions or units reset their quantity to missing; unchanged source and unit keep the recorded quantity.</p><Field label="Reason for correction or source refresh"><input disabled={busy} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></Field><button disabled={busy||!reason.trim()} onClick={()=>void send('count.reopen',{reason},count)}>{count.status==='draft'?'Refresh definitions':'Reopen count'}</button></details>}
 </article>;
}

function PlanGenerator({track,counts,plans,initialCountId,send,busy,onCreated}:{track:PrepTrack;counts:PrepCount[];plans:PrepPlan[];initialCountId:string;send:PrepSend;busy:boolean;onCreated:(id:string)=>void}){
 const [countId,setCountId]=useState(initialCountId),[target,setTarget]=useState(()=>{const count=counts.find(record=>record.id===initialCountId);return count?nextDate(count.businessDate,1):''});
 const count=counts.find(record=>record.id===countId&&record.status==='submitted');
 const existing=plans.find(plan=>plan.targetDate===target&&plan.track===track),released=!!existing&&existing.status!=='draft';
 return <form className="food-flow-panel" onSubmit={async e=>{e.preventDefault();if(!count||released)return;const result=await send('plan.generate',{countId:count.id,countRevision:count.revision,targetDate:target},existing);if(result)onCreated(result.recordId)}}><h2>Preview {trackName(track).toLowerCase()} for the next target date</h2><p>The saved count and reviewed par produce a draft. Release requires a current-day evening count for this restaurant. Choosing a later production date does not refresh an old count.</p><fieldset disabled={busy}><div className="food-flow-fields"><Field label="Submitted count"><select required value={countId} onChange={e=>{setCountId(e.target.value);const selected=counts.find(record=>record.id===e.target.value);setTarget(selected?nextDate(selected.businessDate,1):'')}}><option value="">Choose a submitted evening count</option>{counts.filter(record=>record.status==='submitted').map(record=><option key={record.id} value={record.id}>{record.businessDate} · count version {record.revision}</option>)}</select></Field><Field label="Prep target date"><input type="date" required value={target} min={count?nextDate(count.businessDate,1):undefined} max={count?nextDate(count.businessDate,31):undefined} onChange={e=>setTarget(e.target.value)}/></Field></div>{released?<p className="food-flow-note">A released plan already exists for this target date. Open that saved plan to record completion.</p>:<button className="shared-primary" disabled={!count||!target}>{existing?'Update existing draft preview':'Create plan preview'}</button>}{released&&<button type="button" onClick={()=>onCreated(existing!.id)}>Open saved plan</button>}</fieldset></form>;
}
function PlanCard({plan,currentCount,definitions,w,send,busy,commissaryOnly}:{commissaryOnly?:boolean;plan:PrepPlan;currentCount?:PrepCount;definitions:PrepDefinition[];w:FoodContext;send:PrepSend;busy:boolean}){
 const [confirmed,setConfirmed]=useState(false);
 const needed=plan.lines.filter(line=>line.plannedQty!==null&&line.plannedQty>0),done=needed.filter(line=>line.completedAt);
 const blockers=[...plan.blockers];
 if(plan.status==='draft'&&currentCount&&(currentCount.revision!==plan.countRevision||currentCount.status!=='submitted'))blockers.push('The evening count changed. Submit its reviewed version, then regenerate this draft.');
 if(plan.status==='draft'&&currentCount&&currentCount.businessDate!==localDate(new Date().toISOString(),w.location.timezone))blockers.push('This evening count is from an earlier business date. A future production target does not make an old count current.');
 if(plan.status==='draft'&&(plan.lines.some(line=>!definitions.some(definition=>definition.id===line.definitionId&&definition.revision===line.definitionRevision&&definition.foodRevision===line.foodRevision))||definitions.some(definition=>definition.status==='active'&&!plan.lines.some(line=>line.definitionId===definition.id))))blockers.push('A reviewed definition changed or was retired. Refresh and resubmit the count before regenerating this draft.');
 return <article className="food-flow-panel"><div className="food-flow-actions"><h2>{plan.targetDate} · {trackName(plan.track)}</h2><Status value={plan.status}/></div><p>Count version {plan.countRevision} · generated by {personName(w,plan.createdBy)} · plan version {plan.revision}</p>
  <div className="food-flow-summary"><div><strong>{needed.length}</strong><span>Prep tasks</span></div><div><strong>{done.length}</strong><span>Completed tasks</span></div><div><strong>{blockers.length}</strong><span>Source checks to resolve</span></div></div>
  {blockers.length>0&&<div className="food-flow-warning"><strong>Release is blocked</strong><ul>{blockers.map((blocker,i)=><li key={i}>{blocker}</li>)}</ul><p>Correct the source count or reviewed definition, then regenerate this draft.</p></div>}
  <div className="food-flow-table-wrap"><table className="food-flow-table"><thead><tr><th>Prep item</th><th>Reviewed par</th><th>Evening count</th><th>Planned</th><th>Completed</th></tr></thead><tbody>{plan.lines.map(line=><tr key={line.definitionId}><td>{line.title}<small>{line.countUnit}</small></td><td>{line.par}</td><td>{line.quantity??'Missing'}</td><td>{line.plannedQty??'Blocked'}</td><td>{line.completedQty??(line.plannedQty===0?'No prep needed':'Not recorded')}</td></tr>)}</tbody></table></div>
  {plan.status==='draft'&&<><label className="food-flow-check"><input disabled={busy||!!blockers.length} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this target date, count snapshot and planned quantities for {w.location.name}.</label><div className="food-flow-actions"><button className="shared-primary" disabled={busy||!confirmed||!!blockers.length} onClick={()=>void send('plan.release',{confirmed:true},plan)}>Release prep plan</button><button disabled={busy||!currentCount||currentCount.status!=='submitted'} onClick={()=>void send('plan.generate',{countId:plan.countId,countRevision:currentCount!.revision,targetDate:plan.targetDate},plan)}>Regenerate from latest submitted count</button></div><p>Regeneration refreshes this draft from the latest submitted version of its evening count.</p></>}
  {plan.status==='released'&&needed.filter(line=>!line.completedAt).map(line=><div key={line.definitionId}>{!commissaryOnly&&<Field label={'Assign '+line.title}><select disabled={busy} value={line.assignedTo??''} onChange={e=>{if(e.target.value)void send('plan.assign',{definitionId:line.definitionId,assignedTo:e.target.value},plan)}}><option value="" disabled>Choose responsible employee</option>{(w.members??[]).filter(m=>!m.scheduleOnly).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}<CompletePrep plan={plan} definitionId={line.definitionId} send={send} busy={busy}/></div>)}
  {done.map(line=><p key={line.definitionId}><strong>{line.title}:</strong> {line.completedQty} {line.countUnit} recorded by {personName(w,line.completedBy??undefined)}{line.completedAt?' · '+displayTime(line.completedAt,w.location.timezone):''}{line.completionNote?' · '+line.completionNote:''}</p>)}
 </article>;
}
function CompletePrep({plan,definitionId,send,busy}:{plan:PrepPlan;definitionId:string;send:PrepSend;busy:boolean}){
 const line=plan.lines.find(record=>record.definitionId===definitionId)!;
 const [quantity,setQuantity]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);
 return <form className="food-flow-row" onSubmit={async e=>{e.preventDefault();if(quantity==='')return;await send('plan.complete',{definitionId,quantity:Number(quantity),note,confirmed:true},plan)}}><fieldset disabled={busy}><h3>Complete {line.title}</h3><p>Planned {line.plannedQty} {line.countUnit}. Record what was actually prepared.</p><div className="food-flow-fields"><Field label={'Completed quantity ('+line.countUnit+')'}><input required min="0" max="1000000" type="number" step={line.quantityMode==='whole-portions'?'1':'any'} value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirmed(false)}}/></Field><Field label="Completion note (required if quantity differs)"><input required={quantity!==''&&Number(quantity)!==line.plannedQty} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></Field></div><label className="food-flow-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>This is the actual completed quantity.</label><button disabled={!confirmed||quantity===''}>Record completion</button></fieldset></form>;
}

function WorkflowHistory({record,w,apiRoot,dataset}:{record:PrepWorkflow;w:FoodContext;apiRoot:string;dataset:FoodDataset}){
 const [open,setOpen]=useState(false),[after,setAfter]=useState(0);
 const params=new URLSearchParams({locationId:w.location.id,dataset,recordId:record.id,after:String(after)});
 const {value:loaded,error:loadError}=useFoodRead(`${apiRoot}/food/workflows?${params}`,isDetail,String(record.revision),open);
 const wrongScope=loaded&&(loaded.record.id!==record.id||loaded.record.locationId!==w.location.id||loaded.record.dataset!==dataset),detail=wrongScope?null:loaded,error=loadError||(wrongScope?'The history source does not match this record.':'');
 return <details className="food-flow-history" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Source and action history</summary>{error&&<p role="alert">{error}</p>}{open&&!detail&&!error&&<p role="status">Loading saved history…</p>}{detail?.history.map(event=><p key={event.revision}><strong>{event.byName||personName(w,event.by)}</strong> · {displayTime(event.at,w.location.timezone)} · {event.action.replaceAll('.',' ')} · version {event.revision}<br/>{event.note}</p>)}{after>0&&<button onClick={()=>setAfter(0)}>First history entries</button>}{detail?.next!==null&&detail?.next!==undefined&&<button onClick={()=>setAfter(detail.next!)}>More history</button>}</details>;
}

type DraftLine={item:RecordOf<'fooditem'>;skuId:string;quantity:string};
function PurchaseWorkspace({w,apiRoot,dataset,page,send,busy,onNavigate,initialOrderId}:{initialOrderId?:string;w:FoodContext;apiRoot:string;dataset:FoodDataset;page:FoodWorkflowPage;send:Send;busy:boolean;onNavigate:(tab:string)=>void}){
 const [editing,setEditing]=useState<RecordOf<'order'>|null>(null),[creating,setCreating]=useState(false),[filter,setFilter]=useState('all'),[focused,setFocused]=useState(initialOrderId);
 const original=(w.records??[]).find((r):r is RecordOf<'order'>=>r.id===focused&&r.kind==='order'&&r.locationId===w.location.id&&r.data.food?.dataset===dataset);
 const orders=[...page.purchases,...(original&&!page.purchases.some(r=>r.id===original.id)?[original]:[])].filter(order=>order.data.food?.dataset===dataset),shown=orders.filter(order=>(!focused||order.id===focused)&&(filter==='all'||order.data.status===filter));
 return <>{focused&&<div className="food-flow-note"><strong>Opened original request {focused}</strong><button disabled={busy} onClick={()=>setFocused(undefined)}>All purchase requests</button></div>}<p className="food-flow-note">Requests use existing Food counts, item definitions and supplier packs. Approval is internal; supplier submission remains a separate authorized step.</p><div className="food-flow-actions">{page.permissions.purchase&&<button className="shared-primary" disabled={busy} onClick={()=>{setEditing(null);setCreating(!creating)}}>{creating?'Close draft editor':'Create purchase draft'}</button>}<button disabled={busy} onClick={()=>onNavigate('Orders')}>Other internal order requests</button></div>
  {(creating||editing)&&<PurchaseEditor key={editing?.id+':'+editing?.revision} w={w} apiRoot={apiRoot} dataset={dataset} order={editing??undefined} send={send} busy={busy} onSaved={()=>{setCreating(false);setEditing(null)}}/>}
  <div className="food-flow-context"><Field label="Request status"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All requests</option>{['draft','review','returned','approved'].map(status=><option key={status} value={status}>{statusName(status)}</option>)}</select></Field><span>{shown.length} requests shown</span></div>
  {!shown.length&&<p className="food-flow-empty">No {filter==='all'?'':statusName(filter).toLowerCase()+' '}Food purchase requests are recorded in this dataset.</p>}
  {shown.map(order=><PurchaseCard key={order.id+':'+order.revision} order={order} w={w} busy={busy} send={send} canReview={page.permissions.reviewPurchase} canRequest={page.permissions.purchase} onEdit={()=>{setEditing(order);setCreating(false)}}/>)}
  {page.more.purchases&&<p className="food-flow-note">The most recent 30 purchase requests are shown. The full shared order history remains available through Other internal order requests.</p>}
 </>;
}

function PurchaseEditor({w,apiRoot,dataset,order,send,busy,onSaved}:{w:FoodContext;apiRoot:string;dataset:FoodDataset;order?:RecordOf<'order'>;send:Send;busy:boolean;onSaved:()=>void}){
 const [lines,setLines]=useState<DraftLine[]>([]),[selected,setSelected]=useState<RecordOf<'fooditem'>|null>(null),[skuId,setSkuId]=useState(''),[quantity,setQuantity]=useState(''),[countDate,setCountDate]=useState(()=>order?.data.food?.countDate??localDate(new Date().toISOString(),w.location.timezone)),[note,setNote]=useState(order?.data.note??''),[confirmed,setConfirmed]=useState(false),[loading,setLoading]=useState(!!order),[error,setError]=useState('');
 useEffect(()=>{
  if(!order)return;const controller=new AbortController();
  void (async()=>{
   const loaded:DraftLine[]=[];
   for(const line of order.data.lines){
    if(!line.food)throw new Error('This request is not linked to the Food catalog. Use the existing internal order editor.');
    const params=new URLSearchParams({locationId:w.location.id,dataset,kind:'fooditem',itemId:line.food.itemId});
    const page=await readResponse(await fetch(`${apiRoot}/food?${params}`,{signal:controller.signal,credentials:'same-origin',cache:'no-store'}),isFoodPage);
    const item=page.records.find((record):record is RecordOf<'fooditem'>=>record.kind==='fooditem'&&record.id===line.food?.itemId&&record.locationId===w.location.id&&record.data.source.dataset===dataset);
    if(!item)throw new Error('A linked Food item is unavailable. Refresh the catalog before revising this request.');
    loaded.push({item,skuId:line.food.sku.id,quantity:String(line.quantity)});
   }
   if(!controller.signal.aborted)setLines(loaded);
  })().catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not refresh the order sources.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[apiRoot,w.location.id,dataset,order]);
 const selectedSku=selected?.data.vendorSkus.find(sku=>sku.id===skuId),number=Number(quantity),today=localDate(new Date().toISOString(),w.location.timezone);
 const issues=lines.flatMap(line=>{
  const item=line.item.data,sku=item.vendorSkus.find(value=>value.id===line.skuId),messages:string[]=[];
  if(!item.count||localDate(item.count.at,w.location.timezone)!==countDate)messages.push('A physical count on the chosen count date is required');
  if(item.par===null)messages.push('Reviewed inventory par is missing');
  if(!item.active||item.needsReview||!item.countActive)messages.push('Food definition or count setup needs review');
  if(!sku?.available||sku.price===null||!sku.priceUpdatedAt)messages.push('An available supplier pack with a dated price is required');
  if(sku?.priceUpdatedAt&&sku.priceUpdatedAt.slice(0,10)>today)messages.push('Supplier price date is in the future');
  return messages.map(message=>item.title+': '+message);
 });
 if(countDate!==today)issues.push('Purchasing needs a saved physical count from today at this restaurant.');
 const vendors=[...new Set(lines.map(line=>line.item.data.vendorSkus.find(sku=>sku.id===line.skuId)?.vendor).filter(Boolean))];
 if(vendors.length>1)issues.push('Use one supplier per request. Save separate drafts for different suppliers.');
 return <form className="food-flow-panel" onSubmit={async e=>{e.preventDefault();if(!confirmed||!lines.length||issues.length)return;setError('');if(await send('order.food-save',{dataset,countDate,lines:lines.map(line=>({itemId:line.item.id,itemRevision:line.item.revision,skuId:line.skuId,quantity:Number(line.quantity)})),note},order))onSaved()}}><h2>{order?'Revise Food purchase request':'New Food purchase draft'}</h2><p>Choose counted items and explicit supplier-pack quantities. The server checks current source versions before saving the shared order record.</p>
  {loading&&<p role="status">Refreshing the linked Food definitions…</p>}{error&&<p role="alert" className="food-flow-error">{error}</p>}
  <fieldset disabled={busy||loading}>
   <Field label="Physical count date (today at this restaurant)"><input type="date" required min={today} max={today} value={countDate} onChange={e=>{setCountDate(e.target.value);setConfirmed(false)}}/></Field>
   <CanonicalPicker w={w} apiRoot={apiRoot} dataset={dataset} busy={busy||loading} onSelect={record=>{if(record.kind==='fooditem'){setSelected(record);setSkuId('');setQuantity('');setConfirmed(false)}}}/>
   {selected&&<div className="food-flow-panel"><h3>{selected.data.title}</h3><SourceLine record={selected}/><p>{selected.data.count?`Count: ${selected.data.count.quantity} ${selected.data.purchaseUnit} · ${displayTime(selected.data.count.at,w.location.timezone)}`:'Physical count missing'} · Inventory par: {selected.data.par??'Not set'}</p><div className="food-flow-fields"><Field label="Saved supplier pack"><select value={skuId} required={false} onChange={e=>setSkuId(e.target.value)}><option value="">Choose a supplier pack</option>{selected.data.vendorSkus.map(sku=><option key={sku.id} value={sku.id} disabled={!sku.available}>{sku.vendor} · {sku.vendorSku} · {sku.purchaseUnit||'Unit missing'}{!sku.available?' · Unavailable':''}</option>)}</select></Field><Field label="Requested supplier packs"><input type="number" min="1" max="10000" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></Field></div>{selectedSku&&<p>{selectedSku.packCount??'?'} × {selectedSku.unitQty??'?'} {selectedSku.unitUOM||'measure missing'} per {selectedSku.purchaseUnit||'pack'} · {selectedSku.price===null?'Price missing':money(Math.round(selectedSku.price*100))} · price date {selectedSku.priceUpdatedAt||'missing'}</p>}<button type="button" disabled={!selectedSku||!Number.isInteger(number)||number<=0||number>10000||lines.length>=40||lines.some(line=>line.item.id===selected.id)} onClick={()=>{setLines(values=>[...values,{item:selected,skuId,quantity}]);setSelected(null);setQuantity('');setSkuId('');setConfirmed(false)}}>Add counted item</button></div>}
   {lines.map((line,index)=>{const sku=line.item.data.vendorSkus.find(value=>value.id===line.skuId);return <div className="food-flow-row" key={line.item.id+':'+line.skuId}><div><strong>{line.item.data.title}</strong><small>{sku?.vendor??'Supplier unavailable'} · {sku?.vendorSku??'SKU missing'} · {sku?.purchaseUnit??'Unit missing'} · Food version {line.item.revision}</small><small>{line.item.data.count?`Count ${line.item.data.count.quantity} ${line.item.data.purchaseUnit} on ${localDate(line.item.data.count.at,w.location.timezone)}`:'Count missing'}</small><button type="button" onClick={()=>{setLines(values=>values.filter((_,i)=>i!==index));setConfirmed(false)}}>Remove</button></div><Field label={'Requested packs of '+line.item.data.title}><input required min="1" max="10000" step="1" type="number" value={line.quantity} onChange={e=>{setLines(values=>values.map((value,i)=>i===index?{...value,quantity:e.target.value}:value));setConfirmed(false)}}/></Field></div>})}
   {issues.length>0&&<div className="food-flow-warning"><strong>Sources need review before saving</strong><ul>{[...new Set(issues)].map(issue=><li key={issue}>{issue}</li>)}</ul><p>Correct the shared Food records, then reopen this draft to refresh its sources.</p></div>}
   <Field label="Request note"><textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></Field><label className="food-flow-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked this restaurant, dataset, physical count date, supplier packs and requested quantities.</label>
   <button className="shared-primary" disabled={!confirmed||!lines.length||!!issues.length||!!error}>{order?.data.status==='returned'?'Save revised draft':'Save internal draft'}</button>
  </fieldset>
 </form>;
}
function PurchaseCard({order,w,busy,send,canReview,canRequest,onEdit}:{order:RecordOf<'order'>;w:FoodContext;busy:boolean;send:Send;canReview:boolean;canRequest:boolean;onEdit:()=>void}){
 const [reviewNote,setReviewNote]=useState('');
 const mine=order.ownerId===w.me.id,source=order.data.food,oldCount=!!source&&source.countDate!==localDate(new Date().toISOString(),w.location.timezone);
 return <article className="food-flow-panel"><div className="food-flow-row"><div><h2>{source?.vendor??'Food request'}</h2><p>{personName(w,order.ownerId)} · {order.data.lines.length} items · count date {source?.countDate??'not recorded'}</p><small>Updated {displayTime(order.updatedAt,w.location.timezone)} · order version {order.revision}</small></div><div><Status value={order.data.status}/>{source&&<strong>{money(source.totalCents)}</strong>}</div></div><p>{order.data.note}</p>
  <div className="food-flow-table-wrap"><table className="food-flow-table"><thead><tr><th>Food item</th><th>Supplier pack</th><th>Requested</th><th>Saved estimate</th></tr></thead><tbody>{order.data.lines.map((line,index)=><tr key={index}><td>{line.name}<small>{line.food?'Food version '+line.food.itemRevision:'Internal request line'}</small></td><td>{line.food?.sku.vendorSku||line.productId||'Product code not entered'}<small>{line.unit}{line.food?' · price dated '+line.food.sku.priceUpdatedAt:''}</small></td><td>{line.quantity}</td><td>{line.food?money(line.food.lineTotalCents):'Not recorded'}</td></tr>)}</tbody></table></div>
  <div className="food-flow-actions">{mine&&canRequest&&['draft','returned'].includes(order.data.status)&&<><button disabled={busy} onClick={onEdit}>{order.data.status==='returned'?'Revise and reopen draft':'Edit draft'}</button>{order.data.status==='draft'&&<button className="shared-primary" disabled={busy||oldCount} onClick={()=>void send('order.submit',{},order)}>Submit for review</button>}</>}{mine&&canRequest&&order.data.status==='review'&&<button disabled={busy} onClick={()=>void send('order.withdraw',{},order)}>Withdraw to edit</button>}</div>
  {oldCount&&['draft','review','returned'].includes(order.data.status)&&<p className="food-flow-warning">The saved physical count is from an earlier day. Withdraw or return the request, recount in Food inventory, and save a refreshed draft before submission or approval.</p>}
  {order.data.status==='review'&&canReview&&(mine?<p className="food-flow-warning">You created this request. A different authenticated reviewer must decide.</p>:<fieldset disabled={busy}><Field label="Reviewer decision note"><textarea required maxLength={2000} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="Record the checks or changes required."/></Field><div className="food-flow-actions"><button className="shared-primary" disabled={!reviewNote.trim()||oldCount} onClick={()=>void send('order.review',{approve:true,note:reviewNote},order)}>Approve internally</button><button disabled={!reviewNote.trim()} onClick={()=>void send('order.review',{approve:false,note:reviewNote},order)}>Return for changes</button></div></fieldset>)}
  {order.data.status==='approved'&&<p className="food-flow-note">Approved for separate supplier preparation. Nothing has been sent, purchased or received by this approval.</p>}
  <details className="food-flow-history"><summary>Order and source history</summary><p>Uses the shared JMAX order record and its existing approval history.</p>{source&&<p>Food dataset: {source.dataset==='demo'?'Demo / training':'Restaurant records'} · source snapshot {displayTime(source.capturedAt,w.location.timezone)}</p>}{order.data.lines.map((line,index)=>line.food&&<p key={index}>{line.name}: count {line.food.count.quantity} {line.food.countPack.purchaseUnit}, taken {displayTime(line.food.count.at,w.location.timezone)}; supplier {line.food.sku.vendor}, pack {line.food.sku.packCount??'?'} × {line.food.sku.unitQty??'?'} {line.food.sku.unitUOM}; requested {line.quantity} {line.unit}.</p>)}{order.data.history.map((entry,index)=><p key={index}>{personName(w,entry.actorId)} · {displayTime(entry.at,w.location.timezone)} · {entry.action}<br/>{entry.note}</p>)}</details>
  {!!order.data.foodVersions?.length&&<details className="food-flow-history"><summary>Earlier saved source snapshots ({order.data.foodVersions.length})</summary>{order.data.foodVersions.map((version,index)=><details key={index}><summary>{displayTime(version.at,w.location.timezone)} · {version.food.vendor} · {money(version.food.totalCents)}</summary><p>Revised by {personName(w,version.by)} · original count date {version.food.countDate}</p><ul>{version.lines.map((line,i)=><li key={i}>{line.name}: {line.quantity} {line.unit}{line.food?` · Food version ${line.food.itemRevision} · ${line.food.sku.vendorSku} · counted ${line.food.count.quantity} ${line.food.countPack.purchaseUnit}`:''}</li>)}</ul></details>)}</details>}
 </article>;
}

