'use client';
import {useEffect,useRef,useState} from 'react';
import type {Workspace} from '../shared/types';
import type {WasteReport} from '../shared/food-waste-report';
import {wasteExportCsv,type WasteExport} from '../shared/food-waste-export';

export function WasteExportButton({w,apiRoot,dataset,page}:{w:Workspace;apiRoot:string;dataset:'demo'|'operating';page:WasteReport}){
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[copied,setCopied]=useState(false),[file,setFile]=useState<{url:string;name:string;csv:string}|null>(null),request=useRef<AbortController|null>(null),blob=useRef<string|null>(null);
 useEffect(()=>()=>{request.current?.abort();if(blob.current)URL.revokeObjectURL(blob.current)},[]);
 async function download(){request.current?.abort();if(blob.current)URL.revokeObjectURL(blob.current);blob.current=null;setFile(null);setCopied(false);const ctrl=new AbortController();request.current=ctrl;setLoading(true);setError('');setSaved('');try{
  const response=await fetch(apiRoot+'/food?'+new URLSearchParams({locationId:w.location.id,dataset,view:'waste-export',from:page.from,through:page.through,revision:String(page.revision)}),{signal:ctrl.signal}),data=await response.json() as WasteExport&{error?:string};if(ctrl.signal.aborted)return;
  if(!response.ok)throw Error(data.error??'Waste export could not be loaded.');
  if(data.kind!=='waste-export'||data.locationId!==w.location.id||data.dataset!==dataset||data.from!==page.from||data.through!==page.through||data.revision!==page.revision||!Array.isArray(data.entries))throw Error('Waste export scope could not be verified. Refresh the report.');
  const csv=wasteExportCsv(data),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));blob.current=url;setFile({url,csv,name:'JMAX-'+dataset+'-waste-'+page.from+'-to-'+page.through+'.csv'});setSaved('CSV ready for '+data.totals.entries+' entries across '+data.from+' through '+data.through+'. Includes a report row and all entry rows. Snapshot checked '+data.generatedAt+'.');
 }catch(e){if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Waste export could not be loaded.');}finally{if(!ctrl.signal.aborted)setLoading(false)}}
 async function copy(){if(!file)return;setCopied(false);setError('');try{await navigator.clipboard.writeText(file.csv);setCopied(true)}catch{setError('Copy was not available. Use the Save CSV link in a browser that supports downloads.')}}
 return <div><button type="button" disabled={loading} onClick={()=>void download()}>{loading?'Preparing waste CSV…':'Prepare waste CSV for applied dates'}</button><p className="shared-muted">Full selected range, including voids and missing-cost explanations, up to 500 entries. Narrow the dates for larger reports. Estimates are not booked expenses.</p>{error&&<p role="alert">{error}</p>}{saved&&<p role="status">{saved}</p>}{file&&<div className="shared-actions"><a href={file.url} download={file.name}>Save waste CSV snapshot</a><button type="button" onClick={()=>void copy()}>Copy waste CSV</button></div>}{copied&&<p role="status">Waste CSV copied.</p>}</div>;
}
