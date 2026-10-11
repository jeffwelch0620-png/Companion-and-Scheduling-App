import {configuredLocation,isCheckoutPosition} from './ui-store-configuration.mjs';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const day=(value,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const changed=()=>Error('The schedule or review changed. Reload current records and review the selection again.');
const invalid=()=>Error('The publication review is incomplete. Reload before publishing.');
export function publishableDrafts(w,weekStart,now=new Date().toISOString()) {
 configuredLocation(w.location);
 if(!date(weekStart)||!instant(now))throw invalid();
 const end=new Date(Date.parse(weekStart)+7*86400000).toISOString().slice(0,10),me=w.me;
 if(me.locationId!==w.location.id||me.scheduleOnly||isCheckoutPosition(w,me.position)||!me.capabilities.includes('schedule.publish'))return [];
 return w.records.filter(r=>r.kind==='shift'&&r.locationId===w.location.id&&!r.data.published&&!r.data.cancelled&&!r.data.releasedAt&&revision(r.revision)&&r.revision>0&&instant(r.data.start)&&instant(r.data.end)&&Date.parse(r.data.end)>Date.parse(now)&&(me.area===r.area||me.capabilities.includes('location.manage'))&&day(r.data.start,w.location.timezone)>=weekStart&&day(r.data.start,w.location.timezone)<end);
}
async function checked(call,path,input) {
 const response=await call(path,input);
 if(response.status!==200)throw Error(response.status===401?'Sign in again, reload and review the schedule.':response.status===403?'Your current access does not allow publication review.':'Publication review could not be loaded. Reload and review again.');
 return response.body;
}
function validateWeekReview(r,weekStart,scheduleRevision,inputRevision) {
 if(!r||r.weekStart!==weekStart||!revision(r.workspaceRevision)||typeof r.planningReview!=='string'||!/^[0-9a-f]{64}$/.test(r.planningReview)||!Array.isArray(r.staffing)||!Number.isSafeInteger(r.plannedGapCount)||r.plannedGapCount<0||!instant(r.period?.start)||!instant(r.period?.end))throw invalid();
 if(!revision(r.scheduleRevision)||r.scheduleRevision!==scheduleRevision||!revision(r.inputRevision)||r.inputRevision!==inputRevision)throw changed();
 if(r.staffing.some(n=>!uuid(n.id)||!revision(n.revision)||n.revision<1||!Number.isInteger(n.required)||n.required<1||!Array.isArray(n.gaps)||n.gaps.some(g=>!instant(g.start)||!instant(g.end)||Date.parse(g.start)>=Date.parse(g.end)||!Number.isInteger(g.required)||!Number.isInteger(g.scheduled)||g.required!==n.required||g.scheduled<0||g.scheduled>=g.required)))throw invalid();
 if(new Set(r.staffing.map(n=>n.id)).size!==r.staffing.length||r.staffing.reduce((sum,n)=>sum+n.gaps.length,0)!==r.plannedGapCount)throw invalid();
}
// One batched snapshot is bracketed by current planning and viewer checks; no client certification.
export async function loadWeeklyPublicationReview(call,w,weekStart,selectedIds,now=new Date().toISOString()) {
 if(!Array.isArray(selectedIds)||selectedIds.length<1||selectedIds.length>100||selectedIds.some(id=>!uuid(id))||new Set(selectedIds).size!==selectedIds.length)throw invalid();
 const eligible=publishableDrafts(w,weekStart,now),selected=selectedIds.map(id=>eligible.find(r=>r.id===id));
 if(selected.some(r=>!r))throw changed();
 const scopeRevision=w.scheduleRevision,inputRevision=w.inputRevision,request={weekStart,draftIds:[...selectedIds].sort()},first=await checked(call,'/week-review',request);
 validateWeekReview(first,weekStart,scopeRevision,inputRevision);
 if(!Array.isArray(first.drafts)||first.drafts.length!==selected.length||new Set(first.drafts.map(d=>d.shiftId)).size!==selected.length)throw invalid();
 const drafts=[];
 for(const r of selected) {
  const detail=first.drafts.find(d=>d.shiftId===r.id);
  if(detail?.shiftId!==r.id||detail.revision!==r.revision||detail.scheduleRevision!==scopeRevision||detail.inputRevision!==inputRevision)throw changed();
  if(!Array.isArray(detail.closing)||detail.closing.length>100||detail.closing.some(c=>!uuid(c.id)||!revision(c.revision)||c.revision<1||!instant(c.due)||!uuid(c.ownerId)||!uuid(c.managerId)||c.verifierId!==null&&!uuid(c.verifierId)||!uuid(c.standardId)||!revision(c.standardRevision)||c.standardRevision<1||typeof c.standard?.title!=='string'||!revision(c.standard.version)||c.standard.version<1||typeof c.standard.position!=='string'||Object.keys(c.standard).some(k=>!['title','version','position'].includes(k)))||new Set(detail.closing.map(c=>c.id)).size!==detail.closing.length||!Array.isArray(detail.closingIssues)||!Array.isArray(detail.staffing)||typeof detail.sourceReviewComplete!=='boolean')throw invalid();
  drafts.push({...structuredClone(r),closing:structuredClone(detail.closing).sort((a,b)=>a.id.localeCompare(b.id)),closingIssues:structuredClone(detail.closingIssues),copiedStaffing:detail.staffing.filter(n=>n.status==='draft'),sourceReviewComplete:detail.sourceReviewComplete});
 }
 const staffing=first.staffing.map(n=>{const r=n.record;if(r?.id!==n.id||r.revision!==n.revision||r.kind!=='staffing'||r.locationId!==w.location.id||r.data?.status!=='approved'||r.data.minimum!==n.required)throw changed();return {...structuredClone(r),gaps:structuredClone(n.gaps)};});
 const last=await checked(call,'/week-review',request);validateWeekReview(last,weekStart,scopeRevision,inputRevision);
 if(first.planningReview!==last.planningReview)throw changed();
 const viewer=await checked(call,'/schedule-viewer');
 const planningLocation=({revision,...location})=>location;
 if(viewer.scheduleRevision!==scopeRevision||viewer.inputRevision!==inputRevision||JSON.stringify(planningLocation(viewer.location))!==JSON.stringify(planningLocation(w.location))||JSON.stringify(viewer.me)!==JSON.stringify(w.me))throw changed();
 return {weekStart,locationId:w.location.id,actorId:w.me.id,workspaceRevision:first.workspaceRevision,scheduleRevision:scopeRevision,inputRevision,planningReview:first.planningReview,plannedGapCount:first.plannedGapCount,drafts,staffing};
}
export function publicationInput(review,{confirmed,note,coverageAcknowledged=false,coverageNote=''}) {
 if(!review?.drafts?.length||review.drafts.some(r=>!r.sourceReviewComplete||r.closingIssues.length||r.copiedStaffing.length))throw Error('Resolve schedule input, staffing and closing review issues before publishing.');
 if(confirmed!==true||typeof note!=='string'||!note.trim()||note.trim().length>2000)throw Error('Confirm the selection and enter a publication reason.');
 if(review.plannedGapCount>0&&(coverageAcknowledged!==true||typeof coverageNote!=='string'||!coverageNote.trim()||coverageNote.trim().length>2000))throw Error('Acknowledge remaining gaps and enter a written coverage plan.');
 return {weekStart:review.weekStart,planningReview:review.planningReview,drafts:review.drafts.map(r=>({id:r.id,revision:r.revision,closing:r.closing.map(c=>({id:c.id,revision:c.revision}))})),confirmed:true,note:note.trim(),coverageAcknowledged:review.plannedGapCount>0&&coverageAcknowledged===true,coverageNote:review.plannedGapCount>0?coverageNote.trim():''};
}
