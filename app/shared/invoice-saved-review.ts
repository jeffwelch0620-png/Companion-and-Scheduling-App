import {invoiceUnit} from './food-invoice';
import type {InvoiceCsvRow} from './food-invoice-csv';

export type SavedInvoiceSource={entryKey:string;itemId:string;title:string;controlNumber:string;sequence:number;revision:number;invoiceDate:string;quantity:number;unitBasis:string;invoiceUnit:string;lineTotalCents:number;vendorSku:string};
export type InvoiceSavedReview={state:'unchecked'|'not-recorded'|'recorded'|'conflict';differences:string[];source?:SavedInvoiceSource};
const key=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
export function checkSavedInvoice(row:InvoiceCsvRow,source?:SavedInvoiceSource):InvoiceSavedReview{
 if(!source)return {state:'not-recorded',differences:[]};
 const differences:string[]=[];
 if(key(row.vendorSku)!==key(source.vendorSku))differences.push('supplier SKU');
 if(row.invoiceDate!==source.invoiceDate)differences.push('invoice date');
 if(Number(row.quantity)!==source.quantity)differences.push('quantity');
 if(row.unitBasis!==source.unitBasis)differences.push('quantity basis');
 if(invoiceUnit(row.invoiceUnit)!==invoiceUnit(source.invoiceUnit))differences.push('invoice unit');
 if(Math.round(Number(row.lineTotal)*100)!==source.lineTotalCents)differences.push('net line amount');
 return {state:differences.length?'conflict':'recorded',differences,source};
}
