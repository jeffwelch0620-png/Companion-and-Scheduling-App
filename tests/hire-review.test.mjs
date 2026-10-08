import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleHireReview} from '../.sites-runtime/shared/hire-review-service.mjs';
import {buildHireReview,createHireReviewLoader} from '../.sites-runtime/shared/hire-review.mjs';
import {availableModules} from '../.sites-runtime/shared/operations-home.mjs';
import {tokenHash} from '../.sites-runtime/shared/employee-session.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const now='2026-09-29T12:00:00Z';
const me={id:'owner',locationId:'a',name:'Owner',area:'Executive',position:'Owner',capabilities:['location.manage'],qualifications:[]};
const employee={id:'hire',name:'Fictional hire',area:'BOH',position:'Line Cook',revision:1,active:true,scheduleOnly:false,hireDate:'2026-09-01',status:'active'};
const member={...employee,locationId:'a',qualifications:[],scheduleJobs:['Line Cook'],capabilities:[]};
const base=()=>({location:{id:'a',name:'Fictional a',timezone:'America/New_York',revision:1},me,members:[me,member],hireCandidates:[employee],records:[]});
const record=(id,kind,data,extra={})=>({id,kind,data,locationId:'a',ownerId:'hire',area:'BOH',revision:1,updatedAt:now,...extra});
const checklist=()=>record('checklist','hirechecklist',{title:'Fictional list',hireDate:employee.hireDate,position:employee.position,status:'reviewed',items:[{id:'one',label:'Private entered requirement',dueDate:'2026-09-28',check:{evidence:'Private evidence',at:now}}],sourceReference:'Private source',review:{at:now,note:'Private review'},history:[],versions:[]},{archived:true});
const station=()=>record('station','station',{title:'Fictional grill',status:'active',definitionRevision:2,independentLevel:2,levels:[{value:1,label:'Learning',definition:'With help'},{value:2,label:'Independent',definition:'Entered threshold'}],setup:{jobs:['Line Cook'],allJobMembers:true,memberIds:[],standardIds:[],managerId:'people',goals:[]},history:[]});
const proficiency=()=>record('proficiency','proficiency',{stationId:'station',stationRevision:2,level:2,certifiedTrainer:false,assessedAt:now,evidence:'Private assessment',history:[]});

