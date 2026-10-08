'use client';
import { schedulingNoticeText } from '../shared/message-display';
import { attentionReasons, needsCloseAcknowledgment } from '../shared/close-attention';
import { useState } from 'react';
import { buildShiftBrief, type BriefItem, workTitle } from '../shared/shift-brief';
import { displayTime } from '../shared/local-time';
import { personName, has, type WorkRecord, type Workspace } from '../shared/types';
import type { FormKind } from './workspace-forms';
import { StationGuideContent } from './station-knowledge';
import { assignedStandardCurrent } from '../shared/station-knowledge';
import type { ChatSource } from '../shared/companion-chat-types';
import { CompanionChat } from './companion-chat';

type Props = {focus?:ChatSource|null;onFocusChange?:(focus:ChatSource|null)=>void;w:Workspace;now:string;apiRoot?:string;onOpen:(r:WorkRecord)=>void;onNavigate:(tab:string)=>void;onForm:(kind:FormKind)=>void;onHelp:(record?:WorkRecord)=>void};
function dueText(item:BriefItem,w:Workspace) {
  if (!item.due) return '';
  return `${item.overdue ? 'Past due · ' : 'Due '}${item.due.length === 10 ? item.due : displayTime(item.due,w.location.timezone)}`;
}
export function WorkGuidance({record:r,w}:{record:WorkRecord;w:Workspace}) {
  const person=(id?:string)=>personName(w,id,'Assigned reviewer');
  const history='history' in r.data?r.data.history:[];
  const correction='phase' in r.data&&r.data.phase==='correction'?[...(history??[])].reverse().find(h=>['fix','dispute'].includes(h.action)):undefined;
  if(r.kind==='close') {
    const p=r.data,steps=[{text:`${p.correction?`${person(p.correction.personId)} corrects the work for ${person(r.ownerId)}`:`${person(r.ownerId)} prepares the area`}`,done:!['open','correction'].includes(p.phase)},...(p.verifierId?[{text:`${person(p.verifierId)} physically checks it`,done:['manager-confirmation','closed'].includes(p.phase)}]:[]),{text:`${person(p.managerId)} confirms the final check`,done:p.phase==='closed'}];
    return <div className="companion-guide"><p className="shared-kicker">How this close gets finished</p><ol className="companion-steps">{steps.map((s,i)=><li key={i}><span aria-hidden="true">{s.done?'✓':i+1}</span><div>{s.text}<small>{s.done?'Recorded complete':'Still required'}</small></div></li>)}</ol>{p.attention&&needsCloseAcknowledgment(r)&&<p className="companion-correction"><strong>{attentionReasons[p.attention.reason]}:</strong> {person(p.managerId)} needs to acknowledge this issue. The correction and physical checks remain open.</p>}{p.correction&&<p>Close responsibility stays with {person(r.ownerId)}. Correction assignment: {p.correction.note}</p>}{correction&&<p className="companion-correction"><strong>Correction from {person(correction.actorId)}:</strong> {correction.note}</p>}<details><summary>Instructions for {p.standard.zone}</summary>{assignedStandardCurrent(w,r)?<StationGuideContent guide={p.standard.guide} provenance={p.standard.provenance}/>:<p>This assigned version is no longer current. A manager needs to review the current standard before you continue.</p>}<p>Assigned source: {p.standard.source} · Version {p.standard.version}</p></details><details><summary>Definition of done · {p.standard.zone}</summary><ul>{p.standard.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul><p className="shared-muted">Assigned standard, version {p.standard.version}. Source: {p.standard.source}</p></details><p className="shared-muted">Passing this close is followed by manager checkout. Your recorded work time is separate.</p></div>;
  }
  if(r.kind==='task'||r.kind==='handoff'||r.kind==='goal')return <div className="companion-guide"><p className="shared-kicker">{r.kind==='handoff'?'Condition and next step':'Definition of done'}</p><p className="shared-message">{r.kind==='goal'?r.data.definition:r.data.detail}</p>{correction&&<p className="companion-correction"><strong>Latest correction:</strong> {correction.note}</p>}<p className="shared-muted">{r.kind==='goal'&&r.data.standardSource?`Approved standard source: ${r.data.standardSource}`:'From the saved assignment. Ask the responsible manager if the instruction needs clarification.'}</p></div>;
  return null;
}
function ActionRow({item,w,onOpen,expanded=false}:{item:BriefItem;w:Workspace;onOpen:Props['onOpen'];expanded?:boolean}) {
  return <article className={expanded?'companion-next':'companion-item'}>
    <div className="companion-item-heading"><span>{item.person}{item.record.ownerId===w.me.id?' · You':''}</span>{item.due&&<small className={item.overdue?'companion-overdue':''}>{dueText(item,w)}</small>}</div>
    <h3>{item.title}</h3><p>{item.next}</p>
    {expanded?<><p className="shared-muted">{item.reason}</p><button className="shared-primary" onClick={()=>onOpen(item.record)}>Continue: {item.next.toLowerCase()}</button><WorkGuidance record={item.record} w={w}/></>:<button className="companion-text-action" onClick={()=>onOpen(item.record)}>{item.next} <span aria-hidden="true">→</span></button>}
  </article>;
}
export function ShiftCompanion({w,now,apiRoot='/api',onOpen,onNavigate,onForm,onHelp,focus=null,onFocusChange}:Props) {
  const brief=buildShiftBrief(w,now),[view,setView]=useState<'next'|'waiting'|'closing'|'help'>('next');
  const immediate=brief.items.filter(i=>i.lane==='action'&&i.category!=='development'),waiting=brief.items.filter(i=>i.lane==='waiting'),later=brief.items.filter(i=>i.lane==='later'),growth=brief.items.filter(i=>i.category==='development'&&i.lane==='action');
  const closing=brief.items.filter(i=>i.record.kind==='close'||i.record.kind==='task'&&!!i.record.data.shiftId),first=immediate[0];
  const manager=has(w.me,'tasks.manage')||has(w.me,'schedule.manage');
  const shift=brief.shift,zone=w.location.timezone;
  return <section className="companion-home">
    <div className="companion-intro"><p className="shared-kicker">JMAX · {new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',month:'short',day:'numeric'}).format(new Date(now))}</p><h1>{brief.current?'Let’s work through your shift.':brief.lastToday&&!brief.nextShift?'Let’s finish the follow-through.':`Let’s get you ready, ${w.me.name.split(' ')[0]}.`}</h1>
    <p>{shift?<>{brief.current?'You’re scheduled now':'Your next published shift is'}: <strong>{shift.data.position}</strong>, {displayTime(shift.data.start,zone)} to {displayTime(shift.data.end,zone)}.</>:brief.leadership.length?<>You have a leadership assignment today. {manager?'Start with the work that needs your decision.':'Review the responsibilities below.'}</>:brief.lastToday?<>Your scheduled shift has ended. {brief.lastToday.data.releasedAt?'Manager checkout is recorded.':'Manager checkout has not been recorded.'}</>:<>There is no upcoming published shift in your workspace. {brief.drafts.length?'Draft shifts are still being planned.':'Your assignments and messages are below.'}</>}</p>
    {!first&&<p>{waiting.length?`${waiting.length} open ${waiting.length===1?'item is':'items are'} waiting on another step. See who has the next action below.`:'No operating work is currently asking for your next action.'}</p>}
    <div className="companion-meta"><span>From your saved schedule and work</span><button className="companion-text-action" onClick={()=>shift?onOpen(shift):onNavigate('Schedule')}>{shift?'Open this shift':'Open schedule'} →</button></div></div>
    <CompanionChat key={apiRoot+":"+w.location.id+":"+w.me.id} w={w} apiRoot={apiRoot} onOpen={onOpen} focus={focus} onFocusChange={onFocusChange}/>
    <details className="companion-secondary"><summary>See your saved work and handoffs</summary>
    <div className="companion-prompts" role="group" aria-label="Explore your shift">{([['next','What needs me next?'],['waiting','What am I waiting on?'],['closing','Walk me through closing'],['help','I need help']] as const).map(([key,label])=><button aria-pressed={view===key} key={key} onClick={()=>setView(key)}>{label}</button>)}</div>
    {view==='next'&&<div aria-label="Your next actions">
      {immediate.length?<><ActionRow item={immediate[0]} w={w} onOpen={onOpen} expanded/>{immediate.slice(1,4).map(item=><ActionRow key={item.record.id} item={item} w={w} onOpen={onOpen}/>)}{immediate.length>4&&<button onClick={()=>onNavigate('Today')}>See all {immediate.length} next actions</button>}</>:<p className="shared-empty">No next operating action is assigned to you. Check your messages, upcoming work or schedule.</p>}
      {(later.length>0||brief.drafts.length>0)&&<details className="companion-secondary"><summary>Plan ahead{later.length?` · ${later.length} upcoming items`:''}{brief.drafts.length?` · ${brief.drafts.length} draft shifts`:''}</summary>{later.map(i=><ActionRow key={i.record.id} item={i} w={w} onOpen={onOpen}/>)}{brief.drafts.length>0&&<><p>These shifts are not published yet. Review the full week before publishing.</p><button onClick={()=>onNavigate('Schedule week')}>Review the draft week</button></>}</details>}
      {growth.length>0&&<details className="companion-secondary"><summary>Make time for development & follow-up · {growth.length}</summary><p>Set aside time for these conversations and goals.</p>{growth.map(i=><ActionRow key={i.record.id} item={i} w={w} onOpen={onOpen}/>)}</details>}
    </div>}
    {view==='waiting'&&<div><h2>Who has the next step</h2><p>Waiting does not mean finished. Each item keeps its responsible person and due date.</p>{waiting.length?waiting.map(i=><ActionRow key={i.record.id} item={i} w={w} onOpen={onOpen}/>):<p className="shared-empty">Nothing visible to you is waiting on another person.</p>}</div>}
    {view==='closing'&&<div><h2>{manager?'Closing follow-through':'Your closing path'}</h2><p>Assigned work → required physical checks → manager checkout.</p>{closing.length?closing.map(i=><div className="companion-close" key={i.record.id}><ActionRow item={i} w={w} onOpen={onOpen}/><WorkGuidance record={i.record} w={w}/></div>):<p className="shared-empty">No unfinished closing work is visible to you. Open your shift to review assigned responsibilities and manager checkout.</p>}{shift&&<button onClick={()=>onOpen(shift)}>Open shift and checkout responsibilities</button>}</div>}
    {view==='help'&&<div className="companion-help"><h2>What do you need help with?</h2><p>Start with the saved instruction, or send a specific question to someone on your team.</p>{first&&<><WorkGuidance record={first.record} w={w}/><button onClick={()=>onHelp(first.record)}>Ask about {first.title}</button></>}<div className="shared-actions"><button onClick={()=>onNavigate('Station knowledge')}>Learn your station</button><button onClick={()=>onHelp()}>Write to someone on the team</button><button onClick={()=>onForm('feedback')}>Write a private note</button></div><p className="shared-muted">You choose who receives a message. A private note stays private until you choose to share it.</p><p className="shared-muted">Ask JMAX above for guidance, or choose a team member for a message. Sending a team message is a separate action.</p></div>}
    <details className="companion-secondary"><summary>Inbox · {brief.unread.length} unread</summary>{brief.unread.slice(0,3).map(r=><button className="companion-inbox" key={r.id} onClick={()=>onOpen(r)}><strong>{r.data.title}</strong><span>{r.data.replies.at(-1)?.text??schedulingNoticeText(r.data.title,r.data.body,w.location.timezone)}</span></button>)}{!brief.unread.length&&<p>No unread messages addressed to you.</p>}<button onClick={()=>onNavigate('Inbox')}>Open inbox</button></details>
    </details>
  </section>;
}

export function TodayWorkspace({w,now,onOpen,onForm}:Pick<Props,'w'|'now'|'onOpen'|'onForm'>) {
  const [filter,setFilter]=useState<'action'|'waiting'|'later'|'development'>('action'),brief=buildShiftBrief(w,now);
  const filtered=brief.items.filter(i=>filter==='development'?i.category==='development':i.lane===filter&&i.category!=='development');
  return <section><div className="shared-heading"><h1>Your work & follow-through</h1>{has(w.me,'tasks.manage')&&<div className="shared-actions"><button onClick={()=>onForm('task')}>Assign work</button><button onClick={()=>onForm('handoff')}>Overnight handoff</button></div>}</div><p>Start with your next action. Work assigned to someone else stays visible under Waiting.</p><div className="companion-prompts" role="group" aria-label="Filter work">{([['action','Needs your action'],['waiting','Waiting'],['later','Upcoming'],['development','Development & follow-up']] as const).map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>{filtered.length?filtered.map(i=><ActionRow key={i.record.id} item={i} w={w} onOpen={onOpen}/>):<p className="shared-empty">No items in this view.</p>}<details className="companion-secondary"><summary>Recently completed work</summary>{w.records.filter(r=>r.kind==='close'&&r.data.phase==='closed'||r.kind==='task'&&r.data.phase==='closed'||r.kind==='handoff'&&r.data.phase==='resolved').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,12).map(r=><button className="companion-inbox" key={r.id} onClick={()=>onOpen(r)}><strong>{workTitle(r)}</strong><span>{displayTime(r.updatedAt,w.location.timezone)}</span></button>)}</details></section>;
}

