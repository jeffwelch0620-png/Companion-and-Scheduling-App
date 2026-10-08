'use client';
import {useEffect,useRef,useState} from 'react';
import {InvoiceArchiveSave,archiveUrl} from './invoice-archive';
import {InvoiceBatchPanel} from './invoice-batch';
import {InvoiceSourceSummary} from './invoice-source-groups';
import {invoiceSourceGroups,invoiceSourceEntries} from '../shared/invoice-source-groups';
import {invoiceBatchLimit,type InvoiceChoice} from '../shared/invoice-batch';
import {InvoiceArchiveBrowser} from './invoice-archive-browser';
import {resumeInvoiceArchive} from '../shared/invoice-archive-resume';
import {invoiceCsvColumns,type InvoiceFileSource} from '../shared/food-invoice-csv';
import {invoiceCsvNeedsMapping,readInvoiceUpload,type InvoiceCsvSource} from '../shared/invoice-csv-source';
import type {InvoiceCatalogReview,InvoiceCatalogDraft,InvoiceCatalogEntry} from '../shared/invoice-catalog-review';

import {InvoiceColumnMap} from './invoice-column-map';
type Source=InvoiceCsvSource;
export function InvoiceCatalogPicker({locationId,dataset,apiRoot,disabled,onSelect,onReset,onOpenSaved,refreshVersion=0,onBatchBusy,onBatchChanged}:{locationId:string;dataset:'demo'|'operating';apiRoot:string;disabled:boolean;onSelect:(draft:InvoiceCatalogDraft)=>void;onReset:()=>void;onOpenSaved?:(id:string,sequence:number)=>void;refreshVersion?:number;onBatchBusy?:(v:boolean)=>void;onBatchChanged?:()=>void}){
 const [review,setReview]=useState<InvoiceCatalogReview>(),[source,setSource]=useState<Source>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[page,setPage]=useState(0),[onlyIssues,setOnlyIssues]=useState(false),[reviewVersion,setReviewVersion]=useState(-1);
 const [choices,setChoices]=useState<InvoiceChoice[]>([]),[batchUsed,setBatchUsed]=useState(false);
 const [invoiceKey,setInvoiceKey]=useState('');
 const generation=useRef(0),request=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>{generation.current++;request.current?.abort()},[]);
 const currentReview=reviewVersion===refreshVersion?review:undefined,groups=invoiceSourceGroups(currentReview?.entries??[]),entries=invoiceSourceEntries(groups,invoiceKey,onlyIssues),pages=Math.max(1,Math.ceil(entries.length/20)),current=Math.min(page,pages-1);
 const hiddenSelections=choices.filter(c=>!entries.some(e=>e.row.recordNumber===c.recordNumber)).length;
 const begin=()=>{const ticket=++generation.current;request.current?.abort();const abort=new AbortController();request.current=abort;onReset();setChoices([]);setInvoiceKey('');setBatchUsed(false);setReview(undefined);setError('');setPage(0);setLoading(true);return {ticket,abort}};
 const reviewSource=async(input:Source,ticket:number,abort:AbortController)=>{
  const response=await fetch(`${apiRoot}/food/invoice-review`,{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({locationId,dataset,csv:input.csv,layout:input.file.layout})}),value=await response.json() as InvoiceCatalogReview&{error?:string};
  if(ticket!==generation.current)return;
  if(!response.ok)throw Error(value.error||'Invoice matching is unavailable.');
  if(value.locationId!==locationId||value.dataset!==dataset||!Array.isArray(value.entries)||!value.totals||!value.historyTotals||value.entries.some(e=>!e.saved||!['not-recorded','recorded','conflict'].includes(e.saved.state)))throw Error('Unexpected matching response. Refresh before continuing.');
  setReview(value);setReviewVersion(refreshVersion);
 };
 const failed=(e:unknown,ticket:number)=>{if(ticket===generation.current)setError(e instanceof Error?e.message:'Cannot review this file.')};
 const finished=(ticket:number)=>{if(ticket===generation.current)setLoading(false)};
 return <section className="food-import"><h2>Match invoice CSV to food items</h2><p>Review up to 250 lines from one CSV against this restaurant’s selected records. Saved source identities are checked across the selected catalog, including items whose packs have changed. Choose the item and supplier pack for each new line, then confirm before saving. Final duplicate checks run when you save.</p>
 <details><summary>CSV template headings</summary><pre className="food-preserve">{invoiceCsvColumns.join(',')}</pre><p>UTF-8 comma-separated CSV, at most 256 KiB and 40 columns. Other column headings can be mapped after upload. PDF and Excel files are not supported here. File identity and the selected row are retained when saved; the original file is not archived until you explicitly archive it below.</p></details>
 <InvoiceArchiveBrowser key={locationId+':'+dataset} apiRoot={apiRoot} locationId={locationId} dataset={dataset} disabled={disabled||loading} onResume={async file=>{
  const {ticket,abort}=begin();setSource(undefined);
  try{const response=await fetch(archiveUrl(apiRoot,locationId,dataset,file.sha256,true),{signal:abort.signal}),selected=await resumeInvoiceArchive(response,file,true);if(ticket!==generation.current)return;setSource(selected);if(!invoiceCsvNeedsMapping(selected))await reviewSource(selected,ticket,abort)}catch(e){failed(e,ticket)}finally{finished(ticket)}
 }}/>
 <label className="shared-field">Invoice CSV<input type="file" accept=".csv,text/csv" disabled={disabled} onChange={async e=>{
  const f=e.target.files?.[0];e.target.value='';const {ticket,abort}=begin();setSource(undefined);if(!f){finished(ticket);return;}
  try{
   const selected=await readInvoiceUpload(f,true);
   if(ticket!==generation.current)return;
   setSource(selected);if(!invoiceCsvNeedsMapping(selected))await reviewSource(selected,ticket,abort);
  }catch(e){failed(e,ticket)}finally{finished(ticket)}
 }}/></label>
 {source&&invoiceCsvNeedsMapping(source)&&<InvoiceColumnMap key={source.file.sha256} source={source} disabled={disabled||loading} onApply={async mapped=>{const {ticket,abort}=begin();setSource(mapped);try{await reviewSource(mapped,ticket,abort)}catch(e){failed(e,ticket)}finally{finished(ticket)}}}/>}
 {source&&!invoiceCsvNeedsMapping(source)&&<div><p>Selected file: {source.file.fileName}</p><button disabled={disabled||loading} onClick={async()=>{const {ticket,abort}=begin();try{await reviewSource(source,ticket,abort)}catch(e){failed(e,ticket)}finally{finished(ticket)}}}>Refresh matches and saved lines</button><p className="shared-muted">The working copy stays in this open review. Refresh after a save or catalog change. Archived originals remain available when you return.</p></div>}
 {source&&!invoiceCsvNeedsMapping(source)&&<InvoiceArchiveSave key={source.file.sha256+':'+(source.archived?'archived':'selected')} archived={source.archived} apiRoot={apiRoot} locationId={locationId} dataset={dataset} csv={source.csv} file={source.file} disabled={disabled||loading} onSaved={archived=>setSource(previous=>previous?.file.sha256===source.file.sha256?{...previous,archived}:previous)}/>}
 {loading&&<p role="status">Checking item matches and saved invoice lines…</p>}{error&&<p role="alert">{error}</p>}{review&&!currentReview&&<p role="status">Food records changed. Refresh matches and saved lines before choosing another line.</p>}
 {source?.file.layout&&<button type="button" disabled={disabled||loading} onClick={()=>{generation.current++;request.current?.abort();onReset();setChoices([]);setReview(undefined);setInvoiceKey('');setPage(0);setError('');setBatchUsed(false);setSource({...source,file:{...source.file,layout:undefined}})}}>Review column mapping again</button>}
 {source?.file.layout&&<p role="status">{source.archived?'Original archived. Review item and pack matches before saving.':'Archive this original CSV above before choosing or saving mapped invoice lines.'}</p>}
 {currentReview&&source&&<><p>{currentReview.entries.length} source lines: {currentReview.historyTotals.notRecorded} not recorded; {currentReview.historyTotals.recorded} already recorded; {currentReview.historyTotals.conflict} with changed source fields.</p><p>Catalog matches: {currentReview.totals.ready} single; {currentReview.totals['choose-item']} multiple; {currentReview.totals['needs-review']} with unit or item issues; {currentReview.totals.unmatched} unmatched.</p><label className="food-check"><input type="checkbox" checked={onlyIssues} onChange={e=>{setOnlyIssues(e.target.checked);setPage(0)}}/>Show lines needing attention</label>
 <InvoiceSourceSummary groups={groups} selected={invoiceKey} disabled={disabled||batchUsed||!!source.file.layout&&!source.archived} onChange={key=>{setInvoiceKey(key);setPage(0)}} shown={entries.length} selectedLines={choices.length} hiddenSelections={hiddenSelections}/>
 {onBatchBusy&&<InvoiceBatchPanel key={source.file.sha256+':'+currentReview.checkedAt} review={currentReview} file={source.file} choices={choices} apiRoot={apiRoot} disabled={disabled||batchUsed||!!source.file.layout&&!source.archived} onBusy={onBatchBusy} onStarted={()=>{setBatchUsed(true);onReset()}} onChanged={()=>onBatchChanged?.()}/>}
 {batchUsed&&<p role="status">This matching review has been used for a group. Refresh matches and saved lines before choosing more lines.</p>}
 {entries.slice(current*20,current*20+20).map(entry=><InvoiceCatalogRow key={entry.row.recordNumber} entry={entry} file={source.file} disabled={disabled||batchUsed||!!source.file.layout&&!source.archived} onSelect={onSelect} onOpenSaved={onOpenSaved} choice={choices.find(c=>c.recordNumber===entry.row.recordNumber)} groupFull={choices.length>=invoiceBatchLimit} onChoose={onBatchBusy?choice=>setChoices(previous=>{const others=previous.filter(c=>c.recordNumber!==entry.row.recordNumber);return choice&&others.length<invoiceBatchLimit?[...others,choice]:others}):undefined}/>)}
 <div className="shared-actions"><button disabled={current===0} onClick={()=>setPage(current-1)}>Previous lines</button><span>Page {current+1} of {pages}</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Next lines</button></div></>}
 </section>;
}
export function InvoiceCatalogRow({entry,file,disabled,onSelect,onOpenSaved,choice,onChoose,groupFull=false}:{choice?:InvoiceChoice;onChoose?:(choice?:InvoiceChoice)=>void;groupFull?:boolean;entry:InvoiceCatalogEntry;file:Omit<InvoiceFileSource,'row'>;disabled:boolean;onSelect:(draft:InvoiceCatalogDraft)=>void;onOpenSaved?:(id:string,sequence:number)=>void}){
 const saved=entry.saved,existing=saved.source;
 return <article className="food-card"><h3>Record {entry.row.recordNumber} · {entry.row.invoiceNumber} / {entry.row.lineReference}</h3><p>{entry.row.vendor} · {entry.row.vendorSku} · {entry.row.quantity} {entry.row.invoiceUnit} · ${entry.row.lineTotal}</p>
 {existing&&<div className={saved.state==='conflict'?'food-warning':''}><p><strong>{saved.state==='conflict'?'Saved source differs':'Already recorded'}</strong> · {existing.title} · {existing.controlNumber}. This supplier, invoice and line reference already has an active entry.</p>{saved.state==='conflict'&&<p>Changed fields: {saved.differences.join(', ')}. Review the saved source and correct it explicitly; this review does not replace it.</p>}<p>Saved: SKU {existing.vendorSku} · {existing.invoiceDate} · {existing.quantity} {existing.invoiceUnit} ({existing.unitBasis==='measure'?'measured':'supplier packs'}) · ${(existing.lineTotalCents/100).toFixed(2)} net.</p>{onOpenSaved&&<button disabled={disabled} onClick={()=>onOpenSaved(existing.itemId,existing.sequence)}>Open saved invoice history</button>}</div>}
 {saved.state==='unchecked'&&<p role="alert">Saved invoice history has not been checked. Refresh before choosing this line.</p>}
 {saved.state==='not-recorded'&&<>{entry.status==='choose-item'&&<p className="food-warning">Multiple matches. Check the source invoice and explicitly choose the correct item and pack.</p>}{!entry.matches.length&&<p>No available supplier pack matches this supplier and SKU.</p>}{entry.matches.map(m=><div key={m.itemId+':'+m.skuId}><p><strong>{m.title}</strong> · {m.controlNumber} · {m.label}</p>{m.issue?<p className="food-warning">{m.issue}</p>:<p>{m.quantity} {m.unit} · ${m.price?.toFixed(4)} per {m.unit}</p>}{onChoose&&<label className="food-check"><input type="checkbox" checked={choice?.itemId===m.itemId&&choice?.skuId===m.skuId} disabled={disabled||!!m.issue||groupFull&&!choice} onChange={e=>onChoose(e.target.checked?{recordNumber:entry.row.recordNumber,itemId:m.itemId,skuId:m.skuId}:undefined)}/>Choose this item and pack for the group</label>}<button disabled={disabled||!!m.issue} onClick={()=>onSelect({source:{...file,row:entry.row},skuId:m.skuId,itemId:m.itemId,itemRevision:m.itemRevision})}>Review this item and line</button></div>)}</>}
 </article>;
}
