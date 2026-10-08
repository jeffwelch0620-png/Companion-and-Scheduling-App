import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {buildShiftBrief} from '../.sites-runtime/shared/shift-brief.mjs';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {employeeCheckoutRecords} from './employee-checkout-fixture.mjs';

const at='2026-10-08T02:00:00.000Z';
function fixture(){
 const f=employeeCheckoutRecords(at),member=(id,capabilities=[])=>({id,locationId:'rudds',name:id,position:capabilities.length?'Manager':'Server',area:'FOH',qualifications:['Server'],capabilities});
 const employee=member(f.employeeId),manager=member(f.managerId,['tasks.manage','close.confirm','people.manage']),other=member('other-manager',['tasks.manage','close.confirm','people.manage']);
 let w={location:{id:'rudds',name:'Fictional Rudd’s',timezone:'America/New_York',revision:1},members:[employee,manager,other],me:employee,records:f.records};
 const run=(actor,action,input,r)=>{w={...w,me:actor};const changes=applyCommand(w,{requestId:crypto.randomUUID(),locationId:'rudds',action,input,recordId:r.id,expectedRevision:r.revision},at),ids=new Set(changes.map(c=>c.id));w={...w,records:[...w.records.filter(c=>!ids.has(c.id)),...changes]};return w.records.find(c=>c.id===r.id)};
 return {...f,employee,manager,other,run,get w(){return w}};
}
test('ended shift keeps side work and waiting checkout reachable until independent manager release',()=>{
 const f=fixture();let close=f.close,shift=f.shift;
 let work=myWork(publicWorkspace(f.w),at);assert.equal(work.shift.id,shift.id);assert.equal(work.checkoutPending,true);assert.equal(work.current,false);assert.equal(work.duties[0].record.id,close.id);
 assert.equal(workforceContext(f.w,'What should I do for this shift?',at).context.myShift.status,'scheduled shift ended; operational checkout pending');
 assert.throws(()=>f.run(f.manager,'shift.release',{note:'Too early'},shift),/every assigned close/);
 close=f.run(f.employee,'close.transition',{step:'ready',answers:[0],note:'Fictional silverware and section are ready'},close);
 assert.equal(close.data.phase,'manager-confirmation');assert.match(myWork(publicWorkspace({...f.w,me:f.employee}),at).duties[0].next,/Waiting for/);
 assert.throws(()=>f.run(f.employee,'close.transition',{step:'confirm',note:'Self check'},close));
 assert.throws(()=>f.run(f.other,'close.transition',{step:'confirm',note:'Unassigned reviewer'},close));
 assert.match(buildShiftBrief({...f.w,me:f.manager},at).items.find(i=>i.record.id===close.id).next,/final physical check/);
 close=f.run(f.manager,'close.transition',{step:'confirm',note:'Fictional physical side-work check passed'},close);
 work=myWork(publicWorkspace({...f.w,me:f.employee}),at);assert.equal(close.data.phase,'closed');assert.equal(work.duties.find(i=>i.record.id===shift.id).next,'Waiting for manager checkout');
 assert.match(f.standard.data.guide.steps.join(' '),/manager.*settle the server bank before release/);
 assert.equal(shift.data.releasedAt,undefined);
 shift=f.run(f.manager,'shift.release',{note:'Fictional manager release recorded; no banking amounts recorded'},shift);
 assert.ok(shift.data.releasedAt);work=myWork(publicWorkspace({...f.w,me:f.employee}),at);assert.equal(work.shift,undefined);assert.deepEqual(work.duties,[]);
 assert.equal(shift.data.start,f.shift.data.start);assert.equal(shift.data.end,f.shift.data.end);assert.equal(f.w.records.some(r=>/cash|payroll/.test(r.kind)),false);
});
test('new shift takes focus without erasing earlier checkout; cancelled, draft and foreign shifts cannot supply checkout focus',()=>{
 const f=fixture();f.close.data.phase='closed';
 const next={...f.shift,id:'next',data:{...f.shift.data,start:'2026-10-08T01:45:00.000Z',end:'2026-10-08T06:00:00.000Z'}};f.w.records.push(next);
 const work=myWork(f.w,at);assert.equal(work.shift.id,'next');assert.equal(work.checkoutPending,false);assert.ok(work.duties.some(i=>i.record.id===f.shift.id));
 for(const mutate of [s=>s.data.cancelled=true,s=>s.data.published=false,s=>s.locationId='elsewhere']){const other=fixture();mutate(other.shift);assert.equal(myWork(other.w,at).shift,undefined)}
 const old=fixture();old.shift.data.end='2026-10-06T01:00:00.000Z';old.close.data.phase='closed';const older=myWork(old.w,at);assert.equal(older.shift,undefined);assert.ok(older.duties.some(i=>i.record.id===old.shift.id));
});
