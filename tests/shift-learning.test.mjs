import test from 'node:test';
import assert from 'node:assert/strict';
import { guidesForShift } from '../.sites-runtime/shared/shift-learning.mjs';

const standard=(id,overrides={})=>({id,locationId:'berts',ownerId:'manager',area:'BOH',revision:1,kind:'standard',data:{title:id,position:'Grill',zone:'Grill',status:'approved',version:1,...overrides.data},...Object.fromEntries(Object.entries(overrides).filter(([k])=>k!=='data'))});
const shift={id:'shift',locationId:'berts',ownerId:'worker',area:'BOH',revision:1,kind:'shift',data:{position:'Grill',published:true,cancelled:false}};
const workspace=()=>({location:{id:'berts'},me:{id:'worker',locationId:'berts',area:'BOH',position:'Cook',capabilities:[],qualifications:[]},members:[],records:[standard('right'),standard('draft',{data:{status:'draft'}}),standard('retired',{data:{status:'retired'}}),standard('other-restaurant',{locationId:'rudds'}),standard('other-department',{area:'FOH'}),standard('other-station',{data:{position:'Fry'}})]});

test('shift shortcuts use approved sources for the exact restaurant, department and scheduled job',()=>{
  const w=workspace();assert.deepEqual(guidesForShift(w,shift).map(r=>r.id),['right']);
  assert.deepEqual(w.me.qualifications,[],'Viewing a guide must not grant clearance');
});
test('owner access does not attach another department source to a shift with the same station name',()=>{
  const w=workspace();w.me.capabilities=['location.manage'];assert.deepEqual(guidesForShift(w,shift).map(r=>r.id),['right']);
});
test('Dishwasher, cancelled shifts and another restaurant do not get training shortcuts',()=>{
  const w=workspace();assert.deepEqual(guidesForShift(w,{...shift,locationId:'rudds'}),[]);
  assert.deepEqual(guidesForShift(w,{...shift,data:{...shift.data,cancelled:true}}),[]);
  w.me.position='Dishwasher';w.me.capabilities=['location.manage'];assert.deepEqual(guidesForShift(w,shift),[]);
});
