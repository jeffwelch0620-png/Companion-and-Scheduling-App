import type { LearningRecord } from '../shared/learning-queue';

export function LearningPath({record:r}:{record:LearningRecord}) {
 const ended=r.kind==='goal'?['declined','cancelled'].includes(r.data.phase):r.data.phase==='cancelled';
 if(ended)return null;
 const steps=r.kind==='goal'?[r.data.type==='required-correction'?'Assigned':'Choose','Practice','Review','Confirmed']:['Self review','Manager','Discuss','Approval'];
 const phases=r.kind==='goal'?['proposed','active','verification','closed']:['self-assessment','manager-assessment','discussion','gm-review'];
 const complete=r.kind==='goal'?r.data.phase==='closed':r.data.phase==='approved';
 const current=complete?steps.length:phases.indexOf(r.data.phase);
 return <ol className="learning-path" aria-label={r.kind==='goal'?'Goal stages':'Review stages'}>{steps.map((label,i)=><li key={label} data-state={i<current?'complete':i===current?'current':'upcoming'} aria-current={i===current?'step':undefined}><span aria-hidden="true">{i<current?'✓':i+1}</span><span>{label}</span><span className="schedule-sr-only">{i<current?' completed':i===current?' current stage':' upcoming'}</span></li>)}</ol>;
}
