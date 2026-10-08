'use client';
import {useEffect,useState} from 'react';
import {has,type Workspace} from '../shared/types';
import {hireCoordinator} from '../shared/hire-handoff';
import {createHireReviewLoader,type HireReview} from '../shared/hire-review';
import {displayTime} from '../shared/local-time';

const stationLabels:Record<string,string>={'not-assessed':'No current assessment','earlier-or-invalid-date':'Assessment date needs review for this hire','definition-changed':'Station definition changed — reassessment needed','threshold-unset':'Independent threshold not defined','meets-threshold':'Meets the entered station threshold','below-threshold':'Below the entered station threshold'};
const developmentLabels:Record<string,string>={'self-assessment':'Awaiting employee assessment','manager-assessment':'Awaiting manager assessment',discussion:'Discussion needed','gm-review':'Awaiting named GM decision',approved:'Saved GM approval',cancelled:'Cancelled review'};
export function HireReviewDetails({data,busy,onNavigate}:{data:HireReview;busy:boolean;onNavigate:(tab:string)=>void}){
 const e=data.employee,open=(tab:string,label:string)=><button disabled={busy} onClick={()=>onNavigate(tab)}>{label}</button>,time=(s:string)=>displayTime(s,data.timezone);
 return <article className="ops-card"><h2>{e.name}</h2><p>{e.area} · {e.position} · Hire date {e.hireDate}</p><p>Checked {time(data.checkedAt)}. Refresh after making changes elsewhere.</p>
  {e.status==='archived'&&<p className="ops-callout">This employee is archived. These records are retained evidence, not current onboarding approval.</p>}
  <section className="ops-card"><h3>Account and recorded sign-in</h3><p>{e.active?'Account enabled':e.scheduleOnly?'Scheduling only — sign-in is not enabled':'Account not enabled'}</p>
   {data.signIn.visibility==='owner-only'?<p>Sign-in audit evidence is available in the owner’s review.</p>:<><p>{data.signIn.lastSignedInAt?'Successful setup-code sign-in recorded: '+time(data.signIn.lastSignedInAt):'No successful setup-code sign-in recorded on or after this hire date.'}</p><p>This is a recorded sign-in, not proof of a current session or of every sign-in method.</p>{open('Employee access','Open employee setup')}</>}
  </section>
  <section className="ops-card"><h3>Entered onboarding requirements</h3>{!data.checklists.length&&<p>No checklist found for this hire and department. Missing records do not mean that no requirements apply.</p>}{data.checklists.map(r=><div key={r.id}><p>{r.archived?'Filed checklist · ':''}{!r.current?'Employee setup changed — review needed':r.status==='reviewed'?'Checklist reviewed':r.status==='cancelled'?'Checklist cancelled':'Checklist still open'} · {r.checked}/{r.total} checked{r.overdue?` · ${r.overdue} past entered due date`:''}</p>{r.reviewedAt&&<p>Saved review: {time(r.reviewedAt)}</p>}</div>)}{open('Onboarding checklist','Open onboarding checklists')}{data.checklists.some(r=>r.archived)&&open('Work history','Open filed checklist history')}</section>
  <section className="ops-card"><h3>First-shift handoff</h3>{!data.handoffs.length&&<p>No scheduling handoff found for this hire and department.</p>}{data.handoffs.map(r=><div key={r.id}><p>{r.schedulerName} · Target {r.targetDate} · {r.archived?'Filed handoff':r.status==='cancelled'?'Cancelled':r.status==='scheduled'?r.confirmationCurrent?'Published shift confirmation is current':'Saved shift confirmation needs review':r.status==='accepted'?'Scheduler accepted':'Awaiting scheduler acknowledgment'}</p>{r.confirmedStart&&<p>Saved first shift: {time(r.confirmedStart)}</p>}{r.archived&&<p>Filed confirmations are retained history; current scheduling is not revalidated here.</p>}</div>)}{open('First-shift handoff','Open scheduling handoffs')}{data.handoffs.some(r=>r.archived)&&open('Work history','Open filed handoff history')}</section>
  <section className="ops-card"><h3>Assigned station assessments</h3><p>These are the employee’s current configured stations. Scheduling eligibility alone does not establish training. A station threshold is not an overall onboarding or GM approval.</p>{!data.stations.length&&<p>No eligible configured stations found. Review station setup; this does not establish that training is unnecessary.</p>}{data.stations.map(s=><div key={s.id}><h4>{s.title}</h4><p>{stationLabels[s.state]}</p>{s.levelLabel&&<p>Recorded level: {s.levelLabel}</p>}{s.thresholdLabel&&<p>Entered threshold: {s.thresholdLabel}</p>}{s.assessedAt&&<p>Saved assessment: {time(s.assessedAt)}</p>}</div>)}{open('Team','Open people and stations')}</section>
  <section className="ops-card"><h3>Development reviews and GM decisions</h3>
   <p>Only reviews you already have permission to read are shown, matched to this hire date and department. Private ratings, discussion and decision notes stay in Training. A saved GM decision does not prove current station clearance.</p>
   {!data.development.length&&<p>No development review is available to you for this hire. This does not establish that a review is missing or unnecessary.</p>}
   {data.development.map(r=><div className="ops-card" key={r.id}><h4>{r.archived?'Filed development review':'Development review'}</h4>
    <p>{developmentLabels[r.phase]}{r.phase==='approved'&&!r.approvalRecorded?' — approval evidence needs review':''}</p>
    <p>Original due date: {r.originalDueDate??'Needs review'}{r.overdueDays>0?' · '+r.overdueDays+' days past due':''}</p>
    <p>Manager: {r.manager.name}{!r.manager.available?' · Current follow-up authority unavailable':''}</p>
    <p>Named GM reviewer: {r.approver.name}{!r.approver.available?' · Current follow-up authority unavailable':''}</p>
    {r.lastDecision&&<p>Last saved decision: {r.lastDecision.outcome==='approved'?'Approved':'Returned for discussion'} · {r.lastDecision.by} · {r.lastDecision.at?time(r.lastDecision.at):'Decision date needs review'}</p>}
    <p>Linked guide versions: {r.guideStatus.current} current · {r.guideStatus.changed} changed · {r.guideStatus.unavailable} unavailable. {r.guideStatus.manual} entered source references require a separate source check.</p>
    {(r.guideStatus.changed>0||r.guideStatus.unavailable>0)&&<p className="ops-callout">Review the changed or unavailable guides before relying on this training evidence. The original decision is retained.</p>}
    {r.archived&&<p>This is filed history, not a current readiness decision.</p>}
   </div>)}
   {data.development.some(r=>!r.archived)&&open('Training','Open development reviews')}
   {data.development.some(r=>r.archived)&&open('Work history','Open filed development history')}
  </section>
  <p className="ops-callout">This review brings existing evidence together. It does not enable an account, approve paperwork, confirm a shift or grant training clearance.</p>
 </article>;
}
export function HireReviews({w,busy,onNavigate}:{w:Workspace;busy:boolean;onNavigate:(tab:string)=>void}){
 const [employeeId,setEmployeeId]=useState(''),[refresh,setRefresh]=useState(0),[result,setResult]=useState<{key:string;data:HireReview|null;error:string}>({key:'',data:null,error:''});
 const candidates=(w.hireCandidates??[]).filter(c=>hireCoordinator(w.me,c.area)).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)),employee=candidates.find(c=>c.id===employeeId);
 const key=[w.location.id,w.me.id,w.location.revision,employee?.id,employee?.revision,refresh].join(':');
 useEffect(()=>{if(!employee)return;const loader=createHireReviewLoader(r=>setResult({...r,key}));void loader.load(w.location.id,employee,w.me.id);return ()=>loader.cancel();},[key]);
 const current=result.key===key?result:undefined;
 return <section className="ops-page"><p className="ops-eyebrow">{w.location.name} · People</p><h1>Onboarding review</h1><p>Review one hire’s requirements, account evidence, first shift, station assessments and development decisions together. Each keeps its own status.</p><label className="shared-field">Choose a hire<select disabled={busy} value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose employee</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.name} · {c.area} · {c.hireDate}{c.status==='archived'?' · Archived':''}</option>)}</select></label>{!candidates.length&&<p>No hire dates are recorded in your authorized department.{has(w.me,'location.manage')?' Add the hire in Employee setup.':' An owner can finish Employee setup.'}</p>}
 {employee&&<><button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh hire review</button>{current?.error?<p role="alert">{current.error}</p>:current?.data?<HireReviewDetails data={current.data} busy={busy} onNavigate={onNavigate}/>:<p role="status">Loading hire evidence…</p>}</>}
 </section>;
}
