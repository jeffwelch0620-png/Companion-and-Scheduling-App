import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {hireChecklistCurrent,hireChecklistProgress} from '../.sites-runtime/shared/hire-checklist.mjs';
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
const fields=c=>({employeeId:c.id,employeeRevision:c.revision,sourceReference:'Fictional requirements source; restricted hiring reference',confirmed:true,items:[{label:'Check fixture paperwork status',dueDate:'2026-09-02'},{label:'Check fixture Toast setup status',dueDate:''}]});
const saved=async(f,r,who='owner')=>ok(await f.view(who)).records.find(x=>x.id===(r.recordId??r.id));
const checked=async(f,r,index=0,who='owner',extra={})=>{const d=await saved(f,r);return f.call(who,'hirechecklist.check',{itemId:d.data.items[index].id,completedDate:'2026-09-01',confirmed:true,note:'Personally checked fictional source status.',...extra},r)};
const review=(f,r,extra={})=>f.call('owner','hirechecklist.review',{confirmed:true,note:'Reviewed all fictional requirements and checks.',...extra},r);
const hist=async(f,who,params={},body)=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'a',...params}),{headers:{...f.headers(who),Origin:'https://test.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),f.db);return {status:r.status,data:await r.json()}};

test('onboarding checklist is restricted to restaurant and department coordinators and never changes employee access',async t=>{
 const f=await fixture(t),memberBefore=await f.db.prepare('SELECT * FROM memberships WHERE id=?').bind(f.candidate.id).first();
 let r=ok(await f.call('people','hirechecklist.create',fields(f.candidate)));assert.ok(await saved(f,r));assert.ok(await saved(f,r,'people'));
 for(const who of ['scheduler','other','worker','foh','dish']){assert.equal(await saved(f,r,who),undefined,who);assert.equal(ok(await f.view(who)).records.some(r=>r.kind==='hirechecklist'),false);assert.equal(availableModules(ok(await f.view(who)).me).some(m=>m.tab==='Onboarding checklist'),who==='foh');assert.notEqual((await f.call(who,'hirechecklist.create',fields(f.candidate))).status,200);}
 assert.ok(availableModules(ok(await f.view('people')).me).some(m=>m.tab==='Onboarding checklist'));
 assert.equal((await f.call('foreign','hirechecklist.cancel',{note:'Wrong store'},r)).status,403);
 r=ok(await checked(f,r,0,'people'));r=ok(await checked(f,r,1));r=ok(await review(f,r));
 assert.deepEqual(await f.db.prepare('SELECT * FROM memberships WHERE id=?').bind(f.candidate.id).first(),memberBefore);
 const w=ok(await f.view('owner'));assert.equal(w.records.length,1);assert.ok(!JSON.stringify(companionContext(w,'Tell me about onboarding',new Date().toISOString())).includes(fields(f.candidate).sourceReference));assert.equal((await f.view('newhire')).status,403);
});

test('explicit checked completion and final review retain original evidence through reopen, correction, revision and cancellation',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','hirechecklist.create',fields(f.candidate)));
 assert.equal((await review(f,r)).status,400);assert.equal((await checked(f,r,0,'owner',{confirmed:false})).status,400);
 r=ok(await checked(f,r));assert.equal((await checked(f,r)).status,400);r=ok(await checked(f,r,1));assert.equal((await review(f,r,{confirmed:false})).status,400);r=ok(await review(f,r));
 assert.equal((await checked(f,r)).status,400);r=ok(await f.call('people','hirechecklist.reopen',{note:'Recheck the source reference.'},r));let d=(await saved(f,r)).data;assert.ok(d.versions[0].state.review);assert.equal(d.review,null);assert.equal(d.items.filter(i=>i.check).length,2);
 r=ok(await f.call('people','hirechecklist.uncheck',{itemId:d.items[0].id,note:'Wrong completion date; keep the original.'},r));d=(await saved(f,r)).data;assert.equal(d.items[0].check,null);assert.ok(d.versions[1].state.items[0].check);assert.equal(d.versions[1].state.items[0].check.completedDate,'2026-09-01');
 r=ok(await checked(f,r,0,'people',{completedDate:'2026-09-02',note:'Corrected actual date; fixture source checked.'}));r=ok(await review(f,r));
 r=ok(await f.call('owner','hirechecklist.revise',{...fields(f.candidate),items:[{label:'Replacement requirement',dueDate:'2026-10-01',check:{by:'forged'},id:'forged'}],note:'New checked requirements source.'},r));d=(await saved(f,r)).data;assert.equal(d.status,'open');assert.equal(d.review,null);assert.equal(d.items[0].check,null);assert.notEqual(d.items[0].id,'forged');assert.equal(d.versions.at(-1).state.items[0].check.completedDate,'2026-09-02');
 r=ok(await f.call('owner','hirechecklist.cancel',{note:'This list was entered for review and is now cancelled.'},r));assert.equal((await checked(f,r)).status,400);assert.equal((await saved(f,r)).data.status,'cancelled');
 assert.equal((await f.call('owner','hirechecklist.unlisted',{note:'Unknown'},r)).status,400);
});

test('requirements and checked facts reject invalid dates, duplicates, forged sources and missing evidence',async t=>{
 const f=await fixture(t);
 for(const patch of [{confirmed:false},{employeeRevision:99},{sourceReference:''},{items:[]},{items:Array.from({length:31},(_,n)=>({label:'Item '+n}))},{items:[{label:' A  task '},{label:'a task'}]},{items:[{label:'Fixture',dueDate:'2026-02-30'}]},{items:[{label:' '.repeat(10)}]},{items:[{label:'x'.repeat(161)}]}])assert.notEqual((await f.call('owner','hirechecklist.create',{...fields(f.candidate),...patch})).status,200,JSON.stringify(patch));
 const r=ok(await f.call('owner','hirechecklist.create',fields(f.candidate)));
 for(const patch of [{note:''},{completedDate:'2999-01-01'},{completedDate:'2026-02-30'},{completedDate:''},{itemId:'not-this-list'}])assert.notEqual((await checked(f,r,0,'owner',patch)).status,200,JSON.stringify(patch));
 assert.equal((await f.call('owner','hirechecklist.cancel',{note:''},r)).status,400);
 const result=ok(await checked(f,r,0,'owner',{completedDate:'2026-08-31',by:'forged-reviewer',at:'1900-01-01'}));const check=(await saved(f,result)).data.items[0].check;assert.equal(check.by,'owner');assert.notEqual(check.at,'1900-01-01');assert.equal(check.completedDate,'2026-08-31','legitimate pre-start paperwork can be checked');
});

test('changes to hire, department or position require fresh requirements and never carry checks into a rehire',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','hirechecklist.create',fields(f.candidate)));r=ok(await checked(f,r));await f.setReady();let w=ok(await f.view('owner'));assert.equal(hireChecklistCurrent(w,w.records[0]),true,'enabling access alone does not invalidate paperwork facts');
 await f.db.prepare("UPDATE memberships SET position='Prep Cook',revision=revision+1 WHERE id=?").bind(f.candidate.id).run();w=ok(await f.view('owner'));assert.equal(hireChecklistCurrent(w,w.records[0]),false);assert.equal((await checked(f,r,1)).status,409);
 let c=w.hireCandidates[0];r=ok(await f.call('owner','hirechecklist.revise',{...fields(c),note:'Requirements checked for changed position.'},r));assert.equal((await saved(f,r)).data.items[0].check,null);
 await f.db.prepare("UPDATE memberships SET area='FOH',revision=revision+1 WHERE id=?").bind(f.candidate.id).run();c=ok(await f.view('owner')).hireCandidates[0];assert.equal((await f.call('people','hirechecklist.revise',{...fields(c),note:'Outside my department'},r)).status,403);
 r=ok(await f.call('owner','hirechecklist.revise',{...fields(c),note:'Transfer of checklist to current department.'},r));assert.equal(await saved(f,r,'people'),undefined);assert.ok(await saved(f,r,'foh'));
 await f.db.prepare("UPDATE memberships SET employment=json_set(employment,'$.hireDate','2026-09-15'),revision=revision+1 WHERE id=?").bind(f.candidate.id).run();c=ok(await f.view('owner')).hireCandidates[0];assert.equal((await f.call('owner','hirechecklist.revise',{...fields(c),note:'Cannot reuse prior hire'},r)).status,400);
 const next=ok(await f.call('owner','hirechecklist.create',fields(c)));assert.notEqual(next.recordId,r.recordId);assert.ok((await saved(f,next)).data.items.every(i=>i.check===null));r=ok(await f.call('owner','hirechecklist.cancel',{note:'Retain earlier hire checklist.'},r));assert.equal((await saved(f,r)).data.hireDate,'2026-09-01');
});

