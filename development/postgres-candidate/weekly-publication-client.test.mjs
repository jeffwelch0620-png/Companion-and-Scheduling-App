import test from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {loadWeeklyPublicationReview,publishableDrafts,publicationInput} from './weekly-publication-client.mjs';
import {ScheduleScreenSender,publicationRecovery,clearPublicationRecovery,publicationRecoveryMessage} from './schedule-screen-client.mjs';
import {WeeklyPublicationReview} from './runtime/ui-reference/ui-weekly-publication.mjs';
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0'),week='2031-04-28',now='2031-04-28T12:00:00Z';
function fixture() {
 const me={id:id(1),name:'Publisher',locationId:'fictional-week-ui',position:'Manager',area:'Kitchen',capabilities:['schedule.publish'],qualifications:[],scheduleJobs:['Cook']};
 const worker={...me,id:id(2),name:'Employee',position:'Cook',capabilities:[]};
 const w={scheduleRevision:5,location:{id:me.locationId,name:'Fictional store',timezone:'Europe/London',revision:8,configuration:{operatingDepartments:['Service','Kitchen'],dishDepartment:'Kitchen',dishPosition:'Steward',dishAliases:['Steward']}},me,members:[me,worker],records:[{id:id(3),kind:'shift',locationId:me.locationId,ownerId:worker.id,area:'Kitchen',revision:2,data:{position:'Cook',start:'2031-05-01T13:00:00Z',end:'2031-05-01T15:00:00Z',published:false}}]};
 const close={id:id(4),revision:3,due:'2031-05-01T14:30:00Z',ownerId:worker.id,managerId:me.id,verifierId:null,standardId:id(7),standardRevision:2,standard:{title:'Closing checklist',version:2,position:'Cook'}};
 const plan={weekStart:week,period:{start:'2031-04-27T23:00:00Z',end:'2031-05-04T23:00:00Z'},workspaceRevision:8,scheduleRevision:5,planningReview:'a'.repeat(64),plannedGapCount:1,staffing:[{id:id(5),revision:4,required:2,gaps:[{start:'2031-05-01T13:00:00Z',end:'2031-05-01T15:00:00Z',required:2,scheduled:1}]}]};
 const detail={shiftId:id(3),revision:2,workspaceRevision:8,scheduleRevision:5,staffing:[],closing:[close],closingIssues:[],sourceReviewComplete:true};
 const need={id:id(5),revision:4,kind:'staffing',locationId:me.locationId,area:'Kitchen',ownerId:me.id,data:{title:'Grill coverage',position:'Cook',minimum:2,status:'approved',start:'2031-05-01T13:00:00Z',end:'2031-05-01T15:00:00Z'}};
 plan.drafts=[detail];plan.staffing[0].record=need;
 const call=async path=>({status:200,body:structuredClone(path==='/week-review'?plan:{location:w.location,me:w.me,workspaceRevision:8,scheduleRevision:5})});
 return {w,plan,detail,need,call};
}
const review=f=>loadWeeklyPublicationReview(f.call,f.w,week,[id(3)],now);
const fields={confirmed:true,note:'Reviewed service',coverageAcknowledged:true,coverageNote:'Manager covers the second station'};
test('weekly screen includes only current scoped publishable drafts in the store-local week',()=>{
 const f=fixture(),r=f.w.records[0];f.w.records.push(...[{data:{...r.data,published:true}},{data:{...r.data,cancelled:true}},{data:{...r.data,releasedAt:now}},{area:'Service'},{locationId:'foreign'},{data:{...r.data,start:'2031-05-05T13:00:00Z',end:'2031-05-05T15:00:00Z'}},{data:{...r.data,start:'2031-04-27T13:00:00Z',end:'2031-04-27T15:00:00Z'}}].map((v,i)=>({...r,id:id(30+i),...v})));
 assert.deepEqual(publishableDrafts(f.w,week,now).map(r=>r.id),[id(3)]);
 f.w.me.capabilities=['schedule.manage','location.manage'];assert.equal(publishableDrafts(f.w,week,now).length,0);
 f.w.me.capabilities=['schedule.publish'];f.w.me.position='Steward';assert.equal(publishableDrafts(f.w,week,now).length,0);
});
test('server review brackets a batched closing and staffing snapshot before enabling publication',async()=>{
 const f=fixture(),calls=[],original=f.call;f.call=async(...args)=>{calls.push(args[0]);return original(...args);};
 const r=await review(f),input=publicationInput(r,fields);assert.equal(calls.filter(p=>p==='/week-review').length,2);assert.equal(calls.at(-1),'/schedule-viewer');assert.equal(input.planningReview,'a'.repeat(64));assert.deepEqual(input.drafts,[{id:id(3),revision:2,closing:[{id:id(4),revision:3}]}]);assert.equal(r.staffing[0].data.title,'Grill coverage');
 f.detail.closing[0].revision=99;assert.equal(r.drafts[0].closing[0].revision,3);
});
test('selection duplicates, missing drafts and oversized selections fail before any server call',async()=>{
 const f=fixture(),call=()=>assert.fail('must not call server');
 for(const ids of [[],[id(3),id(3)],[id(99)],Array.from({length:101},(_,i)=>id(i+100))])await assert.rejects(loadWeeklyPublicationReview(call,f.w,week,ids,now));
});
test('review discards all details on changed scope, shift revision, planning token or current permission',async()=>{
 for(const mutation of ['scope','shift','token','viewer']) {
  const f=fixture(),original=f.call;let n=0;f.call=async(...args)=>{const r=await original(...args);if(args[0]==='/week-review'&&++n===2&&mutation==='token')r.body.planningReview='b'.repeat(64);if(args[0]==='/week-review'){if(mutation==='scope')r.body.scheduleRevision++;if(mutation==='shift')r.body.drafts[0].revision++;}if(args[0]==='/schedule-viewer'&&mutation==='viewer')r.body.me.capabilities=[];return r;};
  await assert.rejects(review(f),/changed/);
 }
});
test('malformed or incomplete closing and staffing reads never become an empty safe selection',async()=>{
 for(const mutate of [f=>delete f.detail.closing,f=>f.detail.closing.push({...f.detail.closing[0]}),f=>delete f.detail.sourceReviewComplete,f=>f.plan.plannedGapCount=0,f=>f.plan.staffing[0].gaps[0].scheduled=2,f=>f.need.revision++]){const f=fixture();mutate(f);await assert.rejects(review(f));}
});
test('100 selected drafts and over 100 staffing needs still use exactly three calls',async()=>{
 const f=fixture(),calls=[],base=f.w.records[0],detail=f.detail,need=f.need;
 f.w.records=Array.from({length:100},(_,i)=>({...base,id:id(100+i)}));
 f.plan.drafts=f.w.records.map(r=>({...detail,shiftId:r.id}));
 f.plan.staffing=Array.from({length:120},(_,i)=>({...f.plan.staffing[0],id:id(300+i),record:{...need,id:id(300+i)}}));f.plan.plannedGapCount=120;
 const original=f.call;f.call=async(...args)=>{calls.push(args[0]);return original(...args);};
 const result=await loadWeeklyPublicationReview(f.call,f.w,week,f.w.records.map(r=>r.id),now);
 assert.equal(result.drafts.length,100);assert.equal(result.staffing.length,120);assert.deepEqual(calls,['/week-review','/week-review','/schedule-viewer']);
 f.plan.drafts[0].shiftId=id(999);await assert.rejects(loadWeeklyPublicationReview(f.call,f.w,week,f.w.records.map(r=>r.id),now));
});
test('unrelated workspace changes preserve review while scheduling revisions and revoked batched reads fail safely',async()=>{
 const f=fixture(),original=f.call;f.call=async(...args)=>{const result=await original(...args);result.body.workspaceRevision=99;if(result.body.location)result.body.location.revision=99;return result;};assert.equal((await review(f)).scheduleRevision,5);
 f.call=async(...args)=>{const result=await original(...args);result.body.scheduleRevision=6;return result;};await assert.rejects(review(f),/changed/);
 f.call=async()=>({status:403});await assert.rejects(review(f),/current access/);
});
test('closing metadata rejects missing identifiers and excess private standard data',async()=>{
 for(const mutate of [c=>delete c.standardId,c=>delete c.standard.version,c=>c.standard.criteria=['Private'],c=>c.standardRevision=0]){const f=fixture();mutate(f.detail.closing[0]);await assert.rejects(review(f));}
});
test('publication requires confirmation, a reason and acknowledged written plans for actual gaps',async()=>{
 const r=await review(fixture());for(const bad of [{...fields,confirmed:false},{...fields,note:' '},{...fields,coverageAcknowledged:false},{...fields,coverageNote:' '}])assert.throws(()=>publicationInput(r,bad));
 const input=publicationInput(r,fields);assert.equal(input.coverageNote,fields.coverageNote);
 r.plannedGapCount=0;assert.equal(publicationInput(r,fields).coverageAcknowledged,false);assert.equal(publicationInput(r,fields).coverageNote,'');
});
test('incomplete source attestation, copied staffing and closing issues block command construction',async()=>{
 for(const mutation of [r=>r.drafts[0].sourceReviewComplete=false,r=>r.drafts[0].copiedStaffing=[{id:id(6),status:'draft'}],r=>r.drafts[0].closingIssues=[{code:'closing_instruction_changed'}]]){const r=await review(fixture());mutation(r);assert.throws(()=>publicationInput(r,fields),/Resolve/);}
});
test('uncertain publication freezes a deep-copied command; retry preserves receipt ID and all selection details',async()=>{
 const r=await review(fixture()),input=publicationInput(r,fields),sender=new ScheduleScreenSender();
 await assert.rejects(sender.send(async()=>({status:503}),'fictional-week-ui','shift.publish-batch',input));const original=structuredClone(sender.pending.command);
 input.drafts[0].revision=50;await assert.rejects(sender.send(()=>assert.fail(),'fictional-week-ui','shift.publish-batch',input),/previous/);
 await sender.retry(async(_,c)=>{assert.deepEqual(c,original);return {status:200,body:{replayed:true}};});assert.equal(sender.pending,null);
});
test('known publication conflicts clear retry and require a fresh review; authentication loss explains recovery',async()=>{
 const input=publicationInput(await review(fixture()),fields),sender=new ScheduleScreenSender();
 await assert.rejects(sender.send(async()=>({status:409,body:{error:{code:'planning_review_conflict'}}}),'s','shift.publish-batch',input),e=>e.status===409&&e.code==='planning_review_conflict');assert.equal(sender.pending,null);await assert.rejects(sender.retry(()=>assert.fail()),/No uncertain/);
 await assert.rejects(sender.send(async()=>({status:401}),'s','shift.publish-batch',input),/Sign in/);assert.equal(sender.pending,null);
});
test('publication refusals identify required station and input review without retaining a futile retry',async()=>{
 const input=publicationInput(await review(fixture()),fields),sender=new ScheduleScreenSender();
 for(const [code,explanation] of [['station_setup_reference_only',/station needs a reviewed setup/],['weekly_scope_review_required',/complete source review/],['closing_publication_review_required',/assigned reviewers/]]){await assert.rejects(sender.send(async()=>({status:409,body:{error:{code}}}),'s','shift.publish-batch',input),explanation);assert.equal(sender.pending,null);}
});
const render=(f,r)=>renderToStaticMarkup(React.createElement(WeeklyPublicationReview,{w:f.w,review:r,now,busy:false,send:()=>assert.fail('render must not write'),onError:()=>{},onBack:()=>{}}));
test('review form renders the actual selected closing duties and London staffing clocks with explicit confirmations',async()=>{
 const f=fixture(),html=render(f,await review(f));assert.match(html,/Closing checklist/);assert.match(html,/Final check: Publisher/);assert.match(html,/Grill coverage/);assert.match(html,/2:00 PM|2:00 pm/);assert.match(html,/1 scheduled \/ 2 required/);assert.match(html,/Written coverage plan/);assert.match(html,/name="confirmed"/);assert.match(html,/Publish 1 selected shifts/);
});
test('employee and other-department publisher cannot render manager publication controls',async()=>{
 const f=fixture(),r=await review(f);f.w.me=f.w.members[1];assert.equal(render(f,r),'');f.w.me={...f.w.members[0],area:'Service'};assert.equal(render(f,r),'');
});
test('review issues disable publication while describing source and independent closing corrections',async()=>{
 const f=fixture(),r=await review(f);r.drafts[0].sourceReviewComplete=false;r.drafts[0].closingIssues=[{code:'closing_manager_unavailable'}];const html=render(f,r);assert.match(html,/complete source review/);assert.match(html,/assigned reviewers need correction/);assert.match(html,/disabled=""[^>]*>Publish/);
});
test('stale reviewed revisions disable publication and require current records',async()=>{
 const f=fixture(),r=await review(f);f.w.records[0].revision++;const html=render(f,r);assert.match(html,/selection changed/);assert.match(html,/disabled=""[^>]*>Publish/);
});

