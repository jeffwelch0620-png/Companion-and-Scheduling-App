import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { handleCompanionChat } from '../.sites-runtime/shared/companion-chat.mjs';
import { handleWorkspace } from '../.sites-runtime/shared/service.mjs';
import { handleOwnerReview } from '../.sites-runtime/shared/owner-review.mjs';
import { configuredCompanion } from '../.sites-runtime/shared/openai-companion.mjs';
import { companionDailyLimit } from '../.sites-runtime/shared/companion-usage.mjs';
import { canonicalJobRole } from '../.sites-runtime/shared/job-role.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const bindings={OPENAI_API_KEY:'sk-fictional-test-only',JMAX_OPENAI_MODEL:'gpt-5.4-mini'};
const answer=(sourceIds=['close'])=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Prepare the fictional kit, then ask Test senior for the physical check. Test manager performs the final check. I have not marked anything complete.',sourceIds})}]}]});
async function fixture(t){
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  for(const location of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Test '+location,'America/New_York').run();
  for(const [who,position,caps,loc='a'] of [['worker','Fry',[]],['other','Fry',[]],['manager','Manager',['tasks.manage','schedule.manage','people.manage','close.confirm']],['senior','Senior',['close.verify']],['dish','Dishwasher',[]],['outsider','Fry',[],'b']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(who,who+'@example.test',who+'-id',loc,'Test '+who,'BOH',position,JSON.stringify(caps),JSON.stringify([position])).run();
  let now=Date.parse('2026-09-14T21:00:00Z');
  const standard={title:'Fictional Fry practice',zone:'Practice kit',position:'Fry',criteria:['Fictional kit ready'],source:'Fictional test standard',version:1,verification:'senior-then-manager',status:'approved',validationNote:'Fixture',history:[],guide:{purpose:'Practice only',preparation:['Read the fictional label'],steps:['Arrange the fictional kit'],troubleshooting:['Ask if a sample is missing'],escalation:'Ask Test manager'}};
  const record=async(id,kind,owner,data,loc='a')=>db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(id,loc,kind,owner,'BOH',JSON.stringify(data),new Date(now).toISOString()).run();
  await record('standard','standard','manager',standard);
  await record('draft','standard','manager',{...standard,title:'UNAPPROVED_SECRET',status:'draft',criteria:['DRAFT_PRIVATE_MARKER']});
  await record('shift','shift','worker',{personId:'worker',start:'2026-09-14T20:00:00Z',end:'2026-09-15T03:00:00Z',position:'Fry',published:true,cancelled:false});
  await record('close','close','worker',{shiftId:'shift',standardId:'standard',standardRevision:1,standard,verifierId:'senior',managerId:'manager',due:'2026-09-15T03:00:00Z',phase:'open',history:[]});
  await record('my-note','feedback','worker',{text:'MY_PRIVATE_FEEDBACK_MARKER',shared:false,status:'private',response:'',due:'',history:[]});
  await record('other-note','feedback','other',{text:'OTHER_PRIVATE_MARKER',shared:false,status:'private',response:'',due:'',history:[]});
  await record('other-task','task','other',{title:'OTHER_TASK_MARKER',detail:'Not assigned to worker',kind:'task',phase:'open',due:'2026-09-15T03:00:00Z',history:[]});
  await record('other-location','task','outsider',{title:'OTHER_LOCATION_MARKER',detail:'Other restaurant',kind:'task',phase:'open',due:'2026-09-15T03:00:00Z',history:[]},'b');
  const headers=who=>who?{'oai-authenticated-user-id':who+'-id','oai-authenticated-user-email':who+'@example.test'}:{};
  const call=async(who,body,fetcher=async()=>answer(),options={})=>{
    const url='https://test.example/api/companion?locationId='+(options.location??'a')+(options.query?'&'+new URLSearchParams(options.query):'');
    const req=new Request(url,{method:body?'POST':'GET',headers:{...headers(who),Origin:options.origin??'https://test.example','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const r=await handleCompanionChat(req,db,options.bindings??bindings,fetcher,()=>now,options.product??'legacy');return {status:r.status,data:await r.json(),headers:r.headers};
  };
  const body=(v,q='Walk me through my close.',requestId=crypto.randomUUID())=>({locationId:'a',action:'ask',conversationId:v.conversationId,expectedRevision:v.revision,question:q,requestId});
  return {db,call,body,record,headers,tick:(ms=6000)=>{now+=ms},standard};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const preferences=(v,explanationStyle)=>({action:'preferences',locationId:'a',conversationId:v.conversationId,expectedRevision:v.revision,explanationStyle});
const fresh=v=>({action:'start-new',locationId:'a',conversationId:v.conversationId,expectedRevision:v.revision});
const removeHistory=(v,archivedId)=>({...fresh(v),action:'delete-history',archivedId,confirmed:true});
const past=(f,who,query={history:'1'})=>f.call(who,undefined,undefined,{query});

test('Dishwasher chat explains own assigned work without exposing coworkers or adding operating authority',async t=>{
 const f=await fixture(t);await f.record('dish-task','task','dish',{title:'Clean dish station',detail:'Clean and restock the station; ask the named manager to verify.',kind:'task',phase:'correction',due:'2026-09-15T03:00:00Z',history:[]});
 const v=ok(await f.call('dish'));let captured;
 const out=ok(await f.call('dish',{...f.body(v,'What remains for this dish station correction?'),focus:{id:'dish-task',revision:1}},async(_url,init)=>{captured=JSON.parse(init.body).input;const ctx=JSON.parse(captured[1].content.split('\n').slice(1).join('\n'));assert.ok(ctx.evidence.some(e=>e.source.id==='dish-task'));return answer(['dish-task']);},{product:'workforce'}));
 assert.equal(out.turns.at(-1).status,'complete');for(const marker of ['OTHER_TASK_MARKER','OTHER_LOCATION_MARKER','OTHER_PRIVATE_MARKER','DRAFT_PRIVATE_MARKER'])assert.ok(!JSON.stringify(captured).includes(marker));
 assert.equal(JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind('dish-task').first()).data).phase,'correction');
 const w=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('dish')}),f.db).then(r=>r.json());assert.deepEqual(w.me.capabilities,[]);assert.ok(w.records.every(r=>!['standard','goal','station','proficiency','managerlog'].includes(r.kind)));
});

test('active Companion retains closing follow-up context without completing work and isolates a new attached shift',async t=>{
 const f=await fixture(t);
 const before=(await f.db.prepare('SELECT data FROM records WHERE id=?').bind('close').first()).data;
 let view=ok(await f.call('worker'));
 view=ok(await f.call('worker',{...f.body(view,'Walk me through my close.'),focus:{id:'close',revision:1}},async(_url,init)=>{
  const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  assert.equal(context.scopeMode,'selected-closing-work');
  assert.ok(context.evidence.some(e=>e.source.id==='close'));
  assert.ok(!JSON.stringify(context).includes('OTHER_TASK_MARKER'));
  return answer(['close']);
 },{product:'workforce'}));
 f.tick();
 view=ok(await f.call('worker',f.body(view,'Who checks that?'),async(_url,init)=>{
  const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  assert.equal(context.scopeMode,'selected-closing-work');
  assert.equal(context.selectedWork.id,'close','An exact prior attachment stays narrowly focused on its current readable work');
  assert.ok(input.some(m=>m.role==='assistant'),'Closing response remains available for pronoun follow-up');
  assert.ok(context.evidence.some(e=>e.source.id==='close'));
  return answer(['close']);
 },{product:'workforce'}));
 f.tick();
 ok(await f.call('worker',{...f.body(view,'Explain this shift.'),focus:{id:'shift',revision:1}},async(_url,init)=>{
  const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  assert.equal(context.scopeMode,'selected-shift');
  assert.ok(!input.some(m=>m.role==='assistant'),'New attached item must not inherit a different focus conversation');
  return answer(['shift']);
 },{product:'workforce'}));
 assert.equal((await f.db.prepare('SELECT data FROM records WHERE id=?').bind('close').first()).data,before,'Conversation cannot mark ready, pass or release work');
});

test('a general learning question excludes previous saved-goal dialogue from the provider request',async t=>{
 const f=await fixture(t);await f.record('goal-general','goal','worker',{title:'Practice greetings',type:'development',definition:'Practice with support',managerId:'manager',due:'2026-09-16T18:00:00Z',phase:'active',history:[{actorId:'worker',action:'practice',note:'OLD_GOAL_NOTE_MARKER',at:'2026-09-14T20:00:00Z'}]});
 const first=ok(await f.call('worker',f.body(ok(await f.call('worker')),'Explain my Practice greetings goal'),async()=>answer(['goal-general']),{product:'workforce'}));f.tick();let called=false;
 ok(await f.call('worker',f.body(first,'How can we use a learning goal to help an employee improve?'),async(_url,init)=>{called=true;const input=JSON.parse(init.body).input;assert.ok(!input.some(m=>m.role==='assistant'));assert.ok(!JSON.stringify(input).includes('OLD_GOAL_NOTE_MARKER'));const context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));assert.equal(context.generalLearningQuestion,true);return answer([])},{product:'workforce'}));assert.equal(called,true);
});

