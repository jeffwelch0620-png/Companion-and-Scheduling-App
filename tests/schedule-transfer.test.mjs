import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleScheduleTransfer} from '../.sites-runtime/shared/schedule-transfer.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {weekCopyPlan} from '../.sites-runtime/shared/week-copy.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare('INSERT INTO locations(id,name,timezone) VALUES (?,?,?)').bind('a','Fictional','America/New_York').run();
 await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities) VALUES (?,?,?,?,?,?,?,?)').bind('admin','admin@example.test','admin','a','Test admin','BOH','Owner','["location.manage","schedule.manage","schedule.publish","schedule.change"]').run();
 const shift=(employee,date,start,end,minutes,endsNextDay=false)=>({employee,date,start,end,minutes,endsNextDay,job:'Cook',schedule:'BOH',meal:'',break:'',sourceRow:2});
 const source={id:'source',weekStart:'2026-09-09',weekEnd:'2026-09-15',shifts:[shift('Test Alex','2026-09-09','11:00 AM','3:00 PM',240),shift('Test Alex','2026-09-09','4:00 PM','10:00 PM',360),shift('Test Sam','2026-09-15','8:00 PM','2:00 AM',360,true)],employees:2,minutes:960,days:[],warnings:[]};
 await db.prepare('INSERT INTO schedule_imports(id,location_id,week_start,source_hash,data,imported_at,imported_by) VALUES(?,?,?,?,?,?,?)').bind('source','a',source.weekStart,'hash',JSON.stringify(source),'2026-09-10T00:00:00Z','admin').run();
 const headers={'oai-authenticated-user-id':'admin','oai-authenticated-user-email':'admin@example.test'};
 const call=async(input=null,identity=true,binding=db)=>{const r=await handleScheduleTransfer(new Request('https://example.test/api/schedule-transfer?locationId=a',{headers:{...(identity?headers:{}),...(input?{Origin:'https://example.test','Content-Type':'application/json'}:{})},...(input?{method:'POST',body:JSON.stringify(input)}:{})}),binding);return {status:r.status,data:await r.json()}};
 const workspace=async()=>{const r=await handleWorkspace(new Request('https://example.test/api/workspace?locationId=a',{headers}),db);return r.json()};
 return {db,call,workspace,source};
}
test('saved week becomes native editable shifts and a roster without enabling sign-in, granting permissions, training or duplicate records',async t=>{
 const f=await fixture(t),preview=await f.call();assert.equal(preview.status,200);assert.equal(preview.data.shifts,3);assert.deepEqual(preview.data.conflicts,[]);
 const input={locationId:'a',sourceId:'source',revision:preview.data.revision,confirmed:true};assert.equal((await f.call(input)).status,200);
 const w=await f.workspace();assert.equal(w.location.weekStartsOn,3);assert.equal(w.members.length,3);assert.equal(w.records.length,3);assert.equal(w.records.filter(r=>r.kind==='message').length,0);assert.ok(w.records.every(r=>r.kind==='shift'&&r.data.published));
 assert.ok(w.members.filter(m=>m.scheduleOnly).every(m=>m.capabilities.length===0&&m.qualifications.length===0&&m.scheduleJobs[0]==='Cook'));
 const rows=(await f.db.prepare('SELECT active,auth_user_id,email FROM memberships WHERE schedule_only=1').all()).results;assert.ok(rows.every(p=>p.active===0&&p.auth_user_id===null&&p.email===''));
 assert.equal(w.records.find(r=>r.data.start==='2026-09-16T00:00:00.000Z').data.end,'2026-09-16T06:00:00.000Z');
 const copied=weekCopyPlan(w,{sourceWeek:'2026-09-09',targetWeek:'2026-09-16',shiftIds:w.records.map(r=>r.id),staffingIds:[],repeated:''});assert.equal(copied.shifts.length,3);
 assert.equal((await f.call(input)).status,200);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM records').first()).n,3);assert.equal((await f.call()).data.pending,false);
 const anonymous=await handleWorkspace(new Request('https://example.test/api/workspace?locationId=a'),f.db);assert.equal(anonymous.status,401);
});
test('ambiguous/inactive name, unauthorized access, stale review and lost authority do not partially transfer',async t=>{
 const f=await fixture(t);assert.equal((await f.call(null,false)).status,401);
 assert.equal((await f.call({locationId:'a',sourceId:'source',revision:99,confirmed:true})).status,409);
 await f.db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,active) VALUES(?,?,?,?,?,?,0)').bind('archived','old@example.test','a','Test Alex','BOH','Cook').run();
 assert.deepEqual((await f.call()).data.conflicts,['Test Alex']);assert.equal((await f.call({locationId:'a',sourceId:'source',revision:0,confirmed:true})).status,409);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM records').first()).n,0);
});
test('authority revoked while transferring cannot create staff, shifts or mark source consumed',async t=>{
 const f=await fixture(t);let batches=0;const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind('admin').run();return f.db.batch(statements)}})};
 const r=await f.call({locationId:'a',sourceId:'source',revision:0,confirmed:true},true,binding);assert.equal(r.status,409);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM records').first()).n,0);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM memberships').first()).n,1);assert.equal((await f.db.prepare('SELECT transferred_at FROM schedule_imports').first()).transferred_at,null);
});
