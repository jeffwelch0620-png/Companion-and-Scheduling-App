import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRoleHomeTarget,authorizedRoleHomeKind,parseRoleHomeKind,completedOwnRoleHomeTasks} from '../.sites-runtime/shared/role-home-target.mjs';
import {buildRoleHome} from '../.sites-runtime/shared/role-home.mjs';
const now=new Date('2026-09-30T18:00:00Z');
test('completed own assignments reopen canonical history without exposing other work or treating them as outstanding',()=>{
 const f=fixture();f.w.me={...f.w.me,id:'dish',position:'Dishwasher',capabilities:[]};f.w.members=[f.w.me];
 const history=[{action:'assigned',actorId:'manager'},{action:'ready',actorId:'dish'},{action:'verify',actorId:'manager'}];
 const own=f.add('task',{title:'Verified rack check',detail:'Done',kind:'task',phase:'closed',due:now.toISOString(),history},{ownerId:'dish'});
 const other={...own,id:'other',ownerId:'other'},issue={...own,id:'issue',data:{...own.data,kind:'issue'}},handoff={...own,id:'handoff',data:{...own.data,kind:'handoff'}},foreign={...own,id:'foreign',locationId:'papa'},open={...own,id:'open',data:{...own.data,phase:'open'}};
 f.w.records.push(other,issue,handoff,foreign,open);
 const before=JSON.stringify(f.w),cards=completedOwnRoleHomeTasks(f.w,now);
 assert.deepEqual(cards.map(c=>c.recordId),[own.id]);
 const target=resolveRoleHomeTarget(f.w,cards[0],now);
 assert.equal(target.record.id,own.id);assert.equal(target.record.revision,3);assert.deepEqual(target.record.data.history,history);
 assert.equal(buildRoleHome(f.w,'frontline',now).attention.some(c=>c.recordId===own.id),false);
 assert.throws(()=>resolveRoleHomeTarget({...f.w,records:f.w.records.map(r=>r.id===own.id?{...r,revision:4}:r)},cards[0],now),e=>e.code==='changed');
 assert.deepEqual(completedOwnRoleHomeTasks({...f.w,roleHomeSource:{state:'unavailable'}},now),[]);
 assert.equal(JSON.stringify(f.w),before);
});
function fixture(){
 const me={id:'manager',locationId:'berts',name:'Fictional manager',area:'BOH',position:'Kitchen manager',capabilities:['tasks.manage','orders.request'],qualifications:[]};
 const w={location:{id:'berts',name:'Fictional Berts',timezone:'America/New_York',revision:1},me,members:[me],records:[]};
 const add=(kind,data,extra={})=>{const record={id:'original-'+kind,kind,locationId:'berts',ownerId:me.id,area:'BOH',revision:3,updatedAt:now.toISOString(),data,...extra};w.records.push(record);return record;};
 const card=(record,tab)=>({id:'card-'+record.id,recordId:record.id,recordKind:record.kind,locationId:record.locationId,actionable:true,tab,source:{recordId:record.id,revision:record.revision}});
 return {w,add,card};
}
test('issue and summary links retain original identity, version and destination mode',()=>{
 const f=fixture(),issue=f.add('managerlog',{title:'Repair',detail:'Inspect wheel',category:'Maintenance',priority:'routine',due:null,status:'open',acceptedBy:'',resolution:'',history:[]});
 const summary=f.add('shiftentry',{title:'Close',businessDate:'2026-09-29',department:'BOH',shift:'closing',status:'submitted',readiness:'not-assessed',summary:'Saved handoff',tomorrowNote:'Inspect wheel',issueIds:[],submittedAt:now.toISOString(),versions:[],history:[]});
 const a=resolveRoleHomeTarget(f.w,f.card(issue,'Manager Log'),now),b=resolveRoleHomeTarget(f.w,f.card(summary,'Manager Log'),now);
 assert.equal(a.mode,'issue');assert.equal(a.record.id,issue.id);assert.equal(a.record.revision,3);
 assert.equal(b.mode,'summary');assert.equal(b.record.data.businessDate,'2026-09-29');assert.equal(b.record.area,'BOH');
});
test('wrong restaurant, kind, target tab and source identity cannot resolve a workflow',()=>{
 const f=fixture(),task=f.add('task',{title:'Assigned work',detail:'Definition',kind:'task',phase:'open',due:now.toISOString(),history:[]}),card=f.card(task,'Legacy duties');
 for(const invalid of [{locationId:'papa'},{recordKind:'message'},{tab:'Employee access'},{source:{recordId:'other',revision:3}},{recordId:'missing'},{actionable:false}])assert.throws(()=>resolveRoleHomeTarget(f.w,{...card,...invalid},now),e=>e.code==='unavailable');
 assert.equal(resolveRoleHomeTarget(f.w,card,now).record.id,task.id);
});
test('changed and missing record revisions reject before opening',()=>{
 const f=fixture(),task=f.add('task',{title:'Work',detail:'Definition',kind:'task',phase:'open',due:now.toISOString(),history:[]}),card=f.card(task,'Legacy duties');
 const before=JSON.stringify(f.w);for(const revision of [2,4,null,undefined])assert.throws(()=>resolveRoleHomeTarget(f.w,{...card,source:{...card.source,revision}},now),e=>e.code==='changed');
 assert.equal(JSON.stringify(f.w),before);
});
test('revoked department scope and unavailable sources reject original targets',()=>{
 const f=fixture(),issue=f.add('managerlog',{title:'Private BOH',detail:'Detail',category:'Other',priority:'routine',due:null,status:'open',acceptedBy:'',resolution:'',history:[]}),card=f.card(issue,'Manager Log');
 assert.throws(()=>resolveRoleHomeTarget({...f.w,me:{...f.w.me,area:'FOH'}},card,now),e=>e.code==='unavailable');
 for(const state of ['missing','unavailable','stale'])assert.throws(()=>resolveRoleHomeTarget({...f.w,roleHomeSource:{state}},card,now),e=>e.code==='unavailable');
});
test('Inbox target preserves field-level attachment redaction',()=>{
 const f=fixture();f.w.me={...f.w.me,id:'dish',position:'Dishwasher',capabilities:[]};f.w.members=[f.w.me];
 const message=f.add('message',{title:'Message',body:'Safe note',recipients:['dish'],readBy:[],replies:[],context:{recordId:'private-guide',revision:1,kind:'standard',capturedAt:now.toISOString(),standardId:'private-guide',standardRevision:1,instruction:{title:'Private',zone:'BOH',position:'Cook',version:1,source:'Private',criteria:['Private'],verification:'manager'},clarifications:[]}}, {ownerId:'manager'});
 const result=resolveRoleHomeTarget(f.w,f.card(message,'Inbox'),now);
 assert.equal(result.record.id,message.id);assert.equal(result.record.data.context,undefined);assert.equal(result.record.data.contextStatus,'unavailable');assert.equal(message.data.context.instruction.title,'Private');
});
test('Food-linked order uses Purchasing review; ordinary order uses original Orders detail',()=>{
 const f=fixture(),order=f.add('order',{lines:[],note:'Sample',status:'draft',history:[]});
 assert.equal(resolveRoleHomeTarget(f.w,f.card(order,'Orders'),now).mode,'detail');
 order.data.food={dataset:'demo',countDate:'2026-09-30',capturedAt:now.toISOString()};
 assert.throws(()=>resolveRoleHomeTarget(f.w,f.card(order,'Orders'),now),e=>e.code==='unavailable');
 const target=resolveRoleHomeTarget(f.w,f.card(order,'Purchasing review'),now);assert.equal(target.mode,'food-order');assert.equal(target.record.id,order.id);assert.equal(target.record.data.food.dataset,'demo');
});
test('role query is bounded by actual owner, GM, department and frontline authority',()=>{
 const f=fixture();assert.equal(parseRoleHomeKind('owner'),'owner');assert.equal(parseRoleHomeKind('admin'),'frontline');
 assert.equal(authorizedRoleHomeKind(f.w,'owner'),'department-manager');
 assert.equal(authorizedRoleHomeKind({...f.w,me:{...f.w.me,capabilities:[]}},'owner'),'frontline');
 assert.equal(authorizedRoleHomeKind({...f.w,me:{...f.w.me,capabilities:['tasks.manage','operations.store']}},'owner'),'general-manager');
 assert.equal(authorizedRoleHomeKind({...f.w,me:{...f.w.me,capabilities:['location.manage']}},'owner'),'owner');
 assert.equal(authorizedRoleHomeKind({...f.w,me:{...f.w.me,capabilities:['operations.store']}},'general-manager'),'frontline');
});
test('home feedback and Food purchasing cards resolve to usable existing workflows',()=>{
 const f=fixture();f.add('feedback',{text:'Feedback',shared:true,status:'follow-up',response:'Review',due:'2026-09-30T18:00:00Z',history:[]});
 f.add('order',{lines:[],note:'Sample',status:'draft',history:[],food:{dataset:'demo',countDate:'2026-09-30',capturedAt:now.toISOString()}});
 const home=buildRoleHome(f.w,'department-manager',now);
 const feedback=home.attention.find(i=>i.recordKind==='feedback'),purchase=home.attention.find(i=>i.recordKind==='order');
 assert.equal(feedback.tab,'Feedback');assert.equal(purchase.tab,'Purchasing review');
 assert.equal(resolveRoleHomeTarget(f.w,feedback,now).mode,'detail');assert.equal(resolveRoleHomeTarget(f.w,purchase,now).mode,'food-order');
});
