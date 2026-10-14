// Read-only normalized-file review. No database, filesystem or network dependency.
import {createHash} from 'node:crypto';
export const sourcePreviewLimits=Object.freeze({bytes:2*1024*1024,stores:20,people:2000,rowsPerFamily:2000,mappings:8000});
const reviewRequired=new Set(['target_record_omitted_review','unused_mapping','inactive_source_leave_untracked','source_families_unavailable']);
const bad=code=>{throw new TypeError(code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function shape(x,keys){if(!object(x)||Object.keys(x).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(x,k)))bad('invalid_snapshot_shape');}
const text=(x,max=200)=>typeof x==='string'&&x.length>0&&x.length<=max&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const rev=x=>Number.isSafeInteger(x)&&x>0&&x<2147483647;
const counter=x=>Number.isSafeInteger(x)&&x>=0;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&+x.slice(0,4)>0&&Number.isFinite(Date.parse(x+'T12:00Z'))&&new Date(x+'T12:00Z').toISOString().slice(0,10)===x;
// Preserve microseconds and explicit UTC offsets; never truncate for comparisons.
function instant(x){
 if(typeof x!=='string')return null;
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(x);
 if(!m||!day(m[1])||+m[2]>23||+m[3]>59||+m[4]>59||m[6]!=='Z'&&(+m[6].slice(1,3)>23||+m[6].slice(4)>59))return null;
 const ms=Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
 return Number.isFinite(ms)?BigInt(ms)*1000n+BigInt((m[5]??'').padEnd(6,'0')):null;
}
function list(x,max){if(!Array.isArray(x)||x.length>max)bad('snapshot_limit_or_shape');}
function names(x){list(x,100);if(x.some(v=>!text(v))||new Set(x).size!==x.length)bad('invalid_snapshot_keys');}
function zone(x){try{return text(x)&&!!new Intl.DateTimeFormat('en',{timeZone:x});}catch{return false;}}
const canonical=x=>Array.isArray(x)?x.map(canonical).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const key=(...parts)=>JSON.stringify(parts);
function localDay(us,timeZone){const ms=us>=0n?us/1000n:(us-999n)/1000n;const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Number(ms))).map(p=>[p.type,p.value]));return parts.year.padStart(4,'0')+'-'+parts.month+'-'+parts.day;}
const inWindow=(r,w,zone)=>localDay(instant(r.start),zone)<=w.to&&localDay(instant(r.end)-1n,zone)>=w.from;
const memberValue=m=>({name:m.name,department:m.department,position:m.position,active:m.active,scheduleOnly:m.scheduleOnly,scheduleJobs:[...m.scheduleJobs].sort()});
const leaveValue=(r,memberId)=>({memberId,department:r.department,start:String(instant(r.start)),end:String(instant(r.end)),status:r.status});
function memberShape(m,source){
 shape(m,source?['sourceId','sourceRevision','name','department','position','active','scheduleOnly','scheduleJobs']:['id','personId','revision','name','department','position','active','scheduleOnly','scheduleJobs']);
 if(!(source?text(m.sourceId)&&rev(m.sourceRevision):uuid(m.id)&&uuid(m.personId)&&rev(m.revision))||![m.name,m.department,m.position].every(v=>text(v))||typeof m.active!=='boolean'||typeof m.scheduleOnly!=='boolean')bad('invalid_member_snapshot');
 names(m.scheduleJobs);
}
function leaveShape(r,source){
 shape(r,source?['sourceId','sourceRevision','memberSourceId','department','start','end','status']:['id','revision','memberId','department','start','end','status']);
 const start=instant(r.start),end=instant(r.end);
 if(!(source?text(r.sourceId)&&rev(r.sourceRevision)&&text(r.memberSourceId):uuid(r.id)&&rev(r.revision)&&uuid(r.memberId))||!text(r.department)||start===null||end===null||end<=start||!(source?['pending','approved','declined','cancelled','withdrawn']:['pending','approved','declined']).includes(r.status))bad('invalid_leave_snapshot');
}

