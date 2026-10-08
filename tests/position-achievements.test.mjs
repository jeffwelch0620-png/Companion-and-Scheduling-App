import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

// Compile to an isolated folder; never change the team's shared checkpoint.
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-achievements-runtime-'));
const sourceManifest=[];
for(const name of fs.readdirSync('app/shared').filter(n=>n.endsWith('.ts'))){
 const raw=fs.readFileSync('app/shared/'+name,'utf8'),source=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 sourceManifest.push({file:'app/shared/'+name,sourceSha256:createHash('sha256').update(raw).digest('hex'),compiledSha256:createHash('sha256').update(source).digest('hex')});
 fs.writeFileSync(path.join(runtime,name.replace('.ts','.mjs')),source);
}
const {positionAchievements,achievementReader,achievementView,synchronizePositionAchievements}=await import('file:///'+path.join(runtime,'position-achievements.mjs').replaceAll('\\','/'));
const {applyCommand,publicWorkspace}=await import('file:///'+path.join(runtime,'domain.mjs').replaceAll('\\','/'));
const {handleWorkspace}=await import('file:///'+path.join(runtime,'service.mjs').replaceAll('\\','/'));
const start='2026-10-20T12:00:00Z',ready='2026-10-20T13:00:00Z',checked='2026-10-20T14:00:00Z',accepted='2026-10-20T15:00:00Z';
const caps=['tasks.manage','people.manage','standards.approve','close.confirm','close.verify','location.manage'];
const person=(id,position='Cook',capabilities=[],locationId='berts')=>({id,name:'Fictional '+id,position,area:'BOH',locationId,capabilities,qualifications:[position]});
const worker=person('worker'),manager=person('manager','General Manager',caps),incoming=person('incoming');
const hist=(action,actorId,at=checked)=>({action,actorId,at,note:'Fictional review evidence for '+action});
const rec=(kind,id,data,ownerId='worker',revision=1)=>({kind,id,data,ownerId,revision,locationId:'berts',area:'BOH',updatedAt:checked});
function workspace(records=[],me=worker,members=[worker,manager,incoming]){return {location:{id:'berts',name:'Fictional Bert’s',timezone:'America/New_York',revision:1},me,members,records};}
function checkedTask(id='work',kind='task'){return rec('task',id,{title:'Fictional assigned work',detail:'QA condition',kind,phase:'closed',due:checked,history:[hist('assigned','manager',start),hist('ready','worker',ready),hist('verify','manager',checked)]});}
const card=(w,id)=>positionAchievements(w).find(c=>c.id===id);
function persist(w,changes){return {...w,records:[...w.records.filter(r=>!changes.some(c=>c.id===r.id)),...changes]};}
let sequence=0;const makeId=()=>`achievement-${++sequence}`;

test('actual ready/independent verify transitions automatically qualify the employee, never the checker',()=>{
 let w=workspace([checkedTask()]);w.records[0].data.phase='open';w.records[0].data.history=w.records[0].data.history.slice(0,1);
 const act=(who,step,at)=>applyCommand({...w,me:who},{action:'task.transition',locationId:'berts',requestId:makeId(),recordId:'work',expectedRevision:w.records[0].revision,input:{step,note:'Fictional actual handler evidence'}},at,makeId);
 let changed=act(worker,'ready',ready);assert.equal(synchronizePositionAchievements(w,changed,ready,makeId).length,0);w=persist(w,changed);
 assert.throws(()=>act(worker,'verify',checked));changed=act(manager,'verify',checked);
 const awards=synchronizePositionAchievements({...w,me:manager},changed,checked,makeId);assert.equal(awards.length,1);assert.equal(awards[0].ownerId,'worker');assert.equal(awards[0].data.milestoneId,'checked-work');
 w=persist(persist(w,changed),awards);assert.equal(card(w,'checked-work').state,'earned');assert.equal(positionAchievements({...w,me:manager}).some(c=>c.state==='earned'),false);
 assert.equal(synchronizePositionAchievements({...w,me:manager},changed,checked,makeId).length,0);
});

test('self verification, a closed label alone, chats and copied unreviewed work cannot earn',()=>{
 for(const task of [checkedTask(),checkedTask(),checkedTask()]){
  if(sequence%3===0)task.data.history=[];else task.data.history=task.data.history.map(h=>h.action==='verify'?{...h,actorId:'worker'}:h);
  assert.equal(card(workspace([task]),'checked-work').state,'opportunity');
 }
 const closed=checkedTask();closed.data.history=[];assert.equal(synchronizePositionAchievements(workspace([closed]),[closed],checked,makeId).length,0);
 assert.equal(synchronizePositionAchievements(workspace(),[rec('message','chat',{title:'Great job',body:'I finished!',recipients:['worker'],readBy:[],replies:[]})],checked,makeId).length,0);
});

