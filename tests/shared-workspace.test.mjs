import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { handleWorkspace } from '../.sites-runtime/shared/service.mjs';
import { normalizeToastRoster, fetchToastRoster } from '../.sites-runtime/shared/toast-roster.mjs';
import { localInstant, localDate } from '../.sites-runtime/shared/local-time.mjs';
import { reviewDueState } from '../.sites-runtime/shared/followthrough.mjs';
import { handleToast } from '../.sites-runtime/shared/toast-service.mjs';
import { configuredToast } from '../.sites-runtime/shared/toast-connection.mjs';
import { approvedStationGuides, assignedStandardCurrent } from '../.sites-runtime/shared/station-knowledge.mjs';
import { recoveredStandards } from '../.sites-runtime/shared/recovered-standards.mjs';
import { createHash } from 'node:crypto';
import { buildShiftBrief } from '../.sites-runtime/shared/shift-brief.mjs';
import { companionContext } from '../.sites-runtime/shared/companion-context.mjs';
import { attendancePatterns, attendanceNotice, parseAttendanceFacts } from '../.sites-runtime/shared/attendance-review.mjs';

// Keep the local emulator registry inside this checkout on Windows and CI.
process.env.MINIFLARE_REGISTRY_PATH ??= path.resolve('.wrangler/registry');

// Fixture identities are supplied to the same handler Sites invokes. No test login ships in app code.
async function fixture(t) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-05-22', d1Databases: ['DB'] });
  t.after(() => mf.dispose()); const db = await mf.getD1Database('DB');
  for (const file of fs.readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').filter(s => s.trim());
    await db.batch(sql.map(s => db.prepare(s)));
  }
  await db.batch(['a', 'b'].map(id => db.prepare('INSERT INTO locations(id,name,timezone) VALUES (?,?,?)').bind(id, `Test restaurant ${id}`, 'America/New_York')));
  for (const [id, area, position, caps, location = 'a'] of [
    ['worker', 'BOH', 'Fry', []], ['incoming', 'BOH', 'Fry', []], ['dish', 'BOH', 'Dishwasher', []],
    ['manager', 'BOH', 'Kitchen Manager', ['schedule.manage','schedule.publish','schedule.change','close.confirm','standards.approve','tasks.manage','people.manage','orders.request']],
    ['drafter', 'BOH', 'Schedule drafter', ['schedule.manage','tasks.manage']],
    ['senior', 'BOH', 'Shift lead', ['close.verify','schedule.change']],
    ['gm', 'BOH', 'General manager', ['people.manage','people.approve','operations.escalation']],
    ['opener', 'BOH', 'Opening manager', ['tasks.manage','close.confirm','schedule.change','people.manage']],
    ['admin', 'BOH', 'Administrator', ['location.manage']],
    ['foh', 'FOH', 'FOH Manager', ['schedule.manage','tasks.manage','people.manage']],
    ['purchaser', 'Executive', 'Reviewer', ['orders.review']],
    ['outsider', 'BOH', 'Fry', [], 'b'],
  ]) await db.prepare('INSERT INTO memberships (id,email,location_id,name,area,position,capabilities,qualifications) VALUES (?,?,?,?,?,?,?,?)').bind(id, `${id}@example.test`, location, `Test ${id}`, area, position, JSON.stringify(caps), JSON.stringify([position])).run();
  async function call(actor, action, input = {}, record, options = {}) {
    const body = { requestId: options.requestId ?? crypto.randomUUID(), locationId: options.locationId ?? 'a', action, input, ...(record ? {recordId: record.id ?? record.recordId, expectedRevision: record.revision} : {}) };
    const response = await handleWorkspace(new Request('https://test.example/api/workspace', {method: 'POST', headers: {'oai-authenticated-user-id':`${actor}-identity`, 'oai-authenticated-user-email':`${actor}@example.test`, Origin: options.origin ?? 'https://test.example', 'Content-Type':'application/json'}, body:JSON.stringify(body)}), db);
    return {status: response.status, data: await response.json(), body};
  }
  async function view(actor, location = 'a') { const response = await handleWorkspace(new Request(`https://test.example/api/workspace?locationId=${location}`, {headers:actor ? {'oai-authenticated-user-id':`${actor}-identity`,'oai-authenticated-user-email':`${actor}@example.test`} : {}}), db); return {status:response.status,data:await response.json()}; }
  return {db, call, view};
}
function ok(result) { assert.equal(result.status,200,JSON.stringify(result.data)); return result.data; }

test('simultaneous message readers merge without changing content, history dates or the restaurant revision',async t=>{
 const f=await fixture(t),readers=Array.from({length:20},(_,i)=>'reader-'+i);
 for(const reader of readers)await f.db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(reader,reader+'@example.test',reader+'-identity','a',reader,'FOH','Server','[]','[]').run();
 const sent=ok(await f.call('manager','message.send',{recipients:readers,title:'Fictional team note',body:'Software test only.'}));
 const before=await f.db.prepare('SELECT revision,data,updated_at FROM records WHERE id=?').bind(sent.recordId).first();
 const revision=(await f.db.prepare("SELECT revision FROM locations WHERE id='a'").first()).revision;
 const results=await Promise.all(readers.map(actor=>f.call(actor,'message.read',{},sent)));for(const result of results)ok(result);
 const after=await f.db.prepare('SELECT revision,data,updated_at FROM records WHERE id=?').bind(sent.recordId).first();
 assert.equal(after.revision,before.revision);assert.equal(after.updated_at,before.updated_at);assert.equal((await f.db.prepare("SELECT revision FROM locations WHERE id='a'").first()).revision,revision);
 assert.deepEqual(new Set(JSON.parse(after.data).readBy),new Set(['manager',...readers]));
 assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='message.read'").first()).n,0);
 const retry=await f.call(readers[0],'message.read',{},sent,{requestId:results[0].body.requestId});assert.deepEqual(ok(retry),results[0].data);
});

test('reading a notice between a manager snapshot and commit cannot invalidate that manager change',async t=>{
 const f=await fixture(t),sent=ok(await f.call('manager','message.send',{recipients:['worker'],title:'Fixture note',body:'Fixture'}));
 let batches=0;const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)ok(await f.call('worker','message.read',{},sent));return f.db.batch(statements)}})};
 const body={requestId:'manager-during-inbox',locationId:'a',action:'message.send',input:{recipients:['incoming'],title:'A second fixture',body:'Manager work continues.'}};
 const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json','oai-authenticated-user-id':'manager-identity','oai-authenticated-user-email':'manager@example.test'},body:JSON.stringify(body)}),binding);
 assert.equal(response.status,200);assert.ok(JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(sent.recordId).first()).data).readBy.includes('worker'));
});

test('message read rejects a concurrent reply, filed record or revoked membership without leaving a receipt',async t=>{
 for(const mutation of ["UPDATE records SET revision=revision+1,data=json_set(data,'$.readBy',json('[]')) WHERE id=?","UPDATE records SET archived_at='2026-01-01T00:00:00Z',revision=revision+1 WHERE id=?","UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'"]){
  const f=await fixture(t),sent=ok(await f.call('manager','message.send',{recipients:['worker'],title:'Fixture note',body:'Fixture'}));await f.view('worker');let batches=0;
  const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2){let query=f.db.prepare(mutation);if(mutation.includes('?'))query=query.bind(sent.recordId);await query.run()}return f.db.batch(statements)}})};
  const body={requestId:'changed-message-read',locationId:'a',action:'message.read',recordId:sent.recordId,expectedRevision:sent.revision,input:{}};
  const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json','oai-authenticated-user-id':'worker-identity','oai-authenticated-user-email':'worker@example.test'},body:JSON.stringify(body)}),binding);
  assert.equal(response.status,409);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM command_receipts WHERE request_id='changed-message-read'").first()).n,0);assert.equal(JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(sent.recordId).first()).data).readBy.includes('worker'),false);
 }
});

test('failed read receipt rolls back the read marker and exact retry saves once',async t=>{
 const f=await fixture(t),sent=ok(await f.call('manager','message.send',{recipients:['worker'],title:'Fixture note',body:'Fixture'}));
 await f.db.prepare("CREATE TRIGGER fail_read BEFORE INSERT ON command_receipts WHEN NEW.request_id='read-failure' BEGIN SELECT RAISE(ABORT,'fictional receipt failure'); END").run();
 const failed=await f.call('worker','message.read',{},sent,{requestId:'read-failure'});assert.equal(failed.status,503);
 assert.equal(JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(sent.recordId).first()).data).readBy.includes('worker'),false);
 await f.db.prepare('DROP TRIGGER fail_read').run();ok(await f.call('worker','message.read',{},sent,{requestId:'read-failure'}));
 assert.equal(JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(sent.recordId).first()).data).readBy.filter(id=>id==='worker').length,1);
});
const period = {start:'2026-09-14T20:00:00-04:00',end:'2026-09-15T01:00:00-04:00'};

async function attendanceFixture(t){
  const f=await fixture(t);
  const draft=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',start:'2026-09-01T20:00:00-04:00',end:'2026-09-02T01:00:00-04:00'}));
  const shift=ok(await f.call('manager','shift.publish',{},draft));
  return {...f,shift,input:{shiftId:shift.recordId,shiftRevision:shift.revision,type:'call-in',reportedAt:'2026-09-01T18:30:00-04:00',note:'Fictional call-in: employee reported they could not attend.'}};
}

test('automatic notifications appear only for their recipients while personal conversations remain visible to senders',async t=>{
  const f=await attendanceFixture(t);
  const manager=ok(await f.view('manager')),worker=ok(await f.view('worker'));
  assert.ok(!manager.records.some(r=>r.kind==='message'&&r.data.title==='Shift published'));
  const notice=worker.records.find(r=>r.kind==='message'&&r.data.title==='Shift published');
  assert.ok(notice);assert.equal(notice.data.automated,true);
  assert.equal((await f.call('manager','message.read',{},notice)).status,404);
  assert.equal((await f.call('worker','message.reply',{text:'A notification is not a private conversation.'},notice)).status,400);
  ok(await f.call('worker','message.read',{},notice));
  const sent=ok(await f.call('worker','message.send',{recipients:['manager'],title:'Schedule question',body:'Can we discuss the fictional shift?'}));
  const own=ok(await f.view('worker')).records.find(r=>r.id===sent.recordId);
  assert.ok(own);assert.ok(!own.data.automated);
  ok(await f.call('manager','message.reply',{text:'Yes, use this conversation.'},sent));
  assert.equal(ok(await f.view('worker')).records.find(r=>r.id===sent.recordId).data.replies.length,1);
});

test('attendance is durable manager-only history without changing the original shift or notifying employees',async t=>{
  const f=await attendanceFixture(t),before=ok(await f.view('manager')),original=before.records.find(r=>r.id===f.shift.recordId),requestId=crypto.randomUUID();
  const saved=ok(await f.call('manager','attendance.record',{...f.input,employeeName:'Forged name',ownerId:'incoming'},undefined,{requestId}));
  assert.deepEqual(ok(await f.call('manager','attendance.record',{...f.input,employeeName:'Forged name',ownerId:'incoming'},undefined,{requestId})),saved);
  const after=ok(await f.view('manager')),entry=after.records.find(r=>r.id===saved.recordId);
  assert.equal(entry.ownerId,'worker');assert.equal(entry.data.employeeName,'Test worker');assert.equal(entry.data.history.length,1);
  assert.equal(entry.data.history[0].actorName,'Test manager');assert.equal(entry.data.history[0].actorId,'manager');
  assert.equal(entry.data.reportedAt,'2026-09-01T22:30:00.000Z');assert.equal(entry.data.shiftRevision,f.shift.revision);
  assert.deepEqual(after.records.find(r=>r.id===f.shift.recordId),original);
  assert.equal(after.records.filter(r=>r.kind==='message').length,before.records.filter(r=>r.kind==='message').length);
  assert.equal((await f.call('manager','attendance.record',f.input)).status,409);
  for(const actor of ['worker','incoming','dish','foh','drafter','senior']){
    assert.ok(!ok(await f.view(actor)).records.some(r=>r.id===entry.id));
    assert.ok([403,404].includes((await f.call(actor,'attendance.correct',{...f.input,changeReason:'Unauthorized change'},entry)).status));
  }
  assert.equal((await f.call('outsider','attendance.record',f.input)).status,403);
  assert.ok(ok(await f.view('admin')).records.some(r=>r.id===entry.id));
  assert.ok(ok(await f.view('gm')).records.some(r=>r.id===f.shift.recordId),'People managers can open published shifts for attendance without edit rights.');
  assert.ok(!JSON.stringify(companionContext(after,'Tell me about attendance and call-ins',new Date().toISOString())).includes(f.input.note));
  assert.throws(()=>companionContext(after,'Explain this',new Date().toISOString(),[],{id:entry.id,revision:entry.revision}));
  // Later scheduling and employment changes must not rewrite this event's owner or original shift.
  await f.db.prepare('UPDATE records SET owner_id=?,data=json_set(data,\'$.personId\',?,\'$.start\',?,\'$.cancelled\',1) WHERE id=?').bind('incoming','incoming','2026-09-02T18:00:00Z',f.shift.recordId).run();
  await f.db.prepare('UPDATE memberships SET active=0,schedule_only=0 WHERE id=?').bind('worker').run();
  const retained=ok(await f.view('manager')).records.find(r=>r.id===entry.id);
  assert.deepEqual(retained,entry);assert.equal(retained.data.shift.start,'2026-09-02T00:00:00.000Z');
});

test('cancelled shifts reject new attendance while existing entries remain correctable and voidable',async t=>{
  const f=await attendanceFixture(t),saved=ok(await f.call('manager','attendance.record',f.input));
  await f.db.prepare("UPDATE records SET data=json_set(data,'$.cancelled',1),revision=revision+1 WHERE id=?").bind(f.shift.recordId).run();
  const cancelled=ok(await f.view('manager')).records.find(r=>r.id===f.shift.recordId);
  const blocked=await f.call('manager','attendance.record',{...f.input,shiftRevision:cancelled.revision,type:'other'});
  assert.equal(blocked.status,400);assert.match(blocked.data.error,/cancelled/i);
  assert.equal(ok(await f.view('manager')).records.filter(r=>r.kind==='attendance').length,1);
  const corrected=ok(await f.call('manager','attendance.correct',{...f.input,note:'Corrected original call-in after cancellation.',changeReason:'Preserve the actual report.'},saved));
  const voided=ok(await f.call('manager','attendance.void',{changeReason:'Original report was recorded in error.'},corrected));
  const retained=ok(await f.view('manager')).records.find(r=>r.id===voided.recordId);
  assert.equal(retained.data.status,'voided');assert.equal(retained.data.history.length,3);
  assert.equal(retained.data.history[0].note,f.input.note);
  assert.equal(retained.data.shift.start,'2026-09-02T00:00:00.000Z');
});

