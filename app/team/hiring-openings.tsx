'use client';
import {OpeningApplicants} from './opening-applicants';
import {useState} from 'react';
import {personName,type Workspace,type RecordOf} from '../shared/types';
import {openingOwner,openingManager,openingReader,type HiringOpening,type OpeningFacts} from '../shared/hiring-openings';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
import {OpeningOnboarding} from './opening-onboarding';
import './operations.css';

const labels={draft:'Draft · not approved',review:'Awaiting owner review',open:'Approved · open internally',closed:'Closed'};
function Field({name,children}:{name:string;children:React.ReactNode}){return <label className="shared-field">{name}{children}</label>}
function Fields({w,d}:{w:Workspace;d?:HiringOpening}){
 const managers=w.members.filter(m=>openingManager(m)&&(openingOwner(w.me)||m.id===w.me.id));
 return <>
 <Field name="Position title"><input name="title" defaultValue={d?.title} maxLength={200} required/></Field>
 <div className="ops-fields"><Field name="Department"><select name="department" defaultValue={d?.department??(w.me.area==='BOH'?'BOH':'FOH')} required><option value="FOH">FOH</option><option value="BOH">BOH</option></select></Field><Field name="Number of positions"><input type="number" name="positions" defaultValue={d?.positions??1} min={1} max={50} step={1} required/></Field><Field name="Needed by date"><input type="date" name="neededOn" defaultValue={d?.neededOn} required/></Field></div>
 <Field name="Shifts and hours needed"><textarea name="shiftPlan" defaultValue={d?.shiftPlan} maxLength={3000} required placeholder="Days, shift times, expected weekly hours and flexibility needed."/></Field>
 <Field name="Staffing need"><textarea name="reason" defaultValue={d?.reason} maxLength={3000} required placeholder="Explain the coverage gap. Keep applicant and employee personal details out of this request."/></Field>
 <Field name="Planning source reference"><textarea name="sourceRef" defaultValue={d?.sourceRef} maxLength={2000} required placeholder="Checked staffing plan, dated manager note or other source supporting the request."/></Field>
 <Field name="Responsible manager"><select name="managerId" defaultValue={d?.managerId??(openingOwner(w.me)?'':w.me.id)} required><option value="">Choose manager</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
 </>;
}
const readFields=(f:FormData)=>({...Object.fromEntries(['title','department','neededOn','shiftPlan','reason','sourceRef','managerId'].map(k=>[k,f.get(k)])),positions:Number(f.get('positions'))});
function Facts({d}:{d:OpeningFacts}){return <><p>{d.positions} {d.positions===1?'position':'positions'} · {d.department} · Needed by {d.neededOn}</p><p>Responsible manager: {d.managerName}</p><h3>Shifts and hours needed</h3><p className="ops-preserve">{d.shiftPlan}</p><h3>Staffing need</h3><p className="ops-preserve">{d.reason}</p><h3>Planning source reference</h3><p className="ops-preserve">{d.sourceRef}</p></>}
export function HiringOpenings({w,send,busy,now,onHistory,onHandoffs}:{w:Workspace;send:Send;busy:boolean;now:string;onHistory:()=>void;onHandoffs?:()=>void}){
 const [creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState<'open'|'planning'|'closed'|'all'>('all');
 if(!openingManager(w.me))return null;
 const all=w.records.filter((r):r is RecordOf<'opening'>=>r.kind==='opening'&&openingReader(r,w.me)).sort((a,b)=>a.data.neededOn.localeCompare(b.data.neededOn)||a.id.localeCompare(b.id));
 const active=all.filter(r=>r.data.status==='open'),rows=all.filter(r=>filter==='all'||(filter==='planning'?['draft','review'].includes(r.data.status):r.data.status===filter)),record=all.find(r=>r.id===selected);
 return <section className="ops-panel"><div className="shared-heading"><div><h1>Hiring and open positions</h1><p>{w.location.name} · Internal staffing requests</p></div>{!creating&&!record&&<button className="shared-primary" disabled={busy} onClick={()=>setCreating(true)}>New staffing request</button>}</div>
 {openingOwner(w.me)&&onHandoffs&&<p><button disabled={busy} onClick={onHandoffs}>Open first-shift handoffs</button></p>}
 <p className="ops-callout">Visible to the responsible manager and restaurant owners. Owner approval marks the request open inside JMAX. Owners can open a staffing request to review private applicant tracking. Public job posting and hiring decisions are handled separately.</p>
 {creating?<form className="ops-card" onSubmit={async e=>{e.preventDefault();const ok=await send('opening.create',readFields(new FormData(e.currentTarget)));if(ok)setCreating(false)}}><h2>New staffing request</h2><fieldset disabled={busy}><Fields w={w}/><div className="shared-actions"><button className="shared-primary">Save staffing draft</button><button type="button" onClick={()=>setCreating(false)}>Cancel</button></div></fieldset></form>:record?<><button disabled={busy} onClick={()=>setSelected(null)}>Back to staffing requests</button><OpeningCard key={record.id+':'+record.revision} r={record} w={w} send={send} busy={busy} now={now}/></>:<>
 <p>{active.length} approved open {active.length===1?'request':'requests'} · {active.reduce((sum,r)=>sum+r.data.positions,0)} {active.reduce((sum,r)=>sum+r.data.positions,0)===1?'position':'positions'} · {all.filter(r=>r.data.status==='review').length} awaiting owner review</p>
 <div className="shared-actions">{(['all','open','planning','closed'] as const).map(value=><button key={value} aria-pressed={filter===value} disabled={busy} onClick={()=>setFilter(value)}>{value==='all'?'All requests':value==='open'?'Approved openings':value==='planning'?'Drafts and review':'Closed requests'}</button>)}</div>
 {!rows.length&&<p>No staffing requests in this view.</p>}{rows.map(r=><article className="ops-card" key={r.id}><div className="shared-heading"><h2>{r.data.title}</h2><span className="ops-badge">{labels[r.data.status]}</span></div><p>{r.data.positions} {r.data.positions===1?'position':'positions'} · {r.data.department} · Needed by {r.data.neededOn} · {r.data.managerName}</p><button disabled={busy} onClick={()=>setSelected(r.id)}>Open {r.data.title}</button></article>)}<button disabled={busy} onClick={onHistory}>Open work history</button>
 </>}</section>;
}
export function OpeningCard({r,w,send,busy,now,readOnly=false}:{r:RecordOf<'opening'>;w:Workspace;send:Send;busy:boolean;now:string;readOnly?:boolean}){
 if(!openingReader(r,w.me))return null;
 const d=r.data,owner=openingOwner(w.me),current=w.members.some(m=>m.id===d.managerId&&openingManager(m));
 const submit=(action:string,values:(f:FormData)=>Record<string,unknown>)=>async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();await send('opening.'+action,values(new FormData(e.currentTarget)),r)};
 const form=(action:string,title:string,button:string,check?:[string,string])=><form className="ops-card" onSubmit={submit(action,f=>({note:f.get('note'),...(check?{[check[0]]:f.get(check[0])==='on'}:{})}))}><h3>{title}</h3><fieldset disabled={busy}><Field name={title+' note'}><textarea name="note" maxLength={3000} required/></Field>{check&&<label><input type="checkbox" name={check[0]} required/> {check[1]}</label>}<p><button className="shared-primary">{button}</button></p></fieldset></form>;
 return <article className="ops-card"><h2>{d.title}</h2><p className="ops-badge">{labels[d.status]}</p><Facts d={d}/>
 {d.status!=='closed'&&d.neededOn<localDate(now,w.location.timezone)&&<p className="ops-callout">The needed-by date has passed. Review whether this staffing need is still current.</p>}
 {d.approval&&<p>{d.status==='closed'?'Previous approval':'Approved internally'} by {personName(w,d.approval.by)} · {displayTime(d.approval.at,w.location.timezone)} · version {d.approval.revision}</p>}
 {!current&&<p className="ops-callout">The named manager no longer has current access. An owner can revise the request to assign a current manager, or close it.</p>}
 {!readOnly&&<>
 {d.status==='draft'&&current&&form('submit','Submit for owner review','Submit staffing request',['checked','I checked the staffing need, position count, needed-by date and shifts.'])}
 {owner&&d.status==='review'&&<>{current&&form('approve','Owner approval','Approve internal opening',['approved','I approve this exact staffing need, position count, date and shifts for this restaurant.'])}<details><summary>Return for changes</summary>{form('return','Changes needed','Return staffing request')}</details></>}
 {d.status!=='closed'&&<details><summary>Change staffing details</summary><p>Saving changes returns this request to draft for a fresh owner review.</p><form onSubmit={submit('revise',f=>({...readFields(f),note:f.get('note'),resetApproval:f.get('resetApproval')==='on'}))}><fieldset disabled={busy}><Fields w={w} d={d}/><Field name="Change reason"><textarea name="note" maxLength={3000} required/></Field>{d.status==='open'&&<label><input type="checkbox" name="resetApproval" required/> I understand this removes the current approval and takes the request out of approved openings.</label>}<p><button>Save revised staffing draft</button></p></fieldset></form></details>}
 {d.status!=='closed'&&<details><summary>Close staffing request</summary>{form('close','Closure reason','Close request',['confirmed','This staffing request should be closed.'])}</details>}
 {owner&&d.status==='closed'&&form('reopen','Reopen for a new review','Reopen as draft',['confirmed','Return this request to draft. Previous approval will not carry forward.'])}
 </>}
 <OpeningApplicants r={r} w={w} send={send} busy={busy} now={now} readOnly={readOnly}/>
 <OpeningOnboarding r={r} w={w} send={send} busy={busy} readOnly={readOnly}/>
 <details><summary>Request history ({d.history.length})</summary>{d.history.slice().reverse().map((h,i)=><p className="ops-preserve" key={i}>{personName(w,h.actorId)} · {displayTime(h.at,w.location.timezone)} · {h.action}: {h.note}</p>)}{d.versions.map((v,i)=><details key={i}><summary>Earlier details {i+1} · {labels[v.status]}</summary><h3>{v.facts.title}</h3><Facts d={v.facts}/>{v.approval&&<p>Approved by {personName(w,v.approval.by)} · {displayTime(v.approval.at,w.location.timezone)} · version {v.approval.revision}</p>}<p>{v.note} · {personName(w,v.by)} · {displayTime(v.at,w.location.timezone)}</p></details>)}</details>
 </article>;
}
