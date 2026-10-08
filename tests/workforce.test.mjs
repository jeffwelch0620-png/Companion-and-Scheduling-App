import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { applyCommand, publicWorkspace } from '../.sites-runtime/shared/domain.mjs';
import { defaultStationLevels, stationProficiency } from '../.sites-runtime/shared/workforce.mjs';
import { currentWeek, workforceWeek, scheduleWeekSource } from '../.sites-runtime/shared/workforce-planning.mjs';
import { workforceContext } from '../.sites-runtime/shared/workforce-context.mjs';
import { scopeCurrent } from '../.sites-runtime/shared/companion-context.mjs';
import { planningStamp } from '../.sites-runtime/shared/schedule-review.mjs';
import { handleWorkspace } from '../.sites-runtime/shared/service.mjs';
import { handleCompanionChat } from '../.sites-runtime/shared/companion-chat.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const at='2026-09-14T16:00:00Z',start='2026-09-14',period={start:'2026-09-18T20:00:00Z',end:'2026-09-19T02:00:00Z'};
const member=(id,area='BOH',capabilities=[],qualifications=['Grill'])=>({id,locationId:'test',area,name:id,position:id==='dish'?'Dishwasher':id,capabilities,qualifications});
function setup(){
 const manager=member('manager','BOH',['people.manage','schedule.manage','schedule.publish']);
 const w={location:{id:'test',name:'Fictional workforce',timezone:'America/New_York',revision:1},me:manager,members:[manager,member('Mike'),member('Sarah'),member('Jake'),member('dish'),member('foh','FOH',['people.manage','schedule.manage'],['Server'])],records:[]};
 let serial=0;
 const run=(action,input,record,actor=manager)=>{
   const changes=applyCommand({...w,me:actor},{action,input,requestId:'request_'+serial,locationId:'test',...(record?{recordId:record.id,expectedRevision:record.revision}:{})},at,()=>`record_${++serial}`);
   for(const r of changes){const i=w.records.findIndex(old=>old.id===r.id);if(i<0)w.records.push(r);else w.records[i]=r;}
   w.location.revision++;return changes.find(r=>r.kind===action.split('.')[0]);
 };
 const levels=defaultStationLevels().map(l=>({...l,definition:l.value===4?'Performs this fictional station independently':''}));
 const definition={title:'Grill',area:'BOH',levels,independentLevel:4,status:'active',note:'Fictional explicit definition, not company policy'};
 const station=run('station.save',definition);
 const assess=(personId,level,certifiedTrainer=false,record)=>run('proficiency.save',{personId,stationId:station.id,stationRevision:station.revision,level,certifiedTrainer,evidence:'Fictional observed practice and next learning step'},record);
 const mike=assess('Mike',2),sarah=assess('Sarah',4,true);
 const add=(id,kind,ownerId,data,area='BOH')=>{const r={id,kind,ownerId,area,locationId:'test',revision:1,updatedAt:at,data};w.records.push(r);return r;};
 return {w,run,station,definition,assess,mike,sarah,add};
}
test('large saved history preserves full hours and reports training opportunities omitted from the bounded answer',()=>{
 const f=setup();
 for(let i=0;i<10;i++){
  const who=`pair-${i}`;f.w.members.push(member(who));f.assess(who,i<6?2:4,i>=6);
  f.add(`pair-shift-${i}`,'shift',who,{...period,personId:who,position:'Grill',published:true,cancelled:false});
 }
 while(f.w.records.length<3000)f.add(`old-${f.w.records.length}`,'shift','Mike',{personId:'Mike',position:'Grill',published:true,cancelled:false,start:'2025-01-01T17:00:00Z',end:'2025-01-01T18:00:00Z'});
 const facts=workforceWeek(f.w,start).facts;
 assert.equal(facts.totals.publishedMinutes,10*360);assert.equal(facts.totals.publishedShifts,10);
 assert.equal(facts.trainingOpportunities.length,20);assert.equal(facts.omittedRecords,4);
 assert.ok(facts.trainingOpportunities.every(p=>p.learner.startsWith('pair-')&&p.trainer.startsWith('pair-')));
});

