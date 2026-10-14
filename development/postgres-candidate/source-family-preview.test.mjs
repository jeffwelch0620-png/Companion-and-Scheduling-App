import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseSourcePreviewFile,previewSourceMapping} from './source-preview.mjs';
const example=new URL('./source-preview.example.json',import.meta.url);
const cli=fileURLToPath(new URL('./source-preview-cli.mjs',import.meta.url));
const fixture=()=>parseSourcePreviewFile(readFileSync(example,'utf8'));
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
function v2(){const f=fixture();f.version=2;for(const s of f.source.scopes){const end=s.endOfSource;delete s.endOfSource;s.coverage.roster={available:true,...s.coverage.roster,endOfSource:end};s.coverage.timeOff={available:true,...s.coverage.timeOff,endOfSource:end};}return f;}
function unavailable(s,family){s.coverage[family]={available:false};s[family==='roster'?'members':'timeOff']=null;}
function readOnly(report){for(const flag of ['canApply','completenessCertified','accessProvisioned'])assert.equal(report[flag],false);}
function targetMember(f){const t=f.target.stores[1];t.members=[{...f.target.stores[0].members[0],id:id(11),revision:5}];f.mappings[1].expectedTargetRevision=5;return t;}

test('accepted V1 report remains byte-for-byte stable and retains its conservative missing-coverage behavior',()=>{
 const f=fixture(),r=previewSourceMapping(f);assert.equal(createHash('sha256').update(JSON.stringify(r)).digest('hex'),'3a72adcc4fbc86510e35acf4b1a77b5d90e92fb02650b3c16e67cc6a1ed4ed75');assert.equal(r.version,1);assert.ok(!Object.hasOwn(r.scopes[0],'families'));assert.ok(!Object.hasOwn(r.counts,'review_required'));
 f.source.scopes[1].coverage.timeOff.complete=false;assert.equal(previewSourceMapping(f).status,'blocked');const g=fixture();g.mappings.pop();g.source.scopes[1].timeOff[0].status='withdrawn';assert.equal(previewSourceMapping(g).status,'blocked');
});

test('roster-only V2 never fabricates empty leave or omissions from existing target leave',()=>{
 const f=v2();for(const s of f.source.scopes)unavailable(s,'timeOff');const t=f.target.stores[0];t.timeOff=[{id:id(30),revision:2,memberId:id(10),department:'Kitchen',start:'2035-11-02T08:00:00-04:00',end:'2035-11-02T09:00:00-04:00',status:'approved'}];const before=structuredClone(f),r=previewSourceMapping(f);
 assert.equal(r.version,2);assert.equal(r.status,'reviewable');assert.equal(r.rows.filter(row=>row.kind==='timeOff').length,0);assert.equal(r.issues.filter(i=>i.kind==='timeOff').length,0);
 for(const s of r.scopes){assert.equal(s.families.roster.coverageClaim,'declared_complete');assert.equal(s.families.roster.status,'reviewable');assert.deepEqual(s.families.timeOff,{available:false,coverageClaim:'unavailable',status:'unavailable'});assert.ok(!Object.hasOwn(s,'coverageClaim'));}
 readOnly(r);assert.deepEqual(f,before);assert.equal(f.source.scopes[0].timeOff,null);
});

test('available complete empty leave differs from unavailable and produces omission review only when requested',()=>{
 const f=v2();f.source.scopes=[f.source.scopes[0]];f.mappings=[f.mappings[0]];const t=f.target.stores[0];t.timeOff=[{id:id(30),revision:2,memberId:id(10),department:'Kitchen',start:'2035-11-02T08:00:00-04:00',end:'2035-11-02T09:00:00-04:00',status:'approved'}];
 const empty=previewSourceMapping(f);assert.equal(empty.status,'review_required');assert.equal(empty.scopes[0].families.timeOff.coverageClaim,'declared_complete');assert.equal(empty.scopes[0].families.timeOff.count,0);assert.equal(empty.scopes[0].families.timeOff.status,'review_required');assert.equal(empty.counts.omitted,1);
 unavailable(f.source.scopes[0],'timeOff');const absent=previewSourceMapping(f);assert.equal(absent.status,'reviewable');assert.equal(absent.scopes[0].families.timeOff.coverageClaim,'unavailable');assert.ok(!Object.hasOwn(absent.scopes[0].families.timeOff,'count'));assert.equal(absent.counts.omitted,0);assert.notEqual(empty.source.digest,absent.source.digest);readOnly(empty);readOnly(absent);
});