test('hire review retains filed checklist status but strips private evidence and other hires, stores and departments',()=>{
 const w=base(),r=checklist();const result=buildHireReview(w,employee,[r,{...r,id:'old',data:{...r.data,hireDate:'2025-01-01'}},{...r,id:'foreign',locationId:'b'},{...r,id:'foh',area:'FOH'},{...r,id:'other',ownerId:'other'}],null,now);
 assert.equal(result.checklists.length,1);assert.equal(result.checklists[0].archived,true);assert.equal(result.checklists[0].checked,1);assert.equal(result.checklists[0].current,true);assert.doesNotMatch(JSON.stringify(result),/Private|auth_user|email|session|token/);
 const changed={...employee,position:'Prep Cook'};w.hireCandidates=[changed];assert.equal(buildHireReview(w,changed,[r],null,now).checklists[0].current,false);
});
test('successful code sign-in is hire-date and restaurant-calendar scoped, never inferred from enablement or job eligibility',()=>{
 const w=base();assert.equal(buildHireReview(w,employee,[],null,now).signIn.lastSignedInAt,null);
 for(const stamp of ['2026-09-01T03:59:59Z','invalid','2027-01-01T00:00:00Z'])assert.equal(buildHireReview(w,employee,[],stamp,now).signIn.lastSignedInAt,null);
 assert.equal(buildHireReview(w,employee,[],'2026-09-01T04:00:00Z',now).signIn.lastSignedInAt,'2026-09-01T04:00:00Z');
 w.me={...me,area:'BOH',capabilities:['people.manage']};assert.deepEqual(buildHireReview(w,employee,[],now,now).signIn,{visibility:'owner-only',lastSignedInAt:null});
});
test('station review distinguishes unassessed, stale definitions, prior hires, missing thresholds and current assessed levels',()=>{
 const w=base(),s=station(),p=proficiency();w.records=[s];assert.equal(buildHireReview(w,employee,[],null,now).stations[0].state,'not-assessed');w.records.push(p);
 const state=()=>buildHireReview(w,employee,[],null,now).stations[0].state;
 assert.equal(state(),'meets-threshold');p.data.level=1;assert.equal(state(),'below-threshold');s.data.independentLevel=null;assert.equal(state(),'threshold-unset');s.data.definitionRevision=3;assert.equal(state(),'definition-changed');
 p.data.assessedAt='2026-08-31T20:00:00Z';assert.equal(state(),'earlier-or-invalid-date');p.data.assessedAt='invalid';assert.equal(buildHireReview(w,employee,[],null,now).stations[0].assessedAt,null);
 s.data.setup.allJobMembers=false;assert.equal(buildHireReview(w,employee,[],null,now).stations.length,0);s.data.setup.memberIds=['hire'];assert.equal(buildHireReview(w,employee,[],null,now).stations.length,1);w.members[1]={...member,scheduleJobs:[]};assert.equal(buildHireReview(w,employee,[],null,now).stations.length,0);
});
test('saved first-shift confirmation is flagged after shift or job change and is not revalidated for filed handoffs',()=>{
 const w=base(),shift=record('shift','shift',{start:'2026-09-02T14:00:00Z',end:'2026-09-02T22:00:00Z',position:'Line Cook',published:true,cancelled:false});w.records=[shift];
 const handoff=record('handoff','hirehandoff',{hireDate:employee.hireDate,position:employee.position,schedulerName:'Scheduler',targetDate:'2026-09-02',status:'scheduled',acknowledgment:{at:now},confirmation:{shiftId:'shift',shiftRevision:1,start:shift.data.start,end:shift.data.end,position:'Line Cook'}},{archived:false});
 const review=()=>buildHireReview(w,employee,[handoff],null,now).handoffs[0];assert.equal(review().confirmationCurrent,true);shift.revision++;assert.equal(review().confirmationCurrent,false);shift.revision--;handoff.archived=true;assert.equal(review().confirmationCurrent,false);assert.equal(review().confirmedStart,shift.data.start);
 handoff.archived=false;handoff.data.position='Prep Cook';assert.equal(review().confirmationCurrent,false);
});
test('review navigation and projections require a people coordinator, not scheduling access alone',()=>{
 for(const cap of [[],['schedule.manage'],['tasks.manage']]){const w=base();w.me={...me,area:'BOH',capabilities:cap};assert.throws(()=>buildHireReview(w,employee,[],null,now));assert.equal(availableModules(w.me).some(m=>m.id==='hire-review'),false);}
 const w=base();w.me={...me,area:'FOH',capabilities:['people.manage']};assert.throws(()=>buildHireReview(w,employee,[],null,now));w.me={...me,area:'BOH',capabilities:['people.manage']};assert.equal(availableModules(w.me).some(m=>m.id==='hire-review'),true);
});