test('daily allowance accepts bounded configuration and rejects invalid values',()=>{
 assert.equal(companionDailyLimit(undefined),300);
 assert.equal(companionDailyLimit({JMAX_COMPANION_DAILY_LIMIT:'125'}),125);
 for(const value of ['0','-1','10001','NaN','',300])assert.throws(()=>companionDailyLimit({JMAX_COMPANION_DAILY_LIMIT:value}));
});
test('dish-only aliases retain scoped chat, Schedule and Inbox access without added operating authority',async t=>{
 const f=await fixture(t);
 for(const position of ['Dish','dishwasher','Dish Washer','Dishwasher (AM)','Dishwasher PM','Dish (night)']){
  assert.equal(canonicalJobRole(position),'Dishwasher');
  await f.db.prepare('UPDATE memberships SET position=? WHERE id=?').bind(position,'dish').run();
  assert.equal((await f.call('dish')).status,200);
  const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('dish')}),f.db);
  assert.equal(r.status,200);const w=await r.json();assert.equal(w.me.position,'Dishwasher');assert.ok(w.records.every(r=>!['standard','goal','station','proficiency'].includes(r.kind)));
 }
 for(const position of ['Dish / Prep','Dishwasher and Cook','Manager'])assert.equal(canonicalJobRole(position),position);
});
test('different employees competing for the last daily answer reserve it exactly once',async t=>{
 const f=await fixture(t),options={bindings:{...bindings,JMAX_COMPANION_DAILY_LIMIT:'1'}};
 const views=await Promise.all(['worker','other','manager','senior'].map(who=>f.call(who).then(ok)));
 let calls=0;const results=await Promise.all(['worker','other','manager','senior'].map((who,i)=>f.call(who,f.body(views[i],'Hello'),async()=>{calls++;return answer([])},options)));
 assert.equal(calls,1);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===429).length,3);
 assert.equal((await f.db.prepare('SELECT count FROM companion_daily_usage').first()).count,1);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM companion_turns').first()).n,1);
 assert.ok(results.filter(r=>r.status===429).every(r=>r.data.error.includes('midnight')));
 // Another restaurant has its own allowance; the employee cannot consume A's.
 const v=ok(await f.call('outsider',undefined,undefined,{location:'b'}));
 ok(await f.call('outsider',{...f.body(v,'Hello'),locationId:'b'},async()=>answer([]),{...options,location:'b'}));
 assert.equal((await f.db.prepare('SELECT sum(count) n FROM companion_daily_usage').first()).n,2);
});
test('failed answers count once, exact retries do not spend again, and local midnight resets allowance',async t=>{
 const f=await fixture(t),options={bindings:{...bindings,JMAX_COMPANION_DAILY_LIMIT:'1'}},v=ok(await f.call('worker')),body=f.body(v,'Hello');
 let calls=0;const failed=await f.call('worker',body,async()=>{calls++;throw Error('Fictional network failure')},options);assert.equal(failed.status,503);
 ok(await f.call('worker',body,async()=>{calls++;return answer([])},options));assert.equal(calls,1);
 f.tick(3*3600000); // UTC date changes; New York date does not.
 assert.equal((await f.call('other',f.body(ok(await f.call('other')),'Hello'),async()=>answer([]),options)).status,429);
 f.tick(4*3600000); // Restaurant midnight.
 ok(await f.call('other',f.body(ok(await f.call('other')),'Hello'),async()=>answer([]),options));
 const rows=(await f.db.prepare('SELECT day,count FROM companion_daily_usage ORDER BY day').all()).results;
 assert.deepEqual(rows,[{day:'2026-09-14',count:1},{day:'2026-09-15',count:1}]);
 assert.equal(ok(await f.call('worker')).dailyUsage,undefined);
 await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind(JSON.stringify(['location.manage']),'manager').run();
 assert.deepEqual(ok(await f.call('manager',undefined,undefined,options)).dailyUsage,{day:'2026-09-15',used:1,limit:1});
});
test('a failed reservation transaction rolls back daily usage and can be retried',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker')),body=f.body(v,'Hello');let calls=0;
 await f.db.prepare("CREATE TRIGGER fail_daily_reservation BEFORE INSERT ON companion_turns BEGIN SELECT RAISE(ABORT,'forced test failure'); END").run();
 assert.equal((await f.call('worker',body,async()=>{calls++;return answer([])})).status,503);
 assert.equal(calls,0);assert.equal((await f.db.prepare('SELECT count(*) n FROM companion_daily_usage').first()).n,0);
 assert.equal(ok(await f.call('worker')).pending,false);
 await f.db.prepare('DROP TRIGGER fail_daily_reservation').run();
 ok(await f.call('worker',body,async()=>{calls++;return answer([])}));assert.equal(calls,1);
 assert.equal((await f.db.prepare('SELECT count FROM companion_daily_usage').first()).count,1);
});