test('attendance corrections and voids retain every prior value and reject stale or conflicting updates',async t=>{
  const f=await attendanceFixture(t),saved=ok(await f.call('manager','attendance.record',f.input));
  const corrected=ok(await f.call('opener','attendance.correct',{type:'late',reportedAt:'2026-09-01T20:10:00-04:00',note:'Fictional correction: late arrival, not a missed shift.',changeReason:'Manager checked the original call.'},saved));
  const entry=ok(await f.view('manager')).records.find(r=>r.id===corrected.recordId);
  assert.equal(entry.data.history.length,2);assert.equal(entry.data.history[0].note,f.input.note);assert.equal(entry.data.history[0].type,'call-in');assert.equal(entry.data.history[1].actorId,'opener');assert.equal(entry.data.type,'late');
  assert.equal((await f.call('manager','attendance.correct',{...f.input,changeReason:'Stale update'},saved)).status,409);
  assert.equal((await f.call('manager','attendance.correct',{...f.input,changeReason:''},corrected)).status,400);
  const second=ok(await f.call('manager','attendance.record',{...f.input,type:'left-early'}));
  assert.equal((await f.call('manager','attendance.correct',{...f.input,type:'left-early',changeReason:'Would duplicate'},corrected)).status,409);
  const voided=ok(await f.call('manager','attendance.void',{changeReason:'Fictional entry was recorded against the wrong shift.'},corrected));
  const history=ok(await f.view('manager')).records.find(r=>r.id===voided.recordId).data;
  assert.equal(history.status,'voided');assert.equal(history.history.length,3);assert.equal(history.history[2].changeReason,'Fictional entry was recorded against the wrong shift.');
  assert.equal(history.note,entry.data.note);assert.equal((await f.call('manager','attendance.correct',{...f.input,changeReason:'Cannot silently restore'},voided)).status,400);
  assert.equal((await f.call('manager','attendance.void',{changeReason:'Again'},voided)).status,400);
  assert.ok(second.recordId!==voided.recordId);
  ok(await f.call('manager','attendance.record',{...f.input,type:'late'}));
});

test('attendance validates reports and commits the record, receipt and audit atomically',async t=>{
  const f=await attendanceFixture(t);
  for(const actor of ['worker','foh','drafter'])assert.equal((await f.call(actor,'attendance.record',f.input)).status,403);
  for(const patch of [{type:'unknown'},{type:'__proto__'},{note:''},{note:'x'.repeat(2001)},{reportedAt:'2026-09-01T18:30'},{reportedAt:'2099-09-01T18:30:00Z'},{type:'no-show'}])assert.equal((await f.call('manager','attendance.record',{...f.input,...patch})).status,400,JSON.stringify(patch));
  assert.equal((await f.call('manager','attendance.record',{...f.input,shiftRevision:1})).status,409);
  const draft=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  assert.equal((await f.call('manager','attendance.record',{...f.input,shiftId:draft.recordId,shiftRevision:draft.revision})).status,400);
  await f.db.prepare("CREATE TRIGGER reject_attendance_audit BEFORE INSERT ON audit_events WHEN NEW.action='attendance.record' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END").run();
  const requestId=crypto.randomUUID();assert.equal((await f.call('manager','attendance.record',f.input,undefined,{requestId})).status,503);
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM records WHERE kind='attendance'").first()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM command_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_attendance_audit').run();
  ok(await f.call('manager','attendance.record',f.input,undefined,{requestId}));
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM records WHERE kind='attendance'").first()).n,1);
  ok(await f.call('manager','attendance.record',{...f.input,type:'no-show',reportedAt:'2026-09-01T20:15:00-04:00'}));
  await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind('[]','manager').run();
  assert.ok(!ok(await f.view('manager')).records.some(r=>r.kind==='attendance'));
  assert.equal((await f.call('manager','attendance.record',{...f.input,type:'other'})).status,403);
});

const trainingGuide={purpose:'Fictional practice area ready for the next shift.',preparation:['Check the fictional practice kit.'],steps:['Read the practice label.','Arrange the sample kit as demonstrated.'],troubleshooting:['If a practice item is missing, record the missing item.'],escalation:'Ask the assigned trainer before using an unfamiliar practice item.'};
const guidedStandard={title:'Fictional guided Fry close',zone:'Practice area',position:'Fry',version:1,criteria:['Practice kit is ready'],source:'Fictional fixture only, not a restaurant SOP.',verification:'manager',guide:trainingGuide};

async function correctionFixture(f,fixInput={}){
  ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...period,note:'Fictional closing leadership'}));
  const draft=ok(await f.call('manager','standard.save',{...guidedStandard,verification:'senior-then-manager'}));
  const standard=ok(await f.call('manager','standard.approve',{validated:true,note:'Fictional standard reviewed'},draft));
  let shift=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  const assigned=ok(await f.call('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',verifierId:'senior',due:period.end}));
  shift=ok(await f.call('manager','shift.publish',{},shift));
  const ready=ok(await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Fictional condition ready'},assigned));
  const close=ok(await f.call('senior','close.transition',{step:'fix',note:'Fictional sample kit needs correction',...fixInput},ready));
  return {shift,standard,close};
}

test('routine corrections notify the manager without adding an acknowledgment requirement',async t=>{
  const f=await fixture(t),s=await correctionFixture(f),w=ok(await f.view('manager'));
  const close=w.records.find(r=>r.id===s.close.recordId);assert.equal(close.data.attention,undefined);
  assert.ok(w.records.some(r=>r.kind==='message'&&r.data.recordId===close.id&&r.data.title.endsWith(': correction')));
  assert.equal(buildShiftBrief(w,'2026-09-15T00:00:00Z').items.find(i=>i.record.id===close.id).lane,'waiting');
  assert.equal((await f.call('manager','close.acknowledge',{note:'No flag to acknowledge'},s.close)).status,400);
  const secondFix=ok(await f.call('senior','close.transition',{step:'fix',note:'Another ordinary correction, no invented severity'},s.close));
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===secondFix.recordId).data.attention,undefined);
  const ready=ok(await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Corrected'},secondFix));
  const checked=ok(await f.call('senior','close.transition',{step:'verify',note:'Physical check'},ready));
  ok(await f.call('manager','close.transition',{step:'confirm',note:'Final physical check'},checked));
});

test('flagged corrections require explicit manager acknowledgment independently of helper work and physical checks',async t=>{
  const f=await fixture(t),s=await correctionFixture(f,{managerAttention:'serious'});
  const w=ok(await f.view('manager')),r=w.records.find(r=>r.id===s.close.recordId);
  assert.equal(r.data.attention.reason,'serious');assert.equal(r.data.attention.raisedBy,'senior');assert.equal(r.data.attention.acknowledgment,undefined);
  const brief=buildShiftBrief(w,'2026-09-15T00:00:00Z').items.find(i=>i.record.id===r.id);assert.equal(brief.lane,'action');assert.equal(brief.next,'Acknowledge the closing issue');
  const notice=w.records.find(r=>r.kind==='message'&&r.data.recordId===s.close.recordId&&r.data.title.endsWith('manager acknowledgment needed'));
  ok(await f.call('manager','message.read',{},notice));assert.equal(ok(await f.view('manager')).records.find(r=>r.id===s.close.recordId).revision,s.close.revision);
  const helper=ok(await f.call('manager','close.correction.assign',{personId:'incoming',note:'Qualified helper arranged'},s.close));
  const ready=ok(await f.call('incoming','close.transition',{step:'ready',answers:[0],note:'Fictional correction complete'},helper));
  const checked=ok(await f.call('senior','close.transition',{step:'verify',note:'Physical first check'},ready));
  assert.equal((await f.call('manager','close.transition',{step:'confirm',note:'Cannot bypass acknowledgment'},checked)).status,400);
  assert.equal((await f.call('manager','shift.release',{note:'Cannot bypass close'},s.shift)).status,400);
  const acknowledged=ok(await f.call('manager','close.acknowledge',{note:'Issue understood; review the corrected result before release'},checked));
  const latest=ok(await f.view('manager')).records.find(r=>r.id===acknowledged.recordId);assert.equal(latest.data.phase,'manager-confirmation');assert.deepEqual(latest.data.answers,[0]);assert.equal(latest.ownerId,'worker');assert.equal(latest.data.correction.personId,'incoming');assert.equal(latest.data.attention.acknowledgment.by,'manager');
  assert.equal(buildShiftBrief(ok(await f.view('manager')),'2026-09-15T00:00:00Z').items.find(i=>i.record.id===latest.id).next,'Perform the final physical check');
  const final=ok(await f.call('manager','close.transition',{step:'confirm',note:'Separate final physical check'},acknowledged));
  assert.deepEqual(ok(await f.view('manager')).records.find(r=>r.id===final.recordId).data.history.slice(-2).map(h=>h.action),['manager-acknowledged','confirm']);
  ok(await f.call('manager','shift.release',{note:'All checks passed'},s.shift));
});

test('early acknowledgment preserves the open correction and a new flagged miss needs a fresh response',async t=>{
  const f=await fixture(t),s=await correctionFixture(f,{managerAttention:'repeated'});
  const ack=ok(await f.call('manager','close.acknowledge',{note:'I understand the issue; closer will correct it'},s.close));
  const r=ok(await f.view('worker')).records.find(r=>r.id===ack.recordId);assert.equal(r.data.phase,'correction');assert.deepEqual(r.data.answers,[]);
  assert.equal(buildShiftBrief(ok(await f.view('worker')),'2026-09-15T00:00:00Z').items.find(i=>i.record.id===r.id).next,'Correct and request another check');
  assert.equal((await f.call('manager','close.transition',{step:'confirm',note:'Awareness is not completion'},ack)).status,403);
  assert.equal((await f.call('manager','close.acknowledge',{note:'Cannot acknowledge twice'},ack)).status,400);
  const ready=ok(await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Ready again'},ack));
  const fix=ok(await f.call('senior','close.transition',{step:'fix',note:'Fictional issue remains unresolved',managerAttention:'unresolved'},ready));
  const next=ok(await f.view('manager')).records.find(r=>r.id===fix.recordId);assert.equal(next.data.attention.reason,'unresolved');assert.equal(next.data.attention.acknowledgment,undefined);assert.ok(next.data.history.some(h=>h.action==='manager-acknowledged'));
  assert.equal((await f.call('manager','close.acknowledge',{note:'Older screen'},ready)).status,409);
  ok(await f.call('manager','close.acknowledge',{note:'New issue reviewed'},fix));
});

test('acknowledgment enforces the named active manager and checked flag values',async t=>{
  const f=await fixture(t),s=await correctionFixture(f,{managerAttention:'serious'});
  for(const actor of ['worker','senior','drafter','opener'])assert.equal((await f.call(actor,'close.acknowledge',{note:'Wrong responsible person'},s.close)).status,403);
  assert.equal((await f.call('admin','close.acknowledge',{note:'Account setup authority does not expose closing work'},s.close)).status,404);
  assert.equal((await f.call('incoming','close.acknowledge',{note:'No access'},s.close)).status,404);
  assert.equal((await f.call('dish','close.acknowledge',{note:'Dish scope'},s.close)).status,404);
  assert.equal((await f.call('outsider','close.acknowledge',{note:'Other restaurant'},s.close,{locationId:'b'})).status,404);
  assert.equal((await f.call('manager','close.acknowledge',{note:''},s.close)).status,400);
  for(const managerAttention of ['automatic-discipline','',true,{reason:'serious'}])assert.equal((await f.call('senior','close.transition',{step:'fix',note:'Invalid flag',managerAttention},s.close)).status,400);
  assert.equal((await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Flag outside correction',managerAttention:'serious'},s.close)).status,400);
  await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind('["tasks.manage"]','manager').run();
  assert.equal((await f.call('manager','close.acknowledge',{note:'No confirmation authority'},s.close)).status,403);
  await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind('["tasks.manage","close.confirm"]','manager').run();
  const leader=ok(await f.view('manager')).records.find(r=>r.kind==='leadership'&&r.ownerId==='manager');
  await f.db.prepare('UPDATE records SET data=? WHERE id=?').bind(JSON.stringify({...leader.data,active:false}),leader.id).run();
  assert.equal((await f.call('manager','close.acknowledge',{note:'No dated leadership'},s.close)).status,403);
  await f.db.prepare('UPDATE memberships SET active=0 WHERE id=?').bind('manager').run();
  assert.equal((await f.call('manager','close.acknowledge',{note:'Inactive manager'},s.close)).status,403);
});

test('pending manager attention survives routine FIX, helper changes, reassignment and coverage without a cancellation bypass',async t=>{
  const f=await fixture(t),s=await correctionFixture(f,{managerAttention:'unresolved'});
  const help=ok(await f.call('manager','close.correction.assign',{personId:'incoming',note:'Help arranged'},s.close));
  const fix=ok(await f.call('senior','close.transition',{step:'fix',note:'Routine detail does not clear the pending escalation'},help));
  assert.equal((await f.call('manager','close.cancel',{note:'Cannot erase pending flag'},fix)).status,400);
  const assigned=ok(await f.call('manager','close.assign',{shiftId:s.shift.recordId,standardId:s.standard.recordId,managerId:'manager',verifierId:'senior',due:period.end,note:'Review same closing duty'},fix));
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===assigned.recordId).data.attention.reason,'unresolved');
  ok(await f.call('manager','shift.save',{personId:'incoming',position:'Fry',...period,note:'Replacement takes the full shift'},s.shift));
  const r=ok(await f.view('manager')).records.find(r=>r.id===assigned.recordId);assert.equal(r.ownerId,'incoming');assert.equal(r.data.attention.reason,'unresolved');assert.equal(r.data.attention.acknowledgment,undefined);
  const ack=ok(await f.call('manager','close.acknowledge',{note:'Reviewed the issue before cancelling the unnecessary duty'},r));
  const cancelled=ok(await f.call('manager','close.cancel',{note:'Fictional duty removed after review'},ack));
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===cancelled.recordId).data.attention.acknowledgment.by,'manager');
});

test('changing the closing manager requires the new manager response and cannot revive an older acknowledgment',async t=>{
  const f=await fixture(t),s=await correctionFixture(f,{managerAttention:'serious'});
  ok(await f.call('manager','leadership.assign',{personId:'opener',area:'BOH',...period,note:'Reviewed replacement leadership'}));
  const ack=ok(await f.call('manager','close.acknowledge',{note:'Original manager acknowledged'},s.close));
  const input={shiftId:s.shift.recordId,standardId:s.standard.recordId,managerId:'opener',verifierId:'senior',due:period.end,note:'New closing manager takes over'};
  const reassigned=ok(await f.call('manager','close.assign',input,ack));
  let r=ok(await f.view('opener')).records.find(r=>r.id===reassigned.recordId);assert.equal(r.data.attention.acknowledgment,undefined);assert.ok(r.data.history.some(h=>h.action==='manager-acknowledged'));
  assert.equal(buildShiftBrief(ok(await f.view('opener')),'2026-09-15T00:00:00Z').items.find(i=>i.record.id===r.id).next,'Acknowledge the closing issue');
  assert.equal((await f.call('manager','close.acknowledge',{note:'Former manager cannot act'},reassigned)).status,403);
  const second=ok(await f.call('opener','close.acknowledge',{note:'Replacement manager independently reviewed it'},reassigned));
  const returned=ok(await f.call('manager','close.assign',{...input,managerId:'manager',note:'Original manager resumes'},second));
  r=ok(await f.view('manager')).records.find(r=>r.id===returned.recordId);assert.equal(r.data.attention.acknowledgment,undefined);assert.equal(r.data.history.filter(h=>h.action==='manager-acknowledged').length,2);
});

