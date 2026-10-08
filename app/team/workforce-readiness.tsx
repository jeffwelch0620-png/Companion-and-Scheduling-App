'use client';
import type { Workspace } from '../shared/types';
import { workforceWeek } from '../shared/workforce-planning';
import { canPlan } from '../shared/schedule-review';

export function WorkforceReadiness({w,start,onAsk,selected}:{w:Workspace;start:string;onAsk:()=>void;selected?:string[]}) {
  if(!w.members.some(m=>canPlan(w.me,m.area)))return null;
  const {facts}=workforceWeek(w,start,selected),unassessed=facts.shifts.filter(s=>s.level===null),weak=facts.staffing.flatMap(n=>n.composition.filter(c=>c.scheduled>=n.minimum&&c.atOrAboveIndependentLevel===0).map(c=>({station:n.station,...c})));
  return <section className="workforce-readiness" aria-label="Experience and training review"><div className="shared-heading"><div><h2>Experience & training</h2><p>Review the people behind this week’s headcount.</p></div><button className="shared-primary" onClick={onAsk}>Ask JMAX about this week</button></div>
    <p className="shared-muted">{selected===undefined?'Published shifts plus all visible drafts.':'After this publication: published shifts plus only your selected drafts. The JMAX week discussion includes all saved drafts.'}</p>
    {unassessed.length>0&&<p>{unassessed.length} scheduled assignment{unassessed.length===1?' needs':'s need'} a current proficiency level before experience can be assessed.</p>}
    {weak.map((c,i)=><p className="shared-notice" key={i}>{c.station} · {c.startLocal} to {c.endLocal}: headcount meets the recorded minimum, but no assigned employee has a current level at or above this station’s independent-readiness threshold.</p>)}
    {facts.staffing.some(n=>n.independentLevel===null)&&<p className="shared-muted">Some stations have no independent-readiness definition. Headcount alone cannot establish experience coverage.</p>}
    {!facts.staffing.length&&<p className="shared-muted">Add and approve staffing needs to compare this week with your required coverage.</p>}
    <details><summary>Scheduled station proficiency</summary>{facts.shifts.length?<div className="workforce-skills">{facts.shifts.map(s=><div key={s.id}><strong>{s.person} · {s.station}</strong><span>{s.label??'Level not recorded'}{s.certifiedTrainer?' · Certified trainer':''} · {s.status}</span><small>{s.startLocal} to {s.endLocal}</small>{s.conflicts.length>0&&<small>{s.conflicts.join(' · ')}</small>}</div>)}</div>:<p>No shifts in this week.</p>}</details>
    <h3>Training opportunities</h3>{facts.trainingOpportunities.length?<ul>{facts.trainingOpportunities.map((p,i)=><li key={i}><strong>{p.learner} ({p.learnerLevel}) with {p.trainer} ({p.trainerLevel}, certified trainer)</strong><p>{p.station} · {p.startLocal} to {p.endLocal} · {p.status}</p></li>)}</ul>:<p>No supported pairing found in the recorded shifts. Pairing needs current levels, station clearance and an overlapping certified trainer at a higher level.</p>}
    {facts.omittedRecords>0&&<p>This is a limited selection. Open the schedule and Team for the remaining records.</p>}<p className="shared-muted">These are learning opportunities to review. Confirm capacity and availability before changing the schedule. Labor budgets and hours limits have not been supplied.</p>
  </section>;
}