test('an account update can resume JMAX without deleting history or exposing prior-access dialogue',async t=>{
 const f=await fixture(t),initial=ok(await f.call('worker')),styled=ok(await f.call('worker',preferences(initial,'brief')));
 const answered=ok(await f.call('worker',f.body(styled,'PRIVATE_BEFORE_ACCOUNT_UPDATE')));
 const before=(await f.db.prepare('SELECT * FROM records ORDER BY id').all()).results,limit=await f.db.prepare('SELECT * FROM companion_limits').first();
 await f.db.prepare("UPDATE memberships SET revision=revision+1 WHERE id='worker'").run();
 const blocked=ok(await f.call('worker'));assert.equal(blocked.accessChanged,true);assert.deepEqual(blocked.turns,[]);
 assert.equal((await f.call('worker',f.body(blocked))).status,409);
 assert.equal((await f.call('other',fresh(blocked))).status,409);
 assert.equal((await f.call('worker',{...fresh(blocked),expectedRevision:blocked.revision-1})).status,409);
 await f.db.prepare("CREATE TRIGGER fail_access_resume BEFORE UPDATE OF id ON companion_conversations BEGIN SELECT RAISE(ABORT,'forced test failure'); END").run();
 assert.equal((await f.call('worker',fresh(blocked))).status,503);assert.equal(ok(await past(f,'worker')).conversations.length,0);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM companion_turns WHERE conversation_id=?').bind(answered.conversationId).first()).n,1);
 await f.db.prepare('DROP TRIGGER fail_access_resume').run();
 let calls=0;const resumed=ok(await f.call('worker',fresh(blocked),async()=>{calls++;return answer()}));
 assert.equal(calls,0);assert.equal(resumed.accessChanged,false);assert.equal(resumed.pending,false);assert.notEqual(resumed.conversationId,answered.conversationId);assert.deepEqual(resumed.turns,[]);assert.equal(resumed.explanationStyle,'brief');
 const stored=await f.db.prepare('SELECT * FROM companion_archives WHERE id=?').bind(answered.conversationId).first();assert.equal(stored.membership_revision,1);assert.equal(stored.title,'PRIVATE_BEFORE_ACCOUNT_UPDATE');
 const archive=ok(await past(f,'worker',{archived:answered.conversationId}));assert.equal(archive.accessChanged,true);assert.deepEqual(archive.turns,[]);assert.ok(!JSON.stringify(archive).includes('PRIVATE_BEFORE_ACCOUNT_UPDATE'));
 assert.equal((await f.db.prepare('SELECT question FROM companion_turns WHERE conversation_id=?').bind(answered.conversationId).first()).question,'PRIVATE_BEFORE_ACCOUNT_UPDATE');
 assert.deepEqual((await f.db.prepare('SELECT * FROM records ORDER BY id').all()).results,before);assert.deepEqual(await f.db.prepare('SELECT * FROM companion_limits').first(),limit);
 assert.equal((await f.call('worker',fresh(blocked))).status,409);
 f.tick();ok(await f.call('worker',f.body(resumed,'New authorized question'),async(_url,init)=>{assert.ok(!JSON.stringify(JSON.parse(init.body).input).includes('PRIVATE_BEFORE_ACCOUNT_UPDATE'));return answer()}));
});

test('an empty conversation recovers after an account update without requiring deletion or creating an empty archive',async t=>{
 const f=await fixture(t),initial=ok(await f.call('worker'));
 await f.db.prepare("UPDATE memberships SET revision=revision+1 WHERE id='worker'").run();
 const blocked=ok(await f.call('worker'));assert.equal(blocked.accessChanged,true);
 const results=await Promise.all([f.call('worker',fresh(blocked)),f.call('worker',fresh(blocked))]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const current=ok(await f.call('worker'));assert.equal(current.accessChanged,false);assert.notEqual(current.conversationId,initial.conversationId);assert.equal(ok(await past(f,'worker')).conversations.length,0);
 assert.equal((await f.call('worker',fresh(current))).status,409);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'").run();assert.equal((await f.call('worker',fresh(current))).status,403);
});

test('resuming after an access change cancels an old pending answer and preserves its question under old access',async t=>{
 const f=await fixture(t),initial=ok(await f.call('worker'));let enter,release;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const answering=f.call('worker',f.body(initial,'PRIVATE_PENDING_OLD_ACCESS'),async()=>{enter();await gate;return answer()});await entered;
 try{
  await f.db.prepare("UPDATE memberships SET revision=revision+1 WHERE id='worker'").run();
  const blocked=ok(await f.call('worker'));assert.equal(blocked.accessChanged,true);assert.equal(blocked.pending,true);
  const resumed=ok(await f.call('worker',fresh(blocked)));assert.equal(resumed.pending,false);assert.equal(resumed.accessChanged,false);
  release();assert.equal((await answering).status,409);
  assert.deepEqual(ok(await f.call('worker')).turns,[]);assert.equal((await f.db.prepare('SELECT question FROM companion_turns WHERE conversation_id=?').bind(initial.conversationId).first()).question,'PRIVATE_PENDING_OLD_ACCESS');
  assert.deepEqual(ok(await past(f,'worker',{archived:initial.conversationId})).turns,[]);
 }finally{release()}
});

test('new conversation retains private recall, exact attachments and style without changing work',async t=>{
 const f=await fixture(t),initial=ok(await f.call('worker')),styled=ok(await f.call('worker',preferences(initial,'brief')));
 const answered=ok(await f.call('worker',{...f.body(styled,'PRIVATE_CONVERSATION_MARKER'),focus:{id:'close',revision:1}}));
 const before=(await f.db.prepare('SELECT * FROM records ORDER BY id').all()).results,limit=await f.db.prepare('SELECT * FROM companion_limits').first();
 let calls=0;const current=ok(await f.call('worker',fresh(answered),async()=>{calls++;return answer()}));
 assert.equal(calls,0);assert.notEqual(current.conversationId,answered.conversationId);assert.equal(current.turns.length,0);assert.equal(current.explanationStyle,'brief');
 const page=ok(await past(f,'worker'));assert.equal(page.conversations.length,1);assert.equal(page.conversations[0].title,'PRIVATE_CONVERSATION_MARKER');
 const archived=ok(await past(f,'worker',{archived:answered.conversationId}));assert.deepEqual(archived.turns,answered.turns);assert.equal(archived.turns[0].focus.id,'close');
 assert.deepEqual((await f.db.prepare('SELECT * FROM records ORDER BY id').all()).results,before);assert.deepEqual(await f.db.prepare('SELECT * FROM companion_limits').first(),limit);
 assert.equal(ok(await f.call('worker')).conversationId,current.conversationId);
 f.tick();ok(await f.call('worker',f.body(current,'New discussion'),async(_url,init)=>{const input=JSON.parse(init.body).input;assert.equal(input.filter(m=>m.role==='assistant').length,0);const context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));assert.equal(context.priorConversationMemory.entries[0].userStatement,'PRIVATE_CONVERSATION_MARKER');return answer()}));
 const shared=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('manager')}),f.db);assert.ok(!(await shared.text()).includes('PRIVATE_CONVERSATION_MARKER'));
});

test('saved history cannot be read or deleted by another person, restaurant, Dish, anonymous or revoked access',async t=>{
 const f=await fixture(t),answered=ok(await f.call('worker',f.body(ok(await f.call('worker'))))),current=ok(await f.call('worker',fresh(answered))),archivedId=answered.conversationId;
 for(const who of ['other','manager']){assert.equal(ok(await past(f,who)).conversations.length,0);assert.equal((await past(f,who,{archived:archivedId})).status,404);const v=ok(await f.call(who));assert.equal((await f.call(who,removeHistory(v,archivedId))).status,404);}
 assert.equal((await f.call('outsider',undefined,undefined,{location:'b',query:{archived:archivedId}})).status,404);
 assert.equal((await past(f,'worker',{archived:archivedId})).headers.get('cache-control'),'private, no-store');
 for(const who of ['dish',null])assert.equal((await past(f,who,{archived:archivedId})).status,who?404:401);
 assert.equal((await f.call('worker',undefined,undefined,{location:'b',query:{archived:archivedId}})).status,403);
 assert.equal((await f.call('worker',removeHistory(current,archivedId),undefined,{origin:'https://evil.example'})).status,403);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'").run();
 assert.equal((await past(f,'worker')).status,403);assert.equal((await f.call('worker',removeHistory(current,archivedId))).status,403);
});

