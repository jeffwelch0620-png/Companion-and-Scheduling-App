import type {FoodItem} from './food-model';
import type {InvoiceFileSource,InvoiceCsvRow} from './food-invoice-csv';
import {reviewInvoiceCsv,type InvoiceCsvCheck} from './invoice-csv-review';
import {requireThat} from './validation';
import type {InvoiceSavedReview} from './invoice-saved-review';

export type InvoiceCatalogItem={id:string;revision:number;data:Pick<FoodItem,'title'|'controlNumber'|'active'|'needsReview'|'source'|'vendorSkus'>};
export type InvoiceCatalogMatch=InvoiceCsvCheck['matches'][number]&{itemId:string;itemRevision:number;title:string;controlNumber:string};
export type InvoiceCatalogEntry={row:InvoiceCsvRow;status:'ready'|'choose-item'|'needs-review'|'unmatched';matches:InvoiceCatalogMatch[];saved:InvoiceSavedReview};
export type InvoiceCatalogReview={locationId:string;dataset:'demo'|'operating';revision:number;checkedAt:string;entries:InvoiceCatalogEntry[];totals:Record<InvoiceCatalogEntry['status'],number>;historyTotals:{notRecorded:number;recorded:number;conflict:number}};
export type InvoiceCatalogDraft={source:InvoiceFileSource;skuId:string;itemId:string;itemRevision:number};
const key=(vendor:string,sku:string)=>JSON.stringify([vendor,sku].map(v=>v.trim().toLowerCase().replace(/\s+/g,' ')));
export function reviewInvoiceCatalog(rows:InvoiceCsvRow[],items:InvoiceCatalogItem[],at:string,timezone:string){
 requireThat(rows.length<=250&&items.length<=5000,'This review exceeds the supported file or catalog size.');
 const index=new Map<string,InvoiceCatalogItem[]>();
 for(const item of items){for(const k of new Set(item.data.vendorSkus.filter(s=>s.available).map(s=>key(s.vendor,s.vendorSku)))){const list=index.get(k)??[];list.push(item);index.set(k,list);}}
 const totals:InvoiceCatalogReview['totals']={ready:0,'choose-item':0,'needs-review':0,unmatched:0};
 const entries=rows.map(row=>{
  const candidates=index.get(key(row.vendor,row.vendorSku))??[];
  requireThat(candidates.length<=20,'More than 20 items share a supplier SKU. Review the catalog mappings first.');
  const matches=candidates.flatMap(item=>reviewInvoiceCsv([row],item.data as FoodItem,at,timezone).entries[0].matches.map(m=>({...m,itemId:item.id,itemRevision:item.revision,title:item.data.title,controlNumber:item.data.controlNumber})));
  requireThat(matches.length<=40,'More than 40 packs share a supplier SKU. Review the catalog mappings first.');
  const compatible=matches.filter(m=>!m.issue).length;
  // Even an incompatible second item is ambiguous: never silently pick its neighbor.
  const status:InvoiceCatalogEntry['status']=!matches.length?'unmatched':!compatible?'needs-review':matches.length>1?'choose-item':'ready';
  totals[status]++;return {row,status,matches,saved:{state:'unchecked' as const,differences:[]}};
 });
 return {entries,totals};
}
