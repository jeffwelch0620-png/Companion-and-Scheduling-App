import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedCommissaryFoodLocations,verifiedCommissaryFoodContext} from '../.sites-runtime/shared/commissary-food-context.mjs';
import {createWorkspaceLoader,restaurantPreference} from '../.sites-runtime/shared/workspace-context.mjs';
const target={id:'comm-berts',locationId:'berts',locationName:"Bert's"};
const food={commissaryOnly:true,location:{id:'berts',name:"Bert's",timezone:'America/New_York'},me:{id:'comm-berts',name:'Food worker',capabilities:['tasks.manage']}};
test('Food context requires exact destination membership and an explicit scoped grant',()=>{
 assert.equal(verifiedCommissaryFoodContext(food,target),food);
 for(const value of [{...food,commissaryOnly:false},{...food,location:{...food.location,id:'papa'}},{...food,me:{...food.me,id:'other-person'}},{...food,me:null},{...food,location:null},null])assert.throws(()=>verifiedCommissaryFoodContext(value,target),/scope could not be verified/);
});
test('Papa is excluded even if a malformed metadata response offers a matching membership',()=>{
 const papa={...target,id:'comm-papa',locationId:'papa',locationName:"Papa's"};
 assert.deepEqual(approvedCommissaryFoodLocations([target,papa]),[target]);
 assert.throws(()=>verifiedCommissaryFoodContext({...food,location:{...food.location,id:'papa'},me:{...food.me,id:'comm-papa'}},papa),/scope could not be verified/);
});
test('approved commissary Food destinations do not become selectable personnel workspaces',async()=>{
 const home={id:'comm-home',locationId:'comm',locationName:'Commissary',name:'Worker',position:'Prep'};
 const calls=[];const loader=createWorkspaceLoader({memberships:async()=>({memberships:[home],commissaryFoodLocations:[target]}),workspace:async id=>{calls.push(id);return {location:{id},me:{id:home.id}}},preference:restaurantPreference('/api',()=>({getItem:()=>null,setItem:()=>{},removeItem:()=>{}}))});
 const result=await loader.load();assert.equal(result.workspace.location.id,'comm');assert.deepEqual(result.commissaryFoodLocations,[target]);assert.deepEqual(result.memberships,[home]);
 await assert.rejects(()=>loader.load('berts'),/access.*no longer available/);assert.deepEqual(calls,['comm']);
});
