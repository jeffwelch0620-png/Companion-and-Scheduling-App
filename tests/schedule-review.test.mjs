import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {scheduleReview,planningStamp} from '../.sites-runtime/shared/schedule-review.mjs';
import {publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {closingSelection} from '../.sites-runtime/shared/publication.mjs';
import {seedMockWeek} from './mock-week-fixture.mjs';
const at='2026-09-01T12:00:00.000Z',week='2026-09-14';
const person=(id,caps=[],position='Server',area='FOH')=>({id,locationId:'a',name:id,area,position,capabilities:caps,qualifications:[position]});
const record=(id,kind,data,ownerId='one',area='FOH')=>({id,locationId:'a',kind,ownerId,area,revision:1,updatedAt:at,data});
const shift=(id,personId,start,end,published=true)=>record(id,'shift',{personId,start,end,position:'Server',published,cancelled:false},personId);
const need=(minimum=2)=>record('need','staffing',{title:'Fictional peak',position:'Server',start:'2026-09-14T20:00:00Z',end:'2026-09-15T03:00:00Z',minimum,source:'Fictional test only',status:'approved',history:[]},'manager');
const fixture=records=>{const members=[person('manager',['schedule.manage','schedule.publish']),person('one'),person('two'),person('dish',[],'Dishwasher','BOH')];return {location:{id:'a',name:'Fictional',timezone:'America/New_York',revision:1},me:members[0],members,records}};
test('staffing distinguishes current published coverage, all drafts and the exact partial publication selection',()=>{
 const w=fixture([need(),shift('a','one','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z'),shift('b','two','2026-09-14T22:00:00Z','2026-09-15T03:00:00Z',false)]);
 const r=scheduleReview(w,week);assert.deepEqual(r.staffing[0].published,[{start:'2026-09-14T20:00:00.000Z',end:'2026-09-15T03:00:00.000Z',required:2,scheduled:1}]);
 assert.deepEqual(r.staffing[0].planned,[{start:'2026-09-14T20:00:00.000Z',end:'2026-09-14T22:00:00.000Z',required:2,scheduled:1}]);
 assert.deepEqual(scheduleReview(w,week,[]).staffing[0].planned,r.staffing[0].published);assert.equal(r.hours.find(x=>x.personId==='two').plannedMinutes,300);
});
test('overlapping assignments and missing station clearance cannot inflate qualified coverage',()=>{
 const w=fixture([need(1),shift('a','one','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z'),shift('b','one','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z')]);
 assert.equal(scheduleReview(w,week).staffing[0].planned[0].scheduled,0);assert.equal(scheduleReview(w,week).issues.length,2);
 w.records.pop();w.members.find(m=>m.id==='one').qualifications=[];assert.equal(scheduleReview(w,week).staffing[0].planned[0].scheduled,0);
});
test('calendar-week hours include carry-in shifts and clip carry-out hours without assuming breaks or worked time',()=>{
 const w=fixture([shift('a','one','2026-09-14T02:00:00Z','2026-09-14T06:00:00Z'),shift('b','one','2026-09-21T02:00:00Z','2026-09-21T06:00:00Z')]);
 assert.equal(scheduleReview(w,week).hours[0].plannedMinutes,240);
 const spring=fixture([shift('s','one','2026-03-08T05:00:00Z','2026-03-09T04:00:00Z')]);assert.equal(scheduleReview(spring,'2026-03-02').hours[0].plannedMinutes,23*60);
 const fall=fixture([shift('f','one','2026-11-01T04:00:00Z','2026-11-02T05:00:00Z')]);assert.equal(scheduleReview(fall,'2026-10-26').hours[0].plannedMinutes,25*60);
});
test('draft needs are not coverage policy and ordinary employees cannot inspect management staffing or coworkers hours',()=>{
 const n=need();n.data.status='draft';const w=fixture([n,shift('a','one','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z')]);assert.equal(scheduleReview(w,week).staffing.length,0);
 for(const id of ['one','dish']){w.me=w.members.find(m=>m.id===id);assert.equal(publicWorkspace(w).records.some(r=>r.kind==='staffing'),false);assert.equal(scheduleReview(w,week).hours.length,0);}
});
test('staffing review stamp changes for shift, clearance and availability changes but not an unrelated message',()=>{
 const w=fixture([need(),shift('a','one','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z',false)]),stamp=planningStamp(w,week,['a']);
 w.records.push(record('message','message',{title:'Unrelated',body:'Private',recipients:[],replies:[],readBy:[]}));assert.equal(planningStamp(w,week,['a']),stamp);
 w.members.find(m=>m.id==='one').qualifications=[];assert.notEqual(planningStamp(w,week,['a']),stamp);w.members.find(m=>m.id==='one').qualifications=['Server'];
 w.records.push(record('off','request',{type:'time-off',start:'2026-09-14T20:00:00Z',end:'2026-09-15T03:00:00Z',status:'approved',note:'Private reason'}));assert.notEqual(planningStamp(w,week,['a']),stamp);assert.equal(scheduleReview(w,week).staffing[0].planned[0].scheduled,0);
});

process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
test('saved staffing drafts, publisher approval and explicit weekly exceptions use the authenticated transactional workflow',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 const call=async(actor,action,input={},r,requestId=crypto.randomUUID())=>{const response=await handleWorkspace(new Request('https://mock.example/api/workspace'+(action?'':'?locationId=review'),{method:action?'POST':'GET',headers:{'oai-authenticated-user-id':actor+'-fixture','oai-authenticated-user-email':actor+'@example.test',Origin:'https://mock.example','Content-Type':'application/json'},...(action?{body:JSON.stringify({requestId,locationId:'review',action,input,...(r?{recordId:r.id??r.recordId,expectedRevision:r.revision}:{})})}:{})}),db);return {status:response.status,data:await response.json()}};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data},f=await seedMockWeek(db,call);
 const input={title:'Mock peak coverage',area:'FOH',position:'Server',...f.period(f.start,'16:00','23:00'),minimum:2,source:'Fictional fixture; not a restaurant standard'};
 assert.equal((await call('worker','staffing.save',input)).status,403);assert.equal((await call('boh','staffing.save',input)).status,403);
 let n=ok(await call('manager','staffing.save',input));assert.equal((await call('manager','staffing.approve',{confirmed:true,note:'Not publisher'},n)).status,403);
 assert.equal((await call('publisher','staffing.approve',{note:'Missing confirmation'},n)).status,400);
 n=ok(await call('publisher','staffing.approve',{confirmed:true,note:'Fictional need approved'},n));
 assert.equal((await call('manager','staffing.save',input,n)).status,400);
 const overlap=ok(await call('manager','staffing.save',input));assert.equal((await call('publisher','staffing.approve',{confirmed:true,note:'Would double count'},overlap)).status,400);
 const w=ok(await call('publisher')),drafts=w.records.filter(r=>r.kind==='shift'),selected=drafts.map(r=>r.id),stamp=planningStamp(w,f.start,selected);
 assert.ok(w.records.filter(r=>r.kind==='request'&&r.data.type==='time-off').every(r=>r.data.note===''));
 assert.ok(w.records.filter(r=>r.kind==='availability').every(r=>r.data.title==='Approved availability'&&r.data.decision===''));
 assert.equal(scheduleReview(w,f.start,selected).hours.find(m=>m.personId==='server2').plannedMinutes,41*60);
 assert.equal((await call('publisher','shift.publish',{publicationReviewed:true},drafts.find(r=>r.data.start===input.start&&r.area==='FOH'))).status,400);
 const publication={weekStart:f.start,drafts:drafts.map(r=>({id:r.id,revision:r.revision,closing:closingSelection(w,r.id)})),planningReview:stamp,confirmed:true,note:'Review fixture week'};
 assert.equal((await call('publisher','shift.publish-batch',{...publication,planningReview:'old'})).status,409);
 assert.equal((await call('publisher','shift.publish-batch',publication)).status,400);
 assert.equal(ok(await call('worker')).records.filter(r=>r.kind==='shift').length,0);
 const requestId=crypto.randomUUID(),ack={...publication,coverageAcknowledged:true,coverageNote:'Fictional exception recorded for the uncovered Server period'};
 const saved=ok(await call('publisher','shift.publish-batch',ack,undefined,requestId));assert.deepEqual(ok(await call('publisher','shift.publish-batch',ack,undefined,requestId)),saved);
 const after=ok(await call('publisher')).records.filter(r=>r.kind==='shift');assert.equal(after.length,28);assert.ok(after.every(r=>r.data.published&&r.data.history.some(h=>h.action==='staffing-exception'&&h.note===ack.coverageNote)));
 const retired=ok(await call('publisher','staffing.retire',{note:'End fictional need'},n));assert.equal(retired.revision,n.revision+1);
 assert.equal(ok(await call('dish')).records.some(r=>r.kind==='staffing'),false);
});


