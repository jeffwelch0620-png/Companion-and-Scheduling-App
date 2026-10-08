'use client';
import {useState} from 'react';
import type {RecordOf,Workspace} from '../shared/types';
import {personName} from '../shared/types';
import {complianceRenewalChoices,complianceRenewalState,type ComplianceRenewal} from '../shared/compliance';
import {displayTime} from '../shared/local-time';
import type {Send} from './workspace';

function SourcePair({link,w}:{link:ComplianceRenewal;w:Workspace}){
 const pairs=[{label:'Earlier permit',facts:link.previousFacts,review:link.previousReview},{label:'Newer permit',facts:link.currentFacts,review:link.currentReview}];
 return <div>{pairs.map(({label,facts:f,review})=><div key={label}><strong>{label}: {f.title}</strong><p>{f.authority} · {f.reference} · Source date {f.documentDate} · Entered due date {f.dueDate??'Not recorded'}</p><p className="ops-preserve">{f.evidence}</p><p className="ops-preserve">{f.summary}</p><p>Recorded responsible person: {f.responsibleName}</p><p>Source check retained from {displayTime(review.at,w.location.timezone)} · {personName(w,review.by)}: {review.note}</p>{f.sourceUrl&&<a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">Open retained source reference</a>}</div>)}</div>;
}
export function ComplianceRenewalPanel({r,w,send,busy,onOpen,readOnly=false}:{readOnly?:boolean;r:RecordOf<'compliance'>;w:Workspace;send:Send;busy:boolean;onOpen?:(id:string)=>void}){
 const [previousId,setPrevious]=useState(r.data.renewal?.previousId??''),[confirmedVersion,setConfirmedVersion]=useState<string|null>(null);
 if(r.data.type!=='permit')return null;
 const link=r.data.renewal,state=complianceRenewalState(r,w),choices=complianceRenewalChoices(r,w),previous=choices.find(x=>x.id===previousId);
 const selectionVersion=previous?`${r.id}:${r.revision}|${previous.id}:${previous.revision}`:'';
 const confirmed=!!selectionVersion&&confirmedVersion===selectionVersion;
 const successors=w.records.filter((x):x is RecordOf<'compliance'>=>x.kind==='compliance'&&x.locationId===r.locationId&&x.data.renewal?.previousId===r.id);
 return <section><h3>Permit renewal documents</h3><p>Link a newer source document to its earlier permit after checking both. Each record keeps its own due date and internal follow-up. This link does not submit a renewal, close either follow-up or establish permit validity.</p>
  {successors.map(next=><div key={next.id}><p>Newer permit: {next.data.title} · {next.data.reference} · {complianceRenewalState(next,w)==='current'?'Source relationship checked':'Relationship needs recheck'}</p>{!readOnly&&onOpen&&<button disabled={busy} onClick={()=>onOpen(next.id)}>Open newer permit record</button>}</div>)}
  {link&&<div className={state==='needs-review'?'ops-callout':''}><p><strong>{state==='current'?'Source relationship checked':'Renewal link needs recheck'}</strong> · {personName(w,link.by)} · {displayTime(link.at,w.location.timezone)}</p><p className="ops-preserve">{link.note}</p>{state==='needs-review'&&<p>One of the source records or its check changed, or the earlier record is unavailable. Review both current sources before checking this relationship again.</p>}<SourcePair link={link} w={w}/>{!readOnly&&onOpen&&w.records.some(x=>x.id===link.previousId&&x.kind==='compliance'&&x.locationId===r.locationId)&&<button disabled={busy} onClick={()=>onOpen(link.previousId)}>Open earlier permit record</button>}</div>}
  {!readOnly&&(r.data.review?<details><summary>{link?'Recheck renewal relationship':'Link an earlier permit'}</summary><form onSubmit={async e=>{e.preventDefault();if(!previous)return;const f=new FormData(e.currentTarget);await send('compliance.renewal-link',{previousId:previous.id,previousRevision:previous.revision,note:f.get('note'),confirmed},r)}}><fieldset disabled={busy}>
   <label className="shared-field">Earlier permit<select value={previousId} onChange={e=>{setPrevious(e.target.value);setConfirmedVersion(null)}} required><option value="">Choose a checked earlier permit</option>{choices.map(p=><option key={p.id} value={p.id}>{p.data.documentDate} · {p.data.title} · {p.data.reference}</option>)}</select></label>
   {!choices.length&&<p>No eligible earlier permit. Record and check both source documents first. They must belong to this restaurant and issuing authority; the earlier document must not already have a different linked successor. Clear an incorrect link before choosing another earlier permit.</p>}
   {previous&&<p>Earlier source: {previous.data.authority} · {previous.data.reference} · {previous.data.documentDate}. Newer source: {r.data.reference} · {r.data.documentDate}.</p>}
   <label className="shared-field">Evidence for the renewal relationship<textarea name="note" required maxLength={3000} onChange={()=>setConfirmedVersion(null)} placeholder="Where both documents establish this relationship; include page references"/></label>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmedVersion(e.target.checked?selectionVersion:null)} required/> I checked both source documents and their renewal relationship.</label><p><button disabled={!previous||!confirmed}>{link?'Record relationship recheck':'Save renewal document link'}</button></p>
  </fieldset></form></details>:<p>Check this permit against its source before linking an earlier permit.</p>)}
  {!readOnly&&link&&<details><summary>Clear an incorrect renewal link</summary><form onSubmit={async e=>{e.preventDefault();await send('compliance.renewal-clear',{note:new FormData(e.currentTarget).get('note')},r)}}><fieldset disabled={busy}><label className="shared-field">Reason for clearing<textarea name="note" maxLength={3000} required/></label><p>Both records and all earlier link evidence remain in history.</p><button>Clear renewal link</button></fieldset></form></details>}
  {!!r.data.renewalHistory?.length&&<details><summary>Renewal relationship history ({r.data.renewalHistory.length})</summary>{r.data.renewalHistory.slice().reverse().map((entry,i)=><div key={i}><p>{entry.action} · {personName(w,entry.by)} · {displayTime(entry.at,w.location.timezone)}: {entry.note}</p><SourcePair link={entry.link} w={w}/></div>)}</details>}
 </section>;
}
