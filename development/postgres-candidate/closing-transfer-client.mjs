import {checkedPublishedShift} from './published-shift-client.mjs';
import {configuredLocation} from './ui-store-configuration.mjs';
export const closingTransferReviewMessage='This cancellation review needs review. Reload current records before choosing covering shifts.';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>0;
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const text=v=>typeof v==='string'&&v.trim().length>0;
export function checkedCancellationReview(w,record,value) {
 const r=checkedPublishedShift(w,record),departments=configuredLocation(w.location).configuration.operatingDepartments;
 const fail=()=>{throw Error(closingTransferReviewMessage);};
 if(!r.data.publishedActions.canEdit||!value||value.locationId!==w.location.id||value.actorId!==w.me.id||value.shiftId!==r.id||value.revision!==r.revision||value.workspaceRevision!==w.location.revision||typeof value.canCancel!=='boolean'||!['','linked_task_pending'].includes(value.blockedReason)||value.canCancel!==(value.blockedReason==='')||!Array.isArray(value.closing)||value.closing.length>100||value.closing.length!==r.data.publishedActions.unfinishedClosingCount)fail();
 const ids=new Set();
 for(const c of value.closing){
  if(!c||!uuid(c.id)||ids.has(c.id)||!revision(c.revision)||!text(c.zone)||!date(c.due)||!['open','verification','manager-confirmation','correction'].includes(c.phase)||c.ownerId!==r.ownerId||!c.standard||!uuid(c.standard.id)||!text(c.standard.title)||!revision(c.standard.version)||!text(c.standard.position)||Object.keys(c.standard).some(k=>!['id','title','version','position'].includes(k))||typeof c.optionsTruncated!=='boolean'||!Array.isArray(c.options)||c.options.length>100||!value.canCancel&&c.options.length)fail();
  ids.add(c.id);const choices=new Set();
  for(const o of c.options){if(!o||!uuid(o.shiftId)||o.shiftId===r.id||choices.has(o.shiftId)||!revision(o.revision)||!uuid(o.ownerId)||!text(o.ownerName)||!text(o.position)||o.area!==r.area||!departments.includes(o.area)||!date(o.start)||!date(o.end)||Date.parse(o.end)<=Date.parse(o.start)||Date.parse(c.due)<Date.parse(o.start)||Date.parse(c.due)>Date.parse(o.end))fail();choices.add(o.shiftId);}
 }
 return structuredClone(value);
}
export async function loadCancellationReview(call,w,record){
 checkedPublishedShift(w,record);
 const response=await call('/cancellation-review/'+record.id);
 if(response.status!==200)throw Error(response.status===401?'Sign in again, then reload current records.':response.status===403?'Your current access does not allow this cancellation review.':response.status===409?'This shift changed or ended. Reload current records before reviewing again.':'Cancellation review could not be loaded. Reload current records before continuing.');
 return checkedCancellationReview(w,record,response.body);
}
export function cancellationTransferInput(w,record,review,selections,{confirmed,note}){
 const checked=checkedCancellationReview(w,record,review);
 if(!checked.canCancel)throw Error('Unfinished linked tasks must be resolved before cancelling this shift.');
 if(!confirmed)throw Error('Confirm the cancellation and every closing transfer.');
 if(typeof note!=='string'||!note.trim()||note.trim().length>2000)throw Error('Enter a reason of up to 2000 characters.');
 if(!selections||typeof selections!=='object'||Array.isArray(selections)||Object.keys(selections).length!==checked.closing.length||Object.keys(selections).some(id=>!checked.closing.some(c=>c.id===id)))throw Error('Choose a covering shift for every unfinished closing assignment.');
 const zones=new Set();
 const closeTransfers=[...checked.closing].sort((a,b)=>a.id.localeCompare(b.id)).map(c=>{
  const target=c.options.find(o=>o.shiftId===selections[c.id]);
  if(!target)throw Error('Choose a reviewed covering shift for every unfinished closing assignment.');
  const key=JSON.stringify([target.shiftId,c.zone]);if(zones.has(key))throw Error('Two closing assignments in the same zone need different covering shifts.');zones.add(key);
  return {closeId:c.id,closingRevision:c.revision,shiftId:target.shiftId,expectedRevision:target.revision};
 });
 return {note:note.trim(),closeTransfers};
}
