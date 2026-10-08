import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMultiweekSession} from './ai-multiweek-handler-fixture.mjs';
const config={key:'sk-fictional-continuity-only',model:'gpt-5.4-mini'};
const provider=async(_url,init)=>{
 const input=JSON.parse(init.body).input,ctx=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Use the current work. No operational action was performed by chat.',sourceIds:ctx.evidence.map(e=>e.source.id).slice(0,20)})}]}]});
};
test('consecutive days retain chat and updated work; the actual weekly archive preserves work and starts fresh history',async()=>{
 const original=JSON.parse(fs.readFileSync('evidence/ai-week/server-cases.json','utf8')).cases.find(c=>c.day===6);
 const session=createMultiweekSession(config,provider);
 try{
  const first=structuredClone(original);Object.assign(first,{week:1,dayInWeek:1,day:1,events:['Fictional current handoff'],followupEvents:['Fictional owner reported Ready']});
  const a=await session.run('Server',first);
  assert.ok(a.turns.every(t=>t.status==='completed'&&t.workUnchanged));assert.equal(a.historyBefore,0);
  const second=structuredClone(original);second.workspace=structuredClone(original.followupWorkspace);delete second.followupWorkspace;
  Object.assign(second,{week:1,dayInWeek:2,day:2,at:new Date(Date.parse(first.at)+86400000).toISOString(),question:'What is still needed on this attached work?',followup:'Does that release the original shift?',selected:original.followupSelected,followupSelected:original.followupSelected});delete second.followupAt;
  const b=await session.run('Server',second);
  assert.ok(b.turns.every(t=>t.status==='completed'&&t.workUnchanged));assert.equal(b.historyBefore,2);assert.equal(b.conversationId,a.conversationId);
  assert.ok(b.turns[0].providerHistoryCount>0,'Eligible current dialogue persists between days.');
  const third=structuredClone(second);Object.assign(third,{week:2,dayInWeek:1,day:8,at:new Date(Date.parse(first.at)+7*86400000).toISOString()});
  const c=await session.run('Server',third);
  assert.ok(c.turns.every(t=>t.status==='completed'&&t.workUnchanged));assert.equal(c.historyBefore,0);assert.notEqual(c.conversationId,b.conversationId);assert.equal(c.turns[0].providerHistoryCount,0);
  const receipt=session.receipt();assert.equal(receipt.rotations.length,1);assert.equal(receipt.rotations[0].archivedTurns,4);assert.ok(receipt.rotations[0].workUnchanged);assert.equal(receipt.archivedConversations[0].turn_count,4);assert.equal(receipt.savedChatTurns,6);
  assert.equal(receipt.transitions.filter(t=>t.phase==='arrival-fixture-event').length,3);
 }finally{session.close();}
});
test('a fixture cannot silently move an existing membership to a different restaurant',async()=>{
 const original=JSON.parse(fs.readFileSync('evidence/ai-week/server-cases.json','utf8')).cases[0],session=createMultiweekSession(config,provider);
 try{
  await session.run('Server',{...structuredClone(original),week:1,dayInWeek:1,day:1});
  const moved=structuredClone(original);moved.locationId='bad-fixture';moved.workspace.members[0].locationId='bad-fixture';
  await assert.rejects(session.run('Server',{...moved,week:2,dayInWeek:1,day:8}),/membership cannot move restaurants/);
 }finally{session.close();}
});
