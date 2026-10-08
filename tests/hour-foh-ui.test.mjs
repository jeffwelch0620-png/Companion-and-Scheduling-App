import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {publicWorkspace} from '../.sites-runtime/shared/domain.mjs';

// Fresh UI modules with the already compiled shared runtime. This is server
// rendering and actual React form callbacks, not a browser interaction proof.
const output=path.resolve('.sites-runtime/hour-foh-ui'),visited=new Set();
function compile(file){
 if(visited.has(file))return;visited.add(file);
 const destination=path.join(output,path.relative(path.resolve('app'),file).replace(/\.tsx?$/,'.mjs'));
 let js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 js=js.replace(/import ['"][^'"]+\.css['"];?/g,'').replace(/from (['"])(\.\.?\/[^'"]+)\1/g,(_,quote,specifier)=>{
  const base=path.resolve(path.dirname(file),specifier);
  if(base.startsWith(path.resolve('app/shared')+path.sep))return `from ${quote}${pathToFileURL(path.resolve('.sites-runtime/shared',path.relative(path.resolve('app/shared'),base)+'.mjs')).href}${quote}`;
  const dependency=['.ts','.tsx'].map(ext=>base+ext).find(f=>fs.existsSync(f));assert.ok(dependency,'Missing UI dependency '+base);compile(dependency);return `from ${quote}${specifier}.mjs${quote}`;
 });
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,js);
}
for(const name of ['my-day','workspace-forms','followthrough-forms'])compile(path.resolve('app/team/'+name+'.tsx'));
const {MyDay}=await import(pathToFileURL(path.join(output,'team/my-day.mjs'))),{RecordDetail}=await import(pathToFileURL(path.join(output,'team/workspace-forms.mjs'))),{FollowDetail}=await import(pathToFileURL(path.join(output,'team/followthrough-forms.mjs')));
const evidenceDir='evidence/hour-trial/berts-foh/ui-'+new Date().toISOString().replaceAll(':','-').replaceAll('.','-');fs.mkdirSync(evidenceDir,{recursive:true});
const results={mode:'React server-rendered actual components and form callbacks; fictional saved-work states. No browser, live service or model request.',checks:[],limits:['Browser geometry, phone layout, navigation clicks and full-shell pending-command recovery are not exercised.','Render states supplement earlier actual-handler tests; fixture states are not production assignments.']};
const profiles=JSON.parse(fs.readFileSync('evidence/all-position-week/berts-foh-profiles.json','utf8'));
const now='2026-10-09T16:00:00.000Z';
function fixture(profile=profiles[0]){
 const me={id:'worker',locationId:'berts',name:'Fictional '+profile.position,area:'FOH',position:profile.position,capabilities:[],qualifications:[profile.position],scheduleJobs:[profile.position]},manager={...me,id:'manager',name:'Fictional manager',position:'Manager',capabilities:['tasks.manage','close.confirm','people.manage']},incoming={...me,id:'incoming',name:'Fictional incoming'},replacement={...manager,id:'new-manager',name:'Fictional new manager'};
 const make=(id,kind,ownerId,data)=>({id,kind,ownerId,area:'FOH',locationId:'berts',revision:1,updatedAt:now,data});
 const standard=make('approved-guide','standard','manager',{title:'Prior '+profile.position+' close',position:profile.position,zone:profile.position,source:'QA confirmed duty profile; no real SOP approval',version:1,status:'approved',verification:'manager',criteria:profile.closing,history:[],guide:{purpose:'Confirmed duty reference used for QA',preparation:profile.opening,steps:profile.closing,troubleshooting:['Report incomplete work'],escalation:'Named manager'}});
 const old=make('previous-shift','shift','worker',{personId:'worker',position:profile.position,start:'2026-10-08T04:00:00.000Z',end:'2026-10-08T10:00:00.000Z',published:true,cancelled:false,history:[]}),current=make('current-shift','shift','worker',{personId:'worker',position:profile.position,start:'2026-10-09T15:00:00.000Z',end:'2026-10-10T00:00:00.000Z',published:true,cancelled:false,history:[]});
 const close=make('previous-close','close','worker',{shiftId:old.id,standardId:standard.id,standardRevision:1,standard:standard.data,managerId:'manager',due:old.data.end,phase:'correction',answers:[],history:[{actorId:'manager',at:'2026-10-08T10:00:00.000Z',action:'fix',note:'One documented condition still needs correction.'}]}),opening=make('current-opening','task','worker',{title:'Current '+profile.position+' opening',kind:'task',phase:'open',shiftId:current.id,detail:profile.opening.join('\n')||'QA starter only',due:now,history:[]});
 const handoff=make('incoming-work','task','worker',{title:'Unfinished incoming service work',kind:'handoff',phase:'acceptance',shiftId:old.id,incomingId:'incoming',detail:'Remaining saved condition must be completed and independently checked.',due:old.data.end,history:[]});
 const w={location:{id:'berts',name:'Fictional Bert’s',timezone:'America/New_York',revision:1},me,members:[me,manager,incoming,replacement],records:[standard,old,current,close,opening,handoff]};return {w,me,manager,incoming,replacement,standard,old,current,close,opening,handoff};
}
const props=f=>({w:f.w,now,send:async()=>true,onError(){},onOpen(){},onWeek(){},onGuides(){},onAskWeek(){}});
const render=(component,properties)=>renderToStaticMarkup(React.createElement(component,properties));
const record=(label,details={})=>results.checks.push({label,status:'passed',...details});
test.after(()=>fs.writeFileSync(evidenceDir+'/summary.json',JSON.stringify(results,null,2)+'\n'));

