import test from 'node:test';
import assert from 'node:assert/strict';
import {people} from '../.sites-runtime/tests/demo-data.mjs';
import {seedState,transition,reviewSchedule,reviewOrder,canSeeMessage,coverage,taskKey,parseState,DEMO_DAY} from '../.sites-runtime/tests/workflow-model.mjs';
import {answerFromContext} from '../.sites-runtime/tests/companion-context.mjs';
const p=id=>people.find(p=>p.id===id);
test('FIX remains open through correction, verification, and incoming acceptance',()=>{
 let e=seedState().events.find(e=>e.id==='fry');
 e=transition(e,p('jordan'),'assign',{note:'Refill disclosed low-stock product',ownerId:'lena'});assert.equal(e.phase,'correction');
 assert.throws(()=>transition(e,p('jordan'),'pass',{note:'Looks good'}));
 e=transition(e,p('lena'),'ready',{note:'Product refilled and disclosed'});assert.equal(e.phase,'verification');
 assert.throws(()=>transition(e,p('lena'),'pass',{note:'Self verified'}));
 e=transition(e,p('jordan'),'pass',{note:'Checked rail and stock',incomingId:'sam'});assert.equal(e.phase,'acceptance');
 assert.throws(()=>transition(e,p('noah'),'accept',{note:'Accepted'}));
 e=transition(e,p('sam'),'dispute',{note:'A second item is missing'});assert.equal(e.phase,'correction');
 e=transition(e,p('lena'),'ready',{note:'Second item replenished'});e=transition(e,p('jordan'),'pass',{note:'Rechecked'});e=transition(e,p('sam'),'accept',{note:'Received station as described'});assert.equal(e.phase,'closed');assert.equal(e.history.length,7);
});
test('time-off request only changes the schedule after authorized review and creates a direct result',()=>{
 let s=seedState();const r={id:'request',personId:'eli',type:'Time off',date:DEMO_DAY,note:'Appointment',replacementId:'',status:'pending'};s.requests=[r];
 assert.throws(()=>reviewSchedule(s,r,p('eli'),true,'Approved'));
 assert.throws(()=>reviewSchedule(s,r,p('avery'),true,'Approved'));
 const next=reviewSchedule(s,r,p('taylor'),true,'Coverage arranged');assert.ok(s.shifts.some(x=>x.personId==='eli'&&x.date===DEMO_DAY));assert.ok(!next.shifts.some(x=>x.personId==='eli'&&x.date===DEMO_DAY));assert.equal(next.requests[0].status,'approved');assert.ok(canSeeMessage(next.messages[0],p('eli')));assert.ok(!canSeeMessage(next.messages[0],p('sofia')));
});
test('message audience cannot expand accidentally through message type',()=>{
 const base={id:'x',kind:'Shift',from:'Renee',fromRole:'Department Manager',audience:'BOH',subject:'BOH only',body:'Test',time:'Now',targetArea:'BOH',acknowledgedBy:[],replies:[]};
 assert.ok(canSeeMessage(base,p('noah')));assert.ok(!canSeeMessage(base,p('sofia')));assert.ok(!canSeeMessage(base,p('avery')));
 assert.ok(!canSeeMessage({...base,kind:'Direct',targetArea:undefined,targetIds:['eli']},p('taylor')));
});
test('orders enforce purchaser scope and version-specific internal approval',()=>{
 const o={id:'o',personId:'renee',location:'Bert’s',status:'review',revision:3,lines:[{id:'l',name:'Black 9x9 foam container',qty:2,unit:'case',note:'Black required'}],note:''};
 assert.throws(()=>reviewOrder(o,p('walter'),true,''));assert.throws(()=>reviewOrder(o,p('taylor'),true,''));
 const approved=reviewOrder(o,p('tim'),true,'Retain black containers');assert.equal(approved.approvedRevision,3);assert.equal(approved.status,'approved');assert.throws(()=>reviewOrder(approved,p('owner-limited'),true,''));assert.throws(()=>reviewOrder({...o,lines:[{...o.lines[0],qty:0}]},p('tim'),true,''));
});
test('coverage is computed from assignments and context follows changes',()=>{const s=seedState();assert.ok(coverage(s));assert.match(answerFromContext('Who covers Back Window?',p('taylor'),s),/Riley/);s.shifts=s.shifts.filter(x=>x.position!=='Back Window');assert.ok(!coverage(s));assert.match(answerFromContext('coverage',p('taylor'),s),/missing/);});
test('all seeded shifts have positive durations and task records are per employee',()=>{const s=seedState();for(const shift of s.shifts)assert.ok(shift.end>shift.start,`${shift.personId}: ${shift.start}-${shift.end}`);assert.notEqual(taskKey(p('noah'),'arrival'),taskKey(p('sofia'),'arrival'));});
test('serialized review retains workflow state and rejects incompatible data',()=>{const s=seedState();s.events[0].phase='correction';assert.equal(parseState(JSON.stringify(s)).events[0].phase,'correction');assert.throws(()=>parseState('{"version":1}'));});
test('Rudd never receives Papa Leone information from companion responses',()=>{assert.match(answerFromContext('Compare businesses',p('owner-limited'),seedState()),/Bert’s, Rudd’s, and Bulk Prep/);assert.doesNotMatch(answerFromContext('Compare businesses',p('owner-limited'),seedState()),/Papa/);});