test('unavailable target leave is distinct from empty and cannot establish historical absence or block roster-only review',()=>{
 const f=v2();for(const s of f.source.scopes)unavailable(s,'timeOff');for(const t of f.target.stores)t.timeOff=null;let r=previewSourceMapping(f);assert.equal(r.status,'reviewable');assert.ok(r.scopes.every(s=>s.families.roster.status==='reviewable'));readOnly(r);
 const g=v2();g.target.stores[1].timeOff=null;r=previewSourceMapping(g);assert.equal(r.status,'blocked');assert.equal(r.scopes[1].families.roster.status,'reviewable');assert.equal(r.scopes[1].families.timeOff.targetAvailable,false);assert.equal(r.scopes[1].families.timeOff.status,'blocked');assert.ok(r.rows.find(row=>row.kind==='timeOff').issues.includes('target_family_unavailable'));
 g.mappings.pop();g.source.scopes[1].timeOff[0].status='declined';r=previewSourceMapping(g);assert.equal(r.status,'blocked');assert.ok(!r.issues.some(i=>i.code==='inactive_source_leave_untracked'));readOnly(r);
 const legacy=fixture();legacy.target.stores[0].timeOff=null;assert.throws(()=>previewSourceMapping(legacy),/snapshot_limit_or_shape/);
});

test('V2 target leave cancellation remains unsupported until the shared cancellation model is ported',()=>{
 const f=v2(),t=targetMember(f),leave=f.source.scopes[1].timeOff[0];t.timeOff=[{id:id(20),revision:2,memberId:id(11),department:leave.department,start:leave.start,end:leave.end,status:'cancelled'}];assert.throws(()=>previewSourceMapping(f),/invalid_leave_snapshot/);
});

test('unavailable, malformed and incomplete family declarations cannot masquerade as complete coverage',()=>{
 for(const edit of [s=>{s.coverage.timeOff={available:false};s.timeOff=[];},s=>{s.coverage.timeOff={available:false,count:0};s.timeOff=null;},s=>{s.coverage.timeOff={available:'false'};s.timeOff=null;},s=>{delete s.coverage.timeOff;},s=>{s.timeOff=null;},s=>{s.coverage.roster.complete='true';}]){const f=v2();edit(f.source.scopes[0]);assert.throws(()=>previewSourceMapping(f),TypeError);}
 const f=v2();unavailable(f.source.scopes[0],'timeOff');f.source.scopes[0].coverage.roster.endOfSource=false;let r=previewSourceMapping(f);assert.equal(r.status,'blocked');assert.equal(r.scopes[0].families.roster.coverageClaim,'incomplete');assert.equal(r.scopes[0].families.timeOff.coverageClaim,'unavailable');
 f.source.scopes[0].coverage.roster.endOfSource=true;f.source.scopes[0].coverage.roster.count++;r=previewSourceMapping(f);assert.equal(r.scopes[0].families.roster.status,'blocked');assert.ok(r.issues.some(i=>i.code==='source_count_mismatch'&&i.family==='roster'));readOnly(r);
});

test('available family coverage failures are scoped without staling another complete family',()=>{
 const f=v2();f.source.scopes[1].coverage.roster.complete=false;const r=previewSourceMapping(f),s=r.scopes.find(s=>s.storeId===f.source.scopes[1].storeId);
 assert.equal(r.status,'blocked');assert.equal(s.families.roster.status,'blocked');assert.equal(s.families.roster.coverageClaim,'incomplete');assert.equal(s.families.timeOff.status,'reviewable');assert.equal(s.families.timeOff.coverageClaim,'declared_complete');assert.ok(r.issues.every(i=>i.family==='roster'));readOnly(r);
});

