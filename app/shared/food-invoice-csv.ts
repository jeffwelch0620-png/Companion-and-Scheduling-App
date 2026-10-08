import type {FoodSku} from './food-model';
import {calendarDate} from './schedule-policy';
import {object,requireThat,text} from './validation';

export const invoiceCsvColumns=['vendor','vendor_sku','invoice_number','line_reference','invoice_date','quantity','unit_basis','invoice_unit','line_total'] as const;
export const invoiceCsvMaxBytes=256*1024;
export const invoiceCsvMaxRows=250;
export type InvoiceCsvRow={recordNumber:number;vendor:string;vendorSku:string;invoiceNumber:string;lineReference:string;invoiceDate:string;quantity:string;unitBasis:'supplier-pack'|'measure';invoiceUnit:string;lineTotal:string};
export type InvoiceCsvColumn=typeof invoiceCsvColumns[number];
export type InvoiceCsvLayout={version:1;headers:string[];fields:Record<InvoiceCsvColumn,number|{literal:string}>};
export const invoiceCsvLiteralColumns:readonly InvoiceCsvColumn[]=['vendor','invoice_number','invoice_date','unit_basis','invoice_unit'];
export type InvoiceFileSource={kind:'csv';fileName:string;byteLength:number;sha256:string;row:InvoiceCsvRow;layout?:InvoiceCsvLayout};
export const invoiceCsvTemplate=invoiceCsvColumns.join(',')+'\r\n';
const key=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');

