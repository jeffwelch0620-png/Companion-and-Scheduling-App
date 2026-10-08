import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {selectableStations} from '../.sites-runtime/shared/station-assignment.mjs';
import {guidesForShift} from '../.sites-runtime/shared/shift-learning.mjs';
import {stationProficiency} from '../.sites-runtime/shared/workforce.mjs';
import {weekCopyPlan} from '../.sites-runtime/shared/week-copy.mjs';
import {workforceWeek} from '../.sites-runtime/shared/workforce-planning.mjs';
import {coverageEligible} from '../.sites-runtime/shared/coverage.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const at='2026-09-14T12:00:00Z',period={start:'2026-09-18T16:00:00Z',end:'2026-09-18T22:00:00Z'};
const member=(id,position,area,capabilities=[])=>({id,name:id,position,area,locationId:'a',capabilities,qualifications:[],scheduleJobs:[position]});
export function fixture(){
 const owner=member('owner','Owner','Executive',['location.manage','people.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage']);
 const cook=member('cook','Cook','BOH'),host=member('host','Host','FOH'),second=member('second','Cook','BOH'),dish=member('dish','Dishwasher','BOH');
 const w={location:{id:'a',name:'Fictional station rehearsal',timezone:'America/New_York',revision:1},me:owner,members:[owner,cook,host,second,dish],records:[]};
 let serial=0;
 const run=(action,input={},record,actor=owner)=>{const changes=applyCommand({...w,me:actor},{action,input,locationId:'a',requestId:crypto.randomUUID(),...(record?{recordId:record.id,expectedRevision:record.revision}:{})},at,()=>`made-${++serial}`);for(const r of changes){const i=w.records.findIndex(old=>old.id===r.id);if(i<0)w.records.push(r);else w.records[i]=r;}w.location.revision++;return changes.find(r=>r.kind===action.split('.')[0])??changes[0];};
 const setup=(job,extra={})=>({jobs:[job],allJobMembers:true,memberIds:[],standardIds:[],managerId:'owner',goals:[],...extra});
 const station=(title,job,area,extra={})=>run('station.save',{title,area,levels:[],independentLevel:null,status:'active',note:'Fictional setup for software tests',setup:setup(job,extra)});
 const fry=station('Fry','Cook','BOH'),grill=station('Grill','Cook','BOH');
 const seating=station('Seating','Host','FOH'),busser=station('Busser','Host','FOH'),window=station('Back Window','Host','FOH'),runner=station('Food Runner','Host','FOH');
 const change=(s,patch)=>run('station.save',{...s.data,area:s.area,setup:{...s.data.setup,...patch},note:'Fictional configuration update'},w.records.find(r=>r.id===s.id));
 const shift=(person=cook,station=fry,p=period)=>run('shift.save',{personId:person.id,position:person.position,stationId:station.id,...p});
 const guide=(id,status='approved',station=fry)=>{const r={id,kind:'standard',locationId:'a',area:station.area,ownerId:'owner',revision:1,updatedAt:at,data:{title:id,position:station.data.title,zone:station.data.title,status,version:1,source:'Fictional demonstration',criteria:['Demonstrate the fictional station check'],verification:'manager',history:[]}};w.records.push(r);return r;};
 const template=(id='practice',standardId)=>({id,title:'Practice the fictional station',definition:'Show the approved fictional check to the reviewer.',dueDays:7,...(standardId?{standardId}:{})});
 return {w,run,cook,host,second,dish,fry,grill,seating,busser,window,runner,setup,station,change,shift,guide,template};
}

test('Cook and Host receive only their job stations; future hires inherit choices without gaining clearance',()=>{
 const f=fixture(),before=JSON.stringify(f.w.members);
 assert.deepEqual(selectableStations(f.w,f.cook,'Cook').map(s=>s.data.title),['Fry','Grill']);
 assert.deepEqual(selectableStations(f.w,f.host,'Host').map(s=>s.data.title),['Back Window','Busser','Food Runner','Seating']);
 assert.deepEqual(selectableStations(f.w,f.host,'Cook'),[]);assert.deepEqual(selectableStations(f.w,f.dish,'Dishwasher'),[]);
 const hire=member('new-hire','Cook','BOH');f.w.members.push(hire);assert.equal(selectableStations(f.w,hire,'Cook').length,2);
 f.w.members.pop();assert.equal(JSON.stringify(f.w.members),before);
 f.change(f.fry,{allJobMembers:false,memberIds:[f.cook.id]});assert.equal(selectableStations(f.w,f.second,'Cook').length,1);
});

