import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Compile into this suite's own directory so parallel source checks cannot replace
// another review's shared modules. These checks use the actual model and fixture.
const output=path.resolve('.sites-runtime/role-home-acceptance'),visited=new Set();
function compile(file){
 if(visited.has(file))return;visited.add(file);
 const destination=path.join(output,path.relative(path.resolve('app'),file).replace(/\.tsx?$/,'.mjs'));
 let js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 js=js.replace(/import ['"][^'"]+\.css['"];?/g,'').replace(/from (['"])(\.\.?\/[^'"]+)\1/g,(_,quote,specifier)=>{
  const base=path.resolve(path.dirname(file),specifier),dependency=['.ts','.tsx'].map(ext=>base+ext).find(candidate=>fs.existsSync(candidate));
  if(!dependency)throw new Error('Missing acceptance dependency: '+base);
  compile(dependency);return `from ${quote}${specifier}.mjs${quote}`;
 });
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,js);
}
for(const source of ['app/shared/role-home.ts','app/team/role-home-fixture.ts','app/team/role-home.tsx'])compile(path.resolve(source));
const {buildRoleHome,buildOwnerHome}=await import(pathToFileURL(path.join(output,'shared/role-home.mjs')));
const {publicWorkspace}=await import(pathToFileURL(path.join(output,'shared/domain.mjs')));
const {createRoleReviewFixtures,roleReviewStores}=await import(pathToFileURL(path.join(output,'team/role-home-fixture.mjs')));
const {default:RoleHomesReview,RoleHomePanel,RoleHomeAttentionCard,roleReviewContext,resolveRoleReviewRecord}=await import(pathToFileURL(path.join(output,'team/role-home.mjs')));
const now=new Date('2026-09-30T21:00:00.000Z');
const fixtures=()=>createRoleReviewFixtures(now.toISOString());
const asPosition=(w,position)=>({...w,me:w.members.find(m=>m.position===position)});
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const entry of Object.values(value))freeze(entry);}return value;}

test('GM review uses a separate bounded membership rather than the owner source',()=>{
 const gm=roleReviewContext(now.toISOString(),'general-manager'),owner=roleReviewContext(now.toISOString(),'owner');
 assert.notEqual(gm.active.me.id,owner.active.me.id);
 assert.equal(gm.active.me.id,'role-review-berts-gm');
 assert.equal(gm.active.me.locationId,'berts');
 assert.deepEqual(gm.active.me.capabilities,['tasks.manage','operations.store']);
 assert.ok(owner.active.me.capabilities.includes('location.manage'));
 assert.deepEqual([...new Set(gm.model.attention.filter(i=>i.recordKind==='managerlog').map(i=>i.area))].sort(),['BOH','FOH']);
 assert.equal(gm.sources.length,1);
});

test('real preview fixtures preserve three restaurants with outdated Rudd’s and unavailable commissary',()=>{
 const workspaces=fixtures(),before=structuredClone(workspaces),home=buildOwnerHome(freeze(workspaces),now);
 assert.deepEqual(home.sources.map(s=>s.locationId).sort(),['berts','comm','papa','rudds']);
 assert.equal(home.sources.filter(s=>s.state==='available').length,2);
 assert.equal(home.sources.find(s=>s.locationId==='rudds').state,'stale');
 assert.equal(home.sources.find(s=>s.locationId==='comm').state,'unavailable');
 assert.ok(home.attention.some(i=>i.locationId==='comm'&&i.freshness.state==='unavailable'&&!i.recordId&&!i.actionable));
 assert.ok(home.attention.some(i=>i.locationId==='berts'&&i.area==='BOH'&&i.freshness.state==='missing'));
 assert.match(home.scopeLabel,/2 of 4/);
 assert.deepEqual(workspaces,before);
 for(const attention of home.attention.filter(i=>i.recordId)){
  const source=workspaces.find(w=>w.location.id===attention.locationId);
  const record=publicWorkspace(source,now.toISOString()).records.find(r=>r.id===attention.recordId);
  assert.ok(record,'Every home item retains an authorized original record');
  assert.equal(attention.recordKind,record.kind);assert.equal(attention.source.revision,record.revision);
 }
});