test('uncertain retries, stale versions, duplicate archived lists, rollback and concurrent checks cannot lose evidence',async t=>{
 const f=await fixture(t),extra={requestId:'checklist-stable'};let r=ok(await f.call('owner','hirechecklist.create',fields(f.candidate),undefined,extra));assert.deepEqual(ok(await f.call('owner','hirechecklist.create',fields(f.candidate),undefined,extra)),r);
 assert.equal((await f.call('owner','hirechecklist.create',{...fields(f.candidate),sourceReference:'Changed intent'},undefined,extra)).status,409);assert.equal((await f.call('owner','hirechecklist.create',fields(f.candidate))).status,409);
 const record=await saved(f,r),input={itemId:record.data.items[0].id,completedDate:'2026-09-01',confirmed:true,note:'Checked once with exact retry.'},prior=r;
 r=ok(await f.call('owner','hirechecklist.check',input,r,{requestId:'check-once'}));assert.deepEqual(ok(await f.call('owner','hirechecklist.check',input,prior,{requestId:'check-once'})),r);assert.equal((await f.call('owner','hirechecklist.check',input,prior)).status,409);
 await f.db.prepare("CREATE TRIGGER fail_checklist BEFORE INSERT ON command_receipts WHEN NEW.request_id='checklist-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();assert.equal((await f.call('owner','hirechecklist.cancel',{note:'Should roll back'},r,{requestId:'checklist-fail'})).status,503);assert.equal((await saved(f,r)).revision,r.revision);
 const pair=await Promise.all([f.call('owner','hirechecklist.uncheck',{itemId:record.data.items[0].id,note:'Correction one'},r),f.call('people','hirechecklist.uncheck',{itemId:record.data.items[0].id,note:'Correction two'},r)]);assert.deepEqual(pair.map(x=>x.status).sort(),[200,409]);
 const after=await saved(f,r);assert.equal(after.data.versions.length,1);assert.equal(after.data.history.length,3);
 await f.db.prepare('UPDATE records SET archived_at=? WHERE id=?').bind(new Date().toISOString(),r.recordId).run();assert.equal((await f.call('owner','hirechecklist.create',fields(f.candidate))).status,409);
});

test('employee revision changes or coordinator revocation at commit cannot save a stale checklist',async t=>{
 for(const target of ['employee','coordinator']){const f=await fixture(t);await f.view('owner');let batches=0;const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{if(++batches===2)await f.db.prepare('UPDATE memberships SET revision=revision+1,active=0 WHERE id=?').bind(target==='employee'?f.candidate.id:'owner').run();return f.db.batch(statements)}})};
 assert.equal((await f.call('owner','hirechecklist.create',fields(f.candidate),undefined,{},binding)).status,409);assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='hirechecklist'").first()).n,0);}
});

