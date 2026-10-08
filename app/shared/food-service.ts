import {parseReplacementReturn,parseReplacementReturnVoid,replacementReturnTotals,enrichReplacementReturns} from './food-replacement-return';
import {authenticateWorkspace,boundedJson,memberFromRow,recordFromRow} from './service';
import {requireIdentityLocation,type WorkspaceIdentity} from './employee-session';
import {applyCommand} from './domain';
import {foodManager} from './food';
import {parseFoodWaste,parseFoodWasteVoid} from './food-waste';
import {parseInvoiceLine,parseInvoiceVoid} from './food-invoice';
import {verifyArchivedInvoiceSource} from './invoice-archive';
import {reviewedInvoicePrice} from './food-price';
import {wasteReport} from './food-waste-report';
import {wasteItemReport} from './food-waste-items';
import type {WasteExport} from './food-waste-export';
import {parseCredit,parseCreditVoid,creditTotals} from './food-credit';
import {parseReplacement,parseReplacementVoid,replacementTotals,enrichReplacements} from './food-replacement';
import {parseExcessBilling,parseExcessBillingVoid,excessBillingTotals,excessBillingChoices,enrichExcessBilling} from './food-excess-billing';
import {parseExcessReturn,parseExcessReturnVoid,excessReturnTotals} from './food-excess-return';
import {parseExcess,parseExcessVoid,excessTotals} from './food-excess';
import {parseReceiving,parseReceivingVoid,receivingTotals} from './food-receiving';
import {parseSupplierReturn,parseSupplierReturnVoid,supplierReturnTotals} from './food-return';
import {parseReturnCredit,parseReturnCreditVoid,returnCreditTotals,returnCreditChoices} from './food-return-credit';
import {receivingQueue} from './food-receiving-queue';
import {parseClaim,parseClaimUpdate,claimLatest,invoiceClaims} from './food-claim';
import {claimQueue} from './food-claim-queue';
import {returnQueue} from './food-return-queue';
import {foodRecipeCost,type FoodSource} from './food-model';
import type {FoodRecord,FoodPage,FoodResult,FoodEvent,FoodHistoryPage} from './food-contract';
import type {Command,Workspace,Location} from './types';
import {has} from './types';
import {AppError,id,text,object,requireThat} from './validation';
import {requireRestaurantAccess,restaurantAccessWriteGuard} from './restaurant-access';

