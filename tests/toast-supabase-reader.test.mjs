import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredToastDayReader} from '../.sites-runtime/shared/toast-supabase-reader.mjs';
import {projectToastDay} from '../.sites-runtime/shared/toast-day.mjs';
const config={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-key'};
const scope={locationId:'berts',restaurantGuid:'6e09b799-f05e-4a86-9867-511b0bb23325',timezone:'America/New_York',businessDate:'2026-09-30',signal:new AbortController().signal};
test('server reads only the mapped snapshot RPC and keeps credentials out of responses',async()=>{
 let captured;
 const reader=configuredToastDayReader(config,async(url,init)=>{captured={url,init};return Response.json({marker:'saved'})});
 assert.deepEqual(await reader.read(scope),{marker:'saved'});
 assert.equal(captured.url,'https://example.supabase.co/rest/v1/rpc/jmax_toast_read_day');
 assert.deepEqual(JSON.parse(captured.init.body),{p_store_id:'berts',p_business_date:'2026-09-30'});
 assert.equal(captured.init.redirect,'error');assert.equal(captured.init.signal,scope.signal);
 assert.equal(captured.init.headers.Authorization,'Bearer test-server-key');
});
test('unknown or substituted restaurant scope is rejected before any network request',async()=>{
 let called=false;const reader=configuredToastDayReader(config,async()=>{called=true;return Response.json({})});
 for(const change of [{locationId:'other'},{restaurantGuid:'95ac8855-65c8-4a49-9d3d-d25e36351edc'},{timezone:'UTC'}])await assert.rejects(reader.read({...scope,...change}));
 assert.equal(called,false);
});
test('Papa uses its own verified mapping and saved snapshot identity',async()=>{
 let captured;
 const reader=configuredToastDayReader(config,async(url,init)=>{captured=JSON.parse(init.body);return Response.json({locationId:'papa'})});
 const papa={...scope,locationId:'papa',restaurantGuid:'ddebbf7f-b32a-4df7-b75f-9428daffd946'};
 assert.deepEqual(await reader.read(papa),{locationId:'papa'});
 assert.deepEqual(captured,{p_store_id:'papa',p_business_date:'2026-09-30'});
 await assert.rejects(reader.read({...papa,restaurantGuid:scope.restaurantGuid}));
});
test('missing credentials and unsafe URLs stay disconnected',()=>{
 for(const c of [{},{SUPABASE_URL:config.SUPABASE_URL},{...config,SUPABASE_URL:'http://example.test'},{...config,SUPABASE_URL:'https://user:pass@example.test'},{...config,SUPABASE_URL:'https://example.test/?secret=x'}])assert.equal(configuredToastDayReader(c),undefined);
});
test('private provider errors cannot pass through the reader',async()=>{
 const reader=configuredToastDayReader(config,async()=>new Response('private credentials',{status:403}));
 await assert.rejects(reader.read(scope),e=>!e.message.includes('private credentials')&&e.status===503);
});
test('an imported snapshot count does not become a reconciled closed-day total',()=>{
 const now=Date.now(),at=new Date(now-100).toISOString(),feed={recordCount:199,checkedAt:at,dataThrough:at,paginationComplete:true,correctionsApplied:false,dayClosed:false};
 const result=projectToastDay({schemaVersion:'jmax-toast-day-read.v1',locationId:scope.locationId,businessDate:scope.businessDate,timezone:scope.timezone,source:{system:'toast',restaurantGuid:scope.restaurantGuid},orders:feed,labor:null},scope,{locationId:scope.locationId,restaurantGuid:scope.restaurantGuid,timezone:scope.timezone},now);
 assert.equal(result.orders.importedRecordCount,199);assert.equal(result.orders.recordCount,null);assert.equal(result.orders.state,'incomplete');assert.equal(result.labor.importedRecordCount,null);
});
