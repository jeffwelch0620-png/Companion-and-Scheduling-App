import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilities,has,manages} from '../.sites-runtime/shared/types.mjs';
import {capabilityLabels} from '../.sites-runtime/shared/access-types.mjs';
import {memberFromRow} from '../.sites-runtime/shared/service.mjs';
import {operationsManager} from '../.sites-runtime/shared/operations.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
import {managerHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {applyCommand,publicWorkspace,visible} from '../.sites-runtime/shared/domain.mjs';
import {foodManager} from '../.sites-runtime/shared/food.mjs';
import {myWork} from '../.sites-runtime/shared/my-work.mjs';
import {buildRoleHome} from '../.sites-runtime/shared/role-home.mjs';
import {buildShiftBrief} from '../.sites-runtime/shared/shift-brief.mjs';

const at='2026-09-30T18:00:00Z';
test('Dish checkout brief names incoming acceptance and gives explicitly authorized GM a bounded verification action',()=>{
 const f=fixture(),checkout=f.task('dish-checkout');checkout.data.phase='verification';checkout.data.dishCheckout={cycleId:'cycle',shift:'AM',participantIds:['dish','pm1','pm2'],businessDate:'2026-09-30'};
 const gm=buildShiftBrief(f.w,at).items.find(i=>i.record.id===checkout.id);assert.equal(gm.lane,'action');assert.equal(gm.next,'Check the completed work');
 const ordinary=f.task('ordinary');ordinary.data.phase='verification';assert.equal(buildShiftBrief(f.w,at).items.some(i=>i.record.id===ordinary.id),false,'Store operations authority does not open unrelated ordinary tasks');
 const incoming=f.task('incoming');incoming.data.phase='correction';incoming.data.dishHandoff={sourceId:'am',cycleId:'cycle',businessDate:'2026-09-30',acceptedBy:'',acceptedAt:null};
 const own=buildShiftBrief({...f.w,me:f.dish},at).items.find(i=>i.record.id===incoming.id);assert.equal(own.next,'Accept unfinished dish work');assert.equal(own.lane,'action');
 const pm=f.task('pm-checkout');pm.data.dishCheckout={cycleId:'cycle',shift:'PM',participantIds:['am','dish','pm2'],businessDate:'2026-09-30'};
 const blocked=buildShiftBrief({...f.w,me:f.dish},at).items.find(i=>i.record.id===pm.id);assert.equal(blocked.lane,'waiting');assert.equal(blocked.next,'Finish the incoming dish work first');
});
function fixture(){
 const member=(id,area,position,capabilities=[])=>({id,locationId:'store-a',name:'Fictional '+id,area,position,capabilities,qualifications:[position]});
 const gm=member('gm','Executive','General manager',['tasks.manage','operations.store']);
 const boh=member('boh','BOH','Manager',['tasks.manage']),foh=member('foh','FOH','Manager',['tasks.manage']),dish=member('dish','BOH','Dishwasher'),cook=member('cook','BOH','Cook');
 const w={location:{id:'store-a',name:'Fictional restaurant',timezone:'America/New_York',revision:1},me:gm,members:[gm,boh,foh,dish,cook],records:[]};
 const add=(id,kind,ownerId,area,data,extra={})=>{const r={id,locationId:w.location.id,ownerId,area,kind,data,revision:1,updatedAt:at,...extra};w.records.push(r);return r;};
 const issue=(id,area,ownerId=gm.id)=>add(id,'managerlog',ownerId,area,{title:id,detail:'Recorded work',category:'Other',priority:'routine',due:at,status:'open',acceptedBy:'',resolution:'',history:[]});
 const task=(id,ownerId=dish.id,kind='task')=>add(id,'task',ownerId,'BOH',{title:id,detail:'Defined work',kind,phase:'open',due:at,history:[]});
 const guide=(id,position='Dishwasher',status='approved',area='BOH')=>add(id,'standard',boh.id,area,{title:id,position,status,zone:'Station',criteria:['Reviewed instruction'],source:'Fictional reviewed source',version:1,verification:'manager',validationNote:'Reviewed',history:[]});
 let id=0;
 const command=(actor,action,input={},record)=>applyCommand({...w,me:actor},{requestId:'request-'+(++id),locationId:w.location.id,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})},at,()=>`created-${++id}`);
 return {w,gm,boh,foh,dish,cook,add,issue,task,guide,command};
}
const forbidden=(fn,status=403)=>assert.throws(fn,error=>error.status===status);

