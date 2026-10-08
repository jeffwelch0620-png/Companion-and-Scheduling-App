import type {FoodInvoiceLine} from './food-invoice';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {text,requireThat} from './validation';

export const creditReasons={'returned':'Returned goods','shortage':'Short or missing delivery','price':'Price adjustment'} as const;
export type CreditReason=keyof typeof creditReasons;
export type CreditFields={invoiceRevision:number;creditNumber:string;lineReference:string;creditDate:string;sourceNote:string;reason:CreditReason;quantity:number;amountCents:number;at:string;by:string};
export type FoodCredit=CreditFields&{entryKey:string;invoice:FoodInvoiceLine;supplierPackQuantity:number};
export type FoodCreditVoid={creditRevision:number;reason:string;at:string;by:string};
export type CreditTotals={entries:number;amountCents:number;quantity:number};
export function parseCreditFields(input:Record<string,unknown>,at:string,by:string,timezone:string):CreditFields{
 requireThat(Number.isSafeInteger(input.invoiceRevision)&&Number(input.invoiceRevision)>0,'Choose the original invoice line.');
 const creditNumber=text(input.creditNumber,'Supplier credit number',100),lineReference=text(input.lineReference,'Credit line reference',100),creditDate=calendarDate(input.creditDate,'Credit date'),sourceNote=text(input.sourceNote,'Credit source reference',1000);
 requireThat(creditDate<=localDate(at,timezone),'An issued credit cannot be dated in the future.');
 requireThat(typeof input.reason==='string'&&Object.hasOwn(creditReasons,input.reason),'Choose the credit reason.');
 const reason=input.reason as CreditReason,amount=input.amount;
 requireThat((typeof amount==='string'||typeof amount==='number')&&/^\d{1,7}(\.\d{1,2})?$/.test(String(amount))&&Number(amount)>0&&Number(amount)<=1000000,'Enter a positive net credit amount in dollars and cents, excluding tax and freight.');
 let quantity=0;
 if(reason==='price')requireThat(input.quantity===undefined||input.quantity===''||input.quantity===0||input.quantity==='0','A price-only credit must not include a returned or short quantity.');
 else {requireThat((typeof input.quantity==='number'||typeof input.quantity==='string'&&input.quantity.trim()!=='')&&Number.isFinite(Number(input.quantity))&&Number(input.quantity)>0&&Number(input.quantity)<=1000000,'Enter the credited quantity in the original invoice unit.');quantity=Number(input.quantity);}
 requireThat(input.confirmed===true,'Confirm this credit was issued by the supplier and checked against its source document.');
 return {invoiceRevision:Number(input.invoiceRevision),creditNumber,lineReference,creditDate,sourceNote,reason,quantity,amountCents:Math.round(Number(amount)*100),at,by};
}
export function parseCredit(input:Record<string,unknown>,invoice:FoodInvoiceLine,used:CreditTotals,at:string,by:string,timezone:string):FoodCredit{
 const fields=parseCreditFields(input,at,by,timezone);
 requireThat(fields.creditDate>=invoice.invoiceDate,'The credit date cannot precede the original invoice date.');
 requireThat(used.amountCents+fields.amountCents<=invoice.lineTotalCents,'This credit exceeds the uncredited net invoice line amount. Review the source or correct an earlier credit.',409);
 const available=invoice.quantity-used.quantity,tolerance=Number.EPSILON*Math.max(1,invoice.quantity)*8;
 requireThat(fields.quantity<=available+tolerance,'The combined returned and short quantity exceeds the original invoice quantity.',409);
 const normalized=fields.quantity/invoice.quantity*invoice.supplierPackQuantity;
 requireThat(Number.isFinite(normalized),'The credited quantity cannot be normalized.');
 const key=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
 return {...fields,entryKey:JSON.stringify([key(invoice.sku.vendor),key(fields.creditNumber),key(fields.lineReference)]),invoice:structuredClone(invoice),supplierPackQuantity:normalized};
}
export function parseCreditVoid(input:Record<string,unknown>,at:string,by:string):FoodCreditVoid{
 requireThat(Number.isSafeInteger(input.creditRevision)&&Number(input.creditRevision)>0,'Choose the original credit entry.');
 return {creditRevision:Number(input.creditRevision),reason:text(input.reason,'Reason for voiding credit',1000),at,by};
}

// Every aggregate uses immutable events, including voids on later history pages.
export async function creditTotals(db:Pick<D1Database,'prepare'>,locationId:string,recordId:string,revisions:number[]):Promise<Map<number,CreditTotals>>{
 if(!revisions.length)return new Map();
 const rows=await db.prepare(`SELECT json_extract(h.event,'$.invoiceCredit.invoiceRevision') AS invoiceRevision,count(*) AS entries,
  coalesce(sum(json_extract(h.event,'$.invoiceCredit.amountCents')),0) AS amountCents,
  coalesce(sum(json_extract(h.event,'$.invoiceCredit.quantity')),0) AS quantity
  FROM food_history h WHERE h.location_id=? AND h.record_id=? AND json_extract(h.event,'$.invoiceCredit.invoiceRevision') IN (${revisions.map(()=>'?').join(',')})
  AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.creditVoid.creditRevision')=h.revision)
  GROUP BY invoiceRevision`).bind(locationId,recordId,...revisions).all<CreditTotals&{invoiceRevision:number}>();
 return new Map(rows.results.map(r=>[r.invoiceRevision,{entries:r.entries,amountCents:r.amountCents,quantity:r.quantity}]));
}
