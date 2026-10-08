'use client';
import { useState, type ReactNode } from 'react';
import { canDraftStandard, manages, personName, type RecordOf, type Workspace } from '../shared/types';
import { trainingReviewIssues } from '../shared/training-review';
import type { Send } from './workspace';
import { SourceDraftEditor } from './source-draft-editor';
import { SourceReview } from './standard-sources';
import { StationGuideContent } from './station-knowledge';

export function SourceGuideDetail({w,record:r,send,onError,trail}:{w:Workspace;record:RecordOf<'standard'>;send:Send;onError:(m:string)=>void;trail:ReactNode}) {
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false);
  const p=r.data.provenance!,g=r.data.guide;
  const issues=trainingReviewIssues(w,p,new Date().toISOString(),r.area);
  if(!g?.purpose||!g.steps.length||!g.escalation||!r.data.criteria.length)issues.unshift('Complete the purpose, instructions, help guidance and learner demonstration conditions.');
  if(editing)return <><button className="schedule-back" onClick={()=>setEditing(false)}>‹ Back to guide</button><SourceDraftEditor w={w} record={r} send={send} onError={onError}/></>;
  return <section className="training-guide-detail"><p className="source-status">{r.data.status==='draft'?'Draft · Not yet visible to employees':r.data.status==='approved'?'Approved guide':'Retired guide'} · Version {r.data.version}</p><p>{r.area} · {r.data.position} · {r.data.zone}</p>
    {canDraftStandard(w.me,r.area)&&<button className="shared-primary" onClick={()=>setEditing(true)}>{r.data.status==='draft'?'Continue draft':'Draft a new version'}</button>}
    <StationGuideContent guide={g}/><h3>What the learner should demonstrate</h3>{r.data.criteria.length?<ul>{r.data.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul>:<p>Not written yet.</p>}
    <p><strong>Source:</strong> {r.data.source}</p>
    {p.review&&<p><strong>Content owner:</strong> {personName(w,p.review.ownerId,'Needs assignment')} · Reviewed {p.review.reviewedOn||'not yet dated'}</p>}
    {p.review?.evidence&&<p><strong>Review evidence:</strong> {p.review.evidence}</p>}
    <details><summary>Source decisions · {p.questions.filter(q=>p.answers[q.id]?.trim()).length} of {p.questions.length} answered</summary><SourceReview provenance={p} approved={r.data.status==='approved'}/></details>
    {r.data.status==='draft'&&<section className="source-issues"><h3>Ready for approval?</h3>{issues.length?<><p>{issues.length} {issues.length===1?'item still needs':'items still need'} attention.</p><ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></>:<p>The instructions and source review are complete. An approver must now validate this exact version.</p>}</section>}
    {manages(w.me,r.area,'standards.approve')&&r.data.status==='draft'&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);try{await send('standard.approve',{validated:f.get('validated')==='on',note:String(f.get('note')??'')},r)}catch(e){onError(e instanceof Error?e.message:'Approval could not save.')}finally{setBusy(false)}}}><label className="shared-check"><input type="checkbox" name="validated" required disabled={issues.length>0}/>I checked these instructions, source decisions and learning conditions against current restaurant practice.</label><label className="shared-field">Approval record<textarea name="note" required maxLength={2000}/></label><button className="shared-primary" disabled={issues.length>0||busy}>Approve guide for employees</button></form>}
    {manages(w.me,r.area,'standards.approve')&&r.data.status!=='retired'&&<details><summary>{r.data.status==='draft'?'Remove this draft':'Retire this guide'}</summary><form onSubmit={async e=>{e.preventDefault();await send('standard.retire',{note:String(new FormData(e.currentTarget).get('note')??'')},r)}}><label className="shared-field">Reason<textarea name="note" required maxLength={2000}/></label><button>{r.data.status==='draft'?'Remove draft':'Retire guide'}</button></form></details>}{trail}
  </section>;
}