test('uncertain publication survives client reconstruction as an actor-scoped warning without storing a command or token',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const sender=new ScheduleScreenSender({storage,actorId:id(1)}),input=publicationInput(await review(fixture()),fields);
 await assert.rejects(sender.send(async()=>{throw Error('Connection lost');},'store','shift.publish-batch',input));
 const next=new ScheduleScreenSender({storage,actorId:id(1)});assert.equal(next.pending,null);
 const marker=publicationRecovery(storage,'store',id(1));assert.equal(marker.requestId,sender.pending.command.requestId);assert.deepEqual(Object.keys(marker).sort(),['actorId','locationId','requestId']);
 assert.equal(publicationRecovery(storage,'store',id(2)),null);assert.equal(publicationRecovery(storage,'other',id(1)),null);assert.match(publicationRecoveryMessage,/Check current published shifts/);
 await sender.retry(async()=>({status:503})).catch(()=>{});assert.equal(publicationRecovery(storage,'store',id(1)).requestId,marker.requestId);
 await sender.retry(async()=>({status:200,body:{replayed:true}}));assert.equal(publicationRecovery(storage,'store',id(1)),null);
 await assert.rejects(sender.send(async()=>({status:409}),'store','shift.publish-batch',input));assert.equal(publicationRecovery(storage,'store',id(1)),null);
 await assert.rejects(sender.send(async()=>({status:503}),'store','shift.publish-batch',input));clearPublicationRecovery(storage,'store',id(1));assert.equal(publicationRecovery(storage,'store',id(1)),null);
});
