import type {FoodInvoiceLine} from './food-invoice';
import {invoiceUnit} from './food-invoice';
import type {ReceivingTotals} from './food-receiving';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export type ExcessFields={invoiceRevision:number;deliveryReference:string;observedDate:string;quantity:number;invoiceUnit:string;evidence:string;goodsLocation:string;at:string;by:string};
export type FoodExcess=ExcessFields&{entryKey:string;invoice:FoodInvoiceLine;supplierPacks:number;receivingAtEntry:ReceivingTotals};
export type FoodExcessVoid={excessRevision:number;reason:string;at:string;by:string};
export type ExcessTotals={entries:number;quantity:number};
export function parseExcessFields(input:Record<string,unknown>,at:string,by:string,timezone:string):ExcessFields{
 requireThat(Number.isSafeInteger(input.invoiceRevision)&&Number(input.invoiceRevision)>0,'Choose the original invoice line.');
 const observedDate=calendarDate(input.observedDate,'Extra goods delivery date');
 requireThat(observedDate<=localDate(at,timezone),'An actual extra delivery cannot be dated in the future.');
 requireThat((typeof input.quantity==='number'||typeof input.quantity==='string'&&input.quantity.trim()!=='')&&Number.isFinite(Number(input.quantity))&&Number(input.quantity)>0&&Number(input.quantity)<=1000000,'Enter an extra quantity greater than zero and no more than 1,000,000.');
 requireThat(input.confirmed===true,'Confirm these are additional goods for this same invoice item, beyond the quantities already checked.');
 return {invoiceRevision:Number(input.invoiceRevision),deliveryReference:text(input.deliveryReference,'Extra delivery reference',150),observedDate,quantity:Number(input.quantity),invoiceUnit:invoiceUnit(text(input.invoiceUnit,'Original invoice unit',30)),evidence:text(input.evidence,'Evidence of extra goods',1000),goodsLocation:text(input.goodsLocation,'Where the extra goods are now',1000),at,by};
}
export function parseExcess(input:Record<string,unknown>,invoice:FoodInvoiceLine,used:ReceivingTotals,at:string,by:string,timezone:string):FoodExcess{
 const fields=parseExcessFields(input,at,by,timezone);
 requireThat(Math.abs(invoice.quantity-used.accepted-used.rejected)<=Number.EPSILON*Math.max(1,invoice.quantity)*8,'Complete the invoiced quantity checks before recording additional goods.',409);
 requireThat(fields.invoiceUnit===invoice.invoiceUnit,'Use the original invoice unit for extra goods.');
 const supplierPacks=fields.quantity/invoice.quantity*invoice.supplierPackQuantity;
 requireThat(Number.isFinite(supplierPacks)&&supplierPacks>0,'The extra quantity cannot be normalized.');
 return {...fields,invoice:structuredClone(invoice),receivingAtEntry:{...used},supplierPacks,entryKey:JSON.stringify([fields.invoiceRevision,fields.deliveryReference.trim().toLowerCase().replace(/\s+/g,' ')])};
}
export function parseExcessVoid(input:Record<string,unknown>,at:string,by:string):FoodExcessVoid{
 requireThat(Number.isSafeInteger(input.excessRevision)&&Number(input.excessRevision)>0,'Choose the extra goods entry.');
 return {excessRevision:Number(input.excessRevision),reason:text(input.reason,'Reason for voiding extra goods',1000),at,by};
}
// Immutable observations remain separate from invoiced receiving, stock and settlement.
export async function excessTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,ExcessTotals>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.excess.invoiceRevision') AS invoiceRevision,count(*) AS entries,total(json_extract(h.event,'$.excess.quantity')) AS quantity FROM food_history h
  WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.excess.invoiceRevision') IN (${revisions.map(()=>'?').join(',')})
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessVoid.excessRevision')=h.revision) GROUP BY invoiceRevision`).bind(locationId,recordId,...revisions).all<ExcessTotals&{invoiceRevision:number}>();
 return new Map(rows.results.map(r=>[r.invoiceRevision,{entries:r.entries,quantity:r.quantity}]));
}
