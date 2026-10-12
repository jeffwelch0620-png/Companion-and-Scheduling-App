import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {connection} from './test-config.mjs';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
const admin=new pg.Pool({...connection,user:'candidate_owner'}),db=new PostgresDatabase({...connection,user:'candidate_runtime'});
after(async()=>{await admin.end();await db.close();});
async function fixture(){
 const scope='attendance-'+randomUUID(),f={scope};
 await admin.query("INSERT INTO candidate_identity.restaurants(id,name,timezone,operating_departments,dish_department,dish_position,dish_aliases) VALUES($1,'Fictional attendance','America/Chicago',ARRAY['Kitchen','Service'],'Kitchen','Steward',ARRAY['Steward'])",[scope]);
 for(const [key,area,caps] of [['manager','Kitchen',['location.manage','schedule.manage','schedule.publish']],['department','Kitchen',['people.manage']],['foreign','Service',['people.manage']],['scheduler','Kitchen',['schedule.publish','schedule.change']],['employee','Kitchen',[]],['replacement','Kitchen',[]]]){
  const person=randomUUID(),membershipId=randomUUID(),subject='fictional-'+randomUUID(),sessionId=randomUUID();
  await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional '+key]);
  await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[membershipId,person,scope,area]);
  await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[membershipId]);
  for(const cap of caps)await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[membershipId,cap]);
  await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,subject]);
  f[key]={person,membershipId,subject,sessionId,area};
 }
 f.shift=await shift(f);return f;
}
async function shift(f,options={}){
 const id=randomUUID();await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,cancelled,released_at) VALUES($1,$2,$3,$4,'Cook',$5,$6,1,$7,$8,$9)",[id,f.scope,options.owner??f.employee.membershipId,options.area??'Kitchen',options.start??'2020-05-01T13:00:00Z',options.end??'2020-05-01T15:00:00Z',options.published??true,options.cancelled??false,options.released??null]);return {id,revision:1};
}
const command=(f,input={})=>({requestId:randomUUID(),locationId:f.scope,action:'attendance.record',input:{shiftId:f.shift.id,shiftRevision:f.shift.revision,type:'call-in',reportedAt:'2020-05-01T12:00:00Z',note:'Fictional reported facts',...input}});
const change=(f,r,action,input)=>({requestId:randomUUID(),locationId:f.scope,action,recordId:r.recordId,expectedRevision:r.revision,input});
const run=(f,c,a=f.manager)=>executeTask(db,a,f.scope,c);
const list=(f,a=f.manager,after=null,limit=50,from=null,to=null)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.list_attendance($1,$2,$3,$4,$5,$6,$7) result',[a.subject,a.membershipId,f.scope,after,limit,from,to])).rows[0].result);
const detail=(f,id,a=f.manager)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_attendance($1,$2,$3,$4) result',[a.subject,a.membershipId,f.scope,id])).rows[0].result);
const history=(f,id,a=f.manager,after=0,limit=50)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_attendance_history($1,$2,$3,$4,$5,$6) result',[a.subject,a.membershipId,f.scope,id,after,limit])).rows[0].result);
const correcting=(f,r,input={})=>change(f,r,'attendance.correct',{type:'late',reportedAt:'2020-05-01T13:15:00Z',note:'Fictional corrected fact',changeReason:'Fictional correction evidence',...input});
function http(f,a=f.manager){const h=createTaskHandler(db,async()=>({subject:a.subject,sessionId:a.sessionId}));return async(path,cmd)=>{const response=await h(new Request('http://candidate.invalid/api/operations/'+f.scope+path,{method:cmd?'POST':'GET',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},...(cmd?{body:JSON.stringify(cmd)}:{})}));return {status:response.status,body:await response.json()};};}
const rows=async(table,scope)=>(await admin.query('SELECT to_jsonb(t) value FROM candidate_operations.'+table+' t '+(table==='person_shift_bookings'?'JOIN candidate_operations.shift_references s ON s.id=t.shift_id WHERE s.restaurant_id=$1':'WHERE t.restaurant_id=$1')+' ORDER BY to_jsonb(t)::text',[scope])).rows;

