import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {moveWeekTime,weekCopyPlan,copySources} from '../.sites-runtime/shared/week-copy.mjs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {closingPublicationIssues,closingSelection} from '../.sites-runtime/shared/publication.mjs';
import {planningStamp} from '../.sites-runtime/shared/schedule-review.mjs';
import {nextDate,localDate} from '../.sites-runtime/shared/local-time.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {seedMockWeek} from './mock-week-fixture.mjs';

const at='2026-09-07T12:00:00.000Z';
const person=(id,caps=[],position='Server',area='FOH')=>({id,locationId:'a',name:id,area,position,qualifications:[position],capabilities:caps});
const record=(id,kind,data,ownerId='worker',area='FOH')=>({id,kind,locationId:'a',ownerId,area,data,revision:1,updatedAt:at});
const options={sourceWeek:'2026-09-14',targetWeek:'2026-09-21',shiftIds:['shift'],staffingIds:['need'],repeated:''};
function fixture(){
 const manager=person('manager',['schedule.manage','tasks.manage','schedule.change','close.confirm'],'Manager'),publisher=person('publisher',['schedule.publish']);
 const standard=record('standard','standard',{title:'Sample close',zone:'Counter',position:'Server',criteria:['Ready'],source:'Fictional',version:1,verification:'manager',status:'approved',validationNote:'Fixture',history:[]},'manager');
 const shift=record('shift','shift',{personId:'worker',position:'Server',start:'2026-09-14T20:00:00.000Z',end:'2026-09-15T03:00:00.000Z',published:true,cancelled:false,releasedAt:'2026-09-15T03:01:00.000Z',history:[{action:'staffing-exception',actorId:'publisher',at,note:'Old exception must not carry'}]});
 return {location:{id:'a',name:'Fictional',timezone:'America/New_York',revision:1},me:manager,members:[manager,publisher,person('worker'),person('other'),person('dish',[],'Dishwasher','BOH')],records:[standard,shift,record('close','close',{shiftId:'shift',standardId:'standard',standardRevision:1,standard:standard.data,managerId:'manager',due:shift.data.end,phase:'closed',answers:[0],history:[{actorId:'manager',at,action:'confirm',note:'Old evidence must not carry'}]}),record('need','staffing',{title:'Sample staffing',position:'Server',start:shift.data.start,end:shift.data.end,minimum:1,status:'approved',source:'Fictional staffing',history:[]},'manager')]};
}
function execute(w,input,requestId='copy'){return applyCommand(w,{requestId,locationId:w.location.id,action:'shift.copy-week',input},at)}
function copyInput(w,o=options){return {...o,reviewStamp:weekCopyPlan(w,o).stamp,confirmed:true,note:'Reviewed fictional destination week'}}

