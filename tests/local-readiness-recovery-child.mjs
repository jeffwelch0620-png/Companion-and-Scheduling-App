import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
export function snapshot(sqlite){return JSON.parse(JSON.stringify(Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sqlite.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]))));}
export function request(loc,actor,body,route='workspace'){return new Request(`https://recovery.example/api/${route}?locationId=${loc}`,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://recovery.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});}
const specFile=process.argv[2];
if(specFile){
 const spec=JSON.parse(fs.readFileSync(specFile)),store=openPositionDatabase(spec.database);
 if(spec.mode==='crash'){
  store.sqlite.function('terminate_before_commit',()=>process.exit(91));
  store.sqlite.exec("CREATE TEMP TRIGGER deliberate_process_exit BEFORE INSERT ON audit_events BEGIN SELECT terminate_before_commit(); END");
  await handleWorkspace(request(spec.restaurant,'manager',spec.command),store.db);
  throw new Error('Crash hook did not execute');
 }
 assert.deepEqual(snapshot(store.sqlite),spec.expected,'New process restored all saved tables exactly');
 assert.equal(store.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 const before=snapshot(store.sqlite),retry=await handleWorkspace(request(spec.restaurant,'manager',spec.command),store.db);
 assert.equal(retry.status,200);assert.deepEqual(await retry.json(),spec.commandResult);assert.deepEqual(snapshot(store.sqlite),before,'Exact acknowledged retry must not duplicate records');
 const changed=await handleWorkspace(request(spec.restaurant,'manager',{...spec.command,input:{...spec.command.input,title:'ALTERED RETRY MUST NOT SAVE'}}),store.db);
 assert.equal(changed.status,409);assert.deepEqual(snapshot(store.sqlite),before);
 const own=await handleWorkspace(request(spec.restaurant,'worker'),store.db),ownData=await own.json();assert.equal(own.status,200);assert.ok(ownData.records.some(r=>r.id===spec.issueId&&r.data.phase==='correction'));
 const incoming=await handleWorkspace(request(spec.restaurant,'incoming'),store.db),incomingData=await incoming.json();assert.equal(incoming.status,200);assert.ok(incomingData.records.some(r=>r.id===spec.handoffId&&r.data.phase==='acceptance'));assert.ok(incomingData.records.some(r=>r.id===spec.messageId));
 for(const other of ['berts','rudds','papa'].filter(x=>x!==spec.restaurant))assert.equal((await handleWorkspace(request(other,'worker'),store.db)).status,403);
 assert.equal((await handleWorkspace(request(spec.restaurant,'revoked'),store.db)).status,403,'A restored backup preserves saved deactivation');
 const provider=()=>{throw new Error('Restoration read must not call any AI provider');};
 const chat=await handleCompanionChat(request(spec.restaurant,'worker',undefined,'companion'),store.db,{OPENAI_API_KEY:'sk-fictional-no-network'},provider,()=>spec.now,'workforce'),chatData=await chat.json();assert.equal(chat.status,200);assert.equal(chatData.turns.length,1);assert.equal(chatData.turns[0].question,spec.privateQuestion);
 const peerChat=await handleCompanionChat(request(spec.restaurant,'incoming',undefined,'companion'),store.db,{OPENAI_API_KEY:'sk-fictional-no-network'},provider,()=>spec.now,'workforce');assert.equal(peerChat.status,200);assert.equal((await peerChat.json()).turns.length,0);
 const peer=store.sqlite.prepare('SELECT * FROM memberships WHERE id=?').get('incoming');assert.equal(peer.active,1);assert.deepEqual(JSON.parse(peer.capabilities),[]);
 const currentHandoff=store.sqlite.prepare('SELECT id,revision FROM records WHERE id=?').get(spec.handoffId);
 const accepted=await handleWorkspace(request(spec.restaurant,'incoming',{locationId:spec.restaurant,requestId:'restored-handoff-accept',action:'task.transition',recordId:currentHandoff.id,expectedRevision:currentHandoff.revision,input:{step:'accept',note:'Named incoming employee accepts after restoration'}}),store.db);assert.equal(accepted.status,200);assert.equal(JSON.parse(store.sqlite.prepare('SELECT data FROM records WHERE id=?').get(spec.handoffId).data).phase,'closed');
 fs.writeFileSync(spec.output,JSON.stringify({restaurant:spec.restaurant,restoredInNewProcess:true,allTablesExactlyRetained:true,integrity:'ok',retryExactlyOnce:true,alteredRetryRejected:true,privateConversationRetained:true,privateConversationIsolated:true,pendingIssueRetained:true,incomingAcceptanceRetained:true,incomingAcceptanceContinuesAfterRestore:true,namedMessageRetained:true,permissionsRetained:true,deactivatedMemberStillDenied:true,crossRestaurantRejected:true,providerRequests:0},null,2));
 store.close();
}
