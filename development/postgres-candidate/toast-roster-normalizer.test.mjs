// Wholly fictional fixtures authored from the header contract, never transformed employee data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {toastRosterProfile,canonicalJson,contentDigest,utcMicroseconds,fingerprintToastMember,sourceReviewContextDigest} from './source-fingerprint.mjs';
import {normalizeToastRoster,toastRosterHeaders,toastRosterLimits} from './toast-roster-normalizer.mjs';
import {previewSourceMapping} from './source-preview.mjs';
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const scope=()=>({organizationId:'fictional-organization',system:'toast',tenant:'fictional-tenant',storeId:'fictional-store',externalStoreId:'fictional-external',timezone:'America/New_York',...toastRosterProfile});
const context=()=>({scope:scope(),capturedAt:'2035-11-04T12:00:00.123456Z',population:{kind:'initial_active_only',effectiveDate:'2035-11-04',archivedHistory:'excluded',filterEvidence:'Fictional active-filter review',reviewer:'fictional-reviewer',revision:1},pairing:{mode:'reviewed_positional_pairs',reviewer:'fictional-reviewer',revision:1},location:{expectedLabel:'Fictional Restaurant',reviewer:'fictional-reviewer',revision:1}});
const row=(n=1)=>['Fictional Restaurant',id(n),'Example','Fictional',`fictional${n}@example.invalid`,'555-0100','',id(101)+';'+id(102),'Fictional Cook;Fictional Host','99.99'];
const field=x=>'"'+String(x).replaceAll('"','""')+'"';
const csv=(rows=[row()],headers=toastRosterHeaders,eol='\n')=>Buffer.from([headers,...rows].map(r=>r.map(field).join(',')).join(eol)+eol);
const prep=(rows,ctx=context())=>normalizeToastRoster(csv(rows),ctx);
const member=()=>({sourceId:id(1),name:'Fictional Example',jobs:[{token:id(101),description:'Fictional Cook'},{token:id(102),description:'Fictional Host'}]});
const frozen=r=>{for(const k of ['canApply','completenessCertified','accessProvisioned'])assert.equal(r[k],false);};