test('scheduled roster jobs count toward coverage without inventing training clearance; actual conflicts still surface',()=>{
 const w=fixture([need(1),shift('a','one','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z')]);
 const member=w.members.find(m=>m.id==='one');member.qualifications=[];member.scheduleJobs=['Server'];member.scheduleOnly=true;
 assert.equal(scheduleReview(w,week).issues.length,0);assert.equal(scheduleReview(w,week).plannedGapCount,0);assert.deepEqual(member.qualifications,[]);
 const stamp=planningStamp(w,week,[]);member.scheduleJobs=[];assert.notEqual(planningStamp(w,week,[]),stamp);assert.match(scheduleReview(w,week).issues[0].reason,/scheduling approval/);
 member.scheduleJobs=['Server'];w.records.push(record('off','request',{type:'time-off',start:'2026-09-14T20:00:00Z',end:'2026-09-15T03:00:00Z',status:'approved',note:'Private'}));
 assert.match(scheduleReview(w,week).issues[0].reason,/approved time off/);assert.equal(scheduleReview(w,week).staffing[0].planned[0].scheduled,0);
 w.records.pop();w.records.push(shift('b','one','2026-09-14T21:00:00Z','2026-09-15T01:00:00Z'));
 assert.equal(scheduleReview(w,week).issues.length,2);assert.ok(scheduleReview(w,week).issues.every(i=>i.reason.includes('Overlaps')));
});
