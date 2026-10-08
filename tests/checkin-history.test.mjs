import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {checkinPatterns,retainedCheckinIds} from '../.sites-runtime/shared/shift-checkin.mjs';
import {historyPlan} from '../.sites-runtime/shared/record-history.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const old='2026-01-01T12:00:00Z',filed='2026-06-01T12:00:00Z',before='2026-05-01';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+name,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['berts','other'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='berts',position='Server'] of [['owner','Executive',['location.manage']],['gm','FOH',['people.approve']],['manager','FOH',['people.manage','schedule.manage']],['worker','FOH',[]],['coworker','FOH',[]],['foreign','FOH',['location.manage'],'other'],['dish','FOH',[],'berts','Dishwasher']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',id,loc,id,area,position,JSON.stringify(caps),'[]').run();
 const headers=who=>({'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test',Origin:'https://test.example','Content-Type':'application/json'});
 const read=async(who,params={})=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'berts',...params}),{headers:headers(who)}),db);return {status:r.status,data:await r.json()}};
 const post=async(who,body,binding=db)=>{const r=await handleRecordHistory(new Request('https://test.example/api/history',{method:'POST',headers:headers(who),body:JSON.stringify(body)}),binding);return {status:r.status,data:await r.json()}};
 const view=async(who='owner')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=berts',{headers:headers(who)}),db);return ok({status:r.status,data:await r.json()})};
 const command=async(who,action,input,record)=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:headers(who),body:JSON.stringify({locationId:'berts',requestId:crypto.randomUUID(),action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})})}),db);return {status:r.status,data:await r.json()}};
 const put=async(id,area='FOH',end='2026-01-01T23:00:00Z',archived=null,owner='worker')=>{
  const shift={personId:owner,start:end.replace('23:00','17:00'),end,position:'Fictional shift',published:true,cancelled:false};
  const data={title:'Shift check-in',employeeName:owner,shiftId:'shift-'+id,shiftRevision:1,shift:{start:shift.start,end,position:shift.position},experience:'rough',note:'Private fictional note '+id,submittedAt:old,versions:[],history:[]};
  await db.batch([['shift-'+id,'shift',shift],[id,'shiftcheckin',data]].map(([rid,kind,d])=>db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at,archived_by) VALUES(?,?,?,?,?,1,?,?,?,?)').bind(rid,'berts',kind,owner,area,JSON.stringify(d),old,archived,archived?'owner':null)));return data;
 };
 const archive=async(who='owner')=>{const p=ok(await read(who,{preview:'1',before}));const body={action:'archive',locationId:'berts',requestId:crypto.randomUUID(),confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records};return {p,body,result:await post(who,body)}};
 const restoreBody=(p,id)=>({action:'restore',locationId:'berts',requestId:crypto.randomUUID(),confirmed:true,recordId:id,workspaceRevision:p.workspaceRevision,records:p.records});
 return {db,read,post,view,command,put,archive,restoreBody};
}
test('filing keeps five per employee and department, preserving every reviewer sample across tied and offset dates',async t=>{
 const f=await fixture(t);
 for(const area of ['FOH','BOH'])for(let i=1;i<=7;i++)await f.put(area+i,area,`2026-01-${10+i}T23:00:00Z`);
 await f.put('few','FOH','2026-01-01T23:00:00Z',null,'coworker');
 const w=await f.view(),gm=await f.view('gm'),p=historyPlan(w,before),kept=retainedCheckinIds(w);
 assert.equal(kept.size,11);assert.equal(p.records.filter(r=>r.kind==='shiftcheckin').length,4);assert.equal(p.records.filter(r=>r.kind==='shift').length,4);
 assert.ok(!p.records.some(r=>r.id==='few'||r.id==='shift-few'));
 const signature=x=>checkinPatterns(x).map(p=>({personId:p.personId,ids:p.latest.map(r=>r.id),rough:p.rough,flagged:p.flagged}));
 const beforeOwner=signature(w),beforeGM=signature(gm);ok((await f.archive()).result);
 assert.deepEqual(signature(await f.view()),beforeOwner);assert.deepEqual(signature(await f.view('gm')),beforeGM);
 // Equivalent instants compare by ID, not by the lexicographic offset text.
 const records=w.records.filter(r=>r.kind==='shiftcheckin').slice(0,6).map((r,i)=>({...r,id:'offset-'+i,data:{...r.data,shiftId:'unique-'+i,shift:{...r.data.shift,end:i===5?'2026-02-01T01:00:00+03:00':'2026-01-31T22:00:00Z'}}}));
 assert.deepEqual(checkinPatterns({...w,records})[0].latest.map(r=>r.id),['offset-5','offset-4','offset-3','offset-2','offset-1']);
});
test('employee restores only their archived response, corrects it, and cannot submit a second response to the old shift',async t=>{
 const f=await fixture(t);for(let i=1;i<=6;i++)await f.put('c'+i,'FOH',`2026-01-${10+i}T23:00:00Z`);ok((await f.archive()).result);
 const detail=ok(await f.read('worker',{recordId:'c1'}));assert.equal(detail.canRestore,true);assert.equal(detail.workspace.records.find(r=>r.id==='c1').data.note,'Private fictional note c1');
 const p=ok(await f.read('worker',{restore:'c1'}));assert.deepEqual(p.records.map(r=>r.id),['c1']);
 const body=f.restoreBody(p,'c1'),restored=ok(await f.post('worker',body));assert.deepEqual(ok(await f.post('worker',body)),restored);
 assert.ok((await f.db.prepare("SELECT archived_at FROM records WHERE id='shift-c1'").first()).archived_at);
 const r=(await f.view('worker')).records.find(r=>r.id==='c1');ok(await f.command('worker','shiftcheckin.correct',{experience:'okay',note:'Correction from history',reason:'Wrong original selection'},r));
 const corrected=(await f.view('worker')).records.find(r=>r.id==='c1');assert.equal(corrected.data.versions[0].experience,'rough');assert.equal(corrected.data.versions[0].note,'Private fictional note c1');assert.equal(corrected.data.shiftId,'shift-c1');
 assert.equal((await f.command('owner','shiftcheckin.correct',{experience:'good',reason:'Override'},corrected)).status,403);
 // Recreate a valid old source visibility situation without altering the response.
 await f.db.prepare("UPDATE records SET archived_at=NULL,archived_by=NULL WHERE id='shift-c1'").run();
 await f.db.prepare("UPDATE records SET archived_at=?,archived_by='owner' WHERE id='c1'").bind(filed).run();
 assert.equal((await f.command('worker','shiftcheckin.submit',{shiftId:'shift-c1',shiftRevision:2,experience:'good',shareConfirmed:true})).status,409);
 assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='shiftcheckin' AND json_extract(data,'$.shiftId')='shift-c1'").first()).n,1);
});
test('history does not broaden readers, GM department scope, ordinary employee restoration or current access',async t=>{
 const f=await fixture(t);await f.put('private','FOH',undefined,filed);await f.put('boh-private','BOH',undefined,filed);
 for(const who of ['coworker','manager','dish']){assert.equal(ok(await f.read(who,{kind:'shiftcheckin'})).items.length,0);assert.equal((await f.read(who,{recordId:'private'})).status,404);assert.equal((await f.read(who,{restore:'private'})).status,403)}
 assert.equal((await f.read('foreign',{restore:'private'})).status,403);
 assert.deepEqual(ok(await f.read('gm',{kind:'shiftcheckin'})).items.map(x=>x.record.id),['private']);assert.equal((await f.read('gm',{restore:'boh-private'})).status,403);
 assert.equal((await f.read('worker',{restore:'shift-private'})).status,403);
 const p=ok(await f.read('worker',{restore:'private'})),body=f.restoreBody(p,'private');
 assert.equal((await f.post('worker',{...body,records:[...body.records,{id:'shift-private',revision:1}]})).status,409);
 assert.equal((await f.post('worker',{...body,action:'archive',before})).status,403);
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='gm'").run();assert.equal((await f.read('gm',{recordId:'private'})).status,404);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'").run();assert.equal((await f.post('worker',body)).status,403);
});
test('self restoration is atomic, safe to retry, and rejected when authority changes at commit',async t=>{
 const f=await fixture(t);await f.put('private','FOH',undefined,filed);const p=ok(await f.read('worker',{restore:'private'})),body=f.restoreBody(p,'private');
 await f.db.prepare("CREATE TRIGGER fail_restore BEFORE INSERT ON audit_events WHEN NEW.action='history.restore' BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
 assert.equal((await f.post('worker',body)).status,503);assert.ok((await f.db.prepare("SELECT archived_at FROM records WHERE id='private'").first()).archived_at);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM command_receipts').first()).n,0);
 await f.db.prepare('DROP TRIGGER fail_restore').run();ok(await f.post('worker',body));ok(await f.post('worker',body));
 assert.equal((await f.db.prepare("SELECT count(*) n FROM audit_events WHERE action='history.restore'").first()).n,1);
 await f.put('race','FOH',undefined,filed);const rp=ok(await f.read('worker',{restore:'race'}));let batches=0;
 const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'").run();return f.db.batch(statements)}})};
 assert.equal((await f.post('worker',f.restoreBody(rp,'race'),binding)).status,409);assert.ok((await f.db.prepare("SELECT archived_at FROM records WHERE id='race'").first()).archived_at);
});
test('3005 archived check-ins page without loss or growing the active daily payload, with restaurant-calendar date filters',async t=>{
 const f=await fixture(t);for(let i=1;i<=5;i++)await f.put('current'+i,'FOH',`2026-01-${10+i}T23:00:00Z`);
 const bytes=JSON.stringify(await f.view()).length,data={title:'Shift check-in',employeeName:'worker',shiftId:'historical-source',shiftRevision:1,shift:{start:'2026-03-09T03:30:00Z',end:'2026-03-09T04:30:00Z',position:'Fixture'},experience:'okay',note:'Fictional historical note',submittedAt:old,versions:[],history:[]};
 await f.db.batch(Array.from({length:3005},(_,i)=>f.db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at,archived_by) VALUES(?,?,?,?,?,1,?,?,?,?)').bind('history-'+String(i).padStart(4,'0'),'berts','shiftcheckin','worker','FOH',JSON.stringify({...data,shiftId:'historical-source-'+i}),old,filed,'owner')));
 assert.equal(JSON.stringify(await f.view()).length,bytes);assert.equal(checkinPatterns(await f.view())[0].count,5);
 let cursor,seen=new Set();do{const page=ok(await f.read('worker',{kind:'shiftcheckin',...(cursor?{cursor}:{})}));assert.ok(page.items.length<=50);for(const x of page.items){assert.ok(!seen.has(x.record.id));seen.add(x.record.id)}cursor=page.nextCursor;}while(cursor);assert.equal(seen.size,3005);
 assert.equal(ok(await f.read('worker',{kind:'shiftcheckin',from:'2026-03-08',through:'2026-03-08'})).items.length,50);assert.equal(ok(await f.read('worker',{kind:'shiftcheckin',from:'2026-03-09'})).items.length,0);
});
test('a changed check-in invalidates an archive preview, and recently corrected old entries stay active',async t=>{
 const f=await fixture(t);for(let i=1;i<=6;i++)await f.put('c'+i,'FOH',`2026-01-${10+i}T23:00:00Z`);
 const p=ok(await f.read('owner',{preview:'1',before})),body={action:'archive',locationId:'berts',requestId:crypto.randomUUID(),confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records};
 const c=(await f.view('worker')).records.find(r=>r.id==='c1');ok(await f.command('worker','shiftcheckin.correct',{experience:'good',reason:'Reviewed own original'},c));
 assert.equal((await f.post('owner',body)).status,409);assert.equal(ok(await f.read('owner',{preview:'1',before})).records.some(r=>r.id==='c1'||r.id==='shift-c1'),false);
});
