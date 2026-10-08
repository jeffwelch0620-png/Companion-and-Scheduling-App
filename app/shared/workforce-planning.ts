import {scheduleChangeContext} from './schedule-change-context';
import { has, personName, type Workspace, type RecordOf } from './types';
import { shiftStationName } from './station-assignment';
import { activeStations, stationProficiency } from './workforce';
import { canPlan, scheduleReview, weekPeriod } from './schedule-review';
import { availabilityConflict, calendarDate } from './schedule-policy';
import { displayTime, localDate, nextDate } from './local-time';
import { overlaps } from './validation';
import type { ChatSource } from './companion-chat-types';

export const scheduleWeekId=(start:string)=>`schedule-week_${start}`;
export function scheduleWeekDate(id:string):string|null {
  if(!/^schedule-week_\d{4}-\d{2}-\d{2}$/.test(id))return null;
  try{return calendarDate(id.slice(14),'Schedule week')}catch{return null}
}
export function scheduleWeekSource(w:Workspace,start:string):ChatSource {
  calendarDate(start,'Schedule week');return {id:scheduleWeekId(start),revision:w.location.revision+1,title:`Schedule · ${start} to ${nextDate(start,6)}`,kind:'schedule-week'};
}
export function currentWeek(w:Workspace,at:string){const date=localDate(at,w.location.timezone),day=new Date(date+'T12:00:00Z').getUTCDay();return nextDate(date,-((day-(w.location.weekStartsOn??1)+7)%7));}