test('server rejects unauthorized station changes, foreign stations and invalid job/guide/employee mappings',()=>{
 const f=fixture();assert.throws(()=>f.run('station.save',{...f.fry.data,area:'BOH',note:'No permission'},f.fry,f.cook),/permission/);
 assert.throws(()=>f.change(f.fry,{jobs:['Host']}),/existing scheduling jobs/);
 assert.throws(()=>f.change(f.fry,{memberIds:['host']}),/matching job/);
 assert.throws(()=>f.shift(f.host,f.fry),/department/);
 f.w.records.push({...f.fry,id:'foreign',locationId:'b'});assert.throws(()=>f.shift(f.cook,{id:'foreign'}),/active station/);
 const foreign=f.guide('foreign-guide');foreign.locationId='b';assert.throws(()=>f.change(f.fry,{standardIds:[foreign.id]}),/current draft or approved/);
});

test('station shift keeps Cook as job and links only its exact approved guides without leaking drafts',()=>{
 const f=fixture(),approved=f.guide('approved-fry'),draft=f.guide('PRIVATE_DRAFT','draft'),other=f.guide('grill-guide','approved',f.grill);
 f.change(f.fry,{standardIds:[approved.id,draft.id],goals:[f.template('draft-goal',draft.id)]});
 const s=f.shift();assert.equal(s.data.position,'Cook');assert.equal(s.data.stationName,'Fry');
 assert.deepEqual(guidesForShift(f.w,s).map(g=>g.id),[approved.id]);assert.ok(!guidesForShift(f.w,s).includes(other));
 const view=publicWorkspace({...f.w,me:f.cook},at);assert.doesNotMatch(JSON.stringify(view),/PRIVATE_DRAFT|draft-goal/);
 assert.equal(view.records.find(r=>r.id===f.fry.id).data.setup.goals.length,0);
 f.run('shift.publish',{},s);assert.equal(f.w.records.filter(r=>r.kind==='goal').length,0,'Draft-linked goals wait for approval');
});

test('publishing proposes goals once, repeated weeks do not duplicate, and history receipts survive goal archiving',()=>{
 const f=fixture(),guide=f.guide('approved-guide');f.change(f.fry,{standardIds:[guide.id],goals:[f.template('practice',guide.id)]});
 const a=f.shift(),b=f.shift(f.cook,f.fry,{start:'2026-09-19T16:00:00Z',end:'2026-09-19T22:00:00Z'});
 assert.equal(f.w.records.filter(r=>r.kind==='goal').length,0);
 f.run('shift.publish-batch',{weekStart:'2026-09-14',confirmed:true,note:'Fictional week reviewed',drafts:[a,b].map(s=>({id:s.id,revision:s.revision,closing:[]}))});
 const goals=f.w.records.filter(r=>r.kind==='goal');assert.equal(goals.length,1);assert.equal(goals[0].data.phase,'proposed');assert.equal(goals[0].data.standardId,guide.id);
 assert.equal(goals[0].data.stationLearning.stationId,f.fry.id);assert.deepEqual(f.cook.qualifications,[]);
 assert.ok(f.w.records.some(r=>r.kind==='message'&&r.data.recordId===goals[0].id));
 f.w.records=f.w.records.filter(r=>r.id!==goals[0].id); // simulate a filed completed goal
 const c=f.shift(f.cook,f.fry,{start:'2026-09-20T16:00:00Z',end:'2026-09-20T22:00:00Z'});f.run('shift.publish',{},c);
 assert.equal(f.w.records.filter(r=>r.kind==='goal').length,0);assert.equal(f.w.records.find(r=>r.id===f.fry.id).data.issuedGoals.length,1);
});

test('copying a week preserves station and rechecks current station restrictions before making drafts',()=>{
 const f=fixture(),s=f.shift(),options={sourceWeek:'2026-09-14',targetWeek:'2026-09-21',shiftIds:[s.id],staffingIds:[],repeated:''};
 const copied=f.run('shift.copy-week',{...options,reviewStamp:weekCopyPlan(f.w,options).stamp,confirmed:true,note:'Fictional copy reviewed'});
 assert.equal(copied.data.stationId,f.fry.id);assert.equal(copied.data.position,'Cook');assert.equal(copied.data.published,false);
 f.change(f.fry,{allJobMembers:false,memberIds:['second']});assert.throws(()=>weekCopyPlan(f.w,{...options,targetWeek:'2026-09-28'}),/scheduling list/);
});

test('a draft-linked goal waits for approval and a later current shift; historical edits create no new learning',()=>{
 const f=fixture(),guide=f.guide('pending-guide','draft');f.change(f.fry,{standardIds:[guide.id],goals:[f.template('practice',guide.id)]});
 f.run('shift.publish',{},f.shift());assert.equal(f.w.records.filter(r=>r.kind==='goal').length,0);
 guide.data.status='approved';guide.revision++;
 f.run('shift.publish',{},f.shift(f.cook,f.fry,{start:'2026-09-19T16:00:00Z',end:'2026-09-19T22:00:00Z'}));
 assert.equal(f.w.records.filter(r=>r.kind==='goal').length,1);
 const old=f.shift(f.second,f.fry,{start:'2026-09-10T16:00:00Z',end:'2026-09-10T22:00:00Z'});old.data.published=true;
 f.run('shift.save',{personId:'second',position:'Cook',stationId:f.fry.id,start:old.data.start,end:old.data.end,note:'Historical correction only'},old);
 assert.equal(f.w.records.filter(r=>r.kind==='goal').length,1);
});

