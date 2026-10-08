'use client';
import { useState } from 'react';
import { has, personName, type RecordOf, type Workspace } from '../shared/types';
import { incidentCategories, incidentReader, type IncidentFacts } from '../shared/incidents';
import { operationsManager } from '../shared/operations';
import { displayTime, localDate, localInstant } from '../shared/local-time';
import type { Send } from './workspace';
import './operations.css';

function Field({name,children}:{name:string;children:React.ReactNode}){return <label className="shared-field">{name}{children}</label>}
function TimeFields({prefix,label,at,zone}:{prefix:string;label:string;at:string;zone:string}){
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
 return <><Field name={`${label} date · ${zone}`}><input type="date" name={prefix+'Date'} defaultValue={localDate(at,zone)} required/></Field><Field name={`${label} time`}><input type="time" name={prefix+'Time'} defaultValue={time} required/></Field></>;
}
function formTime(f:FormData,prefix:string,zone:string){return localInstant(String(f.get(prefix+'Date')),String(f.get(prefix+'Time')),zone);}
function FactsFields({facts,now,zone}:{facts?:IncidentFacts;now:string;zone:string}){return <>
 <div className="ops-fields"><Field name="Short summary"><input name="title" defaultValue={facts?.title} maxLength={200} required/></Field><Field name="Category"><select name="category" defaultValue={facts?.category??''} required><option value="">Choose category</option>{incidentCategories.map(c=><option key={c}>{c}</option>)}</select></Field><TimeFields prefix="occurred" label="Incident" at={facts?.occurredAt??now} zone={zone}/></div>
 <Field name="Where it happened"><input name="place" defaultValue={facts?.place} maxLength={200} required/></Field>
 <Field name="What happened — observed facts"><textarea name="description" defaultValue={facts?.description} maxLength={6000} required/></Field>
 <Field name="Immediate action taken"><textarea name="immediateAction" defaultValue={facts?.immediateAction} maxLength={3000} required/></Field>
 </>}
