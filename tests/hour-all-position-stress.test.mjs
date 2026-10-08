import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runPositionWeek} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {trialSourceRevision} from './ai-task-trial-fixture.mjs';

const groups=['berts-foh','berts-boh','rudds','papas','management','commissary'];
const profiles=groups.flatMap(group=>JSON.parse(fs.readFileSync(`evidence/all-position-week/${group}-profiles.json`,'utf8')).map(p=>({...p,group})));
const sourceRevision=trialSourceRevision(),receipts=[];
const deniedStatus=profile=>(profile.capabilities??[]).some(c=>c==='tasks.manage'||c==='location.manage')?403:404;
const recordState=store=>JSON.stringify(Object.fromEntries(['records','command_receipts','audit_events'].map(table=>[table,store.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));

for(const input of profiles)test(`${input.restaurant} ${input.position}: second distinct week with rotated curveballs and added communication/reassignment interruptions`,async()=>{
 const extraChecks=[];
 const profile={...input,simulationStartDate:'2026-10-19',dailyScenarios:input.dailyScenarios.map((_,n)=>{
  const original=input.dailyScenarios[(n+2)%7];
  return {...original,sourceScenarioDay:(n+2)%7+1,async run({command,view,request,store,day}){
   if(day.day===1||day.day===7){
    let note=await command('worker','message.send',{recipients:['manager'],title:`Second-week ${day.day} named escalation`,body:'Fictional unresolved work needs a manager response, rather than an AI claim that somebody has already been notified.'});
    note=await command('manager','message.reply',{text:'Named manager direction saved; related work still requires its own independent verification.'},note);
    assert.equal((await view('worker')).records.find(r=>r.id===note.recordId).data.replies.length,1);
    extraChecks.push({day:day.day,action:'manager reply arrives in worker conversation',status:'passed'});
   }else if(day.day===2||day.day===3){
    let support=await command('manager','task.create',{ownerId:day.day===2?'incoming':'worker',kind:'task',title:`Second-week day ${day.day} additional coverage`,detail:'Clearly assigned fictional work; retain remaining work until independently checked.',due:new Date(day.dayStart+6*3600000).toISOString()});
    if(day.day===3)support=await command('manager','task.reassign',{ownerId:'incoming',note:'The manager explicitly changed the named person doing this additional ordinary task.'},support);
    const before=recordState(store());
    const denied=await handleWorkspace(request('workspace','worker',{locationId:profile.restaurant,requestId:crypto.randomUUID(),action:'task.transition',recordId:support.recordId,expectedRevision:support.revision,input:{step:'ready',note:'Cannot report another person’s work ready'}}),store().db);
    assert.equal(denied.status,deniedStatus(profile));assert.equal(recordState(store()),before);
    support=await command('incoming','task.transition',{step:'ready',note:'Incoming person reports coverage work ready'},support);
    if(day.day===2){support=await command('manager','task.transition',{step:'fix',note:'Independent inspection finds a remaining issue'},support);support=await command('incoming','task.transition',{step:'ready',note:'Additional correction reported'},support);}
    support=await command('manager','task.transition',{step:'verify',note:'Fictional independent check of the additional ordinary task'},support);
    assert.equal((await view('manager')).records.find(r=>r.id===support.recordId).data.phase,'closed');
    extraChecks.push({day:day.day,action:day.day===2?'named coverage with correction and independent check':'reassigned coverage rejects former-owner submission',status:'passed'});
   }else if(day.day===4){
    const shared=await command('manager','message.send',{recipients:['worker','incoming'],title:'Second-week shared coverage direction',body:'Both named people should read the same manager direction; this message does not certify work completion.'});
    await command('worker','message.read',{},shared);await command('incoming','message.read',{},shared);
    const saved=(await view('manager')).records.find(r=>r.id===shared.recordId);assert.ok(saved.data.readBy.includes('worker')&&saved.data.readBy.includes('incoming'));
    extraChecks.push({day:day.day,action:'two recipients acknowledge the saved direction without losing either read',status:'passed'});
   }else if(day.day===5||day.day===6){
    const before=recordState(store());
    const rejected=await handleWorkspace(request('workspace','worker',{locationId:profile.restaurant,requestId:crypto.randomUUID(),action:'message.send',input:{recipients:['outsider'],title:'Rejected foreign destination',body:'A restaurant employee cannot send private work into the other restaurant.'}}),store().db);
    assert.equal(rejected.status,400);assert.equal(recordState(store()),before);
    extraChecks.push({day:day.day,action:'foreign-recipient rejection is atomic and leaves no receipt or message',status:'passed'});
   }
  }};
 })};
 const result=await runPositionWeek(profile);result.group=input.group;result.variant='Fresh durable seven-day fixture beginning October 19; source curveballs rotated by two days; added actual communication, ordinary coverage correction/reassignment and foreign-recipient interruptions.';result.extraChecks=extraChecks;result.sourceRevision=sourceRevision;
 fs.mkdirSync('evidence/hour-trial/second-week',{recursive:true});fs.writeFileSync(`evidence/hour-trial/second-week/${input.id}.json`,JSON.stringify(result,null,2));receipts.push(result);
 assert.equal(result.days.length,7);assert.equal(result.operationalReseeds,0);assert.equal(extraChecks.length,7);assert.deepEqual(result.failures,[],JSON.stringify(result.failures));
});
test.after(()=>{fs.mkdirSync('evidence/hour-trial',{recursive:true});fs.writeFileSync('evidence/hour-trial/second-week-summary.json',JSON.stringify({createdAt:new Date().toISOString(),sourceRevision,profiles:receipts.length,days:receipts.reduce((n,r)=>n+r.days.length,0),phaseChecks:receipts.reduce((n,r)=>n+r.days.reduce((m,d)=>m+d.checks.length,0),0),extraChecks:receipts.reduce((n,r)=>n+r.extraChecks.length,0),failures:receipts.flatMap(r=>r.failures.map(f=>({profileId:r.id,...f}))),proof:'Actual handler lifecycle and durable SQLite; AI responses mocked. This is a second independently seeded week with within-week continuity, not proof that one database survived two successive weeks. The separate durable multiweek tests cover longer continuity.',profileIds:receipts.map(r=>r.id)},null,2));});
