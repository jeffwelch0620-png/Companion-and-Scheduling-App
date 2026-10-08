import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {hireDevelopmentReview} from '../.sites-runtime/shared/hire-development.mjs';
import {handleHireReview} from '../.sites-runtime/shared/hire-review-service.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const now='2026-09-30T03:30:00Z';
const employee={id:'hire',name:'Fictional hire',area:'BOH',position:'Line Cook',revision:1,active:true,scheduleOnly:false,hireDate:'2026-09-01',status:'active'};
const member=(id,caps=[],area='BOH')=>({id,name:id,locationId:'a',area,position:'Manager',capabilities:caps,qualifications:[]});
const base=()=>{const manager=member('manager',['people.manage']),gm=member('gm',['people.approve']);return {location:{id:'a',name:'Fictional a',timezone:'America/New_York',revision:1},me:manager,members:[manager,gm,member('hire')],hireCandidates:[employee],records:[]}};
const review=(id='dev')=>({id,kind:'development',locationId:'a',ownerId:'hire',area:'BOH',revision:1,archived:false,updatedAt:now,data:{title:'Development review',managerId:'manager',approverId:'gm',hireDate:'2026-09-01',originalDueDate:'2026-09-28',phase:'approved',selfShared:false,managerShared:false,stations:[{name:'Private station text',definition:'PRIVATE criteria',source:'PRIVATE source',standardId:'guide',standardRevision:1,selfNote:'PRIVATE draft',managerNote:'PRIVATE draft'}],submissions:[{summary:'PRIVATE submission'}],approvalNote:'PRIVATE GM note',history:[{action:'gm-approved',actorId:'gm',at:'2026-09-29T14:00:00Z',note:'PRIVATE approval'}]}});
const project=(w=base(),rows=[review()])=>hireDevelopmentReview(w,employee,rows,now);

test('development linkage matches restaurant,hire,department and existing named reader policy without exposing assessment or notes',()=>{
 const w=base(),r=review(),rows=[r,{...r,id:'store',locationId:'b'},{...r,id:'area',area:'FOH'},{...r,id:'person',ownerId:'other'},{...r,id:'rehire',data:{...r.data,hireDate:'2025-01-01'}}];
 assert.equal(project(w,rows).length,1);assert.doesNotMatch(JSON.stringify(project(w,rows)),/PRIVATE|Private|draft|submission|criteria|approvalNote|managerId|approverId/);
 for(const me of [member('unassigned',['people.manage']),member('owner',['location.manage']),member('manager',[]),{...w.me,scheduleOnly:true,capabilities:[]},member('manager',['people.manage'],'FOH')])assert.equal(project({...w,me},rows).length,0);
 assert.equal(project({...w,me:w.members[1]},rows).length,1);
});
test('approval needs a same-hire nonfuture recorded independent GM decision,not merely saved approved phase',()=>{
 const w=base(),r=review();assert.equal(project(w,[r])[0].approvalRecorded,true);
 for(const change of [[],[{action:'gm-approved',actorId:'manager',at:'2026-09-29T14:00:00Z'}],[{action:'gm-approved',actorId:'gm',at:'invalid'}],[{action:'gm-approved',actorId:'gm',at:'2027-01-01T00:00:00Z'}],[{action:'gm-approved',actorId:'gm',at:'2026-09-01T03:59:59Z'}],[{action:'gm-returned',actorId:'gm',at:now}]]){r.data.history=change;assert.equal(project(w,[r])[0].approvalRecorded,false);}
 r.data.history=[{action:'gm-approved',actorId:'gm',at:'2026-09-01T04:00:00Z'}];assert.equal(project(w,[r])[0].approvalRecorded,true);
 r.data.approverId='manager';r.data.history[0].actorId='manager';assert.equal(project(w,[r])[0].approvalRecorded,false);
});
test('saved decisions survive filing and revoked current follow-up authority without becoming current clearance',()=>{
 const w=base(),r=review();r.archived=true;w.formerMembers=[{id:'gm',name:'Former GM'}];w.members=w.members.filter(m=>m.id!=='gm');
 const result=project(w,[r])[0];assert.equal(result.archived,true);assert.equal(result.approvalRecorded,true);assert.equal(result.approver.name,'Former GM');assert.equal(result.approver.available,false);assert.equal(result.overdueDays,0);assert.equal(result.lastDecision.outcome,'approved');
 r.data.phase='discussion';r.archived=false;r.data.history.push({action:'gm-returned',actorId:'gm',at:now});assert.equal(project(w,[r])[0].lastDecision.outcome,'returned');assert.equal(project(w,[r])[0].approvalRecorded,false);
});
test('linked guide freshness is separate from historical approval and manual source references never become verified guides',()=>{
 const w=base(),r=review();r.data.stations.push({source:'Private manual reference'});
 const guide={id:'guide',kind:'standard',locationId:'a',area:'BOH',revision:1,data:{status:'approved'}};w.records=[guide];
 assert.deepEqual(project(w,[r])[0].guideStatus,{current:1,changed:0,unavailable:0,manual:1});
 guide.revision=2;assert.equal(project(w,[r])[0].guideStatus.changed,1);assert.equal(project(w,[r])[0].approvalRecorded,true);
 for(const patch of [{data:{status:'retired'}},{area:'FOH'},{locationId:'b'}]){w.records=[{...guide,...patch}];assert.equal(project(w,[r])[0].guideStatus.unavailable,1);}
});
test('due status uses restaurant-local date and leaves completed,filed and invalid dates out of overdue counts',()=>{
 const w=base(),r=review();r.data.phase='gm-review';assert.equal(project(w,[r])[0].overdueDays,1,'UTC September30 is still restaurant September29');
 for(const phase of ['approved','cancelled']){r.data.phase=phase;assert.equal(project(w,[r])[0].overdueDays,0);}
 r.data.phase='gm-review';r.data.originalDueDate='2026-02-31';assert.equal(project(w,[r])[0].originalDueDate,null);assert.equal(project(w,[r])[0].overdueDays,0);
 r.data.originalDueDate='2026-10-01';assert.equal(project(w,[r])[0].overdueDays,0);
});

