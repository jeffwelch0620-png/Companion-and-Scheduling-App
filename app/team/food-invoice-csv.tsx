'use client';
import {useEffect,useRef,useState} from 'react';
import {invoiceCsvTemplate,readInvoiceCsv,type InvoiceFileSource} from '../shared/food-invoice-csv';
import type {FoodItem} from '../shared/food-model';
import {reviewInvoiceCsv,invoiceCsvReviewPage} from '../shared/invoice-csv-review';
import {invoiceCsvNeedsMapping,readInvoiceUpload,type InvoiceCsvSource} from '../shared/invoice-csv-source';
import {resumeInvoiceArchive} from '../shared/invoice-archive-resume';
import {InvoiceArchiveSave,archiveUrl} from './invoice-archive';
import {InvoiceArchiveBrowser} from './invoice-archive-browser';
import {InvoiceColumnMap} from './invoice-column-map';

const labels={ready:'Ready for line review','choose-pack':'Choose between compatible packs','needs-review':'Needs source or pack review',unmatched:'No available supplier match on this item'};
const amount=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(n);
const quantity=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function InvoiceCsvPicker({onSelect,onReset,disabled,item,timezone,locationId,dataset,apiRoot}:{onSelect:(source:InvoiceFileSource)=>void;onReset:()=>void;disabled:boolean;item:FoodItem;timezone:string;locationId:string;dataset:'demo'|'operating';apiRoot:string}){
 const [source,setSource]=useState<InvoiceCsvSource>(),[selected,setSelected]=useState<number|null>(null),[error,setError]=useState(''),[reading,setReading]=useState(false);
 const [view,setView]=useState<'all'|'matched'|'needs-review'>('all'),[query,setQuery]=useState(''),[page,setPage]=useState(0);
 const generation=useRef(0),request=useRef<AbortController|undefined>(undefined);useEffect(()=>()=>{generation.current++;request.current?.abort()},[]);
 const needsMap=source?invoiceCsvNeedsMapping(source):false,rows=source&&!needsMap?readInvoiceCsv(source.csv,source.file.layout):[],file=source?.file;
 const review=reviewInvoiceCsv(rows,item,new Date().toISOString(),timezone),result=invoiceCsvReviewPage(review,view,query,page);
 const clear=()=>{generation.current++;request.current?.abort();setSource(undefined);setSelected(null);setError('');setReading(false);setQuery('');setPage(0);setView('all');onReset()};
 return <details><summary>Read an invoice CSV</summary><p>Use the JMAX invoice template or review a column map for another comma-separated CSV, up to 250 lines, 40 columns and 256 KiB. Review the file against this item, choose one line, then confirm its supplier pack and source before saving. PDF and Excel files still need conversion. Supplier exports must contain the required source facts and supported date/number formats.</p>
 <a download="JMAX-invoice-template.csv" href={'data:text/csv;charset=utf-8,'+encodeURIComponent(invoiceCsvTemplate)}>Download blank invoice CSV template</a>
 <InvoiceArchiveBrowser key={locationId+':'+dataset} apiRoot={apiRoot} locationId={locationId} dataset={dataset} disabled={disabled||reading} onResume={async archived=>{
  clear();const id=generation.current,abort=new AbortController();request.current=abort;setReading(true);
  try{const response=await fetch(archiveUrl(apiRoot,locationId,dataset,archived.sha256,true),{signal:abort.signal}),value=await resumeInvoiceArchive(response,archived,true);if(id===generation.current&&!abort.signal.aborted)setSource(value)}catch(e){if(id===generation.current&&!abort.signal.aborted)setError(e instanceof Error?e.message:'Unable to reopen this CSV.')}finally{if(id===generation.current)setReading(false)}
 }}/>
 <label className="shared-field">Invoice CSV file<input type="file" accept=".csv,text/csv" disabled={disabled} onChange={async e=>{
  const chosen=e.target.files?.[0];e.target.value='';clear();const id=generation.current;if(!chosen)return;
  setReading(true);try{
   const value=await readInvoiceUpload(chosen,true);if(id===generation.current)setSource(value);
  }catch(e){if(id===generation.current)setError(e instanceof Error?e.message:'Unable to read this CSV.');}finally{if(id===generation.current)setReading(false)}
 }}/></label>
 {(file||error||reading)&&<button type="button" disabled={disabled} onClick={clear}>Clear invoice CSV</button>}
 {source&&needsMap&&<InvoiceColumnMap key={source.file.sha256} source={source} disabled={disabled||reading} onApply={mapped=>{onReset();setSelected(null);setSource(mapped)}}/>}
 {source&&!needsMap&&<InvoiceArchiveSave key={locationId+':'+dataset+':'+source.file.sha256+':'+(source.archived?'archived':'selected')} apiRoot={apiRoot} locationId={locationId} dataset={dataset} csv={source.csv} file={source.file} archived={source.archived} disabled={disabled||reading} onSaved={archived=>setSource(previous=>previous?.file.sha256===source.file.sha256?{...previous,archived}:previous)}/>}
 {reading&&<p role="status">Reading invoice lines…</p>}{error&&<p role="alert">{error}</p>}
 {source?.file.layout&&<button type="button" disabled={disabled||reading} onClick={()=>{onReset();setSelected(null);setPage(0);setError('');setSource({...source,file:{...source.file,layout:undefined}})}}>Review column mapping again</button>}
 {source?.file.layout&&!source.archived&&<p role="status">Archive this original CSV above before selecting a mapped invoice line.</p>}
 {file&&!needsMap&&<section aria-label="Invoice CSV matching review"><h4>Match invoice lines to {item.title}</h4><p>{rows.length} lines read from {file.fileName}. No lines saved by reading the file.</p>
 <p>{review.totals.ready} ready for line review · {review.totals['choose-pack']} with multiple compatible packs · {review.totals['needs-review']} needing source or pack review · {review.totals.unmatched} without a match on this item.</p>
 <p className="shared-muted">This checks only this item’s available supplier packs. Unmatched rows may belong to other items. A match does not confirm the source or whether the invoice was already saved; those checks still apply when saving.</p>
 <div className="food-controls"><label className="shared-field">CSV row view<select disabled={disabled} value={view} onChange={e=>{setView(e.target.value as typeof view);setPage(0)}}><option value="all">All file rows</option><option value="matched">Supplier matches on this item</option><option value="needs-review">Rows needing review</option></select></label><label className="shared-field">Find CSV row<input type="search" disabled={disabled} value={query} maxLength={100} placeholder="Supplier, SKU, invoice, line or record" onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label></div>
 {selected!==null&&<p role="status">Selected CSV record {selected}. Finish its supplier-pack and source review below.</p>}
 {result.entries.map(e=><article className="food-card" key={e.row.recordNumber}><h4>Record {e.row.recordNumber} · {e.row.invoiceNumber} / {e.row.lineReference}</h4><p>{e.row.vendor} · SKU {e.row.vendorSku} · {e.row.invoiceDate}<br/>{e.row.quantity} {e.row.invoiceUnit} · USD {e.row.lineTotal} net</p><p><strong>{labels[e.status]}</strong></p>
 {e.matches.map(m=><p key={m.skuId}>{m.label}<br/>{m.issue??`Normalizes to ${quantity(m.quantity!)} ${m.unit} at ${amount(m.price!)} per ${m.unit}.`}</p>)}
 <button type="button" disabled={disabled||!!source?.file.layout&&!source.archived||e.status==='unmatched'||e.status==='needs-review'} onClick={()=>{setSelected(e.row.recordNumber);onSelect({...file,row:e.row})}}>Review CSV record {e.row.recordNumber}</button></article>)}
 {!result.entries.length&&<p>No CSV rows match this view.</p>}
 <div className="shared-actions"><span>{result.entries.length} shown · {result.total} matching rows · page {result.page+1} of {result.pages}</span>{result.page>0&&<button type="button" disabled={disabled} onClick={()=>setPage(result.page-1)}>Previous CSV rows</button>}{result.page+1<result.pages&&<button type="button" disabled={disabled} onClick={()=>setPage(result.page+1)}>Next CSV rows</button>}</div></section>}
 <p className="shared-muted">Only the selected line and its file reference are saved after line review. Reading or reopening a CSV does not save invoice lines. Archiving stores the entire original in the selected restaurant’s records after a separate confirmation. Clearing or replacing this working copy clears the unsaved invoice fields and leaves archived originals unchanged.</p></details>;
}

