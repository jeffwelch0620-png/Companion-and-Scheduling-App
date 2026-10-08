// Loopback-only review of the built application with an ephemeral test database.
// These fictional identities are injected by the harness, never by app code.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {Miniflare} from 'miniflare';
import {seedManagerFixture} from './manager-log-fixture.mjs';
import {seedCombinedSchedule} from './combined-shell-fixture.mjs';
import {seedCombinedFood} from './combined-food-fixture.mjs';
import {seedEmployeeJourney} from './employee-journey-fixture.mjs';
import {seedGmPreview} from './gm-preview-fixture.mjs';
import {seedEmployeeCheckout} from './employee-checkout-fixture.mjs';
import {seedFoodFixture} from './food-fixture.mjs';
import {seedReturnCreditFixture} from './return-credit-fixture.mjs';
import {seedExtraBillingFixture} from './extra-billing-fixture.mjs';
import {seedReplacementFixture} from './replacement-fixture.mjs';
import {seedReplacementQueueFixture} from './replacement-queue-fixture.mjs';
import {seedShiftCheckinFixture} from './shift-checkin-fixture.mjs';
import {seedCheckinHistoryFixture} from './checkin-history-fixture.mjs';
import {seedAttendanceReviewFixture} from './attendance-review-fixture.mjs';
import {seedHireHandoffFixture} from './hire-handoff-fixture.mjs';
import {seedHireDevelopmentFixture} from './hire-development-fixture.mjs';
import {seedFollowupDesk} from './followup-desk-fixture.mjs';
import {seedMaintenanceCostFixture} from './maintenance-cost-fixture.mjs';
import {seedServiceCosts} from './service-cost-report-fixture.mjs';
import {seedTransferReviewFixture} from './transfer-review-fixture.mjs';
import {seedWasteItemsFixture} from './waste-items-fixture.mjs';
import {seedInvoiceSourceFixture} from './invoice-source-fixture.mjs';
import {seedInvoiceColumnMapPreview} from './invoice-column-map-preview.mjs';
import {seedMeterOnlyPreview} from './meter-only-preview.mjs';
import {seedTransferWindowPreview} from './transfer-window-preview.mjs';
import {seedOpeningOnboardingPreview} from './opening-onboarding-preview.mjs';
import {seedTransferReceiptUnitsPreview} from './transfer-receipt-units-preview.mjs';
import {seedToastSchedulePreview,toastSchedulePreviewBindings} from './toast-schedule-preview-fixture.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const assetsRoot=path.resolve(process.env.JMAX_TEST_DIST??'dist','client');
async function assets(request){
 let file;try{file=path.resolve(assetsRoot,`.${decodeURIComponent(new URL(request.url).pathname)}`)}catch{return new Response('Not found',{status:404})}
 if(!file.startsWith(assetsRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('Not found',{status:404});
 const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'}[path.extname(file)]??'application/octet-stream';
 return new Response(fs.readFileSync(file),{headers:{'Content-Type':mime,'Cache-Control':'no-store'}});
}
let toastPreviewService=null;
const worker=new Miniflare({modules:true,scriptPath:path.resolve(process.env.JMAX_TEST_DIST??'dist','server/index.js'),modulesRoot:path.resolve(process.env.JMAX_TEST_DIST??'dist','server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:assets},...(process.env.JMAX_PREVIEW_TOAST_SCHEDULE==='1'?{bindings:toastSchedulePreviewBindings}:{}),outboundService:request=>toastPreviewService?toastPreviewService(request):new Response('External services are disabled in this fictional review.',{status:503})});
const db=await worker.getD1Database('DB');
for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
await seedManagerFixture(db);
// Explicit grants for fictional review accounts; never change real access.
for(const [actor,kind] of [['admin','rudd'],['otherowner','jay'],['foh','restaurant'],['boh','restaurant'],['worker','restaurant']]){
 await db.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').bind(actor+'-fixture',kind,'berts').run();
}
if(process.env.JMAX_PREVIEW_GM==='1')await seedGmPreview(db);
if(process.env.JMAX_PREVIEW_EMPLOYEE_CHECKOUT==='1')await seedEmployeeCheckout(db);
await seedFoodFixture(db);
if(process.env.JMAX_PREVIEW_COMBINED_SCHEDULE==='1')await seedCombinedFood(db,(url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_EMPLOYEE_JOURNEY==='1')await seedEmployeeJourney(db);
if(process.env.JMAX_PREVIEW_METER_ONLY==='1')await seedMeterOnlyPreview((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_REPLACEMENT_QUEUE==='1'){
 if(process.env.JMAX_PREVIEW_REPLACEMENT==='1'||process.env.JMAX_PREVIEW_RETURN_CREDIT==='1'||process.env.JMAX_PREVIEW_EXTRA_BILLING==='1')throw Error('Choose one fictional invoice preview seed.');
 await seedReplacementQueueFixture((url,init)=>worker.dispatchFetch(url,init));
}
if(process.env.JMAX_PREVIEW_REPLACEMENT==='1'){
 if(process.env.JMAX_PREVIEW_RETURN_CREDIT==='1'||process.env.JMAX_PREVIEW_EXTRA_BILLING==='1')throw Error('Choose one fictional invoice preview seed.');
 await seedReplacementFixture((url,init)=>worker.dispatchFetch(url,init));
}
if(process.env.JMAX_PREVIEW_TRANSFER_REVIEW==='1')await seedTransferReviewFixture((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_TRANSFER_WINDOW==='1')await seedTransferWindowPreview((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_RECEIPT_UNITS==='1')await seedTransferReceiptUnitsPreview((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_WASTE_ITEMS==='1')await seedWasteItemsFixture(db);
if(process.env.JMAX_PREVIEW_INVOICE_SOURCE==='1')await seedInvoiceSourceFixture((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_INVOICE_COLUMNS==='1')await seedInvoiceColumnMapPreview((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_RETURN_CREDIT==='1')await seedReturnCreditFixture((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_EXTRA_BILLING==='1'){
 if(process.env.JMAX_PREVIEW_RETURN_CREDIT==='1')throw Error('Choose one fictional invoice preview seed.');
 await seedExtraBillingFixture((url,init)=>worker.dispatchFetch(url,init));
}
await seedAttendanceReviewFixture(db);
if(process.env.JMAX_PREVIEW_CHECKINS==='1')await seedShiftCheckinFixture(db);
if(process.env.JMAX_PREVIEW_CHECKIN_HISTORY==='1')await seedCheckinHistoryFixture(db);
if(process.env.JMAX_PREVIEW_HIRE_HANDOFF==='1'||process.env.JMAX_PREVIEW_OPENING_ONBOARDING==='1')await seedHireHandoffFixture(db);
if(process.env.JMAX_PREVIEW_OPENING_ONBOARDING==='1')await seedOpeningOnboardingPreview((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_HIRE_DEVELOPMENT==='1')await seedHireDevelopmentFixture(db);
if(process.env.JMAX_PREVIEW_MAINTENANCE_COST==='1')await seedMaintenanceCostFixture((url,init)=>worker.dispatchFetch(url,init));
if(process.env.JMAX_PREVIEW_FOLLOWUP_DESK==='1')await seedFollowupDesk(db);
if(process.env.JMAX_PREVIEW_SERVICE_COST_REPORT==='1')await seedServiceCosts(db,'rudds','demo-owner-rudds','demo-rudds-boh');
if(process.env.JMAX_PREVIEW_COMBINED_SCHEDULE==='1'){
 const sample=await seedCombinedSchedule(db,(url,init)=>worker.dispatchFetch(url,init),`http://127.0.0.1:${Number(process.env.JMAX_PREVIEW_PORT??6601)}`);
 if(process.env.JMAX_PREVIEW_TOAST_SCHEDULE==='1'){
  toastPreviewService=await seedToastSchedulePreview(db,sample.start);
  console.log('TOAST PREVIEW QA: fictional POS responses only; no network connection to Toast.');
 }
 console.log(`FICTIONAL SCHEDULE: ${sample.start} through ${sample.end}; ${sample.publishedShifts} published sample shifts. Select "${sample.locationName}" in the restaurant selector and open Schedule, then Next week. Operations samples keep their original historical dates.`);
 console.log(process.env.JMAX_PREVIEW_GM==='1'?'ROLE QA: separate owner, GM operations, department manager and frontline identities.':'ROLE QA: owner, department manager and frontline identities; enable JMAX_PREVIEW_GM for a separate GM operations identity.');
}
const actors=['admin','foh','boh','worker','otherowner',...(process.env.JMAX_PREVIEW_GM==='1'?['gm']:[])],servers=[];
// Opt-in test: the first owner workspace mutation saves successfully but its
// acknowledgement is lost. Retry must keep the original command and scope.
let loseAcknowledgement=process.env.JMAX_PREVIEW_LOST_ACK==='1';
let loseTransferAcknowledgement=process.env.JMAX_PREVIEW_TRANSFER_LOST_ACK==='1';
for(let i=0;i<actors.length;i++){
 const actor=actors[i],port=Number(process.env.JMAX_PREVIEW_PORT??6391)+i;
 const server=http.createServer(async(req,res)=>{
  try{
   const url=`http://127.0.0.1:${port}${req.url}`;
   if(req.method==='GET'&&new URL(url).pathname!=='/team'){
    const asset=await assets(new Request(url));if(asset.ok){res.writeHead(asset.status,Object.fromEntries(asset.headers));res.end(Buffer.from(await asset.arrayBuffer()));return}
   }
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v&&!['host','content-length','connection'].includes(k))headers.set(k,Array.isArray(v)?v.join(','):v);
   headers.set('oai-authenticated-user-id',actor+'-fixture');headers.set('oai-authenticated-user-email',actor+'@example.test');
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>128000){res.writeHead(413);res.end();return}chunks.push(chunk)}
   const response=await worker.dispatchFetch(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   if(loseTransferAcknowledgement&&actor==='admin'&&req.method==='POST'&&new URL(url).pathname==='/api/food/transfers'&&response.ok){
    loseTransferAcknowledgement=false;await response.arrayBuffer();res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Fictional preview: transfer saved but acknowledgement was interrupted. Retry the same transfer save.'}));return;
   }
   if(loseAcknowledgement&&actor==='admin'&&req.method==='POST'&&new URL(url).pathname==='/api/workspace'&&response.ok){
    loseAcknowledgement=false;await response.arrayBuffer();res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Fictional preview: acknowledgement interrupted after save. Retry the same change.'}));return;
   }
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500);res.end('Local review request failed.');console.error(error.message)}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});servers.push(server);
 console.log(`DEMO ${actor}: http://127.0.0.1:${port}/team`);
}
async function shutdown(){for(const server of servers)server.close();await worker.dispose();process.exit(0)}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
process.stdin.setEncoding('utf8');
process.stdin.on('data',value=>{if(value.trim()==='stop')void shutdown()});
