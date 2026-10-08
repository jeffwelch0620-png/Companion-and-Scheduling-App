'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { canDraftStandard, has, type RecordOf, type Workspace } from '../shared/types';
import type { SourceDocument } from '../shared/source-library-types';
import { localDate } from '../shared/local-time';
import type { Send } from './workspace';
import { StationGuideContent } from './station-knowledge';

export function SourceDraftEditor({w,record,send,onError}:{w:Workspace;record:RecordOf<'standard'>;send:Send;onError:(message:string)=>void}) {
  const d=record.data,p=d.provenance!,editing=d.status==='draft';
  const [step,setStep]=useState(0),[busy,setBusy]=useState(false),[original,setOriginal]=useState<SourceDocument|null>(null),[sourceError,setSourceError]=useState('');
  const [value,setValue]=useState({title:d.title,zone:d.zone,position:d.position,version:editing?d.version:d.version+1,source:d.source,criteria:d.criteria.join('\n'),purpose:d.guide?.purpose??'',preparation:d.guide?.preparation.join('\n')??'',steps:d.guide?.steps.join('\n')??'',troubleshooting:d.guide?.troubleshooting.join('\n')??'',escalation:d.guide?.escalation??'',ownerId:editing?p.review?.ownerId??'':'',reviewedOn:editing?p.review?.reviewedOn??'':'',evidence:editing?p.review?.evidence??'':''});
  const [answers,setAnswers]=useState<Record<string,string>>(editing?p.answers:{}),formRef=useRef<HTMLFormElement>(null);
  useLayoutEffect(()=>{formRef.current?.closest('dialog')?.scrollTo({top:0,left:0,behavior:'instant'})},[step]);
  const lines=(v:string)=>v.split('\n').map(s=>s.trim()).filter(Boolean);
  const guide={purpose:value.purpose,preparation:lines(value.preparation),steps:lines(value.steps),troubleshooting:lines(value.troubleshooting),escalation:value.escalation};
  const field=(key:keyof typeof value,label:string,multiline=false,max=2000,required=false)=> <label className="shared-field">{label}{multiline?<textarea value={String(value[key])} maxLength={max} required={required} onChange={e=>setValue(v=>({...v,[key]:e.target.value}))}/>:<input value={String(value[key])} maxLength={max} required={required} readOnly={(key==='zone'||key==='position')&&(!editing||!!d.supersedes)} onChange={e=>setValue(v=>({...v,[key]:e.target.value}))}/>}</label>;
  async function readOriginal(){setSourceError('');try{const response=await fetch('/api/source-library?locationId='+encodeURIComponent(w.location.id)+'&documentId='+encodeURIComponent(p.intake!.documentId),{cache:'no-store'});const result=await response.json() as {error?:string;document?:SourceDocument};if(!response.ok||!result.document)throw Error(result.error??'The original source could not load.');setOriginal(result.document);}catch(e){setSourceError(e instanceof Error?e.message:'The original source could not load.')}}
  return <form ref={formRef} className="training-editor" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await send('standard.save',{title:value.title,zone:value.zone,position:value.position,version:value.version,criteria:lines(value.criteria),source:value.source,verification:d.verification,guide,sourceAnswers:answers,sourceReview:{ownerId:value.ownerId,reviewedOn:value.reviewedOn,evidence:value.evidence},...(!editing?{basedOnId:record.id,basedOnRevision:record.revision}:{})},editing?record:undefined)}catch(e){onError(e instanceof Error?e.message:'The draft could not save.')}finally{setBusy(false)}}}>
    <div className="training-tabs" aria-label="Guide drafting steps">{['Guide',p.starter?'Restaurant review':'Source review','Preview'].map((s,i)=><button type="button" key={s} aria-pressed={step===i} onClick={()=>setStep(i)}>{i+1}. {s}</button>)}</div>
    <p className="source-status">Draft · Employees see this after approval</p>
    {!editing&&<p>This creates a new version. Its source review starts fresh.</p>}
    <section hidden={step!==0}>
      {field('title','Guide title',false,200,true)}
      <div className="shared-grid">{field('zone','Training topic / work area',false,100,true)}{field('position','Station / role',false,100,true)}</div>
      <label className="shared-field">Version<input type="number" min="1" required value={value.version} onChange={e=>setValue(v=>({...v,version:Number(e.target.value)}))}/></label>
      {field('purpose','Purpose',true)}{field('preparation','Before you start — one item per line',true,15015)}{field('steps','Instructions — one step per line',true,30030)}{field('troubleshooting','If something goes wrong — one item per line',true,15015)}{field('escalation','When to get help',true)}{field('criteria','What the learner should demonstrate — one item per line',true,15030)}
    </section>
    <section hidden={step!==1}>
      <h3>Review this guide for your restaurant</h3><p>{p.starter?'These are suggested job routines. Confirm the responsibilities, fill in the local methods and remove anything that does not apply.':p.intake?.title+'. The original stays reference material; this review applies to the instructions in this guide.'}</p>
      {p.intake&&has(w.me,'location.manage')&&<details onToggle={e=>{if(e.currentTarget.open&&!original&&!sourceError)void readOriginal()}}><summary>Read original source</summary>{sourceError?<p role="alert">{sourceError} <button type="button" onClick={()=>void readOriginal()}>Try again</button></p>:original?<div className="source-text" tabIndex={0}>{original.content}</div>:<p role="status">Loading source…</p>}</details>}
      <label className="shared-field">Content owner<select value={value.ownerId} onChange={e=>setValue(v=>({...v,ownerId:e.target.value}))}><option value="">Choose who maintains this guide</option>{w.members.filter(m=>!m.scheduleOnly&&canDraftStandard(m,record.area)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="shared-field">Date reviewed<input type="date" value={value.reviewedOn} max={localDate(new Date().toISOString(),w.location.timezone)} onInput={e=>{const reviewedOn=e.currentTarget.value;setValue(v=>({...v,reviewedOn}))}} onChange={e=>setValue(v=>({...v,reviewedOn:e.target.value}))}/></label>
      {field('evidence','Current restaurant evidence used for this review',true)}
      {field('source','Source citation for employees',true)}
      {p.questions.map(q=><label className="shared-field" key={q.id}>{q.prompt}<textarea maxLength={2000} value={answers[q.id]??''} onChange={e=>setAnswers(v=>({...v,[q.id]:e.target.value}))}/></label>)}
    </section>
    {step===2&&<section><h3>{value.title}</h3><p>{record.area} · {value.position} · {value.zone}</p><StationGuideContent guide={guide}/><h3>What the learner should demonstrate</h3><ul>{lines(value.criteria).map((c,i)=><li key={i}>{c}</li>)}</ul><p><strong>Source:</strong> {value.source}</p><p>{p.questions.filter(q=>!answers[q.id]?.trim()).length} source questions unanswered</p><p>Save the draft, then review its approval checklist.</p></section>}
    <div className="training-editor-actions"><button type="button" disabled={step===0||busy} onClick={()=>setStep(s=>s-1)}>Back</button>{step<2&&<button type="button" disabled={busy} onClick={()=>setStep(s=>s+1)}>{step===0?(p.starter?'Review for restaurant':'Review source'):'Preview guide'}</button>}<button className="shared-primary" disabled={busy}>{busy?'Saving…':'Save draft'}</button></div>
  </form>;
}
