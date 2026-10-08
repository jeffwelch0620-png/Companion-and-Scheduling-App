import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runPositionWeek,openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {carriedIssues,previousShift} from '../.sites-runtime/shared/operations.mjs';
import {localDate} from '../.sites-runtime/shared/local-time.mjs';

const output='evidence/hour-trial/rudds';
fs.mkdirSync(output,{recursive:true});
const profiles=JSON.parse(fs.readFileSync('evidence/all-position-week/rudds-profiles.json','utf8'));
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const response=async(r,expected=200)=>{const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;};

test('Rudd’s all 15 positions: extended communication, handoff, retry, checkout and hierarchy trials',async()=>{
 const results=[];
 for(const original of profiles){
  const profile=structuredClone(original),newChecks=[];
  for(const [index,scenario] of profile.dailyScenarios.entries())scenario.run=async({command,view,request,store,find,day})=>{
   const raw=async(actor,action,input,record,status,requestId=crypto.randomUUID(),location='rudds')=>response(await handleWorkspace(request('workspace',actor,{locationId:location,requestId,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})},location),store().db),status);
   const snapshot=()=>JSON.stringify(store().sqlite.prepare('SELECT * FROM records ORDER BY rowid').all());
   const mark=detail=>newChecks.push({day:day.day,detail,status:'passed'});
   if(index===0){
    let message=await command('worker','message.send',{recipients:['manager'],title:'Named manager acknowledgment required',body:scenario.detail});
    message=await command('manager','message.reply',{text:'I received the reported issue. Keep it open until its assigned correction is independently checked.'},message);
    assert.equal(find(message.recordId).data.replies[0].actorId,'manager');
    assert.ok((await view('worker')).records.some(r=>r.id===message.recordId));
    assert.ok(!(await view('incoming')).records.some(r=>r.id===message.recordId));
    mark('Actual manager reply is saved and visible only to participants, not an unrelated coworker.');
   }else if(index===1){
    let task=await command('manager','task.create',{ownerId:'worker',title:'Concurrent correction review',detail:'Check this saved assignment revision before acting.',kind:'task',due:new Date(Date.now()+3600000).toISOString()});
    const old=task;task=await command('worker','task.transition',{step:'ready',note:'Reported first attempt.'},task);
    const before=snapshot();await raw('worker','task.transition',{step:'ready',note:'Old phone still has the prior revision.'},old,409);assert.equal(snapshot(),before);
    await command('manager','task.transition',{step:'verify',note:'Independent current revision checked.'},task);
    mark('Stale phone correction is rejected without overwriting the current ready state.');
   }else if(index===2){
    const notice=await command('worker','message.send',{recipients:['manager'],title:'Read receipt does not verify work',body:'Acknowledgment is distinct from correction, check and release.'});
    const beforeRecords=(await view('worker')).records.filter(r=>r.kind==='task'||r.kind==='close').map(r=>[r.id,r.revision,r.data.phase]);
    const requestId='read-idempotent-'+profile.id;
    const first=await raw('manager','message.read',{},notice,200,requestId);const duplicate=await raw('manager','message.read',{},notice,200,requestId);assert.deepEqual(duplicate,first);
    assert.deepEqual((await view('worker')).records.filter(r=>r.kind==='task'||r.kind==='close').map(r=>[r.id,r.revision,r.data.phase]),beforeRecords);
    mark('Read receipt retries are idempotent and do not complete tasks or closing.');
   }else if(index===3){
    let task=await command('manager','task.create',{ownerId:'worker',title:'Remaining same-department work',detail:'Named owner takes responsibility; no closed work is transferred.',kind:'task',due:new Date(Date.now()+3600000).toISOString()});
    task=await command('manager','task.reassign',{ownerId:'incoming',note:'Incoming qualified employee receives the remaining work.'},task);
    const before=snapshot();await raw('worker','task.transition',{step:'ready',note:'Outgoing employee may not finish someone else’s work.'},task,profile.capabilities?.includes('tasks.manage')?403:404);assert.equal(snapshot(),before);
    task=await command('incoming','task.transition',{step:'ready',note:'Incoming employee reports work complete.'},task);await command('manager','task.transition',{step:'verify',note:'Independent correction check.'},task);
    mark('Reassignment changes ownership; outgoing employee cannot submit the incoming employee’s work.');
   }else if(index===4){
    const before=snapshot();await raw('worker','message.send',{recipients:['outsider'],title:'Attempted foreign restaurant message',body:'No other restaurant participant may be added.'},undefined,403,crypto.randomUUID(),'berts');assert.equal(snapshot(),before);
    mark('Cross-restaurant message mutation is denied, leaving saved work unchanged.');
   }else if(index===5){
    const shift=(await view('worker')).records.find(r=>r.kind==='shift'&&r.ownerId==='worker'&&r.data.published&&!r.data.cancelled&&!r.data.releasedAt);assert.ok(shift);
    let pending=await command('manager','task.create',{ownerId:'worker',shiftId:shift.id,title:'Required checkout dependency',detail:'Keep this task linked to the shift until independently verified.',kind:'task',due:new Date(day.dayStart+7*3600000).toISOString()});
    const before=snapshot();await raw('manager','shift.release',{note:'Cannot release while linked work is pending.'},shift,400);assert.equal(snapshot(),before);
    pending=await command('worker','task.transition',{step:'ready',note:'Assigned work ready for the manager.'},pending);await raw('manager','shift.release',{note:'Readiness still is not a passed check.'},shift,400);
    await command('manager','task.transition',{step:'verify',note:'Independent linked-task check.'},pending);
    mark('Open and ready linked checkout tasks both block operational release until independently verified.');
   }else{
    const before=snapshot(),opposite=profile.area==='FOH'?'BOH':'FOH';
    await raw('worker','managerlog.create',{ownerId:'manager',department:opposite,title:'Unauthorized department escalation',detail:'Ordinary job titles must not widen management authority.',category:'Other',priority:'routine',due:new Date(Date.now()+3600000).toISOString()},undefined,403);assert.equal(snapshot(),before);
    mark('Employee and department-manager identities cannot create manager work in the other department.');
   }
  };
  const result=await runPositionWeek(profile);result.additionalChecks=newChecks;results.push(result);
  save(profile.id+'.json',result);
  console.log(JSON.stringify({profileId:profile.id,days:result.days.length,newChecks:newChecks.length,failures:result.failures.length}));
 }
 save('all-positions-summary.json',{profiles:results.length,positionDays:results.reduce((n,r)=>n+r.days.length,0),additionalChecks:results.reduce((n,r)=>n+r.additionalChecks.length,0),failures:results.flatMap(r=>r.failures.map(f=>({id:r.id,...f}))),limits:['Actual local handlers with durable fictional data and mocked AI context only.','No external AI request, Toast order update, real staff deployment or physical kitchen inspection is performed.','Source-specific missing oil, equipment and recipe methods remain flagged; they are not invented to make a test pass.']});
 assert.deepEqual(results.flatMap(r=>r.failures.map(f=>({id:r.id,...f}))),[]);
 assert.equal(results.reduce((n,r)=>n+r.additionalChecks.length,0),105);
});

