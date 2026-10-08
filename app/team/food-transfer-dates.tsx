'use client';
import {useState} from 'react';
import {localDate} from '../shared/local-time';
import {transferWindow,type TransferWindow} from '../shared/food-transfer-window';
export type TransferDates=Pick<TransferWindow,'from'|'through'>;
export function TransferDateFilter({applied,zone,onApply}:{applied:TransferDates;zone:string;onApply:(value:TransferDates)=>void}){
 const [from,setFrom]=useState(applied.from),[through,setThrough]=useState(applied.through),[error,setError]=useState('');
 const changed=from!==applied.from||through!==applied.through;
 const apply=(dates:TransferDates)=>{try{transferWindow(dates.from,dates.through,zone);setError('');setFrom(dates.from);setThrough(dates.through);onApply(dates)}catch(e){setError(e instanceof Error?e.message:'Check the dispatch dates.')}};
 return <form aria-label="Filter dispatch dates" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);apply({from:String(data.get('from')??''),through:String(data.get('through')??'')})}}>
  <p>Dispatch dates use {zone}. These dates refer to the original dispatch, not later parcel arrivals or delivery checks.</p>
  <div className="food-controls"><label className="shared-field">Dispatch start date<input type="date" name="from" value={from} onInput={e=>setFrom(e.currentTarget.value)} onChange={e=>setFrom(e.target.value)}/></label><label className="shared-field">Dispatch end date<input type="date" name="through" value={through} onInput={e=>setThrough(e.currentTarget.value)} onChange={e=>setThrough(e.target.value)}/></label></div>
  <div className="shared-actions"><button>Apply dispatch dates</button><button type="button" onClick={()=>{const today=localDate(new Date().toISOString(),zone);apply({from:today,through:today})}}>Dispatched today</button><button type="button" onClick={()=>apply({from:'',through:''})}>All dispatch dates</button></div>
  {changed&&<p role="status">Dates changed. Apply them to update the transfer list and counts.</p>}{error&&<p role="alert" className="food-warning">{error}</p>}
 </form>;
}
export function TransferWindowNote({window}:{window:TransferWindow}){return <p>Applied dispatch dates: {window.from?`${window.from} through ${window.through}`:'all dates'} · {window.timezone}.{window.from&&' Both selected dates are included.'} Review counts cover these dates and the applied search, across all pages and statuses.</p>}
