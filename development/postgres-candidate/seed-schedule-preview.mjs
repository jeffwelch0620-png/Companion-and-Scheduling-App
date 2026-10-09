import {connection} from './test-config.mjs';
import pg from 'pg';import {randomUUID} from 'node:crypto';import {writeFileSync} from 'node:fs';
const pool=new pg.Pool({...connection,user:'candidate_owner'}),scope='fictional-schedule-preview',sessions={};
try {
 await pool.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional scheduling restaurant']);
 for(const [actor,name,area,caps] of [['schedule-worker','Fictional employee','BOH',[]],['schedule-manager','Fictional schedule manager','BOH',['schedule.manage','schedule.change']],['schedule-foreign','Fictional other-department manager','FOH',['schedule.manage']]]){
  const id=randomUUID(),person=randomUUID(),session=randomUUID(),subject=actor+'-'+id;
  await pool.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,name]);
  await pool.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
  await pool.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[id,person,scope,area]);
  for(const cap of caps)await pool.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[id,cap]);
  await pool.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '4 hours')",[session,subject]);sessions[actor]={id:session,subject};
 }
 writeFileSync(new URL('runtime/schedule-preview-fixture.json',import.meta.url),JSON.stringify({sessions}));
}finally{await pool.end();}
