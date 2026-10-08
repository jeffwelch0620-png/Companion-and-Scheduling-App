'use client';
import {useState} from 'react';
import {shiftStationName,selectableStations} from '../shared/station-assignment';
import {guidesForShift} from '../shared/shift-learning';
import {shiftContextWorkspace} from '../shared/shift-context';
import {chatSource} from '../shared/companion-focus';
import {personName,type RecordOf,type Workspace,type WorkRecord} from '../shared/types';
import {StationGuideContent} from './station-knowledge';
import {CompanionChat} from './companion-chat';
import {FollowDetail} from './followthrough-forms';
import {learningNextStep} from '../shared/learning-queue';
import {LearningHelp} from './learning-help';
import {WorkspaceIcon} from './workspace-icon';
import type {Send} from './workspace';

export function ShiftShortcuts({w,shift,send,onError,onEdit,onOpen,apiRoot='/api'}:{w:Workspace;shift:RecordOf<'shift'>;send:Send;onError:(message:string)=>void;onEdit?:()=>void;apiRoot?:string;onOpen?:(r:WorkRecord)=>void;onGuides?:(station:string)=>void;onAskWeek?:(shift:RecordOf<'shift'>)=>void}) {
 const [asking,setAsking]=useState(false),[opened,setOpened]=useState<WorkRecord|null>(null);
 const open=(record:WorkRecord)=>onOpen?onOpen(record):setOpened(record);
 if(w.me.position==='Dishwasher'||shift.data.cancelled)return null;
 const guides=guidesForShift(w,shift),scoped=shiftContextWorkspace(w,shift),goals=scoped.records.filter((r):r is RecordOf<'goal'>=>r.kind==='goal');
 const related=opened?scoped.records.find(r=>r.id===opened.id):undefined;
 const employee=w.members.find(m=>m.id===shift.ownerId),needsStation=!shift.data.stationId&&employee&&selectableStations(w,employee,shift.data.position).length>0;
 return <section className="shift-shortcuts" aria-label="Help for this employee’s shift">
 <div className="compact-heading"><h3>For this shift</h3><span className="shared-muted">{shiftStationName(shift)}</span></div>
 {related?<div className="shift-context-panel"><button className="detail-back" onClick={()=>setOpened(null)}>‹ Back to {personName(w,shift.ownerId).split(' ')[0]}’s shift</button>{related.kind==='standard'?<><h3>{related.data.title}</h3><StationGuideContent guide={related.data.guide} provenance={related.data.provenance}/><h4>Practice checks</h4><ul>{related.data.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul></>:related.kind==='goal'?<><FollowDetail key={related.id+':'+related.revision} record={related} w={w} send={send} onError={onError}/>{learningNextStep(w,related,new Date().toISOString()).canAsk&&<LearningHelp goal={related} w={w} apiRoot={apiRoot}/>}</>:null}</div>:<>
  {goals.length>0&&<div className="shift-practice-list">{goals.map(g=><button key={g.id} className="shift-work-link" onClick={()=>open(g)}><span className="shift-work-icon"><WorkspaceIcon name="Training"/></span><span><small>{g.data.phase==='verification'?'Ready for review':'Practice in progress'}</small><strong>{g.data.title}</strong></span><span aria-hidden="true">›</span></button>)}</div>}
  {guides.length>0?<div className="shift-instruction-list">{guides.map(g=><button key={g.id} className="shift-work-link" onClick={()=>open(g)}><span className="shift-work-icon"><WorkspaceIcon name="Guide"/></span><span><small>Approved instructions</small><strong>{g.data.title}</strong><small>{g.data.guide?.steps.length??0} {(g.data.guide?.steps.length??0)===1?'step':'steps'} · {g.data.criteria.length} practice {g.data.criteria.length===1?'check':'checks'}</small></span><span aria-hidden="true">›</span></button>)}</div>:<div className="shift-guide-status"><WorkspaceIcon name="Guide" size={20}/><div><strong>{needsStation?'Choose the station for this shift':'Station guide not ready'}</strong><p>{needsStation?'The station brings the matching instructions into this shift.':'Approved instructions will appear here when they are ready.'}</p>{needsStation&&onEdit&&<button type="button" onClick={onEdit}>Set shift station →</button>}</div></div>}
  <div className="shift-jmax-help"><button className="shift-work-link" aria-expanded={asking} onClick={()=>setAsking(!asking)}><span className="shift-work-icon"><WorkspaceIcon name="JMAX"/></span><span><strong>Ask JMAX</strong><small>About {personName(w,shift.ownerId).split(' ')[0]}’s {shiftStationName(shift)} shift</small></span><span aria-hidden="true">{asking?'−':'+'}</span></button>{asking&&<div className="shift-context-panel"><CompanionChat key={shift.id} shiftMode w={w} apiRoot={apiRoot} focus={chatSource(shift)} onOpen={r=>{if(r.id===shift.id){setAsking(false)}else if(scoped.records.some(item=>item.id===r.id))open(r)}}/></div>}</div>
 </>}
 </section>;
}
