import type {FoodExcess,ExcessTotals} from './food-excess';
import type {FoodInvoiceLine} from './food-invoice';
import type {FoodEvent,FoodHistoryPage} from './food-contract';
import {id,requireThat,text} from './validation';
export type ExcessBillingFields={excessRevision:number;invoiceRevision:number;quantity:number;note:string;at:string;by:string};
export type FoodExcessBilling=ExcessBillingFields&{excess:FoodExcess;invoice:FoodInvoiceLine};
export type FoodExcessBillingVoid={matchRevision:number;reason:string;at:string;by:string};
const norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
export function excessBillingIssue(excess:FoodExcess,invoice:FoodInvoiceLine,revision:number):string{
 const a=excess.invoice,b=invoice;
 if(revision===excess.invoiceRevision)return 'Choose a separate invoice line for these additional goods.';
 if(b.dataset!==a.dataset)return 'The invoice must use the same dataset.';
 if(b.invoiceDate<excess.observedDate)return 'The billing invoice predates the extra delivery.';
 if(a.sku.id!==b.sku.id||norm(a.sku.vendor)!==norm(b.sku.vendor)||norm(a.sku.vendorSku)!==norm(b.sku.vendorSku))return 'Supplier and supplier item must match the original extra goods.';
 if(a.invoiceUnit!==b.invoiceUnit||a.unitBasis!==b.unitBasis)return 'Invoice units and quantity basis must match; conversions are not inferred.';
 if(a.unitBasis==='supplier-pack'&&(['purchaseUnit','packCount','unitQty','unitUOM'] as const).some(k=>a.sku[k]!==b.sku[k]))return 'Supplier-pack definitions differ. Review the original documents; packs are not treated as equal.';
 return '';
}
export function parseExcessBillingFields(input:Record<string,unknown>,at:string,by:string):ExcessBillingFields{
 for(const key of ['excessRevision','invoiceRevision'])requireThat(Number.isSafeInteger(input[key])&&Number(input[key])>0,'Choose the extra delivery and billing invoice line.');
 requireThat((typeof input.quantity==='number'||typeof input.quantity==='string'&&input.quantity.trim()!=='')&&Number.isFinite(Number(input.quantity))&&Number(input.quantity)>0&&Number(input.quantity)<=1000000,'Enter a positive matched quantity no greater than 1,000,000.');
 requireThat(input.confirmed===true,'Confirm the issued invoice line bills this quantity from the selected extra delivery.');
 return {excessRevision:Number(input.excessRevision),invoiceRevision:Number(input.invoiceRevision),quantity:Number(input.quantity),note:text(input.note,'Billing match evidence',1000),at,by};
}
export function parseExcessBilling(input:Record<string,unknown>,excess:FoodExcess,invoice:FoodInvoiceLine,usedExtra:ExcessTotals,usedInvoice:ExcessTotals,at:string,by:string):FoodExcessBilling{
 const f=parseExcessBillingFields(input,at,by),issue=excessBillingIssue(excess,invoice,f.invoiceRevision);requireThat(!issue,issue);
 requireThat(f.quantity<=excess.quantity-usedExtra.quantity+Number.EPSILON*excess.quantity*8,'This match exceeds extra goods not yet linked to billing.',409);
 requireThat(f.quantity<=invoice.quantity-usedInvoice.quantity+Number.EPSILON*invoice.quantity*8,'This match exceeds the invoice quantity not yet linked to extra goods.',409);
 return {...f,excess:structuredClone(excess),invoice:structuredClone(invoice)};
}
export function parseExcessBillingVoid(input:Record<string,unknown>,at:string,by:string):FoodExcessBillingVoid{
 requireThat(Number.isSafeInteger(input.matchRevision)&&Number(input.matchRevision)>0,'Choose the billing match.');return {matchRevision:Number(input.matchRevision),reason:text(input.reason,'Reason for voiding billing match',1000),at,by};
}
export async function excessBillingTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,side:'extra'|'invoice',revisions:number[]):Promise<Map<number,ExcessTotals>>{
 if(!revisions.length)return new Map();const field=side==='extra'?'excessRevision':'invoiceRevision';
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.excessBilling.${field}') AS target,count(*) AS entries,total(json_extract(h.event,'$.excessBilling.quantity')) AS quantity FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.excessBilling.${field}') IN (${revisions.map(()=>'?').join(',')}) AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessBillingVoid.matchRevision')=h.revision) GROUP BY target`).bind(locationId,recordId,...revisions).all<ExcessTotals&{target:number}>();
 return new Map(rows.results.map(r=>[r.target,{entries:r.entries,quantity:r.quantity}]));
}
export async function enrichExcessBilling(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,entries:FoodHistoryPage['entries']){
 for(const [side,field] of [['extra','excessBilled'],['invoice','invoiceExtraBilling']] as const){const ids=entries.filter(e=>side==='extra'?e.event.excess:e.event.invoiceLine).map(e=>e.revision),totals=await excessBillingTotals(db,locationId,recordId,side,ids);for(const e of entries)if(ids.includes(e.revision))e[field]=totals.get(e.revision)??{entries:0,quantity:0};}
 const ids=entries.filter(e=>e.event.excessBilling).map(e=>e.revision);if(!ids.length)return;
 const rows=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessBillingVoid.matchRevision') IN (${ids.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...ids).all<{revision:number;event:string}>();
 for(const r of rows.results){const v=(JSON.parse(r.event) as FoodEvent).excessBillingVoid,e=entries.find(e=>e.revision===v?.matchRevision);if(e&&v)e.excessBillingVoided={...v,revision:r.revision};}
}
export type ExcessBillingChoices={revision:number;recordId:string;dataset:string;excessRevision:number;quantity:number;matched:number;invoiceUnit:string;entries:{sequence:number;revision:number;invoice:FoodInvoiceLine;matched:number;issue:string}[];next:number|null};
export async function excessBillingChoices(db:Pick<D1Database,'prepare'>,locationId:string,dataset:string,url:URL,revision:number):Promise<ExcessBillingChoices>{
 const recordId=id(url.searchParams.get('recordId')),excessRevision=Number(url.searchParams.get('excessRevision')),before=Number(url.searchParams.get('before')??0);
 requireThat(Number.isSafeInteger(excessRevision)&&excessRevision>0&&Number.isSafeInteger(before)&&before>=0,'Choose the extra delivery and a valid invoice page.');
 if(before)requireThat(url.searchParams.has('revision')&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh billing invoices from the first page.',409);
 const row=await db.prepare('SELECT h.event FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id WHERE h.location_id=? AND h.record_id=? AND h.revision=? AND r.dataset=?').bind(locationId,recordId,excessRevision,dataset).first<{event:string}>(),extra=row?(JSON.parse(row.event) as FoodEvent).excess:undefined;
 requireThat(extra,'Extra delivery not found in this restaurant and dataset.',404);
 requireThat(!await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.excessVoid.excessRevision')=? LIMIT 1").bind(locationId,recordId,excessRevision).first(),'A voided extra delivery cannot be matched.',409);
 const rows=await db.prepare(`SELECT h.sequence,h.revision,json_extract(h.event,'$.invoiceLine') AS invoice FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_type(h.event,'$.invoiceLine')='object' AND h.revision!=? AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.invoiceVoid.invoiceRevision')=h.revision) AND (?=0 OR h.sequence<?) ORDER BY h.sequence DESC LIMIT 21`).bind(locationId,recordId,extra.invoiceRevision,before,before).all<{sequence:number;revision:number;invoice:string}>();
 const page=rows.results.slice(0,20),totals=await excessBillingTotals(db,locationId,recordId,'invoice',page.map(r=>r.revision)),matched=(await excessBillingTotals(db,locationId,recordId,'extra',[excessRevision])).get(excessRevision)?.quantity??0;
 const entries=page.map(r=>{const invoice=JSON.parse(r.invoice) as FoodInvoiceLine;return {...r,invoice,matched:totals.get(r.revision)?.quantity??0,issue:excessBillingIssue(extra,invoice,r.revision)}});
 return {revision,recordId,dataset,excessRevision,quantity:extra.quantity,matched,invoiceUnit:extra.invoice.invoiceUnit,entries,next:rows.results.length>20?entries.at(-1)!.sequence:null};
}
