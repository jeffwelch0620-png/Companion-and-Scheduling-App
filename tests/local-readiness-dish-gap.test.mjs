import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {closingStatus} from '../.sites-runtime/shared/closing-status.mjs';

const root=path.resolve('evidence/local-readiness-2026-10-08/dish-gap',crypto.randomUUID());
fs.mkdirSync(root,{recursive:true});
const runtime=()=>Object.fromEntries(fs.readdirSync('.sites-runtime/shared').filter(n=>n.endsWith('.mjs')).sort().map(n=>[n,createHash('sha256').update(fs.readFileSync('.sites-runtime/shared/'+n)).digest('hex')]));
const before=runtime(),receipts=[];
for(const location of ['berts','rudds'])test(`${location}: no-show cannot be disguised as accepted incoming Dish responsibility`,async t=>{
 const file=path.join(root,location+'.sqlite');let store=openPositionDatabase(file);t.after(()=>store.close());
 for(const f of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds','papa'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');
 const caps=['location.manage','schedule.manage','schedule.publish','tasks.manage','close.confirm'];
 for(const actor of ['manager','am','absent','pm2','replacement'])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(actor,actor+'@example.test',actor+'-identity',location,'Fictional '+actor,'BOH',actor==='manager'?'General manager':'Dishwasher',JSON.stringify(actor==='manager'?caps:[]),'["Dishwasher"]');
 const request=(actor,body)=>new Request('https://readiness.example/api/workspace?locationId='+location,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://readiness.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const raw=async(actor,action,input={},r,id=crypto.randomUUID())=>{const response=await handleWorkspace(request(actor,{locationId:location,requestId:id,action,input,...(r?{recordId:r.id??r.recordId,expectedRevision:r.revision}:{})}),store.db);return {status:response.status,data:await response.json()};};
 const command=async(...args)=>{const result=await raw(...args);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
 const records=()=>store.sqlite.prepare('SELECT * FROM records ORDER BY id').all().map(r=>({...r,ownerId:r.owner_id,data:JSON.parse(r.data)}));
 const saved=r=>records().find(x=>x.id===(r.id??r.recordId));
 const snapshot=()=>JSON.stringify(Object.fromEntries(['locations','records','command_receipts','audit_events'].map(table=>[table,store.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 const view=async actor=>{const response=await handleWorkspace(request(actor),store.db);assert.equal(response.status,200);return response.json();};
 let shift=await command('manager','shift.save',{personId:'am',position:'Dishwasher',start:'2026-10-20T12:00:00Z',end:'2026-10-20T20:00:00Z'});
 shift=await command('manager','shift.publish',{},shift);
 await command('manager','task.dish-cycle',{amOwnerId:'am',pmOwnerIds:['absent','pm2'],businessDate:'2026-10-20',title:'Fictional Dish cycle',detail:'Fictional software checks only',due:'2026-10-20T23:00:00Z'});
 let parent=records().find(r=>r.data.dishCheckout?.shift==='AM');
 await command('am','task.dish-pass',{incomingId:'absent',note:'Fictional remaining work, original recipient unavailable',due:'2026-10-20T23:00:00Z'},parent);
 parent=saved(parent);
 let ready=await command('am','task.transition',{step:'ready',note:'Fictional outgoing readiness'},parent);
 await command('manager','task.transition',{step:'verify',note:'Fictional independent outgoing check'},ready);
 const child=records().find(r=>r.data.dishHandoff?.sourceId===parent.id);
 const rejected=[];
 for(const [actor,action,input,r] of [
  ['manager','task.reassign',{ownerId:'replacement',note:'Fictional PM no-show'},child],
  ['replacement','task.transition',{step:'accept',note:'Replacement must not impersonate recipient'},child],
  ['manager','task.transition',{step:'accept',note:'Manager cannot acknowledge for recipient'},child],
  ['manager','task.dish-cycle',{amOwnerId:'am',pmOwnerIds:['replacement','pm2'],businessDate:'2026-10-20',title:'Do not duplicate current cycle',detail:'Fictional substitute attempt',due:'2026-10-20T23:00:00Z'}],
  ['manager','shift.release',{note:'No recipient acknowledgment, must remain blocked'},shift],
 ]){const beforeState=snapshot(),result=await raw(actor,action,input,r);assert.ok([400,403,404].includes(result.status),JSON.stringify(result));assert.equal(snapshot(),beforeState);rejected.push({actor,action,status:result.status});}
 const amView=await view('am');assert.equal(amView.records.some(r=>r.id===child.id),false);assert.equal(closingStatus(amView,amView.records.find(r=>r.id===shift.recordId),{allowProjectedReceipts:true}).complete,false);
 const retained=snapshot();store.close();store=openPositionDatabase(file);assert.equal(snapshot(),retained);
 assert.equal(saved(child).data.dishHandoff.acceptedBy,'');
 // Verify existing acceptance is healthy without claiming to fix no-show substitution.
 await command('absent','task.transition',{step:'accept',note:'Fictional original recipient eventually arrives'},child);
 const afterArrival=await view('am');assert.equal(closingStatus(afterArrival,afterArrival.records.find(r=>r.id===shift.recordId),{allowProjectedReceipts:true}).complete,true);
 assert.equal(saved(child).data.phase,'open','Acceptance transfers responsibility but does not finish incoming work');
 receipts.push({location,file,guardChecks:rejected,reopens:1,noShowReplacement:'unimplemented; outgoing employee remains correctly blocked',originalRecipientArrival:'explicit acceptance succeeds without closing incoming work',sourceUnchanged:true});
});
test.after(()=>{assert.deepEqual(runtime(),before);fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify({mode:'local fictional handlers only',externalCalls:0,tests:2,receipts,runtime:before,limits:['This proves no-show rejection and recovery on the original recipient arrival. Qualified substitute assignment remains unimplemented.','Papa has shared Dish coverage in Pizza Make; no dedicated three-person Dish cycle was invented there.']},null,2)+'\n');console.log('Dish gap evidence: '+root);});
