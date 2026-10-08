import type {InvoiceCatalogEntry} from './invoice-catalog-review';
import {invoiceEntryKey} from './food-invoice';
export type InvoiceSourceGroup={key:string;vendor:string;invoiceNumber:string;dates:string[];entries:InvoiceCatalogEntry[];netCents:number;recorded:number;unrecorded:number;conflicts:number;unchecked:number;matchingIssues:number;attention:number};
// Same normalization as saved source identity. Date must not hide a conflict.
export const invoiceSourceKey=(entry:InvoiceCatalogEntry)=>invoiceEntryKey(entry.row.vendor,entry.row.invoiceNumber,'');
export function invoiceSourceGroups(entries:InvoiceCatalogEntry[]):InvoiceSourceGroup[]{
 const groups=new Map<string,InvoiceSourceGroup>();
 for(const entry of entries){
  const key=invoiceSourceKey(entry);let group=groups.get(key);
  if(!group){group={key,vendor:entry.row.vendor,invoiceNumber:entry.row.invoiceNumber,dates:[],entries:[],netCents:0,recorded:0,unrecorded:0,conflicts:0,unchecked:0,matchingIssues:0,attention:0};groups.set(key,group);}
  group.entries.push(entry);if(!group.dates.includes(entry.row.invoiceDate))group.dates.push(entry.row.invoiceDate);
  // Bounded decimal-only CSV rows: sum integer cents, never unlike quantities.
  const [whole,fraction='']=entry.row.lineTotal.split('.');group.netCents+=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(entry.saved.state==='recorded')group.recorded++;
  else if(entry.saved.state==='not-recorded')group.unrecorded++;
  else if(entry.saved.state==='conflict')group.conflicts++;
  else group.unchecked++;
  if(entry.saved.state==='not-recorded'&&entry.status!=='ready')group.matchingIssues++;
 }
 for(const group of groups.values()){group.dates.sort();group.attention=group.entries.filter(entry=>invoiceSourceNeedsAttention(entry,group)).length;}
 return [...groups.values()];
}
export function invoiceSourceNeedsAttention(entry:InvoiceCatalogEntry,group:InvoiceSourceGroup){return group.dates.length>1||entry.saved.state==='conflict'||entry.saved.state==='unchecked'||entry.saved.state==='not-recorded'&&entry.status!=='ready';}
export function invoiceSourceEntries(groups:InvoiceSourceGroup[],selected:string,onlyIssues:boolean){return groups.filter(g=>!selected||g.key===selected).flatMap(g=>g.entries.filter(e=>!onlyIssues||invoiceSourceNeedsAttention(e,g))).sort((a,b)=>a.row.recordNumber-b.row.recordNumber);}
