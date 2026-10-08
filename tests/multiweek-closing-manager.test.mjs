import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {buildShiftBrief} from '../.sites-runtime/shared/shift-brief.mjs';
import {gmOperatingSetup,gmClosingSetup} from '../.sites-runtime/shared/gm-operating-setup.mjs';

const evidence={role:'Closing manager and explicitly reviewed fictional GM',schema:'jmax-closing-week.v1',execution:'Actual authenticated request handlers with disposable in-memory SQLite D1 adapter; application clock controlled.',days:[],checks:[],findings:[],limitations:['No production storage, real permission changes, external APIs or bank/payroll mutations.','Reviewed GM closing membership is an explicit fictional fixture; this is not an automatically enabled or title-derived permission grant.','Physical cleaning and manager inspections are represented by submitted fictional evidence. Handler execution proves workflow gates, not physical restaurant work.','Bank settlement remains manual/external: the app records a checkout note but no bank balances, cash reconciliation, payment or payroll transaction.','SQLite adapter exercises SQL transactions and rollbacks; deployed Workers/D1 and browser UI are not exercised.']};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const source=(file,needle)=>({file,line:fs.readFileSync(file,'utf8').split(/\r?\n/).findIndex(l=>l.includes(needle))+1});

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){let params=[];return {bind(...values){params=values;return this;},async all(){const results=sqlite.prepare(sql).all(...params);return {results,meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async first(){return sqlite.prepare(sql).get(...params)??null;},async run(){const result=sqlite.prepare(sql).run(...params);return {results:[],meta:{changes:Number(result.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};db.withSession=()=>db;
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['a','b'])sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'FICTIONAL closing '+loc,'America/New_York');
 const caps=['tasks.manage','close.confirm'];
 const people=[['owner','Executive','Owner',['location.manage','tasks.manage','close.confirm']],['gm','Executive','General manager',gmOperatingSetup().capabilities],['gm-reviewed','Executive','General manager',gmClosingSetup().capabilities],['foh','FOH','FOH manager',caps],['boh','BOH','BOH manager',caps],['other-foh','FOH','FOH manager',caps],['other-boh','BOH','BOH manager',caps],['first-FOH','FOH','First checker',['close.verify']],['first-BOH','BOH','First checker',['close.verify']],['incoming-FOH','FOH','Server',[]],['incoming-BOH','BOH','Cook',[]],['server','FOH','Server',[]],['cook','BOH','Cook',[]],['helper-FOH','FOH','Server',[]],['helper-BOH','BOH','Cook',[]],['opener-FOH','FOH','Opening manager',['tasks.manage']],['opener-BOH','BOH','Opening manager',['tasks.manage']]];
 for(const [id,area,position,capabilities] of people)sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(id,id+'@example.test',id+'-identity','a','FICTIONAL '+id,area,position,JSON.stringify(capabilities),JSON.stringify([area==='FOH'?'Server':'Cook']));
 sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').run('foreign','foreign@example.test','foreign-identity','b','FICTIONAL foreign','FOH','Manager',JSON.stringify(caps),'[]');
 const headers=actor=>({'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'});
 const invoke=async(actor,action,input={},record,requestId=crypto.randomUUID(),loc='a')=>{const r=await handleWorkspace(new Request('http://localhost/api/workspace'+(action?'':'?locationId='+loc),{headers:headers(actor),...(action?{method:'POST',body:JSON.stringify({requestId,locationId:loc,action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})})}:{})}),db);return {status:r.status,data:await r.json()};};
 const saved=ref=>{const row=sqlite.prepare('SELECT * FROM records WHERE id=?').get(ref.recordId??ref.id??ref);return row?{id:row.id,kind:row.kind,locationId:row.location_id,ownerId:row.owner_id,area:row.area,revision:row.revision,updatedAt:row.updated_at,data:JSON.parse(row.data)}:null;};
 const seed=(id,kind,ownerId,area,data,at,loc='a')=>{sqlite.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(id,loc,kind,ownerId,area,JSON.stringify(data),at);return saved(id);};
 const snapshot=()=>Object.fromEntries(['locations','records','command_receipts','audit_events'].map(table=>[table,sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(x=>({...x}))]));
 const deny=async(label,fn,status)=>{const before=snapshot(),result=await fn();assert.equal(result.status,status,JSON.stringify(result.data));assert.deepEqual(snapshot(),before);evidence.checks.push({action:label,expected:{status,noPartialWrites:true},actual:{...result,noPartialWrites:true}});return result;};
 return {sqlite,db,invoke,saved,seed,deny,snapshot};
}

test('28-day closing manager executes correction, physical review, linked work and independent checkout',async t=>{
 const realDate=globalThis.Date;let now='2026-10-08T18:00:00.000Z';globalThis.Date=class extends realDate{constructor(...values){super(...(values.length?values:[now]));}static now(){return realDate.parse(now);}};t.after(()=>{globalThis.Date=realDate;});
 const f=fixture(t);t.after(()=>{fs.mkdirSync('evidence/ai-multiweek/closing',{recursive:true});fs.writeFileSync('evidence/ai-multiweek/closing/manager.json',JSON.stringify(evidence,null,2)+'\n');});
 const call=f.invoke;
 const record=(day,action,expected,actual,proof)=>day.actions.push({action,expected,actual,source:proof});
 function setupDay(day,area,manager,closeMode='manager'){
  const date=new realDate(realDate.parse('2026-10-08T00:00:00.000Z')+(day-1)*86400000).toISOString().slice(0,10),start=date+'T20:00:00.000Z',end=new realDate(realDate.parse(start)+6*3600000).toISOString(),employee=area==='FOH'?'server':'cook',position=area==='FOH'?'Server':'Cook';now=start;
  const shift=f.seed('closing-shift-'+day,'shift',employee,area,{personId:employee,position,start,end,published:true,cancelled:false,history:[]},now);
  const leadership=f.seed('closing-leader-'+day,'leadership',manager,area,{personId:manager,area,start,end,active:true,note:'FICTIONAL explicitly assigned closing responsibility'},now);
  const standard=f.seed('closing-guide-'+day,'standard',manager,area,{title:'FICTIONAL '+area+' closing conditions day '+day,zone:'FICTIONAL assigned '+area+' area day '+day,position,criteria:['Assigned cleaning and side work are ready','Actual unsafe or missing condition reported'],source:'FICTIONAL tested conditions; not an approved restaurant SOP',version:1,status:'approved',validationNote:'FICTIONAL fixture approval only',verification:closeMode,history:[],guide:{purpose:'Practice independent closing checks',preparation:['Manager stops new seating; finish existing guest responsibilities'],steps:['Complete assigned cleaning and side work','Report conditions ready for independent physical check','Server waits for manual manager bank settlement and operational release'],troubleshooting:['Report incomplete work and follow the correction'],escalation:'Manager personally checks dining room, bathrooms and entrances; any actual money remains external.'}},now);
  return {date,start,end,employee,position,area,manager,shift,leadership,standard};
 }
 for(let day=1;day<=28;day++){
  const weekday=(day-1)%7+1;const area=weekday%2?'FOH':'BOH',manager=weekday%2||weekday===4?'gm-reviewed':'boh',s=setupDay(day,area,manager,weekday===1||weekday===4?'senior-then-manager':'manager');
  const d={day,week:Math.ceil(day/7),dayInWeek:weekday,businessDate:s.date,department:area,scenario:['Independent verifier and GM final check','Correction, helper, failed save and retry','Linked ordinary side work blocks release','Serious correction acknowledgment and physical recheck','No closing assignment still waits for manager checkout','Linked handoff acceptance requires actual recipient work and verification','Restaurant isolation, revoked authority and stale or duplicate requests'][weekday-1],actions:[]};evidence.days.push(d);
  let close=null,task=null;
  if(weekday!==5){
   const input={shiftId:s.shift.id,standardId:s.standard.id,managerId:s.manager,due:s.end,...(s.standard.data.verification==='senior-then-manager'?{verifierId:'first-'+area}:{})};
   if(weekday===1){
    const minimal=await f.deny('Minimal operating GM preset cannot become a closing confirmer by title',()=>call('owner','close.assign',{...input,managerId:'gm'}),400);
    evidence.checks.push({action:'Reviewed fictional GM closing setup is separate from base operating setup',expected:'Base preset remains tasks.manage + operations.store; optional gmClosingSetup is explicitly selected only for a fictional reviewed test membership.',actual:{basePreset:gmOperatingSetup(),reviewedFixture:gmClosingSetup(),minimalAttempt:minimal},proposal:'The optional closing proposal needs administrator review and explicit selection. It preserves independent participants and assigned leadership; this test never grants real permissions.'});
   }
   close=ok(await call('owner','close.assign',input));
   record(d,'Assign reviewed closing conditions and independent checkers',{phase:'open',noAutoCompletion:true},{id:close.recordId,phase:f.saved(close).data.phase,manager:s.manager,verification:s.standard.data.verification},source('app/shared/domain.ts',"case 'close.assign'"));
  }
  now=new realDate(realDate.parse(s.end)+30*60000).toISOString();
  const initialEmployee=ok(await call(s.employee));assert.equal(myWork(initialEmployee,now).checkoutPending,true);assert.equal(myWork(initialEmployee,now).shift.id,s.shift.id);
  record(d,'Scheduled end keeps operational checkout visible',{checkoutPending:true,scheduledEnd:s.end},{checkoutPending:myWork(initialEmployee,now).checkoutPending,shiftId:myWork(initialEmployee,now).shift.id},source('app/shared/my-work.ts','const pendingCheckout='));
  await f.deny('Day '+day+' employee cannot release own shift',()=>call(s.employee,'shift.release',{note:'Self release'},s.shift),403);
  await f.deny('Day '+day+' unassigned same-department manager cannot release',()=>call('other-'+area.toLowerCase(),'shift.release',{note:'Unassigned release'},s.shift),403);
  if(close){
   await f.deny('Day '+day+' release before closing check',()=>call(s.manager,'shift.release',{note:'Before physical review'},s.shift),400);
   close=ok(await call(s.employee,'close.transition',{step:'ready',answers:[0,1],note:'FICTIONAL assigned conditions reported ready'},close));
   await f.deny('Day '+day+' employee cannot self-confirm physical close',()=>call(s.employee,'close.transition',{step:'confirm',note:'Self confirmation'},close),403);
   await f.deny('Day '+day+' unnamed manager cannot final-confirm',()=>call('other-'+area.toLowerCase(),'close.transition',{step:'confirm',note:'Unassigned final check'},close),403);
   if(weekday===1||weekday===4){await f.deny('Day '+day+' GM/manager cannot skip independent first check',()=>call(s.manager,'close.transition',{step:'confirm',note:'Before verifier'},close),403);close=ok(await call('first-'+area,'close.transition',{step:'verify',note:'FICTIONAL independent first physical check passed'},close));}
   if(weekday===2||weekday===4){
    close=ok(await call(s.manager,'close.transition',{step:'fix',note:'FICTIONAL sanitizer container or cleaning condition missing',...(weekday===4?{managerAttention:'serious'}:{})},close));
    record(d,'Manager correction reopens required work',{phase:'correction',answers:[]},{phase:f.saved(close).data.phase,answers:f.saved(close).data.answers},source('app/shared/domain.ts',"else if(step==='fix')"));
    await f.deny('Day '+day+' correction cannot become release',()=>call(s.manager,'shift.release',{note:'Correction is still open'},s.shift),400);
    if(weekday===2){
     const stale=close;close=ok(await call(s.manager,'close.correction.assign',{personId:'helper-'+area,note:'FICTIONAL cleared helper completes missing condition; employee remains responsible'},close));
     await f.deny('Stale employee correction report cannot replace assigned helper',()=>call(s.employee,'close.transition',{step:'ready',answers:[0,1],note:'Old report'},stale),409);
     await f.deny('Original employee cannot submit helper assigned correction',()=>call(s.employee,'close.transition',{step:'ready',answers:[0,1],note:'Wrong performer'},close),403);
     f.sqlite.exec("CREATE TRIGGER closing_week_fail_receipt BEFORE INSERT ON command_receipts WHEN NEW.request_id='closing-correction-retry-"+day+"' BEGIN SELECT RAISE(ABORT,'fictional save failure'); END");
     const input={step:'ready',answers:[0,1],note:'FICTIONAL helper corrected condition and requests physical check'},original=close;
     await f.deny('Failed correction save leaves no partial phase, notice, audit or receipt',()=>call('helper-'+area,'close.transition',input,original,'closing-correction-retry-'+day),503);
     f.sqlite.exec('DROP TRIGGER closing_week_fail_receipt');close=ok(await call('helper-'+area,'close.transition',input,original,'closing-correction-retry-'+day));assert.deepEqual(ok(await call('helper-'+area,'close.transition',input,original,'closing-correction-retry-'+day)),close);
     record(d,'Safe retry saves helper readiness once',{phase:'manager-confirmation',owner:s.employee,performer:'helper-'+area},{phase:f.saved(close).data.phase,owner:f.saved(close).ownerId,performer:f.saved(close).data.correction.personId},source('app/shared/domain.ts',"case 'close.correction.assign'"));
    }else{
     close=ok(await call(s.manager,'close.acknowledge',{note:'FICTIONAL manager responds to serious issue and next action'},close));assert.equal(f.saved(close).data.phase,'correction');
     record(d,'Serious issue acknowledgment does not complete the cleaning or check',{phase:'correction'},{phase:f.saved(close).data.phase,acknowledgedBy:f.saved(close).data.attention.acknowledgment.by},source('app/shared/close-attention.ts','needsCloseAcknowledgment'));
     close=ok(await call(s.employee,'close.transition',{step:'ready',answers:[0,1],note:'FICTIONAL corrected and requests new check'},close));close=ok(await call('first-'+area,'close.transition',{step:'verify',note:'FICTIONAL repeat independent check passed'},close));
    }
   }
   const managerView=ok(await call(s.manager));assert.match(buildShiftBrief(managerView,now).items.find(i=>i.record.id===close.recordId).next,/final physical check/);
   close=ok(await call(s.manager,'close.transition',{step:'confirm',note:'FICTIONAL manager performed final physical check'},close));assert.equal(f.saved(close).data.phase,'closed');
   record(d,'Final physical confirmation completes close, not shift release',{closePhase:'closed',releasedAt:null},{closePhase:f.saved(close).data.phase,releasedAt:f.saved(s.shift).data.releasedAt??null},source('app/shared/domain.ts',"else if(step==='confirm')"));
  }
  if(weekday===3||weekday===6){
   task=ok(await call('owner','task.create',{ownerId:s.employee,kind:weekday===6?'handoff':'task',shiftId:s.shift.id,...(weekday===6?{incomingId:'incoming-'+area}:{}),title:'FICTIONAL linked '+(weekday===6?'unfinished closing work':'side work'),detail:'Assigned side work must finish and pass independent checks before manager release',due:s.end}));
   assert.equal(f.saved(task).data.shiftId,s.shift.id);
   await f.deny('Linked unfinished side work blocks release even after close is closed',()=>call(s.manager,'shift.release',{note:'Try to bypass linked work'},s.shift),400);
   task=ok(await call(s.employee,'task.transition',{step:'ready',note:'FICTIONAL linked work reported ready'},task));await f.deny('Reported linked readiness does not authorize release',()=>call(s.manager,'shift.release',{note:'Ready is not verified'},s.shift),400);
   task=ok(await call(s.manager,'task.transition',{step:'verify',note:'FICTIONAL physical task check passed'},task));
   if(weekday===6){
    assert.equal(f.saved(task).data.phase,'acceptance');await f.deny('Incoming handoff not yet accepted cannot release source shift',()=>call(s.manager,'shift.release',{note:'Before acceptance'},s.shift),400);
    const original=task,acceptInput={step:'accept',note:'FICTIONAL incoming employee accepts unfinished closing work'};task=ok(await call('incoming-'+area,'task.transition',acceptInput,original,'closing-incoming-accept-'+day));assert.deepEqual(ok(await call('incoming-'+area,'task.transition',acceptInput,original,'closing-incoming-accept-'+day)),task);
    assert.equal(f.saved(task).data.phase,'open');assert.equal(f.saved(task).ownerId,'incoming-'+area);
    await f.deny('Handoff receipt does not complete actual linked work or release original shift',()=>call(s.manager,'shift.release',{note:'Accepted is not complete'},s.shift),400);
    record(d,'Incoming receipt creates ongoing responsibility',{phase:'open',owner:'incoming-'+area,originalShift:s.shift.id},{phase:f.saved(task).data.phase,owner:f.saved(task).ownerId,shiftId:f.saved(task).data.shiftId,receipt:f.saved(task).data.closingHandoff},source('app/shared/domain.ts','closingHandoff'));
    await f.deny('Outgoing employee cannot submit incoming linked work',()=>call(s.employee,'task.transition',{step:'ready',note:'Wrong owner'},task),403);
    task=ok(await call('incoming-'+area,'task.transition',{step:'ready',note:'FICTIONAL actual accepted work completed'},task));task=ok(await call(s.manager,'task.transition',{step:'verify',note:'FICTIONAL independent manager checked recipient completed work'},task));
   }
   assert.equal(f.saved(task).data.phase,'closed');record(d,'Linked work actual result passes independent review',{phase:'closed'},{phase:f.saved(task).data.phase,shiftId:f.saved(task).data.shiftId},source('app/shared/domain.ts',"case 'task.transition'"));
  }
  if(weekday===5){
   const employeeView=ok(await call(s.employee)),managerView=ok(await call(s.manager));assert.equal(myWork(employeeView,now).checkoutPending,true);assert.ok(myWork(employeeView,now).duties.some(i=>i.record.id===s.shift.id&&/Waiting for manager checkout/.test(i.next)));assert.ok(buildShiftBrief(managerView,now).items.some(i=>i.record.id===s.shift.id&&/Confirm operational checkout/.test(i.next)));
   record(d,'No-close ended shift waits for independent manager release',{employeeWaiting:true,managerAction:true},{employeeWaiting:true,managerAction:true,savedCloseCount:0},source('app/shared/shift-brief.ts','Confirm operational checkout'));
  }
  if(weekday===7){
   await f.deny('Foreign restaurant cannot modify local closing records',()=>call('foreign','shift.release',{note:'Foreign'},s.shift,undefined,'a'),403);
   await f.deny('Same identity cannot submit restaurant A shift against restaurant B',()=>call(s.manager,'shift.release',{note:'Wrong restaurant'},s.shift,undefined,'b'),403);
   const capabilities=f.sqlite.prepare("SELECT capabilities FROM memberships WHERE id='gm-reviewed'").get().capabilities;f.sqlite.prepare("UPDATE memberships SET capabilities=?,revision=revision+1 WHERE id='gm-reviewed'").run(JSON.stringify(['tasks.manage','operations.store']));
    await f.deny('Revoked explicit GM closing capability blocks release',()=>call(s.manager,'shift.release',{note:'Revoked permission'},s.shift),404);f.sqlite.prepare("UPDATE memberships SET capabilities=?,revision=revision+1 WHERE id='gm-reviewed'").run(capabilities);
  }
  const beforeShift=f.saved(s.shift),releaseInput={note:'FICTIONAL actual manager checks completed; server bank handled manually outside JMAX; operational release only'},rid='closing-release-day-'+day;
  const released=ok(await call(s.manager,'shift.release',releaseInput,s.shift,rid));assert.deepEqual(ok(await call(s.manager,'shift.release',releaseInput,s.shift,rid)),released);
  await f.deny('Day '+day+' duplicate ID cannot alter release note',()=>call(s.manager,'shift.release',{note:'Changed duplicate'},s.shift,rid),409);
  await f.deny('Day '+day+' stale different release request cannot repeat release',()=>call(s.manager,'shift.release',releaseInput,s.shift),409);
  const after=f.saved(released);assert.ok(after.data.releasedAt);assert.equal(after.data.start,beforeShift.data.start);assert.equal(after.data.end,beforeShift.data.end);assert.equal(myWork(ok(await call(s.employee)),now).shift,undefined);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM records WHERE kind IN ('cash','bank','payroll','payment')").get().n,0);
  record(d,'Independent final checkout preserves work time and external bank boundary',{released:true,workTimesUnchanged:true,bankTransaction:false},{releasedAt:after.data.releasedAt,start:after.data.start,end:after.data.end,bankTransaction:false,bankProof:'Only fictional manual settlement note; no external verification'},source('app/shared/domain.ts',"case 'shift.release'"));
 }
 assert.equal(evidence.days.length,28);evidence.summary={completed:true,days:28,actions:evidence.days.reduce((n,d)=>n+d.actions.length,0),boundaryChecks:evidence.checks.length};
});