async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,id,'America/New_York').run();
 for(const [id,caps,area='BOH',loc='a'] of [['manager',['people.manage']],['gm',['people.manage','people.approve']],['owner',['location.manage'],'Executive'],['unassigned',['people.manage']],['scheduler',['schedule.manage']],['foh',['people.manage'],'FOH'],['foreign',['location.manage'],'BOH','b'],['hire',[]]])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,employment) VALUES(?,?,?,?,?,?,'Line Cook',?,'[]',?)").bind(id,id+'@example.test',id+'-identity',loc,id,area,JSON.stringify(caps),JSON.stringify(id==='hire'?{hireDate:'2026-09-01',status:'active'}:{})).run();
 const add=async r=>db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt,r.archived?now:null).run();
 const read=async(who,binding=db)=>{const res=await handleHireReview(new Request('http://localhost/api/people/hire-review?locationId=a&employeeId=hire',{headers:{'oai-authenticated-user-id':who+'-identity','oai-authenticated-user-email':who+'@example.test'}}),binding);return {status:res.status,data:await res.json()}};
 return {db,add,read};
}
test('endpoint includes visible filed decisions but reveals no hidden review count even with many unassigned records',async t=>{
 const f=await fixture(t);await f.add({...review(),archived:true});
 for(let i=0;i<55;i++)await f.add({...review('hidden'+i),data:{...review().data,managerId:'other',approverId:'othergm'}});
 const before=await f.db.prepare("SELECT data,revision,archived_at FROM records WHERE id='dev'").first();
 let r=await f.read('manager');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.development.length,1);assert.equal(r.data.development[0].archived,true);assert.equal(r.data.schemaVersion,'jmax-hire-review.v2');assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE|hidden|othergm/);
 assert.equal((await f.read('gm')).data.development.length,1);
 for(const who of ['owner','unassigned'])assert.equal((await f.read(who)).data.development.length,0,who);
 for(const who of ['scheduler','foh','foreign','hire'])assert.equal((await f.read(who)).status,403,who);
 assert.deepEqual(await f.db.prepare("SELECT data,revision,archived_at FROM records WHERE id='dev'").first(),before);
});
test('endpoint refuses partial visible development history after its separate50record bound',async t=>{
 const f=await fixture(t);for(let i=0;i<51;i++)await f.add(review('v'+i));const r=await f.read('manager');assert.equal(r.status,503);assert.match(r.data.error,/Too many visible development/);
});
test('post-read revalidation rejects source revision changes and reflects revoked assigned reviewer authority',async t=>{
 const f=await fixture(t);await f.add(review());
 const wrapped=mutate=>({withSession(){const session=f.db.withSession('first-primary');return {prepare(sql){const statement=session.prepare(sql);if(sql.includes("kind='development'"))return {bind:(...v)=>({all:async()=>{const result=await statement.bind(...v).all();await mutate();return result}})};return statement;},batch:x=>session.batch(x)}}});
 let r=await f.read('manager',wrapped(()=>f.db.prepare("UPDATE locations SET revision=revision+1 WHERE id='a'").run()));assert.equal(r.status,409);
 r=await f.read('manager',wrapped(()=>f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='gm'").run()));assert.equal(r.status,200);assert.equal(r.data.development[0].approver.available,false);assert.equal(r.data.development[0].approvalRecorded,true);
 r=await f.read('manager',wrapped(()=>f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='manager'").run()));assert.equal(r.status,409);
});

