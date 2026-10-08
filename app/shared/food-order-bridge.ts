// Jeff's purchase-order concept maps to JMAX's existing internal Order lifecycle.
// No supplier submission, email, receiving or inventory mutation is performed.
import type {Command,Line,Workspace} from './types';
import type {FoodItem} from './food-model';
import type {FoodOrderSource} from './food-workflow-model';
import {foodWorkflowPermissions} from './food-workflow-model';
import {foodShortfall,packAmount} from './food-model';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {id,object,requireThat,text} from './validation';
export type ResolvedFoodOrder={lines:Line[];source:FoodOrderSource};
type DB=Pick<D1Database,'prepare'|'batch'>;
export async function resolveFoodOrder(db:DB,w:Workspace,principal:string,command:Command,at:string):Promise<{resolved?:ResolvedFoodOrder;foodRevision:number|null}>{
 const existing=w.records.find(r=>r.id===command.recordId);
 const food=existing?.kind==='order'?existing.data.food:undefined;
 if(command.action!=='order.food-save'&&!food)return {foodRevision:null};
 const permissions=foodWorkflowPermissions(w.me);
 requireThat(permissions.purchase||permissions.reviewPurchase,'Food purchasing requires restaurant food and ordering access.',403);
 if(existing)requireThat(existing.kind==='order'&&(existing.ownerId===w.me.id||permissions.reviewPurchase&&existing.data.status!=='draft'),'This food order is not available to this account.',403);
 if(command.action==='order.save')requireThat(false,'Edit this food-linked request in Food purchasing so its source references are retained.');
 if(command.action==='order.review')requireThat(principal!==food?.preparedByPrincipal,'A different authenticated purchasing reviewer must review this request.',403);
 const revision=(await db.prepare('SELECT revision FROM food_state WHERE location_id=?').bind(w.location.id).first<{revision:number}>())?.revision??0;
 if(command.action==='order.food-save'){
  requireThat(permissions.purchase,'Ordering requests are not enabled for this account.',403);
  const input=command.input,ds=input.dataset;requireThat(ds==='demo'||ds==='operating','Choose a food dataset.');
  requireThat(!food||food.dataset===ds,'A food-linked request cannot move between datasets.');
  const countDate=calendarDate(input.countDate,'Physical count date');requireThat(countDate===localDate(at,w.location.timezone),'Purchasing requires a saved physical count from today at this restaurant.');
  requireThat(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=40,'Choose 1–40 canonical food items for one supplier.');
  const seen=new Set<string>(),lines:Line[]=[];
  for(const value of input.lines){
   const line=object(value),itemId=id(line.itemId);requireThat(!seen.has(itemId),'An item may appear only once in a purchasing request.');seen.add(itemId);
   const row=await db.prepare("SELECT revision,data FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem'").bind(itemId,w.location.id,ds).first<{revision:number;data:string}>();
   requireThat(row,'Item not found in this restaurant and dataset.',404);requireThat(row.revision===line.itemRevision,'A food item changed. Refresh its definition and count before saving.',409);
   const item=JSON.parse(row.data) as FoodItem,sku=item.vendorSkus.find(s=>s.id===line.skuId);
   requireThat(item.active&&item.countActive&&!item.needsReview,'The food item must be active and its mapping reviewed.');
   requireThat(item.count&&localDate(item.count.at,w.location.timezone)===countDate,'Every item needs a saved physical count on the selected date. Blank is not zero.');
   requireThat(sku?.available,'Choose an available supplier pack from this item.');
   requireThat(sku.price!==null&&Number.isFinite(sku.price)&&sku.price>=0&&sku.priceUpdatedAt,'The supplier pack needs a reviewed price and price date.');
   requireThat(calendarDate(sku.priceUpdatedAt.slice(0,10),'Supplier price date')<=localDate(at,w.location.timezone),'A supplier price date cannot be in the future.');
   const cp=packAmount(item.count.pack),ip=packAmount(item),sp=packAmount(sku);
   requireThat(cp&&ip&&sp&&cp.family===ip.family&&cp.family===sp.family&&cp.value===ip.value,'The dated count and supplier pack need a known, unchanged unit conversion.');
   const shortfall=foodShortfall({...item,vendorSkus:item.vendorSkus.map(s=>({...s,preferred:s.id===sku.id}))},countDate,w.location.timezone);
   requireThat(shortfall.units!==null,shortfall.issues.join('; '));
   requireThat(typeof line.quantity==='number'&&Number.isInteger(line.quantity)&&line.quantity>0&&line.quantity<=10000,'Order quantity must be a whole number of supplier packs from 1 to 10,000.');
   const lineTotalCents=Math.round(sku.price*100)*line.quantity;requireThat(Number.isSafeInteger(lineTotalCents),'The order amount exceeds the supported range.');
   lines.push({name:item.title,quantity:line.quantity,unit:sku.purchaseUnit,productId:item.controlNumber,note:text(line.note??'','Line note',500,true),food:{itemId,itemRevision:row.revision,controlNumber:item.controlNumber,count:structuredClone(item.count),countPack:{purchaseUnit:item.purchaseUnit,packCount:item.packCount,unitQty:item.unitQty,unitUOM:item.unitUOM},sku:structuredClone(sku),suggestedPacks:shortfall.units,lineTotalCents}});
  }
  const vendors=new Set(lines.map(l=>l.food!.sku.vendor));requireThat(vendors.size===1,'Use one supplier per purchasing request.');
  return {foodRevision:revision,resolved:{lines,source:{dataset:ds,countDate,vendor:lines[0].food!.sku.vendor,totalCents:lines.reduce((s,l)=>s+l.food!.lineTotalCents,0),preparedByPrincipal:food?.preparedByPrincipal??principal,capturedAt:at}}};
 }
 if(food&&(command.action==='order.submit'||command.action==='order.review'&&command.input.approve===true)){
  requireThat(food.countDate===localDate(at,w.location.timezone),'The physical count is no longer from today. Withdraw or return this request, recount and resave it.',409);
  requireThat(existing?.kind==='order','Open the food-linked request first.');
  for(const line of existing.data.lines){
   requireThat(line.food,'This food request has incomplete source evidence. Resave it from Food purchasing.');
   const row=await db.prepare("SELECT revision FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem'").bind(line.food.itemId,w.location.id,food.dataset).first<{revision:number}>();
   requireThat(row?.revision===line.food.itemRevision,'A source item, count, pack or price changed. Withdraw or return the request, then refresh and resave it.',409);
  }
 }
 return {foodRevision:revision};
}
