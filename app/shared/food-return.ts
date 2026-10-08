import type {FoodReceiving,ReceivingTotals} from './food-receiving';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export type ReturnFields={receivingRevision:number;returnReference:string;returnDate:string;accepted:number;rejected:number;reason:string;evidence:string;at:string;by:string};
export type FoodSupplierReturn=ReturnFields&{entryKey:string;receiving:FoodReceiving;acceptedSupplierPacks:number;rejectedSupplierPacks:number};
export type FoodSupplierReturnVoid={returnRevision:number;reason:string;at:string;by:string};
function quantity(value:unknown,label:string){
 requireThat((typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1000000,`Enter ${label} as a number from zero to 1,000,000.`);
 return Number(value);
}
export function parseReturnFields(input:Record<string,unknown>,at:string,by:string,timezone:string):ReturnFields{
 requireThat(Number.isSafeInteger(input.receivingRevision)&&Number(input.receivingRevision)>0,'Choose the original delivery entry.');
 const returnDate=calendarDate(input.returnDate,'Return date');
 requireThat(returnDate<=localDate(at,timezone),'An actual return cannot be dated in the future.');
 const accepted=quantity(input.accepted,'the quantity returned from accepted goods'),rejected=quantity(input.rejected,'the quantity returned from rejected goods');
 requireThat(accepted+rejected>0,'Record at least one quantity physically returned to the supplier.');
 requireThat(input.confirmed===true,'Confirm these goods have actually been returned, in the original invoice unit.');
 return {receivingRevision:Number(input.receivingRevision),returnDate,returnReference:text(input.returnReference,'Return reference',150),accepted,rejected,reason:text(input.reason,'Return reason',1000),evidence:text(input.evidence,'Return evidence',1000),at,by};
}
export function parseSupplierReturn(input:Record<string,unknown>,receiving:FoodReceiving,used:ReceivingTotals,at:string,by:string,timezone:string):FoodSupplierReturn{
 const fields=parseReturnFields(input,at,by,timezone),invoice=receiving.invoice,tolerance=Number.EPSILON*Math.max(1,invoice.quantity)*8;
 requireThat(fields.returnDate>=receiving.receivedDate,'A return cannot precede its original delivery.');
 requireThat(fields.accepted<=receiving.accepted-used.accepted+tolerance,'Returned accepted goods exceed the accepted quantity remaining from this delivery.',409);
 requireThat(fields.rejected<=receiving.rejected-used.rejected+tolerance,'Returned rejected goods exceed the rejected quantity remaining from this delivery.',409);
 const acceptedSupplierPacks=fields.accepted/invoice.quantity*invoice.supplierPackQuantity,rejectedSupplierPacks=fields.rejected/invoice.quantity*invoice.supplierPackQuantity;
 requireThat(Number.isFinite(acceptedSupplierPacks)&&Number.isFinite(rejectedSupplierPacks),'The returned quantity cannot be normalized.');
 return {...fields,entryKey:JSON.stringify([fields.receivingRevision,fields.returnReference.toLowerCase().replace(/\s+/g,' ')]),receiving:structuredClone(receiving),acceptedSupplierPacks,rejectedSupplierPacks};
}
export function parseSupplierReturnVoid(input:Record<string,unknown>,at:string,by:string):FoodSupplierReturnVoid{
 requireThat(Number.isSafeInteger(input.returnRevision)&&Number(input.returnRevision)>0,'Choose the original supplier return.');
 return {returnRevision:Number(input.returnRevision),reason:text(input.reason,'Reason for voiding return',1000),at,by};
}
// All immutable events count, including corrections on later history pages.
export async function supplierReturnTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,ReceivingTotals>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.supplierReturn.receivingRevision') AS receivingRevision,count(*) AS entries,
  coalesce(sum(json_extract(h.event,'$.supplierReturn.accepted')),0) AS accepted,coalesce(sum(json_extract(h.event,'$.supplierReturn.rejected')),0) AS rejected
  FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.supplierReturn.receivingRevision') IN (${revisions.map(()=>'?').join(',')})
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.supplierReturnVoid.returnRevision')=h.revision)
  GROUP BY receivingRevision`).bind(locationId,recordId,...revisions).all<ReceivingTotals&{receivingRevision:number}>();
 return new Map(rows.results.map(r=>[r.receivingRevision,{entries:r.entries,accepted:r.accepted,rejected:r.rejected}]));
}