test('week copying preserves local clocks across DST, overnight dates and explicit repeated-hour choice',()=>{
 assert.equal(moveWeekTime('2026-10-25T20:00:00.000Z',7,'America/New_York'),'2026-11-01T21:00:00.000Z');
 assert.equal(moveWeekTime('2026-10-26T05:00:00.000Z',7,'America/New_York'),'2026-11-02T06:00:00.000Z');
 assert.throws(()=>moveWeekTime('2026-03-01T07:30:00.000Z',7,'America/New_York'),/does not exist/);
 assert.throws(()=>moveWeekTime('2026-10-25T05:30:00.000Z',7,'America/New_York'),/twice/);
 const first=moveWeekTime('2026-10-25T05:30:00.000Z',7,'America/New_York','earlier'),second=moveWeekTime('2026-10-25T05:30:00.000Z',7,'America/New_York','later');assert.equal(Date.parse(second)-Date.parse(first),3600000);
});
test('copy creates new unpublished identities and open duties without old evidence, authority, approval or notices',()=>{
 const w=fixture(),before=JSON.stringify(w),made=execute(w,copyInput(w));assert.equal(JSON.stringify(w),before);
 assert.deepEqual(made.map(r=>r.kind),['shift','close','staffing']);assert.equal(new Set(made.map(r=>r.id)).size,3);
 const s=made[0],c=made[1],n=made[2];assert.equal(s.data.published,false);assert.equal(s.data.releasedAt,undefined);assert.equal(s.data.history.length,1);assert.equal(s.data.history[0].action,'copied-as-draft');
 assert.equal(c.data.shiftId,s.id);assert.equal(c.data.phase,'open');assert.deepEqual(c.data.answers,[]);assert.equal(c.data.history.length,1);assert.equal(n.data.status,'draft');assert.equal(c.data.due,'2026-09-22T03:00:00.000Z');
 const projected={...w,records:[...w.records,...made]};assert.match(closingPublicationIssues(projected,s)[0].reason,/closing manager/);
 projected.me=w.members.find(m=>m.id==='worker');assert.equal(publicWorkspace(projected).records.some(r=>made.some(c=>c.id===r.id)),false);
});
test('copy rejects stale duties, hidden responsibilities, changed standards, invalid dates and duplicate copies',()=>{
 const w=fixture(),input=copyInput(w);w.records.find(r=>r.kind==='close').revision++;assert.throws(()=>execute(w,input),/changed/);
 w.me={...w.me,capabilities:['schedule.manage']};assert.throws(()=>weekCopyPlan(w,options),/task-management/);
 w.me=w.members[0];w.records.find(r=>r.kind==='standard').data.status='retired';assert.throws(()=>weekCopyPlan(w,options),/retired/);
 for(const o of [{...options,targetWeek:'2026-09-22'},{...options,targetWeek:'2026-09-14'},{...options,targetWeek:'2026-02-30'},{...options,shiftIds:['shift','shift']}])assert.throws(()=>weekCopyPlan(fixture(),o));
 const clean=fixture(),made=execute(clean,copyInput(clean));clean.records.push(...made);const s=made.find(r=>r.kind==='shift');
 // Moving the copied draft later must not erase its origin and permit a second copy.
 const changed=applyCommand(clean,{requestId:'edit',locationId:'a',action:'shift.save',recordId:s.id,expectedRevision:s.revision,input:{personId:'worker',position:'Server',start:'2026-09-21T21:00:00.000Z',end:s.data.end,note:'Later start'}},at);clean.records=clean.records.map(r=>changed.find(c=>c.id===r.id)??r);
 assert.equal(clean.records.find(r=>r.id===s.id).data.copiedFrom.id,'shift');assert.throws(()=>execute(clean,input,'different-request'),/already been copied/);
 clean.me=clean.members.find(m=>m.id==='dish');assert.equal(copySources(clean,options.sourceWeek).shifts.length,0);
});
test('destination availability, existing shifts, station clearance and cross-department authority are checked before any copy',()=>{
 const w=fixture();w.records.push(record('off','request',{type:'time-off',status:'approved',start:'2026-09-21T20:00:00.000Z',end:'2026-09-22T03:00:00.000Z'}));assert.throws(()=>weekCopyPlan(w,options),/unavailable/);w.records.pop();
 w.records.push(record('existing','shift',{...w.records.find(r=>r.kind==='shift').data,start:'2026-09-21T20:00:00.000Z',end:'2026-09-22T03:00:00.000Z',published:false}));assert.throws(()=>weekCopyPlan(w,options),/already has a shift/);w.records.pop();
 w.members.find(m=>m.id==='worker').qualifications=[];assert.throws(()=>weekCopyPlan(w,options),/cleared/);
 w.me=person('wrong',['schedule.manage','tasks.manage'],'Manager','BOH');assert.throws(()=>weekCopyPlan(w,options),/department/);
});

