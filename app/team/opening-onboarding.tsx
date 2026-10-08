'use client';
import {useState} from 'react';
import {personName,type Workspace,type RecordOf} from '../shared/types';
import {openingOwner,openingHireProgress} from '../shared/hiring-openings';
import {hireReader,hireEvidence} from '../shared/hire-handoff';
import {displayTime} from '../shared/local-time';
import type {Send} from './workspace';

export function OpeningOnboarding({r,w,send,busy,readOnly=false}:{r:RecordOf<'opening'>;w:Workspace;send:Send;busy:boolean;readOnly?:boolean}){
 const [handoffId,setHandoffId]=useState('');
 if(!openingOwner(w.me)||r.locationId!==w.me.locationId)return null;
 const links=r.data.onboarding?.links??[],active=links.filter(l=>!l.released),hires=w.records.filter((h):h is RecordOf<'hirehandoff'>=>h.kind==='hirehandoff'&&h.locationId===r.locationId&&hireReader(h,w.me));
 const options=hires.filter(h=>h.area===r.data.department&&h.data.status!=='cancelled'&&hireEvidence(w,h).setupCurrent&&!w.records.some(o=>o.kind==='opening'&&o.data.onboarding?.links.some(l=>!l.released&&l.employeeId===h.ownerId&&l.hireDate===h.data.hireDate)));
 const selected=options.find(h=>h.id===handoffId),person=selected?hireEvidence(w,selected).person:undefined;
 const evidence=(h:RecordOf<'hirehandoff'>)=>({handoffId:h.id,handoffRevision:h.revision,employeeRevision:hireEvidence(w,h).person?.revision});
 return <section className="ops-card"><h3>Owner onboarding links</h3><p className="ops-callout">Link an existing hire’s first-shift handoff after checking it against this approved request. Linked records show scheduling progress; they do not prove a position is filled, the employee has started, or sign-in and training are complete. Names and link notes stay private to owners.</p>
 <p>{active.length} unreleased onboarding {active.length===1?'link':'links'} for {r.data.positions} requested {r.data.positions===1?'position':'positions'}.</p>
 {!readOnly&&r.data.status==='open'&&active.length<r.data.positions&&<details><summary>Link a first-shift handoff</summary>{!options.length?<p>No unlinked current handoffs match this department. Review First-shift handoff and employee setup first.</p>:<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(selected&&person)await send('opening.link-handoff',{...evidence(selected),note:f.get('note'),checked:f.get('checked')==='on'},r)}}><fieldset disabled={busy}>
 <label className="shared-field">Existing first-shift handoff<select value={handoffId} required onChange={e=>setHandoffId(e.target.value)}><option value="">Choose handoff</option>{options.map(h=><option key={h.id} value={h.id}>{h.data.employeeName} · {h.data.position} · Hire date {h.data.hireDate}</option>)}</select></label>
 {selected&&<p>{selected.data.employeeName} · {selected.area} · {selected.data.position}<br/>Hire date {selected.data.hireDate} · Target first shift {selected.data.targetDate} · Scheduler {selected.data.schedulerName}</p>}
 <label className="shared-field">Private link review note<textarea name="note" maxLength={3000} required placeholder="Why this existing hire belongs to this approved staffing request. No payroll, credentials or private documents."/></label>
 <label><input name="checked" type="checkbox" required/> I checked this existing hire and handoff against the approved position, department and staffing need.</label><p><button disabled={!selected||!person} className="shared-primary">Save onboarding link</button></p>
 </fieldset></form>}</details>}
 {links.map(l=>{const h=hires.find(h=>h.id===l.handoffId),progress=openingHireProgress(w,r,l),canReview=!readOnly&&!l.released&&r.data.status==='open'&&h&&hireEvidence(w,h).setupCurrent&&h.data.status!=='cancelled'&&h.area===r.data.department;return <article className="ops-card" key={l.id}><h4>{l.employeeName}</h4><p>{l.department} · Hire date {l.hireDate}</p><p className="ops-badge">{readOnly?(l.released?'Historical released link':'Historical retained link — review current evidence after restoration'):progress.label}</p>
 {!readOnly&&h&&!l.released&&<p>Current handoff: {h.data.employeeName} · {h.data.position} · {h.data.schedulerName} · Target {h.data.targetDate}</p>}
 {l.reviews.map((review,i)=><details key={i}><summary>Owner link review {i+1} · opening approval version {review.openingApprovalRevision}</summary><p className="ops-preserve">{review.note}</p><p>{personName(w,review.by)} · {displayTime(review.at,w.location.timezone)} · Handoff version {review.handoffRevision}</p></details>)}
 {l.released&&<p className="ops-preserve">Released by {personName(w,l.released.by)} · {displayTime(l.released.at,w.location.timezone)}: {l.released.note}</p>}
 {canReview&&progress.state==='review'&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('opening.review-handoff',{...evidence(h),linkId:l.id,note:f.get('note'),checked:f.get('checked')==='on'},r)}}><fieldset disabled={busy}><label className="shared-field">Updated private link review<textarea name="note" maxLength={3000} required/></label><label><input type="checkbox" name="checked" required/> I rechecked this hire against the current approved staffing request.</label><p><button>Save reviewed link</button></p></fieldset></form>}
 {!readOnly&&!l.released&&<details><summary>Release this onboarding link</summary><p>This removes only the association. It does not cancel the hire, employee access, handoff or schedule.</p><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('opening.release-handoff',{linkId:l.id,note:f.get('note'),checked:f.get('checked')==='on'},r)}}><fieldset disabled={busy}><label className="shared-field">Private release reason<textarea name="note" maxLength={3000} required/></label><label><input type="checkbox" name="checked" required/> Release this association and retain its history.</label><p><button>Release link</button></p></fieldset></form></details>}
 </article>})}
 {!links.length&&<p>No onboarding records linked.</p>}
 </section>;
}
