import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {buildShiftBrief} from '../.sites-runtime/shared/shift-brief.mjs';
import {buildRoleHome} from '../.sites-runtime/shared/role-home.mjs';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {employeeCheckoutRecords} from './employee-checkout-fixture.mjs';

const at='2026-10-08T02:00:00.000Z';
function fixture({close=true}={}){
 const f=employeeCheckoutRecords(at),member=(id,capabilities=[])=>({id,locationId:'rudds',name:id,position:capabilities.length?'Manager':'Server',area:'FOH',qualifications:['Server'],capabilities});
 const employee=member(f.employeeId),manager=member(f.managerId,['tasks.manage','close.confirm','people.manage']);
 let w={location:{id:'rudds',name:'Fictional Rudd’s',timezone:'America/New_York',revision:1},members:[employee,manager],me:employee,records:f.records.filter(r=>close||r.kind!=='close')};
 const run=(actor,action,input,r,when=at)=>{w={...w,me:actor};const changes=applyCommand(w,{requestId:crypto.randomUUID(),locationId:'rudds',action,input,...(r?{recordId:r.id,expectedRevision:r.revision}:{})},when),ids=new Set(changes.map(c=>c.id));w={...w,records:[...w.records.filter(c=>!ids.has(c.id)),...changes]};return w.records.find(c=>c.id===r?.id)??changes.find(c=>c.kind==='task');};
 const view=actor=>publicWorkspace({...w,me:actor??employee},at);
 return {...f,employee,manager,run,view,get w(){return w}};
}

test('ended shift without a close remains waiting overnight until independent manager release',()=>{
 const f=fixture({close:false});
 for(const when of [at,'2026-10-08T12:00:00.000Z']){
  const w=f.view(),work=myWork(w,when),brief=buildShiftBrief(w,when),home=buildRoleHome(w,'frontline',new Date(when));
  assert.equal(work.shift.id,f.shift.id);assert.equal(work.checkoutPending,true);assert.equal(work.current,false);
  assert.equal(work.duties.find(i=>i.record.id===f.shift.id).next,'Waiting for manager checkout');assert.equal(brief.shift.id,f.shift.id);
  assert.match(home.attention.find(i=>i.recordId===f.shift.id).why,/scheduled shift has ended/);assert.doesNotMatch(home.attention.find(i=>i.recordId===f.shift.id).why,/next published assignment/);
  assert.equal(home.attention.filter(i=>i.recordId===f.shift.id).length,1);
  assert.equal(workforceContext(w,'What is my shift?',when).context.myShift.status,'scheduled shift ended; operational checkout pending');
 }
 assert.equal(buildShiftBrief(f.view(f.manager),at).items.find(i=>i.record.id===f.shift.id).next,'Confirm operational checkout');
 assert.throws(()=>f.run(f.employee,'shift.release',{note:'Self release'},f.shift),/assigned closing manager/);
 const released=f.run(f.manager,'shift.release',{note:'Fixture actual release checks completed.'},f.shift);
 assert.ok(released.data.releasedAt);assert.equal(myWork(f.view(),at).shift,undefined);assert.equal(myWork(f.view(),at).duties.some(i=>i.record.id===f.shift.id),false);
 assert.equal(released.data.start,f.shift.data.start);assert.equal(released.data.end,f.shift.data.end);
});

test('linked side work blocks checkout through readiness and correction; unrelated work does not',()=>{
 const f=fixture({close:false});
 let linked=f.run(f.manager,'task.create',{ownerId:f.employeeId,kind:'task',shiftId:f.shift.id,title:'Fixture silverware side work',detail:'Complete silverware for this shift.',due:f.shift.data.end});
 const unrelated=f.run(f.manager,'task.create',{ownerId:f.employeeId,kind:'task',title:'Future fixture learning supplies',detail:'Unrelated to operational checkout.',due:'2026-10-10T02:00:00.000Z'});
 const employeeBrief=()=>buildShiftBrief(f.view(),at),managerBrief=()=>buildShiftBrief(f.view(f.manager),at);
 assert.match(employeeBrief().items.find(i=>i.record.id===linked.id).reason,/linked to shift checkout/);
 assert.match(myWork(f.view(),at).duties.find(i=>i.record.id===f.shift.id).next,/Closing work remains/);
 assert.equal(managerBrief().items.some(i=>i.record.id===f.shift.id),false);
 assert.throws(()=>f.run(f.manager,'shift.release',{note:'Too early'},f.shift),/task.*checkout/i);
 linked=f.run(f.employee,'task.transition',{step:'ready',note:'Fixture silverware ready.'},linked);
 assert.equal(linked.data.phase,'verification');assert.match(employeeBrief().items.find(i=>i.record.id===linked.id).reason,/checkout waits/);
 assert.equal(managerBrief().items.some(i=>i.record.id===f.shift.id),false);
 linked=f.run(f.manager,'task.transition',{step:'fix',note:'Fixture missing bag.'},linked);
 assert.match(employeeBrief().items.find(i=>i.record.id===linked.id).next,/correction/);
 linked=f.run(f.employee,'task.transition',{step:'ready',note:'Fixture bag corrected.'},linked);
 linked=f.run(f.manager,'task.transition',{step:'verify',note:'Fixture physical check passed.'},linked);
 assert.equal(linked.data.phase,'closed');assert.equal(managerBrief().items.find(i=>i.record.id===f.shift.id).next,'Confirm operational checkout');
 assert.equal(employeeBrief().items.find(i=>i.record.id===f.shift.id).next,'Waiting for manager checkout');
 assert.equal(f.w.records.find(r=>r.id===unrelated.id).data.phase,'open');
 const released=f.run(f.manager,'shift.release',{note:'Fixture independent checkout after linked work verified.'},f.shift);
 assert.ok(released.data.releasedAt);assert.equal(myWork(f.view(),at).duties.some(i=>i.record.id===f.shift.id),false);assert.ok(f.w.records.find(r=>r.id===unrelated.id));
});

