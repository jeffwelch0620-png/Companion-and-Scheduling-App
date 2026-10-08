import {readInvoiceCsv,invoiceCsvMaxBytes,type InvoiceFileSource} from './food-invoice-csv';
import {object,requireThat,text} from './validation';
export type InvoiceArchive={sha256:string;fileName:string;byteLength:number;rowCount:number;createdAt:string};
export const invoiceArchiveMaxBytes=100*1024*1024,invoiceArchiveMaxFiles=10000;
export const invoiceArchiveHash=(s:unknown)=>{requireThat(typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),'Invalid CSV fingerprint.');return s as string};
export async function csvDigest(csv:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function parseInvoiceArchive(input:unknown){
 const value=object(input);requireThat(value.confirmed===true,'Confirm this source file belongs to the selected restaurant and records.');
 const fileName=text(value.fileName,'CSV file name',200);requireThat(/\.csv$/i.test(fileName)&&!/[\\/\x00-\x1f\x7f]/.test(fileName),'Use a CSV file name without a folder path.');
 requireThat(typeof value.csv==='string','Choose a UTF-8 CSV file.');const csv=value.csv as string,bytes=new TextEncoder().encode(csv);
 requireThat(bytes.byteLength>0&&bytes.byteLength<=invoiceCsvMaxBytes&&bytes.byteLength===value.byteLength,'CSV bytes do not match the selected file.');
 requireThat(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)===csv,'CSV text is not valid UTF-8.');
 const sha256=invoiceArchiveHash(value.sha256);requireThat(await csvDigest(csv)===sha256,'CSV fingerprint does not match the selected file.');
 const rows=readInvoiceCsv(csv,value.layout);return {fileName,sha256,byteLength:bytes.byteLength,rowCount:rows.length,csv};
}
export async function verifyArchivedInvoiceSource(db:Pick<D1Database,'prepare'>,locationId:string,dataset:string,source?:InvoiceFileSource){
 if(!source)return;
 const archive=await db.prepare('SELECT csv,byte_length AS byteLength FROM invoice_files WHERE location_id=? AND dataset=? AND sha256=?').bind(locationId,dataset,source.sha256).first<{csv:string;byteLength:number}>();
 if(!archive){requireThat(!source.layout,'Archive the original mapped CSV in these restaurant records before saving its invoice lines.',409);return;}
 requireThat(archive.byteLength===source.byteLength&&await csvDigest(archive.csv)===source.sha256,'Archived CSV integrity check failed.',409);
 const row=readInvoiceCsv(archive.csv,source.layout).find(r=>r.recordNumber===source.row.recordNumber);
 requireThat(row&&Object.keys(row).every(k=>row[k as keyof typeof row]===source.row[k as keyof typeof row]),'Selected invoice row differs from its archived original.',409);
}