test('acknowledgment can record awareness of a retired guide without approving work under it',async t=>{
  const f=await fixture(t),s=await correctionFixture(f,{managerAttention:'serious'});
  ok(await f.call('manager','standard.retire',{note:'Fictional guide requires replacement'},s.standard));
  assert.equal(buildShiftBrief(ok(await f.view('manager')),'2026-09-15T00:00:00Z').items.find(i=>i.record.id===s.close.recordId).next,'Acknowledge the closing issue');
  const ack=ok(await f.call('manager','close.acknowledge',{note:'Issue understood; replace retired instructions before continuing'},s.close));
  assert.equal((await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Retired guide stays blocked'},ack)).status,400);
  const r=ok(await f.view('manager')).records.find(r=>r.id===ack.recordId);assert.equal(r.data.phase,'correction');
  assert.equal(buildShiftBrief(ok(await f.view('manager')),'2026-09-15T00:00:00Z').items.find(i=>i.record.id===r.id).next,'Closing assignment needs manager attention');
});

test('manager acknowledgment rolls back with audit failure and identical retries record it once',async t=>{
  const f=await fixture(t),s=await correctionFixture(f,{managerAttention:'repeated'}),input={note:'Reviewed once'},options={requestId:'ack-retry'};
  const count=ok(await f.view('manager')).records.filter(r=>r.kind==='message').length;
  await f.db.prepare("CREATE TRIGGER fail_ack BEFORE INSERT ON audit_events WHEN NEW.action='close.acknowledge' BEGIN SELECT RAISE(ABORT,'fictional failure'); END").run();
  assert.equal((await f.call('manager','close.acknowledge',input,s.close,options)).status,503);
  let w=ok(await f.view('manager'));assert.equal(w.records.find(r=>r.id===s.close.recordId).data.attention.acknowledgment,undefined);assert.equal(w.records.filter(r=>r.kind==='message').length,count);
  await f.db.prepare('DROP TRIGGER fail_ack').run();const ack=ok(await f.call('manager','close.acknowledge',input,s.close,options));
  assert.deepEqual(ok(await f.call('manager','close.acknowledge',input,s.close,options)),ack);
  w=ok(await f.view('worker'));assert.equal(w.records.find(r=>r.id===ack.recordId).data.history.filter(h=>h.action==='manager-acknowledged').length,1);assert.equal(w.records.filter(r=>r.kind==='message'&&r.data.title.endsWith('manager acknowledged')).length,1);
  assert.equal((await f.call('manager','close.acknowledge',{note:'Changed intent'},s.close,options)).status,409);
});

test('correction helper preserves the original owner and must pass both independent physical checks',async t=>{
  const f=await fixture(t),s=await correctionFixture(f);
  const help=ok(await f.call('manager','close.correction.assign',{personId:'incoming',note:'Fictional qualified helper arranged'},s.close));
  const helper=ok(await f.view('incoming')),r=helper.records.find(r=>r.id===s.close.recordId);assert.equal(r.ownerId,'worker');assert.equal(r.data.shiftId,s.shift.recordId);assert.equal(r.data.phase,'correction');assert.deepEqual(r.data.answers,[]);assert.equal(r.data.correction.personId,'incoming');
  assert.equal(helper.records.some(r=>r.id===s.shift.recordId),false);
  const helperBrief=buildShiftBrief(helper,'2026-09-15T00:00:00Z').items.find(i=>i.record.id===r.id);assert.equal(helperBrief.lane,'action');
  const ownerBrief=buildShiftBrief(ok(await f.view('worker')),'2026-09-15T00:00:00Z').items.find(i=>i.record.id===r.id);assert.equal(ownerBrief.lane,'waiting');assert.match(ownerBrief.next,/incoming/);
  assert.equal((await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Other person was assigned'},help)).status,403);
  assert.equal((await f.call('incoming','close.transition',{step:'ready',answers:[],note:'Missing condition'},help)).status,400);
  const question=ok(await f.call('incoming','message.send',{recipients:['manager'],title:'Helper question',body:'Fictional question',context:{recordId:r.id,revision:r.revision}}));
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===question.recordId).data.context.assignment.helperId,'incoming');
  const ready=ok(await f.call('incoming','close.transition',{step:'ready',answers:[0],note:'Fictional kit corrected by helper'},help));
  assert.equal((await f.call('incoming','close.transition',{step:'verify',note:'Cannot check own correction'},ready)).status,403);
  assert.equal((await f.call('manager','shift.release',{note:'Not finished'},s.shift)).status,400);
  const verified=ok(await f.call('senior','close.transition',{step:'verify',note:'Independent physical first check'},ready));
  const closed=ok(await f.call('manager','close.transition',{step:'confirm',note:'Independent manager physical check'},verified));
  const final=ok(await f.view('manager')).records.find(r=>r.id===closed.recordId);assert.equal(final.ownerId,'worker');assert.equal(final.data.phase,'closed');assert.equal(final.data.correction.personId,'incoming');assert.ok(final.data.history.some(h=>h.action==='ready'&&h.actorId==='incoming'));
  ok(await f.call('manager','shift.release',{note:'All required checks passed'},s.shift));
});

test('correction assignments enforce named manager authority, active station clearance and independent checkers',async t=>{
  const f=await fixture(t),s=await correctionFixture(f),input={personId:'incoming',note:'Fixture help'};
  for(const actor of ['worker','senior','drafter','opener'])assert.equal((await f.call(actor,'close.correction.assign',input,s.close)).status,403);
  await f.db.prepare('UPDATE memberships SET qualifications=? WHERE id IN (?,?)').bind('["Fry"]','manager','senior').run();
  for(const personId of ['manager','senior','dish','foh','outsider'])assert.equal((await f.call('manager','close.correction.assign',{...input,personId},s.close)).status,400);
  await f.db.prepare('UPDATE memberships SET qualifications=? WHERE id=?').bind('[]','incoming').run();assert.equal((await f.call('manager','close.correction.assign',input,s.close)).status,400);
  await f.db.prepare('UPDATE memberships SET qualifications=?,active=0 WHERE id=?').bind('["Fry"]','incoming').run();assert.equal((await f.call('manager','close.correction.assign',input,s.close)).status,400);
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===s.close.recordId).revision,s.close.revision);
});

test('a fresh FIX returns work to the original closer and ends the earlier helper assignment',async t=>{
  const f=await fixture(t),s=await correctionFixture(f);
  const help=ok(await f.call('manager','close.correction.assign',{personId:'incoming',note:'Help arranged'},s.close));
  const ready=ok(await f.call('incoming','close.transition',{step:'ready',answers:[0],note:'Helper prepared it'},help));
  assert.equal((await f.call('manager','close.correction.assign',{personId:'worker',note:'Cannot change ready work'},ready)).status,400);
  const fix=ok(await f.call('senior','close.transition',{step:'fix',note:'One fictional detail still needs correction'},ready));
  const owner=ok(await f.view('worker')),r=owner.records.find(r=>r.id===fix.recordId);assert.equal(r.data.correction,undefined);assert.equal(r.data.phase,'correction');assert.deepEqual(r.data.answers,[]);
  assert.equal(ok(await f.view('incoming')).records.some(r=>r.id===fix.recordId),false);
  assert.equal((await f.call('incoming','close.transition',{step:'ready',answers:[0],note:'Old helper cannot act'},fix)).status,404);
  assert.ok(ok(await f.view('incoming')).records.some(r=>r.kind==='message'&&r.data.body.includes('previous helper assignment has ended')));
  ok(await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Original closer corrected it'},fix));
});

test('coverage transfers clear correction help and preserve its historical attribution',async t=>{
  const f=await fixture(t),s=await correctionFixture(f);
  const help=ok(await f.call('manager','close.correction.assign',{personId:'incoming',note:'Fictional help'},s.close));
  ok(await f.call('manager','shift.save',{personId:'incoming',position:'Fry',...period,note:'Reviewed replacement now owns the whole shift'},s.shift));
  const r=ok(await f.view('incoming')).records.find(r=>r.id===help.recordId);assert.equal(r.ownerId,'incoming');assert.equal(r.data.phase,'open');assert.equal(r.data.correction,undefined);assert.deepEqual(r.data.answers,[]);assert.ok(r.data.history.some(h=>h.action==='correction-assigned'));assert.ok(r.data.history.some(h=>h.action==='coverage-transferred'));
});

test('unavailable correction helpers become manager follow-up and assignment saves roll back atomically',async t=>{
  const f=await fixture(t),s=await correctionFixture(f),input={personId:'incoming',note:'Qualified helper'},options={requestId:'helper-retry'};
  await f.db.prepare("CREATE TRIGGER fail_helper BEFORE INSERT ON audit_events WHEN NEW.action='close.correction.assign' BEGIN SELECT RAISE(ABORT,'fixture help failure'); END").run();
  const count=ok(await f.view('manager')).records.filter(r=>r.kind==='message').length;
  assert.equal((await f.call('manager','close.correction.assign',input,s.close,options)).status,503);
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===s.close.recordId).data.correction,undefined);assert.equal(ok(await f.view('manager')).records.filter(r=>r.kind==='message').length,count);
  await f.db.prepare('DROP TRIGGER fail_helper').run();const help=ok(await f.call('manager','close.correction.assign',input,s.close,options));assert.deepEqual(ok(await f.call('manager','close.correction.assign',input,s.close,options)),help);
  await f.db.prepare('UPDATE memberships SET active=0 WHERE id=?').bind('incoming').run();
  const w=ok(await f.view('manager')),item=buildShiftBrief(w,'2026-09-15T00:00:00Z').items.find(i=>i.record.id===help.recordId);assert.equal(item.lane,'action');assert.equal(item.next,'Review the correction assignment');
  ok(await f.call('manager','close.correction.assign',{personId:'worker',note:'Return correction to the active original closer'},help));
});

test('retired standards stop helper work and a reviewed replacement assignment clears the helper',async t=>{
  const f=await fixture(t),s=await correctionFixture(f);
  const help=ok(await f.call('manager','close.correction.assign',{personId:'incoming',note:'Fictional qualified help'},s.close));
  const retired=ok(await f.call('manager','standard.retire',{note:'Fictional guide needs replacement'},s.standard));
  assert.equal((await f.call('incoming','close.transition',{step:'ready',answers:[0],note:'Retired guide must not advance'},help)).status,400);
  assert.equal((await f.call('manager','close.correction.assign',{personId:'worker',note:'Retired guide must be reassigned first'},help)).status,400);
  const draft=ok(await f.call('manager','standard.save',{...guidedStandard,verification:'senior-then-manager',version:2,basedOnId:retired.recordId,basedOnRevision:retired.revision}));
  const standard=ok(await f.call('manager','standard.approve',{validated:true,note:'Replacement fixture reviewed'},draft));
  const assigned=ok(await f.call('manager','close.assign',{shiftId:s.shift.recordId,standardId:standard.recordId,managerId:'manager',verifierId:'senior',due:period.end,note:'Reviewed replacement assignment'},help));
  const r=ok(await f.view('worker')).records.find(r=>r.id===assigned.recordId);assert.equal(r.ownerId,'worker');assert.equal(r.data.phase,'open');assert.equal(r.data.correction,undefined);assert.equal(r.data.standard.version,2);assert.ok(r.data.history.some(h=>h.action==='correction-assigned'));
  assert.equal(ok(await f.view('incoming')).records.some(r=>r.id===assigned.recordId),false);
  assert.equal((await f.call('incoming','close.transition',{step:'ready',answers:[0],note:'Former helper cannot advance new assignment'},assigned)).status,404);
});

test('help messages capture exact approved instructions and preserve them through replies and later versions',async t=>{
  const f=await fixture(t),draft=ok(await f.call('manager','standard.save',guidedStandard));
  const standard=ok(await f.call('manager','standard.approve',{validated:true,note:'Fictional guide approved'},draft));
  const input={recipients:['manager'],title:'Which practice label?',body:'Please clarify the first step.',context:{recordId:standard.recordId,revision:standard.revision}};
  const sent=ok(await f.call('worker','message.send',input));
  let message=ok(await f.view('manager')).records.find(r=>r.id===sent.recordId);const snapshot=structuredClone(message.data.context);
  assert.deepEqual(snapshot.instruction.guide,trainingGuide);assert.equal(snapshot.instruction.version,1);assert.equal(snapshot.instruction.source,guidedStandard.source);assert.equal(message.data.contextStatus,'current');assert.equal(snapshot.standardRevision,standard.revision);
  assert.equal('history' in snapshot.instruction,false);assert.equal('provenance' in snapshot.instruction,false);
  ok(await f.call('manager','message.reply',{text:'Use the sample label shown in that practice kit.'},message));
  message=ok(await f.view('worker')).records.find(r=>r.id===sent.recordId);assert.deepEqual(message.data.context,snapshot);assert.equal(message.data.replies.length,1);
  assert.equal(ok(await f.view('incoming')).records.some(r=>r.id===sent.recordId),false);
  const next=ok(await f.call('manager','standard.save',{...guidedStandard,version:2,basedOnId:standard.recordId,basedOnRevision:standard.revision,guide:{...trainingGuide,steps:['Different reviewed instruction.']}}));
  ok(await f.call('manager','standard.approve',{validated:true,note:'Next fictional source version reviewed'},next));
  message=ok(await f.view('manager')).records.find(r=>r.id===sent.recordId);assert.deepEqual(message.data.context,snapshot);assert.equal(message.data.contextStatus,'changed');
  const former=ok(await f.view('worker')).records.find(r=>r.id===sent.recordId);assert.equal(former.data.context,undefined);assert.equal(former.data.contextStatus,'unavailable');assert.equal(former.data.body,input.body);assert.equal(former.data.replies.length,1);
});

test('help attachments reject stale, private, forged, cross-restaurant and Dish source sharing',async t=>{
  const f=await fixture(t),draft=ok(await f.call('manager','standard.save',guidedStandard));
  const send=(context,recipients=['manager'],actor='worker')=>f.call(actor,'message.send',{recipients,title:'Fictional question',body:'Need guidance.',context});
  assert.equal((await send({recordId:draft.recordId,revision:draft.revision})).status,404);
  const approved=ok(await f.call('manager','standard.approve',{validated:true,note:'Reviewed'},draft)),context={recordId:approved.recordId,revision:approved.revision};
  assert.equal((await send({...context,revision:1})).status,409);
  assert.equal((await send({...context,instruction:{source:'Forged source'}})).status,400);
  assert.equal((await send(context,['dish'])).status,403);assert.equal((await send(context,['manager'],'dish')).status,404);
  assert.equal((await send(context,['outsider'])).status,400);
  assert.equal((await send(context,['manager'],'outsider')).status,403);
  const note=ok(await f.call('worker','feedback.save',{text:'Private concern',shared:false}));
  assert.equal((await send({recordId:note.recordId,revision:note.revision})).status,404);
  ok(await f.call('worker','message.send',{recipients:['dish'],title:'Ordinary message',body:'Schedule question without operating attachment.'}));
  assert.equal(ok(await f.view('manager')).records.filter(r=>r.kind==='message').length,0);
});

test('assignment help cannot grant access and rechecks recipients when responsibility changes',async t=>{
  const f=await fixture(t);ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...period,note:'Fictional lead'}));
  const draft=ok(await f.call('manager','standard.save',guidedStandard)),standard=ok(await f.call('manager','standard.approve',{validated:true,note:'Reviewed'},draft));
  let shift=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  const close=ok(await f.call('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',due:period.end}));
  shift=ok(await f.call('manager','shift.publish',{},shift));
  const input={title:'Help with my close',body:'Which step comes first?',context:{recordId:close.recordId,revision:close.revision}};
  const before=ok(await f.view('manager')).records.filter(r=>r.kind==='message').length;
  assert.equal((await f.call('worker','message.send',{...input,recipients:['manager','incoming']})).status,403);
  assert.equal(ok(await f.view('manager')).records.filter(r=>r.kind==='message').length,before);
  const sent=ok(await f.call('worker','message.send',{...input,recipients:['manager']}));
  const message=ok(await f.view('manager')).records.find(r=>r.id===sent.recordId);assert.equal(message.data.context.assignment.ownerId,'worker');assert.equal(message.data.context.assignment.phase,'open');
  assert.equal(ok(await f.view('incoming')).records.some(r=>r.id===sent.recordId),false);
  // Changing the recipient's department removes work access without deleting the conversation.
  await f.db.prepare('UPDATE memberships SET area=? WHERE id=?').bind('FOH','manager').run();
  // The named manager still has assigned access; removing that assignment must revoke the attachment.
  const stored=await f.db.prepare('SELECT data FROM records WHERE id=?').bind(close.recordId).first();const changed=JSON.parse(stored.data);changed.managerId='opener';
  await f.db.prepare('UPDATE records SET data=?, revision=revision+1 WHERE id=?').bind(JSON.stringify(changed),close.recordId).run();
  const redacted=ok(await f.view('manager')).records.find(r=>r.id===sent.recordId);assert.equal(redacted.data.context,undefined);assert.equal(redacted.data.contextStatus,'unavailable');assert.equal(redacted.data.body,input.body);
  const raw=await f.db.prepare('SELECT data FROM records WHERE id=?').bind(sent.recordId).first();assert.deepEqual(JSON.parse(raw.data).context,message.data.context);
});

