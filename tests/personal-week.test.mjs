import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalWeek,weekStart,zone} from './personal-week-runtime.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {localInstant,nextDate} from '../.sites-runtime/shared/local-time.mjs';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';

test('a fictional employee week follows real saved work from Monday through Sunday overnight',async t=>{
 const f=await createPersonalWeek();t.after(()=>f.dispose());
 const time=(day,hour='12:00')=>f.setTime(localInstant(nextDate(weekStart,day),hour,zone));
 const own=async actor=>myWork(await f.get(actor),f.at);
 const goal=async(actor,title)=>(await f.get(actor)).records.find(r=>r.kind==='goal'&&r.data.title===title);
 const transition=async(actor,title,step)=>f.call(actor,'goal.transition',{step,note:'Fictional '+step+' check'},await goal(actor,title));
 const ask=async actor=>{const v=await(await f.request(actor,'/api/companion?locationId=week')).json();const r=await f.request(actor,'/api/companion',{locationId:'week',action:'ask',conversationId:v.conversationId,expectedRevision:v.revision,requestId:crypto.randomUUID(),question:'What should I do for my shift today?'});assert.equal(r.status,200,await r.clone().text());return f.captures.at(-1)};
 let task;
 await t.test('Owner setup: new guidance goes to the chosen department and stays there',async()=>{
  const input={area:'BOH',title:'Fictional owner draft',zone:'Fry',position:'Fry',version:1,source:'Fictional test only',criteria:['Practice card ready'],verification:'manager'};
  const draft=await f.call('owner','standard.save',input);const saved=await f.fresh('owner',draft);assert.equal(saved.area,'BOH');assert.equal(saved.data.status,'draft');
  await assert.rejects(()=>f.call('owner','standard.save',{...input,area:'FOH'},saved),/original department/);
  await assert.rejects(()=>f.call('cook','standard.save',input),error=>error.status===403);
 });
 await t.test('Monday: own station, approved source, learning choice, practice and manager queue',async()=>{
  time(0);const c=await own('cook');assert.equal(c.station,'Fry');assert.equal(c.current,true);assert.deepEqual(c.guides.map(g=>g.id),[f.guides.Fry.recordId]);assert.equal(c.relatedGoals[0].data.title,'Practice Fry');
  assert.equal(c.relatedGoals[0].data.stationLearning.shiftId,f.shifts['cook-0'].recordId);assert.equal(c.relatedGoals[0].data.due,localInstant(nextDate(weekStart,3),'23:59',zone),'The first scheduled Fry shift anchors its learning due date, even when publication order is reversed');
  assert.equal((await own('host')).station,'Seating');const d=await f.get('dish');assert.equal(d.records.some(r=>['goal','standard','task','close'].includes(r.kind)),false);assert.equal((await f.request('dish','/api/companion?locationId=week')).status,403);
  await transition('cook','Practice Fry','accept');await transition('cook','Practice Fry','practice');await transition('cook','Practice Fry','ready');
  assert.equal((await goal('owner','Practice Fry')).data.phase,'verification');assert.equal((await goal('cook','Practice Fry')).data.phase,'verification');
  task=await f.call('owner','task.create',{ownerId:'host',kind:'task',title:'Fictional seating card',detail:'Place the practice card in the empty test tray.',due:localInstant(weekStart,'17:00',zone)});
  assert.equal((await own('host')).duties[0].record.id,task.recordId);
  task=await f.call('host','task.transition',{step:'ready',note:'Fictional tray ready'},task);assert.equal((await own('host')).duties[0].lane,'waiting');
  const context=await ask('cook');assert.equal(context.myShift.station,'Fry');assert.deepEqual(context.myShift.approvedGuideIds,[f.guides.Fry.recordId]);
 });
 await t.test('Tuesday: station change and corrections remain work, not completion',async()=>{
  time(1);assert.equal((await own('cook')).station,'Grill');assert.equal((await own('host')).station,'Busser');
  await transition('owner','Practice Fry','fix');assert.equal((await goal('cook','Practice Fry')).data.phase,'active');
  await transition('cook','Practice Fry','practice');await transition('cook','Practice Fry','ready');
  task=await f.call('owner','task.transition',{step:'fix',note:'Fictional correction: turn the practice card over'},task);assert.equal((await own('host')).duties[0].lane,'action');
  task=await f.call('host','task.transition',{step:'ready',note:'Fictional correction completed'},task);await f.call('owner','task.transition',{step:'verify',note:'Fictional outcome checked'},task);assert.equal((await own('host')).duties.length,0);
  assert.equal((await ask('cook')).myShift.station,'Grill');
 });
 await t.test('Wednesday: edited published station changes the personal view; completed learning disappears',async()=>{
  time(2);let shift=await f.fresh('owner',f.shifts['cook-2']);await f.call('owner','shift.save',{personId:'cook',position:'Cook',stationId:f.stations.Fry.recordId,start:shift.data.start,end:shift.data.end,note:'Fictional manager reassignment to Fry'},shift);
  const c=await own('cook');assert.equal(c.station,'Fry');assert.deepEqual(c.guides.map(g=>g.id),[f.guides.Fry.recordId]);
  await transition('owner','Practice Fry','verify');assert.equal((await own('cook')).goals.some(g=>g.data.title==='Practice Fry'),false);assert.deepEqual((await f.get('cook')).me.qualifications,[]);
  assert.equal((await f.get('owner')).records.filter(r=>r.kind==='goal'&&r.ownerId==='cook'&&r.data.title==='Practice Fry').length,1,'Changing and repeating shifts must not duplicate learning');
  assert.equal((await ask('cook')).myShift.station,'Fry');
 });
 await t.test('Thursday: call-in history stays with its employee, coverage moves the actual station',async()=>{
  time(3,'08:00');const shift=await f.fresh('owner',f.shifts['cook-3']);
  const attendance=await f.call('owner','attendance.record',{shiftId:shift.id,shiftRevision:shift.revision,type:'call-in',reportedAt:f.at,note:'Fictional call-in for software rehearsal'});
  assert.equal((await own('cook')).shift.id,shift.id,'Recording attendance alone must not silently reassign a shift');
  let offer=await f.call('cook','coverage.create',{shiftId:shift.id,shiftRevision:shift.revision,note:'Fictional private reason'});
  const candidate=await f.fresh('backup',offer);assert.equal(candidate.data.note,'');assert.equal(candidate.data.eligible,true);
  offer=await f.call('backup','coverage.volunteer',{confirmed:true},candidate);await f.call('owner','coverage.approve',{personId:'backup',confirmed:true,note:'Fictional coverage approved'},offer);
  time(3);assert.equal((await own('backup')).station,'Fry');assert.equal((await own('backup')).current,true);assert.notEqual((await own('cook')).shift?.id,shift.id);
  assert.equal((await f.fresh('owner',attendance)).ownerId,'cook');assert.equal((await f.get('backup')).records.some(r=>r.kind==='attendance'),false);
  assert.equal((await ask('backup')).myShift.station,'Fry');
 });
 await t.test('Friday: a day off and an unpublished shift do not become today’s station',async()=>{
  time(4);const c=await own('cook');assert.equal(c.current,false);assert.equal(c.station,'Pizza');assert.equal(c.shift.data.start,localInstant(nextDate(weekStart,5),'10:00',zone));
  assert.equal((await f.get('cook')).records.some(r=>r.kind==='shift'&&!r.data.published),false);
  assert.equal((await own('host')).station,'Food Runner');
  const context=await ask('cook');assert.equal(context.myShift.status,'next published shift');assert.deepEqual(context.myShift.approvedGuideIds,[]);
 });
 await t.test('Saturday: unapproved station instructions do not become an invented method',async()=>{
  time(5);const c=await own('cook');assert.equal(c.station,'Pizza');assert.deepEqual(c.guides,[]);assert.equal(c.relatedGoals.length,0);
  const context=await ask('cook');assert.deepEqual(context.myShift.approvedGuideIds,[]);
  assert.equal(context.evidence.some(e=>e.source.kind==='standard'),false,'The built Worker must also omit unrelated methods from the provider request');
  const evidence=workforceContext(await f.get('cook'),'What should I do for my shift today?',f.at).evidence;
  assert.equal(evidence.some(e=>e.source.kind==='standard'),false,'Do not supply unrelated station methods when the assigned station has no approved guide');
  const suggestion=workforceContext(await f.get('cook'),'Help me prepare for my Pizza shift.',f.at).evidence;
  assert.equal(suggestion.some(e=>e.source.kind==='standard'),false,'The built-in named-shift suggestion must also respect the missing guide');
 });
 await t.test('Sunday into Monday: overnight station survives midnight and ends cleanly',async()=>{
  time(6,'23:00');assert.equal((await own('cook')).station,'Grill');assert.equal((await own('cook')).current,true);
  time(7,'01:00');assert.equal((await own('cook')).station,'Grill');assert.equal((await own('cook')).current,true);assert.equal((await ask('cook')).myShift.station,'Grill');
  time(7,'02:00');assert.equal((await own('cook')).shift,undefined);assert.equal((await own('cook')).current,false);
 });
});
