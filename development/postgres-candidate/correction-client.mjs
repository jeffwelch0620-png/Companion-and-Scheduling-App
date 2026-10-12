import {configuredLocation} from './ui-store-configuration.mjs';
import {localDate,localClock,localInstant} from './runtime/closing-reference/local-time.mjs';
export const correctionReviewMessage='This correction needs review. Reload or contact an authorized manager.';
export const correctionRangeMessage='Choose a shorter range; no partial history is shown';
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export function defaultCorrectionRange(w,now=new Date().toISOString()){const to=localDate(now,w.location.timezone),start=new Date(to+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-13);return {from:start.toISOString().slice(0,10),to};}
function checkedRange(range){if(!date(range?.from)||!date(range?.to)||range.from>range.to)throw Error('Choose a valid start and end date.');return {from:range.from,to:range.to};}
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const count=v=>Number.isSafeInteger(v)&&v>=0,positive=v=>count(v)&&v>0,rev=v=>positive(v)&&v<=1000;
const text=v=>typeof v==='string'&&!!v.trim();
const time=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))&&Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60&&Number(v.slice(17,19))<60&&new Date(v.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)===v.slice(0,10);
const same=(a,b)=>JSON.stringify(a,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)===JSON.stringify(b,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=()=>{throw Error(correctionReviewMessage);};
function summary(v){return v&&time(v.start)&&time(v.end)&&Date.parse(v.end)>Date.parse(v.start)&&text(v.position);}
const statuses=['pending','applied','rejected','withdrawn'];
// Explicit 055 audit contract. Additive ledger metadata is not part of chain equality.
// Old events stay byte-for-byte intact; optional 056 source keys must still match captured evidence.
const auditFields=['id','restaurant_id','shift_id','source_revision','member_id','person_id','department','employee_name_at_entry','original_snapshot','timezone','shift_local_date','effective_summary','applied_revision','proposal_summary','proposal_base_revision','author_id','author_person_id','author_name_at_entry','reason','decision_note','status','revision','updated_at'];
function auditProjection(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||auditFields.some(k=>!Object.hasOwn(value,k))||!id(value.person_id)||!id(value.author_person_id)||!text(value.employee_name_at_entry)||!text(value.author_name_at_entry)||!time(value.updated_at))fail();
 if(Object.hasOwn(value,'source_key')){
  const keys=['revision','member_id','department','starts_at','ends_at','position','published','cancelled'];
  if(!value.original_snapshot||!same(value.source_key,Object.fromEntries(keys.map(k=>[k,value.original_snapshot[k]]))))fail();
 }
 return Object.fromEntries(auditFields.map(k=>[k,value[k]]));
}
export function hasCorrectionAccess(w){try{return !!configuredLocation(w.location)&&Array.isArray(w.me.capabilities)&&w.me.capabilities.includes('schedule.correct')&&w.me.scheduleOnly!==true&&w.me.position!==w.location.configuration.dishPosition;}catch{return false;}}
// A navigation/freshness projection only. Server reads and commands enforce person and scope authority.
export function correctionAccessKey(w){const config=configuredLocation(w.location).configuration;return JSON.stringify({actor:w.me.id,scope:w.location.id,area:w.me.area,position:w.me.position,scheduleOnly:w.me.scheduleOnly===true,capabilities:[...(w.me.capabilities??[])].filter(c=>['schedule.correct','location.manage'].includes(c)).sort(),timezone:w.location.timezone,configuration:config},(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
export function correctionReadCurrent(w,data){try{return !!data&&data.actorId===w.me.id&&data.locationId===w.location.id&&data.accessKey===correctionAccessKey(w)&&hasCorrectionAccess(w)&&count(data.correctionRevision)&&count(data.scheduleRevision)&&('from' in data?!!checkedRange(data):data.scheduleRevision>=(w.scheduleRevision??0));}catch{return false;}}
function checkedViewer(w,v){if(!hasCorrectionAccess(v)||v.location.id!==w.location.id||correctionAccessKey(v)!==correctionAccessKey(w)||!count(v.scheduleRevision))throw Error('Correction access changed. Reload current records.');return {...w,me:v.me,location:v.location};}
export function checkedCorrection(w,r){
 const d=r?.data,a=d?.actions,o=d?.original;
 if(!hasCorrectionAccess(w)||!id(r?.id)||r.kind!=='shift-correction'||r.locationId!==w.location.id||!id(r.ownerId)||!w.location.configuration.operatingDepartments.includes(r.area)||!rev(r.revision)||!time(r.updatedAt)||!d||!id(d.shiftId)||!positive(d.sourceRevision)||!positive(d.currentSourceRevision)||!text(d.employeeName)||!text(d.employeeNameAtEntry)||d.historicalNameLabel!=='name at time of entry'||!text(d.timezone)||!/^\d{4}-\d{2}-\d{2}$/.test(d.shiftLocalDate)||!o||o.id!==d.shiftId||o.member_id!==r.ownerId||o.department!==r.area||o.revision!==d.sourceRevision||!summary({start:o.starts_at,end:o.ends_at,position:o.position})||!summary(d.effectiveSummary)||!count(d.appliedRevision)||d.appliedRevision>r.revision||!count(d.proposalBaseRevision)||d.proposalBaseRevision>r.revision||!summary(d.proposal)||!id(d.authorId)||!text(d.authorName)||!text(d.authorNameAtEntry)||!text(d.reason)||typeof d.decisionNote!=='string'||!statuses.includes(d.status)||!a||['canPropose','canApprove','canReject','canWithdraw'].some(k=>typeof a[k]!=='boolean')||!d.warnings||['sourceChanged','hasOriginalTasks','hasOriginalClosings'].some(k=>typeof d.warnings[k]!=='boolean'))fail();
 try{if(localDate(o.starts_at,d.timezone)!==d.shiftLocalDate||localDate(d.effectiveSummary.start,d.timezone)!==d.effectiveLocalDate)fail();}catch{fail();}
 if(!Array.isArray(d.positionOptions)||d.positionOptions.some(v=>!text(v))||new Set(d.positionOptions).size!==d.positionOptions.length||!d.positionOptions.includes(o.position))fail();
 if(d.status==='pending'?a.canPropose:d.status!=='pending'&&(a.canApprove||a.canReject||a.canWithdraw))fail();
 if(r.revision===1000&&Object.values(a).some(Boolean)||d.warnings.sourceChanged&&(a.canPropose||a.canApprove)||d.status==='applied'&&(d.appliedRevision!==r.revision||!same(d.proposal,d.effectiveSummary)))fail();
 return structuredClone(r);
}
export function checkedCompletedShift(w,s){
 if(!hasCorrectionAccess(w)||!id(s?.shiftId)||!positive(s.sourceRevision)||!positive(s.currentSourceRevision)||!id(s.ownerId)||!w.location.configuration.operatingDepartments.includes(s.area)||!text(s.employeeName)||!summary(s.originalSummary)||!summary(s.effectiveSummary)||!text(s.timezone)||!count(s.recordRevision)||s.recordRevision>1000||typeof s.canPropose!=='boolean'||!count(s.correctionRevision))fail();
 try{localDate(s.originalSummary.start,s.timezone);if(localDate(s.effectiveSummary.start,s.timezone)!==s.effectiveLocalDate)fail();}catch{fail();}
 if(!Array.isArray(s.positionOptions)||s.positionOptions.some(v=>!text(v))||new Set(s.positionOptions).size!==s.positionOptions.length||!s.positionOptions.includes(s.originalSummary.position))fail();
 if(s.correction===null){if(s.recordRevision!==0||!same(s.originalSummary,s.effectiveSummary))fail();}
 else {const r=checkedCorrection(w,s.correction);if(r.data.shiftId!==s.shiftId||r.revision!==s.recordRevision||r.ownerId!==s.ownerId||r.area!==s.area||r.data.sourceRevision!==s.sourceRevision||r.data.currentSourceRevision!==s.currentSourceRevision||r.data.timezone!==s.timezone||r.data.effectiveLocalDate!==s.effectiveLocalDate||!same(r.data.effectiveSummary,s.effectiveSummary)||!same({start:r.data.original.starts_at,end:r.data.original.ends_at,position:r.data.original.position},s.originalSummary))fail();}
 return structuredClone(s);
}
async function get(call,path){let r;try{r=await call(path);}catch{throw Error('Corrections could not be loaded. Keep this page open if a submission is uncertain.');}if(r?.status!==200)throw Object.assign(Error(r?.status===401?'Sign in again, then reload corrections.':r?.status===403?'Your current access does not allow corrections.':'Corrections could not be loaded. No partial history is shown.'),{status:r?.status});return r.body;}
const stamp=(w,n)=>({actorId:w.me.id,locationId:w.location.id,accessKey:correctionAccessKey(w),correctionRevision:n});
export async function loadCorrectionBoard(call,w,range=defaultCorrectionRange(w)){
 if(!hasCorrectionAccess(w))fail();
 const {from,to}=checkedRange(range),rangeQuery='&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to);
 for(let attempt=0;attempt<3;attempt++){
  const viewer=await get(call,'/schedule-viewer'),current=checkedViewer(w,viewer),sources=[],records=[];let correctionRevision=null,asOf=null,changed=false,invalid=0;
  for(const resource of ['completed-shifts','shift-corrections']){
   let after=null,pages=0;const seen=new Set(),cursors=new Set();
   do{
    const p=await get(call,'/'+resource+'?limit=100'+rangeQuery+(after?'&after='+after:'')+(resource==='completed-shifts'&&asOf?'&asOf='+encodeURIComponent(asOf):''));pages++;
    if(!p||!Array.isArray(p.items)||p.items.length>100||!count(p.correctionRevision)||typeof p.rangeComplete!=='boolean'||p.rangeComplete!==(p.nextCursor===null)||p.nextCursor!==null&&!id(p.nextCursor))fail();
    if(p.from!==from||p.to!==to)fail();
    correctionRevision??=p.correctionRevision;if(p.correctionRevision!==correctionRevision){changed=true;break;}
    if(resource==='completed-shifts'){if(!time(p.asOf)||!count(p.scheduleRevision))fail();asOf??=p.asOf;if(p.asOf!==asOf){changed=true;break;}}
    let last=after;
    for(const raw of p.items){const key=resource==='completed-shifts'?raw?.shiftId:raw?.id;if(!id(key)||seen.has(key)||last&&key<=last)fail();seen.add(key);last=key;try{if(resource==='completed-shifts'){const s=checkedCompletedShift(current,{...raw,correctionRevision:p.correctionRevision});if(s.correctionRevision!==correctionRevision||Date.parse(s.originalSummary.end)>Date.parse(asOf))fail();sources.push(s);}else records.push(checkedCorrection(current,raw));}catch{invalid++;}}
    if(p.nextCursor&&(p.nextCursor!==last||cursors.has(p.nextCursor)))fail();
    if(p.nextCursor&&pages>=100)throw Error(correctionRangeMessage);after=p.nextCursor;if(after)cursors.add(after);
   }while(after);
   if(changed)break;
  }
  const fence=await get(call,'/completed-shifts?limit=1'+rangeQuery+(asOf?'&asOf='+encodeURIComponent(asOf):'')),final=await get(call,'/schedule-viewer');checkedViewer(w,final);
  if(!count(fence.correctionRevision)||!time(fence.asOf)||fence.from!==from||fence.to!==to)fail();
  if(changed||fence.correctionRevision!==correctionRevision||fence.asOf!==asOf)continue;
  return {sources,records,invalid,complete:invalid===0,asOf,from,to,scheduleRevision:final.scheduleRevision,...stamp(w,correctionRevision)};
 }
 throw Error('Correction records changed while loading. Reload to review them.');
}
export async function loadCorrectionDetail(call,w,key,{source=false}={}){
 if(!id(key)||!hasCorrectionAccess(w))fail();
 for(let attempt=0;attempt<3;attempt++){
  const viewer=await get(call,'/schedule-viewer'),current=checkedViewer(w,viewer);
  const review=source?checkedCompletedShift(current,await get(call,'/completed-shifts/'+key)):null;
  let record=review?.correction??(source?null:checkedCorrection(current,await get(call,'/shift-corrections/'+key))),events=[],changed=false,n=review?.correctionRevision??null;
  if(review?.shiftId!==key&&source||!source&&record.id!==key)fail();
  if(record){
   let after=0;
   do{
    const p=await get(call,'/shift-correction-history/'+record.id+'?limit=100&after='+after);
    if(!p||!count(p.correctionRevision)||!rev(p.recordRevision))fail();n??=p.correctionRevision;if(p.correctionRevision!==n||p.recordRevision!==record.revision){changed=true;break;}
    if(!Array.isArray(p.items)||p.items.length>100||typeof p.historyComplete!=='boolean'||p.historyComplete!==(p.nextCursor===null)||p.nextCursor!==null&&!rev(p.nextCursor))fail();
    for(const e of p.items){const a=e?.after;
     auditProjection(a);
     if(e?.revision!==events.length+1||e.revision>record.revision||!['correction.propose','correction.approve','correction.reject','correction.withdraw'].includes(e.action)||!id(e.actorId)||!text(e.actorName)||!text(e.actorNameAtEntry)||e.historicalNameLabel!=='name at time of entry'||!time(e.at)||!text(e.note)||!a||a.id!==record.id||a.restaurant_id!==w.location.id||a.member_id!==record.ownerId||a.department!==record.area||a.shift_id!==record.data.shiftId||a.source_revision!==record.data.sourceRevision||a.revision!==e.revision||a.timezone!==record.data.timezone||a.shift_local_date!==record.data.shiftLocalDate||!same(a.original_snapshot,record.data.original)||!summary(a.effective_summary)||!summary(a.proposal_summary)||!statuses.includes(a.status)||!count(a.applied_revision)||a.applied_revision>e.revision||!count(a.proposal_base_revision)||a.proposal_base_revision>e.revision||!id(a.author_id)||!text(a.reason)||typeof a.decision_note!=='string'||e.revision===1&&(e.before!==null||e.action!=='correction.propose')||e.revision>1&&!same(auditProjection(e.before),auditProjection(events.at(-1)?.after)))fail();
     if(e.action==='correction.propose'?!['pending','applied'].includes(a.status):a.status!=={'correction.approve':'applied','correction.reject':'rejected','correction.withdraw':'withdrawn'}[e.action])fail();
     if(a.status==='applied'?(a.applied_revision!==e.revision||!same(a.proposal_summary,a.effective_summary)):(a.applied_revision>=e.revision||e.before&&(!same(a.effective_summary,e.before.effective_summary)||a.applied_revision!==e.before.applied_revision)))fail();
     events.push(e);
    }
    if(p.nextCursor&&(p.nextCursor!==events.at(-1)?.revision||p.nextCursor<=after))fail();after=p.nextCursor;
   }while(after);
   if(!changed){const a=events.at(-1)?.after,d=record.data;if(events.length!==record.revision||!a||a.status!==d.status||a.reason!==d.reason||a.decision_note!==d.decisionNote||a.author_id!==d.authorId||a.applied_revision!==d.appliedRevision||a.proposal_base_revision!==d.proposalBaseRevision||!same(a.effective_summary,d.effectiveSummary)||!same(a.proposal_summary,d.proposal))fail();}
  }
  const latest=source?checkedCompletedShift(current,await get(call,'/completed-shifts/'+key)):checkedCorrection(current,await get(call,'/shift-corrections/'+key));
  const final=await get(call,'/schedule-viewer');checkedViewer(w,final);
  if(changed||viewer.scheduleRevision!==final.scheduleRevision||!same(latest,source?review:record))continue;
  return {source:review,record,events,complete:true,scheduleRevision:viewer.scheduleRevision,...stamp(w,n)};
 }
 throw Error('Correction history changed while loading. Reload before acting.');
}
function initial(summary,zone){const f={position:summary.position};for(const k of ['start','end']){f[k+'Date']=localDate(summary[k],zone);f[k+'Time']=localClock(summary[k],zone);const early=localInstant(f[k+'Date'],f[k+'Time'],zone,'earlier'),late=localInstant(f[k+'Date'],f[k+'Time'],zone,'later');f[k+'Occurrence']=early===late?'':Date.parse(summary[k])>=Date.parse(late)?'later':'earlier';}return f;}
export function correctionFields(s){return initial(s.effectiveSummary,s.timezone);}
function reason(v){if(!text(v)||v.trim().length>2000)throw Error('Give a reason in 2,000 characters or fewer.');return v.trim();}
// Zero-only precision beyond milliseconds may be removed without changing an instant.
function supportedInstant(v){const match=v.match(/\.(\d+)(Z|[+-]\d{2}:\d{2})$/);if(match&&match[1].length>3){if(/[1-9]/.test(match[1].slice(3)))throw Error('This source uses sub-millisecond precision. Contact an authorized manager for reconciliation before correcting it.');return v.replace(/\.(\d+)(Z|[+-]\d{2}:\d{2})$/,(_,digits,offset)=>'.'+digits.slice(0,3)+offset);}return v;}
export function correctionInput(w,s,fields,now=new Date().toISOString()){
 const review=checkedCompletedShift(w,s);if(!review.canPropose||review.correction&&!review.correction.data.actions.canPropose)fail();const base=correctionFields(review),period={};
 for(const k of ['start','end'])period[k]=['Date','Time','Occurrence'].every(suffix=>fields[k+suffix]===base[k+suffix])?supportedInstant(review.effectiveSummary[k]):localInstant(fields[k+'Date'],fields[k+'Time'],review.timezone,fields[k+'Occurrence']);
 if(!text(fields.position)||fields.position.trim().length>100||Date.parse(period.end)>Date.parse(now)||Date.parse(period.end)<=Date.parse(period.start)||Date.parse(period.end)-Date.parse(period.start)>86400000)throw Error('Check the ended shift period (up to 24 hours) and position.');
 if(Date.parse(period.start)===Date.parse(review.effectiveSummary.start)&&Date.parse(period.end)===Date.parse(review.effectiveSummary.end)&&fields.position.trim()===review.effectiveSummary.position)throw Error('Change at least one planned detail before submitting a correction.');
 return {shiftId:review.shiftId,shiftRevision:review.currentSourceRevision,expectedCorrectionRevision:review.recordRevision,...period,position:fields.position.trim(),reason:reason(fields.reason)};
}
export function correctionDecision(w,r,action,note){const flags=checkedCorrection(w,r).data.actions,key={'correction.approve':'canApprove','correction.reject':'canReject','correction.withdraw':'canWithdraw'}[action];if(!key||flags[key]!==true)fail();return {note:reason(note)};}
