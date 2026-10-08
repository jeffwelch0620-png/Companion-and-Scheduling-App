import type {FoodInvoiceLine} from './food-invoice';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export type ReceivingFields={invoiceRevision:number;deliveryReference:string;receivedDate:string;accepted:number;rejected:number;rejectionReason:string;note:string;at:string;by:string};
export type FoodReceiving=ReceivingFields&{entryKey:string;invoice:FoodInvoiceLine;acceptedSupplierPacks:number;rejectedSupplierPacks:number};
export type FoodReceivingVoid={receivingRevision:number;reason:string;at:string;by:string};
export type ReceivingTotals={entries:number;accepted:number;rejected:number};
function quantity(value:unknown,label:string){
 requireThat((typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1000000,`Enter ${label} as a number from zero to 1,000,000.`);
 return Number(value);
}
export function parseReceivingFields(input:Record<string,unknown>,at:string,by:string,timezone:string):ReceivingFields{
 requireThat(Number.isSafeInteger(input.invoiceRevision)&&Number(input.invoiceRevision)>0,'Choose the original invoice line.');
 const receivedDate=calendarDate(input.receivedDate,'Delivery date'),deliveryReference=text(input.deliveryReference,'Delivery reference',150);
 requireThat(receivedDate<=localDate(at,timezone),'An actual delivery cannot be dated in the future.');
 const accepted=quantity(input.accepted,'the accepted quantity'),rejected=quantity(input.rejected,'the rejected quantity');
 requireThat(accepted+rejected>0,'Record at least one accepted or rejected quantity. An outstanding quantity alone is not a delivery.');
 const rejectionReason=text(input.rejectionReason??'','Rejection reason',1000,rejected===0),note=text(input.note??'','Receiving note',1000,true);
 requireThat(input.confirmed===true,'Confirm the delivered quantities were checked in the original invoice unit.');
 return {invoiceRevision:Number(input.invoiceRevision),receivedDate,deliveryReference,accepted,rejected,rejectionReason,note,at,by};
}
export function parseReceiving(input:Record<string,unknown>,invoice:FoodInvoiceLine,used:ReceivingTotals,at:string,by:string,timezone:string):FoodReceiving{
 const fields=parseReceivingFields(input,at,by,timezone),remaining=invoice.quantity-used.accepted-used.rejected;
 const tolerance=Number.EPSILON*Math.max(1,invoice.quantity)*8;
 requireThat(fields.accepted+fields.rejected<=remaining+tolerance,'This delivery exceeds the invoice quantity still unaccounted for. Review the source or void an incorrect receipt first.',409);
 const acceptedSupplierPacks=fields.accepted/invoice.quantity*invoice.supplierPackQuantity,rejectedSupplierPacks=fields.rejected/invoice.quantity*invoice.supplierPackQuantity;
 requireThat(Number.isFinite(acceptedSupplierPacks)&&Number.isFinite(rejectedSupplierPacks),'The received quantity cannot be normalized.');
 return {...fields,entryKey:JSON.stringify([fields.invoiceRevision,fields.deliveryReference.trim().toLowerCase().replace(/\s+/g,' ')]),invoice:structuredClone(invoice),acceptedSupplierPacks,rejectedSupplierPacks};
}
export function parseReceivingVoid(input:Record<string,unknown>,at:string,by:string):FoodReceivingVoid{
 requireThat(Number.isSafeInteger(input.receivingRevision)&&Number(input.receivingRevision)>0,'Choose the original receiving entry.');
 return {receivingRevision:Number(input.receivingRevision),reason:text(input.reason,'Reason for voiding receipt',1000),at,by};
}
// Resolve the entire event history in SQL, including voids beyond the visible page.
export async function receivingTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,ReceivingTotals>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.receiving.invoiceRevision') AS invoiceRevision,count(*) AS entries,
  coalesce(sum(json_extract(h.event,'$.receiving.accepted')),0) AS accepted,coalesce(sum(json_extract(h.event,'$.receiving.rejected')),0) AS rejected
  FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.receiving.invoiceRevision') IN (${revisions.map(()=>'?').join(',')})
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.receivingVoid.receivingRevision')=h.revision)
  GROUP BY invoiceRevision`).bind(locationId,recordId,...revisions).all<ReceivingTotals&{invoiceRevision:number}>();
 return new Map(rows.results.map(r=>[r.invoiceRevision,{entries:r.entries,accepted:r.accepted,rejected:r.rejected}]));
}
