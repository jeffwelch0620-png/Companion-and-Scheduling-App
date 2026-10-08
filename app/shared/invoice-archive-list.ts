import {object,requireThat} from './validation';
import {invoiceArchiveMaxBytes,invoiceArchiveMaxFiles,type InvoiceArchive} from './invoice-archive';
export type InvoiceArchiveList={locationId:string;dataset:string;q:string;files:InvoiceArchive[];next:string|null;totals:{files:number;bytes:number;matched:number};limits:{files:number;bytes:number}};
type Cursor={v:1;locationId:string;dataset:string;q:string;through:number;before:number};
export async function listInvoiceArchives(db:Pick<D1Database,'prepare'|'batch'>,locationId:string,dataset:string,input:Record<string,unknown>):Promise<InvoiceArchiveList>{
 requireThat(input.q===undefined||typeof input.q==='string','Invalid file-name search.');const q=String(input.q??'').trim();requireThat(q.length<=100,'File-name search is too long.');
 let cursor:Cursor;
 if(input.after!==undefined){
  requireThat(typeof input.after==='string'&&input.after.length<=2000,'Invalid archive page.');let parsed:unknown;
  try{parsed=JSON.parse(input.after as string)}catch{requireThat(false,'Invalid archive page.');}
  const value=object(parsed);
  requireThat(Object.keys(value).every(k=>['v','locationId','dataset','q','through','before'].includes(k))&&value.v===1&&value.locationId===locationId&&value.dataset===dataset&&value.q===q,'Archive page belongs to a different search. Start again.');
  requireThat(Number.isSafeInteger(value.through)&&Number(value.through)>=0&&Number(value.through)<Number.MAX_SAFE_INTEGER&&Number.isSafeInteger(value.before)&&Number(value.before)>0&&Number(value.before)<=Number(value.through)+1,'Invalid archive page.');cursor=value as Cursor;
 }else{
  const row=await db.prepare('SELECT COALESCE(MAX(rowid),0) AS latest FROM invoice_files WHERE location_id=? AND dataset=?').bind(locationId,dataset).first<{latest:number}>();
  const through=row?.latest??0;cursor={v:1,locationId,dataset,q,through,before:through+1};
 }
 const [rows,stats]=await db.batch([
  db.prepare('SELECT rowid AS sequence,sha256,file_name AS fileName,byte_length AS byteLength,row_count AS rowCount,created_at AS createdAt FROM invoice_files WHERE location_id=? AND dataset=? AND rowid<=? AND rowid<? AND instr(lower(file_name),lower(?))>0 ORDER BY rowid DESC LIMIT 21').bind(locationId,dataset,cursor.through,cursor.before,q),
  db.prepare('SELECT COUNT(*) AS files,COALESCE(SUM(byte_length),0) AS bytes,COALESCE(SUM(CASE WHEN instr(lower(file_name),lower(?))>0 THEN 1 ELSE 0 END),0) AS matched FROM invoice_files WHERE location_id=? AND dataset=? AND rowid<=?').bind(q,locationId,dataset,cursor.through),
 ]);
 const found=rows.results as (InvoiceArchive&{sequence:number})[],page=found.slice(0,20),totals=stats.results[0] as InvoiceArchiveList['totals'];
 return {locationId,dataset,q,files:page.map(({sequence,...file})=>file),next:found.length>20?JSON.stringify({...cursor,before:page.at(-1)!.sequence}):null,totals,limits:{files:invoiceArchiveMaxFiles,bytes:invoiceArchiveMaxBytes}};
}
