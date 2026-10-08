'use client';
import { useRef, useState } from 'react';
import { personName, manages, type RecordOf, type Workspace, type WorkRecord } from '../shared/types';
import { ScheduleBoard, type ScheduleView } from './schedule-board';
import { isScheduleRequest, requestStage } from '../shared/schedule-requests';
import { ScheduleDraftEditor } from './schedule-draft-editor';
import { CoverageBoard } from './shift-coverage';
import { canPublish } from '../shared/schedule-policy';
import { closingForShift, closingSelection, closingPublicationIssues, pendingCopiedStaffing } from '../shared/publication';
import { planningStamp, scheduleReview } from '../shared/schedule-review';
import { WorkforceReadiness } from './workforce-readiness';
import { ScheduleReadiness } from './schedule-readiness';
import { ScheduleCopy } from './schedule-copy';
import { displayTime, localDate, nextDate } from '../shared/local-time';
import type { Send } from './workspace';
import { WorkspaceIcon } from './workspace-icon';
import { canManageAttendance } from '../shared/attendance';
import {ToastSchedulePreview} from './toast-schedule-preview';

export function ScheduleWeek({w,now,start,setStart,onRequests,onAttendance,onHistory,onAdd,onStaffing,onCover,onOpen,send,busy,onAskWeek,view,onViewChange}:{w:Workspace;now:string;start:string;setStart:(day:string)=>void;onRequests:()=>void;onAttendance:()=>void;onHistory:()=>void;onAdd:(day:string)=>void;onStaffing:()=>void;onCover:(r:RecordOf<'staffing'>)=>void;onOpen:(r:WorkRecord)=>void;send:Send;busy:boolean;onAskWeek:()=>void;view?:ScheduleView;onViewChange:(view:ScheduleView)=>void}){
  const [selected,setSelected]=useState<(RecordOf<'shift'>&{closing:{id:string;revision:number}[]})[]>([]),[reviewing,setReviewing]=useState(false);
  const [editing,setEditing]=useState(false);
  const [copying,setCopying]=useState(false);
  const [addDay,setAddDay]=useState(()=>{const today=localDate(now,w.location.timezone);return /^\d{4}-\d{2}-\d{2}$/.test(start)&&Number.isFinite(Date.parse(start))&&today>=start&&today<nextDate(start,7)?today:start});
  const toolsRef=useRef<HTMLDetailsElement>(null);
  const [planningReview,setPlanningReview]=useState('');
  const [checksOpen,setChecksOpen]=useState(false),checksRef=useRef<HTMLDetailsElement>(null);
  const planner=w.me.position!=='Dishwasher'&&w.me.capabilities.some(c=>['schedule.manage','schedule.publish','schedule.change'].includes(c));
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(start)&&Number.isFinite(Date.parse(start))&&new Date(start).toISOString().slice(0,10)===start,end=valid?nextDate(start,7):'',days=valid?Array.from({length:7},(_,i)=>nextDate(start,i)):[];
  const shifts=w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&!r.data.cancelled&&localDate(r.data.start,w.location.timezone)>=start&&localDate(r.data.start,w.location.timezone)<end).sort((a,b)=>a.data.start.localeCompare(b.data.start));
  const drafts=shifts.filter(r=>!r.data.published&&canPublish(w.me,r.area)),stale=selected.some(r=>w.records.find(current=>current.id===r.id)?.revision!==r.revision||JSON.stringify(r.closing)!==JSON.stringify(closingSelection(w,r.id)))||reviewing&&valid&&planningReview!==planningStamp(w,start,selected.map(r=>r.id));
  const checks=valid?scheduleReview(w,start,reviewing?selected.map(r=>r.id):undefined):null;
  const remainingGaps=reviewing?checks?.plannedGapCount??0:0;
  const person=(r:RecordOf<'shift'>)=>personName(w,r.ownerId,'Employee');
  const select=(r:RecordOf<'shift'>,checked:boolean)=>{setReviewing(false);setSelected(old=>checked?[...old,{...r,closing:closingSelection(w,r.id)}]:old.filter(s=>s.id!==r.id))};
  const editable=shifts.filter(r=>!r.data.published&&!r.data.releasedAt&&manages(w.me,r.area,'schedule.manage'));
  const closingIssues=selected.flatMap(s=>closingPublicationIssues(w,s));
  const pendingStaffing=selected.some(s=>pendingCopiedStaffing(w,s).length);
  if(copying)return <ScheduleCopy w={w} sourceWeek={start} send={send} busy={busy} onClose={()=>setCopying(false)} onCreated={day=>{setCopying(false);setStart(day)}}/>;
  if(editing)return <ScheduleDraftEditor w={w} weekStart={start} drafts={editable} send={send} busy={busy} onClose={()=>{setEditing(false);setSelected([]);setReviewing(false)}}/>;
  const dateLabel=(d:string)=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
  const pendingRequests=w.records.filter(isScheduleRequest).filter(r=>requestStage(r,now,w.location.timezone)==='pending').length;
  const leadership=w.records.filter((r):r is RecordOf<'leadership'>=>r.kind==='leadership'&&r.data.active&&localDate(r.data.start,w.location.timezone)>=start&&localDate(r.data.start,w.location.timezone)<end).sort((a,b)=>a.data.start.localeCompare(b.data.start));
  const thisWeek=()=>{const today=localDate(now,w.location.timezone);setStart(nextDate(today,-((new Date(today+'T12:00:00Z').getUTCDay()-(w.location.weekStartsOn??1)+7)%7)))};
  const weekNavigation=(<div className="schedule-week-nav"><button aria-label="Previous week" disabled={!valid||busy} onClick={()=>setStart(nextDate(start,-7))}>‹</button><details className="schedule-date-picker"><summary>{valid?dateLabel(start)+' – '+dateLabel(nextDate(start,6)):'Choose week'} <span aria-hidden="true">⌄</span></summary><label className="shared-field">Week starting<input type="date" value={start} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)}/></label></details><button aria-label="Next week" disabled={!valid||busy} onClick={()=>setStart(nextDate(start,7))}>›</button><button onClick={thisWeek} disabled={busy}>Today</button></div>);
  return <section className="schedule-week"><div className="schedule-title"><div><p className="jmax-eyebrow">Labor / Weekly planning</p><h1>Schedule</h1><p className="jmax-schedule-description">People, stations and coverage, together.</p></div><div className="schedule-title-actions">{w.me.capabilities.includes('schedule.manage')&&<button className="shared-primary" disabled={busy||!valid} onClick={()=>onAdd(addDay)}>+ Add shift</button>}</div></div>
    {valid?<>
      {drafts.length>0&&<details className="schedule-draft-actions" open={selected.length>0}><summary>{drafts.length} draft {drafts.length===1?'shift':'shifts'} · Review & publish</summary><div className="shared-actions"><button disabled={busy} onClick={()=>{setSelected(drafts.slice(0,100).map(r=>({...r,closing:closingSelection(w,r.id)})));setReviewing(false)}}>Select eligible drafts</button><button disabled={busy||!selected.length} onClick={()=>{setSelected([]);setReviewing(false)}}>Clear selection</button><button disabled={busy||!selected.length||stale} onClick={()=>{setPlanningReview(planningStamp(w,start,selected.map(r=>r.id)));setReviewing(true)}}>Review {selected.length} selected drafts</button></div><p>Select up to 100 drafts you are authorized to publish.</p></details>}
      {stale&&<p role="alert" className="shared-error">The staffing review, selected shifts or closing responsibilities changed. Clear the selection and review the latest week.</p>}
      {reviewing&&<form className="shared-publish-review" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await send('shift.publish-batch',{weekStart:start,drafts:selected.map(r=>({id:r.id,revision:r.revision,closing:r.closing})),planningReview,coverageAcknowledged:f.get('coverageAcknowledged')==='on',coverageNote:String(f.get('coverageNote')??''),note:String(f.get('note')??''),confirmed:f.get('confirmed')==='on'})){setSelected([]);setReviewing(false)}}}>
        <h2>Publish selected shifts</h2><p>Only these saved drafts will be published. If any selected shift fails a check, none of this selection will publish.</p>
        <ul>{selected.map(r=><li key={r.id}><strong>{person(r)} · {r.data.position}</strong><br/>{displayTime(r.data.start,w.location.timezone)} → {displayTime(r.data.end,w.location.timezone)}<details><summary>Closing responsibilities: {r.closing.length}</summary>{closingForShift(w,r.id).map(c=><article key={c.id}><strong>{c.data.standard.title} · v{c.data.standard.version}</strong><p>Due {displayTime(c.data.due,w.location.timezone)} · Final check: {personName(w,c.data.managerId,'Assigned manager')}{c.data.verifierId?' · First check: '+(personName(w,c.data.verifierId,'Assigned verifier')):''}</p><ul>{c.data.standard.criteria.map((criterion,i)=><li key={i}>{criterion}</li>)}</ul><p>{c.data.standard.source}</p></article>)}{!r.closing.length&&<p>No closing work assigned.</p>}</details></li>)}</ul>
        <label className="shared-field">Publication review note<textarea name="note" required maxLength={2000} disabled={busy}/></label>
        {pendingStaffing&&<p role="alert">Review or withdraw the copied staffing needs shown above before publishing affected shifts.</p>}
        {!!closingIssues.length&&<div role="alert"><p>Closing responsibilities need attention before this selection can publish.</p>{closingIssues.map(({record,reason},i)=><p key={record.id+':'+i}>{record.data.standard.title}: {reason}</p>)}</div>}
        {!!remainingGaps&&<><p role="status">This selection leaves {remainingGaps} staffing time {remainingGaps===1?'window':'windows'} short. Review Schedule checks below.</p><p>This plan is saved with each published shift and is visible to its employee.</p><label className="shared-field">Plan for remaining staffing gaps<textarea name="coverageNote" required maxLength={2000} disabled={busy}/></label><label className="shared-check"><input type="checkbox" name="coverageAcknowledged" required disabled={busy||stale}/>I reviewed the remaining gaps and am explicitly publishing with this exception.</label></>}
        <label className="shared-check"><input type="checkbox" name="confirmed" required disabled={busy||stale}/>I reviewed these exact shifts and their assigned responsibilities.</label>
        <div className="shared-actions"><button className="shared-primary" disabled={busy||stale||!!closingIssues.length||pendingStaffing}>Publish selected shifts</button><button type="button" disabled={busy} onClick={()=>setReviewing(false)}>Back to planning</button></div>
      </form>}
      <ScheduleBoard view={view} onViewChange={onViewChange} weekNavigation={weekNavigation} onRequests={onRequests} pendingRequests={pendingRequests} w={w} now={now} days={days} onDayChange={setAddDay} shifts={shifts} selected={selected.map(s=>s.id)} onSelect={select} onOpen={onOpen} busy={busy}/>
      <ToastSchedulePreview key={w.location.id+':'+start} w={w} weekStart={start}/>
      {w.me.position!=='Dishwasher'&&w.me.capabilities.some(c=>['schedule.manage','schedule.publish','schedule.change'].includes(c))&&<details ref={checksRef} className="schedule-secondary" open={reviewing||checksOpen} onToggle={e=>setChecksOpen(e.currentTarget.open)}><summary>Schedule checks{checks?.issues.length?' · '+new Set(checks.issues.map(i=>i.record.ownerId)).size+' people need review':''}{checks?.plannedGapCount?' · '+checks.plannedGapCount+' coverage gaps':''}</summary><ScheduleReadiness w={w} start={start} selected={reviewing?selected.map(r=>r.id):undefined} onOpen={onOpen} onAdd={onStaffing} onCover={onCover}/></details>}
      {w.me.position!=='Dishwasher'&&w.me.capabilities.some(c=>['schedule.manage','schedule.publish','schedule.change'].includes(c))&&<details className="schedule-secondary"><summary>Experience & training</summary><WorkforceReadiness w={w} start={start} selected={reviewing?selected.map(r=>r.id):undefined} onAsk={onAskWeek}/></details>}
      {(planner||editable.length>0||shifts.some(s=>manages(w.me,s.area,'schedule.manage')))&&<details className="schedule-secondary"><summary>Week tools</summary><div className="shared-actions"><button onClick={onHistory}>Past work</button>{canManageAttendance(w.me)&&<button onClick={onAttendance}>Attendance history</button>}{planner&&<button disabled={busy||!valid} onClick={onAskWeek}>Ask JMAX about the team’s week</button>}{editable.length>0&&<button disabled={busy} onClick={()=>setEditing(true)}>Edit draft shifts</button>}{shifts.some(s=>manages(w.me,s.area,'schedule.manage'))&&<button disabled={busy} onClick={()=>setCopying(true)}>Prepare another week</button>}</div></details>}
      {leadership.length>0&&<details className="schedule-secondary"><summary>Shift leadership · {leadership.length}</summary><div className="shared-list">{leadership.map(r=><button key={r.id} onClick={()=>onOpen(r)}><span><strong>{personName(w,r.ownerId)} · {r.data.area}</strong><small>{displayTime(r.data.start,w.location.timezone)} – {displayTime(r.data.end,w.location.timezone)}</small></span></button>)}</div></details>}
      <details className="schedule-secondary"><summary>Coverage requests</summary><CoverageBoard w={w} start={start} days={7} onOpen={onOpen}/></details>
    </>:<>{weekNavigation}<p>Choose the first day of the week to review.</p></>}
  </section>;
}