test('guide questions include approved local clarifications without recovered draft evidence',async t=>{
  const f=await fixture(t);await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind(JSON.stringify(['tasks.manage','standards.approve']),'foh').run();
  const imported=ok(await f.call('foh','standard.import',{sourceId:'berts-foh-bathrooms',sourceRevision:1}));
  const r=ok(await f.view('foh')).records.find(x=>x.id===imported.recordId),{provenance,...draft}=r.data;
  const answers=Object.fromEntries(provenance.questions.map(q=>[q.id,'Fictional local clarification.']));
  const saved=ok(await f.call('foh','standard.save',{...draft,sourceAnswers:answers},r));
  const approved=ok(await f.call('foh','standard.approve',{validated:true,note:'Fictional reviewed guide'},saved));
  const sent=ok(await f.call('worker','message.send',{recipients:['foh'],title:'Clarification',body:'Explain the local method.',context:{recordId:approved.recordId,revision:approved.revision}}));
  const c=ok(await f.view('foh')).records.find(x=>x.id===sent.recordId).data.context;
  assert.deepEqual(c.clarifications,provenance.questions.map(q=>({question:q.prompt,answer:answers[q.id]})));assert.equal(JSON.stringify(c).includes(provenance.references[0].excerpt),false);
});

test('replies return as unread to the question author and other participants without expanding the audience',async t=>{
  const f=await fixture(t),sent=ok(await f.call('worker','message.send',{recipients:['manager','incoming'],title:'Fixture question',body:'Which sample label?'}));
  const unread=async actor=>buildShiftBrief(ok(await f.view(actor)),new Date().toISOString()).unread.map(r=>r.id);
  assert.deepEqual(await unread('worker'),[]);assert.ok((await unread('manager')).includes(sent.recordId));
  const read=ok(await f.call('manager','message.read',{},sent));const both=ok(await f.call('incoming','message.read',{},read));
  const answer=ok(await f.call('manager','message.reply',{text:'Use the amber sample label.'},both));
  assert.ok((await unread('worker')).includes(sent.recordId));assert.ok((await unread('incoming')).includes(sent.recordId));assert.deepEqual(await unread('manager'),[]);
  assert.equal(ok(await f.view('foh')).records.some(r=>r.id===sent.recordId),false);
  assert.equal((await f.call('worker','message.read',{},both)).status,409);
  const acknowledged=ok(await f.call('worker','message.read',{},answer));assert.deepEqual(await unread('worker'),[]);
  ok(await f.call('incoming','message.reply',{text:'I have the same sample label.'},acknowledged));assert.ok((await unread('worker')).includes(sent.recordId));assert.ok((await unread('manager')).includes(sent.recordId));assert.deepEqual(await unread('incoming'),[]);
});

test('help attachment saves atomically and uncertain retries never send twice',async t=>{
  const f=await fixture(t),draft=ok(await f.call('manager','standard.save',guidedStandard)),standard=ok(await f.call('manager','standard.approve',{validated:true,note:'Reviewed'},draft));
  const input={recipients:['manager'],title:'Help',body:'Please explain.',context:{recordId:standard.recordId,revision:standard.revision}},options={requestId:'context-retry'};
  await f.db.prepare("CREATE TRIGGER fail_help BEFORE INSERT ON audit_events WHEN NEW.action='message.send' BEGIN SELECT RAISE(ABORT,'fixture help failure'); END").run();
  assert.equal((await f.call('worker','message.send',input,undefined,options)).status,503);assert.equal(ok(await f.view('manager')).records.filter(r=>r.kind==='message').length,0);
  await f.db.prepare('DROP TRIGGER fail_help').run();
  const sent=ok(await f.call('worker','message.send',input,undefined,options));assert.deepEqual(ok(await f.call('worker','message.send',input,undefined,options)),sent);
  assert.equal(ok(await f.view('manager')).records.filter(r=>r.kind==='message').length,1);
});

test('recovered source excerpts match the retained document and the corrected FOH chains',()=>{
  const bytes=fs.readFileSync('source-material/berts-foh-close-2026-08-28.md'),source=bytes.toString('utf8');
  assert.equal(recoveredStandards.length,7);
  for(const draft of recoveredStandards){for(const reference of draft.references){assert.equal(reference.sha256,createHash('sha256').update(bytes).digest('hex').toUpperCase());assert.ok(source.includes(reference.excerpt),draft.id);}assert.ok(draft.questions.some(q=>q.id==='restaurant'));assert.ok(draft.guide.steps.length);}
  for(const id of ['bathrooms','server-station'])assert.equal(recoveredStandards.find(s=>s.id===`berts-foh-${id}`).verification,'senior-then-manager');
  for(const id of ['salad-bar','back-window','host-entry','first-out'])assert.equal(recoveredStandards.find(s=>s.id===`berts-foh-${id}`).verification,'manager');
});

test('recovered import is authorized, scoped, draft-only and safe to retry without duplicates',async t=>{
  const f=await fixture(t),input={sourceId:'berts-foh-bathrooms',sourceRevision:1};
  assert.equal(ok(await f.view('foh')).recoveredStandards.length,7);
  for(const actor of ['worker','dish','manager']){assert.deepEqual(ok(await f.view(actor)).recoveredStandards,[]);assert.equal((await f.call(actor,'standard.import',input)).status,403);}
  assert.equal((await f.call('outsider','standard.import',input)).status,403);
  assert.equal((await f.call('foh','standard.import',{...input,sourceRevision:0})).status,409);
  const forged={...input,status:'approved',guide:trainingGuide,provenance:{questions:[]}};
  const saved=ok(await f.call('foh','standard.import',forged,undefined,{requestId:'source-import-retry'}));
  assert.deepEqual(ok(await f.call('foh','standard.import',forged,undefined,{requestId:'source-import-retry'})),saved);
  assert.equal((await f.call('foh','standard.import',input)).status,409);
  const r=ok(await f.view('foh')).records.find(r=>r.id===saved.recordId);
  assert.equal(r.area,'FOH');assert.equal(r.locationId,'a');assert.equal(r.data.status,'draft');assert.deepEqual(r.data.provenance.answers,{});
  assert.equal(r.data.provenance.importedBy,'foh');assert.equal(r.data.provenance.restaurant,'Bert’s');
  assert.equal(ok(await f.view('worker')).records.some(x=>x.id===saved.recordId),false);
  assert.deepEqual(r.data.guide,recoveredStandards.find(s=>s.id===input.sourceId).guide);
  assert.deepEqual(approvedStationGuides(ok(await f.view('foh'))),[]);
  assert.equal((await f.call('foh','standard.approve',{validated:true,note:'Drafting does not grant approval'},saved)).status,403);
});

test('source questions survive editing, block premature approval and reset for the next version',async t=>{
  const f=await fixture(t);
  await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind(JSON.stringify(['tasks.manage','standards.approve']),'foh').run();
  await f.db.prepare('UPDATE memberships SET area=?,position=? WHERE id=?').bind('FOH','Server','incoming').run();
  const first=ok(await f.call('foh','standard.import',{sourceId:'berts-foh-bathrooms',sourceRevision:1}));
  let r=ok(await f.view('foh')).records.find(r=>r.id===first.recordId);const original=structuredClone(r.data.provenance);
  assert.equal(ok(await f.view('incoming')).records.some(x=>x.id===r.id),false);
  assert.equal((await f.call('foh','standard.approve',{validated:true,note:'Only clicked the checkbox'},r)).status,400);
  const {provenance,...draft}=r.data;
  assert.equal((await f.call('foh','standard.save',{...draft,provenance:{...provenance,questions:[]}},r)).status,400);
  assert.equal((await f.call('foh','standard.save',{...draft,sourceAnswers:{unknown:'Pretend question'}},r)).status,400);
  assert.equal((await f.call('foh','standard.save',{...draft,sourceAnswers:{restaurant:'x'.repeat(2001)}},r)).status,400);
  ok(await f.call('foh','standard.save',{...draft,sourceAnswers:{restaurant:'Fictional restaurant review; not real operating approval.'}},r));
  r=ok(await f.view('foh')).records.find(x=>x.id===r.id);
  assert.equal((await f.call('foh','standard.approve',{validated:true,note:'One answer only'},r)).status,400);
  const answers=Object.fromEntries(provenance.questions.map(q=>[q.id,`Fictional reviewed clarification for ${q.id}.`]));
  ok(await f.call('foh','standard.save',{...draft,sourceAnswers:answers,guide:{...trainingGuide,steps:['Fictional adapted instructions.']}},r));
  r=ok(await f.view('foh')).records.find(x=>x.id===r.id);
  assert.deepEqual({...r.data.provenance,answers:{}},original);
  ok(await f.call('foh','standard.approve',{validated:true,note:'Fictional complete review'},r));
  r=ok(await f.view('foh')).records.find(x=>x.id===r.id);
  const employee=ok(await f.view('incoming')),approved=approvedStationGuides(employee)[0];assert.equal(approved.id,r.id);assert.deepEqual(approved.data.provenance.answers,answers);assert.deepEqual(employee.recoveredStandards,[]);
  const next=ok(await f.call('foh','standard.save',{...draft,version:2,basedOnId:r.id,basedOnRevision:r.revision}));
  const pending=ok(await f.view('foh')).records.find(x=>x.id===next.recordId);
  assert.deepEqual(pending.data.provenance.answers,{});assert.deepEqual(pending.data.provenance.references,original.references);
  assert.equal((await f.call('foh','standard.approve',{validated:true,note:'Old answers must not carry approval'},pending)).status,400);
});

test('source import and audit commit together; a failed import can retry exactly once',async t=>{
  const f=await fixture(t),input={sourceId:'berts-foh-host-entry',sourceRevision:1},options={requestId:'failed-source-import'};
  await f.db.prepare("CREATE TRIGGER fail_source_import BEFORE INSERT ON audit_events WHEN NEW.action='standard.import' BEGIN SELECT RAISE(ABORT,'fixture import failure'); END").run();
  assert.equal((await f.call('foh','standard.import',input,undefined,options)).status,503);
  assert.equal(ok(await f.view('foh')).records.filter(r=>r.kind==='standard').length,0);
  await f.db.prepare('DROP TRIGGER fail_source_import').run();
  const saved=ok(await f.call('foh','standard.import',input,undefined,options));
  assert.deepEqual(ok(await f.call('foh','standard.import',input,undefined,options)),saved);
  assert.equal(ok(await f.view('foh')).records.filter(r=>r.kind==='standard').length,1);
  const audit=await f.db.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE action='standard.import'").first();assert.equal(audit.total,1);
});

test('station instructions require approved source review; drafts stay hidden and learning grants no clearance',async t=>{
  const f=await fixture(t),saved=ok(await f.call('drafter','standard.save',guidedStandard));
  assert.equal(ok(await f.view('worker')).records.some(r=>r.id===saved.recordId),false);
  const draft=ok(await f.view('manager')).records.find(r=>r.id===saved.recordId);assert.deepEqual(draft.data.guide,trainingGuide);
  assert.deepEqual(approvedStationGuides(ok(await f.view('manager'))),[]);
  assert.equal((await f.call('worker','standard.approve',{validated:true,note:'Not authorized'},saved)).status,404);
  assert.equal((await f.call('manager','standard.approve',{validated:false,note:'Not reviewed'},saved)).status,400);
  const approved=ok(await f.call('manager','standard.approve',{validated:true,note:'All fixture instructions and source reviewed'},saved));
  const worker=ok(await f.view('worker'));assert.deepEqual(approvedStationGuides(worker).map(r=>r.id),[saved.recordId]);assert.deepEqual(worker.me.qualifications,['Fry']);
  assert.deepEqual(approvedStationGuides(ok(await f.view('foh'))),[]);assert.deepEqual(approvedStationGuides(ok(await f.view('dish'))),[]);
  assert.equal((await f.view('outsider')).status,403);
  assert.equal((await f.call('manager','standard.save',{...guidedStandard,guide:{...trainingGuide,steps:['Silently rewrite approved work']}},approved)).status,400);
  assert.equal((await f.call('manager','standard.save',{...guidedStandard,basedOnId:approved.recordId,basedOnRevision:approved.revision-1,version:2})).status,409);
});

test('a reviewed new guide version retires old teaching material without rewriting assigned evidence',async t=>{
  const f=await fixture(t);
  ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...period,note:'Fixture closing leader'}));
  const draft=ok(await f.call('manager','standard.save',guidedStandard));
  const approved=ok(await f.call('manager','standard.approve',{validated:true,note:'Version one checked'},draft));
  let shift=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  const close=ok(await f.call('manager','close.assign',{shiftId:shift.recordId,standardId:approved.recordId,managerId:'manager',due:period.end}));
  shift=ok(await f.call('manager','shift.publish',{},shift));
  let w=ok(await f.view('worker')),assignment=w.records.find(r=>r.id===close.recordId);assert.equal(assignedStandardCurrent(w,assignment),true);assert.deepEqual(assignment.data.standard.guide,trainingGuide);
  const input={...guidedStandard,version:2,basedOnId:approved.recordId,basedOnRevision:approved.revision,guide:{...trainingGuide,steps:['Use the revised fictional practice layout.']}};
  assert.equal((await f.call('manager','standard.save',{...input,zone:'Another station'})).status,400);
  const next=ok(await f.call('manager','standard.save',input));
  const nextDraft=ok(await f.view('manager')).records.find(r=>r.id===next.recordId);assert.deepEqual(nextDraft.data.supersedes,{id:approved.recordId,revision:approved.revision});
  assert.equal((await f.call('manager','standard.save',{...guidedStandard,version:2,zone:'Change the version identity'},next)).status,400);
  ok(await f.call('manager','standard.approve',{validated:true,note:'Revised source checked'},next));
  w=ok(await f.view('worker'));assignment=w.records.find(r=>r.id===close.recordId);
  assert.deepEqual(approvedStationGuides(w).map(r=>r.id),[next.recordId]);assert.equal(assignedStandardCurrent(w,assignment),false);assert.deepEqual(assignment.data.standard.guide,trainingGuide);assert.equal(assignment.revision,close.revision);
  assert.equal((await f.call('worker','close.transition',{step:'ready',answers:[0],note:'Must not follow retired material'},close)).status,400);
  ok(await f.call('manager','close.assign',{shiftId:shift.recordId,standardId:next.recordId,managerId:'manager',due:period.end,note:'Reviewed updated instructions'},close));
  w=ok(await f.view('worker'));assignment=w.records.find(r=>r.id===close.recordId);assert.equal(assignedStandardCurrent(w,assignment),true);assert.deepEqual(assignment.data.standard.guide.steps,input.guide.steps);assert.equal(assignment.data.phase,'open');
});

test('station guide validation rejects incomplete or oversized content and preserves checklist compatibility',async t=>{
  const f=await fixture(t);
  for(const guide of [{...trainingGuide,purpose:''},{...trainingGuide,steps:[]},{...trainingGuide,escalation:''},{...trainingGuide,steps:Array(31).fill('Too many')},{...trainingGuide,preparation:['x'.repeat(1001)]},{...trainingGuide,troubleshooting:'not a list'}])assert.equal((await f.call('manager','standard.save',{...guidedStandard,guide})).status,400);
  assert.equal((await f.call('manager','standard.save',{...guidedStandard,source:''})).status,400);
  const plain=ok(await f.call('manager','standard.save',{...guidedStandard,guide:{purpose:'',steps:[],preparation:[],troubleshooting:[],escalation:''}}));
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===plain.recordId).data.guide,undefined);
});