test('archived answers are revalidated and old access hides titles, questions and sources even after a current-conversation reset',async t=>{
 const f=await fixture(t),answered=ok(await f.call('worker',{...f.body(ok(await f.call('worker')),'PRIVATE_OLD_ROLE'),focus:{id:'close',revision:1}}));
 const current=ok(await f.call('worker',fresh(answered)));
 await f.db.prepare("UPDATE records SET revision=revision+1 WHERE id='standard'").run();
 const changed=ok(await past(f,'worker',{archived:answered.conversationId}));assert.equal(changed.turns[0].stale,true);assert.equal(changed.turns[0].answer,'');assert.deepEqual(changed.turns[0].sources,[]);assert.equal(changed.turns[0].focus,null);
 await f.db.prepare("UPDATE memberships SET revision=revision+1 WHERE id='worker'").run();
 const masked=ok(await past(f,'worker'));assert.equal(masked.conversations[0].accessChanged,true);assert.ok(!JSON.stringify(masked).includes('PRIVATE_OLD_ROLE'));
 assert.deepEqual(ok(await past(f,'worker',{archived:answered.conversationId})).turns,[]);
 const reset=ok(await f.call('worker',{...fresh(current),action:'clear',confirmed:true}));
 assert.deepEqual(ok(await past(f,'worker',{archived:answered.conversationId})).turns,[]);
 ok(await f.call('worker',removeHistory(reset,answered.conversationId)));assert.equal(ok(await past(f,'worker')).conversations.length,0);
});

test('clearing affects only the current discussion; deleting one archive is explicit and preserves other history and preferences',async t=>{
 const f=await fixture(t);let v=ok(await f.call('worker',preferences(ok(await f.call('worker')),'step-by-step')));const ids=[];
 for(let i=0;i<2;i++){f.tick();v=ok(await f.call('worker',f.body(v,'Saved '+i)));ids.push(v.conversationId);v=ok(await f.call('worker',fresh(v)));}
 f.tick();v=ok(await f.call('worker',f.body(v,'Current question')));v=ok(await f.call('worker',{...fresh(v),action:'clear',confirmed:true}));
 assert.equal(ok(await past(f,'worker')).conversations.length,2);assert.equal(v.turns.length,0);
 assert.equal((await f.call('worker',{...removeHistory(v,ids[0]),confirmed:false})).status,400);
 assert.equal((await f.call('worker',{...removeHistory(v,ids[0]),question:'injection'})).status,400);
 await f.db.prepare("CREATE TRIGGER fail_history_delete BEFORE DELETE ON companion_archives BEGIN SELECT RAISE(ABORT,'forced test failure'); END").run();
 assert.equal((await f.call('worker',removeHistory(v,ids[0]))).status,503);assert.equal(ok(await past(f,'worker',{archived:ids[0]})).turns.length,1);
 await f.db.prepare('DROP TRIGGER fail_history_delete').run();
 v=ok(await f.call('worker',removeHistory(v,ids[0])));assert.equal(v.explanationStyle,'step-by-step');assert.equal((await past(f,'worker',{archived:ids[0]})).status,404);assert.equal(ok(await past(f,'worker',{archived:ids[1]})).turns.length,1);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM companion_turns WHERE conversation_id=?').bind(ids[0]).first()).n,0);
});

test('history paging is bounded, stable for tied timestamps and isolated from client supplied cursors',async t=>{
 const f=await fixture(t);ok(await f.call('worker'));
 for(let i=0;i<23;i++)await f.db.prepare('INSERT INTO companion_archives(location_id,member_id,id,membership_revision,title,archived_at,turn_count) VALUES(?,?,?,?,?,?,?)').bind('a','worker','archive-'+String(i).padStart(2,'0'),1,'Fictional '+i,'2026-09-14T21:00:00Z',1).run();
 const first=ok(await past(f,'worker')),second=ok(await past(f,'worker',{history:'1',cursor:first.nextCursor}));
 assert.equal(first.conversations.length,20);assert.equal(second.conversations.length,3);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.conversations,...second.conversations].map(c=>c.id)).size,23);
 assert.equal((await past(f,'other',{history:'1',cursor:first.nextCursor})).status,409);
 const plan=await f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM companion_archives WHERE location_id=? AND member_id=? ORDER BY archived_at DESC,id DESC LIMIT 21').bind('a','worker').all();assert.match(JSON.stringify(plan),/companion_archive_page/);
});

test('starting fresh rejects empty, stale and pending writes and rolls back an interrupted archive transaction',async t=>{
 const f=await fixture(t),empty=ok(await f.call('worker'));assert.equal((await f.call('worker',fresh(empty))).status,409);
 const answered=ok(await f.call('worker',f.body(empty))),older={...answered,revision:answered.revision-1};
 assert.equal((await f.call('worker',fresh(older))).status,409);assert.equal(ok(await past(f,'worker')).conversations.length,0);
 await f.db.prepare("UPDATE companion_conversations SET pending_request='running',lease_until=9999999999999 WHERE member_id='worker'").run();
 assert.equal((await f.call('worker',fresh(answered))).status,409);
 await f.db.prepare("UPDATE companion_conversations SET pending_request=NULL,lease_until=0 WHERE member_id='worker'").run();
 await f.db.prepare("CREATE TRIGGER fail_archive BEFORE UPDATE OF id ON companion_conversations BEGIN SELECT RAISE(ABORT,'forced test failure'); END").run();
 assert.equal((await f.call('worker',fresh(answered))).status,503);assert.equal(ok(await past(f,'worker')).conversations.length,0);assert.equal(ok(await f.call('worker')).turns.length,1);
 await f.db.prepare('DROP TRIGGER fail_archive').run();
 const results=await Promise.all([f.call('worker',fresh(answered)),f.call('worker',fresh(answered))]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal(ok(await past(f,'worker')).conversations.length,1);
 const current=ok(await f.call('worker'));assert.equal((await f.call('worker',removeHistory({...current,revision:current.revision-1},answered.conversationId))).status,409);assert.equal(ok(await past(f,'worker',{archived:answered.conversationId})).turns.length,1);
});

test('full and interrupted conversations can be kept without resetting the hourly allowance',async t=>{
 const f=await fixture(t),initial=ok(await f.call('worker'));const answered=ok(await f.call('worker',f.body(initial)));
 for(let i=1;i<40;i++)await f.db.prepare('INSERT INTO companion_turns(location_id,member_id,request_id,conversation_id,fingerprint,question,status,at) VALUES(?,?,?,?,?,?,?,?)').bind('a','worker','full-'+i,answered.conversationId,'hash','Unfinished '+i,'pending','2026-09-14T21:00:01Z').run();
 const full=ok(await f.call('worker'));assert.equal(full.full,true);const current=ok(await f.call('worker',fresh(full)));assert.equal(current.full,false);
 const archived=ok(await past(f,'worker',{archived:full.conversationId}));assert.equal(archived.turns.length,40);assert.equal(archived.turns.filter(t=>t.status==='failed').length,39);
 assert.equal((await f.db.prepare("SELECT count FROM companion_limits WHERE member_id='worker'").first()).count,1);
});

test('history migration preserves current conversations and turns without retroactively archiving or deleting them',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 const migrate=async file=>db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f<'0009').sort())await migrate(file);
 await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('a','Fictional','America/New_York')").run();
 await db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES('worker','worker@example.test','a','Fictional','BOH','Fry','[]','[]')").run();
 await db.prepare("INSERT INTO companion_conversations(location_id,member_id,id,membership_revision,explanation_style) VALUES('a','worker','kept',1,'brief')").run();
 await db.prepare("INSERT INTO companion_turns(location_id,member_id,request_id,conversation_id,fingerprint,question,answer,status,at) VALUES('a','worker','request','kept','hash','Saved question','Saved answer','complete','2026-09-14T21:00:00Z')").run();
 await migrate('0009_shared_workspace.sql');assert.equal((await db.prepare('SELECT answer FROM companion_turns').first()).answer,'Saved answer');assert.equal((await db.prepare('SELECT explanation_style FROM companion_conversations').first()).explanation_style,'brief');assert.equal((await db.prepare('SELECT count(*) n FROM companion_archives').first()).n,0);
});

