import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskTrial} from './ai-task-trial-fixture.mjs';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {closingStatus} from '../.sites-runtime/shared/closing-status.mjs';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
import {companionClosingNext} from '../.sites-runtime/shared/companion-closing-next.mjs';

const receipts=[];
async function fixture(t,timezone='America/New_York'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-dish-release-')),file=path.join(dir,'saved.sqlite');
 const profile={id:'dish-release',restaurant:'berts',position:'Dishwasher',area:'BOH',opening:['Use current assigned dish work.'],service:['Receive explicit unfinished work.'],closing:['Request independent manager checkout.']};
 const trial=await createTaskTrial(profile,{file,bindings:{},fetcher:async()=>{throw Error('No API calls');}});let store=openPositionDatabase(file);t.after(()=>{store.close();trial.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.sqlite.prepare('UPDATE locations SET timezone=? WHERE id=?').run(timezone,'berts');
 for(const id of ['incoming','second'])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(id,id+'@example.test',id+'-trial-identity','berts','Fictional '+id,'BOH','Dishwasher','[]','["Dishwasher"]');
 const req=(actor,body)=>new Request('https://dish-release.example/api/workspace?locationId=berts',{headers:{'oai-authenticated-user-id':actor+'-trial-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://dish-release.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const command=async(actor,action,input,r,requestId=crypto.randomUUID())=>{const response=await handleWorkspace(req(actor,{locationId:'berts',requestId,action,input,...(r?{recordId:r.id??r.recordId,expectedRevision:r.revision}:{})}),store.db);return {status:response.status,data:await response.json()};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const record=id=>{const r=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return {...r,id:r.id,ownerId:r.owner_id,data:JSON.parse(r.data)};};
 const records=()=>store.sqlite.prepare('SELECT id FROM records').all().map(r=>record(r.id));
 const work=async actor=>{const r=await handleWorkspace(req(actor),store.db);assert.equal(r.status,200);return r.json();};
 const state=()=>JSON.stringify(store.sqlite.prepare('SELECT * FROM records ORDER BY rowid').all());
 const cycle=async(date,amOwner='worker')=>{ok(await command('manager','task.dish-cycle',{amOwnerId:amOwner,pmOwnerIds:amOwner==='worker'?['incoming','second']:['worker','second'],businessDate:date,title:'Fictional dated dish checkout',detail:'Software simulation, independent manager verification.',due:'2026-10-20T20:00:00Z'}));return records().filter(r=>r.data.dishCheckout?.businessDate===date);};
 const shift=async(owner,start,end)=>{let r=ok(await command('manager','shift.save',{personId:owner,position:'Dishwasher',start,end}));r=ok(await command('manager','shift.publish',{},r));return r;};
 const finish=async(r)=>{r=ok(await command(r.ownerId,'task.transition',{step:'ready',note:'Fictional readiness submission'},r));r=ok(await command('manager','task.transition',{step:'verify',note:'Fictional independent physical check'},r));return record(r.recordId);};
 const reopen=()=>{const before=state();store.close();store=openPositionDatabase(file);assert.equal(state(),before);};
 let now=Date.parse('2026-10-15T19:00:00Z');const captures=[];
 const chat=async(body)=>{now+=10000;const r=await handleCompanionChat(new Request(req('worker',body).url.replace('/workspace?','/companion?'),req('worker',body)),store.db,{OPENAI_API_KEY:'sk-fictional-dish-release',JMAX_OPENAI_MODEL:'gpt-5.4-mini'},async(_url,init)=>{const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));captures.push({input,context});return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Your outgoing acceptance and your manager release are separate. This chat has not completed PM work.',sourceIds:context.evidence.map(e=>e.source.id)})}]}]});},()=>now,'workforce');return {status:r.status,data:await r.json()};};
 return {command,ok,record,records,work,state,cycle,shift,finish,reopen,chat,captures,sqlite:()=>store.sqlite};
}

test('AM release requires own checkout and explicit child acceptance; accepted PM work and other dates do not block AM',async t=>{
 const f=await fixture(t),s=await f.shift('worker','2026-10-15T12:00:00Z','2026-10-15T20:00:00Z');
 const current=await f.cycle('2026-10-15'),am=current.find(r=>r.ownerId==='worker');
 await f.cycle('2026-10-14');await f.cycle('2026-10-16');
 f.ok(await f.command('worker','task.dish-pass',{incomingId:'incoming',note:'Remaining load requires explicit incoming acceptance.',due:'2026-10-15T23:00:00Z'},am));
 const child=f.records().find(r=>r.data.dishHandoff?.sourceId===am.id);
 await f.finish(f.record(am.id));
 const workerBefore=await f.work('worker'),publicStatus=closingStatus(workerBefore,workerBefore.records.find(r=>r.id===s.recordId),{allowProjectedReceipts:true}),contextBefore=workforceContext(workerBefore,'Can I leave after my AM checkout?', '2026-10-15T19:00:00Z');
 if(publicStatus.complete||!JSON.stringify(contextBefore.context).includes(am.id)){fs.mkdirSync('evidence/hour-trial/berts-boh',{recursive:true});fs.writeFileSync('evidence/hour-trial/berts-boh/am-public-acceptance-before-fix.json',JSON.stringify({publicComplete:publicStatus.complete,publicPendingTaskIds:publicStatus.pendingTasks.map(r=>r.id),outgoingChildVisible:workerBefore.records.some(r=>r.id===child.id),aiClosingStatus:contextBefore.context.closingStatus??null,expected:'Public own checkout and AI must explain pending outgoing acceptance without receiving PM body/work records.'},null,2)+'\n');}
 assert.equal(publicStatus.complete,false,'Unaccepted outgoing work must stay pending in actual worker public view');
 assert.ok(JSON.stringify(contextBefore.context).includes(am.id),'AI must receive own current dedicated checkout');
 assert.deepEqual(contextBefore.context.closingStatus.pendingOutgoingAcceptanceIds,[child.id]);assert.equal(workerBefore.records.some(r=>r.id===child.id),false);
 const shiftSource={id:s.recordId,revision:s.revision,kind:'shift',title:'AM shift'},departure=companionClosingNext(workerBefore,[shiftSource],'Can I leave after my AM checkout?','Your checkout is complete.', '2026-10-15T19:00:00Z',shiftSource);assert.match(departure,/explicitly acknowledge/);assert.match(departure,/does not complete the PM work/);assert.match(departure,/does not need to wait for accepted PM work/);
 const c=f.ok(await f.chat()),beforeAI=f.state();const response=f.ok(await f.chat({action:'ask',locationId:'berts',conversationId:c.conversationId,expectedRevision:c.revision,requestId:'AM-acceptance-before',question:'Can I leave after my AM checkout?',focus:{id:s.recordId,revision:s.revision}}));assert.equal(f.state(),beforeAI);assert.ok(response.turns.at(-1).answer);assert.ok(response.turns.at(-1).sources.some(source=>source.id===am.id),'The handoff receipt source revision is part of answer validity');
 let before=f.state();assert.equal((await f.command('worker','shift.release',{note:'Employee cannot release own shift'},s)).status,403);assert.equal(f.state(),before);
 before=f.state();assert.equal((await f.command('manager','shift.release',{note:'AM child not yet accepted'},s)).status,400);assert.equal(f.state(),before);
 before=f.state();assert.equal((await f.command('incoming','task.transition',{step:'dispute',note:'Declining does not silently accept this child'},child)).status,403);assert.equal(f.state(),before);
 // Current dedicated-cycle policy has no replacement path for a PM no-show.
 // Keep this uncovered operating case visible rather than inventing an override.
 for(const [actor,action,input,record] of [
  ['manager','task.reassign',{ownerId:'second',note:'Fictional incoming PM no-show'},child],
  ['manager','task.reassign',{ownerId:'second',note:'Fictional incoming PM no-show'},current.find(r=>r.ownerId==='incoming')],
  ['second','task.transition',{step:'accept',note:'Different PM cannot impersonate the assigned recipient'},child],
  ['manager','task.dish-cycle',{amOwnerId:'worker',pmOwnerIds:['incoming','second'],businessDate:'2026-10-15',title:'Replacement attempt',detail:'Do not overwrite existing assignments',due:'2026-10-15T23:00:00Z'},undefined]
 ]){const snapshot=f.state(),rejected=await f.command(actor,action,input,record);assert.ok([400,403,404].includes(rejected.status));assert.equal(f.state(),snapshot);}
 const allState=()=>JSON.stringify(Object.fromEntries(['records','audit_events','command_receipts'].map(table=>[table,f.sqlite().prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 // The local storage interruption must roll back the parent receipt, child
 // acceptance, notifications and command receipt together.
 f.sqlite().exec(`CREATE TRIGGER interrupt_parent_accept BEFORE UPDATE ON records WHEN OLD.id='${am.id}' BEGIN SELECT RAISE(ABORT,'Fictional interrupted parent receipt'); END`);const interruptedState=allState();const interrupted=await f.command('incoming','task.transition',{step:'accept',note:'Incoming explicitly accepts ownership'},child,'accept-with-interrupted-write');assert.equal(interrupted.status,503);assert.equal(allState(),interruptedState);f.sqlite().exec('DROP TRIGGER interrupt_parent_accept');
 const parentRevision=f.record(am.id).revision,acceptInput={step:'accept',note:'Incoming explicitly accepts ownership'};const accepted=f.ok(await f.command('incoming','task.transition',acceptInput,child,'accept-retry-proof'));const acceptedState=allState();assert.deepEqual(f.ok(await f.command('incoming','task.transition',acceptInput,child,'accept-retry-proof')),accepted);assert.equal(allState(),acceptedState);assert.equal(f.record(am.id).revision,parentRevision+1);f.reopen();
 assert.equal(f.record(child.id).data.phase,'open');
 const workerAfter=await f.work('worker');assert.equal(workerAfter.records.some(r=>r.id===child.id),false);assert.equal(closingStatus(workerAfter,workerAfter.records.find(r=>r.id===s.recordId),{allowProjectedReceipts:true}).complete,true);assert.equal(f.ok(await f.chat()).turns.at(-1).stale,true,'Saved selected-parent answer invalidates when acceptance updates parent revision');
 const contextAfter=workforceContext(workerAfter,'Can I leave after my AM checkout?', '2026-10-15T19:00:00Z');assert.deepEqual(contextAfter.context.closingStatus.pendingOutgoingAcceptanceIds,[]);assert.equal(JSON.stringify(contextAfter.context).includes('Remaining load requires explicit incoming acceptance.'),false,'PM child detail remains private');
 const managerAfter=await f.work('manager'),managerSelected=workforceContext(managerAfter,'Can this AM employee leave?', '2026-10-15T19:00:00Z',[],{id:s.recordId,revision:s.revision});
 if(!managerSelected.context.closingStatus.complete){fs.writeFileSync('evidence/hour-trial/berts-boh/manager-selected-acceptance-before-fix.json',JSON.stringify({status:managerSelected.context.closingStatus,expected:'A narrowed selected AM shift must retain the validated acceptance-only receipt, without pulling PM work into the selected employee context.'},null,2)+'\n');}
 assert.equal(managerSelected.context.closingStatus.complete,true,'Authorized manager selected AM context must read the acceptance-only receipt');assert.deepEqual(managerSelected.context.closingStatus.pendingOutgoingAcceptanceIds,[]);assert.equal(managerSelected.context.evidence.some(e=>e.source.id===child.id),false,'Selected AM context excludes accepted PM body');
 // Explicit fault injection checks malformed saved data, not daily reseeding:
 // acceptance cannot be laundered through a missing child or changed ownership.
 const childRow=f.sqlite().prepare('SELECT * FROM records WHERE id=?').get(child.id),parentRow=f.sqlite().prepare('SELECT * FROM records WHERE id=?').get(am.id);
 for(const fault of ['deleted-child','changed-owner','changed-area','changed-kind','missing-acceptance-time','forged-view-marker','missing-parent-forward-link']){
  if(fault==='deleted-child'||fault==='forged-view-marker')f.sqlite().prepare('DELETE FROM records WHERE id=?').run(child.id);
  if(fault==='changed-owner')f.sqlite().prepare('UPDATE records SET owner_id=? WHERE id=?').run('second',child.id);
  if(fault==='changed-area')f.sqlite().prepare('UPDATE records SET area=? WHERE id=?').run('FOH',child.id);
  if(fault==='changed-kind'){const data=JSON.parse(childRow.data);data.kind='issue';f.sqlite().prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data),child.id);}
  if(fault==='missing-acceptance-time'){const data=JSON.parse(childRow.data);data.dishHandoff.acceptedAt=null;f.sqlite().prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data),child.id);}
  if(fault==='missing-parent-forward-link'){const data=JSON.parse(parentRow.data);data.dishHandoffs=[];f.sqlite().prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data),am.id);}
  if(fault==='forged-view-marker'){const data=JSON.parse(parentRow.data);data.dishHandoffReceiptView=true;f.sqlite().prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(data),am.id);}
  const publicFault=await f.work('worker'),ownShift=publicFault.records.find(r=>r.id===s.recordId);assert.equal(closingStatus(publicFault,ownShift,{allowProjectedReceipts:true}).complete,false,`${fault}: worker projection must not invent acceptance`);
  const before=f.state();assert.equal((await f.command('manager','shift.release',{note:'Do not release malformed handoff'},s)).status,400,`${fault}: raw manager release must inspect current child and its source receipt`);assert.equal(f.state(),before);
  // Restore only the deliberately corrupted records to their exact captured
  // values; normal sequence writes still occur through handlers.
  f.sqlite().prepare('INSERT OR REPLACE INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)').run(childRow.id,childRow.location_id,childRow.kind,childRow.owner_id,childRow.area,childRow.revision,childRow.data,childRow.updated_at,childRow.archived_at);
  f.sqlite().prepare('UPDATE records SET data=? WHERE id=?').run(parentRow.data,am.id);
 }
 const legacy=JSON.parse(parentRow.data);delete legacy.dishHandoffAcceptances;f.sqlite().prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(legacy),am.id);const legacyView=await f.work('worker');assert.equal(closingStatus(legacyView,legacyView.records.find(r=>r.id===s.recordId),{allowProjectedReceipts:true}).complete,true,'Valid current legacy child provides an acceptance-only receipt');assert.equal(legacyView.records.some(r=>r.id===child.id),false);const legacyManager=await f.work('manager');assert.equal(closingStatus(legacyManager,legacyManager.records.find(r=>r.id===s.recordId)).complete,true);f.sqlite().prepare('UPDATE records SET data=? WHERE id=?').run(parentRow.data,am.id);
 const w=await f.work('manager'),status=closingStatus(w,w.records.find(r=>r.id===s.recordId));assert.equal(status.pendingTasks.length,0);assert.equal(status.tasks.length,1);
 const released=f.ok(await f.command('manager','shift.release',{note:'AM own checkout verified and PM acceptance saved'},s));assert.ok(f.record(released.recordId).data.releasedAt);
 assert.equal(f.record(current.find(r=>r.ownerId==='incoming').id).data.phase,'open');assert.equal(f.record(child.id).data.phase,'open');
 receipts.push({case:'AM acceptance boundary',passed:true,otherDatesExcluded:true,otherPMWorkExcluded:true,declinedActionDidNotAccept:true,durableReopen:true,atomicRollback:true,idempotentAcceptance:true,parentRevisionInvalidatesAI:true,legacyAcceptedChild:true,managerSelectedReceipt:true,malformedSavedRecordGuards:7,pmNoShowReplacement:'No supported dedicated cycle/checkout replacement path; remains an operating gap.'});
});

for(const [timezone,start,end,date] of [['America/New_York','2026-10-16T02:00:00Z','2026-10-16T07:00:00Z','2026-10-15'],['Asia/Tokyo','2026-10-15T14:00:00Z','2026-10-15T18:00:00Z','2026-10-15']])test(`${timezone}: overnight PM release checks local start date and own accepted child until verified`,async t=>{
 const f=await fixture(t,timezone),s=await f.shift('worker',start,end),rows=await f.cycle(date,'incoming');await f.cycle('2026-10-14','incoming');await f.cycle('2026-10-16','incoming');
 const am=rows.find(r=>r.ownerId==='incoming'),pm=rows.find(r=>r.ownerId==='worker');
 f.ok(await f.command('incoming','task.dish-pass',{incomingId:'worker',note:'Unfinished AM work follows the PM employee.',due:end},am));const child=f.records().find(r=>r.data.dishHandoff?.sourceId===am.id);
 const w=await f.work('manager'),status=closingStatus(w,w.records.find(r=>r.id===s.recordId));assert.deepEqual(new Set(status.pendingTasks.map(r=>r.id)),new Set([pm.id,child.id]));
 let before=f.state();assert.equal((await f.command('manager','shift.release',{note:'Overnight own checkout incomplete'},s)).status,400);assert.equal(f.state(),before);
 f.ok(await f.command('worker','task.transition',{step:'accept',note:'Saved incoming acceptance'},child));
 before=f.state();assert.equal((await f.command('worker','task.transition',{step:'ready',note:'PM cannot bypass inherited work'},pm)).status,400);assert.equal(f.state(),before);
 const accepted=f.record(child.id);await f.finish(accepted);const pmReady=f.ok(await f.command('worker','task.transition',{step:'ready',note:'PM own work submitted'},pm));
 f.reopen();before=f.state();assert.equal((await f.command('manager','shift.release',{note:'Submission is not independent verification'},s)).status,400);assert.equal(f.state(),before);
 f.ok(await f.command('manager','task.transition',{step:'verify',note:'Independent PM checkout verification'},pmReady));
 const released=f.ok(await f.command('manager','shift.release',{note:'Only this PM worker and owned incoming work now checked'},s));assert.ok(f.record(released.recordId).data.releasedAt);
 assert.equal(f.record(rows.find(r=>r.ownerId==='second').id).data.phase,'open');assert.equal(f.record(am.id).data.phase,'open');
 receipts.push({case:'PM overnight owner scope',timezone,localStartDate:date,passed:true,pendingOnlyOwnCheckoutAndChild:true,unrelatedDatesAndEmployeesExcluded:true,readyNotRelease:true,durableReopen:true});
});

test.after(()=>{fs.mkdirSync('evidence/hour-trial/berts-boh',{recursive:true});fs.writeFileSync('evidence/hour-trial/berts-boh/dish-release-scope.json',JSON.stringify({createdAt:new Date().toISOString(),cases:receipts,provider:'No provider calls',limits:['Fictional software records and physical-check assertions; no restaurant hardware inspected.','Historical business dates are compared to the restaurant-local scheduled start date, not the date of the release request.']},null,2)+'\n');});
