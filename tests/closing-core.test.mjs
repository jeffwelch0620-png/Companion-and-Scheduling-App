import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {closingStatus} from '../.sites-runtime/shared/closing-status.mjs';
import {gmOperatingSetup,gmClosingSetup} from '../.sites-runtime/shared/gm-operating-setup.mjs';

function fixture(){
 const at='2026-10-08T18:00:00.000Z';
 const member=(id,area,position,capabilities=[])=>({id,locationId:'rudds',name:'FICTIONAL '+id,area,position,capabilities,qualifications:['Pizza Make','Pizza Catch'],scheduleJobs:position==='Cook'?['Cook']:[position]});
 const admin=member('admin','Executive','Owner',['location.manage','people.manage','tasks.manage','schedule.manage','schedule.publish','schedule.change','close.confirm']);
 const pizza=member('pizza','BOH','Cook'),second=member('second','BOH','Cook'),expo=member('expo','FOH','Expo');
 const w={location:{id:'rudds',name:'Fictional closing test',timezone:'America/New_York',revision:1},members:[admin,pizza,second,expo],me:admin,records:[]};let serial=0;
 const run=(actor,action,input={},r)=>{w.me=actor;const changes=applyCommand(w,{locationId:'rudds',requestId:crypto.randomUUID(),action,input,...(r?{recordId:r.id,expectedRevision:r.revision}:{})},at,()=>`fictional-${++serial}`);for(const c of changes){const i=w.records.findIndex(p=>p.id===c.id);if(i<0)w.records.push(c);else w.records[i]=c;}return changes.find(c=>c.kind===action.split('.')[0])??changes[0];};
 const station=run(admin,'station.save',{title:'Pizza Make',area:'BOH',status:'active',levels:[],independentLevel:null,note:'Fictional',setup:{jobs:['Cook'],allJobMembers:true,memberIds:[],standardIds:[],managerId:admin.id,goals:[]}});
 let shift=run(admin,'shift.save',{personId:pizza.id,position:'Cook',stationId:station.id,start:'2026-10-08T19:00:00Z',end:'2026-10-09T01:00:00Z'});shift=run(admin,'shift.publish',{},shift);
 const guide=(id,position,status='approved',locationId='rudds')=>{const r={id,kind:'standard',ownerId:admin.id,locationId,area:'BOH',revision:1,updatedAt:at,data:{title:id,zone:id,position,status,version:1,source:'Fictional only',verification:'manager',criteria:['Table clean'],history:[]}};w.records.push(r);return r;};
 const task=(extra={})=>run(admin,'task.create',{ownerId:pizza.id,title:'Fictional required table work',detail:'Clean table and request independent check',kind:'task',due:shift.data.end,shiftId:shift.id,...extra});
 return {w,admin,pizza,second,expo,station,shift,run,guide,task};
}

test('Cook station close accepts exact approved station guide and rejects another station, draft or restaurant',()=>{
 const f=fixture(),approved=f.guide('make-guide','Pizza Make');
 const close=f.run(f.admin,'close.assign',{shiftId:f.shift.id,standardId:approved.id,managerId:f.admin.id,due:f.shift.data.end});assert.equal(close.data.standard.position,'Pizza Make');
 for(const g of [f.guide('catch-guide','Pizza Catch'),f.guide('draft-guide','Pizza Make','draft'),f.guide('foreign-guide','Pizza Make','approved','berts')])assert.throws(()=>f.run(f.admin,'close.assign',{shiftId:f.shift.id,standardId:g.id,managerId:f.admin.id,due:f.shift.data.end}),/approved standard/);
 // A same-owner schedule time edit remains valid for the approved station guide.
 const edited=f.run(f.admin,'shift.save',{personId:f.pizza.id,position:'Cook',stationId:f.station.id,start:f.shift.data.start,end:'2026-10-09T02:00:00Z',note:'Fictional extended shift'},f.shift);assert.equal(edited.data.stationId,f.station.id);
});

