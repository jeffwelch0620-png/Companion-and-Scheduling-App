import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkedNoteNotification} from '../.sites-runtime/shared/companion-note-notification.mjs';
import {createMultiweekSession} from './ai-multiweek-handler-fixture.mjs';

test('a needed follow-up is never a completed notification in a factual note',()=>{
 const faulty='Add: "Manager notified / current instructions needed for follow-up." Only include that if you actually told the manager or need follow-up noted.';
 const result=checkedNoteNotification('Does Morgan receive this chat? What should the factual note say?',faulty);
 assert.doesNotMatch(result,/Manager notified/);assert.match(result,/Manager follow-up needed/);assert.match(result,/needing follow-up is not a completed notification/);
 assert.equal(checkedNoteNotification('I told Morgan directly. Help me write the note.',faulty),faulty);
 assert.equal(checkedNoteNotification('If I told Morgan, what should the note say?',faulty).includes('Manager notified'),false);
 assert.equal(checkedNoteNotification('Who should I tell?',faulty),faulty);
});

test('actual shortage-note delivery cannot imply that chat notified the manager',async()=>{
 const c=JSON.parse(fs.readFileSync('evidence/ai-multiweek/back-window-cases.json')).cases.find(c=>c.day===6);
 const old=JSON.parse(fs.readFileSync('evidence/ai-multiweek/back-window-replies-verified-3.json')).results.find(c=>c.day===6).turns[1].answer;
 assert.match(old,/Manager notified \/ current instructions/);
 const session=createMultiweekSession({key:'sk-fictional-notification-test',model:'gpt-5.4-mini'},async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:old,sourceIds:[]})}]}]}));
 try{
  const r=await session.run('Back Window',c),turn=r.turns[1];
  assert.equal(turn.status,'completed');assert.equal(turn.workUnchanged,true);
  assert.match(turn.answer,/0 made today/);assert.doesNotMatch(turn.answer,/Manager notified/);
  assert.match(turn.answer,/Chat cannot complete prep/);assert.match(turn.answer,/follow-up is not a completed notification/);
 }finally{session.close();}
});
