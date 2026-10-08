import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createSchedulingFixture,localClock,localDate,nextDate} from './scheduling-stress-fixture.mjs';

const output=path.resolve('evidence/schedule-toast-simulations-2026-10-08/schedule-lifecycle',crypto.randomUUID());
after(()=>{
 const receipts=['berts','rudds','papa'].map(restaurant=>JSON.parse(fs.readFileSync(path.join(output,restaurant+'.json'),'utf8')));
 const summary={runDirectory:output,tests:receipts.length,checks:receipts.reduce((n,r)=>n+r.checks.length,0),failures:receipts.flatMap(r=>r.failures.map(f=>({restaurant:r.restaurant,...f}))),consecutiveWeeksPerRestaurant:3,weeks:receipts.reduce((n,r)=>n+r.weeks.length,0),savedShifts:receipts.reduce((n,r)=>n+(r.savedShifts?.length??0),0),databaseReopens:receipts.reduce((n,r)=>n+(r.reopens??0),0),requests:receipts.reduce((n,r)=>n+r.events.length,0),guardRejections:receipts.reduce((n,r)=>n+r.events.filter(e=>e.status>=400&&e.status<500).length,0),injectedRollbackFailures:receipts.reduce((n,r)=>n+r.events.filter(e=>e.status===503).length,0),initialSeedsPerDatabase:1,operationalReseeds:0,runtimeStable:receipts.every(r=>JSON.stringify(r.runtimeBefore)===JSON.stringify(r.runtimeAfter)),selected:receipts.map(r=>({restaurant:r.restaurant,receipt:path.join(output,r.restaurant+'.json'),database:r.database})),runtimeHashes:receipts[0].runtimeAfter,limits:receipts[0].limits};
 fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));if(!summary.failures.length&&summary.runtimeStable)fs.writeFileSync(path.resolve('evidence/schedule-toast-simulations-2026-10-08/schedule-lifecycle/latest-selection.json'),JSON.stringify(summary,null,2));
});
for(const restaurant of ['berts','rudds','papa'])test(`${restaurant}: build, publish and copy three durable schedule weeks including fall DST`,async()=>{
 const f=await createSchedulingFixture(restaurant,output),{ids,job}=f;let shifts=[],standard,closing;
 try{
  await f.check('Building: worker, foreign restaurant, wrong department and missing qualification rejected without writes',async()=>{
   const input={personId:ids.worker,position:job,start:f.instant('2026-10-19','15:00'),end:f.instant('2026-10-19','23:00')};
   await f.deny(ids.worker,'shift.save',input,undefined,403);await f.deny(ids.foreign,'shift.save',input,undefined,403);await f.deny(ids.boh,'shift.save',input,undefined,403);await f.deny(ids.manager,'shift.save',{...input,personId:ids.unqualified});
   for(const other of ['berts','rudds','papa'].filter(x=>x!==restaurant))assert.equal((await f.call(ids.worker,undefined,{},undefined,undefined,other)).status,403);
  });
  await f.check('Building: seven drafts plus isolated overnight and repeated-hour edge slots; employee sees no drafts',async()=>{
   for(let d=0;d<7;d++){const date=nextDate('2026-10-19',d);shifts.push(await f.command(ids.manager,'shift.save',{personId:ids.worker,position:job,start:f.instant(date,restaurant==='papa'?'15:00':'12:00'),end:f.instant(date,restaurant==='papa'?'23:00':'20:00')}));}
   shifts.push(await f.command(ids.manager,'shift.save',{personId:ids.overnight,position:job,start:f.instant('2026-10-24','22:00'),end:f.instant('2026-10-25','02:30')}));
   shifts.push(await f.command(ids.manager,'shift.save',{personId:ids.early,position:job,start:f.instant('2026-10-25','01:30'),end:f.instant('2026-10-25','02:30')}));
   assert.equal((await f.view(ids.worker)).records.filter(r=>r.kind==='shift').length,0);
   const first=f.find(shifts[0].recordId);await f.deny(ids.manager,'shift.save',{personId:ids.worker,position:job,start:first.data.start,end:first.data.end});
   standard=await f.command(ids.manager,'standard.save',{title:'QA close-to-open reference',zone:'QA counter',position:job,criteria:['Fictional assigned station ready'],source:'Fictional schedule test, not production policy',version:1,verification:'manager'});
   standard=await f.command(ids.manager,'standard.approve',{validated:true,note:'QA reference only'},standard);
   closing=await f.command(ids.manager,'close.assign',{shiftId:shifts[0].recordId,standardId:standard.recordId,managerId:ids.manager,due:first.data.end});
  });
  await f.check('Building: multi-draft slot exchange succeeds atomically; resulting overlap and stale revisions rejected',async()=>{
   const a=f.find(shifts[1].recordId),b=f.find(shifts[2].recordId);
   const selection=(r,period)=>({id:r.id,revision:r.revision,input:{personId:r.ownerId,position:job,start:period.start,end:period.end}});
   const exchange={weekStart:'2026-10-19',confirmed:true,note:'Fictional exchange of two existing draft slots',drafts:[selection(a,b.data),selection(b,a.data)]};
   await f.command(ids.manager,'shift.save-batch',exchange);assert.equal(f.find(a.id).data.start,b.data.start);assert.equal(f.find(b.id).data.start,a.data.start);await f.deny(ids.manager,'shift.save-batch',exchange,undefined,409);
   const currentA=f.find(a.id),currentB=f.find(b.id);await f.deny(ids.manager,'shift.save-batch',{...exchange,drafts:[selection(currentA,currentA.data),selection(currentB,currentA.data)]});f.reopen();
  });
  let week='2026-10-19';
  for(let w=1;w<=3;w++){
   if(w===2)await f.check('Week 2: retired closing source blocks publication; current approved revision must be assigned explicitly',async()=>{
    standard=await f.command(ids.manager,'standard.retire',{note:'QA source withdrawn for explicit version review'},standard);
    const first=f.find(shifts[0].id??shifts[0].recordId);await f.deny(ids.manager,'shift.publish',{},first);
    const retired=f.find(standard.recordId);let replacement=await f.command(ids.manager,'standard.save',{title:'QA close-to-open reference version two',zone:retired.data.zone,position:job,criteria:['Fictional newly reviewed station check'],source:'Fictional schedule test version two',version:2,verification:'manager',basedOnId:retired.id,basedOnRevision:retired.revision});replacement=await f.command(ids.manager,'standard.approve',{validated:true,note:'New fictional reference explicitly approved'},replacement);standard=replacement;
    const prior=f.find(closing.id??closing.recordId);closing=await f.command(ids.manager,'close.assign',{shiftId:first.id,standardId:standard.recordId,managerId:ids.manager,due:prior.data.due,note:'New review uses current approved QA reference'},prior);assert.equal(f.find(closing.recordId).data.standardRevision,standard.revision);
   });
   await f.check(`Week ${w}: publication snapshots current closing selection and only own published shifts become visible`,async()=>{
    const first=f.find(shifts[0].id??shifts[0].recordId);await f.deny(ids.worker,'shift.publish',{},first,404);await f.deny(ids.boh,'shift.publish',{},first,404);
    const stale=await f.publicationInput(week,shifts),existing=f.find(closing.id??closing.recordId);closing=await f.command(ids.manager,'close.assign',{shiftId:first.id,standardId:standard.recordId,managerId:ids.manager,due:existing.data.due,note:'Reviewer explicitly updates responsibility after publication preview'},existing);await f.deny(ids.manager,'shift.publish-batch',stale,undefined,409);
    const input=await f.publicationInput(week,shifts),requestId='publish-week-'+w,before=f.snapshot();f.sqlite().exec("CREATE TRIGGER schedule_publish_abort BEFORE INSERT ON records WHEN NEW.kind='message' BEGIN SELECT RAISE(ABORT,'fictional publication interruption'); END");const failed=await f.call(ids.manager,'shift.publish-batch',input,undefined,requestId);assert.equal(failed.status,503,JSON.stringify(failed));assert.equal(f.snapshot(),before);f.sqlite().exec('DROP TRIGGER schedule_publish_abort');
    const published=await f.command(ids.manager,'shift.publish-batch',input,undefined,requestId);f.reopen();assert.deepEqual(await f.command(ids.manager,'shift.publish-batch',input,undefined,requestId),published);const mine=(await f.view(ids.worker)).records.filter(r=>r.kind==='shift'&&!r.data.cancelled);assert.equal(mine.filter(r=>localDate(r.data.start,'America/New_York')>=week&&localDate(r.data.start,'America/New_York')<nextDate(week,7)).length,7);assert.ok(mine.every(r=>r.ownerId===ids.worker&&r.data.published));
    const close=f.find(closing.id??closing.recordId);assert.equal(close.data.phase,'open');assert.ok(!close.data.answers?.length);
    f.receipt.weeks.push({week,shiftIds:shifts.map(s=>s.id??s.recordId),closingId:close.id});
   });
   await f.check(`Week ${w}: scoped lead cannot change published shift without dated responsibility; explicit reason and stale revision checked`,async()=>{
    let current=f.find(shifts[6].id??shifts[6].recordId),input={personId:current.ownerId,position:job,start:current.data.start,end:current.data.end,note:'Fictional reviewed update'};
    await f.deny(ids.lead,'shift.save',input,current,403);await f.deny(ids.manager,'shift.save',{...input,note:''},current);
    const stale=current;current=await f.command(ids.manager,'shift.save',input,current);await f.deny(ids.manager,'shift.save',input,stale,409);
    assert.ok((await f.view(ids.worker)).records.some(r=>r.kind==='message'&&r.data.title==='Your schedule changed'&&r.data.recordId===stale.id));
    let leadership=await f.command(ids.manager,'leadership.assign',{personId:ids.lead,area:'FOH',start:input.start,end:input.end,note:'Dated department responsibility for this exact shift'});current=await f.command(ids.lead,'shift.save',input,current);leadership=await f.command(ids.manager,'leadership.revoke',{note:'Responsibility revoked in the simulation'},leadership);await f.deny(ids.lead,'shift.save',input,current,403);
   });
   await f.check(`Week ${w}: closing independently confirmed on its actual simulation date, persisted before next week`,async()=>{
    let close=f.find(closing.id??closing.recordId);f.setNow(close.data.due);close=await f.command(ids.worker,'close.transition',{step:'ready',answers:[0],note:'Fictional software inspection, no physical work'},close);close=await f.command(ids.manager,'close.transition',{step:'confirm',note:'Independent fictional inspection'},close);closing=close;assert.equal(f.find(close.recordId).data.phase,'closed');const shift=f.find(close.recordId).data.shiftId,current=f.find(shift);await f.deny(ids.manager,'shift.save',{personId:current.ownerId,position:job,start:new Date(Date.parse(current.data.start)+3600000).toISOString(),end:current.data.end,note:'Completed evidence must not move to a changed assignment'},current);f.reopen();
   });
   if(w===3)break;
   const target=nextDate(week,7);
   await f.check(`Week ${w+1}: stale copy preview rejected and ambiguous fall hour requires explicit selection`,async()=>{
    const stale=await f.copyInput(week,target,shifts);let current=f.find(shifts[6].id??shifts[6].recordId);await f.command(ids.manager,'shift.save',{personId:current.ownerId,position:job,start:current.data.start,end:current.data.end,note:'Source revision changed after copy preview'},current);await f.deny(ids.manager,'shift.copy-week',stale,undefined,409);
    if(w===1){const safe=await f.copyInput(week,target,shifts);await f.deny(ids.manager,'shift.copy-week',{...safe,repeated:''});}
   });
   await f.check(`Week ${w+1}: copy rollback is atomic, interrupted retry exactly once, and copied closes contain fresh evidence`,async()=>{
    const input=await f.copyInput(week,target,shifts),requestId='copy-'+w,before=f.snapshot();
    f.sqlite().exec("CREATE TRIGGER schedule_copy_abort BEFORE INSERT ON records WHEN NEW.kind='close' BEGIN SELECT RAISE(ABORT,'fictional copy interruption'); END");
    const failed=await f.call(ids.manager,'shift.copy-week',input,undefined,requestId);assert.equal(failed.status,503,JSON.stringify(failed));assert.equal(f.snapshot(),before);f.sqlite().exec('DROP TRIGGER schedule_copy_abort');
    const result=await f.command(ids.manager,'shift.copy-week',input,undefined,requestId);f.reopen();assert.deepEqual(await f.command(ids.manager,'shift.copy-week',input,undefined,requestId),result);
    const workspace=await f.view(),copied=workspace.records.filter(r=>r.kind==='shift'&&r.data.copiedFrom?.targetWeek===target);assert.equal(copied.length,9);assert.ok(copied.every(r=>!r.data.published&&!r.data.releasedAt));
    for(const s of copied){const source=f.find(s.data.copiedFrom.id);assert.equal(localClock(s.data.start,'America/New_York'),localClock(source.data.start,'America/New_York'));assert.equal(localClock(s.data.end,'America/New_York'),localClock(source.data.end,'America/New_York'));assert.equal(localDate(s.data.start,'America/New_York'),nextDate(localDate(source.data.start,'America/New_York'),7));}
    const overnight=copied.find(r=>r.ownerId===ids.overnight);if(w===1)assert.equal((Date.parse(overnight.data.end)-Date.parse(overnight.data.start))/3600000,5.5);
    const close=workspace.records.find(r=>r.kind==='close'&&copied.some(s=>s.id===r.data.shiftId));assert.ok(close);assert.equal(close.data.phase,'open');assert.deepEqual(close.data.answers,[]);assert.equal(close.data.history.length,1);
    assert.ok(!(await f.view(ids.worker)).records.some(r=>copied.some(c=>r.id===c.id)));
    shifts=copied.sort((a,b)=>a.data.start.localeCompare(b.data.start));const mains=shifts.filter(s=>s.ownerId===ids.worker).sort((a,b)=>a.data.start.localeCompare(b.data.start));shifts=[...mains,...shifts.filter(s=>s.ownerId!==ids.worker)];closing=close;
   });
   week=target;
  }
  await f.check('Final week: cancellation notification, durable retry and immutable cancelled shift',async()=>{
   const current=f.find(shifts[6].id??shifts[6].recordId),input={note:'Fictional cancellation after manager review'},id='final-cancel';let cancelled=await f.command(ids.manager,'shift.cancel',input,current,id);f.reopen();assert.deepEqual(await f.command(ids.manager,'shift.cancel',input,current,id),cancelled);assert.ok(f.find(current.id).data.cancelled);await f.deny(ids.manager,'shift.save',{personId:current.ownerId,position:job,start:current.data.start,end:current.data.end,note:'Cannot reopen cancelled shift'},f.find(current.id));assert.ok((await f.view(ids.worker)).records.some(r=>r.kind==='message'&&r.data.title==='Shift cancelled'&&r.data.recordId===current.id));
   for(const saved of f.receipt.weeks){assert.equal(saved.shiftIds.length,9);assert.ok(saved.shiftIds.every(id=>f.find(id)));assert.equal(f.find(saved.closingId).data.phase,'closed');}
   assert.equal(f.sqlite().prepare("SELECT count(*) AS n FROM records WHERE kind='shift'").get().n,27);
  });
 }finally{f.finish();}
});

