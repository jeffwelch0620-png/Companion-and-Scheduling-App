import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {complianceRenewalState} from '../.sites-runtime/shared/compliance.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const old='2026-01-12T17:00:00Z',before='2026-05-01';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const facts=(reference,type='permit')=>({title:'Fictional '+reference,type,authority:'Fictional Äuthority',reference,documentDate:'2026-01-01',dueDate:'2026-03-01',evidence:'Fictional source page, not operating evidence',sourceUrl:'https://example.test/source',summary:'Fixture scope <only>',responsibleId:'owner'});
async function fixture(t){
 const compiled=process.env.JMAX_COMPLIANCE_COMPILED==='1';let outbound=0;
 const mf=new Miniflare({modules:true,...(compiled?{scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityFlags:['nodejs_compat'],serviceBindings:{ASSETS:()=>new Response('Missing',{status:404})}}:{script:'export default {fetch(){return new Response("test")}}'}),compatibilityDate:'2026-05-22',d1Databases:['DB'],outboundService:()=>{outbound++;throw Error('No outbound expected')}});t.after(async()=>{assert.equal(outbound,0);await mf.dispose()});const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();
 for(const [id,loc,caps,position='Manager',scheduleOnly=0] of [['owner','a',['location.manage'],'Owner'],['manager','a',['tasks.manage','people.manage']],['worker','a',[]],['dish','a',['location.manage'],'Dishwasher'],['schedule','a',['location.manage'],'Owner',1],['other','b',['location.manage'],'Owner'],['third','c',['location.manage'],'Owner']])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active,schedule_only) VALUES(?,?,?,?,?,'BOH',?,?,'[]',1,?)").bind(id,id+'@example.test',id,loc,'Fictional '+id,position,JSON.stringify(caps),scheduleOnly).run();
 const headers=actor=>({'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'});
 async function request(actor,url,body,binding=db){const init={headers:headers(actor),...(body?{method:'POST',body:JSON.stringify(body)}:{})};const res=compiled?await mf.dispatchFetch('http://localhost'+url,init):await (url.startsWith('/api/history')?handleRecordHistory:handleWorkspace)(new Request('http://localhost'+url,init),binding);return {status:res.status,data:await res.json()};}
 const call=(action,input={},record,actor='owner',loc='a',requestId=crypto.randomUUID())=>request(actor,'/api/workspace',{locationId:loc,requestId,action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})});
 const get=(params={},actor='owner',loc='a')=>request(actor,'/api/history?'+new URLSearchParams({locationId:loc,...params}));
 const view=async()=>ok(await request('owner','/api/workspace?locationId=a'));
 const row=id=>db.prepare('SELECT * FROM records WHERE id=?').bind(id).first();
 const age=()=>db.prepare('UPDATE records SET updated_at=? WHERE archived_at IS NULL').bind(old).run();
 const create=async(ref,type='permit')=>{let r=ok(await call('compliance.create',facts(ref,type)));return ok(await call('compliance.review',{note:'Fixture checked',sourceChecked:true},r));};
 const close=async r=>ok(await call('compliance.close',{note:'Fixture internal follow-up complete',followUpComplete:true},r));
 const link=async(newer,earlier)=>ok(await call('compliance.renewal-link',{previousId:earlier.recordId,previousRevision:earlier.revision,note:'Fixture renewal evidence',confirmed:true},newer));
 const file=async()=>{const p=ok(await get({preview:'1',before}));const body={action:'archive',locationId:'a',requestId:crypto.randomUUID(),confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))};return {p,body,response:await request('owner','/api/history',body)};};
 const restore=async recordId=>{const p=ok(await get({restore:recordId})),body={action:'restore',locationId:'a',recordId,requestId:crypto.randomUUID(),confirmed:true,workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))};return {p,body,response:await request('owner','/api/history',body)};};
 return {compiled,db,call,get,view,row,age,create,close,link,file,restore,request};
}

test('closed permit and inspection sources file only after the local retention cutoff, with their exact facts and outcomes',async t=>{
 const f=await fixture(t),p=await f.close(await f.create('P')),i=await f.close(await f.create('I','inspection'));await f.create('OPEN');ok(await f.call('compliance.create',facts('UNCHECKED')));
 assert.equal(ok(await f.get({preview:'1',before})).records.length,0);await f.age();
 // 04:30 UTC is the preceding restaurant day; 04:00 is midnight EDT.
 await f.db.prepare("UPDATE records SET updated_at='2026-05-01T03:59:59Z' WHERE id=?").bind(p.recordId).run();
 await f.db.prepare("UPDATE records SET updated_at='2026-05-01T04:00:00Z' WHERE id=?").bind(i.recordId).run();
 assert.deepEqual(ok(await f.get({preview:'1',before})).records.map(r=>r.id),[p.recordId]);await f.age();
 const original=JSON.parse((await f.row(p.recordId)).data),filed=await f.file();ok(filed.response);assert.equal(filed.p.records.length,2);assert.deepEqual(ok(await f.request('owner','/api/history',filed.body)),filed.response.data);
 assert.equal((await f.view()).records.length,2);const detail=ok(await f.get({recordId:p.recordId}));assert.deepEqual(detail.workspace.records.find(r=>r.id===p.recordId).data,original);assert.equal(detail.canRestore,true);
 const restored=await f.restore(p.recordId);ok(restored.response);assert.deepEqual(JSON.parse((await f.row(p.recordId)).data),original);assert.equal((await f.row(p.recordId)).archived_at,null);assert.equal(ok(await f.get({preview:'1',before})).records.length,0);
});

