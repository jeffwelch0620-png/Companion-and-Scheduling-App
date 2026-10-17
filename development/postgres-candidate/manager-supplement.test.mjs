// Entirely fictional review evidence, independently authored; no real employee fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeManagerSupplement,parseManagerSupplementFile,reviewManagerSupplementSelections,managerSupplementLimits} from './manager-supplement.mjs';
import {contentDigest,fingerprintToastMember,toastRosterProfile} from './source-fingerprint.mjs';
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
const scope=()=>({organizationId:'fictional-org',system:'toast',tenant:'fictional-tenant',storeId:'fictional-store',externalStoreId:'fictional-external'});
const population=()=>({revision:2,effectiveDate:'2035-11-04'});
const binding=()=>({scope:scope(),population:population()});
const review=()=>({revision:1,reviewer:'fictional-reviewer',reviewedAt:'2035-11-04T12:00:00.123456Z'});
const job=(n=101)=>({kind:'job',token:id(n),department:'Kitchen',position:n===101?'Fictional Cook':'Fictional Prep',allowScheduling:true,...review()});
const member=(n=1)=>({kind:'member',sourceId:id(n),primaryJobToken:id(101),schedulingJobTokens:[id(102),id(101)],scheduleOnly:false,...review()});
const supplement=()=>({format:'manager-supplement-v1',scope:scope(),population:population(),...review(),choices:[member(),job(102),job(101)]});
const provider=(n=1)=>({sourceId:id(n),jobs:[{token:id(101),description:'Fictional Cook'},{token:id(102),description:'Fictional Prep'}]});
const configuration=()=>({departments:['Kitchen','Service'],jobs:['Fictional Cook','Fictional Prep','Fictional Host']});
const canonical=s=>canonicalizeManagerSupplement(s,binding());
const report=(s=supplement(),members=[provider()],config=configuration())=>reviewManagerSupplementSelections(s,binding(),members,config);
const choice=(s,kind,key)=>s.choices.find(c=>c.kind===kind&&(kind==='job'?c.token:c.sourceId)===id(key));
const codes=r=>r.rows[0].issues.map(x=>x.code);
const flags=r=>{for(const k of ['canApply','completenessCertified','accessProvisioned'])assert.equal(r[k],false);};

