'use client';
import {useEffect,useState} from 'react';
import type {Workspace} from '../shared/types';
import type {ToastDayFeed} from '../shared/toast-day';
import {displayTime,localDate,nextDate} from '../shared/local-time';
type Day={locationId:string;businessDate:string;connection:string;orders:ToastDayFeed;labor:ToastDayFeed;error?:string};
function feedStatus(feed:ToastDayFeed){
 if(feed.state==='unavailable')return 'No verified saved import is available.';
 const notices:string[]=[];
 if(feed.freshness==='stale')notices.push('Saved snapshot is stale; this is not a current operating total.');
 if(feed.freshness==='unknown')notices.push('Snapshot freshness is unconfirmed.');
 if(feed.state==='incomplete')notices.push('This business day is not fully reconciled.');
 if(!feed.paginationComplete)notices.push('Not all pages have been confirmed.');
 if(!feed.correctionsApplied)notices.push('Late corrections have not been confirmed.');
 if(!feed.dayClosed)notices.push('Final day close has not been confirmed.');
 if(!notices.length)notices.push(feed.state==='empty'?'Verified saved import has no records.':'Saved import is current and complete within the stated snapshot window.');
 return notices.join(' ');
}
function validFeed(value:unknown):value is ToastDayFeed{
 if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>,count=(n:unknown)=>n===null||Number.isSafeInteger(n)&&Number(n)>=0,time=(t:unknown)=>t===null||typeof t==='string'&&Number.isFinite(Date.parse(t));
 if(!['unavailable','incomplete','empty','available'].includes(String(v.state))||!['unknown','current','stale'].includes(String(v.freshness))||!count(v.recordCount)||!count(v.importedRecordCount)||!time(v.checkedAt)||!time(v.dataThrough)||!['paginationComplete','correctionsApplied','dayClosed'].every(key=>typeof v[key]==='boolean'))return false;
 if(v.state==='unavailable')return v.freshness==='unknown'&&v.recordCount===null&&v.importedRecordCount===null&&v.checkedAt===null&&v.dataThrough===null&&!v.paginationComplete&&!v.correctionsApplied&&!v.dayClosed;
 if(v.importedRecordCount===null||v.checkedAt===null||v.dataThrough===null||v.freshness==='unknown'||Date.parse(String(v.dataThrough))>Date.parse(String(v.checkedAt)))return false;
 const complete=v.paginationComplete&&v.correctionsApplied&&v.dayClosed;
 return v.state===(complete?(v.importedRecordCount===0?'empty':'available'):'incomplete')&&v.recordCount===(complete&&v.freshness==='current'?v.importedRecordCount:null);
}
export function ToastDayPanel({w,apiRoot='/api'}:{w:Workspace;apiRoot?:string}){
 const [date,setDate]=useState(()=>nextDate(localDate(new Date().toISOString(),w.location.timezone),-1));
 const [day,setDay]=useState<Day|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[busy,setBusy]=useState(false);
 const currentDay=day?.locationId===w.location.id&&day.businessDate===date?day:null;
 useEffect(()=>{const abort=new AbortController();setDay(null);setError('');setBusy(true);
  void fetch(apiRoot+'/integrations/toast-day?'+new URLSearchParams({locationId:w.location.id,businessDate:date}),{signal:abort.signal,cache:'no-store',credentials:'same-origin'}).then(async response=>{
   const raw:unknown=await response.json();
   const result=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
   if(!response.ok)throw Error(typeof result.error==='string'?result.error:'Saved Toast data is unavailable.');
   if(result.locationId!==w.location.id||result.businessDate!==date||!['connected','not-connected'].includes(String(result.connection))||!validFeed(result.orders)||!validFeed(result.labor))throw Error('The saved import response did not match this restaurant and date.');
   if(!abort.signal.aborted)setDay(result as unknown as Day);
  }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Saved Toast data is unavailable.');}).finally(()=>{if(!abort.signal.aborted)setBusy(false)});
  return()=>abort.abort();
 },[w.location.id,apiRoot,date,reload]);
 return <section aria-busy={busy}><h2>Toast sales and labor imports</h2>
  <p>{w.location.name} · saved business-day snapshots</p>
  <label className="shared-field">Business date<input type="date" value={date} max={localDate(new Date().toISOString(),w.location.timezone)} onChange={e=>{if(e.target.value)setDate(e.target.value)}}/></label>
  <button disabled={busy} onClick={()=>setReload(v=>v+1)}>Reload saved imports</button>
  {error&&<p role="alert" className="shared-error">{error}</p>}
  {busy&&<p>Reading saved imports…</p>}
  {currentDay?.connection==='not-connected'&&<p>The app server still needs its shared data connection. Imports may already exist in Supabase.</p>}
  {currentDay?.connection==='connected'&&<><dl>{([['Orders',currentDay.orders],['Labor time entries',currentDay.labor]] as const).map(([label,feed])=><div key={label}><dt>{label}</dt><dd>{feed.importedRecordCount===null?'No saved import':`${feed.importedRecordCount} imported records`}{feed.checkedAt&&` · imported ${displayTime(feed.checkedAt,w.location.timezone)}`}<p role="status">{feedStatus(feed)}</p>{feed.dataThrough&&<p className="shared-muted">Data through {displayTime(feed.dataThrough,w.location.timezone)}</p>}</dd></div>)}</dl>
   <p className="shared-muted">These are import counts, not sales dollars, payroll totals, or final closed-day reports. Late corrections and final day reconciliation remain separate. Reload reads the latest successful snapshot; it does not add repeated pulls together.</p></>}
 </section>;
}