test('an open or recent renewal retains its earlier permit; closed chains file dependants first and restore required originals',async t=>{
 const f=await fixture(t);let earlier=await f.close(await f.create('OLD'));let newer=ok(await f.call('compliance.create',{...facts('NEW'),documentDate:'2026-02-01'}));newer=ok(await f.call('compliance.review',{note:'Checked',sourceChecked:true},newer));newer=await f.link(newer,earlier);await f.age();assert.equal(ok(await f.get({preview:'1',before})).records.length,0);
 newer=await f.close(newer);assert.equal(ok(await f.get({preview:'1',before})).records.length,0);await f.age();const filed=await f.file();ok(filed.response);assert.deepEqual(filed.p.records.map(r=>r.id),[newer.recordId,earlier.recordId]);
 const detail=ok(await f.get({recordId:newer.recordId}));assert.equal(detail.workspace.records.length,2);const source=detail.workspace.records.find(r=>r.id===newer.recordId);assert.equal(complianceRenewalState(source,detail.workspace),'current');assert.equal(source.data.renewal.previousFacts.reference,'OLD');
 const restored=await f.restore(newer.recordId);ok(restored.response);assert.equal(restored.p.records.length,2);assert.ok((await f.view()).records.every(r=>r.data.status==='closed'));
});

test('filing preserves owner-only content across list, detail, preview, restore and all three restaurant scopes',async t=>{
 const f=await fixture(t),record=await f.close(await f.create('PRIVATE'));await f.age();ok((await f.file()).response);
 for(const actor of ['manager','worker','dish','schedule']){assert.equal(ok(await f.get({kind:'compliance'},actor)).items.length,0);assert.equal((await f.get({recordId:record.recordId},actor)).status,404);assert.equal((await f.get({restore:record.recordId},actor)).status,403);}
 for(const [actor,loc] of [['other','b'],['third','c']]){assert.equal((await f.get({recordId:record.recordId},actor)).status,403);assert.equal(ok(await f.get({kind:'compliance'},actor,loc)).items.length,0);assert.equal((await f.get({recordId:record.recordId},actor,loc)).status,404);ok(await f.call('compliance.create',{...facts('PRIVATE'),responsibleId:actor},undefined,actor,loc));}
 assert.equal(ok(await f.get({kind:'compliance'})).items.length,1);
});

test('filed document identity stays reserved through creation and correction, including beyond one page and Unicode case folding',async t=>{
 const f=await fixture(t),original=await f.close(await f.create('MATCH'));await f.age();ok((await f.file()).response);const saved=await f.row(original.recordId);
 await f.db.batch(Array.from({length:101},(_,i)=>f.db.prepare("INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at,archived_by) VALUES(?,'a','compliance','owner','BOH',1,?,?,?,'owner')").bind('000-fixture-'+i,JSON.stringify({...JSON.parse(saved.data),reference:'filler-'+i}),old,old)));
 const attempted={...facts('match'),authority:'fictional äuthority'};assert.equal((await f.call('compliance.create',attempted)).status,409);
 const other=await f.create('DIFFERENT');assert.equal((await f.call('compliance.correct',{...attempted,note:'Fixture correction'},other)).status,409);assert.equal(JSON.parse((await f.row(other.recordId)).data).reference,'DIFFERENT');
 ok(await f.call('compliance.create',{...attempted,type:'inspection'}));ok(await f.call('compliance.create',{...attempted,documentDate:'2026-01-02'}));
});

test('a filed successor keeps its renewal relationship reserved when only its earlier permit is restored',async t=>{
 const f=await fixture(t),earlier=await f.close(await f.create('OLD'));let newer=ok(await f.call('compliance.create',{...facts('NEW'),documentDate:'2026-02-01'}));newer=ok(await f.call('compliance.review',{note:'Checked',sourceChecked:true},newer));newer=await f.close(await f.link(newer,earlier));await f.age();ok((await f.file()).response);ok((await f.restore(earlier.recordId)).response);
 const active=(await f.view()).records.find(r=>r.id===earlier.recordId);let alternate=ok(await f.call('compliance.create',{...facts('ALTERNATE'),documentDate:'2026-03-01'}));alternate=ok(await f.call('compliance.review',{note:'Checked',sourceChecked:true},alternate));const input={previousId:active.id,previousRevision:active.revision,note:'Fixture relationship',confirmed:true};assert.equal((await f.call('compliance.renewal-link',input,alternate)).status,409);
 ok((await f.restore(newer.recordId)).response);let current=(await f.view()).records.find(r=>r.id===newer.recordId);ok(await f.call('compliance.renewal-clear',{note:'Fixture incorrect relationship'},{recordId:current.id,revision:current.revision}));ok(await f.call('compliance.renewal-link',input,alternate));
});

test('changed reviewed selections and failed transactions never partially file safety sources',async t=>{
 const f=await fixture(t),r=await f.close(await f.create('ROLLBACK'));await f.age();const p=ok(await f.get({preview:'1',before})),body={action:'archive',locationId:'a',requestId:'file-safety',confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records};
 assert.equal((await f.request('owner','/api/history',{...body,records:[{id:r.recordId,revision:999}]})).status,409);assert.equal((await f.row(r.recordId)).archived_at,null);
 await f.db.prepare("CREATE TRIGGER fail_safety BEFORE INSERT ON audit_events WHEN NEW.action='history.archive' BEGIN SELECT RAISE(ABORT,'fictional failure'); END").run();assert.equal((await f.request('owner','/api/history',body)).status,503);assert.equal((await f.row(r.recordId)).archived_at,null);assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM command_receipts WHERE request_id='file-safety'").first()).n,0);
 await f.db.prepare('DROP TRIGGER fail_safety').run();ok(await f.request('owner','/api/history',body));
});
