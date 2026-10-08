'use client';
import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {employeeShiftWeek} from '../shared/employee-week';
import {localDate} from '../shared/local-time';
import {shiftStationName} from '../shared/station-assignment';
import {personName,type RecordOf,type Workspace} from '../shared/types';
import {scheduledDuration} from './schedule-board';

const dateLabel=(date:string,options:Intl.DateTimeFormatOptions)=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{...options,timeZone:'UTC'});

export function EmployeeShiftWeek({w,shift,onSelect,children}:{w:Workspace;shift:RecordOf<'shift'>;onSelect:(r:RecordOf<'shift'>)=>void;children:ReactNode}) {
 const week=employeeShiftWeek(w,shift),selectedDate=localDate(shift.data.start,w.location.timezone);
 const [offDay,setOffDay]=useState<string|null>(null),ref=useRef<HTMLElement>(null);
 const day=offDay??selectedDate,shifts=week.days.find(d=>d.date===day)?.shifts??[];
 const firstName=personName(w,shift.ownerId).split(' ')[0];
 useLayoutEffect(()=>{ref.current?.closest('dialog')?.scrollTo({top:0,behavior:'instant'})},[shift.id,day]);
 const choose=(r:RecordOf<'shift'>)=>{if(r.ownerId!==shift.ownerId||r.locationId!==w.location.id)return;setOffDay(null);onSelect(r)};
 return <section ref={ref} className="employee-shift-week" aria-label={`${firstName}’s schedule`}>
  <div className="employee-week-heading"><div><strong>{firstName}’s week</strong><span>{dateLabel(week.start,{month:'short',day:'numeric'})} – {dateLabel(week.end,{month:'short',day:'numeric'})}</span></div><span><strong>{scheduledDuration(week.minutes)}</strong> scheduled{week.hasDrafts&&<small>Includes drafts</small>}</span></div>
  <div className="employee-week-days" aria-label={`${firstName}’s days`}>
   {week.days.map(d=><button key={d.date} type="button" aria-pressed={day===d.date} aria-label={`${dateLabel(d.date,{weekday:'long',month:'short',day:'numeric'})}, ${d.shifts.length?`${d.shifts.length} ${d.shifts.length===1?'shift':'shifts'}`:'no scheduled shifts'}`} onClick={()=>d.shifts.length?choose(d.shifts[0]):setOffDay(d.date)}><small>{dateLabel(d.date,{weekday:'short'})}</small><strong>{dateLabel(d.date,{day:'numeric'})}</strong><span className="employee-day-dots" aria-hidden="true">{d.shifts.length>0?<i/>:<span>–</span>}{d.shifts.length>1&&<i/>}</span></button>)}
  </div>
  {offDay?<div className="employee-day-off" role="status"><span aria-hidden="true">—</span><h3>No shift scheduled</h3><p>{firstName} · {dateLabel(offDay,{weekday:'long',month:'short',day:'numeric'})}</p><button type="button" onClick={()=>setOffDay(null)}>Back to selected shift</button></div>:<>
   {shifts.length>1&&<div className="employee-split-shifts" aria-label="Choose this employee’s shift">{shifts.map((s,i)=><button key={s.id} type="button" aria-pressed={s.id===shift.id} onClick={()=>choose(s)}><small>Shift {i+1} · {shiftStationName(s)}</small><strong>{new Date(s.data.start).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:w.location.timezone})}</strong></button>)}</div>}
   <div className="employee-selected-shift" key={shift.id}>{children}</div>
  </>}
 </section>;
}
