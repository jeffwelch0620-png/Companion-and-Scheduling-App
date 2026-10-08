import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {planReviewReminders} from '../.sites-runtime/shared/review-reminders.mjs';
import {runLocationReminders,runScheduledReviewReminders,handleReminders,reminderState} from '../.sites-runtime/shared/reminder-service.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const location={id:'a',name:'Fictional restaurant',timezone:'America/New_York',revision:0};
const members=[['employee',[]],['manager',['people.manage']],['gm',['people.approve']],['owner',['operations.escalation','location.manage']],['admin',['location.manage']],['outsider',[]],['dish',['location.manage','operations.escalation']]].map(([id,capabilities])=>({id,locationId:'a',name:'Fictional '+id,area:'BOH',position:id==='dish'?'Dishwasher':'Cook',capabilities,qualifications:[]}));
function review(overrides={}) {return {id:'review',locationId:'a',kind:'development',ownerId:'employee',area:'BOH',revision:1,updatedAt:'2026-09-01T12:00:00Z',data:{title:'Private calibration',managerId:'manager',approverId:'gm',hireDate:'2026-08-01',originalDueDate:'2026-09-01',phase:'self-assessment',stations:[{name:'Fixture',definition:'Fixture only',source:'Fixture',selfScore:null,selfNote:'private employee note',managerScore:null,managerNote:'private manager note'}],selfShared:false,managerShared:false,submissions:[],selfSummary:'private employee summary',managerSummary:'private manager summary',employeeDiscussion:'',managerDiscussion:'',approvalNote:'',history:[],...overrides}}}
const at=day=>`2026-09-${String(day).padStart(2,'0')}T12:00:00Z`;
const headers=id=>id?{'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'}:{};
async function fixture(t){
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  for(const id of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,'Fictional '+id,location.timezone).run();
  for(const m of members)await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(m.id,m.id+'@example.test',m.id==='outsider'?'b':'a',m.name,m.area,m.position,JSON.stringify(m.capabilities),'[]').run();
  async function save(r=review()){await db.prepare("INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,'development',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=records.revision+1").bind(r.id,r.locationId,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt).run();await db.prepare('UPDATE locations SET revision=revision+1 WHERE id=?').bind(r.locationId).run()}
  await save();
  async function view(actor){const response=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:headers(actor)}),db);assert.equal(response.status,200);return response.json()}
  return {db,save,view};
}

test('review deadlines follow restaurant dates across DST and catch up without sending every missed milestone',()=>{
  for(const [day,expected] of [[3,[]],[4,[3]],[5,[3]],[6,[5]],[7,[5]],[8,[5,7]],[20,[5,7]]])assert.deepEqual(planReviewReminders(location,members,[review()],[],at(day)).reminders.map(r=>r.milestone),expected);
  const r=review({originalDueDate:'2026-11-01'});
  assert.equal(planReviewReminders(location,members,[r],[],'2026-11-04T04:59:59Z').reminders.length,0);
  assert.deepEqual(planReviewReminders(location,members,[r],[],'2026-11-04T05:00:00Z').reminders.map(r=>r.milestone),[3]);
  assert.equal(planReviewReminders(location,members,[review({phase:'approved'}),review({phase:'cancelled'})],[],at(20)).reminders.length,0);
});

test('delivery and receipts persist once, preserve private assessments and reading does not approve a review',async t=>{
  const f=await fixture(t);
  assert.equal((await runLocationReminders(f.db,'a',at(4),'scheduled')).delivered,1);
  assert.equal((await runLocationReminders(f.db,'a',at(4),'manual')).delivered,0);
  assert.equal((await runLocationReminders(f.db,'a',at(6),'scheduled')).delivered,1);
  assert.equal((await runLocationReminders(f.db,'a',at(8),'scheduled')).delivered,1);
  const owner=await f.view('owner');assert.equal(owner.records.length,1);assert.equal(owner.records[0].kind,'message');assert.doesNotMatch(JSON.stringify(owner),/private employee|private manager|Private calibration/);
  const manager=await f.view('manager'),message=manager.records.find(r=>r.kind==='message');
  const call=action=>handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers('manager'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,recordId:message.id,expectedRevision:message.revision,input:{text:'Done'}})}),f.db);
  assert.equal((await call('message.reply')).status,400);assert.equal((await call('message.read')).status,200);
  const r=(await f.view('employee')).records.find(r=>r.kind==='development');assert.equal(r.data.phase,'self-assessment');assert.equal(r.data.originalDueDate,'2026-09-01');
  assert.equal((await f.view('dish')).records.length,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM review_reminders').first()).n,3);
});