test('strict supplement canonicalization preserves explicit choices and input objects',()=>{
 const s=supplement(),b=binding(),before=structuredClone({s,b}),r=canonicalizeManagerSupplement(s,b);assert.deepEqual({s,b},before);flags(r);
 assert.equal(r.canonical.format,'manager-supplement-v1');assert.deepEqual(r.canonical.population,population());assert.equal(r.digest,contentDigest(r.canonical));assert.equal(r.canonical.reviewedAtMicroseconds,'2077790400123456');
 assert.deepEqual(r.canonical.choices.map(c=>c.kind),['job','job','member']);
});
test('choice order, JSON property order and selected-job set order do not stale a digest',()=>{
 const a=supplement(),b=supplement();b.choices.reverse();b.choices.find(c=>c.kind==='member').schedulingJobTokens.reverse();b.scope=Object.fromEntries(Object.entries(b.scope).reverse());
 assert.deepEqual(canonical(a),canonical(b));assert.deepEqual(canonical(a).canonical.choices[2].schedulingJobTokens,[id(101),id(102)]);
});
test('duplicate choice keys refuse identical and conflicting rows before report evaluation',()=>{
 for(const kind of ['job','member']){const s=supplement(),copy=structuredClone(s.choices.find(c=>c.kind===kind));s.choices.push(copy);assert.throws(()=>canonical(s),/duplicate_supplement_choice/);copy.reviewer='fictional-other';assert.throws(()=>canonical(s),/duplicate_supplement_choice/);}
});
test('duplicate selected-job tokens refuse rather than silently deduplicate',()=>{
 const s=supplement();choice(s,'member',1).schedulingJobTokens=[id(101),id(101)];assert.throws(()=>canonical(s),/duplicate_scheduling_job_selection/);
});
test('exact job token spelling is retained and token keys are not case-folded or trimmed',()=>{
 const s=supplement();s.choices=[{...job(),token:' fictional-token '},{...job(),token:'fictional-token'},{...job(),token:'FICTIONAL-TOKEN'}];const r=canonical(s);assert.equal(r.canonical.choices.length,3);assert.deepEqual(r.canonical.choices.map(c=>c.token),[' fictional-token ','FICTIONAL-TOKEN','fictional-token']);
});
test('choice decisions and every layer of review metadata bind the digest',()=>{
 const original=supplement(),before=canonical(original).digest;
 for(const edit of [s=>s.revision++,s=>s.reviewer='fictional-other',s=>s.reviewedAt='2035-11-04T12:00:00.123457Z',s=>choice(s,'job',101).department='Service',s=>choice(s,'job',101).position='Fictional Host',s=>choice(s,'job',101).allowScheduling=false,s=>choice(s,'member',1).primaryJobToken=id(102),s=>choice(s,'member',1).schedulingJobTokens=[],s=>choice(s,'member',1).scheduleOnly=true,s=>choice(s,'member',1).revision++,s=>choice(s,'job',101).reviewer='fictional-other']){const s=structuredClone(original);edit(s);assert.notEqual(canonical(s).digest,before);}
});
test('equivalent timestamp offsets share a canonical digest and microsecond changes differ',()=>{
 const a=supplement(),b=supplement();b.reviewedAt='2035-11-04T07:00:00.123456-05:00';for(const c of b.choices)c.reviewedAt=b.reviewedAt;assert.deepEqual(canonical(a),canonical(b));b.choices[0].reviewedAt='2035-11-04T07:00:00.123457-05:00';assert.notEqual(canonical(a).digest,canonical(b).digest);
});
test('population revision and effective date must match exactly before any rows are evaluated',()=>{
 for(const edit of [s=>s.population.revision++,s=>s.population.effectiveDate='2035-11-05']){const s=supplement();edit(s);assert.throws(()=>canonical(s),/supplement_population_mismatch/);assert.throws(()=>report(s),/supplement_population_mismatch/);}
 const s=supplement(),b=binding();s.population.revision++;b.population.revision++;assert.notEqual(canonicalizeManagerSupplement(s,b).digest,canonical(supplement()).digest);
});
test('namespace binding prevents another store, tenant or organization from satisfying choices',()=>{
 for(const key of Object.keys(scope()).filter(k=>k!=='system')){const s=supplement();s.scope[key]='fictional-other';assert.throws(()=>canonical(s),/supplement_scope_mismatch/);const b=binding();b.scope[key]='fictional-other';assert.notEqual(canonicalizeManagerSupplement(s,b).digest,canonical(supplement()).digest);}
});
test('unknown fields, grants, unsupported formats and row scope overrides fail closed',()=>{
 for(const edit of [s=>s.format='unknown',s=>s.capabilities=['schedule.publish'],s=>s.scope.extra='unknown',s=>s.population.extra=true,s=>s.choices[0].scope=scope(),s=>s.choices[1].permissions=['owner']]){const s=supplement();edit(s);assert.throws(()=>canonical(s),TypeError);}
});
test('missing or invalid reviewer, revision, date and population values are never defaulted',()=>{
 for(const edit of [s=>delete s.reviewer,s=>s.revision=0,s=>s.reviewedAt='2035-02-30T00:00:00Z',s=>s.choices[0].reviewer='',s=>s.choices[1].revision=1.5,s=>s.population.effectiveDate='2035-02-30',s=>s.population.revision=0]){const s=supplement();edit(s);assert.throws(()=>canonical(s),TypeError);}
});
test('explicit empty scheduling selection differs from missing or invalid selections',()=>{
 const s=supplement();choice(s,'member',1).schedulingJobTokens=[];assert.equal(canonical(s).canonical.choices[2].schedulingJobTokens.length,0);
 for(const value of [null,undefined,'', [' ']]){const b=supplement();choice(b,'member',1).schedulingJobTokens=value;assert.throws(()=>canonical(b),TypeError);}
});
test('schema limits refuse oversized sets, unknown nested data and non-JSON structures',()=>{
 const s=supplement();s.choices=Array.from({length:managerSupplementLimits.choices+1},()=>job());assert.throws(()=>canonical(s),/supplement_choice_limit/);
 const b=supplement();choice(b,'member',1).schedulingJobTokens=Array.from({length:101},(_,i)=>id(1000+i));assert.throws(()=>canonical(b),/invalid_scheduling_job_selection/);
 const c=supplement();c.choices[0].primaryJobToken='x'.repeat(201);assert.throws(()=>canonical(c),TypeError);
 const d=supplement();d.choices=new Array(2);assert.throws(()=>canonical(d),TypeError);
});
test('bounded JSON parser refuses duplicate, escaped duplicate and malformed keys without leaking content',()=>{
 for(const text of ['{"reviewer":"fictional-secret","reviewer":"other"}','{"reviewer":1,"\\u0072eviewer":2}','{"secret":"fictional-secret",', ' '.repeat(managerSupplementLimits.bytes+1)])assert.throws(()=>parseManagerSupplementFile(text),e=>e.message==='invalid_supplement_json'&&!e.message.includes('fictional-secret'));
 assert.deepEqual(parseManagerSupplementFile(JSON.stringify(supplement())),supplement());
});
test('valid same-department choices produce the mapped primary membership fields only',()=>{
 const r=report();assert.equal(r.status,'reviewable');assert.deepEqual(r.rows[0].proposed,{department:'Kitchen',position:'Fictional Cook',scheduleJobs:['Fictional Cook','Fictional Prep'],scheduleOnly:false});flags(r);assert.ok(r.requires.includes('identity-and-alias-review'));
});
test('nonschedulable primary still supplies department and position with no scheduling eligibility',()=>{
 const s=supplement();choice(s,'job',101).allowScheduling=false;choice(s,'member',1).schedulingJobTokens=[];const r=report(s);assert.equal(r.rows[0].status,'reviewable');assert.deepEqual(r.rows[0].proposed,{department:'Kitchen',position:'Fictional Cook',scheduleJobs:[],scheduleOnly:false});
});
test('nonschedulable primary permits a separately selected schedulable job in its department',()=>{
 const s=supplement();choice(s,'job',101).allowScheduling=false;choice(s,'member',1).schedulingJobTokens=[id(102)];assert.deepEqual(report(s).rows[0].proposed.scheduleJobs,['Fictional Prep']);
});
test('cross-department scheduling blocks the row without changing its primary department',()=>{
 const s=supplement();choice(s,'job',102).department='Service';const r=report(s);assert.ok(codes(r).includes('cross_department_scheduling_review'));assert.equal(r.rows[0].status,'blocked');assert.ok(!Object.hasOwn(r.rows[0],'proposed'));assert.equal(choice(s,'job',101).department,'Kitchen');
});
test('unmapped primary blocks even when no scheduling jobs are selected',()=>{
 const s=supplement();s.choices=s.choices.filter(c=>c.kind!=='job'||c.token!==id(101));choice(s,'member',1).schedulingJobTokens=[];const r=report(s);assert.deepEqual(codes(r),['primary_job_mapping_required']);assert.equal(r.status,'blocked');
});
test('missing selected-job mapping is distinct from a missing configured target department or position',()=>{
 const a=supplement();a.choices=a.choices.filter(c=>c.kind!=='job'||c.token!==id(102));assert.deepEqual(codes(report(a)),['job_mapping_required']);
 for(const edit of [s=>choice(s,'job',101).department='Unconfigured',s=>choice(s,'job',102).position='Unconfigured']){const s=supplement();edit(s);const r=report(s);assert.ok(codes(r).includes('target_job_configuration_required'));assert.ok(!codes(r).includes('job_mapping_required'));}
});
test('primary and scheduling tokens must belong to the actual provider job set',()=>{
 const s=supplement();choice(s,'member',1).primaryJobToken=id(103);s.choices.push(job(103));assert.ok(codes(report(s)).includes('primary_job_not_reported'));
 const b=supplement();choice(b,'member',1).schedulingJobTokens=[id(103)];b.choices.push(job(103));assert.ok(codes(report(b)).includes('scheduling_job_not_reported'));
});
test('a selected job with allowScheduling false blocks without clearing the selection',()=>{
 const s=supplement();choice(s,'job',102).allowScheduling=false;assert.ok(codes(report(s)).includes('scheduling_job_not_allowed'));assert.deepEqual(choice(s,'member',1).schedulingJobTokens,[id(102),id(101)]);
});
test('no-job employees are retained among valid rows as review-required without guessed defaults',()=>{
 const s=supplement();s.choices.push(member(2));const r=report(s,[provider(1),{sourceId:id(2),jobs:[]}]);assert.equal(r.rows.length,2);assert.equal(r.rows[0].status,'reviewable');assert.equal(r.rows[1].status,'review_required');assert.deepEqual(r.rows[1].issues,[{code:'source_jobs_missing'}]);assert.ok(!Object.hasOwn(r.rows[1],'proposed'));flags(r);
});
test('missing member choices block their rows but retain valid coworkers',()=>{
 const r=report(supplement(),[provider(1),provider(2)]);assert.equal(r.rows.length,2);assert.equal(r.rows[0].status,'reviewable');assert.equal(r.rows[1].status,'blocked');assert.deepEqual(r.rows[1].issues,[{code:'member_supplement_required'}]);
});
test('unknown token shapes and conflicting provider descriptions cannot be approved by supplying a mapping',()=>{
 const s=supplement(),p=provider();p.jobs[0].token='unknown-fictional';choice(s,'job',101).token='unknown-fictional';choice(s,'member',1).primaryJobToken='unknown-fictional';choice(s,'member',1).schedulingJobTokens=[];assert.ok(codes(report(s,[p])).includes('job_token_unresolved'));
 const a=provider(1),b=provider(2);b.jobs[0].description='Fictional Conflict';const r=report(supplement(),[a,b]);assert.ok(r.rows.every(row=>row.issues.some(x=>x.code==='job_token_description_conflict')));
});
test('unused source choices remain explicit and mapped but unselected reported jobs are retained normally',()=>{
 const s=supplement();choice(s,'member',1).schedulingJobTokens=[];assert.equal(report(s).issues.length,0);s.choices.push(job(104));const r=report(s);assert.equal(r.status,'review_required');assert.deepEqual(r.issues,[{code:'unused_supplement_choice',kind:'job',key:id(104)}]);
});
test('multiple provider tokens cannot silently collapse into duplicate canonical scheduling jobs',()=>{
 const s=supplement();choice(s,'job',102).position='Fictional Cook';assert.ok(codes(report(s)).includes('duplicate_target_scheduling_job'));
});
test('provider/configuration shape, duplicate source GUIDs and bounds fail without partial reports',()=>{
 assert.throws(()=>report(supplement(),[provider(),provider()]),/invalid_supplement_provider_member/);
 assert.throws(()=>report(supplement(),[]),/empty_supplement_provider_projection/);
 assert.throws(()=>report(supplement(),Array.from({length:2001},(_,i)=>provider(i+1))),/supplement_member_limit/);
 for(const config of [{departments:['Kitchen'],jobs:['Fictional Cook','Fictional Cook']},{departments:['Kitchen'],jobs:[],extra:true}])assert.throws(()=>report(supplement(),[provider()],config),/invalid_supplement_target_configuration/);
 const p=provider();p.name='Unexpected source value';assert.throws(()=>report(supplement(),[p]),/invalid_supplement_provider_projection/);
});
test('supplement edits change only supplement digests, never provider fingerprints or caller data',()=>{
 const s=supplement(),b=binding(),p=[provider()],config=configuration(),before=structuredClone({s,b,p,config});report(s,p,config);assert.deepEqual({s,b,p,config},before);
 const scopeWithProfile={...scope(),timezone:'America/New_York',...toastRosterProfile},m={sourceId:id(1),firstName:'Fictional',lastName:'Example',jobs:provider().jobs},version=fingerprintToastMember(scopeWithProfile,m),old=canonical(s).digest;choice(s,'member',1).scheduleOnly=true;assert.notEqual(canonical(s).digest,old);assert.deepEqual(fingerprintToastMember(scopeWithProfile,m),version);assert.equal(report(s).rows[0].proposed.scheduleOnly,true);flags(report(s));
});

