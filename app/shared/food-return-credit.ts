import type {FoodCredit} from './food-credit';
import type {FoodSupplierReturn} from './food-return';
import type {FoodEvent} from './food-contract';
import {id,requireThat,text} from './validation';

export type MatchTotals={entries:number;quantity:number};
export type ReturnCreditFields={returnRevision:number;creditRevision:number;quantity:number;note:string;at:string;by:string};
export type FoodReturnCredit=ReturnCreditFields&{invoiceRevision:number;invoiceNumber:string;invoiceLine:string;invoiceUnit:string;vendor:string;returnReference:string;returnDate:string;creditNumber:string;creditLine:string;creditDate:string};
export type FoodReturnCreditVoid={matchRevision:number;reason:string;at:string;by:string};
export function parseReturnCreditFields(input:Record<string,unknown>,at:string,by:string):ReturnCreditFields{
 for(const key of ['returnRevision','creditRevision'])requireThat(Number.isSafeInteger(input[key])&&Number(input[key])>0,'Choose the original return and issued credit.');
 requireThat((typeof input.quantity==='number'||typeof input.quantity==='string'&&input.quantity.trim()!=='')&&Number.isFinite(Number(input.quantity))&&Number(input.quantity)>0&&Number(input.quantity)<=1000000,'Enter a positive matched quantity in the original invoice unit.');
 requireThat(input.confirmed===true,'Confirm the supplier credit document covers this physical return.');
 return {returnRevision:Number(input.returnRevision),creditRevision:Number(input.creditRevision),quantity:Number(input.quantity),note:text(input.note,'Matching evidence',1000),at,by};
}
export function parseReturnCredit(input:Record<string,unknown>,returned:FoodSupplierReturn,credit:FoodCredit,usedReturn:MatchTotals,usedCredit:MatchTotals,at:string,by:string):FoodReturnCredit{
 const fields=parseReturnCreditFields(input,at,by),invoice=returned.receiving.invoice;
 requireThat(credit.reason==='returned','Only a returned-goods credit can be matched to a physical return.');
 requireThat(credit.invoiceRevision===returned.receiving.invoiceRevision,'The return and credit must reference the same original invoice line.');
 const tolerance=Number.EPSILON*Math.max(1,invoice.quantity)*8;
 requireThat(fields.quantity<=returned.accepted+returned.rejected-usedReturn.quantity+tolerance,'This match exceeds the return quantity still unmatched.',409);
 requireThat(fields.quantity<=credit.quantity-usedCredit.quantity+tolerance,'This match exceeds the credit quantity still unmatched.',409);
 return {...fields,invoiceRevision:credit.invoiceRevision,invoiceNumber:invoice.invoiceNumber,invoiceLine:invoice.lineReference,invoiceUnit:invoice.invoiceUnit,vendor:invoice.sku.vendor,returnReference:returned.returnReference,returnDate:returned.returnDate,creditNumber:credit.creditNumber,creditLine:credit.lineReference,creditDate:credit.creditDate};
}
export function parseReturnCreditVoid(input:Record<string,unknown>,at:string,by:string):FoodReturnCreditVoid{
 requireThat(Number.isSafeInteger(input.matchRevision)&&Number(input.matchRevision)>0,'Choose the original return-credit match.');
 return {matchRevision:Number(input.matchRevision),reason:text(input.reason,'Reason for voiding match',1000),at,by};
}
export async function returnCreditTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,side:'return'|'credit',revisions:number[]):Promise<Map<number,MatchTotals>>{
 if(!revisions.length)return new Map();
 const field=side==='return'?'returnRevision':'creditRevision';
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.returnCredit.${field}') AS target,count(*) AS entries,coalesce(sum(json_extract(h.event,'$.returnCredit.quantity')),0) AS quantity
  FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.returnCredit.${field}') IN (${revisions.map(()=>'?').join(',')})
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.returnCreditVoid.matchRevision')=h.revision)
  GROUP BY target`).bind(locationId,recordId,...revisions).all<MatchTotals&{target:number}>();
 return new Map(rows.results.map(r=>[r.target,{entries:r.entries,quantity:r.quantity}]));
}
export type ReturnCreditChoices={revision:number;returnRevision:number;returnReference:string;invoiceUnit:string;returnQuantity:number;matchedQuantity:number;entries:{sequence:number;revision:number;creditNumber:string;lineReference:string;creditDate:string;sourceNote:string;quantity:number;matched:number;amountCents:number}[];next:number|null};
// A bounded picker for the selected item's original invoice, not a catalog scan.
export async function returnCreditChoices(db:Pick<D1Database,'prepare'>,locationId:string,dataset:string,url:URL,revision:number):Promise<ReturnCreditChoices>{
 const recordId=id(url.searchParams.get('recordId')),returnRevision=Number(url.searchParams.get('returnRevision')),before=Number(url.searchParams.get('before')??0);
 requireThat(Number.isSafeInteger(returnRevision)&&returnRevision>0&&Number.isSafeInteger(before)&&before>=0,'Choose a valid return and credit page.');
 if(before)requireThat(url.searchParams.has('revision')&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh eligible credits from the first page.',409);
 const original=await db.prepare('SELECT h.event FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id WHERE h.location_id=? AND h.record_id=? AND h.revision=? AND r.dataset=?').bind(locationId,recordId,returnRevision,dataset).first<{event:string}>();
 const returned=original?(JSON.parse(original.event) as FoodEvent).supplierReturn:undefined;requireThat(returned,'Return not found in this restaurant and dataset.',404);
 const voided=await db.prepare("SELECT sequence FROM food_history WHERE location_id=? AND record_id=? AND json_extract(event,'$.supplierReturnVoid.returnRevision')=? LIMIT 1").bind(locationId,recordId,returnRevision).first();requireThat(!voided,'A voided return cannot be matched.',409);
 const matched=(await returnCreditTotals(db,locationId,recordId,'return',[returnRevision])).get(returnRevision)?.quantity??0;
 const rows=await db.prepare(`SELECT h.sequence,h.revision,json_extract(h.event,'$.invoiceCredit') AS credit FROM food_history h
  WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.invoiceCredit.invoiceRevision')=? AND json_extract(h.event,'$.invoiceCredit.reason')='returned'
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.creditVoid.creditRevision')=h.revision)
  AND (?=0 OR h.sequence<?) ORDER BY h.sequence DESC LIMIT 21`).bind(locationId,recordId,returned.receiving.invoiceRevision,before,before).all<{sequence:number;revision:number;credit:string}>();
 const page=rows.results.slice(0,20),totals=await returnCreditTotals(db,locationId,recordId,'credit',page.map(r=>r.revision));
 const entries=page.map(row=>{const c=JSON.parse(row.credit) as FoodCredit;return {sequence:row.sequence,revision:row.revision,creditNumber:c.creditNumber,lineReference:c.lineReference,creditDate:c.creditDate,sourceNote:c.sourceNote,quantity:c.quantity,matched:totals.get(row.revision)?.quantity??0,amountCents:c.amountCents}});
 return {revision,returnRevision,returnReference:returned.returnReference,invoiceUnit:returned.receiving.invoice.invoiceUnit,returnQuantity:returned.accepted+returned.rejected,matchedQuantity:matched,entries,next:rows.results.length>20?entries.at(-1)!.sequence:null};
}