test('presentation changes retain real fixture permissions and cannot reveal another department or restaurant',()=>{
 const w=asPosition(fixtures()[0],'Kitchen manager');
 const secret=w.records.find(r=>r.kind==='managerlog'&&r.area==='FOH');
 secret.data.title='FORBIDDEN_FOH_SECRET';
 w.records.push({...structuredClone(secret),id:'foreign-secret',locationId:'papa',area:'BOH',data:{...secret.data,title:'FORBIDDEN_FOREIGN_SECRET'}});
 const before=structuredClone(w),authorized=new Set(publicWorkspace(w,now.toISOString()).records.map(r=>r.id));
 freeze(w);
 for(const role of ['frontline','department-manager','general-manager','owner']){
  const home=buildRoleHome(w,role,now);
  assert.doesNotMatch(JSON.stringify(home),/FORBIDDEN_FOH_SECRET|FORBIDDEN_FOREIGN_SECRET/);
  for(const attention of home.attention.filter(i=>i.recordId))assert.ok(authorized.has(attention.recordId));
 }
 assert.deepEqual(w,before);
 const gm=buildRoleHome(w,'general-manager',now);
 assert.ok(gm.attention.some(i=>i.area==='FOH'&&i.freshness.state==='unavailable'&&!i.actionable));
});

test('Dishwasher fixture uses its own published assignment and inbox without invented task access',()=>{
 const w=asPosition(fixtures()[0],'Dishwasher'),home=buildRoleHome(w,'frontline',now);
 const records=home.attention.filter(i=>i.recordId),ids=records.map(i=>i.recordId);
 assert.ok(ids.includes('role-review-berts-Dishwasher-shift'));
 assert.ok(ids.includes('role-review-berts-Dishwasher-message'));
 assert.ok(!ids.some(id=>/Cook|Server/.test(id)));
 assert.ok(records.every(i=>['shift','message'].includes(i.recordKind)));
 assert.ok(home.attention.some(i=>i.freshness.state==='unavailable'&&/instructions/i.test(i.what)&&!i.actionable));
 assert.deepEqual(w.me.capabilities,[]);
});

test('partial owner evidence reports missing locations instead of manufacturing records or finance',()=>{
 const workspaces=fixtures();
 const expected=roleReviewStores.map(store=>({locationId:store.id,locationName:store.name}));
 const home=buildOwnerHome([workspaces[0]],now,expected);
 assert.equal(home.sources.length,4);assert.equal(home.sources.filter(s=>s.state==='missing').length,3);
 assert.match(home.scopeLabel,/1 of 4/);
 assert.ok(home.attention.filter(i=>i.locationId!=='berts').every(i=>!i.recordId&&!i.actionable&&i.freshness.state==='missing'));
 assert.doesNotMatch(JSON.stringify(home),/\$\s*\d|all clear|all locations ready|profit.{0,12}\d|revenue.{0,12}\d/i);
});

test('all four actual homes render their distinct scope with fictional and financial evidence boundaries',t=>{
 const previousFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=previousFetch;});
 globalThis.fetch=()=>{throw new Error('A local role preview must not contact a service.');};
 for(const [role,title] of [['owner','Our restaurants and commissary'],['general-manager','My restaurant today'],['department-manager','My department today'],['frontline','My position today']]){
  const html=renderToStaticMarkup(React.createElement(RoleHomesReview,{now:now.toISOString(),initialRole:role}));
  assert.match(html,new RegExp(`data-role="${role}"`));assert.ok(html.includes(title));
  assert.match(html,/LOCAL ROLE REVIEW/);assert.match(html,/Fictional personas and records/);
  assert.match(html,/Sales, labor cost and food-cost feeds are not supplied/);
  assert.match(html,/Availability is not readiness/);assert.match(html,/Selections change this fictional review only/);
  assert.doesNotMatch(html,/\$\s*\d/);
  if(role==='owner'){assert.match(html,/2 \/ 4/);assert.match(html,/Source outdated/);assert.match(html,/Source unavailable/);assert.match(html,/Commissary/);}
  if(role==='general-manager'){assert.match(html,/FOH at a glance/);assert.match(html,/BOH at a glance/);assert.match(html,/distinct fictional account/);assert.doesNotMatch(html,/fictional broad-access account/);}
  if(role==='department-manager'){assert.match(html,/Dish rack wheel needs repair/);assert.doesNotMatch(html,/Opening handoff needs confirmation/);}
  if(role==='frontline'){assert.match(html,/Your dish area handoff/);assert.doesNotMatch(html,/Confirm your prep handoff|Review your section handoff|Opening handoff needs confirmation/);}
 }
});

