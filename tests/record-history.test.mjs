import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { handleRecordHistory } from '../.sites-runtime/shared/history-service.mjs';
import { handleWorkspace } from '../.sites-runtime/shared/service.mjs';
import { handleAccess } from '../.sites-runtime/shared/access-service.mjs';
import { runLocationReminders } from '../.sites-runtime/shared/reminder-service.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const before='2026-05-01',old='2026-01-12T17:00:00.000Z',end='2026-01-12T23:00:00.000Z';
const shift={personId:'employee',position:'Server',start:old,end,published:true,cancelled:false};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+name,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const location of ['berts','other'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Fictional '+location,'America/New_York').run();
 for(const [actor,area,position,caps,location='berts'] of [['owner','Executive','Owner',['location.manage','schedule.manage','people.manage']],['manager','FOH','Manager',['people.manage','schedule.manage','tasks.manage']],['employee','FOH','Server',[]],['coworker','FOH','Server',[]],['dish','BOH','Dishwasher',[]],['other','FOH','Owner',['location.manage'],'other']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(actor,actor+'@example.test',actor,location,actor,area,position,JSON.stringify(caps),'[]').run();
 const headers=actor=>({'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test',Origin:'https://test.example','Content-Type':'application/json'});
 const get=async(actor,params={})=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'berts',...params}),{headers:headers(actor)}),db);return {status:r.status,data:await r.json()}};
 const post=async(actor,body,extra={})=>{const r=await handleRecordHistory(new Request('https://test.example/api/history',{method:'POST',headers:{...headers(actor),...extra},body:JSON.stringify(body)}),db);return {status:r.status,data:await r.json()}};
 const view=async(actor='owner')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=berts',{headers:headers(actor)}),db);return {status:r.status,data:await r.json()}};
 const put=async(id,kind,data,owner='employee',area='FOH',archived=null)=>db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at,archived_by) VALUES(?,?,?,?,?,1,?,?,?,?)').bind(id,'berts',kind,owner,area,JSON.stringify(data),old,archived,archived?'owner':null).run();
 const row=id=>db.prepare('SELECT * FROM records WHERE id=?').bind(id).first();
 const archive=async(actor='owner')=>{const p=ok(await get(actor,{preview:'1',before}));const body={action:'archive',locationId:'berts',requestId:crypto.randomUUID(),confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))};return {p,body,result:await post(actor,body)}};
 return {db,get,post,view,put,row,archive};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const message=(recordId,readBy=['employee'])=>({title:'Private fictional notification',body:'Private body must not leak to owner',recipients:['employee'],readBy,replies:[],automated:true,recordId});
const attendance={title:'Fictional attendance',employeeName:'employee',shiftId:'old-shift',shiftRevision:1,shift:{start:old,end,position:'Server'},type:'call-in',reportedAt:old,note:'Private fictional manager note',status:'recorded',history:[]};

