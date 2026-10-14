import {configuredLocation,isCheckoutPosition} from './ui-store-configuration.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=1&&v<=2147483646;
const counter=v=>Number.isSafeInteger(v)&&v>=0;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fields=(v,allowed,required=allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k));
const invalid=()=>Error('This group is incomplete or changed. Reload current drafts and review again.');
export const groupLimit=100;
export const groupRecoveryMessage='A previous copy or batch save may have completed. Check current drafts and copied staffing before reviewing or submitting again.';
export function localDay(value,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
export function nextDay(value,days=7){if(!validDay(value))throw invalid();return new Date(Date.parse(value+'T12:00Z')+days*86400000).toISOString().slice(0,10);}
function validDay(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000')&&Number.isFinite(Date.parse(v+'T12:00Z'))&&new Date(v+'T12:00Z').toISOString().slice(0,10)===v;}
export function localStamp(value,zone){
 if(!instant(value))throw invalid();
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
 const fraction=/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1]??'';
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${fraction.slice(0,6).padEnd(6,'0')}`;
}
function local(v){const m=typeof v==='string'&&/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/.exec(v);if(!m||!validDay(m[1]))throw invalid();return `${m[1]}T${m[2]}:${m[3]}:${m[4]??'00'}.${(m[5]??'').padEnd(6,'0')}`;}
const occurrence=v=>{if(!['','earlier','later'].includes(v??''))throw invalid();return v??'';};
export const isGroupAction=action=>['shift.copy-week','shift.save-batch'].includes(action);
export function groupSelection(action,input){
 if(!isGroupAction(action)||!object(input))throw invalid();
 const copy=action==='shift.copy-week',allowed=copy?['sourceWeek','targetWeek','shifts','staffing']:['weekStart','drafts'];
 if(!fields(input,[...allowed,'reviewToken','note','confirmed'],allowed))throw invalid();
 const selection=Object.fromEntries(allowed.map(k=>[k,input[k]]));
 if(copy){if(!validDay(selection.sourceWeek)||!validDay(selection.targetWeek))throw invalid();const days=(Date.parse(selection.targetWeek)-Date.parse(selection.sourceWeek))/86400000;if(days<7||days>364||days%7)throw Error('Choose a later week on the same weekday, within 52 weeks.');}
 else if(!validDay(selection.weekStart))throw invalid();
 const families=copy?['shifts','staffing']:['drafts'];
 for(const family of families){const values=selection[family];if(!Array.isArray(values)||values.length>groupLimit||family!=='staffing'&&!values.length)throw Error('Choose 1–100 shifts and at most 100 independent staffing needs.');
  selection[family]=values.map(row=>{
   if(!fields(row,copy?['id','revision','startOccurrence','endOccurrence']:['id','revision','input'],copy?['id','revision']:['id','revision','input'])||!uuid(row.id)||!revision(row.revision))throw invalid();
   if(copy)return {id:row.id.toLowerCase(),revision:row.revision,startOccurrence:occurrence(row.startOccurrence),endOccurrence:occurrence(row.endOccurrence)};
   const f=row.input;if(!fields(f,['personId','position','startLocal','endLocal','startOccurrence','endOccurrence'],['personId','position','startLocal','endLocal'])||!uuid(f.personId)||typeof f.position!=='string'||!f.position.trim()||f.position.trim().length>100)throw invalid();
   return {id:row.id.toLowerCase(),revision:row.revision,input:{personId:f.personId.toLowerCase(),position:f.position.trim(),startLocal:local(f.startLocal),endLocal:local(f.endLocal),startOccurrence:occurrence(f.startOccurrence),endOccurrence:occurrence(f.endOccurrence)}};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(selection[family].map(r=>r.id)).size!==values.length)throw invalid();
 }
 return selection;
}
export function hasGroupAccess(w){configuredLocation(w.location);const m=w.me;return m.locationId===w.location.id&&!m.scheduleOnly&&!isCheckoutPosition(w,m.position)&&m.capabilities.includes('schedule.manage');}
const areaAllowed=(w,area)=>w.location.configuration.operatingDepartments.includes(area)&&(w.me.area===area||w.me.capabilities.includes('location.manage'));
export function groupSources(w,week,mode='copy',now=new Date().toISOString()){
 if(!validDay(week)||!instant(now))throw invalid();if(!hasGroupAccess(w))return {shifts:[],staffing:[]};const end=nextDay(week);
 const selected=r=>r.locationId===w.location.id&&uuid(r.id)&&revision(r.revision)&&areaAllowed(w,r.area)&&instant(r.data?.start)&&instant(r.data?.end)&&localDay(r.data.start,w.location.timezone)>=week&&localDay(r.data.start,w.location.timezone)<end;
 return {shifts:w.records.filter(r=>r.kind==='shift'&&selected(r)&&!r.data.cancelled&&(mode==='copy'||!r.data.published&&!r.data.releasedAt&&Date.parse(r.data.start)>Date.parse(now))),staffing:w.records.filter(r=>r.kind==='staffing'&&selected(r)&&r.data.status==='approved')};
}
export function draftFields(source,zone){const start=localStamp(source.data.start,zone),end=localStamp(source.data.end,zone);return {source,personId:source.ownerId,position:source.data.position,startDate:start.slice(0,10),startTime:start.slice(11,16),endDate:end.slice(0,10),endTime:end.slice(11,16),startOccurrence:'',endOccurrence:''};}
export function draftProposal(edit,zone){
 const clock=(side)=>{const original=localStamp(edit.source.data[side],zone),value=edit[side+'Date']+'T'+edit[side+'Time'];return value===original.slice(0,16)?original:local(value);};
 return {id:edit.source.id,revision:edit.source.revision,input:{personId:edit.personId,position:edit.position,startLocal:clock('start'),endLocal:clock('end'),startOccurrence:edit.startOccurrence,endOccurrence:edit.endOccurrence}};
}
function expectedRows(action,selection){return action==='shift.copy-week'?[...selection.shifts.map(r=>({...r,kind:'shift'})),...selection.staffing.map(r=>({...r,kind:'staffing'}))]:selection.drafts.map(r=>({...r,kind:'shift'}));}
function checkedIssues(row,expected){
 if(!Array.isArray(row.issues)||row.issues.length>201||row.issues.some(i=>!object(i)||typeof i.code!=='string'||!/^[a-z_]+$/.test(i.code)||i.round!==undefined&&(!Number.isInteger(i.round)||i.round<0||i.round>101)||i.sourceIds!==undefined&&(!Array.isArray(i.sourceIds)||i.sourceIds.length>100||i.sourceIds.some(id=>!uuid(id)||!expected.some(e=>e.kind==='shift'&&e.id===id)))))throw invalid();
}
function checkedItems(action,items,selection,result=false){
 const expected=expectedRows(action,selection);if(!Array.isArray(items)||items.length!==expected.length)throw invalid();const remaining=new Map(expected.map(e=>[e.kind+':'+e.id,e]));
 for(const row of items){const source=remaining.get(row?.kind+':'+row?.id);if(!source||row.sourceRevision!==source.revision||!['rejected',result?'saved':'ready'].includes(row.status))throw invalid();remaining.delete(row.kind+':'+row.id);checkedIssues(row,expected);
  if(row.status==='rejected'?row.issues.length===0||row.recordId!==undefined:row.issues.length!==0)throw invalid();
  if(row.status==='saved'&&(!uuid(row.recordId)||row.revision!==(action==='shift.copy-week'?1:source.revision+1)||action==='shift.save-batch'&&row.recordId!==row.id))throw invalid();
  for(const key of ['sourceStart','sourceEnd','start','end'])if(row[key]!==undefined&&row[key]!==null&&!instant(row[key]))throw invalid();
  for(const key of ['before','after'])if(row[key]!==undefined){const slot=row[key];if(!object(slot)||!uuid(slot.personId)||typeof slot.position!=='string'||!slot.position||[slot.start,slot.end].some(v=>v!==null&&!instant(v))||key==='before'&&(!instant(slot.start)||!instant(slot.end)))throw invalid();}
  if(row.status==='ready'||row.status==='saved'){
   const times=action==='shift.copy-week'?row:row.after;if(!instant(times?.start)||!instant(times?.end)||Date.parse(times.end)<=Date.parse(times.start)||Date.parse(times.end)-Date.parse(times.start)>86400000||!revision(row.currentSourceRevision)||row.currentSourceRevision!==source.revision||typeof row.area!=='string'||typeof (row.position??row.after?.position)!=='string')throw invalid();
   if(action==='shift.copy-week'&&(!counter(row.omittedClosingCount)||!instant(row.sourceStart)||!instant(row.sourceEnd)||row.kind==='shift'&&!uuid(row.personId)||row.kind==='staffing'&&(typeof row.title!=='string'||!Number.isInteger(row.minimum)||row.minimum<1)))throw invalid();
   if(action==='shift.save-batch'&&(!instant(row.before?.start)||!instant(row.before?.end)||!uuid(row.before?.personId)||!uuid(row.after?.personId)))throw invalid();
  }
  if(row.warnings!==undefined&&(!Array.isArray(row.warnings)||row.warnings.some(i=>!object(i)||typeof i.code!=='string'||!/^[a-z_]+$/.test(i.code))))throw invalid();
 }
 return structuredClone(items);
}
export function checkedGroupReview(action,body,selection,w){
 const canonical=groupSelection(action,selection),copy=action==='shift.copy-week';
 if(!body||body.coverage!==(copy?'candidate-schedule-copy-review':'candidate-schedule-batch-review')||typeof body.reviewToken!=='string'||!/^[a-f0-9]{64}$/.test(body.reviewToken)||typeof body.sourceReviewComplete!=='boolean'||body.timezone!==w.location.timezone||JSON.stringify(groupSelection(action,body.selection))!==JSON.stringify(canonical))throw invalid();
 const items=checkedItems(action,body.items,canonical),ready=items.filter(r=>r.status==='ready').length;
 if(!copy&&(body.readyCount!==ready||body.rejectedCount!==items.length-ready))throw invalid();
 if(items.some(r=>r.area!==undefined&&!areaAllowed(w,r.area)))throw invalid();
 return {action,selection:canonical,items,reviewToken:body.reviewToken,sourceReviewComplete:body.sourceReviewComplete,timezone:body.timezone,locationId:w.location.id,actorId:w.me.id};
}
export async function loadGroupReview(call,w,action,selection){
 if(!hasGroupAccess(w))throw Error('Current scheduling authority is required.');const canonical=groupSelection(action,selection);
 const response=await call(action==='shift.copy-week'?'/copy-review':'/batch-review',canonical);
 if(response.status!==200)throw Error(response.status===401?'Sign in again, then reload current drafts.':response.status===403?'Your current access does not allow this review.':'Review could not be loaded. Reload current drafts and review again.');
 return checkedGroupReview(action,response.body,canonical,w);
}
export function groupInput(review,note,confirmed){if(!review?.sourceReviewComplete)throw Error('Schedule inputs need a complete source review before saving.');if(confirmed!==true||typeof note!=='string'||!note.trim()||note.trim().length>2000)throw Error('Confirm the reviewed selection and enter a reason.');return {...groupSelection(review.action,review.selection),reviewToken:review.reviewToken,note:note.trim(),confirmed:true};}
export function checkedGroupResult(action,body,command){
 if(!body||body.recordId!==command.requestId||body.requestId!==command.requestId||body.revision!==1||!counter(body.workspaceRevision)||!counter(body.scheduleRevision)||!counter(body.inputRevision)||!instant(body.appliedAt)||typeof body.replayed!=='boolean')throw invalid();
 const items=checkedItems(action,body.items,groupSelection(action,command.input),true),saved=items.filter(r=>r.status==='saved').length;
 if(body.savedCount!==saved||body.rejectedCount!==items.length-saved)throw invalid();return {...body,items};
}
export function rejectedSelection(action,selection,result){const canonical=groupSelection(action,selection),rejected=new Set(result.items.filter(r=>r.status==='rejected').map(r=>r.kind+':'+r.id));return action==='shift.copy-week'?{...canonical,shifts:canonical.shifts.filter(r=>rejected.has('shift:'+r.id)),staffing:canonical.staffing.filter(r=>rejected.has('staffing:'+r.id))}:{...canonical,drafts:canonical.drafts.filter(r=>rejected.has('shift:'+r.id))};}
export function restrictGroupSources(sources,selection){if(!selection)return sources;const shifts=new Set((selection.shifts??selection.drafts).map(r=>r.id)),staffing=new Set((selection.staffing??[]).map(r=>r.id));return {shifts:sources.shifts.filter(r=>shifts.has(r.id)),staffing:sources.staffing.filter(r=>staffing.has(r.id))};}
export function refreshCopySelection(selection,sources){
 const dropped=[];const refresh=(family,kind)=>selection[family].flatMap(row=>{const source=sources[family].find(r=>r.id===row.id);if(!source){dropped.push({kind,id:row.id});return [];}return [{...row,revision:source.revision}];});
 return {selection:{...selection,shifts:refresh('shifts','shift'),staffing:refresh('staffing','staffing')},dropped};
}
const messages={revision_conflict:'The source changed. Reload and review the current record.',copy_source_unavailable:'This source is unavailable for copying.',copy_source_week_conflict:'This source is outside the selected week.',copy_duplicate:'An active copy already exists in the destination week.',copy_destination_started:'The destination start has passed. Refresh and choose future dates.',copy_occurrence_required:'Choose a separate first or second occurrence for the repeated start or end.',copy_time_nonexistent:'This local time does not exist when clocks change.',batch_occurrence_required:'Choose the first or second occurrence for each repeated time.',batch_time_nonexistent:'This local time does not exist when clocks change.',batch_source_unavailable:'This source is unavailable. Reload current drafts.',batch_source_ineligible:'This record needs individual review and cannot be batch edited.',batch_source_started:'The original shift has started. Refresh and use individual review.',batch_destination_started:'The proposed start has passed. Refresh and choose a future time.',batch_week_conflict:'The original and proposed starts must be in the selected week.',draft_reference_only:'Imported drafts need individual review.',linked_shift_protected:'Linked work needs individual review.',owner_denied:'This employee is not currently eligible in the shift’s department.',schedule_job_denied:'This scheduling job needs current eligibility.',station_needs_individual_review:'The retained station needs individual review; it will not be cleared.',approved_time_off_conflict:'Approved leave conflicts with this shift.',availability_shift_conflict:'Approved availability conflicts with this shift.',shift_overlap:'This employee has another booking at this time.',proposed_shift_overlap:'Selected proposed shifts conflict with each other.',depends_on_rejected_row:'This change depends on a rejected row vacating its original slot.',invalid_draft_duration:'The shift must last more than zero and no more than 24 elapsed hours.',invalid_staffing_department:'The staffing department needs an eligible roster.',staffing_overlap_at_approval:'This staffing draft overlaps an approved need and will need review before approval.'};
export const groupIssueMessage=issue=>messages[issue.code]??'This row needs individual review ('+issue.code.replaceAll('_',' ')+').';
const recoveryKey=(scope,actor)=>'jmax-copy-batch-recovery:'+encodeURIComponent(scope)+':'+encodeURIComponent(actor);
export function groupRecovery(storage,scope,actor){try{const r=JSON.parse(storage?.getItem(recoveryKey(scope,actor))??'null');return r?.locationId===scope&&r.actorId===actor&&uuid(r.requestId)&&isGroupAction(r.action)?r:null;}catch{return null;}}
export function setGroupRecovery(storage,command,actor){if(actor)try{storage?.setItem(recoveryKey(command.locationId,actor),JSON.stringify({locationId:command.locationId,actorId:actor,requestId:command.requestId,action:command.action}));}catch{}}
export function clearGroupRecovery(storage,scope,actor){try{storage?.removeItem(recoveryKey(scope,actor));}catch{}}
// Keep areaAllowed aligned with goal_authorized; any future leadership-based manage grant must change both.
async function loadStaffingScope(call,w,query){
 if(!hasGroupAccess(w))return [];
 const params=new URLSearchParams(Object.entries(query).filter(([,value])=>value!==null));
 for(let attempt=0;attempt<3;attempt++){
  const items=[],seen=new Set();let after=null,version=null,changed=false;
  for(let page=0;page<100;page++){
   const response=await call('/staffing?limit=100&'+params.toString()+(after?'&after='+after:'')),b=response.body;
   if(response.status!==200||!Array.isArray(b?.items)||b.items.length>100||!counter(b.inputRevision)||b.nextCursor!==null&&!uuid(b.nextCursor)||!fields(b.query,['from','to','status','copyRequest'])||Object.entries(query).some(([key,value])=>b.query[key]!==value))throw Error('Staffing records are unavailable. No partial selection is shown.');
   version??=b.inputRevision;if(b.inputRevision!==version){changed=true;break;}
   for(const row of b.items){if(row?.kind!=='staffing'||row.locationId!==w.location.id||!uuid(row.id)||!revision(row.revision)||!areaAllowed(w,row.area)||!instant(row.data?.start)||!instant(row.data?.end)||!['draft','approved','retired'].includes(row.data.status)||typeof row.data.title!=='string'||typeof row.data.position!=='string'||!Number.isInteger(row.data.minimum)||row.data.minimum<1||seen.has(row.id)||query.status!==null&&row.data.status!==query.status||query.from!==null&&(localDay(row.data.start,w.location.timezone)<query.from||localDay(row.data.start,w.location.timezone)>query.to))throw invalid();seen.add(row.id);items.push(row);}
   if(b.nextCursor===null){const fence=await call('/schedule-viewer');
    if(fence.status!==200||JSON.stringify(fence.body?.me)!==JSON.stringify(w.me)||JSON.stringify({...fence.body?.location,revision:0})!==JSON.stringify({...w.location,revision:0}))throw Error('Staffing access or configuration changed. Reload and review again.');
    if(fence.body.inputRevision!==version){changed=true;break;}return items;
   }
   if(!b.items.length||b.items.at(-1).id!==b.nextCursor||after&&b.nextCursor<=after)throw invalid();after=b.nextCursor;
   if(page===99)throw Error('Choose a shorter range; no partial staffing history is shown.');
  }
  if(!changed)throw invalid();
 }
 throw Error('Staffing inputs changed while loading. Reload and review again; no partial selection is shown.');
}
export async function loadCopyStaffing(call,w,sourceWeek){if(!validDay(sourceWeek))throw invalid();return loadStaffingScope(call,w,{from:sourceWeek,to:nextDay(sourceWeek,6),status:'approved',copyRequest:null});}
export async function refreshRejectedCopy(call,w,selection){
 const staffing=selection.staffing.length?await loadCopyStaffing(call,w,selection.sourceWeek):[];
 return {...refreshCopySelection(selection,groupSources({...w,records:[...w.records.filter(r=>r.kind!=='staffing'),...staffing]},selection.sourceWeek,'copy')),staffing};
}
export async function loadCopiedStaffing(call,w,requestId){if(!uuid(requestId))throw invalid();return loadStaffingScope(call,w,{from:null,to:null,status:null,copyRequest:requestId.toLowerCase()});}
