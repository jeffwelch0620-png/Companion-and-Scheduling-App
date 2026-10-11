import {configuredLocation} from './ui-store-configuration.mjs';
import {localDate,localClock,localInstant} from './runtime/closing-reference/local-time.mjs';
export const publishedShiftReviewMessage='This published shift needs review. Reload or contact a manager.';
export function checkedPublishedShift(w,r) {
 configuredLocation(w.location);const d=r?.data,a=d?.publishedActions;
 if(r?.kind!=='shift'||r.locationId!==w.location.id||typeof r.id!=='string'||!r.id||!Number.isSafeInteger(r.revision)||r.revision<1||!w.location.configuration.operatingDepartments.includes(r.area)||typeof r.ownerId!=='string'||!r.ownerId||d?.personId!==r.ownerId||d?.published!==true||typeof d.cancelled!=='boolean'||typeof d.position!=='string'||!d.position||![d.start,d.end].every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t)))||Date.parse(d.end)<=Date.parse(d.start)||!a||['canEdit','canChangeStructure','canChangeStation','canCancel','hasLinkedTasks','hasCompletedClosing'].some(k=>typeof a[k]!=='boolean')||!Number.isSafeInteger(a.unfinishedClosingCount)||a.unfinishedClosingCount<0||!Array.isArray(a.editAreas)||a.editAreas.some(area=>!w.location.configuration.operatingDepartments.includes(area))||new Set(a.editAreas).size!==a.editAreas.length||!['','draft','inactive','ended','reference','authority'].includes(a.blockedReason)||(!a.canEdit&&(a.canCancel||a.canChangeStructure||a.canChangeStation))||a.canChangeStation&&!a.canChangeStructure||a.canCancel&&a.unfinishedClosingCount>0||a.canEdit&&(d.cancelled||d.releasedAt||a.blockedReason))throw Error(publishedShiftReviewMessage);
 if(a.canChangeStructure&&(a.hasLinkedTasks||a.hasCompletedClosing)||a.canChangeStation&&a.unfinishedClosingCount>0)throw Error(publishedShiftReviewMessage);
 return r;
}
export function publishedShiftFields(w,r) {
 checkedPublishedShift(w,r);const fields={personId:r.ownerId,position:r.data.position,stationId:r.data.stationId??''};
 for(const key of ['start','end']) {
  const instant=r.data[key],date=localDate(instant,w.location.timezone),time=localClock(instant,w.location.timezone);
  fields[key+'Date']=date;fields[key+'Time']=time;
  fields[key+'Occurrence']=Date.parse(localInstant(date,time,w.location.timezone,'later'))>Date.parse(localInstant(date,time,w.location.timezone,'earlier'))&&Date.parse(instant)>=Date.parse(localInstant(date,time,w.location.timezone,'later'))?'later':'earlier';
 }
 return fields;
}
function reason(note) {if(typeof note!=='string'||!note.trim()||note.trim().length>2000)throw Error('Explain the reason for this published change.');return note.trim();}
export function publishedShiftInput(w,r,fields,confirmed,now=new Date().toISOString()) {
 const a=checkedPublishedShift(w,r).data.publishedActions;if(!a.canEdit)throw Error('This shift cannot be edited with your current access.');
 if(confirmed!==true)throw Error('Review the employee, times and effect on linked work before saving.');
 const note=reason(fields.note),original=publishedShiftFields(w,r),input={personId:r.ownerId,position:r.data.position,start:r.data.start,end:r.data.end,note};
 if(a.canChangeStructure) {
  const person=w.members.find(m=>m.id===fields.personId&&a.editAreas.includes(m.area));
  if(!person||![...(person.qualifications??[]),...(person.scheduleJobs??[])].includes(fields.position))throw Error('Choose an employee and one of their current scheduling jobs.');
  input.personId=person.id;input.position=fields.position;
  for(const key of ['start','end']) {
   const date=fields[key+'Date'],time=fields[key+'Time'],occurrence=fields[key+'Occurrence']??'';
   const resolved=localInstant(date,time,w.location.timezone,occurrence);
   input[key]=date===original[key+'Date']&&time===original[key+'Time']&&occurrence===original[key+'Occurrence']?r.data[key]:resolved;
  }
 }else if(['personId','position','startDate','startTime','endDate','endTime','startOccurrence','endOccurrence'].some(k=>fields[k]!==original[k]))throw Error('Linked work protects this shift. Only the reason can change here.');
 const duration=Date.parse(input.end)-Date.parse(input.start);if(duration<=0||duration>24*3600000)throw Error('Use a positive shift period of at most 24 elapsed hours.');
 if(!Number.isFinite(Date.parse(now)))throw Error('Reload to confirm the current time.');
 if(Date.parse(r.data.end)<=Date.parse(now))throw Error('This shift has ended. Use the separately audited correction workflow.');
 if(Date.parse(r.data.start)<=Date.parse(now)&&(Date.parse(input.start)>Date.parse(r.data.start)||Date.parse(input.end)<Date.parse(now)))throw Error('For an active shift, the start cannot move later and the end cannot move before now.');
 if(a.canChangeStation)input.stationId=fields.stationId||null;
 else if((fields.stationId??'')!==(r.data.stationId??''))throw Error('Linked instructions protect this station assignment.');
 // Omit an unchanged protected station so note-only edits preserve its saved metadata.
 return input;
}
export function publishedShiftCancelInput(w,r,note,confirmed,now=new Date().toISOString()) {
 if(!checkedPublishedShift(w,r).data.publishedActions.canCancel)throw Error('Resolve unfinished tasks and closing transfers before cancelling this shift.');
 if(!Number.isFinite(Date.parse(now))||Date.parse(r.data.end)<=Date.parse(now))throw Error('This shift has ended. Use the separately audited correction workflow.');
 if(confirmed!==true)throw Error('Confirm that the published shift will be cancelled.');
 return {note:reason(note),closeTransfers:[]};
}
