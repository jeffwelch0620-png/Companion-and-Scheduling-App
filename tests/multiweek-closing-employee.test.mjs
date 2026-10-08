import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {buildShiftBrief} from '../.sites-runtime/shared/shift-brief.mjs';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
import {confirmedDutiesForLocation,confirmedDutySource} from '../.sites-runtime/shared/starter-tasks.mjs';

const roles=[
 {id:'cook',role:'Prep Cook',job:'Cook',station:'Prep',area:'BOH',loc:'berts'},
 {id:'host',role:'Host',job:'Host',station:'Host',area:'FOH',loc:'berts',duty:'host-shared'},
 {id:'pizza',role:'Pizza Make',job:'Cook',station:'Pizza Make',area:'BOH',loc:'rudds',duty:'pizza-make-close'},
 {id:'window',role:'Back Window',job:'Host',station:'Back Window',area:'FOH',loc:'berts',duty:'back-window-berts'},
 {id:'server',role:'Server',job:'Server',station:'Server',area:'FOH',loc:'rudds',duty:'server-shared'},
];
const stamp=(day,hour=20)=>new Date(Date.parse('2026-10-12T00:00:00.000Z')+(day-1)*86400000+hour*3600000).toISOString();
const ref=(path,needle)=>({path,line:fs.readFileSync(path,'utf8').split(/\r?\n/).findIndex(l=>l.includes(needle))+1});
function fixture(t,evidence){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async all(){return {results:sqlite.prepare(sql).all(...args),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){const r=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:Number(r.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};db.withSession=()=>db;
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
 const caps=['location.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','close.confirm','standards.approve','people.manage'];
 const members=[];
 for(const loc of ['berts','rudds']){
  sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional closing rehearsal '+loc,'America/New_York');
  for(const [id,permissions] of [['manager',caps],['wrong-manager',caps],['verifier',['location.manage','close.verify']]])members.push({id:id+'-'+loc,loc,area:'Executive',position:'Owner',caps:permissions,qualifications:[],jobs:['Owner']});
 }
 for(const role of roles)for(const id of [role.id,role.id+'-helper'])members.push({id,loc:role.loc,area:role.area,position:role.job,caps:[],qualifications:[role.job,role.station],jobs:[role.job]});
 for(const m of members)sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs) VALUES(?,?,?,?,?,?,?,?,?,?)').run(m.id,m.id+'@example.test',m.id,m.loc,'Fictional '+m.id,m.area,m.position,JSON.stringify(m.caps),JSON.stringify(m.qualifications),JSON.stringify(m.jobs));
 const headers=actor=>({'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test',Origin:'https://fictional.example','Content-Type':'application/json'});
 const call=async(actor,loc,action,input={},record,requestId=crypto.randomUUID())=>{const response=await handleWorkspace(new Request('https://fictional.example/api/workspace',{method:'POST',headers:headers(actor),body:JSON.stringify({locationId:loc,requestId,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})})}),db);evidence.totals.commands++;evidence.totals[response.status===200?'accepted':'rejected']++;return {status:response.status,data:await response.json()};};
 const view=async(actor,loc)=>{const response=await handleWorkspace(new Request('https://fictional.example/api/workspace?locationId='+loc,{headers:headers(actor)}),db);assert.equal(response.status,200,await response.clone().text());return response.json();};
 const fresh=r=>{const row=sqlite.prepare('SELECT * FROM records WHERE id=?').get(r.recordId??r.id);assert.ok(row);return {id:row.id,locationId:row.location_id,kind:row.kind,ownerId:row.owner_id,area:row.area,revision:row.revision,updatedAt:row.updated_at,data:JSON.parse(row.data)};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const command=async(actor,loc,action,input={},r)=>fresh(ok(await call(actor,loc,action,input,r)));
 const counts=()=>Object.fromEntries(['records','command_receipts','audit_events'].map(table=>[table,sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n]));
 return {db,sqlite,call,view,fresh,command,ok,counts};
}