test('leave-only source resolves existing reviewed target-member aliases without inventing roster proposals',()=>{
 const f=v2(),t=targetMember(f);unavailable(f.source.scopes[1],'roster');f.source.scopes=[f.source.scopes[1]];f.mappings=f.mappings.filter(m=>m.storeId===f.source.scopes[0].storeId);t.members[0].department='Service';const r=previewSourceMapping(f);
 assert.equal(r.status,'reviewable');assert.equal(r.rows.length,1);assert.equal(r.rows[0].kind,'timeOff');assert.equal(r.rows[0].status,'new');assert.equal(r.scopes[0].families.roster.status,'unavailable');assert.equal(r.scopes[0].families.timeOff.status,'reviewable');assert.equal(r.issues.length,0);readOnly(r);
});

test('leave-only dependency still requires exact existing identity, store and target-member revision',()=>{
 for(const edit of [f=>f.mappings[1].targetId=id(10),f=>{f.mappings.splice(1,1);},f=>{f.target.stores[1].members=[];f.mappings[1].expectedTargetRevision=null;}]){
  const f=v2();targetMember(f);unavailable(f.source.scopes[1],'roster');edit(f);f.source.scopes=[f.source.scopes[1]];f.mappings=f.mappings.filter(m=>m.storeId===f.source.scopes[0].storeId);const r=previewSourceMapping(f),row=r.rows.find(row=>row.kind==='timeOff');assert.equal(row.status,'blocked');assert.ok(row.issues.includes('leave_member_mapping_required'));assert.equal(row.memberSourceId,f.source.scopes[0].timeOff[0].memberSourceId);assert.equal(r.scopes[0].families.roster.status,'unavailable');readOnly(r);
 }
});

test('snapshots with every family unavailable are invalid input',()=>{
 const f=v2();for(const s of f.source.scopes)for(const family of ['roster','timeOff'])unavailable(s,family);assert.throws(()=>previewSourceMapping(f),/source_families_unavailable/);
});

test('a mixed snapshot retains unavailable scopes without blocking available families',()=>{
 const f=v2();for(const family of ['roster','timeOff'])unavailable(f.source.scopes[0],family);const r=previewSourceMapping(f);
 assert.equal(r.status,'review_required');assert.ok(r.issues.some(i=>i.code==='source_families_unavailable'&&i.severity==='review_required'));assert.ok(Object.values(r.scopes[0].families).every(c=>c.status==='unavailable'));assert.equal(r.scopes[1].families.roster.status,'reviewable');assert.equal(r.scopes[1].families.timeOff.status,'reviewable');readOnly(r);
});

test('leave-only stale revision or person aliases have a distinct blocking dependency code',()=>{
 for(const edit of [f=>f.mappings[1].expectedTargetRevision++,f=>f.mappings[1].personId=id(2)]){
  const f=v2();targetMember(f);unavailable(f.source.scopes[1],'roster');edit(f);const r=previewSourceMapping(f),row=r.rows.find(r=>r.kind==='timeOff');
  assert.equal(row.status,'blocked');assert.ok(row.issues.includes('leave_member_alias_stale'));assert.ok(!row.issues.includes('leave_member_mapping_required'));assert.equal(row.memberSourceId,f.source.scopes[1].timeOff[0].memberSourceId);assert.ok(r.issues.some(i=>i.code==='leave_member_alias_stale'&&i.severity==='blocking'&&i.memberSourceId===row.memberSourceId));readOnly(r);
 }
});

test('inactive leave absence ignores other employees leave by exact membership id',()=>{
 for(const rosterAvailable of [true,false])for(const status of ['declined','cancelled','withdrawn']){
  const f=v2(),t=targetMember(f),s=f.source.scopes[1];f.mappings.pop();s.timeOff[0].status=status;if(!rosterAvailable)unavailable(s,'roster');
  f.target.people.push({id:id(2),name:'Other fictional employee',active:true});t.members.push({...t.members[0],id:id(12),personId:id(2)});
  t.timeOff=[{id:id(30),revision:2,memberId:id(12),department:'Kitchen',start:s.timeOff[0].start,end:s.timeOff[0].end,status:'approved'}];
  const before=structuredClone(f),r=previewSourceMapping(f),row=r.rows.find(r=>r.sourceId===s.timeOff[0].sourceId);
  assert.equal(row.status,'review_required');assert.deepEqual(row.issues,['inactive_source_leave_untracked']);assert.equal(row.targetId,null);assert.deepEqual(f,before);readOnly(r);
 }
});

