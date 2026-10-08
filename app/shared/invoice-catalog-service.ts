import {authenticateWorkspace,boundedJson} from './service';
import {context} from './food-service';
import {readInvoiceCsv} from './food-invoice-csv';
import {invoiceEntryKey} from './food-invoice';
import {checkSavedInvoice,type SavedInvoiceSource} from './invoice-saved-review';
import {reviewInvoiceCatalog,type InvoiceCatalogItem} from './invoice-catalog-review';
import {has} from './types';
import {localDate} from './local-time';
import {AppError,id,object,requireThat} from './validation';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'POST'}:{})}});
export async function handleInvoiceCatalog(request:Request,binding?:D1Database):Promise<Response>{
 try{
  requireThat(request.method==='POST','Method not allowed.',405);
  requireThat(request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this review from your JMAX workspace.',403);
  requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
  const auth=await authenticateWorkspace(request,binding),body=object(await boundedJson(request.body,1600000));
  requireThat(Object.keys(body).every(k=>['locationId','dataset','csv','layout'].includes(k)),'Unexpected invoice review fields.');
  const locationId=id(body.locationId),dataset=body.dataset;
  requireThat(dataset==='demo'||dataset==='operating','Choose a food dataset.');
  const initial=await context(auth.db,auth.identity,locationId),w=initial.w;
  requireThat(has(w.me,'location.manage')||has(w.me,'orders.review'),'Invoice review requires purchasing access.',403);
  requireThat(typeof body.csv==='string','Choose a CSV file.');
  const rows=readInvoiceCsv(body.csv,body.layout),at=new Date().toISOString();
  // Project only definitions needed for matching, never counts or event history.
  const records=await auth.db.prepare("SELECT id,revision,json_object('title',title,'controlNumber',source_key,'active',json_extract(data,'$.active'),'needsReview',json_extract(data,'$.needsReview'),'source',json_object('dataset',dataset),'vendorSkus',json_extract(data,'$.vendorSkus')) AS data FROM food_records WHERE location_id=? AND dataset=? AND kind='fooditem' ORDER BY id LIMIT 5001").bind(locationId,dataset).all<{id:string;revision:number;data:string}>();
  requireThat(records.results.length<=5000&&records.results.reduce((n,r)=>n+r.data.length,0)<=5000000,'Catalog too large for this review. Review individual invoice lines instead.',413);
  const result=reviewInvoiceCatalog(rows,records.results.map(r=>({...r,data:JSON.parse(r.data)})) as InvoiceCatalogItem[],at,w.location.timezone);
  const keys=rows.map(row=>invoiceEntryKey(row.vendor,row.invoiceNumber,row.lineReference)),saved=new Map<string,SavedInvoiceSource>();
  // Query only these source identities. Old item/pack mappings do not hide a saved line.
  for(let start=0;start<keys.length;start+=50){
   const chunk=keys.slice(start,start+50);
   const history=await auth.db.prepare(`SELECT h.record_id AS itemId,r.title,r.source_key AS controlNumber,h.sequence,h.revision,
    json_extract(h.event,'$.invoiceLine.entryKey') AS entryKey,json_extract(h.event,'$.invoiceLine.invoiceDate') AS invoiceDate,
    json_extract(h.event,'$.invoiceLine.quantity') AS quantity,json_extract(h.event,'$.invoiceLine.unitBasis') AS unitBasis,
    json_extract(h.event,'$.invoiceLine.invoiceUnit') AS invoiceUnit,json_extract(h.event,'$.invoiceLine.lineTotalCents') AS lineTotalCents,
    json_extract(h.event,'$.invoiceLine.sku.vendorSku') AS vendorSku
    FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
    WHERE h.location_id=? AND r.dataset=? AND r.kind='fooditem' AND json_extract(h.event,'$.invoiceLine.entryKey') IN (${chunk.map(()=>'?').join(',')})
    AND NOT EXISTS (SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.invoiceVoid.invoiceRevision')=h.revision)
    ORDER BY h.sequence LIMIT 51`).bind(locationId,dataset,...chunk).all<SavedInvoiceSource>();
   requireThat(history.results.length<=chunk.length,'Saved invoice history has duplicate source identifiers. Review the history first.',503);
   for(const source of history.results){requireThat(!saved.has(source.entryKey),'Saved invoice history has duplicate source identifiers. Review the history first.',503);saved.set(source.entryKey,source);}
  }
  const entries=result.entries.map(entry=>({...entry,saved:checkSavedInvoice(entry.row,saved.get(invoiceEntryKey(entry.row.vendor,entry.row.invoiceNumber,entry.row.lineReference)))}));
  const historyTotals={notRecorded:entries.filter(e=>e.saved.state==='not-recorded').length,recorded:entries.filter(e=>e.saved.state==='recorded').length,conflict:entries.filter(e=>e.saved.state==='conflict').length};
  const fresh=await authenticateWorkspace(request,binding),current=await context(fresh.db,fresh.identity,locationId);
  requireThat(fresh.authUserId===auth.authUserId&&current.w.me.id===w.me.id&&current.membershipRevision===initial.membershipRevision&&current.revision===initial.revision&&current.w.location.revision===w.location.revision&&localDate(new Date().toISOString(),w.location.timezone)===localDate(at,w.location.timezone),'The restaurant or catalog changed. Review the file again.',409);
  return json({locationId,dataset,revision:initial.revision,checkedAt:at,...result,entries,historyTotals});
 }catch(error){return json({error:error instanceof AppError?error.message:'Invoice catalog review is unavailable.'},error instanceof AppError?error.status:503);}
}
