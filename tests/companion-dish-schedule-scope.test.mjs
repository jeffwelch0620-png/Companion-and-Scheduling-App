import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskTrial} from './ai-task-trial-fixture.mjs';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';

test('Dishwasher own schedule context leaves current answers visible across GET, archive and database reopen, while changes still stale them',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-dish-scope-')),file=path.join(dir,'durable.sqlite');
 const profile={id:'dish-current-schedule',restaurant:'berts',position:'Dishwasher',area:'BOH',opening:['Check inherited readiness and assigned work with the manager.'],service:['Report equipment concerns to the named BOH manager.'],closing:['Ask the manager to physically check dedicated dish checkout before leaving.']};
 const bindings={OPENAI_API_KEY:'sk-fictional-dish-scope-test',JMAX_OPENAI_MODEL:'gpt-5.4-mini'};
 const trial=await createTaskTrial(profile,{file,bindings,fetcher:async()=>{throw new Error('Setup must not ask the provider');}});let store=openPositionDatabase(file);t.after(()=>{store.close();trial.close();fs.rmSync(dir,{recursive:true,force:true});});
 const request=(actor='worker',location='berts',body,extra={})=>new Request('https://ai-task-trial.example/api/companion?'+new URLSearchParams({locationId:location,...extra}),{headers:{'oai-authenticated-user-id':actor+'-trial-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://ai-task-trial.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 let askedContext;
 const provider=async(_url,init)=>{const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));askedContext=context;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Check your own published schedule before this shift. Ask the named manager about a schedule problem. Chat has not changed your shifts or released your shift.',sourceIds:context.evidence.filter(e=>e.source.kind==='schedule-week').map(e=>e.source.id)})}]}]});};
 const initialResponse=await handleCompanionChat(request(),store.db,bindings,provider,undefined,'workforce'),initial=await initialResponse.json();assert.equal(initialResponse.status,200);
 // A normal own-schedule question has no selected guide or task focus. A
 // focused guide is intentionally isolated from schedule dependencies.
 const asked=await handleCompanionChat(request('worker','berts',{action:'ask',locationId:'berts',conversationId:initial.conversationId,expectedRevision:initial.revision,requestId:'dish-own-schedule',question:'What does my own published schedule say for this week?'}),store.db,bindings,provider,undefined,'workforce'),askedData=await asked.json();
 const answer=askedData.turns.at(-1),saved=store.sqlite.prepare('SELECT answer,status,scope FROM companion_turns WHERE request_id=?').get('dish-own-schedule');
 const receipt={provider:'mocked; no network calls',queryMode:'normal own-schedule question without guide/task focus',handlerStatus:asked.status,status:answer.status,returnedAnswerLength:answer.answer.length,savedAnswerLength:saved.answer.length,savedScopeKinds:JSON.parse(saved.scope).map(s=>s.kind),expected:'Current authorized Dish answer remains visible; another restaurant/person cannot read it.'};
 fs.mkdirSync('evidence/ai-task-trial/berts-boh',{recursive:true});fs.writeFileSync('evidence/ai-task-trial/berts-boh/dish-scope-regression-latest.json',JSON.stringify(receipt,null,2)+'\n');
 assert.ok(receipt.savedScopeKinds.includes('schedule-week'));
 assert.ok(receipt.savedAnswerLength>0);
 assert.match(answer.answer,/Check your own published schedule/);assert.ok(!askedContext.selectedWork);assert.ok(answer.sources.some(s=>s.kind==='schedule-week'));
 const chat=async(...args)=>{const r=await handleCompanionChat(request(...args),store.db,bindings,async()=>{throw new Error('Read/archive must not call the provider');},undefined,'workforce');return {status:r.status,data:await r.json()};};
 let current=await chat();assert.equal(current.status,200);assert.equal(current.data.turns[0].stale,false);assert.match(current.data.turns[0].answer,/Check your own published schedule/);
 const conversationId=current.data.conversationId;
 const archived=await chat('worker','berts',{action:'start-new',locationId:'berts',conversationId,expectedRevision:current.data.revision});assert.equal(archived.status,200);
 let history=await chat('worker','berts',undefined,{archived:conversationId});assert.equal(history.status,200);assert.equal(history.data.turns[0].stale,false);assert.match(history.data.turns[0].answer,/Check your own published schedule/);
 store.close();store=openPositionDatabase(file);history=await chat('worker','berts',undefined,{archived:conversationId});assert.equal(history.data.turns[0].stale,false);assert.match(history.data.turns[0].answer,/Check your own published schedule/);
 assert.equal((await chat('worker','rudds')).status,403);assert.equal((await chat('outsider','berts')).status,403);
 // An ordinary second account at the same restaurant must not read the archive.
 store.sqlite.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES('peer','peer@example.test','peer-trial-identity','berts','Fictional peer','BOH','Dishwasher','[]','[\"Dishwasher\"]')").run();
 const peer=await chat('peer');assert.equal(peer.status,200);assert.equal(peer.data.turns.length,0);assert.equal((await chat('peer','berts',undefined,{archived:conversationId})).status,404);
 // The actual schedule command changes restaurant revision and invalidates the
 // prior schedule dependency. Removing the role bug must not remove staleness.
 const now=Date.now(),r=await handleWorkspace(new Request('https://ai-task-trial.example/api/workspace?locationId=berts',{method:'POST',headers:{'oai-authenticated-user-id':'manager-trial-identity','oai-authenticated-user-email':'manager@example.test',Origin:'https://ai-task-trial.example','Content-Type':'application/json'},body:JSON.stringify({locationId:'berts',requestId:'changed-schedule',action:'shift.save',input:{personId:'worker',position:'Dishwasher',start:new Date(now+3600000).toISOString(),end:new Date(now+8*3600000).toISOString()}})}),store.db);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
 history=await chat('worker','berts',undefined,{archived:conversationId});assert.equal(history.data.turns[0].stale,true);assert.equal(history.data.turns[0].answer,'');
 receipt.verified={immediate:true,get:true,archive:true,databaseReopen:true,foreignRestaurantDenied:true,foreignEmployeeDenied:true,sameRestaurantPeerArchiveDenied:true,scheduleChangeStillStales:true};fs.writeFileSync('evidence/ai-task-trial/berts-boh/dish-scope-regression-latest.json',JSON.stringify(receipt,null,2)+'\n');
});
