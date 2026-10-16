// Pure, supplied-evidence validation only. No database, files, network or authority lookup.
import {exactShape,trimmedText,sourceUuid,validDay,utcMicroseconds,canonicalJson,canonicalJobPairs,contentDigest} from './source-fingerprint.mjs';
import {parseSourcePreviewFile} from './source-preview.mjs';
export const managerSupplementLimits=Object.freeze({bytes:2*1024*1024,choices:8000,members:2000,jobs:100});
const fail=code=>{throw new TypeError(code);};
const positive=v=>Number.isSafeInteger(v)&&v>0;
const ordinal=(a,b)=>a<b?-1:a>b?1:0;
const flags=()=>({canApply:false,completenessCertified:false,accessProvisioned:false});
const token=v=>typeof v==='string'&&v.length<=200&&v.trim().length>0&&!/[\x00-\x1f\x7f]/.test(v);
const scopeKeys=['organizationId','system','tenant','storeId','externalStoreId'];
function checkedScope(scope){
 exactShape(scope,scopeKeys,'invalid_supplement_scope');
 if(Object.values(scope).some(v=>!trimmedText(v))||scope.system!=='toast')fail('invalid_supplement_scope');
 return Object.fromEntries(scopeKeys.map(k=>[k,scope[k]]));
}
function population(p){
 exactShape(p,['revision','effectiveDate'],'invalid_supplement_population');
 if(!positive(p.revision)||!validDay(p.effectiveDate))fail('invalid_supplement_population');
 return {revision:p.revision,effectiveDate:p.effectiveDate};
}
function metadata(value){
 if(!positive(value.revision)||!trimmedText(value.reviewer))fail('invalid_supplement_review');
 return {revision:value.revision,reviewer:value.reviewer,reviewedAtMicroseconds:utcMicroseconds(value.reviewedAt)};
}
function selectedTokens(values){
 if(!Array.isArray(values)||values.length>managerSupplementLimits.jobs||values.some(v=>!token(v)))fail('invalid_scheduling_job_selection');
 if(new Set(values).size!==values.length)fail('duplicate_scheduling_job_selection');
 return [...values].sort(ordinal);
}
const choiceIdentity=c=>JSON.stringify([c.kind,c.kind==='job'?c.token:c.sourceId]);
export function parseManagerSupplementFile(body){
 // Reuse the accepted bounded JSON parser, including duplicate and escaped-duplicate key refusal.
 try{return parseSourcePreviewFile(body);}catch{fail('invalid_supplement_json');}
}
export function canonicalizeManagerSupplement(input,binding){
 exactShape(binding,['scope','population'],'invalid_supplement_binding');
 const expectedScope=checkedScope(binding.scope),expectedPopulation=population(binding.population);
 exactShape(input,['format','scope','population','revision','reviewer','reviewedAt','choices'],'invalid_supplement_shape');
 if(input.format!=='manager-supplement-v1')fail('unsupported_supplement_format');
 const scope=checkedScope(input.scope),boundPopulation=population(input.population);
 if(canonicalJson(scope)!==canonicalJson(expectedScope))fail('supplement_scope_mismatch');
 if(canonicalJson(boundPopulation)!==canonicalJson(expectedPopulation))fail('supplement_population_mismatch');
 if(!Array.isArray(input.choices)||input.choices.length>managerSupplementLimits.choices)fail('supplement_choice_limit');
 if(Buffer.byteLength(canonicalJson(input))>managerSupplementLimits.bytes)fail('supplement_byte_limit');
 const seen=new Set(),choices=input.choices.map(c=>{
  const reviewKeys=['kind','revision','reviewer','reviewedAt'];let result;
  if(c?.kind==='job'){
   exactShape(c,[...reviewKeys,'token','department','position','allowScheduling'],'invalid_supplement_choice');
   if(!token(c.token)||!trimmedText(c.department)||!trimmedText(c.position)||typeof c.allowScheduling!=='boolean')fail('invalid_supplement_job');
   result={kind:'job',token:c.token,department:c.department,position:c.position,allowScheduling:c.allowScheduling,...metadata(c)};
  }else if(c?.kind==='member'){
   exactShape(c,[...reviewKeys,'sourceId','primaryJobToken','schedulingJobTokens','scheduleOnly'],'invalid_supplement_choice');
   if(!sourceUuid(c.sourceId)||!token(c.primaryJobToken)||typeof c.scheduleOnly!=='boolean')fail('invalid_supplement_member');
   result={kind:'member',sourceId:c.sourceId,primaryJobToken:c.primaryJobToken,schedulingJobTokens:selectedTokens(c.schedulingJobTokens),scheduleOnly:c.scheduleOnly,...metadata(c)};
  }else fail('invalid_supplement_choice');
  const key=choiceIdentity(result);if(seen.has(key))fail('duplicate_supplement_choice');seen.add(key);return result;
 });
 choices.sort((a,b)=>ordinal(a.kind,b.kind)||ordinal(a.kind==='job'?a.token:a.sourceId,b.kind==='job'?b.token:b.sourceId));
 // Namespace is fixed by the envelope. Canonical timestamps use exact UTC microseconds, not display strings.
 const canonical={format:input.format,scope,population:boundPopulation,...metadata(input),choices};
 return {canonical,digest:contentDigest(canonical),...flags()};
}
function targetKeys(values){
 if(!Array.isArray(values)||values.length>2000||values.some(v=>!trimmedText(v))||new Set(values).size!==values.length)fail('invalid_supplement_target_configuration');
 return new Set(values);
}
export function reviewManagerSupplementSelections(input,binding,providerMembers,configuration){
 const normalized=canonicalizeManagerSupplement(input,binding),c=normalized.canonical;
 exactShape(configuration,['departments','jobs'],'invalid_supplement_target_configuration');
 const departments=targetKeys(configuration.departments),positions=targetKeys(configuration.jobs);
 if(!Array.isArray(providerMembers)||providerMembers.length>managerSupplementLimits.members)fail('supplement_member_limit');
 if(!providerMembers.length)fail('empty_supplement_provider_projection');
 canonicalJson(providerMembers);
 const memberIds=new Set(),allTokens=new Set(),descriptions=new Map();
 const members=providerMembers.map(m=>{
  exactShape(m,['sourceId','jobs'],'invalid_supplement_provider_projection');
  if(!sourceUuid(m.sourceId)||memberIds.has(m.sourceId.toLowerCase()))fail('invalid_supplement_provider_member');memberIds.add(m.sourceId.toLowerCase());
  const jobs=canonicalJobPairs(m.jobs);for(const j of jobs){allTokens.add(j.token);if(!descriptions.has(j.token))descriptions.set(j.token,new Set());descriptions.get(j.token).add(j.description);}
  return {sourceId:m.sourceId,jobs};
 });
 const jobs=new Map(c.choices.filter(x=>x.kind==='job').map(x=>[x.token,x]));
 const choices=new Map(c.choices.filter(x=>x.kind==='member').map(x=>[x.sourceId,x]));
 const used=new Set([...jobs.values()].filter(j=>allTokens.has(j.token)).map(choiceIdentity)),rows=[];
 for(const member of members){
  const issues=[],add=(code,value)=>{const finding={code,...(value===undefined?{}:{token:value})};if(!issues.some(x=>JSON.stringify(x)===JSON.stringify(finding)))issues.push(finding);};
  const assigned=new Set(member.jobs.map(j=>j.token)),choice=choices.get(member.sourceId);
  if(!assigned.size)add('source_jobs_missing');
  else{
   for(const j of member.jobs){if(!sourceUuid(j.token))add('job_token_unresolved',j.token);if(descriptions.get(j.token).size>1)add('job_token_description_conflict',j.token);}
   if(!choice)add('member_supplement_required');
   else{
    used.add(choiceIdentity(choice));const primary=jobs.get(choice.primaryJobToken);
    if(!assigned.has(choice.primaryJobToken))add('primary_job_not_reported',choice.primaryJobToken);
    if(!primary)add('primary_job_mapping_required',choice.primaryJobToken);
    const checkConfiguration=job=>{
     used.add(choiceIdentity(job));if(!departments.has(job.department)||!positions.has(job.position))add('target_job_configuration_required',job.token);
    };
    if(primary)checkConfiguration(primary);
    const selected=[];
    for(const selectedToken of choice.schedulingJobTokens){
     if(!assigned.has(selectedToken))add('scheduling_job_not_reported',selectedToken);
     const job=jobs.get(selectedToken);if(!job){add('job_mapping_required',selectedToken);continue;}
     checkConfiguration(job);if(!job.allowScheduling)add('scheduling_job_not_allowed',selectedToken);
     if(primary&&job.department!==primary.department)add('cross_department_scheduling_review',selectedToken);
     selected.push(job.position);
    }
    if(new Set(selected).size!==selected.length)add('duplicate_target_scheduling_job');
    if(!issues.length)rows.push({sourceId:member.sourceId,status:'reviewable',issues:[],proposed:{department:primary.department,position:primary.position,scheduleJobs:selected.sort(ordinal),scheduleOnly:choice.scheduleOnly}});
   }
  }
  if(issues.length){issues.sort((a,b)=>ordinal(a.code,b.code)||ordinal(a.token??'',b.token??''));rows.push({sourceId:member.sourceId,status:issues.every(i=>i.code==='source_jobs_missing')?'review_required':'blocked',issues});}
 }
 const issues=c.choices.filter(x=>!used.has(choiceIdentity(x))).map(x=>({code:'unused_supplement_choice',kind:x.kind,key:x.kind==='job'?x.token:x.sourceId}));
 rows.sort((a,b)=>ordinal(a.sourceId,b.sourceId));
 return {stage:'manager-supplement-selection-review',scope:c.scope,population:c.population,supplementDigest:normalized.digest,status:rows.some(x=>x.status==='blocked')?'blocked':issues.length||rows.some(x=>x.status==='review_required')?'review_required':'reviewable',rows,issues,...flags(),requires:['verified-source-provenance','current-authorized-target-read','identity-and-alias-review','V3-preview-bridge']};
}