test('exact Toast profile prepares source-only records and never invents manager fields or complete leave',()=>{
 const r=prep(),m=r.source.records[0];frozen(r);assert.equal(r.status,'review_required');assert.deepEqual(r.source.families.timeOff,{available:false});assert.equal(r.source.families.roster.coverageClaim,'unverified');assert.equal(r.source.families.roster.archivedHistory,'excluded');
 for(const k of ['active','department','position','primaryJob','scheduleOnly','scheduleJobs','sourceRevision'])assert.ok(!Object.hasOwn(m,k));
 assert.deepEqual(m.sourceVersion,fingerprintToastMember(scope(),member()));assert.ok(m.issues.includes('manager_supplement_required'));assert.ok(m.issues.includes('identity_mapping_required'));
 assert.ok(!JSON.stringify(r).includes('@example.invalid'));assert.ok(!JSON.stringify(r).includes('555-0100'));assert.ok(!JSON.stringify(r).includes('99.99'));
});
test('source records and semantic digest ignore row order; raw-byte provenance changes',()=>{
 const a=prep([row(1),row(2)]),b=prep([row(2),row(1)]);assert.deepEqual(a.source,b.source);assert.equal(a.provenance.normalizedSourceDigest,b.provenance.normalizedSourceDigest);assert.notEqual(a.provenance.rawFileSha256,b.provenance.rawFileSha256);assert.notEqual(a.provenanceDigest,b.provenanceDigest);
});
test('job pairs are sorted together, independent of provider order',()=>{
 const a=row(),b=row();b[7]=id(102)+';'+id(101);b[8]='Fictional Host;Fictional Cook';assert.deepEqual(prep([a]).source,prep([b]).source);
});
test('ordinal token then description ordering is deterministic without locale or case folding',()=>{
 const m=member();m.jobs=[{token:'z',description:'B'},{token:'A',description:'z'},{token:'A',description:'A'}];const a=fingerprintToastMember(scope(),m);m.jobs.reverse();assert.deepEqual(a,fingerprintToastMember(scope(),m));
});
test('name changes stale mappings while trimmed name/description whitespace is stable',()=>{
 const a=row(),b=row();b[2]='  Example  ';b[3]=' Fictional ';b[8]=' Fictional Cook ; Fictional Host ';assert.deepEqual(prep([a]).source,prep([b]).source);b[3]='Fictional Changed';assert.notDeepEqual(prep([a]).source.records[0].sourceVersion,prep([b]).source.records[0].sourceVersion);
});
test('internal spelling, whitespace, punctuation and Unicode are preserved',()=>{
 const a=row();a[2]='Comma, "Quote"';a[3]='Fictional  É';assert.equal(prep([a]).source.records[0].name,'Fictional  É Comma, "Quote"');const b=[...a];b[3]='Fictional  E\u0301';assert.notDeepEqual(prep([a]).source.records[0].sourceVersion,prep([b]).source.records[0].sourceVersion);
});
test('excluded contact, compensation and optional legacy ID changes do not affect sourceVersion',()=>{
 const a=row(),b=row();b[4]='different@example.invalid';b[5]='555-0199';b[6]='repeated-legacy';b[9]='777.77';assert.deepEqual(prep([a]).source,prep([b]).source);assert.notEqual(prep([a]).provenance.rawFileSha256,prep([b]).provenance.rawFileSha256);
});
test('reported job token and description changes each change sourceVersion',()=>{
 for(const col of [7,8]){const a=row(),b=row();b[col]=col===7?id(103)+';'+id(102):'Fictional Baker;Fictional Host';assert.notDeepEqual(prep([a]).source.records[0].sourceVersion,prep([b]).source.records[0].sourceVersion);}
});
test('non-UUID tokens retain exact text and deterministic versions while unresolved',()=>{
 const a=row();a[7]=' unknown-token ;'+id(102);const r=prep([a]),m=r.source.records[0];assert.equal(m.jobs[0].token,' unknown-token ');assert.ok(m.issues.includes('job_token_unresolved'));assert.deepEqual(r,prep([a]));const b=[...a];b[7]='unknown-token;'+id(102);assert.notDeepEqual(m.sourceVersion,prep([b]).source.records[0].sourceVersion);
});
test('duplicate job pairs refuse the whole preparation, never silently deduplicate',()=>{
 const a=row();a[7]=id(101)+';'+id(101);a[8]='Fictional Cook; Fictional Cook ';assert.throws(()=>prep([row(2),a]),/duplicate_source_job_pair/);
});
test('conflicting descriptions for a token flag every affected record',()=>{
 const a=row(1),b=row(2);b[8]='Fictional Baker;Fictional Host';const r=prep([a,b]);assert.ok(r.source.records.every(m=>m.issues.includes('job_token_description_conflict')));frozen(r);
});
test('unverified positional pairing remains an explicit review obligation',()=>{
 const c=context();c.pairing.mode='unverified';const r=prep(undefined,c);assert.ok(r.source.records[0].issues.includes('job_pairing_review_required'));assert.deepEqual(r.source.records[0].sourceVersion,prep().source.records[0].sourceVersion);
});
test('supplement choice, revision and reviewer changes stale review but leave sourceVersion unchanged',()=>{
 const r=prep(),before=structuredClone(r),c={provenanceDigest:r.provenanceDigest,supplement:{revision:1,reviewer:'fictional-reviewer',choices:[{sourceId:id(1),department:'Kitchen',primaryJob:id(101),scheduleOnly:false,schedulingJobs:[id(101)]}]},targetInputRevision:1,accessFence:'fictional-access-1'};
 for(const edit of [x=>x.supplement.revision++,x=>x.supplement.reviewer='fictional-other',x=>x.supplement.choices[0].department='Service',x=>x.supplement.choices[0].scheduleOnly=true,x=>x.targetInputRevision++,x=>x.accessFence='fictional-access-2']){const changed=structuredClone(c);edit(changed);assert.notEqual(sourceReviewContextDigest(c),sourceReviewContextDigest(changed));}
 assert.deepEqual(r,before);assert.deepEqual(r.source.records[0].sourceVersion,prep().source.records[0].sourceVersion);
});
test('capture time/population review changes provenance, not provider sourceVersion',()=>{
 const a=prep();for(const edit of [c=>c.capturedAt='2035-11-05T12:00:00Z',c=>c.population.effectiveDate='2035-11-05',c=>c.population.revision++]){const c=context();edit(c);const b=prep(undefined,c);assert.deepEqual(a.source.records[0].sourceVersion,b.source.records[0].sourceVersion);assert.notEqual(a.provenanceDigest,b.provenanceDigest);}
});
test('scope is part of sourceVersion and unknown source profiles cannot be accepted',()=>{
 for(const key of ['organizationId','tenant','storeId','externalStoreId','timezone']){const c=context();c.scope[key]=key==='timezone'?'UTC':'fictional-other';assert.notDeepEqual(prep().source.records[0].sourceVersion,prep(undefined,c).source.records[0].sourceVersion);}
 for(const key of ['sourceFormat','transformVersion','system']){const c=context();c.scope[key]='unknown';assert.throws(()=>prep(undefined,c),/unsupported_source_profile/);}
});
test('UTF8 BOM and CRLF are explicit supported variants; source versions remain stable',()=>{
 const a=normalizeToastRoster(csv(),context()),b=normalizeToastRoster(Buffer.concat([Buffer.from([239,187,191]),csv([row()],toastRosterHeaders,'\r\n')]),context());assert.deepEqual(a.source,b.source);assert.notEqual(a.provenance.rawFileSha256,b.provenance.rawFileSha256);
});
test('invalid encoding, malformed quoting, unknown/missing/reordered headers fail closed',()=>{
 assert.throws(()=>normalizeToastRoster(Buffer.from([255]),context()),/invalid_roster_encoding/);
 for(const bytes of [Buffer.from(csv().toString()+'"unfinished'),Buffer.from(csv().toString().replace('"Location"','"Location"bad')),csv([row()],['Unknown',...toastRosterHeaders.slice(1)]),csv([row()],toastRosterHeaders.slice(1)),csv([row()],[...toastRosterHeaders].reverse())])assert.throws(()=>normalizeToastRoster(bytes,context()),TypeError);
});
test('duplicate GUID, blank/mismatched jobs, mixed stores and incomplete rows refuse atomically',()=>{
 assert.throws(()=>prep([row(1),row(1)]),/invalid_or_duplicate_employee_guid/);
 for(const edit of [r=>r[1]='not-a-guid',r=>r[7]='',r=>r[8]='Fictional Cook',r=>r[2]='',r=>r.pop()]){const r=row();edit(r);assert.throws(()=>prep([r]),TypeError);}
 const b=row(2);b[0]='Other Fictional Restaurant';assert.throws(()=>prep([row(),b]),/mixed_or_missing_roster_location/);
 assert.throws(()=>normalizeToastRoster(csv([]),context()),/empty_roster_requires_review/);
});
test('missing scope/timezone/population declarations never get inferred from a filename or location',()=>{
 for(const edit of [c=>delete c.scope.timezone,c=>c.scope.timezone='Invalid/Zone',c=>c.population.kind='all_employees',c=>c.population.archivedHistory='complete',c=>c.population.effectiveDate='2035-02-30',c=>delete c.population.reviewer,c=>c.population.revision=0,c=>c.extra='unknown']){const c=context();edit(c);assert.throws(()=>prep(undefined,c),TypeError);}
});
test('programmatic input is not mutated and manager fields cannot enter provider fingerprints',()=>{
 const c=context(),before=structuredClone(c);prep(undefined,c);assert.deepEqual(c,before);const m=member();m.department='Kitchen';assert.throws(()=>fingerprintToastMember(scope(),m),/invalid_source_shape/);
});
test('reviewed location binding rejects a uniform export from the wrong store',()=>{
 const c=context();c.location.expectedLabel='Another Fictional Restaurant';assert.throws(()=>prep(undefined,c),/mixed_or_missing_roster_location/);
});
test('preparation cannot slip into accepted V1/V2 preview as a fabricated source revision',()=>{
 assert.throws(()=>previewSourceMapping(prep()),/invalid_snapshot_shape/);
});
test('exact UTC microseconds preserve offset equivalence, pre-epoch instants and precision',()=>{
 assert.equal(utcMicroseconds('1969-12-31T23:59:59.999999Z'),'-1');assert.equal(utcMicroseconds('2035-11-04T01:30:00.123456-04:00'),utcMicroseconds('2035-11-04T05:30:00.123456Z'));assert.equal(BigInt(utcMicroseconds('2035-11-04T05:30:00.123457Z'))-BigInt(utcMicroseconds('2035-11-04T05:30:00.123456Z')),1n);
 for(const v of ['2035-02-30T00:00:00Z','2035-11-04T01:30:00','2035-11-04T24:00:00Z','2035-11-04T01:30:00.1234567Z','2035-11-04T01:30:60Z'])assert.throws(()=>utcMicroseconds(v),/invalid_source_instant/);
});
test('canonical JSON sorts keys but never positional arrays; invalid structures fail',()=>{
 assert.equal(canonicalJson({b:2,a:1}),'{"a":1,"b":2}');assert.notEqual(contentDigest({items:[1,2]}),contentDigest({items:[2,1]}));
 const cycle={};cycle.loop=cycle;for(const v of [cycle,{value:undefined},{value:NaN},{value:new Date()},new Array(2)])assert.throws(()=>canonicalJson(v),TypeError);
});
test('file, row, field and job bounds refuse rather than truncating',()=>{
 assert.throws(()=>normalizeToastRoster(Buffer.alloc(toastRosterLimits.bytes+1),context()),/roster_byte_limit/);assert.throws(()=>prep(Array.from({length:2001},(_,i)=>row(i+1))),/roster_row_limit/);
 const a=row();a[4]='x'.repeat(2001);assert.throws(()=>prep([a]),/roster_field_limit/);const b=row();b[7]=Array.from({length:101},(_,i)=>String(i)).join(';');b[8]=Array.from({length:101},()=> 'Job').join(';');assert.throws(()=>prep([b]),/invalid_source_jobs/);
});
test('CLI success is private review-required preparation; errors leak no paths or source values',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fictional-toast-')),csvPath=join(dir,'fictional.csv'),ctxPath=join(dir,'context.json'),cli=fileURLToPath(new URL('./toast-roster-cli.mjs',import.meta.url));
 try{
  writeFileSync(csvPath,csv());writeFileSync(ctxPath,JSON.stringify(context()));let result=spawnSync(process.execPath,[cli,csvPath,ctxPath],{encoding:'utf8'});assert.equal(result.status,3);frozen(JSON.parse(result.stdout));assert.equal(result.stderr,'');assert.deepEqual(readFileSync(csvPath),csv());
  for(const args of [[],[csvPath,join(dir,'private-missing.json')],[csvPath,ctxPath]]){if(args.length===2&&args[1]===ctxPath)writeFileSync(ctxPath,'{"scope":{},"scope":{}}');result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(result.status,1);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),{status:'blocked',error:'toast_roster_input_refused',canApply:false,completenessCertified:false,accessProvisioned:false});assert.ok(!result.stdout.includes(dir));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