test('guide approval, retirement and audit roll back together; retries never duplicate a reviewed version',async t=>{
  const f=await fixture(t),old=ok(await f.call('manager','standard.save',guidedStandard));
  const approved=ok(await f.call('manager','standard.approve',{validated:true,note:'Initial fixture source checked'},old));
  const next=ok(await f.call('manager','standard.save',{...guidedStandard,version:2,basedOnId:approved.recordId,basedOnRevision:approved.revision}));
  await f.db.prepare("CREATE TRIGGER fail_guide_approval BEFORE INSERT ON audit_events WHEN NEW.action='standard.approve' BEGIN SELECT RAISE(ABORT,'fixture approval failure'); END").run();
  const input={validated:true,note:'Second complete guide checked'},requestId=crypto.randomUUID();
  assert.equal((await f.call('manager','standard.approve',input,next,{requestId})).status,503);
  assert.deepEqual(approvedStationGuides(ok(await f.view('worker'))).map(r=>r.id),[old.recordId]);
  await f.db.prepare('DROP TRIGGER fail_guide_approval').run();
  const result=ok(await f.call('manager','standard.approve',input,next,{requestId}));assert.deepEqual(ok(await f.call('manager','standard.approve',input,next,{requestId})),result);
  assert.deepEqual(approvedStationGuides(ok(await f.view('worker'))).map(r=>r.id),[next.recordId]);
});

test('draft authority cannot publish; changing a published shift requires its assigned leader', async t => {
  const f=await fixture(t);
  let s=ok(await f.call('drafter','shift.save',{personId:'worker',position:'Fry',...period}));
  assert.equal((await f.call('drafter','shift.publish',{},s)).status,403);
  s=ok(await f.call('manager','shift.publish',{},s));
  assert.equal((await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period,note:'No assigned responsibility'},s)).status,403);
  const grant=ok(await f.call('manager','leadership.assign',{personId:'senior',area:'BOH',...period,note:'Cover this shift'}));
  s=ok(await f.call('senior','shift.save',{personId:'worker',position:'Fry',...period,note:'Coverage checked'},s));
  assert.equal((await f.call('senior','shift.save',{personId:'worker',position:'Fry',...period,end:'2026-09-15T02:00:00-04:00',note:'Outside my responsibility'},s)).status,403);
  ok(await f.call('manager','leadership.revoke',{note:'Replacement leader required'},grant));
  assert.equal((await f.call('senior','shift.cancel',{note:'No longer assigned'},s)).status,403);
});

test('approved recurring availability enforces school travel, term exceptions, midnight and both DST hours', async t => {
  const f=await fixture(t), school={title:'School term',kind:'school',startDate:'2026-09-01',endDate:'2026-12-20',days:[1,2,3,4,5],startMinute:480,endMinute:900,afterMinutes:30,excludedDates:['2026-09-21']};
  let a=ok(await f.call('worker','availability.save',school));
  assert.equal((await f.call('worker','availability.review',{approve:true,note:'Self approval'},a)).status,403);
  a=ok(await f.call('manager','availability.review',{approve:true,note:'Term checked'},a));
  assert.equal((await f.call('manager','shift.save',{personId:'worker',position:'Fry',start:'2026-09-14T15:00:00-04:00',end:period.start})).status,400);
  ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',start:'2026-09-14T15:30:00-04:00',end:period.start}));
  assert.equal((await f.call('manager','shift.save',{personId:'worker',position:'Fry',start:'2026-09-13T23:00:00-04:00',end:'2026-09-14T09:00:00-04:00'})).status,400);
  ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',start:'2026-09-21T08:00:00-04:00',end:'2026-09-21T12:00:00-04:00'}));
  const replacement=ok(await f.call('worker','availability.save',{...school,title:'Updated term',endDate:'2026-10-01',replacesId:a.recordId}));
  ok(await f.call('manager','availability.review',{approve:true,note:'New term confirmed'},replacement));
  assert.equal(ok(await f.view('worker')).records.find(r=>r.id===a.recordId).data.status,'superseded');
  const dst=ok(await f.call('incoming','availability.save',{title:'Sunday restriction',kind:'unavailable',startDate:'2026-11-01',endDate:'2026-11-01',days:[0],startMinute:90,endMinute:120}));
  ok(await f.call('manager','availability.review',{approve:true,note:'Confirmed'},dst));
  for(const offset of ['-04:00','-05:00']) assert.equal((await f.call('manager','shift.save',{personId:'incoming',position:'Fry',start:`2026-11-01T01:45:00${offset}`,end:`2026-11-01T01:55:00${offset}`})).status,400);
});

async function closeFixture(f, verification='senior-then-manager') {
  ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...period,note:'Closing manager'}));
  let standard=ok(await f.call('manager','standard.save',{title:'Test closing standard',zone:'Test zone',position:'Fry',criteria:['Test surface ready','Test supplies ready'],source:'Fictional test criteria; not operating instructions',version:1,verification}));
  let shift=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  assert.equal((await f.call('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',verifierId:'senior',due:period.end})).status,400);
  standard=ok(await f.call('manager','standard.approve',{validated:true,note:'Fixture validation'},standard));
  let close=ok(await f.call('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',verifierId:'senior',due:period.end}));
  assert.equal(ok(await f.view('worker')).records.some(r=>r.kind==='close'),false);
  shift=ok(await f.call('manager','shift.publish',{},shift));
  return {standard,shift,close};
}

test('bulk draft editing cannot drop inherited closing duties when moving a shift',async t=>{
  const f=await fixture(t),{shift}=await closeFixture(f,'manager');
  await f.db.prepare("UPDATE records SET data=json_set(data,'$.published',json('false')) WHERE id=?").bind(shift.recordId).run();
  const second=ok(await f.call('manager','shift.save',{personId:'incoming',position:'Fry',start:'2026-09-15T16:00:00-04:00',end:'2026-09-15T22:00:00-04:00'}));
  const input={weekStart:'2026-09-14',confirmed:true,note:'Must preserve the existing closing deadline',drafts:[{id:second.recordId,revision:second.revision,input:{personId:'incoming',position:'Fry',start:'2026-09-16T16:00:00-04:00',end:'2026-09-16T22:00:00-04:00'}},{id:shift.recordId,revision:shift.revision,input:{personId:'worker',position:'Fry',start:'2026-09-17T16:00:00-04:00',end:'2026-09-17T22:00:00-04:00'}}]};
  const result=await f.call('manager','shift.save-batch',input);assert.equal(result.status,400);assert.match(result.data.error,/closing due time/);
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===second.recordId).revision,second.revision);
});

test('close requires all conditions, an independent first check, correction and manager confirmation before release', async t => {
  const f=await fixture(t); let {close,shift}=await closeFixture(f);
  assert.equal((await f.call('manager','shift.cancel',{note:'Must retain close ownership'},shift)).status,400);
  assert.equal((await f.call('manager','shift.release',{note:'Too early'},shift)).status,400);
  assert.equal((await f.call('worker','close.transition',{step:'ready',note:'Incomplete',answers:[0]},close)).status,400);
  close=ok(await f.call('worker','close.transition',{step:'ready',note:'Ready',answers:[0,1]},close));
  assert.equal((await f.call('manager','close.transition',{step:'confirm',note:'Skip first check'},close)).status,403);
  close=ok(await f.call('senior','close.transition',{step:'fix',note:'Finish the second condition'},close));
  assert.equal(ok(await f.view('worker')).records.find(r=>r.id===close.recordId).data.phase,'correction');
  close=ok(await f.call('worker','close.transition',{step:'ready',note:'Corrected',answers:[0,1]},close));
  close=ok(await f.call('senior','close.transition',{step:'verify',note:'Physical first pass'},close));
  assert.equal((await f.call('manager','shift.release',{note:'Still missing final check'},shift)).status,400);
  close=ok(await f.call('manager','close.transition',{step:'confirm',note:'Final physical check complete'},close));
  ok(await f.call('manager','shift.release',{note:'All assigned work passed'},shift));
  assert.equal((await f.call('manager','shift.save',{personId:'incoming',position:'Fry',...period,note:'Already released'},shift)).status,409);
});

test('approved coverage transfers closing ownership and resets ready evidence; cancellation needs a covering shift', async t => {
  const f=await fixture(t); const {close,shift}=await closeFixture(f,'manager');
  ok(await f.call('worker','close.transition',{step:'ready',note:'Ready',answers:[0,1]},close));
  let req=ok(await f.call('worker','request.create',{type:'swap',shiftId:shift.recordId,replacementId:'incoming',note:'Coverage',...period}));
  req=ok(await f.call('incoming','request.consent',{accept:true},req));
  ok(await f.call('manager','request.review',{approve:true,note:'Reviewed coverage'},req));
  const inherited=ok(await f.view('incoming')).records.find(r=>r.kind==='close');
  assert.equal(inherited.ownerId,'incoming'); assert.equal(inherited.data.phase,'open'); assert.deepEqual(inherited.data.answers,[]);
  assert.equal((await f.call('worker','close.transition',{step:'ready',note:'No longer mine',answers:[0,1]},inherited)).status,404);
  const old=ok(await f.view('manager')).records.find(r=>r.id===shift.recordId);
  let covering=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  covering=ok(await f.call('manager','shift.publish',{},covering));
  ok(await f.call('manager','shift.cancel',{note:'Reassigned coverage',closeTransfers:[{closeId:inherited.id,shiftId:covering.recordId}]},old));
  const reassigned=ok(await f.view('worker')).records.find(r=>r.kind==='close'); assert.equal(reassigned.data.shiftId,covering.recordId);
});

test('claimed access stays with the stable authenticated identity, not a later account using the same email', async t => {
  const f=await fixture(t); ok(await f.view('worker'));
  const request=(user,email)=>new Request('https://test.example/api/workspace?locationId=a',{headers:{'oai-authenticated-user-id':user,'oai-authenticated-user-email':email}});
  assert.equal((await handleWorkspace(request('different-identity','worker@example.test'),f.db)).status,403);
  assert.equal((await handleWorkspace(request('worker-identity','changed@example.test'),f.db)).status,200);
});

test('station changes cannot strand closing work and retired standards cannot publish', async t => {
  const f=await fixture(t), {shift,standard}=await closeFixture(f,'manager');
  await f.db.prepare("UPDATE memberships SET qualifications='[\"Grill\"]', revision=revision+1 WHERE id='worker'").run();
  const change=await f.call('manager','shift.save',{personId:'worker',position:'Grill',...period,note:'Moving stations'},shift);
  assert.equal(change.status,400); assert.match(change.data.error,/closing work/);
  const draft=ok(await f.call('manager','shift.save',{personId:'incoming',position:'Fry',...period}));
  ok(await f.call('manager','close.assign',{shiftId:draft.recordId,standardId:standard.recordId,managerId:'manager',due:period.end}));
  ok(await f.call('manager','standard.retire',{note:'Outdated fixture'},standard));
  const publish=await f.call('manager','shift.publish',{},draft);
  assert.equal(publish.status,400); assert.match(publish.data.error,/retired closing standards/);
  assert.equal(ok(await f.view('incoming')).records.some(r=>r.kind==='shift'),false);
});

test('a multi-shift cancellation cannot assign duplicate closing areas to one covering shift', async t => {
  const f=await fixture(t), {standard,shift,close}=await closeFixture(f,'manager');
  const extended={start:period.start,end:'2026-09-15T02:00:00-04:00'};
  ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...extended,note:'Extended coverage'}));
  let second=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',start:period.end,end:extended.end}));
  const secondClose=ok(await f.call('manager','close.assign',{shiftId:second.recordId,standardId:standard.recordId,managerId:'manager',due:extended.end}));
  second=ok(await f.call('manager','shift.publish',{},second));
  let covering=ok(await f.call('manager','shift.save',{personId:'incoming',position:'Fry',...extended}));
  covering=ok(await f.call('manager','shift.publish',{},covering));
  const request=ok(await f.call('worker','request.create',{type:'time-off',...extended,note:'Cannot work either shift'}));
  const result=await f.call('manager','request.review',{approve:true,note:'Coverage review',closeTransfers:[close,secondClose].map(c=>({closeId:c.recordId,shiftId:covering.recordId}))},request);
  assert.equal(result.status,400); assert.match(result.data.error,/already owns/);
  const records=ok(await f.view('manager')).records;
  for(const r of [shift,second]) assert.equal(records.find(x=>x.id===r.recordId).data.cancelled,false);
  assert.equal(records.find(x=>x.id===close.recordId).data.shiftId,shift.recordId);
});

test('accepted swaps notify the assigned shift reviewer rather than every schedule drafter', async t => {
  const f=await fixture(t);
  ok(await f.call('manager','leadership.assign',{personId:'senior',area:'BOH',...period,note:'Responsible shift leader'}));
  let shift=ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  shift=ok(await f.call('manager','shift.publish',{},shift));
  let request=ok(await f.call('worker','request.create',{type:'swap',shiftId:shift.recordId,replacementId:'incoming',...period,note:'Coverage'}));
  request=ok(await f.call('incoming','request.consent',{accept:true},request));
  const reviewMessage=ok(await f.view('senior')).records.find(r=>r.kind==='message'&&r.data.title==='Swap ready for manager review');
  assert.ok(reviewMessage); assert.deepEqual(reviewMessage.data.recipients,['senior']);
  assert.deepEqual(JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(reviewMessage.id).first()).data).recipients,['worker','senior']);
  assert.deepEqual(ok(await f.view('worker')).records.find(r=>r.id===reviewMessage.id).data.recipients,['worker']);
  assert.equal(ok(await f.view('drafter')).records.some(r=>r.kind==='message'),false);
  ok(await f.call('senior','request.review',{approve:true,note:'Coverage checked'},request));
});

test('local schedule times handle midnight and require an explicit repeated-hour choice', () => {
  const zone='America/New_York';
  assert.equal(localDate(localInstant('2026-09-14','23:00',zone),zone),'2026-09-14');
  assert.throws(()=>localInstant('2026-03-08','02:30',zone),/does not exist/);
  assert.throws(()=>localInstant('2026-11-01','01:30',zone),/occurs twice/);
  assert.equal(Date.parse(localInstant('2026-11-01','01:30',zone,'later'))-Date.parse(localInstant('2026-11-01','01:30',zone,'earlier')),3600000);
});

test('identity, restaurant, department, private messages and private notes are enforced by server', async t => {
  const f = await fixture(t);
  assert.equal((await f.view(null)).status,401);
  assert.equal((await f.view('unknown')).status,403);
  assert.equal((await f.view('outsider')).status,403);
  assert.equal((await f.call('worker','message.send',{recipients:['outsider'],title:'No',body:'No cross-restaurant send'})).status,400);
  ok(await f.call('worker','message.send',{recipients:['incoming'],title:'Private',body:'Only two people'}));
  ok(await f.call('worker','feedback.save',{text:'Private thought',shared:false}));
  const manager = ok(await f.view('manager'));
  assert.equal(manager.records.length,0);
  assert.equal(JSON.stringify(manager).includes('example.test'),false);
  assert.equal((await f.call('worker','message.send',{recipients:['incoming'],title:'No',body:'Forged origin'},null,{origin:'https://bad.example'})).status,403);
  assert.equal((await f.call('foh','shift.save',{personId:'worker',position:'Fry',...period})).status,403);
  assert.equal((await f.call('worker','shift.save',{personId:'worker',position:'Fry',...period,capabilities:['schedule.manage']})).status,403);
});

