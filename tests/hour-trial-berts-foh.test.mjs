import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';

// Deliberately supplement the previous seven-day trials: delayed acceptance,
// rejected incoming receipt, original-shift release, cross-midnight correction,
// stale contextual staff communications, and revocation during an AI answer.
// No operating records are reseeded. Injected membership suspensions and a
// failed-save trigger are adversarial events, not operational work mutations.
const profiles=JSON.parse(fs.readFileSync('evidence/all-position-week/berts-foh-profiles.json','utf8'));
const NativeDate=Date;
// Keep subsequent combined runs from overwriting this run's receipts.
const outputDir='evidence/hour-trial/berts-foh/'+(process.env.JMAX_HOUR_FOH_RUN_ID??'run-'+new NativeDate().toISOString().replaceAll(':','-').replaceAll('.','-'));
fs.mkdirSync(outputDir,{recursive:true});

function fixture(t,profile){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-hour-foh-')),file=path.join(directory,'durable.sqlite');let store=openPositionDatabase(file),now=NativeDate.parse('2026-10-08T12:00:00-04:00');
 globalThis.Date=class extends NativeDate{constructor(...values){super(...(values.length?values:[now]));}static now(){return now;}};
 t.after(()=>{globalThis.Date=NativeDate;store.close();fs.rmSync(directory,{recursive:true,force:true});});
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds','papa'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'FICTIONAL '+loc,'America/New_York');
 for(const [actor,loc,role,capabilities]of [['worker','berts',profile.position,profile.capabilities??[]],['incoming','berts',profile.position,profile.incomingCapabilities??[]],['manager','berts','General manager',['location.manage','tasks.manage','close.confirm','standards.approve','schedule.manage','schedule.publish','schedule.change']],['peer','berts','Server',[]],['foreign','rudds','Server',[]]])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(actor,actor+'@example.test',actor+'-identity',loc,'FICTIONAL '+actor,'FOH',role,JSON.stringify(capabilities),JSON.stringify([profile.position]));
 const request=(actor,body,loc='berts')=>new Request('https://hour-foh.example/api/workspace?locationId='+loc,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://hour-foh.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const call=async(actor,action,input={},record,requestId=crypto.randomUUID(),loc='berts')=>{const r=await handleWorkspace(request(actor,action?{locationId:loc,requestId,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})}:undefined,loc),store.db);return {status:r.status,data:await r.json()};};
 const ok=async response=>{const r=await response;assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const command=(...values)=>ok(call(...values)),view=actor=>command(actor);
 const saved=record=>{const r=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(record.recordId??record.id??record);return r&&{...r,ownerId:r.owner_id,data:JSON.parse(r.data)};};
 const snapshot=()=>JSON.stringify(Object.fromEntries(['locations','records','command_receipts','audit_events'].map(table=>[table,store.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
 const reopen=()=>{const before=snapshot();store.close();store=openPositionDatabase(file);assert.equal(snapshot(),before);};
 const evidence={id:profile.id,position:profile.position,restaurant:'berts',execution:'Actual authenticated workspace/chat handlers; fictional records; durable local SQLite; mock AI provider.',provenance:profile.provenance,days:[],checks:[],failures:[],limits:['No external AI, Toast or Jeff requests. Mock AI checks context and transaction boundaries, not generated-answer quality.','Recorded actions do not prove physical cleaning, actual guest service, POS order accuracy, bank settlement or real arrival time.','Incoming lateness is explicitly reported in an Inbox message; no attendance telemetry is inferred.','No shared approved-equipment-learning or automatic AI shift debrief feature exists in this trial.','Expo opening remains a supplemental QA starter draft; exact recovered server section sheet is not embedded in the profile.']};
 const verify=async(day,label,fn)=>{try{await fn();evidence.checks.push({day,label,status:'passed'});}catch(error){evidence.failures.push({day,label,error:String(error.stack??error)});throw error;}};
 const deny=async(day,label,fn,status)=>verify(day,label,async()=>{const before=snapshot(),r=await fn();assert.equal(r.status,status,JSON.stringify(r.data));assert.equal(snapshot(),before,'Rejected request must not mutate operations');});
 const chatRequest=(actor,body)=>new Request('https://hour-foh.example/api/companion?locationId=berts',{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://hour-foh.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 return {file,command,call,view,saved,reopen,snapshot,request,evidence,verify,deny,chatRequest,get store(){return store;},get now(){return now;},time(value){now=typeof value==='number'?value:NativeDate.parse(value);}};
}

for(const profile of profiles)test(`${profile.position}: seven durable delayed handoffs, midnight corrections and communications`,async t=>{
 const f=fixture(t,profile),e=f.evidence;t.after(()=>fs.writeFileSync(`${outputDir}/${profile.id}.json`,JSON.stringify(e,null,2)+'\n'));
 let standard=await f.command('manager','standard.save',{title:profile.position+' close-to-open reference',position:profile.position,zone:'FOH '+profile.position,criteria:profile.closing,source:'Fictional QA approval using '+JSON.stringify(profile.provenance),version:1,verification:'manager',guide:{purpose:'Exercise documented role duties',preparation:profile.opening,steps:profile.closing,troubleshooting:['Keep incomplete work open and request the named manager review'],escalation:'Named closing manager'}});
 standard=await f.command('manager','standard.approve',{validated:true,note:'Fictional QA approval only'},standard);let pendingShift;
 for(let day=1;day<=7;day++){
  const dayStart=NativeDate.parse('2026-10-'+String(day+7).padStart(2,'0')+'T12:00:00-04:00'),end=new NativeDate(dayStart+10*3600000).toISOString();f.time(dayStart);
  e.days.push({day,scenario:day%2?'Incoming employee reports late arrival; acceptance delayed until next opening':'Incoming employee disputes handoff before corrected resubmission',documentedDutyCoverage:{opening:profile.opening,service:profile.service,closing:profile.closing}});
  let shift=pendingShift;if(!shift){shift=await f.command('manager','shift.save',{personId:'worker',position:profile.position,start:new Date(dayStart).toISOString(),end});shift=await f.command('manager','shift.publish',{},shift);}
  let opening=await f.command('manager','task.create',{ownerId:'worker',title:'Day '+day+' opening',detail:profile.opening.join('\n')||'QA Expo opening reference; operating approval not claimed',kind:'task',due:new Date(dayStart+3600000).toISOString()});
  await f.verify(day,'Opening report returned for correction then independently checked',async()=>{opening=await f.command('worker','task.transition',{step:'ready',note:'Fictional opening conditions reported'},opening);opening=await f.command('manager','task.transition',{step:'fix',note:'Initial report omitted a required supply; correct it'},opening);assert.equal(f.saved(opening).data.phase,'correction');opening=await f.command('worker','task.transition',{step:'ready',note:'Fictional missing opening condition corrected'},opening);});
  await f.deny(day,'Self verification cannot approve opening',()=>f.call('worker','task.transition',{step:'verify',note:'Cannot self verify'},opening),403);
  opening=await f.command('manager','task.transition',{step:'verify',note:'Fictional independent opening check'},opening);
  let close=await f.command('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',due:end});
  let handoff=await f.command('manager','task.create',{ownerId:'worker',incomingId:'incoming',kind:'handoff',shiftId:shift.recordId,title:'Day '+day+' remaining service work',detail:[profile.dailyScenarios[day-1].detail,profile.dailyScenarios[day-1].nextAction].join('\n'),due:end});
  await f.deny(day,'Incoming cannot accept unfinished unreviewed service work',()=>f.call('incoming','task.transition',{step:'accept',note:'Premature receipt'},handoff),403);
  handoff=await f.command('worker','task.transition',{step:'ready',note:'Saved handoff condition and next action are accurate'},handoff);handoff=await f.command('manager','task.transition',{step:'verify',note:'Fictional handoff report checked; recipient work remains'},handoff);
  await f.verify(day,'Late incoming staff message is saved, read and replied without changing handoff',async()=>{const before=f.saved(handoff).revision;let message=await f.command('incoming','message.send',{recipients:['worker','manager'],title:'Reported late arrival day '+day,body:'I am delayed. Handoff '+handoff.recordId+' remains unaccepted; manager please arrange interim coverage.'});message=await f.command('worker','message.read',{},message);message=await f.command('manager','message.reply',{text:'Acknowledged. Original responsibility remains until acceptance and actual completion.'},message);assert.ok(f.saved(message).data.replies.length);assert.equal(f.saved(handoff).revision,before);});
  if(day%2===0){handoff=await f.command('incoming','task.transition',{step:'dispute',note:'Required component missing; outgoing staff must correct report'},handoff);assert.equal(f.saved(handoff).data.phase,'correction');handoff=await f.command('worker','task.transition',{step:'ready',note:'Missing condition added to the handoff'},handoff);handoff=await f.command('manager','task.transition',{step:'verify',note:'Corrected handoff report independently reviewed'},handoff);}
  let contextMessage=await f.command('worker','message.send',{recipients:['manager'],title:'Closing condition needs review',body:'Please review my assigned close.',context:{recordId:close.recordId,revision:close.revision}});
  await f.deny(day,'Attachment does not grant unrelated colleague closing access',()=>f.call('worker','message.send',{recipients:['peer'],title:'Private assignment',body:'Forbidden attachment',context:{recordId:close.recordId,revision:close.revision}}),403);
  f.time(dayStart+11*3600000);close=await f.command('worker','close.transition',{step:'ready',answers:profile.closing.map((_,i)=>i),note:'Fictional full close submitted'},close);close=await f.command('manager','close.transition',{step:'fix',note:'One documented closing condition remains incomplete',...(day===6?{managerAttention:'repeated'}:{})},close);
  await f.verify(day,'Saved attachment becomes changed when current closing condition changes',async()=>{const message=(await f.view('manager')).records.find(r=>r.id===contextMessage.recordId);assert.equal(message.data.contextStatus,'changed');assert.equal(message.data.context.revision,1);});
  await f.deny(day,'Open close and pending incoming handoff block outgoing release',()=>f.call('manager','shift.release',{note:'Too early'},shift),400);
  f.time(dayStart+13*3600000);f.reopen();
  await f.verify(day,'Midnight keeps correction, pending receipt and manager responsibility after reopen',async()=>{const w=await f.view('worker');assert.equal(f.saved(close).data.phase,'correction');assert.equal(f.saved(handoff).data.phase,'acceptance');assert.equal(f.saved(handoff).ownerId,'worker');assert.equal(myWork(w,new Date().toISOString()).checkoutPending,true);assert.ok(myWork(w,new Date().toISOString()).duties.some(i=>i.record.id===close.recordId));});
  f.time(dayStart+24*3600000);let next=await f.command('manager','shift.save',{personId:'worker',position:profile.position,start:new Date().toISOString(),end:new Date(f.now+10*3600000).toISOString()});next=await f.command('manager','shift.publish',{},next);pendingShift=next;
  await f.verify(day,'Next current shift takes focus without hiding previous closing correction',async()=>{const work=myWork(await f.view('worker'),new Date().toISOString());assert.equal(work.shift.id,next.recordId);assert.ok(work.duties.some(i=>i.record.id===close.recordId));});
  if(day===3){
   f.store.sqlite.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='incoming'").run();
   await f.deny(day,'Suspended late recipient cannot receive responsibility',()=>f.call('incoming','task.transition',{step:'accept',note:'Access revoked'},handoff),403);
   await f.verify(day,'Failed acceptance preserves outgoing responsibility',async()=>{assert.equal(f.saved(handoff).ownerId,'worker');assert.equal(f.saved(handoff).data.phase,'acceptance');});
   f.store.sqlite.prepare("UPDATE memberships SET active=1,revision=revision+1 WHERE id='incoming'").run();
  }
  const original=handoff,acceptId=profile.id+'-receive-'+day;
  if(day===5){
   f.store.sqlite.exec("CREATE TRIGGER hour_fail_incoming_receipt BEFORE INSERT ON command_receipts WHEN NEW.request_id='hour-incoming-failed-save' BEGIN SELECT RAISE(ABORT,'fictional disk interruption'); END");
   await f.deny(day,'Failed incoming receipt rolls back transfer, messages, audit and receipt',()=>f.call('incoming','task.transition',{step:'accept',note:'Incoming explicitly receives the remaining work'},original,'hour-incoming-failed-save'),503);
   f.store.sqlite.exec('DROP TRIGGER hour_fail_incoming_receipt');f.reopen();
   handoff=await f.command('incoming','task.transition',{step:'accept',note:'Incoming explicitly receives the remaining work'},original,'hour-incoming-failed-save');
  }else handoff=await f.command('incoming','task.transition',{step:'accept',note:'Incoming explicitly receives the remaining work'},original,acceptId);
  f.reopen();
  await f.verify(day,'Receipt retry is safe and original shift link remains unresolved',async()=>{assert.deepEqual(await f.command('incoming','task.transition',{step:'accept',note:'Incoming explicitly receives the remaining work'},original,day===5?'hour-incoming-failed-save':acceptId),handoff);assert.equal(f.saved(handoff).data.phase,'open');assert.equal(f.saved(handoff).ownerId,'incoming');assert.equal(f.saved(handoff).data.shiftId,shift.recordId);});
  await f.deny(day,'Outgoing cannot submit work transferred to incoming',()=>f.call('worker','task.transition',{step:'ready',note:'Wrong current performer'},handoff),403);
  handoff=await f.command('incoming','task.transition',{step:'ready',note:'Fictional remaining work actually completed'},handoff);handoff=await f.command('manager','task.transition',{step:'verify',note:'Fictional independent completed-work review'},handoff);
  close=await f.command('worker','close.transition',{step:'ready',answers:profile.closing.map((_,i)=>i),note:'Prior close corrected and ready for another check'},close);
  if(day===6){
   await f.deny(day,'Repeated miss still needs manager acknowledgment after correction',()=>f.call('manager','close.transition',{step:'confirm',note:'Cannot bypass manager acknowledgment'},close),400);
   close=await f.command('manager','close.acknowledge',{note:'Manager addresses repeated miss and requires actual final check'},close);
   await f.verify(day,'Manager acknowledgment does not perform final physical confirmation',async()=>{assert.equal(f.saved(close).data.phase,'manager-confirmation');});
  }
  close=await f.command('manager','close.transition',{step:'confirm',note:'Fictional final check of every documented close condition'},close);
  shift=await f.command('manager','shift.release',{note:'Operational checkout after independent closing check and accepted-work completion; any actual bank settlement is external'},shift);
  if(day===7)next=await f.command('manager','shift.release',{note:'Fictional early end to final current QA shift; no assigned closing work'},next);
  await f.verify(day,'Prior shift is released separately; scheduled work times unchanged',async()=>{assert.ok(f.saved(shift).data.releasedAt);assert.equal(f.saved(shift).data.end,end);assert.equal(f.saved(handoff).data.phase,'closed');assert.equal(f.saved(close).data.phase,'closed');});
  for(const loc of ['rudds','papa'])await f.deny(day,'Staff cannot hop to '+loc,()=>f.call('worker',undefined,{},undefined,undefined,loc),403);
  if(day===7){
   await f.verify(day,'Suspension during mock AI answer rejects reply and never writes operational work',async()=>{
    let providerCalls=0;const currentResponse=await handleCompanionChat(f.chatRequest('worker'),f.store.db,{},undefined,()=>f.now,'workforce'),current=await currentResponse.json();assert.equal(currentResponse.status,200);
    const before=f.snapshot(),response=await handleCompanionChat(f.chatRequest('worker',{action:'ask',locationId:'berts',conversationId:current.conversationId,expectedRevision:current.revision,requestId:crypto.randomUUID(),question:'Explain the selected approved guide.',focus:{id:standard.recordId,revision:standard.revision}}),f.store.db,{OPENAI_API_KEY:'sk-fictional-hour-test'},async()=>{providerCalls++;f.store.sqlite.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'").run();return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Use the approved guide; no work saved.',sourceIds:[standard.recordId]})}]}]});},()=>f.now,'workforce');
    assert.equal(providerCalls,1);assert.notEqual(response.status,200);const after=f.snapshot();assert.equal(after,before,'Chat and access fault must not modify operational tables');assert.equal((await f.call('worker')).status,403);const history=await handleCompanionChat(f.chatRequest('worker'),f.store.db,{},undefined,()=>f.now,'workforce');assert.equal(history.status,403);
   });
  }
 }
 e.summary={roleDays:e.days.length,checks:e.checks.length,failures:e.failures.length,initialOperationalSeeds:1,operationalReseeds:0};assert.equal(e.failures.length,0);assert.equal(e.days.length,7);
});

