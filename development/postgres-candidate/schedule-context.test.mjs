import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {connection} from './test-config.mjs';
import {PostgresDatabase} from './postgres-driver.ts';
import {createTaskHandler} from './task-http.ts';
import {visible} from './runtime/closing-reference/domain.mjs';
import {canScheduleJob} from './runtime/closing-reference/types.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:2}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:3});
after(async()=>{await admin.end();await db.close();});
async function fixture() {
 const scope=`context-${randomUUID()}`,subject=`context-${randomUUID()}`,session=randomUUID();
 await admin.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional schedule context']);
 const members=[];
 for(const [area,active,scheduleOnly] of [['BOH',true,false],['BOH',true,true],['FOH',true,false],['BOH',false,false],['FOH',false,true]]) {
  const m={id:randomUUID(),person:randomUUID(),area,active,scheduleOnly};
  await admin.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[m.person,'Fictional roster employee']);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position,active,schedule_only) VALUES($1,$2,$3,$4,'Cook',$5,$6)",[m.id,m.person,scope,area,active,scheduleOnly]);members.push(m);
 }
 await admin.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,members[0].person]);
 await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[session,subject]);
 await admin.query("INSERT INTO candidate_identity.schedule_eligibility(member_id,job,source,active) VALUES($1,'Cook','qualification',true),($1,'Dishwasher','schedule-job',true),($1,'Chef','schedule-job',false)",[members[1].id]);
 const records=[];
 for(const m of members.slice(0,3)) for(const status of ['pending','approved','declined','superseded']) {
  const record={id:randomUUID(),locationId:scope,ownerId:m.id,area:m.area,revision:2,kind:'availability',updatedAt:'2031-11-01T12:00:00Z',data:{startDate:'2031-11-01',endDate:'2031-11-03',days:[0],excludedDates:['2031-11-03'],startMinute:60,endMinute:120,beforeMinutes:30,afterMinutes:20,title:'Fictional school hours',kind:'school',status,decision:status==='approved'?'Fictional independent review':''}};
  await admin.query('INSERT INTO candidate_operations.availability_references(id,restaurant_id,member_id,department,revision,updated_at,status,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[record.id,scope,m.id,m.area,2,record.updatedAt,status,JSON.stringify(record.data)]);records.push(record);
 }
 return {scope,subject,session,id:members[0].id,members,records};
}
const list=(f,kind,after=null,limit=100)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.list_schedule_context($1,$2,$3,$4,$5,$6) AS result',[f.subject,f.id,f.scope,kind,after,limit])).rows[0].result);
async function grant(f,caps) {
 await admin.query('DELETE FROM candidate_identity.membership_capabilities WHERE membership_id=$1',[f.id]);
 for(const cap of caps)await admin.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[f.id,cap]);
}
test('roster preserves original membership inclusion and scheduling eligibility without access or training grants',async()=>{
 const f=await fixture(),roster=(await list(f,'roster')).items;
 assert.deepEqual(roster.map(m=>m.id),f.members.filter(m=>m.active||m.scheduleOnly).map(m=>m.id).sort());
 const scheduled=roster.find(m=>m.id===f.members[1].id);assert.deepEqual(scheduled.qualifications,['Cook']);assert.deepEqual(scheduled.scheduleJobs,['Dishwasher']);
 assert.equal(canScheduleJob(scheduled,'Cook'),true);assert.equal(canScheduleJob(scheduled,'Dishwasher'),true);assert.equal(canScheduleJob(scheduled,'Chef'),false);
 assert.equal(canScheduleJob(roster.find(m=>m.id===f.id),'Cook'),false); // Position alone is not eligibility.
 for(const field of ['authUserId','personId','email','capabilities'])assert.equal(Object.hasOwn(scheduled,field),false);
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_identity.auth_links WHERE person_id=$1',[f.members[1].person])).rows[0].n,0);
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_identity.station_clearances WHERE member_id=$1',[f.members[1].id])).rows[0].n,0);
});
test('availability read visibility matches original source across owners, departments, status and scheduling grants',async()=>{
 const f=await fixture();
 for(const capabilities of [[],['schedule.manage'],['schedule.publish'],['schedule.change'],['people.manage'],['location.manage'],['schedule.manage','location.manage'],['schedule.publish','location.manage']]) {
  await grant(f,capabilities);
  const me={id:f.id,locationId:f.scope,name:'Fictional reader',area:'BOH',position:'Cook',capabilities,qualifications:[]};
  assert.deepEqual((await list(f,'availability')).items.map(r=>r.id),f.records.filter(r=>visible(r,me)).map(r=>r.id).sort(),JSON.stringify(capabilities));
 }
});
test('context paging preserves availability dates, buffers and exceptions; revoked grants narrow later pages',async()=>{
 const f=await fixture();await grant(f,['schedule.manage','location.manage']);
 const ids=[];let cursor=null;
 do {const page=await list(f,'availability',cursor,3);assert.equal(page.timezone,'America/New_York');
  for(const r of page.items){ids.push(r.id);assert.deepEqual(r.data,f.records.find(s=>s.id===r.id).data);assert.equal(r.revision,2);}cursor=page.nextCursor;
 }while(cursor);
 assert.deepEqual(ids,f.records.map(r=>r.id).sort());
 await admin.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[f.id]);assert.equal((await list(f,'availability')).items.length,4);
 const page=await list(f,'roster',null,1);assert.equal(page.items.length,1);assert.ok(page.nextCursor);
 for(const kind of ['invalid',null])await assert.rejects(list(f,kind),e=>e.code==='22023');
});
test('cross-scope and schedule-only actors are denied; runtime cannot inspect or alter reference tables',async()=>{
 const f=await fixture(),foreign=await fixture();
 await assert.rejects(list({...f,scope:foreign.scope},'roster'),e=>e.code==='42501');
 await assert.rejects(list({...f,subject:'wrong'},'availability'),e=>e.code==='42501');
 await admin.query('UPDATE candidate_identity.memberships SET schedule_only=true WHERE id=$1',[f.id]);await assert.rejects(list(f,'roster'),e=>e.code==='42501');
 for(const table of ['candidate_identity.schedule_eligibility','candidate_operations.availability_references']) {
  await assert.rejects(db.transaction(c=>c.query(`SELECT * FROM ${table}`,[])),e=>e.code==='42501');
  await assert.rejects(db.transaction(c=>c.query(`INSERT INTO ${table} DEFAULT VALUES`,[])),e=>e.code==='42501');
 }
});
test('HTTP roster and availability routes resolve sessions, validate paging and stop after session revocation',async()=>{
 const f=await fixture(),handler=createTaskHandler(db,async()=>({subject:f.subject,sessionId:f.session}));
 const request=(kind,suffix='')=>new Request(`https://candidate.invalid/api/operations/${f.scope}/schedule-${kind}${suffix}`,{headers:{Authorization:'Bearer fictional-verified-session'}});
 for(const kind of ['roster','availability']) {
  const response=await handler(request(kind,'?limit=1'));assert.equal(response.status,200);assert.equal((await response.json()).items.length,1);
  for(const suffix of ['?limit=0','?limit=1&limit=2','?after=bad','?department=FOH',`/${randomUUID()}`])assert.equal((await handler(request(kind,suffix))).status,400);
 }
 await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[f.session]);
 assert.equal((await handler(request('roster'))).status,401);assert.equal((await handler(request('availability'))).status,401);
});
