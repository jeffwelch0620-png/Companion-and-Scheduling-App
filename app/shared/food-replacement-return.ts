import type {FoodReplacement} from './food-replacement';
import type {ExcessTotals} from './food-excess';
import {invoiceUnit} from './food-invoice';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';
export type ReplacementReturnFields={replacementRevision:number;returnReference:string;returnDate:string;quantity:number;invoiceUnit:string;reason:string;evidence:string;at:string;by:string};
export type FoodReplacementReturn=ReplacementReturnFields&{entryKey:string;replacement:FoodReplacement;supplierPacks:number};
export type FoodReplacementReturnVoid={returnRevision:number;reason:string;at:string;by:string};
export function parseReplacementReturnFields(input:Record<string,unknown>,at:string,by:string,timezone:string):ReplacementReturnFields{
 requireThat(Number.isSafeInteger(input.replacementRevision)&&Number(input.replacementRevision)>0,'Choose the original replacement goods entry.');
 const returnDate=calendarDate(input.returnDate,'Replacement goods return date');
 requireThat(returnDate<=localDate(at,timezone),'An actual supplier pickup cannot be dated in the future.');
 requireThat((typeof input.quantity==='number'||typeof input.quantity==='string'&&input.quantity.trim()!=='')&&Number.isFinite(Number(input.quantity))&&Number(input.quantity)>0&&Number(input.quantity)<=1000000,'Enter a returned quantity greater than zero and no more than 1,000,000.');
 requireThat(input.confirmed===true,'Confirm these replacement goods were physically returned to the supplier in the original invoice unit.');
 return {replacementRevision:Number(input.replacementRevision),returnReference:text(input.returnReference,'Supplier pickup reference',150),returnDate,quantity:Number(input.quantity),invoiceUnit:invoiceUnit(text(input.invoiceUnit,'Original invoice unit',30)),reason:text(input.reason,'Return reason',1000),evidence:text(input.evidence,'Actual pickup evidence',1000),at,by};
}
export function parseReplacementReturn(input:Record<string,unknown>,replacement:FoodReplacement,used:ExcessTotals,at:string,by:string,timezone:string):FoodReplacementReturn{
 const fields=parseReplacementReturnFields(input,at,by,timezone);
 requireThat(fields.returnDate>=replacement.receivedDate,'A supplier pickup cannot precede the original accepted replacement delivery.');
 requireThat(fields.invoiceUnit===replacement.receiving.invoice.invoiceUnit,'Use the original invoice unit for this pickup.');
 requireThat(fields.quantity<=replacement.quantity-used.quantity+Number.EPSILON*replacement.quantity*8,'Returned replacement goods exceed the quantity remaining from this arrival.',409);
 const supplierPacks=fields.quantity/replacement.receiving.invoice.quantity*replacement.receiving.invoice.supplierPackQuantity;
 requireThat(Number.isFinite(supplierPacks)&&supplierPacks>0,'The pickup quantity cannot be normalized.');
 return {...fields,entryKey:JSON.stringify([fields.replacementRevision,fields.returnReference.toLowerCase().replace(/\s+/g,' ')]),replacement:structuredClone(replacement),supplierPacks};
}
export function parseReplacementReturnVoid(input:Record<string,unknown>,at:string,by:string):FoodReplacementReturnVoid{
 requireThat(Number.isSafeInteger(input.returnRevision)&&Number(input.returnRevision)>0,'Choose the replacement goods return.');
 return {returnRevision:Number(input.returnRevision),reason:text(input.reason,'Reason for voiding pickup record',1000),at,by};
}
export async function replacementReturnTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,ExcessTotals>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.replacementReturn.replacementRevision') AS sourceRevision,count(*) AS entries,total(json_extract(h.event,'$.replacementReturn.quantity')) AS quantity FROM food_history h
  WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.replacementReturn.replacementRevision') IN (${revisions.map(()=>'?').join(',')})
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.replacementReturnVoid.returnRevision')=h.revision)
  GROUP BY sourceRevision`).bind(locationId,recordId,...revisions).all<ExcessTotals&{sourceRevision:number}>();
 return new Map(rows.results.map(r=>[r.sourceRevision,{entries:r.entries,quantity:r.quantity}]));
}
export async function enrichReplacementReturns(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,entries:import('./food-contract').FoodHistoryPage['entries']){
 const ids=entries.filter(e=>e.event.replacement).map(e=>e.revision),totals=await replacementReturnTotals(db,locationId,recordId,ids);
 for(const e of entries)if(e.event.replacement)e.replacementReturned=totals.get(e.revision)??{entries:0,quantity:0};
 const returns=entries.filter(e=>e.event.replacementReturn).map(e=>e.revision);if(!returns.length)return;
 const rows=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.replacementReturnVoid.returnRevision') IN (${returns.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...returns).all<{revision:number;event:string}>();
 for(const r of rows.results){const v=(JSON.parse(r.event) as import('./food-contract').FoodEvent).replacementReturnVoid,e=entries.find(e=>e.revision===v?.returnRevision);if(v&&e)e.replacementReturnVoided={...v,revision:r.revision};}
}