test('current shift has focus while older no-close checkout remains reachable; invalid shifts never supply checkout',()=>{
 const f=fixture({close:false});
 const next={...f.shift,id:'fixture-current',data:{...f.shift.data,start:'2026-10-08T01:45:00.000Z',end:'2026-10-08T06:00:00.000Z'}};f.w.records.push(next);
 let work=myWork(f.view(),at);assert.equal(work.shift.id,next.id);assert.equal(work.checkoutPending,false);assert.ok(work.duties.some(i=>i.record.id===f.shift.id));
 const older=fixture({close:false});older.shift.data.end='2026-10-06T01:00:00.000Z';work=myWork(older.view(),at);assert.equal(work.shift,undefined);assert.ok(work.duties.some(i=>i.record.id===older.shift.id));
 for(const mutate of [s=>s.data.cancelled=true,s=>s.data.published=false,s=>s.locationId='foreign',s=>s.data.releasedAt=at]){
  const invalid=fixture({close:false});mutate(invalid.shift);const w=invalid.view();assert.equal(myWork(w,at).shift,undefined);assert.equal(myWork(w,at).duties.some(i=>i.record.id===invalid.shift.id),false);
 }
});

test('outgoing employee sees accepted linked handoff until incoming completion and independent verification',()=>{
 const f=fixture({close:false}),incoming={...f.employee,id:'fixture-incoming',name:'Fictional incoming Server'};f.w.members.push(incoming);
 let handoff=f.run(f.manager,'task.create',{ownerId:f.employeeId,kind:'handoff',incomingId:incoming.id,shiftId:f.shift.id,title:'Fixture unfinished silverware',detail:'Incoming Server must finish the remaining bagged silverware.',due:f.shift.data.end});
 handoff=f.run(f.employee,'task.transition',{step:'ready',note:'Fixture outgoing condition reported.'},handoff);
 handoff=f.run(f.manager,'task.transition',{step:'verify',note:'Fixture handoff condition checked, work remains.'},handoff);
 handoff=f.run(incoming,'task.transition',{step:'accept',note:'Fixture incoming Server accepts the unfinished work.'},handoff);
 assert.equal(handoff.ownerId,incoming.id);assert.equal(handoff.data.phase,'open');assert.equal(handoff.data.closingHandoff.outgoingId,f.employeeId);
 let outgoing=myWork(f.view(),at),received=myWork(f.view(incoming),at);
 assert.match(outgoing.duties.find(i=>i.record.id===handoff.id).next,/Waiting for/);assert.match(outgoing.duties.find(i=>i.record.id===handoff.id).reason,/checkout waits/);
 assert.match(outgoing.duties.find(i=>i.record.id===f.shift.id).next,/Closing work remains/);assert.equal(received.duties.find(i=>i.record.id===handoff.id).lane,'action');
 assert.throws(()=>f.run(f.manager,'shift.release',{note:'Acceptance is not completion.'},f.shift),/task.*checkout/i);
 handoff=f.run(incoming,'task.transition',{step:'ready',note:'Fixture silverware now complete.'},handoff);
 assert.match(myWork(f.view(),at).duties.find(i=>i.record.id===handoff.id).next,/manager/);
 handoff=f.run(f.manager,'task.transition',{step:'verify',note:'Fixture independent completed-work check.'},handoff);
 assert.equal(handoff.data.phase,'closed');outgoing=myWork(f.view(),at);assert.equal(outgoing.duties.some(i=>i.record.id===handoff.id),false);assert.equal(outgoing.duties.find(i=>i.record.id===f.shift.id).next,'Waiting for manager checkout');
 const released=f.run(f.manager,'shift.release',{note:'Fixture release after incoming work completion was checked.'},f.shift);assert.ok(released.data.releasedAt);
});
