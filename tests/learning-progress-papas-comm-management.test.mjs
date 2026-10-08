import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runPositionWeek} from './all-position-week-fixture.mjs';
import {withLearningProgress} from './learning-progress-week-hook.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';

const runId=crypto.randomUUID();
const dir=path.resolve('evidence/learning-progress-simulations-2026-10-08/papas-comm-management/'+runId);
fs.mkdirSync(dir,{recursive:true});
const hashes=()=>Object.fromEntries(fs.readdirSync('.sites-runtime/shared').filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,createHash('sha256').update(fs.readFileSync('.sites-runtime/shared/'+f)).digest('hex')]));
const before=hashes(),results=[];
const testSourceHashes=Object.fromEntries(['tests/all-position-week-fixture.mjs','tests/learning-progress-week-hook.mjs','tests/learning-progress-papas-comm-management.test.mjs'].map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const profiles=['papas','management','commissary'].flatMap(group=>JSON.parse(fs.readFileSync('evidence/all-position-week/'+group+'-profiles.json','utf8')).map(p=>({...p,manifest:group+'-profiles.json',captureAIContexts:true,preserveDatabaseTo:path.join(dir,p.id+'.sqlite')})));
assert.equal(profiles.length,10);
function summary(){const after=hashes();return {runId,expectedProfiles:10,completedProfiles:results.length,simulationDaysPerProfile:21,testSourceHashes,totalDays:results.reduce((n,r)=>n+r.days.length,0),passedChecks:results.reduce((n,r)=>n+r.days.reduce((v,d)=>v+d.checks.filter(c=>c.status==='passed').length,0),0),failures:results.flatMap(r=>r.failures.map(f=>({profile:r.id,...f}))),aiContextRequests:results.reduce((n,r)=>n+(r.aiContextRequests??0),0),operationalReseeds:results.reduce((n,r)=>n+(r.operationalReseeds??0),0),runtimeRevision:before,runtimeRevisionAfter:after,runtimeUnchanged:JSON.stringify(before)===JSON.stringify(after),externalCalls:0,profiles:results.map(r=>({id:r.id,restaurant:r.restaurant,position:r.position,days:r.days.length,checks:r.days.reduce((n,d)=>n+d.checks.length,0),aiContextRequests:r.aiContextRequests,failures:r.failures,learningProgress:r.learningProgress,preservedDatabase:r.preservedDatabase})),limits:['Fictional records through authenticated actual local handlers. Physical duties are assigned and checked in software, not claimed physically performed.','The AI provider is mocked: context delivery is checked, not generated answer helpfulness or model training.','No hosted Jeff recipes, Toast, Shipday, cash reconciliation, actual payout, food production or stock posting.','Commissary names are functional QA groupings; shared dish remains assigned Pizza Make work, not a newly approved title.','Papa opens at 3 PM and uses one shift; the fixture end is fictional and does not establish an operating closing time.']};}

for(const original of profiles)test(original.id+': 21 continuous shifts with learning, progress and privacy',async()=>{
 const restaurantChecks=[];
 if(original.restaurant==='papa')original.dailyScenarios=original.dailyScenarios.map(s=>({...s,run:async({view,day})=>{
  assert.equal(day.actualShift.startClock,'15:00');
  const worker=await view('worker');assert.equal(worker.location.id,'papa');assert.equal(worker.me.position,original.position);
  const shift=worker.records.find(r=>r.id===day.actualShift.id);assert.ok(shift);
  const guide=worker.records.find(r=>r.kind==='standard'&&r.data.status==='approved'&&r.data.position===original.position);assert.deepEqual(guide.data.criteria,original.closing);
  restaurantChecks.push({day:day.day,oneShift:true,startClock:day.actualShift.startClock,position:worker.me.position,closingCriteriaPreserved:true});
 }}));
 if(original.restaurant==='comm')original.dailyScenarios=original.dailyScenarios.map(s=>({...s,run:async({request,store,day})=>{
  // An explicit grant is initial identity configuration, never broad employment access.
  if(day.day===1){
   store().sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run('worker-identity','commissary','comm');
   // Food scope needs explicit destination member bindings as well as the grant.
   // Those bindings do not grant access to the general personnel workspace.
   for(const loc of ['berts','rudds'])store().sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run('worker-food-'+loc,'worker@example.test','worker-identity',loc,'Fictional commissary Food-only binding','BOH',original.position,JSON.stringify(original.capabilities),JSON.stringify([original.position]));
  }
  const expected=original.capabilities.includes('tasks.manage')?200:403;
  for(const loc of ['berts','rudds']){
   assert.equal((await handleFoodWorkflows(request('food/workflows','worker',undefined,loc),store().db)).status,expected);
   assert.equal((await handleWorkspace(request('workspace','worker',undefined,loc),store().db)).status,403);
  }
  assert.equal((await handleFoodWorkflows(request('food/workflows','worker',undefined,'papa'),store().db)).status,403);
  restaurantChecks.push({day:day.day,explicitGrant:true,bertsAndRuddsFoodReadStatus:expected,employmentWorkspaceStatus:403,papaFoodStatus:403});
 }}));
 const profile=withLearningProgress(original);
 const result=await runPositionWeek(profile);result.learningProgress=profile.learningProgress;result.manifest=original.manifest;result.restaurantChecks=restaurantChecks;
 fs.writeFileSync(path.join(dir,original.id+'.json'),JSON.stringify(result,null,2)+'\n');results.push(result);
 fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary(),null,2)+'\n');
 assert.deepEqual(result.failures,[]);assert.equal(result.days.length,21);assert.equal(result.aiContextRequests,21);assert.equal(result.initialSeeds,1);assert.equal(result.operationalReseeds,0);assert.equal(result.finalReopen,true);assert.ok(fs.existsSync(result.preservedDatabase));assert.equal(summary().runtimeUnchanged,true);
});

test.after(()=>{const final=summary();fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(final,null,2)+'\n');console.log('Learning/progress evidence: '+path.join(dir,'summary.json'));});
