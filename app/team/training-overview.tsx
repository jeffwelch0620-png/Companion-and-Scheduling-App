'use client';
import {learningNextStep,type LearningRecord} from '../shared/learning-queue';
import {draftGuides} from '../shared/personal-learning';
import {approvedStationGuides} from '../shared/station-knowledge';
import {has,personName,type RecordOf,type Workspace,type WorkRecord} from '../shared/types';
import {LearningQueue} from './learning-queue';
import {WorkspaceIcon} from './workspace-icon';

export function GuidePreview({guide,onOpen}:{guide:RecordOf<'standard'>;onOpen:(r:WorkRecord)=>void}) {
 return <button className="guide-preview" onClick={()=>onOpen(guide)}><span className="guide-preview-icon"><WorkspaceIcon name="Guide"/></span><span className="guide-preview-copy"><span className="guide-preview-meta"><span>{guide.data.position}</span><span data-status={guide.data.status}>{guide.data.status==='draft'?'Needs review':'Approved'}</span></span><strong>{guide.data.title}</strong><small>{guide.data.guide?.steps.length??0} instruction {(guide.data.guide?.steps.length??0)===1?'step':'steps'} · {guide.data.criteria.length} practice {guide.data.criteria.length===1?'check':'checks'}</small></span><span className="guide-preview-arrow" aria-hidden="true">›</span></button>;
}

export function TrainingOverview({w,now,records,onOpen,onGuides,onCreateGoal,onCreateReview,onAskJmax}:{w:Workspace;now:string;records:LearningRecord[];onOpen:(r:WorkRecord)=>void;onGuides:()=>void;onCreateGoal:()=>void;onCreateReview:()=>void;onAskJmax:(r:WorkRecord)=>void}) {
 const pending=draftGuides(w),approved=approvedStationGuides(w);
 const items=records.map(record=>({record,...learningNextStep(w,record,now)}));
 const waiting=items.filter(i=>!i.ended&&i.needsMe).sort((a,b)=>a.due.localeCompare(b.due)),active=items.filter(i=>!i.ended),next=waiting[0];
 const first=pending[0],library=[...pending,...approved],preview=library.filter(g=>g.id!==(!next?first?.id:undefined)).slice(0,4);
 return <div className="training-overview">
  <section className="training-next" aria-label="Your next training action"><div className="training-next-label"><WorkspaceIcon name={next?'Review':'Training'} size={18}/><span>{next?'Waiting on you':first?'Start with one guide':'Team learning'}</span></div>
   <h2>{next?personName(w,next.record.ownerId):first?'Review your station instructions':active.length?'Your team is practicing':'Your team’s next step'}</h2>
   <p>{next?next.record.data.title:first?'Review a guide once. Matching employees get it in their personal learning path.':active.length?'Follow their progress below. Reviews that need you come here first.':approved.length?'Approved guides are available to people with matching jobs. Their practice appears here when they begin.':'Add current station instructions to give your team a learning path.'}</p>
   {next?<button className="training-next-action" onClick={()=>onOpen(next.record)}><span><small>{next.label}</small><strong>{next.action}</strong></span><span aria-hidden="true">→</span></button>:first?<button className="training-next-action" onClick={()=>onOpen(first)}><span><small>{first.data.position} · Needs review</small><strong>{first.data.title}</strong></span><span aria-hidden="true">→</span></button>:<button className="training-next-action" onClick={onGuides}><span><strong>Open station guides</strong></span><span aria-hidden="true">→</span></button>}
  </section>
  <dl className="training-snapshot" aria-label="Team learning status"><div><dt>In progress</dt><dd>{active.length}</dd></div><div><dt>Waiting on you</dt><dd>{waiting.length}</dd></div><div><dt>Guides to review</dt><dd>{pending.length}</dd></div></dl>
  {records.length>0&&<section className="training-people"><div className="training-section-heading"><h2>People & progress</h2></div><LearningQueue w={w} records={records} onOpen={onOpen} onAskJmax={onAskJmax} onCreate={onCreateGoal} team hideCreate/></section>}
  {library.length>0&&<section className="training-library-preview" aria-label="Station guide library"><div className="training-section-heading"><div><h2>Station guides</h2><p>{approved.length} approved · {pending.length} to review</p></div><button className="inline-action" onClick={onGuides}>See all {library.length} <span aria-hidden="true">→</span></button></div><div className="guide-preview-grid">{(preview.length?preview:library).map(g=><GuidePreview key={g.id} guide={g} onOpen={onOpen}/>)}</div></section>}
  {has(w.me,'people.manage')&&<details className="training-individual-tools"><summary>Individual reviews & goals</summary><p>Use these for a specific conversation or an individual development goal.</p><div><button onClick={onCreateReview}><WorkspaceIcon name="Review" size={18}/>Start employee review</button><button onClick={onCreateGoal}><WorkspaceIcon name="Goal" size={18}/>Create custom goal</button></div></details>}
 </div>;
}