async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a'] of [['owner','Executive',['location.manage']],['people','BOH',['people.manage']],['scheduler','BOH',['schedule.manage']],['foh','FOH',['people.manage']],['foreign','BOH',['location.manage'],'b']])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,'Manager',?,'[]')").bind(id,id+'@example.test',id+'-identity',loc,id,area,JSON.stringify(caps)).run();
 await db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications,active,employment) VALUES('hire','hire@example.test','a','Fictional hire','BOH','Line Cook','[]','[]',0,?)").bind(JSON.stringify({hireDate:'2026-09-01',status:'onboarding'})).run();
 const request=(who,qs='locationId=a&employeeId=hire',extra={})=>new Request('https://fixture.example/api/people/hire-review?'+qs,{headers:{'oai-authenticated-user-id':who+'-identity','oai-authenticated-user-email':who+'@example.test'},...extra});
 const read=async(who,qs,extra,binding=db)=>{const res=await handleHireReview(request(who,qs,extra),binding);return {status:res.status,data:await res.json(),headers:res.headers}};
 const add=async r=>db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt,r.archived?now:null).run();
 return {db,read,add,request};
}
test('scoped endpoint includes filed current-hire evidence and owner-only sign-in without changing records or access',async t=>{
 const f=await fixture(t);await f.add(checklist());await f.db.prepare("INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) VALUES('audit','a','hire','employee.signed-in','hire','2026-09-02T14:00:00Z',1)").run();
 const before=await f.db.prepare('SELECT * FROM memberships WHERE id=?').bind('hire').first();
 const owner=await f.read('owner');assert.equal(owner.status,200,JSON.stringify(owner.data));assert.equal(owner.data.checklists[0].archived,true);assert.equal(owner.data.signIn.lastSignedInAt,'2026-09-02T14:00:00Z');assert.match(owner.headers.get('Cache-Control'),/no-store/);assert.equal(owner.data.employee.active,false);
 const people=await f.read('people');assert.equal(people.status,200);assert.equal(people.data.signIn.visibility,'owner-only');assert.equal(people.data.signIn.lastSignedInAt,null);assert.doesNotMatch(JSON.stringify(people.data),/Private|example.test|identity|token_hash/);
 assert.deepEqual(await f.db.prepare('SELECT * FROM memberships WHERE id=?').bind('hire').first(),before);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM records').first()).n,1);
 for(const who of ['scheduler','foh','foreign'])assert.equal((await f.read(who)).status,403,who);
});
test('endpoint fails closed on ambiguous scope, wrong methods, unauthenticated requests and bounded history overflow',async t=>{
 const f=await fixture(t);for(const qs of ['locationId=a&employeeId=hire&employeeId=other','locationId=a&employeeId=hire&extra=x','locationId=a','locationId=b&employeeId=hire'])assert.notEqual((await f.read('owner',qs)).status,200);
 assert.equal((await f.read('owner',undefined,{method:'POST'})).status,405);assert.equal((await f.read('owner',undefined,{headers:{}})).status,401);
 for(let i=0;i<21;i++)await f.add({...checklist(),id:'c'+i});assert.equal((await f.read('owner')).status,503);
});
test('endpoint rechecks membership, restaurant revision, employee revision and revoked setup-code session before releasing data',async t=>{
 const f=await fixture(t),original=f.db;
 const wrapped=(mutate)=>({withSession(){const session=original.withSession('first-primary');return {prepare:sql=>{const statement=session.prepare(sql);if(sql.startsWith('SELECT * FROM records WHERE location_id=? AND owner_id=?'))return {bind:(...v)=>({all:async()=>{const result=await statement.bind(...v).all();await mutate();return result}})};return statement;},batch:x=>session.batch(x)}}});
 let r=await f.read('owner',undefined,undefined,wrapped(()=>original.prepare("UPDATE memberships SET revision=revision+1 WHERE id='hire'").run()));assert.equal(r.status,409);
 r=await f.read('owner',undefined,undefined,wrapped(()=>original.prepare("UPDATE locations SET revision=revision+1 WHERE id='a'").run()));assert.equal(r.status,409);
 r=await f.read('owner',undefined,undefined,wrapped(()=>original.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='owner'").run()));assert.equal(r.status,409);
 await original.prepare("UPDATE memberships SET capabilities='[\"location.manage\"]' WHERE id='owner'").run();
 const revision=(await original.prepare("SELECT revision FROM memberships WHERE id='owner'").first()).revision,token='a'.repeat(64);
 await original.prepare("INSERT INTO employee_sessions(token_hash,auth_user_id,member_id,member_revision,created_at,expires_at) VALUES(?,'owner-identity','owner',?,?,?)").bind(await tokenHash(token),revision,Date.now(),Date.now()+60000).run();
 r=await f.read('owner',undefined,{headers:{Cookie:'__Host-jmax-session='+token}},wrapped(()=>original.prepare("DELETE FROM employee_sessions WHERE member_id='owner'").run()));assert.equal(r.status,401);
});
test('loader drops old results and old errors after another hire or cancellation',async()=>{
 const queue=[],published=[],fetcher=()=>new Promise((resolve,reject)=>queue.push({resolve,reject})),loader=createHireReviewLoader(x=>published.push(x),fetcher);
 const one=loader.load('a',employee,'owner'),other={...employee,id:'other'},two=loader.load('a',other,'owner');queue[0].resolve(Response.json(buildHireReview(base(),employee,[],null,now)));await one;assert.equal(published.filter(x=>x.data).length,0);
 const data={...buildHireReview(base(),employee,[],null,now),employee:other};queue[1].resolve(Response.json(data));await two;assert.equal(published.at(-1).data.employee.id,'other');
 const three=loader.load('a',employee,'owner');loader.cancel();queue[2].reject(new Error('Old network error'));await three;assert.equal(published.at(-1).error,'');
});
test('loader rejects other restaurant, viewer and employee versions without showing stale evidence',async()=>{
 for(const patch of [{locationId:'b'},{viewerId:'other'},{employee:{...employee,revision:2}}]){let last;const loader=createHireReviewLoader(r=>last=r,async()=>Response.json({...buildHireReview(base(),employee,[],null,now),...patch}));await loader.load('a',employee,'owner');assert.equal(last.data,null);assert.match(last.error,/changed/);}
});
