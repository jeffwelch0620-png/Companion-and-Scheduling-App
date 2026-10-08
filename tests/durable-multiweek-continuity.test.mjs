import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
import {handleEmployeeLogin} from '../.sites-runtime/shared/employee-login.mjs';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';

// No provider or restaurant connection is contacted. The actual handlers use
// one file-backed database, migrated/seeded once, then closed and reopened daily.
// This deliberately differs from the old fixture that replaces daily snapshots.
const bindings={JMAX_LOGIN_SECRET:'a'.repeat(64),OPENAI_API_KEY:'sk-fictional-durable-test-only',JMAX_OPENAI_MODEL:'gpt-5.4-mini'};
const RealDate=Date;
function openDatabase(file){
 const sqlite=new DatabaseSync(file);
 const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){const r=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:Number(r.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 db.withSession=()=>db;
 return {db,sqlite,close:()=>sqlite.close()};
}
const ok=async response=>{const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
const receipts=[];

for(const restaurant of ['berts','rudds','papa'])test(`${restaurant}: 21 days retain operational work and AI history through daily database reopen and phone sign-in`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-durable-'));
 const file=path.join(dir,'saved.sqlite');let store=openDatabase(file),cookie,now=RealDate.parse('2026-10-08T23:00:00-04:00');
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 t.after(()=>{globalThis.Date=RealDate;store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const ids=Object.fromEntries(['worker','manager','senior','outsider'].map(w=>[w,`${restaurant}-${w}`]));
 const foreign=restaurant==='berts'?'rudds':'berts';
 for(const filename of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+filename,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of [restaurant,foreign])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,`Fictional ${loc}`,'America/New_York');
 for(const [who,loc,caps] of [['worker',restaurant,[]],['manager',restaurant,['location.manage','tasks.manage','people.manage','standards.approve','schedule.manage','schedule.publish','close.confirm']],['senior',restaurant,['close.verify']],['outsider',foreign,[]]])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(ids[who],ids[who]+'@example.test',ids[who]+'-identity',loc,'Fictional '+who,'BOH','Fry',JSON.stringify(caps),'["Fry"]');
 const headers=(who,phone=false)=>phone?{Cookie:cookie}:{'oai-authenticated-user-id':ids[who]+'-identity','oai-authenticated-user-email':ids[who]+'@example.test'};
 const request=(route,who='worker',body,query='',phone=false)=>new Request(`https://durable.example/api/${route}?locationId=${restaurant}${query}`,{headers:{...headers(who,phone),Origin:'https://durable.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const command=async(who,action,input={},record,requestId=crypto.randomUUID())=>ok(await handleWorkspace(request('workspace',who,{locationId:restaurant,requestId,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})}),store.db));
 const view=()=>handleWorkspace(request('workspace','worker',undefined,'',true),store.db).then(ok);
 const record=id=>{const r=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return {...r,data:JSON.parse(r.data)};};
 const operations=()=>JSON.stringify(Object.fromEntries(['records','food_workflows','food_workflow_events','food_receipts','command_receipts','audit_events'].map(table=>[table,store.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
 const signIn=async()=>{
  const issued=await ok(await handleEmployeeLogin(request('employee-login','manager',{action:'issue',locationId:restaurant,memberId:ids.worker,expectedRevision:1}),store.db,bindings));
  const response=await handleEmployeeLogin(request('employee-login','worker',{action:'verify',code:issued.code}),store.db,bindings);await ok(response);cookie=response.headers.get('Set-Cookie').split(';')[0];
 };
 await signIn();
 const due=new Date(now+21*86400000).toISOString();
 let issue=await command('manager','task.create',{ownerId:ids.worker,title:'Cooling-label curveball',detail:'Missing label remains open until manager verifies the correction.',kind:'issue',due});
 let goal=await command('worker','goal.create',{ownerId:ids.worker,managerId:ids.manager,title:'Observe portion practice',definition:'Demonstrate the agreed fictional portion steps.',type:'development',due});
 const standardDraft=await command('manager','standard.save',{title:'Durable Fry close',position:'Fry',zone:'Fictional area',criteria:['Fictional surface ready'],source:'Fictional test instruction',version:1,verification:'senior-then-manager',guide:{purpose:'Test carryover',preparation:['Read fictional instructions'],steps:['Check fictional area'],troubleshooting:['Report incomplete work'],escalation:'Ask fictional manager'}});
 const standard=await command('manager','standard.approve',{validated:true,note:'Reviewed fictional test instruction'},standardDraft);
 let shift=await command('manager','shift.save',{personId:ids.worker,position:'Fry',start:new Date(now-3600000).toISOString(),end:new Date(now+3600000).toISOString()});
 let close=await command('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:ids.manager,verifierId:ids.senior,due:new Date(now+3600000).toISOString()});
 shift=await command('manager','shift.publish',{},shift);
 // Food records represent an already imported source and released assignment.
 // They are seeded once; changes after this point go through actual handlers.
 const recipe={title:'Persistent fictional ranch',procedure:'Use current imported procedure',equipment:'Bowl',portionNote:'3.25 oz cup',yieldQty:4,yieldUOM:'cup'};
 store.sqlite.prepare('INSERT INTO food_state(location_id) VALUES(?)').run(restaurant);
 store.sqlite.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('persistent-recipe',restaurant,'foodrecipe','operating',restaurant,'persistent-recipe',recipe.title,ids.manager,'BOH',1,JSON.stringify(recipe),new Date().toISOString());
 const line={definitionId:'persistent-line',foodRecordId:'persistent-recipe',foodRevision:1,title:recipe.title,countUnit:'cup',par:4,quantity:1,plannedQty:3,completedQty:null,completedAt:null,completedBy:null,completionNote:'',assignedTo:ids.worker};
 const prep={id:'persistent-plan',locationId:restaurant,dataset:'operating',revision:1,kind:'plan',status:'released',targetDate:'2026-10-09',track:'daily',countId:'fictional-count',countRevision:1,lines:[line],blockers:[],createdBy:ids.manager,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),releasedBy:ids.manager,releasedAt:new Date().toISOString()};
 store.sqlite.prepare('INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(prep.id,restaurant,'operating','plan','daily:2026-10-09',1,'released',JSON.stringify(prep),new Date().toISOString());
 store.sqlite.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').run('foreign-marker',foreign,'task',ids.outsider,'BOH',JSON.stringify({title:'FOREIGN_RESTAURANT_SECRET',detail:'Never send to employee AI',kind:'task',phase:'open',due,history:[]}),new Date().toISOString());
 const captured=[];
 const provider=async(_url,init)=>{
  const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));captured.push({input,context});
  assert.equal(JSON.stringify(input).includes('FOREIGN_RESTAURANT_SECRET'),false);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Follow the current saved assignment. Chat has not completed or notified anyone.',sourceIds:context.evidence.map(e=>e.source.id).slice(0,20)})}]}]});
 };
 const chat=(body,query='')=>handleCompanionChat(request('companion','worker',body,query,true),store.db,bindings,provider,()=>now,'workforce').then(ok);
 let conversationId,previousDayView;
 for(let day=1;day<=21;day++){
  // Every iteration loads the same saved file; no records, plans or chats reseeded.
  if(day>1){const before=operations();store.close();store=openDatabase(file);assert.equal(operations(),before);now+=86400000;}
  if(day===3)issue=await command('worker','task.transition',{step:'ready',note:'DAY3_LABEL_READY'},issue);
  if(day===4)issue=await command('manager','task.transition',{step:'fix',note:'DAY4_LABEL_STILL_INCORRECT'},issue);
  if(day===7)goal=await command('manager','goal.transition',{step:'coach',note:'DAY7_REPEAT_PORTION_PRACTICE'},goal);
  if(day===9)await ok(await handleFoodWorkflows(request('food/workflows','worker',{locationId:restaurant,requestId:'durable-short-production',action:'plan.employee-complete',recordId:prep.id,expectedRevision:1,input:{dataset:'operating',definitionId:line.definitionId,quantity:2,confirmed:true,note:'DAY9_INGREDIENT_SHORTAGE'}},'',true),store.db));
  if(day===12){close=await command('worker','close.transition',{step:'ready',answers:[0],note:'DAY12_READY_FOR_CHECK'},close);close=await command('senior','close.transition',{step:'fix',note:'DAY12_CLOSE_NOT_PASSED'},close);}
  if(day===15){await ok(await handleEmployeeLogin(request('employee-login','worker',{action:'logout'},'',true),store.db,bindings));await signIn();}
  const w=await view();assert.equal(w.me.id,ids.worker);assert.ok(w.records.some(r=>r.id===issue.recordId));assert.ok(w.records.some(r=>r.id===goal.recordId));assert.ok(w.records.some(r=>r.id===close.recordId));assert.equal(JSON.stringify(w).includes('FOREIGN_RESTAURANT_SECRET'),false);
  assert.equal(record(issue.recordId).data.phase,day>=4?'correction':day>=3?'verification':'open');
  assert.equal(record(goal.recordId).data.phase,'active');assert.equal(record(close.recordId).data.phase,day>=12?'correction':'open');
  const savedPrep=JSON.parse(store.sqlite.prepare('SELECT data FROM food_workflows WHERE id=?').get(prep.id).data);
  assert.equal(savedPrep.lines[0].completedQty,day>=9?2:null);assert.equal(savedPrep.lines[0].completionNote,day>=9?'DAY9_INGREDIENT_SHORTAGE':'');
  const prepView=await ok(await handleEmployeePrep(request('food/assigned-prep','worker',undefined,'',true),store.db));assert.equal(prepView.items.length,day>=9?0:1);
  let current=await chat();conversationId??=current.conversationId;assert.equal(current.conversationId,conversationId);assert.equal(current.turns.length,day-1);
  if(previousDayView)assert.equal(current.turns.at(-1).question,previousDayView.turns.at(-1).question);
  const target=day<=7?issue:day<=14?goal:close,title=day<=7?'Cooling-label curveball':day<=14?'Observe portion practice':'Durable Fry close';
  const before=operations();current=await chat({action:'ask',locationId:restaurant,conversationId:current.conversationId,expectedRevision:current.revision,requestId:`day-${day}`,question:`Day ${day}: Explain ${title} and the currently saved next action.`,focus:{id:target.recordId,revision:target.revision}});
  assert.equal(current.turns.length,day);assert.equal(current.turns.at(-1).status,'complete');assert.equal(operations(),before,'Chat cannot mutate operational state');
  const evidence=captured.at(-1).context.evidence;assert.ok(evidence.some(e=>e.source.id===target.recordId),`Day ${day}: saved prior work ${target.recordId} must reach AI`);
  assert.equal(evidence.find(e=>e.source.id===target.recordId).facts.phase,record(target.recordId).data.phase);
  if(day===2||day===14||day===21)assert.ok(captured.at(-1).input.some(m=>m.role==='assistant'),'Relevant prior dialogue is retained across midnight/week/restart');
  if(day===8||day===15)assert.equal(captured.at(-1).input.some(m=>m.role==='assistant'),false,'A different attached assignment must not inherit unrelated prior dialogue');
  if(day>=8&&day<=14)assert.ok(JSON.stringify(evidence).includes('DAY7_REPEAT_PORTION_PRACTICE'));
  if(day>=15)assert.ok(JSON.stringify(evidence).includes('DAY12_CLOSE_NOT_PASSED'));
  previousDayView=current;
 }
 // A separate OS process reopens the same file and invokes actual authenticated
 // read handlers. This rules out retained JavaScript objects masquerading as storage.
 store.close();
 const childSource=`
 import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
 import {handleWorkspace} from './.sites-runtime/shared/service.mjs';
 import {handleCompanionChat} from './.sites-runtime/shared/companion-chat.mjs';
 import {handleEmployeePrep} from './.sites-runtime/shared/employee-prep-service.mjs';
 const openDatabase=${openDatabase.toString()};
 const p=JSON.parse(fs.readFileSync(0,'utf8')),s=openDatabase(p.file);
 const req=route=>new Request('https://durable.example/api/'+route+'?locationId='+p.restaurant,{headers:{Cookie:p.cookie}});
 const w=await handleWorkspace(req('workspace'),s.db),c=await handleCompanionChat(req('companion'),s.db,{},async()=>{throw Error('Read must not call provider')},()=>p.now,'workforce'),prep=await handleEmployeePrep(req('food/assigned-prep'),s.db);
 const workspace=await w.json(),chat=await c.json(),assigned=await prep.json();
 const plan=JSON.parse(s.sqlite.prepare("SELECT data FROM food_workflows WHERE id='persistent-plan'").get().data);
 process.stdout.write(JSON.stringify({statuses:[w.status,c.status,prep.status],member:workspace.me.id,records:workspace.records,conversationId:chat.conversationId,turns:chat.turns,prepItems:assigned.items.length,plan}));s.close();
 `;
 const child=spawnSync(process.execPath,['--input-type=module','-e',childSource],{cwd:process.cwd(),input:JSON.stringify({file,restaurant,cookie,now}),encoding:'utf8',timeout:30000});
 assert.equal(child.status,0,child.stderr);const recovered=JSON.parse(child.stdout);
 assert.deepEqual(recovered.statuses,[200,200,200]);assert.equal(recovered.member,ids.worker);assert.equal(recovered.conversationId,conversationId);assert.equal(recovered.turns.length,21);assert.equal(recovered.prepItems,0);
 for(const id of [issue.recordId,goal.recordId,close.recordId])assert.ok(recovered.records.some(r=>r.id===id));
 assert.equal(recovered.plan.lines[0].completedQty,2);assert.equal(recovered.plan.lines[0].completionNote,'DAY9_INGREDIENT_SHORTAGE');
 store=openDatabase(file);
 // A deliberate fresh chat preserves the private archive and open work. It
 // must not inject stale archived dialogue into a new AI request automatically.
 const beforeArchive=operations(),oldId=conversationId,oldView=await chat();
 const fresh=await chat({action:'start-new',locationId:restaurant,conversationId:oldView.conversationId,expectedRevision:oldView.revision});
 assert.notEqual(fresh.conversationId,oldId);assert.deepEqual(fresh.turns,[]);assert.equal(operations(),beforeArchive);
 store.close();store=openDatabase(file);now+=86400000;
 const archived=await chat(undefined,'&archived='+encodeURIComponent(oldId));assert.equal(archived.turns.length,21);assert.equal(archived.turns[0].question.startsWith('Day 1:'),true);
 const reopened=await chat();assert.equal(reopened.conversationId,fresh.conversationId);assert.deepEqual(reopened.turns,[]);
 const answered=await chat({action:'ask',locationId:restaurant,conversationId:reopened.conversationId,expectedRevision:reopened.revision,requestId:'after-explicit-archive',question:'Explain the attached Durable Fry close still awaiting correction.',focus:{id:close.recordId,revision:close.revision}});assert.equal(answered.turns.length,1);
 assert.equal(captured.at(-1).input.some(m=>m.role==='assistant'),false);assert.ok(captured.at(-1).context.evidence.some(e=>e.source.id===close.recordId));
 assert.equal(store.sqlite.prepare('SELECT count(*) AS n FROM companion_turns').get().n,22);assert.equal(store.sqlite.prepare('SELECT count(*) AS n FROM companion_archives').get().n,1);
 const foreignResponse=await handleCompanionChat(new Request(`https://durable.example/api/companion?locationId=${foreign}`,{headers:{Cookie:cookie}}),store.db,bindings,provider,()=>now,'workforce');assert.equal(foreignResponse.status,403);
 receipts.push({restaurant,simulatedDays:22,dailyReopens:21,separateProcessAuthenticatedRecovery:1,operationalReseedsAfterInitialSetup:0,phoneLogoutAndSignIn:1,chatTurnsRetained:22,explicitArchives:1,foreignRestaurantDenied:true,provider:'mocked input inspection; no live AI/key use',backend:'disk SQLite adapter calling actual app handlers; hosted persistence unverified'});
});

test.after(()=>{
 fs.mkdirSync('evidence',{recursive:true});
 fs.writeFileSync('evidence/durable-multiweek-continuity.json',JSON.stringify({createdAt:new RealDate().toISOString(),passedRestaurants:receipts,proofLimits:['Mock provider verifies delivered context, not generated answer quality.','File-backed local SQLite with actual app handlers, daily close/reopen and separate-process recovery is not hosted D1/Supabase restart acceptance.','Initial fixture seeds an imported recipe/released plan; no Jeff hosted pull is tested.','Abrupt OS crash during an in-flight write is not tested.','AI receives relevant current work and up to eight eligible recent turns; private archives stay accessible but are not automatically injected into new chat.']},null,2)+'\n');
});
