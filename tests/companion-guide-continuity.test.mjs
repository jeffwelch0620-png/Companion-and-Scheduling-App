import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-guide-continuity-')),file=path.join(dir,'saved.sqlite');let store=openPositionDatabase(file),clock=Date.now(),captured=[];
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');
 for(const [actor,loc,caps,qualification] of [['worker','berts',[],['Server']],['manager','berts',['location.manage','tasks.manage','standards.approve'],[]],['outsider','rudds',[],[]]])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(actor,actor+'@example.test',actor+'-identity',loc,'Fictional '+actor,'FOH','Server',JSON.stringify(caps),JSON.stringify(qualification));
 const request=(actor,route,body,query='')=>new Request(`https://guide-continuity.example/api/${route}?locationId=berts${query}`,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://guide-continuity.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const ok=async r=>{const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 const work=(action,input,record)=>handleWorkspace(request('manager','workspace',{requestId:crypto.randomUUID(),locationId:'berts',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})}),store.db).then(ok);
 const provider=async(_url,init)=>{const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));captured.push({input,context});return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Use the approved Server guide: read the order back and ask the named manager if the method is unclear. This guide does not assign a shift or complete any work.',sourceIds:context.evidence.map(e=>e.source.id)})}]}]});};
 const chat=(body,query='')=>handleCompanionChat(request('worker','companion',body,query),store.db,{OPENAI_API_KEY:'sk-fictional-local-guide-test',JMAX_OPENAI_MODEL:'gpt-5.4-mini'},provider,()=>clock,'workforce').then(ok);
 let guide=await work('standard.save',{title:'Approved Server service reference',position:'Server',zone:'Server reference',criteria:['Read orders back'],source:'Fictional source-backed guide continuity test',version:1,verification:'manager',guide:{purpose:'Explain current service methods',preparation:['Read the current approved instructions'],steps:['Repeat the order back before entering it'],troubleshooting:['Ask manager about an unclear instruction'],escalation:'Named on-duty manager'}});guide=await work('standard.approve',{validated:true,note:'Fictional QA approval only'},guide);
 const ask=async question=>{clock+=6000;const current=await chat();return chat({action:'ask',locationId:'berts',requestId:crypto.randomUUID(),conversationId:current.conversationId,expectedRevision:current.revision,question,focus:{id:guide.recordId,revision:guide.revision}});};
 const reopen=()=>{store.close();store=openPositionDatabase(file);};
 return {file,request,work,chat,ask,reopen,guide,get captured(){return captured;},get store(){return store;},tick(){clock+=6000;},now(){return clock;}};
}

test('selected unchanged approved guide survives unrelated task writes and database reopen without a schedule dependency',async t=>{
 const f=await fixture(t),first=await f.ask('Explain the attached order read-back method.'),initial=f.captured.at(-1).context;
 assert.equal(first.turns.at(-1).stale,false);
 await f.work('task.create',{ownerId:'worker',title:'Unrelated restock instruction',detail:'An unrelated assignment changes the restaurant revision.',kind:'task',due:new Date(Date.now()+86400000).toISOString()});
 f.reopen();const restored=await f.chat();assert.equal(restored.turns[0].stale,false);assert.equal(restored.turns[0].answer,first.turns[0].answer);
 assert.equal(initial.scopeMode,'selected-guide');assert.equal(initial.person.verifiedStationClearances.includes('Server'),true);
 assert.equal(initial.evidence.length,1);assert.equal(initial.evidence[0].source.id,f.guide.recordId);assert.equal(initial.evidence[0].facts.trainingClearanceRecorded,true);
 assert.ok(!JSON.stringify(initial).includes('schedule-week_'));assert.equal(initial.myShift,undefined);assert.match(initial.limits.join(' '),/reference.*not.*assignment/i);
 const stored=f.store.sqlite.prepare('SELECT scope FROM companion_turns ORDER BY rowid LIMIT 1').get();assert.deepEqual(JSON.parse(stored.scope).map(s=>s.id),[f.guide.recordId]);
 await f.ask('Explain that same attached method again.');const payload=JSON.stringify(f.captured.at(-1).input);assert.ok(payload.includes(first.turns[0].question));assert.ok(!payload.includes('Unrelated restock instruction'));
});

test('selected guide archive recalls the unchanged reference but deletion removes the archived dependency',async t=>{
 const f=await fixture(t),answered=await f.ask('Remember the attached read-back method.'),archivedId=answered.conversationId;
 const newer=await f.chat({action:'start-new',locationId:'berts',conversationId:answered.conversationId,expectedRevision:answered.revision});
 await f.work('task.create',{ownerId:'worker',title:'Other work',detail:'Not the selected guide',kind:'task',due:new Date(Date.now()+86400000).toISOString()});f.reopen();
 const history=await f.chat(undefined,'&archived='+encodeURIComponent(archivedId));assert.equal(history.turns[0].stale,false);assert.equal(history.turns[0].answer,answered.turns[0].answer);
 await f.ask('Explain this attached read-back guide again.');assert.ok(JSON.stringify(f.captured.at(-1).input).includes(answered.turns[0].question));
 const current=await f.chat();await f.chat({action:'delete-history',locationId:'berts',conversationId:current.conversationId,expectedRevision:current.revision,archivedId,confirmed:true});
 const after=await f.chat();assert.equal(after.turns[0].stale,true,'An answer that recalled deleted history must no longer be treated as current');
 assert.ok(!after.turns[0].answer);assert.notEqual(newer.conversationId,archivedId);
});

test('changed or retired guide remains invalid and cannot be silently reused as a current answer',async t=>{
 const f=await fixture(t);await f.ask('Explain the current approved guide.');
 f.store.sqlite.prepare('UPDATE records SET revision=revision+1 WHERE id=?').run(f.guide.recordId);
 let view=await f.chat();assert.equal(view.turns[0].stale,true);assert.equal(view.turns[0].answer,'');
 const row=f.store.sqlite.prepare('SELECT data FROM records WHERE id=?').get(f.guide.recordId),data=JSON.parse(row.data);data.status='retired';f.store.sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data),f.guide.recordId);
 view=await f.chat();assert.equal(view.turns[0].stale,true);assert.equal(view.turns[0].answer,'');
 f.tick();const request={action:'ask',locationId:'berts',requestId:crypto.randomUUID(),conversationId:view.conversationId,expectedRevision:view.revision,question:'Use that old guide.',focus:{id:f.guide.recordId,revision:f.guide.revision}},response=await handleCompanionChat(f.request('worker','companion',request),f.store.db,{OPENAI_API_KEY:'sk-fictional-local-guide-test'},async()=>{throw Error('Retired guide must not call the provider');},()=>f.now(),'workforce');assert.equal(response.status,409);
});

test('membership access revision still protects earlier selected-guide history',async t=>{
 const f=await fixture(t);await f.ask('Explain the approved guide.');f.store.sqlite.prepare("UPDATE memberships SET revision=revision+1 WHERE id='worker'").run();
 const view=await f.chat();assert.equal(view.accessChanged,true);assert.deepEqual(view.turns,[]);
});
