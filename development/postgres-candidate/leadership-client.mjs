import {configuredLocation} from './ui-store-configuration.mjs';
import {localDate,localClock,localInstant} from './runtime/closing-reference/local-time.mjs';
export const leadershipReviewMessage='This leadership assignment needs review. Reload or contact a publisher.';
export function leadershipOptions(w) {
 configuredLocation(w.location);
 const options=w.leadershipOptions===undefined?[]:w.leadershipOptions;
 if(!Array.isArray(options)||options.some(o=>!o||!w.location.configuration.operatingDepartments.includes(o.area)||!Array.isArray(o.leaders)||o.leaders.some(m=>!m||typeof m.id!=='string'||!m.id||typeof m.name!=='string'||!m.name)||new Set(o.leaders.map(m=>m.id)).size!==o.leaders.length)||new Set(options.map(o=>o.area)).size!==options.length)throw Error('Leadership choices need review. Reload current records.');
 return options;
}
export function checkedLeadership(w,r) {
 if(!r||r.kind!=='leadership'||r.locationId!==w.location.id||typeof r.id!=='string'||!r.id||!Number.isSafeInteger(r.revision)||r.revision<1||typeof r.ownerId!=='string'||!r.ownerId||!w.location.configuration.operatingDepartments.includes(r.area)||r.data?.area!==r.area||r.data?.personId!==r.ownerId||typeof r.data?.active!=='boolean'||typeof r.data?.note!=='string'||typeof r.data?.actions?.canEdit!=='boolean'||typeof r.data?.actions?.canRevoke!=='boolean'||![r.data.start,r.data.end].every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t)))||Date.parse(r.data.end)<=Date.parse(r.data.start))throw Error(leadershipReviewMessage);
 return r;
}
export function leadershipFields(w,r) {
 const zone=w.location.timezone,fields={};
 for(const key of ['start','end']) {
  const instant=checkedLeadership(w,r).data[key],date=localDate(instant,zone),time=localClock(instant,zone);
  fields[key+'Date']=date;fields[key+'Time']=time;
  fields[key+'Occurrence']=Date.parse(localInstant(date,time,zone,'later'))>Date.parse(localInstant(date,time,zone,'earlier'))&&Date.parse(instant)>=Date.parse(localInstant(date,time,zone,'later'))?'later':'earlier';
 }
 return fields;
}
export function leadershipInput(w,fields,r) {
 const options=leadershipOptions(w);if(r&&!checkedLeadership(w,r).data.actions.canEdit)throw Error('A current schedule publisher must edit this assignment.');
 if(!options.some(o=>o.area===fields.area&&o.leaders.some(m=>m.id===fields.personId)))throw Error('Choose a currently eligible leader and authorized department.');
 const note=typeof fields.note==='string'?fields.note.trim():'';if(!note||note.length>2000)throw Error('Describe the responsibility or reason.');
 const old=r?leadershipFields(w,r):null,period={};
 for(const key of ['start','end']) {
  const date=fields[key+'Date'],time=fields[key+'Time'],occurrence=fields[key+'Occurrence']??'';
  const resolved=localInstant(date,time,w.location.timezone,occurrence);
  // Preserve the original seconds/milliseconds when an imported boundary is unchanged.
  period[key]=old&&date===old[key+'Date']&&time===old[key+'Time']&&occurrence===old[key+'Occurrence']?r.data[key]:resolved;
 }
 const duration=Date.parse(period.end)-Date.parse(period.start);if(duration<=0||duration>24*3600000)throw Error('Leadership must cover a positive period of at most 24 elapsed hours.');
 return {personId:fields.personId,area:fields.area,...period,note};
}
export function leadershipRevokeInput(w,r,note,confirmed) {
 if(!checkedLeadership(w,r).data.actions.canRevoke||!r.data.active)throw Error('This assignment cannot be revoked with your current access.');
 if(confirmed!==true)throw Error('Confirm the effect of revoking this dated responsibility.');
 if(typeof note!=='string'||!note.trim()||note.trim().length>2000)throw Error('Explain why this responsibility is ending.');
 return {note:note.trim()};
}
