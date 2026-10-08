import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createSchedulingFixture,schedulingRuntimeHashes} from './scheduling-stress-fixture.mjs';
import {guidesForShift} from '../.sites-runtime/shared/shift-learning.mjs';
import {shiftContextWorkspace} from '../.sites-runtime/shared/shift-context.mjs';
import {buildShiftBrief} from '../.sites-runtime/shared/shift-brief.mjs';
import {employeeShiftWeek} from '../.sites-runtime/shared/employee-week.mjs';
import {closingStatus} from '../.sites-runtime/shared/closing-status.mjs';
import {handleEmployeeLogin} from '../.sites-runtime/shared/employee-login.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {openPositionDatabase} from './all-position-week-fixture.mjs';

// Readiness audit: do not seed per-shift tasks, close assignments or goals.
// A passing test documents current behavior, including explicit missing features.
const output=path.resolve('evidence/local-readiness-2026-10-08/shift-setup',crypto.randomUUID());
const before=schedulingRuntimeHashes();
const sources=Object.fromEntries(['app/shared/domain.ts','app/shared/station-assignment.ts','app/shared/shift-learning.ts','app/shared/shift-context.ts','app/shared/shift-brief.ts','app/shared/closing-status.ts','app/shared/week-copy.ts','app/team/shift-companion.tsx'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
after(()=>{
 const receipts=['berts','rudds','papa'].map(store=>JSON.parse(fs.readFileSync(path.join(output,store+'.json'),'utf8')));
 const summary={runDirectory:output,tests:3,assertedPhases:receipts.reduce((n,r)=>n+r.checks.length,0),failures:receipts.flatMap(r=>r.failures),gaps:receipts.flatMap(r=>(r.setupGaps??[]).map(g=>({restaurant:r.restaurant,...g}))),runtimeBefore:before,runtimeAfter:schedulingRuntimeHashes(),sourceHashes:sources,operatingReadiness:false,scope:'Fictional three-restaurant persistent SQLite records, actual authenticated workspace commands and authorized employee reads; no per-shift operational task or close inserted.',limits:['No real employees, external providers, browser or phone acceptance.','Station setup and approved QA guide text are configured once via handlers; per-shift work is deliberately not seeded.','Proposed station goals are voluntary training, not opening/closing work or clearance.','These tests characterize missing automatic setup; passing the assertions does not mean a complete operating shift.']};
 assert.deepEqual(summary.runtimeBefore,summary.runtimeAfter,'Shared runtime changed during tests');
 fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
 fs.writeFileSync(path.resolve('evidence/local-readiness-2026-10-08/shift-setup/latest-selection.json'),JSON.stringify(summary,null,2));
});

for(const store of ['berts','rudds','papa'])test(`${store}: genuine scheduled shift without manually seeded work exposes setup limits`,async()=>{
 const f=await createSchedulingFixture(store,output),{ids,job}=f;
 f.receipt.limits=['Fictional initial account configuration; actual workspace handlers and durable SQLite.','No external requests, operating data, real phones or employee trial.','No task.create, close.assign or goal.create command is used.'];
 f.receipt.setupGaps=[];let standard,station,shift,copied;
 try{
  // Initial fictional account configuration only; do not mutate permissions during a shift.
  const caps=['location.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','people.manage','standards.approve','close.confirm'];
  f.sqlite().prepare('UPDATE memberships SET capabilities=? WHERE id=?').run(JSON.stringify(caps),ids.manager);
  f.sqlite().prepare('UPDATE memberships SET qualifications=? WHERE id=?').run(JSON.stringify([job,'Host']),ids.worker);
  const instant=(d,t)=>f.instant(d,t);
  const workKinds=w=>w.records.filter(r=>['task','close'].includes(r.kind));
  await f.check('One-time approved guide and station configured; drafts create no employee work',async()=>{
   standard=await f.command(ids.manager,'standard.save',{title:'Fictional complete role reference',zone:'QA service station',position:job,criteria:['Fictional station restored for opening'],source:'QA-only instructions; not approved operating policy',version:1,verification:'manager',guide:{purpose:'Fictional role walkthrough',preparation:['Review manager briefing','Prepare the fictional station'],steps:['Maintain accurate service','Restore the fictional station'],troubleshooting:['Report fictional shortages'],escalation:'Ask the named manager'}});
   standard=await f.command(ids.manager,'standard.approve',{validated:true,note:'Approve only fictional test reference'},standard);
   station=await f.command(ids.manager,'station.save',{title:job,area:'FOH',levels:[],independentLevel:null,status:'active',note:'One-time fictional station configuration',setup:{jobs:[job],allJobMembers:true,memberIds:[],standardIds:[standard.recordId],managerId:ids.manager,goals:[{id:'review-guide',title:'Practice the fictional role',definition:'Explain the reviewed fictional guide',dueDays:7,standardId:standard.recordId}]}});
   shift=await f.command(ids.manager,'shift.save',{personId:ids.worker,position:job,stationId:station.recordId,start:instant('2026-10-19','15:00'),end:instant('2026-10-19','23:00')});
   const worker=await f.view(ids.worker);assert.ok(!worker.records.some(r=>r.id===shift.recordId));assert.equal(workKinds(worker).length,0);assert.equal(worker.records.filter(r=>r.kind==='goal').length,0);
  });
  await f.check('Publication makes schedule and approved guide visible and proposes one optional goal, not operating duties',async()=>{
   const preview=await f.publicationInput('2026-10-19',[shift]);
   const result=await f.command(ids.manager,'shift.publish-batch',preview,undefined,'setup-publish-once');
   f.reopen();assert.deepEqual(await f.command(ids.manager,'shift.publish-batch',preview,undefined,'setup-publish-once'),result);
   const worker=await f.view(ids.worker),saved=f.find(shift.recordId),goals=worker.records.filter(r=>r.kind==='goal');
   assert.ok(worker.records.some(r=>r.id===saved.id));assert.deepEqual(guidesForShift(worker,saved).map(r=>r.id),[standard.recordId]);
   assert.equal(goals.length,1);assert.equal(goals[0].data.phase,'proposed');assert.equal(goals[0].data.type,'development');assert.ok(worker.me.qualifications.includes(job));assert.ok(!worker.me.qualifications.includes('Practice the fictional role'));
   assert.equal(workKinds(worker).length,0);const brief=buildShiftBrief(worker,instant('2026-10-19','16:00'));assert.equal(brief.current.id,saved.id);assert.equal(brief.items.filter(i=>i.category==='shift').length,0);
   const status=closingStatus(worker,saved);assert.equal(status.required,false);assert.equal(status.complete,true);
   f.receipt.setupGaps.push({kind:'missing-feature',area:'Automatic operating work',evidence:'Published shift with an approved guide and configured learning template creates one optional learning goal but zero task/close records; the shift brief has zero operational next actions.',shiftId:saved.id});
  });
  await f.check('Copy next week preserves station, creates private draft, keeps goal receipt, and carries no completion',async()=>{
   const input=await f.copyInput('2026-10-19','2026-10-26',[shift]);await f.command(ids.manager,'shift.copy-week',input);
   copied=(await f.view()).records.find(r=>r.kind==='shift'&&r.data.copiedFrom?.targetWeek==='2026-10-26');assert.ok(copied);assert.equal(copied.data.stationId,station.recordId);assert.equal(copied.data.published,false);assert.equal(copied.data.releasedAt,undefined);
   assert.ok(!(await f.view(ids.worker)).records.some(r=>r.id===copied.id));assert.equal((await f.view()).records.filter(r=>r.kind==='goal').length,1);
   await f.publish('2026-10-26',[copied]);f.reopen();const worker=await f.view(ids.worker);assert.ok(worker.records.some(r=>r.id===copied.id));assert.equal(worker.records.filter(r=>r.kind==='goal').length,1);assert.equal(workKinds(worker).length,0);
   assert.equal(f.find(copied.id).data.history.some(h=>['closed','released','confirm'].includes(h.action)),false);
  });
  await f.check('Code sign-in reads published copied shift and approved guide without generating tasks; revoked session denied',async()=>{
   f.setNow(instant('2026-10-26','15:15'));const connection=openPositionDatabase(f.receipt.database),binding={JMAX_LOGIN_SECRET:'a'.repeat(64)};
   try{
    const headers={Origin:'https://shift-setup.example','Content-Type':'application/json'};
    const issue=await handleEmployeeLogin(new Request('https://shift-setup.example/api/employee-login',{method:'POST',headers:{...headers,'oai-authenticated-user-id':ids.manager+'-identity','oai-authenticated-user-email':ids.manager+'@example.test'},body:JSON.stringify({action:'issue',locationId:store,memberId:ids.worker,expectedRevision:1})}),connection.db,binding);
    const issued=await issue.json();assert.equal(issue.status,200,JSON.stringify(issued));
    const login=await handleEmployeeLogin(new Request('https://shift-setup.example/api/employee-login',{method:'POST',headers,body:JSON.stringify({action:'verify',code:issued.code})}),connection.db,binding);assert.equal(login.status,200,await login.clone().text());
    const cookie=login.headers.get('Set-Cookie').split(';')[0],read=location=>handleWorkspace(new Request('https://shift-setup.example/api/workspace?locationId='+location,{headers:{Cookie:cookie}}),connection.db);
    const response=await read(store);assert.equal(response.status,200);const w=await response.json();assert.equal(w.me.id,ids.worker);assert.ok(w.records.some(r=>r.id===copied.id));assert.equal(buildShiftBrief(w,new Date().toISOString()).current.id,copied.id);assert.deepEqual(guidesForShift(w,f.find(copied.id)).map(g=>g.id),[standard.recordId]);assert.equal(workKinds(w).length,0);
    for(const other of ['berts','rudds','papa'].filter(loc=>loc!==store))assert.equal((await read(other)).status,403);
    const logout=await handleEmployeeLogin(new Request('https://shift-setup.example/api/employee-login',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({action:'logout'})}),connection.db,binding);assert.equal(logout.status,200);assert.equal((await read(store)).status,401);
    f.receipt.phoneSessionSimulation=true;
   }finally{connection.close();}
  });
  await f.check('Published role change links only new exact-role guide; prior station goal stays separate from shift',async()=>{
   let host=await f.command(ids.manager,'standard.save',{title:'Fictional Host reference',zone:'QA host stand',position:'Host',criteria:['QA host station ready'],source:'QA-only Host reference',version:1,verification:'manager',guide:{purpose:'QA Host role',preparation:['Read the QA host briefing'],steps:['Welcome fictional guest'],troubleshooting:['Notify manager'],escalation:'QA manager'}});host=await f.command(ids.manager,'standard.approve',{validated:true,note:'QA-only reference'},host);
   shift=await f.command(ids.manager,'shift.save',{personId:ids.worker,position:'Host',stationId:'',start:instant('2026-10-19','15:00'),end:instant('2026-10-19','23:00'),note:'Fictional position change, no prior work assigned'},f.find(shift.recordId));
   const worker=await f.view(ids.worker),saved=f.find(shift.recordId);assert.deepEqual(guidesForShift(worker,saved).map(r=>r.id),[host.recordId]);
   const context=shiftContextWorkspace(worker,saved);assert.ok(context.records.some(r=>r.id===host.recordId));assert.ok(!context.records.some(r=>r.id===standard.recordId));assert.equal(context.records.filter(r=>r.kind==='goal').length,0);assert.equal(workKinds(worker).length,0);
   assert.equal(worker.records.filter(r=>r.kind==='goal').length,1,'Optional development history is retained independently of the changed operational role');
  });
  await f.check('Cancellation removes current operating shift and guide association; off-day has zero scheduled shifts',async()=>{
   await f.command(ids.manager,'shift.cancel',{note:'Fictional cancelled staffing need'},f.find(shift.recordId));f.reopen();const worker=await f.view(ids.worker),cancelled=f.find(shift.recordId),brief=buildShiftBrief(worker,instant('2026-10-19','16:00'));
   assert.equal(brief.current,undefined);assert.notEqual(brief.shift?.id,cancelled.id);assert.deepEqual(guidesForShift(worker,cancelled),[]);
   const week=employeeShiftWeek(worker,copied);assert.equal(week.days.find(d=>d.date==='2026-10-27').shifts.length,0);
   const beforeOff=f.snapshot();f.setNow(instant('2026-10-27','16:00'));await f.view(ids.worker);f.reopen();assert.equal(f.snapshot(),beforeOff,'Off-day workspace reads do not create/reset operational work');
   assert.equal(workKinds(await f.view(ids.worker)).length,0);
  });
  await f.check('Manager can record release when no closing work was generated; report readiness boundary explicitly',async()=>{
   f.setNow(instant('2026-10-26','23:01'));const saved=f.find(copied.id);await f.command(ids.manager,'shift.release',{note:'QA boundary: independent manager releases a shift with no configured assignments'},saved);f.reopen();assert.ok(f.find(copied.id).data.releasedAt);assert.equal(workKinds(await f.view(ids.worker)).length,0);
   f.receipt.setupGaps.push({kind:'configuration-readiness-boundary',area:'Manager checkout without assigned work',evidence:'A published shift with no task/close assignments reports closing complete and manager release succeeds. This is not proof that operating work occurred; no recurring duty setup is connected.',shiftId:copied.id});
   assert.ok((await f.view(ids.worker)).records.every(r=>r.locationId===store));
  });
 }finally{f.finish();}
});
