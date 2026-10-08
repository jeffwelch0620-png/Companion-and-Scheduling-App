import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoleHome,buildOwnerHome} from '../.sites-runtime/shared/role-home.mjs';

const at=new Date('2026-09-30T18:00:00Z');
function fixture(locationId='store-a'){
 const member=(id,area,capabilities=[])=>({id,locationId,name:'Fixture '+id,area,position:'Manager',capabilities,qualifications:[]});
 const admin=member('admin','Executive',['location.manage']),foh=member('foh','FOH',['tasks.manage']),boh=member('boh','BOH',['tasks.manage']),employee={...member('employee','BOH'),position:'Cook'},dish={...member('dish','BOH'),position:'Dishwasher'};
 const w={location:{id:locationId,name:'Fictional '+locationId,timezone:'America/New_York',revision:1},me:admin,members:[admin,foh,boh,employee,dish],records:[]};
 const add=(id,kind,ownerId,area,data,extra={})=>{const r={id,kind,ownerId,area,locationId,revision:1,updatedAt:at.toISOString(),data,...extra};w.records.push(r);return r;};
 const issue=(id,area='BOH',extra={})=>add(id,'managerlog',area==='FOH'?'foh':'boh',area,{title:'Issue '+id,detail:'Recorded detail',category:'Other',priority:'routine',due:null,status:'open',acceptedBy:'',resolution:'',history:[],...extra});
 const shift=(id,person='employee',extra={})=>add(id,'shift',person,'BOH',{personId:person,position:person==='dish'?'Dishwasher':'Cook',stationName:'Fictional assigned station',start:'2026-09-30T17:00:00Z',end:'2026-10-01T01:00:00Z',published:true,cancelled:false,...extra});
 const summary=(id,area,date,status='submitted',extra={})=>add(id,'shiftentry',area==='FOH'?'foh':'boh',area,{title:'Summary '+id,businessDate:date,shift:'closing',department:area,status,readiness:'ready',summary:'Saved condition',tomorrowNote:'Check the next step',issueIds:[],submittedAt:status==='submitted'?at.toISOString():'',history:[],versions:[],...extra});
 return {w,admin,foh,boh,employee,dish,add,issue,shift,summary};
}
test('role presentation never expands the supplied membership, restaurant or private record scope',()=>{
 const f=fixture();f.issue('foh-visible','FOH');f.issue('boh-private');const foreign=f.issue('foreign');foreign.locationId='elsewhere';
 f.add('private-meeting','meeting','admin','FOH',{title:'PRIVATE coaching',managerId:'boh',status:'active',due:at.toISOString(),cadenceDays:14,agenda:'PRIVATE',actions:[],sessions:[],history:[]});
 f.w.me=f.foh;const before=JSON.stringify(f.w);
 for(const role of ['frontline','department-manager','general-manager','owner']){
  const home=buildRoleHome(f.w,role,at),json=JSON.stringify(home);
  assert.doesNotMatch(json,/Issue boh-private|Issue foreign|PRIVATE/);
  assert.equal(home.attention.some(i=>i.recordId==='foh-visible'),role!=='frontline');
 }
 const gm=buildRoleHome(f.w,'general-manager',at);assert.ok(gm.attention.some(i=>i.area==='BOH'&&i.freshness.state==='unavailable'));
 assert.equal(JSON.stringify(f.w),before);
});
test('the GM layout shows both permitted departments and discloses the source administration authority',()=>{
 const f=fixture();f.issue('front','FOH');f.issue('back','BOH');
 const home=buildRoleHome(f.w,'general-manager',at);
 assert.deepEqual(home.attention.filter(i=>i.recordKind==='managerlog').map(i=>i.area).sort(),['BOH','FOH']);
 assert.ok(home.assumptions.some(n=>n.includes('Dedicated GM permission mapping remains to connect')));
 assert.ok(home.assumptions.some(n=>n.includes('location.manage')));
 assert.equal(home.attention.some(i=>['combined','production'].includes(i.area)),false);
});
test('frontline uses only its own published assignment and flags overlapping assignments',()=>{
 const f=fixture();f.w.me=f.employee;f.shift('own');f.shift('someone-else','boh');f.shift('draft','employee',{published:false});
 let home=buildRoleHome(f.w,'frontline',at);assert.deepEqual(home.attention.filter(i=>i.recordKind==='shift').map(i=>i.recordId),['own']);assert.equal(home.priorities[0].recordId,'own','Own published position orients the home before source gaps');
 f.shift('overlap');home=buildRoleHome(f.w,'frontline',at);
 assert.equal(home.attention.some(i=>i.recordKind==='shift'),false);assert.ok(home.attention.some(i=>i.what==='Confirm your position'&&i.freshness.state==='changed'));
});
test('dishwasher has its own position, assigned task and Inbox without gaining manager permissions',()=>{
 const f=fixture();f.w.me=f.dish;f.shift('dish-shift','dish');
 f.add('dish-task','task','dish','BOH',{title:'Assigned dish task',detail:'Defined work',kind:'task',phase:'open',due:at.toISOString(),history:[]});
 f.add('other-task','task','employee','BOH',{title:'RESTRICTED task',detail:'Restricted',kind:'task',phase:'open',due:at.toISOString(),history:[]});
 f.add('note','message','boh','BOH',{title:'Your shift update',body:'See your manager',recipients:['dish'],readBy:[],replies:[]});
 const home=buildRoleHome(f.w,'frontline',at);
 assert.ok(home.attention.some(i=>i.recordId==='dish-shift'));assert.ok(home.attention.some(i=>i.recordId==='note'&&i.tab==='Inbox'));
 assert.ok(home.attention.some(i=>i.recordId==='dish-task'&&i.tab==='Legacy duties'));
 assert.doesNotMatch(JSON.stringify(home),/RESTRICTED task/);assert.ok(home.attention.some(i=>i.freshness.state==='unavailable'));
});
test('old handoff remains historical even after a recent edit and missing current evidence stays missing',()=>{
 const f=fixture();f.w.me=f.boh;f.summary('yesterday','BOH','2026-09-29');f.summary('draft','BOH','2026-09-30','draft');
 const home=buildRoleHome(f.w,'department-manager',at),old=home.attention.find(i=>i.recordId==='yesterday');
 assert.equal(old.freshness.state,'historical');assert.equal(old.source.businessDate,'2026-09-29');assert.match(old.freshness.label,/does not confirm today/);
 assert.ok(home.attention.some(i=>i.freshness.state==='missing'&&/draft/.test(i.why)));
});
test('summary freshness uses the restaurant local date and preserves not-assessed readiness',()=>{
 const f=fixture();f.w.me=f.boh;f.summary('local-day','BOH','2026-09-29','submitted',{readiness:'not-assessed'});
 const home=buildRoleHome(f.w,'department-manager',new Date('2026-09-30T02:00:00Z')),entry=home.attention.find(i=>i.recordId==='local-day');
 assert.equal(entry.freshness.state,'current');assert.equal(entry.source.businessDate,'2026-09-29');assert.match(entry.why,/not assessed/);assert.match(entry.freshness.label,/not a live readiness check/);
});
test('unassigned and urgent issues preserve exact original record identity',()=>{
 const f=fixture(),r=f.issue('urgent','BOH',{priority:'urgent'});r.ownerId='removed-person';
 const home=buildRoleHome(f.w,'general-manager',at),entry=home.priorities[0];
 assert.equal(entry.recordId,r.id);assert.equal(entry.source.revision,1);assert.equal(entry.tab,'Manager Log');assert.equal(entry.person,'Unassigned');assert.equal(entry.personId,null);assert.equal(entry.priority,'urgent');assert.match(entry.why,/no longer available/);
});
test('purchasing freshness follows the count business date instead of a recently saved order',()=>{
 const f=fixture();f.w.me={...f.admin,capabilities:['location.manage','orders.review']};
 f.add('purchase','order','employee','BOH',{lines:[],note:'Internal request',status:'review',history:[],food:{dataset:'demo',countDate:'2026-09-29',vendor:'Fictional supplier',totalCents:0,preparedByPrincipal:'fixture-only',capturedAt:at.toISOString()}});
 const entry=buildRoleHome(f.w,'general-manager',at).attention.find(i=>i.recordId==='purchase');
 assert.equal(entry.freshness.state,'historical');assert.equal(entry.source.businessDate,'2026-09-29');assert.equal(entry.person,'Unassigned');assert.match(entry.why,/Supplier placement is separate/);
 assert.doesNotMatch(JSON.stringify(entry),/fixture-only/);
});
test('owner aggregation keeps same record IDs distinct by restaurant and reports explicit missing/unavailable sources',()=>{
 const a=fixture('a'),b=fixture('b');a.issue('same-id');b.issue('same-id');
 const expected=[{locationId:'a',locationName:'Fictional a'},{locationId:'b',locationName:'Fictional b'},{locationId:'c',locationName:'Fictional c'},{locationId:'comm',locationName:'Fictional commissary',state:'unavailable',reason:'Source refresh failed.'}];
 const home=buildOwnerHome([a.w,b.w],at,expected);
 assert.equal(home.sources.length,4);assert.equal(home.sources.filter(s=>s.state==='available').length,2);assert.equal(home.attention.filter(i=>i.recordId==='same-id').length,2);
 assert.equal(new Set(home.attention.map(i=>i.id)).size,home.attention.length);assert.ok(home.sources.some(s=>s.locationId==='comm'&&s.state==='unavailable'));assert.ok(home.sources.some(s=>s.locationId==='c'&&s.state==='missing'));assert.match(home.scopeLabel,/2 of 4/);
 assert.equal(buildOwnerHome([a.w],at).sources.length,1,'No universal four-location assumption');
});
test('unavailable workspaces expose no records, duplicate sources do not inflate coverage, conflicting principals fail closed',()=>{
 const f=fixture();f.issue('SECRET unavailable');f.w.roleHomeSource={state:'unavailable',label:'Cannot refresh this source.'};
 const unavailable=buildOwnerHome([f.w],at);assert.doesNotMatch(JSON.stringify(unavailable),/SECRET/);assert.equal(unavailable.sources[0].state,'unavailable');
 delete f.w.roleHomeSource;assert.equal(buildOwnerHome([f.w,structuredClone(f.w)],at).sources.length,1);
 const conflict=structuredClone(f.w);conflict.me=f.boh;const home=buildOwnerHome([f.w,conflict],at);assert.equal(home.sources[0].state,'unavailable');assert.doesNotMatch(JSON.stringify(home),/SECRET/);
});
test('a mismatched membership and restaurant does not produce a home with records',()=>{
 const f=fixture();f.issue('SECRET mismatch');f.w.me={...f.admin,locationId:'different'};
 const home=buildRoleHome(f.w,'general-manager',at);assert.equal(home.sources[0].state,'unavailable');assert.doesNotMatch(JSON.stringify(home),/SECRET/);
});
test('a source-provided stale state makes coverage incomplete and preserves its evidence date',()=>{
 const current=fixture('current'),stale=fixture('old');stale.issue('OLD current-looking issue');
 stale.w.roleHomeSource={state:'stale',label:'The source has not supplied its required shift update.',asOf:'2026-09-27T18:00:00Z'};
 const home=buildOwnerHome([current.w,stale.w],at),row=home.attention.find(i=>i.locationId==='old');
 assert.match(home.scopeLabel,/1 of 2/);assert.equal(home.sources.find(s=>s.locationId==='old').state,'stale');
 assert.equal(row.freshness.state,'stale');assert.equal(row.freshness.sourceAt,'2026-09-27T18:00:00Z');assert.match(row.what,/outdated/);
 assert.equal(row.recordId,null);assert.doesNotMatch(JSON.stringify(home),/OLD current-looking issue/);assert.ok(home.missing.some(s=>/outdated/.test(s)));
});
test('owner readiness excludes combined administrator profiles and honors configured production scope',()=>{
 const restaurant=fixture();restaurant.admin.area='combined';
 const inferred=buildOwnerHome([restaurant.w],at);
 assert.deepEqual(inferred.attention.filter(i=>i.id.includes(':gap:summary-')).map(i=>i.area).sort(),['BOH','FOH']);
 restaurant.issue('actual-combined','combined');
 assert.ok(buildOwnerHome([restaurant.w],at).attention.some(i=>i.id.includes(':gap:summary-combined')),'Genuine combined operating records can establish a combined department');
 restaurant.w.roleHomeSource={state:'available',operatingAreas:['FOH','BOH']};
 assert.equal(buildOwnerHome([restaurant.w],at).attention.some(i=>i.id.includes(':gap:summary-combined')),false);
 const commissary=fixture('comm');commissary.w.roleHomeSource={state:'available',operatingAreas:['production']};
 assert.deepEqual(buildOwnerHome([commissary.w],at).attention.filter(i=>i.id.includes(':gap:summary-')).map(i=>i.area),['production']);
 commissary.w.me=commissary.boh;
 assert.equal(buildOwnerHome([commissary.w],at).attention.some(i=>i.id.includes(':gap:summary-production')),false,'Configured areas do not grant operating authority');
});