test('inactive leave absence checks the full declared window rather than matching source dates',()=>{
 for(const dates of [['2035-11-07T23:00:00-05:00','2035-11-08T00:00:00-05:00'],['2035-10-31T23:00:00-04:00','2035-11-01T00:00:00-04:00'],['2035-11-08T00:00:00-05:00','2035-11-08T01:00:00-05:00']]){
  const f=v2(),t=targetMember(f),s=f.source.scopes[1];f.mappings.pop();s.timeOff[0].status='declined';unavailable(s,'roster');
  t.timeOff=[{id:id(30),revision:2,memberId:id(11),department:'Kitchen',start:dates[0],end:dates[1],status:'approved'}];const row=previewSourceMapping(f).rows.find(r=>r.sourceId===s.timeOff[0].sourceId);
  if(dates[0].startsWith('2035-11-07')){assert.equal(row.status,'blocked');assert.ok(row.issues.includes('identity_mapping_required'));}else{assert.equal(row.status,'review_required');assert.deepEqual(row.issues,['inactive_source_leave_untracked']);}
 }
});

test('inactive leave for an unresolved member remains blocked even with an empty target family',()=>{
 for(const rosterAvailable of [true,false]){
  const f=v2();targetMember(f);f.mappings.pop();const s=f.source.scopes[1];s.timeOff[0].status='withdrawn';s.timeOff[0].memberSourceId='unresolved-member';if(!rosterAvailable)unavailable(s,'roster');const r=previewSourceMapping(f),row=r.rows.find(r=>r.kind==='timeOff');
  assert.equal(row.status,'blocked');assert.ok(row.issues.includes('leave_member_mapping_required'));assert.ok(row.issues.includes('identity_mapping_required'));assert.ok(!row.issues.includes('inactive_source_leave_untracked'));readOnly(r);
 }
});

test('all-unavailable CLI input exits 1 with a fixed public error and preserves input bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jmax-source-unavailable-')),file=join(dir,'private-source.json');
 try{const f=v2();for(const s of f.source.scopes)for(const family of ['roster','timeOff'])unavailable(s,family);const bytes=Buffer.from(JSON.stringify(f));writeFileSync(file,bytes);const run=spawnSync(process.execPath,[cli,file],{encoding:'utf8',windowsHide:true});assert.equal(run.status,1);assert.deepEqual(JSON.parse(run.stdout),{status:'blocked',canApply:false,error:'source_families_unavailable'});assert.equal(run.stdout.includes(file),false);assert.deepEqual(readFileSync(file),bytes);}finally{unlinkSync(file);rmdirSync(dir);}
});

test('untracked inactive historical leave is review-required only in V2 with established target absence',()=>{
 for(const status of ['declined','cancelled','withdrawn']){const f=v2();targetMember(f);f.mappings.pop();const s=f.source.scopes[1];s.timeOff[0].status=status;s.timeOff[0].department='Former historical label';unavailable(s,'roster');const before=structuredClone(f),r=previewSourceMapping(f),row=r.rows.find(row=>row.kind==='timeOff');
  assert.equal(r.status,'review_required');assert.equal(row.status,'review_required');assert.deepEqual(row.issues,['inactive_source_leave_untracked']);assert.equal(row.targetId,null);assert.equal(r.counts.review_required,1);assert.equal(r.scopes[1].families.timeOff.status,'review_required');assert.ok(r.issues.some(i=>i.code==='inactive_source_leave_untracked'&&i.family==='timeOff'&&i.severity==='review_required'));readOnly(r);assert.deepEqual(f,before);assert.equal(JSON.stringify(r).includes('Former historical label'),false);
 }
 const active=v2();active.mappings.pop();assert.equal(previewSourceMapping(active).status,'blocked');
 const linked=v2();linked.source.scopes[1].timeOff[0].status='withdrawn';assert.equal(previewSourceMapping(linked).status,'blocked');
});

