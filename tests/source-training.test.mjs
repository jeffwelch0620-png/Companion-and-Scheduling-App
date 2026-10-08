import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { handleWorkspace } from '../.sites-runtime/shared/service.mjs';
import { sourceLibrary } from '../.sites-runtime/shared/source-library-data.mjs';
import { approvedStationGuides } from '../.sites-runtime/shared/station-knowledge.mjs';
import { starterTaskPacks, starterTaskRevision } from '../.sites-runtime/shared/starter-tasks.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const source=sourceLibrary.documents.find(d=>d.department==='FOH'&&d.conflicts.length&&d.stations.some(s=>s!=='Dishwasher'));
const input={sourceId:source.id,sourceHash:source.sha256,area:'FOH',title:'Fictional training kit',position:'Server',zone:'Fictional practice kit'};
const guide={purpose:'Fictional test practice only.',preparation:[],steps:['Arrange the fictional practice card.'],troubleshooting:[],escalation:'Ask the fictional trainer.'};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+name,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const location of ['berts','other'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Fictional '+location,'America/New_York').run();
 for(const [id,area,position,caps,location='berts'] of [['owner','Executive','Owner',['location.manage','standards.approve']],['employee','FOH','Server',[]],['manager','FOH','Manager',['standards.approve']],['drafter','FOH','Trainer',['tasks.manage']],['dish','BOH','Dishwasher',['location.manage','standards.approve']],['other','FOH','Owner',['location.manage','standards.approve'],'other']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',id,location,id,area,position,JSON.stringify(caps),'[]').run();
 const call=async(actor,action,input={},record,options={})=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json','oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test'},body:JSON.stringify({requestId:options.requestId??crypto.randomUUID(),locationId:options.locationId??'berts',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})})}),db);return {status:response.status,data:await response.json()}};
 const view=async(actor)=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=berts',{headers:{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test'}}),db);return response.json()};
 const record=async saved=>(await view('owner')).records.find(r=>r.id===(saved.recordId??saved.id));
 return {db,call,view,record};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const starterInput={templateIds:starterTaskPacks.map(p=>p.id),catalogRevision:starterTaskRevision};

test('an owner can withdraw an unwanted draft without approving it and its removal stays in history',async t=>{
 const f=await fixture(t);
 assert.ok(!starterTaskPacks.some(p=>p.id==='bartender'));
 assert.equal((await f.call('owner','standard.preload-starters',{...starterInput,templateIds:['bartender']})).status,404);
 ok(await f.call('owner','standard.preload-starters',{...starterInput,templateIds:['server']}));
 const draft=(await f.view('owner')).records[0];
 for(const actor of ['employee','dish','other','drafter'])assert.ok((await f.call(actor,'standard.retire',{note:'Role does not apply.'},draft)).status>=400);
 ok(await f.call('owner','standard.retire',{note:'Role does not apply.'},draft));
 const removed=await f.record(draft);assert.equal(removed.data.status,'retired');assert.equal(removed.data.history.at(-1).action,'withdrawn');assert.equal(removed.data.history.at(-1).note,'Role does not apply.');
 assert.ok(!removed.data.history.some(h=>h.action==='approved'));
 assert.equal((await f.view('employee')).records.length,0);
 assert.equal((await f.call('owner','standard.retire',{note:'Repeat'},removed)).status,400);
});

