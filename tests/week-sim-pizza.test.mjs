import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {guidesForShift} from '../.sites-runtime/shared/shift-learning.mjs';
import {confirmedDutiesForLocation} from '../.sites-runtime/shared/starter-tasks.mjs';

// All people, approvals, shifts and work are fictional and isolated. Nothing is
// connected to a live restaurant, authentication provider or external API.
process.env.MINIFLARE_REGISTRY_PATH=path.resolve('.wrangler/registry-week-pizza');
const evidence={role:'Pizza Make / Catch / combined Oven',scope:'Isolated fictional domain state and disposable D1 HTTP handlers; no live operations',days:[],findings:[]};
const day=(n,location,story)=>{const d={day:n,date:`2026-10-${String(n+7).padStart(2,'0')}`,location,story,actions:[]};evidence.days.push(d);return d;};
function record(d,name,expected,actual,source,status='pass',mode='executable') {d.actions.push({name,expected,actual,status,mode,source,repro:`node --test tests/week-sim-pizza.test.mjs; day ${d.day}: ${name}`});if(status==='gap')evidence.findings.push({day:d.day,name,expected,actual,source,mode});}
// Resolve exact current source lines after all assertions, since parallel closing
// fixes may insert lines without changing the behavior being exercised.
function refreshSourceLines(){
 const refs={
  'Find scheduled station training':['shift-learning','if(shift.data.stationId)'],
  'Assign Pizza Make closing guide':['domain','standard && guidesForShift(w,shift)'],
  'Explicitly assign station close':['starter-tasks','Reading this catalog does not approve'],
  'Ticket check, cut, garnish, box or plate instructions':['starter-tasks',"id:'pizza-make-close'"],
  'Find Rudd’s Catch extra duties':['starter-tasks',"id:'catch-rudds'"],
  'Worker cannot assign operational task':['domain',"if(shiftId)requireThat(canManageClosing(me,target.area"],
  'Worker reports notice and manager follows through':['domain',"case 'feedback.save'"],
  'Manager records issue':['domain',"create({ kind: 'task', data: { title"],
  'Move late catch work to Expo':['domain',"target.area===r.area&&target.id!==r.data.incomingId"],
  'Narrow incoming Expo visibility':['domain',"case 'task': return"],
  'Checkout with unfinished late catch':['domain','pendingTasks.length===0,\'Complete and independently verify'],
  'Expo accepts handoff':['domain','closingHandoff:{outgoingId:r.ownerId'],
  'Accepted late catch follow-through':['domain',"phase = r.data.kind === 'handoff'&&!r.data.closingHandoff"],
  'Combined oven service and close variant':['starter-tasks',"id:'oven-berts'"],
  'Assign combined oven close':['domain','standard && guidesForShift(w,shift)'],
  'Papa shift and location instructions':['starter-tasks',"id:'pizza-make-close'"],
  'Opening time instruction':['starter-tasks','Papa’s is a one-shift restaurant'],
  'Next-day unresolved issue carryover':['my-work','const duties='],
  'Manager check, correction and checkout':['domain',"if(step==='ready') { requireThat(me.id===correctionPerformer"],
  'Changed station access':['station-assignment','station’s scheduling list'],
  'Durable reload and restaurant scope':['service','SELECT * FROM records WHERE location_id = ?'],
  'Wrong restaurant access':['service','const mine ='],
  'Changed authority on fresh request':['service','const { value: w, membershipRevision'],
  'Removed employee access':['service','const mine ='],
  'Removal preserves unresolved work':['service','SELECT * FROM records WHERE location_id = ?']
 };
 for(const a of [...evidence.days.flatMap(d=>d.actions),...evidence.findings]){const ref=refs[a.name];if(!ref)continue;const file=`app/shared/${ref[0]}.ts`,lines=fs.readFileSync(file,'utf8').split(/\r?\n/),line=lines.findIndex(s=>s.includes(ref[1]));assert.ok(line>=0,`Source locator missing for ${a.name}`);a.source=`${file}:${line+1}`;}
}
function world(locationId){
 const member=(id,position,area,capabilities=[])=>({id:`${locationId}-${id}`,locationId,name:`FICTIONAL ${id}`,position,area,capabilities,qualifications:['Pizza Make','Pizza Catch','Oven / Pizza Make / Catch'],scheduleJobs:position==='Cook'?['Cook']:[position]});
 const owner=member('owner','Owner','Executive',['location.manage','people.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','close.confirm','standards.approve']);
 const worker=member('pizza','Cook','BOH'),catcher=member('catch','Cook','BOH'),expo=member('expo','Expo','FOH'),manager=member('manager','Manager','BOH',['tasks.manage','close.confirm','schedule.manage','schedule.publish']);
 const w={location:{id:locationId,name:`FICTIONAL ${locationId}`,timezone:'America/New_York',revision:1},me:owner,members:[owner,worker,catcher,expo,manager],records:[]};let serial=0,at='2026-10-08T18:00:00Z';
 const run=(actor,action,input={},r)=>{w.me=actor;const changes=applyCommand(w,{locationId,action,input,requestId:crypto.randomUUID(),...(r?{recordId:r.id,expectedRevision:r.revision}:{})},at,()=>`${locationId}-${++serial}`);for(const c of changes){const i=w.records.findIndex(p=>p.id===c.id);if(i<0)w.records.push(c);else w.records[i]=c;}w.location.revision++;return changes.find(c=>c.kind===action.split('.')[0])??changes[0];};
 const station=title=>run(owner,'station.save',{title,area:'BOH',levels:[],independentLevel:null,status:'active',note:'FICTIONAL station setup',setup:{jobs:['Cook'],allJobMembers:true,memberIds:[],standardIds:[],managerId:owner.id,goals:[]}});
 const guide=(title,position,criteria,steps)=>{const r={id:`${locationId}-guide-${++serial}`,kind:'standard',locationId,area:'BOH',ownerId:owner.id,revision:1,updatedAt:at,data:{title,zone:title,position,version:1,status:'approved',verification:'manager',source:'FICTIONAL scenario only, using owner-confirmed reference for test coverage; not a live operating approval',criteria,history:[],guide:{purpose:'Fictional role rehearsal',preparation:['Clean utensils, garnish bottles, shakers, boxes and trays'],steps,troubleshooting:['Ask manager about missing supplies'],escalation:'Report the issue to the manager'}}};w.records.push(r);return r;};
 const shift=(n,s,person=worker,hour=19)=>{const start=`2026-10-${String(n+7).padStart(2,'0')}T${hour}:00:00Z`,end=new Date(Date.parse(start)+6*3600000).toISOString();let r=run(owner,'shift.save',{personId:person.id,position:'Cook',stationId:s.id,start,end});return run(owner,'shift.publish',{},r);};
 const view=(person,time=at)=>myWork(publicWorkspace({...w,me:person},time),time);
 return {w,owner,worker,catcher,expo,manager,run,station,guide,shift,view,clock:time=>at=time,now:()=>at};
}