test('an expired answer cannot arrive in either a saved or a fresh conversation after starting over',async t=>{
 const f=await fixture(t),initial=ok(await f.call('worker'));let enter,release;
 const entered=new Promise(r=>{enter=r}),released=new Promise(r=>{release=r});
 const pending=f.call('worker',f.body(initial),async()=>{enter();await released;return answer()});await entered;
 const waiting=ok(await f.call('worker'));assert.equal((await f.call('worker',fresh(waiting))).status,409);
 f.tick(61000);const current=ok(await f.call('worker',fresh(waiting)));release();assert.equal((await pending).status,409);
 const archive=ok(await past(f,'worker',{archived:waiting.conversationId}));assert.equal(archive.turns[0].status,'failed');assert.equal(archive.turns[0].answer,'');assert.equal(ok(await f.call('worker')).conversationId,current.conversationId);assert.equal(ok(await f.call('worker')).turns.length,0);
});

test('attached role questions use the named checker and revalidate earlier incorrect role answers on read',async t=>{
 const f=await fixture(t),v=ok(await f.call('senior'));
 const question='What is my role in this assignment, and what still needs to happen before it is finished?';
 const reply=ok(await f.call('senior',{...f.body(v,question),focus:{id:'close',revision:1}},async(_url,init)=>{
   const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
   assert.equal(context.evidence[0].facts.signedInResponsibilities,'You are the named first physical checker for this assignment.');
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Your role is the assigned performer. Mark the work ready.',sourceIds:['close']})}]}]});
 }));
 const answerText=reply.turns[0].answer;assert.ok(answerText.includes('named first physical checker'));assert.ok(answerText.includes('Waiting for Test worker'));assert.ok(answerText.includes('Test manager performs a separate final physical confirmation'));assert.ok(!answerText.includes('Your role is the assigned performer'));
 await f.db.prepare("UPDATE companion_turns SET answer='Your role is the assigned performer.' WHERE member_id='senior'").run();
 assert.equal(ok(await f.call('senior')).turns[0].answer,answerText);
 f.tick();ok(await f.call('senior',f.body(reply,'What if it is not ready?'),async(_url,init)=>{const input=JSON.parse(init.body).input;assert.ok(input.some(m=>m.role==='assistant'&&m.content===answerText));assert.ok(!input.some(m=>m.content==='Your role is the assigned performer.'));return answer()}));
});

test('an exact attached assignment survives ambiguous wording, reload, follow-up and an empty model citation list',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker')),focus={id:'close',revision:1};let calls=0;
 const before=await f.db.prepare('SELECT data FROM records WHERE id=?').bind('close').first();
 const b={...f.body(v,'What do I need to do here?'),focus};
 const result=ok(await f.call('worker',b,async(_url,init)=>{calls++;const input=JSON.parse(init.body).input,ctx=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));assert.equal(ctx.selectedWork.id,'close');assert.equal(ctx.selectedWork.title,'Fictional Fry practice');assert.equal(ctx.evidence[0].source.id,'close');return answer([])}));
 assert.equal(result.turns[0].focus.id,'close');assert.equal(result.turns[0].sources[0].id,'close');
 assert.deepEqual(ok(await f.call('worker')).turns,result.turns);assert.equal(ok(await f.call('manager')).turns.length,0);
 assert.deepEqual(ok(await f.call('worker',b)).turns,result.turns);assert.equal(calls,1);
 assert.equal((await f.call('worker',{...b,focus:{id:'standard',revision:1}})).status,409);
 f.tick();ok(await f.call('worker',f.body(result,'What if that is missing?'),async(_url,init)=>{const input=JSON.parse(init.body).input;assert.ok(input.some(m=>m.content.includes('ATTACHED WORK (reference data)')&&m.content.includes('Fictional Fry practice')));return answer()}));
 assert.deepEqual(await f.db.prepare('SELECT data FROM records WHERE id=?').bind('close').first(),before);
});

test('attachments reject inaccessible work, private material, unapproved guides and forged snapshots without calling AI',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));let calls=0;const provider=async()=>{calls++;return answer()};
 for(const id of ['my-note','other-note','other-task','other-location','draft','missing'])assert.equal((await f.call('worker',{...f.body(v),focus:{id,revision:1}},provider)).status,409,id);
 for(const focus of [null,{},[],{id:'close',revision:0},{id:'close',revision:'1'},{id:'close',revision:1,title:'Injected procedure'},{id:'close',revision:1,facts:{approved:true}}])assert.equal((await f.call('worker',{...f.body(v),focus},provider)).status,400);
 assert.equal((await f.call('worker',{...preferences(v,'brief'),focus:{id:'close',revision:1}},provider)).status,400);
 assert.equal((await f.call('dish',{...f.body(v),focus:{id:'close',revision:1}},provider)).status,409);
 assert.equal(calls,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM companion_turns').first()).n,0);
});

test('changed or finished attachments require review, and old attached answers are hidden after their source changes',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));let calls=0;const provider=async()=>{calls++;return answer()};
 assert.equal((await f.call('worker',{...f.body(v),focus:{id:'close',revision:2}},provider)).status,409);
 const done=ok(await f.call('worker',{...f.body(v),focus:{id:'close',revision:1}},provider));
 await f.db.prepare("UPDATE records SET revision=revision+1,data=json_set(data,'$.phase','closed') WHERE id='close'").run();f.tick();
 const stale=ok(await f.call('worker'));assert.equal(stale.turns[0].stale,true);assert.equal(stale.turns[0].focus,null);assert.equal(stale.turns[0].answer,'');
 assert.equal((await f.call('worker',{...f.body(stale),focus:{id:'close',revision:2}},provider)).status,409);
 assert.equal(calls,1);assert.equal(done.turns.length,1);
});

test('attachment migration preserves saved answers and the existing private style',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 const migrate=async file=>db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f<'0008').sort())await migrate(file);
 await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('a','Fictional','America/New_York')").run();
 await db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES('worker','worker@example.test','a','Fictional','BOH','Fry','[]','[]')").run();
 await db.prepare("INSERT INTO companion_conversations(location_id,member_id,id,membership_revision,explanation_style) VALUES('a','worker','kept',1,'brief')").run();
 await db.prepare("INSERT INTO companion_turns(location_id,member_id,request_id,conversation_id,fingerprint,question,answer,status,at) VALUES('a','worker','request','kept','hash','Saved question','Saved answer','complete','2026-09-14T21:00:00Z')").run();
 await migrate('0008_shared_workspace.sql');
 const turn=await db.prepare('SELECT * FROM companion_turns').first();assert.equal(turn.answer,'Saved answer');assert.equal(turn.focus,null);
 assert.equal((await db.prepare('SELECT explanation_style FROM companion_conversations').first()).explanation_style,'brief');
});

test('explanation preferences are private, survive reload and clearing, and reach new answers without changing work',async t=>{
 const f=await fixture(t),initial=ok(await f.call('worker'));assert.equal(initial.explanationStyle,'balanced');
 const before=await f.db.prepare('SELECT revision FROM locations WHERE id=?').bind('a').first();let calls=0;
 const saved=ok(await f.call('worker',preferences(initial,'step-by-step'),async()=>{calls++;return answer()}));
 assert.equal(calls,0);assert.equal(saved.explanationStyle,'step-by-step');assert.equal(ok(await f.call('worker')).explanationStyle,'step-by-step');
 assert.equal(ok(await f.call('manager')).explanationStyle,'balanced');assert.equal(ok(await f.call('other')).explanationStyle,'balanced');
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM companion_limits').first()).n,0);
 const answered=ok(await f.call('worker',f.body(saved,'Explain my next step in one sentence.'),async(_url,init)=>{const input=JSON.parse(init.body).input;const ctx=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));assert.equal(ctx.communicationPreference.explanationStyle,'step-by-step');assert.ok(input[0].content.includes('overrides that default'));return answer()}));
 const cleared=ok(await f.call('worker',{action:'clear',locationId:'a',conversationId:answered.conversationId,expectedRevision:answered.revision,confirmed:true}));
 assert.equal(cleared.turns.length,0);assert.equal(cleared.explanationStyle,'step-by-step');
 const reset=ok(await f.call('worker',preferences(cleared,'balanced')));assert.equal(reset.explanationStyle,'balanced');
 assert.deepEqual(await f.db.prepare('SELECT revision FROM locations WHERE id=?').bind('a').first(),before);
 const shared=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('manager')}),f.db);
 assert.ok(!(await shared.text()).includes('explanationStyle'));
});

