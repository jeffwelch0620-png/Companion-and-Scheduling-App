import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {executeTask,CommandError,parseCommand} from './task-adapter.ts';

import {connection} from './test-config.mjs';
const psql=process.env.CANDIDATE_PSQL||'psql';
const ids={manager:'10000000-0000-0000-0000-000000000001',employee:'10000000-0000-0000-0000-000000000002',
 peer:'10000000-0000-0000-0000-000000000003',foreign:'10000000-0000-0000-0000-000000000004'};
function admin(sql){
 const out=spawnSync(psql,['-h','127.0.0.1','-p',String(connection.port),'-U','candidate_owner','-d',connection.database,
  '-v','ON_ERROR_STOP=1','-At','-c',sql],{encoding:'utf8'});
 assert.equal(out.status,0,out.stderr);return out.stdout.trim();
}
class Bridge {
 constructor(){
  this.pending=[];this.chain=Promise.resolve();this.stderr='';
  this.process=spawn(process.execPath,[fileURLToPath(new URL('./test-bridge.mjs',import.meta.url))],
   {env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.process.stderr.on('data',b=>this.stderr+=b);
  createInterface({input:this.process.stdout}).on('line',line=>{
   const call=this.pending.shift();if(!call)return;
   const result=JSON.parse(line);
   if(result.error){const e=new Error(result.error.message);e.code=result.error.code;call.reject(e);}
   else call.resolve(result);
  });
  this.closed=new Promise(resolve=>this.process.on('close',code=>{
   for(const call of this.pending)call.reject(new Error('bridge exited '+code+': '+this.stderr));resolve();
  }));
  this.process.on('error',error=>{for(const call of this.pending)call.reject(error);});
 }
 query(sql,values=[]){
  return new Promise((resolve,reject)=>{
   this.pending.push({resolve,reject});
   this.process.stdin.write(JSON.stringify({sql,values})+'\n');
  });
 }
 transaction(operation){
  const run=this.chain.then(async()=>{
   await this.query('BEGIN');
   try{const result=await operation(this);await this.query('COMMIT');return result;}
   catch(error){await this.query('ROLLBACK');throw error;}
  });this.chain=run.catch(()=>{});return run;
 }
 async close(){this.process.stdin.end();await this.closed;}
}
const identity=actor=>({subject:actor,membershipId:ids[actor]});
const create=(owner='employee',title='Fictional task')=>({
 requestId:randomUUID(),locationId:'fictional-a',action:'task.create',
 input:{ownerId:ids[owner],title,detail:'Clean and inspect the work area.',kind:'task',due:'2026-10-09T12:00:00-04:00'}
});
const transition=(task,step,revision=task.revision)=>({
 requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:task.recordId,
 expectedRevision:revision,input:{step,note:'Fictional evidence.'}
});
const run=(db,actor,command)=>executeTask(db,identity(actor),'fictional-a',command);
async function withBridge(t){const db=new Bridge();t.after(()=>db.close());return db;}
async function read(db,actor,task){
 const out=await db.query('SELECT candidate_operations.read_task($1,$2::uuid,$3,$4::uuid) AS result',
  [actor,ids[actor],'fictional-a',task.recordId]);return JSON.parse(out.rows[0].result);
}
const denied=status=>error=>error instanceof CommandError&&error.status===status;

test('employee ready, correction/resubmission, independent verification and history',async t=>{
 const db=await withBridge(t);let task=await run(db,'manager',create());
 assert.equal((await read(db,'employee',task)).data.phase,'open');
 task=await run(db,'employee',transition(task,'ready'));
 assert.equal((await read(db,'manager',task)).data.phase,'verification');
 task=await run(db,'manager',transition(task,'fix'));
 task=await run(db,'employee',transition(task,'ready'));
 task=await run(db,'manager',transition(task,'verify'));
 const saved=await read(db,'employee',task);
 assert.equal(saved.data.phase,'closed');assert.equal(saved.revision,5);
 assert.deepEqual(saved.data.history.map(h=>h.action),['assigned','ready','fix','ready','verify']);
 await assert.rejects(run(db,'manager',transition(task,'fix')),denied(409));
});
test('assignee, manager, restaurant and trusted subject restrictions',async t=>{
 const db=await withBridge(t),task=await run(db,'manager',create());
 await assert.rejects(run(db,'peer',transition(task,'ready')),denied(403));
 await assert.rejects(run(db,'employee',create()),denied(403));
 await assert.rejects(run(db,'foreign',transition(task,'ready')),denied(403));
 await assert.rejects(executeTask(db,{subject:'peer',membershipId:ids.employee},'fictional-a',transition(task,'ready')),denied(403));
 await assert.rejects(db.query('SELECT * FROM candidate_operations.tasks'),e=>e.code==='42501');
 await assert.rejects(read(db,'peer',task),e=>e.code==='42501');
});
test('self-verification is denied even for manager assigned to own task',async t=>{
 const db=await withBridge(t);let task=await run(db,'manager',create('manager'));
 task=await run(db,'manager',transition(task,'ready'));
 await assert.rejects(run(db,'manager',transition(task,'verify')),e=>denied(403)(e)&&e.code==='self_verification_denied');
});
test('lost-response replay produces one event and stable committed receipt',async t=>{
 const db=await withBridge(t),command=create();const first=await run(db,'manager',command);
 const replay=await run(db,'manager',command);
 assert.deepEqual({...replay,replayed:false},first);
 assert.equal((await read(db,'manager',first)).data.history.length,1);
 await assert.rejects(run(db,'manager',{...command,input:{...command.input,title:'Changed payload'}}),denied(409));
});
test('stale versions and unsupported input do not create effects',async t=>{
 const db=await withBridge(t),task=await run(db,'manager',create());
 await run(db,'employee',transition(task,'ready'));
 await assert.rejects(run(db,'employee',transition(task,'ready')),denied(409));
 assert.equal((await read(db,'employee',task)).data.history.length,2);
 assert.throws(()=>parseCommand({...create(),locationId:'fictional-b'},'fictional-a'),denied(403));
 assert.throws(()=>parseCommand({...create(),actorId:ids.manager},'fictional-a'),denied(400));
 assert.throws(()=>parseCommand({...transition(task,'ready'),expectedRevision:1.5},'fictional-a'),denied(400));
 assert.throws(()=>parseCommand({...create(),input:{...create().input,kind:'handoff'}},'fictional-a'),denied(400));
});
test('revocation is checked for new commands and saved-result replays',async t=>{
 const db=await withBridge(t),task=await run(db,'manager',create()),command=transition(task,'ready');
 await run(db,'employee',command);
 admin("UPDATE candidate_identity.memberships SET active=false WHERE id='"+ids.employee+"'");
 try{
  await assert.rejects(run(db,'employee',command),denied(403));
  await assert.rejects(run(db,'employee',transition(task,'ready',2)),denied(403));
 }finally{admin("UPDATE candidate_identity.memberships SET active=true WHERE id='"+ids.employee+"'");}
});
test('notification failure rolls back task, event, receipt and scope revision',async t=>{
 const db=await withBridge(t),command=create('employee','Fictional Fault task');
 admin(`CREATE FUNCTION candidate_operations.test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.message LIKE 'Fictional Fault%' THEN RAISE EXCEPTION 'fictional notification failure'; END IF; RETURN NEW; END; $$;
 CREATE TRIGGER test_fail BEFORE INSERT ON candidate_operations.notification_outbox
 FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_fail_outbox();`);
 const before=admin("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'");
 try{
  await assert.rejects(run(db,'manager',command),e=>!(e instanceof CommandError)&&e.message==='fictional notification failure');
  assert.equal(admin("SELECT count(*) FROM candidate_operations.tasks WHERE title='Fictional Fault task'"),'0');
  assert.equal(admin("SELECT count(*) FROM candidate_operations.command_receipts WHERE request_id='"+command.requestId+"'"),'0');
  assert.equal(admin("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'"),before);
 }finally{admin('DROP TRIGGER test_fail ON candidate_operations.notification_outbox; DROP FUNCTION candidate_operations.test_fail_outbox();');}
});
test('two actual PostgreSQL sessions concurrently retry one command',async t=>{
 const left=await withBridge(t),right=await withBridge(t),command=create();
 const outcomes=await Promise.all([run(left,'manager',command),run(right,'manager',command)]);
 assert.equal(outcomes[0].recordId,outcomes[1].recordId);
 assert.deepEqual(outcomes.map(o=>o.replayed).sort(),[false,true]);
 assert.equal((await read(left,'manager',outcomes[0])).data.history.length,1);
 assert.equal(admin("SELECT count(*) FROM candidate_operations.command_receipts WHERE request_id='"+command.requestId+"'"),'1');
});
