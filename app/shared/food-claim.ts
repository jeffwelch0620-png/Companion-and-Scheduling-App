import type {FoodInvoiceLine} from './food-invoice';
import {invoiceUnit} from './food-invoice';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {text,requireThat} from './validation';

export const claimReasons={shortage:'Short or missing delivery',damaged:'Damaged or rejected goods',returned:'Returned goods',price:'Price discrepancy'} as const;
export type ClaimState='pending'|'closed'|'cancelled';
export type ClaimFields={invoiceRevision:number;reference:string;openedDate:string;reason:keyof typeof claimReasons;details:string;followUpDate:string;at:string;by:string};
export type ClaimImpact={quantity?:number;unit?:string;amountCents?:number};
export type FoodClaim=ClaimFields&{invoice:FoodInvoiceLine;impact?:ClaimImpact};
export type FoodClaimUpdate={claimRevision:number;state:ClaimState;note:string;followUpDate:string;at:string;by:string};
export type ClaimLatest=FoodClaimUpdate&{revision:number};
export type InvoiceClaim={sequence:number;revision:number;claim:FoodClaim;latest?:ClaimLatest};

export function parseClaimFields(input:Record<string,unknown>,at:string,by:string,timezone:string):ClaimFields{
 requireThat(Number.isSafeInteger(input.invoiceRevision)&&Number(input.invoiceRevision)>0,'Choose the original invoice line.');
 const openedDate=calendarDate(input.openedDate,'Issue date'),followUpDate=calendarDate(input.followUpDate,'Follow-up date');
 requireThat(openedDate<=localDate(at,timezone),'The issue date cannot be in the future.');
 requireThat(followUpDate>=openedDate,'Follow-up cannot precede the issue date.');
 requireThat(typeof input.reason==='string'&&Object.hasOwn(claimReasons,input.reason),'Choose a supplier issue reason.');
 requireThat(input.confirmed===true,'Confirm these are source-checked facts for internal follow-up.');
 return {invoiceRevision:Number(input.invoiceRevision),reference:text(input.reference,'Internal issue reference',100),openedDate,followUpDate,reason:input.reason as ClaimFields['reason'],details:text(input.details,'Issue facts and source reference',2000),at,by};
}
export function parseClaim(input:Record<string,unknown>,invoice:FoodInvoiceLine,at:string,by:string,timezone:string):FoodClaim{
 const fields=parseClaimFields(input,at,by,timezone);
 requireThat(fields.openedDate>=invoice.invoiceDate,'The issue date cannot precede the invoice date.');
 const impact:ClaimImpact={},present=(value:unknown)=>value!==undefined&&value!==null&&value!=='';
 if(present(input.quantity)){
  const quantity=input.quantity;
  requireThat((typeof quantity==='number'||typeof quantity==='string'&&quantity.trim()!=='')&&Number.isFinite(Number(quantity))&&Number(quantity)>0&&Number(quantity)<=invoice.quantity,'Quantity in question must be greater than zero and no more than the original invoice quantity.');
  requireThat(typeof input.quantityUnit==='string'&&invoiceUnit(input.quantityUnit)===invoice.invoiceUnit,'Use the original invoice unit for the quantity in question.');
  impact.quantity=Number(quantity);impact.unit=invoice.invoiceUnit;
 }
 if(present(input.amount)){
  const amount=input.amount;
  requireThat((typeof amount==='string'||typeof amount==='number')&&/^\d{1,7}(\.\d{1,2})?$/.test(String(amount)),'Enter the net amount in question in dollars and cents, without tax, freight or currency symbols.');
  const cents=Math.round(Number(amount)*100);
  requireThat(cents<=invoice.lineTotalCents,'The net amount in question cannot exceed this original invoice line amount.');
  impact.amountCents=cents;
 }
 return {...fields,invoice:structuredClone(invoice),...(Object.keys(impact).length?{impact}:{})};
}
export function parseClaimUpdate(input:Record<string,unknown>,at:string,by:string):FoodClaimUpdate{
 requireThat(Number.isSafeInteger(input.claimRevision)&&Number(input.claimRevision)>0,'Choose the original supplier issue.');
 requireThat(['pending','closed','cancelled'].includes(String(input.state)),'Choose pending, closed or cancelled.');
 const state=input.state as ClaimState,followUpDate=state==='pending'?calendarDate(input.followUpDate,'Next follow-up date'):'';
 return {claimRevision:Number(input.claimRevision),state,followUpDate,note:text(input.note,'Follow-up facts or reason',2000),at,by};
}
// Latest updates are fetched from the complete immutable history, not just the visible page.
export async function claimLatest(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,ClaimLatest>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT h.revision,json_extract(h.event,'$.claimUpdate') AS update_json FROM food_history h
 WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.claimUpdate.claimRevision') IN (${revisions.map(()=>'?').join(',')})
 AND NOT EXISTS(SELECT 1 FROM food_history n WHERE n.location_id=h.location_id AND n.record_id=h.record_id AND n.sequence>h.sequence AND json_extract(n.event,'$.claimUpdate.claimRevision')=json_extract(h.event,'$.claimUpdate.claimRevision'))`).bind(locationId,recordId,...revisions).all<{revision:number;update_json:string}>();
 return new Map(rows.results.map(r=>{const u=JSON.parse(r.update_json) as FoodClaimUpdate;return [u.claimRevision,{...u,revision:r.revision}]}));
}
// One non-cancelled issue per invoice line keeps related follow-ups in a single history.
export async function invoiceClaims(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,InvoiceClaim>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT h.sequence,h.revision,json_extract(h.event,'$.supplierClaim') AS claim_json FROM food_history h
 WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.supplierClaim.invoiceRevision') IN (${revisions.map(()=>'?').join(',')})
 AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.claimUpdate.claimRevision')=h.revision AND json_extract(v.event,'$.claimUpdate.state')='cancelled')`).bind(locationId,recordId,...revisions).all<{sequence:number;revision:number;claim_json:string}>();
 const latest=await claimLatest(db,locationId,recordId,rows.results.map(r=>r.revision));
 return new Map(rows.results.map(r=>{const claim=JSON.parse(r.claim_json) as FoodClaim;return [claim.invoiceRevision,{sequence:r.sequence,revision:r.revision,claim,latest:latest.get(r.revision)}]}));
}