test('starter preload saves role drafts, excludes dish and cannot publish or assign through injected fields',async t=>{
 const f=await fixture(t);ok(await f.call('owner','standard.preload-starters',{...starterInput,status:'approved',provenance:{questions:[]}}));
 const records=(await f.view('owner')).records;assert.equal(records.length,starterTaskPacks.length);
 for(const r of records){assert.equal(r.kind,'standard');assert.equal(r.data.status,'draft');assert.equal(r.data.provenance.questions.length,3);assert.equal(r.data.provenance.review,undefined);assert.notEqual(r.data.position,'Dishwasher');assert.equal(r.data.guide.preparation.length+r.data.guide.steps.length,9)}
 assert.equal((await f.view('employee')).records.length,0);assert.equal((await f.view('dish')).records.length,0);assert.equal(approvedStationGuides(await f.view('owner')).length,0);
});
test('starter requests respect restaurant and department permissions, catalog revision and validated unique selection',async t=>{
 const f=await fixture(t);
 for(const actor of ['employee','dish','other','manager','drafter'])assert.equal((await f.call(actor,'standard.preload-starters',starterInput)).status,403);
 assert.equal((await f.call('owner','standard.preload-starters',{...starterInput,catalogRevision:0})).status,409);
 for(const ids of [[],['server','server'],['not-a-job']])assert.ok((await f.call('owner','standard.preload-starters',{...starterInput,templateIds:ids})).status>=400);
 assert.equal((await f.view('owner')).records.length,0);
 ok(await f.call('manager','standard.preload-starters',{...starterInput,templateIds:['server']}));
 assert.equal((await f.view('owner')).records.length,1);
});
test('repeat starter loading preserves edited drafts and adds only missing jobs',async t=>{
 const f=await fixture(t),opts={requestId:'starter-repeat'};const result=ok(await f.call('owner','standard.preload-starters',{...starterInput,templateIds:['server']},undefined,opts));
 assert.deepEqual(ok(await f.call('owner','standard.preload-starters',{...starterInput,templateIds:['server']},undefined,opts)),result);
 let r=(await f.view('owner')).records[0];ok(await f.call('owner','standard.save',{...ready(r),title:'My edited server routine'},r));
 ok(await f.call('owner','standard.preload-starters',starterInput));let rows=(await f.view('owner')).records;assert.equal(rows.length,starterTaskPacks.length);assert.equal(rows.find(x=>x.id===r.id).data.title,'My edited server routine');
 assert.equal((await f.call('owner','standard.preload-starters',starterInput)).status,409);assert.equal((await f.view('owner')).records.length,starterTaskPacks.length);
});
test('starter approval needs local decisions and review evidence; approved versions restart review when revised',async t=>{
 const f=await fixture(t);ok(await f.call('owner','standard.preload-starters',{...starterInput,templateIds:['server']}));let r=(await f.view('owner')).records[0];
 assert.equal((await f.call('owner','standard.approve',{validated:true,note:'Unreviewed'},r)).status,400);
 assert.equal((await f.call('owner','standard.save',{...ready(r),provenance:{questions:[]}},r)).status,400);
 let saved=ok(await f.call('owner','standard.save',{...ready(r),sourceReview:{ownerId:'employee',reviewedOn:'2026-09-10',evidence:'Invalid owner'}},r));assert.equal((await f.call('owner','standard.approve',{validated:true,note:'Unreviewed'},saved)).status,400);
 saved=ok(await f.call('owner','standard.save',ready(r),saved));saved=ok(await f.call('owner','standard.approve',{validated:true,note:'Fictional fixture approval only'},saved));r=await f.record(saved);assert.equal(approvedStationGuides(await f.view('employee')).length,1);
 const next={...ready(r),version:2,basedOnId:r.id,basedOnRevision:r.revision};delete next.sourceAnswers;delete next.sourceReview;
 saved=ok(await f.call('owner','standard.save',next));const revision=await f.record(saved);assert.deepEqual(revision.data.provenance.starter,r.data.provenance.starter);assert.deepEqual(revision.data.provenance.answers,{});assert.equal(revision.data.provenance.review,undefined);
 assert.equal((await f.call('owner','standard.approve',{validated:true,note:'Unreviewed v2'},saved)).status,400);
});
test('a failed starter batch rolls back all job drafts and its receipt; retry saves exactly once',async t=>{
 const f=await fixture(t),opts={requestId:'starter-atomic'};
 await f.db.prepare("CREATE TRIGGER fail_starter BEFORE INSERT ON audit_events WHEN NEW.action='standard.preload-starters' BEGIN SELECT RAISE(ABORT,'fictional failure'); END").run();
 assert.equal((await f.call('owner','standard.preload-starters',starterInput,undefined,opts)).status,503);assert.equal((await f.view('owner')).records.length,0);
 await f.db.prepare('DROP TRIGGER fail_starter').run();const saved=ok(await f.call('owner','standard.preload-starters',starterInput,undefined,opts));assert.deepEqual(ok(await f.call('owner','standard.preload-starters',starterInput,undefined,opts)),saved);assert.equal((await f.view('owner')).records.length,starterTaskPacks.length);
});
function ready(r){return {title:r.data.title,zone:r.data.zone,position:r.data.position,version:r.data.version,source:r.data.source,criteria:['Fictional card arranged.'],verification:'manager',guide,sourceAnswers:Object.fromEntries(r.data.provenance.questions.map(q=>[q.id,'Fictional review answer; no real operating approval.'])),sourceReview:{ownerId:'owner',reviewedOn:'2026-09-10',evidence:'Fictional fixture only.'}}}

