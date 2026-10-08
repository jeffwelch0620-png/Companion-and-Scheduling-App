import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {managerHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
import {promotionReader,promotionNeedsAck,promotionPhase} from '../.sites-runtime/shared/promotions.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a',position='Manager'] of [['owner','Executive',['location.manage']],['otherowner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['opener','BOH',['tasks.manage']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['coworker','BOH',[]],['server','FOH',[]],['dish','BOH',['location.manage'],'a','Dishwasher'],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,position,JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={},binding=db)=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),binding);return {status:response.status,data:await response.json()}};
 const view=async(id,loc='a')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);return {status:r.status,data:await r.json()}};
 return {db,call,view,headers};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const facts={title:'Fictional autumn offer',startsOn:'2026-09-01',endsOn:'2099-10-01',offer:'Fictional offer for tests only.',conditions:'Test terms; no real redemption.',staffBrief:'Ask the fictional manager if unclear.',audience:['BOH'],managerId:'manager',sourceRef:'PRIVATE-PLAN-A: fictional checked proposal',comparisonPlan:'PRIVATE-METHOD: compare equivalent dates, sources and limits.'};
const saved=async(f,who,r)=>ok(await f.view(who)).records.find(x=>x.id===(r.recordId??r.id));
const submit=(f,r,who='manager')=>f.call(who,'promotion.submit',{note:'Checked fictional plan.',checked:true},r);
const approve=(f,r,who='owner')=>f.call(who,'promotion.approve',{note:'Test owner approves exact fictional terms.',approved:true},r);
const ack=(f,r,who='worker',extra={})=>f.call(who,'promotion.acknowledge',{read:true},r,extra);
const cancel=(f,r)=>f.call('owner','promotion.cancel',{note:'Fictional offer withdrawn; do not use it.'},r);
const hist=async(f,who,params={},body)=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'a',...params}),{headers:{...f.headers(who),Origin:'https://test.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),f.db);return {status:r.status,data:await r.json()}};

test('private proposal -> manager review -> explicit owner approval -> department briefing; unrelated private plans never leak',async t=>{
 const f=await fixture(t);let r=ok(await f.call('manager','promotion.create',facts));assert.equal((await saved(f,'owner',r)).data.status,'draft');
 for(const who of ['opener','foh','worker','server','dish'])assert.equal(await saved(f,who,r),undefined);
 for(const who of ['worker','dish','foreign'])assert.equal((await f.call(who,'promotion.create',facts)).status,403);
 assert.equal((await f.call('foh','promotion.create',facts)).status,403);assert.equal((await approve(f,r)).status,400);r=ok(await submit(f,r));assert.equal((await approve(f,r,'manager')).status,403);
 assert.equal((await f.call('owner','promotion.approve',{note:'No explicit approval'},r)).status,400);r=ok(await approve(f,r));
 const worker=await saved(f,'worker',r);assert.equal(worker.data.approval.by,'owner');assert.equal(worker.data.internal,undefined);assert.equal((await saved(f,'opener',r)).data.internal,undefined);assert.ok((await saved(f,'manager',r)).data.internal);
 assert.equal(await saved(f,'server',r),undefined);assert.equal(await saved(f,'dish',r),undefined);assert.equal((await f.call('opener','promotion.cancel',{note:'No owner'},r)).status,403);
 const w=ok(await f.view('worker'));assert.ok(!JSON.stringify(w).includes('PRIVATE-'));assert.equal(w.records.filter(x=>x.kind==='message').length,0);
 for(const output of [companionContext(w,'Offers?',new Date().toISOString()),managerHandoff(ok(await f.view('owner')),'2026-09-29')])assert.ok(!JSON.stringify(output).includes('PRIVATE-'));
 const foreign=ok(await f.call('foreign','promotion.create',{...facts,managerId:'foreign'},undefined,{locationId:'b'}));assert.equal((await f.call('owner','promotion.submit',{note:'Wrong store',checked:true},foreign)).status,404);
});
test('return and draft edits retain prior facts; approved terms cannot change; withdrawn notices need separate read acknowledgment',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','promotion.create',facts));r=ok(await submit(f,r));r=ok(await f.call('owner','promotion.return',{note:'Clarify the terms.'},r));
 r=ok(await f.call('owner','promotion.correct',{...facts,offer:'Revised fictional offer',note:'Clarified exact terms.'},r));assert.equal((await saved(f,'owner',r)).data.internal.versions[0].facts.offer,facts.offer);
 r=ok(await submit(f,r));r=ok(await approve(f,r));assert.equal((await f.call('owner','promotion.correct',{...facts,note:'Silent edit'},r)).status,400);
 r=ok(await ack(f,r));assert.equal((await saved(f,'owner',r)).data.acknowledgments.length,1);assert.equal((await ack(f,r)).status,400);
 r=ok(await ack(f,r,'coworker'));assert.equal((await saved(f,'worker',r)).data.acknowledgments.length,1);assert.equal((await saved(f,'owner',r)).data.acknowledgments.length,2);
 r=ok(await cancel(f,r));const wr=await saved(f,'worker',r);assert.equal(wr.data.status,'cancelled');assert.match(wr.data.withdrawal.note,/do not use/);assert.equal(promotionNeedsAck(wr,ok(await f.view('worker')).me,new Date().toISOString(),'America/New_York'),true);
 r=ok(await ack(f,r));const a=(await saved(f,'worker',r)).data.acknowledgments;assert.deepEqual(a.map(x=>x.status),['approved','cancelled']);assert.equal(a.every(x=>x.by==='worker'),true);
 assert.equal((await f.call('owner','promotion.submit',{note:'Revive',checked:true},r)).status,400);
});
test('dates, source, audience, assignment and deliberate review are validated; expiry uses restaurant calendar',async t=>{
 const f=await fixture(t);
 for(const patch of [{title:''},{startsOn:'2026-02-30'},{endsOn:'2026-08-31'},{offer:''},{conditions:''},{staffBrief:''},{audience:[]},{audience:['Executive']},{audience:['BOH','BOH']},{sourceRef:''},{comparisonPlan:''},{managerId:'worker'},{managerId:'foreign'},{managerId:'dish'}])assert.equal((await f.call('owner','promotion.create',{...facts,...patch})).status,400,JSON.stringify(patch));
 let r=ok(await f.call('owner','promotion.create',{...facts,endsOn:'2026-09-28'}));assert.equal((await f.call('manager','promotion.submit',{note:'No check'},r)).status,400);r=ok(await submit(f,r));
 const w=ok(await f.view('owner')),command={locationId:'a',requestId:'calendar-approval',action:'promotion.approve',recordId:r.recordId,expectedRevision:r.revision,input:{approved:true,note:'Exact offer approved.'}};
 const d=applyCommand(w,command,'2026-09-29T03:59:00Z')[0].data;assert.equal(promotionPhase(d,'2026-09-29T03:59:00Z','America/New_York'),'active');assert.equal(promotionPhase(d,'2026-09-29T04:00:00Z','America/New_York'),'ended');assert.throws(()=>applyCommand(w,command,'2026-09-29T04:00:00Z'),/ended/);
 assert.equal(promotionPhase({...d,startsOn:'2026-09-29'},'2026-09-29T03:59:00Z','America/New_York'),'upcoming');
 assert.equal(promotionReader({...w.records[0],data:d},{...w.me,scheduleOnly:true}),false);
 r=ok(await f.call('owner','promotion.cancel',{note:'Cancel an unapproved plan.'},r));assert.equal(await saved(f,'worker',r),undefined);
});
test('source-backed outcomes remain private, append with evidence and are allowed only after an approved offer ends or is withdrawn',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','promotion.create',facts));const outcome={note:'PRIVATE-OUTCOME: source counts differ; no causal or profit claim.',sourceRef:'PRIVATE-REPORT: fictional comparable date report',checked:true};
 assert.equal((await f.call('manager','promotion.outcome',outcome,r)).status,400);r=ok(await submit(f,r));r=ok(await approve(f,r));assert.equal((await f.call('manager','promotion.outcome',outcome,r)).status,400);r=ok(await cancel(f,r));
 assert.equal((await f.call('worker','promotion.outcome',outcome,r)).status,403);assert.equal((await f.call('manager','promotion.outcome',{...outcome,sourceRef:''},r)).status,400);assert.equal((await f.call('manager','promotion.outcome',{...outcome,checked:false},r)).status,400);
 r=ok(await f.call('manager','promotion.outcome',outcome,r));r=ok(await f.call('owner','promotion.outcome',{...outcome,note:'PRIVATE-CORRECTION: earlier count needs correction; verified new total stated here.'},r));
 assert.equal((await saved(f,'owner',r)).data.internal.outcomes.length,2);assert.ok(!JSON.stringify(ok(await f.view('worker'))).includes('PRIVATE-'));assert.equal((await saved(f,'worker',r)).data.offer,facts.offer);
});
test('revoked manager access and commit-time assignment changes are enforced; access review shows counts without planning content',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','promotion.create',facts));
 const a=await handleAccess(new Request('https://test.example/api/access?locationId=a',{headers:f.headers('owner')}),f.db),access=await a.json();assert.equal(a.status,200);assert.ok(access.accounts.find(x=>x.id==='manager').responsibilities.some(x=>x.category==='Offers awaiting review or outcome'&&x.count===1));assert.ok(!JSON.stringify(access).includes('PRIVATE-'));
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='manager'").run();assert.equal(await saved(f,'manager',r),undefined);assert.equal((await submit(f,r)).status,404);
 assert.equal((await submit(f,r,'owner')).status,400);r=ok(await f.call('owner','promotion.correct',{...facts,managerId:'opener',note:'Reassign before approval.'},r));assert.ok(await saved(f,'opener',r));
 let batches=0;const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='opener'").run();return f.db.batch(statements)}})};
 assert.equal((await f.call('owner','promotion.create',{...facts,managerId:'opener'},undefined,{},binding)).status,409);assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='promotion'").first()).n,1);
});
test('exact retries, competing acknowledgments and failed persistence preserve one record and do not silently lose approvals',async t=>{
 const f=await fixture(t),extra={requestId:'promo-retry'};let r=ok(await f.call('owner','promotion.create',facts,undefined,extra));assert.deepEqual(ok(await f.call('owner','promotion.create',facts,undefined,extra)),r);assert.equal((await f.call('owner','promotion.create',{...facts,title:'Changed'},undefined,extra)).status,409);
 r=ok(await submit(f,r));r=ok(await approve(f,r));const race=await Promise.all([ack(f,r),ack(f,r,'coworker')]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
 const loser=race[0].status===409?'worker':'coworker';r=await saved(f,'owner',r);const original=JSON.stringify(r.data);
 await f.db.prepare("CREATE TRIGGER fail_promo BEFORE INSERT ON command_receipts WHEN NEW.request_id='promo-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await ack(f,r,loser,{requestId:'promo-fail'})).status,503);assert.equal(JSON.stringify((await saved(f,'owner',r)).data),original);
 const retry={requestId:'ack-retry'},result=ok(await ack(f,r,loser,retry));assert.deepEqual(ok(await ack(f,r,loser,retry)),result);assert.equal((await saved(f,'owner',result)).data.acknowledgments.length,2);
});
test('owner files old cancelled offers; staff history redacts planning and other acknowledgments, and only owners restore',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','promotion.create',facts));r=ok(await submit(f,r));r=ok(await approve(f,r));r=ok(await ack(f,r));r=ok(await ack(f,r,'coworker'));
 await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE id=?").bind(r.recordId).run();assert.equal(ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'})).records.length,0,'future-ending offer stays active');
 r=ok(await cancel(f,r));await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE id=?").bind(r.recordId).run();const before='2026-05-01',plan=ok(await hist(f,'owner',{preview:'1',before}));assert.equal(plan.records.length,1);assert.equal(ok(await hist(f,'manager',{preview:'1',before})).records.length,0);
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'archive-offer',action:'archive',confirmed:true,before,workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));
 const list=ok(await hist(f,'worker',{kind:'promotion'}));assert.equal(list.items.length,1);assert.equal(list.items[0].record.data.internal,undefined);assert.equal(list.items[0].record.data.acknowledgments.length,1);assert.equal(ok(await hist(f,'server',{kind:'promotion'})).items.length,0);
 const detail=ok(await hist(f,'worker',{recordId:r.recordId}));assert.equal(detail.canRestore,false);assert.ok(!JSON.stringify(detail).includes('PRIVATE-'));assert.equal((await hist(f,'worker',{restore:r.recordId})).status,403);
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-offer',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));assert.equal((await saved(f,'owner',r)).data.status,'cancelled');
});

test('former approval and read labels remain attributable without leaking private planning identities',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','promotion.create',facts));r=ok(await submit(f,r));r=ok(await approve(f,r));const w=ok(await f.view('owner')),record=w.records.find(x=>x.id===r.recordId);
 record.data.approval.by='former-approver';record.data.internal.history.push({actorId:'former-planner',action:'note',at:'2026-09-29T12:00:00Z',note:'Private historical planning'});record.data.acknowledgments.push({by:'former-reader',at:'2026-09-29T12:00:00Z',status:'approved'});w.formerMembers=[{id:'former-approver',name:'Former approver'},{id:'former-planner',name:'Former planner'},{id:'former-reader',name:'Former reader'}];
 assert.equal(publicWorkspace(w).formerMembers.length,3);const safe=publicWorkspace({...w,me:w.members.find(m=>m.id==='worker')});assert.deepEqual(safe.formerMembers,[{id:'former-approver',name:'Former approver'}]);assert.ok(!JSON.stringify(safe).includes('former-planner'));
});