test('station proficiency is explicit, versioned, scoped and cannot grant clearance or change legacy reviews',()=>{
 const f=setup(),{w}=f,legacy=f.add('legacy','development','Mike',{stations:[{selfScore:8,managerScore:6}],phase:'discussion',managerId:'manager',approverId:'manager',selfShared:false,managerShared:false,history:[]});
 const original=JSON.stringify(legacy),qualifications=JSON.stringify(w.members.map(m=>m.qualifications));
 assert.equal(stationProficiency(w,'Sarah',f.station).trainer,true);
 assert.throws(()=>f.assess('Mike',9),/latest version|already exists|level/);
 assert.throws(()=>f.run('proficiency.save',{personId:'manager'},null),/different authorized manager/);
 assert.throws(()=>f.run('station.save',f.definition,null,w.members.find(m=>m.id==='Mike')),/permission/);
 assert.throws(()=>f.run('station.save',f.definition,null,w.members.find(m=>m.id==='foh')),/permission/);
 const employee=publicWorkspace({...w,me:w.members.find(m=>m.id==='Mike')},at);
 assert.ok(employee.records.some(r=>r.id===f.mike.id));assert.ok(!employee.records.some(r=>r.id===f.sarah.id));
 assert.ok(!publicWorkspace({...w,me:w.members.find(m=>m.id==='dish')},at).records.some(r=>['proficiency','station'].includes(r.kind)));
 const changed=f.run('station.save',{...f.definition,levels:f.definition.levels.slice(0,4),note:'Four-level rubric explicitly revised'},f.station);
 assert.equal(stationProficiency(w,'Sarah',changed).current,false);assert.equal(stationProficiency(w,'Sarah',changed).trainer,false);
 assert.throws(()=>f.assess('Sarah',4,true,f.sarah),/definition changed/);
 assert.equal(JSON.stringify(legacy),original);assert.equal(JSON.stringify(w.members.map(m=>m.qualifications)),qualifications);
 const archived=f.run('station.save',{...f.definition,status:'archived'},changed);assert.equal(archived.data.status,'archived');assert.ok(w.records.some(r=>r.id===f.sarah.id));
});
test('weekly composition distinguishes headcount, missing readiness and an actual trainer pairing',()=>{
 const f=setup();
 f.add('mike-shift','shift','Mike',{...period,personId:'Mike',position:'Grill',published:false,cancelled:false});
 const sarah=f.add('sarah-shift','shift','Sarah',{...period,personId:'Sarah',position:'Grill',published:false,cancelled:false});
 f.add('need','staffing','manager',{...period,title:'Friday Grill',position:'Grill',minimum:2,source:'Fictional manager requirement',status:'approved',history:[]});
 let facts=workforceWeek(f.w,start).facts;assert.equal(facts.staffing[0].plannedGaps.length,0);assert.equal(facts.staffing[0].publishedGaps.length,1);assert.equal(facts.trainingOpportunities.length,1);assert.equal(facts.trainingOpportunities[0].trainer,'Sarah');assert.equal(facts.trainingOpportunities[0].learner,'Mike');
 assert.equal(facts.staffing[0].composition[0].atOrAboveIndependentLevel,1);assert.ok(!facts.staffing[0].candidates.some(c=>['Mike','Sarah'].includes(c.name)));
 const selected=workforceWeek(f.w,start,['mike-shift']).facts;assert.equal(selected.trainingOpportunities.length,0);assert.equal(selected.staffing[0].composition[0].atOrAboveIndependentLevel,0);assert.equal(selected.staffing[0].plannedGaps.length,1);
 const before=planningStamp(f.w,start,['mike-shift','sarah-shift']);f.assess('Sarah',3,false,f.sarah);assert.notEqual(planningStamp(f.w,start,['mike-shift','sarah-shift']),before);
 facts=workforceWeek(f.w,start).facts;assert.equal(facts.staffing[0].plannedGaps.length,0);assert.equal(facts.staffing[0].composition[0].atOrAboveIndependentLevel,0);assert.equal(facts.trainingOpportunities.length,0);
 f.add('sarah-off','request','Sarah',{...period,type:'time-off',status:'approved',note:'PRIVATE_TIME_OFF_REASON'});
 facts=workforceWeek(f.w,start).facts;assert.equal(facts.staffing[0].plannedGaps.length,1);assert.deepEqual(facts.staffing[0].candidates.find(c=>c.name==='Sarah').conflicts,['Overlapping shift','Approved time off']);
 sarah.data.cancelled=true;assert.equal(workforceWeek(f.w,start).facts.shifts.length,1);
});
test('JMAX uses the restaurant week start and totals the full week before shortening shift details',()=>{
 const f=setup();f.w.me.capabilities.push('location.manage');f.w.location.weekStartsOn=3;
 assert.equal(currentWeek(f.w,'2026-09-11T16:00:00Z'),'2026-09-09');
 assert.equal(currentWeek(f.w,'2026-09-09T02:00:00Z'),'2026-09-02');
 for(let i=0;i<121;i++)f.add('bulk-'+i,'shift','Mike',{personId:'Mike',position:'Grill',start:'2026-09-11T16:00:00Z',end:'2026-09-11T17:00:00Z',published:true,cancelled:false});
 f.add('draft','shift','Sarah',{personId:'Sarah',position:'Grill',start:'2026-09-11T16:00:00Z',end:'2026-09-11T18:00:00Z',published:false,cancelled:false});
 f.add('boundary','shift','Jake',{personId:'Jake',position:'Grill',start:'2026-09-09T02:00:00Z',end:'2026-09-09T06:00:00Z',published:true,cancelled:false});
 f.add('cancelled','shift','Mike',{personId:'Mike',position:'Grill',...period,published:true,cancelled:true});
 const context=workforceContext(f.w,'Are the scheduled hours good for a 56k week?','2026-09-11T16:00:00Z'),facts=context.evidence[0].facts;
 assert.equal(facts.weekStart,'2026-09-09');assert.ok(facts.shifts.length<123);assert.equal(facts.totals.publishedMinutes,123*60);assert.equal(facts.totals.plannedMinutes,125*60);assert.equal(facts.totals.draftMinutes,120);
 assert.equal(context.context.salesCheck.weeklySales,56000);assert.equal(context.context.salesCheck.published.salesPerScheduledHour,455.28);assert.equal(context.context.salesCheck.plannedIncludingDrafts.salesPerScheduledHour,448);
 const selected=workforceWeek(f.w,'2026-09-09',[]).facts.totals;assert.equal(selected.plannedMinutes,123*60);assert.equal(selected.draftMinutes,0);
 const employee=workforceContext({...f.w,me:f.w.members.find(m=>m.id==='Mike')},'a 56k week','2026-09-11T16:00:00Z');assert.equal(employee.context.salesCheck,null);assert.equal(employee.evidence[0].facts.totals.scope,'own schedule');assert.equal(employee.evidence[0].facts.totals.publishedMinutes,121*60);
 const attached=scheduleWeekSource(f.w,'2026-09-16');assert.equal(workforceContext(f.w,'a 56k week','2026-09-11T16:00:00Z',[],attached).evidence[0].facts.weekStart,'2026-09-16');
});
test('AI distinguishes whole shift-card hours from calendar-week carry-in and carry-out hours',()=>{
 const f=setup();
 f.add('carry-in','shift','Mike',{personId:'Mike',position:'Grill',start:'2026-09-14T02:00:00Z',end:'2026-09-14T06:00:00Z',published:true,cancelled:false});
 f.add('carry-out','shift','Sarah',{personId:'Sarah',position:'Grill',start:'2026-09-20T20:00:00Z',end:'2026-09-21T05:00:00Z',published:true,cancelled:false});
 f.add('draft','shift','Jake',{personId:'Jake',position:'Grill',...period,published:false,cancelled:false});
 const totals=workforceWeek(f.w,start).facts.totals;
 assert.equal(totals.publishedMinutes,10*60);assert.equal(totals.shiftCardPublishedMinutes,9*60);
 assert.equal(totals.plannedMinutes,16*60);assert.equal(totals.shiftCardPlannedMinutes,15*60);
 assert.equal(workforceWeek(f.w,start,[]).facts.totals.shiftCardPlannedMinutes,9*60);
 const own=workforceWeek({...f.w,me:f.w.members.find(m=>m.id==='Mike')},start).facts.totals;
 assert.equal(own.publishedMinutes,120);assert.equal(own.shiftCardPublishedMinutes,0);
});

