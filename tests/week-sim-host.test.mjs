import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {buildRoleHome} from '../.sites-runtime/shared/role-home.mjs';
import {buildShiftBrief} from '../.sites-runtime/shared/shift-brief.mjs';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {confirmedDutiesForLocation} from '../.sites-runtime/shared/starter-tasks.mjs';

// All commands run against isolated fictional objects. No database, network,
// production approval, attendance, payroll or physical guest action is implied.
const results={role:'Host',executedLayer:'applyCommand + publicWorkspace + role home + myWork + shift brief + workforce context',week:'2026-10-05 through 2026-10-11',locations:[],gaps:[],limitations:['No browser interactions or HTTP/D1 persistence executed.','Guest volume and physical work are fictional scenario inputs, not observed restaurant conditions.','The approved guide and manager permissions are fictional fixture setup; no live standard or authority was changed.','Podium work is physical. App messages in these cases are simulated after stepping away; no phone-at-podium requirement is introduced.']};
const time=(day,hour)=>`2026-10-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00.000Z`;
function fixture(locationId){
 const member=(id,position,capabilities=[])=>({id,locationId,name:'Fictional '+id,area:'FOH',position,capabilities,qualifications:[],scheduleJobs:[position]});
 const host=member('host','Host'),manager=member('manager','Manager',['location.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','close.confirm','people.manage']),other=member('other','Server');
 const duty=confirmedDutiesForLocation(locationId).find(d=>d.id==='host-shared');
 const standard={id:'host-guide',kind:'standard',locationId,ownerId:manager.id,area:'FOH',revision:1,updatedAt:time(5,12),data:{title:'Fictional approved Host guide',zone:'Host podium',position:'Host',version:1,status:'approved',source:'Fictional software rehearsal of owner-confirmed Host reference; no operating approval.',validationNote:'Fixture only',verification:'manager',criteria:[...duty.closing],history:[],guide:{purpose:'Welcome and seat guests at a steady pace; keep the podium supplied.',preparation:[...duty.opening],steps:[...duty.service,...duty.closing],troubleshooting:['Ask the manager how to cover an unstaffed busser position.'],escalation:'Ask the manager for overload direction; use the written server rotation.'}}};
 const w={location:{id:locationId,name:'Fictional '+locationId,timezone:'America/New_York',revision:1},me:manager,members:[host,manager,other],records:[standard]};let serial=0;
 const run=(actor,action,input={},record,at=time(5,12))=>{const changes=applyCommand({...w,me:actor},{requestId:crypto.randomUUID(),locationId,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})},at,()=>`${locationId}-host-${++serial}`);for(const changed of changes){const i=w.records.findIndex(r=>r.id===changed.id);if(i<0)w.records.push(changed);else w.records[i]=changed;}w.location.revision++;return changes.find(r=>r.kind===action.split('.')[0])??changes[0];};
 const view=(actor=host,at=time(5,18))=>publicWorkspace({...w,me:actor},at),fresh=id=>w.records.find(r=>r.id===id);
 return {w,host,manager,other,duty,standard,run,view,fresh};
}

