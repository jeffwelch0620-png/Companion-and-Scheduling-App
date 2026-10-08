import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { parseHotSchedules } from '../.sites-runtime/shared/hotschedules-import.mjs';
import { handleScheduleImport } from '../.sites-runtime/shared/schedule-import-service.mjs';

process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const days=['Wed','Thu','Fri','Sat','Sun','Mon','Tue'];
const header=['Employee',...days.flatMap(d=>['Shift','Schedule','Job','Meal','Break'].map(f=>d+' '+f))];
const quote=v=>'"'+v.replaceAll('"','""')+'"';
function row(name,shifts){return [name,...days.flatMap((_,i)=>shifts[i]??['-','-','-','-','-'])]}
function csv(rows){return [header,...rows].map(r=>r.map(quote).join(',')).join('\r\n')}
const sample=csv([
 row('Test, Alex',{0:['11:00 AM - 3:00 PM','BOH','Cook','-','-'],6:['8:00 PM - 2:00 AM','BOH','Cook','-','-']}),
 row('Test, Alex',{0:['4:00 PM - 10:00 PM','BOH','Cook','-','-']}),
 row('Test Sam',{4:['11:00 AM - 4:15 PM','FOH','Salad bar','30 minutes','10 minutes']}),
]);
const weekStart='2026-09-09',fileName='Weekly_Roster_09092026_09152026.csv';
test('preserves Wednesday week, quoted names, split shifts, overnight ending, job and breaks',()=>{
 const w=parseHotSchedules('\uFEFF'+sample,weekStart,fileName);
 assert.equal(w.weekEnd,'2026-09-15');assert.equal(w.employees,2);assert.equal(w.shifts.length,4);assert.equal(w.minutes,1275);
 assert.deepEqual(w.days.map(d=>d.shifts),[2,0,0,0,1,0,1]);
 assert.equal(w.shifts.find(s=>s.date==='2026-09-15').endsNextDay,true);
 assert.equal(w.shifts.find(s=>s.employee==='Test Sam').meal,'30 minutes');assert.equal(w.warnings.length,1);
});
test('rejects wrong dates, changed schema, duplicate shifts, incomplete rows and malformed CSV',()=>{
 for(const [value,date,file] of [[sample,'2026-09-10',''],[sample,'2026-09-16',fileName],[sample,'2026-02-30',''],[sample.replace('Employee','Employee,Phone Number'),weekStart,''],[sample+'\n"never closed',weekStart,''],[csv([row('Test A',{0:['3:00 PM - 3:00 PM','BOH','Cook','-','-']})]),weekStart,''],[csv([row('Test A',{0:['13:00 PM - 4:00 PM','BOH','Cook','-','-']})]),weekStart,''],[csv([row('Test A',{0:['-','BOH','Cook','-','-']})]),weekStart,'']])assert.throws(()=>parseHotSchedules(value,date,file));
 assert.throws(()=>parseHotSchedules(csv([row('Test A',{0:['3:00 PM - 4:00 PM','BOH','Cook','-','-']}),row('Test A',{0:['3:00 PM - 4:00 PM','BOH','Cook','-','-']})]),weekStart));
 assert.throws(()=>parseHotSchedules('x'.repeat(100001),weekStart));
 const overlapped=parseHotSchedules(csv([row('Test A',{0:['3:00 PM - 5:00 PM','BOH','Cook','-','-']}),row('Test A',{0:['4:00 PM - 6:00 PM','FOH','Server','-','-']})]),weekStart);assert.match(overlapped.warnings[0],/overlap/);
});

