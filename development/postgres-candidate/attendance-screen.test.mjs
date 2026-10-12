import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {createTaskHandler} from './task-http.ts';import {loadScheduleScreen,ScheduleScreenSender} from './schedule-screen-client.mjs';
import {loadAttendanceRange,loadShiftAttendance,loadAttendanceDetail,attendanceFields,attendanceInput,attendanceDecision,attendancePatterns} from './attendance-client.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner'}),db=new PostgresDatabase({...connection,user:'candidate_runtime'});after(async()=>{await admin.end();await db.close();});
async function fixture(){
 const f={scope:'attendance-ui-'+randomUUID()};await admin.query("INSERT INTO candidate_identity.restaurants(id,name,timezone,operating_departments,dish_department,dish_position,dish_aliases) VALUES($1,'Fictional attendance forms','America/Chicago',ARRAY['Kitchen','Service'],'Kitchen','Steward',ARRAY['Steward'])",[f.scope]);
 for(const [key,caps] of [['manager',['location.manage','people.manage']],['worker',[]],['replacement',[]]]){const person=randomUUID(),id=randomUUID(),subject='fictional-'+randomUUID(),sessionId=randomUUID();await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional '+key]);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'Kitchen','Cook')",[id,person,f.scope]);for(const cap of caps)await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[id,cap]);await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,subject]);f[key]={person,id,subject,sessionId};}
 f.shift=randomUUID();await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,released_at) VALUES($1,$2,$3,'Kitchen','Cook','2020-05-01T13:00:00Z','2020-05-01T15:00:00Z',1,true,'2020-05-01T15:00:00Z')",[f.shift,f.scope,f.worker.id]);return f;
}
function http(f,a=f.manager){const h=createTaskHandler(db,async()=>({subject:a.subject,sessionId:a.sessionId}));return async(path,command)=>{const response=await h(new Request('http://candidate.invalid/api/operations/'+f.scope+path,{method:command?'POST':'GET',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},...(command?{body:JSON.stringify(command)}:{})}));return {status:response.status,body:await response.json()};};}
async function record(f,type='call-in',call=http(f)){const w=await loadScheduleScreen(call),shift=w.records.find(r=>r.id===f.shift),input=attendanceInput(w,{...attendanceFields(w,undefined,'2020-05-01T12:00:00Z'),type,note:'Fictional private attendance facts',facts:{contact:'message',coverage:'unknown',emergency:'unknown'}},undefined,shift);return new ScheduleScreenSender().send(call,f.scope,'attendance.record',input);}
async function detail(f,id,call=http(f)){return loadAttendanceDetail(call,await loadScheduleScreen(call),id);}