// V2 makes missing coverage explicit. Empty available rows and unavailable data are different inputs.
function familyCoverage(value,records,family){
 if(!object(value)||typeof value.available!=='boolean')bad('invalid_family_coverage');
 if(!value.available){shape(value,['available']);if(records!==null)bad('unavailable_family_has_records');return {available:false,rows:[]};}
 shape(value,family==='roster'?['available','complete','count','endOfSource','inactiveIncluded','scheduleOnlyIncluded']:['available','complete','count','endOfSource','from','to']);
 if(typeof value.complete!=='boolean'||typeof value.endOfSource!=='boolean'||!counter(value.count))bad('invalid_source_coverage');
 if(family==='roster'?[value.inactiveIncluded,value.scheduleOnlyIncluded].some(x=>typeof x!=='boolean'):!day(value.from)||!day(value.to)||value.from>value.to)bad('invalid_source_coverage');
 list(records,sourcePreviewLimits.rowsPerFamily);return {...value,rows:records};
}
const coverageComplete=(coverage,family)=>coverage.complete&&coverage.endOfSource&&coverage.count===coverage.rows.length&&(family!=='roster'||coverage.inactiveIncluded&&coverage.scheduleOnlyIncluded);
const countsFor=(rows,v2)=>Object.fromEntries(['new','unchanged','changed','omitted','blocked',...(v2?['review_required']:[])].map(status=>[status,rows.filter(r=>r.status===status).length]));
const statusFor=issues=>issues.some(i=>i.severity==='blocking')?'blocked':issues.length?'review_required':'reviewable';

export function parseSourcePreviewFile(body){
 if(typeof body!=='string'||Buffer.byteLength(body)>sourcePreviewLimits.bytes)bad('snapshot_byte_limit');
 let parsed;try{parsed=JSON.parse(body);}catch{bad('invalid_snapshot_json');}
 // JSON.parse otherwise silently keeps the final occurrence of duplicate keys.
 const stack=[],tokens=body.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g);
 const colonAfter=index=>{while(/\s/.test(body[index]??''))index++;return body[index]===':';};
 for(const match of tokens){const t=match[0];if(t==='{'||t==='[')stack.push(t==='{'?new Set():null);else if(t==='}'||t===']')stack.pop();else if(t.startsWith('"')&&colonAfter(match.index+t.length)){const fields=stack.at(-1),k=JSON.parse(t);if(fields?.has(k))bad('duplicate_snapshot_key');fields?.add(k);}}
 return parsed;
}

