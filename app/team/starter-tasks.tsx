'use client';
import { useState } from 'react';
import { starterTaskPacks, starterTaskRevision, confirmedDutiesForLocation, confirmedDutySource } from '../shared/starter-tasks';
import { canDraftStandard, type RecordOf, type Workspace } from '../shared/types';
import type { Send } from './workspace';

export function StarterTasks({w,send,onOpen}:{w:Workspace;send:Send;onOpen:(r:RecordOf<'standard'>)=>void}) {
  const [busy,setBusy]=useState(false);
  const packs=starterTaskPacks.filter(p=>canDraftStandard(w.me,p.area));
  const existing=(id:string)=>w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.data.status!=='retired'&&r.data.provenance?.starter?.templateId===id);
  const missing=packs.filter(p=>!existing(p.id));
  const confirmed=confirmedDutiesForLocation(w.location.id,['FOH','BOH'].filter(area=>canDraftStandard(w.me,area)));
  if(!packs.length)return null;
  async function add(ids:string[]){setBusy(true);try{await send('standard.preload-starters',{templateIds:ids,catalogRevision:starterTaskRevision})}finally{setBusy(false)}}
  return <section className="shared-recovered-sources" aria-label="Starter tasks by job">
    <h3>Starter tasks by job</h3>
    <p>Additional routines for jobs and stations not covered by the detailed guides below. Review these proposed tasks alongside the existing guides before approval.</p>
    <p>{packs.length-missing.length} of {packs.length} proposed job drafts saved. Dishwasher staff can view their own assigned work and approved Dishwasher instructions; this draft tool grants no additional access.</p>
    {confirmed.length>0&&<details><summary>Confirmed duties for {w.location.name}</summary><p>Source: <a href={confirmedDutySource.url}>{confirmedDutySource.title}</a> · {confirmedDutySource.date}. These recorded owner answers are separate from the older general starter drafts. Use them when reviewing an existing guide; this reference does not approve, assign or overwrite saved work.</p>{confirmed.map(item=><details key={item.id}><summary>{item.role}</summary>{[['Opening',item.opening],['During service',item.service],['Closing',item.closing]].map(([title,items])=>(items as readonly string[]).length>0&&<section key={title as string}><h4>{title}</h4><ul>{(items as readonly string[]).map(text=><li key={text}>{text}</li>)}</ul></section>)}</details>)}</details>}
    <button className="shared-primary" disabled={busy||!missing.length} onClick={()=>void add(missing.map(p=>p.id))}>{busy?'Saving drafts…':missing.length?`Add ${missing.length} job drafts`:'All job drafts saved'}</button>
    <details><summary>Review the job lists</summary>{packs.map(p=>{const saved=existing(p.id);return <details key={p.id}><summary>{p.role} · {saved?(saved.data.status==='approved'?'Approved':'Draft saved'):'Not added'}</summary>{saved?<><p>Review the saved guide for its current instructions and remaining questions.</p><button onClick={()=>onOpen(saved)}>Open {p.role} {saved.data.status==='approved'?'guide':'draft'}</button></>:<>{[['Opening',p.opening],['During service',p.service],['Closing',p.closing]].map(([title,items])=><section key={title as string}><h4>{title}</h4><ul>{(items as string[]).map(item=><li key={item}>{item}</li>)}</ul></section>)}<p><strong>Review together:</strong> {p.review}</p><button disabled={busy} onClick={()=>void add([p.id])}>Add {p.role} draft</button></>}</details>})}</details>
  </section>;
}