test('only explicitly linked verified checkout tasks block release and all link conditions are validated',()=>{
 const f=fixture();
 const other=fixture();f.w.records.push({...other.shift,id:'wrong-owner',ownerId:f.second.id});
 for(const extra of [{shiftId:'missing'},{shiftId:'wrong-owner'},{due:'2026-10-09T02:00:00Z'},{due:'2026-10-08T18:00:00Z'}])assert.throws(()=>f.task(extra));
 f.w.records=f.w.records.filter(r=>r.id!=='wrong-owner');
 for(const patch of [{published:false},{cancelled:true},{releasedAt:'2026-10-09T01:00:00Z'}]){const invalid={...f.shift,id:'invalid',data:{...f.shift.data,...patch}};f.w.records.push(invalid);assert.throws(()=>f.task({shiftId:invalid.id}),/active published shift/);f.w.records.pop();}
 const unrelated=f.task({shiftId:undefined,title:'Fictional future optional issue',kind:'issue'});let required=f.task();
 assert.equal(closingStatus(f.w,f.shift).tasks.length,1);assert.throws(()=>f.run(f.admin,'shift.release',{note:'Too early'},f.shift),/every task required/);
 assert.throws(()=>f.run(f.admin,'task.reassign',{ownerId:f.second.id,note:'Wrong linked owner'},required),/linked shift/);
 assert.throws(()=>f.run(f.admin,'shift.cancel',{note:'Must preserve checkout'},f.shift),/linked checkout work/);
 assert.throws(()=>f.run(f.admin,'shift.save',{personId:f.second.id,position:'Cook',stationId:f.station.id,start:f.shift.data.start,end:f.shift.data.end,note:'Must preserve checkout'},f.shift),/linked checkout work/);
 required=f.run(f.pizza,'task.transition',{step:'ready',note:'Fictional work ready'},required);assert.throws(()=>f.run(f.admin,'shift.release',{note:'Still unchecked'},f.shift),/every task required/);
 assert.throws(()=>f.run(f.pizza,'task.transition',{step:'verify',note:'Fictional self check'},required));
 required=f.run(f.admin,'task.transition',{step:'fix',note:'Fictional crumb remains'},required);assert.equal(required.data.phase,'correction');
 required=f.run(f.pizza,'task.transition',{step:'ready',note:'Fictional correction ready'},required);required=f.run(f.admin,'task.transition',{step:'verify',note:'Independent fictional check'},required);
 assert.equal(closingStatus(f.w,f.shift).complete,true);assert.equal(unrelated.data.phase,'open');assert.ok(f.run(f.admin,'shift.release',{note:'Fictional checkout complete'},f.shift).data.releasedAt);
});

test('linked late catch handoff transfers remaining work, retains original checkout block and narrow visibility',()=>{
 const f=fixture(),unrelated=f.task({shiftId:undefined,title:'Fictional unrelated BOH issue'});let handoff=f.task({kind:'handoff',incomingId:f.expo.id});
 handoff=f.run(f.pizza,'task.transition',{step:'ready',note:'Fictional pizza remains in oven'},handoff);handoff=f.run(f.admin,'task.transition',{step:'verify',note:'Fictional state checked'},handoff);
 assert.throws(()=>f.run(f.admin,'shift.release',{note:'Acceptance pending'},f.shift),/every task required/);
 handoff=f.run(f.expo,'task.transition',{step:'accept',note:'Fictional Expo receives remaining catch'},handoff);
 assert.equal(handoff.ownerId,f.expo.id);assert.equal(handoff.data.phase,'open');assert.equal(handoff.data.shiftId,f.shift.id);assert.equal(handoff.data.closingHandoff.outgoingId,f.pizza.id);
 assert.throws(()=>f.run(f.admin,'shift.release',{note:'Received is not completed'},f.shift),/every task required/);
 const expoView=publicWorkspace({...f.w,me:f.expo});assert.ok(expoView.records.some(r=>r.id===handoff.id));assert.ok(!expoView.records.some(r=>r.id===unrelated.id));
 assert.ok(publicWorkspace({...f.w,me:f.pizza}).records.some(r=>r.id===handoff.id));
 handoff=f.run(f.expo,'task.transition',{step:'ready',note:'Fictional pizza caught, cut, garnished and plated'},handoff);handoff=f.run(f.admin,'task.transition',{step:'verify',note:'Fictional manager verified finished service'},handoff);
 assert.equal(handoff.data.phase,'closed');assert.ok(f.run(f.admin,'shift.release',{note:'Fictional catch complete'},f.shift).data.releasedAt);
});

