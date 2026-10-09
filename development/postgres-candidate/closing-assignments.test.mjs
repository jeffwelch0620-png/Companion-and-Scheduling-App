import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
import {connection as config} from './test-config.mjs';
const db=new PostgresDatabase({...config,user:'candidate_runtime',max:3}),owner=new pg.Pool({...config,user:'candidate_owner',max:2});
after(async()=>{await db.close();await owner.end();});
const creator={subject:'manager',membershipId:'10000000-0000-0000-0000-000000000001'};
async function member(capabilities=[],position='Cook'){
 const person=randomUUID(),membershipId=randomUUID(),subject='closing-fixture-'+randomUUID();
 await owner.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional closing fixture']);await owner.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
 await owner.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,'fictional-a','BOH',$3)",[membershipId,person,position]);
 for(const cap of capabilities)await owner.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[membershipId,cap]);return {subject,membershipId};
}
async function fixture({published=true,mode='manager',leadership=true,location=false}={}){
 const worker=await member(),manager=await member(['close.confirm',...(location?['location.manage']:[])]),verifier=await member(['close.verify']);const shift=randomUUID(),standard=randomUUID();
 await owner.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,'fictional-a',$2,'BOH','Cook','2026-10-09T12:00:00-04:00','2026-10-09T20:00:00-04:00',1,$3)",[shift,worker.membershipId,published]);
 await owner.query("INSERT INTO candidate_operations.standard_references(id,restaurant_id,department,title,zone,position,revision,version,verification,status,criteria) VALUES($1,'fictional-a','BOH','Fictional station close','cook station','Cook',1,1,$2,'approved','[\"Station clean\",\"Equipment safe\"]')",[standard,mode]);
 await owner.query("INSERT INTO candidate_operations.shift_standard_links(shift_id,standard_id,restaurant_id) VALUES($1,$2,'fictional-a')",[shift,standard]);
 await owner.query("INSERT INTO candidate_identity.station_clearances(member_id,restaurant_id,position) VALUES($1,'fictional-a','Cook')",[worker.membershipId]);
 if(leadership)await owner.query("INSERT INTO candidate_operations.leadership_references(member_id,restaurant_id,department,starts_at,ends_at) VALUES($1,'fictional-a','BOH','2026-10-09T12:00:00-04:00','2026-10-09T20:00:00-04:00')",[manager.membershipId]);
 const command={requestId:randomUUID(),locationId:'fictional-a',action:'close.assign',input:{shiftId:shift,standardId:standard,managerId:manager.membershipId,due:'2026-10-09T20:00:00-04:00',note:'Fictional closing assignment.',...(mode==='senior-then-manager'?{verifierId:verifier.membershipId}:{})}};
 return {worker,manager,verifier,shift,standard,command};
}
const run=command=>executeTask(db,creator,'fictional-a',command),denied=status=>e=>e.status===status;
const read=(actor,assigned)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_close($1,$2,$3,$4) AS result',[actor.subject,actor.membershipId,'fictional-a',assigned.recordId])).rows[0].result);
test('approved closing snapshot and independent manager are saved without releasing shift',async()=>{
 const f=await fixture(),assigned=await run(f.command),record=await read(f.worker,assigned);assert.equal(record.kind,'close');assert.equal(record.data.phase,'open');assert.equal(record.data.managerId,f.manager.membershipId);assert.equal(record.data.standardRevision,1);assert.equal(record.data.standard.criteria.length,2);
 assert.equal((await owner.query('SELECT released_at FROM candidate_operations.shift_references WHERE id=$1',[f.shift])).rows[0].released_at,null);
 assert.equal((await owner.query('SELECT count(*)::int AS n FROM candidate_operations.close_notification_outbox WHERE close_id=$1',[assigned.recordId])).rows[0].n,2);
});
test('standard snapshot survives changes to the source reference',async()=>{
 const f=await fixture(),assigned=await run(f.command);await owner.query("UPDATE candidate_operations.standard_references SET revision=2,version=2,criteria='[\"Changed requirement\"]',status='retired' WHERE id=$1",[f.standard]);const record=await read(f.worker,assigned);assert.equal(record.data.standard.version,1);assert.deepEqual(record.data.standard.criteria,['Station clean','Equipment safe']);
});
test('draft shifts may receive closing assignments without employee notification',async()=>{
 const f=await fixture({published:false}),assigned=await run(f.command);assert.equal((await read(f.worker,assigned)).data.phase,'open');assert.equal((await owner.query('SELECT count(*)::int AS n FROM candidate_operations.close_notification_outbox WHERE close_id=$1',[assigned.recordId])).rows[0].n,0);
});
test('approved status, station guide and employee clearance are required independently',async()=>{
 for(const mutation of [f=>owner.query("UPDATE candidate_operations.standard_references SET status='draft' WHERE id=$1",[f.standard]),f=>owner.query('UPDATE candidate_operations.shift_standard_links SET active=false WHERE shift_id=$1',[f.shift]),f=>owner.query('UPDATE candidate_identity.station_clearances SET active=false WHERE member_id=$1',[f.worker.membershipId])]){const f=await fixture();await mutation(f);await assert.rejects(run(f.command),denied(403));}
});
test('manager requires leadership covering due time or explicit location authority',async()=>{
 const missing=await fixture({leadership:false});await assert.rejects(run(missing.command),denied(403));
 const outside=await fixture();await owner.query("UPDATE candidate_operations.leadership_references SET ends_at='2026-10-09T19:59:59-04:00' WHERE member_id=$1",[outside.manager.membershipId]);await assert.rejects(run(outside.command),denied(403));
 const wide=await fixture({leadership:false,location:true});assert.equal((await run(wide.command)).revision,1);
});
test('senior verification requires a third eligible independent member',async()=>{
 const f=await fixture({mode:'senior-then-manager'});for(const id of [f.worker.membershipId,f.manager.membershipId,creator.membershipId])await assert.rejects(run({...f.command,input:{...f.command.input,verifierId:id}}),denied(403));
 assert.equal((await read(f.verifier,await run(f.command))).data.verifierId,f.verifier.membershipId);
});
test('unrelated employees cannot read an assignment, including nullable verifier case',async()=>{
 const f=await fixture(),assigned=await run(f.command);await assert.rejects(read(await member(),assigned),e=>e.code==='42501');await assert.rejects(executeTask(db,f.worker,'fictional-a',{...f.command,requestId:randomUUID()}),denied(403));
});
test('duplicate zone conflicts while identical request replay is stable',async()=>{
 const f=await fixture(),first=await run(f.command),replay=await run(f.command);assert.equal(replay.replayed,true);assert.equal(first.recordId,replay.recordId);await assert.rejects(run({...f.command,requestId:randomUUID()}),denied(409));await assert.rejects(run({...f.command,input:{...f.command.input,note:'Changed evidence'}}),denied(409));
});
test('due time must fall within the shift and manager needs an independent confirmation grant',async()=>{
 const f=await fixture();for(const due of ['2026-10-09T11:59:59-04:00','2026-10-09T20:00:01-04:00'])await assert.rejects(run({...f.command,input:{...f.command.input,due}}),denied(400));
 await assert.rejects(run({...f.command,input:{...f.command.input,managerId:f.worker.membershipId}}),denied(403));
 await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='close.confirm'",[f.manager.membershipId]);await assert.rejects(run(f.command),denied(403));
});
test('senior mode cannot omit its verifier and revoked creators cannot replay assignments',async()=>{
 const senior=await fixture({mode:'senior-then-manager'});const input={...senior.command.input};delete input.verifierId;await assert.rejects(run({...senior.command,input}),denied(400));
 const f=await fixture(),other=await member(['tasks.manage']);const first=await executeTask(db,other,'fictional-a',f.command);assert.equal(first.revision,1);
 await owner.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[other.membershipId]);await assert.rejects(executeTask(db,other,'fictional-a',f.command),denied(403));
});
test('pending close protects shift cancellation, release and structural edits',async()=>{
 const f=await fixture();await run(f.command);for(const update of ['cancelled=true','released_at=clock_timestamp()',"ends_at=ends_at+interval '1 hour'"])await assert.rejects(owner.query('UPDATE candidate_operations.shift_references SET '+update+' WHERE id=$1',[f.shift]),e=>e.code==='P0001');
});
test('notification failure rolls back assignment, event, receipt and scope revision',async()=>{
 const f=await fixture();const before=(await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision;
 await owner.query(`CREATE FUNCTION candidate_operations.test_close_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional close notification failure'; END; $$; CREATE TRIGGER test_close_failure BEFORE INSERT ON candidate_operations.close_notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_close_failure();`);
 try{await assert.rejects(run(f.command),e=>e.message==='fictional close notification failure');assert.equal((await owner.query('SELECT count(*)::int AS n FROM candidate_operations.closes WHERE shift_id=$1',[f.shift])).rows[0].n,0);assert.equal((await owner.query('SELECT count(*)::int AS n FROM candidate_operations.command_receipts WHERE request_id=$1',[f.command.requestId])).rows[0].n,0);assert.equal((await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision,before);}finally{await owner.query('DROP TRIGGER test_close_failure ON candidate_operations.close_notification_outbox; DROP FUNCTION candidate_operations.test_close_failure();');}
});
test('HTTP command dispatch and close detail use verified identity; unsupported attention remains excluded',async()=>{
 const f=await fixture(),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,'manager',clock_timestamp()+interval '1 hour')",[sessionId]);
 const handler=createTaskHandler(db,async()=>({subject:'manager',sessionId}));
 const result=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/commands',{method:'POST',headers:{Authorization:'Bearer fictional-verified-session','Content-Type':'application/json'},body:JSON.stringify(f.command)}));assert.equal(result.status,200);const assigned=await result.json();
 const detail=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/closes/'+assigned.recordId,{headers:{Authorization:'Bearer fictional-verified-session'}}));assert.equal(detail.status,200);assert.equal((await detail.json()).data.phase,'open');
 assert.throws(()=>parseCommand({requestId:randomUUID(),locationId:'fictional-a',action:'close.transition',recordId:assigned.recordId,expectedRevision:1,input:{step:'fix',note:'Not implemented',managerAttention:'equipment'}},'fictional-a'),denied(400));
 await assert.rejects(db.transaction(c=>c.query("UPDATE candidate_operations.closes SET phase='closed'",[])),e=>e.code==='42501');
});
