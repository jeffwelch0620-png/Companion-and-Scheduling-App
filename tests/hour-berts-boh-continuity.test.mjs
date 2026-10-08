import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskTrial} from './ai-task-trial-fixture.mjs';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';

const profiles=JSON.parse(fs.readFileSync('evidence/all-position-week/berts-boh-profiles.json','utf8'));
const receipts=[];
const bindings={OPENAI_API_KEY:'sk-fictional-hour-only',JMAX_OPENAI_MODEL:'gpt-5.4-mini'};
const dayOf=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};

for(const profile of profiles)test(`${profile.id}: opening to delayed close, reassigned prep shortage and next-day recovery`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-hour-boh-')),file=path.join(dir,'durable.sqlite');
 const trial=await createTaskTrial(profile,{file,bindings,fetcher:async()=>{throw Error('This test only uses a local mock provider');}});
 let store=openPositionDatabase(file),now=Date.now();t.after(()=>{store.close();trial.close();fs.rmSync(dir,{recursive:true,force:true});});
 // Additional fictional staff and imported recipe are configured once, before
 // the sequence. Every subsequent operational change uses its actual handler.
 for(const actor of ['incoming','second','manager2'])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(actor,actor+'@example.test',actor+'-trial-identity','berts','Fictional '+actor,'BOH',actor==='manager2'?'General manager':profile.position,JSON.stringify(actor==='manager2'?['location.manage','tasks.manage','close.confirm','schedule.manage','schedule.publish']:[]),JSON.stringify([profile.position]));
 const recipe={title:'Fictional assigned prep',recipeType:'prep',sourceId:'hour-source',yieldQty:10,yieldUOM:'ready portion',procedure:'Fictional source-backed portion method; missing real methods remain missing.',equipment:'Fictional portion station',portionNote:'Whole ready portions',shelfLife:'Fictional reviewed source',lines:[],source:{sourceRestaurantId:'fictional-berts',dataset:'operating'}};
 store.sqlite.prepare('INSERT INTO food_state(location_id) VALUES(?)').run('berts');
 store.sqlite.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('hour-recipe','berts','foodrecipe','operating','fictional-berts','hour-source',recipe.title,'manager','BOH',1,JSON.stringify(recipe),new Date(now).toISOString());
 const req=(route,actor='worker',body,location='berts',query={})=>new Request('https://hour.example/api/'+route+'?'+new URLSearchParams({locationId:location,...query}),{headers:{'oai-authenticated-user-id':actor+'-trial-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://hour.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const invoke=async(handler,route,actor,body,location='berts')=>{const r=await handler(req(route,actor,body,location),store.db);return {status:r.status,data:await r.json()};};
 const command=(actor,action,input={},r,requestId=crypto.randomUUID())=>invoke(handleWorkspace,'workspace',actor,{locationId:'berts',requestId,action,input,...(r?{recordId:r.recordId??r.id,expectedRevision:r.revision}:{})});
 const food=(actor,action,input={},r,requestId=crypto.randomUUID())=>invoke(handleFoodWorkflows,'food/workflows',actor,{locationId:'berts',requestId,action,input:{dataset:'operating',...input},...(r?{recordId:r.recordId,expectedRevision:r.revision}:{})});
 const record=id=>{const r=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return {...r,id:r.id,revision:r.revision,ownerId:r.owner_id,data:JSON.parse(r.data)};};
 const plan=r=>JSON.parse(store.sqlite.prepare('SELECT data FROM food_workflows WHERE id=?').get(r.recordId).data);
 const state=()=>JSON.stringify(Object.fromEntries(['records','food_records','food_workflows','food_workflow_events','food_receipts','command_receipts','audit_events'].map(table=>[table,store.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 const reopen=()=>{const before=state();store.close();store=openPositionDatabase(file);assert.equal(state(),before);};
 const captures=[];
 const mock=async(_url,init)=>{const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));captures.push({input,context});assert.ok(!JSON.stringify(input).includes('FOREIGN_TRIAL_SECRET'));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Use the current attached work and its named responsible manager. Historical reports do not establish current stock or completed action. Chat has not saved production or released this shift.',sourceIds:context.evidence.map(e=>e.source.id).slice(0,20)})}]}]});};
 const chat=async(actor='worker',body,query={})=>{now+=10000;const r=await handleCompanionChat(req('companion',actor,body,'berts',query),store.db,bindings,mock,()=>now,'workforce');return {status:r.status,data:await r.json()};};
 const ask=async(actor,question,focus)=>{const c=ok(await chat(actor)),before=state();const result=ok(await chat(actor,{action:'ask',locationId:'berts',conversationId:c.conversationId,expectedRevision:c.revision,requestId:crypto.randomUUID(),question,...(focus?{focus:{id:focus.recordId??focus.id,revision:focus.revision}}:{})}));assert.equal(state(),before);assert.ok(result.turns.at(-1).answer);return result;};
 const due=new Date(now+7*3600000).toISOString();
 let shift=ok(await command('manager','shift.save',{personId:'worker',position:profile.position,start:new Date(now-3600000).toISOString(),end:new Date(now+8*3600000).toISOString()}));shift=ok(await command('manager','shift.publish',{},shift));
 let opening=ok(await command('manager','task.create',{ownerId:'worker',title:'Inherited opening readiness',detail:profile.opening.join('\n'),kind:'task',due}));
 await ask('worker','Walk me through my approved opening instructions without treating them as completed work.',trial.guide);
 opening=ok(await command('worker','task.transition',{step:'ready',note:'Fictional opening submission'},opening));opening=ok(await command('manager','task.transition',{step:'verify',note:'Fictional independent opening check'},opening));
 // Begin with a draft and prove staff cannot use it before manager release.
 const def=ok(await food('manager','definition.save',{foodRecordId:'hour-recipe',foodRevision:1,track:'daily',countUnit:'ready portion',quantityMode:'whole-portions',par:10,reviewNote:'Fictional whole-portion definition reviewed',confirmed:true}));
 let count=ok(await food('manager','count.create',{track:'daily',businessDate:dayOf(new Date())}));count=ok(await food('manager','count.save',{lines:[{definitionId:def.recordId,quantity:3,note:'Fictional observed on-hand, not historical chat'}]},count));count=ok(await food('manager','count.submit',{confirmed:true},count));
 let prep=ok(await food('manager','plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:dayOf(new Date(Date.now()+86400000))}));assert.equal(plan(prep).lines[0].plannedQty,7);assert.equal(ok(await invoke(handleEmployeePrep,'food/assigned-prep','worker')).items.length,0);
 prep=ok(await food('manager','plan.release',{confirmed:true},prep));prep=ok(await food('manager','plan.assign',{definitionId:def.recordId,assignedTo:'worker'},prep));
 assert.equal(ok(await invoke(handleEmployeePrep,'food/assigned-prep','worker')).items[0].quantity,7);
 await ask('worker','What is my current assigned prep recipe and production amount?');assert.ok(JSON.stringify(captures.at(-1).context).includes('Fictional assigned prep'));
 // Equipment interruption produces an explicit report and changes ownership.
 let issue=ok(await command('manager','task.create',{ownerId:'worker',title:'Equipment interruption remains unresolved',detail:'Fictional equipment problem: stop affected work, use no invented machine method, notify the named BOH manager.',kind:profile.position==='Dishwasher'?'task':'issue',due}));
 const notification=ok(await command('worker','message.send',{recipients:['manager'],title:'Equipment interruption needs direction',body:'Affected prep stopped. Actual issue '+issue.recordId+' remains open.'}));
 await ask('worker','Explain the attached equipment interruption and what remains open.',issue);
 issue=ok(await command('manager','task.reassign',{ownerId:'incoming',note:'Incoming employee owns remaining equipment follow-through; no repair claimed.'},issue));
 const beforeOldOwner=state();const oldOwner=await command('worker','task.transition',{step:'ready',note:'Old owner cannot complete transferred work'},issue);assert.ok([403,404].includes(oldOwner.status),JSON.stringify(oldOwner));assert.equal(state(),beforeOldOwner);
 prep=ok(await food('manager','plan.assign',{definitionId:def.recordId,assignedTo:'incoming'},prep));assert.equal(ok(await invoke(handleEmployeePrep,'food/assigned-prep','worker')).items.length,0);
 const beforeOldPrep=state();assert.equal((await food('worker','plan.employee-complete',{definitionId:def.recordId,quantity:7,confirmed:true},prep)).status,403);assert.equal(state(),beforeOldPrep);
 const previousPrep=prep,requestId='production-shortage-'+profile.id;prep=ok(await food('incoming','plan.employee-complete',{definitionId:def.recordId,quantity:4,note:'Fictional ingredient shortage; three planned portions not made.',confirmed:true},previousPrep,requestId));
 const afterPrep=state();assert.deepEqual(ok(await food('incoming','plan.employee-complete',{definitionId:def.recordId,quantity:4,note:'Fictional ingredient shortage; three planned portions not made.',confirmed:true},previousPrep,requestId)),prep);assert.equal(state(),afterPrep);
 assert.equal(plan(prep).lines[0].plannedQty,7);assert.equal(plan(prep).lines[0].completedQty,4);assert.match(plan(prep).lines[0].completionNote,/shortage/);assert.equal(store.sqlite.prepare('SELECT revision FROM food_records WHERE id=?').get('hour-recipe').revision,1);
 let close;
 if(profile.position==='Dishwasher'){
  const pm=profile.dishShift==='PM',amOwner=pm?'incoming':'worker',recipient=pm?'worker':'incoming';
  ok(await command('manager','task.dish-cycle',{amOwnerId:amOwner,pmOwnerIds:[recipient,'second'],businessDate:dayOf(new Date()),title:'Fictional dedicated dish checkout',detail:profile.closing.join('\n'),due}));
  const am=record(store.sqlite.prepare("SELECT id FROM records WHERE kind='task' AND owner_id=? AND json_extract(data,'$.dishCheckout.shift')='AM'").get(amOwner).id);
  ok(await command(amOwner,'task.dish-pass',{incomingId:recipient,note:'Unfinished dish equipment follow-through remains open.',due},am));
  close=record(store.sqlite.prepare("SELECT id FROM records WHERE kind='task' AND owner_id='worker' AND json_extract(data,'$.dishCheckout') IS NOT NULL").get().id);
  const incomingTask=record(store.sqlite.prepare("SELECT id FROM records WHERE kind='task' AND json_extract(data,'$.dishHandoff.sourceId')=?").get(am.id).id);
  assert.equal((await command(recipient,'task.transition',{step:'ready',note:'Cannot skip explicit incoming acceptance'},incomingTask)).status,400);
  if(!pm)close=ok(await command('worker','task.transition',{step:'ready',note:'Fictional AM close request'},close));
  close=ok(await command('manager','task.transition',{step:'fix',note:'Machine concern remains; correction and handoff required'},close));
 }else{
  close=ok(await command('manager','close.assign',{shiftId:shift.recordId,standardId:trial.guide.id,managerId:'manager',due}));
  close=ok(await command('worker','close.transition',{step:'ready',answers:[0],note:'Fictional close submitted'},close));close=ok(await command('manager','close.transition',{step:'fix',note:'Equipment interruption remains unresolved',managerAttention:'unresolved'},close));
  // A change of manager keeps the reason/history, but the new manager must
  // independently acknowledge rather than inherit the old manager's response.
  close=ok(await command('manager','close.assign',{shiftId:shift.recordId,standardId:trial.guide.id,managerId:'manager2',due,note:'Actual manager handoff of unresolved close'},close));
 }
 const interruptedPhase=profile.position==='Dishwasher'?'correction':'open';assert.equal(record(close.recordId??close.id).data.phase,interruptedPhase);const beforeRelease=state();const premature=await command('manager','shift.release',{note:'Cannot release interrupted close'},shift);if(profile.position==='Dishwasher'&&premature.status===200){fs.mkdirSync('evidence/hour-trial/berts-boh',{recursive:true});fs.writeFileSync('evidence/hour-trial/berts-boh/'+profile.id+'-premature-release-before-fix.json',JSON.stringify({profileId:profile.id,handlerStatus:premature.status,dedicatedCheckoutPhase:record(close.recordId??close.id).data.phase,shiftReleasedAt:record(shift.recordId).data.releasedAt,expected:'Refuse shift departure while assigned dedicated checkout remains unfinished.',provider:'No network calls'},null,2)+'\n');}assert.equal(premature.status,400);assert.equal(state(),beforeRelease);
 const outgoing=ok(await command('worker','message.send',{recipients:['manager2'],title:'Unfinished BOH close and prep shortage',body:'Close correction '+(close.recordId??close.id)+'; reported production four of seven; equipment issue '+issue.recordId+' assigned incoming.'}));
 // Same saved database after a day boundary: nothing is reseeded or completed
 // merely because the schedule end passed or a historical answer was saved.
 reopen();now+=86400000;assert.equal(record(close.recordId??close.id).data.phase,interruptedPhase);assert.equal(record(issue.recordId).ownerId,'incoming');assert.equal(record(issue.recordId).data.phase,'open');assert.equal(plan(prep).lines[0].completedQty,4);
 const managerView=ok(await invoke(handleWorkspace,'workspace','manager2'));assert.ok(managerView.records.some(r=>r.id===outgoing.recordId));assert.ok(!managerView.records.some(r=>r.id===notification.recordId),'Private old-manager message does not become visible merely because manager changed');const oldManagerView=ok(await invoke(handleWorkspace,'workspace','manager'));assert.ok(oldManagerView.records.some(r=>r.id===notification.recordId));
 await ask('worker','Yesterday prep was reported. Does that mean current stock changed or this interrupted close is completed?',close);assert.equal(captures.at(-1).context.evidence.find(e=>e.source.id===(close.recordId??close.id)).facts.phase,interruptedPhase);
 assert.equal(record(close.recordId??close.id).data.phase,interruptedPhase);assert.equal(plan(prep).lines[0].quantity,3);assert.equal(plan(prep).lines[0].completedQty,4);
 if(profile.position==='Dishwasher'){
  const rows=store.sqlite.prepare("SELECT id FROM records WHERE kind='task' AND (json_extract(data,'$.dishCheckout') IS NOT NULL OR json_extract(data,'$.dishHandoff') IS NOT NULL) ORDER BY json_extract(data,'$.dishHandoff') IS NULL").all();
  for(const row of rows){let r=record(row.id);if(r.data.dishHandoff)r=ok(await command(r.ownerId,'task.transition',{step:'accept',note:'Incoming accepts saved remaining work'},r));r=ok(await command(record(row.id).ownerId,'task.transition',{step:'ready',note:'Fictional physical remedy performed'},r));ok(await command('manager','task.transition',{step:'verify',note:'Fictional independent dedicated dish check'},r));}
 }else{
  assert.equal(record(close.recordId).data.managerId,'manager2');assert.equal(record(close.recordId).data.attention.reason,'unresolved');
  close=ok(await command('worker','close.transition',{step:'ready',answers:[0],note:'Fictional remedy and complete criteria'},close));const beforeAck=state();assert.equal((await command('manager2','close.transition',{step:'confirm',note:'Cannot skip new manager acknowledgment'},close)).status,400);assert.equal(state(),beforeAck);
  close=ok(await command('manager2','close.acknowledge',{note:'New manager acknowledges saved issue; actual remedy and physical check separate'},close));close=ok(await command('manager2','close.transition',{step:'confirm',note:'Fictional independent final physical check'},close));
 }
 shift=ok(await command('manager2','shift.release',{note:'Required checkout independently verified in fictional sequence'},shift));assert.ok(record(shift.recordId).data.releasedAt);
 reopen();assert.equal(record(close.recordId??close.id).data.phase,'closed');assert.equal(plan(prep).lines[0].completedQty,4);assert.equal(record(issue.recordId).data.phase,'open','The separate equipment follow-through was not silently completed by close signoff');
 receipts.push({profileId:profile.id,position:profile.position,passed:true,databaseReopens:2,operationalReseeds:0,aiRequests:captures.length,provider:'local mock; no API call',coverage:['opening independent check','draft/release/assignment/recipe','equipment issue report and task transfer','old owner rejected','prep reassignment and short-production idempotence','interrupted close prevents release','new-day correction and manager message retained','manager handoff/independent checkout','historical report not current stock'],limits:['Fictional imported recipe; no Jeff hosted pull','AI context/delivery checked, not real model answer quality','Physical events asserted by fictional tester, not observed','Equipment issue remains open separately after close release; manager must track it'],shortProduction:{planned:7,actual:4,onHandObservation:3},sourceGaps:profile.knownGaps??profile.gaps??[]});
});

test.after(()=>{fs.mkdirSync('evidence/hour-trial/berts-boh',{recursive:true});fs.writeFileSync('evidence/hour-trial/berts-boh/continuity.json',JSON.stringify({createdAt:new Date().toISOString(),profiles:receipts,expectedProfiles:profiles.length,noExternalCalls:true},null,2)+'\n');});