test('station setup edits preserve assessments; changed rubric invalidates them and goal publication does not grant scores',()=>{
 const f=fixture();let station=f.run('station.save',{...f.fry.data,area:'BOH',levels:[{label:'Learning',definition:'Practice with help'},{label:'Independent',definition:'Demonstrates the fictional check'}],independentLevel:2,note:'Fictional scale'},f.fry);
 f.run('proficiency.save',{personId:'cook',stationId:station.id,stationRevision:station.revision,level:1,certifiedTrainer:false,evidence:'Fictional practice observed'});
 station=f.change(station,{goals:[f.template()]});assert.equal(stationProficiency(f.w,'cook',station).current,true);
 f.run('shift.publish',{},f.shift());station=f.w.records.find(r=>r.id===station.id);assert.equal(stationProficiency(f.w,'cook',station).current,true);
 station=f.run('station.save',{...station.data,area:'BOH',levels:[{label:'Learning',definition:'Changed rubric'},{label:'Independent',definition:'Demonstrates new check'}],note:'Rubric revision'},station);
 assert.equal(stationProficiency(f.w,'cook',station).current,false);
});

test('publication fails atomically when a reviewer leaves or a station no longer allows the employee',()=>{
 const f=fixture();f.change(f.fry,{goals:[f.template()]});const s=f.shift();
 f.w.records.find(r=>r.id===f.fry.id).data.setup.managerId='departed';let before=JSON.stringify(f.w);
 assert.throws(()=>f.run('shift.publish',{},s),/reviewer is unavailable/);assert.equal(JSON.stringify(f.w),before);
 f.w.records.find(r=>r.id===f.fry.id).data.setup.managerId='owner';f.change(f.fry,{allJobMembers:false,memberIds:['second']});before=JSON.stringify(f.w);
 assert.throws(()=>f.run('shift.publish',{},s),/scheduling list/);assert.equal(JSON.stringify(f.w),before);
});

test('coverage honors scheduling jobs plus station restrictions and AI distinguishes job from station',()=>{
 const f=fixture(),s=f.run('shift.publish',{},f.shift());
 const offer={id:'offer',kind:'coverage',locationId:'a',area:'BOH',ownerId:'cook',revision:1,data:{...s.data,shiftId:s.id,shiftRevision:s.revision,position:'Cook',status:'open',duties:[],volunteers:[]}};
 assert.equal(coverageEligible(f.w,offer,f.second,at),true);assert.equal(coverageEligible(f.w,offer,f.host,at),false);
 f.change(f.fry,{allJobMembers:false,memberIds:['cook']});assert.equal(coverageEligible(f.w,offer,f.second,at),false);
 const facts=workforceWeek(f.w,'2026-09-14').facts;assert.equal(facts.shifts[0].station,'Fry');assert.equal(facts.shifts[0].job,'Cook');assert.equal(facts.shifts[0].cleared,false);f.cook.qualifications=['Fry'];assert.equal(workforceWeek(f.w,'2026-09-14').facts.shifts[0].cleared,true);
});

test('durable save, publication retry and employee read preserve job-based stations and private drafts',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 const f=fixture();f.change(f.fry,{goals:[f.template()]});const s=f.shift();
 await db.prepare('INSERT INTO locations(id,name,timezone,revision) VALUES(?,?,?,?)').bind('a','Fictional station test','America/New_York',1).run();
 for(const m of f.w.members)await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(m.id,m.id+'@example.test',m.id,'a',m.name,m.area,m.position,JSON.stringify(m.capabilities),'[]',JSON.stringify(m.scheduleJobs)).run();
 for(const r of f.w.records)await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(r.id,'a',r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),at).run();
 const headers=actor=>({'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test',Origin:'https://test.example','Content-Type':'application/json'});
 const body=JSON.stringify({locationId:'a',requestId:'publish-once',action:'shift.publish',recordId:s.id,expectedRevision:s.revision,input:{}});
 const call=()=>handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:headers('owner'),body}),db);
 let response=await call();assert.equal(response.status,200,await response.clone().text());const result=await response.json();response=await call();assert.deepEqual(await response.json(),result);
 const view=await(await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:headers('cook')}),db)).json();
 assert.equal(view.records.filter(r=>r.kind==='goal').length,1);assert.deepEqual(view.me.qualifications,[]);assert.deepEqual(view.me.scheduleJobs,['Cook']);
 assert.equal(view.records.find(r=>r.id===f.fry.id).data.setup.allJobMembers,true);assert.equal(view.records.find(r=>r.id===f.fry.id).data.issuedGoals,undefined);
});
