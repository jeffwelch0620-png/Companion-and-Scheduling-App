import type {FoodExcess,ExcessTotals} from './food-excess';
import {invoiceUnit} from './food-invoice';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';
export type ExcessReturnFields={excessRevision:number;returnReference:string;returnDate:string;quantity:number;invoiceUnit:string;reason:string;evidence:string;at:string;by:string};
export type FoodExcessReturn=ExcessReturnFields&{entryKey:string;excess:FoodExcess;supplierPacks:number};
export type FoodExcessReturnVoid={returnRevision:number;reason:string;at:string;by:string};
export function parseExcessReturnFields(input:Record<string,unknown>,at:string,by:string,timezone:string):ExcessReturnFields{
 requireThat(Number.isSafeInteger(input.excessRevision)&&Number(input.excessRevision)>0,'Choose the original extra goods entry.');
 const returnDate=calendarDate(input.returnDate,'Extra goods return date');
 requireThat(returnDate<=localDate(at,timezone),'An actual supplier pickup cannot be dated in the future.');
 requireThat((typeof input.quantity==='number'||typeof input.quantity==='string'&&input.quantity.trim()!=='')&&Number.isFinite(Number(input.quantity))&&Number(input.quantity)>0&&Number(input.quantity)<=1000000,'Enter a returned quantity greater than zero and no more than 1,000,000.');
 requireThat(input.confirmed===true,'Confirm these extra goods were physically returned to the supplier in the original invoice unit.');
 return {excessRevision:Number(input.excessRevision),returnReference:text(input.returnReference,'Supplier pickup reference',150),returnDate,quantity:Number(input.quantity),invoiceUnit:invoiceUnit(text(input.invoiceUnit,'Original invoice unit',30)),reason:text(input.reason,'Return reason',1000),evidence:text(input.evidence,'Actual pickup evidence',1000),at,by};
}
export function parseExcessReturn(input:Record<string,unknown>,excess:FoodExcess,used:ExcessTotals,at:string,by:string,timezone:string):FoodExcessReturn{
 const fields=parseExcessReturnFields(input,at,by,timezone);
 requireThat(fields.returnDate>=excess.observedDate,'A supplier pickup cannot precede the original extra delivery.');
 requireThat(fields.invoiceUnit===excess.invoice.invoiceUnit,'Use the original invoice unit for this pickup.');
 requireThat(fields.quantity<=excess.quantity-used.quantity+Number.EPSILON*excess.quantity*8,'Returned extra goods exceed the quantity remaining from this observation.',409);
 const supplierPacks=fields.quantity/excess.invoice.quantity*excess.invoice.supplierPackQuantity;
 requireThat(Number.isFinite(supplierPacks)&&supplierPacks>0,'The pickup quantity cannot be normalized.');
 return {...fields,entryKey:JSON.stringify([fields.excessRevision,fields.returnReference.toLowerCase().replace(/\s+/g,' ')]),excess:structuredClone(excess),supplierPacks};
}
export function parseExcessReturnVoid(input:Record<string,unknown>,at:string,by:string):FoodExcessReturnVoid{
 requireThat(Number.isSafeInteger(input.returnRevision)&&Number(input.returnRevision)>0,'Choose the extra goods return.');
 return {returnRevision:Number(input.returnRevision),reason:text(input.reason,'Reason for voiding pickup record',1000),at,by};
}
export async function excessReturnTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,scope:'extra'|'invoice',revisions:number[]):Promise<Map<number,ExcessTotals>>{
 if(!revisions.length)return new Map();
 const field=scope==='extra'?'$.excessReturn.excessRevision':'$.excessReturn.excess.invoiceRevision';
 const rows=await db.prepare(`SELECT json_extract(h.event,'${field}') AS sourceRevision,count(*) AS entries,total(json_extract(h.event,'$.excessReturn.quantity')) AS quantity FROM food_history h
  WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'${field}') IN (${revisions.map(()=>'?').join(',')})
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessReturnVoid.returnRevision')=h.revision)
  GROUP BY sourceRevision`).bind(locationId,recordId,...revisions).all<ExcessTotals&{sourceRevision:number}>();
 return new Map(rows.results.map(r=>[r.sourceRevision,{entries:r.entries,quantity:r.quantity}]));
}
