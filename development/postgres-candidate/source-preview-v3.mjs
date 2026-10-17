// Pure roster-only V3 comparison. No files, network, database, authority lookup or write path.
import {exactShape,trimmedText,sourceUuid,checkedToastScope,canonicalJson,contentDigest,sourceEncoding} from './source-fingerprint.mjs';
import {validateToastRosterPreparation} from './toast-roster-preparation.mjs';
import {reviewManagerSupplementSelections} from './manager-supplement.mjs';
import {validateSourceTarget,memberIdentityIssues,compareSourceMember} from './source-preview.mjs';
const fail=code=>{throw new TypeError(code);};
const revision=v=>Number.isSafeInteger(v)&&v>0&&v<2147483647;
const ordinal=(a,b)=>a<b?-1:a>b?1:0;
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const version=value=>{
 exactShape(value,['kind','encoding','algorithm','value'],'invalid_v3_source_version');
 if(value.kind!=='content_fingerprint'||value.encoding!==sourceEncoding||value.algorithm!=='sha256'||!hash(value.value))fail('unsupported_v3_source_version');
 return {...value};
};
const statuses=['new','unchanged','changed','omitted','blocked','review_required'];
export function previewSourceMappingV3(input){
 canonicalJson(input);exactShape(input,['version','preparation','supplement','mappings','target','accessFence'],'invalid_v3_snapshot');
 if(input.version!==3)fail('unsupported_v3_snapshot');if(!trimmedText(input.accessFence))fail('invalid_v3_access_fence');
 const preparation=validateToastRosterPreparation(input.preparation),source=preparation.source;
 const scope=Object.fromEntries(['organizationId','system','tenant','storeId','externalStoreId','timezone','sourceFormat','transformVersion'].map(k=>[k,source[k]]));
 const {people,stores,hasTarget}=validateSourceTarget(input.target,scope.organizationId,true),store=stores.get(scope.storeId);
 // Always use the entire verified artifact; there is deliberately no source-selection parameter.
 const binding={scope:Object.fromEntries(['organizationId','system','tenant','storeId','externalStoreId'].map(k=>[k,scope[k]])),population:{revision:preparation.provenance.population.revision,effectiveDate:preparation.provenance.population.effectiveDate}};
 const selection=reviewManagerSupplementSelections(input.supplement,binding,source.records.map(r=>({sourceId:r.sourceId,jobs:r.jobs})),store?{departments:store.departments,jobs:store.jobs}:{departments:[],jobs:[]});
 if(!Array.isArray(input.mappings)||input.mappings.length>8000)fail('v3_mapping_limit');
 const aliases=new Map(),sourceKeys=new Set(),targetKeys=new Set();
 for(const m of input.mappings){
  exactShape(m,['scope','kind','sourceId','sourceVersion','targetId','personId','mappingRevision','expectedTargetRevision'],'invalid_v3_mapping');
  checkedToastScope(m.scope);if(canonicalJson(m.scope)!==canonicalJson(scope))fail('v3_mapping_scope_mismatch');
  if(m.kind!=='member'||!sourceUuid(m.sourceId)||!sourceUuid(m.targetId)||!sourceUuid(m.personId)||!revision(m.mappingRevision)||m.expectedTargetRevision!==null&&!revision(m.expectedTargetRevision))fail('invalid_v3_mapping');
  version(m.sourceVersion);if(sourceKeys.has(m.sourceId.toLowerCase())||targetKeys.has(m.targetId.toLowerCase()))fail('duplicate_v3_mapping');
  aliases.set(m.sourceId,m);sourceKeys.add(m.sourceId.toLowerCase());targetKeys.add(m.targetId.toLowerCase());
 }
 const issues=[],rows=[],represented=new Set(),used=new Set(),countsByPerson=new Map(),selectionById=new Map(selection.rows.map(r=>[r.sourceId,r]));
 const add=(code,sourceId=null,severity='blocking',details={})=>issues.push({code,severity,storeId:scope.storeId,kind:sourceId===null?'scope':'member',sourceId,...details});
 // Active-only/unverified population is an explicit review obligation, never all-employee coverage.
 add('active_population_review_required',null,'review_required');
 if(!store)add('target_store_mapping_required');else if(store.timezone!==scope.timezone)add('timezone_mapping_conflict');
 for(const i of selection.issues)add(i.code,i.kind==='member'?i.key:null,'review_required',{choiceKind:i.kind,choiceKey:i.key});
 for(const r of source.records){const m=aliases.get(r.sourceId);if(m){const person=m.personId.toLowerCase();countsByPerson.set(person,(countsByPerson.get(person)??0)+1);}}
 for(const r of source.records){
  const selected=selectionById.get(r.sourceId),m=aliases.get(r.sourceId),rowIssues=[],findings=new Set();let blocked=false;
  const rowAdd=(code,severity='blocking',details={})=>{const key=canonicalJson({code,severity,...details});if(findings.has(key))return;findings.add(key);if(!rowIssues.includes(code))rowIssues.push(code);if(severity==='blocking')blocked=true;add(code,r.sourceId,severity,details);};
  for(const i of selected.issues)rowAdd(i.code,i.code==='source_jobs_missing'?'review_required':'blocking',i.token===undefined?{}:{token:i.token});
  if(r.jobs.length&&preparation.provenance.pairing.mode!=='reviewed_positional_pairs')rowAdd('job_pairing_review_required');
  let existing;
  if(!m)rowAdd('identity_mapping_required');else{
   used.add(r.sourceId);const id=m.targetId.toLowerCase();represented.add(id);existing=store?.members.find(x=>x.id.toLowerCase()===id);
   if(canonicalJson(version(m.sourceVersion))!==canonicalJson(r.sourceVersion))rowAdd('source_mapping_stale');
   if(m.expectedTargetRevision!==(existing?.revision??null))rowAdd('target_revision_conflict');
   if(!existing&&hasTarget('member',id))rowAdd('target_scope_collision');
   if(existing?.active===false)rowAdd('target_membership_reactivation_review');
   const proposed={name:r.displayName,active:true,...selected.proposed};
   // Run identity checks even for unresolved jobs; configured-job checks need a valid proposal.
   for(const code of memberIdentityIssues(proposed,m,existing,store,people,countsByPerson.get(m.personId.toLowerCase()),!!selected.proposed))rowAdd(code);
  }
  rows.push({storeId:scope.storeId,kind:'member',sourceId:r.sourceId,targetId:m?.targetId.toLowerCase()??null,personId:m?.personId.toLowerCase()??null,sourceVersion:{...r.sourceVersion},mappingRevision:m?.mappingRevision??null,expectedTargetRevision:m?.expectedTargetRevision??null,...(rowIssues.length?{status:blocked?'blocked':'review_required',changedFields:[]}:compareSourceMember({name:r.displayName,active:true,...selected.proposed},existing)),issues:rowIssues});
 }
 for(const m of aliases.values())if(!used.has(m.sourceId))add('unused_mapping',m.sourceId,'review_required');
 if(store)for(const member of store.members)if(member.active&&!represented.has(member.id.toLowerCase())){add('target_record_omitted_review',null,'review_required',{targetId:member.id.toLowerCase()});rows.push({storeId:scope.storeId,kind:'member',sourceId:null,targetId:member.id.toLowerCase(),status:'omitted',changedFields:[],issues:['target_record_omitted_review']});}
 const canonicalMappings=[...aliases.values()].sort((a,b)=>ordinal(a.sourceId,b.sourceId));
 const reviewContextDigest=contentDigest({version:3,scope,provenanceDigest:preparation.provenanceDigest,supplementDigest:selection.supplementDigest,mappings:canonicalMappings,target:input.target,accessFence:input.accessFence});
 const sort=(a,b)=>ordinal(a.sourceId??'',b.sourceId??'')||ordinal(a.targetId??'',b.targetId??'')||ordinal(a.code??'',b.code??'')||ordinal(canonicalJson(a),canonicalJson(b));rows.sort(sort);issues.sort(sort);
 return {purpose:'read-only-source-mapping-preview',version:3,status:issues.some(i=>i.severity==='blocking')?'blocked':'review_required',organizationId:scope.organizationId,source:{scope,provenanceDigest:preparation.provenanceDigest,digest:preparation.provenance.normalizedSourceDigest},target:{capturedAt:input.target.capturedAt,digest:contentDigest(input.target),inputRevision:store?.inputRevision??null},mappingDigest:contentDigest(canonicalMappings),supplementDigest:selection.supplementDigest,reviewContextDigest,canApply:false,completenessCertified:false,accessProvisioned:false,requires:['verified-active-population-coverage','current-authorized-target-read','independent-identity-access-review','reviewed-application-contract'],scopes:[{storeId:scope.storeId,externalStoreId:scope.externalStoreId,timezone:scope.timezone,inputRevision:store?.inputRevision??null,families:{roster:{available:true,population:'initial_active_only',coverageClaim:'unverified',count:source.records.length},timeOff:{available:false,coverageClaim:'unavailable'}},targetContext:store&&store.timezone===scope.timezone?'supplied':'needs_review'}],rows,issues,counts:Object.fromEntries(statuses.map(status=>[status,rows.filter(r=>r.status===status).length]))};
}