test('private source import requires owner and drafting authority, exact restaurant and source hash',async t=>{
 const f=await fixture(t);
 for(const actor of ['employee','manager','drafter','dish'])assert.equal((await f.call(actor,'standard.from-source',input)).status,403);
 assert.equal((await f.call('other','standard.from-source',input,undefined,{locationId:'other'})).status,404);
 assert.equal((await f.call('owner','standard.from-source',{...input,sourceHash:'stale'})).status,409);
 const saved=ok(await f.call('owner','standard.from-source',{...input,provenance:{questions:[]},guide,status:'approved'}));const r=await f.record(saved);
 assert.equal(r.data.status,'draft');assert.equal(r.area,'FOH');assert.deepEqual(r.data.criteria,[]);assert.equal(r.data.guide,undefined);assert.equal(r.data.provenance.intake.sha256,source.sha256);assert.ok(r.data.provenance.questions.length>=3);assert.equal(JSON.stringify(r).includes(source.content),false);assert.equal(JSON.stringify(r).includes(source.sourcePath),false);
 assert.equal((await f.call('owner','standard.from-source',input)).status,409);assert.equal((await f.view('employee')).records.some(x=>x.id===r.id),false);assert.equal((await f.view('dish')).records.some(x=>x.kind==='standard'),false);
});
test('partial source drafts persist but incomplete instructions and unresolved review cannot be approved',async t=>{
 const f=await fixture(t);let saved=ok(await f.call('owner','standard.from-source',input)),r=await f.record(saved);
 assert.equal((await f.call('owner','standard.approve',{validated:true,note:'Incomplete'},saved)).status,400);
 saved=ok(await f.call('owner','standard.save',{...ready(r),criteria:[],guide:{...guide,steps:[],escalation:''},sourceAnswers:{scope:'Fictional partial scope'},sourceReview:{ownerId:'',reviewedOn:'',evidence:''}},saved));r=await f.record(saved);
 assert.equal(r.data.guide.purpose,guide.purpose);assert.equal(r.data.provenance.answers.scope,'Fictional partial scope');assert.equal((await f.call('owner','standard.approve',{validated:true,note:'Incomplete'},saved)).status,400);
 assert.equal((await f.call('owner','standard.save',{...ready(r),provenance:{questions:[]}},saved)).status,400);
 assert.equal((await f.call('owner','standard.save',{...ready(r),sourceAnswers:{unknown:'Injected'}},saved)).status,400);
});
test('approval rechecks content ownership, calendar date and complete source decisions',async t=>{
 const f=await fixture(t);let saved=ok(await f.call('owner','standard.from-source',input)),r=await f.record(saved);
 for(const patch of [{ownerId:'employee'},{ownerId:'other'},{reviewedOn:'2026-02-30'},{reviewedOn:'2099-01-01'},{evidence:''}]){saved=ok(await f.call('owner','standard.save',{...ready(r),sourceReview:{...ready(r).sourceReview,...patch}},saved));assert.equal((await f.call('owner','standard.approve',{validated:true,note:'Invalid review'},saved)).status,400)}
 saved=ok(await f.call('owner','standard.save',ready(r),saved));const approved=ok(await f.call('owner','standard.approve',{validated:true,note:'Fictional owner approval only.'},saved));
 const employee=await f.view('employee');assert.equal(approvedStationGuides(employee).some(x=>x.id===approved.recordId),true);assert.equal((await f.view('dish')).records.some(x=>x.kind==='standard'),false);
 const result=await f.record(approved);assert.equal(result.data.provenance.intake.sourceOwner,null);assert.equal(result.data.provenance.intake.lastApprovedDate,null);assert.equal(result.data.history.at(-1).actorId,'owner');assert.equal(source.publicationStatus,'reference_only');
});
test('new source guide version resets review, keeps provenance, rejects stale saves and atomically retires previous guide',async t=>{
 const f=await fixture(t);let saved=ok(await f.call('owner','standard.from-source',input)),r=await f.record(saved);saved=ok(await f.call('owner','standard.save',ready(r),saved));const approved=ok(await f.call('owner','standard.approve',{validated:true,note:'Fictional v1'},saved));r=await f.record(approved);
 assert.equal((await f.call('owner','standard.save',ready(r),approved)).status,400);
 const nextInput={...ready(r),version:2,basedOnId:r.id,basedOnRevision:r.revision};delete nextInput.sourceAnswers;delete nextInput.sourceReview;
 let next=ok(await f.call('owner','standard.save',nextInput));const draft=await f.record(next);assert.deepEqual(draft.data.provenance.answers,{});assert.equal(draft.data.provenance.review,undefined);assert.deepEqual(draft.data.provenance.intake,r.data.provenance.intake);
 assert.equal((await f.call('owner','standard.approve',{validated:true,note:'Not reviewed'},next)).status,400);
 const old=next;next=ok(await f.call('owner','standard.save',ready(draft),next));assert.equal((await f.call('owner','standard.save',ready(draft),old)).status,409);
 ok(await f.call('owner','standard.approve',{validated:true,note:'Fictional v2'},next));assert.equal((await f.record(approved)).data.status,'retired');
});
test('source import receipt and record roll back together, retry does not duplicate the guide',async t=>{
 const f=await fixture(t),opts={requestId:'source-transaction'};
 await f.db.prepare("CREATE TRIGGER fail_source_draft BEFORE INSERT ON audit_events WHEN NEW.action='standard.from-source' BEGIN SELECT RAISE(ABORT,'fictional failure'); END").run();
 assert.equal((await f.call('owner','standard.from-source',input,undefined,opts)).status,503);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM records').first()).n,0);
 await f.db.prepare('DROP TRIGGER fail_source_draft').run();const saved=ok(await f.call('owner','standard.from-source',input,undefined,opts));assert.deepEqual(ok(await f.call('owner','standard.from-source',input,undefined,opts)),saved);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='standard'").first()).n,1);
});
