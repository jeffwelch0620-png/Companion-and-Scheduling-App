'use client';
import {useState} from 'react';
import {personName,type RecordOf,type Workspace} from '../shared/types';
import {ComplianceRenewalPanel} from './compliance-renewal';
import {complianceManager,complianceReader,complianceDue,complianceRenewalState,type ComplianceFacts} from '../shared/compliance';
import {localDate,displayTime} from '../shared/local-time';
import type {Send} from './workspace';
import './operations.css';

const statusLabel={ 'needs-review':'Check source facts',tracking:'Follow-up open',closed:'Follow-up closed'};
function Field({name,children}:{name:string;children:React.ReactNode}){return <label className="shared-field">{name}{children}</label>}
function Facts({w,facts}:{w:Workspace;facts?:ComplianceFacts}){
 const owners=w.members.filter(complianceManager),missing=facts&&!owners.some(m=>m.id===facts.responsibleId);
 return <>
 <div className="ops-fields"><Field name="Record title"><input name="title" maxLength={200} defaultValue={facts?.title} required/></Field><Field name="Record type"><select name="type" defaultValue={facts?.type??'permit'}>{(!facts||facts.type==='permit')&&<option value="permit">Permit</option>}{(!facts||facts.type==='inspection')&&<option value="inspection">Inspection</option>}</select></Field></div>
 <div className="ops-fields"><Field name="Issuing or inspecting authority"><input name="authority" maxLength={200} defaultValue={facts?.authority} required/></Field><Field name="Source document reference"><input name="reference" maxLength={200} defaultValue={facts?.reference} required/></Field></div>
 <div className="ops-fields"><Field name="Source document date"><input type="date" name="documentDate" defaultValue={facts?.documentDate} required/></Field><Field name="Renewal or follow-up due date · optional"><input type="date" name="dueDate" defaultValue={facts?.dueDate??''}/></Field></div>
 <Field name="Source location and date evidence"><textarea name="evidence" maxLength={2000} defaultValue={facts?.evidence} required placeholder="Document name and page; what the date applies to. If no date is recorded, say so."/></Field>
 <Field name="Source link · optional"><input type="url" name="sourceUrl" maxLength={2000} defaultValue={facts?.sourceUrl} placeholder="https://"/></Field>
 <Field name="Recorded findings or permit scope"><textarea name="summary" maxLength={4000} defaultValue={facts?.summary} required/></Field>
 <Field name="Responsible owner or administrator"><select name="responsibleId" defaultValue={missing?'':facts?.responsibleId??''} required><option value="">Choose person</option>{owners.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
 </>;
}
const readFacts=(f:FormData)=>Object.fromEntries(['title','type','authority','reference','documentDate','dueDate','evidence','sourceUrl','summary','responsibleId'].map(k=>[k,f.get(k)]));
function FactView({d}:{d:ComplianceFacts}){return <>
 <p>{d.type==='permit'?'Permit':'Inspection'} · {d.authority} · Reference {d.reference}</p><p>Source date: {d.documentDate} · Recorded due date: {d.dueDate??'Not recorded'}</p>
 <h3>Source evidence</h3><p className="ops-preserve">{d.evidence}</p>{d.sourceUrl&&<a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">Open source document</a>}
 <h3>Recorded findings or scope</h3><p className="ops-preserve">{d.summary}</p><p>Responsible: {d.responsibleName}</p>
 </>}
export function ComplianceRecords({initialRecordId,w,send,busy,now}:{initialRecordId?:string;w:Workspace;send:Send;busy:boolean;now:string}){
 const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(initialRecordId??null),[query,setQuery]=useState(''),[filter,setFilter]=useState('open');
 const today=localDate(now,w.location.timezone),records=w.records.filter((r):r is RecordOf<'compliance'>=>r.kind==='compliance'&&r.locationId===w.location.id&&complianceReader(r,w.me));
 const current=records.find(r=>r.id===selected),rows=records.filter(r=>(filter==='all'||filter==='closed'&&r.data.status==='closed'||filter==='open'&&r.data.status!=='closed'||filter==='overdue'&&complianceDue(r.data,today)==='overdue')&&[r.data.title,r.data.authority,r.data.reference].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>(a.data.dueDate??'9999').localeCompare(b.data.dueDate??'9999')||a.data.title.localeCompare(b.data.title));
 const dueText=(r:RecordOf<'compliance'>)=>{const state=complianceDue(r.data,today);return state==='closed'?'Internal follow-up closed':state==='no-date'?'Due date not recorded':state==='overdue'?'Entered due date has passed':state==='today'?'Entered due date is today':'Due '+r.data.dueDate;};
 if(!complianceManager(w.me)||w.me.locationId!==w.location.id)return <section className="ops-page"><h1>Inspections and permits</h1><p>Restaurant owner or administrator access is required.</p></section>;
 return <section className="ops-page"><div className="shared-heading"><div><p className="ops-eyebrow">{w.location.name} · Safety records</p><h1>Inspections and permits</h1></div><button disabled={busy} onClick={()=>{setCreating(!creating);setSelected(null)}}>{creating?'Cancel new record':'Add source record'}</button></div>
 <p>Completed follow-ups filed by an owner remain available in Work history, including their source checks and renewal evidence.</p><p>Keep source documents, recorded dates and internal follow-up together. Available to this restaurant’s owners and administrators.</p><p className="ops-callout">A checked entry means its facts were compared with the source. It does not certify a valid permit, a passed inspection or legal compliance. No renewal is submitted and no reminder is sent from this screen.</p>
 {creating&&<form className="ops-card" onSubmit={async e=>{e.preventDefault();if(await send('compliance.create',readFacts(new FormData(e.currentTarget))))setCreating(false)}}><h2>New source record</h2><fieldset disabled={busy}><Facts w={w}/><button className="shared-primary">Save source record</button></fieldset></form>}
 {current?<><button disabled={busy} onClick={()=>setSelected(null)}>Back to source records</button><ComplianceCard key={current.id+':'+current.revision} r={current} w={w} send={send} busy={busy} dueText={dueText(current)} onOpen={setSelected}/></>:<>
 <div className="ops-filters">{[['open','Open follow-up'],['overdue','Past entered due date'],['closed','Closed follow-up'],['all','All records']].map(([value,label])=><button key={value} disabled={busy} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
 <Field name="Find a source record"><input value={query} disabled={busy} onChange={e=>setQuery(e.target.value)} placeholder="Title, authority or reference"/></Field>
 {!rows.length&&<p className="ops-empty">No matching source records. Missing records do not establish compliance.</p>}
 {rows.map(r=><article className="ops-card" key={r.id}><div className="shared-heading"><h2>{r.data.title}</h2><span className="ops-badge">{statusLabel[r.data.status]}</span></div><p>{r.data.authority} · {r.data.reference}</p><p>{dueText(r)} · {r.data.responsibleName}</p>{r.data.renewal&&<p>{complianceRenewalState(r,w)==='current'?'Earlier permit linked':'Renewal link needs recheck'}</p>}<button disabled={busy} onClick={()=>{setSelected(r.id);setCreating(false)}}>Open {r.data.title}</button></article>)}
 </>}
 </section>;
}
export function ComplianceCard({r,w,send,busy,dueText,onOpen,readOnly=false}:{readOnly?:boolean;onOpen?:(id:string)=>void;r:RecordOf<'compliance'>;w:Workspace;send:Send;busy:boolean;dueText:string}){
 const d=r.data,zone=w.location.timezone;
 const submit=(action:string,values:(f:FormData)=>Record<string,unknown>)=>async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();await send(action,values(new FormData(e.currentTarget)),r)};
 return <article className="ops-card"><h2>{d.title}</h2><p className="ops-badge">{statusLabel[d.status]}</p><p>{dueText}</p><FactView d={d}/>{!w.members.some(m=>m.id===d.responsibleId&&complianceManager(m))&&<p className="ops-callout">The recorded responsible person no longer has current owner or administrator access. Correct the record to assign a current person.</p>}
 {d.review&&<p>Source checked by {personName(w,d.review.by)} · {displayTime(d.review.at,zone)}: {d.review.note}</p>}{d.resolution&&<p className="ops-callout ops-preserve">Internal follow-up result: {d.resolution}</p>}
 <ComplianceRenewalPanel r={r} w={w} send={send} busy={busy} onOpen={readOnly?undefined:onOpen} readOnly={readOnly}/>
 {!readOnly&&d.status!=='closed'&&<details><summary>Check against the source</summary><form onSubmit={submit('compliance.review',f=>({note:f.get('note'),sourceChecked:f.get('sourceChecked')==='on'}))}><fieldset disabled={busy}><Field name="Source check note"><textarea name="note" maxLength={3000} required/></Field><label><input type="checkbox" name="sourceChecked" required/> I compared the current entry with the source document.</label><p><button>Record source check</button></p></fieldset></form></details>}
 {!readOnly&&<details><summary>Add follow-up update</summary><form onSubmit={e=>{const f=new FormData(e.currentTarget);return submit(String(f.get('action')),f=>({note:f.get('note'),followUpComplete:f.get('followUpComplete')==='on'}))(e)}}><fieldset disabled={busy}><Field name="Follow-up action"><select name="action"><option value="compliance.note">Add update</option>{d.status==='tracking'&&<option value="compliance.close">Close internal follow-up</option>}{d.status==='closed'&&<option value="compliance.reopen">Reopen follow-up</option>}</select></Field><Field name="Follow-up note"><textarea name="note" maxLength={3000} required/></Field>{d.status==='tracking'&&<label><input name="followUpComplete" type="checkbox"/> If closing: the internal follow-up is complete; this does not certify compliance.</label>}<p><button>Save follow-up update</button></p></fieldset></form></details>}
 {!readOnly&&<details><summary>Correct source facts or responsibility</summary><p>Earlier facts stay in history. A correction resets the source check and reopens follow-up.</p><form onSubmit={submit('compliance.correct',f=>({...readFacts(f),note:f.get('note')}))}><fieldset disabled={busy}><Facts w={w} facts={d}/><Field name="Correction reason"><textarea name="note" maxLength={3000} required/></Field><button>Save corrected source facts</button></fieldset></form></details>}
 <details><summary>Source and follow-up history ({d.history.length})</summary>{d.history.slice().reverse().map((h,i)=><p className="ops-preserve" key={i}>{displayTime(h.at,zone)} · {personName(w,h.actorId)} · {h.action}: {h.note}</p>)}{d.versions.map((v,i)=><div key={i}><h3>Source facts before correction {i+1}</h3><FactView d={v.facts}/>{v.review&&<p>Earlier source check: {v.review.note}</p>}{v.resolution&&<p>Earlier follow-up result: {v.resolution}</p>}<p>Correction reason: {v.reason}</p></div>)}</details>
 </article>;
}
