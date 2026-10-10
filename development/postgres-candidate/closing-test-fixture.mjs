import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
import {connection as config} from './test-config.mjs';
import {privilegedScopeTransaction} from './privileged-scope-transaction.mjs';
const db=new PostgresDatabase({...config,user:'candidate_runtime',max:3}),owner=new pg.Pool({...config,user:'candidate_owner',max:2});
after(async()=>{await db.close();await owner.end();});
const creator={subject:'manager',membershipId:'10000000-0000-0000-0000-000000000001'};
async function member(capabilities=[],position='Cook'){
 const person=randomUUID(),membershipId=randomUUID(),subject='closing-fixture-'+randomUUID();
 return privilegedScopeTransaction(owner,['fictional-a'],async client=>{
  await client.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional closing fixture']);await client.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
  await client.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,'fictional-a','BOH',$3)",[membershipId,person,position]);
  for(const cap of capabilities)await client.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[membershipId,cap]);return {subject,membershipId};
 });
}
async function fixture({published=true,mode='manager',leadership=true,location=false}={}){
 const worker=await member(),manager=await member(['close.confirm',...(location?['location.manage']:[])]),verifier=await member(['close.verify']);const shift=randomUUID(),standard=randomUUID();
 await owner.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,'fictional-a',$2,'BOH','Cook','2026-10-09T12:00:00-04:00','2026-10-09T20:00:00-04:00',1,$3)",[shift,worker.membershipId,published]);
 await owner.query("INSERT INTO candidate_operations.standard_references(id,restaurant_id,department,title,zone,position,revision,version,verification,status,criteria) VALUES($1,'fictional-a','BOH','Fictional station close','cook station','Cook',1,1,$2,'approved','[\"Station clean\",\"Equipment safe\"]')",[standard,mode]);
 await owner.query("INSERT INTO candidate_operations.shift_standard_links(shift_id,standard_id,restaurant_id) VALUES($1,$2,'fictional-a')",[shift,standard]);
 await owner.query("INSERT INTO candidate_identity.station_clearances(member_id,restaurant_id,position) VALUES($1,'fictional-a','Cook')",[worker.membershipId]);
 if(leadership)await owner.query("INSERT INTO candidate_operations.leadership_references(member_id,restaurant_id,department,starts_at,ends_at) VALUES($1,'fictional-a','BOH','2026-10-09T12:00:00-04:00','2026-10-09T20:00:00-04:00')",[manager.membershipId]);
 const command={requestId:randomUUID(),locationId:'fictional-a',action:'close.assign',input:{shiftId:shift,standardId:standard,managerId:manager.membershipId,due:'2026-10-09T20:00:00-04:00',note:'Fictional closing assignment.',...(mode==='senior-then-manager'?{verifierId:verifier.membershipId}:{})}};
 return {worker,manager,verifier,shift,standard,command};
}
const run=command=>executeTask(db,creator,'fictional-a',command),denied=status=>e=>e.status===status;
const read=(actor,assigned)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_close($1,$2,$3,$4) AS result',[actor.subject,actor.membershipId,'fictional-a',assigned.recordId])).rows[0].result);

export {fixture,run,read,owner,db,member,creator,denied};
