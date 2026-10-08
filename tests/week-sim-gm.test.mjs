import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
import {handleOperationsHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {prepProgress} from '../.sites-runtime/shared/prep-progress.mjs';
import {gmOperatingSetup} from '../.sites-runtime/shared/gm-operating-setup.mjs';
import {localDate,nextDate} from '../.sites-runtime/shared/local-time.mjs';

// Actual current request handlers, disposable D1, fictional identities, controlled
// application clock. This does not use or mutate a preview, credentials or APIs.
process.env.MINIFLARE_REGISTRY_PATH=path.resolve('.wrangler/week-sim-gm-registry');
const evidence={role:'General Manager',schema:'jmax-week-simulation.v1',fictional:true,days:[],gaps:[],checks:[],limitations:['Handler-level execution with isolated local D1; no browser or rendered UI inspection.','Fixture membership and fictional Food catalog are inserted locally; real setup-code redemption, Toast, payroll, ordering and external messages are not exercised.','Narrative staffing/cuts/guest alerts/closing inspection are recorded evidence; this test cannot establish that physical work or conversations occurred.','Application Date is controlled during handler execution; the local D1 emulator retains its own real infrastructure clock.']};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
function gap(id,expected,actual,source,repro){if(!evidence.gaps.some(g=>g.id===id))evidence.gaps.push({id,expected,actual,source,repro,proof:'executed current request handler'});}

test('GM seven-day isolated operational simulation and authority probes',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fictional GM week")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});
 const db=await mf.getD1Database('DB');
 t.after(async()=>{fs.mkdirSync('evidence/week-simulation',{recursive:true});fs.writeFileSync('evidence/week-simulation/gm.json',JSON.stringify(evidence,null,2)+'\n');await mf.dispose();});
 for(const file of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const location of ['a','papa','foreign'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Fictional '+location,'America/New_York').run();
 const roster=[['owner','Executive','Owner',['location.manage','tasks.manage','schedule.manage','schedule.publish']],['gm','Executive','General manager',gmOperatingSetup().capabilities],['foh','FOH','FOH manager',['tasks.manage']],['boh','BOH','BOH manager',['tasks.manage']],['cook','BOH','Cook',[]],['server','FOH','Server',[]],['scheduler','FOH','Scheduling manager',['schedule.manage','schedule.publish','tasks.manage']]];
 for(const [id,area,position,caps] of [...roster,['papa-gm','Executive','General manager',gmOperatingSetup().capabilities]])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(id,id+'@example.test',id+'-identity',id==='papa-gm'?'papa':'a','Fictional '+id,area,position,JSON.stringify(caps),JSON.stringify([position])).run();
 const RealDate=globalThis.Date;let clock='2026-10-01T16:00:00.000Z';
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
 t.after(()=>{globalThis.Date=RealDate;});
 const setClock=value=>{clock=value;};
 const headers=actor=>({'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'});
 const request=async(actor,url,body)=>{const handler=url.startsWith('/api/access')?handleAccess:url.startsWith('/api/operations/handoff')?handleOperationsHandoff:url.startsWith('/api/food/assigned-prep')?handleEmployeePrep:url.startsWith('/api/food/workflows')?handleFoodWorkflows:url.startsWith('/api/food')?handleFood:handleWorkspace;const r=await handler(new Request('http://localhost'+url,{headers:headers(actor),...(body?{method:'POST',body:JSON.stringify(body)}:{})}),db);return {status:r.status,data:await r.json()};};
 const command=(actor,url,action,input={},record,requestId=crypto.randomUUID(),locationId='a')=>request(actor,url,{requestId,locationId,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})});
 const work=(actor,action,input={},record,rid,loc)=>command(actor,'/api/workspace',action,input,record,rid,loc);
 const prep=(action,input={},record,actor='gm',rid)=>command(actor,'/api/food/workflows',action,{dataset:'demo',...input},record,rid);
 const snapshot=async()=>Object.fromEntries(await Promise.all(['records','command_receipts','audit_events','food_records','food_workflows','food_workflow_events','food_receipts'].map(async table=>[table,(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results])));
 const denied=async(label,fn,status)=>{const before=await snapshot(),r=await fn();assert.equal(r.status,status,JSON.stringify(r.data));assert.deepEqual(await snapshot(),before);evidence.checks.push({action:label,expected:{status,noPartialWrites:true},actual:{...r,noPartialWrites:true}});return r;};
 const item=ok(await command('owner','/api/food','fooditem.import',{dataset:'demo',sourceRestaurantId:'fictional-source',sourceLabel:'Fictional week only',destinationLocationId:'a',confirmed:true,rows:[{restaurantId:'fictional-source',name:'Fictional dressing cups',controlNumber:'CUPS',purchaseUnit:'cup',packCount:1,unitQty:1,unitUOM:'each',portionSize:1,portionUOM:'each',par:10,active:true,countActive:true,needsReview:false,vendorSkus:[]}]}));
 const definition=ok(await prep('definition.save',{foodRecordId:item.recordId,foodRevision:item.revision,track:'daily',countUnit:'cup',par:10,confirmed:true,reviewNote:'Fictional reviewed count unit'}));
 let unresolved,coaching,firstCount,firstPlan;
 for(let day=1;day<=7;day++){
  const date='2026-10-'+String(day).padStart(2,'0');setClock(date+'T16:00:00.000Z');
  const d={day,businessDate:date,actions:[]};evidence.days.push(d);
  const add=(action,expected,actual)=>d.actions.push({action,expected,actual});
  const opening=ok(await request('gm','/api/operations/handoff?locationId=a&date='+date));
  if(day>1){assert.ok(opening.opening_carried_issue_ids.includes(unresolved.recordId));assert.equal(opening.previous_handoffs.length,2);}
  add('Opening reads both departments, previous submitted close and unresolved Red Book responsibility',{departments:['FOH','BOH'],carryover:day>1},{previous:opening.previous_handoffs.map(x=>({department:x.department,date:x.business_date})),carried:opening.opening_carried_issue_ids});
  if(day===1){
   unresolved=ok(await work('gm','managerlog.create',{department:'BOH',ownerId:'gm',title:'Missing cooler gasket; GM owns follow-up',detail:'BOH manager absent; GM coordinates staffing, readiness and urgent prep. Repair remains unresolved until physical inspection.',category:'Maintenance',priority:'urgent',due:'2026-10-07T22:00:00-04:00'}));
   unresolved=ok(await work('gm','managerlog.accept',{note:'GM explicitly accepts BOH follow-through'},unresolved));
  }
  unresolved=ok(await work('gm','managerlog.note',{note:'Day '+day+': checked with both departments; gasket remains unresolved, inspect before next opening.'},unresolved));
  add('GM maintains unresolved BOH responsibility',{status:'accepted',owner:'gm'},{recordId:unresolved.recordId,revision:unresolved.revision});
  if(day===2){coaching=ok(await work('boh','managerlog.create',{department:'BOH',ownerId:'boh',title:'Cook misses reviewed prep sequence',detail:'BOH initial coaching documented. Repeat issue requires GM review.',category:'Food and prep',priority:'routine',due:date+'T22:00:00-04:00'}));coaching=ok(await work('boh','managerlog.reassign',{ownerId:'gm',note:'Repeated after initial BOH coaching; GM escalation',due:'2026-10-05T22:00:00-04:00'},coaching));coaching=ok(await work('gm','managerlog.accept',{note:'GM will observe next preparation'},coaching));add('Initial BOH coaching escalates responsibility to GM',{owner:'gm',accepted:true},{recordId:coaching.recordId,revision:coaching.revision});}
  if(day===5&&coaching){coaching=ok(await work('gm','managerlog.resolve',{note:'GM observed correct prep sequence and BOH confirmed follow-through'},coaching));add('GM resolves escalated issue with outcome',{status:'resolved'},{recordId:coaching.recordId,revision:coaching.revision});}
  for(const [employee,manager,area] of [['cook','boh','BOH'],['server','foh','FOH']]){
   const taskInput={ownerId:employee,kind:'task',title:'Day '+day+' '+area+' readiness',detail:area==='BOH'?'Verify urgent prep and equipment readiness':'Coordinate host/server alerts; simple table visits; report prolonged Expo staffing need',due:date+'T19:00:00-04:00'};
   const gmAssignment=await work('gm','task.create',taskInput);
   add('GM assigns '+area+' readiness work',{status:200},gmAssignment);
   if(gmAssignment.status!==200)gap('gm-cross-department-tasks','Explicit whole-store GM can assign and verify ordinary FOH/BOH operational tasks',{assignment:gmAssignment},[{file:'app/shared/domain.ts',line:1317},{file:'app/shared/domain.ts',line:109},{file:'app/shared/types.ts',line:57}],'Executive GM with tasks.manage + operations.store POST task.create ownerId=cook or server.');
   let task=ok(gmAssignment.status===200?gmAssignment:await work(manager,'task.create',taskInput));
   assert.equal((await work(manager,'task.transition',{step:'verify',note:'Premature approval'},task)).status,400);
   task=ok(await work(employee,'task.transition',{step:'ready',note:'Fictional readiness evidence reported'},task));
   const gmVerify=await work('gm','task.transition',{step:'verify',note:'GM checked evidence'},task);
   if(gmVerify.status!==200){const g=evidence.gaps.find(x=>x.id==='gm-cross-department-tasks');g.actual.verification=gmVerify;}
   task=ok(gmVerify.status===200?gmVerify:await work(manager,'task.transition',{step:'verify',note:'Department manager verified reported readiness'},task));
   add(area+' readiness respects employee submission before manager verification',{phase:'closed'},{recordId:task.recordId,gmVerification:gmVerify,status:'closed'});
  }
  const quantity=day===1?0:day===3?2:day===6?10:4;
  let count=ok(await prep('count.create',{track:'daily',businessDate:date}));
  count=ok(await prep('count.save',{lines:[{definitionId:definition.recordId,quantity,note:'Fictional physically observed count'}]},count));
  count=ok(await prep('count.submit',{confirmed:true},count));
  let plan=ok(await prep('plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:nextDate(date,1)}));
  const releaseRequest='gm-release-day-'+day,priorPlan=plan;
  plan=ok(await prep('plan.release',{confirmed:true},plan,'gm',releaseRequest));
  assert.deepEqual(ok(await prep('plan.release',{confirmed:true},priorPlan,'gm',releaseRequest)),plan);
  const detail=async r=>ok(await request('gm','/api/food/workflows?locationId=a&dataset=demo&recordId='+r.recordId));
  const planned=10-quantity;
  if(planned>0){plan=ok(await prep('plan.assign',{definitionId:definition.recordId,assignedTo:'cook'},plan));const employee=ok(await request('cook','/api/food/assigned-prep?locationId=a&dataset=demo'));assert.ok(employee.items.some(i=>i.planId===plan.recordId));plan=ok(await prep('plan.employee-complete',{definitionId:definition.recordId,quantity:day===3?planned-2:planned,note:day===3?'Short dressing supply: GM alerted; Toast markout must be independently confirmed':'Target completed',confirmed:true},plan,'cook'));}
  const pd=await detail(plan);assert.equal(pd.record.status,'completed');
  const pages=ok(await request('gm','/api/food/workflows?locationId=a&dataset=demo'));
  const progress=prepProgress(pages.plans,'a','demo');
  add('Daily count, plan release retry, assigned prep and actual completion',{plannedQty:planned,status:'completed',zeroIsValid:true},{countId:count.recordId,planId:plan.recordId,plannedQty:pd.record.lines[0].plannedQty,completedQty:pd.record.lines[0].completedQty,status:pd.record.status,remainingExceptions:progress.map(p=>({id:p.id,shortages:p.shortages}))});
  if(day===1){firstCount=count;firstPlan=plan;}
  if(day===3)add('Shortage remains manager exception; Toast markout requires separate source confirmation',{shortage:2,toastMutation:false},{shortage:progress.some(p=>p.shortages.length>0),toastIntegrationExecuted:false});
  if(day===4){const late=ok(await prep('plan.generate',{countId:firstCount.recordId,countRevision:firstCount.revision,targetDate:'2026-10-15'}));await denied('Old unchanged count cannot release despite future target',()=>prep('plan.release',{confirmed:true},late),409);}
  for(const area of ['FOH','BOH']){
   let entry=ok(await work('gm','shiftentry.save',{businessDate:date,department:area,shift:'closing',summary:area==='FOH'?'Daily sales/labor plan reviewed; shift manager makes cuts. Support staff released first when duties covered, servers normally last. Host stops new seating, finishes existing tables, then sidework and bank checked by manager.':'GM covers absent BOH manager, coordinates service and urgent prep; shortage followed up without claiming a Toast mutation.',tomorrowNote:'GM personally walked dining room, bathrooms and entrances. Cooler gasket requires next opening follow-up.',readiness:'action-needed',issueIds:area==='BOH'?[unresolved.recordId]:[]}));
   const draft=ok(await request('gm','/api/operations/handoff?locationId=a&date='+date+'&department='+area));assert.equal(draft.shift_entries[0].record_state,'draft');
   entry=ok(await work('gm','shiftentry.submit',{},entry));
   const submitted=ok(await request('gm','/api/operations/handoff?locationId=a&date='+date+'&department='+area));assert.equal(submitted.shift_entries[0].record_state,'submitted');
   add(area+' close submission and next-day carryover',{draftThenSubmitted:true},{recordId:entry.recordId,record_state:submitted.shift_entries[0].record_state,tomorrow_note:submitted.shift_entries[0].tomorrow_note});
  }
 }
 const historical=ok(await request('gm','/api/operations/handoff?locationId=a&date=2026-09-30'));
 if(historical.issues.some(i=>i.id===unresolved.recordId)){
  gap('dated-handoff-current-issues-contract','Consumers of a dated handoff need a clear distinction between historical opening evidence and the current open-issue list',{requested:'2026-09-30',futureCreatedIssue:historical.issues.find(i=>i.id===unresolved.recordId),qualifiedFinding:'The payload explicitly uses current_status; this is mixed-date context ambiguity, not a proven historical-snapshot bug.'},[{file:'app/shared/operations-handoff.ts',line:22}],'After creating an unresolved issue on Oct 1, GET handoff date=2026-09-30 includes that Oct 1 issue in issues with current_status. opening_carried_issue_ids stays historical. Clarify the source contract before consumers treat all issues as opening-as-of facts.');
  evidence.gaps.find(g=>g.id==='dated-handoff-current-issues-contract').classification='source-contract clarification';
 }
 const papa=await work('papa-gm','shiftentry.save',{businessDate:'2026-10-07',department:'combined',shift:'closing',summary:'One shift: stop seating, finish tables, sidework, bank and personal GM closing walk',tomorrowNote:'Next-day carryover; no same-day handoff invented',readiness:'action-needed',issueIds:[]},undefined,undefined,'papa');
 evidence.checks.push({action:'Papa one-shift combined daily close with same GM baseline',expected:{status:200},actual:papa});
 if(papa.status!==200)gap('gm-papa-combined-access','Papa GM baseline supports one-shift combined operating close',{status:papa.status,error:papa.data.error},[{file:'app/shared/operations.ts',line:12}],'Executive Papa GM with minimal pair POST shiftentry.save department=combined returns 403.');
 await denied('GM cannot administer access',()=>request('gm','/api/access?locationId=a'),403);
 await denied('GM cannot inspect another store',()=>request('gm','/api/workspace?locationId=foreign'),403);
 await denied('GM cannot invent purchase authority',()=>work('gm','order.save',{lines:[],note:'Unauthorized'}),403);
 await denied('GM cannot create owner-only private coaching series',()=>work('gm','meeting.create',{managerId:'boh',cadenceDays:14,due:'2026-10-10T10:00:00-04:00',agenda:'Unauthorized'}),403);
 await denied('GM cannot draft a schedule without separately reviewed scheduling capability',()=>work('gm','shift.save',{personId:'server',position:'Server',start:'2026-10-08T16:00:00-04:00',end:'2026-10-08T23:00:00-04:00'}),403);
 let shift=ok(await work('scheduler','shift.save',{personId:'server',position:'Server',start:'2026-10-08T16:00:00-04:00',end:'2026-10-08T23:00:00-04:00'}));
 assert.equal(ok(await request('server','/api/workspace?locationId=a')).records.some(r=>r.id===shift.recordId),false);
 await denied('GM cannot publish scheduler draft without scheduling authority',()=>work('gm','shift.publish',{publicationReviewed:true},shift),404);
 shift=ok(await work('scheduler','shift.publish',{publicationReviewed:true},shift));assert.ok(ok(await request('server','/api/workspace?locationId=a')).records.some(r=>r.id===shift.recordId));
 evidence.checks.push({action:'Schedule draft versus published boundary',expected:{hiddenDraft:true,visiblePublished:true},actual:{hiddenDraft:true,visiblePublished:true,recordId:shift.recordId}});
 const standardData={title:'Fictional server close',zone:'Fictional dining room',position:'Server',criteria:['Fictional dining room ready'],source:'Fictional approved fixture, not restaurant policy',version:1,verification:'manager',status:'approved',validationNote:'Fixture reviewed',history:[]};
 await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind('fictional-close-standard','a','standard','owner','FOH',1,JSON.stringify(standardData),clock).run();
 const closeInput={shiftId:shift.recordId,standardId:'fictional-close-standard',managerId:'gm',due:'2026-10-08T23:00:00-04:00'};
 const managerContract=await denied('Owner cannot designate minimal-pair GM as close confirmer without separately reviewed close authority',()=>work('owner','close.assign',closeInput),400);
 gap('gm-close-confirmation-setup-contract','GM baseline daily closing responsibility needs an explicitly reviewed configuration compatible with independent close-confirmation gates',{status:managerContract.status,error:managerContract.data.error},[{file:'app/shared/gm-operating-setup.ts',line:6},{file:'app/shared/domain.ts',line:984}],'Owner POST close.assign on active published FOH shift and approved manager-only standard, managerId=Executive GM with minimal pair: 400 independent manager required. Existing close.confirm and assigned-leader gates must be preserved; review the role setup contract.');
 const stale=unresolved;unresolved=ok(await work('gm','managerlog.note',{note:'Latest observed follow-up'},unresolved));await denied('Stale GM save',()=>work('gm','managerlog.note',{note:'Old save'},stale),409);
 await db.prepare("CREATE TRIGGER gm_week_fail_receipt BEFORE INSERT ON command_receipts WHEN NEW.request_id='gm-week-rollback' BEGIN SELECT RAISE(ABORT,'fictional rollback'); END").run();
 await denied('Failed GM receipt rolls back manager log and audit',()=>work('gm','managerlog.note',{note:'Fictional interrupted save'},unresolved,'gm-week-rollback'),503);
 await db.prepare('DROP TRIGGER gm_week_fail_receipt').run();const retryOriginal=unresolved;unresolved=ok(await work('gm','managerlog.note',{note:'Fictional interrupted save'},retryOriginal,'gm-week-rollback'));assert.deepEqual(ok(await work('gm','managerlog.note',{note:'Fictional interrupted save'},retryOriginal,'gm-week-rollback')),unresolved);
 await denied('Same retry ID rejects changed GM content',()=>work('gm','managerlog.note',{note:'Different content'},retryOriginal,'gm-week-rollback'),409);
 // Explicit late-night New York date: UTC is already the following date.
 setClock('2026-10-08T03:59:00.000Z');assert.equal(localDate(clock,'America/New_York'),'2026-10-07');
 const currentPage=ok(await request('gm','/api/food/workflows?locationId=a&dataset=demo')),lastCount=currentPage.counts.find(c=>c.businessDate==='2026-10-07');
 let rollover=ok(await prep('plan.generate',{countId:lastCount.id,countRevision:lastCount.revision,targetDate:'2026-10-16'}));
 assert.deepEqual((await request('gm','/api/food/workflows?locationId=a&dataset=demo&recordId='+rollover.recordId)).data.record.blockers,[]);
 setClock('2026-10-08T04:01:00.000Z');assert.equal(localDate(clock,'America/New_York'),'2026-10-08');
 await denied('New York midnight rejects previous-day prep release',()=>prep('plan.release',{confirmed:true},rollover),409);
 await db.prepare("UPDATE memberships SET capabilities='[\"tasks.manage\"]',revision=revision+1 WHERE id='gm'").run();
 await denied('GM store operating access revoked',()=>work('gm','managerlog.note',{note:'Revoked write'},unresolved),404);
 await denied('GM prep access revoked',()=>request('gm','/api/food/workflows?locationId=a&dataset=demo'),403);
 await db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='gm'").run();await denied('Disabled GM cannot access workspace',()=>request('gm','/api/workspace?locationId=a'),403);
 assert.equal(evidence.days.length,7);
 evidence.execution={completed:true,days:7,handlerActions:evidence.days.reduce((n,d)=>n+d.actions.length,0),gapCount:evidence.gaps.length};
});