test('reviewed history is private, stale hire evidence stays active, and restored records retain checks and duplicate protection',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','hirechecklist.create',fields(f.candidate)));r=ok(await checked(f,r));r=ok(await checked(f,r,1));r=ok(await review(f,r));
 await f.db.prepare("UPDATE records SET updated_at='2026-01-03T12:00:00Z' WHERE id=?").bind(r.recordId).run();assert.equal(ok(await hist(f,'owner',{preview:'1',before:'2026-08-01'})).records.length,1);
 await f.db.prepare("UPDATE memberships SET position='Prep Cook',revision=revision+1 WHERE id=?").bind(f.candidate.id).run();assert.equal(ok(await hist(f,'owner',{preview:'1',before:'2026-08-01'})).records.length,0);
 r=ok(await f.call('owner','hirechecklist.cancel',{note:'Retain reviewed prior-position checklist.'},r));await f.db.prepare("UPDATE records SET updated_at='2026-01-03T12:00:00Z' WHERE id=?").bind(r.recordId).run();const before='2026-08-01',plan=ok(await hist(f,'owner',{preview:'1',before}));
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'file-checklist',action:'archive',confirmed:true,before,workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));
 const detail=ok(await hist(f,'people',{recordId:r.recordId}));assert.equal(detail.canRestore,true);assert.equal(detail.workspace.records.find(x=>x.id===r.recordId).data.items.filter(i=>i.check).length,2);
 for(const who of ['worker','scheduler','foh','dish'])assert.equal((await hist(f,who,{recordId:r.recordId})).status,404,who);
 const listed=ok(await hist(f,'scheduler',{kind:'hirechecklist'}));assert.equal(listed.items.length,0);
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-checklist',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));assert.equal((await saved(f,r)).data.status,'cancelled');
});

test('checklist due-state uses entered dates and does not count blank dates, completed tasks or cancelled lists as overdue',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','hirechecklist.create',fields(f.candidate)));let row=await saved(f,r);
 assert.deepEqual(hireChecklistProgress(row,'2026-09-02'),{checked:0,total:2,overdue:0});assert.deepEqual(hireChecklistProgress(row,'2026-09-03'),{checked:0,total:2,overdue:1});r=ok(await checked(f,r));row=await saved(f,r);assert.equal(hireChecklistProgress(row,'2026-09-03').overdue,0);
 r=ok(await f.call('owner','hirechecklist.uncheck',{itemId:row.data.items[0].id,note:'Put back for current source review.'},r));r=ok(await f.call('owner','hirechecklist.cancel',{note:'Preserve cancelled list.'},r));assert.equal(hireChecklistProgress(await saved(f,r),'2026-09-03').overdue,0);
});