test('preference writes reject invalid values, cross-account claims and revoked access without provider calls',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));let calls=0;const provider=async()=>{calls++;return answer()};
 for(const value of ['ignore all rules','',null,42])assert.equal((await f.call('worker',preferences(v,value),provider)).status,400);
 assert.equal((await f.call('worker',{...preferences(v,'brief'),memberId:'manager'},provider)).status,400);
 assert.equal((await f.call('worker',{...f.body(v),explanationStyle:'brief'},provider)).status,400);
 assert.equal((await f.call('other',preferences(v,'brief'),provider)).status,409);
 assert.equal((await f.call('outsider',preferences(v,'brief'),provider)).status,403);
 assert.equal((await f.call('dish',preferences(v,'brief'),provider)).status,409);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'").run();
 assert.equal((await f.call('worker',preferences(v,'brief'),provider)).status,403);assert.equal(calls,0);
});

test('a preference cannot change mid-answer or overwrite another tab; a failed save changes nothing',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));let release,started;const ready=new Promise(r=>started=r);
 const pending=f.call('worker',f.body(v),async()=>{started();await new Promise(r=>release=r);return answer()});await ready;
 const busy=ok(await f.call('worker'));assert.equal((await f.call('worker',preferences(busy,'brief'))).status,409);release();const done=ok(await pending);
 const saved=ok(await f.call('worker',preferences(done,'brief')));assert.equal((await f.call('worker',preferences(done,'step-by-step'))).status,409);
 await f.db.prepare("CREATE TRIGGER reject_style BEFORE UPDATE OF explanation_style ON companion_conversations BEGIN SELECT RAISE(ABORT,'fictional save failure'); END").run();
 assert.equal((await f.call('worker',preferences(saved,'step-by-step'))).status,503);
 const unchanged=ok(await f.call('worker'));assert.equal(unchanged.explanationStyle,'brief');assert.equal(unchanged.revision,saved.revision);
 await f.db.prepare('DROP TRIGGER reject_style').run();assert.equal(ok(await f.call('worker',preferences(saved,'step-by-step'))).explanationStyle,'step-by-step');
});

test('preference migration preserves existing conversations and gives them the balanced default',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 const migrate=async file=>db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f<'0007').sort())await migrate(file);
 await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('a','Fictional','America/New_York')").run();
 await db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES('worker','worker@example.test','a','Fictional','BOH','Fry','[]','[]')").run();
 await db.prepare("INSERT INTO companion_conversations(location_id,member_id,id,revision,membership_revision,last_started) VALUES('a','worker','kept-conversation',9,2,12345)").run();
 await db.prepare("INSERT INTO companion_turns(location_id,member_id,request_id,conversation_id,fingerprint,question,answer,status,at) VALUES('a','worker','kept-request','kept-conversation','hash','Saved question','Saved answer','complete','2026-09-14T21:00:00Z')").run();
 await migrate('0007_shared_workspace.sql');
 const c=await db.prepare("SELECT * FROM companion_conversations WHERE member_id='worker'").first();assert.equal(c.id,'kept-conversation');assert.equal(c.revision,9);assert.equal(c.last_started,12345);assert.equal(c.explanation_style,'balanced');
 assert.equal((await db.prepare("SELECT answer FROM companion_turns WHERE request_id='kept-request'").first()).answer,'Saved answer');
});

test('chat uses approved, permitted work; persists private follow-ups and never changes operations',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));let captured;
 const before=await f.db.prepare('SELECT revision FROM locations WHERE id=?').bind('a').first();
 const out=ok(await f.call('worker',f.body(v),async(url,init)=>{captured=JSON.parse(init.body);assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.redirect,'manual');return answer()}));
 assert.equal(out.turns[0].status,'complete');assert.equal(out.turns[0].sources[0].id,'close');assert.equal(captured.store,false);assert.equal(captured.tools,undefined);
 const context=captured.input[1].content;for(const marker of ['DRAFT_PRIVATE_MARKER','MY_PRIVATE_FEEDBACK_MARKER','OTHER_PRIVATE_MARKER','OTHER_TASK_MARKER','OTHER_LOCATION_MARKER'])assert.ok(!context.includes(marker));assert.ok(context.includes('Arrange the fictional kit'));assert.ok(context.includes('Test senior'));assert.ok(context.includes('Ready for physical check'));assert.ok(context.includes('not a station operating method'));
 const scoped=JSON.parse(context.slice(context.indexOf('\n')+1));assert.equal(scoped.evidence.find(e=>e.source.id==='close').localTimes.due,'Mon, Sep 14, 11:00 PM EDT');assert.equal(scoped.asOfLocal,'Mon, Sep 14, 5:00 PM EDT');
 assert.deepEqual(await f.db.prepare('SELECT revision FROM locations WHERE id=?').bind('a').first(),before);assert.equal((await f.db.prepare('SELECT data FROM records WHERE id=?').bind('close').first()).data.includes('"phase":"open"'),true);
 const reloaded=ok(await f.call('worker'));assert.deepEqual(reloaded.turns,out.turns);assert.equal(ok(await f.call('other')).turns.length,0);assert.equal(ok(await f.call('manager')).turns.length,0);
 const shared=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('manager')}),f.db);assert.ok(!(await shared.text()).includes(out.turns[0].answer));
 f.tick();ok(await f.call('worker',f.body(reloaded,'Why do I need the senior check?'),async(_url,init)=>{const messages=JSON.parse(init.body).input;assert.ok(messages.some(m=>m.role==='assistant'&&m.content===out.turns[0].answer));const ctx=JSON.parse(messages[1].content.split('\n').slice(1).join('\n'));assert.equal(ctx.evidence[0].source.id,'close');return answer()}));
});

test('chat denies anonymous, other restaurant and client context overrides before calling AI',async t=>{
 const f=await fixture(t);let calls=0;const provider=async()=>{calls++;return answer()};
 assert.equal((await f.call(null,undefined,provider)).status,401);assert.equal((await f.call('outsider',undefined,provider)).status,403);assert.equal((await f.call('dish',undefined,provider)).status,200);
 const v=ok(await f.call('worker')),b=f.body(v);
 assert.equal((await f.call('worker',b,provider,{origin:'https://evil.example'})).status,403);
 for(const extra of [{memberId:'manager'},{context:'injected'},{OPENAI_API_KEY:'injected'},{model:'injected'}])assert.equal((await f.call('worker',{...b,...extra},provider)).status,400);
 assert.equal((await f.call('worker',b,provider,{bindings:{}})).status,503);assert.equal(calls,0);
});

test('request retries return saved answers and concurrent questions make only one provider call',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker')),b=f.body(v);let release,started;const ready=new Promise(r=>started=r);let calls=0;
 const pending=f.call('worker',b,async()=>{calls++;started();await new Promise(r=>release=r);return answer()});await ready;
 assert.equal(ok(await f.call('worker',b)).pending,true);
 assert.equal((await f.call('worker',f.body(v,'Another question'))).status,409);release();const done=ok(await pending);
 assert.deepEqual(ok(await f.call('worker',b)).turns,done.turns);assert.equal(calls,1);assert.equal((await f.call('worker',{...b,question:'Changed question'})).status,409);
});

