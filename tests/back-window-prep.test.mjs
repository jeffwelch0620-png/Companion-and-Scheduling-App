import test from 'node:test';
import assert from 'node:assert/strict';
import {backWindowItems,estimateBackWindowCups,planBackWindowPrep} from '../.sites-runtime/shared/back-window-prep.mjs';
const input={itemId:'ranch',forecastUsageCups:30,bufferCups:5,usableCups:20};

test('owner references cover eight 3.25 oz portion cups without inventing demand',()=>{
 assert.equal(backWindowItems.length,8);assert.ok(backWindowItems.every(i=>i.cupSizeOz===3.25));
 assert.equal(backWindowItems.find(i=>i.id==='ranch').referenceParCups,100);assert.equal(backWindowItems.find(i=>i.id==='honey-mustard').referenceParCups,50);
 assert.ok(backWindowItems.filter(i=>!['ranch','honey-mustard'].includes(i.id)).every(i=>i.referenceParCups===15));
});
test('full and partial pans estimate counts of stored portion cups',()=>{
 assert.equal(estimateBackWindowCups({container:'deep-half',fullPans:1,partialPanFraction:0.5}).usableCups,75);
 assert.equal(estimateBackWindowCups({container:'sixth',fullPans:0,partialPanFraction:0.5}).usableCups,7.5);
 assert.equal(estimateBackWindowCups({container:'deep-half',fullPans:0,partialPanFraction:0}).usableCups,0);
});
test('unknown pan counts remain review items rather than turning into zero',()=>{
 for(const count of [{container:'deep-half',fullPans:null,partialPanFraction:0},{container:'sixth',fullPans:0,partialPanFraction:null},{container:'unknown',fullPans:0,partialPanFraction:0},{container:'sixth',fullPans:0.5,partialPanFraction:0},{container:'sixth',fullPans:0,partialPanFraction:1.1}])assert.equal(estimateBackWindowCups(count).status,'needs-review');
});
test('recommendation uses expected consumption plus explicit buffer minus usable cups',()=>{
 const result=planBackWindowPrep(input);assert.equal(result.status,'ready');assert.equal(result.neededCups,15);assert.equal(result.recommendedCups,15);assert.equal(result.referenceParCups,100);
 assert.equal(planBackWindowPrep({...input,forecastUsageCups:0,bufferCups:0,usableCups:0}).recommendedCups,0);
 assert.equal(planBackWindowPrep({...input,usableCups:70}).recommendedCups,0);
});
test('reference par is never an automatic fill target or cap',()=>{
 assert.equal(planBackWindowPrep({...input,forecastUsageCups:8,bufferCups:0,usableCups:5}).recommendedCups,3);
 assert.equal(planBackWindowPrep({...input,forecastUsageCups:150,bufferCups:0,usableCups:10}).recommendedCups,140);
});
test('unknown required inputs and invalid quantities require review',()=>{
 for(const field of ['forecastUsageCups','bufferCups','usableCups'])for(const value of [null,undefined,-1,NaN,Infinity,'0'])assert.equal(planBackWindowPrep({...input,[field]:value}).status,'needs-review');
 assert.equal(planBackWindowPrep({...input,itemId:'unknown'}).status,'needs-review');
});
test('optional practical batch applies only when explicitly supplied and prep is needed',()=>{
 assert.equal(planBackWindowPrep({...input,minimumPracticalBatchCups:25}).recommendedCups,25);
 assert.equal(planBackWindowPrep({...input,usableCups:50,minimumPracticalBatchCups:25}).recommendedCups,0);
 for(const value of [null,0,-1,2.5,NaN])assert.equal(planBackWindowPrep({...input,minimumPracticalBatchCups:value}).status,'needs-review');
});
test('partial cup estimates round only final required production upward and mutate no inputs',()=>{
 const value={...input,forecastUsageCups:15,bufferCups:0,usableCups:7.5},before=JSON.stringify(value);
 assert.equal(planBackWindowPrep(value).recommendedCups,8);assert.equal(JSON.stringify(value),before);
});
