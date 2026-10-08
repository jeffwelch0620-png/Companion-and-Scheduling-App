import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {applyCommand} from '../.sites-runtime/shared/domain.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {managerHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
import {checkinPatterns} from '../.sites-runtime/shared/shift-checkin.mjs';
import {recordDependencies,historyPlan} from '../.sites-runtime/shared/record-history.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a',position='Manager'] of [['owner','Executive',['location.manage']],['otherowner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['opener','BOH',['tasks.manage']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['dish','BOH',['location.manage'],'a','Dishwasher'],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,position,JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={})=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),db);return {status:response.status,data:await response.json()}};
 const view=async(id,loc='a')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);return {status:r.status,data:await r.json()}};
 return {db,call,view,headers};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
async function shift(f,id='shift-1',owner='worker',end='2026-09-20T22:00:00Z',patch={}){
 const data={personId:owner,start:end.replace('22:00','16:00'),end,position:'Fry',published:true,cancelled:false,...patch};
 await f.db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(id,'a','shift',owner,'BOH',JSON.stringify(data),data.start).run();return {shiftId:id,shiftRevision:1,experience:'rough',note:'Fictional shift response',shareConfirmed:true};
}
const saved=async(f,id,r)=>ok(await f.view(id)).records.find(x=>x.id===r.recordId);
test('check-ins belong to the employee; current GM authority and restaurant scope gate review',async t=>{
 const f=await fixture(t),input=await shift(f),r=ok(await f.call('worker','shiftcheckin.submit',input));
 assert.equal(r.revision,1);assert.equal((await saved(f,'worker',r)).data.experience,'rough');assert.ok(await saved(f,'owner',r));
 for(const who of ['manager','foh','opener','dish'])assert.equal(await saved(f,who,r),undefined);
 assert.equal((await f.call('owner','shiftcheckin.submit',input)).status,403);
 assert.equal((await f.call('manager','shiftcheckin.correct',{experience:'good',reason:'Override'},r)).status,404);
 assert.equal((await f.call('owner','shiftcheckin.correct',{experience:'good',reason:'Override'},r)).status,403);
 assert.equal((await f.call('foreign','shiftcheckin.submit',input)).status,403);
 await f.db.prepare("UPDATE memberships SET capabilities='[\"people.approve\"]' WHERE id IN ('manager','foh')").run();
 assert.ok(await saved(f,'manager',r));assert.equal(await saved(f,'foh',r),undefined);
 await f.db.prepare("UPDATE memberships SET capabilities='[]' WHERE id='manager'").run();assert.equal(await saved(f,'manager',r),undefined);
 const w=ok(await f.view('owner')),at=new Date().toISOString();
 for(const output of [managerHandoff(w,'2026-09-21'),operationsHome(w,at),companionContext(w,'How was work?',at)])assert.ok(!JSON.stringify(output).includes(input.note));
 assert.equal(w.records.some(x=>x.kind==='message'||x.kind==='attendance'),false);
});
test('completed published shift and explicit sharing are required; revisions and duplicates are protected',async t=>{
 const f=await fixture(t),input=await shift(f);
 for(const patch of [{experience:'bad'},{shareConfirmed:false},{note:'x'.repeat(2001)},{shiftId:'missing'},{shiftRevision:2}])assert.notEqual((await f.call('worker','shiftcheckin.submit',{...input,...patch})).status,200);
 for(const [id,patch,end] of [['draft',{published:false}],['cancelled',{cancelled:true}],['future',{},'2099-09-20T22:00:00Z']]){
  const candidate=await shift(f,id,'worker',end,patch);assert.equal((await f.call('worker','shiftcheckin.submit',candidate)).status,400);
 }
 const extra={requestId:'checkin-repeat'},r=ok(await f.call('worker','shiftcheckin.submit',input,undefined,extra));
 assert.deepEqual(ok(await f.call('worker','shiftcheckin.submit',input,undefined,extra)),r);
 assert.equal((await f.call('worker','shiftcheckin.submit',{...input,experience:'good'},undefined,extra)).status,409);
 assert.equal((await f.call('worker','shiftcheckin.submit',input)).status,409);
 assert.equal((await f.call('worker','shiftcheckin.unknown',input)).status,400);
 const another=await shift(f,'race');const results=await Promise.all([f.call('worker','shiftcheckin.submit',another),f.call('worker','shiftcheckin.submit',another)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
});
test('corrections preserve previous responses and cannot change the shift or person',async t=>{
 const f=await fixture(t),input=await shift(f);let r=ok(await f.call('worker','shiftcheckin.submit',input));
 assert.equal((await f.call('worker','shiftcheckin.correct',{experience:'good'},r)).status,400);
 const original=r;r=ok(await f.call('worker','shiftcheckin.correct',{experience:'good',note:'Corrected thought',reason:'Tapped wrong response',shiftId:'other',personId:'owner'},r));
 const record=await saved(f,'worker',r);assert.equal(record.ownerId,'worker');assert.equal(record.data.shiftId,input.shiftId);assert.equal(record.data.versions[0].experience,'rough');assert.equal(record.data.versions[0].note,input.note);assert.equal(record.data.experience,'good');assert.equal(record.data.history.length,2);
 assert.equal((await f.call('worker','shiftcheckin.correct',{experience:'okay',reason:'Stale'},original)).status,409);
 await f.db.prepare("UPDATE records SET data=json_set(data,'$.cancelled',json('true')),revision=revision+1 WHERE id='shift-1'").run();
 r=ok(await f.call('worker','shiftcheckin.correct',{experience:'okay',reason:'Historical response correction'},r));assert.equal((await saved(f,'worker',r)).data.shift.end,'2026-09-20T22:00:00Z');
});
test('three rough of latest five distinct submitted shifts flags; corrections and newer shifts recompute it',async t=>{
 const f=await fixture(t);let records=[];
 for(let i=1;i<=5;i++)records.push(ok(await f.call('worker','shiftcheckin.submit',{...await shift(f,'s'+i,'worker',`2026-09-${10+i}T22:00:00Z`),experience:i<=3?'rough':'good'})));
 let w=ok(await f.view('owner')),p=checkinPatterns(w)[0];assert.equal(p.flagged,true);assert.equal(p.rough,3);assert.equal(p.count,5);
 assert.equal(checkinPatterns({...w,records:w.records.filter(r=>r.id!==records[4].recordId)})[0].flagged,false);
 assert.deepEqual(checkinPatterns({...w,me:ok(await f.view('manager')).me}),[]);
 const duplicate=w.records.find(r=>r.id===records[0].recordId);assert.equal(checkinPatterns({...w,records:[...w.records,{...duplicate,id:'duplicate'}]})[0].count,5);
 await f.call('worker','shiftcheckin.correct',{experience:'okay',reason:'Wrong selection'},records[2]);p=checkinPatterns(ok(await f.view('owner')))[0];assert.equal(p.flagged,false);assert.equal(p.rough,2);
 ok(await f.call('worker','shiftcheckin.submit',{...await shift(f,'old','worker','2026-09-01T22:00:00Z'),experience:'rough'}));assert.equal(checkinPatterns(ok(await f.view('owner')))[0].rough,2,'Late submission of older shift must not displace latest five');
 ok(await f.call('worker','shiftcheckin.submit',{...await shift(f,'new','worker','2026-09-16T22:00:00Z'),experience:'good'}));p=checkinPatterns(ok(await f.view('owner')))[0];assert.equal(p.rough,1);assert.equal(p.latest[0].data.shiftId,'new');
});
test('failed persistence rolls back check-in and audit; active response retains its source shift',async t=>{
 const f=await fixture(t),input=await shift(f);
 await f.db.prepare("CREATE TRIGGER fail_checkin BEFORE INSERT ON command_receipts WHEN NEW.request_id='checkin-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await f.call('worker','shiftcheckin.submit',input,undefined,{requestId:'checkin-fail'})).status,503);
 assert.equal(ok(await f.view('worker')).records.some(r=>r.kind==='shiftcheckin'),false);
 assert.equal((await f.db.prepare("SELECT count(*) n FROM audit_events WHERE action LIKE 'shiftcheckin.%'").first()).n,0);
 const r=ok(await f.call('worker','shiftcheckin.submit',input));const w=ok(await f.view('owner')),record=w.records.find(x=>x.id===r.recordId);assert.deepEqual(recordDependencies(record),[input.shiftId]);assert.equal(historyPlan(w,'2099-01-01').records.some(x=>x.id===input.shiftId),false);
 await f.db.prepare("UPDATE memberships SET schedule_only=1 WHERE id='worker'").run();assert.notEqual((await f.call('worker','shiftcheckin.correct',{experience:'good',reason:'Inactive'},r)).status,200);
});
