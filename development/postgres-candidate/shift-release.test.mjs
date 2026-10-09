import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {fixture,run,owner,db,member,creator,denied} from './closing-test-fixture.mjs';
import {executeTask,parseCommand} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
const command=(recordId,revision=1)=>({requestId:randomUUID(),locationId:'fictional-a',action:'shift.release',recordId,expectedRevision:revision,input:{note:'Fictional operational checkout confirmed'}});
const release=(f,c=command(f.shift))=>executeTask(db,f.manager,'fictional-a',c);
const step=(actor,r,action,extra={})=>executeTask(db,actor,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'close.transition',recordId:r.recordId,expectedRevision:r.revision,input:{step:action,note:'Fictional physical check',...extra}});
const classify=f=>owner.query("UPDATE candidate_operations.shift_references SET checkout_profile='ordinary' WHERE id=$1",[f.shift]);
const shiftRow=f=>owner.query('SELECT * FROM candidate_operations.shift_references WHERE id=$1',[f.shift]).then(r=>r.rows[0]);
async function completedClose(){const f=await fixture();await classify(f);const a=await run(f.command),r=await step(f.worker,a,'ready',{answers:[0,1]});await step(f.manager,r,'confirm');return f;}
async function linked(f,kind='task'){return executeTask(db,creator,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{kind,title:'Fictional checkout work',detail:'Required linked work',ownerId:f.worker.membershipId,shiftId:f.shift,due:'2026-10-09T18:00:00-04:00'}});}
const taskStep=(actor,r,step)=>executeTask(db,actor,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:r.recordId,expectedRevision:r.revision,input:{step,note:'Fictional linked task check'}});
test('closed station work still needs separate release; release records history, receipt and employee notification',async()=>{
 const f=await completedClose();assert.equal((await shiftRow(f)).released_at,null);const result=await release(f);assert.equal(result.revision,2);assert.ok((await shiftRow(f)).released_at);assert.equal((await owner.query('SELECT actor_id,action FROM candidate_operations.shift_events WHERE shift_id=$1',[f.shift])).rows[0].actor_id,f.manager.membershipId);
 const notifications=(await owner.query('SELECT recipient_id,message FROM candidate_operations.shift_notification_outbox WHERE shift_id=$1',[f.shift])).rows;assert.equal(notifications.length,1);assert.equal(notifications[0].recipient_id,f.worker.membershipId);assert.match(notifications[0].message,/does not change recorded work time/);
});
test('reviewed ordinary shift with no assigned checkout work may be released; scheduled times remain unchanged',async()=>{
 const f=await fixture();await classify(f);const before=await shiftRow(f);await release(f);const after=await shiftRow(f);assert.equal(after.starts_at.toISOString(),before.starts_at.toISOString());assert.equal(after.ends_at.toISOString(),before.ends_at.toISOString());
});
test('every pending closing phase blocks release',async()=>{
 for(const mode of ['manager','senior-then-manager']){const f=await fixture({mode});await classify(f);const a=await run(f.command);await assert.rejects(release(f),denied(409));const r=await step(f.worker,a,'ready',{answers:[0,1]});await assert.rejects(release(f),denied(409));await step(f.manager,r,'fix');await assert.rejects(release(f),denied(409));assert.equal((await shiftRow(f)).released_at,null);}
});
test('linked tasks and issues must be independently verified even after all station closes are closed',async()=>{
 for(const kind of ['task','issue']){const f=await completedClose(),t=await linked(f,kind);await assert.rejects(release(f),denied(409));const r=await taskStep(f.worker,t,'ready');await assert.rejects(release(f),denied(409));await taskStep(creator,r,'verify');assert.equal((await release(f)).revision,2);}
});
test('unlinked work for same employee and pending work on another shift do not block this shift',async()=>{
 const f=await completedClose();await executeTask(db,creator,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{kind:'task',title:'Unrelated duty',detail:'Not linked to checkout',ownerId:f.worker.membershipId,due:'2026-10-09T18:00:00-04:00'}});const other=await fixture();await linked(other);assert.equal((await release(f)).revision,2);
});
test('unreviewed and specialty profiles fail closed including misclassified Dishwasher shifts',async()=>{
 for(const profile of ['unreviewed','dishwasher']){const f=await fixture();await owner.query('UPDATE candidate_operations.shift_references SET checkout_profile=$2 WHERE id=$1',[f.shift,profile]);await assert.rejects(release(f),denied(403));}
 const f=await fixture();await classify(f);await owner.query("UPDATE candidate_operations.shift_references SET position='Dishwasher' WHERE id=$1",[f.shift]);await assert.rejects(release(f),denied(403));
});
test('self-release, missing capability, foreign scope, inactive owner and expired leadership coverage are denied',async()=>{
 const f=await fixture();await classify(f);await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'close.confirm'),($1,'location.manage')",[f.worker.membershipId]);await assert.rejects(executeTask(db,f.worker,'fictional-a',command(f.shift)),denied(403));await assert.rejects(executeTask(db,await member(),'fictional-a',command(f.shift)),denied(403));
 await assert.rejects(executeTask(db,f.manager,'fictional-b',{...command(f.shift),locationId:'fictional-b'}),denied(403));await owner.query("UPDATE candidate_operations.leadership_references SET ends_at='2026-10-09T19:59:59-04:00' WHERE member_id=$1",[f.manager.membershipId]);await assert.rejects(release(f),denied(403));
 const g=await fixture();await classify(g);await owner.query('UPDATE candidate_identity.memberships SET active=false WHERE id=$1',[g.worker.membershipId]);await assert.rejects(release(g),denied(403));
});
test('explicit location authority bypasses leadership coverage but requires confirmation capability',async()=>{
 const f=await fixture({leadership:false,location:true});await classify(f);assert.equal((await release(f)).revision,2);
 const g=await fixture({leadership:false,location:true});await classify(g);await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='close.confirm'",[g.manager.membershipId]);await assert.rejects(release(g),denied(403));
});
test('unpublished, cancelled, previously released and stale shift revisions conflict',async()=>{
 for(const update of ['published=false','cancelled=true','revision=revision+1']){const f=await fixture();await classify(f);await owner.query('UPDATE candidate_operations.shift_references SET '+update+' WHERE id=$1',[f.shift]);await assert.rejects(release(f),denied(409));}
 const f=await fixture();await classify(f);await release(f);await assert.rejects(release(f,command(f.shift,2)),denied(409));
});
test('concurrent release retries commit once, changed payload conflicts and revoked manager cannot replay',async()=>{
 const f=await completedClose(),c=command(f.shift);const [a,b]=await Promise.all([release(f,c),release(f,c)]);assert.equal(Number(a.replayed)+Number(b.replayed),1);assert.equal(a.appliedAt,b.appliedAt);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.shift_events WHERE shift_id=$1',[f.shift])).rows[0].n,1);
 await assert.rejects(release(f,{...c,input:{note:'Changed'}}),denied(409));await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='close.confirm'",[f.manager.membershipId]);await assert.rejects(release(f,c),denied(403));
});
test('notification failure rolls back release timestamp, shift and workspace revisions, event and receipt',async()=>{
 const f=await completedClose(),c=command(f.shift),before=(await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision;
 await owner.query(`CREATE FUNCTION candidate_operations.test_release_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional release failure'; END; $$; CREATE TRIGGER test_release_failure BEFORE INSERT ON candidate_operations.shift_notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_release_failure();`);
 try{await assert.rejects(release(f,c),e=>e.message==='fictional release failure');const row=await shiftRow(f);assert.equal(row.released_at,null);assert.equal(row.revision,1);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.shift_events WHERE shift_id=$1',[f.shift])).rows[0].n,0);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[c.requestId])).rows[0].n,0);assert.equal((await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision,before);}finally{await owner.query('DROP TRIGGER test_release_failure ON candidate_operations.shift_notification_outbox; DROP FUNCTION candidate_operations.test_release_failure();');}
});
test('HTTP dispatch uses verified identity; client cannot supply checkout counts or classify a shift',async()=>{
 const f=await completedClose(),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,f.manager.subject]);const handler=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId}));const response=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/commands',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(command(f.shift))}));assert.equal(response.status,200);
 assert.throws(()=>parseCommand({...command(f.shift),input:{note:'Trust client',pendingTasks:0}},'fictional-a'),denied(400));await assert.rejects(db.transaction(c=>c.query("UPDATE candidate_operations.shift_references SET checkout_profile='ordinary'",[])),e=>e.code==='42501');
});
test('concurrent task creation and shift release cannot both commit',async()=>{
 for(let attempt=0;attempt<3;attempt++){const f=await completedClose();const [released,created]=await Promise.allSettled([release(f),linked(f)]);assert.notEqual(released.status==='fulfilled'&&created.status==='fulfilled',true);assert.equal(Number(released.status==='fulfilled')+Number(created.status==='fulfilled'),1);
  if(released.status==='fulfilled'){assert.equal(created.reason.status,403);assert.ok((await shiftRow(f)).released_at);}else{assert.equal(released.reason.status,409);assert.equal((await shiftRow(f)).released_at,null);}}
});
test('no new closing assignment or task can be added after release',async()=>{
 const f=await fixture();await classify(f);await release(f);await assert.rejects(run(f.command),denied(403));await assert.rejects(linked(f),denied(403));
});
