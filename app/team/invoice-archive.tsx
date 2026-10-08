'use client';
import {useEffect,useRef,useState} from 'react';
import {InvoiceColumnMapHistory} from './invoice-column-map';
import type {InvoiceArchive} from '../shared/invoice-archive';
import type {InvoiceFileSource} from '../shared/food-invoice-csv';
export function archiveUrl(apiRoot:string,locationId:string,dataset:string,sha256:string,download=false){return `${apiRoot}/food/invoice-files?${new URLSearchParams({locationId,dataset,sha256,...(download?{download:'1'}:{})})}`;}
async function result(response:Response,locationId:string,dataset:string,sha256:string){
 const value=await response.json() as {locationId?:string;dataset?:string;file?:InvoiceArchive;error?:string};if(!response.ok)throw Error(value.error||'Original CSV is unavailable.');
 if(value.locationId!==locationId||value.dataset!==dataset||value.file?.sha256!==sha256||typeof value.file.fileName!=='string'||!Number.isSafeInteger(value.file.byteLength))throw Error('Unexpected source response. Reopen this review.');
 return value.file as InvoiceArchive;
}
export function InvoiceArchiveSave({apiRoot,locationId,dataset,csv,file,disabled,archived,onSaved}:{apiRoot:string;locationId:string;dataset:string;csv:string;file:Omit<InvoiceFileSource,'row'>;disabled:boolean;archived?:InvoiceArchive;onSaved?:(file:InvoiceArchive)=>void}){
 const [confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[saved,setSaved]=useState<InvoiceArchive|undefined>(archived),[error,setError]=useState('');
 const alive=useRef(true),inFlight=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 return <section aria-label="Original CSV storage"><p>Archive the original CSV in this restaurant’s {dataset==='demo'?'demo / training':'operating'} records. This stores the entire file; it does not record its invoice lines. Repeating the same file keeps one original copy.</p>
 {saved?<p role="status">Original CSV archived as {saved.fileName}. <a href={archiveUrl(apiRoot,locationId,dataset,saved.sha256,true)}>Download archived CSV</a></p>:<><label className="food-check"><input type="checkbox" disabled={disabled||saving} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that the entire file belongs to this restaurant and selected records.</label><button type="button" disabled={disabled||saving||!confirmed} onClick={async()=>{
  if(inFlight.current)return;inFlight.current=true;setSaving(true);setError('');
  try{const response=await fetch(`${apiRoot}/food/invoice-files`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId,dataset,csv,fileName:file.fileName,byteLength:file.byteLength,sha256:file.sha256,confirmed,layout:file.layout})}),value=await result(response,locationId,dataset,file.sha256);if(value.byteLength!==file.byteLength)throw Error('Archived size differs from this file.');if(alive.current){setSaved(value);onSaved?.(value)}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Archive not confirmed. Retry the same file.')}finally{inFlight.current=false;if(alive.current)setSaving(false)}
 }}>Archive original CSV</button></>}{saving&&<p role="status">Saving original CSV…</p>}{error&&<p role="alert">{error}</p>}</section>;
}
export function InvoiceArchiveDownload({apiRoot,locationId,dataset,source}:{apiRoot:string;locationId:string;dataset:string;source:InvoiceFileSource}){
 const [file,setFile]=useState<InvoiceArchive>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);const abort=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>abort.current?.abort(),[]);
 return <div>{source.layout&&<InvoiceColumnMapHistory layout={source.layout}/>} {file?<p>Matching original CSV is archived as {file.fileName}. <a href={archiveUrl(apiRoot,locationId,dataset,source.sha256,true)}>Download archived CSV</a></p>:<button type="button" disabled={loading} onClick={async()=>{
  abort.current?.abort();const request=new AbortController();abort.current=request;setLoading(true);setError('');
  try{const response=await fetch(archiveUrl(apiRoot,locationId,dataset,source.sha256),{signal:request.signal}),value=await result(response,locationId,dataset,source.sha256);if(value.byteLength!==source.byteLength)throw Error('Archived size differs from this saved reference.');if(!request.signal.aborted)setFile(value)}catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:'Unable to check original CSV.')}finally{if(!request.signal.aborted)setLoading(false)}
 }}>Find archived original CSV</button>}{error&&<p role="alert">{error}</p>}</div>;
}
