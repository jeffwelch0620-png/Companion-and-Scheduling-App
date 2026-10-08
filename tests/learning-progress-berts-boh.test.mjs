import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runPositionWeek} from './all-position-week-fixture.mjs';
import {trialSourceRevision} from './ai-task-trial-fixture.mjs';
import {createLearningProgressOverrides} from './learning-progress-week-hook.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';

const root='evidence/learning-progress-simulations-2026-10-08/berts-boh';
fs.mkdirSync(root,{recursive:true});
const profiles=JSON.parse(fs.readFileSync('evidence/all-position-week/berts-boh-profiles.json','utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceRevision={...trialSourceRevision(),weekFixtureSha256:hash('tests/all-position-week-fixture.mjs'),learningProgressHookSha256:hash('tests/learning-progress-week-hook.mjs')};
const summary={startedAt:new Date().toISOString(),sourceRevision,profiles:[],failures:[],provider:'Local fictional mocked AI; no external calls',continuousDays:21,limits:['Each profile retains one database and its saved operational, learning and private progress records across all 21 days; initial setup occurs once.','Opening, service curveballs, reported corrections, dedicated Dish handoffs, closing checks and manager release use actual local authenticated handlers. No physical actions are proven.','Generic approved QA guides and task records are fictional source-labelled instructions; this is not a live Jeff recipe pull or Food inventory/production simulation.','Mocked provider input verifies authorized following-shift context; no generated-answer helpfulness or live forecast claim.','Dish learning uses the authorized task and explicit operational-report path. Legacy development goals remain excluded; no permission is granted to bridge that exclusion.','PM no-show replacement remains an existing separate gap; this run does not invent substitute acceptance or manager bypass.']};
const persistSummary=()=>fs.writeFileSync(root+'/summary.json',JSON.stringify(summary,null,2)+'\n');
for(const profile of profiles)test(`${profile.id}: 21 continuous opening-service-closing shifts with learning and private progress`,{concurrency:false},async()=>{
 const overrides=createLearningProgressOverrides(profile);
 const extraScopeChecks=[];
 if(profile.position==='Dishwasher')overrides.dailyScenarios=overrides.dailyScenarios.map(scenario=>({...scenario,run:async context=>{
  await scenario.run?.(context);
  if(context.day.day!==1)return;
  const {command,view,request,store}=context;
  const equipment=await command('manager','equipment.create',{title:'Fictional hidden dish machine',assetTag:'PRIVATE-DISH-SCOPE-1',placement:'Fictional dish room',sourceRef:'Isolated simulation fixture, no real equipment verification',details:'HIDDEN_EQUIPMENT_PRIVATE_NOTES',checked:true,note:'Fictional source checked only for handler trial'});
  assert.equal((await view('worker')).records.some(r=>r.id===equipment.recordId),false,'Dish view must not reveal manager-only equipment');
  const otherWork=await command('manager','task.create',{ownerId:'incoming',title:'Other employee private source',detail:'OTHER_EMPLOYEE_PRIVATE_DISH_WORK',kind:'task',due:new Date(context.day.dayStart+6*3600000).toISOString()});
  const snapshot=()=>JSON.stringify(Object.fromEntries(['records','audit_events','command_receipts'].map(table=>[table,store().sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
  for(const source of [equipment,otherWork]){const before=snapshot();const response=await handleWorkspace(request('workspace','worker',{locationId:profile.restaurant,requestId:crypto.randomUUID(),action:'learningcase.submit',input:{sourceId:source.recordId,sourceRevision:source.revision,shareConfirmed:true,title:'Cannot attach hidden source',symptom:'Fictional symptom',observedResult:'No authorized source'}}),store().db);assert.ok([400,403,404].includes(response.status),await response.text());assert.equal(snapshot(),before);extraScopeChecks.push({day:1,source:source.recordId,kind:source===equipment?'hidden-equipment':'other-worker-task',denied:true,zeroWrites:true});}
 }}));
 const result=await runPositionWeek({...profile,...overrides,simulationStartDate:'2026-10-08',preserveDatabaseTo:`${root}/${profile.id}.sqlite`});
 const finalSourceRevision=trialSourceRevision();
 const receipt={...result,learningProgress:overrides.learningProgress,extraScopeChecks,sourceRevision,finalSourceRevision,runtimeUnchanged:sourceRevision.runtimeSha256===finalSourceRevision.runtimeSha256,knownGaps:profile.knownGaps??[],proofScope:summary.limits};
 fs.writeFileSync(`${root}/${profile.id}.json`,JSON.stringify(receipt,null,2)+'\n');
 summary.profiles.push({id:profile.id,position:profile.position,shiftVariant:result.shiftVariant,days:result.days.length,phaseChecks:result.days.reduce((n,d)=>n+d.checks.length,0),aiContextRequests:result.aiContextRequests,savedTurns:result.savedTurns,savedRecords:result.savedRecords,initialSeeds:result.initialSeeds,operationalReseeds:result.operationalReseeds,interruptionReopens:result.interruptionReopens,finalReopen:result.finalReopen,runtimeUnchanged:receipt.runtimeUnchanged,learningProgress:overrides.learningProgress,extraScopeChecks,failures:result.failures,receipt:`${profile.id}.json`,database:`${profile.id}.sqlite`});
 summary.failures.push(...result.failures.map(f=>({profileId:profile.id,...f})));persistSummary();
 assert.deepEqual(result.failures,[],JSON.stringify(result.failures));assert.equal(result.days.length,21);assert.equal(result.initialSeeds,1);assert.equal(result.operationalReseeds,0);assert.equal(result.finalReopen,true);assert.equal(result.interruptionReopens,21);assert.equal(result.savedTurns,21);assert.equal(result.aiContextRequests,21);assert.equal(receipt.runtimeUnchanged,true,'Frozen runtime must remain the same throughout this receipt');
});
test.after(()=>{summary.completedAt=new Date().toISOString();summary.finalSourceRevision=trialSourceRevision();summary.runtimeUnchanged=summary.sourceRevision.runtimeSha256===summary.finalSourceRevision.runtimeSha256;summary.totalPositionDays=summary.profiles.reduce((n,p)=>n+p.days,0);summary.totalPhaseChecks=summary.profiles.reduce((n,p)=>n+p.phaseChecks,0);summary.totalAIRequests=summary.profiles.reduce((n,p)=>n+p.aiContextRequests,0);summary.totalDiskReopens=summary.profiles.reduce((n,p)=>n+p.interruptionReopens,0);persistSummary();});
