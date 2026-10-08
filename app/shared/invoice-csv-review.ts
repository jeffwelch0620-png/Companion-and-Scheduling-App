import type {FoodItem} from './food-model';
import {csvMatchesSupplier,invoiceCsvMaxRows,type InvoiceCsvRow} from './food-invoice-csv';
import {parseInvoiceLine} from './food-invoice';
import {requireThat} from './validation';

export type InvoiceCsvCheck={row:InvoiceCsvRow;status:'ready'|'choose-pack'|'needs-review'|'unmatched';matches:{skuId:string;label:string;issue?:string;quantity?:number;price?:number;unit:string}[]};
export type InvoiceCsvReview={entries:InvoiceCsvCheck[];totals:Record<InvoiceCsvCheck['status'],number>};
// Local preflight against one selected item, never a catalog-wide or duplicate-history check.
export function reviewInvoiceCsv(rows:InvoiceCsvRow[],item:FoodItem,at:string,timezone:string):InvoiceCsvReview{
 requireThat(rows.length<=invoiceCsvMaxRows,'Review at most 250 invoice lines at a time.');
 const totals:InvoiceCsvReview['totals']={ready:0,'choose-pack':0,'needs-review':0,unmatched:0};
 const entries=rows.map(row=>{
  const matches:InvoiceCsvCheck['matches']=item.vendorSkus.filter(s=>s.available&&csvMatchesSupplier(row,s)).map(sku=>{
   const identity={skuId:sku.id,label:`${sku.vendor} · ${sku.vendorSku} · ${sku.packCount??'?'} × ${sku.unitQty??'?'} ${sku.unitUOM} / ${sku.purchaseUnit}`,unit:sku.purchaseUnit};
   try{
    const line=parseInvoiceLine({...row,skuId:sku.id,sourceNote:'Local CSV matching review',confirmed:true},item,at,'local-review',timezone);
    return {...identity,quantity:line.supplierPackQuantity,price:line.pricePerSupplierPack};
   }catch(e){return {...identity,issue:e instanceof Error?e.message:'Review this supplier pack and invoice line.'};}
  });
  const compatible=matches.filter(m=>!m.issue).length;
  const status:InvoiceCsvCheck['status']=!matches.length?'unmatched':!compatible?'needs-review':compatible>1?'choose-pack':'ready';
  totals[status]++;return {row,status,matches};
 });
 return {entries,totals};
}
export function invoiceCsvReviewPage(review:InvoiceCsvReview,view:'all'|'matched'|'needs-review',query:string,page:number){
 const needle=query.trim().toLowerCase(),size=20;
 const entries=review.entries.filter(e=>(view==='all'||view==='matched'&&e.matches.length>0||view==='needs-review'&&e.status!=='ready')&&[e.row.vendor,e.row.vendorSku,e.row.invoiceNumber,e.row.lineReference,String(e.row.recordNumber)].join(' ').toLowerCase().includes(needle));
 const pages=Math.max(1,Math.ceil(entries.length/size)),current=Math.min(Math.max(0,Number.isSafeInteger(page)?page:0),pages-1);
 return {entries:entries.slice(current*size,(current+1)*size),total:entries.length,page:current,pages};
}