const tokenReview=(value=id(101),descriptions=['Fictional Cook'],semantics='provider_job_key')=>({kind:'tokenReview',token:value,semantics,observedDescriptions:descriptions,canonicalDescription:null,...review()});
function nonUuidExample(){
 const s=supplement(),p=provider(),value='fictional-provider-key';p.jobs[0].token=value;choice(s,'job',101).token=value;choice(s,'member',1).primaryJobToken=value;choice(s,'member',1).schedulingJobTokens=[value];return {s,p,value};
}
test('reviewed provider semantics resolve an exact non-UUID token without changing source evidence',()=>{
 const {s,p,value}=nonUuidExample(),before=structuredClone(p);assert.ok(codes(report(s,[p])).includes('job_token_unresolved'));
 s.choices.push(tokenReview(value));const r=report(s,[p]);assert.equal(r.status,'reviewable');assert.equal(r.rows[0].proposed.position,'Fictional Cook');assert.deepEqual(p,before);flags(r);
});
test('retired and non-job tokens refuse primary and scheduling selection for every token shape',()=>{
 for(const semantics of ['retired_job','not_a_job'])for(const uuid of [true,false]){
  const {s,p,value}=nonUuidExample(),key=uuid?id(101):value;if(uuid){p.jobs[0].token=key;s.choices.find(c=>c.kind==='job'&&c.token===value).token=key;choice(s,'member',1).primaryJobToken=key;choice(s,'member',1).schedulingJobTokens=[key];}
  s.choices.push(tokenReview(key,['Fictional Cook'],semantics));const r=report(s,[p]);for(const code of ['primary_job_token_excluded','scheduling_job_token_excluded','job_token_mapping_excluded'])assert.ok(codes(r).includes(code));assert.equal(r.status,'blocked');assert.ok(!r.rows[0].proposed);
 }
});
test('reviewed excluded unselected tokens remain in provider fingerprints without blocking a valid job',()=>{
 const {s,p,value}=nonUuidExample();s.choices=s.choices.filter(c=>c.kind!=='job'||c.token!==value);choice(s,'member',1).primaryJobToken=id(102);choice(s,'member',1).schedulingJobTokens=[id(102)];s.choices.push(tokenReview(value,['Fictional Cook'],'retired_job'));
 const original=structuredClone(p),scopeWithProfile={...scope(),timezone:'America/New_York',...toastRosterProfile},m={sourceId:p.sourceId,firstName:'Fictional',lastName:'Example',jobs:p.jobs},hash=fingerprintToastMember(scopeWithProfile,m);
 assert.equal(report(s,[p]).status,'reviewable');assert.deepEqual(p,original);assert.deepEqual(fingerprintToastMember(scopeWithProfile,m),hash);assert.notDeepEqual(fingerprintToastMember(scopeWithProfile,{...m,jobs:p.jobs.slice(1)}),hash);
});
test('token review duplicate identities refuse identical or conflicting decisions',()=>{
 const s=supplement();s.choices.push(tokenReview(),tokenReview());assert.throws(()=>canonical(s),/duplicate_supplement_choice/);s.choices.at(-1).semantics='retired_job';assert.throws(()=>canonical(s),/duplicate_supplement_choice/);
});
test('token review and observed-description sets canonicalize independent of input ordering',()=>{
 const a=supplement();a.choices.push({...tokenReview(id(101),['Fictional Other','Fictional Cook']),canonicalDescription:'Fictional Canonical'},tokenReview(id(102),['Fictional Prep']));const b=structuredClone(a);b.choices.reverse();b.choices.find(c=>c.kind==='tokenReview'&&c.token===id(101)).observedDescriptions.reverse();assert.deepEqual(canonical(a),canonical(b));
});
test('token review semantics, description acknowledgement and review metadata bind only the supplement digest',()=>{
 const a=supplement();a.choices.push(tokenReview());const before=canonical(a).digest,m={sourceId:id(1),firstName:'Fictional',lastName:'Example',jobs:provider().jobs},sourceScope={...scope(),timezone:'America/New_York',...toastRosterProfile},sourceVersion=fingerprintToastMember(sourceScope,m);
 for(const edit of [c=>c.semantics='retired_job',c=>c.observedDescriptions=['Fictional Changed'],c=>c.canonicalDescription='Fictional Display',c=>c.revision++,c=>c.reviewer='fictional-other',c=>c.reviewedAt='2035-11-04T12:00:00.123457Z']){const b=structuredClone(a);edit(b.choices.at(-1));assert.notEqual(canonical(b).digest,before);assert.deepEqual(fingerprintToastMember(sourceScope,m),sourceVersion);}
});
test('description conflicts require explicit canonical display acknowledgement of the full observed set',()=>{
 const a=provider(),b=provider(2);b.jobs[0].description='Fictional Conflict';const s=supplement();s.choices.push(member(2),tokenReview(id(101),['Fictional Cook','Fictional Conflict']));
 assert.ok(report(s,[a,b]).rows.every(r=>r.issues.some(i=>i.code==='job_token_description_conflict')));
 s.choices.at(-1).canonicalDescription='Fictional Reviewed Display';assert.equal(report(s,[a,b]).status,'reviewable');assert.equal(a.jobs[0].description,'Fictional Cook');assert.equal(b.jobs[0].description,'Fictional Conflict');
});
test('new or changed observed descriptions stale prior review including UUID-shaped and excluded tokens',()=>{
 for(const semantics of ['provider_job_key','retired_job','not_a_job']){
  const s=supplement();s.choices.push(tokenReview(id(101),['Fictional Cook'],semantics));const p=provider();p.jobs[0].description='Fictional Changed';assert.ok(codes(report(s,[p])).includes('job_token_review_stale'));
 }
 const {s,p,value}=nonUuidExample();s.choices.push(tokenReview(value));p.jobs[0].description='Fictional Changed';const r=report(s,[p]);assert.ok(codes(r).includes('job_token_unresolved'));assert.ok(codes(r).includes('job_token_review_stale'));
});
test('full-roster conflict indexing flags selected members even when the peer has no member choice',()=>{
 const s=supplement(),a=provider(),b=provider(2);b.jobs[0].description='Fictional Conflict';s.choices.push({...tokenReview(),canonicalDescription:'Fictional Display'});const r=report(s,[a,b]);assert.ok(r.rows[0].issues.some(i=>i.code==='job_token_review_stale'));assert.ok(r.rows[0].issues.some(i=>i.code==='job_token_description_conflict'));assert.ok(r.rows[1].issues.some(i=>i.code==='member_supplement_required'));
});
test('token review identities preserve exact tokens and cannot resolve another spelling',()=>{
 const {s,p,value}=nonUuidExample();s.choices.push(tokenReview(value.toUpperCase()));const r=report(s,[p]);assert.ok(codes(r).includes('job_token_unresolved'));assert.ok(r.issues.some(i=>i.kind==='tokenReview'&&i.code==='unused_supplement_choice'));
});
test('token review shape, metadata and observed descriptions fail closed',()=>{
 for(const edit of [c=>c.semantics='guess',c=>c.observedDescriptions=[],c=>c.observedDescriptions=['Fictional Cook','Fictional Cook'],c=>c.observedDescriptions=[' Fictional Cook'],c=>c.canonicalDescription='',c=>delete c.canonicalDescription,c=>c.revision=0,c=>c.reviewer='',c=>c.reviewedAt='2035-11-04',c=>c.grants=['owner']]){const s=supplement(),c=tokenReview();edit(c);s.choices.push(c);assert.throws(()=>canonical(s),TypeError);}
});
test('token reviews are scoped by both provider namespace and reviewed population',()=>{
 const s=supplement();s.choices.push(tokenReview());for(const edit of [b=>b.scope.tenant='fictional-other',b=>b.scope.storeId='fictional-other',b=>b.population.revision++,b=>b.population.effectiveDate='2035-11-05']){const b=binding();edit(b);assert.throws(()=>canonicalizeManagerSupplement(s,b),/supplement_(scope|population)_mismatch/);}
});
test('no-job member choices receive their specific diagnostic without generic unused duplication',()=>{
 const s=supplement();s.choices.push(member(2));const r=report(s,[provider(),{sourceId:id(2),jobs:[]}]);assert.deepEqual(r.issues,[{code:'member_choice_for_no_job_employee',kind:'member',key:id(2)}]);assert.equal(r.rows[1].status,'review_required');assert.deepEqual(r.rows[1].issues,[{code:'source_jobs_missing'}]);assert.ok(!r.rows[1].proposed);
});