test('operations.store persists as a validated capability with an explicit label',()=>{
 assert.ok(capabilities.includes('operations.store'));
 assert.equal(Object.keys(capabilityLabels).length,capabilities.length);
 const m=memberFromRow({id:'gm',location_id:'store-a',name:'Fictional GM',area:'Executive',position:'General manager',capabilities:'["tasks.manage","operations.store"]',qualifications:'[]'});
 assert.deepEqual(m.capabilities,['tasks.manage','operations.store']);
});

test('whole-store operating scope requires both capabilities, preserves local scope, and grants no admin or unrelated permissions',()=>{
 const {gm}=fixture();
 for(const area of ['FOH','BOH'])assert.equal(operationsManager(gm,area),true);
 for(const area of ['production','combined'])assert.equal(operationsManager(gm,area),false);
 for(const capabilities of [[],['operations.store'],['tasks.manage']])assert.equal(operationsManager({...gm,capabilities},'BOH'),false);
 assert.equal(operationsManager({...gm,area:'production'},'production'),true,'Existing same-area tasks authority is preserved');
 assert.equal(operationsManager({...gm,position:'Dishwasher'},'BOH'),false);
 for(const cap of ['location.manage','people.manage','people.approve','schedule.manage','schedule.publish','schedule.change','orders.request','orders.review'])assert.equal(has(gm,cap),false);
 assert.equal(manages(gm,'BOH','tasks.manage'),false,'Generic capability scope is unchanged');
 assert.equal(foodManager(gm),true,'Explicit GM can back up BOH Food and prep management');
 const renamed={...gm,name:'Employee',position:'Cook'};assert.equal(operationsManager(renamed,'FOH'),true,'Explicit grants, not title, establish scope');
});

test('GM original membership sees and works both department logs but not foreign or private records',()=>{
 const f=fixture(),front=f.issue('front','FOH'),back=f.issue('back','BOH'),foreign=f.issue('foreign','BOH');foreign.locationId='store-b';
 f.add('private','meeting',f.boh.id,'BOH',{title:'Private coaching',managerId:f.boh.id,cadenceDays:14,due:at,agenda:'Private',status:'active',actions:[],sessions:[],history:[]});
 assert.deepEqual(publicWorkspace(f.w,at).records.map(r=>r.id).sort(),['back','front']);
 for(const r of [front,back])assert.equal(f.command(f.gm,'managerlog.note',{note:'GM recorded next action'},r).find(x=>x.id===r.id).revision,2);
 forbidden(()=>f.command(f.gm,'managerlog.note',{note:'Wrong store'},foreign),404);
 assert.equal(visible(back,{...f.gm,capabilities:['operations.store']},f.w,at),false,'Revocation removes access');
});

test('departmental manager can reassign its original issue to explicitly authorized store GM',()=>{
 const f=fixture(),r=f.issue('front','FOH',f.foh.id);
 const changed=f.command(f.foh,'managerlog.reassign',{ownerId:f.gm.id,due:at,note:'GM is handling this'},r).find(x=>x.id===r.id);
 assert.equal(changed.ownerId,f.gm.id);assert.equal(changed.area,'FOH');assert.equal(changed.revision,2);
});

