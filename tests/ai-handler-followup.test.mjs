import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runHandlerCase} from './ai-week-handler-fixture.mjs';
const cases=role=>JSON.parse(fs.readFileSync(`evidence/ai-week/${role}-cases.json`,'utf8')).cases;
const config={key:'sk-fictional-test-only',model:'gpt-5.4-mini'};
function replies(select,inspect=()=>{}){
 let turn=0;
 return async(_url,init)=>{
  const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  inspect(context,input,turn);
  const sourceIds=select(context,turn++);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Use the current saved work. This conversation changes no operational record.',sourceIds})}]}]});
 };
}
test('authenticated follow-up rereads revised handoff work without restoring the old answer',async()=>{
 const c=cases('server').find(c=>c.day===6);
 const result=await runHandlerCase('server',c,config,replies(ctx=>[ctx.selectedWork.id],(ctx,input,turn)=>{
  if(turn){assert.equal(ctx.selectedWork.revision,2);assert.equal(ctx.scopeMode,'selected-closing-work');assert.ok(!input.some(m=>m.role==='assistant'));assert.ok(ctx.previousWorkChanged);}
 }));
 assert.ok(result.turns.every(t=>t.status==='completed'&&t.workUnchanged));
 assert.ok(JSON.stringify(result.turns[1].context).includes('verification'));
});
test('a valid leadership citation does not discard attached-shift conversation history',async()=>{
 const c=cases('host').find(c=>c.day===6);
 const result=await runHandlerCase('host',c,config,replies(ctx=>ctx.evidence.filter(e=>['shift','leadership'].includes(e.source.kind)).map(e=>e.source.id),(ctx,input,turn)=>{
  if(turn){assert.equal(ctx.scopeMode,'selected-shift');assert.ok(input.some(m=>m.role==='assistant'));}
 }));
 assert.ok(result.turns.every(t=>t.status==='completed'&&t.workUnchanged));
 assert.ok(result.turns[0].sources.some(s=>s.kind==='leadership'));
});
test('prep follow-up rereads released lists even when the question contains no prep keyword',async()=>{
 const c=cases('prep-cook').find(c=>c.day===5);
 const result=await runHandlerCase('prep-cook',c,config,replies(ctx=>ctx.evidence.filter(e=>e.source.kind==='food-prep').map(e=>e.source.id)));
 assert.ok(result.turns.every(t=>t.status==='completed'&&t.workUnchanged));
 assert.ok(result.turns[1].context.assignedPrep);
 assert.ok(result.turns[1].sources.some(s=>s.kind==='food-prep'));
});
test('fixture follow-up actually applies changed member qualifications',async()=>{
 const c=cases('gm').find(c=>c.day===6);
 const result=await runHandlerCase('gm',c,config,replies(ctx=>ctx.evidence.filter(e=>e.source.kind==='schedule-week').map(e=>e.source.id)));
 assert.ok(result.turns.every(t=>t.status==='completed'&&t.workUnchanged));
 const week=result.turns[1].context.evidence.find(e=>e.source.kind==='schedule-week').facts;
 assert.ok(week.trainingOpportunities.length>0,'The explicitly qualified fictional learner and trainer must reach the actual handler');
});

test('actual authenticated pan question receives the grounded calculation from its current approved guide',async()=>{
 const c=cases('back-window').find(c=>c.day===3);
 const result=await runHandlerCase('back-window',c,config,replies(ctx=>ctx.evidence.filter(e=>e.source.kind==='standard').map(e=>e.source.id),(ctx,_input,turn)=>{
  if(!turn){assert.equal(ctx.backWindowCupCalculation.status,'ready');assert.equal(ctx.backWindowCupCalculation.estimatedTotalCups,82.5);assert.deepEqual(ctx.backWindowCupCalculation.components.map(x=>x.estimatedCups),[75,7.5]);}
 }));
 assert.ok(result.turns.every(t=>t.status==='completed'&&t.workUnchanged));
});

test('an attached approved guide does not hide the actual personal prep line during a shortage question',async()=>{
 const c=cases('back-window').find(c=>c.day===6);
 const result=await runHandlerCase('back-window',c,config,replies(ctx=>ctx.evidence.filter(e=>['standard','food-prep'].includes(e.source.kind)).map(e=>e.source.id),ctx=>assert.ok(ctx.assignedPrep.items.some(i=>i.quantity===12))));
 assert.ok(result.turns.every(t=>t.status==='completed'&&t.workUnchanged));
 assert.match(result.turns[0].answer,/actual quantity 0/);
 assert.match(result.turns[0].answer,/note alone is not a substitute/);
 assert.match(result.turns[0].answer,/Tell your assigned manager directly/);
 assert.ok(result.turns[0].sources.some(s=>s.kind==='food-prep'));
});

test('actual handler and saved readback reject stock inferred from an observation plus a production report',async()=>{
 const c=cases('gm').find(c=>c.day===1);
 const result=await runHandlerCase('gm',c,config,async(_url,init)=>{
  const input=JSON.parse(init.body).input,ctx=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'You are still 1 vessel below the 6-vessel par overall (4 on hand + 1 completed = 5; short 1).',sourceIds:ctx.evidence.filter(e=>e.source.kind==='food-prep').map(e=>e.source.id)})}]}]});
 });
 assert.ok(result.turns.every(t=>t.status==='completed'&&t.workUnchanged));
 for(const turn of result.turns){
  assert.match(turn.answer,/current gap to par are unknown/);
  assert.match(turn.answer,/BOH and FOH/);
  assert.doesNotMatch(turn.answer,/Your assigned prep|4 on hand \+ 1 completed = 5/);
 }
 assert.match(result.turns[0].answer,/production shortfall of 1 vessel \(5 gallons/);
 assert.match(result.turns[1].answer,/cannot mark the item unavailable in Toast/);
});
