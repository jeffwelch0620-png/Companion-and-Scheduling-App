// Entirely fictional sources, review facts and identities; no private roster-derived fixtures.
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {normalizeToastRoster,toastRosterHeaders} from './toast-roster-normalizer.mjs';
import {validateToastRosterPreparation,prepareToastRoster} from './toast-roster-preparation.mjs';
import {previewSourceMappingV3} from './source-preview-v3.mjs';
import {previewSourceMapping} from './source-preview.mjs';
import {toastRosterProfile,contentDigest} from './source-fingerprint.mjs';
const id=n=>'30000000-0000-0000-0000-'+String(n).padStart(12,'0');
const scope=()=>({organizationId:'fictional-org',system:'toast',tenant:'fictional-tenant',storeId:'fictional-store',externalStoreId:'fictional-external',timezone:'America/New_York',...toastRosterProfile});
const context=()=>({scope:scope(),capturedAt:'2035-11-04T12:00:00.123456Z',population:{kind:'initial_active_only',effectiveDate:'2035-11-04',archivedHistory:'excluded',filterEvidence:'Fictional active review',reviewer:'fictional-reviewer',revision:1},pairing:{mode:'reviewed_positional_pairs',reviewer:'fictional-reviewer',revision:1},location:{expectedLabel:'Fictional Location',reviewer:'fictional-reviewer',revision:1}});
const row=(n=1)=>['Fictional Location',id(n),'Example','Fictional','','','',id(101),'Fictional Cook',''];
const bytes=rows=>Buffer.from([toastRosterHeaders,...rows].map(r=>r.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
const preparation=(rows=[row()],ctx=context())=>normalizeToastRoster(bytes(rows),ctx);
const review=()=>({revision:1,reviewer:'fictional-reviewer',reviewedAt:'2035-11-04T12:00:00.123456Z'});
const memberChoice=(n=1)=>({kind:'member',sourceId:id(n),primaryJobToken:id(101),schedulingJobTokens:[id(101)],scheduleOnly:false,...review()});
const supplement=()=>({format:'manager-supplement-v1',scope:Object.fromEntries(Object.entries(scope()).filter(([k])=>!['timezone','sourceFormat','transformVersion'].includes(k))),population:{revision:1,effectiveDate:'2035-11-04'},...review(),choices:[{kind:'job',token:id(101),department:'Kitchen',position:'Fictional Cook',allowScheduling:true,...review()},memberChoice()]});
const targetMember=(n=1)=>({id:id(200+n),personId:id(300+n),revision:2,name:'Fictional Example',department:'Kitchen',position:'Fictional Cook',active:true,scheduleOnly:false,scheduleJobs:['Fictional Cook']});
const person=(n=1)=>({id:id(300+n),name:'Fictional Example',active:true});
const store=()=>({id:'fictional-store',timezone:'America/New_York',departments:['Kitchen','Service'],jobs:['Fictional Cook','Fictional Host'],inputRevision:7,members:[],timeOff:null});
const alias=(p,n=1)=>({scope:scope(),kind:'member',sourceId:id(n),sourceVersion:p.source.records.find(r=>r.sourceId===id(n)).sourceVersion,targetId:id(200+n),personId:id(300+n),mappingRevision:1,expectedTargetRevision:null});
const fixture=()=>{const p=preparation();return {version:3,preparation:p,supplement:supplement(),mappings:[alias(p)],target:{organizationId:'fictional-org',capturedAt:'2035-11-04T13:00:00Z',people:[person()],stores:[store()]},accessFence:'fictional-access-1'};};
const codes=r=>r.issues.map(i=>i.code);
const flags=r=>{for(const k of ['canApply','completenessCertified','accessProvisioned'])assert.equal(r[k],false);};
const rehash=p=>{p.provenance.normalizedSourceDigest=contentDigest(p.source);p.provenanceDigest=contentDigest(p.provenance);return p;};

test('preparation recomputation round-trips supported artifacts without mutating them',()=>{
 const p=preparation([row(2),row(1)]),before=structuredClone(p);assert.deepEqual(validateToastRosterPreparation(p),p);assert.deepEqual(p,before);flags(validateToastRosterPreparation(p));
});
test('every derived record field, source fingerprint, coverage count and grant flag is recomputed',()=>{
 for(const edit of [p=>p.source.records[0].displayName='Fictional Other',p=>p.source.records[0].firstName='Changed',p=>p.source.records[0].sourceVersion.value='0'.repeat(64),p=>p.source.records[0].status='ready',p=>p.source.records[0].issues=[],p=>p.source.families.roster.count++,p=>p.source.families.roster.coverageClaim='complete',p=>p.source.families.timeOff.available=true,p=>p.canApply=true,p=>p.completenessCertified=true,p=>p.accessProvisioned=true]){const p=preparation();edit(p);rehash(p);assert.throws(()=>validateToastRosterPreparation(p),TypeError);}
});
test('changed normalized/provenance digests and unknown nested fields refuse with fixed errors',()=>{
 for(const edit of [p=>p.provenance.normalizedSourceDigest='0'.repeat(64),p=>p.provenanceDigest='f'.repeat(64),p=>p.source.records[0].email='fictional-secret@example.invalid',p=>p.source.extra='fictional-secret',p=>p.provenance.extra=true,p=>p.extra=true]){const p=preparation();edit(p);assert.throws(()=>validateToastRosterPreparation(p),e=>e instanceof TypeError&&!e.message.includes('fictional-secret'));}
});
test('unsupported transforms, source formats and source-version modes never become counters',()=>{
 for(const edit of [p=>p.source.transformVersion='toast-roster-provider-v1',p=>p.source.sourceFormat='unknown',p=>p.source.records[0].sourceVersion={kind:'provider_revision',value:1},p=>p.format='unknown']){const p=preparation();edit(p);rehash(p);assert.throws(()=>validateToastRosterPreparation(p),TypeError);}
});
test('duplicate scoped employee IDs, duplicate pairs, omitted rows and reordered canonical records refuse',()=>{
 for(const edit of [p=>p.source.records.push(structuredClone(p.source.records[0])),p=>p.source.records[0].jobs.push({...p.source.records[0].jobs[0]}),p=>p.source.records.pop(),p=>p.source.records.reverse()]){const p=preparation([row(1),row(2)]);edit(p);assert.throws(()=>validateToastRosterPreparation(p),TypeError);}
});
test('capture microseconds preserve equivalent exact instants including pre-epoch values',()=>{
 for(const capturedAt of ['2035-11-04T07:00:00.123456-05:00','1969-12-31T23:59:59.999999Z']){const c=context();c.capturedAt=capturedAt;const p=preparation([row()],c);assert.deepEqual(validateToastRosterPreparation(p),p);}
 for(const value of ['01','-0','1.1','not-an-instant','999999999999999999999999']){const p=preparation();p.provenance.capturedAtMicroseconds=value;rehash(p);assert.throws(()=>validateToastRosterPreparation(p),TypeError);}
});
test('self-consistent supplied evidence is not authentication or original-byte verification',()=>{
 const c=context(),members=[{sourceId:id(1),firstName:'Fictional',lastName:'Changed',jobs:[{token:id(101),description:'Fictional Cook'}]}];const p=prepareToastRoster(members,c,'a'.repeat(64));assert.deepEqual(validateToastRosterPreparation(p),p);flags(p);
});
test('preparation bounds and required context refuse rather than truncating',()=>{
 const p=preparation();p.source.records=Array.from({length:2001},()=>p.source.records[0]);assert.throws(()=>validateToastRosterPreparation(p),TypeError);
 for(const edit of [p=>p.provenance.population.archivedHistory='included',p=>p.provenance.pairing.mode='guessed',p=>p.provenance.rawFileSha256='ABC',p=>p.provenance.location.revision=0]){const q=preparation();edit(q);rehash(q);assert.throws(()=>validateToastRosterPreparation(q),TypeError);}
});
test('V3 typed comparison proposes a new membership while active coverage and leave stay explicit',()=>{
 const input=fixture(),before=structuredClone(input),r=previewSourceMappingV3(input);assert.deepEqual(input,before);flags(r);assert.equal(r.version,3);assert.equal(r.rows[0].status,'new');assert.deepEqual(r.rows[0].sourceVersion,input.mappings[0].sourceVersion);assert.ok(!Object.hasOwn(r.rows[0],'sourceRevision'));assert.equal(r.status,'review_required');assert.ok(codes(r).includes('active_population_review_required'));assert.equal(r.scopes[0].families.timeOff.available,false);assert.equal(r.scopes[0].families.roster.coverageClaim,'unverified');
});
test('V3 unchanged and changed comparisons retain target revisions and canonical scheduling sets',()=>{
 const input=fixture();input.target.stores[0].members=[targetMember()];input.mappings[0].expectedTargetRevision=2;assert.equal(previewSourceMappingV3(input).rows[0].status,'unchanged');input.target.stores[0].members[0].scheduleOnly=true;const r=previewSourceMappingV3(input);assert.equal(r.rows[0].status,'changed');assert.deepEqual(r.rows[0].changedFields,['scheduleOnly']);
});
test('name-component or reported-job changes stale a typed alias',()=>{
 for(const change of [r=>r[3]='Fictional Changed',r=>r[8]='Fictional Changed Job']){const input=fixture(),r=row();change(r);input.preparation=preparation([r]);assert.ok(codes(previewSourceMappingV3(input)).includes('source_mapping_stale'));}
});
test('invalid, legacy integer and unsupported typed alias versions refuse instead of coercing',()=>{
 for(const value of [1,'1',{kind:'provider_revision',value:1},{kind:'content_fingerprint',encoding:'old',algorithm:'sha256',value:'0'.repeat(64)},{kind:'content_fingerprint',encoding:'source-content-v2',algorithm:'sha256',value:'A'.repeat(64)}]){const input=fixture();input.mappings[0].sourceVersion=value;assert.throws(()=>previewSourceMappingV3(input),TypeError);}
});
test('alias profile and provider/store namespace must match exactly',()=>{
 for(const key of Object.keys(scope())){const input=fixture();input.mappings[0].scope[key]='fictional-other';assert.throws(()=>previewSourceMappingV3(input),TypeError);}
});
test('missing identities and inactive people block without name matching',()=>{
 const input=fixture();input.mappings=[];assert.ok(codes(previewSourceMappingV3(input)).includes('identity_mapping_required'));const a=fixture();a.target.people=[];assert.ok(codes(previewSourceMappingV3(a)).includes('person_review_required'));const b=fixture();b.target.people[0].active=false;assert.ok(codes(previewSourceMappingV3(b)).includes('person_inactive'));
});
test('target revision, person binding and cross-store membership collisions fail closed',()=>{
 const a=fixture();a.target.stores[0].members=[targetMember()];assert.ok(codes(previewSourceMappingV3(a)).includes('target_revision_conflict'));
 const b=fixture();b.target.people.push(person(2));b.target.stores[0].members=[{...targetMember(),personId:id(302)}];b.mappings[0].expectedTargetRevision=2;assert.ok(codes(previewSourceMappingV3(b)).includes('person_binding_conflict'));
 const c=fixture();c.target.stores.push({...store(),id:'fictional-other',members:[targetMember()]});assert.ok(codes(previewSourceMappingV3(c)).includes('target_scope_collision'));
});
test('same-store duplicate person memberships refuse through the shared identity checks',()=>{
 const input=fixture();input.target.stores[0].members=[{...targetMember(),id:id(999)}];const r=previewSourceMappingV3(input);assert.ok(codes(r).includes('duplicate_person_membership'));assert.ok(codes(r).includes('target_record_omitted_review'));const noJob=row();noJob[7]='';noJob[8]='';input.preparation=preparation([noJob]);input.mappings=[alias(input.preparation)];assert.ok(codes(previewSourceMappingV3(input)).includes('duplicate_person_membership'));
});
test('two source employees mapped to one person block both rows',()=>{
 const input=fixture();input.preparation=preparation([row(1),row(2)]);input.supplement.choices.push(memberChoice(2));input.mappings.push({...alias(input.preparation,2),personId:id(301)});const r=previewSourceMappingV3(input);assert.equal(r.rows.filter(r=>r.issues.includes('duplicate_person_membership')).length,2);
});
test('duplicate alias identities and target bindings refuse the whole snapshot',()=>{
 const input=fixture();input.mappings.push(structuredClone(input.mappings[0]));assert.throws(()=>previewSourceMappingV3(input),/duplicate_v3_mapping/);const a=fixture();a.mappings.push({...a.mappings[0],sourceId:id(2)});assert.throws(()=>previewSourceMappingV3(a),/duplicate_v3_mapping/);
});
test('omitted memberships remain review obligations and unavailable leave is never compared',()=>{
 const input=fixture();input.target.people.push(person(2));input.target.stores[0].members=[targetMember(2)];input.target.stores[0].timeOff=[{id:id(901),revision:1,memberId:id(202),department:'Kitchen',start:'2035-11-04T00:00:00Z',end:'2035-11-05T00:00:00Z',status:'approved'}];const r=previewSourceMappingV3(input);assert.equal(r.counts.omitted,1);assert.ok(r.rows.every(r=>r.kind==='member'));assert.equal(input.target.stores[0].timeOff.length,1);
});
test('unused aliases are explicit review findings rather than silently discarded',()=>{
 const input=fixture();input.mappings.push({...input.mappings[0],sourceId:id(2),targetId:id(202),personId:id(302)});assert.ok(codes(previewSourceMappingV3(input)).includes('unused_mapping'));
});
test('supplement, target, alias, provenance and access changes stale the complete review context',()=>{
 const a=fixture(),before=previewSourceMappingV3(a).reviewContextDigest;
 for(const change of [i=>i.supplement.revision++,i=>i.supplement.choices[1].scheduleOnly=true,i=>i.target.stores[0].inputRevision++,i=>i.target.people[0].name='Fictional New Name',i=>i.mappings[0].mappingRevision++,i=>i.accessFence='fictional-revoked',i=>{i.preparation.provenance.population.revision++;i.preparation.provenanceDigest=contentDigest(i.preparation.provenance);i.supplement.population.revision++;}]){const input=structuredClone(a);change(input);assert.notEqual(previewSourceMappingV3(input).reviewContextDigest,before);}
});
test('choice/alias reordering leaves the complete review context stable',()=>{
 const a=fixture();a.preparation=preparation([row(1),row(2)]);a.supplement.choices.push(memberChoice(2));a.target.people.push(person(2));a.mappings.push(alias(a.preparation,2));const b=structuredClone(a);b.supplement.choices.reverse();b.mappings.reverse();assert.deepEqual(previewSourceMappingV3(a),previewSourceMappingV3(b));
});
test('full verified roster exposes peer description conflicts even without a peer choice',()=>{
 const input=fixture(),peer=row(2);peer[8]='Fictional Conflict';input.preparation=preparation([row(),peer]);input.supplement.choices.push({kind:'tokenReview',token:id(101),semantics:'provider_job_key',observedDescriptions:['Fictional Cook'],canonicalDescription:'Fictional Display',...review()});const r=previewSourceMappingV3(input);assert.ok(r.rows.find(r=>r.sourceId===id(1)).issues.includes('job_token_description_conflict'));assert.ok(codes(r).includes('job_token_review_stale'));input.selection=[id(1)];assert.throws(()=>previewSourceMappingV3(input),/invalid_v3_snapshot/);
});
test('V3 token review resolves provider keys and excludes retired selections without changing preparation',()=>{
 const input=fixture(),r=row();r[7]='fictional-key';input.preparation=preparation([r]);input.mappings=[alias(input.preparation)];input.supplement.choices[0].token='fictional-key';input.supplement.choices[1].primaryJobToken='fictional-key';input.supplement.choices[1].schedulingJobTokens=['fictional-key'];input.supplement.choices.push({kind:'tokenReview',token:'fictional-key',semantics:'provider_job_key',observedDescriptions:['Fictional Cook'],canonicalDescription:null,...review()});const before=structuredClone(input.preparation);assert.equal(previewSourceMappingV3(input).rows[0].status,'new');assert.deepEqual(input.preparation,before);input.supplement.choices.at(-1).semantics='retired_job';assert.ok(codes(previewSourceMappingV3(input)).includes('primary_job_token_excluded'));
});
test('unverified pair associations remain blocking after mappings are supplied',()=>{
 const input=fixture(),ctx=context();ctx.pairing.mode='unverified';input.preparation=preparation([row()],ctx);assert.ok(codes(previewSourceMappingV3(input)).includes('job_pairing_review_required'));
});
test('no-job employees retain their report row alongside valid coworkers',()=>{
 const input=fixture(),r=row(2);r[7]='';r[8]='';input.preparation=preparation([row(),r]);const out=previewSourceMappingV3(input);assert.equal(out.rows.length,2);assert.equal(out.rows.find(r=>r.sourceId===id(1)).status,'new');assert.ok(out.rows.find(r=>r.sourceId===id(2)).issues.includes('source_jobs_missing'));
});
test('configuration, organization, missing store and timezone checks are shared and explicit',()=>{
 const a=fixture();a.target.organizationId='fictional-other';assert.throws(()=>previewSourceMappingV3(a),TypeError);const b=fixture();b.target.stores=[];assert.ok(codes(previewSourceMappingV3(b)).includes('target_store_mapping_required'));const c=fixture();c.target.stores[0].timezone='UTC';assert.ok(codes(previewSourceMappingV3(c)).includes('timezone_mapping_conflict'));const d=fixture();d.target.stores[0].jobs=['Fictional Host'];assert.ok(codes(previewSourceMappingV3(d)).includes('target_job_configuration_required'));
});
test('V3 is a separate programmatic boundary; accepted V1/V2 parser never silently accepts it',()=>{
 assert.throws(()=>previewSourceMapping(fixture()),TypeError);for(const change of [i=>i.version=2,i=>i.accessFence='',i=>i.extra=true,i=>i.mappings[0].grants=['owner']]){const input=fixture();change(input);assert.throws(()=>previewSourceMappingV3(input),TypeError);}
});

// These report hashes were captured from accepted PR59 main before validator extraction.
test('accepted V1/V2 example report bytes remain unchanged',()=>{
 for(const [name,expected] of [["source-preview.example.json","3a72adcc4fbc86510e35acf4b1a77b5d90e92fb02650b3c16e67cc6a1ed4ed75"],["source-preview-v2.example.json","1847e7fa1e667d4c48644b0f02a3e6ad247f167bade1557df488c54a2696a82b"]]){const input=JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));assert.equal(createHash('sha256').update(JSON.stringify(previewSourceMapping(input))).digest('hex'),expected);}
});
test('V3 retains each token-specific finding when multiple jobs share the same error code',()=>{
 const input=fixture(),r=row();r[7]='fictional-key-a;fictional-key-b';r[8]='Fictional A;Fictional B';input.preparation=preparation([r]);input.mappings=[alias(input.preparation)];const out=previewSourceMappingV3(input);assert.deepEqual(out.issues.filter(i=>i.code==='job_token_unresolved').map(i=>i.token).sort(),['fictional-key-a','fictional-key-b']);
});

test('active-only omission review excludes archived target memberships while preserving their context',()=>{
 const input=fixture();input.target.people.push({...person(2),active:false});input.target.stores[0].members=[{...targetMember(2),active:false}];const before=structuredClone(input.target),r=previewSourceMappingV3(input);assert.equal(r.counts.omitted,0);assert.ok(!codes(r).includes('target_record_omitted_review'));assert.deepEqual(input.target,before);
});
