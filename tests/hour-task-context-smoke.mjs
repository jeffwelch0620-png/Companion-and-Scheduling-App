import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {buildTaskCases,createTaskTrial,trialSourceRevision,trialGaps} from './ai-task-trial-fixture.mjs';

const root=process.env.HOUR_TASK_EVIDENCE_ROOT??'evidence/hour-trial/final-current-local-smoke';
const groups=['berts-foh','berts-boh','rudds','papas','management','commissary'];
const profiles=groups.flatMap(group=>JSON.parse(fs.readFileSync(`evidence/all-position-week/${group}-profiles.json`,'utf8')).map(profile=>({...profile,group})));
const sourceRevision=trialSourceRevision();
const summary={startedAt:new Date().toISOString(),sourceRevision,realProvider:false,externalProviderCalls:0,qualityGrades:null,profiles:[],failures:[],limits:['Actual scoped chat and workspace handlers on durable fictional SQLite fixtures; provider output is canned mock text.','Covers every documented manifest duty entry, supported practice goal and seven curveballs; several entries combine physical actions.','Normal duties select fictional QA-approved manifest instructions, not production SOP approval or live Jeff recipes.','A delivered mock answer proves persistence and context contracts only, never generated answer usefulness.']};
fs.mkdirSync(root,{recursive:true});const save=(file,data)=>fs.writeFileSync(path.join(root,file),JSON.stringify(data,null,2));let next=0;
async function worker(){
 while(next<profiles.length){
  const profile=profiles[next++],specs=buildTaskCases(profile),filename=profile.id+'.json',database=path.join(root,profile.id+'.sqlite');
  assert.equal(fs.existsSync(database),false,'Final checkpoint evidence requires a fresh database, not resumed old receipts');
  const report={profileId:profile.id,restaurant:profile.restaurant,position:profile.position,group:profile.group,sourceRevision,realProvider:false,qualityGrades:null,provenance:profile.provenance??null,sourceGaps:trialGaps(profile),expectedCases:specs.length,cases:[],failures:[],proofScope:summary.limits};let trial;
  try{
   trial=await createTaskTrial(profile,{file:database,bindings:{OPENAI_API_KEY:'sk-fictional-local-context-only',JMAX_OPENAI_MODEL:'gpt-5.4-mini'},fetcher:async(_url,_init,{context})=>Response.json({status:'completed',usage:{input_tokens:0,output_tokens:0},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'MOCK CONTEXT CONTRACT: Consult the attached current instructions and named manager for an unresolved requirement. This fixed test response did not perform, notify, approve or release any operational work.',sourceIds:context.evidence.map(e=>e.source.id).slice(0,20)})}]}]})});
   for(const spec of specs){
    let result;
    try{result=await trial.askCase(spec);assert.equal(result.handlerStatus,200);assert.equal(result.providerStatus,200);assert.equal(result.status,'complete');assert.ok(result.answer,'Actual handler answer must remain readable immediately');assert.equal(result.operationalMutation,false);assert.ok(result.evidence.some(e=>e.source.id===result.focus.id),'The selected actual current source must reach authorized context');result.contractStatus='passed';}
    catch(error){report.failures.push({caseId:spec.caseId,error:String(error.stack??error)});result={...(result??spec),contractStatus:'failed',error:String(error.message??error)};}
    report.cases.push(result);save(filename,report);
   }
   report.persistence=await trial.finish();assert.equal(report.persistence.retainedTurns,specs.length);assert.equal(report.persistence.operationalReseeds,0);
  }catch(error){report.failures.push({phase:'fixture-or-persistence',error:String(error.stack??error)});}
  finally{trial?.close();report.completedAt=new Date().toISOString();save(filename,report);}
  summary.profiles.push({id:profile.id,group:profile.group,restaurant:profile.restaurant,position:profile.position,expectedCases:specs.length,observedCases:report.cases.length,failedCases:report.failures,persistence:report.persistence??null,receipt:filename,database:path.basename(database)});summary.failures.push(...report.failures.map(f=>({profileId:profile.id,...f})));save('summary.json',summary);console.log(JSON.stringify({profileId:profile.id,cases:report.cases.length,failures:report.failures.length}));
 }
}
// This fixture uses a private clock per profile; no process-wide Date mutation.
await Promise.all(Array.from({length:3},worker));
summary.completedAt=new Date().toISOString();summary.totalDocumentedCases=profiles.reduce((n,p)=>n+buildTaskCases(p).length,0);summary.totalObservedCases=summary.profiles.reduce((n,p)=>n+p.observedCases,0);summary.retainedTurns=summary.profiles.reduce((n,p)=>n+(p.persistence?.retainedTurns??0),0);summary.retainedArchives=summary.profiles.reduce((n,p)=>n+(p.persistence?.retainedArchives??0),0);summary.databaseReopens=summary.profiles.reduce((n,p)=>n+(p.persistence?.databaseReopens??0),0);summary.priorGuideAnswersChecked=summary.profiles.reduce((n,p)=>n+(p.persistence?.priorGuideAnswersChecked??0),0);summary.finalGuideAnswersRetrieved=summary.profiles.reduce((n,p)=>n+(p.persistence?.finalGuideAnswersRetrieved??0),0);summary.finalSourceRevision=trialSourceRevision();summary.runtimeUnchanged=summary.finalSourceRevision.runtimeSha256===sourceRevision.runtimeSha256;save('summary.json',summary);
console.log(JSON.stringify({profiles:summary.profiles.length,cases:summary.totalObservedCases,failures:summary.failures.length,runtimeUnchanged:summary.runtimeUnchanged}));assert.equal(summary.profiles.length,42);assert.equal(summary.totalObservedCases,564);assert.deepEqual(summary.failures,[]);assert.equal(summary.runtimeUnchanged,true);