test('fictional seven-day Pizza Make/Catch journey records working paths and reproducible gaps',async t=>{
 const rudds=world('rudds'),berts=world('berts'),papa=world('papa');
 const d1=day(1,'rudds','Opening and flexible pizza teamwork; link the right instructions and assigned close');
 const make=rudds.station('Pizza Make'),catchStation=rudds.station('Pizza Catch');
 const reference=confirmedDutiesForLocation('rudds').find(r=>r.id==='pizza-make-close');
 assert.match(reference.service.join(' '),/does not require a fixed handoff/);
 const makeGuide=rudds.guide('Fictional Pizza Make','Pizza Make',['Pizza table broken down and clean'],[...reference.service,...reference.closing]);
 const s1=rudds.shift(1,make);rudds.clock(s1.data.start);
 assert.deepEqual(guidesForShift(publicWorkspace({...rudds.w,me:rudds.worker}),s1).map(g=>g.id),[makeGuide.id]);
 record(d1,'Find scheduled station training','Cook job retains Pizza Make station and its guide',{job:s1.data.position,station:s1.data.stationName,guideCount:1},'app/shared/shift-learning.ts:14');
 const cookGuide=makeGuide;
 let c1=rudds.run(rudds.owner,'close.assign',{shiftId:s1.id,standardId:makeGuide.id,managerId:rudds.owner.id,due:s1.data.end});
 record(d1,'Assign Pizza Make closing guide','The approved guide matching the scheduled station can become its close',{job:s1.data.position,station:s1.data.stationName,assignedGuide:c1.data.standard.position},'app/shared/domain.ts:982');
 assert.equal(c1.data.phase,'open');
 record(d1,'Explicitly assign station close','Assignment is open; catalog alone assigned no work',{beforeAssignmentCloseCount:0,afterAssignmentCloseCount:1},'app/shared/starter-tasks.ts:7');
 record(d1,'Ticket check, cut, garnish, box or plate instructions','Shared Pizza Make/Catch reference covers ticket check, cutting, garnishing and serving','Confirmed catalog covers flexible build split and supplies; shared Catch service instruction is absent','app/shared/starter-tasks.ts:37','gap','source-only');

 const d2=day(2,'rudds','Catch closes walk-in/freezer/back hallway; reporting and carrying a missing garnish issue');
 const s2=rudds.shift(2,catchStation,rudds.catcher);rudds.clock(s2.data.start);
 const catchRef=confirmedDutiesForLocation('rudds').find(r=>r.id==='catch-rudds');
 const catchGuide=rudds.guide('Fictional Catch assigned area','Pizza Catch',['Walk-in, freezer and back hallway swept and mopped'],catchRef.closing);
 const c2=rudds.run(rudds.owner,'close.assign',{shiftId:s2.id,standardId:catchGuide.id,managerId:rudds.owner.id,due:s2.data.end});
 assert.equal(rudds.view(rudds.catcher).duties.some(i=>i.record.id===c2.id),true);
 record(d2,'Find Rudd’s Catch extra duties','Only Rudd’s receives cooler/freezer/back hallway assignment',c2.data.standard.criteria,'app/shared/starter-tasks.ts:41');
 assert.throws(()=>rudds.run(rudds.catcher,'task.create',{ownerId:rudds.catcher.id,kind:'issue',title:'Fictional missing garnish bottle',detail:'Manager must replace fictional bottle before next shift',due:s2.data.end}),/permission/);
 record(d2,'Worker cannot assign operational task','Task assignments require manager authority','task.create rejected for worker without tasks.manage; employee feedback route tested separately','app/shared/domain.ts:1317');
 let feedback=rudds.run(rudds.catcher,'feedback.save',{text:'Fictional garnish bottle missing; need a clean replacement',shared:true});
 feedback=rudds.run(rudds.owner,'feedback.respond',{response:'Fictional manager will locate clean replacement and follow up',due:'2026-10-10T19:00:00Z'},feedback);
 assert.equal(feedback.data.status,'follow-up');
 record(d2,'Worker reports notice and manager follows through','Worker can share feedback and receive a timed manager commitment',{shared:true,status:feedback.data.status,due:feedback.data.due},'app/shared/domain.ts:1484');
 const issue=rudds.run(rudds.owner,'task.create',{ownerId:rudds.worker.id,kind:'issue',title:'Fictional next-day garnish bottle',detail:'Locate clean replacement before next pizza shift',due:'2026-10-10T19:00:00Z'});
 record(d2,'Manager records issue','Issue remains open for follow-through',issue.data.phase,'app/shared/domain.ts:1326');

 const d3=day(3,'rudds','Late pizza is passed to Expo while outgoing pizza worker seeks checkout');
 const s3=rudds.shift(3,make);rudds.clock(s3.data.start);
 let late=rudds.run(rudds.owner,'task.create',{ownerId:rudds.worker.id,kind:'task',title:'Fictional last pizza catch',detail:'Check ticket, cut, garnish and plate last pizza before oven shutdown',due:s3.data.end});
 assert.throws(()=>rudds.run(rudds.owner,'task.reassign',{ownerId:rudds.expo.id,note:'Expo covers fictional late catch'},late),/department/);
 record(d3,'Move late catch work to Expo','Department ownership remains guarded; authorized handoff supplies a separate path','Generic task reassignment rejects FOH Expo from BOH task; accepted incoming handoff tested below','app/shared/domain.ts:1387');
 let handoff=rudds.run(rudds.owner,'task.create',{ownerId:rudds.worker.id,incomingId:rudds.expo.id,shiftId:s3.id,kind:'handoff',title:'Fictional late pizza handoff',detail:'Last pizza in oven; Expo checks ticket, cuts, garnishes and plates',due:s3.data.end});
 handoff=rudds.run(rudds.worker,'task.transition',{step:'ready',note:'Fictional oven status and ticket communicated'},handoff);
 handoff=rudds.run(rudds.owner,'task.transition',{step:'verify',note:'Fictional handoff state checked'},handoff);
 assert.equal(handoff.data.phase,'acceptance');
 const expoView=publicWorkspace({...rudds.w,me:rudds.expo});
 assert.ok(expoView.records.some(r=>r.id===handoff.id));assert.ok(!expoView.records.some(r=>r.id===late.id));assert.ok(!expoView.records.some(r=>r.id===issue.id));
 record(d3,'Narrow incoming Expo visibility','Authorized incoming Expo can see this handoff without seeing unrelated BOH tasks',{handoffVisible:true,otherPizzaTaskVisible:false,unrelatedIssueVisible:false},'app/shared/domain.ts:1322');
 rudds.clock(s3.data.end);assert.throws(()=>rudds.run(rudds.owner,'shift.release',{note:'Fictional release while late catch acceptance remains pending'},s3),/every task required/);
 assert.equal(handoff.data.phase,'acceptance');assert.equal(late.data.phase,'open');
 record(d3,'Checkout with unfinished late catch','Require resolution of explicitly linked late catch handoff before release',{released:false,unlinkedTask:'open',linkedHandoff:'acceptance'},'app/shared/domain.ts:1123');
 handoff=rudds.run(rudds.expo,'task.transition',{step:'accept',note:'Fictional Expo receives last pizza catch'},handoff);
 assert.equal(handoff.data.phase,'open');assert.equal(handoff.ownerId,rudds.expo.id);
 assert.throws(()=>rudds.run(rudds.owner,'shift.release',{note:'Receipt alone not complete'},s3),/every task required/);
 record(d3,'Expo accepts handoff','Incoming Expo receipt transfers the remaining work and keeps checkout blocked',{phase:handoff.data.phase,ownerIncoming:true,shiftId:handoff.data.shiftId},'app/shared/domain.ts:1384');
 handoff=rudds.run(rudds.expo,'task.transition',{step:'ready',note:'Fictional pizza caught, cut, garnished and plated'},handoff);
 handoff=rudds.run(rudds.owner,'task.transition',{step:'verify',note:'Fictional served pizza independently checked'},handoff);
 const released=rudds.run(rudds.owner,'shift.release',{note:'Fictional linked catch completed; unrelated unlinked task remains open'},s3);assert.ok(released.data.releasedAt);
 record(d3,'Accepted late catch follow-through','Incoming work is completed and independently verified before original checkout',{phase:handoff.data.phase,released:true,unlinkedTaskStillOpen:late.data.phase==='open'},'app/shared/domain.ts:1396');

 const d4=day(4,'berts','Combined oven worker makes other oven foods and catches Pasta/Sandwich baked spaghetti');
 const oven=berts.station('Oven / Pizza Make / Catch'),ovenRef=confirmedDutiesForLocation('berts').find(r=>r.id==='oven-berts');
 const ovenGuide=berts.guide('Fictional combined oven guide','Oven / Pizza Make / Catch',['Oven off and crumb tray clean','Pizza table/date checks/underneath and pans complete','Mixing-bowl/smoking area clean and butter handled'],[...ovenRef.service,...ovenRef.closing]);
 const s4=berts.shift(4,oven);berts.clock(s4.data.start);
 const text=JSON.stringify(guidesForShift(publicWorkspace({...berts.w,me:berts.worker}),s4));
 for(const item of ['breadsticks','dinner rolls','Reubens','chicken bacon ranch subs','potato skins','baked spaghetti','smoking area','butter'])assert.ok(text.includes(item));
 assert.ok(!text.includes('back hallway'));assert.ok(!confirmedDutiesForLocation('berts').some(r=>r.id==='catch-rudds'));
 record(d4,'Combined oven service and close variant','Bert’s guide covers oven products, catch/plate to Expo and full close; excludes Rudd’s floor area',{guideId:ovenGuide.id,checkedProducts:6,spaghettiCatch:true,bertsClosing:true,ruddsFloorArea:false},'app/shared/starter-tasks.ts:43');
 const ovenClose=berts.run(berts.owner,'close.assign',{shiftId:s4.id,standardId:ovenGuide.id,managerId:berts.owner.id,due:s4.data.end});assert.equal(ovenClose.data.phase,'open');
 record(d4,'Assign combined oven close','Combined Oven station guide can be assigned to its Cook shift',{job:s4.data.position,guidePosition:ovenClose.data.standard.position,phase:ovenClose.data.phase},'app/shared/domain.ts:982');

 const d5=day(5,'papa','One shift opens at 3 PM; shared pizza work without salad bar or Rudd’s Catch floors');
 const papaMake=papa.station('Pizza Make'),papaRef=confirmedDutiesForLocation('papa').find(r=>r.id==='pizza-make-close');
 const pGuide=papa.guide('Fictional Papa pizza guide','Pizza Make',['Pizza table clean'],[...papaRef.service,...papaRef.closing]);
 const s5=papa.shift(5,papaMake);papa.clock(s5.data.start);
 assert.equal(new Date(s5.data.start).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric'}),'3 PM');
 assert.equal(guidesForShift(publicWorkspace({...papa.w,me:papa.worker}),s5)[0].id,pGuide.id);
 assert.ok(!confirmedDutiesForLocation('papa').some(r=>['oven-berts','catch-rudds'].includes(r.id)));
 record(d5,'Papa shift and location instructions','3 PM shift, shared flexible pizza, no Bert’s oven extras or Rudd’s Catch floors',{localStart:'3 PM',station:s5.data.stationName,foreignDutyCount:0},'app/shared/starter-tasks.ts:37');
 assert.match(confirmedDutiesForLocation('papa').find(r=>r.id==='counter-papa').closing.join(' '),/one-shift restaurant and has no salad bar/);
 record(d5,'Opening time instruction','Worker can recover 3 PM opening from current instruction reference','Papa one-shift/no-salad-bar is present; 3 PM opening time is absent from confirmed catalog','app/shared/starter-tasks.ts:50','gap','source-only');

 const d6=day(6,'rudds','Earlier issue survives next shift; independent close check, changed checker access and correction');
 const s6=rudds.shift(6,make);rudds.clock(s6.data.start);
 assert.ok(rudds.view(rudds.worker).duties.some(i=>i.record.id===issue.id));
 record(d6,'Next-day unresolved issue carryover','Old issue remains visible alongside current pizza shift',{currentShift:rudds.view(rudds.worker).shift.id,oldIssueVisible:true,oldIssuePhase:issue.data.phase},'app/shared/my-work.ts:23');
 let close=rudds.run(rudds.owner,'close.assign',{shiftId:s6.id,standardId:cookGuide.id,managerId:rudds.owner.id,due:s6.data.end});
 assert.throws(()=>rudds.run(rudds.worker,'close.transition',{step:'ready',answers:[],note:'Fictional incomplete table'},close),/every required condition/);
 assert.throws(()=>rudds.run(rudds.owner,'shift.release',{note:'Fictional early attempt'},s6),/every assigned close/);
 close=rudds.run(rudds.worker,'close.transition',{step:'ready',answers:[0],note:'Fictional table ready for physical check'},close);
 assert.throws(()=>rudds.run(rudds.worker,'close.transition',{step:'confirm',note:'Fictional self-check'},close),/independent closing manager/);
 const revoked={...rudds.owner,capabilities:[]};assert.throws(()=>rudds.run(revoked,'close.transition',{step:'confirm',note:'Fictional removed authority'},close));
 close=rudds.run(rudds.owner,'close.transition',{step:'fix',note:'Fictional crumb found under pizza table'},close);
 close=rudds.run(rudds.worker,'close.transition',{step:'ready',answers:[0],note:'Fictional correction cleaned and ready'},close);
 close=rudds.run(rudds.owner,'close.transition',{step:'confirm',note:'Fictional manager physically checked'},close);
 assert.equal(close.data.phase,'closed');
 const checkout=rudds.run(rudds.owner,'shift.release',{note:'Fictional final checkout complete'},s6);assert.ok(checkout.data.releasedAt);
 record(d6,'Manager check, correction and checkout','Incomplete answers/early release/self-check/revoked checker blocked; correction and manager confirmation then release',{blockedAttempts:4,closed:close.data.phase,released:true},'app/shared/domain.ts:1056');
 let stationNow=rudds.w.records.find(r=>r.id===make.id);
 rudds.run(rudds.owner,'station.save',{...stationNow.data,area:'BOH',note:'Fictional scheduling restriction changed',setup:{...stationNow.data.setup,allJobMembers:false,memberIds:[rudds.catcher.id]}},stationNow);
 assert.throws(()=>rudds.shift(7,make),/scheduling list/);
 record(d6,'Changed station access','Future Pizza Make shift honors changed station membership','Previously scheduled worker blocked from new restricted station assignment','app/shared/station-assignment.ts:16');

 const d7=day(7,'rudds','Reload durable records and test removed account, current permissions and foreign restaurant access');
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fictional")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const f of [rudds,berts,papa]){
  await db.prepare('INSERT INTO locations(id,name,timezone,revision) VALUES(?,?,?,?)').bind(f.w.location.id,f.w.location.name,'America/New_York',1).run();
  for(const m of f.w.members)await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(m.id,m.id+'@example.test',m.id,m.locationId,m.name,m.area,m.position,JSON.stringify(m.capabilities),JSON.stringify(m.qualifications),JSON.stringify(m.scheduleJobs)).run();
  for(const r of f.w.records)await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt).run();
 }
 const headers=id=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.test',Origin:'https://fictional.example','Content-Type':'application/json'});
 const get=async(id,loc='rudds')=>handleWorkspace(new Request('https://fictional.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);
 let response=await get(rudds.worker.id);assert.equal(response.status,200);const reload=await response.json();assert.ok(reload.records.some(r=>r.id===issue.id));assert.ok(reload.records.every(r=>r.locationId==='rudds'));
 record(d7,'Durable reload and restaurant scope','Unresolved issue survives reload and foreign restaurant records stay out',{status:200,issueVisible:true,onlyRuddsRecords:true},'app/shared/service.ts:38');
 response=await get(rudds.worker.id,'berts');assert.equal(response.status,403);
 record(d7,'Wrong restaurant access','Pizza worker without Bert’s membership cannot read Bert’s',{status:response.status},'app/shared/service.ts:49');
 await db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id=?").bind(rudds.owner.id).run();
 response=await handleWorkspace(new Request('https://fictional.example/api/workspace',{method:'POST',headers:headers(rudds.owner.id),body:JSON.stringify({locationId:'rudds',requestId:'fictional-revoked-assignment',action:'task.create',input:{ownerId:rudds.worker.id,kind:'task',title:'Fictional revoked attempt',detail:'Must not save',due:'2026-10-14T23:00:00Z'}})}),db);
 assert.equal(response.status,403);record(d7,'Changed authority on fresh request','Removing current manager capability blocks later assignment',{status:response.status},'app/shared/service.ts:100');
 await db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind(rudds.worker.id).run();response=await get(rudds.worker.id);assert.equal(response.status,403);
 record(d7,'Removed employee access','Inactive employee cannot continue reading the workspace',{status:response.status},'app/shared/service.ts:49');
 assert.equal((await db.prepare('SELECT data FROM records WHERE id=?').bind(issue.id).first()).data.includes('Locate clean replacement'),true);
 record(d7,'Removal preserves unresolved work','Removing account access keeps manager follow-up evidence','Issue remains stored; access removal does not erase work','app/shared/service.ts:43');
 refreshSourceLines();fs.mkdirSync('evidence/week-simulation',{recursive:true});fs.writeFileSync('evidence/week-simulation/pizza.json',JSON.stringify({...evidence,result:'completed',executableAssertions:'passed'},null,2)+'\n');
});