test('published overnight shift, replacement consent, manager review, and Inbox result share one durable state', async t => {
  const f = await fixture(t);
  ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...period,note:'Scheduled leader'}));
  const shift = ok(await f.call('manager','shift.save',{personId:'worker',position:'Fry',...period}));
  assert.equal(ok(await f.view('worker')).records.filter(r=>r.kind==='shift').length,0);
  const published = ok(await f.call('manager','shift.publish',{},shift));
  const req = ok(await f.call('worker','request.create',{type:'swap',shiftId:shift.recordId,replacementId:'incoming',note:'Please cover',...period}));
  assert.equal((await f.call('manager','request.review',{approve:true,note:'Approved'},req)).status,400);
  assert.equal(ok(await f.view('worker')).records.find(r=>r.id===shift.recordId).ownerId,'worker');
  const accepted = ok(await f.call('incoming','request.consent',{accept:true},req));
  ok(await f.call('manager','request.review',{approve:true,note:'Coverage confirmed'},accepted));
  assert.equal(ok(await f.view('worker')).records.some(r=>r.kind==='shift'),false);
  const incoming = ok(await f.view('incoming'));
  assert.equal(incoming.records.find(r=>r.kind==='shift').data.end,'2026-09-15T05:00:00.000Z');
  assert.ok(incoming.records.some(r=>r.kind==='message'&&r.data.title==='swap approved'));
  assert.equal((await f.call('manager','shift.cancel',{},published)).status,409);
  assert.equal((await f.call('manager','shift.save',{personId:'incoming',position:'Fry',...period})).status,400);
});

test('physical handoff workflow stays open through correction, independent verification and incoming acceptance', async t => {
  const f = await fixture(t);
  let r = ok(await f.call('manager','task.create',{ownerId:'worker',incomingId:'incoming',kind:'handoff',title:'Fry handoff',detail:'Test definition of done',due:period.end}));
  assert.equal((await f.call('worker','task.transition',{step:'verify',note:'Self verify'},r)).status,403);
  r = ok(await f.call('worker','task.transition',{step:'ready',note:'Ready for physical check'},r));
  r = ok(await f.call('manager','task.transition',{step:'fix',note:'Finish assigned correction'},r));
  assert.equal(ok(await f.view('worker')).records.find(x=>x.id===r.recordId).data.phase,'correction');
  r = ok(await f.call('worker','task.transition',{step:'ready',note:'Correction complete'},r));
  r = ok(await f.call('manager','task.transition',{step:'verify',note:'Physically checked'},r));
  r = ok(await f.call('incoming','task.transition',{step:'dispute',note:'Missing item'},r));
  r = ok(await f.call('worker','task.transition',{step:'ready',note:'Restocked'},r));
  r = ok(await f.call('manager','task.transition',{step:'verify',note:'Rechecked'},r));
  r = ok(await f.call('incoming','task.transition',{step:'accept',note:'Accepted'},r));
  assert.equal(ok(await f.view('incoming')).records.find(x=>x.id===r.recordId).data.phase,'closed');
  const dishTask=ok(await f.call('manager','task.create',{ownerId:'dish',kind:'task',title:'Fictional dish cleanup',detail:'Ordinary assigned cleanup; no closing authority granted.',due:period.end}));
  assert.equal(ok(await f.view('dish')).records.find(x=>x.id===dishTask.recordId).data.kind,'task');
  assert.equal((await f.call('manager','task.create',{ownerId:'dish',incomingId:'incoming',kind:'handoff',title:'Denied dish handoff',detail:'Dish uses its separate checkout cycle.',due:period.end})).status,400);
});

test('order retries are idempotent; stale approval and concurrent edits cannot overwrite the reviewed version', async t => {
  const f = await fixture(t), input = {lines:[{name:'Black 9x9 boxes',quantity:1,unit:'case',productId:'test-sku',note:'Keep black'}],note:''}, requestId = crypto.randomUUID();
  const draft = ok(await f.call('manager','order.save',input,null,{requestId}));
  assert.deepEqual(ok(await f.call('manager','order.save',input,null,{requestId})),draft);
  assert.equal((await f.call('manager','order.save',{...input,note:'Different payload'},null,{requestId})).status,409);
  const review = ok(await f.call('manager','order.submit',{},draft));
  assert.equal((await f.call('manager','order.review',{approve:true,note:'Not permitted'},review)).status,403);
  assert.equal((await f.call('purchaser','order.review',{approve:true,note:'Stale'},draft)).status,409);
  const results = await Promise.all([f.call('purchaser','order.review',{approve:true,note:'Reviewed'},review),f.call('manager','order.withdraw',{},review)]);
  assert.equal(results.filter(r=>r.status===200).length,1); assert.equal(results.filter(r=>r.status===409).length,1);
  const orders = ok(await f.view('manager')).records.filter(r=>r.kind==='order'); assert.equal(orders.length,1);
  if (orders[0].data.status==='approved') assert.equal(orders[0].data.approvedRevision,review.revision);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS total FROM command_receipts WHERE request_id=?').bind(requestId).first()).total,1);
});

test('database failure rolls back content, notification, receipt and audit together; revoked account is denied', async t => {
  const f = await fixture(t);
  await f.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'test rollback'); END").run();
  assert.equal((await f.call('worker','message.send',{recipients:['incoming'],title:'Rollback',body:'Must not save'})).status,503);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS total FROM records').first()).total,0);
  assert.equal((await f.db.prepare("SELECT revision FROM locations WHERE id='a'").first()).revision,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS total FROM command_receipts').first()).total,0);
  await f.db.prepare("UPDATE memberships SET active=0, revision=revision+1 WHERE id='worker'").run();
  assert.equal((await f.view('worker')).status,403);
});

test('Toast mapping preserves multiple jobs and flags ambiguous accounts without leaking payroll or passcodes', () => {
  const employees = [{guid:'person-a',firstName:'Alex',lastName:'Cook',chosenName:'A',email:'same@example.test',passcode:'SECRET',wageOverrides:[{wage:99}],jobReferences:[{guid:'cook'},{guid:'lead'}]}, {guid:'person-b',firstName:'B',email:'same@example.test',jobReferences:[]}];
  const roster = normalizeToastRoster(employees,[{guid:'cook',title:'Cook'},{guid:'lead',title:'Shift Lead'}],'restaurant');
  assert.equal(roster.employees[0].jobs.length,2); assert.equal(roster.employees[0].name,'A Cook');
  assert.ok(roster.employees.every(e=>e.issues.some(i=>i.includes('do not merge'))));
  assert.equal(JSON.stringify(roster).includes('SECRET'),false); assert.equal(JSON.stringify(roster).includes('wage'),false);
  assert.throws(()=>normalizeToastRoster([employees[0],employees[0]],[],'restaurant'),/duplicate employee/);
  assert.ok(normalizeToastRoster([],[],'restaurant').issues[0].includes('Do not deactivate'));
});

test('Toast connector only reads both location-scoped endpoints and rejects partial or unauthorized results', async () => {
  const calls = [], config={host:'https://ws-api.toasttab.com',restaurantGuid:'11111111-1111-4111-8111-111111111111',accessToken:'fixture-token'};
  const roster = await fetchToastRoster(config,async(url,options)=>{calls.push({url,options});return Response.json([])});
  assert.equal(calls.length,2); assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.headers['Toast-Restaurant-External-ID']===config.restaurantGuid));
  assert.equal(roster.employees.length,0);
  await assert.rejects(fetchToastRoster(config,async url=>url.endsWith('jobs')?new Response('',{status:403}):Response.json([])),/previous roster has not been replaced/);
  await assert.rejects(fetchToastRoster({...config,host:'https://bad.example'},async()=>Response.json([])),/not configured/);
});

const reviewSetup={ownerId:'worker',managerId:'manager',approverId:'gm',hireDate:'2026-01-01',dueDate:'2026-09-01',validated:true,stations:[{name:'Fry fixture',definition:'Fictional observable station criteria',source:'Controlled test source'},{name:'Prep fixture',definition:'Fictional preparation criteria',source:'Controlled test source'}]};
const ratings=(a,b)=>[{score:a,note:'First station examples'},{score:b,note:'Second station examples'}];

test('assessment drafts stay private even after cancellation, and named review participants are enforced',async t=>{
  const f=await fixture(t);let r=ok(await f.call('manager','development.create',reviewSetup));
  r=ok(await f.call('worker','development.assess',{by:'employee',submit:false,ratings:[{score:4,note:'private self draft'},{score:null,note:''}],summary:'private employee summary'},r));
  assert.equal(JSON.stringify(ok(await f.view('manager'))).includes('private self draft'),false);
  assert.equal(JSON.stringify(ok(await f.view('gm'))).includes('private employee summary'),false);
  assert.equal(ok(await f.view('opener')).records.some(x=>x.kind==='development'),false);
  assert.equal((await f.call('opener','development.assess',{by:'manager',submit:true,ratings:ratings(4,5),summary:'Unassigned'},r)).status,404);
  r=ok(await f.call('gm','development.cancel',{note:'Wrong review setup'},r));
  assert.equal(JSON.stringify(ok(await f.view('gm'))).includes('private self draft'),false);
  assert.ok(JSON.stringify(ok(await f.view('worker'))).includes('private self draft'));
  assert.equal((await f.call('manager','development.create',{...reviewSetup,ownerId:'dish'})).status,400);
});

test('development requires self-assessment, manager discussion, employee acknowledgement and independent GM approval',async t=>{
  const f=await fixture(t);let r=ok(await f.call('manager','development.create',reviewSetup));
  assert.equal((await f.call('manager','development.assess',{by:'manager',submit:true,ratings:ratings(7,8),summary:'Early manager assessment'},r)).status,400);
  assert.equal((await f.call('worker','development.assess',{by:'employee',submit:true,ratings:ratings(0,0),summary:'Automatic zeros'},r)).status,400);
  r=ok(await f.call('worker','development.assess',{by:'employee',submit:true,ratings:ratings(5,6),summary:'Employee station assessment'},r));
  assert.equal((await f.call('manager','development.request-approval',{},r)).status,400);
  r=ok(await f.call('manager','development.assess',{by:'manager',submit:false,ratings:ratings(7,8),summary:'private manager draft'},r));
  assert.equal(JSON.stringify(ok(await f.view('worker'))).includes('private manager draft'),false);
  r=ok(await f.call('manager','development.assess',{by:'manager',submit:true,ratings:ratings(7,8),summary:'Manager assessment submitted'},r));
  assert.equal((await f.call('worker','development.discuss',{note:'No conversation yet',confirm:true},r)).status,400);
  r=ok(await f.call('manager','development.discuss',{note:'Discussed both differences and agreed support'},r));
  r=ok(await f.call('worker','development.discuss',{note:'Still need to discuss the second station',confirm:false},r));
  assert.equal((await f.call('manager','development.request-approval',{},r)).status,400);
  r=ok(await f.call('manager','development.discuss',{note:'Discussed second station with examples'},r));
  r=ok(await f.call('worker','development.discuss',{note:'Conversation occurred; I retain my perspective',confirm:true},r));
  r=ok(await f.call('manager','development.request-approval',{},r));
  assert.equal((await f.call('manager','development.approve',{approve:true,note:'Self approval'},r)).status,403);
  r=ok(await f.call('gm','development.approve',{approve:false,note:'Clarify the assessment examples'},r));
  r=ok(await f.call('manager','development.revise-assessment',{by:'manager',note:'Correct the second rating'},r));
  r=ok(await f.call('manager','development.assess',{by:'manager',submit:true,ratings:ratings(7,7),summary:'Revised manager assessment'},r));
  r=ok(await f.call('manager','development.discuss',{note:'Reviewed corrected rating'},r));
  r=ok(await f.call('worker','development.discuss',{note:'Discussed revised assessment',confirm:true},r));
  r=ok(await f.call('manager','development.request-approval',{},r));
  r=ok(await f.call('gm','development.approve',{approve:true,note:'Conversation and examples reviewed'},r));
  const view=ok(await f.view('worker')),review=view.records.find(x=>x.id===r.recordId);
  assert.equal(review.data.phase,'approved');assert.equal(review.data.originalDueDate,reviewSetup.dueDate);
  assert.equal(review.data.submissions.length,3);assert.equal(review.data.submissions[1].ratings[1].score,8);assert.equal(review.data.stations[1].managerScore,7);
  assert.deepEqual(view.me.qualifications,['Fry']);assert.deepEqual(view.me.capabilities,[]);
});

test('review reassignment preserves due dates, clears a replaced manager draft and routes overdue responsibility',async t=>{
  const f=await fixture(t);let r=ok(await f.call('manager','development.create',reviewSetup));
  r=ok(await f.call('worker','development.assess',{by:'employee',submit:true,ratings:ratings(3,4),summary:'Employee assessment'},r));
  r=ok(await f.call('manager','development.assess',{by:'manager',submit:false,ratings:ratings(7,8),summary:'Former manager private draft'},r));
  r=ok(await f.call('gm','development.reassign',{managerId:'opener',approverId:'gm',note:'Manager responsibility changed'},r));
  const review=ok(await f.view('opener')).records.find(x=>x.id===r.recordId);
  assert.equal(review.data.originalDueDate,reviewSetup.dueDate);assert.equal(review.data.managerSummary,'');
  assert.ok(review.data.stations.every(s=>s.managerScore===null));
  assert.equal(reviewDueState(review,'2026-09-04').level,'first-reminder');
  assert.equal(reviewDueState(review,'2026-09-06').level,'second-reminder');
  assert.equal(reviewDueState({...review,data:{...review.data,phase:'gm-review'}},'2026-09-08').responsibleId,'gm');
  assert.equal(reviewDueState(review,'2026-09-08').level,'owner');
});

test('overnight deferral keeps closing ownership until the scheduled opening manager accepts',async t=>{
  const f=await fixture(t);
  const closing=ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...period,note:'Closing responsibility'}));
  const opening=ok(await f.call('manager','leadership.assign',{personId:'opener',area:'BOH',start:'2026-09-15T08:00:00-04:00',end:'2026-09-15T16:00:00-04:00',note:'Opening responsibility'}));
  const input={outgoingLeadershipId:closing.recordId,incomingId:'opener',incomingLeadershipId:opening.recordId,title:'Fixture follow-up',detail:'Condition assessed; next manager follows up',priority:'urgent',safeToDefer:true};
  assert.equal((await f.call('manager','handoff.create',{...input,safeToDefer:false})).status,400);
  let r=ok(await f.call('manager','handoff.create',input));
  assert.ok(ok(await f.view('gm')).records.some(x=>x.kind==='message'&&x.data.recordId===r.recordId));
  assert.equal(ok(await f.view('opener')).records.find(x=>x.id===r.recordId).ownerId,'manager');
  assert.equal((await f.call('manager','handoff.transition',{step:'resolve',note:'Not accepted'},r)).status,400);
  assert.equal((await f.call('manager','handoff.transition',{step:'accept',note:'Cannot accept for another manager'},r)).status,403);
  r=ok(await f.call('opener','handoff.transition',{step:'dispute',note:'Need the condition clarified'},r));
  assert.equal(ok(await f.view('manager')).records.find(x=>x.id===r.recordId).ownerId,'manager');
  r=ok(await f.call('manager','handoff.transition',{step:'offer',note:'Clarified the temporary action',incomingId:'opener',incomingLeadershipId:opening.recordId},r));
  r=ok(await f.call('opener','handoff.transition',{step:'accept',note:'I accept responsibility and will follow up'},r));
  const accepted=ok(await f.view('opener')).records.find(x=>x.id===r.recordId);
  assert.equal(accepted.ownerId,'opener');assert.equal(accepted.data.phase,'accepted');
  assert.equal((await f.call('manager','handoff.transition',{step:'resolve',note:'No longer the owner'},r)).status,403);
  r=ok(await f.call('opener','handoff.transition',{step:'resolve',note:'Issue resolved; evidence recorded'},r));
  assert.equal(ok(await f.view('manager')).records.find(x=>x.id===r.recordId).data.phase,'resolved');
});

