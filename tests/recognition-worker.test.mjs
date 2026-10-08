import test from 'node:test';import assert from 'node:assert/strict';import {fixture,ok} from './maintenance-meter-fixture.mjs';
process.env.JMAX_METER_COMPILED='1';
test('built recognition worker submits, reviews, publishes and withdraws with current roles and no peer history',async t=>{
 const f=await fixture(t);assert.equal(f.compiled,true);let r=ok(await f.call('worker','recognition.submit',{title:'Compiled fictional thank-you',message:'Fictional only',recipientId:'manager',occurredOn:'2026-09-01',shareConfirmed:true}));
 assert.equal((await f.view('othermanager')).records.some(x=>x.kind==='recognition'),false);r=ok(await f.call('owner','recognition.publish',{note:'Private review',confirmed:true},r));const d=(await f.view('manager')).records.find(x=>x.id===r.recordId).data;assert.equal(d.status,'published');assert.equal(d.internal,undefined);
 assert.equal((await f.call('foreign','recognition.withdraw',{note:'Wrong restaurant',confirmed:true},r)).status,403);r=ok(await f.call('worker','recognition.withdraw',{note:'Author correction',confirmed:true},r));assert.equal((await f.view('manager')).records.some(x=>x.id===r.recordId),false);
});
test('built recognition worker isolates all three restaurants and rechecks owner capability',async t=>{
 const f=await fixture(t);
 for(const [loc,owner]of [['a','owner'],['b','foreign'],['c','third']]){
  for(const suffix of ['author','recipient'])await f.db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,'BOH','Cook','[]','[]',1)").bind(loc+'-'+suffix,loc+'-'+suffix+'@example.test',loc+'-'+suffix+'-identity',loc,'Fictional '+suffix).run();
  let r=ok(await f.call(loc+'-author','recognition.submit',{title:'Fixture '+loc,message:'Local thank-you '+loc,recipientId:loc+'-recipient',occurredOn:'2026-09-01',shareConfirmed:true},undefined,{locationId:loc}));r=ok(await f.call(owner,'recognition.publish',{note:'Private '+loc,confirmed:true},r,{locationId:loc}));const rows=(await f.view(loc+'-recipient',loc)).records.filter(x=>x.kind==='recognition');assert.equal(rows.length,1);assert.equal(rows[0].locationId,loc);assert.equal(rows[0].data.internal,undefined);
 }
 const unpublished=ok(await f.call('worker','recognition.submit',{title:'Revoked reviewer',message:'Fixture',recipientId:'manager',occurredOn:'2026-09-01',shareConfirmed:true}));await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='owner'").run();assert.equal((await f.call('owner','recognition.publish',{note:'Revoked',confirmed:true},unpublished)).status,404);assert.equal((await f.request('worker','/api/workspace?locationId=c')).status,403);
});
