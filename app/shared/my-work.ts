import { guidesForShift } from './shift-learning';
import { approvedStationGuides } from './station-knowledge';
import { shiftStationName } from './station-assignment';
import { buildShiftBrief } from './shift-brief';
import { type RecordOf, type Workspace } from './types';

// Use an actual published assignment. Eligibility alone never assigns a station.
// Callers on the server must pass publicWorkspace so this cannot widen access.
export function myWork(w:Workspace,at:string) {
 const time=Date.parse(at);
 const shifts=w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===w.location.id&&r.ownerId===w.me.id&&r.data.published&&!r.data.cancelled&&!r.data.releasedAt&&Date.parse(r.data.end)>time&&Date.parse(r.data.start)<=time+7*86400000).sort((a,b)=>a.data.start.localeCompare(b.data.start)||a.id.localeCompare(b.id));
 const current=shifts.filter(s=>Date.parse(s.data.start)<=time);
 // A scheduled end does not complete the assigned close or release the employee.
 // Keep the most recent checkout in focus through the next day; older work stays in duties.
 // Release still requires a manager even when no closing assignment was saved.
 const pendingCheckout=w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===w.location.id&&r.ownerId===w.me.id&&r.data.published&&!r.data.cancelled&&!r.data.releasedAt&&Date.parse(r.data.end)<=time&&Date.parse(r.data.end)>time-86400000).sort((a,b)=>b.data.end.localeCompare(a.data.end)||a.id.localeCompare(b.id));
 const candidates=current.length?current:pendingCheckout.length?pendingCheckout.filter(s=>s.data.end===pendingCheckout[0].data.end):shifts.filter(s=>s.data.start===shifts[0]?.data.start);
 const ambiguous=candidates.length>1;
 const shift=ambiguous?undefined:candidates[0];
 const guides=ambiguous?[]:shift?guidesForShift(w,shift):approvedStationGuides(w).filter(r=>r.area===w.me.area&&r.data.position===w.me.position);
 const guideIds=new Set(guides.map(g=>g.id));
 const goals=w.records.filter((r):r is RecordOf<'goal'>=>r.kind==='goal'&&r.locationId===w.location.id&&r.ownerId===w.me.id&&!['closed','declined','cancelled'].includes(r.data.phase));
 const relatedGoals=goals.filter(g=>!!shift?.data.stationId&&g.data.stationLearning?.stationId===shift.data.stationId||!!g.data.standardId&&guideIds.has(g.data.standardId));
 const duties=buildShiftBrief(w,at).items.filter(item=>(['task','close','handoff'].includes(item.record.kind)||item.record.kind==='shift'&&item.record.ownerId===w.me.id)&&(item.record.ownerId===w.me.id||item.lane==='action'||item.record.kind==='task'&&item.record.data.closingHandoff?.outgoingId===w.me.id)&&(item.lane!=='later'||['close','task'].includes(item.record.kind)&&'shiftId' in item.record.data&&item.record.data.shiftId===shift?.id));
 return {shift,upcomingShifts:shifts,ambiguous,checkoutPending:!!shift&&Date.parse(shift.data.end)<=time,current:!!shift&&Date.parse(shift.data.start)<=time&&Date.parse(shift.data.end)>time,station:shift?shiftStationName(shift):w.me.position,guides,goals,relatedGoals,duties};
}
