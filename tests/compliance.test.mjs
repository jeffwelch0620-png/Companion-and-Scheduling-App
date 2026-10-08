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
import {complianceDue,complianceRenewalState,complianceRenewalChoices} from '../.sites-runtime/shared/compliance.mjs';
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
const facts={title:'Fictional permit record',type:'permit',authority:'Fictional test authority',reference:'DEMO-PERMIT-001',documentDate:'2026-09-01',dueDate:'2026-10-01',evidence:'Fictional document page 1 states renewal follow-up date; not operating evidence.',sourceUrl:'https://example.test/permit',summary:'Fictional source scope only',responsibleId:'otherowner'};
const saved=async(f,id,r)=>ok(await f.view(id)).records.find(x=>x.id===r.recordId);
test('inspection and permit records are owner-only, store-scoped and absent from unrelated work',async t=>{
 const f=await fixture(t),r=ok(await f.call('owner','compliance.create',facts));
 assert.equal((await saved(f,'otherowner',r)).data.status,'needs-review');
 for(const actor of ['manager','opener','foh','worker','dish','foreign']){
  assert.equal((await f.call(actor,'compliance.create',facts)).status,403);
  if(actor!=='foreign')assert.equal(await saved(f,actor,r),undefined);
  assert.equal((await f.call(actor,'compliance.note',{note:'Unauthorized'},r)).status,403);
 }
 assert.equal(ok(await f.view('owner')).records.filter(x=>x.kind==='message').length,0);
 const w=ok(await f.view('owner')),at=new Date().toISOString();
 for(const output of [managerHandoff(w,'2026-09-21'),operationsHome(w,at),companionContext(w,'What permits?',at)])assert.ok(!JSON.stringify(output).includes(facts.summary));
 const foreign=ok(await f.call('foreign','compliance.create',{...facts,responsibleId:'foreign'},undefined,{locationId:'b'}));
 assert.equal((await f.call('owner','compliance.note',{note:'Wrong store'},foreign)).status,404);
});
test('source review, close, reopen and corrected facts retain the evidence trail',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','compliance.create',facts));
 assert.equal((await f.call('owner','compliance.close',{note:'Complete',followUpComplete:true},r)).status,400);
 assert.equal((await f.call('owner','compliance.review',{note:'Read'},r)).status,400);
 r=ok(await f.call('otherowner','compliance.review',{note:'Compared entry to page 1',sourceChecked:true},r));
 assert.equal((await f.call('owner','compliance.close',{note:'Complete'},r)).status,400);
 r=ok(await f.call('owner','compliance.close',{note:'Internal renewal follow-up complete',followUpComplete:true},r));
 let d=(await saved(f,'owner',r)).data;assert.equal(d.status,'closed');assert.equal(d.dueDate,facts.dueDate);
 r=ok(await f.call('owner','compliance.correct',{...facts,dueDate:'2026-10-05',note:'Corrected date transcription'},r));
 d=(await saved(f,'owner',r)).data;assert.equal(d.status,'needs-review');assert.equal(d.review,null);assert.equal(d.resolution,'');assert.equal(d.versions[0].facts.dueDate,'2026-10-01');assert.equal(d.versions[0].review.by,'otherowner');assert.equal(d.versions[0].resolution,'Internal renewal follow-up complete');
 r=ok(await f.call('owner','compliance.review',{note:'Checked corrected date',sourceChecked:true},r));r=ok(await f.call('owner','compliance.close',{note:'Second internal completion',followUpComplete:true},r));r=ok(await f.call('otherowner','compliance.reopen',{note:'New follow-up required'},r));
 d=(await saved(f,'owner',r)).data;assert.equal(d.status,'needs-review');assert.ok(d.history.some(h=>h.action==='close'&&h.note==='Second internal completion'));assert.ok(d.history.some(h=>h.action==='review'&&h.note==='Checked corrected date'));
});
test('source dates, references, links and responsible people are validated without inventing missing dates',async t=>{
 const f=await fixture(t);
 for(const patch of [{type:'compliant'},{title:''},{authority:''},{reference:''},{documentDate:'2026-02-30'},{documentDate:'2099-01-01'},{dueDate:'2026-08-01'},{dueDate:'2026-02-30'},{evidence:''},{summary:''},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:pass@example.test'},{sourceUrl:'http://example.test'},{responsibleId:'manager'},{responsibleId:'foreign'},{responsibleId:'dish'}])assert.equal((await f.call('owner','compliance.create',{...facts,...patch})).status,400,JSON.stringify(patch));
 const r=ok(await f.call('owner','compliance.create',{...facts,type:'inspection',dueDate:'',sourceUrl:'',evidence:'No due date stated in fictional inspection.'}));const d=(await saved(f,'owner',r)).data;assert.equal(d.dueDate,null);assert.equal(d.sourceUrl,'');assert.equal(complianceDue(d,'2026-09-29'),'no-date');
 assert.equal((await f.call('owner','compliance.correct',{...facts,note:'Change type'},r)).status,400);
 assert.equal((await f.call('owner','compliance.note',{note:' '},r)).status,400);
 assert.equal((await f.call('owner','compliance.unknown',{note:'Unknown'},r)).status,400);
});
test('duplicate documents, exact retry and concurrent edits cannot silently overwrite source facts',async t=>{
 const f=await fixture(t),extra={requestId:'compliance-repeat'},r=ok(await f.call('owner','compliance.create',facts,undefined,extra));
 assert.deepEqual(ok(await f.call('owner','compliance.create',facts,undefined,extra)),r);
 assert.equal((await f.call('owner','compliance.create',{...facts,title:'Different'},undefined,extra)).status,409);
 assert.equal((await f.call('otherowner','compliance.create',{...facts,reference:'demo-permit-001',authority:'FICTIONAL TEST AUTHORITY'})).status,409);
 const second=ok(await f.call('owner','compliance.create',{...facts,reference:'DEMO-PERMIT-002'}));
 assert.equal((await f.call('owner','compliance.correct',{...facts,note:'Duplicate correction'},second)).status,409);
 const writes=await Promise.all([f.call('owner','compliance.review',{note:'Checked',sourceChecked:true},r),f.call('otherowner','compliance.correct',{...facts,summary:'Changed facts',note:'Correction'},r)]);assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
 assert.equal((await saved(f,'owner',r)).revision,2);
});
test('failed persistence rolls back facts and audit; current access and assignments are reflected',async t=>{
 const f=await fixture(t),r=ok(await f.call('owner','compliance.create',facts));
 await f.db.prepare("CREATE TRIGGER fail_compliance BEFORE INSERT ON command_receipts WHEN NEW.request_id='compliance-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await f.call('owner','compliance.correct',{...facts,summary:'Should roll back',note:'Test'},r,{requestId:'compliance-fail'})).status,503);
 assert.equal((await saved(f,'owner',r)).data.summary,facts.summary);assert.equal((await f.db.prepare("SELECT count(*) n FROM audit_events WHERE action LIKE 'compliance.%'").first()).n,1);
 const response=await handleAccess(new Request('https://test.example/api/access?locationId=a',{headers:f.headers('owner')}),f.db),access=await response.json();assert.equal(response.status,200);assert.ok(access.accounts.find(a=>a.id==='otherowner').responsibilities.some(x=>x.category==='Inspection or permit follow-up'&&x.count===1));assert.ok(!JSON.stringify(access).includes(facts.summary));
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='otherowner'").run();
 assert.equal(await saved(f,'otherowner',r),undefined);assert.equal((await f.call('otherowner','compliance.note',{note:'Revoked'},r)).status,403);
 assert.equal((await f.call('owner','compliance.correct',{...facts,note:'Former assignee'},r)).status,400);
 const reassigned=ok(await f.call('owner','compliance.correct',{...facts,responsibleId:'owner',note:'Reassigned current owner'},r));assert.equal((await saved(f,'owner',reassigned)).data.responsibleId,'owner');
});
test('entered due dates use restaurant calendar days and archived content keeps owner access',async t=>{
 const f=await fixture(t),r=ok(await f.call('owner','compliance.create',facts)),d=(await saved(f,'owner',r)).data;
 const w=ok(await f.view('owner')),command={requestId:'midnight-source',locationId:'a',action:'compliance.create',input:{...facts,reference:'MIDNIGHT',documentDate:'2026-09-29'}};
 assert.equal(applyCommand(w,command,'2026-09-30T01:00:00Z',()=> 'midnight-record')[0].data.documentDate,'2026-09-29');
 assert.throws(()=>applyCommand(w,{...command,input:{...command.input,documentDate:'2026-09-30'}},'2026-09-30T01:00:00Z'),/future/);
 assert.equal(complianceDue(d,'2026-09-30'),'upcoming');assert.equal(complianceDue(d,'2026-10-01'),'today');assert.equal(complianceDue(d,'2026-10-02'),'overdue');assert.equal(complianceDue({...d,status:'closed'},'2026-10-02'),'closed');
 await f.db.prepare("UPDATE records SET archived_at=?,archived_by='owner' WHERE id=?").bind(new Date().toISOString(),r.recordId).run();
 for(const actor of ['manager','worker','dish']){const resp=await handleRecordHistory(new Request('https://test.example/api/history?locationId=a&recordId='+r.recordId,{headers:f.headers(actor)}),f.db);assert.equal(resp.status,404);}
 const resp=await handleRecordHistory(new Request('https://test.example/api/history?locationId=a&recordId='+r.recordId,{headers:f.headers('owner')}),f.db);assert.equal(resp.status,200);assert.ok(JSON.stringify(await resp.json()).includes(facts.evidence));
});

const renewalFacts=(reference,date='2026-09-02')=>({...facts,reference,documentDate:date});
async function checked(f,reference,date){let r=ok(await f.call('owner','compliance.create',renewalFacts(reference,date)));return ok(await f.call('owner','compliance.review',{note:'Compared fictional source facts',sourceChecked:true},r));}
const linkInput=previous=>({previousId:previous.recordId,previousRevision:previous.revision,note:'Fictional documents identify this renewal',confirmed:true});
test('renewal linking keeps independent due dates, follow-up and evidence with exact request retry',async t=>{
 const f=await fixture(t),previous=await checked(f,'EARLIER','2026-09-01');let current=await checked(f,'NEWER','2026-09-02');
 const earlierBefore=await saved(f,'owner',previous),newerBefore=await saved(f,'owner',current),request={requestId:'renewal-exact'};
 const result=ok(await f.call('owner','compliance.renewal-link',linkInput(previous),current,request));
 assert.deepEqual(ok(await f.call('owner','compliance.renewal-link',linkInput(previous),current,request)),result);
 assert.deepEqual(await saved(f,'owner',previous),earlierBefore);
 const newer=await saved(f,'owner',result);assert.equal(newer.data.status,newerBefore.data.status);assert.equal(newer.data.dueDate,newerBefore.data.dueDate);assert.deepEqual(newer.data.review,newerBefore.data.review);
 assert.equal(newer.data.renewal.previousFacts.reference,'EARLIER');assert.equal(newer.data.renewal.currentFacts.reference,'NEWER');assert.equal(newer.data.renewalHistory.length,1);assert.equal(complianceRenewalState(newer,ok(await f.view('owner'))),'current');
 assert.equal(ok(await f.view('owner')).records.filter(r=>r.kind==='message').length,0);
});
test('renewal eligibility requires checked permits, earlier dates, matching authority and explicit current source revisions',async t=>{
 const f=await fixture(t),previous=await checked(f,'PRIOR','2026-09-01'),current=await checked(f,'CURRENT','2026-09-02'),equal=await checked(f,'SAME-DAY','2026-09-02');
 let unchecked=ok(await f.call('owner','compliance.create',renewalFacts('UNCHECKED','2026-09-01')));
 const foreignAuthority=ok(await f.call('owner','compliance.create',{...renewalFacts('AUTH','2026-08-01'),authority:'Another authority'}));const reviewedAuthority=ok(await f.call('owner','compliance.review',{note:'Checked',sourceChecked:true},foreignAuthority));
 const inspect=ok(await f.call('owner','compliance.create',{...renewalFacts('INSPECT','2026-08-01'),type:'inspection'})),inspection=ok(await f.call('owner','compliance.review',{note:'Checked',sourceChecked:true},inspect));
 for(const p of [current,equal,unchecked,reviewedAuthority,inspection])assert.equal((await f.call('owner','compliance.renewal-link',linkInput(p),current)).status,400);
 assert.equal((await f.call('owner','compliance.renewal-link',{...linkInput(previous),confirmed:false},current)).status,400);
 assert.equal((await f.call('owner','compliance.renewal-link',{...linkInput(previous),note:''},current)).status,400);
 assert.equal((await f.call('owner','compliance.renewal-link',{...linkInput(previous),previousRevision:previous.revision-1},current)).status,409);
 assert.equal((await f.call('owner','compliance.renewal-link',linkInput(previous),unchecked)).status,400);
 const w=ok(await f.view('owner'));assert.deepEqual(complianceRenewalChoices(await saved(f,'owner',current),w).map(r=>r.id),[previous.recordId]);
});
test('source corrections require explicit relationship recheck; follow-up notes do not silently change evidence',async t=>{
 const f=await fixture(t);let previous=await checked(f,'P','2026-09-01'),current=await checked(f,'C','2026-09-02');current=ok(await f.call('owner','compliance.renewal-link',linkInput(previous),current));
 previous=ok(await f.call('owner','compliance.note',{note:'Routine internal update'},previous));assert.equal(complianceRenewalState(await saved(f,'owner',current),ok(await f.view('owner'))),'current');
 previous=ok(await f.call('owner','compliance.correct',{...renewalFacts('P','2026-09-01'),summary:'Corrected source scope',note:'Transcription fix'},previous));
 assert.equal(complianceRenewalState(await saved(f,'owner',current),ok(await f.view('owner'))),'needs-review');assert.equal((await f.call('owner','compliance.renewal-link',linkInput(previous),current)).status,400);
 previous=ok(await f.call('owner','compliance.review',{note:'Corrected facts checked',sourceChecked:true},previous));current=ok(await f.call('owner','compliance.renewal-link',linkInput(previous),current));
 let d=(await saved(f,'owner',current)).data;assert.equal(d.renewalHistory.length,2);assert.equal(d.renewalHistory[1].action,'rechecked');assert.equal(d.renewalHistory[0].link.previousFacts.summary,facts.summary);assert.equal(d.renewal.previousFacts.summary,'Corrected source scope');
 current=ok(await f.call('owner','compliance.correct',{...renewalFacts('C','2026-09-02'),summary:'Newer document scope corrected',note:'Source fix'},current));assert.equal(complianceRenewalState(await saved(f,'owner',current),ok(await f.view('owner'))),'needs-review');
});
test('one successor wins concurrent links; clearing preserves evidence and permits explicit replacement',async t=>{
 const f=await fixture(t),previous=await checked(f,'P','2026-09-01'),alternate=await checked(f,'OTHER','2026-08-01');let a=await checked(f,'A','2026-09-02'),b=await checked(f,'B','2026-09-03');
 const results=await Promise.all([f.call('owner','compliance.renewal-link',linkInput(previous),a),f.call('otherowner','compliance.renewal-link',linkInput(previous),b)]);assert.equal(results.filter(r=>r.status===200).length,1);
 let winner=results.find(r=>r.status===200).data,loser=winner.recordId===a.recordId?b:a;
 assert.equal((await f.call('owner','compliance.renewal-link',linkInput(previous),loser)).status,400);
 assert.equal((await f.call('owner','compliance.renewal-link',linkInput(alternate),winner)).status,400);
 winner=ok(await f.call('owner','compliance.renewal-clear',{note:'Wrong earlier document selected'},winner));let d=(await saved(f,'owner',winner)).data;assert.equal(d.renewal,null);assert.equal(d.renewalHistory.at(-1).action,'cleared');assert.equal(d.renewalHistory.at(-1).link.previousId,previous.recordId);
 ok(await f.call('owner','compliance.renewal-link',linkInput(previous),loser));winner=ok(await f.call('owner','compliance.renewal-link',linkInput(alternate),winner));assert.equal((await saved(f,'owner',winner)).data.renewal.previousId,alternate.recordId);
});
test('renewal changes are owner-only, restaurant-scoped and transactional with current access',async t=>{
 const f=await fixture(t),previous=await checked(f,'P','2026-09-01'),current=await checked(f,'C','2026-09-02');
 for(const actor of ['manager','worker','dish','foreign'])assert.equal((await f.call(actor,'compliance.renewal-link',linkInput(previous),current)).status,403);
 const other=ok(await f.call('foreign','compliance.create',{...renewalFacts('FOREIGN','2026-08-01'),responsibleId:'foreign'},undefined,{locationId:'b'}));assert.equal((await f.call('owner','compliance.renewal-link',linkInput(other),current)).status,400);
 await f.db.prepare("CREATE TRIGGER fail_renewal BEFORE INSERT ON command_receipts WHEN NEW.request_id='renewal-fail' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();
 assert.equal((await f.call('owner','compliance.renewal-link',linkInput(previous),current,{requestId:'renewal-fail'})).status,503);assert.equal((await saved(f,'owner',current)).data.renewal,undefined);
 await f.db.prepare('DROP TRIGGER fail_renewal').run();const linked=ok(await f.call('owner','compliance.renewal-link',linkInput(previous),current,{requestId:'renewal-fail'}));assert.equal((await saved(f,'owner',linked)).data.renewalHistory.length,1);
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='otherowner'").run();assert.equal((await f.call('otherowner','compliance.renewal-clear',{note:'Revoked'},linked)).status,403);
});
test('missing predecessor leaves retained evidence but cannot be treated as a current checked relationship',async t=>{
 const f=await fixture(t),previous=await checked(f,'P','2026-09-01');let current=await checked(f,'C','2026-09-02');current=ok(await f.call('owner','compliance.renewal-link',linkInput(previous),current));
 await f.db.prepare("UPDATE records SET archived_at='2026-09-29T12:00:00Z' WHERE id=?").bind(previous.recordId).run();const w=ok(await f.view('owner')),r=await saved(f,'owner',current);assert.equal(complianceRenewalState(r,w),'needs-review');assert.equal(r.data.renewal.previousFacts.reference,'P');assert.equal(complianceRenewalChoices(r,w).length,0);
 current=ok(await f.call('owner','compliance.renewal-clear',{note:'Retained source is unavailable for current link'},current));assert.equal((await saved(f,'owner',current)).data.renewalHistory.at(-1).link.previousFacts.reference,'P');
});

test('corrected source dates cannot create a circular renewal chain',async t=>{
 const f=await fixture(t);let first=await checked(f,'FIRST','2026-09-01'),second=await checked(f,'SECOND','2026-09-02'),third=await checked(f,'THIRD','2026-09-03');
 second=ok(await f.call('owner','compliance.renewal-link',linkInput(first),second));third=ok(await f.call('owner','compliance.renewal-link',linkInput(second),third));
 first=ok(await f.call('owner','compliance.correct',{...renewalFacts('FIRST','2026-09-04'),note:'Fixture source date correction'},first));first=ok(await f.call('owner','compliance.review',{note:'Corrected date checked',sourceChecked:true},first));
 assert.equal(complianceRenewalState(await saved(f,'owner',second),ok(await f.view('owner'))),'needs-review');
 assert.ok(!complianceRenewalChoices(await saved(f,'owner',first),ok(await f.view('owner'))).some(r=>r.id===third.recordId));
 assert.equal((await f.call('owner','compliance.renewal-link',linkInput(third),first)).status,400);
 second=ok(await f.call('owner','compliance.renewal-clear',{note:'Fixture correction invalidated this relationship'},second));
 first=ok(await f.call('owner','compliance.renewal-link',linkInput(third),first));assert.equal((await saved(f,'owner',first)).data.renewal.previousId,third.recordId);
});
