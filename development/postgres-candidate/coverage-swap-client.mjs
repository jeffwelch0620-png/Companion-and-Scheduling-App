// Presentation checks complement, but never replace, server eligibility and consent.
import {configuredLocation} from './ui-store-configuration.mjs';
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export const isOffer=r=>r?.kind==='coverage'||r?.kind==='request'&&r?.data?.type==='swap';
export function checkedOffer(w,r) {
 configuredLocation(w.location);
 const statuses=r?.kind==='coverage'?['open','approved','withdrawn','invalidated']:['pending','accepted-by-replacement','approved','declined','invalidated'];
 if(!isOffer(r)||!r?.data||r.locationId!==w.location.id||!Number.isSafeInteger(r.revision)||r.revision<1||!r.id||!r.ownerId||!r.data.shiftId||!w.location.configuration.operatingDepartments.includes(r.area)||!statuses.includes(r.data.status)||!instant(r.data.start)||!instant(r.data.end)||Date.parse(r.data.start)>=Date.parse(r.data.end)||!Array.isArray(r.data.duties)||!Array.isArray(r.data.volunteers)||!Array.isArray(r.data.history)||r.kind==='request'&&!r.data.replacementId)throw Error('Coverage details are incomplete. Reload current records before responding.');
 for(const d of r.data.duties)if(!d.id||!d.title||!d.zone||!instant(d.due)||!Array.isArray(d.criteria)||d.criteria.some(c=>typeof c!=='string'))throw Error('Closing duties are incomplete. Reload before consenting.');
 return r;
}
export function canReviewDepartment(w,area,period) {
 const me=w.me,caps=me.capabilities;
 return me.locationId===w.location.id&&!me.scheduleOnly&&caps.includes('schedule.change')&&(caps.includes('location.manage')||me.area===area&&w.records.some(r=>r.kind==='leadership'&&r.locationId===w.location.id&&r.area===area&&r.data.personId===me.id&&r.data.active&&Date.parse(r.data.start)<=Date.parse(period.start)&&Date.parse(r.data.end)>=Date.parse(period.end)));
}
export function offerActions(w,record,now) {
 const r=checkedOffer(w,record),d=r.data,own=r.ownerId===w.me.id,swap=r.kind==='request',current=!d.unavailableReason&&Date.parse(d.end)>Date.parse(now)&&(swap?['pending','accepted-by-replacement'].includes(d.status):d.status==='open'&&Date.parse(d.start)>Date.parse(now));
 const volunteered=d.volunteers.some(v=>v.personId===w.me.id),replacement=w.members.find(m=>m.id===d.replacementId);
 const review=current&&!own&&w.me.id!==d.replacementId&&canReviewDepartment(w,r.area,d);
 return {current,volunteer:!swap&&current&&!own&&!volunteered&&d.eligible===true,withdrawVolunteer:!swap&&d.status==='open'&&volunteered,withdraw:!swap&&d.status==='open'&&own,consent:swap&&current&&d.status==='pending'&&w.me.id===d.replacementId,review,approve:review&&(!swap||d.status==='accepted-by-replacement'&&!!replacement&&canReviewDepartment(w,replacement.area,d)),departmentChange:swap&&!!replacement&&replacement.area!==r.area,replacement};
}
export function replacementCandidates(w,shift) {
 // A roster suggestion is not clearance. The server checks every candidate again.
 return w.members.filter(m=>m.locationId===w.location.id&&!m.scheduleOnly&&m.id!==shift.ownerId&&(m.scheduleJobs??[]).includes(shift.data.position));
}
export function replacementInput(w,shift,type,fields,now) {
 if(shift.kind!=='shift'||shift.locationId!==w.location.id||shift.ownerId!==w.me.id||!shift.data.published||shift.data.cancelled||shift.data.releasedAt||Date.parse(shift.data.end)<=Date.parse(now))throw Error('Open your current published shift before requesting a replacement.');
 const note=String(fields.note??'').trim();
 if(note.length>2000||type==='swap'&&!note)throw Error('Describe why you are requesting this replacement.');
 if(type==='coverage') {
  if(Date.parse(shift.data.start)<=Date.parse(now))throw Error('This shift has started. Contact the assigned leader about coverage.');
  return {shiftId:shift.id,shiftRevision:shift.revision,note};
 }
 if(type!=='swap'||!replacementCandidates(w,shift).some(m=>m.id===fields.replacementId))throw Error('Choose a current coworker with the scheduled job. Eligibility will be checked by the server.');
 return {type:'swap',shiftId:shift.id,shiftRevision:shift.revision,start:shift.data.start,end:shift.data.end,replacementId:fields.replacementId,note};
}
export function offerCommandInput(w,r,action,fields,now) {
 const a=offerActions(w,r,now),confirmed=fields.confirmed===true,note=String(fields.note??'').trim();
 if(action==='coverage.withdraw'&&a.withdraw)return {};
 if(action==='coverage.withdraw-volunteer'&&a.withdrawVolunteer)return {};
 if(action==='coverage.volunteer'&&a.volunteer&&confirmed)return {confirmed:true};
 if(action==='request.consent'&&a.consent&&typeof fields.accept==='boolean'&&(!fields.accept||confirmed))return {accept:fields.accept};
 if(!a.review||!note||note.length>2000)throw Error('This decision requires an independent assigned reviewer and a reason. Reload current records.');
 if(action==='request.review'&&r.kind==='request'&&typeof fields.approve==='boolean') {
  if(fields.approve&&(!a.approve||!confirmed||a.departmentChange&&fields.departmentConfirmed!==true))throw Error('Review the replacement, duties and any department change before approval.');
  return {approve:fields.approve,note};
 }
 if(action==='coverage.approve'&&r.kind==='coverage'&&confirmed) {
  const target=w.members.find(m=>m.id===fields.personId);
  if(target&&target.id!==w.me.id&&target.id!==r.ownerId&&target.area===r.area&&r.data.volunteers.some(v=>v.personId===target.id)&&canReviewDepartment(w,target.area,r.data))return {personId:target.id,confirmed:true,note};
 }
 throw Error('This response is unavailable or needs explicit consent. Reload current records.');
}
export const offerIssueText=code=>({offer_finished:'This request is finished.',offer_shift_unavailable:'This shift is no longer available.',offer_shift_ended:'This shift has ended.',offer_shift_started:'This coverage shift has started. Contact its assigned leader.',offer_shift_changed:'The shift changed. A fresh request and consent are required.',offer_owner_inactive:'The original employee is no longer active.',offer_duties_changed:'Closing duties changed. A fresh request and consent are required.',offer_guide_unavailable:'A closing guide needs review before this request can continue.'}[code]??'This request needs review. Reload current records.');
