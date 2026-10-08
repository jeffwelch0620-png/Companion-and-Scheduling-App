'use client';
import {type Workspace,has,personName} from '../shared/types';
import {displayTime} from '../shared/local-time';
import {operationsHome,availableModules} from '../shared/operations-home';
import {FollowupSummary} from './followup-desk';
import {useEffect,useState} from 'react';
import {buildShiftBrief} from '../shared/shift-brief';
import {canManageClosing} from '../shared/closing-access';

type Navigation={onFollowup:(id:string)=>void;onNavigate:(tab:string)=>void;onIssue:(id:string)=>void};
export function OperationsHome({w,now,onNavigate,onIssue,onFollowup}:{w:Workspace;now:string}&Navigation){
 const home=operationsHome(w,now);
 const closing=buildShiftBrief(w,now).items.filter(i=>{
  const r=i.record;
  if(r.kind==='shift')return i.lane==='action'&&Date.parse(r.data.start)<=Date.parse(now);
  if(i.lane==='later'||r.kind!=='close'&&!(r.kind==='task'&&r.data.shiftId))return false;
  if(!(r.ownerId===w.me.id||canManageClosing(w.me,r.area,'tasks.manage')||r.kind==='close'&&(r.data.managerId===w.me.id||r.data.verifierId===w.me.id)))return false;
  const shiftId=r.data.shiftId;
  return w.records.some(s=>s.kind==='shift'&&s.id===shiftId&&s.locationId===w.location.id&&s.data.published&&!s.data.cancelled&&!s.data.releasedAt&&Date.parse(s.data.start)<=Date.parse(now))||!!i.due&&Date.parse(i.due)<=Date.parse(now);
 });
 const closingChecks=closing.filter(i=>i.record.kind!=='shift').length,checkouts=closing.filter(i=>i.record.kind==='shift').length;
 return <section className="jmax-home">
  <div className="jmax-home-heading"><div><p className="jmax-eyebrow">Home / Daily brief</p><h1>The day, in focus</h1><p>{new Intl.DateTimeFormat('en-US',{timeZone:w.location.timezone,weekday:'long',month:'long',day:'numeric'}).format(new Date(now))} · {w.location.name}</p></div><button onClick={()=>onNavigate('All areas')}>Explore work centers →</button></div>
  {home.urgent.length>0&&<div className="ops-callout"><strong>{home.urgent.length} urgent {home.urgent.length===1?'issue needs':'issues need'} attention.</strong> Call the primary owner, then the other owner if unanswered. Recording an issue does not send an alert.</div>}
  <div className="jmax-metrics" aria-label="Recorded work needing attention">
   <button onClick={()=>onNavigate('Manager Log')}><strong>{home.issues.length}</strong><span>Open issues</span><small>{home.overdue.length} overdue · {home.unaccepted.length} awaiting acceptance</small></button>
   <button onClick={()=>onNavigate('Repairs')}><strong>{home.repairs.length}</strong><span>Open repairs</span><small>Shared with the Red Book</small></button>
   <button onClick={()=>onNavigate('Manager Log')}><strong>{home.drafts.length}</strong><span>Draft summaries today</span><small>Not yet submitted</small></button>
  </div>
  <FollowupSummary w={w} now={now} onOpen={onFollowup} onAll={()=>onNavigate('Follow-up desk')}/>
  <div className="jmax-day-grid"><div>
   <article className="jmax-panel"><div className="jmax-panel-heading"><h2>Pick up where we left off</h2><button onClick={()=>onNavigate('Manager Log')}>Open Red Book</button></div>
    {!home.handoffs.length&&<p>No previous closing handoff is recorded.</p>}
    {home.handoffs.map(({area,record})=><div className="jmax-handoff" key={area}><strong>{area} · {record?.data.businessDate??'No handoff recorded'}</strong>{record?<><p>{record.data.tomorrowNote||'No next-shift note was entered.'}</p><small>Readiness at that close: {record.data.readiness.replaceAll('-',' ')}. This does not confirm today’s readiness.</small></>:<p>The next submitted closing or production summary will appear here.</p>}</div>)}
   </article>
   <article className="jmax-panel"><div className="jmax-panel-heading"><h2>Needs follow-through</h2><button onClick={()=>onNavigate('Manager Log')}>View all</button></div>
    {!home.issues.length?<p>No open issues are recorded in your accessible departments.</p>:<ul className="jmax-work-list">{home.issues.slice(0,6).map(r=><li key={r.id}><button onClick={()=>onIssue(r.id)}><strong>{r.data.title}</strong><span>{r.area} · {personName(w,r.ownerId)} · {r.data.due?'Due '+displayTime(r.data.due,w.location.timezone):'Due time not set'}</span><small>{r.data.priority==='urgent'?'Urgent · ':''}{r.data.acceptedBy?'Accepted':'Awaiting acceptance'}</small></button></li>)}</ul>}
   </article>
  </div><div>
   {home.maintenance.length>0&&<article className="jmax-panel"><h2>Maintenance and meter checks</h2><p>{home.maintenance.length} checked {home.maintenance.length===1?'plan':'plans'} due, in the warning window or needing a meter reading. No automatic messages are sent.</p><ul>{home.maintenance.slice(0,3).map(s=><li key={s.record.id}>{s.record.data.title} · {s.record.data.meterOnly?'meter hours only':`calendar ${s.due}`} · {s.state}{s.meter&&<> · meter due {s.meter.dueHours} hours · {s.meter.reading?`${s.meter.reading.hours} hours recorded ${s.meter.reading.date}`:'no reading recorded'}</>}</li>)}</ul><button onClick={()=>onNavigate('Scheduled maintenance')}>Open maintenance</button></article>}
   <article className="jmax-panel"><h2>Today’s team</h2><p>{home.shifts.length?`${home.shifts.length} published shifts starting today.`:'No published shifts starting today are recorded here.'}</p><button onClick={()=>onNavigate('Schedule week')}>Open schedule</button></article>
   <article className="jmax-panel"><h2>Closing checks and checkout</h2><p>{closing.length?`${closingChecks} pending closing ${closingChecks===1?'check':'checks'} · ${checkouts} ${checkouts===1?'shift ready':'shifts ready'} for manager checkout.`:'No closing check or shift checkout currently needs your follow-through.'}</p><button className="shared-primary" onClick={()=>onNavigate('Legacy duties')}>Open shift duties &amp; checkout</button></article>
   <article className="jmax-panel"><h2>Close and hand off</h2><p>{home.summaries.length?`${home.summaries.length} shift summaries recorded for today; ${home.drafts.length} still in draft.`:'No shift summaries have been recorded for today.'}</p><button className="shared-primary" onClick={()=>onNavigate('Manager Log')}>Write shift summary</button><p className="jmax-small">Missing records do not mean the work is complete.</p></article>
   <article className="jmax-panel"><h2>Your one-on-ones</h2><p>{home.meetings.length?`${home.meetings.length} recurring meetings · ${home.followups.length} unfinished follow-ups.`:'No recurring meetings are set up for you here.'}</p><button onClick={()=>onNavigate('Manager one-on-ones')}>Open private meetings</button></article>
   <p className="jmax-toast-note">Sales, clock-ins and live labor stay in Toast. No live Toast totals are displayed here.</p>
  </div></div>
 </section>;
}