for(const profile of profiles)test(`${profile.position} My day: old correction remains reachable beside current opening after 30 hours`,()=>{
 const f=fixture(profile),html=render(MyDay,{...props(f),w:publicWorkspace(f.w,now),onTraining(){},onSchedule(){},onDuties(){},onAsk(){},onStart(){}});fs.writeFileSync(evidenceDir+'/'+profile.id+'-my-day.html',html);
 assert.match(html,/Scheduled now/);assert.match(html,new RegExp('Current '+profile.position+' opening'));assert.match(html,new RegExp('Prior '+profile.position+' close'));assert.match(html,/Correct and request another check/);assert.match(html,/All assignments/);assert.match(html,/Overdue/);
 const detail=render(RecordDetail,{...props(f),record:f.close});assert.match(detail,/What needs correction/);assert.match(detail,/One documented condition still needs correction/);assert.match(detail,/Ready for physical check/);assert.doesNotMatch(detail,/Final physical check passed/);
 record(profile.position+' retains current opening and earlier overdue correction',{pendingAgeHours:30,currentShift:f.current.id,priorCorrection:f.close.id});
});

test('manager Inbox renders changed instruction snapshot and hides unavailable attachment after access reassignment',()=>{
 const f=fixture(),context={recordId:f.close.id,revision:1,kind:'close',capturedAt:'2026-10-08T09:00:00Z',standardId:f.standard.id,standardRevision:1,instruction:{title:'EARLIER APPROVED SNAPSHOT',zone:'Server',position:'Server',version:1,source:'QA earlier source',criteria:['Earlier criterion'],verification:'manager',guide:{purpose:'Earlier supplied reference',preparation:[],steps:['EARLIER INSTRUCTION'],troubleshooting:[],escalation:'Manager'}},clarifications:[],assignment:{ownerId:'worker',due:f.old.data.end,phase:'open'}};
 const message={id:'saved-question',kind:'message',ownerId:'worker',locationId:'berts',area:'FOH',revision:1,updatedAt:now,data:{title:'Saved question',body:'Please review this condition.',recipients:['manager'],readBy:['worker'],replies:[],recordId:f.close.id,context}};f.close.revision=2;f.w.records.push(message);f.w.me=f.manager;
 let projected=publicWorkspace(f.w,now),m=projected.records.find(r=>r.id===message.id),html=render(RecordDetail,{...props(f),w:projected,record:m});fs.writeFileSync(evidenceDir+'/manager-inbox-changed.html',html);
 assert.equal(m.data.contextStatus,'changed');assert.match(html,/has changed since this question was sent/);assert.match(html,/Read the earlier instruction snapshot/);assert.match(html,/EARLIER INSTRUCTION/);assert.match(html,/Open related work/);
 f.close.data.managerId='new-manager';f.w.me={...f.manager,capabilities:[],position:'Server'};f.w.members=f.w.members.map(p=>p.id==='manager'?f.w.me:p);projected=publicWorkspace(f.w,now);m=projected.records.find(r=>r.id===message.id);html=render(RecordDetail,{...props(f),w:projected,record:m});fs.writeFileSync(evidenceDir+'/manager-inbox-unavailable.html',html);
 assert.equal(m.data.contextStatus,'unavailable');assert.match(html,/original attachment is no longer available with your current access/);assert.match(html,/Please review this condition/);assert.doesNotMatch(html,/EARLIER INSTRUCTION|EARLIER APPROVED SNAPSHOT|Open related work/);record('Changed and unavailable Inbox attachments remain distinguishable and do not grant work access');
});

