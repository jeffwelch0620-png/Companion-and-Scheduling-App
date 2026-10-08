import type {FoodReceiving} from './food-receiving';
import type {ExcessTotals} from './food-excess';
import type {FoodEvent,FoodHistoryPage} from './food-contract';
import {invoiceUnit} from './food-invoice';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';
export type ReplacementFields={receivingRevision:number;deliveryReference:string;receivedDate:string;quantity:number;invoiceUnit:string;evidence:string;at:string;by:string};
export type FoodReplacement=ReplacementFields&{entryKey:string;receiving:FoodReceiving;supplierPacks:number};
export type FoodReplacementVoid={replacementRevision:number;reason:string;at:string;by:string};
export function parseReplacementFields(input:Record<string,unknown>,at:string,by:string,timezone:string):ReplacementFields{
 requireThat(Number.isSafeInteger(input.receivingRevision)&&Number(input.receivingRevision)>0,'Choose the original delivery with rejected goods.');
 const receivedDate=calendarDate(input.receivedDate,'Replacement delivery date');
 requireThat(receivedDate<=localDate(at,timezone),'An actual replacement delivery cannot be dated in the future.');
 requireThat((typeof input.quantity==='number'||typeof input.quantity==='string'&&input.quantity.trim()!=='')&&Number.isFinite(Number(input.quantity))&&Number(input.quantity)>0&&Number(input.quantity)<=1000000,'Enter an accepted replacement quantity greater than zero and no more than 1,000,000.');
 requireThat(input.confirmed===true,'Confirm these replacements arrived and were accepted as the same supplier item and pack, in the original invoice unit.');
 return {receivingRevision:Number(input.receivingRevision),deliveryReference:text(input.deliveryReference,'Replacement delivery reference',150),receivedDate,quantity:Number(input.quantity),invoiceUnit:invoiceUnit(text(input.invoiceUnit,'Original invoice unit',30)),evidence:text(input.evidence,'Replacement delivery evidence',1000),at,by};
}
export function parseReplacement(input:Record<string,unknown>,receiving:FoodReceiving,used:ExcessTotals,at:string,by:string,timezone:string):FoodReplacement{
 const f=parseReplacementFields(input,at,by,timezone),invoice=receiving.invoice;
 requireThat(receiving.rejected>0,'The original delivery has no rejected quantity to replace.');
 requireThat(f.receivedDate>=receiving.receivedDate,'The replacement cannot precede the original rejected delivery.');
 requireThat(f.invoiceUnit===invoice.invoiceUnit,'Use the original invoice unit; substitutions and conversions are not inferred.');
 requireThat(f.quantity<=receiving.rejected-used.quantity+Number.EPSILON*receiving.rejected*8,'Replacements exceed the rejected quantity not yet replaced.',409);
 const supplierPacks=f.quantity/invoice.quantity*invoice.supplierPackQuantity;
 requireThat(Number.isFinite(supplierPacks)&&supplierPacks>0,'The replacement quantity cannot be normalized.');
 return {...f,entryKey:JSON.stringify([f.receivingRevision,f.deliveryReference.toLowerCase().replace(/\s+/g,' ')]),receiving:structuredClone(receiving),supplierPacks};
}
export function parseReplacementVoid(input:Record<string,unknown>,at:string,by:string):FoodReplacementVoid{
 requireThat(Number.isSafeInteger(input.replacementRevision)&&Number(input.replacementRevision)>0,'Choose the replacement delivery.');
 return {replacementRevision:Number(input.replacementRevision),reason:text(input.reason,'Reason for voiding replacement',1000),at,by};
}
export async function replacementTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,ExcessTotals>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.replacement.receivingRevision') AS target,count(*) AS entries,total(json_extract(h.event,'$.replacement.quantity')) AS quantity FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.replacement.receivingRevision') IN (${revisions.map(()=>'?').join(',')}) AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.replacementVoid.replacementRevision')=h.revision) GROUP BY target`).bind(locationId,recordId,...revisions).all<ExcessTotals&{target:number}>();
 return new Map(rows.results.map(r=>[r.target,{entries:r.entries,quantity:r.quantity}]));
}
export async function enrichReplacements(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,entries:FoodHistoryPage['entries']){
 const receipts=entries.filter(e=>e.event.receiving).map(e=>e.revision),totals=await replacementTotals(db,locationId,recordId,receipts);
 for(const e of entries)if(e.event.receiving)e.receivingReplacements=totals.get(e.revision)??{entries:0,quantity:0};
 const ids=entries.filter(e=>e.event.replacement).map(e=>e.revision);if(!ids.length)return;
 const rows=await db.prepare(`SELECT revision,event FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.replacementVoid.replacementRevision') IN (${ids.map(()=>'?').join(',')}) LIMIT 20`).bind(locationId,recordId,...ids).all<{revision:number;event:string}>();
 for(const r of rows.results){const v=(JSON.parse(r.event) as FoodEvent).replacementVoid,e=entries.find(e=>e.revision===v?.replacementRevision);if(v&&e)e.replacementVoided={...v,revision:r.revision};}
}
