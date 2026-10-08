'use client';
import {useState,type FormEvent} from 'react';
import {recognitionParticipant,recognitionOwner,recognitionEditor,recognitionReviewer,recognitionReader,recognitionView,type RecognitionFacts} from '../shared/recognition';
import {type Workspace,type RecordOf,personName} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
const displayDate=(date:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));

const states={submitted:'Awaiting owner review',returned:'Returned to author',published:'On the restaurant board',withdrawn:'Withdrawn'};
type Props={w:Workspace;send:Send;busy:boolean;now:string};
export function RecognitionBoard({w,send,busy,now,onHistory}:Props&{onHistory:()=>void}){
 const [creating,setCreating]=useState(false),[filter,setFilter]=useState('board'),[page,setPage]=useState(0),[selected,setSelected]=useState('');
 if(!recognitionParticipant(w.me))return null;
 const rows=w.records.filter((r):r is RecordOf<'recognition'>=>r.kind==='recognition'&&recognitionReader(r,w.me));
 const review=rows.filter(r=>r.data.status==='submitted'&&recognitionOwner(w.me));
 const filtered=rows.filter(r=>filter==='board'?r.data.status==='published':filter==='mine'?r.ownerId===w.me.id:filter==='review'?r.data.status==='submitted'&&recognitionOwner(w.me):recognitionEditor(r,w.me)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages-1),r=rows.find(x=>x.id===selected);
 const choose=(value:string)=>{setFilter(value);setPage(0);setSelected('');setCreating(false)};
 return <section className="ops-page"><h1>Recognition</h1><p>A named thank-you for a teammate. Your submission is private to you and restaurant owners until an independent owner publishes it to this restaurant’s board.</p><p className="shared-muted">Recognition records no reward, payment or performance rating. No email, text or push notification is sent.</p>
  <div className="shared-actions"><button disabled={busy} onClick={()=>{setCreating(true);setSelected('')}}>Thank a teammate</button><button onClick={onHistory}>Work history</button></div>
  <label className="shared-field">Show recognition<select value={filter} onChange={e=>choose(e.target.value)}><option value="board">Restaurant board</option><option value="mine">My submissions</option>{recognitionOwner(w.me)&&<><option value="review">Awaiting owner review ({review.length})</option><option value="private">All review records</option></>}</select></label>
  {creating&&<section className="ops-card"><h2>Thank a teammate</h2><RecognitionForm w={w} busy={busy} now={now} onSubmit={async input=>{if(await send('recognition.submit',input)){setCreating(false);choose('mine')}}}/><button disabled={busy} onClick={()=>setCreating(false)}>Cancel</button></section>}
  <p>{filtered.length} {filter==='board'?'published thank-yous':'matching submissions'}</p>
  <div className="shared-list">{filtered.slice(current*20,current*20+20).map(x=><button key={x.id} aria-label={'Open '+x.data.title} onClick={()=>{setSelected(x.id);setCreating(false)}}><span><strong>{x.data.title}</strong><small>For {x.data.recipientName} · from {x.data.authorName} · {displayDate(x.data.occurredOn)}</small></span><em>{states[x.data.status]}</em></button>)}</div>
  {!filtered.length&&<p>No recognition in this view yet.</p>}{pages>1&&<div className="shared-actions"><button disabled={!current} onClick={()=>setPage(current-1)}>Previous page</button><span>Page {current+1} of {pages}</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Next page</button></div>}
  {r&&<RecognitionCard key={r.id+':'+r.revision} w={w} r={r} send={send} busy={busy} now={now}/>}
 </section>;
}
function RecognitionForm({w,busy,now,facts,onSubmit}:{w:Workspace;busy:boolean;now:string;facts?:RecognitionFacts;onSubmit:(input:Record<string,unknown>)=>Promise<void>}){
 const people=w.members.filter(m=>m.id!==w.me.id&&m.locationId===w.location.id&&recognitionParticipant(m));
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);await onSubmit({title:f.get('title'),message:f.get('message'),recipientId:f.get('recipientId'),occurredOn:f.get('occurredOn'),shareConfirmed:f.get('shareConfirmed')==='on',...(facts?{note:f.get('note')}:{})})};
 return <form onSubmit={e=>void submit(e)}><fieldset disabled={busy}><label className="shared-field">Teammate<select name="recipientId" defaultValue={facts?.recipientId??''} required><option value="">Choose a teammate</option>{facts&&!people.some(m=>m.id===facts.recipientId)&&<option value={facts.recipientId} disabled>{facts.recipientName} · no longer available</option>}{people.map(m=><option key={m.id} value={m.id}>{m.name} · {m.area}</option>)}</select></label>
  <label className="shared-field">Recognition date<input name="occurredOn" type="date" required max={localDate(now,w.location.timezone)} defaultValue={facts?.occurredOn??localDate(now,w.location.timezone)}/></label>
  <label className="shared-field">Title<input name="title" required maxLength={200} defaultValue={facts?.title??''}/></label><label className="shared-field">Thank-you<textarea name="message" required maxLength={2000} defaultValue={facts?.message??''}/></label>
  {facts&&<label className="shared-field">Reason for correction<textarea name="note" required maxLength={2000}/></label>}
  <label className="ops-check"><input name="shareConfirmed" type="checkbox" required/>My name and this thank-you may appear on this restaurant’s board after owner review.</label><button className="shared-primary">{facts?'Save and resubmit':'Submit for owner review'}</button>
 </fieldset></form>;
}
export function RecognitionCard({w,r:source,send,busy,now,readOnly=false}:Props&{r:RecordOf<'recognition'>;readOnly?:boolean}){
 if(!recognitionReader(source,w.me))return null;
 const r=recognitionView(source,w.me),d=r.data,editor=recognitionEditor(r,w.me),reviewer=recognitionReviewer(r,w.me);
 const act=async(e:FormEvent<HTMLFormElement>,action:string)=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('recognition.'+action,{note:f.get('note'),confirmed:f.get('confirmed')==='on'},r)};
 return <article className="ops-card"><h2>{d.title}</h2><p><strong>For {d.recipientName}</strong> · from {d.authorName}</p><p>{displayDate(d.occurredOn)} · {states[d.status]}{readOnly?' · Filed history':''}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{d.message}</p>
  {d.publication&&<p>{d.status==='published'?'Published':'Previously published'} {displayTime(d.publication.at,w.location.timezone)}{editor?' · '+personName(w,d.publication.by):''}</p>}
  {!readOnly&&editor&&<>
   {r.ownerId===w.me.id&&['submitted','returned'].includes(d.status)&&<details><summary>Correct and resubmit</summary><RecognitionForm w={w} busy={busy} now={now} facts={d} onSubmit={async input=>{await send('recognition.correct',input,r)}}/></details>}
   {d.status==='submitted'&&recognitionOwner(w.me)&&!reviewer&&<p>An independent owner must review this submission. Authors and recipients cannot review their own recognition.</p>}
   {d.status==='submitted'&&reviewer&&<><h3>Owner review</h3><p>Review this exact title, date, teammate and thank-you. Review notes stay private to the author and restaurant owners.</p><form onSubmit={e=>void act(e,'publish')}><fieldset disabled={busy}><label className="shared-field">Publication review note<textarea name="note" required maxLength={2000}/></label><label className="ops-check"><input name="confirmed" type="checkbox" required/>Publish this exact named thank-you on the restaurant board.</label><button className="shared-primary">Publish thank-you</button></fieldset></form><details><summary>Return for correction</summary><form onSubmit={e=>void act(e,'return')}><fieldset disabled={busy}><label className="shared-field">Return reason<textarea name="note" required maxLength={2000}/></label><button>Return to author</button></fieldset></form></details></>}
   {d.status!=='withdrawn'&&<details><summary>Withdraw thank-you</summary><p>This removes the thank-you from review and the board. Its text and history remain available to the author and restaurant owners. Published text is fixed; submit a new thank-you if a replacement is needed.</p><form onSubmit={e=>void act(e,'withdraw')}><fieldset disabled={busy}><label className="shared-field">Withdrawal reason<textarea name="note" required maxLength={2000}/></label><label className="ops-check"><input name="confirmed" type="checkbox" required/>Remove this thank-you from review and the restaurant board.</label><button>Confirm withdrawal</button></fieldset></form></details>}
  </>}
  {d.internal&&<details><summary>Private review history</summary><p>Submitted {displayTime(d.submittedAt,w.location.timezone)}. Visible to the author and restaurant owners.</p><ol>{d.internal.history.map((h,i)=><li key={i}>{displayTime(h.at,w.location.timezone)} · {personName(w,h.actorId)} · {h.action}<p style={{overflowWrap:'anywhere'}}>{h.note}</p></li>)}</ol>{d.internal.versions.map((v,i)=><details key={i}><summary>Earlier version {i+1}</summary><p>{v.facts.title} · {v.facts.recipientName} · {displayDate(v.facts.occurredOn)}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{v.facts.message}</p><p>{v.reason}</p></details>)}</details>}
 </article>;
}