test('closing employees: 28 days for Prep Cook, Host, Pizza, Back Window and Server using existing saved workflows',async t=>{
 const NativeDate=Date;let clock=stamp(1,15);globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return NativeDate.parse(clock);}};
 const evidence={scope:'Executed workspace handlers and employee projections in fictional in-memory SQLite; 28 days for five roles',source:confirmedDutySource,days:[],gaps:[],observations:[],limitations:['No live records, external APIs, model calls, physical inspection, bank settlement or payroll time edits.','Standards approved only in isolated test state. Prep Cook instructions and criteria are explicitly fictional; other role guide text reuses the confirmed role reference.','SQLite D1-compatible adapter exercises shared handlers; deployed Workers runtime and browser controls are not exercised.','Companion source presence is inspected without calling a model. Existing parked scope is recorded as a limitation when it lacks execution evidence.'],totals:{roleDays:0,commands:0,accepted:0,rejected:0}};
 const f=fixture(t,evidence);t.after(()=>{globalThis.Date=NativeDate;fs.mkdirSync('evidence/ai-multiweek/closing',{recursive:true});fs.writeFileSync('evidence/ai-multiweek/closing/employee.json',JSON.stringify(evidence,null,2)+'\n');});
 const standardInput=role=>{
  const duty=role.duty?confirmedDutiesForLocation(role.loc).find(d=>d.id===role.duty):null;
  assert.ok(!role.duty||duty);
  return {area:role.area,title:'Fictional '+role.role+' closing guide',zone:'Fictional '+role.station+' close',position:role.station,version:1,verification:'senior-then-manager',criteria:['Assigned area and equipment inspected against the approved instructions.','Remaining stock or work disclosed to the assigned checker.'],source:role.duty?'Confirmed role reference copied into isolated fictional approval; '+role.duty:'Fictional Prep Cook software-test checklist; no operating method inferred.',guide:{purpose:'Fictional closing rehearsal only.',preparation:['Open the current guide and identify the assigned checkers.'],steps:duty?[...duty.closing]:['Follow the locally approved Prep close; report missing instructions to the manager.'],troubleshooting:['Leave readiness open if required conditions are unmet.'],escalation:'Ask the assigned closing manager; a reported check does not release the employee.'}};
 };
 for(const role of roles){
  const manager='manager-'+role.loc;
  role.input=standardInput(role);role.guide=await f.command(manager,role.loc,'standard.save',role.input);role.guide=await f.command(manager,role.loc,'standard.approve',{validated:true,note:'Fictional software test approval only.'},role.guide);
  role.stationRecord=await f.command(manager,role.loc,'station.save',{title:role.station,area:role.area,status:'active',levels:[],independentLevel:null,note:'Fictional closing station mapping.',setup:{jobs:[role.job],allJobMembers:true,memberIds:[],standardIds:[role.guide.id],managerId:manager,goals:[]}});
 }
 const log=(d,role,action,expected,actual,proof)=>d.actions.push({role:role.role,action,expected,actual,proof,repro:`node --test tests/multiweek-closing-employee.test.mjs; day ${d.day}, ${role.role}: ${action}`});
 const step=(actor,role,close,name,extra={})=>f.command(actor,role.loc,'close.transition',{step:name,note:'Fictional '+name+' evidence.',...extra},f.fresh(close));
 const reject=async(actor,role,action,input,r,status)=>{const before=f.counts(),reply=await f.call(actor,role.loc,action,input,f.fresh(r));assert.equal(reply.status,status,JSON.stringify(reply));assert.deepEqual(f.counts(),before);return reply;};
 for(let day=1;day<=28;day++){
  const weekday=(day-1)%7+1;clock=stamp(day,16);const d={day,week:Math.ceil(day/7),dayInWeek:weekday,date:clock.slice(0,10),scenario:['incomplete checklist and ordered checks','returned correction','helper and manager attention','shift-linked task versus unrelated work','retired guide replacement','duplicate and stale submissions','checker access and final checkout'][weekday-1],actions:[]};evidence.days.push(d);
  for(const role of roles){
   const manager='manager-'+role.loc,verifier='verifier-'+role.loc,wrong='wrong-manager-'+role.loc;
   let shift=await f.command(manager,role.loc,'shift.save',{personId:role.id,position:role.job,stationId:role.stationRecord.id,start:stamp(day,18),end:stamp(day,22)});
   let close=await f.command(manager,role.loc,'close.assign',{shiftId:shift.id,standardId:role.guide.id,managerId:manager,verifierId:verifier,due:stamp(day,22)});
   shift=await f.command(manager,role.loc,'shift.publish',{},shift);clock=stamp(day);
   const w=await f.view(role.id,role.loc),work=myWork(w,clock),brief=buildShiftBrief(w,clock);
   assert.equal(work.shift.id,shift.id);assert.equal(work.station,role.station);assert.ok(work.guides.some(g=>g.id===role.guide.id));assert.ok(work.duties.some(i=>i.record.id===close.id));
   assert.ok(brief.items.some(i=>i.record.id===close.id&&i.lane==='action'));
   const generalClose=workforceContext(w,'What remains in my assigned close?',clock),selectedClose=workforceContext(w,'What remains in this assigned close?',clock,[],{id:shift.id,revision:shift.revision});
   const closeContext={general:generalClose.scope.some(s=>s.id===close.id),selected:selectedClose.scope.some(s=>s.id===close.id)};assert.equal(closeContext.general,true);assert.equal(closeContext.selected,true);
   log(d,role,'Open approved station guide and assigned close','Published underlying job resolves its exact station and approved guide; close explicitly assigned and available in narrow current Companion context.',{job:shift.data.position,station:work.station,guide:work.guides.map(g=>g.data.title),closePhase:close.data.phase,next:work.duties.find(i=>i.record.id===close.id).next,companionCloseSources:closeContext},ref('app/shared/domain.ts',"case 'close.assign'"));
   if(weekday===1){
    const missing=await reject(role.id,role,'close.transition',{step:'ready',answers:[0],note:'One condition incomplete.'},close,400);
    const duplicateAnswer=await reject(role.id,role,'close.transition',{step:'ready',answers:[0,0],note:'Duplicate answers cannot fill missing condition.'},close,400);
    const release=await reject(manager,role,'shift.release',{note:'Premature release.'},shift,400);
    log(d,role,'Keep incomplete checklist and checkout open','Missing/duplicate checklist answers and release before physical checks are rejected without writes.',{missingStatus:missing.status,duplicateAnswerStatus:duplicateAnswer.status,releaseStatus:release.status},ref('app/shared/domain.ts','Confirm every required condition'));
   }
   if(weekday===5){
    role.guide=await f.command(manager,role.loc,'standard.retire',{note:'Fictional changed source requires reviewed new version.'},role.guide);
    const old=await reject(role.id,role,'close.transition',{step:'ready',answers:[0,1],note:'Attempt with retired instructions.'},close,400);
    const pending=myWork(await f.view(role.id,role.loc),clock).duties.find(i=>i.record.id===close.id);assert.match(pending.reason,/no longer approved/);
    const replacement=await f.command(manager,role.loc,'standard.save',{...role.input,version:role.guide.data.version+1,basedOnId:role.guide.id,basedOnRevision:role.guide.revision});
    role.guide=await f.command(manager,role.loc,'standard.approve',{validated:true,note:'Fictional replacement reviewed.'},replacement);
    close=await f.command(manager,role.loc,'close.assign',{shiftId:shift.id,standardId:role.guide.id,managerId:manager,verifierId:verifier,due:stamp(day,22),note:'Explicit current-version replacement.'},close);
    assert.equal(close.data.standard.version,role.guide.data.version);
    log(d,role,'Replace retired instructions before readiness','Obsolete guide blocks reporting; employee sees warning; manager approves v2 and explicitly reassigns.',{retiredReadyStatus:old.status,warning:pending.reason,newVersion:close.data.standard.version},ref('app/shared/domain.ts','This standard was retired'));
   }
   let performer=role.id;
   if(weekday===2||weekday===3){
    close=await step(role.id,role,close,'ready',{answers:[0,1]});
    close=await step(verifier,role,close,'fix',weekday===3?{managerAttention:'repeated'}:{});assert.equal(close.data.phase,'correction');assert.deepEqual(close.data.answers,[]);
    if(weekday===3){
     const checkerHelper=await reject(manager,role,'close.correction.assign',{personId:verifier,note:'Checker cannot perform their own verification.'},close,400);
     close=await f.command(manager,role.loc,'close.correction.assign',{personId:role.id+'-helper',note:'Fictional cleared helper corrects assigned area.'},close);performer=role.id+'-helper';assert.equal(close.ownerId,role.id);
     const original=await reject(role.id,role,'close.transition',{step:'ready',answers:[0,1],note:'Owner cannot bypass current helper assignment.'},close,403);
     const helperWork=myWork(await f.view(performer,role.loc),clock);assert.ok(helperWork.duties.some(i=>i.record.id===close.id&&i.lane==='action'));
     log(d,role,'Manager assigns a qualified helper while employee retains responsibility','Checker cannot become performer; helper sees correction; original owner cannot submit for the helper.',{owner:close.ownerId,performer,checkerHelperStatus:checkerHelper.status,ownerReadyStatus:original.status,helperVisible:true},ref('app/shared/domain.ts',"case 'close.correction.assign'"));
    }
    log(d,role,'Return work for specific correction','Correction remains open with cleared answers and another physical check required.',{phase:close.data.phase,attention:close.data.attention?.reason??null,answers:close.data.answers},ref('app/shared/domain.ts',"else if(step==='fix')"));
   }
   if(weekday===6){
    const original=f.fresh(close),requestId='ready-'+day+'-'+role.id,input={step:'ready',answers:[0,1],note:'Fictional same report after uncertain save.'};
    const first=f.ok(await f.call(role.id,role.loc,'close.transition',input,original,requestId)),before=f.counts(),repeat=f.ok(await f.call(role.id,role.loc,'close.transition',input,original,requestId));assert.deepEqual(first,repeat);assert.deepEqual(f.counts(),before);
    const stale=await f.call(role.id,role.loc,'close.transition',{...input,note:'Extra outdated submission.'},original);assert.equal(stale.status,409);
    const changed=await f.call(role.id,role.loc,'close.transition',{...input,note:'Changed reused request.'},original,requestId);assert.equal(changed.status,409);close=f.fresh(first);
    log(d,role,'Retry exact submission and reject stale or changed duplicate','Exact receipt replay creates no writes; new stale revision or changed request content rejects.',{sameReceipt:JSON.stringify(first)===JSON.stringify(repeat),staleStatus:stale.status,changedRequestStatus:changed.status,phase:close.data.phase},ref('app/shared/service.ts','SELECT fingerprint, result FROM command_receipts'));
   }else close=await step(performer,role,close,'ready',{answers:[0,1]});
   assert.equal(close.data.phase,'verification');
   const earlyFinal=await reject(manager,role,'close.transition',{step:'confirm',note:'Cannot skip first independent check.'},close,403);
   const selfCheck=await reject(performer,role,'close.transition',{step:'verify',note:'Cannot verify own work.'},close,403);
   close=await step(verifier,role,close,'verify');assert.equal(close.data.phase,'manager-confirmation');
   const wrongManager=await reject(wrong,role,'close.transition',{step:'confirm',note:'Capability alone does not make assigned manager.'},close,403);
   if(weekday===3){
    const beforeAck=await reject(manager,role,'close.transition',{step:'confirm',note:'Flag remains unacknowledged.'},close,400);
    const wrongAck=await reject(wrong,role,'close.acknowledge',{note:'Not the assigned manager.'},close,403);
    close=await f.command(manager,role.loc,'close.acknowledge',{note:'Fictional repeated issue acknowledged; correction and actual checks still required.'},close);assert.equal(close.data.phase,'manager-confirmation');
    log(d,role,'Manager acknowledges flagged correction independently','Acknowledgment cannot replace correction, verifier check or manager final.',{beforeAcknowledgmentStatus:beforeAck.status,wrongManagerAcknowledgmentStatus:wrongAck.status,phaseAfterAcknowledgment:close.data.phase},ref('app/shared/close-attention.ts','export function needsCloseAcknowledgment'));
   }
   if(weekday===7){
    const permissions=f.sqlite.prepare('SELECT capabilities FROM memberships WHERE id=?').get(manager).capabilities;
    f.sqlite.prepare('UPDATE memberships SET capabilities=?,revision=revision+1 WHERE id=?').run('[]',manager);
    const denied=await f.call(manager,role.loc,'close.transition',{step:'confirm',note:'Capability revoked before final.'},close);assert.equal(denied.status,403);assert.equal(f.fresh(close).data.phase,'manager-confirmation');
    f.sqlite.prepare('UPDATE memberships SET capabilities=?,revision=revision+1 WHERE id=?').run(permissions,manager);
    log(d,role,'Refresh checker authority before final','Revoked closing capability cannot confirm; restoring fictional authority permits a fresh request.',{revokedFinalStatus:denied.status,phaseAfterDenied:f.fresh(close).data.phase},ref('app/shared/domain.ts','const isManager ='));
   }
   close=await step(manager,role,close,'confirm');assert.equal(close.data.phase,'closed');
   log(d,role,'Complete ordered independent physical checks','Performer readiness → designated verifier → assigned manager final; self, early and wrong-manager approval rejected.',{earlyManagerStatus:earlyFinal.status,selfVerifierStatus:selfCheck.status,wrongManagerStatus:wrongManager.status,finalPhase:close.data.phase,history:close.data.history.map(h=>h.action)},ref('app/shared/domain.ts',"else if(step==='confirm')"));
   let linked=null,unrelated=null;
   if(weekday===4){
    linked=await f.command(manager,role.loc,'task.create',{ownerId:role.id,kind:'task',shiftId:shift.id,title:'Fictional shift-linked remaining side work',detail:'Complete and request verification before this exact checkout.',due:stamp(day,22)});assert.equal(linked.data.shiftId,shift.id);
    unrelated=await f.command(manager,role.loc,'task.create',{ownerId:role.id,kind:'task',title:'Fictional unrelated future follow-up',detail:'Separate work with no checkout link.',due:stamp(day+1,21)});
    const open=await reject(manager,role,'shift.release',{note:'Linked task still open.'},shift,400);
    const employee=myWork(await f.view(role.id,role.loc),clock);assert.ok(employee.duties.some(i=>i.record.id===linked.id));
    const context=workforceContext(await f.view(role.id,role.loc),'What remains before checkout?',clock),selected=workforceContext(await f.view(role.id,role.loc),'What remains before checkout?',clock,[],{id:shift.id,revision:shift.revision}),legacy=companionContext(await f.view(role.id,role.loc),'What remains before checkout?',clock);
    const sourceStatus={general:context.scope.some(s=>s.id===linked.id),selected:selected.scope.some(s=>s.id===linked.id),legacy:legacy.scope.some(s=>s.id===linked.id)};assert.equal(sourceStatus.general,true);assert.equal(sourceStatus.selected,true);assert.equal(sourceStatus.legacy,true);
    if(!sourceStatus.general||!sourceStatus.selected)evidence.observations.push({role:role.role,day,category:'existing Companion scope limitation',detail:'Current My day has actual linked checkout work. Active Companion scope lacks some execution evidence; legacy context retains it.',actual:sourceStatus,source:ref('app/shared/workforce-context.ts',"const learning=")});
    linked=await f.command(role.id,role.loc,'task.transition',{step:'ready',note:'Fictional linked work ready for review.'},linked);
    const waiting=await reject(manager,role,'shift.release',{note:'Reported ready is not manager verified.'},shift,400);
    const self=await reject(role.id,role,'task.transition',{step:'verify',note:'Cannot verify own task.'},linked,403);
    linked=await f.command(manager,role.loc,'task.transition',{step:'fix',note:'Fictional manager found unfinished detail.'},linked);
    const correction=await reject(manager,role,'shift.release',{note:'Correction remains open.'},shift,400);
    linked=await f.command(role.id,role.loc,'task.transition',{step:'ready',note:'Fictional correction finished.'},linked);linked=await f.command(manager,role.loc,'task.transition',{step:'verify',note:'Fictional linked work checked.'},linked);assert.equal(linked.data.phase,'closed');
    log(d,role,'Keep exact shift-linked task in checkout through review and correction','Open, reported ready and returned correction each block release; distinct manager verification closes the task.',{shiftId:linked.data.shiftId,releaseStatuses:{open:open.status,verification:waiting.status,correction:correction.status},selfVerifyStatus:self.status,finalTask:linked.data.phase,companionSourceCoverage:sourceStatus},ref('app/shared/domain.ts',"case 'shift.release'"));
   }
   clock=stamp(day,22);shift=await f.command(manager,role.loc,'shift.release',{note:'Fictional manager final operational checkout; actual payroll time is unchanged.'},f.fresh(shift));assert.ok(shift.data.releasedAt);
   if(unrelated){assert.equal(f.fresh(unrelated).data.phase,'open');assert.equal('shiftId'in f.fresh(unrelated).data,false);log(d,role,'Release without blocking on unrelated future work','Only explicitly linked unfinished checkout work blocks this shift.',{releasedAt:shift.data.releasedAt,unrelatedTaskPhase:f.fresh(unrelated).data.phase,unrelatedHasShiftLink:false},ref('app/shared/domain.ts',"case 'shift.release'"));}
   const after=myWork(await f.view(role.id,role.loc),clock);assert.equal(after.duties.some(i=>i.record.id===close.id),false);assert.equal(after.shift?.id===shift.id,false);
   log(d,role,'Manager releases employee and closed responsibilities leave active view','Operational checkout saved once after required checks; finished close no longer presented as pending.',{releasedAt:shift.data.releasedAt,closedCloseStillPending:false,shiftFields:Object.keys(shift.data)},ref('app/shared/my-work.ts','const pendingCheckout='));
   evidence.totals.roleDays++;
  }
 }
 assert.equal(evidence.days.length,28);assert.equal(evidence.totals.roleDays,140);
 evidence.totals.persisted=f.counts();evidence.totals.closedAssignments=f.sqlite.prepare("SELECT count(*) AS n FROM records WHERE kind='close' AND json_extract(data,'$.phase')='closed'").get().n;assert.equal(evidence.totals.closedAssignments,140);
 evidence.totals.releasedShifts=f.sqlite.prepare("SELECT count(*) AS n FROM records WHERE kind='shift' AND json_extract(data,'$.releasedAt') IS NOT NULL").get().n;assert.equal(evidence.totals.releasedShifts,140);
 evidence.observations.push({category:'physical proof boundary',detail:'Checklist, verifier and manager submissions prove recorded workflow only; no real physical check, server bank settlement or payroll time alteration was verified.',source:ref('app/shared/domain.ts',"case 'shift.release'")});
});
