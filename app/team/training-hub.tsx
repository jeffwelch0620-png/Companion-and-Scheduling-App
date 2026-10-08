'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { has, type RecordOf, type Workspace, type WorkRecord } from '../shared/types';
import { activeStations, stationProficiency } from '../shared/workforce';
import { myWork } from '../shared/my-work';
import { StationKnowledge } from './station-knowledge';
import { LearningQueue } from './learning-queue';
import type { LearningRecord } from '../shared/learning-queue';
import { PersonalLearning } from './personal-learning';
import {personalLearning} from '../shared/personal-learning';
import {TrainingOverview} from './training-overview';

export function TrainingHub({w,now,initialStation,onOpen,onHelp,onAskJmax,onPlanGoal,onCreateGoal,onCreateReview,onContent,onHistory,onStart}:{w:Workspace;now:string;initialStation?:string;onOpen:(r:WorkRecord)=>void;onHelp:(r:WorkRecord)=>void;onAskJmax:(r:WorkRecord)=>void;onPlanGoal:(r:WorkRecord)=>void;onCreateGoal:()=>void;onCreateReview:()=>void;onContent:()=>void;onHistory:()=>void;onStart:(guide:RecordOf<'standard'>)=>void}) {
 const manager=has(w.me,'people.manage')||has(w.me,'people.approve'),work=myWork(w,now);
 const [view,setView]=useState(initialStation!==undefined?'guides':manager?'team':'mine');
 const sectionRef=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{sectionRef.current?.closest('main')?.scrollTo({top:0,left:0,behavior:'instant'})},[view]);
 const path=personalLearning(w,now),pathGoals=new Set(path.items.map(i=>i.goal?.id));
 const learning=w.records.filter((r):r is LearningRecord=>(r.kind==='goal'||r.kind==='development')&&(view==='team'?r.ownerId!==w.me.id:r.ownerId===w.me.id&&!pathGoals.has(r.id)));
 const profiles=activeStations(w).filter(s=>s.area===w.me.area).map(s=>({station:s,...stationProficiency(w,w.me.id,s)})).filter(p=>p.record);
 if(w.me.position==='Dishwasher')return null;
 return <section ref={sectionRef} className="training-hub"><div className="compact-heading training-page-heading"><div><p>{manager?'Team development':'Your learning path'}</p><h1>Training</h1></div>{view==='guides'&&(has(w.me,'tasks.manage')||has(w.me,'standards.approve'))&&<button className="inline-action" onClick={onContent}>Manage guides</button>}</div>
  <div className="compact-tabs" aria-label="Training views">{manager&&<button aria-pressed={view==='team'} onClick={()=>setView('team')}>Team learning</button>}<button aria-pressed={view==='mine'} onClick={()=>setView('mine')}>My learning</button><button aria-pressed={view==='guides'} onClick={()=>setView('guides')}>Guides</button></div>
  <div className="training-panel" key={view}>{view==='guides'?<StationKnowledge onStart={onStart} key={(work.shift?.id??'job')+':'+(work.shift?.data.stationId??work.shift?.data.position??w.me.position)} w={w} initialStation={initialStation??(!manager?(work.shift?.data.stationId??work.shift?.data.position??w.me.position):undefined)} onOpen={onOpen} onHelp={onHelp} onAskJmax={onAskJmax} onPlanGoal={onPlanGoal}/>:<>
   {view==='mine'&&<PersonalLearning w={w} now={now} onOpen={onOpen} onStart={onStart}/>}
   {view==='team'?<TrainingOverview w={w} now={now} records={learning} onOpen={onOpen} onGuides={()=>setView('guides')} onCreateGoal={onCreateGoal} onCreateReview={onCreateReview} onAskJmax={onAskJmax}/>:learning.length>0&&<LearningQueue key={view} w={w} records={learning} onOpen={onOpen} onAskJmax={onAskJmax} onCreate={onCreateGoal}/>}
   {view==='mine'&&profiles.length>0&&<details className="compact-note"><summary>My station development</summary><div className="compact-list">{profiles.map(p=><button className="compact-row" key={p.station.id} onClick={()=>onOpen(p.record!)}><span><strong>{p.station.data.title}</strong><small>{p.current?p.level?.label??'Not assessed':'Assessment needs review'}{p.trainer?' · Certified trainer':''}</small></span><span aria-hidden="true">›</span></button>)}</div></details>}
  </>}</div>
 </section>;
}
