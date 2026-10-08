import test from 'node:test';
import assert from 'node:assert/strict';
import {availableModules} from '../.sites-runtime/shared/operations-home.mjs';
import {foodDestination,foodWorkflowDestination} from '../.sites-runtime/shared/food-navigation.mjs';
const member=(area,capabilities,position='Manager')=>({id:'fictional',locationId:'berts',name:'Fictional reviewer',area,capabilities,position,qualifications:[]});
const owner=member('Executive',['location.manage']),buyer=member('FOH',['orders.review']),boh=member('BOH',['tasks.manage']);
const links=['Invoice CSV matching','Delivery checks','Supplier returns','Supplier issues','Restaurant transfers','Waste report'];
test('owner and purchaser directory destinations open the matching specialist Food view',()=>{
 for(const me of [owner,buyer])for(const tab of links){assert.ok(availableModules(me).some(m=>m.tab===tab));assert.ok(foodDestination(tab,me));}
 assert.equal(foodDestination('Food inventory',owner).view,'items');assert.equal(foodDestination('Food recipes',owner).recipesOnly,true);
 assert.equal(foodDestination('Invoice CSV matching',owner).view,'invoices');
 assert.equal(foodDestination('Restaurant transfers',owner).view,'transfers');
});
test('BOH manager can review deliveries and transfers but cannot enter purchaser-only invoice capture',()=>{
 const modules=availableModules(boh);assert.ok(modules.some(m=>m.tab==='Delivery checks'));assert.ok(modules.some(m=>m.tab==='Restaurant transfers'));
 assert.ok(!modules.some(m=>['invoice-lines','invoice-matching'].includes(m.id)));assert.equal(foodDestination('Invoice CSV matching',boh),null);
 for(const tab of links.slice(1))assert.ok(foodDestination(tab,boh));
});
test('FOH manager, employee and dishwasher do not gain Food access from a destination',()=>{
 for(const me of [member('FOH',['tasks.manage']),member('BOH',[]),member('BOH',['location.manage'],'Dishwasher')]){
  assert.ok(!availableModules(me).some(m=>m.tab&&foodDestination(m.tab,owner)));
  for(const tab of [...links,'Food inventory','Food recipes'])assert.equal(foodDestination(tab,me),null);
 }
 for(const tab of ['unknown','__proto__','constructor','toString'])assert.equal(foodDestination(tab,owner),null);
});
test('prep and purchasing destinations use exact existing food and ordering capabilities',()=>{
 const requester={...boh,capabilities:[...boh.capabilities,'orders.request']};
 for(const me of [owner,boh,requester]){
  assert.equal(foodWorkflowDestination('Prep production',me),'prep');
  assert.ok(availableModules(me).some(m=>m.id==='prep'&&m.tab==='Prep production'&&!m.pending));
 }
 for(const me of [buyer,requester]){
  assert.equal(foodWorkflowDestination('Purchasing review',me),'purchasing');
  assert.ok(availableModules(me).some(m=>m.id==='purchasing'&&m.tab==='Purchasing review'&&!m.pending));
 }
 assert.equal(foodWorkflowDestination('Purchasing review',owner),null,'location management does not imply ordering capability');
 assert.equal(foodWorkflowDestination('Purchasing review',boh),null,'prep management does not imply ordering capability');
 assert.equal(foodWorkflowDestination('Prep production',buyer),null,'order review does not imply prep management');
 for(const me of [member('FOH',['tasks.manage','orders.request']),member('BOH',[]),{...requester,scheduleOnly:true},member('BOH',['location.manage','orders.request','orders.review'],'Dishwasher')]){
  for(const tab of ['Prep production','Purchasing review'])assert.equal(foodWorkflowDestination(tab,me),null);
  assert.ok(!availableModules(me).some(m=>['prep','purchasing'].includes(m.id)));
 }
 for(const tab of ['unknown','__proto__','constructor','toString'])assert.equal(foodWorkflowDestination(tab,requester),null);
});
test('supplier submission and cross-restaurant consolidation remain explicit unmounted connections',()=>{
 const modules=availableModules({...owner,capabilities:['location.manage','orders.request','orders.review']});
 for(const id of ['supplier-submission','transfers']){const m=modules.find(m=>m.id===id);assert.ok(m.pending);assert.equal(m.tab,undefined);}
 assert.match(modules.find(m=>m.id==='supplier-submission').pending,/does not send or place a supplier order/);
 assert.match(modules.find(m=>m.id==='transfers').pending,/consolidation across restaurants/);
 for(const me of [boh,buyer])assert.ok(!availableModules(me).some(m=>m.id==='supplier-submission'));
});