test('withdrawals linked to existing targets or unresolved nonempty targets remain blockers without touching leave',()=>{
 for(const mapped of [false,true])for(const status of ['cancelled','withdrawn']){
  const f=v2(),t=targetMember(f),leave=f.source.scopes[1].timeOff[0];leave.status=status;t.timeOff=[{id:id(20),revision:2,memberId:id(11),department:leave.department,start:leave.start,end:leave.end,status:'approved'}];f.mappings[2].expectedTargetRevision=2;if(!mapped)f.mappings.pop();const before=structuredClone(f),r=previewSourceMapping(f),row=r.rows.find(row=>row.sourceId===leave.sourceId&&row.kind==='timeOff');
  assert.equal(r.status,'blocked');assert.equal(row.status,'blocked');assert.ok(row.issues.includes('leave_withdrawal_policy_required'));assert.ok(!row.issues.includes('inactive_source_leave_untracked'));readOnly(r);assert.deepEqual(f,before);
 }
});

test('inactive leave outside coverage or duplicated remains blocked instead of being discarded as history',()=>{
 for(const edit of [s=>{s.timeOff[0].start='2035-10-01T08:00:00-04:00';s.timeOff[0].end='2035-10-01T09:00:00-04:00';},s=>{s.timeOff.push({...s.timeOff[0]});s.coverage.timeOff.count++;}]){
  const f=v2();f.mappings.pop();f.source.scopes[1].timeOff[0].status='declined';edit(f.source.scopes[1]);const r=previewSourceMapping(f);assert.equal(r.status,'blocked');assert.ok(r.rows.filter(row=>row.kind==='timeOff').every(row=>row.status==='blocked'));assert.ok(r.issues.every(i=>i.code!=='inactive_source_leave_untracked'));readOnly(r);
 }
});

test('V2 scope and diagnostics remain deterministic when mixed available families and historical rows reorder',()=>{
 const f=v2();unavailable(f.source.scopes[0],'timeOff');f.mappings.pop();f.source.scopes[1].timeOff[0].status='declined';const r=previewSourceMapping(f);f.source.scopes.reverse();f.target.stores.reverse();f.mappings.reverse();assert.deepEqual(previewSourceMapping(f),r);
});

test('actual CLI supports V2 roster-only and review-required history without changing file bytes or printing private labels',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jmax-source-family-')),file=join(dir,'private-source.json');
 try{
  const f=v2();for(const s of f.source.scopes)unavailable(s,'timeOff');let bytes=Buffer.from(JSON.stringify(f));writeFileSync(file,bytes);let run=spawnSync(process.execPath,[cli,file],{encoding:'utf8',windowsHide:true}),r=JSON.parse(run.stdout);assert.equal(run.status,0);assert.equal(r.version,2);assert.equal(r.status,'reviewable');assert.ok(r.scopes.every(s=>s.families.timeOff.status==='unavailable'));readOnly(r);assert.deepEqual(readFileSync(file),bytes);assert.equal(run.stdout.includes('Fictional employee'),false);
  const g=v2();targetMember(g);g.mappings.pop();g.source.scopes[1].timeOff[0].status='withdrawn';bytes=Buffer.from(JSON.stringify(g));writeFileSync(file,bytes);run=spawnSync(process.execPath,[cli,file],{encoding:'utf8',windowsHide:true});r=JSON.parse(run.stdout);assert.equal(run.status,3);assert.equal(r.status,'review_required');readOnly(r);assert.deepEqual(readFileSync(file),bytes);
  g.source.scopes[1].coverage.timeOff={available:false};writeFileSync(file,JSON.stringify(g));run=spawnSync(process.execPath,[cli,file],{encoding:'utf8',windowsHide:true});assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).error,'unavailable_family_has_records');assert.equal(run.stdout.includes(file),false);
 }finally{unlinkSync(file);rmdirSync(dir);}
});
