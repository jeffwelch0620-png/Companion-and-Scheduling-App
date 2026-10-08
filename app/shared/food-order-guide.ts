import type {FoodPack,FoodItem} from './food-model';
import {requireThat} from './validation';

export const guideMaxBytes=256*1024;
export const guideLayouts={
 berts:['Product ID','Product','Provider','In stock','Order','PPU Unit','Provider'],
 rudds:['Product ID','order amount','Product','Brand','Price','PPU','Package','PPU Unit','Provider'],
} as const;
export type GuideLayout=keyof typeof guideLayouts;
export type GuideRow={row:number;description:string;vendor:string;sku:string;unit:string;pack:string;section:string;oldCount:string;oldOrder:string;issues:string[]};
export type GuideTable={layout:GuideLayout;rows:GuideRow[];sections:number;blankRows:number};
export type GuideItem={id:string;revision:number;data:Pick<FoodItem,'title'|'controlNumber'|'active'|'needsReview'|'vendorSkus'>};
export type GuideMatch={itemId:string;itemRevision:number;title:string;controlNumber:string;skuId:string;pack:FoodPack;active:boolean;available:boolean;needsReview:boolean};
export type GuideStatus='source-issue'|'unmatched'|'ambiguous'|'unit-conflict'|'check-pack';
export type GuideEntry=GuideRow&{status:GuideStatus;matches:GuideMatch[]};
export type GuideReview={locationId:string;dataset:'demo'|'operating';revision:number;checkedAt:string;fileName:string;sha256:string;table:GuideTable;entries:GuideEntry[];totals:Record<GuideStatus,number>};
const key=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
const supplierKey=(vendor:string,sku:string)=>JSON.stringify([key(vendor),key(sku)]);
const purchaseUnit=(s:string)=>{const unit=key(s);return unit==='cs'||unit==='case'?'case':unit==='ea'||unit==='each'?'each':''};

// Read the two observed Simple-sheet layouts. Duplicate Provider headings are
// intentional in Bert's file; both cells must agree. No formula evaluation.
export function readOrderGuide(csv:string):GuideTable{
 requireThat(new TextEncoder().encode(csv).length<=guideMaxBytes,'Use a UTF-8 order-guide CSV no larger than 256 KiB.');
 const records:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 const pushField=()=>{requireThat(field.length<=1000,'An order-guide cell is longer than 1,000 characters.');row.push(field);field='';closed=false;requireThat(row.length<=9,'The guide has too many columns. Export the Simple sheet without adding columns.');};
 const pushRow=()=>{pushField();records.push(row);row=[];requireThat(records.length<=501,'Use at most 500 guide rows, including section and blank rows.');};
 const raw=csv.replace(/^\uFEFF/,'');
 for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(quoted){if(c==='"'){if(raw[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
  if(c===','){pushField();continue}
  if(c==='\r'||c==='\n'){if(c==='\r'&&raw[i+1]==='\n')i++;pushRow();continue}
  requireThat(!closed,'Unexpected text after a quoted guide cell.');
  if(c==='"'){requireThat(!field,'Quotes must start at the beginning of a guide cell.');quoted=true}else field+=c;
 }
 requireThat(!quoted,'The guide has an unclosed quoted cell.');if(field!==''||row.length||closed)pushRow();
 const header=records[0]??[],layout=(Object.keys(guideLayouts) as GuideLayout[]).find(k=>header.length===guideLayouts[k].length&&header.every((v,i)=>key(v)===key(guideLayouts[k][i])));
 requireThat(layout,'Use the original Bert’s or Rudd’s Simple-sheet headings in their original order.');
 const result:GuideTable={layout,rows:[],sections:0,blankRows:0};let section='';
 records.slice(1).forEach((cells,i)=>{
  if(cells.every(v=>!v.trim())){result.blankRows++;return}
  requireThat(cells.length===header.length,`Guide row ${i+2} has a different number of columns from its headings.`);
  const v=cells.map(c=>c.trim()),[sku]=v,description=v[layout==='berts'?1:2],vendor=v[layout==='berts'?2:8],unit=v[layout==='berts'?5:7];
  const descriptionIndex=layout==='berts'?1:2;
  if(description&&v.every((c,n)=>n===descriptionIndex||!c)){section=description;result.sections++;return}
  const issues:string[]=[];
  if(!description||description.length>200)issues.push('Item description is missing or longer than 200 characters.');
  if(!sku||sku.length>100||/^[=+@-]/.test(sku)||/[\r\n]/.test(sku))issues.push('Supplier SKU needs review. A note, formula or blank is not a product identifier.');
  if(!vendor||vendor.length>200||/[\r\n]/.test(vendor))issues.push('Supplier is missing or invalid.');
  if(layout==='berts'&&key(v[6])!==key(vendor))issues.push('The two Provider cells disagree. Confirm the supplier from the ordering record.');
  if(!purchaseUnit(unit))issues.push('Confirm the purchase unit. Supported guide units are CS/case and EA/each.');
  result.rows.push({row:i+2,description,vendor,sku,unit,pack:layout==='rudds'?v[6]:'',section,oldCount:layout==='berts'?v[3]:'',oldOrder:v[layout==='berts'?4:1],issues});
 });
 requireThat(result.rows.length>0,'This guide contains no product rows to review.');
 const repeated=new Map<string,number[]>();
 for(const r of result.rows)if(r.vendor&&r.sku){const id=supplierKey(r.vendor,r.sku),rows=repeated.get(id)??[];rows.push(r.row);repeated.set(id,rows)}
 for(const r of result.rows){const rows=repeated.get(supplierKey(r.vendor,r.sku));if(rows&&rows.length>1)r.issues.push(`Supplier and SKU repeat in rows ${rows.join(', ')}. Reconcile duplicates without adding their quantities.`)}
 return result;
}

export function reviewOrderGuide(table:GuideTable,items:GuideItem[]){
 requireThat(items.length<=5000,'The catalog is too large for one guide review.');
 const index=new Map<string,GuideMatch[]>();
 for(const item of items)for(const sku of item.data.vendorSkus){
  const id=supplierKey(sku.vendor,sku.vendorSku),list=index.get(id)??[];
  list.push({itemId:item.id,itemRevision:item.revision,title:item.data.title,controlNumber:item.data.controlNumber,skuId:sku.id,active:!!item.data.active,available:!!sku.available,needsReview:!!item.data.needsReview,pack:{purchaseUnit:sku.purchaseUnit,packCount:sku.packCount,unitQty:sku.unitQty,unitUOM:sku.unitUOM}});index.set(id,list);
 }
 const totals:Record<GuideStatus,number>={'source-issue':0,unmatched:0,ambiguous:0,'unit-conflict':0,'check-pack':0};
 const entries=table.rows.map(r=>{
  const matches=r.vendor&&r.sku?index.get(supplierKey(r.vendor,r.sku))??[]:[];
  requireThat(matches.length<=40,'More than 40 catalog packs share a guide supplier/SKU. Reconcile those definitions first.');
  const status:GuideStatus=r.issues.length?'source-issue':!matches.length?'unmatched':matches.length>1?'ambiguous':purchaseUnit(matches[0].pack.purchaseUnit)!==purchaseUnit(r.unit)?'unit-conflict':'check-pack';
  totals[status]++;return {...r,status,matches};
 });
 return {entries,totals};
}
