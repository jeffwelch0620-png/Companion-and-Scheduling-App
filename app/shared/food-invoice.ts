import {packAmount,foodUnits,type FoodItem,type FoodSku,type FoodSource} from './food-model';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';
import {parseInvoiceFileSource,type InvoiceFileSource} from './food-invoice-csv';

export type FoodInvoiceLine={entryKey:string;dataset:FoodSource['dataset'];invoiceNumber:string;lineReference:string;invoiceDate:string;sourceNote:string;quantity:number;unitBasis:'supplier-pack'|'measure';invoiceUnit:string;lineTotalCents:number;supplierPackQuantity:number;pricePerSupplierPack:number;sku:FoodSku;at:string;by:string;fileSource?:InvoiceFileSource};
export type FoodInvoiceVoid={invoiceRevision:number;reason:string;at:string;by:string;clearedSkuIds?:string[]};
const aliases:Record<string,string>={cs:'case',cases:'case',ea:'each',piece:'each',pieces:'each',lbs:'lb',pound:'lb',pounds:'lb',ounces:'oz',ounce:'oz',grams:'g',gram:'g',kilogram:'kg',kilograms:'kg',gallon:'gal',gallons:'gal',quart:'qt',quarts:'qt',pint:'pt',pints:'pt',liter:'l',litre:'l',liters:'l',litres:'l',milliliter:'ml',milliliters:'ml','fluid ounce':'fl oz','fluid ounces':'fl oz',bg:'bag',bags:'bag',pk:'pack',packs:'pack',bx:'box',boxes:'box'};
export function invoiceUnit(value:string){const unit=value.trim().toLowerCase().replace(/\s+/g,' ');return Object.hasOwn(aliases,unit)?aliases[unit]:unit;}
const key=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
export const invoiceEntryKey=(vendor:string,invoiceNumber:string,lineReference:string)=>JSON.stringify([vendor,invoiceNumber,lineReference].map(key));
export function parseInvoiceLine(input:Record<string,unknown>,item:FoodItem,at:string,by:string,timezone:string):FoodInvoiceLine{
 requireThat(item.active&&!item.needsReview,'Resolve the item mapping and active status before recording an invoice line.');
 const sku=item.vendorSkus.find(s=>s.id===input.skuId);requireThat(sku&&sku.available,'Choose an available supplier pack for this item.');
 requireThat(sku.purchaseUnit.trim(),'Set the supplier purchase unit before recording an invoice line.');
 const invoiceNumber=text(input.invoiceNumber,'Invoice number',100),lineReference=text(input.lineReference,'Invoice line reference',100),invoiceDate=calendarDate(input.invoiceDate,'Invoice date'),sourceNote=text(input.sourceNote,'Invoice source note',1000);
 requireThat(invoiceDate<=localDate(at,timezone),'An observed invoice cannot be dated in the future.');
 const qty=input.quantity;requireThat((typeof qty==='number'||typeof qty==='string'&&qty.trim()!=='')&&Number.isFinite(Number(qty))&&Number(qty)>0&&Number(qty)<=1000000,'Invoice quantity must be greater than zero and at most 1,000,000.');
 const total=input.lineTotal;requireThat((typeof total==='string'||typeof total==='number')&&/^\d{1,7}(\.\d{1,2})?$/.test(String(total)),'Enter the net line amount in dollars and cents, without tax, freight or currency symbols.');
 const lineTotalCents=Math.round(Number(total)*100);requireThat(lineTotalCents<=100000000,'Line amount exceeds the supported limit.');
 const unit=invoiceUnit(text(input.invoiceUnit,'Invoice unit',30));let supplierPackQuantity=Number(qty);
 requireThat(input.unitBasis==='supplier-pack'||input.unitBasis==='measure','Choose whether the invoice uses the supplier pack or a measured quantity.');
 if(input.unitBasis==='supplier-pack')requireThat(unit&&unit===invoiceUnit(sku.purchaseUnit),'Invoice unit does not match the selected supplier purchase unit.');
 else{
  requireThat(foodUnits.includes(unit),'Use a supported measured invoice unit.');
  const measured=packAmount({purchaseUnit:unit,packCount:1,unitQty:1,unitUOM:unit}),supplier=packAmount({...sku,unitUOM:invoiceUnit(sku.unitUOM)});
  requireThat(measured&&supplier&&measured.family===supplier.family,'Invoice measure and supplier pack need a known conversion in the same unit family.');
  supplierPackQuantity=Number(qty)*measured.value/supplier.value;
 }
 const pricePerSupplierPack=lineTotalCents/100/supplierPackQuantity;
 requireThat(Number.isFinite(supplierPackQuantity)&&supplierPackQuantity>0&&Number.isFinite(pricePerSupplierPack)&&pricePerSupplierPack<=1000000,'The normalized pack quantity or price is outside the supported range.');
 requireThat(input.confirmed===true,'Confirm the item, supplier pack, unit and net line amount against the source invoice.');
 const fileSource=input.fileSource===undefined?undefined:parseInvoiceFileSource(input.fileSource,input,sku);
 return {entryKey:invoiceEntryKey(sku.vendor,invoiceNumber,lineReference),dataset:item.source.dataset,invoiceNumber,lineReference,invoiceDate,sourceNote,quantity:Number(qty),unitBasis:input.unitBasis,invoiceUnit:unit,lineTotalCents,supplierPackQuantity,pricePerSupplierPack,sku:{...sku},at,by,...(fileSource?{fileSource}:{})};
}
export function parseInvoiceVoid(input:Record<string,unknown>,at:string,by:string):FoodInvoiceVoid{
 requireThat(Number.isSafeInteger(input.invoiceRevision)&&Number(input.invoiceRevision)>0,'Choose the original invoice line entry.');
 return {invoiceRevision:Number(input.invoiceRevision),reason:text(input.reason,'Reason for voiding invoice line',1000),at,by};
}