test('attendance parser refuses coercible categories and misplaced create/correction fields',()=>{
 const f={scope:'fictional',shift:{id:randomUUID(),revision:1}};
 for(const input of [{type:['call-in']},{type:4},{shiftRevision:'1'},{facts:{contact:'unknown',coverage:'unknown',emergency:'unknown',hidden:true}}])assert.throws(()=>parseCommand(command(f,input),f.scope),e=>e.status===400);
 assert.throws(()=>parseCommand({...command(f),recordId:randomUUID()},f.scope),e=>e.status===400);
 assert.throws(()=>parseCommand({...correcting(f,{recordId:randomUUID(),revision:1}),input:{...correcting(f,{recordId:randomUUID(),revision:1}).input,shiftId:randomUUID()}},f.scope),e=>e.status===400);
});

test('recorded attendance preserves original identity, shift, timezone and unknown facts',async()=>{
 const f=await fixture(),before=await rows('shift_references',f.scope),r=await run(f,command(f)),read=await detail(f,r.recordId);
 assert.equal(read.kind,'attendance');assert.equal(read.ownerId,f.employee.membershipId);assert.equal(read.data.shiftId,f.shift.id);assert.equal(read.data.shift.timezone,'America/Chicago');assert.equal(read.data.employeeName,'Fictional employee');assert.equal(read.data.employeeNameAtEntry,'Fictional employee');
 assert.deepEqual(read.data.facts,{contact:'unknown',coverage:'unknown',emergency:'unknown'});assert.equal(read.data.status,'recorded');assert.equal(read.data.review,null);assert.equal(read.data.actions.canReview,true);assert.deepEqual(await rows('shift_references',f.scope),before);
 assert.equal((await history(f,r.recordId)).items[0].before,null);
});
test('correction preserves original ownership and snapshot after reassignment, cancellation and release',async()=>{
 const f=await fixture(),r=await run(f,command(f)),initial=await detail(f,r.recordId);
 await admin.query("UPDATE candidate_operations.shift_references SET member_id=$1,cancelled=true,released_at=clock_timestamp(),revision=revision+1,position='Reconciled cook' WHERE id=$2",[f.replacement.membershipId,f.shift.id]);
 const corrected=await run(f,correcting(f,r)),read=await detail(f,corrected.recordId);
 assert.equal(read.ownerId,f.employee.membershipId);assert.equal(read.data.shiftRevision,1);assert.deepEqual(read.data.shift,initial.data.shift);assert.equal(read.data.type,'late');assert.equal(read.revision,2);
 const events=await history(f,r.recordId);assert.equal(events.items.length,2);assert.equal(events.items[1].before.attendance_type,'call-in');assert.equal(events.items[1].after.attendance_type,'late');
});
test('review reopen correction and void retain before/after history and enforce current status',async()=>{
 const f=await fixture();let r=await run(f,command(f));
 await assert.rejects(run(f,change(f,r,'attendance.reopen',{note:'Already open'})),e=>e.code==='attendance_not_reviewed');
 r=await run(f,change(f,r,'attendance.review',{note:'Fictional follow-up'}));const reviewed=await detail(f,r.recordId);assert.equal(reviewed.data.review.note,'Fictional follow-up');assert.equal(reviewed.data.actions.canReopen,true);
 await assert.rejects(run(f,change(f,r,'attendance.review',{note:'Again'})),e=>e.code==='attendance_already_reviewed');
 r=await run(f,change(f,r,'attendance.reopen',{note:'Fictional renewed evidence'}));assert.equal((await detail(f,r.recordId)).data.review,null);
 r=await run(f,change(f,r,'attendance.review',{note:'Fictional second review'}));r=await run(f,correcting(f,r));assert.equal((await detail(f,r.recordId)).data.review,null);
 r=await run(f,change(f,r,'attendance.review',{note:'Fictional final review'}));r=await run(f,change(f,r,'attendance.void',{changeReason:'Mistaken attendance entry'}));
 const read=await detail(f,r.recordId);assert.equal(read.data.status,'voided');assert.equal(read.data.review.note,'Fictional final review');assert.deepEqual(Object.values(read.data.actions),[false,false,false,false]);
 await assert.rejects(run(f,correcting(f,r)),e=>e.code==='attendance_voided');assert.equal((await history(f,r.recordId)).items.length,7);
});
test('only current published noncancelled sources are recordable, including ended and released shifts',async()=>{
 const f=await fixture();for(const opts of [{published:false,start:'2019-05-01T13:00:00Z',end:'2019-05-01T15:00:00Z'},{cancelled:true,start:'2018-05-01T13:00:00Z',end:'2018-05-01T15:00:00Z'}]){
  const s=await shift(f,opts);await assert.rejects(run(f,command(f,{shiftId:s.id})),e=>e.code==='attendance_source_ineligible');
 }
 await assert.rejects(run(f,command(f,{shiftRevision:2})),e=>e.code==='revision_conflict');
 await admin.query('UPDATE candidate_operations.shift_references SET released_at=clock_timestamp() WHERE id=$1',[f.shift.id]);assert.equal((await run(f,command(f))).revision,1);
});
test('reported times no-show start and facts are validated in both adapter and direct SQL',async()=>{
 const f=await fixture();for(const input of [{reportedAt:new Date(Date.now()+120000).toISOString()},{type:'no-show',reportedAt:'2020-05-01T12:59:59Z'},{facts:{contact:'message',coverage:'unknown',emergency:'bad'}},{reportedAt:'2020-02-30T12:00:00Z'},{reportedAt:'2020-05-01T24:00:00Z'}])await assert.rejects(run(f,command(f,input)),e=>e.status===400);
 const r=await run(f,command(f,{type:'no-show',reportedAt:'2020-05-01T13:00:00Z',facts:{contact:'message',coverage:'uncovered',emergency:'reported'}}));assert.equal((await detail(f,r.recordId)).data.facts.contact,'message');
 for(const input of [{type:'bad'},{note:5},{note:'\t\u00a0'},{facts:{contact:'phone',coverage:'unknown',emergency:'unknown',extra:true}},{reportedAt:'2020-02-30T12:00:00Z'},{reportedAt:'2020-05-01T24:00:00Z'},{reportedAt:'2020-05-01T13:00:60Z'}]){
  const c=command(f,input);await assert.rejects(db.transaction(t=>t.query('SELECT candidate_operations.attendance_command($1,$2,$3,$4,$5::jsonb)',[f.manager.subject,f.manager.membershipId,f.scope,c.requestId,JSON.stringify({action:c.action,input:c.input})])),e=>e.code.startsWith('22'));
 }
});
test('the existing 60-second tolerance permits near-current reports without applying contact guidance as a gate',async()=>{
 const f=await fixture(),r=await run(f,command(f,{reportedAt:new Date(Date.now()+30000).toISOString(),facts:{contact:'none',coverage:'uncovered',emergency:'not-reported'}}));assert.equal((await detail(f,r.recordId)).data.facts.contact,'none');
});
test('private reads and writes reject employees schedule-only authority other stores and configured checkout role',async()=>{
 const f=await fixture(),r=await run(f,command(f));
 for(const a of [f.employee,f.scheduler,f.foreign]){await assert.rejects(detail(f,r.recordId,a),e=>e.code==='42501');await assert.rejects(history(f,r.recordId,a),e=>e.code==='42501');await assert.rejects(run(f,correcting(f,r),a),e=>e.status===403);}
 const other=await fixture();await assert.rejects(list(f,other.manager),e=>e.code==='42501');
 for(const edit of ["position='Steward'","active=false","schedule_only=true"]){await admin.query('UPDATE candidate_identity.memberships SET '+edit+' WHERE id=$1',[f.department.membershipId]);await assert.rejects(list(f,f.department),e=>e.code==='42501');await assert.rejects(run(f,command(f,{type:'other'}),f.department),e=>e.status===403);await admin.query("UPDATE candidate_identity.memberships SET position='Cook',active=true,schedule_only=false WHERE id=$1",[f.department.membershipId]);}
 for(const sql of ['SELECT * FROM candidate_operations.attendance_entries','SELECT * FROM candidate_operations.attendance_events','UPDATE candidate_operations.attendance_entries SET note=\'Changed\'','SELECT candidate_operations.attendance_allowed($1,$2,$3)'])await assert.rejects(db.transaction(t=>t.query(sql,sql.includes('$1')?[f.employee.membershipId,f.scope,'Kitchen']:[])),e=>e.code==='42501');
});
test('department authority filters lists and historical shift actions without exposing private notes',async()=>{
 const f=await fixture(),first=await run(f,command(f)),service=await shift(f,{owner:f.foreign.membershipId,area:'Service'});await run(f,command(f,{shiftId:service.id}));
 assert.equal((await list(f)).items.length,2);assert.deepEqual((await list(f,f.department)).items.map(r=>r.id),[first.recordId]);assert.equal((await list(f,f.foreign)).items.length,1);
 const call=http(f,f.department),viewer=await call('/schedule-viewer'),shifts=await call('/schedule-shifts');assert.deepEqual(viewer.body.attendanceAreas,['Kitchen']);assert.equal(shifts.body.items.find(r=>r.id===f.shift.id).data.attendanceActions.canRecord,true);assert.ok(!JSON.stringify(shifts.body).includes('Fictional reported facts'));
 const employee=await http(f,f.employee)('/schedule-shifts');assert.equal(employee.body.items[0].data.attendanceActions.canRecord,false);
});
test('record and history paging mark completeness and use the captured store-local date',async()=>{
 const f=await fixture(),ids=[];for(const type of ['call-in','late','other'])ids.push((await run(f,command(f,{type}))).recordId);
 const first=await list(f,f.manager,null,1,'2020-05-01','2020-05-01');assert.equal(first.rangeComplete,false);const seen=[first.items[0].id];let cursor=first.nextCursor;
 while(cursor){const page=await list(f,f.manager,cursor,1,'2020-05-01','2020-05-01');seen.push(page.items[0].id);cursor=page.nextCursor;if(!cursor)assert.equal(page.rangeComplete,true);}assert.deepEqual(seen.sort(),ids.sort());assert.equal((await list(f,f.manager,null,50,'2020-05-02','2020-05-02')).items.length,0);
 let r={recordId:ids[0],revision:1};r=await run(f,change(f,r,'attendance.review',{note:'Fictional review'}));r=await run(f,change(f,r,'attendance.reopen',{note:'Fictional reopening'}));const h=await history(f,r.recordId,f.manager,0,1);assert.equal(h.historyComplete,false);const tail=await history(f,r.recordId,f.manager,h.nextCursor,100);assert.equal(tail.items.length,2);assert.equal(tail.historyComplete,true);
 const s=await shift(f,{start:'2020-05-03T01:00:00Z',end:'2020-05-03T03:00:00Z'}),late=await run(f,command(f,{shiftId:s.id}));assert.equal((await list(f,f.manager,null,50,'2020-05-02','2020-05-02')).items[0].id,late.recordId);
});
test('current employee and actor names change at read time while labelled snapshots remain unchanged',async()=>{
 const f=await fixture();let r=await run(f,command(f));r=await run(f,change(f,r,'attendance.review',{note:'Fictional review'}));
 await admin.query('UPDATE candidate_identity.people SET name=$1 WHERE id=$2',['Fictional new employee name',f.employee.person]);await admin.query('UPDATE candidate_identity.people SET name=$1 WHERE id=$2',['Fictional new manager name',f.manager.person]);
 const read=await detail(f,r.recordId);assert.equal(read.data.employeeName,'Fictional new employee name');assert.equal(read.data.employeeNameAtEntry,'Fictional employee');assert.equal(read.data.historicalNameLabel,'name at time of entry');assert.equal(read.data.review.actorName,'Fictional new manager name');assert.equal(read.data.review.actorNameAtEntry,'Fictional manager');
 const event=(await history(f,r.recordId)).items[0];assert.equal(event.actorName,'Fictional new manager name');assert.equal(event.actorNameAtEntry,'Fictional manager');
});
test('concurrent original receipt replay applies once and different requests cannot duplicate a type',async()=>{
 const f=await fixture(),c=command(f),results=await Promise.all([run(f,c),run(f,c)]);assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);assert.equal((await history(f,results[0].recordId)).items.length,1);
 const duplicates=await Promise.allSettled([run(f,command(f,{type:'late'})),run(f,command(f,{type:'late'}))]);assert.equal(duplicates.filter(r=>r.status==='fulfilled').length,1);assert.equal(duplicates.find(r=>r.status==='rejected').reason.code,'attendance_duplicate');
 await assert.rejects(run(f,correcting(f,results[0])),e=>e.code==='attendance_duplicate');
 await run(f,change(f,results[0],'attendance.void',{changeReason:'Fictional mistake'}));assert.equal((await run(f,command(f))).revision,1);
});
test('receipt replay survives source/status changes but rechecks original-area authority and payload',async()=>{
 const f=await fixture(),c=command(f),r=await run(f,c,f.department);await run(f,change(f,r,'attendance.void',{changeReason:'Fictional mistake'}));await admin.query('UPDATE candidate_operations.shift_references SET cancelled=true,revision=revision+1 WHERE id=$1',[f.shift.id]);assert.equal((await run(f,c,f.department)).replayed,true);
 await assert.rejects(run(f,{...c,input:{...c.input,note:'Changed'}},f.department),e=>e.code==='request_payload_conflict');
 await admin.query("UPDATE candidate_identity.memberships SET department='Service' WHERE id=$1",[f.department.membershipId]);await assert.rejects(run(f,c,f.department),e=>e.status===403);
});
test('HTTP enforces session, strict shapes, date filters and separate bounded history cursor',async()=>{
 const f=await fixture(),call=http(f),created=await call('/commands',command(f));assert.equal(created.status,200);const id=created.body.recordId;
 assert.equal((await call('/attendance')).status,200);assert.equal((await call('/attendance/'+id)).status,200);assert.equal((await call('/attendance-history/'+id+'?after=0&limit=1')).status,200);
 for(const path of ['/attendance?from=2020-02-30&to=2020-03-01','/attendance?from=2020-05-01','/attendance?limit=0','/attendance?after=x','/attendance?from=2020-05-01&from=2020-05-01&to=2020-05-02','/attendance/'+id+'?limit=1','/attendance-history/'+id+'?after=-1','/attendance-history','/attendance?to=2019-01-01&from=2020-01-01'])assert.equal((await call(path)).status,400,path);
 assert.equal((await http(f,f.employee)('/attendance')).status,403);assert.equal((await call('/commands',{...command(f),input:{...command(f).input,actorId:f.employee.membershipId}})).status,400);
 await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[f.manager.sessionId]);assert.equal((await call('/attendance')).status,401);assert.equal((await call('/commands',command(f))).status,401);
});
test('stale versions, invalid reasons and the existing 1000-event limit leave state unchanged',async()=>{
 const f=await fixture(),r=await run(f,command(f));await assert.rejects(run(f,{...correcting(f,r),expectedRevision:2}),e=>e.code==='revision_conflict');
 for(const cmd of [correcting(f,r,{changeReason:''}),change(f,r,'attendance.void',{changeReason:42}),change(f,r,'attendance.review',{note:''}),command(f,{facts:{contact:'unknown'}})])await assert.rejects(run(f,cmd),e=>e.status===400);
 await admin.query('UPDATE candidate_operations.attendance_entries SET revision=1000 WHERE id=$1',[r.recordId]);assert.equal((await detail(f,r.recordId)).data.actions.canCorrect,false);await assert.rejects(run(f,correcting(f,{...r,revision:1000})),e=>e.code==='attendance_history_limit');assert.equal((await history(f,r.recordId)).items.length,1);
});
test('late receipt failure rolls back entry event and workspace revision atomically',async()=>{
 const f=await fixture(),c=command(f),before=(await admin.query('SELECT revision FROM candidate_identity.restaurants WHERE id=$1',[f.scope])).rows[0].revision;
 await admin.query("CREATE FUNCTION candidate_operations.fail_attendance_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'action' LIKE 'attendance.%' THEN RAISE EXCEPTION 'fictional_attendance_receipt_failure'; END IF; RETURN NEW; END; $$");await admin.query('CREATE TRIGGER fail_attendance_receipt BEFORE INSERT ON candidate_operations.command_receipts FOR EACH ROW EXECUTE FUNCTION candidate_operations.fail_attendance_receipt()');
 try{await assert.rejects(run(f,c),e=>e.message==='fictional_attendance_receipt_failure');assert.equal((await list(f)).items.length,0);assert.equal((await rows('attendance_events',f.scope)).length,0);assert.equal((await admin.query('SELECT revision FROM candidate_identity.restaurants WHERE id=$1',[f.scope])).rows[0].revision,before);}finally{await admin.query('DROP TRIGGER fail_attendance_receipt ON candidate_operations.command_receipts');await admin.query('DROP FUNCTION candidate_operations.fail_attendance_receipt()');}
});
test('attendance writes preserve completed tasks closes audit events and existing receipts',async()=>{
 const f=await fixture(),task=randomUUID(),standard=randomUUID(),close=randomUUID();
 await admin.query("INSERT INTO candidate_operations.tasks(id,restaurant_id,assignee_id,department,title,detail,due,phase,revision,shift_id,shift_revision) VALUES($1,$2,$3,'Kitchen','Fictional completed task','Preserved completed evidence','2020-05-01T14:00:00Z','closed',1,$4,1)",[task,f.scope,f.employee.membershipId,f.shift.id]);
 await admin.query("INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES($1,$2,1,$3,'task.transition','Fictional completed audit','closed',$4)",[task,f.scope,f.manager.membershipId,f.employee.membershipId]);
 await admin.query("INSERT INTO candidate_operations.standard_references VALUES($1,$2,'Kitchen','Fictional closing','Grill','Cook',1,1,'manager','approved','[\"Clean\"]')",[standard,f.scope]);
 await admin.query("INSERT INTO candidate_operations.closes(id,restaurant_id,shift_id,shift_revision,owner_id,department,standard_id,standard_revision,standard_snapshot,zone,manager_id,due,phase,answers) VALUES($1,$2,$3,1,$4,'Kitchen',$5,1,'{\"title\":\"Fictional guide\",\"criteria\":[\"Clean\"],\"position\":\"Cook\"}','Grill',$6,'2020-05-01T14:30:00Z','closed','[0]')",[close,f.scope,f.shift.id,f.employee.membershipId,standard,f.manager.membershipId]);
 await admin.query("INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note,answers) VALUES($1,$2,1,$3,'close.transition','Fictional completed audit','[0]')",[close,f.scope,f.manager.membershipId]);
 const before={};for(const table of ['tasks','task_events','closes','close_events','person_shift_bookings','shift_references'])before[table]=await rows(table,f.scope);
 let r=await run(f,command(f)),originalReceipt=(await admin.query('SELECT * FROM candidate_operations.command_receipts WHERE restaurant_id=$1',[f.scope])).rows;
 r=await run(f,correcting(f,r));r=await run(f,change(f,r,'attendance.review',{note:'Fictional review'}));await run(f,change(f,r,'attendance.void',{changeReason:'Fictional mistake'}));
 for(const table of Object.keys(before))assert.deepEqual(await rows(table,f.scope),before[table],table);
 const receipts=(await admin.query('SELECT * FROM candidate_operations.command_receipts WHERE restaurant_id=$1 AND request_id=$2',[f.scope,originalReceipt[0].request_id])).rows;assert.deepEqual(receipts,originalReceipt);
});
test('attendance advances workspace and attendance revisions while preserving reviewed weekly publication',async()=>{
 const f=await fixture();await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[f.scope]);
 const draft=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.employee.membershipId,position:'Cook',start:'2031-05-01T13:00:00Z',end:'2031-05-01T15:00:00Z'}});
 await admin.query("INSERT INTO candidate_operations.weekly_scope_reviews(restaurant_id,workspace_revision,schedule_revision,input_revision,evidence) SELECT r.id,r.revision,c.schedule_revision,c.input_revision,'Complete fictional source fixture' FROM candidate_identity.restaurants r JOIN candidate_operations.scope_coordination c ON c.restaurant_id=r.id WHERE r.id=$1",[f.scope]);
 const review=()=>db.transaction(async c=>(await c.query('SELECT candidate_operations.weekly_review($1,$2,$3,$4,$5::jsonb) result',[f.manager.subject,f.manager.membershipId,f.scope,'2031-04-28',JSON.stringify([draft.recordId])])).rows[0].result),before=await review(),bookings=await rows('person_shift_bookings',f.scope);
 let r=await run(f,command(f));r=await run(f,change(f,r,'attendance.review',{note:'Fictional review'}));r=await run(f,correcting(f,r));await run(f,change(f,r,'attendance.void',{changeReason:'Fictional mistake'}));const later=await review();assert.equal(later.planningReview,before.planningReview);assert.equal(later.scheduleRevision,before.scheduleRevision);assert.equal(later.inputRevision,before.inputRevision);assert.ok(later.workspaceRevision>before.workspaceRevision);assert.deepEqual(await rows('person_shift_bookings',f.scope),bookings);
 await run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.publish-batch',input:{weekStart:'2031-04-28',drafts:[{id:draft.recordId,revision:draft.revision,closing:[]}],confirmed:true,planningReview:before.planningReview,note:'Fictional publication after attendance'}});
});

