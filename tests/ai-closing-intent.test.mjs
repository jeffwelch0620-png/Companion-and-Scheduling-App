import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {closingQuestionIntent,workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';

// These snapshots also drove the authenticated real-provider week. This test
// exercises current app retrieval and saved state without another provider call.
const cases=role=>JSON.parse(readFileSync(new URL(`../evidence/ai-week/${role}-cases.json`,import.meta.url),'utf8')).cases;
const server=cases('server'),host=cases('host');
const day=(list,n)=>structuredClone(list.find(c=>c.day===n));
const source=r=>({id:r.id,revision:r.revision,kind:r.kind,title:r.data.title??r.data.standard?.title??r.kind});
const facts=(context,id)=>context.evidence.find(e=>e.source.id===id)?.facts;

test('Server day 4 colloquial checkout questions retrieve actual pending checks without saving work',()=>{
 const c=day(server,4),before=JSON.stringify(c.workspace);
 const close=c.workspace.records.find(r=>r.kind==='close'),task=c.workspace.records.find(r=>r.kind==='task');
 for(const question of [c.question,'Am I good to go?','Can you check me out now?','My shift’s over. Can I leave?','My shift is finished.','Can I go?']){
  const view=workforceContext(c.workspace,question,c.at);
  assert.equal(view.context.scopeMode,'my-closing-work',question);
  assert.equal(facts(view,close.id).phase,'manager-confirmation');
  assert.match(facts(view,close.id).manager,/Morgan/);
  assert.equal(facts(view,task.id).phase,'verification');
  assert.equal(view.context.myShift.status,'scheduled shift ended; operational checkout pending');
  assert.equal(view.context.closingStatus.releaseRecorded,false);
  assert.deepEqual(view.context.closingStatus.assignedCloses,[{id:close.id,phase:'manager-confirmation'}]);
  assert.equal(view.context.closingStatus.linkedTasks.find(t=>t.id===task.id).phase,'verification');
  assert.match(view.context.closingStatus.nextAction,/Closing work remains/);
 }
 assert.equal(JSON.stringify(c.workspace),before);
});

test('Server day 6 closing continuation retrieves updated accepted handoff, not earlier open state',()=>{
 const c=day(server,6),initialTask=c.workspace.records.find(r=>r.kind==='task');
 const initial=workforceContext(c.workspace,c.question,c.at);
 assert.equal(facts(initial,initialTask.id).phase,'open');
 assert.match(facts(initial,initialTask.id).owner,/Casey/);
 const updated=c.followupWorkspace,task=updated.records.find(r=>r.kind==='task');
 const before=JSON.stringify(updated),view=workforceContext(updated,c.followup,c.followupAt??c.at,[source(task)]);
 assert.equal(view.context.scopeMode,'my-closing-work');
 assert.equal(view.scope.find(s=>s.id===task.id).revision,2);
 assert.equal(facts(view,task.id).phase,'verification');
 assert.match(facts(view,task.id).owner,/Casey/);
 assert.match(facts(view,task.id).closingHandoff.outgoing,/Avery/);
 assert.equal(facts(view,task.id).history.at(-1).action,'ready');
 assert.equal(view.context.closingStatus.linkedTasks.find(t=>t.id===task.id).phase,'verification');
 assert.equal(view.context.closingStatus.releaseRecorded,false);
 assert.equal(view.context.myShift.status,'scheduled shift ended; operational checkout pending');
 assert.equal(JSON.stringify(updated),before);
});

test('Host day 4 incidental closing citation does not hijack a new arrivals/podium question',()=>{
 const c=day(host,4),close=c.workspace.records.find(r=>r.kind==='close'),focus=[source(close)];
 for(const question of [c.followup,'What should I say to these guests next?','How do I welcome arrivals at the podium?']){
  const view=workforceContext(c.workspace,question,c.at,focus);
  assert.notEqual(view.context.scopeMode,'my-closing-work',question);
  assert.ok(view.evidence.some(e=>e.source.id==='host-ai-approved-guide'));
  assert.equal(view.evidence.some(e=>e.source.kind==='close'||e.source.kind==='task'),false);
  const body=JSON.stringify(view.evidence);
  assert.match(body,/please-wait sign/);
  assert.match(body,/Nearby employees welcome new arrivals/);
  assert.doesNotMatch(body,/PRIVATE INBOX CONTENT|DRAFT ONLY|second seating host phone/);
 }
});

test('closing continuation requires a related reference and explicit closing intent wins over service words',()=>{
 const c=day(host,4),close=c.workspace.records.find(r=>r.kind==='close'),focus=[source(close)];
 assert.equal(closingQuestionIntent('What’s next?',focus),true);
 assert.equal(closingQuestionIntent('What happens next?',focus),true);
 assert.equal(closingQuestionIntent('What’s next?'),false);
 assert.equal(closingQuestionIntent('Can you explain this check?',focus),true);
 assert.equal(closingQuestionIntent('What is left?',focus),true);
 assert.equal(closingQuestionIntent('Can you explain a learning goal?',focus),false);
 assert.equal(closingQuestionIntent('What is next on my learning goal?',focus),false);
 assert.equal(closingQuestionIntent('How do I ask for a schedule change?',focus),false);
 assert.equal(closingQuestionIntent('What should I say to these guests next?',focus),false);
 const view=workforceContext(c.workspace,'After the last guest leaves, how do I finish my Host closing work?',c.at,focus);
 assert.equal(view.context.scopeMode,'my-closing-work');
 assert.equal(facts(view,close.id).phase,'open');
 const continuation=workforceContext(c.workspace,'What happens next?',c.at,focus);
 assert.equal(continuation.context.scopeMode,'my-closing-work');
 assert.equal(facts(continuation,close.id).phase,'open');
});

test('unlinked task citations do not turn a generic followup into shift closing',()=>{
 const c=day(server,4),task=c.workspace.records.find(r=>r.kind==='task');
 delete task.data.shiftId;
 const view=workforceContext(c.workspace,'What’s next?',c.at,[source(task)]);
 assert.notEqual(view.context.scopeMode,'my-closing-work');
 assert.equal(view.evidence.some(e=>e.source.id===task.id),false);
});

test('ordinary coaching correction does not import operating close checks',()=>{
 assert.equal(closingQuestionIntent('The prep sequence correction is ready. Does coached or ready close it?'),false);
 assert.equal(closingQuestionIntent('What correction remains?',[{id:'close',revision:1,kind:'close',title:'Close'}]),true);
 assert.equal(closingQuestionIntent('My close is in correction. What is next?'),true);
});
