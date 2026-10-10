import {fictionalStoreInsert} from './store-fixture.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {connection} from './test-config.mjs';
import {PostgresDatabase} from './postgres-driver.ts';
import {createTaskHandler} from './task-http.ts';
import {visible} from './runtime/closing-reference/domain.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:2}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:3});
after(async()=>{await admin.end();await db.close();});
async function fixture() {
 const scope=`schedule-${randomUUID()}`,person=randomUUID(),id=randomUUID(),subject=`schedule-${randomUUID()}`,session=randomUUID();
 await admin.query(fictionalStoreInsert,[scope,'Fictional schedule']);
 await admin.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional reader']);
 await admin.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
 await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[id,person,scope]);
 await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[session,subject]);
 const records=[];
 for(const area of ['BOH','FOH']) {
  const otherPerson=randomUUID(),other=randomUUID();
  await admin.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[otherPerson,'Fictional scheduled employee']);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position,schedule_only) VALUES($1,$2,$3,$4,'Cook',true)",[other,otherPerson,scope,area]);
  for(const ownerId of area==='BOH'?[id,other]:[other]) for(const published of [false,true]) {
   const record={id:randomUUID(),locationId:scope,ownerId,area,revision:3,kind:'shift',data:{personId:ownerId,position:'Cook',start:'2031-11-02T01:15:00-04:00',end:'2031-11-02T02:15:00-05:00',published,cancelled:false}};
   if(!published){record.data.start='2031-10-26T01:15:00-04:00';record.data.end='2031-10-26T03:15:00-04:00';}
   await admin.query(`INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published)
    VALUES($1,$2,$3,$4,'Cook',$5,$6,3,$7)`,[record.id,scope,ownerId,area,record.data.start,record.data.end,published]); records.push(record);
  }
 }
 return {scope,id,subject,session,records};
}
async function grant(f,caps,position='Cook') {
 await admin.query('DELETE FROM candidate_identity.membership_capabilities WHERE membership_id=$1',[f.id]);
 for(const cap of caps) await admin.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[f.id,cap]);
 await admin.query('UPDATE candidate_identity.memberships SET position=$2 WHERE id=$1',[f.id,position]);
}
const list=(f,after=null,limit=100)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.list_schedule_shifts($1,$2,$3,$4,$5) AS result',[f.subject,f.id,f.scope,after,limit])).rows[0].result);
test('schedule shift visibility matches original domain across grants, departments, titles and draft/published state',async()=>{
 const f=await fixture();
 const profiles=[[],['schedule.manage'],['schedule.publish'],['schedule.change'],['location.manage'],['people.manage'],['tasks.manage'],['close.confirm'],['close.confirm','tasks.manage','operations.store'],['schedule.manage','location.manage']];
 for(const position of ['Cook','GM','Dishwasher']) for(const capabilities of profiles) {
  await grant(f,capabilities,position);
  const me={id:f.id,locationId:f.scope,name:'Fictional reader',area:'BOH',position,capabilities,qualifications:[]};
  const expected=f.records.filter(r=>visible(r,me)).map(r=>r.id).sort();
  assert.deepEqual((await list(f)).items.map(r=>r.id),expected,JSON.stringify({position,capabilities}));
 }
});
test('pagination filters before page size, retains reference fields and real instants, and does not grant scheduled accounts sign-in',async()=>{
 const f=await fixture(); await grant(f,['schedule.manage','location.manage']);
 const ids=[];let cursor=null;
 do {const page=await list(f,cursor,2); assert.equal(page.coverage,'shift-references-only');assert.equal(page.timezone,'America/New_York');
  for(const record of page.items){ids.push(record.id);assert.equal(record.revision,3);const expected=f.records.find(r=>r.id===record.id);assert.equal(Date.parse(record.data.start),Date.parse(expected.data.start));assert.equal(Date.parse(record.data.end),Date.parse(expected.data.end));}
  cursor=page.nextCursor;
 }while(cursor);
 assert.deepEqual(ids,f.records.map(r=>r.id).sort()); assert.equal(new Set(ids).size,6);
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_identity.auth_links WHERE person_id IN (SELECT person_id FROM candidate_identity.memberships WHERE restaurant_id=$1 AND schedule_only)',[f.scope])).rows[0].n,0);
 for(const limit of [0,101,null])await assert.rejects(list(f,null,limit),e=>e.code==='22023');
});
test('read scope and revoked grants/membership are checked on each request; runtime cannot bypass tables',async()=>{
 const f=await fixture(),foreign=await fixture(); await grant(f,['schedule.manage','location.manage']);assert.equal((await list(f)).items.length,6);
 await admin.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[f.id]);assert.equal((await list(f)).items.length,1);
 await assert.rejects(list({...f,scope:foreign.scope}),e=>e.code==='42501');
 await assert.rejects(list({...f,subject:'wrong-subject'}),e=>e.code==='42501');
 await admin.query('UPDATE candidate_identity.memberships SET schedule_only=true WHERE id=$1',[f.id]);await assert.rejects(list(f),e=>e.code==='42501');
 await admin.query('UPDATE candidate_identity.memberships SET schedule_only=false,active=false WHERE id=$1',[f.id]);await assert.rejects(list(f),e=>e.code==='42501');
 await assert.rejects(db.transaction(c=>c.query('SELECT * FROM candidate_operations.shift_references',[])),e=>e.code==='42501');
});
test('HTTP schedule paging resolves a database session and rejects malformed or ambiguous queries',async()=>{
 const f=await fixture();await grant(f,['schedule.manage']);
 const handler=createTaskHandler(db,async()=>({subject:f.subject,sessionId:f.session}));
 const request=(suffix='',method='GET')=>new Request(`https://candidate.invalid/api/operations/${f.scope}/schedule-shifts${suffix}`,{method,headers:{Authorization:'Bearer fictional-verified-session'}});
 const response=await handler(request('?limit=2'));assert.equal(response.status,200);const page=await response.json();assert.equal(page.items.length,2);assert.ok(page.nextCursor);
 for(const suffix of ['?limit=0','?limit=101','?limit=2&limit=3','?after=bad','?department=FOH',`/${randomUUID()}`])assert.equal((await handler(request(suffix))).status,400);
 assert.equal((await handler(request('','POST'))).status,405);
 await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[f.session]);assert.equal((await handler(request())).status,401);
});