test('unlinked handoff retains its legacy receipt behavior and revoked incoming account cannot accept linked work',()=>{
 const f=fixture();let legacy=f.task({shiftId:undefined,kind:'handoff',incomingId:f.expo.id});legacy=f.run(f.pizza,'task.transition',{step:'ready',note:'Fictional'},legacy);legacy=f.run(f.admin,'task.transition',{step:'verify',note:'Fictional'},legacy);legacy=f.run(f.expo,'task.transition',{step:'accept',note:'Fictional'},legacy);assert.equal(legacy.data.phase,'closed');assert.equal(legacy.ownerId,f.pizza.id);
 let linked=f.task({kind:'handoff',incomingId:f.expo.id});linked=f.run(f.pizza,'task.transition',{step:'ready',note:'Fictional'},linked);linked=f.run(f.admin,'task.transition',{step:'verify',note:'Fictional'},linked);f.w.members=f.w.members.filter(m=>m.id!==f.expo.id);
 assert.throws(()=>f.run(f.expo,'task.transition',{step:'accept',note:'Removed incoming'},linked),/active employee/);assert.equal(closingStatus(f.w,f.shift).complete,false);
});

test('reviewed store GM closing access resolves actual Cook station guides and still requires leadership and independence',()=>{
 const f=fixture();
 const base={...f.admin,id:'base-gm',position:'General manager',capabilities:gmOperatingSetup().capabilities};
 const gm={...base,id:'reviewed-gm',capabilities:gmClosingSetup().capabilities};f.w.members.push(base,gm);
 const guide=f.guide('actual-station-guide','Pizza Make');
 f.w.records.push({id:'gm-leadership',kind:'leadership',ownerId:gm.id,locationId:'rudds',area:'BOH',revision:1,updatedAt:f.shift.data.start,data:{personId:gm.id,area:'BOH',start:f.shift.data.start,end:f.shift.data.end,active:true,note:'Fictional explicitly assigned whole-store closing review'}});
 const view=publicWorkspace({...f.w,me:gm});assert.ok(view.records.some(r=>r.id===f.station.id));assert.ok(view.records.some(r=>r.id===guide.id));
 assert.throws(()=>f.run(base,'close.assign',{shiftId:f.shift.id,standardId:guide.id,managerId:base.id,due:f.shift.data.end}),/independent manager/);
 let close=f.run(gm,'close.assign',{shiftId:f.shift.id,standardId:guide.id,managerId:gm.id,due:f.shift.data.end});
 close=f.run(f.pizza,'close.transition',{step:'ready',answers:[0],note:'Fictional table ready'},close);
 assert.throws(()=>f.run(f.pizza,'close.transition',{step:'confirm',note:'Self check'},close));
 close=f.run(gm,'close.transition',{step:'confirm',note:'Reviewed GM fictional physical check'},close);assert.equal(close.data.phase,'closed');
 const leader=f.w.records.find(r=>r.id==='gm-leadership');leader.data.active=false;
 assert.throws(()=>f.run(gm,'shift.release',{note:'Leadership removed'},f.shift),/assigned closing manager/);leader.data.active=true;
 assert.ok(f.run(gm,'shift.release',{note:'Fictional GM checkout confirmed'},f.shift).data.releasedAt);
});
