'use client';
import { canDraftStandard, type RecordOf, type StandardProvenance, type Workspace } from '../shared/types';
import type { Send } from './workspace';
import { StationGuideContent } from './station-knowledge';

export function SourceReview({provenance:p,approved=false}:{provenance:StandardProvenance;approved?:boolean}){
  const remaining=p.questions.filter(q=>!p.answers[q.id]?.trim()).length;
  return <section><h3>Restaurant source review</h3><p>{p.restaurant} · {p.starter?'Draft created':p.intake?'Source captured':'Source dated'} {p.sourceDate}</p><p>{p.attribution}</p><p>{remaining?`${remaining} questions still need a restaurant answer before approval.`:approved?'Restaurant clarifications were included in the approval of this version.':'Every source question has an answer. The approver still needs to validate this complete version.'}</p>
    <dl>{p.questions.map(q=><div key={q.id}><dt><strong>{q.prompt}</strong></dt><dd className="shared-message">{p.answers[q.id]||'Not yet resolved.'}</dd></div>)}</dl>
    <details hidden={!p.references.length}><summary>{p.intake?'Original source record':'Read the recovered source excerpts'}</summary><p>Historical source material. Follow the current approved instructions and restaurant clarifications.</p>{p.references.map((r,i)=><article key={i}><p><strong>{r.title}</strong> · {r.section}</p><blockquote>{r.excerpt}</blockquote></article>)}</details>
  </section>;
}

export function SourceReviewFields({provenance:p,reset=false}:{provenance:StandardProvenance;reset?:boolean}){
  return <fieldset><legend>Resolve the recovered source questions</legend><p>Save partial answers while drafting. Complete every answer and update the instructions before approval. These clarifications will be visible with the approved guide.</p>{p.questions.map(q=><label className="shared-field" key={q.id}>{q.prompt}<textarea name={`source-answer-${q.id}`} maxLength={2000} defaultValue={reset?'':p.answers[q.id]}/></label>)}</fieldset>;
}

export function RecoveredStandards({w,send,onOpen}:{w:Workspace;send:Send;onOpen:(r:RecordOf<'standard'>)=>void}){
  const sources=w.recoveredStandards??[];
  if(!sources.length)return null;
  return <details className="shared-recovered-sources"><summary>Recovered FOH material · {sources.length} draft guides</summary><p>From the Bert’s working session with Walter and the FOH team. Choose a guide to review for {w.location.name}. Nothing becomes employee guidance until a version is approved.</p>
    {sources.map(s=>{const draft=w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.data.status==='draft'&&r.data.provenance?.sourceId===s.id);return <details key={s.id}><summary>{s.title}</summary><p>{s.restaurant} · {s.sourceDate} · {s.verification==='manager'?'Closing-manager check':'Senior / lead, then closing-manager check'}</p><p>{s.attribution}</p><StationGuideContent guide={s.guide}/><h3>Proposed completion conditions</h3><ul>{s.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul><h3>Questions for restaurant review</h3><ul>{s.questions.map(q=><li key={q.id}>{q.prompt}</li>)}</ul><details><summary>Recovered source</summary>{s.references.map((r,i)=><article key={i}><p>{r.title} · {r.section}</p><blockquote>{r.excerpt}</blockquote></article>)}</details>
      {draft?<button className="shared-primary" onClick={()=>onOpen(draft)}>Continue existing draft</button>:canDraftStandard(w.me,s.area)&&<button className="shared-primary" onClick={()=>send('standard.import',{sourceId:s.id,sourceRevision:s.revision})}>Create draft for {w.location.name}</button>}
    </details>})}
  </details>;
}
