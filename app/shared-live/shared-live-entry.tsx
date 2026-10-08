'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import ConnectedWorkspace from '../team/workspace';
import '../team/workspace.css';
import '../team/companion-flow.css';
import '../team/jmax-shell.css';
import './shared-live.css';

type Session={configured:boolean;signedIn:boolean;user?:{id:string;email:string};message?:string};
const sessionPath='/api/shared-store/session';
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
async function sessionStatus(signal?:AbortSignal):Promise<Session>{
 const response=await fetch(sessionPath,{credentials:'same-origin',cache:'no-store',signal});
 const value:unknown=await response.json();
 if(response.status===401)return {configured:true,signedIn:false,message:'Your shared sign-in has expired. Sign in again to continue.'};
 if(!response.ok)throw new Error(isObject(value)&&typeof value.error==='string'?value.error:'The shared connection could not be checked. Try again.');
 if(!isObject(value)||typeof value.configured!=='boolean'||typeof value.signedIn!=='boolean')throw new Error('The shared connection returned an unexpected response. Try again.');
 return value as Session;
}
async function changeSession(input:{action:'sign-in';email:string;password:string}|{action:'sign-out'}){
 const response=await fetch(sessionPath,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const value:unknown=await response.json();
 if(!response.ok)throw new Error(isObject(value)&&typeof value.error==='string'?value.error:'Sign-in could not be completed. Try again.');
 if(!isObject(value)||typeof value.signedIn!=='boolean')throw new Error('The sign-in response could not be verified. Check the connection before continuing.');
 return value;
}

export default function SharedLiveEntry(){
 const [epoch,setEpoch]=useState(0),[result,setResult]=useState<{epoch:number;session:Session|null;error:string}|null>(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const busyRef=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();
  void sessionStatus(controller.signal).then(session=>{if(!controller.signal.aborted)setResult({epoch,session,error:''})}).catch(value=>{if(!controller.signal.aborted)setResult({epoch,session:null,error:value instanceof Error?value.message:'The shared connection could not be checked.'})});
  return()=>controller.abort();
 },[epoch]);
 const session=result?.epoch===epoch?result.session:null,checking=result?.epoch!==epoch;
 const signOut=useCallback(async()=>{
  if(busyRef.current)throw new Error('Sign-in is already changing. Wait for it to finish.');
  busyRef.current=true;setBusy(true);setError('');
  try{const value=await changeSession({action:'sign-out'});if(value.signedIn)throw new Error('Sign-out was not confirmed. Try again.');setPassword('');setResult({epoch,session:{configured:true,signedIn:false},error:''})}
  finally{busyRef.current=false;setBusy(false)}
 },[epoch]);
 const signIn=async()=>{
  if(busyRef.current||!session?.configured)return;
  busyRef.current=true;setBusy(true);setError('');
  try{
   const value=await changeSession({action:'sign-in',email:email.trim(),password});
   if(!value.signedIn)throw new Error('The account did not finish signing in. Try again.');
   const verified=await sessionStatus();
   if(!verified.signedIn)throw new Error('This browser did not retain the sign-in. Allow cookies for this app and try again.');
   setPassword('');setResult({epoch,session:verified,error:''});
  }catch(value){setError(value instanceof Error?value.message:'Sign-in could not be completed. Try again.')}
  finally{busyRef.current=false;setBusy(false)}
 };
 if(session?.configured&&session.signedIn)return <ConnectedWorkspace signInPath="/shared-live" apiRoot="/api/shared-store" sharedStore={{onSignOut:signOut}}/>;
 return <div className="shared-ui shared-flow jmax-combined shared-live-entry"><div className="shared-shell">
  <header><a className="shared-brand" href="/shared-live"><b>J</b><span className="jmax-wordmark">JMAX<small>OPERATIONS</small></span></a><div className="jmax-header-context"><strong>Shared Manager Log</strong><span>Sign in to your restaurant</span></div></header>
  <main><section className="shared-live-card" aria-labelledby="shared-live-title"><p className="jmax-eyebrow">JMAX · Shared workspace</p><h1 id="shared-live-title">Keep the next person informed.</h1><p className="shared-live-intro">Sign in to record a manager issue, leave an update, and see the saved history from another device.</p>
   <div className="shared-live-status" data-state={checking?'checking':session?.configured?'ready':'unavailable'} role="status">{checking?'Checking shared sign-in…':session?.configured?'Shared sign-in is available':result?.error?'Connection status unavailable':'Shared saving is not configured'}</div>
   {!checking&&session&&!session.configured&&<p className="shared-live-explanation">The shared connection needs to be configured before this log can open. Your existing JMAX workspace remains available below.</p>}
   {!checking&&session?.configured&&session.message&&<p className="shared-live-explanation">{session.message}</p>}
   <form onSubmit={event=>{event.preventDefault();void signIn()}}><fieldset disabled={busy||checking||!session?.configured}>
    <label className="shared-field">Account email<input type="email" name="email" autoComplete="username" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} placeholder="Your work account email"/></label>
    <label className="shared-field">Password<input type="password" name="password" autoComplete="current-password" required maxLength={4096} value={password} onChange={event=>setPassword(event.target.value)}/></label>
    <button className="shared-primary" type="submit" disabled={!email.trim()||!password}>{busy?'Signing in…':'Sign in to shared JMAX'}</button>
   </fieldset></form>
   {(error||result?.epoch===epoch&&result.error)&&<p className="shared-error" role="alert">{error||result?.error}</p>}
   <p className="shared-live-help">Use an existing account. Access to each restaurant must already be assigned to you.</p>
   <div className="shared-live-actions"><button disabled={busy||checking} onClick={()=>{setError('');setEpoch(value=>value+1)}}>Check connection</button><a href="/team">Open existing JMAX workspace</a></div>
   <div className="shared-live-scope"><strong>Available in this shared workspace</strong><p>New manager issues, saved notes and entry history. Refresh the log to see updates from other devices.</p></div>
  </section></main>
 </div></div>;
}