test('goals require employee acceptance and required corrections cannot bypass their approved standard',async t=>{
  const f=await fixture(t),data={ownerId:'worker',managerId:'manager',title:'Chosen skill',definition:'Observable practice with support',due:period.end,type:'development'};
  let r=ok(await f.call('manager','goal.create',data));
  assert.equal(ok(await f.view('worker')).records.find(x=>x.id===r.recordId).data.phase,'proposed');
  assert.equal((await f.call('manager','goal.transition',{step:'accept',note:'Cannot choose for employee'},r)).status,403);
  r=ok(await f.call('worker','goal.transition',{step:'decline',note:'Prefer a different development goal'},r));
  assert.equal(ok(await f.view('worker')).records.find(x=>x.id===r.recordId).data.phase,'declined');
  r=ok(await f.call('worker','goal.create',data));
  r=ok(await f.call('worker','goal.transition',{step:'ready',note:'Practice completed'},r));
  r=ok(await f.call('manager','goal.transition',{step:'fix',note:'One more observed example needed'},r));
  r=ok(await f.call('worker','goal.transition',{step:'ready',note:'Example complete'},r));
  ok(await f.call('manager','goal.transition',{step:'verify',note:'Outcome observed'},r));
  assert.equal((await f.call('manager','goal.create',{...data,type:'required-correction'})).status,400);
  const {standard}=await closeFixture(f,'manager');
  r=ok(await f.call('manager','goal.create',{...data,type:'required-correction',standardId:standard.recordId}));
  assert.equal((await f.call('worker','goal.transition',{step:'decline',note:'Optional?'},r)).status,400);
  ok(await f.call('manager','standard.retire',{note:'Changed standard'},standard));
  assert.equal((await f.call('worker','goal.transition',{step:'ready',note:'Old standard'},r)).status,400);
});

async function learningFixture(t){
  const f=await fixture(t);
  let standard=ok(await f.call('manager','standard.save',guidedStandard));
  standard=ok(await f.call('manager','standard.approve',{validated:true,note:'Fictional learning-source fixture only'},standard));
  return {f,standard,input:{ownerId:'worker',managerId:'manager',type:'development',title:'Learn the fictional practice kit',definition:'Practice the approved kit with manager support.',due:period.end,standardId:standard.recordId,standardRevision:standard.revision}};
}

test('a chosen learning goal retains its approved guide through coaching and separate outcome review',async t=>{
  const {f,standard,input}=await learningFixture(t);
  const before=ok(await f.view('worker'));
  let goal=ok(await f.call('worker','goal.create',input));
  let w=ok(await f.view('worker')),saved=w.records.find(r=>r.id===goal.recordId);
  assert.equal(saved.data.phase,'active');assert.equal(saved.data.standardRevision,standard.revision);
  assert.equal(saved.data.standardSource,guidedStandard.source);
  let context=companionContext(w,'Walk me through my learning goal.',period.start,[],{id:saved.id,revision:saved.revision});
  let evidence=context.evidence.find(e=>e.source.id===saved.id);
  assert.deepEqual(evidence.facts.guide,trainingGuide);assert.ok(context.scope.some(s=>s.id===standard.recordId));
  goal=ok(await f.call('worker','goal.transition',{step:'ready',note:'Practiced both kit steps with support.'},goal));
  assert.equal((await f.call('worker','goal.transition',{step:'verify',note:'Cannot self-verify.'},goal)).status,403);
  goal=ok(await f.call('manager','goal.transition',{step:'fix',note:'Repeat the practice label check together.'},goal));
  w=ok(await f.view('worker'));saved=w.records.find(r=>r.id===goal.recordId);
  context=companionContext(w,'What should I work on next for this goal?',period.start,[],{id:saved.id,revision:saved.revision});
  evidence=context.evidence.find(e=>e.source.id===saved.id);
  assert.equal(evidence.facts.recentFollowThrough.length,2);
  assert.equal(evidence.facts.recentFollowThrough.at(-1).note,'Repeat the practice label check together.');
  goal=ok(await f.call('worker','goal.transition',{step:'ready',note:'Repeated the label check with support.'},goal));
  goal=ok(await f.call('manager','goal.transition',{step:'verify',note:'Observed the agreed practice outcome.'},goal));
  w=ok(await f.view('worker'));
  assert.equal(w.records.find(r=>r.id===goal.recordId).data.phase,'closed');
  assert.deepEqual(w.me.qualifications,before.me.qualifications);
  assert.deepEqual(w.records.find(r=>r.id===standard.recordId),before.records.find(r=>r.id===standard.recordId));
});

test('practice and manager coaching persist without advancing a goal or granting clearance',async t=>{
  const {f,standard,input}=await learningFixture(t);
  let goal=ok(await f.call('worker','goal.create',input));
  const before=ok(await f.view('worker'));
  const messagesBefore=await f.db.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='message'").first();
  const practice={step:'practice',note:'Practiced the sample kit with support; still need help with the label check.'};
  const requestId=crypto.randomUUID(),original=goal;
  goal=ok(await f.call('worker','goal.transition',practice,goal,{requestId}));
  assert.deepEqual(ok(await f.call('worker','goal.transition',practice,original,{requestId})),goal,'retry is idempotent');
  let w=ok(await f.view('worker')),saved=w.records.find(r=>r.id===goal.recordId);
  assert.equal(saved.data.phase,'active');assert.equal(saved.data.due,new Date(input.due).toISOString());
  assert.equal(saved.data.history.filter(h=>h.action==='practice').length,1);
  assert.equal(saved.data.history.at(-1).actorId,'worker');assert.equal(saved.data.history.at(-1).note,practice.note);
  assert.deepEqual(await f.db.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='message'").first(),messagesBefore,'practice creates no Inbox alert');
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===goal.recordId).data.history.at(-1).note,practice.note);
  assert.ok(!ok(await f.view('incoming')).records.some(r=>r.id===goal.recordId));
  assert.ok(!ok(await f.view('outsider','b')).records.some(r=>r.id===goal.recordId));
  assert.equal((await f.call('manager','goal.transition',practice,goal)).status,403);
  assert.equal((await f.call('worker','goal.transition',{step:'coach',note:'Cannot impersonate the manager.'},goal)).status,403);
  assert.ok([403,404].includes((await f.call('opener','goal.transition',{step:'coach',note:'Not the named manager.'},goal)).status));
  goal=ok(await f.call('manager','goal.transition',{step:'coach',note:'We will repeat the label check together on the next practice shift.'},goal));
  w=ok(await f.view('worker'));saved=w.records.find(r=>r.id===goal.recordId);
  assert.equal(saved.data.phase,'active');assert.equal(saved.data.history.at(-1).action,'coach');
  assert.equal(saved.data.history.at(-1).actorId,'manager');
  const evidence=companionContext(w,'Help with my learning goal.',period.start,[],{id:saved.id,revision:saved.revision}).evidence.find(e=>e.source.id===saved.id);
  assert.deepEqual(evidence.facts.recentFollowThrough.map(h=>h.action),['practice','coach']);
  assert.equal(evidence.facts.outcomeReview.grantsStationClearance,false);
  assert.deepEqual(w.me.qualifications,before.me.qualifications);
  assert.deepEqual(w.records.find(r=>r.id===standard.recordId),before.records.find(r=>r.id===standard.recordId));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='message'").first()).count,messagesBefore.count+1);
  goal=ok(await f.call('worker','goal.transition',{step:'ready',note:'Ready to demonstrate the sample kit.'},goal));
  assert.equal(ok(await f.view('manager')).records.find(r=>r.id===goal.recordId).data.phase,'verification');
  goal=ok(await f.call('manager','goal.transition',{step:'verify',note:'Observed the agreed sample-kit outcome.'},goal));
  assert.equal(ok(await f.view('worker')).records.find(r=>r.id===goal.recordId).data.phase,'closed');
});

test('practice and coaching reject inactive states, blank notes, stale instructions and revoked authority',async t=>{
  const {f,standard,input}=await learningFixture(t);
  let goal=ok(await f.call('manager','goal.create',input));
  const practice={step:'practice',note:'Sample practice'},coach={step:'coach',note:'Sample coaching'};
  assert.equal((await f.call('worker','goal.transition',practice,goal)).status,400);
  assert.equal((await f.call('manager','goal.transition',coach,goal)).status,400);
  goal=ok(await f.call('worker','goal.transition',{step:'accept',note:'I choose this goal.'},goal));
  assert.equal((await f.call('worker','goal.transition',{...practice,note:'  '},goal)).status,400);
  assert.equal((await f.call('worker','goal.transition',{...practice,note:'a'.repeat(2001)},goal)).status,400);
  await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind('[]','manager').run();
  assert.ok([403,404].includes((await f.call('manager','goal.transition',coach,goal)).status));
  await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind(JSON.stringify(['people.manage','standards.approve']),'manager').run();
  goal=ok(await f.call('worker','goal.transition',{step:'ready',note:'Ready for observation.'},goal));
  assert.equal((await f.call('worker','goal.transition',practice,goal)).status,400);
  assert.equal((await f.call('manager','goal.transition',coach,goal)).status,400);
  goal=ok(await f.call('manager','goal.transition',{step:'fix',note:'Practice the label check again.'},goal));
  ok(await f.call('manager','standard.retire',{note:'Fictional instructions replaced.'},standard));
  assert.equal((await f.call('worker','goal.transition',practice,goal)).status,400);
  assert.equal((await f.call('manager','goal.transition',coach,goal)).status,400);
  goal=ok(await f.call('worker','goal.transition',{step:'cancel',note:'Replace this goal.'},goal));
  assert.equal((await f.call('worker','goal.transition',practice,goal)).status,400);
});

test('a manager-proposed linked learning goal requires employee choice and stays out of AI until accepted',async t=>{
  const {f,input}=await learningFixture(t);
  let goal=ok(await f.call('manager','goal.create',input));
  let w=ok(await f.view('worker'));
  assert.equal(w.records.find(r=>r.id===goal.recordId).data.phase,'proposed');
  assert.ok(!companionContext(w,'What is my learning goal?',period.start).evidence.some(e=>e.source.id===goal.recordId));
  assert.equal((await f.call('manager','goal.transition',{step:'accept',note:'Cannot choose for the employee.'},goal)).status,403);
  goal=ok(await f.call('worker','goal.transition',{step:'accept',note:'I choose this practice goal.'},goal));
  w=ok(await f.view('worker'));
  assert.ok(companionContext(w,'Help with my learning goal.',period.start).evidence.some(e=>e.source.id===goal.recordId));
  for(const actor of ['incoming','foh','outsider','dish'])assert.ok(!ok(await f.view(actor,actor==='outsider'?'b':'a')).records.some(r=>r.id===goal.recordId));
  assert.ok(ok(await f.view('manager')).records.some(r=>r.id===goal.recordId));
});

test('linked learning rejects stale, missing, unapproved and wrong-department sources before saving',async t=>{
  const {f,standard,input}=await learningFixture(t);
  for(const patch of [{standardId:'missing'},{standardRevision:undefined},{standardRevision:standard.revision+1},{standardRevision:String(standard.revision)}]){
    assert.notEqual((await f.call('worker','goal.create',{...input,...patch})).status,200);
  }
  await f.db.prepare('UPDATE records SET area=? WHERE id=?').bind('FOH',standard.recordId).run();
  assert.equal((await f.call('worker','goal.create',input)).status,400);
  await f.db.prepare('UPDATE records SET area=? WHERE id=?').bind('BOH',standard.recordId).run();
  const draft=ok(await f.call('manager','standard.save',{...guidedStandard,title:'Unapproved fixture'}));
  assert.equal((await f.call('worker','goal.create',{...input,standardId:draft.recordId,standardRevision:draft.revision})).status,400);
  ok(await f.call('manager','standard.retire',{note:'Fictional guide retired'},standard));
  assert.equal((await f.call('worker','goal.create',input)).status,400);
  assert.ok(!ok(await f.view('worker')).records.some(r=>r.kind==='goal'));
  const {standardId,standardRevision,...unlinked}=input;
  assert.ok(standardId);assert.ok(standardRevision);
  const goal=ok(await f.call('worker','goal.create',unlinked));
  assert.equal(ok(await f.view('worker')).records.find(r=>r.id===goal.recordId).data.standardId,undefined);
});

test('changed learning instructions block acceptance and outcome approval while leaving decline and cancellation available',async t=>{
  const {f,standard,input}=await learningFixture(t);
  const proposed=ok(await f.call('manager','goal.create',input));
  const active=ok(await f.call('worker','goal.create',input));
  let ready=ok(await f.call('worker','goal.create',input));
  ready=ok(await f.call('worker','goal.transition',{step:'ready',note:'Practice ready for review.'},ready));
  ok(await f.call('manager','standard.retire',{note:'Replace the fictional instructions.'},standard));
  assert.equal((await f.call('worker','goal.transition',{step:'accept',note:'Old proposal.'},proposed)).status,400);
  assert.equal((await f.call('worker','goal.transition',{step:'ready',note:'Old instructions.'},active)).status,400);
  assert.equal((await f.call('manager','goal.transition',{step:'verify',note:'Old outcome basis.'},ready)).status,400);
  ok(await f.call('worker','goal.transition',{step:'decline',note:'I will review the new proposal.'},proposed));
  ok(await f.call('worker','goal.transition',{step:'cancel',note:'Choosing a new goal with current instructions.'},active));
  ok(await f.call('manager','goal.transition',{step:'cancel',note:'Replace the outdated goal.'},ready));
  const w=ok(await f.view('worker'));assert.ok(w.records.filter(r=>r.kind==='goal').every(r=>['declined','cancelled'].includes(r.data.phase)));
});

test('feedback stays employee-controlled through sharing, manager commitment and further follow-up',async t=>{
  const f=await fixture(t);let r=ok(await f.call('worker','feedback.save',{text:'Private employee thought',shared:false}));
  assert.equal(ok(await f.view('manager')).records.some(x=>x.kind==='feedback'),false);
  r=ok(await f.call('worker','feedback.save',{text:'Please discuss training support',shared:true},r));
  assert.equal((await f.call('manager','feedback.close',{note:'Manager cannot close for employee'},r)).status,403);
  r=ok(await f.call('manager','feedback.respond',{response:'Meet to agree training support',due:period.end},r));
  r=ok(await f.call('worker','feedback.close',{note:'Conversation helped'},r));
  r=ok(await f.call('worker','feedback.reopen',{note:'One commitment still needs follow-up'},r));
  assert.equal(ok(await f.view('manager')).records.find(x=>x.id===r.recordId).data.status,'submitted');
  assert.ok(ok(await f.view('worker')).records.some(x=>x.kind==='message'&&x.data.recordId===r.recordId));
});