process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
test('closing publication rechecks current leadership and capability; completed evidence cannot move with a shift edit',()=>{
 const w=fixture(),made=execute(w,copyInput(w));w.records.push(...made);const shift=made.find(r=>r.kind==='shift');
 assert.ok(closingPublicationIssues(w,shift).length);
 const leader=record('leader','leadership',{personId:'manager',area:'FOH',start:shift.data.start,end:shift.data.end,active:true,note:'New dated responsibility'},'manager');w.records.push(leader);assert.equal(closingPublicationIssues(w,shift).length,0);
 w.members[0].capabilities=w.members[0].capabilities.filter(c=>c!=='close.confirm');assert.ok(closingPublicationIssues(w,shift).length);w.members[0].capabilities.push('close.confirm');
 const original=w.records.find(r=>r.id==='shift');delete original.data.releasedAt;leader.data.start=original.data.start;leader.data.end=original.data.end;
 const before=JSON.stringify(w);assert.throws(()=>applyCommand(w,{requestId:'move-completed',locationId:'a',action:'shift.save',recordId:original.id,expectedRevision:original.revision,input:{personId:'worker',position:'Server',start:'2026-09-14T21:00:00.000Z',end:original.data.end,note:'Move an already completed close'}},at),/Completed closing work/);assert.equal(JSON.stringify(w),before);
});
test('full next week is atomically copied by department, re-reviewed by publisher and retains duties through published changes',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 const call=async(actor,action,input={},r,requestId=crypto.randomUUID())=>{const response=await handleWorkspace(new Request('https://mock.example/api/workspace'+(action?'':'?locationId=review'),{method:action?'POST':'GET',headers:{'oai-authenticated-user-id':actor+'-fixture','oai-authenticated-user-email':actor+'@example.test',Origin:'https://mock.example','Content-Type':'application/json'},...(action?{body:JSON.stringify({requestId,locationId:'review',action,input,...(r?{recordId:r.id??r.recordId,expectedRevision:r.revision}:{})})}:{})}),db);return {status:response.status,data:await response.json()}};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data},f=await seedMockWeek(db,call,{staffing:true}),targetWeek=nextDate(f.start,7);
 for(const actor of ['manager','boh']){
  const w=ok(await call(actor)),src=copySources(w,f.start),o={sourceWeek:f.start,targetWeek,shiftIds:src.shifts.map(r=>r.id),staffingIds:src.staffing.map(r=>r.id),repeated:''},input=copyInput(w,o),requestId=crypto.randomUUID();
  if(actor==='manager'){
   assert.equal((await call('publisher','shift.copy-week',input)).status,403);
   await db.prepare("CREATE TRIGGER week_copy_abort BEFORE INSERT ON records WHEN NEW.kind='close' BEGIN SELECT RAISE(ABORT,'copy rollback proof'); END").run();
   assert.equal((await call(actor,'shift.copy-week',input,undefined,requestId)).status,503);
   const unchanged=ok(await call(actor));assert.equal(unchanged.location.revision,w.location.revision);assert.equal(unchanged.records.some(r=>r.kind==='shift'&&r.data.copiedFrom),false);
   await db.prepare('DROP TRIGGER week_copy_abort').run();
  }
  const saved=ok(await call(actor,'shift.copy-week',input,undefined,requestId));assert.deepEqual(ok(await call(actor,'shift.copy-week',input,undefined,requestId)),saved);assert.equal((await call(actor,'shift.copy-week',input)).status,400);
 }
 let w=ok(await call('publisher'));const copied=w.records.filter(r=>r.kind==='shift'&&r.data.copiedFrom?.targetWeek===targetWeek),closes=w.records.filter(r=>r.kind==='close'&&copied.some(s=>s.id===r.data.shiftId));assert.equal(copied.length,28);assert.equal(closes.length,14);assert.ok(closes.every(c=>c.data.phase==='open'&&c.data.answers.length===0));
 assert.equal(ok(await call('worker')).records.filter(r=>r.kind==='shift'&&r.data.copiedFrom).length,0);
 const publication=()=>({weekStart:targetWeek,drafts:copied.map(r=>({id:r.id,revision:r.revision,closing:closingSelection(w,r.id)})),planningReview:planningStamp(w,targetWeek,copied.map(r=>r.id)),confirmed:true,note:'Review next fictional week'});
 assert.equal((await call('publisher','shift.publish-batch',publication())).status,400);assert.ok(ok(await call('publisher')).records.filter(r=>r.kind==='shift').every(r=>!r.data.published));
  for(const leader of w.records.filter(r=>r.kind==='leadership'))ok(await call('publisher','leadership.assign',{personId:leader.ownerId,area:leader.area,start:moveWeekTime(leader.data.start,7,f.zone),end:moveWeekTime(leader.data.end,7,f.zone),note:'Explicit responsibility for next fictional week'}));
  w=ok(await call('publisher'));const pending=await call('publisher','shift.publish-batch',publication());assert.equal(pending.status,400);assert.match(pending.data.error,/copied staffing/);
 const staffing=w.records.find(r=>r.kind==='staffing'&&r.data.copiedFrom);ok(await call('publisher','staffing.approve',{confirmed:true,note:'New week needs independent staffing approval'},staffing));w=ok(await call('publisher'));
 assert.equal((await call('publisher','shift.publish-batch',publication())).status,400);
 ok(await call('publisher','shift.publish-batch',{...publication(),coverageAcknowledged:true,coverageNote:'Fresh fictional shortage plan; not inherited from the source week'}));
 const worker=ok(await call('worker'));assert.ok(worker.records.filter(r=>r.kind==='shift').every(r=>r.data.published&&r.data.copiedFrom));
 const shift=worker.records.find(r=>r.kind==='shift'&&localDate(r.data.start,f.zone)===targetWeek),close=worker.records.find(r=>r.kind==='close'&&r.data.shiftId===shift.id);
 ok(await call('worker','close.transition',{step:'ready',answers:[0,1],note:'Fictional conditions checked'},close));
 const manager=ok(await call('manager')),current=manager.records.find(r=>r.id===shift.id);ok(await call('manager','shift.save',{personId:current.ownerId,position:current.data.position,start:new Date(Date.parse(current.data.start)+3600000).toISOString(),end:current.data.end,note:'Fictional later start, with new readiness check'},current));
 const after=ok(await call('worker')),reset=after.records.find(r=>r.id===close.id);assert.equal(reset.data.phase,'open');assert.deepEqual(reset.data.answers,[]);assert.ok(reset.data.history.some(h=>h.action==='schedule-changed'));
 for(const actor of ['worker','manager','senior'])assert.ok(ok(await call(actor)).records.some(r=>r.kind==='message'&&r.data.title==='Closing responsibility changed'&&r.data.recordId===close.id));
 assert.ok(after.records.some(r=>r.kind==='message'&&r.data.title==='Your schedule changed'&&r.data.recordId===shift.id));
});
