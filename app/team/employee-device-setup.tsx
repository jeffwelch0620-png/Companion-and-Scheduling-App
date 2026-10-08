'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccessAccount} from '../shared/access-types';
import {displayTime} from '../shared/local-time';
type SignInStatus={active:boolean;claimed:boolean;revision:number;firstSignedInAt:string|null;lastSignedInAt:string|null;codeIssuedAt:string|null;codeExpiresAt:string|null;codeUsedAt:string|null};
type IssuedCode={code:string;issuedAt:string;expiresAt:string};

export function EmployeeDeviceSetup({account,actorId,onChanged,timezone}:{account:AccessAccount;actorId:string;onChanged:()=>Promise<void>;timezone:string}){
 const administrator=account.capabilities.includes('location.manage'),canIssue=!administrator||account.id===actorId;
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[issued,setIssued]=useState<IssuedCode|null>(null),[status,setStatus]=useState<SignInStatus|null>(null),[statusError,setStatusError]=useState(''),[copied,setCopied]=useState(''),[now,setNow]=useState(0),[loginUrl,setLoginUrl]=useState(''),[confirmRevoke,setConfirmRevoke]=useState(false);
 const busyRef=useRef(false),alive=useRef(true),checkSerial=useRef(0);
 const check=useCallback(async(signal?:AbortSignal)=>{
   const serial=++checkSerial.current;
   try{const r=await fetch('/api/employee-login?locationId='+encodeURIComponent(account.locationId)+'&memberId='+encodeURIComponent(account.id),{cache:'no-store',credentials:'same-origin',signal});const data=await r.json() as SignInStatus&{error?:string};if(!r.ok)throw Error(data.error??'Could not check sign-in.');if(!signal?.aborted&&alive.current&&serial===checkSerial.current){setStatus(data);setStatusError('');setNow(Date.now());setLoginUrl(window.location.origin+'/login');}}
   catch(e){if(!signal?.aborted&&alive.current&&serial===checkSerial.current)setStatusError(e instanceof Error?e.message:'Could not check sign-in.');}
 },[account.id,account.locationId]);
 // check updates state only after the asynchronous status request settles.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{alive.current=true;const controller=new AbortController();void check(controller.signal);return()=>{alive.current=false;controller.abort()}},[check]);
 const expired=!!issued&&Date.parse(issued.expiresAt)<=now;
 const used=!!issued&&status?.codeIssuedAt===issued.issuedAt&&!!status.codeUsedAt;
 const replaced=!!issued&&!!status&&status.codeIssuedAt!==issued.issuedAt;
 const firstClaim=used&&!account.claimed&&status?.revision===account.revision+1;
 const accessChanged=!!status&&(!status.active||status.revision!==account.revision&&!firstClaim);
 const waiting=!!issued&&!expired&&!used&&!replaced&&!accessChanged;
 useEffect(()=>{if(!waiting)return;const controller=new AbortController();let running=false;const timer=window.setInterval(()=>{setNow(Date.now());if(document.visibilityState==='visible'&&!running&&!busyRef.current){running=true;void check(controller.signal).finally(()=>{running=false})}},5000);return()=>{controller.abort();window.clearInterval(timer)}},[waiting,check]);
 async function run(action:'issue'|'revoke'){
   if(busyRef.current)return;busyRef.current=true;checkSerial.current++;setBusy(true);setError('');setCopied('');setIssued(null);
   try{const r=await fetch('/api/employee-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,memberId:account.id,locationId:account.locationId,expectedRevision:firstClaim?status!.revision:account.revision})});const data=await r.json() as IssuedCode&{error?:string};if(!r.ok)throw Error(data.error??'Could not update phone sign-in.');if(!alive.current)return;if(action==='issue'){setLoginUrl(window.location.origin+'/login');setStatus(null);setIssued(data);setNow(Date.now());await check()}else{setConfirmRevoke(false);await onChanged()}}
   catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not confirm phone sign-in. Refresh status before trying again.')}finally{busyRef.current=false;if(alive.current)setBusy(false)}
 }
 async function copy(value:string,label:string){try{await navigator.clipboard.writeText(value);setCopied(label+' copied.')}catch{setCopied('Select the '+label.toLowerCase()+' below to copy it.')}}
 return <section className="shared-card onboarding-signin" aria-label="Employee phone sign-in">
   <h3>{status?.claimed||account.claimed?'Help employee sign in':'Finish phone setup'}</h3>
   <p role="status">{used?'Signed in successfully · '+displayTime(status!.codeUsedAt!,timezone):waiting?'Waiting for the employee to enter this code…':status?.lastSignedInAt?'Last signed in '+displayTime(status.lastSignedInAt,timezone):status?.claimed||account.claimed?'This employee has signed in before.':'Awaiting first sign-in'}</p>
   {statusError&&<p role="alert">{statusError} <button disabled={busy} onClick={()=>void check()}>Check sign-in again</button></p>}
   {accessChanged?<p role="alert">This employee&apos;s access changed. Use Refresh status before issuing another code.</p>:canIssue?<><p>{administrator?'Create a code for your own other phone.':'Give the code directly to '+account.name+' for their own phone.'}</p><button className="shared-primary" disabled={busy} onClick={()=>void run('issue')}>{busy?'Working…':issued?'Create a replacement code':'Create sign-in code'}</button>{issued&&<p>Replacing a code makes the previous unused code stop working.</p>}</>:<p>{account.name} creates their own phone codes while signed in. If they have lost access, ask them to use <a href="/login" target="_blank" rel="noreferrer">Owner sign-in</a>, then review their recovery request.</p>}
   {issued&&!accessChanged&&<div className="onboarding-code-panel">{used?<p>The single-use code has been used. Their account and history stay together.</p>:expired?<p role="status">This code expired. Create a replacement code for the same employee.</p>:replaced?<p role="status">This code was replaced or revoked. Refresh status before continuing.</p>:<><p className="employee-setup-code" aria-label="Single-use sign-in code">{issued.code}</p><p>Expires {displayTime(issued.expiresAt,timezone)} · works once</p><button disabled={busy} onClick={()=>void copy(issued.code,'Code')}>Copy code</button></>}
   <label className="shared-field">Employee sign-in link<input readOnly value={loginUrl} onFocus={e=>e.currentTarget.select()}/></label><button onClick={()=>void copy(loginUrl,'Link')}>Copy link</button>
   <ol><li>Open this link on the employee&apos;s phone.</li><li>Enter the code and tap Continue.</li><li>Check their name and restaurant, then tap “That&apos;s me — open JMAX.”</li></ol><p>No ChatGPT account, Toast password, or POS code is needed.</p></div>}
   {copied&&<p role="status">{copied}</p>}{error&&<p className="shared-error" role="alert">{error}</p>}
   <details onToggle={e=>{if(!e.currentTarget.open)setConfirmRevoke(false)}}><summary>Lost or shared phone</summary><p>Sign out this employee&apos;s setup-code devices. Their schedule and history stay saved.{administrator?' Their separate owner sign-in remains available.':' They will need a new code to sign back in.'}</p>{confirmRevoke?<div className="shared-actions"><button disabled={busy} onClick={()=>void run('revoke')}>Confirm sign out of devices</button><button disabled={busy} onClick={()=>setConfirmRevoke(false)}>Cancel</button></div>:<button disabled={busy||accessChanged} onClick={()=>setConfirmRevoke(true)}>Sign out setup-code devices…</button>}</details>
 </section>;
}
