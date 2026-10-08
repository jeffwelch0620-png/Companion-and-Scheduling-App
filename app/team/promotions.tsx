'use client';
import {useState} from 'react';
import {personName,type Workspace,type RecordOf} from '../shared/types';
import {promotionOwner,promotionManager,promotionEditor,promotionReader,promotionPhase,promotionNeedsAck,type Promotion,type PromotionFacts} from '../shared/promotions';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
import './operations.css';

const labels={draft:'Draft · not approved',review:'Awaiting owner approval',active:'Active offer',upcoming:'Upcoming offer',ended:'Offer ended',cancelled:'Cancelled / withdrawn'};
function Field({name,children}:{name:string;children:React.ReactNode}){return <label className="shared-field">{name}{children}</label>}
function Fields({w,d}:{w:Workspace;d?:Promotion}){
 const managers=w.members.filter(m=>promotionManager(m)&&(promotionOwner(w.me)||m.id===w.me.id));
 return <>
 <Field name="Promotion title"><input name="title" defaultValue={d?.title} maxLength={200} required/></Field>
 <div className="ops-fields"><Field name="Start date"><input type="date" name="startsOn" defaultValue={d?.startsOn} required/></Field><Field name="End date · inclusive"><input type="date" name="endsOn" defaultValue={d?.endsOn} required/></Field></div>
 <Field name="Exact offer"><textarea name="offer" defaultValue={d?.offer} maxLength={3000} required placeholder="Exact offer and price, if any. This proposal does not change Toast."/></Field>
 <Field name="Conditions and limits"><textarea name="conditions" defaultValue={d?.conditions} maxLength={3000} required placeholder="Hours, availability, exclusions and redemption rules. State none if there are no additional limits."/></Field>
 <Field name="Staff briefing"><textarea name="staffBrief" defaultValue={d?.staffBrief} maxLength={3000} required placeholder="What staff should say and do; who to ask for help."/></Field>
 <fieldset><legend>Briefing audience</legend>{(['FOH','BOH'] as const).map(a=><label key={a}><input type="checkbox" name="audience" value={a} defaultChecked={d?.audience.includes(a)}/> {a} </label>)}</fieldset>
 <Field name="Responsible manager"><select name="managerId" defaultValue={d?.managerId??(promotionOwner(w.me)?'':w.me.id)} required><option value="">Choose manager</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
 <Field name="Planning source reference"><textarea name="sourceRef" defaultValue={d?.internal?.sourceRef} maxLength={2000} required placeholder="Document or source that supports this proposal. No passwords or customer payment details."/></Field>
 <Field name="Comparison plan"><textarea name="comparisonPlan" defaultValue={d?.internal?.comparisonPlan} maxLength={3000} required placeholder="How to compare results, dates and source reports needed. Include limits; sales alone do not establish profit."/></Field>
 </>;
}
const readFields=(f:FormData)=>({...Object.fromEntries(['title','startsOn','endsOn','offer','conditions','staffBrief','managerId','sourceRef','comparisonPlan'].map(k=>[k,f.get(k)])),audience:f.getAll('audience')});
function Facts({d}:{d:PromotionFacts}){return <><p>{d.startsOn} through {d.endsOn} · {d.audience.join(' / ')} · {d.managerName}</p><h3>Offer</h3><p className="ops-preserve">{d.offer}</p><h3>Conditions and limits</h3><p className="ops-preserve">{d.conditions}</p><h3>Staff briefing</h3><p className="ops-preserve">{d.staffBrief}</p></>}
export function Promotions({initialRecordId,w,send,busy,now,onHistory}:{initialRecordId?:string;w:Workspace;send:Send;busy:boolean;now:string;onHistory:()=>void}){
 const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(initialRecordId??null),[filter,setFilter]=useState('current'),[date,setDate]=useState(''),[query,setQuery]=useState('');
 const records=w.records.filter((r):r is RecordOf<'promotion'>=>r.kind==='promotion'&&promotionReader(r,w.me)),current=records.find(r=>r.id===selected);
 const rows=records.filter(r=>{const p=promotionPhase(r.data,now,w.location.timezone);return (filter==='all'||filter==='current'&&['active','upcoming','cancelled'].includes(p)||filter==='planning'&&['draft','review'].includes(p)||filter===p)&&(!date||r.data.startsOn<=date&&date<=r.data.endsOn)&&r.data.title.toLowerCase().includes(query.trim().toLowerCase())}).sort((a,b)=>a.data.startsOn.localeCompare(b.data.startsOn)||a.id.localeCompare(b.id));
 return <section className="ops-page"><div className="shared-heading"><div><p className="ops-eyebrow">{w.location.name} · Marketing</p><h1>Offers and promotions</h1></div>{promotionManager(w.me)&&<button disabled={busy} onClick={()=>{setCreating(!creating);setSelected(null)}}>{creating?'Cancel new proposal':'Propose an offer'}</button>}</div>
 <p>Read the exact offer, dates and conditions before using it. Dates follow {w.location.timezone}; today is {localDate(now,w.location.timezone)}.</p>
 <p className="ops-callout">An owner approves each offer before it appears in staff briefings. JMAX saves the briefing and read acknowledgments; it does not publish advertising, change Toast prices or send notifications.</p>
 {creating&&<form className="ops-card" onSubmit={async e=>{e.preventDefault();if(await send('promotion.create',readFields(new FormData(e.currentTarget)))){setCreating(false);setFilter('planning')}}}><h2>New offer proposal</h2><fieldset disabled={busy}><Fields w={w}/><p><button className="shared-primary">Save draft proposal</button></p></fieldset></form>}
 {current?<><button disabled={busy} onClick={()=>setSelected(null)}>Back to offer calendar</button><PromotionCard key={current.id+':'+current.revision} r={current} w={w} send={send} busy={busy} now={now}/></>:<>
 <div className="ops-filters">{[['current','Current and upcoming'],['planning','Drafts and owner review'],['ended','Ended'],['all','All']].filter(([v])=>v!=='planning'||promotionManager(w.me)).map(([v,label])=><button disabled={busy} key={v} aria-pressed={filter===v} onClick={()=>setFilter(v)}>{label}</button>)}</div>
 <div className="ops-fields"><Field name="Find offer"><input disabled={busy} value={query} onChange={e=>setQuery(e.target.value)}/></Field><Field name="Offers covering date · optional"><input disabled={busy} type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field></div>
 {!rows.length&&<p className="ops-empty">No matching offers. Older offers may be in Work history.</p>}
 {rows.map(r=><article className="ops-card" key={r.id}><div className="shared-heading"><h2>{r.data.title}</h2><span className="ops-badge">{labels[promotionPhase(r.data,now,w.location.timezone)]}</span></div><p>{r.data.startsOn} through {r.data.endsOn} · {r.data.managerName}</p>{promotionNeedsAck(r,w.me,now,w.location.timezone)&&<p>Read acknowledgment needed{r.data.status==='cancelled'?' for the withdrawal notice':''}.</p>}<button disabled={busy} onClick={()=>{setSelected(r.id);setCreating(false)}}>Open {r.data.title}</button></article>)}
 <button disabled={busy} onClick={onHistory}>Open work history</button>
 </>}
 </section>;
}
export function PromotionCard({r,w,send,busy,now,readOnly=false}:{r:RecordOf<'promotion'>;w:Workspace;send:Send;busy:boolean;now:string;readOnly?:boolean}){
 const d=r.data,editor=promotionEditor(r,w.me),owner=promotionOwner(w.me),phase=promotionPhase(d,now,w.location.timezone),internal=d.internal;
 const submit=(action:string,values:(f:FormData)=>Record<string,unknown>)=>async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();await send('promotion.'+action,values(new FormData(e.currentTarget)),r)};
 const form=(action:string,title:string,button:string,check?:[string,string])=><form className="ops-card" onSubmit={submit(action,f=>({note:f.get('note'),...(check?{[check[0]]:f.get(check[0])==='on'}:{})}))}><h3>{title}</h3><fieldset disabled={busy}><Field name={title+' note'}><textarea name="note" maxLength={3000} required/></Field>{check&&<label><input type="checkbox" name={check[0]} required/> {check[1]}</label>}<p><button className="shared-primary">{button}</button></p></fieldset></form>;
 return <article className="ops-card"><h2>{d.title}</h2><p className="ops-badge">{labels[phase]}</p>
 {phase==='ended'&&<p className="ops-callout">This offer has ended. Do not present it as currently available.</p>}
 {d.withdrawal&&<div className="ops-callout"><h3>{d.approval?'Offer withdrawn — do not use':'Proposal cancelled'}</h3><p className="ops-preserve">{d.withdrawal.note}</p><p>{displayTime(d.withdrawal.at,w.location.timezone)}</p></div>}
 <Facts d={d}/>{d.approval&&<p>Approved in JMAX by {personName(w,d.approval.by)} · {displayTime(d.approval.at,w.location.timezone)}</p>}
 {!readOnly&&promotionNeedsAck(r,w.me,now,w.location.timezone)&&<form onSubmit={submit('acknowledge',f=>({read:f.get('read')==='on'}))}><fieldset disabled={busy}><label><input type="checkbox" name="read" required/> I read the offer, conditions and any withdrawal notice.</label><p><button className="shared-primary">Acknowledge {d.status==='cancelled'?'withdrawal':'briefing'}</button></p></fieldset></form>}
 {d.acknowledgments.filter(a=>a.by===w.me.id).map((a,i)=><p key={i}>You read the {a.status==='approved'?'approved briefing':'withdrawal'} · {displayTime(a.at,w.location.timezone)}</p>)}
 {editor&&internal&&<>
 <details open><summary>Manager planning and review</summary><h3>Source reference</h3><p className="ops-preserve">{internal.sourceRef}</p><h3>Comparison plan</h3><p className="ops-preserve">{internal.comparisonPlan}</p>
 {!w.members.some(m=>m.id===d.managerId&&promotionManager(m))&&<p className="ops-callout">The named person no longer has manager access. An owner can correct an unapproved proposal or withdraw an approved offer.</p>}
 {!readOnly&&<>
 {d.status==='draft'&&form('submit','Submit for owner review','Submit proposal',['checked','I checked the source, dates, exact offer and staff briefing.'])}
 {owner&&d.status==='review'&&<>{form('approve','Owner approval','Approve offer and show staff',['approved','I approve this exact offer, dates, conditions and staff briefing for this restaurant.'])}<details><summary>Return for changes</summary>{form('return','Changes needed','Return proposal')}</details></>}
 {['draft','review'].includes(d.status)&&<details><summary>Change draft details</summary><form onSubmit={submit('correct',f=>({...readFields(f),note:f.get('note')}))}><fieldset disabled={busy}><Fields w={w} d={d}/><Field name="Change reason"><textarea name="note" maxLength={3000} required/></Field><p><button>Save revised draft</button></p></fieldset></form></details>}
 {owner&&d.status!=='cancelled'&&<details><summary>{d.approval?'Withdraw approved offer':'Cancel proposal'}</summary><p>{d.approval?'The withdrawal note is visible to the briefing audience. Previous read acknowledgments stay separate.':'This unapproved proposal stays private.'}</p>{form('cancel','Withdrawal or cancellation','Save cancellation')}</details>}
 {d.approval&&['ended','cancelled'].includes(phase)&&<details><summary>Record a measured outcome</summary><p>Record what the source shows, comparison dates and limitations. This does not calculate profit or prove the offer caused a change.</p><form onSubmit={submit('outcome',f=>({note:f.get('note'),sourceRef:f.get('sourceRef'),checked:f.get('checked')==='on'}))}><fieldset disabled={busy}><Field name="Outcome and comparison limits"><textarea name="note" maxLength={3000} required/></Field><Field name="Outcome source reference"><textarea name="sourceRef" maxLength={2000} required/></Field><label><input name="checked" type="checkbox" required/> I checked the evidence and stated the comparison limits.</label><p><button>Save outcome observation</button></p></fieldset></form></details>}
 </>}
 {internal.outcomes.map((o,i)=><div key={i}><h3>Outcome observation {i+1}</h3><p className="ops-preserve">{o.note}</p><p className="ops-preserve">Source: {o.sourceRef}</p><p>{personName(w,o.by)} · {displayTime(o.at,w.location.timezone)}</p></div>)}
 </details>
 <details><summary>Read acknowledgments ({d.acknowledgments.length})</summary><p>These are deliberate read confirmations, not proof that a notification was delivered or the offer was executed.</p>{d.acknowledgments.map((a,i)=><p key={i}>{personName(w,a.by)} · {a.status==='approved'?'Briefing':'Withdrawal'} · {displayTime(a.at,w.location.timezone)}</p>)}</details>
 <details><summary>Planning history ({internal.history.length})</summary>{internal.history.slice().reverse().map((h,i)=><p className="ops-preserve" key={i}>{personName(w,h.actorId)} · {displayTime(h.at,w.location.timezone)} · {h.action}: {h.note}</p>)}{internal.versions.map((v,i)=><details key={i}><summary>Earlier draft {i+1}</summary><Facts d={v.facts}/><p className="ops-preserve">{v.sourceRef}</p><p className="ops-preserve">{v.comparisonPlan}</p><p>{v.reason}</p></details>)}</details>
 </>}
 </article>;
}