export function OperationsDirectory({w,onNavigate}:{w:Workspace;onNavigate:(tab:string)=>void}){
 const [query,setQuery]=useState('');
 const modules=availableModules(w.me).filter(m=>(m.title+' '+m.group+' '+m.detail).toLowerCase().includes(query.toLowerCase().trim()));
 const groups=[...new Set(modules.map(m=>m.group))];
 return <section className="jmax-directory"><p className="jmax-eyebrow">{w.location.name}</p><h1>All work areas</h1><p>One place to find the restaurant’s work.</p><label className="shared-field">Find a work area<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Prep, schedule, maintenance…"/></label>
  {has(w.me,'location.manage')&&<p className="jmax-small">Areas marked “Not connected” are included for owner review. They cannot record work yet.</p>}
  {!groups.length&&<p>No work areas match your search.</p>}
  <div className="jmax-area-grid">{groups.map(group=><article key={group} className="jmax-panel"><h2>{group}</h2>{modules.filter(m=>m.group===group).map(m=><div key={m.id} className="jmax-area-row">{m.tab?<button onClick={()=>onNavigate(m.tab!)}><strong>{m.title}</strong><span>{m.detail}</span><small>Open →</small></button>:<details><summary>{m.title}<span className="jmax-pending">Not connected</span></summary><p>{m.detail}</p><p>{m.pending}</p></details>}</div>)}</article>)}</div>
 </section>;
}

export function OperationsRail({w,tab,onNavigate}:{w:Workspace;tab:string;onNavigate:(tab:string)=>void}){
 const modules=availableModules(w.me);
 const groups=[...new Set(modules.map(m=>m.group))];
 const activeGroup=modules.find(m=>m.tab===tab)?.group;
 const [expanded,setExpanded]=useState(activeGroup??'Home');
 useEffect(()=>{if(activeGroup)setExpanded(activeGroup)},[activeGroup]);
 const names:Record<string,string>={'Toast':'Sales','Safety and compliance':'Safety & compliance'};
 const marks:Record<string,string>={Home:'01',Labor:'02',Food:'03',Toast:'04','Safety and compliance':'05',Operations:'06',Maintenance:'07',Guests:'08',Marketing:'09',People:'10','Owner tools':'·'};
 return <aside className="jmax-rail" aria-label="JMAX work centers">
  <div className="jmax-rail-heading"><span>WORK CENTERS</span><small>{w.location.name}</small></div>
  <div className="jmax-center-list">{groups.map(group=>{
   const items=modules.filter(m=>m.group===group),open=expanded===group;
   return <div className="jmax-center" key={group} data-active={activeGroup===group}>
    <button className="jmax-center-toggle" aria-expanded={open} onClick={()=>setExpanded(open?'':group)}><span className="jmax-center-mark" aria-hidden="true">{marks[group]}</span><span>{names[group]??group}</span><span className="jmax-center-chevron" aria-hidden="true">{open?'−':'+'}</span></button>
    {open&&<div className="jmax-center-links">{items.map(item=>item.tab?<button key={item.id} aria-current={tab===item.tab?'page':undefined} onClick={()=>onNavigate(item.tab!)}>{item.title}</button>:<div key={item.id} className="jmax-center-pending"><span>{item.title}</span><small>Not connected</small></div>)}</div>}
   </div>;
  })}</div>
  <div className="jmax-rail-footer"><button aria-current={tab==='All areas'?'page':undefined} onClick={()=>onNavigate('All areas')}>All work areas <span aria-hidden="true">↗</span></button><button className="jmax-ask" aria-current={tab==='JMAX'?'page':undefined} onClick={()=>onNavigate('JMAX')}><span aria-hidden="true">✦</span> Ask JMAX</button><small>Local review · sample data</small></div>
 </aside>;
}