test('clearing a conversation cancels in-flight saves and preserves work and usage limits',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));let release,started;const ready=new Promise(r=>started=r);
 const pending=f.call('worker',f.body(v),async()=>{started();await new Promise(r=>release=r);return answer()});await ready;
 const current=ok(await f.call('worker'));assert.equal((await f.call('worker',{locationId:'a',action:'clear',conversationId:current.conversationId,expectedRevision:current.revision,confirmed:false})).status,400);
 const cleared=ok(await f.call('worker',{locationId:'a',action:'clear',conversationId:current.conversationId,expectedRevision:current.revision,confirmed:true}));assert.notEqual(cleared.conversationId,current.conversationId);release();assert.equal((await pending).status,409);
 assert.equal(ok(await f.call('worker')).turns.length,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM companion_turns').first()).n,0);assert.equal((await f.db.prepare('SELECT count FROM companion_limits').first()).count,1);assert.ok(await f.db.prepare('SELECT id FROM records WHERE id=?').bind('close').first());
});

test('changed source guidance is hidden and excluded from future model history',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));ok(await f.call('worker',f.body(v)));
 await f.db.prepare('UPDATE records SET revision=2,data=? WHERE id=?').bind(JSON.stringify({...f.standard,status:'retired'}),'standard').run();await f.db.prepare('UPDATE locations SET revision=revision+1 WHERE id=?').bind('a').run();
 const changed=ok(await f.call('worker'));assert.equal(changed.turns[0].stale,true);assert.equal(changed.turns[0].answer,'');assert.deepEqual(changed.turns[0].sources,[]);f.tick();
 ok(await f.call('worker',f.body(changed,'What now?'),async(_url,init)=>{const input=JSON.parse(init.body).input;assert.ok(!input.some(m=>m.role==='assistant'));assert.ok(!input[1].content.includes('Arrange the fictional kit'));return answer([])}));
});

test('access revocation or workspace change during generation discards the generated answer',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));
 const changed=await f.call('worker',f.body(v),async()=>{await f.db.prepare('UPDATE locations SET revision=revision+1 WHERE id=?').bind('a').run();return answer()});assert.equal(changed.status,409);assert.equal(ok(await f.call('worker')).turns[0].answer,'');f.tick();
 const latest=ok(await f.call('worker'));const revoked=await f.call('worker',f.body(latest),async()=>{await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind('worker').run();return answer()});assert.equal(revoked.status,403);assert.ok(!JSON.stringify(revoked).includes('Prepare the fictional kit'));
 assert.equal((await f.call('worker')).status,403);await f.db.prepare('UPDATE memberships SET active=1,revision=revision+1 WHERE id=?').bind('worker').run();assert.equal(ok(await f.call('worker')).accessChanged,true);
});

test('provider errors, refusal, bad sources and malformed output save no answer or raw secret',async t=>{
 const f=await fixture(t);
 for(const response of [new Response('sk-raw-provider-error',{status:401}),Response.json({status:'incomplete',output:[]}),Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}),answer(['private-record']),Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]})]){
   const v=ok(await f.call('worker')),result=await f.call('worker',f.body(v),async()=>response);assert.ok(result.status>=400);assert.ok(!JSON.stringify(result).includes('sk-raw-provider-error'));const after=ok(await f.call('worker'));assert.equal(after.turns.at(-1).status,'failed');assert.equal(after.turns.at(-1).answer,'');f.tick();
 }
});

test('rate caps and exact revisions survive reload and do not call the provider',async t=>{
 const f=await fixture(t),v=ok(await f.call('worker'));let calls=0;const provider=async()=>{calls++;return answer()};
 assert.equal((await f.call('worker',{...f.body(v),expectedRevision:999},provider)).status,409);
 await f.db.prepare('INSERT INTO companion_limits(location_id,member_id,hour,count) VALUES(?,?,?,30)').bind('a','worker',Math.floor(Date.parse('2026-09-14T21:00:00Z')/3600000)).run();
 assert.equal((await f.call('worker',f.body(v),provider)).status,429);assert.equal(calls,0);
 assert.equal(configuredCompanion({OPENAI_API_KEY:'sk-fixture',JMAX_OPENAI_MODEL:'https://evil.example'}),null);
});

test('AI failures preserve a useful safe reference without logging questions, identities or provider bodies',async t=>{
 const f=await fixture(t),logs=t.mock.method(console,'error',()=>{});
 const cases=[
  ['authentication',async()=>new Response('PRIVATE_PROVIDER_BODY',{status:401})],
  ['permission',async()=>Response.json({error:{message:'PRIVATE_PROVIDER_BODY'}},{status:403})],
  ['quota',async()=>Response.json({error:{code:'insufficient_quota',message:'PRIVATE_PROVIDER_BODY'}},{status:429})],
  ...['credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'].map(code=>['quota',async()=>Response.json({error:{code}},{status:429})]),
  ['rate-limit',async()=>Response.json({error:{code:'rate_limit_exceeded'}},{status:429})],
  ['rate-limit',async()=>Response.json({error:{code:'slow_down'}},{status:429})],
  ['usage-limit',async()=>new Response('PRIVATE_PROVIDER_BODY',{status:429})],
  ['service',async()=>new Response('PRIVATE_PROVIDER_BODY',{status:503})],
  ['timeout',async()=>{throw new DOMException('PRIVATE_PROVIDER_BODY','TimeoutError')}],
  ['connection',async()=>{throw new Error('PRIVATE_PROVIDER_BODY sk-not-a-real-key')}],
  ['invalid-response',async()=>new Response('<html>PRIVATE_PROVIDER_BODY</html>')],
  ['invalid-response',async()=>new Response('PRIVATE_PROVIDER_BODY'.repeat(20000))],
  ['invalid-response',async()=>Response.json({status:'completed',output:[{type:'message',content:[null]}]})],
  ['incomplete',async()=>Response.json({status:'incomplete',output:[]})],
  ['refusal',async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'PRIVATE_PROVIDER_BODY'}]}]})],
  ['invalid-answer',async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'PRIVATE_PROVIDER_BODY'}]}]})],
  ['invalid-sources',async()=>answer(['PRIVATE_PROVIDER_BODY'])],
 ];
 for(const [category,provider] of cases){
  const v=ok(await f.call('worker')),result=await f.call('worker',f.body(v,'PRIVATE_QUESTION_MARKER'),provider);
  assert.ok([429,502,503].includes(result.status),JSON.stringify(result));
  assert.match(result.data.reference,/^[0-9a-f-]{36}$/);
  const log=JSON.parse(logs.mock.calls.at(-1).arguments[0]);
  assert.equal(log.category,category);assert.equal(log.stage,'provider');assert.equal(log.diagnosticId,result.data.reference);assert.equal(log.cleanupSucceeded,true);
  assert.deepEqual(Object.keys(log).sort(),['event','diagnosticId','stage','category','elapsedMs','cleanupSucceeded',...(log.providerStatus===undefined?[]:['providerStatus'])].sort());
  const saved=ok(await f.call('worker')).turns.at(-1);assert.equal(saved.status,'failed');assert.equal(saved.answer,'');assert.ok(saved.error.includes(result.data.reference));
  for(const marker of ['PRIVATE_QUESTION_MARKER','PRIVATE_PROVIDER_BODY','sk-not-a-real-key','worker@example.test'])assert.ok(!JSON.stringify(log).includes(marker)&&!JSON.stringify(result).includes(marker));
  f.tick();
 }
 const last=ok(await f.call('worker'));const done=ok(await f.call('worker',f.body(last,'A deliberate retry.')));assert.equal(done.turns.at(-1).status,'complete');
});