test('forms record correct review reopen and void through HTTP with complete original history',async()=>{
 const f=await fixture(),call=http(f);let saved=await record(f),loaded=await detail(f,saved.recordId),w=await loadScheduleScreen(call),sender=new ScheduleScreenSender();assert.equal(loaded.record.data.shift.timezone,'America/Chicago');assert.equal(loaded.events.length,1);
 const facts={...loaded.record.data.facts,coverage:'confirmed'},input=attendanceInput(w,{...attendanceFields(w,loaded.record),type:'other',note:'Fictional corrected facts',facts,changeReason:'Fictional new evidence'},loaded.record);saved=await sender.send(call,f.scope,'attendance.correct',input,loaded.record);
 for(const action of ['attendance.review','attendance.reopen','attendance.review','attendance.void']){loaded=await detail(f,saved.recordId);w=await loadScheduleScreen(call);saved=await sender.send(call,f.scope,action,attendanceDecision(w,loaded.record,action,'Fictional individual review'),loaded.record);}
 loaded=await detail(f,saved.recordId);assert.equal(loaded.events.length,6);assert.equal(loaded.record.data.status,'voided');assert.equal(loaded.record.data.review.note,'Fictional individual review');assert.equal(loaded.events[1].before.attendance_type,'call-in');assert.equal(loaded.events[1].after.attendance_type,'other');
});
test('HTTP-backed range pagination counts original shifts once and excludes voided entries',async()=>{
 const f=await fixture(),first=await record(f);await record(f,'other');const original=http(f),call=(path,c)=>original(path.replace('limit=100','limit=1'),c),w=await loadScheduleScreen(original);let loaded=await loadAttendanceRange(call,w,'2020-05-01','2020-05-01');assert.equal(loaded.records.length,2);assert.equal(loaded.complete,true);assert.equal(attendancePatterns(loaded)[0].shifts,1);
 const r=(await detail(f,first.recordId)).record;await new ScheduleScreenSender().send(original,f.scope,'attendance.void',attendanceDecision(w,r,'attendance.void','Fictional mistake'),r);loaded=await loadAttendanceRange(call,await loadScheduleScreen(original),'2020-05-01','2020-05-01');assert.equal(loaded.records.length,2);assert.equal(attendancePatterns(loaded)[0].entries,1);
});
test('original identity survives reassignment and cancellation; current names and saved names stay separate',async()=>{
 const f=await fixture(),saved=await record(f);await admin.query('UPDATE candidate_operations.shift_references SET member_id=$1,cancelled=true,revision=revision+1 WHERE id=$2',[f.replacement.id,f.shift]);await admin.query('UPDATE candidate_identity.people SET name=$1 WHERE id=$2',['Fictional renamed employee',f.worker.person]);await admin.query('UPDATE candidate_identity.people SET name=$1 WHERE id=$2',['Fictional renamed manager',f.manager.person]);
 let loaded=await detail(f,saved.recordId);assert.equal(loaded.record.ownerId,f.worker.id);assert.equal(loaded.record.data.employeeName,'Fictional renamed employee');assert.equal(loaded.record.data.employeeNameAtEntry,'Fictional worker');assert.equal(loaded.events[0].actorName,'Fictional renamed manager');assert.equal(loaded.events[0].actorNameAtEntry,'Fictional manager');
 const w=await loadScheduleScreen(http(f));await new ScheduleScreenSender().send(http(f),f.scope,'attendance.correct',attendanceInput(w,{...attendanceFields(w,loaded.record),type:'call-in',note:'Fictional amended facts',facts:loaded.record.data.facts,changeReason:'Fictional documented amendment'},loaded.record),loaded.record);loaded=await detail(f,saved.recordId);assert.equal(loaded.events.length,2);assert.equal(loaded.record.data.shiftRevision,1);
});
test('lost HTTP response replays the frozen receipt once; duplicates become actionable conflict messages',async()=>{
 const f=await fixture(),call=http(f),w=await loadScheduleScreen(call),shift=w.records.find(r=>r.id===f.shift),input=attendanceInput(w,{...attendanceFields(w,undefined,'2020-05-01T12:00:00Z'),type:'call-in',note:'Fictional fact',facts:{contact:'unknown',coverage:'unknown',emergency:'unknown'}},undefined,shift),sender=new ScheduleScreenSender();let committed;
 await assert.rejects(sender.send(async(path,c)=>{const response=await call(path,c);committed=response.body;assert.equal(response.status,200);throw Error('Fictional lost response');},f.scope,'attendance.record',input));const replay=await sender.retry(call);assert.equal(replay.recordId,committed.recordId);assert.equal(replay.replayed,true);assert.equal((await detail(f,replay.recordId)).events.length,1);
 await assert.rejects(new ScheduleScreenSender().send(call,f.scope,'attendance.record',input),/already recorded/);
});
test('private attendance does not enter employee scheduling workspaces; revocation stops partial history',async()=>{
 const f=await fixture(),saved=await record(f),call=http(f);let loaded=await detail(f,saved.recordId),w=await loadScheduleScreen(call);await new ScheduleScreenSender().send(call,f.scope,'attendance.review',attendanceDecision(w,loaded.record,'attendance.review','Fictional review'),loaded.record);
 const employee=await loadScheduleScreen(http(f,f.worker));assert.deepEqual(employee.attendanceAreas,[]);assert.ok(!JSON.stringify(employee).includes('Fictional private attendance facts'));assert.equal((await http(f,f.worker)('/attendance')).status,403);await assert.rejects(loadAttendanceRange(http(f,f.worker),employee,'2020-05-01','2020-05-01'),/current access/);
 w=await loadScheduleScreen(call);let revoked=false;await assert.rejects(loadAttendanceDetail(async(path,c)=>{const response=await call(path.replace('limit=100','limit=1'),c);if(path.startsWith('/attendance-history/')&&!revoked){revoked=true;await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[f.manager.sessionId]);}return response;},w,saved.recordId),/Sign in again/);
});

