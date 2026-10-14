import test from 'node:test';
import assert from 'node:assert/strict';
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
function readOnly(report){for(const flag of ['canApply','completenessCertified','accessProvisioned'])assert.equal(report[flag],false);}
function omitMember(f){f.source.scopes[0].members=[];f.source.scopes[0].coverage.roster.count=0;f.mappings.shift();}
function unusedAlias(f){f.mappings.push({...f.mappings[0],sourceId:'unused-private-alias',targetId:id(80),expectedTargetRevision:null});}

test('review-only aliases and omissions preserve all valid comparisons and independent completeness holds',()=>{
 const f=fixture();omitMember(f);unusedAlias(f);const before=structuredClone(f),r=previewSourceMapping(f);
 assert.equal(r.status,'review_required');assert.deepEqual(new Set(r.issues.map(i=>i.code)),new Set(['target_record_omitted_review','unused_mapping']));
 assert.ok(r.issues.every(i=>i.severity==='review_required'));assert.equal(r.counts.new,2);assert.equal(r.counts.omitted,1);assert.equal(r.counts.blocked,0);readOnly(r);assert.deepEqual(f,before);
 f.mappings.reverse();f.source.scopes.reverse();assert.deepEqual(previewSourceMapping(f).issues,r.issues);
});

test('a genuine blocker takes precedence over review-required findings without dropping either kind',()=>{
 const f=fixture();omitMember(f);unusedAlias(f);f.source.scopes[1].endOfSource=false;const r=previewSourceMapping(f);
 assert.equal(r.status,'blocked');assert.ok(r.issues.some(i=>i.code==='source_coverage_incomplete'&&i.severity==='blocking'));
 assert.ok(r.issues.some(i=>i.code==='target_record_omitted_review'&&i.severity==='review_required'));assert.ok(r.issues.some(i=>i.code==='unused_mapping'&&i.severity==='review_required'));readOnly(r);
});

test('cancelled and withdrawn source leave are row-level policy holds and never rewrite existing leave',()=>{
 for(const status of ['cancelled','withdrawn'])for(const existing of [false,true]){
  const f=fixture(),s=f.source.scopes[1],t=f.target.stores[1],leave=s.timeOff[0];leave.status=status;
  if(existing){t.members=[{...f.target.stores[0].members[0],id:id(11),revision:5}];f.mappings[1].expectedTargetRevision=5;t.timeOff=[{id:id(20),revision:2,memberId:id(11),department:leave.department,start:leave.start,end:leave.end,status:'approved'}];f.mappings[2].expectedTargetRevision=2;}
  s.timeOff.push({...leave,sourceId:'other-leave',status:'pending',start:'2035-11-05T08:00:00-05:00',end:'2035-11-05T09:00:00-05:00'});s.coverage.timeOff.count++;
  f.mappings.push({...f.mappings[2],sourceId:'other-leave',targetId:id(21),expectedTargetRevision:null});const before=structuredClone(f),r=previewSourceMapping(f);
  assert.equal(r.status,'blocked');const held=r.rows.find(row=>row.sourceId===leave.sourceId&&row.kind==='timeOff');assert.equal(held.status,'blocked');assert.deepEqual(held.issues,['leave_withdrawal_policy_required']);assert.deepEqual(held.changedFields,[]);
  assert.ok(r.issues.some(i=>i.sourceId===leave.sourceId&&i.code==='leave_withdrawal_policy_required'&&i.severity==='blocking'));assert.equal(r.rows.find(row=>row.sourceId==='other-leave').status,'new');readOnly(r);assert.deepEqual(f,before);
 }
});

test('unrecognized source states and unsupported target withdrawal states remain malformed snapshots',()=>{
 const f=fixture();f.source.scopes[1].timeOff[0].status='unexpected-state';assert.throws(()=>previewSourceMapping(f),/invalid_leave_snapshot/);
 const g=fixture(),t=g.target.stores[1],leave=g.source.scopes[1].timeOff[0];t.members=[{...g.target.stores[0].members[0],id:id(11),revision:5}];t.timeOff=[{id:id(20),revision:2,memberId:id(11),department:leave.department,start:leave.start,end:leave.end,status:'withdrawn'}];assert.throws(()=>previewSourceMapping(g),/invalid_leave_snapshot/);
});

