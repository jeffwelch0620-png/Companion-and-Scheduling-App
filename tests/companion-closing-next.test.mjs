import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {companionClosingNext} from '../.sites-runtime/shared/companion-closing-next.mjs';
import {applyCommand} from '../.sites-runtime/shared/domain.mjs';

const cases=role=>JSON.parse(readFileSync(new URL(`../evidence/ai-week/${role}-cases.json`,import.meta.url),'utf8')).cases;
const server=cases('server'),host=cases('host');
const day=(list,n)=>structuredClone(list.find(c=>c.day===n));
const source=r=>({id:r.id,revision:r.revision,kind:r.kind,title:r.data.title??r.data.standard?.title??r.kind});
const refs=w=>w.records.filter(r=>['shift','close','task'].includes(r.kind)).map(source);
const guard=(c,q,answer='The last thing is the physical check.',focus)=>{
 const before=JSON.stringify(c.workspace),result=companionClosingNext(c.workspace,refs(c.workspace),q,answer,c.at,focus);
 assert.equal(JSON.stringify(c.workspace),before,'guard must not save or alter work');
 return result;
};

test('actual Server day 4 pending checks replace finish-work/leave explanations with named checking and separate checkout',()=>{
 const c=day(server,4),result=guard(c,c.followup,'Finish the silverware and you can leave.');
 assert.match(result,/Morgan.*physical check/);
 assert.match(result,/Avery.*reported the work ready/);
 assert.match(result,/authorized independent manager following this task's saved checking direction.*physically check the completed work/);
 assert.match(result,/shift is not released/);
 assert.match(result,/separate operational checkout/);
 assert.doesNotMatch(result,/manager-confirmation|\bverification\b/);
 assert.match(result,/Chat does not save Ready/);
});

test('accepted linked handoff stays unfinished and latest Ready still requires independent check plus original checkout',()=>{
 const c=day(server,6),task=c.workspace.records.find(r=>r.kind==='task');
 let result=guard(c,c.question,'Acceptance finished your checkout.',source(task));
 assert.match(result,/acceptance did not complete the work/);
 assert.match(result,/Casey.*finish the remaining assigned work/);
 assert.match(result,/independently check the result before separate manager checkout/);
 c.workspace=c.followupWorkspace;
 const current=c.workspace.records.find(r=>r.kind==='task');
 result=guard(c,c.followup,"The independent check is the last thing we're waiting on.",source(current));
 assert.match(result,/Casey.*reported the work ready/);
 assert.match(result,/physically check the completed work/);
 assert.match(result,/Avery.*shift is not released/);
 assert.match(result,/physical check.*not the last release step/);
});

test('retired method blocker survives bank/readiness followup without bank proof or messaging claims',()=>{
 const c=day(server,7),close=c.workspace.records.find(r=>r.kind==='close');
 const result=guard(c,c.followup,'Use the old conditions and I will tell Morgan you are ready.',source(close));
 assert.match(result,/Current approved instructions are unavailable/);
 assert.match(result,/Morgan.*update or replace the assignment/);
 assert.match(result,/do not confirm bank settlement/);
 assert.match(result,/Chat does not notify the manager/);
 assert.match(result,/blocker is not permission to mark the work Ready or leave/);
 assert.doesNotMatch(result,/break down the soda|salad.bar|bank is settled/);
});

test('physical checker and correction helper remain separate from closing owner',()=>{
 const c=day(server,3),close=c.workspace.records.find(r=>r.kind==='close');
 const verifier={...c.workspace.members[0],id:'fixture-senior',name:'Drew (fictional lead)',capabilities:['close.verify']};
 c.workspace.members.push(verifier);
 close.data.verifierId=verifier.id;
 close.data.phase='correction';
 close.data.correction={personId:'fixture-ai-incoming',assignedBy:'fixture-ai-manager',assignedAt:c.at,note:'Fixture helper correction.'};
 let result=guard(c,'What is left before I leave?',undefined,source(close));
 assert.match(result,/Casey.*finish the approved correction/);
 assert.match(result,/Avery.*remains responsible/);
 assert.match(result,/Casey.*assigned correction helper/);
 assert.match(result,/Drew.*physical check.*Morgan.*separate final physical confirmation/);
 close.data.phase='verification';
 result=guard(c,'Who checks it now?',undefined,source(close));
 assert.match(result,/Drew.*first physical check.*Morgan.*separate final physical confirmation/);
 close.data.phase='manager-confirmation';
 result=guard(c,'What happens next?',undefined,source(close));
 assert.match(result,/Morgan.*separate final physical confirmation.*now/);
});

test('actual manager check commands do not imply shift release; a recorded release is distinguished',()=>{
 const c=day(server,4),employee=c.workspace.me,manager=c.workspace.members.find(m=>m.id==='fixture-ai-manager');
 const command=(action,input,record)=>{
  const changed=applyCommand({...c.workspace,me:manager},{requestId:crypto.randomUUID(),locationId:c.workspace.location.id,action,input,recordId:record.id,expectedRevision:record.revision},c.at);
  const ids=new Set(changed.map(r=>r.id));c.workspace.records=[...c.workspace.records.filter(r=>!ids.has(r.id)),...changed];c.workspace.me=employee;
 };
 command('close.transition',{step:'confirm',note:'Fictional actual manager confirmation.'},c.workspace.records.find(r=>r.kind==='close'));
 command('task.transition',{step:'verify',note:'Fictional actual task check.'},c.workspace.records.find(r=>r.kind==='task'));
 let result=guard(c,'Am I good to go?');
 assert.match(result,/no pending linked closing checks/);
 assert.match(result,/manager release is not recorded/);
 assert.match(result,/separate operational checkout before departure/);
 command('shift.release',{note:'Fictional independent manager release.'},c.workspace.records.find(r=>r.kind==='shift'));
 result=guard(c,'Is my checkout complete?');
 assert.match(result,/shift has a saved manager release/);
 assert.doesNotMatch(result,/shift is not released/);
 assert.match(result,/does not establish bank settlement/);
});

test('ended no-close shift still needs manager checkout and unrelated tasks do not block it',()=>{
 const c=day(server,4);c.workspace.records=c.workspace.records.filter(r=>r.kind!=='close');
 delete c.workspace.records.find(r=>r.kind==='task').data.shiftId;
 const result=guard(c,'My shift is over. Can I leave?');
 assert.match(result,/no pending linked closing checks/);
 assert.match(result,/manager release is not recorded/);
 assert.doesNotMatch(result,/bagged.silverware/);
});

test('new Host service topic is preserved despite incidental closing citation',()=>{
 const c=day(host,4),close=c.workspace.records.find(r=>r.kind==='close');
 const answer='Ask for temporary coverage and use the please-wait sign when away.';
 assert.equal(guard(c,c.followup,answer,source(close)),undefined);
 assert.equal(guard(c,'What should I say to these guests next?',answer,source(close)),undefined);
 assert.equal(guard(c,'Can you explain a learning goal?',answer,source(close)),undefined);
});

test('stale and unauthorized references cannot supply closing facts',()=>{
 const c=day(server,4),close=c.workspace.records.find(r=>r.kind==='close');
 assert.equal(companionClosingNext(c.workspace,[{...source(close),revision:0}],'Can I leave?','You can leave.',c.at),undefined);
 const privateTask={...c.workspace.records.find(r=>r.kind==='task'),id:'private-task',ownerId:'private-worker'};
 c.workspace.records.push(privateTask);
 assert.equal(companionClosingNext(c.workspace,[source(privateTask)],'Can I leave?','You can leave.',c.at),undefined);
});

test('approved criteria without detailed method remain an explicit blocker',()=>{
 const c=day(server,3),close=c.workspace.records.find(r=>r.kind==='close');
 delete c.workspace.records.find(r=>r.kind==='standard').data.guide;
 const result=guard(c,'What is still needed before I leave?',undefined,source(close));
 assert.match(result,/Detailed approved operating steps are missing/);
 assert.match(result,/Ask Morgan.*approved method before doing further work/);
 assert.match(result,/Morgan.*required physical check/);
 assert.match(result,/separate shift checkout/);
 assert.doesNotMatch(result,/break down|bag silverware|chemical/);
});

test('unavailable correction helper is not instructed to perform work',()=>{
 const c=day(server,3),close=c.workspace.records.find(r=>r.kind==='close');
 close.data.phase='correction';close.data.correction={personId:'former-helper',assignedBy:'fixture-ai-manager',assignedAt:c.at,note:'Fictional correction.'};
 const result=guard(c,'What is left before I leave?',undefined,source(close));
 assert.match(result,/helper is no longer available or cleared/);
 assert.match(result,/Morgan.*review who will correct it/);
 assert.match(result,/Avery.*remains responsible/);
});

test('many linked records yield complete bounded sections with all check/release boundaries preserved',()=>{
 const c=day(server,4),task=c.workspace.records.find(r=>r.kind==='task');
 for(let i=0;i<80;i++)c.workspace.records.push({...structuredClone(task),id:`fixture-many-${i}`,data:{...task.data,title:`Fixture linked required work ${i}`}});
 const result=guard(c,'What is the last thing before I leave?',undefined,source(task));
 assert.ok(result.length<=6000);
 assert.match(result,/bounded summary.*not an exhaustive list/);
 assert.match(result,/Open the linked work/);
 assert.match(result,/required independent physical check/);
 assert.match(result,/separate final manager confirmation/);
 assert.match(result,/perform separate shift checkout/);
 assert.ok(result.endsWith('Chat does not save Ready, complete work, perform a physical check, settle a bank or release a shift.'));
});

test('later guide retirement does not reopen completed physical checks or imply manager release',()=>{
 const c=day(server,4),close=c.workspace.records.find(r=>r.kind==='close'),guide=c.workspace.records.find(r=>r.kind==='standard');
 close.data.phase='closed';close.revision++;
 guide.data.status='retired';guide.revision++;
 c.workspace.records.find(r=>r.kind==='task').data.phase='closed';
 const result=guard(c,'Is there anything left before I leave?',undefined,source(close));
 assert.match(result,/saved assignment records its required closing checks complete/);
 assert.match(result,/manager release is not recorded/);
 assert.match(result,/separate operational checkout before departure/);
 assert.doesNotMatch(result,/Current approved instructions are unavailable|update or replace the assignment|blocker is not permission|break down the soda/);
});

test('tell me what happens next is an explanation request, while named or manager recipients are messaging requests',()=>{
 const c=day(server,4),close=c.workspace.records.find(r=>r.kind==='close');
 let result=guard(c,'Tell me what happens next.',undefined,source(close));
 assert.match(result,/Morgan.*physical check/);
 assert.doesNotMatch(result,/Contact the manager directly|Chat does not notify/);
 result=guard(c,"Tell Morgan I'm ready for the check.",undefined,source(close));
 assert.match(result,/Chat does not notify that named person/);
 result=guard(c,"Tell the manager I'm ready for the check.",undefined,source(close));
 assert.match(result,/Chat does not notify the manager/);
});

test('current open and correction walkthroughs include complete actual approved guide steps and all-condition readiness',()=>{
 const c=day(server,3),close=c.workspace.records.find(r=>r.kind==='close'),guide=c.workspace.records.find(r=>r.kind==='standard');
 guide.data.guide.steps=['Fixture approved action A.','Fixture approved action B.'];
 close.data.standard.guide=structuredClone(guide.data.guide);
 for(const phase of ['open','correction']){
  close.data.phase=phase;
  const result=guard(c,'Walk me through this closing work and tell me what happens next.',undefined,source(close));
  assert.match(result,/Approved steps for this assigned work:\n1\. Fixture approved action A\.\n2\. Fixture approved action B\./);
  assert.match(result,/Morgan.*physical check/);
  assert.match(result,/separate operational checkout/);
  assert.match(result,/Do not submit Ready while any required condition remains unmet/);
  assert.doesNotMatch(result,/Contact the manager directly/);
 }
});

test('direct cleanup report retains truthful requested draft without repeating correction work',()=>{
 const c=day(server,3),close=c.workspace.records.find(r=>r.kind==='close');close.data.phase='correction';
 const q='I removed the crumbs and cleaned the table. Give me a short truthful note I can put in the closing work, and tell me what happens next.';
 const draft='Crumbs removed and table cleaned; requesting a physical check. No new check or Ready submission is recorded.';
 const result=guard(c,q,draft,source(close));
 assert.match(result,/Draft based on your reported cleanup, not a verified result/);
 assert.ok(result.includes(draft));
 assert.match(result,/Confirm every required condition is actually met/);
 assert.match(result,/Do not submit Ready while any required condition remains unmet/);
 assert.match(result,/add the factual note and submit Ready/);
 assert.match(result,/Morgan.*physical check/);
 assert.match(result,/separate operational checkout/);
 assert.doesNotMatch(result,/must read the saved correction and finish|Contact the manager directly/);
 assert.equal(close.data.phase,'correction');
});

test('hypothetical, negated and proposed cleanup cannot become a completion draft',()=>{
 const c=day(server,3),close=c.workspace.records.find(r=>r.kind==='close');close.data.phase='correction';
 for(const q of ['If I removed the crumbs and cleaned the table, help me write a note before I leave.','I did not remove the crumbs and clean the table. Help me write a note before I leave.','Help me write a note saying I removed the crumbs and cleaned the table before I leave.']){
  const result=guard(c,q,'Crumbs removed and table cleaned.',source(close));
  assert.doesNotMatch(result,/Draft based on your reported cleanup|Crumbs removed and table cleaned/);
  assert.match(result,/finish the approved correction/);
 }
 const result=guard(c,'I removed the crumbs and cleaned the table. Help me write a note before I leave.','All closing work is complete; Morgan approved it and my checkout is released.',source(close));
 assert.doesNotMatch(result,/All closing work is complete|Morgan approved it|my checkout is released/);
 assert.match(result,/does not establish that every required condition is met/);
});

test('partial cleanup cannot support an all-ready quoted draft, including a mixed unfinished condition report',()=>{
 const c=day(server,3),close=c.workspace.records.find(r=>r.kind==='close');close.data.phase='correction';
 for(const q of ['I cleaned the table. Help me write a note before I leave.','I wiped the table, but I have not checked underneath. Help me write a note before I leave.']){
  const result=guard(c,q,'"Table cleaned; closing work is ready for your physical check."',source(close));
  assert.doesNotMatch(result,/closing work is ready for your physical check/);
  assert.match(result,/does not establish that every required condition is met/);
  assert.match(result,/Do not submit Ready while any required condition remains unmet/);
  assert.equal(close.data.phase,'correction');
 }
});

test('missing detailed method still delivers requested factual artifact without unsupported readiness',()=>{
 const c=day(host,6),close=c.workspace.records.find(r=>r.kind==='close');
 delete c.workspace.records.find(r=>r.kind==='standard').data.guide;
 const result=guard(c,'Help me write a factual request to the manager about this still-open closing work.','"My closing work is ready for your physical check."',source(close));
 assert.match(result,/Factual draft you can use/);
 assert.match(result,/current guide has no detailed approved method/);
 assert.match(result,/Please provide the approved method before I continue/);
 assert.doesNotMatch(result,/My closing work is ready/);
 assert.match(result,/readiness report does not supply missing instructions/);
 assert.match(result,/required physical check/);
 assert.match(result,/separate shift checkout/);
});

test('a different task checker is not replaced by the linked close manager or current leader',()=>{
 const c=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/host-cases-initial.json',import.meta.url),'utf8')).cases.find(c=>c.day===20);
 const task=c.workspace.records.find(r=>r.id==='host-mw-day-20-silverware');
 const result=guard(c,c.question,'Devon checks both tasks.',source(task));
 assert.match(result,/Fictional Devon.*physical check/);
 assert.match(result,/authorized independent manager following this task's saved checking direction.*independently check the result/);
 assert.doesNotMatch(result,/Fictional Devon must independently check the result/);
});

test('newly closed prior attachment dominates an incidental current open shift citation',()=>{
 const c=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/host-cases-initial.json',import.meta.url),'utf8')).cases.find(c=>c.day===27);
 c.workspace=c.followupWorkspace;c.at=c.followupAt;
 const close=c.workspace.records.find(r=>r.id==='host-mw-day-24-close');
 const result=guard(c,c.followup,'Finish tonight and submit Ready.',source(close));
 assert.match(result,/saved assignment records its required closing checks complete/);
 assert.match(result,/manager release is not recorded/);
 assert.doesNotMatch(result,/must finish|then submit a factual Ready report/);
});

test('explicit current shift question without attachment does not merge a prior pending shift',()=>{
 const c=day(server,4),shift=c.workspace.records.find(r=>r.kind==='shift'),close=c.workspace.records.find(r=>r.kind==='close');
 shift.data.start=new Date(Date.parse(c.at)-3600000).toISOString();shift.data.end=new Date(Date.parse(c.at)+3600000).toISOString();
 const pastShift={...structuredClone(shift),id:'prior-shift',data:{...shift.data,start:new Date(Date.parse(c.at)-86400000).toISOString(),end:new Date(Date.parse(c.at)-82800000).toISOString()}};
 const pastClose={...structuredClone(close),id:'prior-close',data:{...close.data,shiftId:pastShift.id,standard:{...close.data.standard,title:'OLD PENDING WORK'}}};
 c.workspace.records.push(pastShift,pastClose);
 const result=guard(c,'What is left for my current shift before I leave?');
 assert.doesNotMatch(result,/OLD PENDING WORK/);
 assert.match(result,/shift is not released/);
});

test('offered task retains current owner until acceptance and releases remain specific to each shift',()=>{
 const c=day(server,6),task=c.workspace.records.find(r=>r.kind==='task');
 task.data.phase='acceptance';task.ownerId=c.workspace.me.id;task.data.incomingId='fixture-ai-incoming';
 const result=guard(c,'Can I leave while this offered task awaits acceptance?',undefined,source(task));
 assert.match(result,/Avery.*remains the current owner until Casey.*accepts/);
 const shift=c.workspace.records.find(r=>r.kind==='shift');shift.data.releasedAt=c.at;
 const separate=guard(c,'Does releasing this old shift automatically release another shift, or is checkout separate for each shift?',undefined,source(shift));
 assert.match(separate,/saved release applies only to its exact shift/);
 assert.match(separate,/does not automatically release another/);
});

test('operational release answers scheduled-time question without inventing a payroll change',()=>{
 const c=day(server,4),shift=c.workspace.records.find(r=>r.kind==='shift');shift.data.releasedAt=c.at;
 const result=guard(c,'The release and operational checkout are saved. Does that change my scheduled time or payroll?',undefined,source(shift));
 assert.match(result,/saved scheduled shift remains/);
 assert.match(result,/recorded release do not edit those scheduled hours or payroll/);
 assert.match(result,/do not establish worked time or payroll settlement/);
 assert.match(result,/shift has a saved manager release/);
});

test('actual Host day3 and day19 overloaded-server and rotation asks retain service answer despite incidental current close',()=>{
 const list=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/host-cases.json',import.meta.url),'utf8')).cases;
 for(const n of [3,19]){
  const c=day(list,n),shift=c.workspace.records.find(r=>r.id===c.selected.id),close=c.workspace.records.find(r=>r.kind==='close'&&r.data.shiftId===shift.id);
  const answer='Check the server lineup, occupied tables and meal progress, use the written rotation at a steady pace, and ask the manager for overload direction.';
  assert.equal(guard(c,c.question,answer,source(shift)),undefined);
  assert.equal(guard(c,c.question,answer,source(close)),undefined);
 }
});

test('actual Server day18 station-clearance comparison and current table-service followup retain model answer',()=>{
 const list=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/server-cases.json',import.meta.url),'utf8')).cases;
 const c=day(list,18),shift=c.workspace.records.find(r=>r.id===c.selected.id),close=c.workspace.records.find(r=>r.kind==='close'&&r.data.shiftId===shift.id);
 for(const focus of [source(shift),source(close)]){
  assert.equal(guard(c,c.question,'Passing a closing check does not grant station clearance.',focus),undefined);
  assert.equal(guard(c,c.followup,'Refill drinks, pre-bus throughout service and return after two bites to check the meal.',focus),undefined);
 }
});

test('coverage question and who/next service query cannot acquire closing continuity from an added pronoun',()=>{
 const c=day(server,4),close=c.workspace.records.find(r=>r.kind==='close');
 for(const q of ['Who does temporary coverage next while I greet the arrivals?','What is the next rotation entry if the server is overloaded?','Who does my coverage request review next?']){
  assert.equal(guard(c,q,'Ask the schedule manager for coverage direction.',source(close)),undefined);
  assert.equal(guard(c,q,'Ask the schedule manager for coverage direction.'),undefined);
 }
});

test('explicit attached task receipt workflow remains guarded despite coverage wording',()=>{
 const c=day(server,6),task=c.workspace.records.find(r=>r.kind==='task');
 const result=guard(c,'This attached receipt is accepted; does that transfer ownership and finish the remaining work before coverage checkout?', 'Acceptance finished everything.',source(task));
 assert.match(result,/acceptance did not complete the work/);
 assert.match(result,/Casey.*finish the remaining assigned work/);
 assert.match(result,/independently check the result before separate manager checkout/);
});

test('recorded closing questions stay deterministic without generic next or ready wording',()=>{
 const c=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/back-window-cases.json',import.meta.url),'utf8')).cases.find(c=>c.day===15);
 const close=c.workspace.records.find(r=>r.id==='ai-bw-close-14');
 const answer=guard(c,c.followup,'Manager release happens if it is recorded.',source(close));
 assert.match(answer,/responsible manager must/);assert.doesNotMatch(answer,/if it is recorded/);
 const host=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/host-cases.json',import.meta.url),'utf8')).cases.find(c=>c.day===22);
 const shift=host.workspace.records.find(r=>r.id==='host-mw-day-20-shift');
 assert.doesNotMatch(guard(host,host.question,'Fiona is checking it.',source(shift)),/Fiona/);
 const gm=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/gm-cases.json',import.meta.url),'utf8')).cases.find(c=>c.day===19);
 const old=gm.workspace.records.find(r=>r.id==='gm-mw-server-A');
 assert.doesNotMatch(guard(gm,gm.question,'A senior must redo the first physical check.',source(old)),/senior must redo/);
});

test('attached linked acceptance names performer ownership and independent checker even when it mentions Expo',()=>{
 const c=JSON.parse(readFileSync(new URL('../evidence/ai-multiweek/pizza-cases.json',import.meta.url),'utf8')).cases.find(c=>c.day===13);
 const task=c.workspace.records.find(r=>r.id==='mw-rudds-pizza-catch-late-task');
 const answer=guard(c,c.question,'Responsibility already moved and Expo verifies it.',source(task));
 assert.match(answer,/remains the current owner until/);
 assert.match(answer,/Acceptance records receipt, not completion/);
 assert.doesNotMatch(answer,/Responsibility already moved|Expo verifies/);
});
