import {has,manages,type Member,type RecordOf,type Workspace,type History} from './types';
import type {CommandContext} from './followthrough';
import {requireThat,text} from './validation';

export const shiftExperiences=['good','okay','rough'] as const;
export type ShiftExperience=typeof shiftExperiences[number];
export type ShiftCheckin={title:string;employeeName:string;shiftId:string;shiftRevision:number;shift:{start:string;end:string;position:string};experience:ShiftExperience;note:string;submittedAt:string;history:History;versions:{at:string;experience:ShiftExperience;note:string;reason:string}[]};
export function checkinReviewer(m:Member,area=m.area){return !m.scheduleOnly&&m.position!=='Dishwasher'&&(has(m,'location.manage')||manages(m,area,'people.approve'));}
export function checkinReader(r:RecordOf<'shiftcheckin'>,m:Member){return !m.scheduleOnly&&r.locationId===m.locationId&&(r.ownerId===m.id||checkinReviewer(m,r.area));}
export function latestCheckins(records:RecordOf<'shiftcheckin'>[]){
 const distinct=new Set<string>();
 return [...records].sort((a,b)=>Date.parse(b.data.shift.end)-Date.parse(a.data.shift.end)||b.id.localeCompare(a.id)).filter(r=>{if(distinct.has(r.data.shiftId))return false;distinct.add(r.data.shiftId);return true;}).slice(0,5);
}
// Keep five per employee AND department. A reviewer of one department must
// retain their full sample even when an owner can see several departments.
export function retainedCheckinIds(w:Workspace){
 const groups=new Map<string,RecordOf<'shiftcheckin'>[]>();
 for(const r of w.records)if(r.kind==='shiftcheckin'&&r.locationId===w.location.id){const key=JSON.stringify([r.ownerId,r.area]);groups.set(key,[...(groups.get(key)??[]),r]);}
 return new Set([...groups.values()].flatMap(rows=>latestCheckins(rows).map(r=>r.id)));
}
export function checkinPatterns(w:Workspace){
 const records=w.records.filter((r):r is RecordOf<'shiftcheckin'>=>r.kind==='shiftcheckin'&&r.locationId===w.location.id&&checkinReviewer(w.me,r.area));
 const groups=new Map<string,RecordOf<'shiftcheckin'>[]>();
 for(const r of records)groups.set(r.ownerId,[...(groups.get(r.ownerId)??[]),r]);
 return [...groups.entries()].map(([personId,all])=>{
  const latest=latestCheckins(all);
  const rough=latest.filter(r=>r.data.experience==='rough').length;
  return {personId,name:w.members.find(m=>m.id===personId)?.name??latest[0].data.employeeName,latest,rough,count:latest.length,flagged:latest.length===5&&rough>=3};
 }).sort((a,b)=>Number(b.flagged)-Number(a.flagged)||a.name.localeCompare(b.name));
}
export function applyShiftCheckin(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history}=c;
 requireThat(!me.scheduleOnly&&me.position!=='Dishwasher','Shift check-in is not available for this account.',403);
 requireThat(command.action==='shiftcheckin.submit'||command.action==='shiftcheckin.correct','Unknown shift check-in action.');
 requireThat(shiftExperiences.includes(input.experience as ShiftExperience),'Choose good, okay or rough.');
 const experience=input.experience as ShiftExperience,note=text(input.note??'','Shift note',2000,true);
 if(command.action==='shiftcheckin.submit'){
  requireThat(!command.recordId,'Use Correct my check-in for an existing entry.');
  const shift=w.records.find((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.id===input.shiftId&&r.locationId===w.location.id);
  requireThat(shift,'Scheduled shift not found.',404);
  requireThat(shift.ownerId===me.id,'Only the employee can submit their own shift check-in.',403);
  requireThat(shift.data.published&&!shift.data.cancelled,'Choose a published shift that has not been cancelled.');
  requireThat(Number.isInteger(input.shiftRevision)&&shift.revision===input.shiftRevision,'The shift changed. Refresh before submitting.',409);
  requireThat(Date.parse(shift.data.end)<=Date.parse(at),'Check in after the scheduled shift has ended.');
  requireThat(!w.records.some(r=>r.kind==='shiftcheckin'&&r.data.shiftId===shift.id),'This shift already has a check-in. Correct your existing entry instead.',409);
  requireThat(input.shareConfirmed===true,'Confirm that your response and optional note will be shared with authorized restaurant owners and GM reviewers.');
  create({kind:'shiftcheckin',data:{title:'Shift check-in',employeeName:me.name,shiftId:shift.id,shiftRevision:shift.revision,shift:{start:shift.data.start,end:shift.data.end,position:shift.data.position},experience,note,submittedAt:at,versions:[],history:[history('submitted','Employee submitted a shift check-in for owner / GM review.')]}}, {...me,area:shift.area});return;
 }
 const r=find('shiftcheckin');requireThat(r.ownerId===me.id,'Only the employee can correct their check-in.',403);
 requireThat(r.data.history.length<100,'This entry has reached its correction limit. Ask an owner to review its history.');
 const reason=text(input.reason,'Correction reason',2000);
 save({...r,data:{...r.data,experience,note,versions:[...r.data.versions,{at,experience:r.data.experience,note:r.data.note,reason}],history:[...r.data.history,history('corrected',reason)]}});
}
