import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
test('hiring review rejects participant revocation between snapshot and commit without partial writes',async t=>{
 for(const [label,mutation] of [
  ['interviewer disabled',"UPDATE memberships SET active=0 WHERE id='othermanager'"],
  ['approver authority revoked',"UPDATE memberships SET capabilities='[\"tasks.manage\"]',revision=revision+1 WHERE id='manager'"],
  ['assigned manager made schedule-only',"UPDATE memberships SET schedule_only=1 WHERE id='assigned'"],
 ])await t.test(label,async t=>{
  const f=await fixture(t);
  await f.db.prepare("UPDATE memberships SET position='General Manager',capabilities='[\"tasks.manage\",\"people.approve\"]' WHERE id='manager'").run();
  await f.db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active,schedule_only) VALUES('assigned','assigned@example.test','assigned-identity','a','Assigned manager','BOH','Manager','[\"tasks.manage\"]','[]',1,0)").run();
  let r=ok(await f.call('owner','opening.create',{title:'Fictional cook',department:'BOH',positions:1,neededOn:'2026-12-01',shiftPlan:'Fictional shift',reason:'Fictional need',sourceRef:'Fictional request',managerId:'assigned'}));
  r=ok(await f.call('owner','opening.submit',{checked:true,note:'Fictional review'},r));r=ok(await f.call('owner','opening.approve',{approved:true,note:'Fictional approval'},r));
  r=ok(await f.call('owner','opening.applicant-add',{name:'Fictional candidate',reference:'RACE-1',receivedOn:'2026-09-01',sourceRef:'Fictional application',followupOn:'2026-12-01',checked:true,note:'Fictional check'},r));
  const before=await f.saved(r),locationBefore=await f.db.prepare("SELECT revision,last_command FROM locations WHERE id='a'").first();
  const requestId='hiring-race-'+label.replaceAll(' ','-'), input={applicantId:before.data.applicants[0].id,candidateType:'frontline',interviews:['manager','othermanager'].map(personId=>({personId,date:'2026-09-15',evidence:'Fictional interview'})),approverId:'manager',offerApproved:true,approvalEvidence:'Fictional final decision',checked:true,note:'Fictional checked review'};
  let batches=0,revoked=false;
  const binding={withSession:()=>binding,prepare:sql=>f.db.prepare(sql),batch:async statements=>{
   batches++;
   // First batch is the consistent workspace read; second is the save.
   if(batches===2){await f.db.prepare(mutation).run();revoked=true;}
   return f.db.batch(statements);
  }};
  const result=await f.call('owner','opening.applicant-hiring-review',input,r,{requestId},binding);
  assert.equal(revoked,true,JSON.stringify({batches,result}));assert.equal(result.status,409);
  assert.deepEqual(await f.saved(r),before);
  assert.deepEqual(await f.db.prepare("SELECT revision,last_command FROM locations WHERE id='a'").first(),locationBefore);
  assert.equal(await f.db.prepare('SELECT * FROM command_receipts WHERE request_id=?').bind(requestId).first(),null);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='opening.applicant-hiring-review'").first()).n,0);
 });
});
test('hiring approval command retains evidence, rejects stale approval and remains private',async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE memberships SET position='General Manager',capabilities='[\"tasks.manage\",\"people.approve\"]' WHERE id='manager'").run();
 let r=ok(await f.call('owner','opening.create',{title:'Fictional cook',department:'BOH',positions:1,neededOn:'2026-12-01',shiftPlan:'Fictional shift',reason:'Fictional need',sourceRef:'Fictional request',managerId:'manager'}));
 r=ok(await f.call('owner','opening.submit',{checked:true,note:'Fictional review'},r));r=ok(await f.call('owner','opening.approve',{approved:true,note:'Fictional approval'},r));
 r=ok(await f.call('owner','opening.applicant-add',{name:'Fictional candidate',reference:'REVIEW-1',receivedOn:'2026-09-01',sourceRef:'Fictional application',followupOn:'2026-12-01',checked:true,note:'Fictional check'},r));
 const applicantId=(await f.saved(r)).data.applicants[0].id;
 const input={applicantId,candidateType:'frontline',interviews:['manager','othermanager'].map(personId=>({personId,date:'2026-09-15',evidence:'Fictional interview'})),approverId:'manager',offerApproved:true,approvalEvidence:'Fictional final decision',checked:true,note:'Fictional checked review'};
 assert.notEqual((await f.call('manager','opening.applicant-hiring-review',input,r)).status,200);
 const before=r,requestId='hiring-review-once';r=ok(await f.call('owner','opening.applicant-hiring-review',input,before,{requestId}));assert.deepEqual(ok(await f.call('owner','opening.applicant-hiring-review',input,before,{requestId})),r);
 assert.equal((await f.saved(r)).data.applicants[0].events.length,2);assert.doesNotMatch(JSON.stringify(await f.view('manager')),/Fictional final decision|hiringReview/);
 for(const candidateType of ['management','gm']){
  const denied=await f.call('owner','opening.applicant-hiring-review',{...input,candidateType,approverId:'owner',interviews:[...input.interviews,{personId:'owner',date:'2026-09-15',evidence:'Fictional owner interview'}]},r);
  assert.equal(denied.status,409);assert.match(JSON.stringify(denied.data),/Explicit owner identity is not configured/);
 }
 assert.equal((await f.saved(r)).data.applicants[0].events.length,2);
 await f.db.prepare("UPDATE memberships SET capabilities='[\"tasks.manage\"]',revision=revision+1 WHERE id='manager'").run();
 assert.notEqual((await f.call('owner','opening.applicant-hiring-review',input,r)).status,200);assert.equal((await f.saved(r)).data.applicants[0].events.length,2);
});
