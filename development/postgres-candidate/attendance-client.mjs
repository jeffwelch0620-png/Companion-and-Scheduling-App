import {configuredLocation} from './ui-store-configuration.mjs';
import {localDate,localClock,localInstant} from './runtime/closing-reference/local-time.mjs';
export const attendanceReviewMessage='This attendance entry needs review. Reload or contact a manager.';
export const attendanceTypes={'call-in':'Called in','no-show':'No-show',late:'Late arrival','left-early':'Left early',other:'Other attendance note'};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const rev=v=>Number.isSafeInteger(v)&&v>0&&v<=1000;
const time=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))&&Number(v.slice(11,13))<24&&Number.isFinite(Date.parse(v.slice(0,10)+'T12:00:00Z'))&&new Date(v.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)===v.slice(0,10);
const text=v=>typeof v==='string'&&!!v.trim();
const same=(a,b)=>JSON.stringify(a,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)===JSON.stringify(b,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=()=>{throw Error(attendanceReviewMessage);};
function facts(v){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='contact,coverage,emergency'&&['unknown','phone','message','none'].includes(v.contact)&&['unknown','confirmed','uncovered'].includes(v.coverage)&&['unknown','reported','not-reported'].includes(v.emergency);}
export function attendanceAreas(w){
 const config=configuredLocation(w.location).configuration,areas=w.attendanceAreas??[];
 if(!Array.isArray(areas)||areas.some(a=>!config.operatingDepartments.includes(a))||new Set(areas).size!==areas.length)fail();
 return areas;
}
export function canRecordAttendance(w,r){
 try{return attendanceAreas(w).includes(r?.area)&&r?.kind==='shift'&&r.locationId===w.location.id&&uuid(r.id)&&uuid(r.ownerId)&&Number.isSafeInteger(r.revision)&&r.revision>0&&r.data?.published===true&&r.data.cancelled===false&&r.data.attendanceActions?.canRecord===true&&time(r.data.start)&&time(r.data.end)&&Date.parse(r.data.end)>Date.parse(r.data.start);}catch{return false;}
}
export function checkedAttendance(w,r){
 const d=r?.data,a=d?.actions;
 if(!attendanceAreas(w).includes(r?.area)||r?.kind!=='attendance'||r.locationId!==w.location.id||!uuid(r.id)||!uuid(r.ownerId)||!rev(r.revision)||!time(r.updatedAt)||!d||!uuid(d.shiftId)||!Number.isSafeInteger(d.shiftRevision)||d.shiftRevision<1||!text(d.employeeName)||!text(d.employeeNameAtEntry)||d.historicalNameLabel!=='name at time of entry'||typeof d.type!=='string'||!Object.hasOwn(attendanceTypes,d.type)||!['recorded','voided'].includes(d.status)||!time(d.reportedAt)||!text(d.note)||!facts(d.facts)||!time(d.shift?.start)||!time(d.shift?.end)||Date.parse(d.shift.end)<=Date.parse(d.shift.start)||!text(d.shift.position)||!text(d.shift.timezone)||!a||['canCorrect','canVoid','canReview','canReopen'].some(k=>typeof a[k]!=='boolean'))fail();
 try{localDate(d.shift.start,d.shift.timezone);}catch{fail();}
 if(d.review!==null&&(!d.review||!uuid(d.review.actorId)||!uuid(d.review.actorPersonId)||!text(d.review.actorName)||!text(d.review.actorNameAtEntry)||!time(d.review.at)||!text(d.review.note)))fail();
 if((d.status==='voided'||r.revision===1000)&&Object.values(a).some(Boolean)||a.canReview&&d.review!==null||a.canReopen&&d.review===null)fail();
 return structuredClone(r);
}
function checkedViewer(w,v){
 if(!v||v.me?.id!==w.me.id||!same(v.me,w.me)||!same(v.attendanceAreas,w.attendanceAreas)||v.location?.id!==w.location.id||!Number.isSafeInteger(v.workspaceRevision)||v.workspaceRevision<w.location.revision||v.location.revision!==v.workspaceRevision||JSON.stringify(v.location.configuration)!==JSON.stringify(w.location.configuration)||v.location.timezone!==w.location.timezone)throw Error('Attendance access changed. Reload current records.');
 const current={...w,location:v.location,attendanceAreas:v.attendanceAreas};if(!attendanceAreas(current).length)throw Error('Your current access does not allow attendance.');return current;
}
async function get(call,path){let response;try{response=await call(path);}catch{throw Error('Attendance could not be loaded. No partial totals or history are shown.');}if(response?.status!==200)throw Object.assign(Error(response?.status===401?'Sign in again, then reload attendance.':response?.status===403?'Your current access does not allow attendance.':'Attendance could not be loaded. No partial totals or history are shown.'),{status:response?.status});return response.body;}
export async function loadAttendanceRange(call,w,from,to){
 if(!attendanceAreas(w).length)throw Error('Your current access does not allow attendance.');
 if(![from,to].every(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d)||from>to)throw Error('Choose a valid attendance date range.');
 for(let attempt=0;attempt<3;attempt++){
  const viewer=await get(call,'/schedule-viewer'),current=checkedViewer(w,viewer),records=[],ids=new Set(),cursors=new Set();let after=null,changed=false,invalid=0;
  do{
   const page=await get(call,'/attendance?limit=100&from='+from+'&to='+to+(after?'&after='+after:''));
   if(!page||typeof page!=='object'||Array.isArray(page))fail();
   if(page.workspaceRevision!==viewer.workspaceRevision){changed=true;break;}
   if(!Array.isArray(page.items)||page.items.length>100||page.from!==from||page.to!==to||typeof page.rangeComplete!=='boolean'||page.nextCursor!==null&&!uuid(page.nextCursor)||page.rangeComplete!==(page.nextCursor===null))fail();
   for(const raw of page.items){if(!uuid(raw?.id)||ids.has(raw.id)||after&&raw.id<=after)fail();ids.add(raw.id);try{const r=checkedAttendance(current,raw),day=localDate(r.data.shift.start,r.data.shift.timezone);if(day<from||day>to)fail();records.push(r);}catch{invalid++;}}
   const last=page.items.at(-1)?.id;
   if(page.nextCursor&&(page.nextCursor!==last||cursors.has(page.nextCursor)||after&&page.nextCursor<=after))fail();
   if(cursors.size>=100)throw Error('This date range has too many entries to review together. Choose a shorter range; no partial totals are shown.');
   after=page.nextCursor;if(after)cursors.add(after);
  }while(after);
  const final=await get(call,'/schedule-viewer');checkedViewer(w,final);
  if(changed||JSON.stringify(viewer)!==JSON.stringify(final))continue;
  return {records,invalid,complete:invalid===0,from,to,workspaceRevision:viewer.workspaceRevision,actorId:w.me.id,locationId:w.location.id};
 }
 throw Error('Attendance changed while loading. Reload before reviewing totals.');
}
export async function loadAttendanceDetail(call,w,id){
 if(!uuid(id)||!attendanceAreas(w).length)fail();
 for(let attempt=0;attempt<3;attempt++){
  const viewer=await get(call,'/schedule-viewer'),current=checkedViewer(w,viewer),record=checkedAttendance(current,await get(call,'/attendance/'+id));
  if(record.id!==id)fail();const events=[];let after=0,changed=false;
  do{
   const page=await get(call,'/attendance-history/'+id+'?limit=100&after='+after);
   if(!page||typeof page!=='object'||Array.isArray(page))fail();
   if(page.attendanceRevision!==record.revision){changed=true;break;}
   if(!Array.isArray(page.items)||page.items.length>100||typeof page.historyComplete!=='boolean'||page.historyComplete!==(page.nextCursor===null)||page.nextCursor!==null&&!rev(page.nextCursor))fail();
   for(const e of page.items){
    const a=e?.after,b=e?.before;
    if(!rev(e?.revision)||e.revision!==events.length+1||e.revision>record.revision||!['attendance.record','attendance.correct','attendance.void','attendance.review','attendance.reopen'].includes(e.action)||!uuid(e.actorId)||!text(e.actorName)||!text(e.actorNameAtEntry)||e.historicalNameLabel!=='name at time of entry'||!time(e.at)||typeof e.changeReason!=='string'||!a||a.id!==id||a.restaurant_id!==w.location.id||a.member_id!==record.ownerId||a.department!==record.area||a.revision!==e.revision||a.shift_id!==record.data.shiftId||a.shift_revision!==record.data.shiftRevision||typeof a.attendance_type!=='string'||!Object.hasOwn(attendanceTypes,a.attendance_type)||!time(a.reported_at)||!text(a.note)||!facts(a.facts)||!['recorded','voided'].includes(a.status)||!same(a.shift_snapshot,record.data.shift)||e.revision===1&&(b!==null||e.action!=='attendance.record')||e.revision>1&&!same(b,events.at(-1)?.after))fail();
    events.push(e);
   }
   if(page.nextCursor&&(page.nextCursor!==events.at(-1)?.revision||page.nextCursor<=after))fail();after=page.nextCursor;
  }while(after);
  const latest=checkedAttendance(current,await get(call,'/attendance/'+id)),final=await get(call,'/schedule-viewer');checkedViewer(w,final);
  if(changed||JSON.stringify(viewer)!==JSON.stringify(final)||JSON.stringify(record)!==JSON.stringify(latest))continue;
  const last=events.at(-1)?.after;
  if(events.length!==record.revision||last.attendance_type!==record.data.type||last.status!==record.data.status||Date.parse(last.reported_at)!==Date.parse(record.data.reportedAt)||last.note!==record.data.note||!same(last.facts,record.data.facts))fail();return {record,events,complete:true,workspaceRevision:viewer.workspaceRevision,actorId:w.me.id,locationId:w.location.id};
 }
 throw Error('Attendance history changed while loading. Reload to review it.');
}
export function attendancePatterns(result){
 if(!result?.complete||result.invalid)throw Error('Complete valid attendance is required before displaying totals.');
 const groups=new Map();for(const r of result.records){if(r.data.status!=='recorded')continue;const row=groups.get(r.ownerId)??{employeeId:r.ownerId,name:r.data.employeeName,entries:0,pending:0,shifts:new Set(),types:{}};row.entries++;row.shifts.add(r.data.shiftId);if(!r.data.review)row.pending++;row.types[r.data.type]=(row.types[r.data.type]??0)+1;groups.set(r.ownerId,row);}
 return [...groups.values()].map(r=>({...r,shifts:r.shifts.size})).sort((a,b)=>a.name.localeCompare(b.name)||a.employeeId.localeCompare(b.employeeId));
}
export function attendanceFields(w,r,now=new Date().toISOString()){
 if(r)checkedAttendance(w,r);const instant=r?.data.reportedAt??now,zone=r?.data.shift.timezone??w.location.timezone,date=localDate(instant,zone),clock=localClock(instant,zone),early=localInstant(date,clock,zone,'earlier'),late=localInstant(date,clock,zone,'later');
 return {date,time:clock,repeated:early===late?'':Date.parse(instant)>=Date.parse(late)?'later':'earlier'};
}
function reason(v){if(typeof v!=='string'||!v.trim()||v.trim().length>2000)throw Error('Explain the attendance entry or change in 2,000 characters or fewer.');return v.trim();}
export function attendanceInput(w,fields,r,shift,now=new Date().toISOString()){
 if(r&&!checkedAttendance(w,r).data.actions.canCorrect||!r&&!canRecordAttendance(w,shift))throw Error('Reload an authorized attendance entry or published shift.');
 const zone=r?.data.shift.timezone??w.location.timezone,initial=r?attendanceFields(w,r):null;
 const reportedAt=initial&&['date','time','repeated'].every(k=>fields[k]===initial[k])?r.data.reportedAt:localInstant(fields.date,fields.time,zone,fields.repeated);
 if(typeof fields.type!=='string'||!Object.hasOwn(attendanceTypes,fields.type)||!facts(fields.facts)||Date.parse(reportedAt)>Date.parse(now)+60000||fields.type==='no-show'&&Date.parse(reportedAt)<Date.parse(r?.data.shift.start??shift.data.start))throw Error('Check the attendance type, reported time and known facts.');
 return {type:fields.type,reportedAt,note:reason(fields.note),facts:structuredClone(fields.facts),...(r?{changeReason:reason(fields.changeReason)}:{shiftId:shift.id,shiftRevision:shift.revision})};
}
export function attendanceDecision(w,r,action,note){
 const flags=checkedAttendance(w,r).data.actions,key={'attendance.review':'canReview','attendance.reopen':'canReopen','attendance.void':'canVoid'}[action];
 if(!key||flags[key]!==true)throw Error('Reload the attendance entry before changing it.');return action==='attendance.void'?{changeReason:reason(note)}:{note:reason(note)};
}