test('GM handoff and reassignment retain the deadline and notify the new responsible party without repeats',async t=>{
  const f=await fixture(t);await runLocationReminders(f.db,'a',at(8),'scheduled');
  await f.save(review({phase:'gm-review'}));
  const state=await runLocationReminders(f.db,'a',at(8),'scheduled');assert.equal(state.delivered,2);
  const gm=(await f.view('gm')).records.find(r=>r.kind==='message');assert.match(gm.data.body,/7 days overdue/);assert.match(gm.data.body,/GM approval/);
  assert.equal((await runLocationReminders(f.db,'a',at(9),'scheduled')).delivered,0);
  // A replacement manager receives the still-overdue review, not a new deadline.
  await f.db.prepare("UPDATE memberships SET capabilities='[\"people.manage\",\"location.manage\"]',revision=revision+1 WHERE id='admin'").run();
  await f.save(review({managerId:'admin'}));
  assert.equal((await runLocationReminders(f.db,'a',at(9),'scheduled')).delivered,2);
  const replacement=(await f.view('admin')).records.find(r=>r.kind==='message');assert.match(replacement.data.body,/8 days overdue/);assert.match(replacement.data.body,/2026-09-01/);
  await f.save(review({phase:'approved'}));assert.equal((await runLocationReminders(f.db,'a',at(20),'scheduled')).delivered,0);
});

test('missing, inactive, Dish or unauthorized recipients remain actionable and are not marked delivered',async t=>{
  const f=await fixture(t);await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id IN ('manager','owner')").run();
  const blocked=await runLocationReminders(f.db,'a',at(8),'scheduled');assert.equal(blocked.delivered,0);assert.deepEqual(blocked.issues.map(i=>i.reason),['missing-manager','missing-owner']);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM review_reminders').first()).n,0);
  await f.db.prepare("UPDATE memberships SET active=1,revision=revision+1 WHERE id IN ('manager','owner')").run();
  assert.equal((await runLocationReminders(f.db,'a',at(9),'scheduled')).delivered,2);
  const corrupt=planReviewReminders(location,members,[review({originalDueDate:'2026-02-30'})],[],at(9));assert.equal(corrupt.reminders.length,0);assert.equal(corrupt.issues[0].reason,'invalid-deadline');
});

test('concurrent checks, stale authority and a transaction failure cannot duplicate or partially deliver reminders',async t=>{
  const f=await fixture(t);
  const results=await Promise.allSettled([runLocationReminders(f.db,'a',at(8),'scheduled'),runLocationReminders(f.db,'a',at(8),'scheduled')]);
  assert.ok(results.some(r=>r.status==='fulfilled'));for(const r of results)if(r.status==='rejected')assert.equal(r.reason.status,409);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM review_reminders').first()).n,2);
  await assert.rejects(runLocationReminders(f.db,'a',at(9),'manual',{memberId:'admin',authUserId:'wrong',revision:1}),e=>e.status===409);
  const other=review();other.id='review2';await f.save(other);
  await f.db.prepare("CREATE TRIGGER fail_reminder BEFORE INSERT ON review_reminders WHEN NEW.review_id='review2' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();
  const before=await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='message'").first();
  await assert.rejects(runLocationReminders(f.db,'a',at(9),'scheduled'));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='message'").first()).n,before.n);
  assert.equal((await reminderState(f.db,'a')).checkedAt,at(8));
  await f.db.prepare('DROP TRIGGER fail_reminder').run();assert.equal((await runLocationReminders(f.db,'a',at(9),'scheduled')).delivered,2);
});

test('reminder administration rejects unauthorized callers and cross-site requests; manual checks do not imply a background run',async t=>{
  const f=await fixture(t);
  const call=(actor,method='GET',origin='https://test.example')=>handleReminders(new Request('https://test.example/api/reminders?locationId=a',{method,headers:{...headers(actor),Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({action:'run'})}:{})}),f.db);
  assert.equal((await call(null)).status,401);for(const actor of ['employee','manager','gm','dish','outsider'])assert.equal((await call(actor)).status,403);
  assert.equal((await call('admin','POST','https://other.example')).status,403);
  assert.equal((await call('admin')).status,200);
  assert.equal((await call('admin','POST')).status,200);
  assert.equal((await reminderState(f.db,'a')).scheduledAt,null);
  await runScheduledReviewReminders(f.db,at(10));assert.equal((await reminderState(f.db,'a')).scheduledAt,at(10));assert.equal((await reminderState(f.db,'b')).scheduledAt,at(10));
});