test('one milestone retains earned date and evidence versions through changes, deletion and recheck',()=>{
 let w=workspace([checkedTask()]);let awards=synchronizePositionAchievements(w,[w.records[0]],checked,makeId);w=persist(w,awards);
 const old=w.records.find(r=>r.kind==='achievement');
 const changed={...w.records[0],revision:2,data:{...w.records[0].data,phase:'correction'}};
 assert.equal(achievementView(old,persist(w,[changed])).data.status,'review-needed');awards=synchronizePositionAchievements(w,[changed],accepted,makeId);w=persist(persist(w,[changed]),awards);
 assert.equal(awards[0].data.earnedAt,checked);assert.equal(awards[0].data.versions.length,1);assert.equal(awards[0].data.sourceRefs[0].revision,1);
 assert.equal(achievementView(awards[0],{...w,records:w.records.filter(r=>r.id!=='work')}).data.status,'review-needed');
 const restored={...changed,revision:3,data:{...changed.data,phase:'closed',history:[...changed.data.history,hist('ready','worker',accepted),hist('verify','manager','2026-10-20T16:00:00Z')]}};
 awards=synchronizePositionAchievements(w,[restored],'2026-10-20T16:00:00Z',makeId);assert.equal(awards.length,1);assert.equal(awards[0].id,old.id);assert.equal(awards[0].data.earnedAt,checked);assert.equal(awards[0].data.versions.length,2);assert.equal(awards[0].data.sourceRefs[0].revision,3);
});

test('repeat distinct checked tasks cannot farm duplicate milestones or replace original proof',()=>{
 let w=workspace([checkedTask()]);w=persist(w,synchronizePositionAchievements(w,[w.records[0]],checked,makeId));const duplicate=checkedTask('another-work');
 assert.equal(synchronizePositionAchievements(w,[duplicate],accepted,makeId).length,0);assert.equal(w.records.filter(r=>r.kind==='achievement').length,1);
});

test('private owner-only store boundaries hold for managers, foreign employees and schedule-only members',()=>{
 const w=workspace([checkedTask()]);const award=synchronizePositionAchievements(w,[w.records[0]],checked,makeId)[0];
 assert.equal(achievementReader(award,worker),true);assert.equal(achievementReader(award,manager),false);assert.equal(achievementReader(award,{...worker,locationId:'rudds'}),false);assert.equal(achievementReader(award,{...worker,scheduleOnly:true}),false);
 assert.deepEqual(positionAchievements({...w,me:{...worker,locationId:'rudds'}}),[]);
 const foreign={...checkedTask(),locationId:'rudds'};assert.equal(synchronizePositionAchievements(w,[foreign],checked,makeId).length,0);
 assert.throws(()=>applyCommand(w,{action:'achievement.refresh',locationId:'berts',requestId:makeId(),input:{ownerId:'manager'}},checked,makeId));
});

test('Dish gets narrowly checked progress and clean acceptance without PM body exposure or orphan receipt',()=>{
 const am=person('worker','Dishwasher'),pm=person('incoming','Dishwasher');
 const parent=checkedTask('am-checkout');parent.data.dishCheckout={shift:'AM',cycleId:'cycle',participantIds:['worker','incoming'],businessDate:'2026-10-20'};parent.data.dishHandoffs=['incoming-task'];parent.data.dishHandoffAcceptances=[{handoffId:'incoming-task',acceptedBy:'incoming',acceptedAt:accepted}];
 const child=rec('task','incoming-task',{title:'PRIVATE PM task body',detail:'Private PM detail',kind:'task',phase:'open',due:accepted,dishHandoff:{sourceId:'am-checkout',cycleId:'cycle',businessDate:'2026-10-20',acceptedBy:'incoming',acceptedAt:accepted},history:[hist('accepted','incoming',accepted)]},'incoming');
 let w=workspace([parent,child],am,[am,pm,manager]);assert.equal(card(w,'clean-handoff').state,'ready');assert.equal(card(w,'checked-work').state,'ready');assert.equal(card(w,'learning-step'),undefined);
 const publicW=publicWorkspace(w);assert.equal(publicW.records.some(r=>r.id==='incoming-task'),false);assert.equal(card(publicW,'clean-handoff').state,'ready');assert.equal(JSON.stringify(card(publicW,'clean-handoff')).includes('PRIVATE PM'),false);
 for(const mutated of [undefined,{...child,ownerId:'manager'},{...child,data:{...child.data,dishHandoff:{...child.data.dishHandoff,acceptedAt:null}}}]){
  const bad=workspace([parent,...mutated?[mutated]:[]],am,[am,pm,manager]);assert.equal(card(bad,'clean-handoff').state,'opportunity');
 }
 w=persist(w,synchronizePositionAchievements(w,[parent],accepted,makeId));const badChild={...child,revision:2,ownerId:'manager'};
 const updates=synchronizePositionAchievements(w,[badChild],accepted,makeId);assert.equal(updates.find(r=>r.data.milestoneId==='clean-handoff').data.status,'review-needed');
});

