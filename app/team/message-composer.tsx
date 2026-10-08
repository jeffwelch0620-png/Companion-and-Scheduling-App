'use client';
import { useState } from 'react';
import { attachMessageContext, canReceiveContext } from '../shared/message-context';
import { visible } from '../shared/domain';
import { workTitle } from '../shared/shift-brief';
import { personName, type MessageContext, type Workspace, type WorkRecord } from '../shared/types';
import { displayTime } from '../shared/local-time';
import { StationGuideContent } from './station-knowledge';
import type { Send } from './workspace';

export function MessageAttachment({context:c,w,changed=false,preview=false}:{context:MessageContext;w:Workspace;changed?:boolean;preview?:boolean}){
  return <section className="message-attachment"><h3>{preview?'Attached guide preview':'Guide attached to this question'}</h3><p><strong>{c.instruction.title}</strong> · Version {c.instruction.version} · {c.instruction.position}</p>
    {!preview&&<p>Saved with the question on {displayTime(c.capturedAt,w.location.timezone)}.</p>}
    {changed&&<p role="status">The guide or assignment has changed since this question was sent. This attachment preserves the earlier context. Review the current work before acting.</p>}
    {c.assignment&&<p>Assignment at the time: {personName(w,c.assignment.ownerId)} · due {displayTime(c.assignment.due,w.location.timezone)} · {c.assignment.phase.replaceAll('-',' ')}{c.assignment.helperId?` · Correction assigned to ${personName(w,c.assignment.helperId)}`:''}</p>}
    <details><summary>{changed?'Read the earlier instruction snapshot':'Read the attached instructions'}</summary><StationGuideContent guide={c.instruction.guide}/><h3>What done looks like</h3><ul>{c.instruction.criteria.map((s,i)=><li key={i}>{s}</li>)}</ul>{!!c.clarifications.length&&<><h3>Restaurant clarifications</h3><dl>{c.clarifications.map((c,i)=><div key={i}><dt><strong>{c.question}</strong></dt><dd className="shared-message">{c.answer}</dd></div>)}</dl></>}<p>Source: {c.instruction.source}</p><p>When assigned as closing work: {c.instruction.verification==='manager'?'Closing manager physical check':'Senior / lead, then closing manager physical confirmation'}</p></details>
  </section>;
}

export function MessageComposer({w,record,send,onError}:{w:Workspace;record?:WorkRecord;send:Send;onError:(message:string)=>void}){
  const supported=record&&(record.kind==='standard'||record.kind==='close')&&w.me.position!=='Dishwasher';
  const [source,setSource]=useState<WorkRecord|undefined>(supported?record:undefined),[include,setInclude]=useState(!!supported),[recipient,setRecipient]=useState('');
  let context:MessageContext|undefined,problem='';
  if(include&&source){try{context=attachMessageContext(w,{recordId:source.id,revision:source.revision},[],new Date().toISOString(),visible)}catch(error){problem=error instanceof Error?error.message:'The attachment needs review.';}}
  const latest=source?w.records.find(r=>r.id===source.id):undefined;
  const candidates=w.members.filter(m=>m.id!==w.me.id&&(!include||!!context&&!!source&&canReceiveContext(w,source,m,visible)));
  return <form onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),value=(name:string)=>String(f.get(name)??'');
    if(include&&!context){onError(problem||'Review the attachment before sending.');return;}
    try{await send('message.send',{recipients:[value('recipient')],title:value('title'),body:value('body'),...(include&&source?{context:{recordId:source.id,revision:source.revision}}:{})})}catch(error){onError(error instanceof Error?error.message:'The question could not be sent.')}
  }}>
    {record&&<p>Ask about <strong>{workTitle(record)}</strong>. Choose who should receive your question. Nothing is sent until you press Send message.</p>}
    {source&&<><label className="shared-check"><input type="checkbox" checked={include} onChange={e=>setInclude(e.target.checked)}/>Include the guide version and {source.kind==='close'?'assigned work':'source'} I am asking about</label>{include&&<><p>The attachment includes the instructions, source and reviewed clarifications. Recipients must already have access to this work.</p>{problem&&<p role="status">{problem}</p>}{latest&&latest.revision!==source.revision&&<button type="button" onClick={()=>setSource(latest)}>Review the latest attachment</button>}{context&&<MessageAttachment context={context} w={w} preview/>}</>}</>}
    <label className="shared-field">To<select name="recipient" required value={candidates.some(m=>m.id===recipient)?recipient:''} onChange={e=>setRecipient(e.target.value)}><option value="">Choose a person</option>{candidates.map(m=><option key={m.id} value={m.id}>{m.name} · {m.position}</option>)}</select></label>
    {include&&!candidates.length&&<p>No available recipient has access to this attachment. You can remove it and send a question without sharing the instructions.</p>}
    <label className="shared-field">Subject<input name="title" required maxLength={200} defaultValue={record?`Help with: ${workTitle(record)}`.slice(0,200):''}/></label>
    <label className="shared-field">Message<textarea name="body" required maxLength={4000} placeholder={record?'What do you need clarified, and what have you checked so far?':undefined}/></label>
    <button className="shared-primary" disabled={include&&!context}>Send message</button>
  </form>;
}