type Database=Pick<D1Database,'prepare'|'batch'>;
type MemberRow=Parameters<typeof memberFromRow>[0];
type Row=Parameters<typeof recordFromRow>[0]&{kind:'fooditem'|'foodrecipe'};
const PAGE=20;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
function record(row:Row):FoodRecord{const r=recordFromRow(row);requireThat(r.kind==='fooditem'||r.kind==='foodrecipe','Food record needs review.',503);return r;}
export async function context(db:Database,identity:WorkspaceIdentity,locationId:string,commissaryFood=false){
 requireIdentityLocation(identity,locationId,commissaryFood?'commissary-food':'restaurant');
 const access=await requireRestaurantAccess(db,identity,locationId,commissaryFood?'commissary-food':'restaurant');
 requireThat(access.kind!=='commissary'||locationId===access.home_location_id||commissaryFood,'No access to this restaurant.',403);
 const destinationCode=identity.source==='setup-code'&&identity.locationId!==locationId&&access.kind==='commissary'&&commissaryFood;
 const scoped=identity.source==='setup-code'&&!destinationCode?identity.memberId:null;
 const rows=await db.batch([
  db.prepare('SELECT * FROM memberships WHERE location_id=? AND auth_user_id=? AND active=1 AND (? IS NULL OR id=?)').bind(locationId,identity.authUserId,scoped,scoped),
  db.prepare('SELECT id,name,timezone,revision,week_starts_on AS weekStartsOn FROM locations WHERE id=?').bind(locationId),
  db.prepare('SELECT revision FROM food_state WHERE location_id=?').bind(locationId),
 ]);
 const mine=rows[0].results[0] as MemberRow|undefined,location=rows[1].results[0] as Location|undefined;
 requireThat(mine&&location,'No access to this restaurant.',403);
 requireThat(identity.source==='sites'||destinationCode||mine.revision===identity.membershipRevision,'Your access changed. Please sign in again.',401);
 const me=memberFromRow(mine);requireThat(foodManager(me),'Food records require restaurant food-management access.',403);
 return {w:{location,me,members:[me],records:[]} satisfies Workspace,membershipRevision:mine.revision,revision:(rows[2].results[0] as {revision:number}|undefined)?.revision??0,restaurantAccess:access};
}
async function prior(db:Database,location:string,actor:string,request:string,fingerprint:string){
 const row=await db.prepare('SELECT fingerprint,result FROM food_receipts WHERE location_id=? AND actor_id=? AND request_id=?').bind(location,actor,request).first<{fingerprint:string;result:string}>();
 if(!row)return null;requireThat(row.fingerprint===fingerprint,'This request identifier was used for a different change.',409);return JSON.parse(row.result) as FoodResult;
}
// Recipe pages resolve only their dependency graph, never the entire catalog.
async function costs(db:Database,locationId:string,dataset:string,seeds:FoodRecord[]){
 const found=new Map(seeds.map(r=>[`${r.kind}:${r.kind==='fooditem'?r.data.controlNumber:r.data.sourceId}`,r]));
 let frontier=seeds.filter(r=>r.kind==='foodrecipe');const visited=new Set<string>();let loaded=0;
 for(let depth=0;frontier.length&&depth<30&&loaded<500;depth++){
  const refs=new Map<string,{kind:string;key:string}>();
  for(const r of frontier)for(const line of r.data.lines){const kind=line.sourceType==='item'?'fooditem':'foodrecipe',key=line.sourceType==='item'?line.controlNumber:line.recipeId,k=`${kind}:${key}`;if(!found.has(k)&&!visited.has(k))refs.set(k,{kind,key});}
  const pending=[...refs.values()].slice(0,500-loaded);frontier=[];
  for(let start=0;start<pending.length;start+=35){const chunk=pending.slice(start,start+35);for(const r of chunk)visited.add(`${r.kind}:${r.key}`);loaded+=chunk.length;
   const rows=await db.prepare(`SELECT * FROM food_records WHERE location_id=? AND dataset=? AND (${chunk.map(()=>'(kind=? AND source_key=?)').join(' OR ')})`).bind(locationId,dataset,...chunk.flatMap(r=>[r.kind,r.key])).all<Row>();
   for(const row of rows.results){const r=record(row);found.set(`${r.kind}:${r.kind==='fooditem'?r.data.controlNumber:r.data.sourceId}`,r);if(r.kind==='foodrecipe')frontier.push(r);}
  }
 }
 const all=[...found.values()],items=all.flatMap(r=>r.kind==='fooditem'?[r.data]:[]),recipes=all.flatMap(r=>r.kind==='foodrecipe'?[r.data]:[]);
 return {costs:Object.fromEntries(seeds.flatMap(r=>r.kind==='foodrecipe'?[[r.id,foodRecipeCost(r.data,items,recipes)]]:[])),names:Object.fromEntries(all.map(r=>[`${r.kind}:${r.kind==='fooditem'?r.data.controlNumber:r.data.sourceId}`,r.data.title]))};
}
async function page(db:Database,identity:WorkspaceIdentity,url:URL){
 const locationId=id(url.searchParams.get('locationId')),ctx=await context(db,identity,locationId),dataset=url.searchParams.get('dataset')??'operating';
 requireThat(dataset==='demo'||dataset==='operating','Choose a food dataset.');
 if(url.searchParams.get('view')==='claims'){
  const result=await claimQueue(db,ctx.w,dataset,url,ctx.revision);
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);return result;
 }
 if(url.searchParams.get('view')==='returns'){
  const result=await returnQueue(db,ctx.w,dataset,url,ctx.revision);
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);return result;
 }
 if(url.searchParams.get('view')==='extra-billing'){
  requireThat(has(ctx.w.me,'location.manage')||has(ctx.w.me,'orders.review'),'Billing matches require purchasing review access.',403);
  const result=await excessBillingChoices(db,locationId,dataset,url,ctx.revision);
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);return result;
 }
 if(url.searchParams.get('view')==='return-credits'){
  const result=await returnCreditChoices(db,locationId,dataset,url,ctx.revision);
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);return result;
 }
 if(url.searchParams.get('view')==='receiving'){
  const result=await receivingQueue(db,ctx.w,dataset,url,ctx.revision);
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);
  return result;
 }
 if(url.searchParams.get('view')==='waste-items'){
  const result=await wasteItemReport(db,ctx.w,dataset,url,ctx.revision);
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);
  requireThat(check.w.location.revision===ctx.w.location.revision,'Restaurant settings changed while loading. Refresh this view.',409);return result;
 }
 if(url.searchParams.get('view')==='waste'||url.searchParams.get('view')==='waste-export'){
  const exporting=url.searchParams.get('view')==='waste-export';
  const result=await wasteReport(db,ctx.w,dataset,url,ctx.revision,exporting);
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);
  requireThat(check.w.location.revision===ctx.w.location.revision,'Restaurant settings changed while loading. Refresh this view.',409);
  if(exporting)return {...result,kind:'waste-export',complete:true,locationId,restaurant:ctx.w.location.name,dataset,generatedAt:new Date().toISOString()} satisfies WasteExport;
  return result;
 }
 if(url.searchParams.get('view')==='history'){
  const recordId=id(url.searchParams.get('recordId')),after=Number(url.searchParams.get('after')??0);requireThat(Number.isSafeInteger(after)&&after>=0,'Invalid history cursor.');
  requireThat(await db.prepare('SELECT id FROM food_records WHERE id=? AND location_id=? AND dataset=?').bind(recordId,locationId,dataset).first(),'Record not found.',404);
  const rows=await db.prepare('SELECT sequence,revision,at,actor_id AS actorId,event FROM food_history WHERE location_id=? AND record_id=? AND sequence>? ORDER BY sequence LIMIT 21').bind(locationId,recordId,after).all<{sequence:number;revision:number;at:string;actorId:string;event:string}>();
  const entries:FoodHistoryPage['entries']=rows.results.slice(0,PAGE).map(r=>({...r,event:JSON.parse(r.event) as FoodEvent}));
  const wastes=entries.filter(e=>e.event.waste).map(e=>e.revision);
  if(wastes.length){
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.wasteVoid.wasteRevision') IN (${wastes.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...wastes).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).wasteVoid;if(voided){const entry=entries.find(e=>e.revision===voided.wasteRevision);if(entry)entry.voided={...voided,revision:row.revision};}}
   const invoiceSources=entries.flatMap(e=>e.event.waste?.cost?.sku?.priceSource?[e.event.waste.cost.sku.priceSource.invoiceRevision]:[]);
   if(invoiceSources.length){
    const invalid=await db.prepare(`SELECT event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoiceVoid.invoiceRevision') IN (${invoiceSources.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...invoiceSources).all<{event:string}>();
    const revisions=new Set(invalid.results.map(r=>(JSON.parse(r.event) as FoodEvent).invoiceVoid!.invoiceRevision));
    for(const e of entries)if(revisions.has(e.event.waste?.cost?.sku?.priceSource?.invoiceRevision??-1))e.wastePriceSourceVoided=true;
   }
  }
  const invoices=entries.filter(e=>e.event.invoiceLine).map(e=>e.revision);
  if(invoices.length){
   const claims=await invoiceClaims(db,locationId,recordId,invoices);
   for(const entry of entries)if(entry.event.invoiceLine)entry.invoiceClaim=claims.get(entry.revision);
   const credits=await creditTotals(db,locationId,recordId,invoices);
   const returnedExtras=await excessReturnTotals(db,locationId,recordId,'invoice',invoices);
   for(const entry of entries)if(entry.event.invoiceLine)entry.invoiceExcessReturns=returnedExtras.get(entry.revision)??{entries:0,quantity:0};
   const extras=await excessTotals(db,locationId,recordId,invoices);
   for(const entry of entries)if(entry.event.invoiceLine)entry.invoiceExcess=extras.get(entry.revision)??{entries:0,quantity:0};
   const deliveries=await receivingTotals(db,locationId,recordId,invoices);
   for(const entry of entries)if(entry.event.invoiceLine)entry.invoiceReceiving=deliveries.get(entry.revision)??{entries:0,accepted:0,rejected:0};
   for(const entry of entries)if(entry.event.invoiceLine)entry.invoiceCredits=credits.get(entry.revision)??{entries:0,amountCents:0,quantity:0};
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoiceVoid.invoiceRevision') IN (${invoices.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...invoices).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).invoiceVoid;if(voided){const entry=entries.find(e=>e.revision===voided.invoiceRevision);if(entry)entry.invoiceVoided={...voided,revision:row.revision};}}
   const applications=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoicePrice.invoiceRevision') IN (${invoices.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...invoices).all<{revision:number;event:string}>();
   for(const row of applications.results){const applied=(JSON.parse(row.event) as FoodEvent).invoicePrice;if(applied){const entry=entries.find(e=>e.revision===applied.invoiceRevision);if(entry)entry.invoicePriceApplied={...applied,revision:row.revision};}}
  }
  const extras=entries.filter(e=>e.event.excess).map(e=>e.revision);
  if(extras.length){
   const returned=await excessReturnTotals(db,locationId,recordId,'extra',extras);
   for(const entry of entries)if(entry.event.excess)entry.excessReturned=returned.get(entry.revision)??{entries:0,quantity:0};
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessVoid.excessRevision') IN (${extras.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...extras).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).excessVoid;if(voided){const entry=entries.find(e=>e.revision===voided.excessRevision);if(entry)entry.excessVoided={...voided,revision:row.revision};}}
  }
  const extraReturns=entries.filter(e=>e.event.excessReturn).map(e=>e.revision);
  if(extraReturns.length){
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessReturnVoid.returnRevision') IN (${extraReturns.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...extraReturns).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).excessReturnVoid;if(voided){const entry=entries.find(e=>e.revision===voided.returnRevision);if(entry)entry.excessReturnVoided={...voided,revision:row.revision};}}
  }
  const claims=entries.filter(e=>e.event.supplierClaim).map(e=>e.revision);
  if(claims.length){const latest=await claimLatest(db,locationId,recordId,claims);for(const entry of entries)if(entry.event.supplierClaim)entry.claimLatest=latest.get(entry.revision);}
  const credits=entries.filter(e=>e.event.invoiceCredit).map(e=>e.revision);
  if(credits.length){
   const matches=await returnCreditTotals(db,locationId,recordId,'credit',credits);
   for(const entry of entries)if(entry.event.invoiceCredit)entry.creditMatched=matches.get(entry.revision)??{entries:0,quantity:0};
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.creditVoid.creditRevision') IN (${credits.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...credits).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).creditVoid;if(voided){const entry=entries.find(e=>e.revision===voided.creditRevision);if(entry)entry.creditVoided={...voided,revision:row.revision};}}
  }
  const deliveries=entries.filter(e=>e.event.receiving).map(e=>e.revision);
  if(deliveries.length){
   const returned=await supplierReturnTotals(db,locationId,recordId,deliveries);
   for(const entry of entries)if(entry.event.receiving)entry.receivingReturns=returned.get(entry.revision)??{entries:0,accepted:0,rejected:0};
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.receivingVoid.receivingRevision') IN (${deliveries.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...deliveries).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).receivingVoid;if(voided){const entry=entries.find(e=>e.revision===voided.receivingRevision);if(entry)entry.receivingVoided={...voided,revision:row.revision};}}
  }
  const returns=entries.filter(e=>e.event.supplierReturn).map(e=>e.revision);
  if(returns.length){
   const matches=await returnCreditTotals(db,locationId,recordId,'return',returns);
   for(const entry of entries)if(entry.event.supplierReturn)entry.returnMatched=matches.get(entry.revision)??{entries:0,quantity:0};
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.supplierReturnVoid.returnRevision') IN (${returns.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...returns).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).supplierReturnVoid;if(voided){const entry=entries.find(e=>e.revision===voided.returnRevision);if(entry)entry.supplierReturnVoided={...voided,revision:row.revision};}}
  }
  const matches=entries.filter(e=>e.event.returnCredit).map(e=>e.revision);
  if(matches.length){
   const voids=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.returnCreditVoid.matchRevision') IN (${matches.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...matches).all<{revision:number;event:string}>();
   for(const row of voids.results){const voided=(JSON.parse(row.event) as FoodEvent).returnCreditVoid;if(voided){const entry=entries.find(e=>e.revision===voided.matchRevision);if(entry)entry.returnCreditVoided={...voided,revision:row.revision};}}
  }
  const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);
  await enrichExcessBilling(db,locationId,recordId,entries);
  await enrichReplacements(db,locationId,recordId,entries);
  await enrichReplacementReturns(db,locationId,recordId,entries);
  const finalCheck=await context(db,identity,locationId);requireThat(finalCheck.revision===ctx.revision&&finalCheck.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);
  return {entries,next:rows.results.length>PAGE?entries.at(-1)!.sequence:null} satisfies FoodHistoryPage;
 }
 const kind=url.searchParams.get('kind')??'fooditem';requireThat(kind==='fooditem'||kind==='foodrecipe','Choose items or recipes.');
 const focus=url.searchParams.has('itemId')?id(url.searchParams.get('itemId')):'';
 if(focus){requireThat(kind==='fooditem','Open an item from the delivery queue.');requireThat(await db.prepare("SELECT id FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem'").bind(focus,locationId,dataset).first(),'Item not found in this restaurant and dataset.',404);}
 const query=text(url.searchParams.get('q')??'','Search',100,true).toLowerCase(),area=text(url.searchParams.get('area')??'','Storage area',200,true),after=url.searchParams.get('after')?id(url.searchParams.get('after')):'';
 let afterKey='';if(after){const cursor=await db.prepare('SELECT source_key FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind=?').bind(after,locationId,dataset,kind).first<{source_key:string}>();requireThat(cursor,'This page cursor no longer belongs to the selected catalog. Start at the first page.');afterKey=cursor.source_key;}
 const where='location_id=? AND dataset=? AND kind=? AND (?=\'\' OR storage_area=?) AND (?=\'\' OR instr(lower(title || \' \' || source_key),?)>0) AND (?=\'\' OR id=?)',values=[locationId,dataset,kind,area,area,query,query,focus,focus];
 const rows=await db.batch([
  db.prepare(`SELECT * FROM food_records WHERE ${where} AND source_key>? ORDER BY source_key LIMIT 21`).bind(...values,afterKey),
  db.prepare(`SELECT count(*) AS total FROM food_records WHERE ${where}`).bind(...values),
  db.prepare("SELECT kind,count(*) AS total,sum(CASE WHEN json_type(data,'$.count')='object' THEN 1 ELSE 0 END) AS counted FROM food_records WHERE location_id=? AND dataset=? GROUP BY kind").bind(locationId,dataset),
  db.prepare("SELECT DISTINCT storage_area FROM food_records WHERE location_id=? AND dataset=? AND kind='fooditem' ORDER BY storage_area LIMIT 200").bind(locationId,dataset),
 ]);
 const records=(rows[0].results.slice(0,PAGE) as Row[]).map(record),cost=await costs(db,locationId,dataset,records);
 const check=await context(db,identity,locationId);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision,'Food records changed while loading. Refresh this view.',409);
 const totals=rows[2].results as {kind:string;total:number;counted:number}[];
 return {records,next:rows[0].results.length>PAGE?records.at(-1)!.id:null,revision:ctx.revision,total:(rows[1].results[0] as {total:number}).total,items:totals.find(r=>r.kind==='fooditem')?.total??0,recipes:totals.find(r=>r.kind==='foodrecipe')?.total??0,counted:totals.find(r=>r.kind==='fooditem')?.counted??0,areas:(rows[3].results as {storage_area:string}[]).map(r=>r.storage_area),...cost} satisfies FoodPage;
}
async function commit(db:Database,identity:WorkspaceIdentity,command:Command):Promise<FoodResult>{
 requireThat(['fooditem.replacement-return','fooditem.replacement-return-void','fooditem.replacement','fooditem.replacement-void','fooditem.excess-billing','fooditem.excess-billing-void','fooditem.excess-return','fooditem.excess-return-void','fooditem.excess','fooditem.excess-void','fooditem.import','foodrecipe.import','fooditem.count','fooditem.configure','fooditem.waste','fooditem.waste-void','fooditem.invoice','fooditem.invoice-void','fooditem.invoice-apply','fooditem.credit','fooditem.credit-void','fooditem.receive','fooditem.receive-void','fooditem.return','fooditem.return-void','fooditem.return-credit','fooditem.return-credit-void','fooditem.claim','fooditem.claim-update'].includes(command.action),'Unsupported food action.');
 const ctx=await context(db,identity,command.locationId),w:Workspace=ctx.w,at=new Date().toISOString();
 const policy=await restaurantAccessWriteGuard(db,identity,command.locationId);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command))),fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const previous=await prior(db,w.location.id,w.me.id,command.requestId,fingerprint);if(previous)return previous;
 let changed:FoodRecord[]=[],existing=0;const importing=command.action.endsWith('.import');
 let source:FoodSource|undefined;let detailEvent:Pick<FoodEvent,'replacementReturn'|'replacementReturnVoid'|'replacement'|'replacementVoid'|'excessBilling'|'excessBillingVoid'|'excessReturn'|'excessReturnVoid'|'excess'|'excessVoid'|'waste'|'wasteVoid'|'invoiceLine'|'invoiceVoid'|'invoicePrice'|'invoiceCredit'|'creditVoid'|'receiving'|'receivingVoid'|'supplierReturn'|'supplierReturnVoid'|'returnCredit'|'returnCreditVoid'|'supplierClaim'|'claimUpdate'>={};
 if(importing){
  // Validate the complete batch before skipping identifiers already present.
  requireThat(!command.recordId,'Imports create new records.');
  const parsed=applyCommand(w,command,at).map(r=>{requireThat(r.kind==='fooditem'||r.kind==='foodrecipe','Unsupported result.',500);return r;});
  source=parsed[0].data.source;
  const pin=await db.prepare('SELECT source_restaurant_id FROM food_sources WHERE location_id=? AND dataset=?').bind(w.location.id,source.dataset).first<{source_restaurant_id:string}>();
  requireThat(!pin||pin.source_restaurant_id===source.sourceRestaurantId,'This dataset already uses a different source restaurant. Imports cannot change it.');
  const keys=parsed.map(r=>r.kind==='fooditem'?r.data.controlNumber:r.data.sourceId);
  const saved=await db.prepare(`SELECT source_key FROM food_records WHERE location_id=? AND dataset=? AND kind=? AND source_key IN (${keys.map(()=>'?').join(',')})`).bind(w.location.id,source.dataset,parsed[0].kind,...keys).all<{source_key:string}>();
  const known=new Set(saved.results.map(r=>r.source_key));changed=parsed.filter(r=>!known.has(r.kind==='fooditem'?r.data.controlNumber:r.data.sourceId));existing=parsed.length-changed.length;
 }else{
  requireThat(command.recordId,'Open the item before changing it.');
  const row=await db.prepare('SELECT * FROM food_records WHERE id=? AND location_id=?').bind(command.recordId,w.location.id).first<Row>();requireThat(row,'Record not found.',404);w.records=[record(row)];
  if(command.action==='fooditem.invoice-apply'){
   requireThat(has(w.me,'location.manage')||has(w.me,'orders.review'),'Invoice price changes require purchasing review access.',403);
   const item=record(row);requireThat(item.kind==='fooditem','Choose a food item.');
   const revision=Number(command.input.invoiceRevision);requireThat(Number.isSafeInteger(revision)&&revision>0,'Choose the original invoice entry.');
   const saved=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,item.id,revision).first<{event:string}>();
   const event=saved?JSON.parse(saved.event) as FoodEvent:null;
   requireThat(event?.action==='fooditem.invoice'&&event.invoiceLine,'Original invoice line not found for this item.',404);
   const used=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND (json_extract(event,'$.invoiceVoid.invoiceRevision')=? OR json_extract(event,'$.invoicePrice.invoiceRevision')=?) LIMIT 1").bind(w.location.id,item.id,revision,revision).first();
   requireThat(!used,'This invoice was voided or its price was already applied. Refresh the history.',409);
   requireThat(!(await creditTotals(db,w.location.id,item.id,[revision])).get(revision)?.entries,'This invoice has supplier credits. Review the supplier price separately through item correction.',409);
   const invoicePrice=reviewedInvoicePrice(item.data,event.invoiceLine,revision,command.input,at,w.me.id);
   const configured=applyCommand(w,{...command,action:'fooditem.configure',input:{reason:invoicePrice.reason,item:{...item.data,name:item.data.title,restaurantId:item.data.source.sourceRestaurantId,vendorSkus:item.data.vendorSkus.map(s=>s.id===invoicePrice.skuId?{...s,price:invoicePrice.price,priceUpdatedAt:invoicePrice.priceDate}:s)}}},at)[0];
   requireThat(configured.kind==='fooditem','Choose a food item.');
   configured.data.vendorSkus=configured.data.vendorSkus.map(s=>s.id===invoicePrice.skuId?{...s,priceSource:{invoiceRevision:revision,appliedRevision:configured.revision}}:s);
   changed=[configured];detailEvent={invoicePrice};
  }else changed=applyCommand(w,command,at).map(r=>{requireThat(r.kind==='fooditem'||r.kind==='foodrecipe','Unsupported result.',500);return r;});
  if(command.action==='fooditem.waste'){
   const item=changed[0];requireThat(item.kind==='fooditem','Choose a food item.');
   detailEvent={waste:parseFoodWaste(command.input,item.data,at,w.me.id,w.location.timezone)};
  }
  if(command.action==='fooditem.waste-void'){
   const wasteVoid=parseFoodWasteVoid(command.input,at,w.me.id);
   const original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,wasteVoid.wasteRevision).first<{event:string}>();
   requireThat(original&&(JSON.parse(original.event) as FoodEvent).action==='fooditem.waste'&&(JSON.parse(original.event) as FoodEvent).waste,'Original waste entry not found for this item.',404);
   const alreadyVoided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.wasteVoid.wasteRevision')=? LIMIT 1").bind(w.location.id,command.recordId,wasteVoid.wasteRevision).first();
   requireThat(!alreadyVoided,'This waste entry was already voided. Refresh the history.',409);
   detailEvent={wasteVoid};
  }
  if(command.action==='fooditem.invoice'){
   const item=changed[0];requireThat(item.kind==='fooditem','Choose a food item.');
   const invoiceLine=parseInvoiceLine(command.input,item.data,at,w.me.id,w.location.timezone);
   await verifyArchivedInvoiceSource(db,w.location.id,invoiceLine.dataset,invoiceLine.fileSource);
   const duplicate=await db.prepare("SELECT h.record_id FROM food_history h JOIN food_records r ON r.id=h.record_id WHERE h.location_id=? AND r.dataset=? AND json_extract(h.event,'$.invoiceLine.entryKey')=? AND NOT EXISTS (SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.invoiceVoid.invoiceRevision')=h.revision) LIMIT 1").bind(w.location.id,invoiceLine.dataset,invoiceLine.entryKey).first();
   requireThat(!duplicate,'This supplier invoice line is already recorded in this restaurant and dataset. Void the incorrect original before recording a correction.',409);
   detailEvent={invoiceLine};
  }
  if(command.action==='fooditem.invoice-void'){
   const invoiceVoid=parseInvoiceVoid(command.input,at,w.me.id);
   const original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,invoiceVoid.invoiceRevision).first<{event:string}>();
   requireThat(original&&(JSON.parse(original.event) as FoodEvent).action==='fooditem.invoice'&&(JSON.parse(original.event) as FoodEvent).invoiceLine,'Original invoice line not found for this item.',404);
   const alreadyVoided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoiceVoid.invoiceRevision')=? LIMIT 1").bind(w.location.id,command.recordId,invoiceVoid.invoiceRevision).first();
   requireThat(!alreadyVoided,'This invoice line was already voided. Refresh the history.',409);
   requireThat(!(await excessBillingTotals(db,w.location.id,command.recordId,'invoice',[invoiceVoid.invoiceRevision])).get(invoiceVoid.invoiceRevision)?.entries,'This invoice has extra-goods billing matches. Correct incorrect matches before voiding their source.',409);
   requireThat(!(await excessTotals(db,w.location.id,command.recordId,[invoiceVoid.invoiceRevision])).get(invoiceVoid.invoiceRevision)?.entries,'This invoice has extra goods observations. Correct incorrect linked observations before voiding its source.',409);
   requireThat(!(await creditTotals(db,w.location.id,command.recordId,[invoiceVoid.invoiceRevision])).get(invoiceVoid.invoiceRevision)?.entries,'This invoice has active credits. Review and void incorrect linked credits before voiding the invoice.',409);
   requireThat(!(await receivingTotals(db,w.location.id,command.recordId,[invoiceVoid.invoiceRevision])).get(invoiceVoid.invoiceRevision)?.entries,'This invoice has recorded deliveries. Review and void incorrect receiving entries before voiding the invoice.',409);
   requireThat(!(await invoiceClaims(db,w.location.id,command.recordId,[invoiceVoid.invoiceRevision])).size,'This invoice has a retained supplier issue. Cancel an incorrect issue record with a reason before voiding its invoice source.',409);
   const item=record(row);requireThat(item.kind==='fooditem','Choose a food item.');
   const linked=item.data.vendorSkus.filter(s=>s.priceSource?.invoiceRevision===invoiceVoid.invoiceRevision).map(s=>s.id);
   if(linked.length){
    requireThat(command.input.confirmPriceClear===true,'This invoice supplies the current catalog price. Confirm clearing that price when voiding its source.');
    const configured=applyCommand(w,{...command,action:'fooditem.configure',input:{reason:invoiceVoid.reason,item:{...item.data,name:item.data.title,restaurantId:item.data.source.sourceRestaurantId,vendorSkus:item.data.vendorSkus.map(s=>linked.includes(s.id)?{...s,price:null,priceUpdatedAt:''}:s)}}},at)[0];
    requireThat(configured.kind==='fooditem','Choose a food item.');
    configured.data.history=[...configured.data.history,...changed[0].data.history];changed=[configured];invoiceVoid.clearedSkuIds=linked;
   }
   detailEvent={invoiceVoid};
  }
  if(command.action==='fooditem.excess-billing'){
   const extraRevision=Number(command.input.excessRevision),invoiceRevision=Number(command.input.invoiceRevision);
   const rows=await db.prepare('SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND revision IN (?,?)').bind(w.location.id,command.recordId,extraRevision,invoiceRevision).all<{revision:number;event:string}>();
   const extra=rows.results.find(r=>r.revision===extraRevision),billed=rows.results.find(r=>r.revision===invoiceRevision),excess=extra?(JSON.parse(extra.event) as FoodEvent).excess:undefined,invoice=billed?(JSON.parse(billed.event) as FoodEvent).invoiceLine:undefined;
   requireThat(excess&&invoice,'Original extra delivery and billing invoice not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND (json_extract(event,'$.excessVoid.excessRevision')=? OR json_extract(event,'$.invoiceVoid.invoiceRevision') IN (?,?)) LIMIT 1").bind(w.location.id,command.recordId,extraRevision,invoiceRevision,excess.invoiceRevision).first();
   requireThat(!voided,'A voided source cannot be linked to billing.',409);
   const usedExtra=(await excessBillingTotals(db,w.location.id,command.recordId,'extra',[extraRevision])).get(extraRevision)??{entries:0,quantity:0},usedInvoice=(await excessBillingTotals(db,w.location.id,command.recordId,'invoice',[invoiceRevision])).get(invoiceRevision)??{entries:0,quantity:0};
   const excessBilling=parseExcessBilling(command.input,excess,invoice,usedExtra,usedInvoice,at,w.me.id);
   requireThat(!await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.excessBilling.excessRevision')=? AND json_extract(h.event,'$.excessBilling.invoiceRevision')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessBillingVoid.matchRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,extraRevision,invoiceRevision).first(),'These two entries already have an active billing match. Correct an incorrect match before replacing it.',409);
   detailEvent={excessBilling};
  }
  if(command.action==='fooditem.excess-billing-void'){
   const excessBillingVoid=parseExcessBillingVoid(command.input,at,w.me.id),row=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,excessBillingVoid.matchRevision).first<{event:string}>();
   requireThat(row&&(JSON.parse(row.event) as FoodEvent).excessBilling,'Billing match not found for this item.',404);
   requireThat(!await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessBillingVoid.matchRevision')=? LIMIT 1").bind(w.location.id,command.recordId,excessBillingVoid.matchRevision).first(),'This billing match was already voided.',409);detailEvent={excessBillingVoid};
  }
  if(command.action==='fooditem.replacement-return'){
   const revision=Number(command.input.replacementRevision),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,revision).first<{event:string}>();
   const event=original?JSON.parse(original.event) as FoodEvent:undefined,replacement=event?.replacement;
   requireThat(event?.action==='fooditem.replacement'&&replacement,'Original replacement goods entry not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND (json_extract(event,'$.replacementVoid.replacementRevision')=? OR json_extract(event,'$.receivingVoid.receivingRevision')=? OR json_extract(event,'$.invoiceVoid.invoiceRevision')=?) LIMIT 1").bind(w.location.id,command.recordId,revision,replacement.receivingRevision,replacement.receiving.invoiceRevision).first();
   requireThat(!voided,'A voided replacement goods observation cannot receive a pickup.',409);
   const used=(await replacementReturnTotals(db,w.location.id,command.recordId,[revision])).get(revision)??{entries:0,quantity:0};
   const replacementReturn=parseReplacementReturn(command.input,replacement,used,at,w.me.id,w.location.timezone);
   const duplicate=await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.replacementReturn.entryKey')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.replacementReturnVoid.returnRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,replacementReturn.entryKey).first();
   requireThat(!duplicate,'This pickup reference is already recorded for this replacement goods observation. Void an incorrect pickup before replacing it.',409);detailEvent={replacementReturn};
  }
  if(command.action==='fooditem.replacement-return-void'){
   const replacementReturnVoid=parseReplacementReturnVoid(command.input,at,w.me.id),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,replacementReturnVoid.returnRevision).first<{event:string}>();
   const pickup=original?(JSON.parse(original.event) as FoodEvent).replacementReturn:undefined;
   requireThat(pickup,'Original replacement goods pickup not found for this item.',404);
   requireThat(pickup.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review'),'Only the recorder or a purchasing reviewer can void this pickup record.',403);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.replacementReturnVoid.returnRevision')=? LIMIT 1").bind(w.location.id,command.recordId,replacementReturnVoid.returnRevision).first();
   requireThat(!voided,'This pickup record was already voided. Refresh the history.',409);detailEvent={replacementReturnVoid};
  }
  if(command.action==='fooditem.excess-return'){
   const revision=Number(command.input.excessRevision),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,revision).first<{event:string}>();
   const event=original?JSON.parse(original.event) as FoodEvent:undefined,excess=event?.excess;
   requireThat(event?.action==='fooditem.excess'&&excess,'Original extra goods entry not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessVoid.excessRevision')=? LIMIT 1").bind(w.location.id,command.recordId,revision).first();
   requireThat(!voided,'A voided extra goods observation cannot receive a pickup.',409);
   const used=(await excessReturnTotals(db,w.location.id,command.recordId,'extra',[revision])).get(revision)??{entries:0,quantity:0};
   const excessReturn=parseExcessReturn(command.input,excess,used,at,w.me.id,w.location.timezone);
   const duplicate=await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.excessReturn.entryKey')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessReturnVoid.returnRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,excessReturn.entryKey).first();
   requireThat(!duplicate,'This pickup reference is already recorded for this extra goods observation. Void an incorrect pickup before replacing it.',409);detailEvent={excessReturn};
  }
  if(command.action==='fooditem.excess-return-void'){
   const excessReturnVoid=parseExcessReturnVoid(command.input,at,w.me.id),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,excessReturnVoid.returnRevision).first<{event:string}>();
   const pickup=original?(JSON.parse(original.event) as FoodEvent).excessReturn:undefined;
   requireThat(pickup,'Original extra goods pickup not found for this item.',404);
   requireThat(pickup.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review'),'Only the recorder or a purchasing reviewer can void this pickup record.',403);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessReturnVoid.returnRevision')=? LIMIT 1").bind(w.location.id,command.recordId,excessReturnVoid.returnRevision).first();
   requireThat(!voided,'This pickup record was already voided. Refresh the history.',409);detailEvent={excessReturnVoid};
  }
  if(command.action==='fooditem.excess'){
   const revision=Number(command.input.invoiceRevision),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,revision).first<{event:string}>();
   const event=original?JSON.parse(original.event) as FoodEvent:undefined,invoice=event?.invoiceLine;
   requireThat(event?.action==='fooditem.invoice'&&invoice,'Original invoice line not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoiceVoid.invoiceRevision')=? LIMIT 1").bind(w.location.id,command.recordId,revision).first();
   requireThat(!voided,'A voided invoice cannot receive extra goods observations.',409);
   const used=(await receivingTotals(db,w.location.id,command.recordId,[revision])).get(revision)??{entries:0,accepted:0,rejected:0};
   const excess=parseExcess(command.input,invoice,used,at,w.me.id,w.location.timezone);
   const duplicate=await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.excess.entryKey')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessVoid.excessRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,excess.entryKey).first();
   requireThat(!duplicate,'Extra goods are already recorded for this invoice line and delivery reference. Void an incorrect observation before replacing it.',409);
   detailEvent={excess};
  }
  if(command.action==='fooditem.excess-void'){
   const excessVoid=parseExcessVoid(command.input,at,w.me.id),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,excessVoid.excessRevision).first<{event:string}>();
   const excess=original?(JSON.parse(original.event) as FoodEvent).excess:undefined;
   requireThat(excess,'Original extra goods entry not found for this item.',404);
   requireThat(excess.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review'),'Only the recorder or a purchasing reviewer can void this observation.',403);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessVoid.excessRevision')=? LIMIT 1").bind(w.location.id,command.recordId,excessVoid.excessRevision).first();
   requireThat(!voided,'This extra goods entry was already voided. Refresh the history.',409);
   requireThat(!(await excessBillingTotals(db,w.location.id,command.recordId,'extra',[excessVoid.excessRevision])).get(excessVoid.excessRevision)?.entries,'This observation has billing matches. Correct incorrect matches before voiding their source.',409);
   requireThat(!(await excessReturnTotals(db,w.location.id,command.recordId,'extra',[excessVoid.excessRevision])).get(excessVoid.excessRevision)?.entries,'This observation has actual supplier pickups. Correct incorrect pickup records before voiding their source.',409);detailEvent={excessVoid};
  }
  if(command.action==='fooditem.replacement'){
   const revision=Number(command.input.receivingRevision),row=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,revision).first<{event:string}>();
   const event=row?JSON.parse(row.event) as FoodEvent:undefined,receiving=event?.receiving;
   requireThat(event?.action==='fooditem.receive'&&receiving,'Original rejected delivery not found for this item.',404);
   requireThat(!await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND (json_extract(event,'$.receivingVoid.receivingRevision')=? OR json_extract(event,'$.invoiceVoid.invoiceRevision')=?) LIMIT 1").bind(w.location.id,command.recordId,revision,receiving.invoiceRevision).first(),'A voided delivery or invoice cannot receive replacements.',409);
   const used=(await replacementTotals(db,w.location.id,command.recordId,[revision])).get(revision)??{entries:0,quantity:0},replacement=parseReplacement(command.input,receiving,used,at,w.me.id,w.location.timezone);
   requireThat(!await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.replacement.entryKey')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.replacementVoid.replacementRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,replacement.entryKey).first(),'This replacement reference already exists for the rejected delivery. Void an incorrect entry before replacing it.',409);
   detailEvent={replacement};
  }
  if(command.action==='fooditem.replacement-void'){
   const replacementVoid=parseReplacementVoid(command.input,at,w.me.id),row=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,replacementVoid.replacementRevision).first<{event:string}>(),replacement=row?(JSON.parse(row.event) as FoodEvent).replacement:undefined;
   requireThat(replacement,'Replacement delivery not found for this item.',404);
   requireThat(replacement.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review'),'Only the recorder or a purchasing reviewer can void this replacement.',403);
   requireThat(!await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.replacementVoid.replacementRevision')=? LIMIT 1").bind(w.location.id,command.recordId,replacementVoid.replacementRevision).first(),'This replacement was already voided.',409);
   requireThat(!(await replacementReturnTotals(db,w.location.id,command.recordId,[replacementVoid.replacementRevision])).get(replacementVoid.replacementRevision)?.entries,'This replacement has actual supplier pickups. Correct incorrect pickup records before voiding their source.',409);detailEvent={replacementVoid};
  }
  if(command.action==='fooditem.receive'){
   const revision=Number(command.input.invoiceRevision),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,revision).first<{event:string}>();
   const event=original?JSON.parse(original.event) as FoodEvent:undefined,invoice=event?.invoiceLine;
   requireThat(event?.action==='fooditem.invoice'&&invoice,'Original invoice line not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoiceVoid.invoiceRevision')=? LIMIT 1").bind(w.location.id,command.recordId,revision).first();
   requireThat(!voided,'A voided invoice cannot receive a delivery.',409);
   const used=(await receivingTotals(db,w.location.id,command.recordId,[revision])).get(revision)??{entries:0,accepted:0,rejected:0};
   const receiving=parseReceiving(command.input,invoice,used,at,w.me.id,w.location.timezone);
   const duplicate=await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.receiving.entryKey')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.receivingVoid.receivingRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,receiving.entryKey).first();
   requireThat(!duplicate,'This delivery reference is already recorded for this invoice line. Void an incorrect receipt before replacing it.',409);
   detailEvent={receiving};
  }
  if(command.action==='fooditem.receive-void'){
   const receivingVoid=parseReceivingVoid(command.input,at,w.me.id),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,receivingVoid.receivingRevision).first<{event:string}>();
   const receiving=original?(JSON.parse(original.event) as FoodEvent).receiving:undefined;
   requireThat(receiving,'Original delivery entry not found for this item.',404);
   requireThat(receiving.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review'),'Only the recorder or a purchasing reviewer can void this delivery.',403);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.receivingVoid.receivingRevision')=? LIMIT 1").bind(w.location.id,command.recordId,receivingVoid.receivingRevision).first();
   requireThat(!voided,'This delivery was already voided. Refresh the history.',409);
   requireThat(!(await replacementTotals(db,w.location.id,command.recordId,[receivingVoid.receivingRevision])).get(receivingVoid.receivingRevision)?.entries,'This delivery has recorded replacements. Correct incorrect replacement entries before voiding their source.',409);
   requireThat(!(await excessTotals(db,w.location.id,command.recordId,[receiving.invoiceRevision])).get(receiving.invoiceRevision)?.entries,'This invoice has extra goods observations based on completed quantity checks. Correct incorrect linked observations before voiding this receipt.',409);
   requireThat(!(await supplierReturnTotals(db,w.location.id,command.recordId,[receivingVoid.receivingRevision])).get(receivingVoid.receivingRevision)?.entries,'This delivery has actual returns. Review and void incorrect linked returns before voiding its source.',409);detailEvent={receivingVoid};
  }
  if(command.action==='fooditem.return'){
   const revision=Number(command.input.receivingRevision),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,revision).first<{event:string}>();
   const event=original?JSON.parse(original.event) as FoodEvent:undefined,receiving=event?.receiving;
   requireThat(event?.action==='fooditem.receive'&&receiving,'Original delivery entry not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.receivingVoid.receivingRevision')=? LIMIT 1").bind(w.location.id,command.recordId,revision).first();
   requireThat(!voided,'A voided delivery cannot receive a supplier return.',409);
   const used=(await supplierReturnTotals(db,w.location.id,command.recordId,[revision])).get(revision)??{entries:0,accepted:0,rejected:0};
   const supplierReturn=parseSupplierReturn(command.input,receiving,used,at,w.me.id,w.location.timezone);
   const duplicate=await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.supplierReturn.entryKey')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.supplierReturnVoid.returnRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,supplierReturn.entryKey).first();
   requireThat(!duplicate,'This return reference is already recorded for this delivery. Correct the original return before replacing it.',409);
   detailEvent={supplierReturn};
  }
  if(command.action==='fooditem.return-void'){
   const supplierReturnVoid=parseSupplierReturnVoid(command.input,at,w.me.id),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,supplierReturnVoid.returnRevision).first<{event:string}>();
   const returned=original?(JSON.parse(original.event) as FoodEvent).supplierReturn:undefined;
   requireThat(returned,'Original supplier return not found for this item.',404);
   requireThat(returned.by===w.me.id||has(w.me,'location.manage')||has(w.me,'orders.review'),'Only the recorder or a purchasing reviewer can void this return.',403);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.supplierReturnVoid.returnRevision')=? LIMIT 1").bind(w.location.id,command.recordId,supplierReturnVoid.returnRevision).first();
   requireThat(!voided,'This supplier return was already voided. Refresh the history.',409);
   requireThat(!(await returnCreditTotals(db,w.location.id,command.recordId,'return',[supplierReturnVoid.returnRevision])).get(supplierReturnVoid.returnRevision)?.entries,'This return has credit matches. Correct incorrect linked matches before voiding their source.',409);detailEvent={supplierReturnVoid};
  }
  if(command.action==='fooditem.return-credit'){
   const returnRevision=Number(command.input.returnRevision),creditRevision=Number(command.input.creditRevision);
   const rows=await db.prepare('SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND revision IN (?,?)').bind(w.location.id,command.recordId,returnRevision,creditRevision).all<{revision:number;event:string}>();
   const returned=rows.results.find(r=>r.revision===returnRevision),credited=rows.results.find(r=>r.revision===creditRevision);
   const supplierReturn=returned?(JSON.parse(returned.event) as FoodEvent).supplierReturn:undefined,credit=credited?(JSON.parse(credited.event) as FoodEvent).invoiceCredit:undefined;
   requireThat(supplierReturn&&credit,'Original return or credit not found for this item.',404);
   const invalid=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND (json_extract(event,'$.supplierReturnVoid.returnRevision')=? OR json_extract(event,'$.creditVoid.creditRevision')=?) LIMIT 1").bind(w.location.id,command.recordId,returnRevision,creditRevision).first();
   requireThat(!invalid,'A voided return or credit cannot be matched.',409);
   const duplicate=await db.prepare("SELECT h.sequence FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.returnCredit.returnRevision')=? AND json_extract(h.event,'$.returnCredit.creditRevision')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.returnCreditVoid.matchRevision')=h.revision) LIMIT 1").bind(w.location.id,command.recordId,returnRevision,creditRevision).first();
   requireThat(!duplicate,'This return and credit are already matched. Correct the existing match before changing its quantity.',409);
   const usedReturn=(await returnCreditTotals(db,w.location.id,command.recordId,'return',[returnRevision])).get(returnRevision)??{entries:0,quantity:0},usedCredit=(await returnCreditTotals(db,w.location.id,command.recordId,'credit',[creditRevision])).get(creditRevision)??{entries:0,quantity:0};
   detailEvent={returnCredit:parseReturnCredit(command.input,supplierReturn,credit,usedReturn,usedCredit,at,w.me.id)};
  }
  if(command.action==='fooditem.return-credit-void'){
   const returnCreditVoid=parseReturnCreditVoid(command.input,at,w.me.id),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,returnCreditVoid.matchRevision).first<{event:string}>();
   requireThat(original&&(JSON.parse(original.event) as FoodEvent).returnCredit,'Original match not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.returnCreditVoid.matchRevision')=? LIMIT 1").bind(w.location.id,command.recordId,returnCreditVoid.matchRevision).first();
   requireThat(!voided,'This match was already voided. Refresh the history.',409);detailEvent={returnCreditVoid};
  }
  if(command.action==='fooditem.claim'){
   const revision=Number(command.input.invoiceRevision),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,revision).first<{event:string}>();
   const invoice=original?(JSON.parse(original.event) as FoodEvent).invoiceLine:undefined;requireThat(invoice,'Original invoice line not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoiceVoid.invoiceRevision')=? LIMIT 1").bind(w.location.id,command.recordId,revision).first();requireThat(!voided,'A voided invoice cannot receive an issue.',409);
   requireThat(!(await invoiceClaims(db,w.location.id,command.recordId,[revision])).size,'This invoice line already has a supplier issue. Continue or reopen it; cancel an incorrect record before replacing it.',409);
   detailEvent={supplierClaim:parseClaim(command.input,invoice,at,w.me.id,w.location.timezone)};
  }
  if(command.action==='fooditem.claim-update'){
   const update=parseClaimUpdate(command.input,at,w.me.id),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,update.claimRevision).first<{event:string}>();
   const claim=original?(JSON.parse(original.event) as FoodEvent).supplierClaim:undefined;requireThat(claim,'Original supplier issue not found for this item.',404);
   const latest=(await claimLatest(db,w.location.id,command.recordId,[update.claimRevision])).get(update.claimRevision);
   requireThat(latest?.state!=='cancelled','A cancelled issue stays in history. Open a corrected issue from its invoice.',409);
   requireThat(!(latest?.state==='closed'&&update.state==='closed'),'This issue is already closed. Reopen it before adding further follow-up.',409);
   if(update.state==='pending')requireThat(update.followUpDate>=claim.openedDate,'Follow-up cannot precede the original issue date.');
   detailEvent={claimUpdate:update};
  }
  if(command.action==='fooditem.credit'){
   const invoiceRevision=Number(command.input.invoiceRevision),original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,invoiceRevision).first<{event:string}>();
   const invoice=original?(JSON.parse(original.event) as FoodEvent).invoiceLine:undefined;
   requireThat(invoice,'Original invoice line not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.invoiceVoid.invoiceRevision')=? LIMIT 1").bind(w.location.id,command.recordId,invoiceRevision).first();
   requireThat(!voided,'A voided invoice cannot receive a credit.',409);
   const totals=(await creditTotals(db,w.location.id,command.recordId,[invoiceRevision])).get(invoiceRevision)??{entries:0,amountCents:0,quantity:0};
   const invoiceCredit=parseCredit(command.input,invoice,totals,at,w.me.id,w.location.timezone);
   const duplicate=await db.prepare("SELECT h.sequence FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id WHERE h.location_id=? AND r.dataset=? AND json_extract(h.event,'$.invoiceCredit.entryKey')=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.creditVoid.creditRevision')=h.revision) LIMIT 1").bind(w.location.id,invoice.dataset,invoiceCredit.entryKey).first();
   requireThat(!duplicate,'This supplier credit line is already recorded in this restaurant and dataset. Correct its original entry first.',409);
   detailEvent={invoiceCredit};
  }
  if(command.action==='fooditem.credit-void'){
   const creditVoid=parseCreditVoid(command.input,at,w.me.id);
   const original=await db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=?').bind(w.location.id,command.recordId,creditVoid.creditRevision).first<{event:string}>();
   requireThat(original&&(JSON.parse(original.event) as FoodEvent).invoiceCredit,'Original credit not found for this item.',404);
   const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.creditVoid.creditRevision')=? LIMIT 1").bind(w.location.id,command.recordId,creditVoid.creditRevision).first();
   requireThat(!voided,'This credit was already voided. Refresh the history.',409);
   requireThat(!(await returnCreditTotals(db,w.location.id,command.recordId,'credit',[creditVoid.creditRevision])).get(creditVoid.creditRevision)?.entries,'This credit has return matches. Correct incorrect linked matches before voiding their source.',409);
   detailEvent={creditVoid};
  }
 }
 const token=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM food_state WHERE location_id=? AND last_command=?)';
 const result:FoodResult={recordId:changed[0]?.id,revision:changed[0]?.revision,foodRevision:ctx.revision+1,added:importing?changed.length:0,existing};
 const statements=[db.prepare(`INSERT INTO food_state(location_id) SELECT ? WHERE ${policy.sql} ON CONFLICT(location_id) DO NOTHING`).bind(w.location.id,...policy.values),
  db.prepare(`UPDATE food_state SET revision=revision+1,last_command=? WHERE location_id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND location_id=? AND auth_user_id=? AND active=1 AND revision=?) AND ${policy.sql}`).bind(token,w.location.id,ctx.revision,w.me.id,w.location.id,identity.authUserId,ctx.membershipRevision,...policy.values)];
 if(source)statements.push(db.prepare(`INSERT INTO food_sources(location_id,dataset,source_restaurant_id) SELECT ?,?,? WHERE ${gate} ON CONFLICT(location_id,dataset) DO NOTHING`).bind(w.location.id,source.dataset,source.sourceRestaurantId,w.location.id,token));
 for(const r of changed){
  const event:FoodEvent={action:command.action,history:r.data.history,...detailEvent,...(r.kind==='fooditem'?{count:r.data.countHistory.at(-1),definition:r.data.definitionHistory.at(-1)}:{})};
  // Keep only current state with the definition. History is append-only, paged separately.
  const data={...r.data,history:[],...(r.kind==='fooditem'?{countHistory:[],definitionHistory:[]}:{})},encoded=JSON.stringify(data),eventJson=JSON.stringify(event);
  requireThat(new TextEncoder().encode(encoded).byteLength<=64000&&new TextEncoder().encode(eventJson).byteLength<=128000,'This definition is too large. Split its supporting documentation.');
  statements.push(db.prepare(`INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,storage_area,owner_id,area,revision,data,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(id) DO UPDATE SET title=excluded.title,storage_area=excluded.storage_area,revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at`).bind(r.id,r.locationId,r.kind,r.data.source.dataset,r.data.source.sourceRestaurantId,r.kind==='fooditem'?r.data.controlNumber:r.data.sourceId,r.data.title,r.kind==='fooditem'?r.data.storageArea:'',r.ownerId,r.area,r.revision,encoded,at,w.location.id,token));
  statements.push(db.prepare(`INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(w.location.id,r.id,r.revision,w.me.id,at,eventJson,w.location.id,token));
 }
 statements.push(db.prepare(`INSERT INTO food_receipts(location_id,actor_id,request_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${gate}`).bind(w.location.id,w.me.id,command.requestId,fingerprint,JSON.stringify(result),w.location.id,token));
 statements.push(db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(token,w.location.id,w.me.id,command.action,changed[0]?.id??'food-import-existing',at,result.foodRevision,w.location.id,token));
 const saved=await db.batch(statements);
 if(!saved[1].meta.changes){await requireRestaurantAccess(db,identity,w.location.id);const repeated=await prior(db,w.location.id,w.me.id,command.requestId,fingerprint);if(repeated)return repeated;throw new AppError(409,'Food records or your access changed. Reload before saving.');}
 return result;
}
export async function handleFood(request:Request,binding?:D1Database):Promise<Response>{
 try{
  requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
  const {db,identity}=await authenticateWorkspace(request,binding),url=new URL(request.url);
  if(request.method==='GET')return json(await page(db,identity,url));
  requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);
  requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
  const body=object(await boundedJson(request.body,128000));
  const command:Command={requestId:id(body.requestId),locationId:id(body.locationId),action:text(body.action,'Action',60),input:object(body.input)};
  if(body.recordId!==undefined){command.recordId=id(body.recordId);requireThat(Number.isInteger(body.expectedRevision)&&Number(body.expectedRevision)>0,'An exact record revision is required.');command.expectedRevision=Number(body.expectedRevision);}
  return json(await commit(db,identity,command));
 }catch(error){if(error instanceof AppError)return json({error:error.message},error.status);console.error(JSON.stringify({event:'food_request_failed',errorType:error instanceof Error?error.name:'unknown'}));return json({error:'Food storage could not confirm this change. Retrying the same request is safe.'},503);}
}
