'use client';
import {useState} from 'react';
import {inspectInvoiceCsv,invoiceCsvColumns,invoiceCsvLiteralColumns,readInvoiceCsv,type InvoiceCsvColumn,type InvoiceCsvLayout} from '../shared/food-invoice-csv';
import {applyInvoiceCsvLayout,type InvoiceCsvSource} from '../shared/invoice-csv-source';

export const invoiceColumnLabels:Record<InvoiceCsvColumn,string>={vendor:'Supplier',vendor_sku:'Supplier SKU',invoice_number:'Invoice number',line_reference:'Line reference',invoice_date:'Invoice date',quantity:'Quantity',unit_basis:'Quantity basis',invoice_unit:'Invoice unit',line_total:'Net line amount (USD)'};
export function InvoiceColumnMap({source,disabled,onApply}:{source:InvoiceCsvSource;disabled:boolean;onApply:(source:InvoiceCsvSource)=>void}){
 const table=inspectInvoiceCsv(source.csv);
 const [fields,setFields]=useState<InvoiceCsvLayout['fields']>(()=>Object.fromEntries(invoiceCsvColumns.map(k=>[k,table.headers.findIndex(h=>h.trim()===k)])) as InvoiceCsvLayout['fields']);
 const [confirmed,setConfirmed]=useState(false);
 const layout:InvoiceCsvLayout={version:1,headers:table.headers,fields};let issue='',rows:ReturnType<typeof readInvoiceCsv>=[];
 try{rows=readInvoiceCsv(source.csv,layout)}catch(e){issue=e instanceof Error?e.message:'Review this column map.'}
 const change=(key:InvoiceCsvColumn,value:number|{literal:string})=>{setConfirmed(false);setFields(previous=>({...previous,[key]:value}))};
 const unused=table.headers.filter((_,i)=>!Object.values(fields).includes(i));
 return <section aria-label="Invoice column mapping"><h3>Match this file’s columns</h3>
 <p>{table.rows.length} source lines in {source.file.fileName}. Choose the column for each field. You can enter a checked value shared by every line for supplier, invoice number, date, quantity basis or unit.</p>
 <p>Dates must be YYYY-MM-DD. Quantities and net USD line amounts must use a decimal point without currency symbols or thousands separators. Credits, tax, freight and totals rows need a separate review. No dates, prices or units are guessed.</p>
 <div className="food-controls">{invoiceCsvColumns.map(k=><div key={k}><label className="shared-field">{invoiceColumnLabels[k]}<select disabled={disabled} value={typeof fields[k]==='number'?String(fields[k]):'fixed'} onChange={e=>change(k,e.target.value==='fixed'?{literal:''}:Number(e.target.value))}><option value="-1">Choose a source column</option>{table.headers.map((h,i)=><option key={i} value={i}>{i+1}. {h}</option>)}{invoiceCsvLiteralColumns.includes(k)&&<option value="fixed">Same checked value for every line</option>}</select></label>{typeof fields[k]!=='number'&&<label className="shared-field">{invoiceColumnLabels[k]} for every line{k==='unit_basis'?<select disabled={disabled} value={(fields[k] as {literal:string}).literal} onChange={e=>change(k,{literal:e.target.value})}><option value="">Choose quantity basis</option><option value="supplier-pack">Supplier packs</option><option value="measure">Measured quantity</option></select>:<input disabled={disabled} type={k==='invoice_date'?'date':'text'} maxLength={150} value={(fields[k] as {literal:string}).literal} onChange={e=>change(k,{literal:e.target.value})}/>}</label>}</div>)}</div>
 <details><summary>Original first three records</summary>{table.rows.slice(0,3).map(r=><article className="food-card" key={r.recordNumber}><strong>Record {r.recordNumber}</strong><dl>{table.headers.map((h,i)=><div key={i}><dt>{h}</dt><dd style={{overflowWrap:'anywhere'}}>{r.values[i]||'(blank)'}</dd></div>)}</dl></article>)}</details>
 <p>Columns excluded from invoice lines: {unused.length?unused.join(', '):'none'}. The original file keeps all columns.</p>
 {issue?<p role="status">{issue}</p>:<><p>{rows.length} lines pass format checks. Check these mapped examples against the source invoice:</p>{rows.slice(0,3).map(r=><p key={r.recordNumber}>Record {r.recordNumber}: {r.vendor} · SKU {r.vendorSku} · invoice {r.invoiceNumber} / line {r.lineReference} · {r.invoiceDate} · {r.quantity} {r.invoiceUnit} ({r.unitBasis}) · USD {r.lineTotal} net</p>)}</>}
 <label className="food-check"><input type="checkbox" disabled={disabled||!!issue} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked every field, shared value and excluded column against the original invoice.</label>
 <button type="button" disabled={disabled||!!issue||!confirmed} onClick={()=>onApply(applyInvoiceCsvLayout(source,layout))}>Use reviewed column map</button>
 <p className="shared-muted">This prepares a review; it does not save invoice lines. Archive this original before saving mapped lines. Saved lines retain their column map; reopening a non-template original requires a fresh map review.</p></section>;
}
export function InvoiceColumnMapHistory({layout}:{layout:InvoiceCsvLayout}){
 return <details><summary>Saved invoice column map</summary><dl>{invoiceCsvColumns.map(k=>{const value=layout.fields[k];return <div key={k}><dt>{invoiceColumnLabels[k]}</dt><dd>{typeof value==='number'?`Column ${value+1}: ${layout.headers[value]}`:`Checked shared value: ${value.literal}`}</dd></div>})}</dl></details>;
}
