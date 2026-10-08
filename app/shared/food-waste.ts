import {packAmount,type FoodItem,type FoodPack,type FoodSku} from './food-model';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export const wasteReasons={spoilage:'Spoilage',overproduction:'Overproduction',preparation:'Preparation mistake',dropped:'Dropped or damaged',returned:'Returned food',other:'Other'} as const;
export type WasteCost={estimatedCents:number|null;currency:'USD';basis:'catalog-at-entry';sku:FoodSku|null;issues:string[]};
export type FoodWaste={quantity:number;reason:keyof typeof wasteReasons;note:string;pack:FoodPack;at:string;by:string;item?:{title:string;controlNumber:string;storageArea:string};cost?:WasteCost};
export type FoodWasteVoid={wasteRevision:number;reason:string;at:string;by:string};

// Cost an observation using its count pack, not recipe portions. A missing
// conversion or price remains unknown, and a real zero supplier price stays zero.
export function wasteCost(item:FoodItem,quantity:number,at:string,timezone:string):WasteCost{
 const choices=item.vendorSkus.filter(s=>s.available),preferred=choices.filter(s=>s.preferred);
 const chosen=preferred.length===1?preferred[0]:preferred.length===0&&choices.length===1?choices[0]:null;
 const sku=chosen?structuredClone(chosen):null,issues:string[]=[];
 if(item.needsReview)issues.push('Item mapping needs review');
 if(!sku)issues.push('Choose one available preferred supplier pack');
 const count=packAmount(item),supplier=sku?packAmount(sku):null;
 if(!count)issues.push('Count pack size is incomplete');
 if(!supplier)issues.push('Supplier pack size is incomplete');
 if(count&&supplier&&count.family!==supplier.family)issues.push('Count and supplier pack units are incompatible');
 if(sku&&(sku.price===null||!Number.isFinite(sku.price)||sku.price<0))issues.push('Supplier price is missing');
 if(sku&&!sku.priceUpdatedAt)issues.push('Supplier price date is missing');
 if(sku?.priceUpdatedAt&&sku.priceUpdatedAt>localDate(at,timezone))issues.push('Supplier price is dated after this waste entry');
 const estimate=issues.length?null:Math.round(quantity*count!.value/supplier!.value*sku!.price!*100);
 if(estimate!==null&&(!Number.isSafeInteger(estimate)||estimate<0))issues.push('Waste estimate exceeds the supported range');
 return {estimatedCents:issues.length?null:estimate,currency:'USD',basis:'catalog-at-entry',sku,issues};
}

// A waste observation is not a new physical count or a perpetual stock balance.
// Snapshot the unit so a later pack correction cannot reinterpret the entry.
export function parseFoodWaste(input:Record<string,unknown>,item:FoodItem,at:string,by:string,timezone='UTC'):FoodWaste{
 requireThat(item.active,'This item is inactive.');
 requireThat(item.purchaseUnit,'Set the counting unit before recording waste.');
 const v=input.quantity;
 requireThat((typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=1000000,'Waste quantity must be greater than zero and at most 1,000,000.');
 requireThat(typeof input.reason==='string'&&Object.hasOwn(wasteReasons,input.reason),'Choose a waste reason.');
 const reason=input.reason as FoodWaste['reason'],note=text(input.note??'','Waste note',1000,reason!=='other');
 requireThat(input.confirmed===true,'Confirm the discarded quantity in the stated counting unit.');
 const {purchaseUnit,packCount,unitQty,unitUOM}=item;
 return {quantity:Number(v),reason,note,pack:{purchaseUnit,packCount,unitQty,unitUOM},at,by,item:{title:item.title,controlNumber:item.controlNumber,storageArea:item.storageArea},cost:wasteCost(item,Number(v),at,timezone)};
}
export function parseFoodWasteVoid(input:Record<string,unknown>,at:string,by:string):FoodWasteVoid{
 requireThat(Number.isSafeInteger(input.wasteRevision)&&Number(input.wasteRevision)>0,'Choose the original waste entry.');
 return {wasteRevision:Number(input.wasteRevision),reason:text(input.reason,'Reason for voiding waste',1000),at,by};
}
