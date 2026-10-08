'use client';
import {useState} from 'react';
import type {InvoiceCatalogDraft} from '../shared/invoice-catalog-review';
import {foodUnits} from '../shared/food-model';
import {parseInvoiceLine,invoiceUnit,type FoodInvoiceLine} from '../shared/food-invoice';
import {reviewedInvoicePrice} from '../shared/food-price';
import type {FoodHistoryPage} from '../shared/food-contract';
import {has,personName,type RecordOf,type Workspace} from '../shared/types';
import {displayTime,localDate} from '../shared/local-time';
import type {Send} from './workspace';
import {InvoiceClaim} from './food-claim';
import {InvoiceCredits} from './food-credit';
import {InvoiceExcess} from './food-excess';
import {InvoiceReceiving} from './food-receiving';
import {InvoiceCsvPicker} from './food-invoice-csv';
import {InvoiceArchiveDownload} from './invoice-archive';
import {csvMatchesSupplier,type InvoiceFileSource} from '../shared/food-invoice-csv';

const dollars=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(n);
const quantity=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function InvoiceForm({r,w,send,busy,onSaved,draft,apiRoot="/api"}:{apiRoot?:string;draft?:InvoiceCatalogDraft;r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean;onSaved:()=>void}){
 const today=localDate(new Date().toISOString(),w.location.timezone);
 const [input,setInput]=useState(draft?{skuId:draft.skuId,invoiceNumber:draft.source.row.invoiceNumber,lineReference:draft.source.row.lineReference,invoiceDate:draft.source.row.invoiceDate,sourceNote:'',quantity:draft.source.row.quantity,unitBasis:draft.source.row.unitBasis,invoiceUnit:draft.source.row.invoiceUnit,lineTotal:draft.source.row.lineTotal}:{skuId:'',invoiceNumber:'',lineReference:'',invoiceDate:today,sourceNote:'',quantity:'',unitBasis:'supplier-pack',invoiceUnit:'',lineTotal:''}),[confirmed,setConfirmed]=useState(false);
 const [fileSource,setFileSource]=useState<InvoiceFileSource|undefined>(draft?.source);
 const sku=r.data.vendorSkus.find(s=>s.id===input.skuId);
 const update=(key:keyof typeof input,value:string)=>{setInput({...input,[key]:value});setConfirmed(false)};
 let preview:FoodInvoiceLine|null=null,issue='';
 try{preview=parseInvoiceLine({...input,fileSource,confirmed:true},r.data,new Date().toISOString(),w.me.id,w.location.timezone)}catch(e){issue=e instanceof Error?e.message:'Review this invoice line.'}
 return <form onSubmit={async e=>{e.preventDefault();if(await send('fooditem.invoice',{...input,fileSource,confirmed},r))onSaved()}}><fieldset disabled={busy}><h3>Review one invoice line</h3>
  <InvoiceCsvPicker key={w.location.id+':'+r.data.source.dataset+':'+r.id} apiRoot={apiRoot} locationId={w.location.id} dataset={r.data.source.dataset} disabled={busy} item={r.data} timezone={w.location.timezone} onReset={()=>{setFileSource(undefined);setInput({skuId:'',invoiceNumber:'',lineReference:'',invoiceDate:today,sourceNote:'',quantity:'',unitBasis:'supplier-pack',invoiceUnit:'',lineTotal:''});setConfirmed(false)}} onSelect={source=>{const row=source.row;setFileSource(source);setInput({...input,skuId:'',invoiceNumber:row.invoiceNumber,lineReference:row.lineReference,invoiceDate:row.invoiceDate,quantity:row.quantity,unitBasis:row.unitBasis,invoiceUnit:row.invoiceUnit,lineTotal:row.lineTotal});setConfirmed(false)}}/>
  {fileSource&&<div className="food-warning"><p>Source: {fileSource.fileName}, CSV record {fileSource.row.recordNumber} · {fileSource.row.vendor} · SKU {fileSource.row.vendorSku}. Choose the matching supplier pack below. Source values are held until you switch to manual entry.</p><button type="button" onClick={()=>{setFileSource(undefined);setInput({...input,invoiceUnit:invoiceUnit(input.invoiceUnit)});setConfirmed(false)}}>Switch to manual entry</button></div>}
  <p>Match a source invoice to this item and supplier pack. Saving records the observed price and units. Catalog prices, recipe costs and physical counts stay unchanged.</p>
  {fileSource&&!r.data.vendorSkus.some(s=>s.available&&csvMatchesSupplier(fileSource.row,s))&&<p role="alert">This CSV line has no matching available supplier pack on this item. Open the correct item or review its mapping before saving.</p>}
  <div className="food-controls">
   <label className="shared-field">Invoice supplier pack<select value={input.skuId} onChange={e=>{const selected=r.data.vendorSkus.find(s=>s.id===e.target.value);setInput(fileSource?{...input,skuId:e.target.value}:{...input,skuId:e.target.value,unitBasis:'supplier-pack',invoiceUnit:selected?.purchaseUnit??''});setConfirmed(false)}} required><option value="">Choose the matching supplier pack</option>{r.data.vendorSkus.filter(s=>s.available&&(!fileSource||csvMatchesSupplier(fileSource.row,s))).map(s=><option value={s.id} key={s.id}>{s.vendor} · {s.vendorSku} · {s.packCount??'?'} × {s.unitQty??'?'} {s.unitUOM} / {s.purchaseUnit}</option>)}</select></label>
   <label className="shared-field">Invoice number<input disabled={!!fileSource} value={input.invoiceNumber} onChange={e=>update('invoiceNumber',e.target.value)} maxLength={100} required/></label>
   <label className="shared-field">Invoice line reference<input disabled={!!fileSource} value={input.lineReference} onChange={e=>update('lineReference',e.target.value)} maxLength={100} placeholder="Line number on the invoice" required/></label>
   <label className="shared-field">Invoice date<input type="date" disabled={!!fileSource} value={input.invoiceDate} onChange={e=>update('invoiceDate',e.target.value)} max={today} required/></label>
   <label className="shared-field">Invoice quantity<input type="number" min="0" max="1000000" step="any" disabled={!!fileSource} value={input.quantity} onChange={e=>update('quantity',e.target.value)} required/></label>
   <label className="shared-field">Invoice quantity basis<select disabled={!!fileSource} value={input.unitBasis} onChange={e=>{setInput({...input,unitBasis:e.target.value,invoiceUnit:e.target.value==='supplier-pack'?sku?.purchaseUnit??'':''});setConfirmed(false)}}><option value="supplier-pack">Supplier purchase packs</option><option value="measure">Measured weight, volume or each</option></select></label>
   <label className="shared-field">Invoice unit{(fileSource||input.unitBasis==='supplier-pack')?<input disabled={!!fileSource} value={input.invoiceUnit} onChange={e=>update('invoiceUnit',e.target.value)} maxLength={30} required/>:<select disabled={!!fileSource} value={input.invoiceUnit} onChange={e=>update('invoiceUnit',e.target.value)} required><option value="">Choose the invoice measure</option>{foodUnits.map(u=><option key={u}>{u}</option>)}</select>}</label>
   <label className="shared-field">Net line amount (USD)<input type="number" min="0" max="1000000" step=".01" disabled={!!fileSource} value={input.lineTotal} onChange={e=>update('lineTotal',e.target.value)} required/></label>
  </div>
  <p>Use the net amount for this line after its discount, excluding tax and freight. Zero means the supplier charged nothing. To record an issued supplier credit, save the invoice first, then open its source and change history.</p>
  <label className="shared-field">Invoice source reference<textarea value={input.sourceNote} onChange={e=>update('sourceNote',e.target.value)} required maxLength={1000} placeholder="Where to find the original invoice, such as its Drive file link and page"/></label><p className="shared-muted">This reference does not upload or verify an attachment.</p>
  {preview?<div className="food-summary" role="status"><span>Normalized quantity <strong>{quantity(preview.supplierPackQuantity)} {preview.sku.purchaseUnit}</strong></span><span>Observed price per {preview.sku.purchaseUnit} <strong>{dollars(preview.pricePerSupplierPack)}</strong></span><span>Current catalog price <strong>{sku?.price==null?'Not supplied':dollars(sku.price)}</strong></span></div>:<p className="shared-muted">{issue}</p>}
  <label className="food-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>I checked the item, supplier pack, unit and net amount against the source invoice.</label>
  <button className="shared-primary" disabled={!preview||!confirmed}>Save reviewed invoice line</button>
 </fieldset></form>;
}