test('actual card activation and record lookup preserve restaurant, kind, id and saved revision',()=>{
 for(const role of ['frontline','department-manager','general-manager','owner']){
  const context=roleReviewContext(now.toISOString(),role),before=structuredClone(context.sources);
  for(const item of context.model.attention.filter(item=>item.actionable)){
   const record=resolveRoleReviewRecord(context.sources,item);
   assert.ok(record);assert.equal(record.id,item.recordId);assert.equal(record.kind,item.recordKind);
   assert.equal(record.locationId,item.locationId);assert.equal(record.revision,item.source.revision);
   let opened=null;const tree=RoleHomeAttentionCard({item,onOpen:value=>{opened=value;}});
   const buttons=[];
   function visit(node){if(!node||typeof node!=='object')return;if(node.type==='button')buttons.push(node);React.Children.forEach(node.props?.children,visit);}
   visit(tree);assert.equal(buttons.length,1);buttons[0].props.onClick();assert.strictEqual(opened,item);
  }
  assert.deepEqual(context.sources,before,'Opening read-only records must not write history or change source data');
 }
});

test('record lookup refuses changed restaurant, record kind, missing and unauthorized targets',()=>{
 const context=roleReviewContext(now.toISOString(),'department-manager'),item=context.model.attention.find(i=>i.recordId);
 assert.ok(item);
 assert.equal(resolveRoleReviewRecord(context.sources,{...item,locationId:'papa'}),null);
 assert.equal(resolveRoleReviewRecord(context.sources,{...item,recordKind:'message'}),null);
 assert.equal(resolveRoleReviewRecord(context.sources,{...item,recordId:'role-review-berts-handoff'}),null,'BOH manager cannot open the FOH issue');
 assert.equal(resolveRoleReviewRecord(context.sources,{...item,recordId:'missing'}),null);
 const unavailable=structuredClone(context.sources);unavailable[0].roleHomeSource.state='unavailable';
 assert.equal(resolveRoleReviewRecord(unavailable,item),null);
 for(const gap of context.model.attention.filter(i=>!i.recordId)){
  assert.equal(resolveRoleReviewRecord(context.sources,gap),null);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(RoleHomeAttentionCard,{item:gap})),/<button/);
 }
});

test('read-only inbox lookup preserves the existing field-level redaction of unavailable attached instructions',()=>{
 const context=roleReviewContext(now.toISOString(),'frontline'),item=context.model.attention.find(i=>i.recordKind==='message');
 const message=context.sources[0].records.find(r=>r.id===item.recordId);
 message.data.context={recordId:'unavailable-guide',kind:'standard',standardId:'unavailable-guide',revision:1,standardRevision:1,instruction:{title:'RESTRICTED_GUIDE_DETAIL'}};
 const before=structuredClone(context.sources),expected=publicWorkspace(context.sources[0],now.toISOString()).records.find(r=>r.id===item.recordId);
 assert.equal(expected.data.context,undefined);
 const record=resolveRoleReviewRecord(context.sources,item);
 assert.equal(record.id,message.id);assert.deepEqual(record,expected);
 assert.doesNotMatch(JSON.stringify(record),/RESTRICTED_GUIDE_DETAIL/);
 assert.deepEqual(context.sources,before);
});

test('an empty rendered panel asks for source evidence instead of reporting completion',()=>{
 const model={...buildOwnerHome([],now),attention:[],priorities:[]};
 const html=renderToStaticMarkup(React.createElement(RoleHomePanel,{model}));
 assert.match(html,/No attention items were supplied/);assert.match(html,/Confirm the source coverage/);
 assert.doesNotMatch(html,/all clear|all done|everything is ready/i);
});

test('an explicitly outdated restaurant source cannot expose its old records as current or openable work',()=>{
 const sources=fixtures(),rudds=sources.find(w=>w.location.id==='rudds');
 const previous=structuredClone(rudds);previous.roleHomeSource={state:'available',label:'Earlier captured fixture'};
 const oldItem=buildRoleHome(previous,'owner',now).attention.find(i=>i.recordId);
 assert.ok(oldItem,'The captured source contains an older saved record for this regression');
 const asOf='2026-09-27T21:00:00.000Z';
 rudds.roleHomeSource={state:'stale',label:'The last supplied sample snapshot is outdated.',asOf};
 const home=buildOwnerHome(sources,now),source=home.sources.find(s=>s.locationId==='rudds');
 assert.equal(source.state,'stale');assert.equal(source.asOf,asOf);
 const items=home.attention.filter(i=>i.locationId==='rudds');assert.ok(items.length);
 assert.ok(items.every(i=>i.freshness.state==='stale'&&i.freshness.sourceAt===asOf&&!i.recordId&&!i.actionable));
 assert.equal(resolveRoleReviewRecord(sources,oldItem),null,'A formerly openable record cannot bypass a stale source');
 const html=renderToStaticMarkup(React.createElement(RoleHomePanel,{model:home}));
 assert.match(html,/Outdated evidence/);assert.doesNotMatch(html,/Oven service follow-up still open/);
});