test('FOH manager: seven overnight manager handoffs retain accountability through delayed arrival, dispute and actual resolution',async t=>{
 const profile={...profiles.find(p=>p.position==='FOH Manager'),id:'berts-foh-manager-overnight',incomingCapabilities:['tasks.manage','close.confirm','schedule.change']},f=fixture(t,profile),e=f.evidence;t.after(()=>fs.writeFileSync(`${outputDir}/${profile.id}.json`,JSON.stringify(e,null,2)+'\n'));
 for(let day=1;day<=7;day++){
  const base=NativeDate.parse('2026-10-'+String(day+7).padStart(2,'0')+'T18:00:00-04:00');f.time(base);
  const end=new Date(base+7*3600000).toISOString(),openingStart=new Date(base+18*3600000).toISOString();
  const outgoing=await f.command('manager','leadership.assign',{personId:'manager',area:'FOH',start:new Date(base).toISOString(),end,note:'Fictional assigned closing manager'}),incoming=await f.command('manager','leadership.assign',{personId:'incoming',area:'FOH',start:openingStart,end:new Date(base+28*3600000).toISOString(),note:'Fictional named next opening manager'});
  e.days.push({day,scenario:'Actual manager handoff, safely deferable incomplete shift issue; explicit receipt and resolution, not a private-chat feed'});
  const input={title:'Unfinished FOH follow-up day '+day,detail:'Owner-confirmed closing responsibility: leave unfinished Red Book work with a named next action. QA case: inspect a nonurgent supply issue at opening; no safety-critical repair instructions supplied.',outgoingLeadershipId:outgoing.recordId,incomingLeadershipId:incoming.recordId,incomingId:'incoming',safeToDefer:true,priority:'routine'};
  await f.deny(day,'Unsafe or unconfirmed deferral does not create a handoff',()=>f.call('manager','handoff.create',{...input,safeToDefer:false}),400);
  let handoff=await f.command('manager','handoff.create',input);
  await f.deny(day,'Only named incoming manager can accept',()=>f.call('worker','handoff.transition',{step:'accept',note:'Wrong recipient'},handoff),403);
  await f.deny(day,'Unaccepted offered handoff cannot be resolved by outgoing manager',()=>f.call('manager','handoff.transition',{step:'resolve',note:'Premature completion'},handoff),400);
  f.time(base+13*3600000);f.reopen();
  await f.verify(day,'Midnight and a late-arrival message do not erase outgoing accountability',async()=>{
   await f.command('incoming','message.send',{recipients:['manager'],title:'Opening delayed day '+day,body:'I am delayed; this message is acknowledgment only. Handoff '+handoff.recordId+' is still offered.'});
   assert.equal(f.saved(handoff).ownerId,'manager');assert.equal(f.saved(handoff).data.phase,'offered');assert.ok((await f.view('incoming')).records.some(r=>r.id===handoff.recordId));
  });
  f.time(base+19*3600000);
  handoff=await f.command('incoming','handoff.transition',{step:'dispute',note:'Need clearer remaining condition before receiving responsibility'},handoff);
  await f.verify(day,'Dispute retains outgoing ownership and is durable',async()=>{assert.equal(f.saved(handoff).ownerId,'manager');assert.equal(f.saved(handoff).data.phase,'disputed');f.reopen();assert.equal(f.saved(handoff).data.phase,'disputed');});
  handoff=await f.command('manager','handoff.transition',{step:'offer',note:'Clarified condition and next action; opening manager still named',incomingId:'incoming',incomingLeadershipId:incoming.recordId},handoff);
  const offered=handoff,rid='overnight-accept-'+day;handoff=await f.command('incoming','handoff.transition',{step:'accept',note:'Actual explicit receipt of unresolved work'},offered,rid);
  await f.verify(day,'Accepted responsibility is separate from resolution and retry is idempotent',async()=>{assert.equal(f.saved(handoff).ownerId,'incoming');assert.equal(f.saved(handoff).data.phase,'accepted');f.reopen();assert.deepEqual(await f.command('incoming','handoff.transition',{step:'accept',note:'Actual explicit receipt of unresolved work'},offered,rid),handoff);});
  await f.deny(day,'Outgoing manager cannot resolve after responsibility transfers',()=>f.call('manager','handoff.transition',{step:'resolve',note:'Wrong current owner'},handoff),403);
  handoff=await f.command('incoming','handoff.transition',{step:'resolve',note:'Fictional actual condition checked and remaining work finished; recorded outcome only'},handoff);
  await f.verify(day,'Resolution is retained after next reopen and does not publish a shared lesson',async()=>{f.reopen();assert.equal(f.saved(handoff).data.phase,'resolved');assert.ok(f.saved(handoff).data.history.some(h=>h.action==='resolve'));assert.equal(f.store.sqlite.prepare("SELECT COUNT(*) n FROM records WHERE kind='standard'").get().n,0);});
 }
 e.summary={managerHandoffDays:e.days.length,checks:e.checks.length,failures:e.failures.length,operationalReseeds:0};assert.equal(e.days.length,7);assert.deepEqual(e.failures,[]);
});
