'use client';
import {useState} from 'react';
import {manages, type Workspace} from '../shared/types';
import {reviewGuideOptions} from '../shared/personal-learning';
import type {Send} from './workspace';

export function ReviewSetup({w,send,onError}:{w:Workspace;send:Send;onError:(message:string)=>void}) {
 const people=w.members.filter(m=>m.position!=='Dishwasher'&&!m.scheduleOnly&&manages(w.me,m.area,'people.manage'));
 const [personId,setPersonId]=useState(''),[excluded,setExcluded]=useState<string[]>([]);
 const person=people.find(m=>m.id===personId),guides=person?reviewGuideOptions(w,person):[];
 const managers=person?w.members.filter(m=>m.id!==person.id&&!m.scheduleOnly&&manages(m,person.area,'people.manage')):[];
 const [managerId,setManagerId]=useState('');const manager=managers.find(m=>m.id===managerId)??managers.find(m=>m.id===w.me.id)??managers[0];
 const approvers=person?w.members.filter(m=>m.id!==person.id&&m.id!==manager?.id&&!m.scheduleOnly&&manages(m,person.area,'people.approve')):[];
 return <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await send('development.create',{ownerId:personId,managerId:manager?.id,approverId:String(f.get('approverId')??''),hireDate:String(f.get('hireDate')??''),dueDate:String(f.get('dueDate')??''),guideRefs:guides.filter(g=>!excluded.includes(g.id)).map(g=>({id:g.id,revision:g.revision}))})}catch(error){onError(error instanceof Error?error.message:'Could not open this review.')}}}>
 <label className="shared-field">Employee<select required value={personId} onChange={e=>{setPersonId(e.target.value);setExcluded([]);setManagerId('')}}><option value="">Choose a person</option>{people.map(m=><option key={m.id} value={m.id}>{m.name} · {m.position}</option>)}</select></label>
 {person&&<><h3>Review their job skills</h3><p>Criteria and sources come from their approved guides. There is nothing to retype.</p>{guides.length?<div className="review-guide-choices">{guides.map(g=><label className="review-guide-choice" key={g.id}><input type="checkbox" checked={!excluded.includes(g.id)} onChange={e=>setExcluded(e.target.checked?excluded.filter(id=>id!==g.id):[...excluded,g.id])}/><span><strong>{g.name}</strong><small>{g.definition}</small></span></label>)}</div>:<p>No approved guides are ready for this job. Review the restaurant’s existing drafts in Training → Guides first.</p>}
 <details className="compact-note" open><summary>Reviewer and dates</summary><label className="shared-field">Responsible manager<select value={manager?.id??''} onChange={e=>setManagerId(e.target.value)} required><option value="">Choose manager</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="shared-field">Independent approver<select key={personId+manager?.id} name="approverId" defaultValue={approvers.length===1?approvers[0].id:''} required><option value="">Choose approver</option>{approvers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="shared-field">Hire date<input name="hireDate" type="date" required/></label><label className="shared-field">Review due date<input name="dueDate" type="date" required/></label></details>
 {!approvers.length&&<p>A formal review needs a separate authorized approver. Everyday learning and practice remain available without starting this review.</p>}<button className="shared-primary" disabled={!manager||!approvers.length||!guides.some(g=>!excluded.includes(g.id))}>Open employee self-review</button></>}
 </form>;
}
