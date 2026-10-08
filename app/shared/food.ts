import {parseReplacementReturnFields,parseReplacementReturnVoid} from './food-replacement-return';
import {has,type Member,type Workspace,type RecordOf} from './types';
import type {CommandContext} from './followthrough';
import {object,text,requireThat} from './validation';
import type {FoodPack,FoodItem,FoodRecipe,FoodSource,FoodSku} from './food-model';
import {calendarDate} from './schedule-policy';
import {parseFoodWaste,parseFoodWasteVoid,wasteReasons} from './food-waste';
import {parseInvoiceLine,parseInvoiceVoid} from './food-invoice';
import {sameSkuPrice} from './food-price';
import {parseClaimFields,parseClaimUpdate} from './food-claim';
import {parseCreditFields,parseCreditVoid} from './food-credit';
import {parseReturnCreditFields,parseReturnCreditVoid} from './food-return-credit';
import {parseReturnFields,parseSupplierReturnVoid} from './food-return';
import {parseReplacementFields,parseReplacementVoid} from './food-replacement';
import {parseExcessBillingFields,parseExcessBillingVoid} from './food-excess-billing';
import {parseExcessReturnFields,parseExcessReturnVoid} from './food-excess-return';
import {parseExcessFields,parseExcessVoid} from './food-excess';
import {parseReceivingFields,parseReceivingVoid} from './food-receiving';

