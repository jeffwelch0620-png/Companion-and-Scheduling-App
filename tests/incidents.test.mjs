import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {managerHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a',position='Manager'] of [['owner','Executive',['location.manage']],['otherowner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['opener','BOH',['tasks.manage']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['dish','BOH',['location.manage'],'a','Dishwasher'],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,position,JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={})=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),db);return {status:response.status,data:await response.json()}};
 const view=async(id,loc='a')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);return {status:r.status,data:await r.json()}};
 return {db,call,view,headers};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const facts={title:'Fictional restricted marker',category:'Service interruption',occurredAt:'2026-09-21T14:00:00-04:00',place:'Test kitchen',description:'Private incident facts marker',immediateAction:'Recorded test action; no live incident.'};
const saved=async(f,id='owner',record)=>ok(await f.view(id)).records.find(r=>r.id===record.recordId);
test('incident creation and every action enforce reporter, owner, current role and restaurant boundaries',async t=>{
 const f=await fixture(t),r=ok(await f.call('manager','incident.create',{...facts,reporterId:'opener',ownerId:'otherowner',status:'resolved'}));
 const data=(await saved(f,'owner',r)).data;assert.equal(data.reporterId,'manager');assert.equal(data.status,'open');assert.equal(data.followUp,null);
 for(const actor of ['manager','owner','otherowner'])assert.ok(await saved(f,actor,r));
 for(const actor of ['opener','foh','worker','dish']){assert.equal(await saved(f,actor,r),undefined);for(const action of ['note','correct','review','resolve','followup','contact','reopen'])assert.ok([403,404].includes((await f.call(actor,'incident.'+action,{...facts,note:'unauthorized'},r)).status));}
 for(const actor of ['worker','dish'])assert.equal((await f.call(actor,'incident.create',facts)).status,403);
 assert.equal((await f.view('foreign')).status,403);
 assert.equal((await f.call('foreign','incident.note',{note:'outside'},r)).status,403);
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='manager'").run();
 assert.equal(await saved(f,'manager',r),undefined);assert.equal((await f.call('manager','incident.note',{note:'old manager'},r)).status,403);assert.ok(await saved(f,'owner',r));
});
test('owner review, resolution, correction and reopen retain prior facts and decisions across reloads',async t=>{
 const f=await fixture(t);let r=ok(await f.call('manager','incident.create',facts));
 assert.equal((await f.call('owner','incident.resolve',{note:'too soon'},r)).status,400);
 for(const action of ['review','resolve','followup'])assert.equal((await f.call('manager','incident.'+action,{note:'unauthorized'},r)).status,403);
 r=ok(await f.call('owner','incident.review',{note:'Facts checked with reporter'},r));
 r=ok(await f.call('otherowner','incident.resolve',{note:'Test service restored'},r));
 const resolved=r;r=ok(await f.call('manager','incident.correct',{...facts,description:'Corrected fact',note:'Corrected observation'},r));
 assert.equal((await f.call('owner','incident.note',{note:'stale'},resolved)).status,409);
 let d=(await saved(f,'owner',r)).data;assert.equal(d.status,'open');assert.equal(d.review,null);assert.equal(d.resolution,'');assert.equal(d.versions[0].facts.description,facts.description);assert.equal(d.versions[0].resolution,'Test service restored');assert.equal(d.versions[0].review.actorId,'owner');
 r=ok(await f.call('owner','incident.review',{note:'Reviewed corrected version'},r));r=ok(await f.call('manager','incident.reopen',{note:'More facts needed'},r));
 d=(await saved(f,'manager',r)).data;assert.equal(d.status,'open');assert.equal(d.history.length,6);assert.ok(d.history.some(h=>h.action==='resolve'&&h.note==='Test service restored'));
});
test('owner follow-up retains changes and reported calls never manufacture notifications',async t=>{
 const f=await fixture(t);let r=ok(await f.call('manager','incident.create',facts));
 const follow={ownerId:'owner',due:'2026-10-01T10:00:00Z',nextStep:'Review repair evidence',note:'Owner follow-up'};
 for(const ownerId of ['manager','foreign','dish'])assert.equal((await f.call('owner','incident.followup',{...follow,ownerId},r)).status,400);
 r=ok(await f.call('owner','incident.followup',follow,r));r=ok(await f.call('otherowner','incident.followup',{...follow,ownerId:'otherowner',nextStep:'Inspect completion'},r));
 const contact={ownerId:'owner',contactedAt:'2026-09-21T18:10:00Z',result:'no-answer',note:'Tried primary'};
 r=ok(await f.call('manager','incident.contact',contact,r));r=ok(await f.call('manager','incident.contact',{...contact,ownerId:'otherowner',result:'spoke',note:'Reached backup'},r));
 const d=(await saved(f,'owner',r)).data;assert.equal(d.followUp.ownerId,'otherowner');assert.ok(d.history.some(h=>h.note.includes(follow.nextStep)&&h.note.includes(new Date(follow.due).toISOString())));assert.deepEqual(d.contacts.map(c=>c.result),['no-answer','spoke']);assert.equal(d.contacts[0].actorId,'manager');
 assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='message'").first()).n,0);
 const response=await handleAccess(new Request('https://test.example/api/access?locationId=a',{headers:f.headers('owner')}),f.db),access=await response.json();assert.equal(response.status,200);assert.ok(access.accounts.find(a=>a.id==='otherowner').responsibilities.some(r=>r.category==='Restricted incident follow-up'&&r.count===1));assert.ok(!JSON.stringify(access).includes(facts.description));
});
test('invalid facts, calls, blank reasons and future dates leave the original untouched',async t=>{
 const f=await fixture(t);const r=ok(await f.call('manager','incident.create',facts));
 for(const patch of [{title:''},{category:'made-up'},{occurredAt:'2099-01-01T10:00:00Z'},{occurredAt:'2026-02-30T10:00:00Z'},{place:''},{description:''},{immediateAction:''}])assert.equal((await f.call('manager','incident.create',{...facts,...patch})).status,400);
 assert.equal((await f.call('manager','incident.correct',facts,r)).status,400);
 for(const patch of [{ownerId:'foreign'},{result:'texted'},{contactedAt:'2099-01-01T10:00:00Z'},{contactedAt:'2026-09-20T10:00:00Z'}])assert.equal((await f.call('manager','incident.contact',{ownerId:'owner',contactedAt:'2026-09-21T18:10:00Z',result:'spoke',note:'Call',...patch},r)).status,400);
 assert.equal((await saved(f,'owner',r)).revision,1);
 const withCall=ok(await f.call('manager','incident.contact',{ownerId:'owner',contactedAt:'2026-09-21T18:10:00Z',result:'spoke',note:'Call'},r));
 assert.equal((await f.call('manager','incident.correct',{...facts,occurredAt:'2026-09-21T19:00:00Z',note:'After call'},withCall)).status,400);
});
test('incident data stays out of handoff, daily summary, AI and unauthorized archived reads',async t=>{
 const f=await fixture(t),r=ok(await f.call('manager','incident.create',facts)),w=ok(await f.view('owner')),at=new Date().toISOString();
 for(const output of [managerHandoff(w,'2026-09-21'),operationsHome(w,at),companionContext(w,'Tell me about '+facts.title,at)]){assert.ok(!JSON.stringify(output).includes(facts.description));assert.ok(!JSON.stringify(output).includes(facts.title));}
 assert.throws(()=>companionContext(w,'Read this report',at,[],{id:r.recordId,revision:1}),/available/i);
 await f.db.prepare("UPDATE records SET archived_at=?,archived_by='owner' WHERE id=?").bind(at,r.recordId).run();
 for(const actor of ['opener','foh','worker','dish']){
 const response=await handleRecordHistory(new Request('https://test.example/api/history?locationId=a&recordId='+r.recordId,{headers:f.headers(actor)}),f.db);assert.equal(response.status,404);
 const listing=await handleRecordHistory(new Request('https://test.example/api/history?locationId=a',{headers:f.headers(actor)}),f.db);assert.ok(!JSON.stringify(await listing.json()).includes(facts.description));}
 const response=await handleRecordHistory(new Request('https://test.example/api/history?locationId=a&recordId='+r.recordId,{headers:f.headers('owner')}),f.db);assert.equal(response.status,200);assert.ok(JSON.stringify(await response.json()).includes(facts.description));
});
test('incident commands preserve atomic audit, exact retries and concurrent revisions',async t=>{
 const f=await fixture(t),extra={requestId:'incident-repeat'},r=ok(await f.call('manager','incident.create',facts,undefined,extra));
 assert.deepEqual(ok(await f.call('manager','incident.create',facts,undefined,extra)),r);assert.equal((await f.call('manager','incident.create',{...facts,title:'changed'},undefined,extra)).status,409);
 await f.db.prepare("CREATE TRIGGER fail_incident BEFORE INSERT ON command_receipts WHEN NEW.request_id='incident-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await f.call('manager','incident.correct',{...facts,description:'Should rollback',note:'Correction'},r,{requestId:'incident-fail'})).status,503);
 assert.equal((await saved(f,'owner',r)).data.description,facts.description);assert.equal((await f.db.prepare("SELECT count(*) n FROM audit_events WHERE action LIKE 'incident.%'").first()).n,1);
 const writes=await Promise.all([f.call('owner','incident.review',{note:'Owner review'},r),f.call('manager','incident.correct',{...facts,description:'Concurrent correction',note:'Facts corrected'},r)]);assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
 assert.equal((await saved(f,'owner',r)).revision,2);
});