export function previewSourceMapping(input){
 // Also bound programmatic callers, before walking their envelope.
 let bytes;try{bytes=Buffer.byteLength(JSON.stringify(input));}catch{bad('invalid_snapshot_shape');}
 if(bytes>sourcePreviewLimits.bytes)bad('snapshot_byte_limit');
 shape(input,['version','organizationId','source','mappings','target']);
 if(![1,2].includes(input.version)||!text(input.organizationId))bad('unsupported_snapshot_version');
 const v2=input.version===2;
 const {source,target,mappings}=input;
 shape(source,['system','tenant','capturedAt','scopes']);shape(target,['organizationId','capturedAt','people','stores']);
 if(!text(source.system)||!text(source.tenant)||instant(source.capturedAt)===null||instant(target.capturedAt)===null||target.organizationId!==input.organizationId)bad('invalid_snapshot_scope');
 list(source.scopes,sourcePreviewLimits.stores);list(target.stores,sourcePreviewLimits.stores);list(target.people,sourcePreviewLimits.people);list(mappings,sourcePreviewLimits.mappings);
 if(!source.scopes.length)bad('empty_snapshot_scope');
 const issues=[],rows=[],scopes=[],seenTargets=new Set(),seenStores=new Set(),seenExternalStores=new Set(),usedMappings=new Set(),coverageByStore=new Map();
 const issue=(code,storeId,kind,sourceId,memberSourceId,family)=>issues.push({code,severity:reviewRequired.has(code)?'review_required':'blocking',storeId,kind,sourceId,...(memberSourceId===undefined?{}:{memberSourceId}),...(v2&&(family||kind==='member'||kind==='timeOff')?{family:family??(kind==='member'?'roster':'timeOff')}:{})});
 const people=new Map();for(const p of target.people){shape(p,['id','name','active']);if(!uuid(p.id)||!text(p.name)||typeof p.active!=='boolean'||people.has(p.id.toLowerCase()))bad('invalid_person_snapshot');people.set(p.id.toLowerCase(),p);}
 const stores=new Map(),targetIds=new Set();
 for(const t of target.stores){
  shape(t,['id','timezone','departments','jobs','inputRevision','members','timeOff']);if(!text(t.id)||!zone(t.timezone)||!counter(t.inputRevision)||stores.has(t.id))bad('invalid_target_store');names(t.departments);names(t.jobs);if(!t.departments.length)bad('invalid_target_store');
  list(t.members,sourcePreviewLimits.rowsPerFamily);if(!v2||t.timeOff!==null)list(t.timeOff,sourcePreviewLimits.rowsPerFamily);const memberPeople=new Set();
  for(const m of t.members){memberShape(m,false);const id=m.id.toLowerCase(),person=m.personId.toLowerCase();if(targetIds.has(key('member',id))||memberPeople.has(person)||!people.has(person)||!t.departments.includes(m.department)||!t.jobs.includes(m.position)||m.scheduleJobs.some(j=>!t.jobs.includes(j)))bad('invalid_target_member');targetIds.add(key('member',id));memberPeople.add(person);}
  for(const r of t.timeOff??[]){leaveShape(r,false);const id=r.id.toLowerCase();if(targetIds.has(key('timeOff',id))||(!t.departments.includes(r.department)||!t.members.some(m=>m.id.toLowerCase()===r.memberId.toLowerCase())))bad('invalid_target_leave');targetIds.add(key('timeOff',id));}
  stores.set(t.id,t);
 }
 const map=new Map();
 for(const m of mappings){
  const family=m?.kind==='member';shape(m,family?['storeId','externalStoreId','kind','sourceId','sourceRevision','targetId','personId','mappingRevision','expectedTargetRevision']:['storeId','externalStoreId','kind','sourceId','sourceRevision','targetId','mappingRevision','expectedTargetRevision']);
  if(!['member','timeOff'].includes(m.kind)||![m.storeId,m.externalStoreId,m.sourceId].every(v=>text(v))||!uuid(m.targetId)||family&&!uuid(m.personId)||!rev(m.sourceRevision)||!rev(m.mappingRevision)||m.expectedTargetRevision!==null&&!rev(m.expectedTargetRevision))bad('invalid_mapping_snapshot');
  const k=key(m.storeId,m.externalStoreId,m.kind,m.sourceId),id=m.targetId.toLowerCase();if(map.has(k)||seenTargets.has(key(m.kind,id)))bad('duplicate_mapping_snapshot');map.set(k,m);seenTargets.add(key(m.kind,id));
 }
 for(const s of source.scopes){
  shape(s,['storeId','externalStoreId','timezone','watermark',...(!v2?['endOfSource']:[]),'coverage','members','timeOff']);
  if(!text(s.storeId)||!text(s.externalStoreId)||!zone(s.timezone)||!text(s.watermark)||!v2&&typeof s.endOfSource!=='boolean'||seenStores.has(s.storeId)||seenExternalStores.has(s.externalStoreId))bad('invalid_source_store');seenStores.add(s.storeId);seenExternalStores.add(s.externalStoreId);
  shape(s.coverage,['roster','timeOff']);const c=s.coverage;let roster,timeOff;
  if(v2){roster=familyCoverage(c.roster,s.members,'roster');timeOff=familyCoverage(c.timeOff,s.timeOff,'timeOff');}
  else{
   shape(c.roster,['complete','count','inactiveIncluded','scheduleOnlyIncluded']);shape(c.timeOff,['complete','count','from','to']);
   if([c.roster.complete,c.roster.inactiveIncluded,c.roster.scheduleOnlyIncluded,c.timeOff.complete].some(x=>typeof x!=='boolean')||!counter(c.roster.count)||!counter(c.timeOff.count)||!day(c.timeOff.from)||!day(c.timeOff.to)||c.timeOff.from>c.timeOff.to)bad('invalid_source_coverage');
   list(s.members,sourcePreviewLimits.rowsPerFamily);list(s.timeOff,sourcePreviewLimits.rowsPerFamily);
   roster={...c.roster,available:true,endOfSource:s.endOfSource,rows:s.members};timeOff={...c.timeOff,available:true,endOfSource:s.endOfSource,rows:s.timeOff};
  }
  coverageByStore.set(s.storeId,{roster,timeOff});roster.rows.forEach(m=>memberShape(m,true));timeOff.rows.forEach(r=>leaveShape(r,true));
  const t=stores.get(s.storeId),scopeIssues=[];const scopeIssue=(code,family)=>{scopeIssues.push(code);issue(code,s.storeId,'scope',null,undefined,family);};
  if(!t)scopeIssue('target_store_mapping_required');else if(t.timezone!==s.timezone)scopeIssue('timezone_mapping_conflict');
  if(v2){
   if(!roster.available&&!timeOff.available)scopeIssue('source_families_unavailable');
   if(timeOff.available&&t?.timeOff===null)scopeIssue('target_family_unavailable','timeOff');
   for(const [family,coverage]of Object.entries({roster,timeOff}))if(coverage.available){
    if(!coverage.complete||!coverage.endOfSource||family==='roster'&&(!coverage.inactiveIncluded||!coverage.scheduleOnlyIncluded))scopeIssue('source_coverage_incomplete',family);
    if(coverage.count!==coverage.rows.length)scopeIssue('source_count_mismatch',family);
   }
  }else{
   if(!s.endOfSource||!c.roster.complete||!c.roster.inactiveIncluded||!c.roster.scheduleOnlyIncluded||!c.timeOff.complete)scopeIssue('source_coverage_incomplete');
   if(c.roster.count!==s.members.length||c.timeOff.count!==s.timeOff.length)scopeIssue('source_count_mismatch');
  }
  const mappedMembers=new Map(),sourcePeople=new Map(),sourceCounts=new Map(),represented=new Set();
  for(const [kind,records]of[['member',roster.rows],['timeOff',timeOff.rows]])for(const r of records){const k=key(s.storeId,s.externalStoreId,kind,r.sourceId);sourceCounts.set(k,(sourceCounts.get(k)??0)+1);if(kind==='member'){const m=map.get(k);if(m){const person=m.personId.toLowerCase();sourcePeople.set(person,(sourcePeople.get(person)??0)+1);}}}
  function review(kind,r){
   const k=key(s.storeId,s.externalStoreId,kind,r.sourceId),codes=[],m=map.get(k);const add=(code,memberSourceId)=>{codes.push(code);issue(code,s.storeId,kind,r.sourceId,memberSourceId);};
   if(sourceCounts.get(k)>1)add('duplicate_source_record');
   if(v2&&kind==='timeOff'&&t?.timeOff===null)add('target_family_unavailable');
   // Members are reviewed first; report their failed dependency even when the leave's own alias is absent.
   if(kind==='timeOff'){
    let parentStale=false;
    if(!roster.available&&!mappedMembers.has(r.memberSourceId)){
     const parentKey=key(s.storeId,s.externalStoreId,'member',r.memberSourceId),parent=map.get(parentKey);
     if(parent){usedMappings.add(parentKey);const existing=t?.members.find(x=>x.id.toLowerCase()===parent.targetId.toLowerCase());
      if(existing&&parent.expectedTargetRevision===existing.revision&&parent.personId.toLowerCase()===existing.personId.toLowerCase())mappedMembers.set(r.memberSourceId,{id:existing.id.toLowerCase(),department:existing.department});
      else if(existing)parentStale=true;
     }
    }
    if(!mappedMembers.has(r.memberSourceId))add(parentStale?'leave_member_alias_stale':roster.available&&sourceCounts.has(key(s.storeId,s.externalStoreId,'member',r.memberSourceId))?'leave_member_blocked':'leave_member_mapping_required',r.memberSourceId);
    // Establish scoped absence only through an exact reviewed membership binding.
    // Other members' leave and this member's out-of-window leave do not imply a match.
    if(v2&&!m&&t&&Array.isArray(t.timeOff)&&['declined','cancelled','withdrawn'].includes(r.status)){
     if(!inWindow(r,timeOff,s.timezone))add('leave_outside_declared_window');
     const member=mappedMembers.get(r.memberSourceId);
     if(!codes.length&&member&&!t.timeOff.some(x=>x.memberId.toLowerCase()===member.id&&inWindow(x,timeOff,s.timezone))){add('inactive_source_leave_untracked');rows.push({storeId:s.storeId,kind,sourceId:r.sourceId,targetId:null,status:'review_required',changedFields:[],issues:codes});return;}
    }
    if(['cancelled','withdrawn'].includes(r.status))add('leave_withdrawal_policy_required');
   }
   if(!m)add('identity_mapping_required');else{
    usedMappings.add(k);if(m.sourceRevision!==r.sourceRevision)add('source_mapping_stale');
    const id=m.targetId.toLowerCase(),all=(kind==='member'?t?.members:t?.timeOff)??[],existing=all.find(x=>x.id.toLowerCase()===id);
    represented.add(key(kind,id));
    if(m.expectedTargetRevision!== (existing?.revision??null))add('target_revision_conflict');
    if(!existing&&targetIds.has(key(kind,id)))add('target_scope_collision');
    if(kind==='member'){
     const person=m.personId.toLowerCase();if(!people.has(person))add('person_review_required');else if(r.active&&!people.get(person).active)add('person_inactive');
     if(sourcePeople.get(person)>1||t?.members.some(x=>x.personId.toLowerCase()===person&&x.id.toLowerCase()!==id))add('duplicate_person_membership');
     if(existing&&existing.personId.toLowerCase()!==person)add('person_binding_conflict');
     if(t&&(!t.departments.includes(r.department)||!t.jobs.includes(r.position)||r.scheduleJobs.some(j=>!t.jobs.includes(j))))add('job_or_department_mapping_required');
     if(!codes.length)mappedMembers.set(r.sourceId,{id,department:r.department});
    }else{
     const member=mappedMembers.get(r.memberSourceId);
     if(t&&!t.departments.includes(r.department))add('leave_department_mapping_required');
     if(existing&&member&&existing.memberId.toLowerCase()!==member.id)add('leave_owner_binding_conflict');
     if(existing&&existing.department!==r.department)add('leave_scope_binding_conflict');
     if(!inWindow(r,timeOff,s.timezone))add('leave_outside_declared_window');
    }
    if(!codes.length){const after=kind==='member'?memberValue(r):leaveValue(r,mappedMembers.get(r.memberSourceId).id),before=existing?(kind==='member'?memberValue(existing):leaveValue(existing,existing.memberId.toLowerCase())):null;
     rows.push({storeId:s.storeId,kind,sourceId:r.sourceId,targetId:id,personId:kind==='member'?m.personId.toLowerCase():null,sourceRevision:r.sourceRevision,mappingRevision:m.mappingRevision,expectedTargetRevision:m.expectedTargetRevision,status:existing?(equal(before,after)?'unchanged':'changed'):'new',changedFields:before?Object.keys(after).filter(k=>!equal(before[k],after[k])):[],issues:[]});return;
    }
   }
   rows.push({storeId:s.storeId,kind,sourceId:r.sourceId,targetId:m?.targetId.toLowerCase()??null,status:'blocked',changedFields:[],issues:codes,...(kind==='timeOff'&&codes.some(code=>['leave_member_blocked','leave_member_mapping_required','leave_member_alias_stale'].includes(code))?{memberSourceId:r.memberSourceId}:{})});
  }
  roster.rows.forEach(r=>review('member',r));timeOff.rows.forEach(r=>review('timeOff',r));
  if(t)for(const [kind,entries] of [['member',t.members],['timeOff',t.timeOff??[]]])for(const r of entries){
   if(!(kind==='member'?roster:timeOff).available)continue;
   if(kind==='timeOff'&&!inWindow(r,timeOff,s.timezone))continue;
   if(!represented.has(key(kind,r.id.toLowerCase()))){issue('target_record_omitted_review',s.storeId,kind,null);rows.push({storeId:s.storeId,kind,sourceId:null,targetId:r.id.toLowerCase(),status:'omitted',changedFields:[],issues:['target_record_omitted_review']});}
  }
  if(v2){
   const families=Object.fromEntries(Object.entries({roster,timeOff}).map(([family,coverage])=>[family,coverage.available?{available:true,coverageClaim:coverageComplete(coverage,family)?'declared_complete':'incomplete',targetAvailable:!!t&&(family==='roster'||t.timeOff!==null),count:coverage.rows.length,...(family==='timeOff'?{from:coverage.from,to:coverage.to}:{})}:{available:false,coverageClaim:'unavailable',status:'unavailable'}]));
   scopes.push({storeId:s.storeId,externalStoreId:s.externalStoreId,timezone:s.timezone,watermark:s.watermark,inputRevision:t?.inputRevision??null,families,targetContext:t&&t.timezone===s.timezone?'supplied':'needs_review',issues:scopeIssues});
  }else scopes.push({storeId:s.storeId,externalStoreId:s.externalStoreId,timezone:s.timezone,watermark:s.watermark,inputRevision:t?.inputRevision??null,coverageClaim:scopeIssues.some(c=>['source_coverage_incomplete','source_count_mismatch'].includes(c))?'incomplete':'declared_complete',coverage:{rosterCount:s.members.length,timeOffCount:s.timeOff.length,from:c.timeOff.from,to:c.timeOff.to},targetContext:t&&t.timezone===s.timezone?'supplied':'needs_review',issues:scopeIssues});
 }
 if(v2&&[...coverageByStore.values()].every(c=>!c.roster.available&&!c.timeOff.available))bad('source_families_unavailable');
 for(const [k,m] of map)if(!usedMappings.has(k)&&(!v2||coverageByStore.get(m.storeId)?.[m.kind==='member'?'roster':'timeOff']?.available!==false))issue('unused_mapping',m.storeId,m.kind,m.sourceId);
 const sort=(a,b)=>{const x=key(a.storeId,a.kind??'',a.sourceId??'',a.targetId??'',a.code??''),y=key(b.storeId,b.kind??'',b.sourceId??'',b.targetId??'',b.code??'');if(x!==y)return x<y?-1:1;const ax=JSON.stringify(canonical(a)),bx=JSON.stringify(canonical(b));return ax<bx?-1:ax>bx?1:0;};
 rows.sort(sort);issues.sort(sort);scopes.sort(sort);
 if(v2)for(const s of scopes)for(const [family,coverage]of Object.entries(s.families))if(coverage.available){const findings=issues.filter(i=>i.storeId===s.storeId&&(i.family===family||i.kind==='scope'&&!i.family));coverage.status=statusFor(findings);coverage.issues=findings.map(i=>i.code);coverage.counts=countsFor(rows.filter(r=>r.storeId===s.storeId&&r.kind===(family==='roster'?'member':'timeOff')),true);}
 return {purpose:'read-only-source-mapping-preview',version:input.version,status:statusFor(issues),organizationId:input.organizationId,source:{system:source.system,tenant:source.tenant,capturedAt:source.capturedAt,digest:digest(source)},target:{capturedAt:target.capturedAt,digest:digest(target)},mappingDigest:digest(mappings),canApply:false,completenessCertified:false,accessProvisioned:false,requires:['verified-source-coverage','current-authorized-target-read','independent-identity-access-review','reviewed-application-contract'],scopes,rows,issues,counts:countsFor(rows,v2)};
}
