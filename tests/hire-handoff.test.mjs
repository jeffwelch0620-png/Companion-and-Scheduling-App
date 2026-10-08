import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {hireEvidence} from '../.sites-runtime/shared/hire-handoff.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
import {availableModules} from '../.sites-runtime/shared/operations-home.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a',position='Manager'] of [['owner','Executive',['location.manage']],['people','BOH',['people.manage']],['scheduler','BOH',['schedule.manage','schedule.publish']],['other','BOH',['schedule.manage']],['foh','FOH',['people.manage','schedule.manage']],['worker','BOH',[]],['dish','BOH',['location.manage'],'a','Dishwasher'],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,position,JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={},binding=db)=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),binding);return {status:response.status,data:await response.json()}};
 const view=async(id,loc='a')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);return {status:r.status,data:await r.json()}};
 const access=async(action,input={})=>{const r=await handleAccess(new Request('https://test.example/api/access',{method:'POST',headers:{...headers('owner'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({locationId:'a',requestId:crypto.randomUUID(),action,input})}),db);return {status:r.status,data:await r.json()}};
 const hire=ok(await access('hire.save',{note:'Fictional test hire setup only.',hireDate:'2026-09-01',profile:{name:'Fictional new cook',email:'newhire@example.test',area:'BOH',position:'Line Cook',capabilities:[],qualifications:['Line Cook']}}));
 const candidate=ok(await view('owner')).hireCandidates[0];assert.ok(candidate,'saved hire becomes candidate');
 const setReady=()=>db.prepare('UPDATE memberships SET active=1,employment=json_set(employment,\'$.status\',\'active\'),revision=revision+1 WHERE id=?').bind(candidate.id).run();
 const shift=async(id='published-first',patch={},ownerId=candidate.id,area='BOH')=>{const d={start:'2026-09-02T15:00:00Z',end:'2026-09-02T21:00:00Z',position:'Line Cook',published:true,...patch};await db.prepare("INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,'a','shift',?,?,1,?,?)").bind(id,ownerId,area,JSON.stringify(d),'2026-09-01T10:00:00Z').run();return {id,revision:1,data:d}};
 return {db,call,view,headers,access,candidate,hire,setReady,shift};
}
const fields=c=>({employeeId:c.id,employeeRevision:c.revision,schedulerId:'scheduler',targetDate:'2026-09-02',handoffNote:'Fictional private scheduling note: arrange the first station shift.'});
const saved=async(f,id,r)=>ok(await f.view(id)).records.find(x=>x.id===(r.recordId??r.id));
const accept=(f,r,who='scheduler')=>f.call(who,'hirehandoff.accept',{note:'Read and accepted scheduling responsibility.',accepted:true},r);
const confirm=(f,r,s={id:'published-first',revision:1},who='scheduler')=>f.call(who,'hirehandoff.confirm',{note:'Checked the published first shift and employee.',shiftId:s.id,shiftRevision:s.revision,checked:true},r);
const hist=async(f,who,params={},body)=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'a',...params}),{headers:{...f.headers(who),Origin:'https://test.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),f.db);return {status:r.status,data:await r.json()}};

test('pending hire is visible only to scoped coordinator, then named scheduler; handoff never enables access or leaks HR data',async t=>{
 const f=await fixture(t),w=ok(await f.view('owner'));assert.equal(w.members.some(m=>m.id===f.candidate.id),false);assert.ok(ok(await f.view('people')).hireCandidates.some(c=>c.id===f.candidate.id));
 for(const who of ['scheduler','other','worker','foh','dish'])assert.deepEqual(ok(await f.view(who)).hireCandidates,[]);
 let r=ok(await f.call('people','hirehandoff.create',fields(f.candidate)));assert.ok(await saved(f,'scheduler',r));assert.ok(await saved(f,'owner',r));
 for(const who of ['other','worker','foh','dish']){assert.equal(await saved(f,who,r),undefined);assert.deepEqual(ok(await f.view(who)).hireCandidates,[])}
 const scheduler=ok(await f.view('scheduler'));assert.ok(availableModules(scheduler.me).some(m=>m.tab==='First-shift handoff'));assert.deepEqual(Object.keys(scheduler.hireCandidates[0]).sort(),['id','name','area','position','revision','active','scheduleOnly','hireDate','status'].sort());
 assert.equal((await f.view('newhire')).status,403);assert.equal((await f.db.prepare('SELECT active FROM memberships WHERE id=?').bind(f.candidate.id).first()).active,0);
 assert.equal((await f.call('foh','hirehandoff.create',fields(f.candidate))).status,403);assert.equal((await f.call('worker','hirehandoff.create',fields(f.candidate))).status,403);assert.equal((await f.call('foreign','hirehandoff.note',{note:'Wrong restaurant'},r)).status,403);
 assert.equal((await accept(f,r,'owner')).status,403);r=ok(await accept(f,r));assert.equal((await confirm(f,r)).status,409);
 assert.ok(!JSON.stringify(companionContext(scheduler,'Show first shift',new Date().toISOString())).includes(fields(f.candidate).handoffNote));assert.equal(scheduler.records.filter(x=>x.kind==='message').length,0);
});
test('named scheduler must accept, then explicitly confirm earliest current published shift; sign-in remains separate',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','hirehandoff.create',fields(f.candidate)));assert.equal((await confirm(f,r)).status,400);assert.equal((await f.call('scheduler','hirehandoff.accept',{note:'No confirmation'},r)).status,400);r=ok(await accept(f,r));
 await f.setReady();const first=await f.shift();await f.shift('later',{start:'2026-09-03T15:00:00Z',end:'2026-09-03T21:00:00Z'});
 for(const [id,patch,who,area] of [['draft',{published:false}],['cancelled',{cancelled:true}],['released',{releasedAt:'2026-09-01T12:00:00Z'}],['before-hire',{start:'2026-08-31T15:00:00Z'}],['wrong-person',{},'worker'],['wrong-department',{},undefined,'FOH']]){const s=await f.shift(id,patch,who,area);assert.equal((await confirm(f,r,s)).status,400,id)}
 assert.equal((await confirm(f,r,{id:first.id,revision:99})).status,409);assert.equal((await confirm(f,r,{id:'later',revision:1})).status,400);assert.equal((await confirm(f,r,first,'owner')).status,403);
 assert.equal((await f.call('scheduler','hirehandoff.confirm',{note:'No checkbox',shiftId:first.id,shiftRevision:1},r)).status,400);r=ok(await confirm(f,r));
 const w=ok(await f.view('scheduler')),record=w.records.find(x=>x.id===r.recordId);assert.equal(hireEvidence(w,record).current,true);assert.equal(record.data.history.length,3);assert.equal(record.data.confirmation.by,'scheduler');assert.equal((await f.call('owner','hirehandoff.note',{note:'Closed'},r)).status,400);
 const row=await f.db.prepare('SELECT auth_user_id FROM memberships WHERE id=?').bind(f.candidate.id).first();assert.equal(row.auth_user_id,null);
});
test('changed shift or employee setup invalidates confirmation; reopening retains proof and requires a fresh acknowledgment',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','hirehandoff.create',fields(f.candidate)));r=ok(await accept(f,r));await f.setReady();await f.shift();r=ok(await confirm(f,r));
 await f.db.prepare("UPDATE records SET revision=revision+1,data=json_set(data,'$.cancelled',1) WHERE id='published-first'").run();let w=ok(await f.view('owner'));assert.equal(hireEvidence(w,w.records.find(x=>x.id===r.recordId)).needsReview,true);
 r=ok(await f.call('owner','hirehandoff.reopen',{note:'Published shift cancelled; arrange another.'},r));let d=(await saved(f,'owner',r)).data;assert.equal(d.confirmation,null);assert.equal(d.versions[0].cycle.confirmation.shiftId,'published-first');assert.equal(d.acknowledgment,null);assert.equal((await confirm(f,r)).status,400);
 r=ok(await accept(f,r));await f.shift('new-first');r=ok(await confirm(f,r,{id:'new-first',revision:1}));await f.db.prepare("UPDATE memberships SET employment=json_set(employment,'$.hireDate','2026-09-04'),revision=revision+1 WHERE id=?").bind(f.candidate.id).run();w=ok(await f.view('owner'));assert.equal(hireEvidence(w,w.records.find(x=>x.id===r.recordId)).current,false);assert.equal((await f.call('owner','hirehandoff.reopen',{note:'Wrong hire date'},r)).status,409);
 r=ok(await f.call('owner','hirehandoff.cancel',{note:'Retain previous hire history.'},r));assert.equal((await saved(f,'owner',r)).data.status,'cancelled');assert.equal((await f.db.prepare('SELECT active FROM memberships WHERE id=?').bind(f.candidate.id).first()).active,1);
});
test('facts and permission scope are checked; corrections preserve old assignment and require a new scheduler acknowledgment',async t=>{
 const f=await fixture(t);
 for(const patch of [{employeeRevision:99},{schedulerId:'worker'},{schedulerId:'foh'},{schedulerId:'foreign'},{targetDate:'2026-02-30'},{targetDate:'2026-08-31'},{handoffNote:''}])assert.notEqual((await f.call('owner','hirehandoff.create',{...fields(f.candidate),...patch})).status,200,JSON.stringify(patch));
 let r=ok(await f.call('owner','hirehandoff.create',fields(f.candidate)));r=ok(await accept(f,r));r=ok(await f.call('people','hirehandoff.correct',{...fields(f.candidate),schedulerId:'other',note:'Different scheduler covers this hire.'},r));const d=(await saved(f,'other',r)).data;assert.equal(d.versions[0].facts.schedulerId,'scheduler');assert.equal(d.versions[0].cycle.status,'accepted');assert.equal(d.status,'awaiting-ack');assert.equal(await saved(f,'scheduler',r),undefined);assert.equal((await accept(f,r)).status,404);r=ok(await accept(f,r,'other'));
 assert.equal((await f.call('other','hirehandoff.cancel',{note:'Scheduler tries cancellation'},r)).status,403);assert.equal((await f.call('other','hirehandoff.unknown',{note:'Unknown'},r)).status,400);
});
test('exact retry, stale revisions, duplicate active and archived hires, atomic rollback and access responsibility counts',async t=>{
 const f=await fixture(t),extra={requestId:'hire-stable'};let r=ok(await f.call('owner','hirehandoff.create',fields(f.candidate),undefined,extra));assert.deepEqual(ok(await f.call('owner','hirehandoff.create',fields(f.candidate),undefined,extra)),r);
 assert.equal((await f.call('owner','hirehandoff.create',{...fields(f.candidate),targetDate:'2026-09-03'},undefined,extra)).status,409);assert.equal((await f.call('owner','hirehandoff.create',fields(f.candidate))).status,409);
 const access=await handleAccess(new Request('https://test.example/api/access?locationId=a',{headers:f.headers('owner')}),f.db),data=await access.json();assert.ok(data.accounts.find(x=>x.id==='scheduler').responsibilities.some(x=>x.category==='First-shift scheduling handoff'&&x.count===1));assert.ok(!JSON.stringify(data).includes(fields(f.candidate).handoffNote));
 const prior=r;r=ok(await accept(f,r));assert.equal((await f.call('owner','hirehandoff.note',{note:'Stale'},prior)).status,409);
 await f.db.prepare("CREATE TRIGGER fail_hire BEFORE INSERT ON command_receipts WHEN NEW.request_id='hire-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();assert.equal((await f.call('owner','hirehandoff.note',{note:'Failed save'},r,{requestId:'hire-fail'})).status,503);assert.equal((await saved(f,'owner',r)).revision,r.revision);
 await f.db.prepare('UPDATE records SET archived_at=? WHERE id=?').bind(new Date().toISOString(),r.recordId).run();assert.equal((await f.call('owner','hirehandoff.create',fields(f.candidate))).status,409);
});
test('concurrent employee changes or scheduler revocation prevent committing obsolete responsibility',async t=>{
 for(const target of ['employee','scheduler']){const f=await fixture(t);let batches=0;const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{if(++batches===2)await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind(target==='employee'?f.candidate.id:'scheduler').run();return f.db.batch(statements)}})};
 assert.equal((await f.call('owner','hirehandoff.create',fields(f.candidate),undefined,{},binding)).status,409);assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='hirehandoff'").first()).n,0);}
});
test('scheduled evidence cannot be filed while stale; valid history retains source shift, restricted reading and duplicate guard',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE memberships SET employment=json_set(employment,'$.hireDate','2026-01-01'),revision=revision+1 WHERE id=?").bind(f.candidate.id).run();const candidate=ok(await f.view('owner')).hireCandidates[0];let r=ok(await f.call('owner','hirehandoff.create',fields(candidate)));r=ok(await accept(f,r));await f.setReady();await f.shift('published-first',{start:'2026-01-02T15:00:00Z',end:'2026-01-02T21:00:00Z'});r=ok(await confirm(f,r));
 await f.db.prepare("UPDATE records SET updated_at='2026-01-03T12:00:00Z' WHERE kind IN ('hirehandoff','shift')").run();assert.equal(ok(await hist(f,'owner',{preview:'1',before:'2026-08-01'})).records.length,2);await f.db.prepare("UPDATE records SET data=json_set(data,'$.cancelled',1) WHERE id='published-first'").run();assert.equal(ok(await hist(f,'owner',{preview:'1',before:'2026-08-01'})).records.some(x=>x.id===r.recordId),false);
 r=await saved(f,'owner',r);r=ok(await f.call('owner','hirehandoff.cancel',{note:'Keep the cancelled earlier attempt.'},r));await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE kind='hirehandoff'").run();
 const before='2026-08-01',plan=ok(await hist(f,'owner',{preview:'1',before}));assert.equal(plan.records.length,2);ok(await hist(f,'owner',{}, {locationId:'a',requestId:'file-hire',action:'archive',confirmed:true,before,workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));
 const detail=ok(await hist(f,'scheduler',{recordId:r.recordId}));assert.equal(detail.canRestore,false);assert.equal(detail.workspace.records.find(x=>x.id===r.recordId).data.confirmation.shiftId,'published-first');assert.equal((await hist(f,'other',{recordId:r.recordId})).status,404);assert.equal((await hist(f,'worker',{recordId:r.recordId})).status,404);
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-hire',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));assert.equal((await saved(f,'owner',r)).data.status,'cancelled');
});
