import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runPositionWeek} from './all-position-week-fixture.mjs';
import {createLearningProgressOverrides} from './learning-progress-week-hook.mjs';

const ActualDate=Date,runId=new ActualDate().toISOString().replaceAll(':','-').replaceAll('.','-');
const output=path.resolve('evidence/learning-progress-simulations-2026-10-08/berts-foh',runId);fs.mkdirSync(output,{recursive:true});
const profiles=JSON.parse(fs.readFileSync('evidence/all-position-week/berts-foh-profiles.json','utf8'));
assert.equal(profiles.length,7);assert.ok(profiles.every(p=>p.restaurant==='berts'&&p.area==='FOH'));
const snapshot=()=>{const modules=fs.readdirSync('.sites-runtime/shared').filter(name=>name.endsWith('.mjs')).sort().map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(path.join('.sites-runtime/shared',name))).digest('hex')}));return {sha256:createHash('sha256').update(JSON.stringify(modules)).digest('hex'),modules};};
const frozen=snapshot();fs.writeFileSync(path.join(output,'runtime-before.json'),JSON.stringify(frozen,null,2)+'\n');
const limitations=[
 'Expo opening still uses a supplemental clearly fictional starter reference, not newly approved restaurant policy.',
 'Detailed recovered Bert’s section and side-work sheets are not verified by this generic manifest.',
 'The FOH Manager duties come from the confirmed management discussion rather than a dedicated catalog row.',
 'Actual local handlers and durable fictional records prove software state, not physical service, ticket accuracy, payments, bank settlement or inspections.',
 'AI provider is mocked to inspect authorized current context and exclusions; this does not prove live model helpfulness or a live Jeff/Toast connection.',
 'Employee operational reports are explicitly shared; private chat is not automatically a manager report.'
];
const summary={runId,status:'running',restaurant:'berts',positions:7,simulationDaysPerPosition:21,roleDays:0,passedChecks:0,failedChecks:0,savedRecords:0,savedTurns:0,aiContextRequests:0,results:[],runtimeBefore:frozen.sha256,limits:limitations};
const writeSummary=()=>fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');writeSummary();
test.after(()=>{const after=snapshot();fs.writeFileSync(path.join(output,'runtime-after.json'),JSON.stringify(after,null,2)+'\n');summary.runtimeAfter=after.sha256;summary.runtimeUnchanged=after.sha256===frozen.sha256;summary.status=summary.results.length===7&&summary.results.every(r=>r.failures.length===0)&&summary.runtimeUnchanged?'passed':'failed or incomplete';writeSummary();});

for(const original of profiles)test(`Bert’s ${original.position}: 21 continuous full shifts with new shared learning and private progress`,{concurrency:false},async()=>{
 const overrides=createLearningProgressOverrides(original),profile={...original,...overrides,preserveDatabaseTo:path.join(output,original.id+'.sqlite'),captureAIContexts:true};
 assert.equal(snapshot().sha256,frozen.sha256,'Frozen runtime changed before position started');
 const result=await runPositionWeek(profile);result.learningProgress=overrides.learningProgress;result.contentLimits=limitations;result.runtimeSha256=frozen.sha256;
 fs.writeFileSync(path.join(output,original.id+'.json'),JSON.stringify(result,null,2)+'\n');
 const checks=result.days.flatMap(day=>day.checks);summary.roleDays+=result.days.length;summary.passedChecks+=checks.filter(c=>c.status==='passed').length;summary.failedChecks+=checks.filter(c=>c.status==='failed').length;summary.savedRecords+=result.savedRecords??0;summary.savedTurns+=result.savedTurns??0;summary.aiContextRequests+=result.aiContextRequests??0;summary.results.push({id:original.id,position:original.position,days:result.days.length,checks:checks.length,failures:result.failures,learningProgress:result.learningProgress,preservedDatabase:result.preservedDatabase});writeSummary();
 assert.equal(result.days.length,21);assert.deepEqual(result.failures,[],JSON.stringify(result.failures));assert.equal(result.initialSeeds,1);assert.equal(result.operationalReseeds,0);assert.equal(result.finalReopen,true);assert.equal(result.savedTurns,21);assert.equal(result.aiContextRequests,21);assert.ok(fs.statSync(profile.preserveDatabaseTo).size>0);assert.equal(snapshot().sha256,frozen.sha256,'Frozen runtime changed while position ran');
});