test('blocked member dependencies identify the source member across stale, configured-job and duplicate failures',()=>{
 for(const change of [f=>f.mappings[1].sourceRevision--,f=>f.source.scopes[1].members[0].position='Unmapped private job',f=>{const s=f.source.scopes[1];s.members.push({...s.members[0]});s.coverage.roster.count++;}]){
  const f=fixture();change(f);const s=f.source.scopes[1],leave=s.timeOff[0],r=previewSourceMapping(f),row=r.rows.find(x=>x.kind==='timeOff');
  assert.equal(row.status,'blocked');assert.equal(row.memberSourceId,leave.memberSourceId);assert.ok(row.issues.includes('leave_member_blocked'));assert.ok(!row.issues.includes('leave_member_mapping_required'));
  const issue=r.issues.find(i=>i.code==='leave_member_blocked');assert.equal(issue.memberSourceId,leave.memberSourceId);assert.equal(issue.severity,'blocking');assert.equal(issue.sourceId,leave.sourceId);readOnly(r);
  assert.equal(JSON.stringify(r).includes('Fictional employee'),false);assert.equal(JSON.stringify(r).includes('Unmapped private job'),false);s.members.reverse();assert.deepEqual(previewSourceMapping(f).rows,r.rows);
 }
});

test('missing source members differ from blocked members even when the leave alias is also absent',()=>{
 const f=fixture();f.source.scopes[1].timeOff[0].memberSourceId='absent-member';let r=previewSourceMapping(f),row=r.rows.find(x=>x.kind==='timeOff');assert.ok(row.issues.includes('leave_member_mapping_required'));assert.ok(!row.issues.includes('leave_member_blocked'));assert.equal(row.memberSourceId,'absent-member');
 const g=fixture();g.mappings=g.mappings.filter(m=>m.storeId!==g.source.scopes[1].storeId);g.source.scopes[1].timeOff[0].status='withdrawn';r=previewSourceMapping(g);row=r.rows.find(x=>x.kind==='timeOff');
 assert.ok(row.issues.includes('identity_mapping_required'));assert.ok(row.issues.includes('leave_member_blocked'));assert.ok(row.issues.includes('leave_withdrawal_policy_required'));assert.equal(row.memberSourceId,g.source.scopes[1].timeOff[0].memberSourceId);readOnly(r);
});

test('duplicate leave with different withdrawal and member findings remains blocked and order-independent',()=>{
 const f=fixture(),s=f.source.scopes[1];s.timeOff.push({...s.timeOff[0],status:'withdrawn',memberSourceId:'absent-private-member'});s.coverage.timeOff.count++;
 const r=previewSourceMapping(f),leaves=r.rows.filter(row=>row.kind==='timeOff');assert.equal(r.status,'blocked');assert.equal(leaves.length,2);assert.ok(leaves.every(row=>row.status==='blocked'&&row.issues.includes('duplicate_source_record')));readOnly(r);
 s.timeOff.reverse();f.mappings.reverse();assert.deepEqual(previewSourceMapping(f),r);
});

test('actual CLI has distinct review-required, blocker and malformed exits while leaving input bytes intact',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jmax-source-followup-')),file=join(dir,'private-operator-input.json');
 try{
  for(const edit of [omitMember,unusedAlias]){const f=fixture();edit(f);const bytes=Buffer.from(JSON.stringify(f));writeFileSync(file,bytes);const run=spawnSync(process.execPath,[cli,file],{encoding:'utf8',windowsHide:true}),r=JSON.parse(run.stdout);assert.equal(run.status,3);assert.equal(r.status,'review_required');readOnly(r);assert.deepEqual(readFileSync(file),bytes);assert.equal(run.stdout.includes('Fictional employee'),false);}
  const f=fixture();unusedAlias(f);f.source.scopes[1].timeOff[0].status='cancelled';writeFileSync(file,JSON.stringify(f));let run=spawnSync(process.execPath,[cli,file],{encoding:'utf8',windowsHide:true});assert.equal(run.status,2);assert.equal(JSON.parse(run.stdout).status,'blocked');
  writeFileSync(file,'{');run=spawnSync(process.execPath,[cli,file],{encoding:'utf8',windowsHide:true});assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).error,'invalid_snapshot_json');assert.equal(run.stdout.includes(file),false);
 }finally{unlinkSync(file);rmdirSync(dir);}
});