function factsInput(f:FormData,zone:string){return {title:f.get('title'),category:f.get('category'),occurredAt:formTime(f,'occurred',zone),place:f.get('place'),description:f.get('description'),immediateAction:f.get('immediateAction')};}
export function IncidentReports({w,send,busy,now}:{w:Workspace;send:Send;busy:boolean;now:string}){
 const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState('open'),[query,setQuery]=useState(''),[error,setError]=useState('');
 const records=w.records.filter((r):r is RecordOf<'incident'>=>r.kind==='incident'&&incidentReader(r,w.me));
 const current=records.find(r=>r.id===selected),rows=records.filter(r=>(filter==='all'||filter==='resolved'&&r.data.status==='resolved'||filter==='open'&&r.data.status!=='resolved')&&[r.data.title,r.data.place,r.data.category].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>b.data.occurredAt.localeCompare(a.data.occurredAt));
 return <section className="ops-page"><div className="shared-heading"><div><p className="ops-eyebrow">{w.location.name} · Safety</p><h1>Incident reports</h1></div><button disabled={busy} onClick={()=>{setCreating(!creating);setSelected(null);setError('')}}>{creating?'Cancel new report':'Record incident'}</button></div>
 <p>Restricted to the reporting manager and this restaurant’s owners or administrators. Keep details factual and limited to what the follow-up needs.</p>
 <p className="ops-callout">Injury, theft, building damage or a service interruption requires an immediate owner phone call. If the primary owner does not answer, call the other owner. Saving here does not place a call or send an alert.</p>
 {error&&<p role="alert" className="shared-error">{error}</p>}
 {creating&&<form className="ops-card" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setError('');try{if(await send('incident.create',factsInput(f,w.location.timezone)))setCreating(false)}catch(err){setError(err instanceof Error?err.message:String(err))}}}><h2>New restricted report</h2><fieldset disabled={busy}><FactsFields now={now} zone={w.location.timezone}/><button className="shared-primary">Save incident report</button></fieldset></form>}
 {current?<><button disabled={busy} onClick={()=>setSelected(null)}>Back to reports</button><IncidentCard key={current.id+':'+current.revision} r={current} w={w} send={send} busy={busy} now={now}/></>:<>
 <div className="ops-filters">{[['open','Needs follow-up'],['resolved','Resolved'],['all','All reports']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
 <Field name="Find a report"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Summary, category or place"/></Field>
 {!rows.length&&<p className="ops-empty">No matching reports available to you at this restaurant.</p>}
 {rows.map(r=><article className="ops-card" key={r.id}><div className="shared-heading"><h2>{r.data.title}</h2><span className="ops-badge">{r.data.status==='open'?'Needs owner review':r.data.status==='reviewed'?'Reviewed · follow-up open':'Resolved'}</span></div><p>{r.data.category} · {displayTime(r.data.occurredAt,w.location.timezone)} · {r.data.place}</p>{r.data.followUp&&r.data.status!=='resolved'&&<p>Follow-up: {r.data.followUp.ownerName} · {displayTime(r.data.followUp.due,w.location.timezone)}</p>}<button disabled={busy} onClick={()=>{setSelected(r.id);setCreating(false)}}>Open report</button></article>)}
 </>}
 </section>;
}
function IncidentCard({r,w,send,busy,now}:{r:RecordOf<'incident'>;w:Workspace;send:Send;busy:boolean;now:string}){
 const [error,setError]=useState(''),d=r.data,zone=w.location.timezone,isOwner=has(w.me,'location.manage');
 const owners=w.members.filter(m=>m.locationId===w.location.id&&has(m,'location.manage')&&operationsManager(m)&&!m.scheduleOnly);
 const submit=(action:string,values:(f:FormData)=>Record<string,unknown>)=>async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);setError('');try{await send(action,values(f),r)}catch(err){setError(err instanceof Error?err.message:String(err))}};
 const ownerSelect=<Field name="Owner or administrator"><select name="ownerId" required defaultValue=""><option value="">Choose person</option>{owners.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>;
 return <article className="ops-card"><h2>{d.title}</h2><p className="ops-badge">{d.status==='open'?'Needs owner review':d.status==='reviewed'?'Reviewed · follow-up open':'Resolved'}</p><p>{d.category} · {displayTime(d.occurredAt,zone)} · {d.place}</p><p>Reported by {d.reporterName}</p><h3>What happened</h3><p className="ops-preserve">{d.description}</p><h3>Immediate action taken</h3><p className="ops-preserve">{d.immediateAction}</p>
 {d.review&&<p className="ops-preserve">Owner review by {personName(w,d.review.actorId)} · {displayTime(d.review.at,zone)}: {d.review.note}</p>}
 {d.resolution&&<p className="ops-callout ops-preserve">Recorded resolution: {d.resolution}</p>}
 {d.followUp&&<div><h3>{d.status==='resolved'?'Last assigned follow-up':'Assigned follow-up'}</h3><p>{d.followUp.ownerName} · {displayTime(d.followUp.due,zone)}</p><p className="ops-preserve">{d.followUp.nextStep}</p></div>}
 <h3>Reported owner calls</h3><p>These are statements recorded by a person, not independently verified calls.</p>{!d.contacts.length&&<p>No owner call has been recorded.</p>}{d.contacts.map((c,i)=><p key={i} className="ops-preserve">{displayTime(c.contactedAt,zone)} · {c.ownerName} · {c.result==='spoke'?'Spoke by phone':'No answer'} · recorded by {personName(w,c.actorId)}: {c.note}</p>)}
 {error&&<p role="alert" className="shared-error">{error}</p>}
 <details><summary>Record an owner call</summary><form onSubmit={submit('incident.contact',f=>({ownerId:f.get('ownerId'),contactedAt:formTime(f,'call',zone),result:f.get('result'),note:f.get('note')}))}><fieldset disabled={busy}><div className="ops-fields">{ownerSelect}<Field name="Call result"><select name="result" required defaultValue=""><option value="">Choose result</option><option value="spoke">Spoke by phone</option><option value="no-answer">No answer</option></select></Field><TimeFields prefix="call" label="Call" at={now} zone={zone}/></div><Field name="Call note"><textarea name="note" required maxLength={3000}/></Field><button>Save call record</button></fieldset></form></details>
 {isOwner&&d.status!=='resolved'&&<details><summary>Assign owner follow-up</summary><form onSubmit={submit('incident.followup',f=>({ownerId:f.get('ownerId'),due:formTime(f,'due',zone),nextStep:f.get('nextStep'),note:f.get('note')}))}><fieldset disabled={busy}><div className="ops-fields">{ownerSelect}<TimeFields prefix="due" label="Follow-up due" at={d.followUp?.due??now} zone={zone}/></div><Field name="Next step"><textarea name="nextStep" required maxLength={3000} defaultValue={d.followUp?.nextStep}/></Field><Field name="Assignment note"><input name="note" maxLength={3000} required/></Field><button>Save follow-up</button></fieldset></form></details>}
 <details><summary>Add an update{isOwner?' or owner decision':''}</summary><form onSubmit={e=>{const f=new FormData(e.currentTarget);return submit(String(f.get('action')),f=>({note:f.get('note')}))(e)}}><fieldset disabled={busy}><Field name="Action"><select name="action" defaultValue="incident.note"><option value="incident.note">Add factual update</option>{isOwner&&d.status!=='resolved'&&<option value="incident.review">Record owner review</option>}{isOwner&&d.status==='reviewed'&&<option value="incident.resolve">Record resolution</option>}{d.status!=='open'&&<option value="incident.reopen">Reopen for review</option>}</select></Field><Field name="Update or reason"><textarea name="note" maxLength={3000} required/></Field><button>Save update</button></fieldset></form></details>
 <details><summary>Correct facts</summary><p>The earlier version stays in history. A correction requires a new owner review.</p><form onSubmit={submit('incident.correct',f=>({...factsInput(f,zone),note:f.get('note')}))}><fieldset disabled={busy}><FactsFields facts={d} now={now} zone={zone}/><Field name="Reason for correction"><textarea name="note" maxLength={3000} required/></Field><button>Save corrected facts</button></fieldset></form></details>
 <details><summary>Report history ({d.history.length})</summary>{d.history.slice().reverse().map((h,i)=><p className="ops-preserve" key={i}>{displayTime(h.at,zone)} · {personName(w,h.actorId)} · {h.action}: {h.note}</p>)}{d.versions.map((v,i)=><div key={i}><h3>Facts before correction {i+1}</h3><p>{v.facts.title} · {v.facts.category} · {displayTime(v.facts.occurredAt,zone)} · {v.facts.place}</p><p className="ops-preserve">{v.facts.description}</p><p className="ops-preserve">Immediate action: {v.facts.immediateAction}</p>{v.review&&<p className="ops-preserve">Earlier review: {v.review.note}</p>}{v.resolution&&<p className="ops-preserve">Earlier resolution: {v.resolution}</p>}<p className="ops-preserve">Correction reason: {v.reason}</p></div>)}</details>
 </article>;
}
