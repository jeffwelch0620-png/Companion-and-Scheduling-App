import {invoiceCsvMaxBytes,inspectInvoiceCsv,isInvoiceTemplate,parseInvoiceCsvLayout,readInvoiceCsv,type InvoiceFileSource} from './food-invoice-csv';
import {csvDigest,type InvoiceArchive} from './invoice-archive';

export type InvoiceCsvSource={csv:string;file:Omit<InvoiceFileSource,'row'>;archived?:InvoiceArchive};
// Reading prepares a local working copy only; archiving is a separate explicit action.
export async function readInvoiceUpload(file:{name:string;size:number;arrayBuffer:()=>Promise<ArrayBuffer>},allowColumnMapping=false):Promise<InvoiceCsvSource>{
 if(!/\.csv$/i.test(file.name)||file.name.length>200||/[\\/\x00-\x1f\x7f]/.test(file.name)||!file.name.trim())throw Error('Choose a CSV file name without a folder path.');
 if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>invoiceCsvMaxBytes)throw Error('Choose a non-empty UTF-8 CSV no larger than 256 KiB.');
 const bytes=await file.arrayBuffer();if(bytes.byteLength!==file.size)throw Error('CSV size changed while reading. Choose the file again.');
 // ignoreBOM retains the BOM in the text, so a later archive preserves exact bytes.
 const csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 if(!allowColumnMapping||isInvoiceTemplate(inspectInvoiceCsv(csv).headers))readInvoiceCsv(csv);
 return {csv,file:{kind:'csv',fileName:file.name,byteLength:bytes.byteLength,sha256:await csvDigest(csv)}};
}
export function invoiceCsvNeedsMapping(source:InvoiceCsvSource){return !source.file.layout&&!isInvoiceTemplate(inspectInvoiceCsv(source.csv).headers);}
export function applyInvoiceCsvLayout(source:InvoiceCsvSource,value:unknown):InvoiceCsvSource{
 const layout=parseInvoiceCsvLayout(value);readInvoiceCsv(source.csv,layout);
 return {...source,file:{...source.file,layout}};
}
