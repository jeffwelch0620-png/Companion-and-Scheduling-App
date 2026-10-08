// Adapted from Jeff Welch's collaboration-source frontend/src/lib/calc.js,
// commit 8715903e68b3285923a94094309cd2020e6fb615. Keep source identifiers;
// unknown inputs must not become zero costs or guessed unit conversions.
import type { History } from './types';
import {localDate} from './local-time';
export type FoodSource={dataset:'demo'|'operating';sourceRestaurantId:string;label:string;importedAt:string;importedBy:string};
export type FoodPack={purchaseUnit:string;packCount:number|null;unitQty:number|null;unitUOM:string};
export type FoodSku=FoodPack&{id:string;vendor:string;vendorSku:string;price:number|null;priceUpdatedAt:string;preferred:boolean;available:boolean;priceSource?:{invoiceRevision:number;appliedRevision:number}};
export type FoodCount={quantity:number;at:string;by:string;note:string;pack:FoodPack};
export type FoodItem=FoodPack&{title:string;controlNumber:string;storageArea:string;active:boolean;countActive:boolean;portionSize:number|null;portionUOM:string;par:number|null;needsReview:boolean;vendorSkus:FoodSku[];source:FoodSource;count:FoodCount|null;countHistory:FoodCount[];history:History;definitionHistory:{at:string;by:string;reason:string;before:Omit<FoodItem,'count'|'countHistory'|'history'|'definitionHistory'>}[]};
export type FoodRecipe={title:string;sourceId:string;recipeType:'menu'|'prep';yieldQty:number|null;yieldUOM:string;menuCategory:string;procedure:string;equipment:string;shelfLife:string;portionNote:string;lines:({sourceType:'item';controlNumber:string;qty:number}|{sourceType:'prep';recipeId:string;qty:number})[];source:FoodSource;history:History};
const units:Record<string,[string,number]>={lb:['weight',16],oz:['weight',1],kg:['weight',35.27396195],g:['weight',0.03527396195],gal:['volume',128],qt:['volume',32],pt:['volume',16],cup:['volume',8],'fl oz':['volume',1],l:['volume',33.814],ml:['volume',0.033814],each:['count',1],ct:['count',1],dozen:['count',12]};
export const foodUnits=Object.keys(units);
function amount(qty:number|null,unit:string){const u=units[unit];return qty!==null&&Number.isFinite(qty)&&qty>0&&u?{family:u[0],value:qty*u[1]}:null;}
export function packAmount(pack:FoodPack){return pack.packCount!==null&&pack.packCount>0&&pack.unitQty!==null?amount(pack.packCount*pack.unitQty,pack.unitUOM):null;}
export function foodItemCost(item:FoodItem):{costPerPortion:number|null;portionsPerPack:number|null;sku:FoodSku|null;issues:string[]}{
 const choices=item.vendorSkus.filter(s=>s.available), preferred=choices.filter(s=>s.preferred);
 const sku=preferred.length===1?preferred[0]:preferred.length===0&&choices.length===1?choices[0]:null;
 const issues:string[]=[];
 if(item.needsReview)issues.push('Item mapping needs review');
 if(!item.active)issues.push('Item is inactive');
 if(!sku)issues.push('Choose one available preferred supplier pack');
 const pack=sku?packAmount(sku):null,portion=amount(item.portionSize,item.portionUOM);
 if(!pack)issues.push('Supplier pack size is incomplete');
 if(!portion)issues.push('Portion size is incomplete');
 if(pack&&portion&&pack.family!==portion.family)issues.push('Pack and portion units are incompatible');
 if(sku&&(sku.price===null||!Number.isFinite(sku.price)||sku.price<0))issues.push('Supplier price is missing');
 if(sku&&!sku.priceUpdatedAt)issues.push('Supplier price date is missing');
 const portionsPerPack=pack&&portion&&pack.family===portion.family?pack.value/portion.value:null;
 return {sku,issues,portionsPerPack,costPerPortion:issues.length||!portionsPerPack||sku?.price==null?null:sku.price/portionsPerPack};
}
export function foodRecipeCost(recipe:FoodRecipe,items:FoodItem[],recipes:FoodRecipe[],stack:string[]=[],budget={remaining:5000}):{total:number|null;perYield:number|null;issues:string[]}{
 if(stack.includes(recipe.sourceId)||stack.length>=30)return {total:null,perYield:null,issues:['Circular or excessively deep prep recipe']};
 const sameSource=(s:FoodSource)=>s.dataset===recipe.source.dataset&&s.sourceRestaurantId===recipe.source.sourceRestaurantId;
 const issues:string[]=[],next=[...stack,recipe.sourceId];let total=0;
 if(!recipe.lines.length)issues.push('No ingredients listed');
 for(const line of recipe.lines){
  if(--budget.remaining<0){issues.push('Recipe dependency graph exceeds the review limit');break;}
  if(!Number.isFinite(line.qty)||line.qty<=0){issues.push('Ingredient quantity is missing');continue;}
  if(line.sourceType==='item'){
   const item=items.find(i=>sameSource(i.source)&&i.controlNumber===line.controlNumber);
   if(!item){issues.push(`Missing item: ${line.controlNumber}`);continue;}
   const result=foodItemCost(item);if(result.costPerPortion===null)issues.push(...result.issues.map(s=>`${item.title}: ${s}`));else total+=result.costPerPortion*line.qty;
  }else{
   const sub=recipes.find(r=>sameSource(r.source)&&r.sourceId===line.recipeId&&r.recipeType==='prep');
   if(!sub){issues.push(`Missing prep recipe: ${line.recipeId}`);continue;}
   const result=foodRecipeCost(sub,items,recipes,next,budget);if(result.perYield===null)issues.push(...result.issues.map(s=>`${sub.title}: ${s}`));else total+=result.perYield*line.qty;
  }
 }
 if(recipe.yieldQty===null||recipe.yieldQty<=0||!recipe.yieldUOM)issues.push('Recipe yield is missing');
 if(!Number.isFinite(total))issues.push('Recipe quantities exceed the supported range');
 return {total:issues.length?null:total,perYield:issues.length?null:total/recipe.yieldQty!,issues:[...new Set(issues)]};
}
// A dated physical count is required. A blank field cannot generate purchasing.
export function foodShortfall(item:FoodItem,today:string,timezone:string){
 const issues:string[]=[];const cost=foodItemCost(item),sku=cost.sku;
 if(!item.count||localDate(item.count.at,timezone)!==today)issues.push('A current dated count is required');
 if(item.par===null)issues.push('Par is not set');
 if(item.needsReview||!item.active||!item.countActive)issues.push('Item is not ready for replenishment review');
 const countPack=packAmount(item),vendorPack=sku?packAmount(sku):null;
 if(!countPack||!vendorPack||countPack.family!==vendorPack.family)issues.push('Count-to-supplier pack conversion is unknown');
 const shortfall=item.count&&item.par!==null?Math.max(0,item.par-item.count.quantity):null;
 return {units:issues.length||shortfall===null?null:Math.ceil(shortfall*countPack!.value/vendorPack!.value),issues};
}
