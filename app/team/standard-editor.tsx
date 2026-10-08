'use client';
import {canDraftStandard, type RecordOf, type Workspace} from '../shared/types';
import type { Send } from './workspace';
import { SourceReviewFields } from './standard-sources';
import { SourceDraftEditor } from './source-draft-editor';

export function StandardEditor({w,record,send,onError}:{w:Workspace;record?:RecordOf<'standard'>;send:Send;onError:(message:string)=>void}) {
  if(record?.data.provenance?.intake||record?.data.provenance?.starter)return <SourceDraftEditor w={w} record={record} send={send} onError={onError}/>;
  const d=record?.data,g=d?.guide,editing=d?.status==='draft';
  const areas=[...new Set([w.me.area,...w.members.map(m=>m.area)])].filter(area=>canDraftStandard(w.me,area)).sort();
  return <form onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),value=(name:string)=>String(f.get(name)??''),lines=(name:string)=>value(name).split('\n').map(s=>s.trim()).filter(Boolean);
    try{await send('standard.save',{area:record?.area??value('area'),...(record&&!editing?{basedOnId:record.id,basedOnRevision:record.revision}:{}),...(d?.provenance?{sourceAnswers:Object.fromEntries(d.provenance.questions.map(q=>[q.id,value(`source-answer-${q.id}`)]))}:{}),title:value('title'),zone:value('zone'),position:value('position'),version:Number(value('version')),criteria:lines('criteria'),source:value('source'),verification:value('verification'),guide:{purpose:value('purpose'),preparation:lines('preparation'),steps:lines('steps'),troubleshooting:lines('troubleshooting'),escalation:value('escalation')}},editing?record:undefined)}catch(error){onError(error instanceof Error?error.message:'The standard could not be saved.')}
  }}>
    {record&&!editing&&<p>This creates a separate draft. The current version and its assignments stay unchanged until a newer version is approved.</p>}
    {!record&&<label className="shared-field">Department<select name="area" required defaultValue={areas.length===1?areas[0]:''}><option value="">Choose department</option>{areas.map(area=><option key={area}>{area}</option>)}</select></label>}
    <label className="shared-field">Standard title<input name="title" required maxLength={200} defaultValue={d?.title}/></label>
    <div className="shared-grid"><label className="shared-field">Closing area<input name="zone" required maxLength={100} readOnly={!!record&&(!editing||!!d?.supersedes)} defaultValue={d?.zone}/></label><label className="shared-field">Station / position<input name="position" required maxLength={100} readOnly={!!record&&(!editing||!!d?.supersedes)} defaultValue={d?.position}/></label><label className="shared-field">Version<input type="number" name="version" defaultValue={d?(editing?d.version:d.version+1):1} min={1} required/></label></div>
    <label className="shared-field">Observable conditions — one per line<textarea name="criteria" required maxLength={15030} defaultValue={d?.criteria.join('\n')}/></label>
    <h3>Instructions for learning the work</h3><p>Optional for an existing checklist. A guide needs a purpose, steps and when to get help. Use approved restaurant material; it will be reviewed together with the completion conditions.</p>
    <label className="shared-field">Why this work matters<textarea name="purpose" maxLength={2000} defaultValue={g?.purpose}/></label>
    <label className="shared-field">Before you start — one item per line<textarea name="preparation" maxLength={15015} defaultValue={g?.preparation.join('\n')}/></label>
    <label className="shared-field">How to do the work — one step per line<textarea name="steps" maxLength={30030} defaultValue={g?.steps.join('\n')}/></label>
    <label className="shared-field">Troubleshooting — one item per line<textarea name="troubleshooting" maxLength={15015} defaultValue={g?.troubleshooting.join('\n')}/></label>
    <label className="shared-field">When to get help<textarea name="escalation" maxLength={2000} defaultValue={g?.escalation}/></label>
    <label className="shared-field">Current restaurant source<textarea name="source" required maxLength={2000} defaultValue={d?.source}/></label>
    {d?.provenance&&<SourceReviewFields provenance={d.provenance} reset={!editing}/>}
    <label className="shared-field">Physical checks required<select name="verification" defaultValue={d?.verification??'manager'}><option value="manager">Closing manager</option><option value="senior-then-manager">Designated senior / lead, then closing manager</option></select></label>
    <button className="shared-primary">{editing?'Save revised draft':'Save draft for validation'}</button>
  </form>;
}