test('Rudd’s integrated shift: cross-position communication, department hierarchy, recook versus order issue and next-day carryover',async()=>{
 const file=path.join(output,'integrated-shift-'+Date.now()+'.sqlite');
 // A fresh isolated fixture per run preserves all earlier databases and receipts.
 let store=openPositionDatabase(file);const checks=[];const at=Date.now(),start=new Date(at+60000).toISOString(),end=new Date(at+8*3600000).toISOString();
 const RealDate=Date;
 const actor=id=>({id:id.replace(/^rudds-/,''),profile:profiles.find(p=>p.id===id)});
 const actors=profiles.map(p=>({id:p.id.replace(/^rudds-/,''),profile:p}));
 const request=(who,body,loc='rudds')=>new Request('https://hour-rudds.example/api/workspace?locationId='+loc,{headers:{'oai-authenticated-user-id':who+'-hour-identity','oai-authenticated-user-email':who+'@example.test',Origin:'https://hour-rudds.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const command=(who,action,input={},record,status=200)=>handleWorkspace(request(who,{locationId:'rudds',requestId:crypto.randomUUID(),action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})}),store.db).then(r=>response(r,status));
 const view=who=>handleWorkspace(request(who),store.db).then(r=>response(r));
 const find=id=>{const row=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return row&&{...row,id:row.id,ownerId:row.owner_id,data:JSON.parse(row.data)};};
 const mark=detail=>checks.push({detail,status:'passed'});
 const message=async(from,to,title,body)=>{let m=await command(from,'message.send',{recipients:to,title,body});for(const target of to)assert.ok((await view(target)).records.some(r=>r.id===m.recordId));return m;};
 const snapshot=()=>JSON.stringify(store.sqlite.prepare('SELECT * FROM records ORDER BY rowid').all());
 try{
  for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
  for(const id of ['rudds','berts','papa'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(id,'Fictional '+id,'America/New_York');
  for(const {id,profile} of [...actors,{id:'gm',profile:{area:'BOH',position:'General manager',capabilities:['location.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','close.confirm','standards.approve','people.manage']}}])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(id,id+'@example.test',id+'-hour-identity','rudds','Fictional '+id,profile.area,profile.position,JSON.stringify(profile.capabilities??[]),JSON.stringify([profile.position]));
  const shifts={};
  for(const {id,profile} of actors){let s=await command('gm','shift.save',{personId:id,position:profile.position,start,end});s=await command('gm','shift.publish',{},s);shifts[id]=s;assert.ok((await view(id)).records.some(r=>r.id===s.recordId));}
  mark('All 15 role/shift profiles receive their actual published shift, including distinct Dish AM/PM identities.');
  const leadershipEnd=new Date(at+9*3600000).toISOString();
  const fohLead=await command('gm','leadership.assign',{personId:'foh-manager',area:'FOH',start,end:leadershipEnd,note:'Named FOH on-duty leader for this fictional shift.'});
  const bohLead=await command('gm','leadership.assign',{personId:'boh-manager',area:'BOH',start,end:leadershipEnd,note:'Named BOH on-duty leader for this fictional shift.'});
  assert.ok((await view('server')).records.some(r=>r.id===fohLead.recordId));assert.ok(!(await view('server')).records.some(r=>r.id===bohLead.recordId));
  assert.ok((await view('pizza-make')).records.some(r=>r.id===bohLead.recordId));assert.ok(!(await view('pizza-make')).records.some(r=>r.id===fohLead.recordId));
  mark('Published workers can see their explicitly assigned department leader; a job title alone is not the reporting chain or access grant.');
  let hostNotice=await message('host',['foh-manager'],'Seating pace backup','Next server in the written rotation is overloaded; manager direction requested.');hostNotice=await command('foh-manager','message.reply',{text:'Pause seating that section until I review coverage; retain the steady pace.'},hostNotice);assert.equal(find(hostNotice.recordId).data.replies[0].actorId,'foh-manager');
  mark('Host reports overload; FOH Manager gives saved direction without changing Host permissions.');
  const ready=await message('busser',['host'],'Table reset ready','Tabletop and retained table items cleaned, seats wiped and chairs restored under the current layout.');await command('host','message.read',{},ready);assert.ok(find(ready.recordId).data.readBy.includes('host'));assert.ok(!(await view('server')).records.some(r=>r.id===ready.recordId));
  mark('Busser-to-Host table-ready message is acknowledged; another employee cannot read the private exchange.');
  let cooking=await message('server',['expo'],'Cooking error at guest table','The pizza delivered is incorrect; correction must go through Expo to the kitchen.');cooking=await command('expo','message.reply',{text:'Cooking error: request recook/remake and communicate expected return to the server.'},cooking);
  const makeNotice=await message('expo',['pizza-make','boh-manager'],'Recook needed','Cooking error requires a corrected pizza; coordinate with Catch and return through Expo.');
  let recook=await command('boh-manager','task.create',{ownerId:'pizza-make',title:'Named recook follow-through',detail:'Correct the reported cooking error using the approved ticket/build instructions; kitchen check before the return through Expo.',kind:'issue',due:end});
  const beforeWrongChecker=snapshot();await command('foh-manager','task.transition',{step:'verify',note:'FOH title must not verify BOH work.'},recook,404);assert.equal(snapshot(),beforeWrongChecker);
  recook=await command('pizza-make','task.transition',{step:'ready',note:'Corrected cooking work reported ready.'},recook);await command('pizza-make','task.transition',{step:'verify',note:'Cannot self-check.'},recook,403);recook=await command('boh-manager','task.transition',{step:'verify',note:'Independent kitchen verification in this fictional shift.'},recook);
  await message('pizza-catch',['expo'],'Corrected pizza handoff','Checked ticket, cut, garnished and boxed/plated; actual kitchen issue check remains distinct from this message.');await message('expo',['food-runner','server'],'Correction ready for return','Coordinate the corrected item and let the responsible server follow through with the guest.');
  mark('Cooking-error sequence spans Server → Expo → Pizza Make/BOH Manager → Catch → Expo → Runner/Server; only the correct department manager verifies assigned kitchen work.');
  let ordering=await message('expo',['foh-manager'],'Ordering error requires FOH decision','The ticket detail is incorrect; kitchen remake alone does not decide the ordering issue.');ordering=await command('foh-manager','message.reply',{text:'I will resolve the guest/ticket ordering issue; keep the unresolved issue visible until checked.'},ordering);await message('foh-manager',['server','expo'],'Ordering correction direction','Named FOH manager owns the ordering issue; communicate the approved correction to the guest and Expo.');
  mark('Ordering error routes to FOH Manager rather than silently becoming a kitchen recook decision.');
  let staffing=await message('foh-manager',['boh-manager'],'Coordinate slowdown staffing','Support roles first when duties are covered; keep servers normally last and align BOH cuts with remaining tickets.');staffing=await command('boh-manager','message.reply',{text:'Kitchen still has tickets; I will coordinate covered BOH cuts when appropriate.'},staffing);await message('foh-manager',['host','server'],'Stop new tables for cut section','Host: no more new tables in this server section; Server: finish existing tables, side work and bank check.');
  await command('server','shift.cancel',{note:'Server cannot self-cut the published shift.'},shifts.server,403);
  const support=await command('gm','shift.cancel',{note:'Covered support staffing adjusted by the authorized scheduler.'},shifts.busser);assert.ok(find(support.recordId).data.cancelled);assert.equal(find(shifts.server.recordId).data.cancelled,false);
  mark('FOH/BOH discuss coverage, Host/Server receive cut instructions, employee self-cancellation is denied, and an authorized support shift change is saved without cutting the server automatically.');
  let handoff=await command('boh-manager','task.create',{ownerId:'pizza-make',incomingId:'pizza-catch',kind:'handoff',title:'Unfinished supplies and station condition',detail:'Outgoing employee reports actual remaining station issue for the incoming qualified same-department employee.',due:end});handoff=await command('pizza-make','task.transition',{step:'ready',note:'Condition reported for inspection.'},handoff);handoff=await command('boh-manager','task.transition',{step:'verify',note:'Manager verifies reported condition, not final remedy.'},handoff);assert.equal(find(handoff.recordId).data.phase,'acceptance');handoff=await command('pizza-catch','task.transition',{step:'dispute',note:'Incoming person identifies missed stock.'},handoff);assert.equal(find(handoff.recordId).data.phase,'correction');handoff=await command('pizza-make','task.transition',{step:'ready',note:'Missed stock correction reported.'},handoff);handoff=await command('boh-manager','task.transition',{step:'verify',note:'Reported condition rechecked.'},handoff);handoff=await command('pizza-catch','task.transition',{step:'accept',note:'Incoming station condition accepted.'},handoff);assert.equal(find(handoff.recordId).data.phase,'closed');
  mark('Incoming employee can dispute a verified handoff; correction requires a fresh readiness/check before acceptance.');
  let pending=await command('foh-manager','task.create',{ownerId:'server',shiftId:shifts.server.recordId,title:'Server required close and bank review',detail:'Fictional manager must verify completed side work; this record does not perform POS bank settlement.',kind:'task',due:end});await command('foh-manager','shift.release',{note:'Cannot release with checkout task open.'},shifts.server,400);pending=await command('server','task.transition',{step:'ready',note:'Side work reported ready.'},pending);await command('foh-manager','shift.release',{note:'Cannot release with only reported readiness.'},shifts.server,400);pending=await command('foh-manager','task.transition',{step:'fix',note:'Physical checker reports missed silverware bagging in simulation.'},pending);pending=await command('server','task.transition',{step:'ready',note:'Silverware correction reported.'},pending);await command('foh-manager','task.transition',{step:'verify',note:'Independent required-task check complete.'},pending);const released=await command('foh-manager','shift.release',{note:'Operational checkout confirmed by assigned FOH leader; this does not clock out payroll.'},shifts.server);assert.ok(find(released.recordId).data.releasedAt);
  mark('Closing readiness and failed check both prevent server release; independent remedy/check is required before the authorized release.');
  let carry=await command('boh-manager','managerlog.create',{ownerId:'boh-manager',department:'BOH',title:'Unresolved shortage for next opening',detail:'Persist the named owner and next-day stock/prep action.',category:'Food and prep',priority:'routine',due:new Date(at+86400000).toISOString()});
  carry=await command('boh-manager','managerlog.reassign',{ownerId:'gm',note:'BOH Manager is absent at next opening; GM accepts ultimate responsibility and may delegate the actual checks.',due:new Date(at+86400000).toISOString()},carry);
  const beforeFormerOwner=snapshot();await command('boh-manager','managerlog.resolve',{note:'Former owner may not mark the new GM-owned issue resolved.'},carry,403);assert.equal(snapshot(),beforeFormerOwner);
  carry=await command('gm','managerlog.accept',{note:'GM accepts the named pending shortage and next-opening checks.'},carry);assert.equal(find(carry.recordId).ownerId,'gm');
  mark('Manager absence transfers unresolved responsibility to GM; the former assigned manager cannot falsely resolve the new owner’s issue.');
  let summary=await command('boh-manager','shiftentry.save',{department:'BOH',businessDate:new Date().toISOString().slice(0,10),shift:'closing',readiness:'action-needed',summary:'Kitchen issue still unresolved after simulated close.',tomorrowNote:'Opening manager checks the saved shortage and assigns actual prep.',issueIds:[carry.recordId]});summary=await command('boh-manager','shiftentry.submit',{},summary);
  const saved=snapshot();store.close();store=openPositionDatabase(file);assert.equal(snapshot(),saved);assert.equal(find(carry.recordId).data.status,'accepted');assert.equal(find(carry.recordId).ownerId,'gm');assert.equal(find(summary.recordId).data.status,'submitted');assert.ok((await view('gm')).records.some(r=>r.id===carry.recordId));assert.ok((await view('server')).records.every(r=>r.id!==carry.recordId));
  mark('Full database reopen preserves submitted closing report and unresolved manager-owned shortage while ordinary Server cannot read BOH manager records.');
  const nextOpening=at+86400000;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[nextOpening]));}static now(){return nextOpening;}};
  const nextBusinessDate=localDate(new Date().toISOString(),'America/New_York');
  const openingWorkspace=await view('gm');
  assert.ok(carriedIssues(openingWorkspace,nextBusinessDate,'BOH').some(r=>r.id===carry.recordId));
  assert.equal(previousShift(openingWorkspace,nextBusinessDate,'BOH')?.id,summary.recordId);
  let opening=await command('boh-manager','shiftentry.save',{department:'BOH',businessDate:nextBusinessDate,shift:'opening',readiness:'action-needed',summary:'GM-owned prior closing shortage remains unresolved at next opening.',tomorrowNote:'Use the prior closing summary and named GM owner; no fresh-day reset.',issueIds:[carry.recordId]});
  opening=await command('boh-manager','shiftentry.submit',{},opening);assert.equal(find(opening.recordId).data.businessDate,nextBusinessDate);assert.equal(find(carry.recordId).data.status,'accepted');
  mark('Next business day uses actual opening-summary handler and previousShift/carriedIssues projections; yesterday’s GM-owned shortage is retained rather than reset.');
  for(const id of ['server','host','expo','boh-manager','foh-manager','gm'])assert.equal((await handleWorkspace(request(id,undefined,'berts'),store.db)).status,403);
  mark('Employee, department-manager and GM titles remain Rudd’s-only; titles do not grant Bert’s access.');
  const result={status:'passed',checks,profileCount:actors.length,source:'Current owner-confirmed role profiles, fictional QA fixture',database:file,databaseRetained:true,operationalReseeds:0,limits:['Cross-role messages are real app inbox records, not guest notifications, Toast tickets or live kitchen dispatch.','No real recook, guest delivery, payment or server-bank settlement is performed.','Stop seating instructions are messages; there is no verified live Toast seating rotation bridge.','This test uses actual manager authority and ownership guards; it does not infer permission from job titles.']};save('integrated-shift-results.json',result);save('integrated-shift-'+Date.now()+'.json',result);
 }catch(error){const result={status:'failed',checks,error:String(error.stack??error),database:file};save('integrated-shift-results.json',result);save('integrated-shift-'+Date.now()+'.json',result);throw error;}finally{globalThis.Date=RealDate;store.close();}
});
