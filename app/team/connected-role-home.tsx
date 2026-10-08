'use client';
import {useEffect,useState} from 'react';
import {buildOwnerHome,buildRoleHome,type ExpectedRoleHomeSource,type RoleHomeAttention,type RoleHomeKind,type RoleHomeModel} from '../shared/role-home';
import {authorizedRoleHomeKind,completedOwnRoleHomeTasks} from '../shared/role-home-target';
import type {Workspace} from '../shared/types';
import type {WorkspaceMembership} from '../shared/workspace-context';
import './role-home.css';
import './connected-role-home.css';

export const expectedReviewLocations:ExpectedRoleHomeSource[]=[{locationId:'berts',locationName:"Bert's"},{locationId:'rudds',locationName:"Rudd's"},{locationId:'papa',locationName:"Papa Leone's"},{locationId:'comm',locationName:'Commissary'}];
type Props={w:Workspace;memberships:WorkspaceMembership[];role:RoleHomeKind;now:string;endpoint:string;busy:boolean;onOpen:(item:RoleHomeAttention)=>void};
export function ConnectedRoleHome({w,memberships,role:requested,now,endpoint,busy,onOpen}:Props){
 const role=authorizedRoleHomeKind(w,requested),memberKey=memberships.map(m=>m.id+':'+m.locationId).sort().join('|');
 const [group,setGroup]=useState<{source:Workspace;key:string;model:RoleHomeModel}|null>(null),[focus,setFocus]=useState<string|null>(null);
 useEffect(()=>{
  if(role!=='owner')return;const abort=new AbortController();
  void Promise.all(memberships.map(async member=>{
   try{
    if(member.locationId===w.location.id&&member.id===w.me.id)return {workspace:w};
    const response=await fetch(`${endpoint}?locationId=${encodeURIComponent(member.locationId)}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal});
    if(!response.ok)throw Error('Source unavailable');const workspace=await response.json() as Workspace;
    if(workspace.location.id!==member.locationId||workspace.me.id!==member.id||workspace.me.locationId!==member.locationId)throw Error('Account scope changed');
    return {workspace};
   }catch{return {missing:{locationId:member.locationId,locationName:member.locationName,state:'unavailable' as const,reason:'This authorized location could not be refreshed. Its current work is unavailable.'}};}
  })).then(results=>{
   if(abort.signal.aborted)return;
   const workspaces=results.flatMap(r=>r.workspace?[r.workspace]:[]),missing=results.flatMap(r=>r.missing?[r.missing]:[]);
   const expected=[...missing,...expectedReviewLocations.filter(expected=>!missing.some(m=>m.locationId===expected.locationId))];
   setGroup({source:w,key:memberKey,model:buildOwnerHome(workspaces,new Date(now),expected)});
  });return()=>abort.abort();
 },[w,memberKey,role,endpoint,now,memberships]);
 const model=role==='owner'?(group?.source===w&&group.key===memberKey?group.model:null):buildRoleHome(w,role,new Date(now));
 const activeFocus=role==='owner'?focus:null;
 const items=model?.attention.filter(item=>!activeFocus||item.locationId===activeFocus)??[];
 const completed=role==='frontline'?completedOwnRoleHomeTasks(w,new Date(now)):[];
 return <section className="rh-review rh-connected"><div className="rh-page-heading"><div><p className="rh-kicker">LOCAL WORKFLOW REVIEW · SAVED FICTIONAL RECORDS</p><h1>{model?.title??'Our restaurants and commissary'}</h1><p>{model?.purpose??'Refreshing each authorized restaurant before showing its work.'}</p></div><span className="rh-count">{w.me.name} · {w.me.position}</span></div>
  {requested!==role&&<p className="shared-notice">The requested home is limited to this account’s assigned scope: {role.replaceAll('-',' ')}.</p>}
  <p className="rh-connected-context">{role==='owner'?'Group overview across this account’s authorized restaurants':w.location.name+' · '+(role==='general-manager'?'FOH + BOH':role==='department-manager'?w.me.area:'your assigned position')}. Opening a card refreshes its original record before enabling the existing workflow.</p>
  {!model?<p role="status">Refreshing authorized group sources…</p>:<>
   <div className="rh-overview-strip"><div><strong>{items.filter(i=>i.priority==='urgent').length}</strong><span>marked urgent<small>Recorded priorities</small></span></div><div><strong>{items.filter(i=>!i.recordId).length}</strong><span>source gaps<small>Missing is not ready</small></span></div><div><strong>{model.sources.filter(s=>s.state==='available').length} / {model.sources.length}</strong><span>sources available<small>Saved records, not live readiness</small></span></div></div>
   {role==='owner'&&<nav className="rh-connected-locations" aria-label="Home restaurant scope"><button aria-pressed={!activeFocus} onClick={()=>setFocus(null)}>Whole group</button>{model.sources.map(source=><button key={source.locationId} aria-pressed={activeFocus===source.locationId} onClick={()=>setFocus(source.locationId)}>{source.locationName}<small>{source.state==='available'?'Available':source.state}</small></button>)}</nav>}
   <div className="rh-section-heading"><div><span className="rh-kicker">What · Why · Who · Next</span><h2>{activeFocus?model.sources.find(s=>s.locationId===activeFocus)?.locationName:'Work to move forward'}</h2></div><span className="rh-count">{items.length} saved items and gaps</span></div>
   <div className="rh-work-grid">{items.map(item=><article className="rh-attention" key={item.id} data-record-id={item.recordId??undefined} data-location-id={item.locationId} data-priority={item.priority}><div className="rh-card-meta"><span>{item.locationName} · {item.area}</span><span className="rh-source-badge" data-state={item.freshness.state}>{item.freshness.state==='recorded'?'Saved record':item.freshness.state}</span></div><h3>{item.what}</h3><p className="rh-why">{item.why}</p><dl className="rh-next"><div><dt>Responsible</dt><dd>{item.person}</dd></div><div><dt>Next step</dt><dd>{item.nextAction}</dd></div></dl><div className="rh-card-bottom"><small>{item.source.label}{item.source.revision!==null?' · v'+item.source.revision:''}</small>{item.actionable?<button disabled={busy} onClick={()=>onOpen(item)}>Open workflow ↗</button>:<span className="rh-no-record">Source needed</span>}</div></article>)}</div>
   {!items.length&&<p className="rh-empty">No work was supplied for this view. Review the sources before assessing the shift.</p>}
   {completed.length>0&&<section className="rh-evidence"><h2>My completed assignments</h2><p>These saved assignments have been verified. Open the original record to review who did the work and who checked it.</p>{completed.map(item=><div className="rh-evidence-row" key={item.id} data-record-id={item.recordId}><strong>{item.what}</strong><span>Verified · v{item.source.revision}</span><button disabled={busy} onClick={()=>onOpen(item)}>Open saved assignment ↗</button></div>)}</section>}
   <section className="rh-evidence"><h2>Source coverage</h2>{model.sources.map(source=><div className="rh-evidence-row" key={source.locationId}><strong>{source.locationName}</strong><span data-state={source.state}>{source.state}</span><p>{source.label}</p></div>)}<p className="rh-evidence-note">No sales, food-cost or labor-cost feed is supplied here. The home does not infer financial totals or an all-clear result.</p></section>
   <details className="rh-assumptions"><summary>Home scope and working assumptions</summary><ul>{model.assumptions.map(note=><li key={note}>{note}</li>)}</ul></details>
  </>}
 </section>;
}
