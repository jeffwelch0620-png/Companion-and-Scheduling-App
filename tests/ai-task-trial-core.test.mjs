import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {buildTaskCases,createTaskTrial,trialSource} from './ai-task-trial-fixture.mjs';
import {boundaryClaims,gradeTrialCases} from './ai-task-trial-runner.mjs';

test('case coverage preserves every unique documented duty by phase plus each curveball and goal',()=>{
 const profile={id:'coverage',position:'Server',restaurant:'berts',opening:['A','A','B'],service:['A'],closing:['C'],goal:'Practice A',dailyScenarios:[{title:'Exception',detail:'Needs correction',nextAction:'Tell Expo'}]};
 const cases=buildTaskCases(profile);assert.equal(cases.length,6);assert.equal(new Set(cases.map(c=>c.caseId)).size,6);assert.equal(cases.filter(c=>c.type==='curveball')[0].expectedHelpfulAction,'Tell Expo');assert.equal(trialSource({provenance:{source:{title:'Reviewed source'}}}),'"title":"Reviewed source"'.replace(/^/,'{')+'}');
});
test('task trials use actual authenticated handler, preserve database and archive phase history without operational writes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-task-ai-'));
 const profile={id:'core-trial',position:'Server',restaurant:'berts',area:'FOH',opening:['Check assigned section','Check menus'],service:['Repeat the food order back'],closing:['Bag silverware'],goal:'Practice order read-back',provenance:{source:{title:'Confirmed discussion'}},dailyScenarios:[{title:'Incorrect item',detail:'Ticket does not match food',nextAction:'Ask Expo to correct the item and notify the server.'}]};
 const seen=[];const trial=await createTaskTrial(profile,{file:path.join(dir,'saved.sqlite'),bindings:{OPENAI_API_KEY:'sk-fictional-task-test',JMAX_OPENAI_MODEL:'gpt-5.4-mini'},fetcher:async(_url,_init,{context})=>{seen.push(context);return Response.json({status:'completed',usage:{input_tokens:1,output_tokens:1},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Follow the current role instructions, correct the ticket mismatch with Expo and request the manager check. Chat has not notified anyone or completed the task.',sourceIds:context.evidence.map(e=>e.source.id).slice(0,20)})}]}]});}});t.after(()=>{trial.close();fs.rmSync(dir,{recursive:true,force:true});});
 for(const spec of trial.cases){const before=trial.snapshot(),r=await trial.askCase(spec);assert.equal(r.handlerStatus,200,JSON.stringify(r));assert.equal(r.providerStatus,200);assert.equal(r.status,'complete');assert.ok(r.evidence.some(e=>e.source.id===r.focus.id));assert.equal(r.operationalMutation,false);assert.notEqual(trial.snapshot(),before,'Actual task is created before the separately guarded chat');}
 const final=await trial.finish();assert.equal(final.retainedTurns,6);assert.equal(final.retainedArchives,4);assert.equal(final.operationalReseeds,0);assert.ok(final.databaseReopens>=5);assert.ok(final.priorGuideAnswersChecked>=1);assert.equal(final.finalGuideAnswersRetrieved,4);assert.equal(seen.length,6);
});
test('quality grading covers each actual case and does not confuse HTTP success with answer quality',async()=>{
 assert.equal(boundaryClaims('I notified the manager.'),true);assert.equal(boundaryClaims('I have not notified anyone.'),false);
 const cases=[{caseId:'safe',handlerStatus:200,providerStatus:200,status:'complete',answer:'Ask Expo to correct the item',evidence:[],sources:[]},{caseId:'bad-handler',handlerStatus:403,status:'handler-error',answer:''}];
 const result=await gradeTrialCases({position:'Server',restaurant:'berts'},cases,'sk-fictional-test',async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({grades:[{caseId:'safe',grade:'partial',reason:'Missing guest follow-through',missingInformation:''}]})}]}]}));
 assert.equal(result.grades.find(g=>g.caseId==='safe').grade,'partial');assert.equal(result.grades.find(g=>g.caseId==='bad-handler').grade,'fail');
});
