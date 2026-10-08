import test from 'node:test';
import assert from 'node:assert/strict';
import {currentFollowupFocus,operationalFollowup} from '../.sites-runtime/shared/companion-followup.mjs';
import {qualityWorkspace,at} from './companion-quality-fixture.mjs';

test('explicit new topics ignore incidental who/now/next and a prior server checkout',()=>{
 const f=qualityWorkspace();
 const shift=f.w.records.find(r=>r.kind==='shift');
 const previous={focus:{id:shift.id,revision:shift.revision,kind:'shift',title:'Previous server shift'},sources:[]};
 const questions=[
  'New training topic: a human recorded Fry qualification. Who can train now?',
  'New service staffing topic: sales slowed. Who should go next?',
  'Next week planning is a new topic; no live forecast was supplied. Does the checkout carry over and what should I plan next?',
  'The BOH manager called out and I am covering opening as GM. What should I do first and who handles the shortage now?',
  'It is a new day. What is my opening plan now?',
  'This morning I am doing arrival checks. What should I do next?',
  'New station method topic: what should I do now on Fry?',
  'How do I prepare this dressing now?'
 ];
 for(const question of questions){
  assert.equal(operationalFollowup(question),false,question);
  assert.equal(currentFollowupFocus(f.w,question,at,previous),undefined,question);
 }
});

test('real same-work follow-ups retain fresh authorized focus',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const task=f.add('checkout-sidework','task',f.employee.id,{title:'Silverware',kind:'task',phase:'correction',shiftId:'busy-shift-0',detail:'Return dirty silverware for correction',due:at,history:[]});
 task.revision=3;
 for(const question of ['Who checks it now?','They have now finished the correction. What is next?','What is the last thing we are waiting on?']){
  assert.equal(operationalFollowup(question),true,question);
  assert.deepEqual(currentFollowupFocus(f.w,question,at,{focus:{id:task.id,revision:1,kind:'task',title:task.data.title},sources:[]}),{id:task.id,revision:3});
 }
 assert.equal(operationalFollowup('Do I need to do tomorrow’s list now?'),true);
});

test('a newly closed close continues on its current authorized parent shift',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const close=f.w.records.find(r=>r.kind==='close');
 close.data.phase='closed';close.revision=2;
 const parent=f.w.records.find(r=>r.id===close.data.shiftId);parent.revision=4;
 const previous={focus:{id:close.id,revision:1,kind:'close',title:'Previously attached close'},sources:[]};
 assert.deepEqual(currentFollowupFocus(f.w,'That check passed. Who checks the remaining side work now?',at,previous),{id:parent.id,revision:4});
 assert.equal(currentFollowupFocus(f.w,'New training topic: who can train next?',at,previous),undefined);
 parent.data.cancelled=true;
 assert.equal(currentFollowupFocus(f.w,'What is next?',at,previous),undefined);
});

test('a closed close never restores a private or foreign parent shift',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const close=f.w.records.find(r=>r.kind==='close');close.data.phase='closed';
 const parent=f.w.records.find(r=>r.id===close.data.shiftId);
 const previous={focus:{id:close.id,revision:1,kind:'close',title:'Previously attached close'},sources:[]};
 parent.ownerId='unrelated';parent.data.personId='unrelated';
 assert.equal(currentFollowupFocus(f.w,'What is next?',at,previous),undefined);
 parent.ownerId=f.employee.id;parent.data.personId=f.employee.id;parent.locationId='foreign';
 assert.equal(currentFollowupFocus(f.w,'What is next?',at,previous),undefined);
 parent.locationId=f.w.location.id;parent.data.published=false;
 assert.equal(currentFollowupFocus(f.w,'What is next?',at,previous),undefined);
 close.data.phase='cancelled';parent.data.published=true;
 assert.equal(currentFollowupFocus(f.w,'What is next?',at,previous),undefined);
});

test('current released prep does not inherit an older closing shift',()=>{
 for(const q of ['My released ranch assignment today is12 portions and I made zero. How do I report it?','What prep is released for today and tomorrow?','Do I need to do tomorrow’s prep now?'])assert.equal(operationalFollowup(q),false,q);
 assert.equal(operationalFollowup('Do I need to do tomorrow’s list now?'),true);
});
