import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {fixture,run,read,owner,db,member,denied} from './closing-test-fixture.mjs';
import {executeTask} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
const command=(r,action,input)=>({requestId:randomUUID(),locationId:'fictional-a',action,recordId:r.recordId,expectedRevision:r.revision,input:{note:'Fictional correction evidence',...input}});
const send=(actor,r,action,input)=>executeTask(db,actor,'fictional-a',command(r,action,input));
const step=(actor,r,step,extra={})=>send(actor,r,'close.transition',{step,...extra});
async function clearedHelper(){const h=await member();await owner.query("INSERT INTO candidate_identity.station_clearances(member_id,restaurant_id,position) VALUES($1,'fictional-a','Cook')",[h.membershipId]);return h;}
async function correction(mode='manager',attention){const f=await fixture({mode}),a=await run(f.command),ready=await step(f.worker,a,'ready',{answers:[0,1]}),fix=await step(f.manager,ready,'fix',attention?{managerAttention:attention}:{});return {...f,fix};}
test('flagged correction requires independent manager acknowledgment before final physical confirmation',async()=>{
 const f=await correction('manager','serious'),r=await step(f.worker,f.fix,'ready',{answers:[0,1]});await assert.rejects(step(f.manager,r,'confirm'),denied(409));
 const ack=await send(f.manager,r,'close.acknowledge',{});const record=await read(f.worker,ack);assert.equal(record.data.phase,'manager-confirmation');assert.equal(record.data.attention.reason,'serious');assert.equal(record.data.attention.acknowledgment.by,f.manager.membershipId);
 const done=await step(f.manager,ack,'confirm');assert.equal((await read(f.worker,done)).data.phase,'closed');assert.equal((await read(f.worker,done)).data.history.filter(h=>h.action==='manager-acknowledged').length,1);
});
test('acknowledgment does not complete correction and each newly raised flag needs a new response',async()=>{
 const f=await correction('manager','repeated'),ack=await send(f.manager,f.fix,'close.acknowledge',{});assert.equal((await read(f.worker,ack)).data.phase,'correction');await assert.rejects(step(f.manager,ack,'confirm'),denied(409));
 const r=await step(f.worker,ack,'ready',{answers:[0,1]}),fix=await step(f.manager,r,'fix',{managerAttention:'unresolved'});assert.equal((await read(f.worker,fix)).data.attention.acknowledgment,undefined);const r2=await step(f.worker,fix,'ready',{answers:[0,1]});await assert.rejects(step(f.manager,r2,'confirm'),denied(409));
});
test('only assigned authorized manager can acknowledge and there must be a pending flag',async()=>{
 const f=await correction('senior-then-manager','serious'),other=await member(['close.confirm','tasks.manage','location.manage']);for(const actor of [f.worker,f.verifier,other])await assert.rejects(send(actor,f.fix,'close.acknowledge',{}),denied(403));
 const ack=await send(f.manager,f.fix,'close.acknowledge',{});await assert.rejects(send(f.manager,ack,'close.acknowledge',{}),denied(409));
 const g=await correction();await assert.rejects(send(g.manager,g.fix,'close.acknowledge',{}),denied(409));
});
test('cleared helper completes correction while original owner remains responsible and checkers remain independent',async()=>{
 const f=await correction('senior-then-manager'),h=await clearedHelper();await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'tasks.manage')",[f.manager.membershipId]);
 const assigned=await send(f.manager,f.fix,'close.correction.assign',{personId:h.membershipId}),record=await read(h,assigned);assert.equal(record.ownerId,f.worker.membershipId);assert.equal(record.data.correction.personId,h.membershipId);assert.deepEqual(record.data.answers,[]);
 await assert.rejects(step(f.worker,assigned,'ready',{answers:[0,1]}),denied(403));const r=await step(h,assigned,'ready',{answers:[0,1]});assert.equal((await read(h,r)).data.phase,'verification');await assert.rejects(step(h,r,'verify'),denied(403));const v=await step(f.verifier,r,'verify'),done=await step(f.manager,v,'confirm');assert.equal((await read(f.worker,done)).data.phase,'closed');
 const recipients=(await owner.query('SELECT recipient_id FROM candidate_operations.close_notification_outbox WHERE close_id=$1 AND revision=$2',[done.recordId,done.revision])).rows.map(x=>x.recipient_id);assert.ok(recipients.includes(h.membershipId)&&recipients.includes(f.worker.membershipId));
});
test('helper assignment requires both manager capabilities, matching approved version and station clearance',async()=>{
 const f=await correction(),h=await clearedHelper();await assert.rejects(send(f.manager,f.fix,'close.correction.assign',{personId:h.membershipId}),denied(403));await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'tasks.manage')",[f.manager.membershipId]);
 await assert.rejects(send(f.manager,f.fix,'close.correction.assign',{personId:(await member()).membershipId}),denied(403));await assert.rejects(send(f.manager,f.fix,'close.correction.assign',{personId:f.manager.membershipId}),denied(403));
 await owner.query('UPDATE candidate_operations.standard_references SET revision=revision+1 WHERE id=$1',[f.standard]);await assert.rejects(send(f.manager,f.fix,'close.correction.assign',{personId:h.membershipId}),denied(403));
});
test('helper cannot be a verifier, another department, inactive, schedule-only or Dishwasher',async()=>{
 const f=await correction('senior-then-manager');await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'tasks.manage')",[f.manager.membershipId]);
 for(const change of ["department='FOH'",'active=false','schedule_only=true',"position='Dishwasher'"]){const h=await clearedHelper();await owner.query('UPDATE candidate_identity.memberships SET '+change+' WHERE id=$1',[h.membershipId]);await assert.rejects(send(f.manager,f.fix,'close.correction.assign',{personId:h.membershipId}),denied(403));}
 await assert.rejects(send(f.manager,f.fix,'close.correction.assign',{personId:f.verifier.membershipId}),denied(403));
});
test('helper replacement removes prior access and notifies both helpers without duplicate recipients',async()=>{
 const f=await correction(),h=await clearedHelper(),next=await clearedHelper();await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'tasks.manage')",[f.manager.membershipId]);
 const a=await send(f.manager,f.fix,'close.correction.assign',{personId:h.membershipId}),b=await send(f.manager,a,'close.correction.assign',{personId:next.membershipId});await assert.rejects(read(h,b),e=>e.code==='42501');await assert.rejects(step(h,b,'ready',{answers:[0,1]}),denied(403));
 const recipients=(await owner.query('SELECT recipient_id FROM candidate_operations.close_notification_outbox WHERE close_id=$1 AND revision=$2',[b.recordId,b.revision])).rows.map(r=>r.recipient_id);assert.equal(recipients.length,4);assert.ok(recipients.includes(h.membershipId)&&recipients.includes(next.membershipId));
});
test('returning helper work for another correction ends helper assignment and clears current answers',async()=>{
 const f=await correction(),h=await clearedHelper();await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'tasks.manage')",[f.manager.membershipId]);const a=await send(f.manager,f.fix,'close.correction.assign',{personId:h.membershipId}),r=await step(h,a,'ready',{answers:[0,1]}),fix=await step(f.manager,r,'fix',{managerAttention:'serious'});
 const record=await read(f.worker,fix);assert.equal(record.data.correction,undefined);assert.deepEqual(record.data.answers,[]);await assert.rejects(read(h,fix),e=>e.code==='42501');const ready=await step(f.worker,fix,'ready',{answers:[0,1]});await assert.rejects(step(f.manager,ready,'confirm'),denied(409));
});
test('helper clearance is rechecked on submission and revoked manager cannot replay support commands',async()=>{
 const f=await correction('manager','serious'),h=await clearedHelper();await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'tasks.manage')",[f.manager.membershipId]);const c=command(f.fix,'close.correction.assign',{personId:h.membershipId}),a=await executeTask(db,f.manager,'fictional-a',c);await owner.query('UPDATE candidate_identity.station_clearances SET active=false WHERE member_id=$1',[h.membershipId]);await assert.rejects(step(h,a,'ready',{answers:[0,1]}),denied(403));
 await owner.query('UPDATE candidate_operations.leadership_references SET active=false WHERE member_id=$1',[f.manager.membershipId]);await assert.rejects(executeTask(db,f.manager,'fictional-a',c),denied(403));
});
test('support replay is stable, changed payload and stale revision conflict',async()=>{
 const f=await correction('manager','serious'),c=command(f.fix,'close.acknowledge',{});const [a,b]=await Promise.all([executeTask(db,f.manager,'fictional-a',c),executeTask(db,f.manager,'fictional-a',c)]);assert.equal(Number(a.replayed)+Number(b.replayed),1);assert.equal(a.revision,b.revision);
 await assert.rejects(executeTask(db,f.manager,'fictional-a',{...c,input:{note:'Changed'}}),denied(409));await assert.rejects(send(f.manager,f.fix,'close.acknowledge',{}),denied(409));
});
test('support notification failure rolls back acknowledgment, history and receipt',async()=>{
 const f=await correction('manager','serious'),c=command(f.fix,'close.acknowledge',{});await owner.query(`CREATE FUNCTION candidate_operations.test_support_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional support failure'; END; $$; CREATE TRIGGER test_support_failure BEFORE INSERT ON candidate_operations.close_notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_support_failure();`);
 try{await assert.rejects(executeTask(db,f.manager,'fictional-a',c),e=>e.message==='fictional support failure');const r=await read(f.worker,f.fix);assert.equal(r.revision,f.fix.revision);assert.equal(r.data.attention.acknowledgment,undefined);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[c.requestId])).rows[0].n,0);}finally{await owner.query('DROP TRIGGER test_support_failure ON candidate_operations.close_notification_outbox; DROP FUNCTION candidate_operations.test_support_failure();');}
});
test('authenticated HTTP dispatch acknowledges the issue and returns its response in close details',async()=>{
 const f=await correction('manager','unresolved'),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,f.manager.subject]);const handler=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId}));
 const response=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/commands',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(command(f.fix,'close.acknowledge',{}))}));assert.equal(response.status,200);
 const detail=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/closes/'+f.fix.recordId,{headers:{Authorization:'Bearer fixture'}}));assert.equal(detail.status,200);const record=await detail.json();assert.equal(record.data.phase,'correction');assert.equal(record.data.attention.acknowledgment.by,f.manager.membershipId);
});
