import type {FoodItem,FoodSku} from './food-model';
import type {FoodInvoiceLine} from './food-invoice';
import {requireThat,text} from './validation';

export type FoodInvoicePrice={invoiceRevision:number;skuId:string;beforePrice:number|null;beforeDate:string;price:number;priceDate:string;reason:string;at:string;by:string};
// A change to price or its pack basis breaks the source link. Preferences and
// availability do not silently discard otherwise unchanged price provenance.
export function sameSkuPrice(a:FoodSku,b:FoodSku){
 return (['id','vendor','vendorSku','purchaseUnit','packCount','unitQty','unitUOM','price','priceUpdatedAt'] as const).every(k=>a[k]===b[k]);
}
export function reviewedInvoicePrice(item:FoodItem,line:FoodInvoiceLine,invoiceRevision:number,input:Record<string,unknown>,at:string,by:string):FoodInvoicePrice{
 requireThat(item.active&&!item.needsReview,'Resolve the item mapping and active status before applying a price.');
 const sku=item.vendorSkus.find(s=>s.id===line.sku.id);
 requireThat(sku&&sku.available,'The original supplier pack is no longer available. Review the item definition.',409);
 requireThat(sameSkuPrice(sku,line.sku),'The catalog price or supplier pack changed after this invoice was recorded. Review and record a fresh line before applying its price.',409);
 requireThat(!sku.priceUpdatedAt||line.invoiceDate>=sku.priceUpdatedAt,'An older invoice cannot replace a newer catalog price. Review the source before correcting the definition.',409);
 requireThat(Number.isFinite(line.pricePerSupplierPack)&&line.pricePerSupplierPack>=0&&line.pricePerSupplierPack<=1000000,'The recorded invoice price needs review.');
 requireThat(input.confirmed===true,'Confirm the reviewed invoice price should become this supplier pack’s catalog price.');
 return {invoiceRevision,skuId:sku.id,beforePrice:sku.price,beforeDate:sku.priceUpdatedAt,price:line.pricePerSupplierPack,priceDate:line.invoiceDate,reason:text(input.reason,'Reason for applying invoice price',1000),at,by};
}
