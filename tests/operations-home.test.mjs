import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsHome,availableModules} from '../.sites-runtime/shared/operations-home.mjs';
import {managerHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {fixtureRecords} from './manager-log-fixture.mjs';

const owner={id:'owner',locationId:'rudds',area:'Executive',position:'Manager',capabilities:['location.manage'],name:'Owner',qualifications:[]};
const foh={...owner,id:'foh',area:'FOH',capabilities:['tasks.manage'],name:'FOH manager'};
const boh={...foh,id:'boh',area:'BOH',name:'BOH manager'};
const worker={...boh,id:'worker',capabilities:[]};
const w={location:{id:'rudds',name:'Rudd’s',timezone:'America/New_York',revision:1},me:owner,members:[owner,foh,boh,worker],records:[]};
const now='2026-09-28T18:00:00Z';
function issue(id,overrides={}){return {id,locationId:'rudds',kind:'managerlog',ownerId:'boh',area:'BOH',revision:1,updatedAt:now,data:{title:id,detail:'Issue detail',category:'Maintenance',priority:'routine',due:null,status:'open',acceptedBy:'',resolution:'',history:[{at:'2026-09-21T20:00:00Z',actorId:'boh',action:'created',note:'Recorded'}]},...overrides};}
function meeting(ownerId='owner'){return {id:'meeting',locationId:'rudds',ownerId,kind:'meeting',area:'BOH',revision:1,updatedAt:now,data:{title:'Private',managerId:'boh',status:'active',due:now,cadenceDays:14,agenda:'Private agenda',actions:[{id:'action',title:'Private action',due:now,ownerId:'boh',doneAt:''}],sessions:[{at:now,by:ownerId,notes:'Private notes',agenda:'Private agenda'}],history:[]}};}

test('daily brief scopes issues and meeting follow-ups without treating blank due dates as overdue',()=>{
 const blank=issue('blank');const overdue=issue('overdue',{data:{...blank.data,title:'Overdue',due:'2026-09-27T10:00:00Z'}});
 const urgent=issue('urgent',{data:{...blank.data,title:'Urgent',priority:'urgent'}});
 const resolved=issue('resolved',{data:{...blank.data,status:'resolved'}});
 const home=operationsHome({...w,records:[blank,overdue,urgent,resolved,issue('foreign',{locationId:'papa'}),meeting(),meeting('otherowner')]},now);
 assert.equal(home.issues.length,3);assert.equal(home.issues[0].id,'urgent');assert.equal(home.overdue.length,1);assert.equal(home.repairs.length,3);
 assert.equal(home.meetings.length,1);assert.equal(home.followups.length,1);
 const limited=operationsHome({...w,me:foh,records:[blank,meeting()]},now);
 assert.equal(limited.issues.length,0);assert.equal(limited.meetings.length,0);assert.equal(limited.followups.length,0);
});
test('daily brief uses restaurant date, excludes unpublished shifts and keeps absent handoffs unknown',()=>{
 const shift={id:'shift',locationId:'rudds',ownerId:'boh',area:'BOH',kind:'shift',revision:1,updatedAt:now,data:{personId:'boh',start:'2026-09-28T02:30:00Z',end:'2026-09-28T05:00:00Z',position:'Cook',published:true,cancelled:false}};
 const summary={id:'draft',locationId:'rudds',ownerId:'boh',area:'BOH',kind:'shiftentry',revision:1,updatedAt:now,data:{businessDate:'2026-09-27',shift:'closing',department:'BOH',status:'draft',readiness:'ready',summary:'Draft only',tomorrowNote:'Not submitted',issueIds:[],submittedAt:'',history:[],versions:[]}};
 const home=operationsHome({...w,me:{...owner,capabilities:['location.manage','schedule.manage']},records:[shift,{...shift,id:'unpublished',data:{...shift.data,published:false}},summary]},'2026-09-28T03:00:00Z');
 assert.equal(home.day,'2026-09-27');assert.equal(home.shifts.length,1);assert.equal(home.drafts.length,1);assert.ok(home.handoffs.every(h=>!h.record));
});
test('module catalogue exposes only mounted tools to managers and leaves owner integration gaps explicit',()=>{
 const staffModules=availableModules(worker);assert.deepEqual(staffModules.map(m=>m.tab),['Staff ideas','Recognition']);
 assert.equal(availableModules({...owner,position:'Dishwasher'}).length,0);
 assert.ok(availableModules(foh).every(m=>m.tab));assert.ok(!availableModules(foh).some(m=>m.access==='owner'));
 const modules=availableModules(owner);assert.ok(modules.some(m=>m.id==='prep'&&m.tab==='Prep production'&&!m.pending));assert.ok(modules.some(m=>m.id==='repairs'&&m.tab==='Repairs'));
 assert.ok(!modules.some(m=>m.id==='purchasing'),'an owner still needs explicit ordering capabilities');
 assert.ok(availableModules({...owner,capabilities:['location.manage','orders.review']}).some(m=>m.id==='purchasing'&&m.tab==='Purchasing review'&&!m.pending));
 assert.ok(modules.some(m=>m.id==='supplier-submission'&&!m.tab&&/not connected/.test(m.pending)));
 assert.ok(!modules.some(m=>m.id==='clock'));
});
test('handoff contract preserves shared fixture identifiers and closed-day carryover without private meetings',()=>{
 const data=managerHandoff({...w,records:[...fixtureRecords(),meeting()]},'2026-09-23','FOH');
 assert.equal(data.schema_version,'jmax-manager-handoff.v1');
 assert.ok(data.shift_entries.length>0);assert.equal(data.previous_handoffs[0].business_date,'2026-09-21');
 assert.ok(data.opening_carried_issue_ids.length>0);assert.ok(data.issues.every(r=>r.store_id==='rudds'&&r.department==='FOH'));
 assert.ok(data.issues.some(r=>r.due_at===null));
 assert.ok(!JSON.stringify(data).includes('Private notes'));assert.ok(!('meetings' in data));
 assert.throws(()=>managerHandoff({...w,me:worker},'2026-09-23'),/Manager access/);
 assert.throws(()=>managerHandoff({...w,me:foh},'2026-09-23','BOH'),/department/);
 assert.throws(()=>managerHandoff(w,'2026-02-30'),/date/i);
});