for(const locationId of ['berts','rudds'])test(`${locationId}: seven Host days execute saved assignment, guide, communication, learning, carryover and checkout`,()=>{
 const f=fixture(locationId),days=[];
 const shifts=[];
 for(let day=5;day<=11;day++){
  let s=f.run(f.manager,'shift.save',{personId:'host',position:'Host',start:time(day,16),end:time(day,22)});
  f.run(f.manager,'close.assign',{shiftId:s.id,standardId:f.standard.id,managerId:'manager',due:time(day,22)});
  s=f.run(f.manager,'shift.publish',{},s);shifts.push(s);
 }
 assert.deepEqual(f.host.qualifications,[]);
 let backlog;
 for(let day=5;day<=11;day++){
  const at=time(day,18),s=f.fresh(shifts[day-5].id),view=f.view(f.host,at),work=myWork(view,at),home=buildRoleHome(view,'frontline',new Date(at));
  assert.equal(work.shift.id,s.id);assert.equal(work.station,'Host');assert.equal(work.guides[0].id,f.standard.id);assert.ok(home.attention.some(a=>a.recordId===f.standard.id&&a.tab==='Training'));
  assert.match(work.guides[0].data.guide.steps.join(' '),/waiting sign.*nearby staff.*acknowledge/i);
  assert.match(work.guides[0].data.guide.steps.join(' '),/written server rotation.*steady seating pace.*manager/i);
  const actions=['Opened published Host assignment and exact saved approved guide.','Read opening check: server lineup, occupied tables, meal progress and clean menus.'];
  if(day===5)actions.push('Arrival-away procedure is in the reachable guide: please-wait sign, nearby employee welcomes, host acknowledges on return. Physical execution is simulated.');
  if(day===6){
   let g=f.run(f.manager,'goal.create',{ownerId:'host',managerId:'manager',type:'development',title:'Fictional Host rotation practice',definition:'Explain the written rotation and overload escalation with the manager.',due:time(7,21),standardId:f.standard.id,standardRevision:1},undefined,at);
   g=f.run(f.host,'goal.transition',{step:'accept',note:'Fictional agreed practice'},g,at);g=f.run(f.host,'goal.transition',{step:'practice',note:'Explained rotation and sign procedure'},g,at);g=f.run(f.host,'goal.transition',{step:'ready',note:'Please observe explanation'},g,at);g=f.run(f.manager,'goal.transition',{step:'verify',note:'Fictional explanation observed'},g,at);assert.equal(g.data.phase,'closed');assert.deepEqual(f.host.qualifications,[]);actions.push('Host-specific learning accepted, practiced and independently confirmed; clearance remains unchanged.');
  }
  if(day===7){backlog=f.run(f.manager,'task.create',{ownerId:'host',kind:'task',title:'Fictional silverware backlog',detail:'Help bag the named remaining silverware after guest work permits; report remaining work.',due:time(7,22)},undefined,at);actions.push('Manager assigned silverware backlog; left open for next-day follow-through.');}
  if(day===8){
   assert.ok(myWork(f.view(f.host,at),at).duties.some(d=>d.record.id===backlog.id&&d.overdue));
   let t=f.run(f.host,'task.transition',{step:'ready',note:'Fictional bags finished'},backlog,at);t=f.run(f.manager,'task.transition',{step:'verify',note:'Fictional remaining bags checked'},t,at);assert.equal(t.data.phase,'closed');
   let changed=f.run(f.manager,'shift.save',{personId:'host',position:'Host',start:time(9,17),end:time(9,22),note:'Fictional Friday later arrival; manager covers podium until arrival.'},f.fresh(shifts[4].id),at);assert.equal(changed.data.start,time(9,17));assert.ok(f.view(f.host,at).records.some(r=>r.kind==='message'&&r.data.title==='Your schedule changed'));actions.push('Next-day backlog remained overdue and was independently verified; Friday published start moved one hour with Inbox notice.');
  }
  if(day===9){
   let msg=f.run(f.host,'message.send',{recipients:['manager'],title:'Fictional seating overload',body:'Stepped away after speaking in person: the next server in written rotation is overloaded. Please direct seating pace.'},undefined,at);assert.ok(f.view(f.manager,at).records.some(r=>r.id===msg.id));msg=f.run(f.manager,'message.reply',{text:'Fictional direction: hold the next seating briefly; I will speak with the overloaded server.'},msg,at);assert.ok(buildRoleHome(f.view(f.host,at),'frontline',new Date(at)).attention.some(a=>a.recordId===msg.id&&a.tab==='Inbox'));msg=f.run(f.host,'message.read',{},msg,at);assert.ok(msg.data.readBy.includes('host'));actions.push('Busy Friday overload direction saved in a manager conversation and surfaced unread for Host; seating itself remains physical.');
  }
  if(day===10){
   assert.throws(()=>f.run(f.manager,'shift.save',{personId:'host',position:'Host',start:time(10,17),end:time(10,21)},undefined,at),/overlapping shift/);
   f.run(f.manager,'message.send',{recipients:['host'],title:'Fictional unstaffed busser coverage',body:'Host remains the single seating position. Nearby server will help reset released tables while you keep the podium covered; ask me if arrival pace exceeds coverage.'},undefined,at);actions.push('Saturday remains one Host assignment; conflicting second assignment is rejected; manager supplied named physical coverage direction.');
  }
  let close=f.w.records.find(r=>r.kind==='close'&&r.data.shiftId===s.id);
  if(day===10){
   assert.throws(()=>f.run(f.manager,'shift.release',{note:'Attempt release before unfinished Host close'},s,time(day,23)),/every assigned close/);
   const endAt=time(day,23),ended=myWork(f.view(f.host,endAt),endAt),endedHome=buildRoleHome(f.view(f.host,endAt),'frontline',new Date(endAt));assert.equal(ended.checkoutPending,true);assert.equal(ended.shift.id,s.id);
   const row=endedHome.attention.find(a=>a.recordId===s.id);assert.match(row.why,/Your scheduled shift has ended; assigned closing work and manager checkout remain separate/);assert.doesNotMatch(row.why,/next published assignment/);
   assert.equal(workforceContext({...f.w,me:f.host},'What should I do for this shift?',endAt).context.myShift.status,'scheduled shift ended; operational checkout pending');
   results.gaps.push({id:'HOST-ENDED-LABEL',locationId,classification:'resolved and verified',severity:'P2',previousBehavior:'Ended selected shift was called the next published assignment.',reproduction:'Publish Host shift with assigned close. Read frontline home one hour after scheduled end while close is open.',actual:row.why,expected:'Ended shift awaiting closing work and manager checkout.',source:'app/shared/role-home.ts:73',support:'app/shared/my-work.ts:16-18'});actions.push('Unfinished Saturday close blocks release and stays in focus after end; home now correctly identifies ended assignment and separate pending checkout (fix verified).');
  }else{
   if(day===11){const earlier=f.w.records.find(r=>r.kind==='close'&&r.data.shiftId===shifts[5].id);assert.ok(myWork(f.view(f.host,at),at).duties.some(d=>d.record.id===earlier.id));let prior=f.run(f.host,'close.transition',{step:'ready',answers:[0,1],note:'Fictional prior menus/windows and child seats corrected; backlog addressed'},earlier,at);prior=f.run(f.manager,'close.transition',{step:'confirm',note:'Fictional prior conditions physically checked'},prior,at);f.run(f.manager,'shift.release',{note:'Fictional Saturday checkout after delayed check'},f.fresh(shifts[5].id),at);actions.push('Sunday current shift takes focus while prior close remains reachable; previous work confirmed and released separately.');}
   close=f.run(f.host,'close.transition',{step:'ready',answers:[0,1],note:'Fictional menus, glass/windows, high chairs/boosters cleaned; backlog help handled'},close,time(day,21));
   assert.throws(()=>f.run(f.host,'close.transition',{step:'confirm',note:'Attempt own physical check'},close,time(day,21)),/independent closing manager/);
   if(day===11){close=f.run(f.manager,'close.transition',{step:'fix',note:'Fictional booster still needs wiping'},close,time(day,21));close=f.run(f.host,'close.transition',{step:'ready',answers:[0,1],note:'Fictional booster correction complete'},close,time(day,21));actions.push('Specific manager correction returned to Host and resubmitted.');}
   close=f.run(f.manager,'close.transition',{step:'confirm',note:'Fictional physical Host close check passed'},close,time(day,22));assert.equal(close.data.phase,'closed');assert.equal(f.fresh(s.id).data.releasedAt,undefined);f.run(f.manager,'shift.release',{note:'Fictional independent manager release'},f.fresh(s.id),time(day,23));actions.push('Host closing conditions reported, manager checked, and separate checkout recorded.');
  }
  days.push({date:`2026-10-${String(day).padStart(2,'0')}`,workload:day>=9?'Fictional weekend surge / coverage pressure':'Fictional weekday steady flow',actions,status:'executed; physical action and workload simulated'});
 }
 results.locations.push({locationId,days,hostQualifications:f.host.qualifications,shiftCount:f.w.records.filter(r=>r.kind==='shift').length,releasedCount:f.w.records.filter(r=>r.kind==='shift'&&r.data.releasedAt).length});
});