test('history files dependants before old shifts and retains open work, unread notices, current guides and personal conversations',async t=>{
 const f=await fixture(t);await f.put('old-shift','shift',shift);await f.put('attendance','attendance',attendance);await f.put('notice','message',message('old-shift'));
 await f.put('unread-shift','shift',shift);await f.put('unread','message',message('unread-shift',[]));
 await f.put('open-shift','shift',shift);await f.put('open-close','close',{shiftId:'open-shift',standardId:'guide',standardRevision:1,standard:{title:'Fixture'},managerId:'manager',due:end,phase:'open',history:[]});
 await f.put('draft-shift','shift',{...shift,published:false});await f.put('personal','message',{...message(undefined),automated:false});
 await f.put('guide','standard',{title:'Approved fictional guide',status:'approved',zone:'Server',position:'Server',version:1,criteria:['Fixture'],source:'Fixture',verification:'manager',validationNote:'Fixture',history:[]});
 const {p,body,result}=await f.archive();ok(result);assert.deepEqual(new Set(p.records.map(r=>r.id)),new Set(['old-shift','attendance','notice']));assert.ok(p.records.findIndex(r=>r.id==='old-shift')>p.records.findIndex(r=>r.id==='notice'));assert.equal(p.records.find(r=>r.id==='notice').label,'Private completed record');assert.equal(JSON.stringify(p).includes('Private body'),false);
 const w=ok(await f.view());assert.equal(w.records.some(r=>r.id==='old-shift'),false);assert.equal(w.records.some(r=>r.id==='open-shift'),true);assert.equal(w.records.some(r=>r.id==='guide'),true);
 assert.deepEqual(ok(await f.post('owner',body)),result.data);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='history.archive'").first()).n,3);
});
test('history permissions and redaction survive filing, direct record reads and restoration previews',async t=>{
 const f=await fixture(t);await f.put('old-shift','shift',shift);await f.put('attendance','attendance',attendance);await f.put('notice','message',message('old-shift'));ok((await f.archive()).result);
 const employee=ok(await f.get('employee'));assert.deepEqual(new Set(employee.items.map(i=>i.record.id)),new Set(['old-shift','notice']));assert.equal(JSON.stringify(employee).includes(attendance.note),false);
 assert.equal(ok(await f.get('coworker')).items.length,0);assert.equal(ok(await f.get('dish')).items.length,0);assert.equal((await f.get('other')).status,403);
 assert.equal((await f.get('employee',{recordId:'attendance'})).status,404);assert.equal((await f.get('owner',{recordId:'notice'})).status,404);assert.equal((await f.get('owner',{restore:'notice'})).status,403);
 assert.equal((await f.get('employee',{preview:'1',before})).status,403);assert.equal((await f.get('dish',{restore:'old-shift'})).status,403);
 const detail=ok(await f.get('employee',{recordId:'notice'}));assert.equal(detail.canRestore,false);assert.equal(detail.workspace.records.some(r=>r.id==='attendance'),false);
});
test('restore brings back required parents, preserves original content and records the operation without changing outcomes',async t=>{
 const f=await fixture(t);await f.put('old-shift','shift',shift);await f.put('attendance','attendance',attendance);ok((await f.archive()).result);
 const p=ok(await f.get('owner',{restore:'attendance'}));assert.deepEqual(new Set(p.records.map(r=>r.id)),new Set(['attendance','old-shift']));
 const body={action:'restore',locationId:'berts',recordId:'attendance',requestId:crypto.randomUUID(),confirmed:true,workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))};
 const result=ok(await f.post('owner',body));assert.equal(result.count,2);assert.deepEqual(ok(await f.post('owner',body)),result);
 for(const [id,data] of [['old-shift',shift],['attendance',attendance]]){const row=await f.row(id);assert.equal(row.archived_at,null);assert.deepEqual(JSON.parse(row.data),data);assert.equal(row.revision,3)}
 assert.equal(ok(await f.get('owner')).items.length,0);assert.equal(ok(await f.view()).records.length,2);
 assert.equal(ok(await f.get('owner',{preview:'1',before})).records.length,0);
});
test('history writes reject changed previews, altered selections, foreign origins and incomplete confirmations without partial writes',async t=>{
 const f=await fixture(t);await f.put('old-shift','shift',shift);const p=ok(await f.get('owner',{preview:'1',before}));const body={action:'archive',locationId:'berts',requestId:'review-archive',confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records};
 for(const patch of [{confirmed:false},{records:[]},{records:[{id:'old-shift',revision:2}]},{workspaceRevision:99},{before:'2099-01-01'}])assert.ok((await f.post('owner',{...body,...patch})).status>=400);
 assert.equal((await f.post('employee',body)).status,403);assert.equal((await f.post('owner',body,{Origin:'https://elsewhere.example'})).status,403);assert.equal((await f.row('old-shift')).archived_at,null);
 ok(await f.post('owner',body));assert.equal((await f.post('owner',{...body,before:'2026-04-01'})).status,409);
});
test('archive and restore roll back metadata, audit and receipt together, then the exact retry succeeds',async t=>{
 const f=await fixture(t);await f.put('old-shift','shift',shift);
 await f.db.prepare("CREATE TRIGGER fail_archive BEFORE INSERT ON audit_events WHEN NEW.action='history.archive' BEGIN SELECT RAISE(ABORT,'fictional failure'); END").run();
 const attempt=await f.archive();assert.equal(attempt.result.status,503);assert.equal((await f.row('old-shift')).archived_at,null);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM command_receipts').first()).n,0);
 await f.db.prepare('DROP TRIGGER fail_archive').run();ok(await f.post('owner',attempt.body));
 const p=ok(await f.get('owner',{restore:'old-shift'}));const restore={action:'restore',recordId:'old-shift',locationId:'berts',requestId:'restore-failure',confirmed:true,workspaceRevision:p.workspaceRevision,records:p.records};
 await f.db.prepare("CREATE TRIGGER fail_restore BEFORE INSERT ON audit_events WHEN NEW.action='history.restore' BEGIN SELECT RAISE(ABORT,'fictional failure'); END").run();assert.equal((await f.post('owner',restore)).status,503);assert.ok((await f.row('old-shift')).archived_at);
 await f.db.prepare('DROP TRIGGER fail_restore').run();ok(await f.post('owner',restore));assert.equal((await f.row('old-shift')).archived_at,null);
});
test('more than 3000 historical records do not fill the active workspace and bounded tied-date paging loses no rows',async t=>{
 const f=await fixture(t);const archived='2026-06-01T12:00:00.000Z';
 await f.db.batch(Array.from({length:3005},(_,i)=>f.db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at,archived_by) VALUES(?,?,?,?,?,1,?,?,?,?)').bind('historical-'+String(i).padStart(4,'0'),'berts','shift','employee','FOH',JSON.stringify(shift),old,archived,'owner')));
 await f.put('active-shift','shift',{...shift,start:'2026-12-01T17:00:00.000Z',end:'2026-12-01T23:00:00.000Z'});
 assert.equal(ok(await f.view()).records.length,1);
 const access=await handleAccess(new Request('https://test.example/api/access?locationId=berts',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}}),f.db);
 assert.equal(access.status,200);assert.equal((await access.json()).accounts.find(a=>a.id==='employee').outstanding,1);
 assert.equal((await runLocationReminders(f.db,'berts','2026-09-17T17:00:00.000Z','manual')).delivered,0);
 let cursor,ids=new Set();do{const page=ok(await f.get('employee',{kind:'shift',...(cursor?{cursor}:{})}));assert.ok(page.items.length<=50);for(const item of page.items){assert.equal(ids.has(item.record.id),false);ids.add(item.record.id)}cursor=page.nextCursor;}while(cursor);
 assert.equal(ids.size,3005);assert.equal(ok(await f.get('employee',{kind:'shift',from:'2026-02-01'})).items.length,0);
 assert.equal((await f.get('employee',{cursor:'not-a-record'})).status,409);
});

