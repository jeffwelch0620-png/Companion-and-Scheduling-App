import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createTaskTrial} from '../.hour-achievement-review-tests/ai-task-trial-fixture.mjs';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.hour-achievement-review-runtime/shared/service.mjs';
const receipts=[];
test('actual independent goal review awards atomically; source retirement, retry, privacy and clearance remain guarded',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-achievement-handler-')),file=path.join(dir,'saved.sqlite'),profile={id:'achievement-review',restaurant:'berts',position:'Server',area:'FOH',opening:['Read current approved guide.'],service:['Practice the assigned outcome.'],closing:['Use independent manager review.']};
 const trial=await createTaskTrial(profile,{file,bindings:{},fetcher:async()=>{throw Error('No provider calls');}});let store=openPositionDatabase(file);t.after(()=>{store.close();trial.close();fs.rmSync(dir,{recursive:true,force:true});});
 const call=async(actor,action,input,r,requestId=crypto.randomUUID())=>{const response=await handleWorkspace(trial.request('workspace',actor,{locationId:'berts',action,input,requestId,...(r?{recordId:r.id??r.recordId,expectedRevision:r.revision}:{})}),store.db);return {status:response.status,data:await response.json()};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const work=async(actor='worker',loc='berts')=>{const response=await handleWorkspace(trial.request('workspace',actor,undefined,loc),store.db);return {status:response.status,data:await response.json()};};
 const awards=()=>store.sqlite.prepare("SELECT * FROM records WHERE kind='achievement'").all().map(r=>({...r,data:JSON.parse(r.data)}));
 const allState=()=>JSON.stringify(Object.fromEntries(['records','audit_events','command_receipts','memberships'].map(table=>[table,store.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 const memberBefore=store.sqlite.prepare('SELECT capabilities,qualifications FROM memberships WHERE id=?').get('worker');
 let goal=ok(await call('worker','goal.create',{ownerId:'worker',type:'development',title:'Reviewed service practice',definition:'Observe approved service behavior',managerId:'manager',standardId:trial.guide.id,standardRevision:trial.guide.revision,due:'2027-01-01T12:00:00Z'}));
 goal=ok(await call('worker','goal.transition',{step:'ready',note:'Fictional reported practice ready'},goal));assert.equal(awards().filter(r=>r.data.milestoneId==='learning-step').length,0);
 const before=allState();assert.equal((await call('worker','goal.transition',{step:'verify',note:'Self review must not earn'},goal)).status,403);assert.equal(allState(),before);
 // Interrupt just the automatic achievement insertion. Goal outcome, badge,
 // notification, audit and retry receipt must all roll back together.
 store.sqlite.exec("CREATE TRIGGER interrupt_achievement BEFORE INSERT ON records WHEN NEW.kind='achievement' BEGIN SELECT RAISE(ABORT,'Fictional automatic achievement write interrupted'); END");const interruptedBefore=allState();const verifyInput={step:'verify',note:'Independent reviewer observed agreed practice'};assert.equal((await call('manager','goal.transition',verifyInput,goal,'goal-review-atomic-fail')).status,503);assert.equal(allState(),interruptedBefore);store.sqlite.exec('DROP TRIGGER interrupt_achievement');
 const verified=ok(await call('manager','goal.transition',verifyInput,goal,'goal-review-retry'));const earned=awards().filter(r=>r.data.milestoneId==='learning-step');assert.equal(earned.length,1);assert.equal(earned[0].data.status,'earned');const saved=allState();assert.deepEqual(ok(await call('manager','goal.transition',verifyInput,goal,'goal-review-retry')),verified);assert.equal(allState(),saved);
 assert.deepEqual(store.sqlite.prepare('SELECT capabilities,qualifications FROM memberships WHERE id=?').get('worker'),memberBefore);
 const workerView=ok(await work());assert.ok(workerView.records.some(r=>r.id===earned[0].id&&r.data.status==='earned'));const managerView=ok(await work('manager'));assert.equal(managerView.records.some(r=>r.id===earned[0].id),false,'Private milestone is not a manager-wide performance feed');assert.equal((await work('outsider','berts')).status,403);
 ok(await call('manager','standard.retire',{note:'Fictional source instruction withdrawn after review'},trial.guide));
 assert.equal(awards().find(r=>r.id===earned[0].id).data.status,'review-needed','Retiring a source updates the persisted badge in the same command');
 const changed=ok(await work());assert.equal(changed.records.find(r=>r.id===earned[0].id).data.status,'review-needed');assert.equal(changed.records.find(r=>r.id===goal.recordId).data.phase,'closed','A changed guide does not erase historical outcome');
 const originalDate=earned[0].data.earnedAt;store.close();store=openPositionDatabase(file);const reopened=ok(await work());assert.equal(reopened.records.find(r=>r.id===earned[0].id).data.status,'review-needed');assert.equal(reopened.records.find(r=>r.id===earned[0].id).data.earnedAt,originalDate);assert.deepEqual(store.sqlite.prepare('SELECT capabilities,qualifications FROM memberships WHERE id=?').get('worker'),memberBefore);
 receipts.push({case:'Actual handler automatic award transaction and boundaries',passed:true,atomicRollback:true,retryNoFarm:true,selfReviewDenied:true,privateLocal:true,sourceRetireReviewNeeded:true,durableReopen:true,qualificationUnchanged:true});
});
test.after(()=>fs.writeFileSync('evidence/hour-trial/berts-boh/achievement-handler-independent-review.json',JSON.stringify({providerCalls:0,receipts,proof:'Actual authenticated local handlers and durable fictional SQLite; no live model or restaurant data.'},null,2)+'\n'));