// Strict RFC-style quoted fields; a record number includes the header and blank records.
// The bounded parser never evaluates spreadsheet expressions or guesses date/number locales.
function records(content:string,maxColumns:number=invoiceCsvColumns.length):string[][]{
 const result:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 const pushField=()=>{row.push(field);field='';closed=false;requireThat(row.length<=maxColumns,'CSV has too many columns. Use the invoice template or a supported column map.');};
 const pushRow=()=>{pushField();result.push(row);row=[];requireThat(result.length<=512,'CSV contains too many records, including blank lines.');};
 for(let i=0;i<content.length;i++){
  const c=content[i];
  if(quoted){if(c==='"'){if(content[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c===','){pushField();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&content[i+1]==='\n')i++;pushRow();continue;}
  requireThat(!closed,'Unexpected text after a quoted CSV field.');
  if(c==='"'){requireThat(field==='','Quotes must start at the beginning of a CSV field.');quoted=true;}else field+=c;
 }
 requireThat(!quoted,'CSV contains an unclosed quoted field.');
 if(field!==''||row.length||closed)pushRow();
 return result;
}
function parseRow(values:string[],recordNumber:number):InvoiceCsvRow{
 requireThat(values.length===invoiceCsvColumns.length,`CSV record ${recordNumber} must have ${invoiceCsvColumns.length} columns.`);
 const [vendor,vendorSku,invoiceNumber,lineReference,date,qty,basis,unit,total]=values.map(v=>v.trim());
 const label=(s:string)=>`CSV record ${recordNumber}: ${s}`;
 text(vendor,label('supplier'),150);text(vendorSku,label('supplier SKU'),100);text(invoiceNumber,label('invoice number'),100);text(lineReference,label('line reference'),100);
 const invoiceDate=calendarDate(date,label('invoice date'));
 requireThat(/^(?:\d+)(?:\.\d+)?$/.test(qty)&&qty.length<=24&&Number(qty)>0&&Number(qty)<=1000000,label('quantity must be a positive decimal up to 1,000,000; no commas or exponent notation.'));
 requireThat(basis==='supplier-pack'||basis==='measure',label('unit_basis must be supplier-pack or measure.'));
 text(unit,label('invoice unit'),30);
 requireThat(/^\d{1,7}(\.\d{1,2})?$/.test(total)&&Number(total)<=1000000,label('line_total must be net USD up to 1,000,000 with at most two decimal places, without tax or freight.'));
 return {recordNumber,vendor,vendorSku,invoiceNumber,lineReference,invoiceDate,quantity:qty,unitBasis:basis,invoiceUnit:unit,lineTotal:total};
}
export function inspectInvoiceCsv(content:string){
 requireThat(new TextEncoder().encode(content).byteLength<=invoiceCsvMaxBytes,'Choose a UTF-8 CSV no larger than 256 KiB.');
 const all=records(content.replace(/^\uFEFF/,''),40),headers=all[0]??[];
 requireThat(headers.length>0&&headers.every(h=>h.trim().length>0&&h.length<=150),'CSV column headings must be non-empty and at most 150 characters.');
 requireThat(new Set(headers.map(key)).size===headers.length,'CSV column headings must be unique. Correct duplicate headings first.');
 const rows=all.slice(1).flatMap((values,i)=>values.length===1&&!values[0].trim()?[]:[{values,recordNumber:i+2}]);
 requireThat(rows.length>0&&rows.length<=invoiceCsvMaxRows,'Choose a CSV containing 1 to 250 invoice lines.');
 for(const row of rows)requireThat(row.values.length===headers.length,`CSV record ${row.recordNumber} has a different number of columns from its headings.`);
 return {headers,rows};
}
export function isInvoiceTemplate(headers:string[]){return headers.length===invoiceCsvColumns.length&&headers.every((v,i)=>v.trim()===invoiceCsvColumns[i]);}
export function parseInvoiceCsvLayout(value:unknown):InvoiceCsvLayout{
 const layout=object(value);requireThat(layout.version===1&&Object.keys(layout).every(k=>['version','headers','fields'].includes(k)),'Unsupported CSV column map.');
 const headers=layout.headers;requireThat(Array.isArray(headers)&&headers.length>0&&headers.length<=40&&headers.every(h=>typeof h==='string'&&h.trim().length>0&&h.length<=150),'Invalid CSV column headings.');
 requireThat(new Set((headers as string[]).map(key)).size===headers.length,'CSV column headings must be unique.');
 const fields=object(layout.fields);requireThat(Object.keys(fields).length===invoiceCsvColumns.length&&invoiceCsvColumns.every(k=>Object.hasOwn(fields,k)),'Map all nine invoice fields.');
 const normalized={} as InvoiceCsvLayout['fields'],used=new Set<number>();
 for(const name of invoiceCsvColumns){
  const entry=fields[name];
  if(typeof entry==='number'){
   requireThat(Number.isSafeInteger(entry)&&entry>=0&&entry<headers.length,'Choose an existing CSV column.');
   requireThat(!used.has(entry),'Use each CSV column for only one invoice field.');used.add(entry);normalized[name]=entry;
  }else{
   const fixed=object(entry);requireThat(invoiceCsvLiteralColumns.includes(name)&&Object.keys(fixed).length===1&&Object.hasOwn(fixed,'literal'),'This field must use an original CSV column.');
   normalized[name]={literal:text(fixed.literal,'Value for every invoice line',150)};
  }
 }
 return {version:1,headers:[...headers] as string[],fields:normalized};
}
export function readInvoiceCsv(content:string,layoutValue?:unknown):InvoiceCsvRow[]{
 requireThat(new TextEncoder().encode(content).byteLength<=invoiceCsvMaxBytes,'Choose a UTF-8 CSV no larger than 256 KiB.');
 if(layoutValue!==undefined){
  const table=inspectInvoiceCsv(content),layout=parseInvoiceCsvLayout(layoutValue);
  requireThat(JSON.stringify(table.headers)===JSON.stringify(layout.headers),'CSV headings changed. Review the column map again.');
  const seen=new Set<string>();
  return table.rows.map(({values,recordNumber})=>{
   const row=parseRow(invoiceCsvColumns.map(k=>{const field=layout.fields[k];return typeof field==='number'?values[field]:field.literal}),recordNumber);
   const id=JSON.stringify([key(row.vendor),key(row.invoiceNumber),key(row.lineReference)]);
   requireThat(!seen.has(id),`CSV record ${recordNumber} repeats the same supplier, invoice and line reference. Correct the file first.`);seen.add(id);return row;
  });
 }
 const rows=records(content.replace(/^\uFEFF/,''));
 requireThat(rows.length>1&&rows[0].length===invoiceCsvColumns.length&&rows[0].every((v,i)=>v.trim()===invoiceCsvColumns[i]),'Use the invoice CSV template with its nine column headings in the supplied order.');
 const data:InvoiceCsvRow[]=[],seen=new Set<string>();
 rows.slice(1).forEach((r,i)=>{if(r.length===1&&!r[0].trim())return;const row=parseRow(r,i+2);
  const id=JSON.stringify([key(row.vendor),key(row.invoiceNumber),key(row.lineReference)]);
  requireThat(!seen.has(id),`CSV record ${row.recordNumber} repeats the same supplier, invoice and line reference. Correct the file first.`);seen.add(id);data.push(row);
 });
 requireThat(data.length>0&&data.length<=invoiceCsvMaxRows,'Choose a CSV containing 1 to 250 invoice lines.');
 return data;
}
export function csvMatchesSupplier(row:InvoiceCsvRow,sku:FoodSku){return key(row.vendor)===key(sku.vendor)&&key(row.vendorSku)===key(sku.vendorSku);}
export function parseInvoiceFileSource(value:unknown,input:Record<string,unknown>,sku:FoodSku):InvoiceFileSource{
 const source=object(value);requireThat(source.kind==='csv','Unsupported invoice file format.');
 const fileName=text(source.fileName,'CSV file name',200);requireThat(/\.csv$/i.test(fileName)&&!/[\\/\x00-\x1f]/.test(fileName),'Use a CSV file name without a folder path.');
 requireThat(Number.isSafeInteger(source.byteLength)&&Number(source.byteLength)>0&&Number(source.byteLength)<=invoiceCsvMaxBytes,'CSV file size is outside the supported limit.');
 const sha256=text(source.sha256,'CSV fingerprint',64);requireThat(/^[a-f0-9]{64}$/.test(sha256),'Invalid CSV fingerprint.');
 const raw=object(source.row);requireThat(Number.isSafeInteger(raw.recordNumber)&&Number(raw.recordNumber)>=2&&Number(raw.recordNumber)<=512,'Invalid CSV record number.');
 const fields=['vendor','vendorSku','invoiceNumber','lineReference','invoiceDate','quantity','unitBasis','invoiceUnit','lineTotal'];
 requireThat(fields.every(k=>typeof raw[k]==='string'),'CSV source values must be text.');
 const row=parseRow(fields.map(k=>raw[k] as string),Number(raw.recordNumber));
 requireThat(csvMatchesSupplier(row,sku),'The CSV supplier and SKU do not match the selected supplier pack.');
 for(const field of ['invoiceNumber','lineReference','invoiceDate','unitBasis','invoiceUnit'] as const)requireThat(typeof input[field]==='string'&&key(String(input[field]))===key(row[field]),'Reviewed fields differ from the CSV row. Switch to manual entry or choose the correct row.');
 requireThat(Number(input.quantity)===Number(row.quantity)&&Number(input.lineTotal)===Number(row.lineTotal),'Reviewed amounts differ from the CSV row. Switch to manual entry or choose the correct row.');
 return {kind:'csv',fileName,byteLength:Number(source.byteLength),sha256,row,...(source.layout===undefined?{}:{layout:parseInvoiceCsvLayout(source.layout)})};
}