test('attendance revision advances once per command, survives replay and ignores schedule commands between pages',async()=>{
 const f=await fixture(),c=command(f),r=await run(f,c);await run(f,command(f,{type:'other'}));
 const first=await list(f,f.manager,null,1),h=await history(f,r.recordId);
 assert.equal(first.attendanceRevision,2);assert.equal(h.attendanceRevision,2);assert.equal(h.recordRevision,1);
 await run(f,c);assert.equal((await list(f)).attendanceRevision,2);
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[f.scope]);
 await run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.employee.membershipId,position:'Cook',start:'2031-06-01T13:00:00Z',end:'2031-06-01T15:00:00Z'}});
 const second=await list(f,f.manager,first.nextCursor,1);assert.equal(second.attendanceRevision,first.attendanceRevision);assert.ok(second.workspaceRevision>first.workspaceRevision);
 const reviewed=await run(f,change(f,r,'attendance.review',{note:'Fictional follow-up'}));const later=await history(f,r.recordId);assert.equal(later.attendanceRevision,3);assert.equal(later.recordRevision,reviewed.revision);
});

test('indexed captured-date ranges match the legacy expression across DST and UTC midnight',async()=>{
 const f=await fixture();
 for(const [start,end] of [['2020-03-08T07:30:00Z','2020-03-08T09:30:00Z'],['2020-11-01T06:30:00Z','2020-11-01T08:30:00Z'],['2020-11-02T01:00:00Z','2020-11-02T03:00:00Z']]){
  const s=await shift(f,{start,end});await run(f,command(f,{shiftId:s.id}));
 }
 for(const day of ['2020-03-08','2020-11-01','2020-11-02']){
  const legacy=(await admin.query("SELECT id,shift_local_date::text AS local_day FROM candidate_operations.attendance_entries WHERE restaurant_id=$1 AND ((shift_snapshot->>'start')::timestamptz AT TIME ZONE (shift_snapshot->>'timezone'))::date=$2::date ORDER BY id",[f.scope,day])).rows;
  assert.deepEqual((await list(f,f.manager,null,100,day,day)).items.map(r=>r.id),legacy.map(r=>r.id));assert.ok(legacy.every(r=>r.local_day===day));
 }
 const indexes=(await admin.query("SELECT indexdef FROM pg_indexes WHERE schemaname='candidate_operations' AND indexname IN ('attendance_scope_date_page','attendance_scope_shift_page')")).rows.map(r=>r.indexdef);
 assert.ok(indexes.some(s=>s.includes('(restaurant_id, shift_local_date, id)')));assert.ok(indexes.some(s=>s.includes('(restaurant_id, shift_id, id)')));
});