const toastConfig={TOAST_LOCATION_ID:'a',TOAST_RESTAURANT_GUID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',TOAST_CLIENT_ID:'fixture-client',TOAST_CLIENT_SECRET:'fixture-secret'};
function toastRequest(actor='admin',method='GET',locationId='a',extra={}) {
  return new Request(`https://test.example/api/integrations/toast${method==='GET'?`?locationId=${locationId}`:''}`,{method,headers:{...(actor?{'oai-authenticated-user-id':`${actor}-identity`,'oai-authenticated-user-email':`${actor}@example.test`}:{}),...(method==='POST'?{Origin:'https://test.example','Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({locationId,...extra})}:{})});
}
function fakeToast() {
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url,method:init.method,body:init.body,headers:new Headers(init.headers)});
    assert.equal(init.redirect,'manual');
    if(url.endsWith('/authentication/login'))return Response.json({status:'SUCCESS',token:{tokenType:'Bearer',expiresIn:3600,accessToken:'fixture-access-token'}});
    assert.equal(init.method,'GET');assert.equal(new Headers(init.headers).get('Toast-Restaurant-External-ID'),toastConfig.TOAST_RESTAURANT_GUID);
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer fixture-access-token');
    if(url.endsWith('/employees'))return Response.json([
      {guid:'toast-person-a',firstName:'Sample',lastName:'Employee',email:'sample@example.test',jobReferences:[{guid:'toast-job-a'},{guid:'toast-job-b'}],passcode:'DO-NOT-SAVE',phoneNumber:'DO-NOT-SAVE',wageOverrides:[{wage:999}]},
      {guid:'toast-person-b',firstName:'Second',lastName:'Person',email:'sample@example.test',jobReferences:[]},
      {guid:'toast-person-old',firstName:'Old',lastName:'Account',deleted:true,jobReferences:[]},
    ]);
    if(url.endsWith('/jobs'))return Response.json([{guid:'toast-job-a',title:'Cook',defaultWage:999},{guid:'toast-job-b',title:'Dishwasher'}]);
    throw Error('Unexpected upstream endpoint');
  };
  return {fetcher,calls};
}
async function toastCall(f,request,config=toastConfig,fetcher=fakeToast().fetcher){const response=await handleToast(request,f.db,config,fetcher);return {status:response.status,data:await response.json()};}

test('Toast setup requires the correct administrator and server-only restaurant configuration',async t=>{
  const f=await fixture(t),remote=fakeToast();
  assert.equal((await toastCall(f,toastRequest(null),toastConfig,remote.fetcher)).status,401);
  for(const actor of ['worker','manager','dish','outsider'])assert.equal((await toastCall(f,toastRequest(actor),toastConfig,remote.fetcher)).status,403);
  assert.equal((await toastCall(f,toastRequest('admin','GET','b'),toastConfig,remote.fetcher)).status,403);
  assert.equal(ok(await toastCall(f,toastRequest(),{},remote.fetcher)).configured,false);
  assert.equal((await toastCall(f,toastRequest('admin','POST'),{},remote.fetcher)).status,503);
  assert.equal((await toastCall(f,toastRequest('admin','POST','a',{host:'https://example.invalid'}),toastConfig,remote.fetcher)).status,400);
  const cross=toastRequest('admin','POST');cross.headers.set('Origin','https://other.example');
  assert.equal((await toastCall(f,cross,toastConfig,remote.fetcher)).status,403);assert.equal(remote.calls.length,0);
  assert.equal(configuredToast({...toastConfig,TOAST_RESTAURANT_GUID:'689850'},'a'),null);
  assert.equal(configuredToast({...toastConfig,TOAST_API_HOST:'https://ws-api.toasttab.com.attacker.example'},'a'),null);
  assert.equal(configuredToast(toastConfig,'b'),null);
});

test('Toast refresh authenticates, saves only normalized fields, and never provisions employee access',async t=>{
  const f=await fixture(t),remote=fakeToast();
  const before=(await f.db.prepare('SELECT * FROM memberships ORDER BY id').all()).results;
  const result=ok(await toastCall(f,toastRequest('admin','POST'),toastConfig,remote.fetcher));
  assert.equal(result.configured,true);assert.equal(result.roster.employees.length,3);
  assert.deepEqual(result.roster.employees[0].jobs.map(j=>j.title),['Cook','Dishwasher']);
  assert.ok(result.roster.employees[0].issues.some(x=>x.includes('Another active')));
  assert.equal(result.roster.employees[2].archived,true);
  assert.equal(remote.calls.length,3);assert.equal(remote.calls[0].url,'https://ws-api.toasttab.com/authentication/v1/authentication/login');
  assert.deepEqual(JSON.parse(remote.calls[0].body),{clientId:'fixture-client',clientSecret:'fixture-secret',userAccessType:'TOAST_MACHINE_CLIENT'});
  const stored=await f.db.prepare('SELECT data FROM toast_rosters WHERE location_id = ?').bind('a').first();
  for(const forbidden of ['DO-NOT-SAVE','wage','passcode','phoneNumber','fixture-access-token','fixture-secret'])assert.ok(!stored.data.includes(forbidden));
  const after=(await f.db.prepare('SELECT * FROM memberships ORDER BY id').all()).results;
  // Only the administrator's first sign-in binding may change; no Toast person becomes a member.
  assert.equal(after.length,before.length);for(const row of after.filter(r=>r.id!=='admin'))assert.deepEqual(row,before.find(x=>x.id===row.id));
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='toast.roster-read'").first()).n,1);
  assert.deepEqual(ok(await toastCall(f,toastRequest())).roster,result.roster);
  const again=await toastCall(f,toastRequest('admin','POST'),toastConfig,remote.fetcher);assert.equal(again.status,429);assert.equal(remote.calls.length,3);
});

test('partial Toast responses and unusable authentication preserve the saved roster without exposing provider errors',async t=>{
  const f=await fixture(t),remote=fakeToast();
  const original=ok(await toastCall(f,toastRequest('admin','POST'),toastConfig,remote.fetcher)).roster;
  for(const mode of ['partial','empty','auth','malformed']){
    await f.db.prepare('UPDATE integration_attempts SET started_at=0').run();
    // Each failure case exercises a fresh authentication, independent of a prior cached success.
    await f.db.prepare('DELETE FROM toast_auth_cache').run();
    const broken=async(url,init)=>{
      if(mode==='auth'&&url.endsWith('/authentication/login'))return new Response('UPSTREAM-SECRET-DETAIL',{status:401});
      if(mode==='malformed'&&url.endsWith('/authentication/login'))return Response.json({status:'SUCCESS',token:{accessToken:'UPSTREAM-SECRET-DETAIL'}});
      if(mode==='partial'&&url.endsWith('/jobs'))return new Response('UPSTREAM-SECRET-DETAIL',{status:500});
      if(mode==='empty'&&url.endsWith('/employees'))return Response.json([]);
      return remote.fetcher(url,init);
    };
    const result=await toastCall(f,toastRequest('admin','POST'),toastConfig,broken);assert.ok(result.status>=400);assert.ok(!JSON.stringify(result.data).includes('UPSTREAM-SECRET-DETAIL'));
    assert.deepEqual(ok(await toastCall(f,toastRequest())).roster,original);
  }
});

test('simultaneous Toast refreshes share one attempt and a changed restaurant hides the previous source',async t=>{
  const f=await fixture(t),remote=fakeToast();await f.view('admin');
  const results=await Promise.all([toastCall(f,toastRequest('admin','POST'),toastConfig,remote.fetcher),toastCall(f,toastRequest('admin','POST'),toastConfig,remote.fetcher)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);assert.equal(remote.calls.length,3);
  const moved=ok(await toastCall(f,toastRequest(),{...toastConfig,TOAST_RESTAURANT_GUID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}));
  assert.equal(moved.roster,null);assert.equal(moved.unmatchedLocation,true);
});

test('revoking administrator access during Toast retrieval prevents roster saving and disclosure',async t=>{
  const f=await fixture(t),remote=fakeToast();let revoked=false;
  const revoking=async(url,init)=>{const response=await remote.fetcher(url,init);if(url.endsWith('/jobs')&&!revoked){revoked=true;await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='admin'").run();}return response};
  const result=await toastCall(f,toastRequest('admin','POST'),toastConfig,revoking);assert.equal(result.status,403);assert.equal(result.data.roster,undefined);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM toast_rosters').first()).n,0);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='toast.roster-read'").first()).n,0);
});

test('attendance call details are validated snapshots with unknown legacy values and no automatic penalty',async t=>{
 const f=await attendanceFixture(t);
 for(const facts of [null,[],{}, {contact:'__proto__',coverage:'confirmed',emergency:'reported'}, {contact:'phone',coverage:'yes',emergency:'no'}])assert.equal((await f.call('manager','attendance.record',{...f.input,facts})).status,400);
 const facts={contact:'phone',coverage:'uncovered',emergency:'reported'};
 const saved=ok(await f.call('manager','attendance.record',{...f.input,facts,review:{note:'Forged'},points:5}));
 const row=ok(await f.view('manager')).records.find(r=>r.id===saved.recordId);
 assert.deepEqual(row.data.facts,facts);assert.deepEqual(row.data.history[0].facts,facts);assert.equal(row.data.review,null);assert.equal(row.data.points,undefined);
 assert.equal(attendanceNotice(row.data).band,'under-four-hours');
 const change=ok(await f.call('manager','attendance.correct',{...f.input,changeReason:'Details confirmed',facts:{...facts,coverage:'confirmed'}},saved));
 const next=ok(await f.view('manager')).records.find(r=>r.id===change.recordId);
 assert.equal(next.data.history[0].facts.coverage,'uncovered');assert.equal(next.data.facts.coverage,'confirmed');
 await f.db.prepare("UPDATE records SET data=json_remove(data,'$.facts','$.review') WHERE id=?").bind(change.recordId).run();
 const legacy=ok(await f.call('manager','attendance.correct',{...f.input,changeReason:'Legacy note correction'},change));
 assert.deepEqual(ok(await f.view('manager')).records.find(r=>r.id===legacy.recordId).data.facts,{contact:'unknown',coverage:'unknown',emergency:'unknown'});
});

test('attendance manager review and reopen are durable, private and tied to the current facts',async t=>{
 const f=await attendanceFixture(t),saved=ok(await f.call('manager','attendance.record',f.input));
 const before=ok(await f.view('manager'));
 for(const actor of ['worker','dish','foh','drafter','outsider'])assert.ok([403,404].includes((await f.call(actor,'attendance.review',{note:'Not authorized'},saved)).status));
 for(const note of ['', 'x'.repeat(2001)])assert.equal((await f.call('manager','attendance.review',{note},saved)).status,400);
 const reviewed=ok(await f.call('gm','attendance.review',{note:'Fictional individual review: discussed the call and follow-up.',actorId:'forged'},saved));
 let row=ok(await f.view('manager')).records.find(r=>r.id===saved.recordId);
 assert.equal(row.data.review.actorId,'gm');assert.equal(row.data.review.actorName,'Test gm');assert.equal(row.data.history.at(-1).action,'reviewed');
 assert.equal((await f.call('manager','attendance.review',{note:'Stale'},saved)).status,409);
 assert.equal((await f.call('manager','attendance.review',{note:'Duplicate'},reviewed)).status,409);
 const reopened=ok(await f.call('manager','attendance.reopen',{note:'Additional facts need checking.'},reviewed));
 row=ok(await f.view('manager')).records.find(r=>r.id===saved.recordId);assert.equal(row.data.review,null);assert.equal(row.data.history[1].review.actorId,'gm');
 assert.equal((await f.call('manager','attendance.reopen',{note:'Again'},reopened)).status,409);
 const reviewedAgain=ok(await f.call('manager','attendance.review',{note:'Fictional second review.'},reopened));
 const corrected=ok(await f.call('manager','attendance.correct',{...f.input,note:'Fictional corrected facts.',changeReason:'Checked timing.'},reviewedAgain));
 row=ok(await f.view('manager')).records.find(r=>r.id===saved.recordId);assert.equal(row.data.review,null);assert.equal(row.data.history[3].review.note,'Fictional second review.');
 const after=ok(await f.view('manager'));
 assert.deepEqual(after.records.find(r=>r.id===f.shift.recordId),before.records.find(r=>r.id===f.shift.recordId));
 assert.deepEqual(after.records.filter(r=>r.kind==='message'),before.records.filter(r=>r.kind==='message'));
 for(const actor of ['worker','foh','dish'])assert.ok(!JSON.stringify(ok(await f.view(actor))).includes('Fictional second review.'));
 assert.ok(!JSON.stringify(companionContext(after,'Attendance review',new Date().toISOString())).includes('Fictional second review.'));
 const voided=ok(await f.call('manager','attendance.void',{changeReason:'Wrong entry'},corrected));
 assert.equal((await f.call('manager','attendance.review',{note:'Cannot review void'},voided)).status,400);
});

test('attendance review receipt, audit and update commit once or roll back together',async t=>{
 const f=await attendanceFixture(t),saved=ok(await f.call('manager','attendance.record',f.input));
 await f.db.prepare("CREATE TRIGGER fail_att_review BEFORE INSERT ON audit_events WHEN NEW.action='attendance.review' BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
 const requestId=crypto.randomUUID(),input={note:'Fictional reviewed case.'};
 assert.equal((await f.call('manager','attendance.review',input,saved,{requestId})).status,503);
 assert.equal(ok(await f.view('manager')).records.find(r=>r.id===saved.recordId).revision,saved.revision);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM command_receipts WHERE request_id=?').bind(requestId).first()).n,0);
 await f.db.prepare('DROP TRIGGER fail_att_review').run();
 const reviewed=ok(await f.call('manager','attendance.review',input,saved,{requestId}));
 assert.deepEqual(ok(await f.call('manager','attendance.review',input,saved,{requestId})),reviewed);
 assert.equal(ok(await f.view('manager')).records.find(r=>r.id===saved.recordId).data.history.length,2);
 assert.equal((await f.call('manager','attendance.review',{note:'Different'},saved,{requestId})).status,409);
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='manager'").run();
 assert.equal((await f.call('manager','attendance.reopen',{note:'Revoked'},reviewed)).status,404);
});

test('attendance review concurrent changes produce a single accepted review',async t=>{
 const f=await attendanceFixture(t),saved=ok(await f.call('manager','attendance.record',f.input));
 const results=await Promise.all(['manager','opener'].map(actor=>f.call(actor,'attendance.review',{note:'Fictional review by '+actor},saved)));
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const row=ok(await f.view('manager')).records.find(r=>r.id===saved.recordId);assert.equal(row.data.history.length,2);assert.ok(['manager','opener'].includes(row.data.review.actorId));
});

test('attendance patterns count distinct shifts, exclude voids and respect local dates and department/store boundaries',async t=>{
 const f=await attendanceFixture(t),first=ok(await f.call('manager','attendance.record',f.input));
 const late=ok(await f.call('manager','attendance.record',{...f.input,type:'late',reportedAt:'2026-09-02T00:10:00Z'}));
 const other=ok(await f.call('manager','attendance.record',{...f.input,type:'other'}));
 ok(await f.call('manager','attendance.void',{changeReason:'Fixture duplicate note'},other));
 ok(await f.call('manager','attendance.review',{note:'Individual review'},first));
 const w=ok(await f.view('manager')),pattern=attendancePatterns(w,'2026-09-01','2026-09-01');
 assert.equal(pattern.length,1);assert.equal(pattern[0].entries,2);assert.equal(pattern[0].shifts,1);assert.equal(pattern[0].pending,1);assert.deepEqual(pattern[0].types,{'call-in':1,late:1});
 assert.deepEqual(attendancePatterns(w,'2026-09-02','2026-09-02'),[]);assert.deepEqual(attendancePatterns(w,'2026-09-02','2026-09-01'),[]);
 const row=w.records.find(r=>r.id===late.recordId);
 const mixed={...w,records:[...w.records,{...row,id:'other-store',locationId:'b'},{...row,id:'other-area',area:'FOH'},{...row,id:'other-shift',data:{...row.data,shiftId:'shift-2'}}]};
 assert.equal(attendancePatterns(mixed,'2026-09-01','2026-09-01')[0].shifts,2);assert.equal(attendancePatterns(mixed,'2026-09-01','2026-09-01')[0].entries,3);
 assert.deepEqual(attendancePatterns({...w,me:{...w.me,capabilities:[]}},'2026-09-01','2026-09-01'),[]);
});

test('attendance notice preserves the exact four-hour boundary across clock changes',()=>{
 const data={type:'call-in',shift:{start:'2026-11-01T06:30:00Z'},reportedAt:'2026-11-01T02:30:00Z'};
 assert.deepEqual(attendanceNotice(data),{minutes:240,band:'at-least-four-hours'});
 assert.equal(attendanceNotice({...data,reportedAt:'2026-11-01T02:30:01Z'}).band,'under-four-hours');
 assert.equal(attendanceNotice({...data,reportedAt:'2026-11-01T06:31:00Z'}).band,'after-start');
 assert.equal(attendanceNotice({...data,type:'late'}),null);
 assert.throws(()=>parseAttendanceFacts({contact:'phone',coverage:'unknown',emergency:'__proto__'}));
});
