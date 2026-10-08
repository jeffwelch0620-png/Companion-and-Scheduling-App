import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';

const RealDate=Date,root=path.resolve('evidence/randomized-ordering');fs.mkdirSync(root,{recursive:true});
const seeds={berts:198673,rudds:774119,papa:942017};
const random=seed=>()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
for(const restaurant of ['berts','rudds','papa'])test(restaurant+' seeded ordering and durable linked checkout stress',async()=>{
 const seed=seeds[restaurant],rng=random(seed),file=path.join(root,restaurant+'-'+Date.now()+'.sqlite');let store=openPositionDatabase(file);
 const events=[],receipts=[],revisions=[],start=RealDate.now();let now=start,shift,close,leadership,current,unlinked,standard,reopens=0,cycle=0,acceptedEvents=0,rejectedEvents=0,duplicateEvents=0;
 const position=restaurant==='papa'?'Counter':'Server';
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const request=(actor,body,loc=restaurant)=>new Request('https://random-order.example/api/workspace?locationId='+loc,{headers:{'oai-authenticated-user-id':restaurant+'-'+actor+'-identity','oai-authenticated-user-email':restaurant+'-'+actor+'@example.test',Origin:'https://random-order.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const find=id=>{const row=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return row&&{...row,ownerId:row.owner_id,data:JSON.parse(row.data)};};
 const state=()=>JSON.stringify(Object.fromEntries(['locations','records','command_receipts','audit_events'].map(table=>[table,store.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 const reference=r=>({recordId:r.recordId??r.id,expectedRevision:r.revision});
 const invariant=()=>{
  const rows=store.sqlite.prepare("SELECT * FROM records WHERE kind IN ('task','close','shift')").all();
  for(const row of rows){const data=JSON.parse(row.data);assert.ok(row.owner_id,'Every work record has an explicit current owner');
   if(row.kind==='task'&&data.shiftId&&data.kind==='handoff'){
    const accepts=data.history.filter(h=>h.action==='accepted');assert.ok(accepts.length<=1,'No duplicate incoming acceptance');
    if(data.closingHandoff){assert.equal(data.closingHandoff.acceptedBy,row.owner_id);assert.equal(accepts.length,1);}
    if(data.phase==='closed'){assert.ok(data.closingHandoff,'Required linked handoff cannot complete before incoming acceptance');const acceptedAt=data.history.findIndex(h=>h.action==='accepted'),verifiedAt=data.history.findLastIndex(h=>h.action==='verify');assert.ok(verifiedAt>acceptedAt,'Remaining received work requires a new independent check after receipt');assert.notEqual(data.history[verifiedAt].actorId,row.owner_id);}
   }
   if(row.kind==='close'&&data.phase==='closed'){const lastConfirm=data.history.findLast(h=>h.action==='confirm'),lastVerify=data.history.findLast(h=>h.action==='verify');assert.ok(lastConfirm&&lastVerify);assert.notEqual(lastConfirm.actorId,row.owner_id);assert.notEqual(lastVerify.actorId,row.owner_id);assert.notEqual(lastConfirm.actorId,lastVerify.actorId);}
   if(row.kind==='shift'&&data.releasedAt){const pending=rows.filter(r=>r.kind==='task'&&JSON.parse(r.data).shiftId===row.id&&JSON.parse(r.data).phase!=='closed');assert.deepEqual(pending,[]);assert.ok(rows.filter(r=>r.kind==='close'&&JSON.parse(r.data).shiftId===row.id).every(r=>JSON.parse(r.data).phase==='closed'));}
  }
  const duplicates=store.sqlite.prepare('SELECT actor_id,request_id,count(*) n FROM command_receipts GROUP BY actor_id,request_id HAVING count(*)>1').all();assert.deepEqual(duplicates,[]);
 };
 const execute=async(actor,action,input={},record,options={})=>{
  const body=options.body??{locationId:restaurant,requestId:crypto.randomUUID(),action,input,...(record?reference(record):{})},before=state();
  const result=await handleWorkspace(request(actor,body,options.location??restaurant),store.db),data=await result.json();
  if(options.expect!==undefined)assert.equal(result.status,options.expect,JSON.stringify(data));
  if(result.status===200){if(options.duplicate){assert.equal(state(),before,'Exact retry must not write again');duplicateEvents++;}else{acceptedEvents++;receipts.push({actor,body,result:data});}}else{assert.ok([400,403,404,409].includes(result.status),JSON.stringify(data));assert.equal(state(),before,'Rejected command must not change any operational state');rejectedEvents++;}
  events.push({number:events.length+1,clock:new Date().toISOString(),actor,action,step:body.input?.step,status:result.status,duplicate:!!options.duplicate,recordId:body.recordId??data.recordId,error:data.error});
  invariant();if(record)revisions.push({actor,body:structuredClone(body)});
  const persisted=state();store.close();store=openPositionDatabase(file);reopens++;assert.equal(state(),persisted,'Every interaction survives a durable reopen');invariant();
  return result.status===200?data:undefined;
 };
 const cmd=(actor,action,input,record)=>execute(actor,action,input,record,{expect:200});
 const latest=r=>find(r.recordId??r.id);
 const transition=(actor,r,step)=>execute(actor,r.kind==='close'?'close.transition':'task.transition',{step,note:'Fictional seeded event: '+step,answers:[0,1]},r);
 const newLinked=async()=>{cycle++;current=await cmd('manager','task.create',{ownerId:'worker',incomingId:'incoming',kind:'handoff',shiftId:shift.recordId,title:'Required linked unfinished work '+cycle,detail:'Fictional QA: incoming acceptance transfers unfinished work; independent check remains required.',due:new Date(start+7*3600000).toISOString()});};
 try{
  for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
  for(const loc of ['berts','rudds','papa'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');
  for(const [actor,role,caps] of [['manager','General manager',['location.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','close.confirm','standards.approve']],['lead','FOH Manager',['tasks.manage','close.confirm','schedule.change']],['senior','Shift lead',['close.verify']],['worker',position,[]],['incoming',position,[]],['alternate',position,[]]])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(actor,restaurant+'-'+actor+'@example.test',restaurant+'-'+actor+'-identity',restaurant,'Fictional '+actor,'FOH',role,JSON.stringify(caps),JSON.stringify([position]));
  shift=await cmd('manager','shift.save',{personId:'worker',position,start:new Date(start-3600000).toISOString(),end:new Date(start+8*3600000).toISOString()});shift=await cmd('manager','shift.publish',{},shift);
  leadership=await cmd('manager','leadership.assign',{personId:'lead',area:'FOH',start:new Date(start-3600000).toISOString(),end:new Date(start+9*3600000).toISOString(),note:'Fictional named independent closing lead.'});
  standard=await cmd('manager','standard.save',{title:'Fictional randomized checkout reference',position,zone:'Random-order QA station',version:1,criteria:['Reported station condition restored.','Required unfinished work remains assigned until received and checked.'],source:'Fictional test reference exercising existing generic handler rules, not a production SOP.',verification:'senior-then-manager'});standard=await cmd('manager','standard.approve',{validated:true,note:'Fictional QA-only reference reviewed.'},standard);
  close=await cmd('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'lead',verifierId:'senior',due:new Date(start+7*3600000).toISOString()});
  const blocker=await cmd('manager','task.create',{ownerId:'worker',kind:'task',shiftId:shift.recordId,title:'Final required operational checkout',detail:'Keep published source shift open while randomized work is exercised.',due:new Date(start+7*3600000).toISOString()});
  unlinked=await cmd('manager','task.create',{ownerId:'worker',kind:'issue',title:'Supported responsibility reassignment',detail:'Fictional unrelated task for same-department reassignment.',due:new Date(start+7*3600000).toISOString()});await newLinked();
  for(let n=0;n<130;n++){
   now=start+n*2*60000;const task=latest(current),closing=latest(close),pick=rng();
   if(n===30){
    // Reach a genuinely confirmable phase before revocation so a premature
    // phase guard cannot explain the subsequent authority rejection.
    let prepared=latest(close);if(['open','correction'].includes(prepared.data.phase)){await transition('worker',prepared,'ready');prepared=latest(close);}if(prepared.data.phase==='verification'){await transition('senior',prepared,'verify');prepared=latest(close);}assert.equal(prepared.data.phase,'manager-confirmation');
    leadership=await cmd('manager','leadership.revoke',{note:'Named lead temporarily unavailable; existing checkout must not bypass independent authority.'},latest(leadership));await execute('lead','close.transition',{step:'confirm',note:'Revoked leader must not finalize a currently confirmable checkout.'},prepared,{expect:403});close=await cmd('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',verifierId:'senior',due:new Date(start+7*3600000).toISOString(),note:'Current GM explicitly assumes pending independent final check.'},prepared);continue;
   }
   if(n%17===0&&receipts.length){const previous=receipts[Math.floor(rng()*receipts.length)];await execute(previous.actor,previous.body.action,{},undefined,{body:previous.body,expect:200,duplicate:true});continue;}
   if(n%13===0&&revisions.length){const stale=revisions[Math.floor(rng()*revisions.length)],r=find(stale.body.recordId);if(r&&r.revision>stale.body.expectedRevision){await execute(stale.actor,stale.body.action,{},undefined,{body:{...stale.body,requestId:crypto.randomUUID()}});assert.ok([404,409].includes(events.at(-1).status),'A stale instruction either conflicts or becomes unreadable after responsibility changes');continue;}}
   if(n%19===0){unlinked=await cmd('manager','task.reassign',{ownerId:latest(unlinked).ownerId==='worker'?'alternate':'worker',note:'Explicit current owner replacement; unfinished work resets to open.'},latest(unlinked));continue;}
   if(n%11===0){await execute('worker','shift.release',{note:'Worker must not self-release.'},latest(shift),{expect:403});continue;}
   if(n%7===0){await execute('manager','shift.release',{note:'Outstanding source tasks block departure even after any receipt.'},latest(shift),{expect:400});continue;}
   if(n%9===0||pick>.86){
    if(closing.data.phase==='closed'){await execute('worker','close.transition',{step:'confirm',note:'Worker cannot self-check the completed close.'},closing,{expect:403});continue;}
    if(closing.data.phase==='open'||closing.data.phase==='correction')await transition('worker',closing,'ready');
    else if(closing.data.phase==='verification')await transition('senior',closing,rng()<.35?'fix':'verify');
    else if(n<85)await transition(closing.data.managerId,closing,'fix');
    else await transition(closing.data.managerId,closing,'confirm');
    continue;
   }
   if(task.data.phase==='closed'){await newLinked();continue;}
   if(pick<.18){await execute(task.ownerId,'task.transition',{step:'verify',note:'Self-verification is never an independent check.'},task,{expect:403});continue;}
   if(pick<.30){await execute('alternate','task.transition',{step:'accept',note:'Only explicitly named incoming person can accept.'},task,{expect:404});continue;}
   if(task.data.phase==='open'||task.data.phase==='correction')await transition(task.ownerId,task,'ready');
   else if(task.data.phase==='verification')await transition('manager',task,rng()<.23?'fix':'verify');
   else if(task.data.phase==='acceptance'){
    if(rng()<.22)await transition(task.ownerId,task,'verify');
    else await transition('incoming',task,rng()<.35?'dispute':'accept');
   }
  }
  // Finish the same persisted state through supported actions, without reseeding.
  for(let n=0;n<15&&latest(current).data.phase!=='closed';n++){const r=latest(current);await transition(r.data.phase==='acceptance'?'incoming':r.data.phase==='verification'?'manager':r.ownerId,r,r.data.phase==='acceptance'?'accept':r.data.phase==='verification'?'verify':'ready');}
  await execute('manager','task.transition',{step:'verify',note:'A manager must not apply an old pre-receipt revision.'},current,{expect:409});
  for(let n=0;n<8&&latest(close).data.phase!=='closed';n++){const r=latest(close);await transition(r.data.phase==='verification'?'senior':r.data.phase==='manager-confirmation'?r.data.managerId:'worker',r,r.data.phase==='verification'?'verify':r.data.phase==='manager-confirmation'?'confirm':'ready');}
  await transition('worker',latest(blocker),'ready');await transition('manager',latest(blocker),'verify');shift=await cmd('manager','shift.release',{note:'Only release after all linked remaining work and the two independent closing checks are saved.'},latest(shift));assert.ok(latest(shift).data.releasedAt);invariant();
  assert.ok(events.length>=100&&events.length<=200);assert.ok(events.some(e=>e.action==='task.reassign'));assert.ok(events.some(e=>e.action==='leadership.revoke'));assert.ok(duplicateEvents>0);assert.ok(rejectedEvents>15);assert.ok(acceptedEvents>30);assert.ok(events.some(e=>e.action==='task.transition'&&e.status===409));
  for(const foreign of ['berts','rudds','papa'].filter(loc=>loc!==restaurant))await execute('manager','message.send',{recipients:['worker'],title:'Cross-store forbidden',body:'No other restaurant access granted.'},undefined,{location:foreign,body:{locationId:foreign,requestId:crypto.randomUUID(),action:'message.send',input:{recipients:['worker'],title:'Cross-store forbidden',body:'No other restaurant access granted.'}},expect:403});
  const report={status:'passed',restaurant,position,seed,eventCount:events.length,acceptedEvents,rejectedEvents,duplicateEvents,durableReopens:reopens,linkedHandoffCycles:cycle,operationalReseeds:0,externalCalls:0,events,database:file,invariantChecks:events.length*2,runtimeHash:createHash('sha256').update(fs.readFileSync('.sites-runtime/shared/domain.mjs')).digest('hex'),limits:['Seeded bounded event ordering covers supported generic linked handoff and closing handlers; it is not exhaustive or physical work.','Dedicated Dish PM replacement remains unsupported and is not asserted as successful.','No live AI, recipe fetch, Toast, payroll, guest communication or production data mutation.']};fs.writeFileSync(path.join(root,restaurant+'-results.json'),JSON.stringify(report,null,2));
 }catch(error){fs.writeFileSync(path.join(root,restaurant+'-results.json'),JSON.stringify({status:'failed',restaurant,seed,events,error:String(error.stack??error),database:file,externalCalls:0},null,2));throw error;}finally{globalThis.Date=RealDate;store.close();}
});