test('captured local date and timezone remain immutable through corrections and reassignment',async()=>{
 const f=await fixture(),r=await run(f,command(f));
 const date=()=>admin.query('SELECT shift_local_date::text AS local_day FROM candidate_operations.attendance_entries WHERE id=$1',[r.recordId]);
 const before=(await date()).rows[0].local_day;
 await run(f,correcting(f,r));await admin.query('UPDATE candidate_operations.shift_references SET member_id=$1 WHERE id=$2',[f.replacement.membershipId,f.shift.id]);
 assert.equal((await date()).rows[0].local_day,before);
 await assert.rejects(admin.query("UPDATE candidate_operations.attendance_entries SET shift_local_date=shift_local_date+1 WHERE id=$1",[r.recordId]),e=>e.message==='attendance_snapshot_immutable');
 await assert.rejects(admin.query("UPDATE candidate_operations.attendance_entries SET shift_snapshot=jsonb_set(shift_snapshot,'{timezone}','\"UTC\"') WHERE id=$1",[r.recordId]),e=>e.message==='attendance_snapshot_immutable');
});

test('per-shift HTTP read is paginated, keeps previous assignees and voids, and rejects mixed or foreign selectors',async()=>{
 const f=await fixture(),a=await run(f,command(f));await run(f,change(f,a,'attendance.void',{changeReason:'Fictional mistake'}));
 await admin.query('UPDATE candidate_operations.shift_references SET member_id=$1,revision=revision+1 WHERE id=$2',[f.replacement.membershipId,f.shift.id]);
 const b=await run(f,command(f,{shiftRevision:2}));const call=http(f),first=await call('/attendance?shift='+f.shift.id+'&limit=1');assert.equal(first.status,200);assert.equal(first.body.shiftId,f.shift.id);
 const second=await call('/attendance?shift='+f.shift.id+'&limit=1&after='+first.body.nextCursor),items=[...first.body.items,...second.body.items];
 assert.deepEqual(items.map(r=>r.id).sort(),[a.recordId,b.recordId].sort());assert.ok(items.some(r=>r.ownerId===f.employee.membershipId&&r.data.status==='voided'));assert.ok(items.some(r=>r.ownerId===f.replacement.membershipId));
 for(const path of ['/attendance?shift=x','/attendance?shift='+f.shift.id+'&from=2020-05-01&to=2020-05-01','/attendance?shift='+f.shift.id+'&shift='+f.shift.id])assert.equal((await call(path)).status,400);
 const foreign=await fixture();assert.equal((await call('/attendance?shift='+foreign.shift.id)).status,403);assert.equal((await http(f,f.employee)('/attendance?shift='+f.shift.id)).status,403);
});