test('whole-store home and handoff include both department history without fake combined or production evidence',()=>{
 const f=fixture();
 for(const area of ['FOH','BOH'])f.add('summary-'+area,'shiftentry',f.gm.id,area,{title:area+' summary',businessDate:'2026-09-29',shift:'closing',department:area,status:'submitted',readiness:'ready',summary:'Reviewed',tomorrowNote:'Follow up',issueIds:[],submittedAt:'2026-09-30T02:00:00Z',history:[],versions:[]});
 assert.deepEqual(operationsHome(f.w,at).handoffs.map(h=>h.area).sort(),['BOH','FOH']);
 assert.deepEqual(managerHandoff(f.w,'2026-09-30').previous_handoffs.map(h=>h.department).sort(),['BOH','FOH']);
 const home=buildRoleHome(f.w,'general-manager',new Date(at));
 assert.deepEqual(home.attention.filter(x=>x.recordKind==='shiftentry').map(x=>x.area).sort(),['BOH','FOH']);
 assert.equal(home.attention.some(x=>['combined','production'].includes(x.area)),false);
 assert.ok(home.assumptions.some(s=>s.includes('explicit operations.store')));
 assert.equal(home.assumptions.some(s=>s.includes('mapping remains to connect')),false);
 const admin={...f.gm,id:'admin',area:'Executive',capabilities:['location.manage']};
 const ownerWorkspace={...f.w,me:admin,members:[...f.w.members.map(m=>m.id===f.gm.id?{...m,area:'combined'}:m),admin]};
 assert.equal(buildRoleHome(ownerWorkspace,'owner',new Date(at)).attention.some(x=>x.area==='combined'),false,'A store-wide GM membership is not a combined operating department');
 assert.equal(operationsHome(ownerWorkspace,at).handoffs.some(x=>x.area==='combined'),false);
});

test('Dishwasher reads only own plain task and approved Dishwasher instructions, retaining other record boundaries',()=>{
 const f=fixture();f.w.me=f.dish;
 f.task('own');f.task('someone-else',f.cook.id);f.task('handoff-own',f.dish.id,'handoff');
 f.guide('approved-dish');f.guide('draft-dish','Dishwasher','draft');f.guide('cook-guide','Cook');f.guide('foh-dish','Dishwasher','approved','FOH');
 const foreign=f.guide('foreign-dish');foreign.locationId='store-b';
 f.add('closing','close',f.dish.id,'BOH',{managerId:f.boh.id,standardId:'approved-dish',phase:'open'});
 const scoped=publicWorkspace(f.w,at);
 assert.deepEqual(scoped.records.map(r=>r.id).sort(),['approved-dish','own']);
 const work=myWork(scoped,at);assert.deepEqual(work.guides.map(r=>r.id),['approved-dish']);assert.deepEqual(work.duties.map(d=>d.record.id),['own']);
 const home=buildRoleHome(f.w,'frontline',new Date(at));
 assert.ok(home.attention.some(x=>x.recordId==='own'&&x.tab==='Legacy duties'));
 assert.ok(home.attention.some(x=>x.recordId==='approved-dish'&&x.tab==='Training'));
 assert.equal(home.attention.some(x=>x.id.endsWith(':gap:dish-work')),false);
});

test('Dishwasher reports own task ready with exact revision and history, never verifies or gains management actions',()=>{
 const f=fixture(),r=f.task('own');
 const changed=f.command(f.dish,'task.transition',{step:'ready',note:'Finished assigned work'},r).find(x=>x.id===r.id);
 assert.equal(changed.id,r.id);assert.equal(changed.revision,2);assert.equal(changed.data.phase,'verification');assert.equal(changed.data.history.at(-1).actorId,f.dish.id);
 for(const step of ['fix','verify','accept','dispute'])forbidden(()=>f.command(f.dish,'task.transition',{step,note:'No authority'},r));
 forbidden(()=>f.command(f.dish,'task.reassign',{ownerId:f.cook.id,note:'No authority'},r));
 forbidden(()=>f.command(f.dish,'task.create',{ownerId:f.cook.id}));
 forbidden(()=>f.command(f.dish,'task.transition',{step:'ready',note:'Old revision'},{...r,revision:0}),409);
 forbidden(()=>f.command(f.dish,'task.transition',{step:'ready',note:'Other person'},f.task('other',f.cook.id)),404);
 const guide=f.guide('approved-dish');forbidden(()=>f.command(f.dish,'standard.retire',{note:'Not allowed'},guide));
});
