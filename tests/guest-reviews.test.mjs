import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {applyCommand} from '../.sites-runtime/shared/domain.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {managerHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
import {guestReader} from '../.sites-runtime/shared/guest-reviews.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a',position='Manager'] of [['owner','Executive',['location.manage']],['otherowner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['opener','BOH',['tasks.manage']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['dish','BOH',['location.manage'],'a','Dishwasher'],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,position,JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={},binding=db)=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),binding);return {status:response.status,data:await response.json()}};
 const view=async(id,loc='a')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);return {status:r.status,data:await r.json()}};
 return {db,call,view,headers};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const facts={title:'Fictional guest review',channel:'Google',reference:'DEMO-REVIEW-001',sourceDate:'2026-09-01',dueDate:'2026-10-01',evidence:'Fictional individual review, restaurant and date checked for testing only.',sourceUrl:'https://example.test/reviews/1',feedback:'Fictional guest feedback: appetizer arrived after the main.',rating:2,managerId:'manager',ownerNote:'Check the handoff and report what happened. No compensation authorized.',sourceChecked:true};
const saved=async(f,id,r)=>ok(await f.view(id)).records.find(x=>x.id===r.recordId);
const ack=(f,r,who='manager')=>f.call(who,'guestreview.acknowledge',{note:'Read the source and accepted responsibility.',accepted:true},r);
const outcome=(f,r,who='manager')=>f.call(who,'guestreview.outcome',{note:'Checked the ticket handoff; discussed the timing with the team. No guest contact claimed.',outcomeConfirmed:true},r);
const close=(f,r)=>f.call('owner','guestreview.close',{note:'Reviewed the outcome; internal follow-up complete.',reviewed:true},r);
const hist=async(f,who,params={},body)=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'a',...params}),{headers:{...f.headers(who),Origin:'https://test.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),f.db);return {status:r.status,data:await r.json()}};

test('owner assigns, named manager acknowledges and reports, owner reviews; no fake messages or wider leakage',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','guestreview.create',facts));
 assert.equal((await saved(f,'manager',r)).data.status,'awaiting-ack');assert.equal((await saved(f,'otherowner',r)).ownerId,'manager');
 for(const who of ['opener','foh','worker','dish'])assert.equal(await saved(f,who,r),undefined);
 for(const who of ['manager','opener','foh','worker','dish','foreign'])assert.equal((await f.call(who,'guestreview.create',facts)).status,403);
 assert.equal((await ack(f,r,'owner')).status,403);assert.equal((await outcome(f,r)).status,400);assert.equal((await close(f,r)).status,400);
 assert.equal((await f.call('manager','guestreview.acknowledge',{note:'Not explicitly accepted'},r)).status,400);
 r=ok(await ack(f,r));assert.equal((await saved(f,'manager',r)).data.acknowledgment.by,'manager');
 assert.equal((await f.call('manager','guestreview.close',{note:'Self close',reviewed:true},r)).status,403);
 assert.equal((await f.call('owner','guestreview.outcome',{note:'Owner replaces manager',outcomeConfirmed:true},r)).status,403);
 r=ok(await outcome(f,r));assert.equal((await f.call('owner','guestreview.close',{note:'No confirmation'},r)).status,400);r=ok(await close(f,r));
 const d=(await saved(f,'owner',r)).data;assert.equal(d.status,'closed');assert.equal(d.history.length,4);assert.equal(d.closure.by,'owner');
 assert.equal((await f.call('manager','guestreview.note',{note:'Closed update'},r)).status,400);
 const w=ok(await f.view('owner')),at=new Date().toISOString();assert.equal(w.records.filter(x=>x.kind==='message').length,0);
 for(const output of [managerHandoff(w,'2026-09-21'),operationsHome(w,at),companionContext(w,'What guest feedback?',at)])assert.ok(!JSON.stringify(output).includes(facts.feedback));
 const foreign=ok(await f.call('foreign','guestreview.create',{...facts,managerId:'foreign'},undefined,{locationId:'b'}));assert.equal((await f.call('owner','guestreview.note',{note:'Wrong store'},foreign)).status,404);
});
test('return, reopen and corrected assignment keep previous source and outcomes, require fresh acknowledgment',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','guestreview.create',facts));r=ok(await ack(f,r));r=ok(await outcome(f,r));
 r=ok(await f.call('otherowner','guestreview.return',{note:'Clarify the service timing.'},r));let d=(await saved(f,'owner',r)).data;
 assert.equal(d.status,'awaiting-ack');assert.equal(d.outcome,null);assert.equal(d.versions[0].cycle.status,'owner-review');assert.ok(d.versions[0].cycle.outcome.note.includes('ticket'));
 r=ok(await ack(f,r));r=ok(await outcome(f,r));r=ok(await close(f,r));r=ok(await f.call('owner','guestreview.reopen',{note:'New information received.'},r));
 d=(await saved(f,'owner',r)).data;assert.equal(d.versions[1].cycle.closure.by,'owner');assert.equal(d.acknowledgment,null);
 r=ok(await f.call('owner','guestreview.correct',{...facts,managerId:'foh',feedback:'Corrected fictional wording.',note:'FOH will handle this.'},r));d=(await saved(f,'foh',r)).data;
 assert.equal(d.versions[2].facts.feedback,facts.feedback);assert.equal(d.managerName,'foh');assert.equal((await saved(f,'foh',r)).area,'FOH');assert.equal(await saved(f,'manager',r),undefined);
 assert.equal((await ack(f,r)).status,404);r=ok(await ack(f,r,'foh'));assert.equal((await saved(f,'foh',r)).data.acknowledgment.by,'foh');
});
test('source facts, dates, URLs, ratings, assignment and acknowledgments are validated',async t=>{
 const f=await fixture(t);
 for(const patch of [{title:''},{channel:'Yelp'},{reference:''},{sourceDate:'2099-01-01'},{sourceDate:'2026-02-30'},{dueDate:'2026-08-01'},{dueDate:''},{evidence:''},{feedback:''},{sourceUrl:''},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:pass@example.test'},{sourceUrl:'http://example.test'},{rating:true},{rating:6},{rating:2.5},{rating:[]},{managerId:'worker'},{managerId:'foreign'},{managerId:'dish'},{ownerNote:''},{sourceChecked:false}])assert.equal((await f.call('owner','guestreview.create',{...facts,...patch})).status,400,JSON.stringify(patch));
 const r=ok(await f.call('owner','guestreview.create',{...facts,channel:'In person',sourceUrl:'',rating:''}));assert.equal((await saved(f,'owner',r)).data.rating,null);
 assert.equal((await f.call('owner','guestreview.note',{note:' '},r)).status,400);assert.equal((await f.call('owner','guestreview.unknown',{note:'Unknown'},r)).status,400);
 const w=ok(await f.view('owner')),command={requestId:'calendar-test',locationId:'a',action:'guestreview.create',input:{...facts,sourceDate:'2026-09-29'}};
 assert.equal(applyCommand(w,command,'2026-09-30T01:00:00Z',()=> 'calendar-record')[0].data.sourceDate,'2026-09-29');
 assert.throws(()=>applyCommand(w,{...command,input:{...command.input,sourceDate:'2026-09-30'}},'2026-09-30T01:00:00Z'),/future/);
 const scheduleOnly={...w.me,scheduleOnly:true};assert.equal(guestReader((await saved(f,'owner',r)),scheduleOnly),false);
});
test('stable source IDs and URLs prevent duplicates including corrections and archived records',async t=>{
 const f=await fixture(t),r=ok(await f.call('owner','guestreview.create',{...facts,sourceUrl:facts.sourceUrl+'#review'}));
 for(const patch of [{reference:'demo-review-001',sourceUrl:'https://example.test/different'},{reference:'NEW-ID',sourceUrl:facts.sourceUrl+'#other'}])assert.equal((await f.call('owner','guestreview.create',{...facts,...patch})).status,409);
 const second=ok(await f.call('owner','guestreview.create',{...facts,reference:'SECOND',sourceUrl:'https://example.test/second'}));
 assert.equal((await f.call('owner','guestreview.correct',{...facts,note:'Duplicate correction'},second)).status,409);
 await f.db.prepare("UPDATE records SET archived_at=?,archived_by='owner' WHERE id=?").bind(new Date().toISOString(),r.recordId).run();
 assert.equal((await f.call('owner','guestreview.create',facts)).status,409);assert.equal((await f.call('owner','guestreview.correct',{...facts,note:'Duplicate archived'},second)).status,409);
});
test('exact retries, conflicting writes and failed persistence do not duplicate or lose outcomes',async t=>{
 const f=await fixture(t),extra={requestId:'guest-create-repeat'};let r=ok(await f.call('owner','guestreview.create',facts,undefined,extra));
 assert.deepEqual(ok(await f.call('owner','guestreview.create',facts,undefined,extra)),r);assert.equal((await f.call('owner','guestreview.create',{...facts,title:'Changed'},undefined,extra)).status,409);
 const edits=await Promise.all([ack(f,r),f.call('owner','guestreview.correct',{...facts,feedback:'Changed feedback.',note:'Correct source'},r)]);assert.deepEqual(edits.map(x=>x.status).sort(),[200,409]);
 r=await saved(f,'owner',r);const original=JSON.stringify(r.data);
 await f.db.prepare("CREATE TRIGGER fail_guest BEFORE INSERT ON command_receipts WHEN NEW.request_id='guest-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await f.call('owner','guestreview.note',{note:'Should roll back'},r,{requestId:'guest-fail'})).status,503);
 const latest=ok(await f.view('owner')).records.find(x=>x.id===r.id);assert.equal(JSON.stringify(latest.data),original);assert.equal(latest.revision,r.revision);
 assert.equal((await f.db.prepare("SELECT count(*) n FROM audit_events WHERE action LIKE 'guestreview.%'").first()).n,2);
});
test('revoked access loses reading and updating; employee-access counts identify reassignment without feedback content',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','guestreview.create',facts));
 const response=await handleAccess(new Request('https://test.example/api/access?locationId=a',{headers:f.headers('owner')}),f.db),access=await response.json();assert.equal(response.status,200);assert.ok(access.accounts.find(a=>a.id==='manager').responsibilities.some(x=>x.category==='Guest review follow-up'&&x.count===1));assert.ok(!JSON.stringify(access).includes(facts.feedback));
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='manager'").run();assert.equal(await saved(f,'manager',r),undefined);assert.equal((await ack(f,r)).status,403);
 assert.equal((await f.call('owner','guestreview.correct',{...facts,note:'Former manager'},r)).status,400);
 r=ok(await f.call('owner','guestreview.correct',{...facts,managerId:'opener',note:'Reassigned to active manager'},r));assert.ok(await saved(f,'opener',r));
});
test('assignee revocation at commit prevents a new inaccessible handoff',async t=>{
 const f=await fixture(t);let batches=0;
 const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();return f.db.batch(statements)}})};
 assert.equal((await f.call('owner','guestreview.create',facts,undefined,{},binding)).status,409);assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='guestreview'").first()).n,0);
});
test('closed follow-up can be filed and restored by owner; assigned reader and source deduplication remain scoped',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','guestreview.create',facts));r=ok(await ack(f,r));r=ok(await outcome(f,r));r=ok(await close(f,r));
 await f.db.prepare('UPDATE records SET updated_at=? WHERE id=?').bind('2026-01-01T12:00:00Z',r.recordId).run();
 const before='2026-05-01',plan=ok(await hist(f,'owner',{preview:'1',before}));assert.equal(plan.records.length,1);assert.equal(ok(await hist(f,'manager',{preview:'1',before})).records.length,0);
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'file-guest',action:'archive',confirmed:true,before,workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));
 assert.equal(await saved(f,'owner',r),undefined);assert.equal(ok(await hist(f,'manager',{kind:'guestreview'})).items.length,1);assert.equal(ok(await hist(f,'opener',{kind:'guestreview'})).items.length,0);
 const detail=ok(await hist(f,'manager',{recordId:r.recordId}));assert.equal(detail.canRestore,false);assert.equal(detail.workspace.records.find(x=>x.id===r.recordId).data.closure.by,'owner');
 assert.equal((await hist(f,'opener',{recordId:r.recordId})).status,404);assert.equal((await hist(f,'manager',{restore:r.recordId})).status,403);
 assert.equal((await f.call('owner','guestreview.create',facts)).status,409);
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-guest',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));
 const restored=await saved(f,'owner',r);assert.equal(restored.data.history.length,4);assert.equal(restored.data.feedback,facts.feedback);ok(await f.call('owner','guestreview.reopen',{note:'Follow up after restoring.'},restored));
});