test('history date filters follow the restaurant day across midnight and daylight saving changes',async t=>{
 const f=await fixture(t);
 for(const [id,start,end] of [['late-winter','2026-01-13T03:00:00.000Z','2026-01-13T04:00:00.000Z'],['next-winter','2026-01-13T05:00:00.000Z','2026-01-13T06:00:00.000Z'],['dst-day','2026-03-09T03:30:00.000Z','2026-03-09T04:30:00.000Z']])await f.put(id,'shift',{...shift,start,end},'employee','FOH','2026-06-01T12:00:00.000Z');
 assert.deepEqual(ok(await f.get('employee',{kind:'shift',from:'2026-01-12',through:'2026-01-12'})).items.map(i=>i.record.id),['late-winter']);
 assert.deepEqual(ok(await f.get('employee',{kind:'shift',from:'2026-03-08',through:'2026-03-08'})).items.map(i=>i.record.id),['dst-day']);
});

test('revoked authority and a changed workspace at commit cannot file any records',async t=>{
 for(const [change,status] of [["UPDATE memberships SET active=0,revision=revision+1 WHERE id='owner'",403],["UPDATE locations SET revision=revision+1 WHERE id='berts'",409]]){
  const f=await fixture(t);await f.put('old-shift','shift',shift);const p=ok(await f.get('owner',{preview:'1',before}));let batches=0;
  const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare(change).run();return f.db.batch(statements)}})};
  const body={action:'archive',locationId:'berts',requestId:'archive-race',confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records};
  const response=await handleRecordHistory(new Request('https://test.example/api/history',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify(body)}),binding);
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));assert.ok(batches>=2,'The race must occur at the commit batch');assert.ok(result.error);assert.equal((await f.row('old-shift')).archived_at,null);assert.equal((await f.row('old-shift')).revision,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM command_receipts').first()).n,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM audit_events').first()).n,0);
 }
});
test('owner storage housekeeping does not expose another manager’s completed private learning goal',async t=>{
 const f=await fixture(t);await f.put('private-goal','goal',{title:'Private fictional goal',definition:'Private learning evidence',type:'development',managerId:'manager',due:end,phase:'closed',history:[]});
 const {p,result}=await f.archive();ok(result);assert.equal(p.records[0].label,'Private completed record');assert.equal(JSON.stringify(p).includes('Private learning'),false);assert.equal(JSON.stringify(p).includes('Private fictional goal'),false);
 assert.equal(ok(await f.get('owner')).items.length,0);assert.equal(ok(await f.get('employee')).items[0].record.data.title,'Private fictional goal');assert.equal(ok(await f.get('manager')).items[0].record.data.title,'Private fictional goal');
 assert.equal((await f.get('owner',{restore:'private-goal'})).status,403);assert.equal(ok(await f.get('manager',{restore:'private-goal'})).records.length,1);
});