test('incoming handoff controls distinguish pending receipt from completion and surface a submission error without marking accepted',async()=>{
 const f=fixture();f.w.me=f.incoming;let sent=[],errors=[],fail=true;const p={...props(f),record:f.handoff,send:async(action,input,record)=>{sent.push({action,input,id:record.id,revision:record.revision});if(fail)throw Error('Temporary save failure. Work has not been received.');return true;},onError:error=>errors.push(error)};
 let html=render(FollowDetail,p);fs.writeFileSync(evidenceDir+'/incoming-acceptance-pending.html',html);assert.match(html,/Accept handoff/);assert.match(html,/Dispute handoff/);assert.doesNotMatch(html,/Incoming work ready for physical check|Physical check passed/);
 function find(element,predicate){if(!React.isValidElement(element))return null;if(predicate(element))return element;for(const child of React.Children.toArray(element.props.children)){const found=find(child,predicate);if(found)return found;}return null;}
 const tree=FollowDetail(p),form=find(tree,element=>typeof element.type==='function'&&element.type.name==='Form');assert.ok(form);const formElement=form.type(form.props),nativeFormData=globalThis.FormData;
 try{globalThis.FormData=class{constructor(element){this.values=element.values;}get(key){return this.values[key]??null;}};await formElement.props.onSubmit({preventDefault(){},currentTarget:{values:{note:'Explicit pending receipt'}},nativeEvent:{submitter:{getAttribute:()=> 'accept'}}});}finally{globalThis.FormData=nativeFormData;}
 assert.equal(errors.length,1);assert.match(errors[0],/Temporary save failure/);assert.deepEqual(sent[0],{action:'task.transition',input:{step:'accept',note:'Explicit pending receipt'},id:f.handoff.id,revision:1});assert.equal(f.handoff.data.phase,'acceptance');html=render(FollowDetail,p);assert.match(html,/Accept handoff/);
 fail=false;try{globalThis.FormData=class{constructor(element){this.values=element.values;}get(key){return this.values[key]??null;}};await formElement.props.onSubmit({preventDefault(){},currentTarget:{values:{note:'Explicit pending receipt'}},nativeEvent:{submitter:{getAttribute:()=> 'accept'}}});}finally{globalThis.FormData=nativeFormData;}
 assert.equal(errors.length,1,'A successful subsequent submission must not add an error');assert.equal(sent.length,2);assert.deepEqual(sent[1],sent[0]);assert.equal(f.handoff.data.phase,'acceptance','The form itself must not optimistically mark receipt complete');
 f.handoff.ownerId='incoming';f.handoff.revision=2;f.handoff.data.phase='open';f.handoff.data.closingHandoff={outgoingId:'worker',acceptedBy:'incoming',acceptedAt:now};html=render(FollowDetail,{...p,record:f.handoff});fs.writeFileSync(evidenceDir+'/incoming-received-still-open.html',html);assert.match(html,/Incoming work ready for physical check/);assert.match(html,/Received by Fictional incoming/);assert.doesNotMatch(html,/Accept handoff|Physical check passed/);record('Pending receipt error surfaces, receipt remains available, and accepted work is a separate open responsibility',{boundary:'Form callback only; full shell request retry not mounted'});
});