test('Host guide approval boundary, explicit seating mapping, and ended shift without close are distinguished',()=>{
 const f=fixture('berts');f.w.records=[];
 let s=f.run(f.manager,'shift.save',{personId:'host',position:'Host',start:time(5,16),end:time(5,22)});s=f.run(f.manager,'shift.publish',{},s);
 assert.equal(myWork(f.view(),time(5,18)).guides.length,0);assert.ok(buildRoleHome(f.view(),'frontline',new Date(time(5,18))).attention.some(a=>a.what==='Approved position instructions missing'));
 f.w.records.push(f.standard);assert.equal(myWork(f.view(),time(5,18)).guides[0].id,f.standard.id);
 let station=f.run(f.manager,'station.save',{title:'Seating',area:'FOH',levels:[],independentLevel:null,status:'active',note:'Fictional single Host station',setup:{jobs:['Host'],allJobMembers:true,memberIds:[],standardIds:[f.standard.id],managerId:'manager',goals:[]}});
 s=f.run(f.manager,'shift.save',{personId:'host',position:'Host',stationId:station.id,start:s.data.start,end:s.data.end,note:'Fictional explicitly linked seating station'},s);assert.equal(myWork(f.view(),time(5,18)).guides[0].id,f.standard.id);
 const after=time(5,23),work=myWork(f.view(f.host,after),after),brief=buildShiftBrief(f.view(f.host,after),after);assert.equal(work.shift.id,s.id);assert.equal(work.checkoutPending,true);assert.ok(brief.items.some(i=>i.record.id===s.id&&i.next==='Waiting for manager checkout'));assert.equal(work.duties.some(i=>i.record.id===s.id),true);
 const contextStatus=workforceContext({...f.w,me:f.host},'What should I do for this shift?',after).context.myShift.status;assert.equal(contextStatus,'scheduled shift ended; operational checkout pending');
 results.gaps.push({id:'HOST-NO-CLOSE-CHECKOUT',classification:'resolved and verified',severity:'P2',previousBehavior:'Unreleased ended shift without close fell out of My Work and Companion checkout context.',reproduction:'Publish a Host shift with reachable approved guide and no assigned close. After scheduled end, leave shift unreleased.',actual:{selectedShift:work.shift.id,checkoutPending:work.checkoutPending,brief:brief.items.find(i=>i.record.id===s.id).next,contextStatus},source:'app/shared/my-work.ts:16',support:'app/shared/my-work.ts:24; app/shared/shift-brief.ts:41-42; app/shared/workforce-context.ts'});
 results.approvalBoundary='Confirmed catalog is not an approved saved standard. Missing saved guide is accurately disclosed; saved Host guide is reachable both by job and explicitly linked Seating station.';
});

test.after(()=>{fs.mkdirSync(new URL('../evidence/week-simulation/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../evidence/week-simulation/host.json',import.meta.url),JSON.stringify(results,null,2)+'\n');});
