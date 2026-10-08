'use client';
import type { ChatTurn } from '../shared/companion-chat-types';
import type { Workspace, WorkRecord } from '../shared/types';
import { scheduleWeekDate } from '../shared/workforce-planning';
import { companionRequirements } from '../shared/companion-requirements';

export function CompanionTurns({turns,w,onOpen,onReuse,onSchedule,disabled=false}:{turns:ChatTurn[];w:Workspace;onOpen:(r:WorkRecord)=>void;onReuse?:(turn:ChatTurn)=>void;disabled?:boolean;onSchedule?:(start:string)=>void}){
  return <>{turns.map(turn=><article className="jmax-chat-turn" key={turn.id}>
    <div className="jmax-chat-question"><strong>You</strong><p>{turn.question}</p>{turn.focus&&<small>About: {turn.focus.kind==='standard'?'Approved guide · ':turn.focus.kind==='close'?'Closing assignment · ':''}{turn.focus.title}</small>}</div>
    <div className="jmax-chat-answer"><strong>JMAX</strong>{turn.status==='pending'?<p>Working through your question…</p>:turn.status==='failed'?<><p>{turn.error}</p>{onReuse&&<button disabled={disabled} onClick={()=>onReuse(turn)}>Use this question again</button>}</>:turn.stale?<p>This answer used work or instructions that have changed. Ask again to use the latest information.</p>:<><p>{turn.answer}</p>{turn.sources.length>0&&<div className="jmax-chat-sources" aria-label="Work and instructions used">{turn.sources.map(s=>{if(s.kind==='food-prep')return <a key={s.id} href='#assigned-prep'>{s.title}</a>;const week=s.kind==='schedule-week'?scheduleWeekDate(s.id):null;if(week)return onSchedule?<button key={s.id} onClick={()=>onSchedule(week)}>{s.title}</button>:<span key={s.id}>{s.title}</span>;const record=w.records.find(r=>r.id===s.id&&r.revision===s.revision);return <button key={s.id} disabled={!record} onClick={()=>{if(record)onOpen(record)}}>{s.kind==='close'?'Closing assignment · ':s.kind==='standard'?'Approved instructions · ':''}{s.title}{!record?' · refresh workspace to open':''}</button>})}</div>}</>}</div>
    {turn.status==='complete'&&!turn.stale&&companionRequirements(w,turn.sources).map(requirement=><aside className="jmax-chat-requirements" key={requirement.id} aria-label={`Saved instruction requirements: ${requirement.title}`}><strong>{requirement.title} · saved requirements</strong>{requirement.yourRole&&<p>{requirement.yourRole}</p>}{requirement.notice&&<p>{requirement.notice}</p>}{requirement.checks.length>0&&<ol>{requirement.checks.map(check=><li key={check}>{check}</li>)}</ol>}</aside>)}
  </article>)}</>;
}