test('closed current voluntary goals and station assessments earn independently; readiness never grants clearance',()=>{
 const guide=rec('standard','guide',{title:'QA guide',zone:'QA',position:'Cook',criteria:['Observed condition'],source:'Fictional fixture',version:1,verification:'manager',status:'approved',validationNote:'QA only',history:[]},'manager');
 const goal=rec('goal','goal',{title:'Voluntary practice',definition:'QA skill',type:'development',managerId:'manager',due:checked,standardId:'guide',standardRevision:1,phase:'verification',history:[hist('ready','worker',ready)]});
 assert.equal(card(workspace([guide,goal]),'learning-step').state,'opportunity');goal.data.phase='closed';goal.data.history.push(hist('verify','manager'));assert.equal(card(workspace([guide,goal]),'learning-step').state,'ready');
 goal.data.type='required-correction';assert.equal(card(workspace([guide,goal]),'learning-step').state,'opportunity');goal.data.type='development';guide.data.status='retired';assert.equal(card(workspace([guide,goal]),'learning-step').state,'opportunity');
 const station=rec('station','station',{title:'QA Station',definitionRevision:1,levels:[{value:1,label:'Learning',definition:'QA method'}],independentLevel:1,status:'active',history:[]},'manager');
 const proficiency=rec('proficiency','assessment',{title:'QA assessment',stationId:'station',stationRevision:1,position:'QA Station',level:1,certifiedTrainer:false,evidence:'Manager observed QA evidence',assessedAt:checked,history:[hist('manager-assessed','manager')]});
 const w=workspace([station,proficiency]);assert.equal(card(w,'station-builder').state,'ready');const before=JSON.stringify(w.me);synchronizePositionAchievements(w,[proficiency],checked,makeId);assert.equal(JSON.stringify(w.me),before);assert.deepEqual(w.me.qualifications,['Cook']);station.data.definitionRevision=2;assert.equal(card(w,'station-builder').state,'opportunity');
});

test('closing requires current guide, published own shift and independent final confirmation',()=>{
 const guide=rec('standard','guide',{title:'Approved QA close',zone:'QA',position:'Cook',criteria:['QA'],source:'Fictional fixture',version:1,verification:'manager',status:'approved',validationNote:'QA only',history:[]},'manager');
 const shift=rec('shift','shift',{personId:'worker',start,end:accepted,position:'Cook',published:true,cancelled:false,history:[]});
 const close=rec('close','close',{shiftId:'shift',standardId:'guide',standardRevision:1,standard:guide.data,managerId:'manager',due:accepted,phase:'closed',history:[hist('ready','worker',ready),hist('confirm','manager')]});
 const w=workspace([guide,shift,close]);assert.equal(card(w,'ready-for-tomorrow').state,'ready');close.data.history[1].actorId='worker';assert.equal(card(w,'ready-for-tomorrow').state,'opportunity');close.data.history[1].actorId='manager';shift.data.cancelled=true;assert.equal(card(w,'ready-for-tomorrow').state,'opportunity');
});

test('reviewed implementation is labelled reported and correction issue needs independent review',()=>{
 const idea=rec('staffidea','idea',{title:'QA idea',idea:'Useful suggestion',benefit:'QA',employeeName:'Fictional',submittedAt:start,status:'closed',managerId:'manager',dueDate:'2026-10-20',responses:[{id:'review',by:'manager',at:checked,outcome:'implemented',note:'Reported result',evidence:'Manager report',readAt:null}],history:[]});
 assert.equal(card(workspace([idea]),'idea-to-action').state,'ready');assert.match(card(workspace([idea]),'idea-to-action').description,/reported/);idea.data.responses[0].by='worker';assert.equal(card(workspace([idea]),'idea-to-action').state,'opportunity');
 const issue=checkedTask('issue','issue');assert.equal(card(workspace([issue]),'problem-solver').state,'opportunity');issue.data.history.splice(1,0,hist('fix','manager','2026-10-20T12:30:00Z'));assert.equal(card(workspace([issue]),'problem-solver').state,'ready');
});