test('failed attendance receipt rolls back the attendance counter as well as global state',async()=>{
 const f=await fixture(),before=(await list(f)).attendanceRevision;
 await admin.query("CREATE FUNCTION candidate_operations.fail_attendance_scope_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'action' LIKE 'attendance.%' THEN RAISE EXCEPTION 'fictional_scope_receipt_failure'; END IF; RETURN NEW; END; $$");
 await admin.query('CREATE TRIGGER fail_attendance_scope_receipt BEFORE INSERT ON candidate_operations.command_receipts FOR EACH ROW EXECUTE FUNCTION candidate_operations.fail_attendance_scope_receipt()');
 try{await assert.rejects(run(f,command(f)),e=>e.message==='fictional_scope_receipt_failure');assert.equal((await list(f)).attendanceRevision,before);}finally{await admin.query('DROP TRIGGER fail_attendance_scope_receipt ON candidate_operations.command_receipts');await admin.query('DROP FUNCTION candidate_operations.fail_attendance_scope_receipt()');}
});

test('current authorized self-actions remain allowed across two memberships pending later policy review',async()=>{
 const f=await fixture(),self=await shift(f,{owner:f.manager.membershipId,start:'2020-05-02T13:00:00Z',end:'2020-05-02T15:00:00Z'});
 let r=await run(f,command(f,{shiftId:self.id}));const alias=randomUUID(),other=await fixture();
 await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'Service','Cook')",[alias,f.manager.person,other.scope]);await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'location.manage',true)",[alias]);
 const actor=f.manager;
 r=await run(f,change(f,r,'attendance.review',{note:'Fictional own-entry review'}),actor);r=await run(f,change(f,r,'attendance.reopen',{note:'Fictional own-entry reopening'}),actor);r=await run(f,change(f,r,'attendance.void',{changeReason:'Fictional own-entry mistake'}),actor);
 assert.equal((await detail(f,r.recordId)).data.status,'voided');
});
