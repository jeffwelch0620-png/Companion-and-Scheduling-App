'use client';
import { useState } from 'react';
import { personName, type Workspace, type WorkRecord } from '../shared/types';
import { learningNextStep, type LearningRecord } from '../shared/learning-queue';
export function LearningQueue({w,records,onOpen,onCreate,team=false,hideCreate=false}:{w:Workspace;records:LearningRecord[];onOpen:(r:WorkRecord)=>void;onAskJmax:(r:WorkRecord)=>void;onCreate:()=>void;team?:boolean;hideCreate?:boolean}) {
 const [filter,setFilter]=useState('active'),[query,setQuery]=useState('');
 const at=new Date().toISOString(),items=records.map(record=>({record,...learningNextStep(w,record,at)}));
 const counts={active:items.filter(x=>!x.ended).length,mine:items.filter(x=>x.needsMe&&!x.ended).length,overdue:items.filter(x=>x.overdue).length,history:items.filter(x=>x.ended).length};
 const search=query.trim().toLowerCase();
 const selected=items.filter(x=>(filter==='history'?x.ended:!x.ended&&(filter==='mine'?x.needsMe:filter==='overdue'?x.overdue:true))&&(!search||[x.record.data.title,personName(w,x.record.ownerId),x.label].join(' ').toLowerCase().includes(search))).sort((a,b)=>Number(b.needsMe)-Number(a.needsMe)||Number(b.overdue)-Number(a.overdue)||a.due.localeCompare(b.due));
 const date=(due:string)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:w.location.timezone}).format(new Date(due.length===10?due+'T12:00:00Z':due));
 return <section className="learning-queue compact-learning">
  <div className="learning-filter-line"><label><span className="schedule-sr-only">Learning status</span><select value={filter} onChange={e=>setFilter(e.target.value)}>{([['active','In progress'],['mine','Needs me'],['overdue','Overdue'],['history','History']] as const).map(([id,label])=><option key={id} value={id}>{label} · {counts[id]}</option>)}</select></label>{!hideCreate&&<button className="inline-action" onClick={onCreate}>Custom goal</button>}</div>
  {items.length>0&&<label className="compact-search"><span className="schedule-sr-only">Find a goal or review</span><input type="search" placeholder={team?'Search people, goals or reviews':'Search your learning'} value={query} onChange={e=>setQuery(e.target.value)}/></label>}
  {!selected.length&&<div className="compact-empty"><h2>{search?'No matches':filter==='mine'?'You’re caught up':filter==='overdue'?'Nothing overdue':filter==='history'?'No completed learning yet':team?'No active learning goals':'No learning goals yet'}</h2><p>{search?'Try a different name or goal.':filter==='mine'?'Nothing is waiting on you.':filter==='overdue'?'No current goals or reviews are past due.':filter==='history'?'Completed goals and reviews will appear here.':team?'Approved job guides create each person’s learning path automatically. Practice that needs your review appears here.':'Your agreed goals and practice will appear here.'}</p></div>}
  <div className="compact-list">{selected.map(item=><button className="compact-row learning-row" key={item.record.id} onClick={()=>onOpen(item.record)}><span><strong>{team?personName(w,item.record.ownerId):item.record.data.title}</strong>{team&&<small>{item.record.data.title}</small>}<small>{item.label}{item.record.kind==='goal'&&item.record.data.automaticLearning&&item.guide?' · '+(item.record.data.practiceChecks?.length??0)+'/'+item.guide.data.criteria.length+' practiced':''}</small></span><span className="compact-row-meta" data-overdue={item.overdue}>{item.ended?'Ended':(item.overdue?'Overdue · ':'')+date(item.due)}<span aria-hidden="true">›</span></span></button>)}</div>
 </section>;
}
