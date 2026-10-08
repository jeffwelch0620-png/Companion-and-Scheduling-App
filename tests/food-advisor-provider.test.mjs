import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredFoodAdvisorProvider} from '../.sites-runtime/shared/food-advisor-provider.mjs';
const scope={locationId:'berts',dataset:'operating',sourceRestaurantId:'canonical-berts',foodRevision:4};
const config={FOOD_ADVISOR_SOURCE_URL:'https://food.example.test',FOOD_ADVISOR_SOURCE_TOKEN:'fictional-server-token',FOOD_ADVISOR_RESTAURANT_BINDINGS:JSON.stringify({berts:'canonical-berts'})};
const snapshot=()=>({restaurantId:'canonical-berts',revision:'source-revision',generatedAt:'2026-10-07T20:00:00Z',sparse:false,recommendations:[{id:'advice',restaurantId:'canonical-berts',recipeId:'source-ranch',recipeName:'Ranch',currentPar:6,recommendedPar:5,reasoning:'Fictional history for connector test',status:'pending',createdAt:'2026-10-07T19:00:00Z',unit:'gal',shelfLife:'5 days',shelfLifeDays:5,shelfLifeSource:'recipe',sourceCurrent:true}],portionMappings:[]});
test('unconfigured advisor is unavailable and never contacts a source',()=>{
 assert.equal(configuredFoodAdvisorProvider({},()=>{throw Error('must not fetch');}),undefined);
});
test('server binding and token select the source without exposing credentials in the snapshot',async()=>{
 let request;const p=configuredFoodAdvisorProvider(config,async(url,init)=>{request={url:String(url),init};return Response.json(snapshot());});
 const result=await p.load(scope);assert.equal(request.url,'https://food.example.test/api/integration/food-advisor/canonical-berts');assert.equal(request.init.headers.Authorization,'Bearer fictional-server-token');assert.equal(request.init.redirect,'error');assert.equal(result.recommendations[0].sourceCurrent,true);assert.ok(!JSON.stringify(result).includes('fictional-server-token'));
});
test('foreign restaurant, demo dataset and invalid source configuration cannot fetch',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json(snapshot());};
 for(const s of [{...scope,sourceRestaurantId:'foreign'},{...scope,dataset:'demo'},{...scope,locationId:'rudds'}])await assert.rejects(configuredFoodAdvisorProvider(config,fetcher).load(s));
 for(const url of ['http://remote.example.test','https://user:password@food.example.test','https://food.example.test?token=x'])await assert.rejects(configuredFoodAdvisorProvider({...config,FOOD_ADVISOR_SOURCE_URL:url},fetcher).load(scope));assert.equal(calls,0);
});
test('wrong scope, missing provenance and invalid shelf-life responses fail closed',async()=>{
 for(const mutate of [s=>{s.restaurantId='foreign';},s=>{delete s.recommendations[0].sourceCurrent;},s=>{s.recommendations[0].shelfLifeSource='guessed';},s=>{s.recommendations[0].shelfLifeDays=-1;},s=>{s.generatedAt='unknown';}]){const s=snapshot();mutate(s);await assert.rejects(configuredFoodAdvisorProvider(config,async()=>Response.json(s)).load(scope));}
});
test('source refusal and oversized streamed responses cannot become recommendations',async()=>{
 await assert.rejects(configuredFoodAdvisorProvider(config,async()=>new Response('source refused',{status:403})).load(scope));
 await assert.rejects(configuredFoodAdvisorProvider(config,async()=>new Response('x'.repeat(524289))).load(scope));
});
test('old advice and unknown recipe duration remain explicitly reviewable rather than relabeled current',async()=>{
 const s=snapshot();s.recommendations[0].sourceCurrent=false;s.recommendations[0].shelfLife='unknown';s.recommendations[0].shelfLifeDays=null;
 const result=await configuredFoodAdvisorProvider(config,async()=>Response.json(s)).load(scope);assert.equal(result.recommendations[0].sourceCurrent,false);assert.equal(result.recommendations[0].shelfLifeDays,null);
});
