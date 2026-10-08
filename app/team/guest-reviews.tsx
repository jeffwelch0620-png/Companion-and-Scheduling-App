'use client';
import {useState} from 'react';
import {personName,type RecordOf,type Workspace} from '../shared/types';
import {guestChannels,guestOwner,guestManager,guestReader,type GuestFacts,type GuestCycle} from '../shared/guest-reviews';
import {localDate,displayTime} from '../shared/local-time';
import type {Send} from './workspace';
import './operations.css';

const statusLabel={'awaiting-ack':'Awaiting manager acknowledgment','in-progress':'Manager working','owner-review':'Owner review needed',closed:'Follow-up closed'};
function Field({name,children}:{name:string;children:React.ReactNode}){return <label className="shared-field">{name}{children}</label>}
function Facts({w,facts}:{w:Workspace;facts?:GuestFacts}){
 const managers=w.members.filter(guestManager),missing=facts&&!managers.some(m=>m.id===facts.managerId);
 return <>
 <Field name="Follow-up title"><input name="title" maxLength={200} defaultValue={facts?.title} required/></Field>
 <div className="ops-fields"><Field name="Feedback source"><select name="channel" defaultValue={facts?.channel??'Google'}>{guestChannels.map(x=><option key={x}>{x}</option>)}</select></Field><Field name="Review ID or source reference"><input name="reference" maxLength={200} defaultValue={facts?.reference} required placeholder="Use the original review ID or a unique source reference"/></Field></div>
 <div className="ops-fields"><Field name="Feedback date"><input name="sourceDate" type="date" defaultValue={facts?.sourceDate} required/></Field><Field name="Source rating · optional"><select name="rating" defaultValue={facts?.rating??''}><option value="">No rating recorded</option>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n} of 5</option>)}</select></Field></div>
 <Field name="Individual review link · required for Google and Facebook"><input name="sourceUrl" type="url" maxLength={2000} defaultValue={facts?.sourceUrl} placeholder="https://"/></Field>
 <Field name="Source evidence"><textarea name="evidence" maxLength={2000} defaultValue={facts?.evidence} required placeholder="Where you read the feedback and how you confirmed the restaurant and date."/></Field>
 <Field name="Guest feedback"><textarea name="feedback" maxLength={4000} defaultValue={facts?.feedback} required placeholder="Quote or summarize accurately. Leave out unnecessary contact or payment details."/></Field>
 <div className="ops-fields"><Field name="Responsible manager"><select name="managerId" defaultValue={missing?'':facts?.managerId??''} required><option value="">Choose manager</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><Field name={`Follow-up due date · ${w.location.timezone}`}><input name="dueDate" type="date" defaultValue={facts?.dueDate} required/></Field></div>
 <Field name="Owner handoff note"><textarea name="ownerNote" maxLength={3000} defaultValue={facts?.ownerNote} required placeholder="What needs checking, the next step and any limits."/></Field>
 <label><input type="checkbox" name="sourceChecked" required/> I checked the source, restaurant and feedback before assigning this follow-up.</label>
 </>;
}
const readFacts=(f:FormData)=>({...Object.fromEntries(['title','channel','reference','sourceDate','sourceUrl','evidence','feedback','rating','managerId','dueDate','ownerNote'].map(k=>[k,f.get(k)])),sourceChecked:f.get('sourceChecked')==='on'});
function FactView({d}:{d:GuestFacts}){return <>
 <p>{d.channel} · {d.sourceDate} · Reference {d.reference}{d.rating!==null&&` · ${d.rating} of 5`}</p>
 <h3>Guest feedback</h3><p className="ops-preserve">{d.feedback}</p>
 <h3>Owner handoff</h3><p className="ops-preserve">{d.ownerNote}</p><p>Assigned to {d.managerName} · Due {d.dueDate}</p>
 <details><summary>Source evidence</summary><p className="ops-preserve">{d.evidence}</p>{d.sourceUrl&&<a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">Open original feedback</a>}</details>
 </>}
function CycleView({d,w}:{d:GuestCycle;w:Workspace}){return <>{([['Manager acknowledgment',d.acknowledgment],['Manager outcome',d.outcome],['Owner closure',d.closure]] as const).map(([label,response])=>response&&<div key={label}><h3>{label}</h3><p className="ops-preserve">{response.note}</p><p>{personName(w,response.by)} · {displayTime(response.at,w.location.timezone)}</p></div>)}</>}
export function GuestReviews({initialRecordId,w,send,busy,now,onHistory}:{initialRecordId?:string;w:Workspace;send:Send;busy:boolean;now:string;onHistory:()=>void}){
 const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(initialRecordId??null),[filter,setFilter]=useState('open'),[query,setQuery]=useState('');
 const owner=guestOwner(w.me),today=localDate(now,w.location.timezone),records=w.records.filter((r):r is RecordOf<'guestreview'>=>r.kind==='guestreview'&&guestReader(r,w.me)),current=records.find(r=>r.id===selected);
 const rows=records.filter(r=>(filter==='all'||filter==='open'&&r.data.status!=='closed'||filter===r.data.status)&&[r.data.title,r.data.reference,r.data.channel,r.data.managerName].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>Number(a.data.status==='closed')-Number(b.data.status==='closed')||a.data.dueDate.localeCompare(b.data.dueDate)||a.id.localeCompare(b.id));
 return <section className="ops-page"><div className="shared-heading"><div><p className="ops-eyebrow">{w.location.name} · Guests</p><h1>Guest reviews and follow-up</h1></div>{owner&&<button disabled={busy} onClick={()=>{setCreating(!creating);setSelected(null)}}>{creating?'Cancel new follow-up':'Add guest feedback'}</button>}</div>
 <p>Keep the original feedback, named manager’s acknowledgment, outcome and owner review together. {owner?'You can see this restaurant’s follow-ups.':'You can see the follow-ups assigned to you.'}</p>
 <p className="ops-callout">Feedback is entered from a checked source. Assignment is saved in JMAX; it does not send an email or text. Public review feeds and replies are not connected.</p>
 {creating&&<form className="ops-card" onSubmit={async e=>{e.preventDefault();if(await send('guestreview.create',readFacts(new FormData(e.currentTarget))))setCreating(false)}}><h2>Assign guest follow-up</h2><fieldset disabled={busy}><Facts w={w}/><p><button className="shared-primary">Save and assign follow-up</button></p></fieldset></form>}
 {current?<><button disabled={busy} onClick={()=>setSelected(null)}>Back to guest follow-up</button><GuestReviewCard key={current.id+':'+current.revision} r={current} w={w} send={send} busy={busy}/></>:<>
 <div className="ops-filters">{[['open','Open'],['awaiting-ack','Awaiting acknowledgment'],['in-progress','Manager working'],['owner-review','Owner review'],['closed','Closed'],['all','All']].map(([value,label])=><button key={value} disabled={busy} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}{!['open','all'].includes(value)&&` (${records.filter(r=>r.data.status===value).length})`}</button>)}</div>
 <Field name="Find guest follow-up"><input disabled={busy} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Title, reference, source or manager"/></Field>
 {!rows.length&&<p className="ops-empty">No matching guest follow-up. Older closed entries may be in Work history.</p>}
 {rows.map(r=><article className="ops-card" key={r.id}><div className="shared-heading"><h2>{r.data.title}</h2><span className="ops-badge">{statusLabel[r.data.status]}</span></div><p>{r.data.channel} · {r.data.sourceDate} · {r.data.managerName}</p><p>{r.data.status!=='closed'&&r.data.dueDate<today?'Past entered due date: ':'Due '}{r.data.dueDate}</p><button disabled={busy} onClick={()=>{setSelected(r.id);setCreating(false)}}>Open {r.data.title}</button></article>)}
 <button disabled={busy} onClick={onHistory}>Open work history</button>
 </>}
 </section>;
}
export function GuestReviewCard({r,w,send,busy,readOnly=false}:{r:RecordOf<'guestreview'>;w:Workspace;send:Send;busy:boolean;readOnly?:boolean}){
 const d=r.data,owner=guestOwner(w.me),assigned=guestManager(w.me)&&d.managerId===w.me.id,currentManager=w.members.some(m=>m.id===d.managerId&&guestManager(m));
 const submit=(action:string,values:(f:FormData)=>Record<string,unknown>)=>async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();await send(action,values(new FormData(e.currentTarget)),r)};
 const actionForm=(action:string,title:string,button:string,check?:[string,string])=><form className="ops-card" onSubmit={submit('guestreview.'+action,f=>({note:f.get('note'),...(check?{[check[0]]:f.get(check[0])==='on'}:{})}))}><h3>{title}</h3><fieldset disabled={busy}><Field name={title+' note'}><textarea name="note" maxLength={3000} required/></Field>{check&&<label><input type="checkbox" name={check[0]} required/> {check[1]}</label>}<p><button className="shared-primary">{button}</button></p></fieldset></form>;
 return <article className="ops-card"><h2>{d.title}</h2><p className="ops-badge">{statusLabel[d.status]}</p><FactView d={d}/><CycleView d={d} w={w}/>
 {!currentManager&&d.status!=='closed'&&<p className="ops-callout">The assigned person no longer has current manager access. An owner needs to correct the assignment.</p>}
 {!readOnly&&<>
 {assigned&&d.status==='awaiting-ack'&&actionForm('acknowledge','Accept responsibility','Acknowledge handoff',['accepted','I read the source and owner note and accept this follow-up.'])}
 {assigned&&d.status==='in-progress'&&actionForm('outcome','Report the outcome','Send outcome for owner review',['outcomeConfirmed','This describes work actually done and any remaining limits.'])}
 {owner&&d.status==='owner-review'&&<>{actionForm('close','Review manager outcome','Close internal follow-up',['reviewed','I reviewed the manager outcome. This closes internal follow-up only.'])}<details><summary>Return to manager</summary>{actionForm('return','More follow-up needed','Return for a new acknowledgment')}</details></>}
 {owner&&d.status==='closed'&&<details><summary>Reopen follow-up</summary>{actionForm('reopen','Reason to reopen','Reopen for a new acknowledgment')}</details>}
 {d.status!=='closed'&&<details><summary>Add progress note</summary>{actionForm('note','Progress update','Save progress note')}</details>}
 {owner&&<details><summary>Correct source or assignment</summary><p>Earlier facts and outcomes stay in history. The corrected assignment needs a new acknowledgment.</p><form onSubmit={submit('guestreview.correct',f=>({...readFacts(f),note:f.get('note')}))}><fieldset disabled={busy}><Facts w={w} facts={d}/><Field name="Correction reason"><textarea name="note" maxLength={3000} required/></Field><button>Save corrected handoff</button></fieldset></form></details>}
 </>}
 <details><summary>Follow-up history ({d.history.length})</summary>{d.history.slice().reverse().map((h,i)=><p className="ops-preserve" key={i}>{displayTime(h.at,w.location.timezone)} · {personName(w,h.actorId)} · {h.action}: {h.note}</p>)}{d.versions.map((v,i)=><details key={i}><summary>Earlier handoff {i+1} · {statusLabel[v.cycle.status]}</summary><FactView d={v.facts}/><CycleView d={v.cycle} w={w}/><p>{personName(w,v.by)} · {displayTime(v.at,w.location.timezone)} · Change reason: {v.reason}</p></details>)}</details>
 </article>;
}