test('AI uses the selected week, excludes parked/private facts, and rejects changed snapshots',()=>{
 const f=setup();f.add('mike-shift','shift','Mike',{...period,personId:'Mike',position:'Grill',published:false,cancelled:false});
 f.add('private','feedback','Mike',{text:'PRIVATE_NOTE',shared:false,status:'private',history:[]});
 f.add('order','order','manager',{lines:[],note:'PARKED_ORDER',status:'review',history:[]});
 f.add('school','availability','Sarah',{title:'PRIVATE_SCHOOL_REASON',kind:'school',status:'approved',startDate:start,endDate:'2026-09-20',days:[5],startMinute:480,endMinute:900,beforeMinutes:0,afterMinutes:0,decision:'PRIVATE_DECISION'});
 f.add('guide','standard','manager',{title:'Unrelated approved operating guide',position:'Grill',status:'approved',version:1,criteria:['An unrelated check'],source:'Fictional',verification:'manager',history:[]});
 const focus=scheduleWeekSource(f.w,start),context=workforceContext(f.w,'Who can train?',at,[],focus),raw=JSON.stringify(context);assert.equal(context.evidence.length,1);assert.doesNotMatch(raw,/Unrelated approved operating guide/);
 assert.equal(context.selectedWork.id,focus.id);assert.equal(context.context.product,'workforce');assert.match(raw,/Sarah/);assert.match(raw,/certifiedTrainer/);assert.doesNotMatch(raw,/PRIVATE_|PARKED_ORDER/);assert.ok(scopeCurrent(context.scope,f.w,at));
 assert.throws(()=>workforceContext(f.w,'this',at,[],{id:'order',revision:1}),/no longer available/);
 f.w.location.revision++;assert.equal(scopeCurrent(context.scope,f.w,at),false);assert.throws(()=>workforceContext(f.w,'this',at,[],focus),/changed/);
 const employee=workforceContext({...f.w,me:f.w.members.find(m=>m.id==='Mike')},'my development',at);assert.doesNotMatch(JSON.stringify(employee.context),/Sarah|PRIVATE_|PARKED_ORDER/);assert.match(JSON.stringify(employee.context),/Mike/);
});
test('persistent workforce commands and active-product chat retain identity, receipts, assessment privacy and manager availability review',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 const f=setup();await db.prepare('INSERT INTO locations(id,name,timezone,revision) VALUES(?,?,?,?)').bind('test','Fictional workforce','America/New_York',1).run();
 for(const m of f.w.members)await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(m.id,m.id+'@example.test',m.id+'-identity','test',m.name,m.area,m.position,JSON.stringify(m.capabilities),JSON.stringify(m.qualifications)).run();
 const headers=actor=>({'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://test.example','Content-Type':'application/json'});
 const get=async actor=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=test',{headers:headers(actor)}),db);assert.equal(response.status,200);return response.json()};
 const call=async(actor,action,input,record,requestId=crypto.randomUUID())=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:headers(actor),body:JSON.stringify({locationId:'test',requestId,action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})}),db);return {status:response.status,data:await response.json()}};
 const station=await call('manager','station.save',f.definition);assert.equal(station.status,200,JSON.stringify(station));
 const input={personId:'Mike',stationId:station.data.recordId,stationRevision:station.data.revision,level:2,certifiedTrainer:false,evidence:'Practice this station with the assigned trainer'};
 const proficiency=await call('manager','proficiency.save',input,null,'same-request');assert.equal(proficiency.status,200,JSON.stringify(proficiency));assert.deepEqual(await call('manager','proficiency.save',input,null,'same-request'),proficiency);
 assert.equal((await call('Mike','proficiency.save',{...input,certifiedTrainer:true},proficiency.data)).status,403);
 assert.equal((await get('Sarah')).records.filter(r=>r.kind==='proficiency').length,0);
 const availability=await call('manager','availability.save',{personId:'Mike',title:'Fictional availability',kind:'unavailable',startDate:'2026-09-14',endDate:'2026-09-20',days:[4],startMinute:480,endMinute:900});assert.equal(availability.status,200,JSON.stringify(availability));
 assert.equal((await get('Mike')).records.find(r=>r.id===availability.data.recordId).data.status,'pending');
 assert.equal((await call('manager','availability.review',{approve:true,note:'Confirmed with employee'},availability.data)).status,200);
 let clock=Date.parse(at),providerContext;const provider=async(_url,init)=>{providerContext=JSON.parse(JSON.parse(init.body).input[1].content.split('\n').slice(1).join('\n'));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Fictional provider: recorded levels need a manager review.',sourceIds:[providerContext.evidence[0].source.id]})}]}]})};
 const chat=async(actor,body)=>handleCompanionChat(new Request('https://test.example/api/companion'+(body?'':'?locationId=test'),{method:body?'POST':'GET',headers:headers(actor),...(body?{body:JSON.stringify(body)}:{})}),db,{OPENAI_API_KEY:'sk-fictional-test'},provider,()=>clock,'workforce');
 const initial=await(await chat('manager')).json(),w=await get('manager'),focus=scheduleWeekSource(w,start);
 const response=await chat('manager',{locationId:'test',action:'ask',requestId:'workforce-chat',conversationId:initial.conversationId,expectedRevision:initial.revision,question:'Review this week',focus:{id:focus.id,revision:focus.revision}});assert.equal(response.status,200,await response.clone().text());
 assert.equal(providerContext.product,'workforce');assert.equal(providerContext.selectedWork.id,focus.id);assert.equal(providerContext.evidence[0].facts.proficiency.find(p=>p.person==='Mike').level,2);
 const dishResponse=await chat('dish');assert.equal(dishResponse.status,200);const dishView=await dishResponse.json();clock+=6000;
 const dishAnswer=await chat('dish',{locationId:'test',action:'ask',requestId:'dish-own-schedule',conversationId:dishView.conversationId,expectedRevision:dishView.revision,question:'What do I need to know about my published schedule?'});
 assert.equal(dishAnswer.status,200);const dishResult=await dishAnswer.json();assert.ok(dishResult.turns.at(-1).answer);
 assert.equal(providerContext.evidence[0].facts.view,'Own published schedule and development only');
 assert.ok(providerContext.evidence[0].facts.shifts.every(s=>s.personId==='dish'));
 assert.ok(providerContext.evidence[0].facts.proficiency.every(p=>p.person==='dish'));
 assert.deepEqual((await get('dish')).me.capabilities,[]);
 assert.equal((await get('Mike')).members.find(m=>m.id==='Mike').qualifications[0],'Grill');
});