test('an actual schedule command during range paging does not restart attendance loading',async()=>{
 const f=await fixture();await record(f);await record(f,'other');
 await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'schedule.manage',true)",[f.manager.id]);
 await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[f.worker.id]);
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[f.scope]);
 const original=http(f),w=await loadScheduleScreen(original);let wrote=false,pages=0,viewers=0;
 const loaded=await loadAttendanceRange(async(path,c)=>{
  if(path==='/schedule-viewer')viewers++;if(path.startsWith('/attendance?'))pages++;
  const response=await original(path.replace('limit=100','limit=1'),c);
  if(path.startsWith('/attendance?')&&!wrote){wrote=true;const command={requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.worker.id,position:'Cook',start:'2031-06-01T13:00:00Z',end:'2031-06-01T15:00:00Z'}};assert.equal((await original('/commands',command)).status,200);}
  return response;
 },w,'2020-05-01','2020-05-01');
 assert.equal(loaded.complete,true);assert.equal(loaded.attendanceRevision,w.attendanceRevision);assert.equal(pages,2);assert.equal(viewers,2);
});

test('an attendance command during range paging restarts the drain and relevant capability revocation denies it',async()=>{
 const f=await fixture(),saved=await record(f);await record(f,'other');const original=http(f),w=await loadScheduleScreen(original);let wrote=false,pages=0;
 const loaded=await loadAttendanceRange(async(path,c)=>{
  const response=await original(path.replace('limit=100','limit=1'),c);
  if(path.startsWith('/attendance?')){pages++;if(!wrote){wrote=true;assert.equal((await original('/commands',{requestId:randomUUID(),locationId:f.scope,action:'attendance.review',recordId:saved.recordId,expectedRevision:1,input:{note:'Fictional concurrent review'}})).status,200);}}
  return response;
 },w,'2020-05-01','2020-05-01');
 assert.equal(loaded.attendanceRevision,w.attendanceRevision+1);assert.equal(pages,4);assert.ok(loaded.records.find(r=>r.id===saved.recordId).data.review);
 const fresh=await loadScheduleScreen(original);let revoked=false;
 await assert.rejects(loadAttendanceRange(async(path,c)=>{const response=await original(path.replace('limit=100','limit=1'),c);if(path.startsWith('/attendance?')&&!revoked){revoked=true;await admin.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[f.manager.id]);}return response;},fresh,'2020-05-01','2020-05-01'),/current access/);
});

test('per-shift loader includes original assignee history without loading unrelated shifts on the same day',async()=>{
 const f=await fixture(),saved=await record(f);await admin.query('UPDATE candidate_operations.shift_references SET member_id=$1,revision=revision+1 WHERE id=$2',[f.replacement.id,f.shift]);
 await record(f,'other');const another=randomUUID();await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'Kitchen','Cook','2020-05-01T16:00:00Z','2020-05-01T18:00:00Z',1,true)",[another,f.scope,f.worker.id]);
 const call=http(f),w=await loadScheduleScreen(call),sender=new ScheduleScreenSender();await sender.send(call,f.scope,'attendance.record',{shiftId:another,shiftRevision:1,type:'other',reportedAt:'2020-05-01T12:00:00Z',note:'Fictional unrelated entry'});
 const paths=[],loaded=await loadShiftAttendance(async(path,c)=>{paths.push(path);return call(path.replace('limit=100','limit=1'),c);},await loadScheduleScreen(call),f.shift);
 assert.equal(loaded.records.length,2);assert.ok(loaded.records.some(r=>r.id===saved.recordId&&r.ownerId===f.worker.id));assert.ok(loaded.records.some(r=>r.ownerId===f.replacement.id));assert.ok(loaded.records.every(r=>r.data.shiftId===f.shift));assert.ok(paths.filter(p=>p.startsWith('/attendance?')).every(p=>p.includes('shift='+f.shift)&&!p.includes('from=')));
});
