import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMultiweekSession} from './ai-multiweek-handler-fixture.mjs';

test('actual delivered Back Window checkout retains manager drawer and release without invented assignment checks',async()=>{
 const cases=JSON.parse(fs.readFileSync('evidence/ai-multiweek/back-window-cases.json')).cases;
 const old=JSON.parse(fs.readFileSync('evidence/ai-multiweek/back-window-replies-verified-2.json')).results;
 for(const day of [19,26]){
  const bad=old.find(c=>c.day===day).turns[1].answer;
  const session=createMultiweekSession({key:'sk-fictional-handler-test',model:'gpt-5.4-mini'},async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:bad,sourceIds:['ai-bw-guide']})}]}]}));
  try{
   const result=await session.run('Back Window',structuredClone(cases.find(c=>c.day===day)));
   const turn=result.turns[1];
   assert.equal(turn.status,'completed');assert.equal(turn.workUnchanged,true);
   assert.match(turn.answer,/cash-drawer closeout to the manager/);
   assert.match(turn.answer,/responsible manager must perform separate operational checkout/);
   assert.match(turn.answer,/No linked closing assignment or assigned physical checker/);
   assert.doesNotMatch(turn.answer,/Lee Lead|Morgan Manager|that the restaurant uses internally|finish your Back Window closing steps/);
   assert.ok(turn.sources.some(s=>s.id===`ai-bw-shift-${day}`));
  }finally{session.close();}
 }
});
