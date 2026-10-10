import test from 'node:test';import assert from 'node:assert/strict';
import {loadScheduleScreen,ScheduleScreenSender} from './schedule-screen-client.mjs';
const viewer=()=>({location:{id:'fictional-screen',timezone:'America/New_York',revision:1},me:{id:'worker',capabilities:[]},workspaceRevision:1});
const ok=body=>({status:200,body});
test('request workspace loads every page, carries only current viewer permissions and retains scoped shifts',async()=>{
 const calls=[];const w=await loadScheduleScreen(async path=>{calls.push(path);if(path==='/schedule-viewer')return ok(viewer());const roster=path.startsWith('/schedule-roster');return ok({workspaceRevision:1,items:roster?[{id:path.includes('after')?'worker':'other'}]:[{id:path,kind:path.startsWith('/schedule-stations')?'station':'shift',data:{}}],nextCursor:roster&&!path.includes('after')?'next':null});});
 assert.equal(calls.filter(p=>p.startsWith('/schedule-roster')).length,2);assert.equal(w.records.length,4);assert.deepEqual(w.members.map(m=>m.capabilities),[[],[]]);
});
test('revision drift retries the entire workspace instead of mixing snapshots',async()=>{
 let version=1,read=0;const w=await loadScheduleScreen(async path=>{if(path==='/schedule-viewer')return ok({...viewer(),workspaceRevision:version});if(++read===1){version=2;return ok({workspaceRevision:2,items:[{id:'mixed'}],nextCursor:null});}return ok({workspaceRevision:2,items:[],nextCursor:null});});assert.equal(w.records.length,0);assert.ok(read>1);
});
test('changed viewer permissions during reads retry without preserving old authority',async()=>{
 let views=0;const w=await loadScheduleScreen(async path=>path==='/schedule-viewer'?ok({...viewer(),me:{id:'worker',capabilities:++views===1?['schedule.manage']:[]}}):ok({workspaceRevision:1,items:[],nextCursor:null}));assert.deepEqual(w.me.capabilities,[]);assert.equal(views,4);
});
test('failed or revoked reads reject a workspace rather than showing partial results',async()=>{
 await assert.rejects(loadScheduleScreen(async path=>path==='/schedule-viewer'?ok(viewer()):{status:403}),/No partial/);
 let n=0;await assert.rejects(loadScheduleScreen(async path=>path==='/schedule-viewer'?(++n===1?ok(viewer()):{status:401}):ok({workspaceRevision:1,items:[],nextCursor:null})),/access changed/);
});
test('endless cursors and repeated concurrent changes stop with a reload instruction',async()=>{
 await assert.rejects(loadScheduleScreen(async path=>path==='/schedule-viewer'?ok(viewer()):ok({workspaceRevision:1,items:[],nextCursor:'repeated'})),/pagination/);
 await assert.rejects(loadScheduleScreen(async path=>path==='/schedule-viewer'?ok(viewer()):ok({workspaceRevision:2,items:[],nextCursor:null})),/changed while loading/);
});
test('uncertain command delivery retains its request ID and disallows a changed retry',async()=>{
 const sender=new ScheduleScreenSender(),sent=[];const call=async(_,command)=>{sent.push(command);if(sent.length===1)throw Error('Disconnected');return ok({recordId:'saved'});};
 await assert.rejects(sender.send(call,'fictional-screen','availability.save',{title:'School'}),/Disconnected/);const id=sender.pending.command.requestId;
 await assert.rejects(sender.send(call,'fictional-screen','availability.save',{title:'Changed'}),/previous submission/);
 await sender.send(call,'fictional-screen','availability.save',{title:'School'});assert.equal(sent[1].requestId,id);assert.equal(sender.pending,null);
});
test('server uncertainty retains retry; rejected stale/access commands clear retry and explain recovery',async()=>{
 const sender=new ScheduleScreenSender();await assert.rejects(sender.send(async()=>({status:503}),'s','availability.save',{}),/Retry/);assert.ok(sender.pending);
 await assert.rejects(sender.send(async()=>({status:409}),'s','availability.save',{}),/Reload/);assert.equal(sender.pending,null);
 await assert.rejects(sender.send(async()=>({status:403}),'s','availability.save',{}),/current access/);assert.equal(sender.pending,null);
});
test('request screen refuses unrelated commands and preserves revision envelopes',async()=>{
 const sender=new ScheduleScreenSender();await assert.rejects(sender.send(()=>assert.fail(),'s','shift.publish',{}),/not enabled/);await assert.rejects(sender.send(()=>assert.fail(),'s','request.create',{type:'swap'}),/not enabled/);
 await sender.send(async(_,command)=>{assert.equal(command.recordId,'a');assert.equal(command.expectedRevision,3);return ok({});},'s','availability.review',{approve:true},{id:'a',revision:3});
});
test('station context keeps exact setup references and safely adapts legacy stations with no guide/goal links',async()=>{
 const setup={jobs:['Cook'],allJobMembers:false,memberIds:['worker'],standardIds:['guide'],goals:[{title:'Practice'}]};
 const w=await loadScheduleScreen(async path=>path==='/schedule-viewer'?ok(viewer()):ok({workspaceRevision:1,items:path.startsWith('/schedule-stations')?[{id:'current',kind:'station',data:{setup}},{id:'legacy',kind:'station',data:{setup:{jobs:['Cook'],allJobMembers:true,memberIds:[]}}}]:[],nextCursor:null}));
 assert.deepEqual(w.records[0].data.setup,setup);assert.deepEqual(w.records[1].data.setup.standardIds,[]);assert.deepEqual(w.records[1].data.setup.goals,[]);
});
test('draft screen retains revision on editing and refuses published, cancelled, released or unrelated records',async()=>{
 const sender=new ScheduleScreenSender();for(const record of [{kind:'shift',data:{published:true}},{kind:'shift',data:{cancelled:true}},{kind:'shift',data:{releasedAt:'2031-01-01'}},{kind:'request',data:{}}])await assert.rejects(sender.send(()=>assert.fail(),'s','shift.save',{},record),/Only unpublished/);
 await sender.send(async(_,c)=>{assert.equal(c.expectedRevision,4);assert.equal(c.recordId,'draft');assert.equal(c.input.stationId,'grill');return ok({});},'s','shift.save',{stationId:'grill'},{id:'draft',revision:4,kind:'shift',data:{published:false}});
});