// A location revision makes the snapshot stale on any related record/access
// change. Only the viewer's schedule scope and explicit assessment facts enter.
export function workforceWeek(w:Workspace,start:string,selected?:string[]) {
  const period=weekPeriod(w,start),planning=w.members.some(m=>canPlan(w.me,m.area));
  const members=w.members.filter(m=>m.locationId===w.location.id&&(canPlan(w.me,m.area)||m.id===w.me.id));
  const ids=new Set(members.map(m=>m.id)),stations=activeStations(w).filter(s=>planning?canPlan(w.me,s.area):s.area===w.me.area);
  const allShifts=w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===w.location.id&&!r.data.cancelled&&ids.has(r.ownerId)&&(r.data.published||canPlan(w.me,r.area)));
  const shifts=allShifts.filter(s=>overlaps(s.data,period)&&(s.data.published||selected===undefined||selected.includes(s.id))).sort((a,b)=>a.data.start.localeCompare(b.data.start)||a.id.localeCompare(b.id));
  const minutes=(s:RecordOf<'shift'>)=>Math.max(0,Math.min(Date.parse(s.data.end),Date.parse(period.end))-Math.max(Date.parse(s.data.start),Date.parse(period.start)))/60000;
  const published=shifts.filter(s=>s.data.published),drafts=shifts.filter(s=>!s.data.published);
  const fullMinutes=(s:RecordOf<'shift'>)=>(Date.parse(s.data.end)-Date.parse(s.data.start))/60000;
  const startingThisWeek=(s:RecordOf<'shift'>)=>Date.parse(s.data.start)>=Date.parse(period.start)&&Date.parse(s.data.start)<Date.parse(period.end);
  const totals={scope:has(w.me,'location.manage')?'restaurant' as const:planning?'authorized departments' as const:'own schedule' as const,publishedMinutes:published.reduce((n,s)=>n+minutes(s),0),draftMinutes:drafts.reduce((n,s)=>n+minutes(s),0),plannedMinutes:shifts.reduce((n,s)=>n+minutes(s),0),publishedShifts:published.length,draftShifts:drafts.length,plannedShifts:shifts.length,people:new Set(shifts.map(s=>s.ownerId)).size,departments:[...new Set(shifts.map(s=>s.area))].sort(),shiftCardPublishedMinutes:published.filter(startingThisWeek).reduce((n,s)=>n+fullMinutes(s),0),shiftCardPlannedMinutes:shifts.filter(startingThisWeek).reduce((n,s)=>n+fullMinutes(s),0),basis:'Calendar-week minutes include all authorized saved shifts overlapping this week, clipped to the week boundaries, before breaks. Planned includes published plus selected drafts. Shift-card minutes count complete shifts starting in this week, including hours after the week ends; they exclude shifts starting before the week. Chat may omit rows for length, but never shortens the saved shift start or end times.'};
  const conflicts=(personId:string,p:{start:string;end:string},except?:string)=>[
    ...(!w.members.find(m=>m.id===personId)?['Employee is no longer active']:[]),
    ...(allShifts.some(s=>s.ownerId===personId&&s.id!==except&&overlaps(s.data,p))?['Overlapping shift']:[]),
    ...(availabilityConflict(w,personId,p)?['Approved availability conflict']:[]),
    ...(w.records.some(r=>r.kind==='request'&&r.ownerId===personId&&r.data.type==='time-off'&&r.data.status==='approved'&&overlaps(r.data,p))?['Approved time off']:[]),
  ];
  const profileCache=new Map<string,ReturnType<typeof readProfile>>();
  const readProfile=(personId:string,position:string,area:string,stationId?:string)=>{
    const station=stations.find(s=>(stationId?s.id===stationId:s.data.title===position)&&s.area===area),p=station?stationProficiency(w,personId,station):null;
    return {stationDefined:!!station,assessmentCurrent:p?.current??false,level:p?.level?.value??null,label:p?.level?.label??null,definition:p?.level?.definition??null,certifiedTrainer:p?.trainer??false,independentLevel:station?.data.independentLevel??null,assessmentRecordedAt:p?.record?.data.assessedAt??null};
  };
  const profile=(personId:string,position:string,area:string,stationId?:string)=>{const key=JSON.stringify([personId,position,area,stationId]),prior=profileCache.get(key);if(prior)return prior;const value=readProfile(personId,position,area,stationId);profileCache.set(key,value);return value;};
  const shiftFacts=shifts.map(s=>({id:s.id,change:scheduleChangeContext(s,w.location.timezone),personId:s.ownerId,person:personName(w,s.ownerId),area:s.area,job:s.data.position,station:shiftStationName(s),stationId:s.data.stationId,status:s.data.published?'published':'draft',start:s.data.start,end:s.data.end,startLocal:displayTime(s.data.start,w.location.timezone),endLocal:displayTime(s.data.end,w.location.timezone),cleared:!!members.find(m=>m.id===s.ownerId)?.qualifications.includes(shiftStationName(s)),conflicts:conflicts(s.ownerId,s.data,s.id),...profile(s.ownerId,s.data.position,s.area,s.data.stationId)}));
  const review=planning?scheduleReview(w,start,selected):null;
  const staffing=(review?.staffing??[]).map(n=>{
    const candidates=members.filter(m=>m.area===n.record.area&&m.qualifications.includes(n.record.data.position)&&!shiftFacts.some(s=>s.personId===m.id&&s.area===n.record.area&&s.job===n.record.data.position&&s.start<=n.record.data.start&&s.end>=n.record.data.end&&s.cleared&&!s.conflicts.length)).map(m=>({personId:m.id,name:m.name,conflicts:conflicts(m.id,n.record.data),...profile(m.id,n.record.data.position,m.area)}));
    const matching=shiftFacts.filter(s=>s.area===n.record.area&&s.job===n.record.data.position&&s.cleared&&!s.conflicts.length&&overlaps(s,n.record.data));
    const threshold=stations.find(s=>s.area===n.record.area&&s.data.title===n.record.data.position)?.data.independentLevel??null;
    const bounds=[...new Set([Math.max(Date.parse(n.record.data.start),Date.parse(period.start)),Math.min(Date.parse(n.record.data.end),Date.parse(period.end)),...matching.flatMap(s=>[Date.parse(s.start),Date.parse(s.end)])])].filter(t=>t>=Math.max(Date.parse(n.record.data.start),Date.parse(period.start))&&t<=Math.min(Date.parse(n.record.data.end),Date.parse(period.end))).sort((a,b)=>a-b);
    const composition=threshold===null?[]:bounds.slice(0,-1).map((from,i)=>{
      const to=bounds[i+1],covering=matching.filter(s=>Date.parse(s.start)<=from&&Date.parse(s.end)>=to);
      return {startLocal:displayTime(new Date(from).toISOString(),w.location.timezone),endLocal:displayTime(new Date(to).toISOString(),w.location.timezone),scheduled:new Set(covering.map(s=>s.personId)).size,atOrAboveIndependentLevel:new Set(covering.filter(s=>s.level!==null&&s.level>=threshold).map(s=>s.personId)).size,certifiedTrainers:new Set(covering.filter(s=>s.certifiedTrainer).map(s=>s.personId)).size,missingAssessments:covering.filter(s=>s.level===null).map(s=>s.person)};
    });
    return {id:n.record.id,title:n.record.data.title,station:n.record.data.position,area:n.record.area,minimum:n.record.data.minimum,source:n.record.data.source,startLocal:displayTime(n.record.data.start,w.location.timezone),endLocal:displayTime(n.record.data.end,w.location.timezone),publishedGaps:n.published.map(g=>({...g,startLocal:displayTime(g.start,w.location.timezone),endLocal:displayTime(g.end,w.location.timezone)})),plannedGaps:n.planned.map(g=>({...g,startLocal:displayTime(g.start,w.location.timezone),endLocal:displayTime(g.end,w.location.timezone)})),independentLevel:threshold,composition,candidateScope:'Additional cleared people; employees already covering this entire window without conflicts appear in shifts instead.',candidates:candidates.slice(0,40),omittedCandidates:Math.max(0,candidates.length-40)};
  });
  const opportunities:{station:string;learner:string;learnerLevel:string;trainer:string;trainerLevel:string;start:string;end:string;startLocal:string;endLocal:string;status:string}[]=[];
  const eligible=shiftFacts.filter(s=>s.cleared&&!s.conflicts.length&&s.level!==null).map(s=>({...s,from:Date.parse(s.start),to:Date.parse(s.end)}));
  const trainers=new Map<string,typeof eligible>();
  for(const shift of eligible.filter(s=>s.certifiedTrainer)){const key=JSON.stringify([shift.area,shift.station]);trainers.set(key,[...(trainers.get(key)??[]),shift]);}
  let opportunityCount=0;const periodFrom=Date.parse(period.start),periodTo=Date.parse(period.end);
  for(const learner of eligible){
    for(const trainer of trainers.get(JSON.stringify([learner.area,learner.station]))??[]){
      if(trainer.personId===learner.personId||trainer.level!<=learner.level!||trainer.from>=learner.to||learner.from>=trainer.to)continue;
      opportunityCount++;
      if(opportunities.length>=20)continue;
      const from=new Date(Math.max(learner.from,trainer.from,periodFrom)).toISOString(),to=new Date(Math.min(learner.to,trainer.to,periodTo)).toISOString();
      opportunities.push({station:learner.station,learner:learner.person,learnerLevel:learner.label!,trainer:trainer.person,trainerLevel:trainer.label!,start:from,end:to,startLocal:displayTime(from,w.location.timezone),endLocal:displayTime(to,w.location.timezone),status:learner.status==='published'&&trainer.status==='published'?'Both published':'Includes draft shift'});
    }
  }
  const proficiency=members.flatMap(m=>stations.filter(s=>s.area===m.area).map(s=>{const p=stationProficiency(w,m.id,s);return {person:m.name,station:s.data.title,...profile(m.id,s.data.title,m.area),cleared:m.qualifications.includes(s.data.title),nextLearningStep:p.current?p.record?.data.evidence:undefined}}));
  const availability=w.records.filter((r):r is RecordOf<'availability'>=>r.kind==='availability'&&ids.has(r.ownerId)&&['approved','pending'].includes(r.data.status)&&r.data.startDate<nextDate(start,7)&&r.data.endDate>=start).map(r=>({person:personName(w,r.ownerId),status:r.data.status,startDate:r.data.startDate,endDate:r.data.endDate,days:r.data.days,excludedDates:r.data.excludedDates??[],startMinute:r.data.startMinute,endMinute:r.data.endMinute,beforeMinutes:r.data.beforeMinutes,afterMinutes:r.data.afterMinutes}));
  const omitted=Math.max(0,shiftFacts.length-120)+Math.max(0,proficiency.length-120)+Math.max(0,staffing.length-40)+Math.max(0,availability.length-80)+Math.max(0,opportunityCount-20);
  return {source:scheduleWeekSource(w,start),facts:{authority:'Saved workforce planning snapshot; manager decisions remain required',weekStart:start,weekEnd:nextDate(start,6),view:planning?'Authorized department planning; published plus all drafts':'Own published schedule and development only',totals,shifts:shiftFacts.slice(0,120),staffing:staffing.slice(0,40),hours:review?.hours??shifts.map(s=>({personId:s.ownerId,shiftId:s.id})),proficiency:proficiency.slice(0,120),availability:availability.slice(0,80),trainingOpportunities:opportunities.slice(0,20),omittedRecords:omitted,limits:['No recorded conflict is not confirmed employee availability. Pending availability is not approved.','Draft shifts and training pairings are proposals. Training time, workload and willingness need manager confirmation.','Independent-readiness thresholds are station definitions, not schedule permissions. Missing definitions or assessments cannot establish strength.','No saved labor budget, wage rates, hours limit, sales forecast or live Toast schedule is supplied. The user may provide a sales scenario in their question; use it as a stated assumption, not a saved forecast or labor budget. Do not invent cost savings, legal compliance or a labor target.','Legacy 0–10 reviews, private chat, Inbox and feedback are excluded. Proficiency is manager-recorded; AI cannot assign ratings, trainer status or clearance.']}};
}