// Explicit store operating authority covers BOH management backup and prep.
// Imports, purchasing, supplier prices and credits retain their separate gates.
export function foodManager(me:Member){return me.position!=='Dishwasher'&&(has(me,'location.manage')||has(me,'orders.review')||has(me,'tasks.manage')&&(me.area==='BOH'||has(me,'operations.store')));}
const optional=(v:unknown,name:string,max=200)=>text(v??'',name,max,true);
function number(v:unknown,name:string,required=false):number|null{
 if(v===undefined||v===null||v===''){requireThat(!required,`${name} is required.`);return null;}
 requireThat((typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1000000,`${name} must be a non-negative number up to 1,000,000.`);return Number(v);
}
function flag(v:unknown,fallback:boolean){requireThat(v===undefined||typeof v==='boolean','Use true or false for item settings.');return v===undefined?fallback:v as boolean;}
function pack(o:Record<string,unknown>):FoodPack{return {purchaseUnit:optional(o.purchaseUnit,'Purchase unit',30),packCount:number(o.packCount,'Pack count'),unitQty:number(o.unitQty,'Pack quantity'),unitUOM:optional(o.unitUOM,'Pack unit',30).toLowerCase()};}
function sku(value:unknown):FoodSku{const s=object(value);return {...pack(s),id:text(s.id,'Supplier pack identifier',100),vendor:text(s.vendor,'Supplier',200),vendorSku:optional(s.vendorSku,'Supplier code',100),price:number(s.price,'Price'),priceUpdatedAt:s.priceUpdatedAt?calendarDate(String(s.priceUpdatedAt).slice(0,10),'Price date'):'',preferred:flag(s.preferred,false),available:flag(s.available,true)};}
export function parseFoodItem(value:unknown,source:FoodSource):FoodItem{
 const i=object(value),title=text(i.name,'Item name',200);
 requireThat(!/^(reference pack size|priority is by|note:|notes:)/i.test(title),'This row looks like a spreadsheet note, not an item.');
 requireThat(i.restaurantId===source.sourceRestaurantId,'Every row must match the chosen source restaurant.');
 if(source.dataset==='operating')requireThat(!/demo|sample|fictional/i.test(source.sourceRestaurantId+' '+title),'Demo rows must stay in the demo dataset.');
 requireThat(i.recipe===undefined,'This is not the supported item export format.');
 requireThat(Array.isArray(i.vendorSkus)&&i.vendorSkus.length<=20,'Supply the vendorSkus array from Jeff’s item export (up to 20 packs per item).');
 const vendorSkus=i.vendorSkus.map(sku);requireThat(new Set(vendorSkus.map(s=>s.id)).size===vendorSkus.length,'Supplier pack identifiers must be unique.');
 return {...pack(i),title,controlNumber:text(i.controlNumber,'Control number',100),storageArea:optional(i.storageArea,'Storage area'),active:flag(i.active,true),countActive:flag(i.countActive,true),portionSize:number(i.portionSize,'Portion size'),portionUOM:optional(i.portionUOM,'Portion unit',30).toLowerCase(),par:number(i.par,'Par'),needsReview:flag(i.needsReview,false),vendorSkus,source,count:null,countHistory:[],history:[],definitionHistory:[]};
}
export function parseFoodRecipe(value:unknown,source:FoodSource):FoodRecipe{
 const r=object(value);requireThat(r.restaurantId===source.sourceRestaurantId,'Every recipe must match the chosen source restaurant.');
 requireThat(r.recipeType==='menu'||r.recipeType==='prep','Recipe type must be menu or prep.');
 requireThat(Array.isArray(r.lines)&&r.lines.length<=100,'Use the current recipe lines export (up to 100 lines); older recipe arrays need conversion.');
 const title=text(r.name,'Recipe name',200);if(source.dataset==='operating')requireThat(!/demo|sample|fictional/i.test(source.sourceRestaurantId+' '+title),'Demo recipes must stay in the demo dataset.');
 return {title,sourceId:text(r.id,'Recipe identifier',100),recipeType:r.recipeType,yieldQty:number(r.yieldQty,'Yield'),yieldUOM:optional(r.yieldUOM,'Yield unit',30),menuCategory:optional(r.menuCategory,'Category'),procedure:optional(r.procedure,'Procedure',12000),equipment:optional(r.equipment,'Equipment',2000),shelfLife:optional(r.shelfLife,'Shelf life',1000),portionNote:optional(r.portionNote,'Portion note',2000),lines:r.lines.map(value=>{const l=object(value),qty=number(l.qty,'Ingredient quantity',true)!;requireThat(qty>0,'Ingredient quantity must be greater than zero.');requireThat(l.sourceType==='item'||l.sourceType==='prep','Choose an item or prep ingredient reference.');return l.sourceType==='item'?{sourceType:'item',controlNumber:text(l.controlNumber,'Ingredient control number',100),qty}:{sourceType:'prep',recipeId:text(l.recipeId,'Prep recipe identifier',100),qty};}),source,history:[]};
}
export function foodRows(w:Workspace,dataset:FoodSource['dataset']){return {items:w.records.filter((r):r is RecordOf<'fooditem'>=>r.kind==='fooditem'&&r.locationId===w.location.id&&r.data.source.dataset===dataset),recipes:w.records.filter((r):r is RecordOf<'foodrecipe'>=>r.kind==='foodrecipe'&&r.locationId===w.location.id&&r.data.source.dataset===dataset)};}
export function applyFood(c:CommandContext){
 const {w,me,command,input,at,find,create,save,history}=c;
 requireThat(foodManager(me),'Food records require restaurant food-management access.',403);
 if(command.action==='fooditem.import'||command.action==='foodrecipe.import'){
  requireThat(has(me,'location.manage'),'An owner must confirm restaurant mapping before importing.',403);
  requireThat(input.destinationLocationId===w.location.id&&input.confirmed===true,'Confirm the destination restaurant and source review.');
  requireThat(input.dataset==='demo'||input.dataset==='operating','Label the source as demo or operating data.');
  const source:FoodSource={dataset:input.dataset,sourceRestaurantId:text(input.sourceRestaurantId,'Source restaurant',100),label:text(input.sourceLabel,'Source label',300),importedAt:at,importedBy:me.id};
  const existing=w.records.filter(r=>(r.kind==='fooditem'||r.kind==='foodrecipe')&&r.locationId===w.location.id&&r.data.source.dataset===source.dataset);
  requireThat(existing.every(r=>(r.kind==='fooditem'||r.kind==='foodrecipe')&&r.data.source.sourceRestaurantId===source.sourceRestaurantId),'This dataset already uses a different source restaurant. Review the mapping; imports cannot change it.');
  requireThat(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=25,'Import 1–25 rows per reviewed batch.');
  const itemImport=command.action==='fooditem.import';
  const parsed=input.rows.map(row=>itemImport?parseFoodItem(row,source):parseFoodRecipe(row,source));
  const keys=parsed.map(row=>'controlNumber'in row?row.controlNumber:row.sourceId);
  requireThat(new Set(keys).size===keys.length,'Duplicate identifiers in this import batch.');
  requireThat(!existing.some(r=>r.kind===(itemImport?'fooditem':'foodrecipe')&&keys.includes(r.kind==='fooditem'?r.data.controlNumber:(r as RecordOf<'foodrecipe'>).data.sourceId)),'One or more identifiers already exist. Imports never overwrite saved food records.');
  for(const data of parsed){data.history=[history('imported',`${source.label}; ${source.dataset}; source restaurant ${source.sourceRestaurantId}. Imported stock is not a new physical count.`)];if('controlNumber'in data)create({kind:'fooditem',data});else create({kind:'foodrecipe',data});}return;
 }
 if(command.action==='fooditem.count'){
  const r=find('fooditem');requireThat(r.data.active&&r.data.countActive,'This item is not enabled for counting.');
  const quantity=number(input.quantity,'Physical count',true)!,note=text(input.note,'Count note',1000,true);
  requireThat(input.confirmed===true,'Confirm this is a physical count in the displayed purchase unit.');
  requireThat(r.data.purchaseUnit,'Set the counting unit before recording a count.');
  const count={quantity,at,by:me.id,note,pack:pack(r.data as unknown as Record<string,unknown>)};save({...r,data:{...r.data,count,countHistory:[...r.data.countHistory,count],history:[...r.data.history,history('counted',`${quantity} ${r.data.purchaseUnit}: ${note}`)]}});return;
 }
 if(command.action==='fooditem.waste'){
  const r=find('fooditem'),waste=parseFoodWaste(input,r.data,at,me.id,w.location.timezone);
  save({...r,data:{...r.data,history:[...r.data.history,history('waste-recorded',`${waste.quantity} ${waste.pack.purchaseUnit} · ${wasteReasons[waste.reason]}${waste.note?' · '+waste.note:''}`)]}});return;
 }
 if(command.action==='fooditem.waste-void'){
  const r=find('fooditem'),voided=parseFoodWasteVoid(input,at,me.id);
  // The dedicated Food service checks the referenced immutable event in this store.
  save({...r,data:{...r.data,history:[...r.data.history,history('waste-voided',`Waste entry ${voided.wasteRevision}: ${voided.reason}`)]}});return;
 }
 if(command.action==='fooditem.invoice'||command.action==='fooditem.invoice-void'){
  requireThat(has(me,'location.manage')||has(me,'orders.review'),'Only an owner or purchasing reviewer can record or correct invoice lines.',403);
  const r=find('fooditem');
  const entry=command.action==='fooditem.invoice'?parseInvoiceLine(input,r.data,at,me.id,w.location.timezone):parseInvoiceVoid(input,at,me.id);
  const note='invoiceNumber' in entry?`${entry.sku.vendor} · invoice ${entry.invoiceNumber} · line ${entry.lineReference} · ${entry.quantity} ${entry.invoiceUnit}. Source: ${entry.sourceNote}. Catalog price and count unchanged.`:`Invoice entry ${entry.invoiceRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.invoice'?'invoice-line-recorded':'invoice-line-voided',note)]}});return;
 }
 if(command.action==='fooditem.claim'||command.action==='fooditem.claim-update'){
  requireThat(has(me,'location.manage')||has(me,'orders.review'),'Supplier issue follow-up requires purchasing review access.',403);
  const r=find('fooditem'),entry=command.action==='fooditem.claim'?parseClaimFields(input,at,me.id,w.location.timezone):parseClaimUpdate(input,at,me.id);
  const note='reference'in entry?`Supplier issue ${entry.reference} for invoice entry ${entry.invoiceRevision}. ${entry.details}`:`Issue entry ${entry.claimRevision}: ${entry.state}. ${entry.note}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.claim'?'supplier-issue-recorded':'supplier-issue-updated',note)]}});return;
 }
 if(command.action==='fooditem.credit'||command.action==='fooditem.credit-void'){
  requireThat(has(me,'location.manage')||has(me,'orders.review'),'Supplier credits require purchasing review access.',403);
  const r=find('fooditem');
  // The Food service checks the original invoice, remaining amounts and duplicates.
  const credit=command.action==='fooditem.credit'?parseCreditFields(input,at,me.id,w.location.timezone):parseCreditVoid(input,at,me.id);
  const note='creditNumber' in credit?`Supplier credit ${credit.creditNumber} · line ${credit.lineReference} against invoice entry ${credit.invoiceRevision}. Source: ${credit.sourceNote}. No stock or catalog price adjustment.`:`Credit entry ${credit.creditRevision}: ${credit.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.credit'?'supplier-credit-recorded':'supplier-credit-voided',note)]}});return;
 }
 if(command.action==='fooditem.excess-billing'||command.action==='fooditem.excess-billing-void'){
  requireThat(has(me,'location.manage')||has(me,'orders.review'),'Billing matches require purchasing review access.',403);
  const r=find('fooditem'),entry=command.action==='fooditem.excess-billing'?parseExcessBillingFields(input,at,me.id):parseExcessBillingVoid(input,at,me.id);
  const note='quantity'in entry?`Extra delivery entry ${entry.excessRevision}: ${entry.quantity} original invoice units linked to billing entry ${entry.invoiceRevision}. ${entry.note}. No stock,receiving or payment change.`:`Billing match entry ${entry.matchRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.excess-billing'?'extra-goods-billing-matched':'extra-goods-billing-match-voided',note)]}});return;
 }
 if(command.action==='fooditem.replacement'||command.action==='fooditem.replacement-void'){
  const r=find('fooditem'),entry=command.action==='fooditem.replacement'?parseReplacementFields(input,at,me.id,w.location.timezone):parseReplacementVoid(input,at,me.id);
  const note='quantity'in entry?`Accepted replacement ${entry.deliveryReference}: ${entry.quantity} ${entry.invoiceUnit} against rejected delivery entry ${entry.receivingRevision}. Original receipt, count and credits unchanged.`:`Replacement entry ${entry.replacementRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.replacement'?'replacement-delivery-recorded':'replacement-delivery-voided',note)]}});return;
 }
 if(command.action==='fooditem.replacement-return'||command.action==='fooditem.replacement-return-void'){
  const r=find('fooditem'),entry=command.action==='fooditem.replacement-return'?parseReplacementReturnFields(input,at,me.id,w.location.timezone):parseReplacementReturnVoid(input,at,me.id);
  const note='returnReference'in entry?`Actual pickup ${entry.returnReference}: ${entry.quantity} ${entry.invoiceUnit} from accepted replacement entry ${entry.replacementRevision}. Count, invoice and credits unchanged.`:`Replacement pickup entry ${entry.returnRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.replacement-return'?'replacement-goods-returned':'replacement-pickup-voided',note)]}});return;
 }
 if(command.action==='fooditem.excess-return'||command.action==='fooditem.excess-return-void'){
  const r=find('fooditem'),entry=command.action==='fooditem.excess-return'?parseExcessReturnFields(input,at,me.id,w.location.timezone):parseExcessReturnVoid(input,at,me.id);
  const note='returnReference'in entry?`Actual pickup ${entry.returnReference}: ${entry.quantity} ${entry.invoiceUnit} from extra goods entry ${entry.excessRevision}. Count, invoice and credits unchanged.`:`Extra goods pickup entry ${entry.returnRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.excess-return'?'extra-goods-returned':'extra-pickup-voided',note)]}});return;
 }
 if(command.action==='fooditem.excess'||command.action==='fooditem.excess-void'){
  const r=find('fooditem'),entry=command.action==='fooditem.excess'?parseExcessFields(input,at,me.id,w.location.timezone):parseExcessVoid(input,at,me.id);
  const note='deliveryReference'in entry?`Extra goods ${entry.deliveryReference}: ${entry.quantity} ${entry.invoiceUnit} beyond invoice entry ${entry.invoiceRevision}. Stock and invoice unchanged.`:`Extra goods entry ${entry.excessRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.excess'?'extra-goods-recorded':'extra-goods-voided',note)]}});return;
 }
 if(command.action==='fooditem.receive'||command.action==='fooditem.receive-void'){
  const r=find('fooditem');
  // The Food service validates the linked invoice and all earlier delivery entries.
  const entry=command.action==='fooditem.receive'?parseReceivingFields(input,at,me.id,w.location.timezone):parseReceivingVoid(input,at,me.id);
  const note='deliveryReference'in entry?`Delivery ${entry.deliveryReference}: ${entry.accepted} accepted, ${entry.rejected} rejected in original invoice units. Physical count unchanged.`:`Receiving entry ${entry.receivingRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.receive'?'delivery-recorded':'delivery-voided',note)]}});return;
 }
 if(command.action==='fooditem.return'||command.action==='fooditem.return-void'){
  const r=find('fooditem');
  const entry=command.action==='fooditem.return'?parseReturnFields(input,at,me.id,w.location.timezone):parseSupplierReturnVoid(input,at,me.id);
  const note='returnReference'in entry?`Supplier return ${entry.returnReference}: ${entry.accepted} from accepted goods, ${entry.rejected} from rejected goods in original invoice units. Count and credits unchanged.`:`Supplier return entry ${entry.returnRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.return'?'supplier-return-recorded':'supplier-return-voided',note)]}});return;
 }
 if(command.action==='fooditem.return-credit'||command.action==='fooditem.return-credit-void'){
  requireThat(has(me,'location.manage')||has(me,'orders.review'),'Matching supplier credits requires purchasing review access.',403);
  const r=find('fooditem'),entry=command.action==='fooditem.return-credit'?parseReturnCreditFields(input,at,me.id):parseReturnCreditVoid(input,at,me.id);
  const note='quantity'in entry?`Matched ${entry.quantity} original invoice units from return entry ${entry.returnRevision} to issued credit entry ${entry.creditRevision}. ${entry.note}`:`Match entry ${entry.matchRevision}: ${entry.reason}`;
  save({...r,data:{...r.data,history:[...r.data.history,history(command.action==='fooditem.return-credit'?'return-credit-matched':'return-credit-match-voided',note)]}});return;
 }
 if(command.action==='fooditem.configure'){
  const r=find('fooditem');requireThat(has(me,'location.manage')||has(me,'orders.review'),'Only an owner or purchasing reviewer can change food definitions.',403);
  const reason=text(input.reason,'Reason for correction',1000),changed=parseFoodItem({...object(input.item),restaurantId:r.data.source.sourceRestaurantId},r.data.source);
  const {count:oldCount,countHistory:oldCounts,history:oldHistory,definitionHistory=[],...before}=r.data;
  requireThat(changed.controlNumber===r.data.controlNumber,'A correction cannot change the source identifier.');
  // Provenance is server-owned. An unchanged price/pack keeps its source;
  // importing or supplying a forged priceSource never establishes one.
  changed.vendorSkus=changed.vendorSkus.map(s=>{const old=r.data.vendorSkus.find(o=>o.id===s.id);return old?.priceSource&&sameSkuPrice(old,s)?{...s,priceSource:{...old.priceSource}}:s;});
  // A changed pack invalidates the current count, but all earlier counts remain in history.
  const changedPack=JSON.stringify(pack(changed as unknown as Record<string,unknown>))!==JSON.stringify(pack(r.data as unknown as Record<string,unknown>));
  save({...r,data:{...changed,count:changedPack?null:oldCount,countHistory:oldCounts,definitionHistory:[...definitionHistory,{at,by:me.id,reason,before}],history:[...oldHistory,history('definition-corrected',reason+(changedPack?' Count pack changed; recount required.':''))]}});return;
 }
 requireThat(false,'Unsupported food action.');
}
