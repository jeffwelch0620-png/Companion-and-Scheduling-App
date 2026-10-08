'use client';
import {useEffect,useState} from 'react';
import type {InvoiceArchive} from '../shared/invoice-archive';
import type {InvoiceArchiveList} from '../shared/invoice-archive-list';
import {archiveUrl} from './invoice-archive';
export function InvoiceArchiveBrowser({apiRoot,locationId,dataset,disabled,onResume}:{apiRoot:string;locationId:string;dataset:string;disabled:boolean;onResume:(file:InvoiceArchive)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[q,setQ]=useState(''),[after,setAfter]=useState(''),[reload,setReload]=useState(0),[page,setPage]=useState<InvoiceArchiveList>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!open)return;const abort=new AbortController();setPage(undefined);setError('');setLoading(true);
  void fetch(`${apiRoot}/food/invoice-files?${new URLSearchParams({locationId,dataset,view:'list',q,...(after?{after}:{})})}`,{signal:abort.signal}).then(async response=>{
   const value=await response.json() as InvoiceArchiveList&{error?:string};if(!response.ok)throw Error(value.error||'Archive list is unavailable.');
   if(value.locationId!==locationId||value.dataset!==dataset||value.q!==q||!Array.isArray(value.files)||value.files.length>20||!value.totals||!value.limits||value.files.some(f=>!f||typeof f.fileName!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.byteLength)))throw Error('Unexpected archive list. Refresh before continuing.');
   if(!abort.signal.aborted)setPage(value);
  }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Unable to browse archives.')}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});
  return()=>abort.abort();
 },[open,apiRoot,locationId,dataset,q,after,reload]);
 const first=()=>{setAfter('');setReload(n=>n+1)};
 return <section><button type="button" disabled={disabled} onClick={()=>setOpen(!open)}>{open?'Close archived CSVs':'Browse archived CSVs'}</button>{open&&<><h3>Archived invoice CSVs</h3><p>Files in this restaurant’s {dataset==='demo'?'demo / training':'operating'} records. Search the first saved file name. Opening a file resumes review; it does not record invoice lines.</p>
 <div role="search" aria-label="Archived invoice files"><label className="shared-field">File name<input value={query} maxLength={100} disabled={disabled} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(!disabled&&!loading){setQ(query.trim());first()}}}}/></label><button type="button" disabled={disabled||loading} onClick={()=>{setQ(query.trim());first()}}>Search archives</button></div><button type="button" disabled={disabled||loading} onClick={first}>Refresh archived files</button>
 {loading&&<p role="status">Loading archived files…</p>}{error&&<p role="alert">{error}</p>}{page&&<InvoiceArchivePage page={page} apiRoot={apiRoot} disabled={disabled||loading} onResume={onResume}/>}<div className="shared-actions">{after&&<button type="button" disabled={disabled||loading} onClick={first}>Newest files</button>}{page?.next&&<button type="button" disabled={disabled||loading} onClick={()=>setAfter(page.next!)}>Older files</button>}</div></>}</section>;
}
export function InvoiceArchivePage({page,apiRoot,disabled,onResume}:{page:InvoiceArchiveList;apiRoot:string;disabled:boolean;onResume:(file:InvoiceArchive)=>void}){
 const full=page.totals.files>=page.limits.files||page.totals.bytes>=page.limits.bytes;
 return <><p>At last refresh: {page.totals.files} files · {(page.totals.bytes/1048576).toFixed(2)} MiB of {(page.limits.bytes/1048576).toFixed(0)} MiB. {page.totals.matched} match this search. Refresh to include newly archived files.</p>{full&&<p className="food-warning">Archive capacity reached. Existing files remain available; an administrator needs to review storage capacity.</p>}{!page.files.length&&<p>No archived CSVs match this view.</p>}{page.files.map(file=><article className="food-card" key={file.sha256}><h4>{file.fileName}</h4><p>{file.rowCount} source lines · {file.byteLength.toLocaleString()} bytes · Archived {file.createdAt} (UTC).</p><button type="button" disabled={disabled} onClick={()=>onResume(file)}>Open for invoice review</button> <a href={archiveUrl(apiRoot,page.locationId,page.dataset,file.sha256,true)}>Download original CSV</a></article>)}</>;
}
