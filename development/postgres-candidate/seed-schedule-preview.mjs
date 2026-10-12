import {connection} from './test-config.mjs';
import pg from 'pg';import {randomUUID} from 'node:crypto';import {writeFileSync} from 'node:fs';
import {PostgresDatabase} from './postgres-driver.ts';import {executeTask} from './task-adapter.ts';
import {localInstant,nextDate} from '../../app/shared/local-time.ts';
const pool=new pg.Pool({...connection,user:'candidate_owner'}),db=new PostgresDatabase({...connection,user:'candidate_runtime'}),scope='fictional-schedule-preview',sessions={},members={};
try {
 await pool.query("INSERT INTO candidate_identity.restaurants(id,name,timezone,operating_departments,dish_department,dish_position,dish_aliases) VALUES($1,$2,'America/Chicago',ARRAY['Service','Kitchen'],'Kitchen','Steward',ARRAY['Steward','Steward PM'])",[scope,'Fictional configured scheduling restaurant']);
 for(const [actor,name,area,caps] of [['schedule-worker','Fictional employee','Kitchen',[]],['schedule-replacement','Fictional replacement employee','Kitchen',[]],['schedule-manager','Fictional schedule manager','Kitchen',['schedule.manage','schedule.change','schedule.correct']],['schedule-corrector','Fictional independent corrector','Kitchen',['schedule.correct']],['schedule-foreign','Fictional other-department manager','Service',['schedule.manage','schedule.publish']],['schedule-publisher','Fictional schedule publisher','Kitchen',['schedule.manage','schedule.publish','schedule.change','location.manage','close.confirm','people.manage','schedule.correct']]]){
  const id=randomUUID(),person=randomUUID(),session=randomUUID(),subject=actor+'-'+id;
  await pool.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,name]);
  await pool.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
  await pool.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[id,person,scope,area]);
  for(const cap of caps)await pool.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[id,cap]);
  await pool.query("INSERT INTO candidate_identity.schedule_eligibility(member_id,job,source) VALUES($1,'Cook','schedule-job')",[id]);
  await pool.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '4 hours')",[session,subject]);sessions[actor]={id:session,subject};members[actor]=id;
 }
 const scheduleOnly=randomUUID(),person=randomUUID();await pool.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional schedule-only employee']);await pool.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position,active,schedule_only) VALUES($1,$2,$3,'Kitchen','Cook',false,true)",[scheduleOnly,person,scope]);await pool.query("INSERT INTO candidate_identity.schedule_eligibility(member_id,job,source) VALUES($1,'Cook','schedule-job')",[scheduleOnly]);
 const publisher={subject:sessions['schedule-publisher'].subject,membershipId:members['schedule-publisher']};
 const stationSetup=await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'station.save',input:{area:'Kitchen',title:'Fictional grill',levels:[],status:'active',note:'Complete fictional station setup',setup:{jobs:['Cook'],memberIds:[],standardIds:[],allJobMembers:true,goals:[]}}});
 const station=stationSetup.recordId;
 // Empty fictional scope reviewed explicitly; never certifies real source data.
 await pool.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));const day=parts.year+'-'+parts.month+'-'+parts.day;
 await pool.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'Kitchen','Cook',$4,$5,1,true)",[randomUUID(),scope,members['schedule-worker'],localInstant(day,'12:00','America/Chicago'),localInstant(day,'14:00','America/Chicago')]);
 await executeTask(db,{subject:sessions['schedule-manager'].subject,membershipId:members['schedule-manager']},scope,{requestId:randomUUID(),locationId:scope,action:'shift.save',input:{personId:scheduleOnly,position:'Cook',stationId:station,start:localInstant(nextDate(day,1),'16:00','America/Chicago'),end:localInstant(nextDate(day,1),'23:00','America/Chicago'),note:'Fictional initial candidate draft'}});
 await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'shift.save',input:{personId:scheduleOnly,position:'Cook',stationId:station,start:localInstant(nextDate(day,2),'16:00','America/Chicago'),end:localInstant(nextDate(day,2),'23:00','America/Chicago'),note:'Fictional unselected draft'}});
 const staffing=await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'staffing.save',input:{title:'Fictional grill coverage',area:'Kitchen',position:'Cook',minimum:2,start:localInstant(nextDate(day,1),'16:00','America/Chicago'),end:localInstant(nextDate(day,1),'23:00','America/Chicago'),source:'Fictional two-person service'}});
 await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'staffing.approve',recordId:staffing.recordId,expectedRevision:staffing.revision,input:{confirmed:true,note:'Fictional staffing approval'}});
 // Command-created future shifts exercise consent and approval, not imported-reference holds.
 for(const offset of [1,2]) {
  const shift=await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'shift.save',input:{personId:members['schedule-worker'],position:'Cook',start:localInstant(nextDate(day,offset),'10:00','America/Chicago'),end:localInstant(nextDate(day,offset),'12:00','America/Chicago'),note:'Fictional replacement workflow'}});
  await pool.query("INSERT INTO candidate_operations.publication_reviews(shift_id,shift_revision,workspace_revision,no_staffing,no_closing,evidence) SELECT $1,$2,revision,true,true,'Complete fictional replacement fixture only' FROM candidate_identity.restaurants WHERE id=$3",[shift.recordId,shift.revision,scope]);
  await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'shift.publish',recordId:shift.recordId,expectedRevision:shift.revision,input:{note:'Fictional replacement preview publication'}});
 }
 // Command-created source and covering shifts for explicit cancellation review.
 const guide=randomUUID(),transferDay=nextDate(day,3);
 await pool.query("INSERT INTO candidate_operations.standard_references VALUES($1,$2,'Kitchen','Fictional grill closing guide','Grill','Cook',1,1,'manager','approved','[\"Clean and inspect grill\"]')",[guide,scope]);
 await pool.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'tasks.manage',true)",[publisher.membershipId]);
 for(const actor of ['schedule-worker','schedule-replacement']){
  await pool.query("INSERT INTO candidate_identity.station_clearances VALUES($1,$2,'Cook',true)",[members[actor],scope]);
  const shift=await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'shift.save',input:{personId:members[actor],position:'Cook',start:localInstant(transferDay,'10:00','America/Chicago'),end:localInstant(transferDay,'12:00','America/Chicago'),note:'Fictional closing transfer review'}});
  if(actor==='schedule-worker')await pool.query('INSERT INTO candidate_operations.shift_standard_links(shift_id,standard_id,restaurant_id) VALUES($1,$2,$3)',[shift.recordId,guide,scope]);
  let closing;
  if(actor==='schedule-worker')closing=await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'close.assign',input:{shiftId:shift.recordId,standardId:guide,managerId:publisher.membershipId,due:localInstant(transferDay,'11:30','America/Chicago'),note:'Fictional closing responsibility'}});
  await pool.query("INSERT INTO candidate_operations.publication_reviews(shift_id,shift_revision,workspace_revision,no_staffing,no_closing,evidence) SELECT $1,$2,revision,true,$4,'Complete fictional transfer fixture only' FROM candidate_identity.restaurants WHERE id=$3",[shift.recordId,shift.revision,scope,!closing]);
  await executeTask(db,publisher,scope,{requestId:randomUUID(),locationId:scope,action:'shift.publish',recordId:shift.recordId,expectedRevision:shift.revision,input:{note:'Fictional closing transfer preview publication'}});
  // Privileged fixture input: the published covering reference gets its reviewed guide link.
  if(actor==='schedule-replacement')await pool.query('INSERT INTO candidate_operations.shift_standard_links(shift_id,standard_id,restaurant_id) VALUES($1,$2,$3)',[shift.recordId,guide,scope]);
  if(closing)await pool.query("UPDATE candidate_operations.closes SET phase='manager-confirmation',answers='[0]' WHERE id=$1",[closing.recordId]);
 }
 // Fictional correction preview only: explicitly selected owner, never inferred from a title or capability.
 await pool.query("INSERT INTO candidate_operations.completed_shift_notice_policy(restaurant_id,person_id,kind) SELECT $1,person_id,'owner' FROM candidate_identity.memberships WHERE id=$2",[scope,members['schedule-publisher']]);
 for(const actor of ['schedule-worker','schedule-manager'])await pool.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'Kitchen','Cook',$4,$5,1,true)",[randomUUID(),scope,members[actor],localInstant(nextDate(day,-1),'10:00','America/Chicago'),localInstant(nextDate(day,-1),'12:00','America/Chicago')]);
 // Privileged seed attestation only, after all fictional inputs; the UI cannot refresh it.
 await pool.query("INSERT INTO candidate_operations.weekly_scope_reviews(restaurant_id,workspace_revision,schedule_revision,input_revision,evidence) SELECT r.id,r.revision,c.schedule_revision,c.input_revision,'Complete fictional scheduling fixture only' FROM candidate_identity.restaurants r JOIN candidate_operations.scope_coordination c ON c.restaurant_id=r.id WHERE r.id=$1",[scope]);
 writeFileSync(new URL('runtime/schedule-preview-fixture.json',import.meta.url),JSON.stringify({sessions}));
}finally{await pool.end();await db.close();}