test('persistence and cleanup failures are distinguishable without leaking database error text',async t=>{
 for(const failAt of ['persist','cleanup']){
  const f=await fixture(t),logs=t.mock.method(console,'error',()=>{});
  await f.db.prepare(`CREATE TRIGGER fail_turn_update BEFORE UPDATE OF status ON companion_turns WHEN NEW.status='${failAt==='cleanup'?'failed':'complete'}' BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_AND_PROMPT'); END`).run();
  const v=ok(await f.call('worker')),r=await f.call('worker',f.body(v),failAt==='cleanup'?async()=>new Response('PRIVATE_PROVIDER',{status:500}):async()=>answer());
  assert.equal(r.status,503);const log=JSON.parse(logs.mock.calls.at(-1).arguments[0]);
  assert.equal(log.stage,failAt==='cleanup'?'provider':'persist');assert.equal(log.cleanupSucceeded,failAt!=='cleanup');assert.ok(!JSON.stringify(log).includes('PRIVATE_'));
  f.tick(61000);assert.equal(ok(await f.call('worker')).turns.at(-1).status,'failed');
  logs.mock.restore();
 }
});

test('owner review chat remains owner-gated and scoped to the selected fictional role',async t=>{
 const f=await fixture(t),url='https://test.example/api/review/employee/companion?locationId=owner-review';
 const config={JMAX_REVIEW_OWNER_EMAIL:'owner@example.test'};
 assert.equal((await handleOwnerReview(new Request(url),f.db,config)).status,401);
 assert.equal((await handleOwnerReview(new Request(url,{headers:{'oai-authenticated-user-email':'other@example.test'}}),f.db,config)).status,403);
 const r=await handleOwnerReview(new Request(url,{headers:{'oai-authenticated-user-email':'owner@example.test'}}),f.db,config);assert.equal(r.status,200);assert.equal((await r.json()).configured,false);
 assert.equal((await handleOwnerReview(new Request(url.replace('/employee/','/dish/'),{headers:{'oai-authenticated-user-email':'owner@example.test'}}),f.db,config)).status,200);
});


test('selected shift guidance excludes the team week, other employees and unrelated conversation history',async t=>{
 const f=await fixture(t);
 await f.record('another-shift','shift','other',{personId:'other',position:'OTHER_SHIFT_MARKER',start:'2026-09-14T20:00:00Z',end:'2026-09-15T03:00:00Z',published:true,cancelled:false});
 let v=ok(await f.call('manager'));
 v=ok(await f.call('manager',f.body(v,'OTHER_EMPLOYEE_DIALOGUE_MARKER'),async()=>answer([]),{product:'workforce'}));f.tick();
 const ask={...f.body(v,'Walk me through this shift.'),focus:{id:'shift',revision:1}};let called=0;
 v=ok(await f.call('manager',ask,async(_url,init)=>{
  called++;const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  assert.equal(context.scopeMode,'selected-shift');assert.equal(context.selectedEmployee.id,'worker');assert.equal(context.person.name,'Test manager');
  assert.equal(context.selectedShift.id,'shift');assert.equal(context.myShift,undefined);
  const payload=JSON.stringify(input);for(const marker of ['OTHER_EMPLOYEE_DIALOGUE_MARKER','OTHER_SHIFT_MARKER','OTHER_PRIVATE_MARKER','MY_PRIVATE_FEEDBACK_MARKER','DRAFT_PRIVATE_MARKER','schedule-week_'])assert.ok(!payload.includes(marker),marker);
  assert.ok(context.evidence.some(e=>e.source.id==='shift'));assert.ok(context.evidence.some(e=>e.source.id==='close'));assert.ok(context.evidence.every(e=>['shift','standard','close'].includes(e.source.id)));
  return answer(['shift']);
 },{product:'workforce'}));assert.equal(called,1);f.tick();
 const last=v.turns.at(-1);assert.equal(last.focus.id,'shift');assert.equal(last.focus.kind,'shift');
 const stale=await f.call('manager',{...f.body(v),focus:{id:'shift',revision:999}},async()=>{throw Error('provider must not run')},{product:'workforce'});assert.equal(stale.status,409);
 const otherRestaurant=await f.call('manager',{...f.body(v),focus:{id:'other-location',revision:1}},async()=>{throw Error('provider must not run')},{product:'workforce'});assert.equal(otherRestaurant.status,409);
});

test('an explicitly opened historical or draft shift stays available without adding other days',async t=>{
 const f=await fixture(t);
 for(const [id,published] of [['past-selected',true],['draft-selected',false]])await f.record(id,'shift','worker',{personId:'worker',position:'Fry',start:'2026-09-01T12:00:00Z',end:'2026-09-01T18:00:00Z',published,cancelled:false});
 let v=ok(await f.call('manager'));
 for(const id of ['past-selected','draft-selected']){
  v=ok(await f.call('manager',{...f.body(v,'Explain this saved shift.'),focus:{id,revision:1}},async(_url,init)=>{const ctx=JSON.parse(JSON.parse(init.body).input[1].content.split('\n').slice(1).join('\n'));assert.deepEqual(ctx.evidence.filter(e=>e.source.kind==='shift').map(e=>e.source.id),[id]);return answer([id]);},{product:'workforce'}));f.tick();
 }
});

test('learning help stays with the selected learner and approved guide across conversation history',async t=>{
 const f=await fixture(t);
 const goal={title:'Practice the fictional kit',definition:'Prepare the fictional kit with support',type:'development',automaticLearning:true,practiceChecks:[0],managerId:'manager',due:'2026-09-16T18:00:00Z',phase:'active',standardId:'standard',standardRevision:1,history:[]};
 await f.record('practice','goal','worker',goal);
 await f.record('unrelated-practice','goal','other',{...goal,title:'OTHER_LEARNER_MARKER',definition:'OTHER_PRACTICE_MARKER'});
 let v=ok(await f.call('manager'));
 v=ok(await f.call('manager',f.body(v,'OLD_WEEK_QUESTION_MARKER'),async()=>answer([]),{product:'workforce'}));f.tick();
 const ask=async question=>{
  v=ok(await f.call('manager',{...f.body(v,question),focus:{id:'practice',revision:1}},async(_url,init)=>{
   const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
   assert.equal(context.scopeMode,'selected-learning');assert.equal(context.selectedEmployee.id,'worker');assert.equal(context.person.name,'Test manager');
   assert.equal(context.selectedWork.id,'practice');assert.deepEqual(context.reportedPractice.checkedCriteria,[0]);assert.equal(context.myShift,undefined);
   const payload=JSON.stringify(input);
   for(const marker of ['OLD_WEEK_QUESTION_MARKER','OTHER_LEARNER_MARKER','OTHER_PRACTICE_MARKER','MY_PRIVATE_FEEDBACK_MARKER','schedule-week_'])assert.ok(!payload.includes(marker),marker);
   assert.ok(context.evidence.some(e=>e.source.id==='practice'));assert.ok(context.evidence.every(e=>['practice','standard'].includes(e.source.id)));
   if(question==='Continue this practice.')assert.ok(payload.includes('Help with this practice.'));
   return answer(['practice','standard']);
  },{product:'workforce'}));f.tick();
 };
 await ask('Help with this practice.');await ask('Continue this practice.');
 assert.equal((await f.call('manager',{...f.body(v),focus:{id:'practice',revision:999}},async()=>{throw Error('must not reach provider')},{product:'workforce'})).status,409);
 assert.equal((await f.call('other',{...f.body(ok(await f.call('other'))),focus:{id:'practice',revision:1}},async()=>{throw Error('must not reach provider')},{product:'workforce'})).status,409);
});
