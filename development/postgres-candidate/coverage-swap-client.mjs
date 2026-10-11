// Presentation checks complement, but never replace, server eligibility and consent.
import {configuredLocation} from './ui-store-configuration.mjs';
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export const offerReviewMessage='This request needs review. Reload or contact a manager.';
export const isOffer=r=>r?.kind==='coverage'||r?.kind==='request'&&r?.data?.type==='swap';
export function checkedOffer(w,r) {
 configuredLocation(w.location);
 const statuses=r?.kind==='coverage'?['open','approved','withdrawn','invalidated']:['pending','accepted-by-replacement','approved','declined','invalidated'];
 if(!isOffer(r)||!r?.data||r.locationId!==w.location.id||!Number.isSafeInteger(r.revision)||r.revision<1||!r.id||!r.ownerId||!r.data.shiftId||!w.location.configuration.operatingDepartments.includes(r.area)||!statuses.includes(r.data.status)||!instant(r.data.start)||!instant(r.data.end)||Date.parse(r.data.start)>=Date.parse(r.data.end)||!Array.isArray(r.data.duties)||!Array.isArray(r.data.volunteers)||!Array.isArray(r.data.history)||r.kind==='request'&&!r.data.replacementId)throw Error('Coverage details are incomplete. Reload current records before responding.');
 if([r.id,r.ownerId,r.data.shiftId,r.data.position,r.data.note].some(v=>typeof v!=='string')||r.data.decision!==undefined&&typeof r.data.decision!=='string')throw Error('Coverage details are incomplete. Reload current records.');
 for(const d of r.data.duties)if(!d||[d.id,d.title,d.zone].some(v=>typeof v!=='string'||!v)||!instant(d.due)||!Array.isArray(d.criteria)||d.criteria.some(c=>typeof c!=='string'))throw Error('Closing duties are incomplete. Reload before consenting.');
 const a=r.data.actions;
 if(!a||['canVolunteer','canWithdraw','canWithdrawVolunteer','canConsent','canApprove','canDecline','canReview','departmentChange','isCurrent'].some(k=>typeof a[k]!=='boolean')||!Array.isArray(a.approvalTargetIds)||a.approvalTargetIds.some(id=>typeof id!=='string'||!id)||new Set(a.approvalTargetIds).size!==a.approvalTargetIds.length||a.replacementDepartment!==null&&typeof a.replacementDepartment!=='string')throw Error('Coverage actions are incomplete. Reload current records.');
 if(a.canApprove&&!a.approvalTargetIds.length||a.departmentChange&&!a.replacementDepartment||r.data.history.some(h=>!h||typeof h.action!=='string'||!instant(h.at)||typeof h.note!=='string'))throw Error('Coverage details are incomplete. Reload current records.');
 if(r.data.volunteers.some(v=>!v||typeof v.personId!=='string'||!instant(v.at)))throw Error('Coverage volunteers are incomplete. Reload current records.');
 return r;
}
export function validOffers(w) {
 const valid=[];let invalid=Number.isSafeInteger(w.offerReviewNotices)?w.offerReviewNotices:0;
 for(const record of w.records.filter(isOffer))try{valid.push(checkedOffer(w,record));}catch{invalid++;}
 return {valid,invalid};
}
export function offerActions(w,record,now) {
 const a=checkedOffer(w,record).data.actions;
 return {current:a.isCurrent,volunteer:a.canVolunteer,withdrawVolunteer:a.canWithdrawVolunteer,withdraw:a.canWithdraw,consent:a.canConsent,review:a.canReview,approve:a.canApprove,decline:a.canDecline,departmentChange:a.departmentChange,replacementDepartment:a.replacementDepartment,approvalTargetIds:a.approvalTargetIds};
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
 if(validOffers(w).valid.some(r=>r.kind==='coverage'&&r.data.shiftId===shift.id&&r.data.status==='open')&&fields.openCoverageConfirmed!==true)throw Error('An open coverage offer exists. Confirm you reviewed it before requesting a named replacement.');
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
  if(!fields.approve&&!a.decline)throw Error('This response is unavailable. Reload current records.');
  return {approve:fields.approve,note,...(fields.approve&&a.departmentChange?{departmentConfirmed:true}:{})};
 }
 if(action==='coverage.approve'&&r.kind==='coverage'&&confirmed) {
  if(a.approve&&a.approvalTargetIds.includes(fields.personId))return {personId:fields.personId,confirmed:true,note};
 }
 throw Error('This response is unavailable or needs explicit consent. Reload current records.');
}
export const offerIssueText=code=>({offer_finished:'This request is finished.',offer_shift_unavailable:'This shift is no longer available.',offer_shift_ended:'This shift has ended.',offer_shift_started:'This coverage shift has started. Contact its assigned leader.',offer_shift_changed:'The shift changed. A fresh request and consent are required.',offer_owner_inactive:'The original employee is no longer active.',offer_duties_changed:'Closing duties changed. A fresh request and consent are required.',offer_guide_unavailable:'A closing guide needs review before this request can continue.'}[code]??'This request needs review. Reload current records.');
