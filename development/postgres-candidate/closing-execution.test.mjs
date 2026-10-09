import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {fixture,run,read,owner,db,member,denied} from './closing-test-fixture.mjs';
import {executeTask,parseCommand} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
const command=(r,step,answers)=>({requestId:randomUUID(),locationId:'fictional-a',action:'close.transition',recordId:r.recordId,expectedRevision:r.revision,input:{step,note:'Fictional physical closing check',...(answers===undefined?{}:{answers})}});
const transition=(actor,r,step,answers)=>executeTask(db,actor,'fictional-a',command(r,step,answers));
test('employee submission and independent manager confirmation preserve checklist evidence without shift release',async()=>{
 const f=await fixture(),a=await run(f.command),ready=await transition(f.worker,a,'ready',[0,1]);assert.equal((await read(f.worker,ready)).data.phase,'manager-confirmation');
 const done=await transition(f.manager,ready,'confirm'),record=await read(f.worker,done);assert.equal(done.revision,3);assert.equal(record.data.phase,'closed');assert.deepEqual(record.data.answers,[0,1]);assert.deepEqual(record.data.history.map(h=>h.action),['assigned','ready','confirm']);assert.deepEqual(record.data.history[1].answers,[0,1]);
 assert.equal((await owner.query('SELECT released_at FROM candidate_operations.shift_references WHERE id=$1',[f.shift])).rows[0].released_at,null);
});
test('senior verification cannot be skipped and assigned independent verifier passes before manager',async()=>{
 const f=await fixture({mode:'senior-then-manager'}),a=await run(f.command),ready=await transition(f.worker,a,'ready',[1,0]);assert.equal((await read(f.worker,ready)).data.phase,'verification');
 await assert.rejects(transition(f.manager,ready,'confirm'),denied(409));await assert.rejects(transition(f.worker,ready,'verify'),denied(403));
 const verified=await transition(f.verifier,ready,'verify'),done=await transition(f.manager,verified,'confirm');assert.equal((await read(f.worker,done)).data.phase,'closed');
});
test('correction clears current answers, retains submitted history, and requires resubmission',async()=>{
 const f=await fixture({mode:'senior-then-manager'}),a=await run(f.command),ready=await transition(f.worker,a,'ready',[0,1]),fix=await transition(f.verifier,ready,'fix');
 const record=await read(f.worker,fix);assert.equal(record.data.phase,'correction');assert.deepEqual(record.data.answers,[]);assert.deepEqual(record.data.history[1].answers,[0,1]);
 await assert.rejects(transition(f.manager,fix,'confirm'),denied(409));const resubmitted=await transition(f.worker,fix,'ready',[0,1]);assert.equal((await read(f.worker,resubmitted)).data.phase,'verification');
});
test('every required criterion is checked with numeric unique indices',async()=>{
 const f=await fixture(),a=await run(f.command);for(const answers of [[],[0],[0,0],[0,2],['0',1],[0,1,2]])await assert.rejects(transition(f.worker,a,'ready',answers),denied(400));
 await assert.rejects(transition(f.worker,a,'ready'),denied(400));assert.equal((await read(f.worker,a)).revision,1);
});
test('unrelated staff and unassigned privileged managers cannot act; owner cannot check self',async()=>{
 const f=await fixture(),a=await run(f.command),other=await member(['tasks.manage','close.confirm','close.verify','location.manage']);
 for(const [actor,step] of [[other,'ready'],[other,'fix'],[other,'confirm'],[f.worker,'fix'],[f.worker,'confirm'],[f.manager,'verify']])await assert.rejects(transition(actor,a,step,step==='ready'?[0,1]:undefined),denied(403));
});
test('revoked confirmation and lost leadership coverage deny both new work and receipt replay',async()=>{
 const f=await fixture(),a=await run(f.command),ready=await transition(f.worker,a,'ready',[0,1]),c=command(ready,'confirm');await executeTask(db,f.manager,'fictional-a',c);
 await owner.query('UPDATE candidate_operations.leadership_references SET active=false WHERE member_id=$1',[f.manager.membershipId]);await assert.rejects(executeTask(db,f.manager,'fictional-a',c),denied(403));
 const g=await fixture(),b=await run(g.command),r=await transition(g.worker,b,'ready',[0,1]);await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='close.confirm'",[g.manager.membershipId]);await assert.rejects(transition(g.manager,r,'confirm'),denied(403));
});
test('draft shift and retired standard block new submissions, while snapshots remain readable',async()=>{
 const f=await fixture({published:false}),a=await run(f.command);await assert.rejects(transition(f.worker,a,'ready',[0,1]),denied(403));
 const g=await fixture(),b=await run(g.command);await owner.query("UPDATE candidate_operations.standard_references SET status='retired' WHERE id=$1",[g.standard]);await assert.rejects(transition(g.worker,b,'ready',[0,1]),denied(403));assert.equal((await read(g.worker,b)).data.standard.status,'approved');
});
test('changed shift revision and stale close revision conflict without additional history',async()=>{
 const f=await fixture(),a=await run(f.command);await owner.query('UPDATE candidate_operations.shift_references SET revision=revision+1 WHERE id=$1',[f.shift]);await assert.rejects(transition(f.worker,a,'ready',[0,1]),denied(409));
 const g=await fixture(),b=await run(g.command);await transition(g.worker,b,'ready',[0,1]);await assert.rejects(transition(g.worker,b,'ready',[0,1]),denied(409));assert.equal((await read(g.worker,b)).data.history.length,2);
});
test('concurrent identical retries commit once; changed payload conflicts and old replay does not regress phase',async()=>{
 const f=await fixture(),a=await run(f.command),c=command(a,'ready',[0,1]);const [x,y]=await Promise.all([executeTask(db,f.worker,'fictional-a',c),executeTask(db,f.worker,'fictional-a',c)]);assert.equal(x.revision,y.revision);assert.equal(Number(x.replayed)+Number(y.replayed),1);
 await assert.rejects(executeTask(db,f.worker,'fictional-a',{...c,input:{...c.input,note:'Changed'}}),denied(409));await transition(f.manager,x,'confirm');const replay=await executeTask(db,f.worker,'fictional-a',c);assert.equal(replay.revision,2);assert.equal((await read(f.worker,a)).data.phase,'closed');assert.equal((await read(f.worker,a)).data.history.length,3);
});
test('closed work cannot be corrected or submitted again',async()=>{
 const f=await fixture(),a=await run(f.command),r=await transition(f.worker,a,'ready',[0,1]),done=await transition(f.manager,r,'confirm');await assert.rejects(transition(f.manager,done,'fix'),denied(409));await assert.rejects(transition(f.worker,done,'ready',[0,1]),denied(409));
});
test('database boundary rejects unsupported flags and string answers even without adapter parsing',async()=>{
 const f=await fixture(),a=await run(f.command);const direct=payload=>db.transaction(c=>c.query('SELECT candidate_operations.transition_close($1,$2,$3,$4,$5)',[f.worker.subject,f.worker.membershipId,'fictional-a',randomUUID(),JSON.stringify(payload)]));
 const base={action:'close.transition',recordId:a.recordId,expectedRevision:1,input:{step:'ready',note:'Direct fixture',answers:[0,1]}};
 for(const payload of [{...base,input:{...base.input,answers:['0',1]}},{...base,input:{...base.input,managerAttention:'equipment'}}])await assert.rejects(direct(payload),e=>e.code==='22023');assert.equal((await read(f.worker,a)).revision,1);
});
test('revoked employee and verifier cannot reuse saved receipts; notifications target the next checker',async()=>{
 const f=await fixture({mode:'senior-then-manager'}),a=await run(f.command),c=command(a,'ready',[0,1]),r=await executeTask(db,f.worker,'fictional-a',c);
 const recipients=(await owner.query('SELECT recipient_id FROM candidate_operations.close_notification_outbox WHERE close_id=$1 AND revision=$2',[a.recordId,2])).rows.map(x=>x.recipient_id);assert.deepEqual(recipients,[f.verifier.membershipId]);
 const v=command(r,'verify');await executeTask(db,f.verifier,'fictional-a',v);await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='close.verify'",[f.verifier.membershipId]);await assert.rejects(executeTask(db,f.verifier,'fictional-a',v),denied(403));
 await owner.query('UPDATE candidate_identity.memberships SET active=false WHERE id=$1',[f.worker.membershipId]);await assert.rejects(executeTask(db,f.worker,'fictional-a',c),denied(403));
});
test('notification failure rolls back transition, checklist, event, receipt and workspace revision',async()=>{
 const f=await fixture(),a=await run(f.command),c=command(a,'ready',[0,1]),before=(await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision;
 await owner.query(`CREATE FUNCTION candidate_operations.test_execution_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional execution failure'; END; $$; CREATE TRIGGER test_execution_failure BEFORE INSERT ON candidate_operations.close_notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_execution_failure();`);
 try{await assert.rejects(executeTask(db,f.worker,'fictional-a',c),e=>e.message==='fictional execution failure');const record=await read(f.worker,a);assert.equal(record.revision,1);assert.deepEqual(record.data.answers,[]);assert.equal(record.data.history.length,1);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[c.requestId])).rows[0].n,0);assert.equal((await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision,before);}finally{await owner.query('DROP TRIGGER test_execution_failure ON candidate_operations.close_notification_outbox; DROP FUNCTION candidate_operations.test_execution_failure();');}
});
test('HTTP dispatch resolves employee session and returns updated close details',async()=>{
 const f=await fixture(),a=await run(f.command),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,f.worker.subject]);const handler=createTaskHandler(db,async()=>({subject:f.worker.subject,sessionId}));
 const response=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/commands',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(command(a,'ready',[0,1]))}));assert.equal(response.status,200);
 const detail=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/closes/'+a.recordId,{headers:{Authorization:'Bearer fixture'}}));assert.equal(detail.status,200);assert.equal((await detail.json()).data.phase,'manager-confirmation');
 assert.throws(()=>parseCommand({...command(a,'fix'),input:{step:'fix',note:'Unsupported',managerAttention:'equipment'}},'fictional-a'),denied(400));
});