export function InvoiceHistory({entry,r,w,send,busy,apiRoot="/api"}:{apiRoot?:string;entry:FoodHistoryPage['entries'][number];r:RecordOf<'fooditem'>;w:Workspace;send:Send;busy:boolean}){
 const [correcting,setCorrecting]=useState(false),[applying,setApplying]=useState(false),line=entry.event.invoiceLine;
 if(!line)return null;
 const mayCorrect=has(w.me,'location.manage')||has(w.me,'orders.review');
 const current=r.data.vendorSkus.find(s=>s.id===line.sku.id),isCurrent=current?.priceSource?.invoiceRevision===entry.revision;
 let priceIssue='';try{reviewedInvoicePrice(r.data,line,entry.revision,{confirmed:true,reason:'Preview'},new Date().toISOString(),w.me.id)}catch(e){priceIssue=e instanceof Error?e.message:'Review this price first.'}
 if(entry.invoiceCredits?.entries)priceIssue='This invoice has supplier credits. Review its supplier price separately through item correction.';
 return <div className="food-waste-history"><p><strong>Invoice {line.invoiceNumber} · line {line.lineReference} · {line.invoiceDate}</strong><br/>{line.sku.vendor} · {line.quantity} {line.invoiceUnit} · {dollars(line.lineTotalCents/100)} net. Equivalent to {quantity(line.supplierPackQuantity)} {line.sku.purchaseUnit} at {dollars(line.pricePerSupplierPack)} per {line.sku.purchaseUnit}.</p>
  <p>Supplier pack at entry: {line.sku.vendorSku} · {line.sku.packCount??'?'} × {line.sku.unitQty??'?'} {line.sku.unitUOM||'unit unknown'} / {line.sku.purchaseUnit}. Recording this line left the catalog price and physical count unchanged.</p>
  {line.fileSource&&<details><summary>CSV source: {line.fileSource.fileName} · record {line.fileSource.row.recordNumber}</summary><p>{line.fileSource.row.vendor} · supplier SKU {line.fileSource.row.vendorSku} · {line.fileSource.byteLength} bytes. File read in the browser; the selected row and reported fingerprint were retained. Archive availability is checked separately against the saved fingerprint.</p><p style={{overflowWrap:'anywhere'}}>SHA-256: {line.fileSource.sha256}</p>{mayCorrect&&<InvoiceArchiveDownload key={w.location.id+':'+r.data.source.dataset+':'+line.fileSource.sha256} apiRoot={apiRoot} locationId={w.location.id} dataset={r.data.source.dataset} source={line.fileSource}/>}</details>}
  {entry.invoicePriceApplied&&<p><strong>{isCurrent?'Current catalog price from this invoice':'Previously applied invoice price'}</strong>: {dollars(entry.invoicePriceApplied.price)} per {line.sku.purchaseUnit}, dated {entry.invoicePriceApplied.priceDate}. Applied by {personName(w,entry.invoicePriceApplied.by)} on {displayTime(entry.invoicePriceApplied.at,w.location.timezone)}: {entry.invoicePriceApplied.reason}.</p>}
  {!entry.invoiceVoided&&!entry.invoicePriceApplied&&mayCorrect&&<>{priceIssue?<p className="shared-muted">Price application needs review: {priceIssue}</p>:<button disabled={busy} onClick={()=>{setApplying(!applying);setCorrecting(false)}}>{applying?'Keep current catalog price':'Apply reviewed invoice price'}</button>}
   {applying&&!priceIssue&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('fooditem.invoice-apply',{invoiceRevision:entry.revision,reason:f.get('reason'),confirmed:f.get('confirmed')==='on'},r)}}><fieldset disabled={busy}><h4>Review catalog price change</h4><p>Change {current?.price==null?'the missing price':dollars(current.price)} to {dollars(line.pricePerSupplierPack)} per {line.sku.purchaseUnit}, dated {line.invoiceDate}. Recipes using this preferred supplier pack will recalculate. Physical stock stays unchanged.</p><label className="shared-field">Reason for applying invoice price<textarea name="reason" required maxLength={1000}/></label><label className="food-check"><input type="checkbox" name="confirmed" required/>Use this reviewed invoice price for this supplier pack.</label><button className="shared-primary">Confirm catalog price</button></fieldset></form>}</>}
  {entry.invoiceVoided?<p><strong>Invoice line voided</strong> by {personName(w,entry.invoiceVoided.by)} on {displayTime(entry.invoiceVoided.at,w.location.timezone)}: {entry.invoiceVoided.reason}. Original retained.{entry.invoiceVoided.clearedSkuIds?.length?' The price supported by this invoice was cleared when it was voided.':''}</p>:mayCorrect&&<><button disabled={busy} onClick={()=>{setCorrecting(!correcting);setApplying(false)}}>{correcting?'Keep this invoice line':'Void incorrect invoice line'}</button>{correcting&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('fooditem.invoice-void',{invoiceRevision:entry.revision,reason:f.get('reason'),confirmPriceClear:f.get('confirmPriceClear')==='on'},r)}}><fieldset disabled={busy}><p>The original stays in history. After voiding it, record the corrected line against the right item.</p>{isCurrent&&<><p>This invoice supplies the current catalog price. Voiding it will clear that price and affected recipe costs will need review. An older price will not be restored automatically.</p><label className="food-check"><input type="checkbox" name="confirmPriceClear" required/>Clear the catalog price supported by this invoice.</label></>}<label className="shared-field">Reason for voiding invoice line<textarea name="reason" required maxLength={1000}/></label><button>Confirm invoice void</button></fieldset></form>}</>}
  {!!entry.invoiceExtraBilling?.entries&&<p>{quantity(entry.invoiceExtraBilling.quantity)} {line.invoiceUnit} of this invoice is linked to extra deliveries across {entry.invoiceExtraBilling.entries} checked matches. Correct incorrect billing matches before voiding this invoice; this does not record receiving or payment.</p>}
  <InvoiceClaim entry={entry} r={r} w={w} send={send} busy={busy}/>
  <InvoiceCredits entry={entry} r={r} w={w} send={send} busy={busy}/>
  <InvoiceReceiving entry={entry} r={r} w={w} send={send} busy={busy}/>
  <InvoiceExcess entry={entry} r={r} w={w} send={send} busy={busy}/>
 </div>;
}