test('durable milestone saved once survives SQLite reopen; refresh rejects fabricated input',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-achievement-proof-')),file=path.join(dir,'progress.sqlite');let db=new DatabaseSync(file);db.exec('CREATE TABLE snapshots(id TEXT PRIMARY KEY,json TEXT NOT NULL)');
 let w=workspace([checkedTask()]);const apply=()=>applyCommand(w,{action:'achievement.refresh',locationId:'berts',requestId:makeId(),input:{}},checked,makeId);w=persist(w,apply());assert.equal(card(w,'checked-work').state,'earned');assert.throws(apply,/already current/);
 db.prepare('INSERT INTO snapshots VALUES(?,?)').run('workspace',JSON.stringify(w));db.close();db=new DatabaseSync(file);w=JSON.parse(db.prepare('SELECT json FROM snapshots WHERE id=?').get('workspace').json);assert.equal(card(w,'checked-work').state,'earned');assert.throws(apply,/already current/);assert.equal(w.records.filter(r=>r.kind==='achievement').length,1);db.close();fs.rmSync(dir,{recursive:true,force:true});
});

async function actualFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-achievement-handler-')),file=path.join(dir,'workspace.sqlite');let sqlite;
 const open=()=>{sqlite=new DatabaseSync(file);return {prepare(sql){let args=[];return {bind(...v){args=v;return this;},async all(){return {results:sqlite.prepare(sql).all(...args),meta:{changes:Number(sqlite.prepare('SELECT changes() n').get().n)}};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){const r=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:Number(r.changes)}};}};},async batch(items){sqlite.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};};let db=open();
 db.withSession=()=>db;t.after(()=>{sqlite.close();fs.rmSync(dir,{recursive:true,force:true});});
 for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds','papa'])sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');
 for(const m of [worker,manager,incoming,person('foreign','Cook',[],'rudds')])sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(m.id,m.id+'@example.test',m.id+'-identity',m.locationId,m.name,m.area,m.position,JSON.stringify(m.capabilities),JSON.stringify(m.qualifications));
 const request=(actor,body,loc='berts')=>new Request('https://achievement.example/api/workspace?locationId='+loc,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://achievement.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const raw=async(actor,action,input={},r,rid=crypto.randomUUID(),loc='berts')=>{const response=await handleWorkspace(request(actor,{locationId:loc,requestId:rid,action,input,...(r?{recordId:r.recordId??r.id,expectedRevision:r.revision}:{})},loc),db);return {status:response.status,data:await response.json()};};
 const command=async(...args)=>{const r=await raw(...args);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const view=async(actor)=>{const response=await handleWorkspace(request(actor),db);assert.equal(response.status,200);return response.json();};
 const snapshot=()=>JSON.stringify(Object.fromEntries(['records','command_receipts','audit_events','locations'].map(table=>[table,sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 const awards=()=>sqlite.prepare("SELECT * FROM records WHERE kind='achievement'").all().map(r=>({...r,data:JSON.parse(r.data)}));
 return {raw,command,view,snapshot,awards,get sqlite(){return sqlite;},reopen(){const before=snapshot();sqlite.close();db=open();db.withSession=()=>db;assert.equal(snapshot(),before);}};
}
test('actual authenticated service records automatic milestone atomically; durable retry and store reads are private',async t=>{
 const f=await actualFixture(t),due=new Date(Date.now()+3600000).toISOString();
 let task=await f.command('manager','task.create',{ownerId:'worker',kind:'task',title:'QA restock',detail:'QA assigned condition',due});
 assert.equal(f.awards().length,0);task=await f.command('worker','task.transition',{step:'ready',note:'Fictional completed assignment'},task);assert.equal(f.awards().length,0);
 const before=f.snapshot();assert.equal((await f.raw('worker','task.transition',{step:'verify',note:'Cannot self verify'},task)).status,403);assert.equal(f.snapshot(),before);
 const verified=await f.command('manager','task.transition',{step:'verify',note:'Fictional independent observation'},task,'verified-once');assert.equal(f.awards().length,1);assert.equal(f.awards()[0].owner_id,'worker');const saved=f.snapshot();f.reopen();assert.deepEqual(await f.command('manager','task.transition',{step:'verify',note:'Fictional independent observation'},task,'verified-once'),verified);assert.equal(f.snapshot(),saved);
 const mine=await f.view('worker'),managerView=await f.view('manager'),peer=await f.view('incoming');assert.equal(mine.records.filter(r=>r.kind==='achievement').length,1);assert.equal(managerView.records.filter(r=>r.kind==='achievement').length,0);assert.equal(peer.records.filter(r=>r.kind==='achievement').length,0);
 assert.equal((await f.raw('foreign','achievement.refresh')).status,403);const noChange=await f.raw('worker','achievement.refresh');assert.equal(noChange.status,400);assert.match(noChange.data.error,/already current/);assert.equal(f.snapshot(),saved);
});
test('achievement storage failure rolls back the independent check and notifications; same request can safely retry',async t=>{
 const f=await actualFixture(t),due=new Date(Date.now()+3600000).toISOString();let task=await f.command('manager','task.create',{ownerId:'worker',kind:'task',title:'QA ready station',detail:'QA source-backed assignment',due});task=await f.command('worker','task.transition',{step:'ready',note:'Fictional completed evidence'},task);
 const before=f.snapshot();f.sqlite.exec("CREATE TRIGGER fail_achievement BEFORE INSERT ON records WHEN NEW.kind='achievement' BEGIN SELECT RAISE(ABORT,'Fictional milestone write outage'); END");
 const failed=await f.raw('manager','task.transition',{step:'verify',note:'Fictional independent check'},task,'outage-retry');assert.equal(failed.status,503,JSON.stringify(failed));assert.equal(f.snapshot(),before);f.sqlite.exec('DROP TRIGGER fail_achievement');f.reopen();await f.command('manager','task.transition',{step:'verify',note:'Fictional independent check'},task,'outage-retry');assert.equal(f.awards().length,1);const state=f.snapshot();assert.equal((await f.raw('worker','achievement.refresh',{score:1000})).status,400);assert.equal(f.snapshot(),state);
});
test('automatic dependency reconciliation persists review-needed for guide retirement and source asset revision',()=>{
 const source=checkedTask('reviewed-source');const equipment=rec('equipment','asset',{title:'QA oven',assetTag:'QA-1',status:'active'},'manager');
 const report=rec('learningcase','lesson',{title:'QA shared lesson',symptom:'QA symptom',actionsTaken:'QA action',observedResult:'QA reported result',uncertainty:'Not a new approved method',remainingWork:'',source:{id:source.id,revision:1,kind:'task',title:source.data.title},asset:{id:'asset',revision:1,title:'QA oven',assetTag:'QA-1'},reporterName:'Fictional',submittedAt:start,status:'reviewed',review:{verdict:'supported',by:'manager',at:checked,evidence:'Fictional independent check',note:'QA only',causeStatus:'not-established',cause:''},versions:[],history:[]});
 let w=workspace([source,equipment,report]);w=persist(w,synchronizePositionAchievements(w,[report],checked,makeId));assert.equal(card(w,'shared-learning').state,'earned');const changedAsset={...equipment,revision:2,data:{...equipment.data,status:'retired'}};const changed=synchronizePositionAchievements({...w,me:manager},[changedAsset],accepted,makeId);assert.equal(changed.find(r=>r.data.milestoneId==='shared-learning').data.status,'review-needed');
 const guide=rec('standard','guide',{title:'QA guide',zone:'QA',position:'Cook',criteria:['QA'],source:'Fictional',version:1,verification:'manager',status:'approved',history:[]},'manager');const goal=rec('goal','goal',{title:'QA voluntary goal',definition:'Practice',type:'development',managerId:'manager',due:checked,standardId:'guide',standardRevision:1,phase:'closed',history:[hist('verify','manager')]});w=workspace([guide,goal]);w=persist(w,synchronizePositionAchievements(w,[goal],checked,makeId));const retired={...guide,revision:2,data:{...guide.data,status:'retired'}};assert.equal(synchronizePositionAchievements({...w,me:manager},[retired],accepted,makeId).find(r=>r.data.milestoneId==='learning-step').data.status,'review-needed');
});
test('server-derived progress projection preserves earned Dish lesson while hiding manager-only equipment',()=>{
 const dish=person('worker','Dishwasher'),source=checkedTask('dish-source'),equipment=rec('equipment','hidden-asset',{title:'PRIVATE CHECKED EQUIPMENT',assetTag:'QA-1',status:'active'},'manager');
 const report=rec('learningcase','dish-lesson',{title:'Explicitly shared reported lesson',symptom:'QA symptom',actionsTaken:'QA action',observedResult:'QA result',uncertainty:'Unknown cause',remainingWork:'',source:{id:source.id,revision:1,kind:'task',title:source.data.title},asset:{id:'hidden-asset',revision:1,title:'Approved reported asset reference',assetTag:'QA-1'},reporterName:'Fictional',submittedAt:start,status:'reviewed',review:{verdict:'supported',by:'manager',at:checked,evidence:'Independent supported review',note:'QA only',causeStatus:'not-established',cause:''},versions:[],history:[]});
 let raw=workspace([source,equipment,report],dish,[dish,manager]);raw=persist(raw,synchronizePositionAchievements(raw,[report],checked,makeId));const publicW=publicWorkspace(raw);
 assert.equal(publicW.records.some(r=>r.id==='hidden-asset'),false);assert.equal(JSON.stringify(publicW).includes('PRIVATE CHECKED EQUIPMENT'),false);assert.equal(card(publicW,'shared-learning').state,'earned');assert.equal(publicW.records.find(r=>r.kind==='achievement'&&r.data.milestoneId==='shared-learning').data.readEvidenceCurrent,true);
 const changed=persist(raw,[{...equipment,revision:2,data:{...equipment.data,status:'retired'}}]);assert.equal(card(publicWorkspace(changed),'shared-learning').state,'review-needed');
});
test('forged persisted achievement rendering marker cannot hide changed source from authoritative service',async t=>{
 const f=await actualFixture(t),due=new Date(Date.now()+3600000).toISOString();let task=await f.command('manager','task.create',{ownerId:'worker',kind:'task',title:'QA progress',detail:'QA condition',due});task=await f.command('worker','task.transition',{step:'ready',note:'Fictional completed work'},task);await f.command('manager','task.transition',{step:'verify',note:'Independent checked work'},task);
 const award=f.awards()[0];f.sqlite.prepare("UPDATE records SET data=json_set(data,'$.readEvidenceCurrent',1) WHERE id=?").run(award.id);f.sqlite.prepare('UPDATE records SET owner_id=? WHERE id=?').run('incoming',task.recordId);
 const w=await f.view('worker'),progress=w.records.find(r=>r.id===award.id);assert.equal(progress.data.readEvidenceCurrent,false);assert.equal(progress.data.status,'review-needed');assert.equal(card(w,'checked-work').state,'review-needed');
 assert.equal((await f.raw('worker','achievement.refresh')).status,200);assert.equal(f.awards()[0].data.status,'review-needed');assert.equal(f.awards()[0].data.readEvidenceCurrent,undefined);
});
test('milestone evidence respects existing explicit whole-store closing and independent people-review permissions',()=>{
 const storeManager={...manager,area:'FOH',capabilities:['tasks.manage','operations.store','close.confirm']},dish=person('worker','Dishwasher'),task=checkedTask();task.data.dishCheckout={cycleId:'cycle',businessDate:'2026-10-20',shift:'AM',participantIds:['worker','incoming']};
 assert.equal(card(workspace([task],dish,[dish,storeManager,incoming]),'checked-work').state,'ready');
 const peopleReviewer={...manager,capabilities:['people.manage']},idea=rec('staffidea','idea',{title:'QA idea',idea:'Useful',benefit:'QA',employeeName:'Fictional',submittedAt:start,status:'closed',managerId:'manager',dueDate:'2026-10-20',responses:[{id:'review',by:'manager',at:checked,outcome:'implemented',note:'Reported implementation',evidence:'Review evidence',readAt:null}],history:[]});
 assert.equal(card(workspace([idea],worker,[worker,peopleReviewer]),'idea-to-action').state,'ready');
 // Explicit store operations never expands ordinary unlinked task authority.
 delete task.data.dishCheckout;assert.equal(card(workspace([task],worker,[worker,storeManager]),'checked-work').state,'opportunity');
});
test.after(()=>{fs.mkdirSync('evidence/hour-trial/position-achievements',{recursive:true});fs.writeFileSync('evidence/hour-trial/position-achievements/isolated-source-manifest.json',JSON.stringify({at:new Date().toISOString(),sourceManifest},null,2));fs.rmSync(runtime,{recursive:true,force:true});});
