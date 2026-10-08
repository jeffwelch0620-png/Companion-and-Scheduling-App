'use client';
import {useState,useSyncExternalStore} from 'react';
import type {Workspace,WorkRecord} from '../shared/types';
import {employeeWelcome} from '../shared/onboarding';
import {displayTime} from '../shared/local-time';

const subscribeLocation=(notify:()=>void)=>{window.addEventListener('popstate',notify);return()=>window.removeEventListener('popstate',notify)};
const welcomeRequested=()=>new URLSearchParams(window.location.search).get('welcome')==='1';

export function EmployeeWelcome({w,onNavigate,onOpen}:{w:Workspace;onNavigate:(tab:string)=>void;onOpen:(record:WorkRecord)=>void}){
 const [dismissed,setDismissed]=useState(false);
 const open=useSyncExternalStore(subscribeLocation,welcomeRequested,()=>false)&&!dismissed;
 const close=()=>{setDismissed(true);const url=new URL(window.location.href);url.searchParams.delete('welcome');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)};
 const go=(tab:string)=>{close();onNavigate(tab)};
 const {nextShift,goals,guides,managers}=employeeWelcome(w),dish=w.me.position==='Dishwasher';
 if(!open)return null;
 return <section className="employee-welcome" aria-label="Welcome to your employee account">
   <div className="shared-heading"><div><p className="shared-kicker">You&apos;re signed in</p><h1>Welcome, {w.me.name}</h1></div><button onClick={close}>Continue to JMAX</button></div>
   <p>{w.location.name} · {w.me.position}</p>
   <div className="onboarding-welcome-grid"><article><h2>Your next shift</h2>{nextShift?<><strong>{displayTime(nextShift.data.start,w.location.timezone)}</strong><p>{nextShift.data.position} · until {displayTime(nextShift.data.end,w.location.timezone)}</p><button onClick={()=>{close();onOpen(nextShift)}}>View my shift</button></>:<><p>No upcoming published shift is saved for you yet.</p><button onClick={()=>go('Schedule week')}>Open my schedule</button></>}</article>
   {!dish&&<article><h2>Your learning</h2>{goals.length?<><p>{goals.length} learning {goals.length===1?'goal':'goals'} to review.</p><button onClick={()=>go('Training')}>Open my learning</button></>:<p>No learning goal has been assigned yet. Ask your manager what to start with.</p>}{guides.length?<><p>{guides.length} approved station {guides.length===1?'guide is':'guides are'} available.</p><button onClick={()=>go('Training')}>Browse training</button></>:<p>Your approved station guides still need to be added.</p>}</article>}</div>
   <p>{managers.length?'Your learning reviewer'+(managers.length>1?'s: ':': ')+managers.map(m=>m.name).join(', ')+'.':'Need help getting started? Ask the manager who gave you your setup code.'}</p>
   <button onClick={()=>go('Inbox')}>Open my inbox</button>
   <details><summary>Put JMAX on your phone&apos;s home screen</summary><p>Open JMAX in your phone&apos;s browser first.</p><p><strong>iPhone:</strong> in Safari, open Share, choose Add to Home Screen, then Add.</p><p><strong>Android:</strong> open your browser menu, choose Add to Home screen or Install app, and follow the prompts.</p><p>If the shortcut asks you to sign in again, ask your manager for a new code. Your employee account and history stay the same.</p></details>
 </section>;
}
