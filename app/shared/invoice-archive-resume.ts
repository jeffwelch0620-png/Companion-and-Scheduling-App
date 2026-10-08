import {invoiceCsvMaxBytes,inspectInvoiceCsv,isInvoiceTemplate,readInvoiceCsv,type InvoiceFileSource} from './food-invoice-csv';
import {csvDigest,type InvoiceArchive} from './invoice-archive';
export async function resumeInvoiceArchive(response:Response,file:InvoiceArchive,allowColumnMapping=false):Promise<{csv:string;file:Omit<InvoiceFileSource,'row'>;archived:InvoiceArchive}>{
 if(!response.ok)throw Error('Archived CSV is unavailable. Refresh the archive list and try again.');
 if(!Number.isSafeInteger(file.byteLength)||file.byteLength<=0||file.byteLength>invoiceCsvMaxBytes||!/^[a-f0-9]{64}$/.test(file.sha256)||!response.body)throw Error('Invalid archived file metadata.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>file.byteLength||total>invoiceCsvMaxBytes)throw Error('Archived CSV exceeds its expected size.');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e}finally{reader.releaseLock()}
 if(total!==file.byteLength)throw Error('Archived CSV size differs from the selected file.');
 const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 const csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 if(await csvDigest(csv)!==file.sha256)throw Error('Archived CSV fingerprint differs from the selected file.');
 const rowCount=allowColumnMapping&&!isInvoiceTemplate(inspectInvoiceCsv(csv).headers)?inspectInvoiceCsv(csv).rows.length:readInvoiceCsv(csv).length;
 if(rowCount!==file.rowCount)throw Error('Archived CSV row count differs from the selected file.');
 return {csv,file:{kind:'csv',fileName:file.fileName,byteLength:file.byteLength,sha256:file.sha256},archived:file};
}