async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES (?,?,?)').bind(id,'Fictional '+id,'America/New_York').run();
 for(const [id,location,caps,position] of [['admin','a',['location.manage'],'Owner'],['worker','a',[],'Cook'],['other','b',['location.manage'],'Owner'],['dish','a',['location.manage'],'Dishwasher']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',id+'-identity',location,'Test '+id,'BOH',position,JSON.stringify(caps),'[]').run();
 async function call(actor='admin',input=null,options={}){
  const headers=actor?{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}:{};
  const request=new Request('https://test.example/api/integrations/hotschedules?locationId='+(options.location??'a')+(options.week?'&weekStart='+options.week:''),{headers:{...headers,...(input?{Origin:options.origin??'https://test.example','Content-Type':'application/json'}:{})},...(input?{method:'POST',body:JSON.stringify({locationId:'a',action:'preview',csv:sample,weekStart,fileName,...input})}:{})});
  const response=await handleScheduleImport(request,options.binding??db);return {status:response.status,headers:response.headers,data:await response.json()};
 }
 const count=async(table)=>(await db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
 return {db,call,count};
}
test('protected preview does not save; save/reload keeps every shift and imports once without altering staff or live records',async t=>{
 const f=await fixture(t),membersBefore=await f.db.prepare('SELECT * FROM memberships ORDER BY id').all();
 const p=await f.call('admin',{});assert.equal(p.status,200);assert.equal(p.data.preview.shifts.length,4);assert.equal(await f.count('schedule_imports'),0);
 const result=await f.call('admin',{action:'save',confirmed:true,expectedLatestId:p.data.expectedLatestId});assert.equal(result.status,200,JSON.stringify(result.data));
 const saved=result.data.saved;const reload=await f.call();assert.deepEqual(reload.data.saved,saved);assert.match(reload.headers.get('Cache-Control'),/private, no-store/);
 const repeat=await f.call('admin',{action:'save',confirmed:true,expectedLatestId:null});assert.equal(repeat.data.repeated,true);assert.equal(await f.count('schedule_imports'),1);assert.equal(await f.count('audit_events'),1);assert.equal(await f.count('records'),0);assert.deepEqual((await f.db.prepare('SELECT * FROM memberships ORDER BY id').all()).results,membersBefore.results);
 for(const actor of [null,'worker','other','dish']){assert.equal((await f.call(actor)).status,actor?403:401);assert.equal((await f.call(actor,{action:'save',confirmed:true,expectedLatestId:null})).status,actor?403:401);}
 assert.equal((await f.call('admin',{}, {origin:'https://untrusted.example'})).status,403);
 assert.equal((await f.call('admin',{action:'save',expectedLatestId:null})).status,400);
 assert.equal((await f.call('admin',{csv:'x'.repeat(128000)})).status,413);
 assert.equal((await f.call('admin',{timezone:'UTC'})).status,400);
 assert.equal((await f.call('other',null,{location:'b'})).data.saved,null);
});
test('replacement requires the reviewed version; prior snapshots retained and old files cannot silently revert a week',async t=>{
 const f=await fixture(t);
 const first=await f.call('admin',{action:'save',confirmed:true,expectedLatestId:null});assert.equal(first.status,200);
 const changed=sample.replace('4:15 PM','4:30 PM');
 assert.equal((await f.call('admin',{action:'save',csv:changed,confirmed:true,expectedLatestId:null})).status,409);
 const p=await f.call('admin',{csv:changed});const second=await f.call('admin',{action:'save',csv:changed,confirmed:true,expectedLatestId:p.data.expectedLatestId});assert.equal(second.status,200);
 assert.equal(await f.count('schedule_imports'),2);assert.equal((await f.call()).data.weeks.length,1);assert.equal((await f.call()).data.saved.id,second.data.saved.id);
 assert.equal((await f.call('admin',{action:'save',csv:sample,confirmed:true,expectedLatestId:second.data.saved.id})).status,409);
 assert.equal((await f.call('admin',{csv:'bad'})).status,400);assert.equal((await f.call()).data.saved.id,second.data.saved.id);
});
test('authority changes at commit prevent import and audit atomically',async t=>{
 const f=await fixture(t);let changed=false;
 const binding={withSession:()=>({prepare:(...a)=>f.db.prepare(...a),batch:async statements=>{if(!changed){changed=true;await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind('admin').run();}return f.db.batch(statements);}})};
 const result=await f.call('admin',{action:'save',confirmed:true,expectedLatestId:null},{binding});assert.equal(result.status,409);assert.equal(await f.count('schedule_imports'),0);assert.equal(await f.count('audit_events'),0);
});
