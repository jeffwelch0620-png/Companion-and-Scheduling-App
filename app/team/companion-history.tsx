'use client';
import { useEffect, useRef, useState } from 'react';
import type { ArchivedChat, ChatHistoryPage, ChatView } from '../shared/companion-chat-types';
import type { Workspace, WorkRecord } from '../shared/types';
import { CompanionTurns } from './companion-turns';

export function CompanionHistory({w,endpoint,view,onOpen,onDelete,disabled}:{w:Workspace;endpoint:string;view:ChatView;onOpen:(r:WorkRecord)=>void;onDelete:(id:string)=>Promise<void>;disabled:boolean}){
  const [page,setPage]=useState<ChatHistoryPage|null>(null),[selected,setSelected]=useState<ArchivedChat|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[confirm,setConfirm]=useState(false);
  const serial=useRef(0),request=useRef<AbortController|null>(null);
  useEffect(()=>()=>{serial.current++;request.current?.abort()},[]);
  async function load(params:Record<string,string>={history:'1'}){
    const token=++serial.current,controller=new AbortController();request.current?.abort();request.current=controller;setLoading(true);setError('');setConfirm(false);setSelected(null);
    try{
      const response=await fetch(endpoint+'?'+new URLSearchParams({locationId:w.location.id,...params}),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      const data=await response.json() as (ChatHistoryPage|ArchivedChat)&{error?:string};if(token!==serial.current)return;
      if(!response.ok){setPage(null);throw Error(typeof data.error==='string'?data.error:'Could not open your saved conversations.');}
      if(params.archived)setSelected(data as ArchivedChat);else setPage(data as ChatHistoryPage);
    }catch(e){if(token===serial.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not open your saved conversations.');}
    finally{if(token===serial.current)setLoading(false);}
  }
  useEffect(()=>{let mounted=true;queueMicrotask(()=>{if(mounted)void load()});return()=>{mounted=false};
    // Account, restaurant and workspace revisions remount this component in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const local=(at:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:w.location.timezone}).format(new Date(at));
  return <section className="jmax-chat-history" aria-label="Private conversation history">
    <p>These conversations belong to your account in this restaurant. JMAX can select useful excerpts to help answer a new question; opening a new conversation does not reset that memory. Current assignments and approved instructions are checked again, and conversations from before an account-access change are excluded from recall.</p>
    <div className="shared-actions"><button disabled={loading||disabled} onClick={()=>void load()}>Newest conversations</button>{page?.nextCursor&&!selected&&<button disabled={loading||disabled} onClick={()=>void load({history:'1',cursor:page.nextCursor!})}>Older conversations</button>}</div>
    {loading&&<p role="status">Opening saved history…</p>}{error&&<p role="alert" className="shared-error">{error}</p>}
    {!loading&&!selected&&page&&<div className="shared-list">{!page.conversations.length&&<p>No earlier conversations yet. Choose New conversation, keep memory to start another discussion and save this one.</p>}{page.conversations.map(c=><button key={c.id} disabled={disabled} onClick={()=>void load({archived:c.id})}><span><strong>{c.title}</strong><small>{local(c.archivedAt)} · {c.turnCount} {c.turnCount===1?'question':'questions'}{c.accessChanged?' · earlier access':''}</small></span><span>Open</span></button>)}</div>}
    {!loading&&selected&&<div><h3>{selected.title}</h3><p className="shared-muted">Saved {local(selected.archivedAt)} · Read only</p>{selected.accessChanged?<p>Your role or access changed after this conversation. Its content is no longer available under your current permissions.</p>:<CompanionTurns turns={selected.turns} w={w} onOpen={onOpen}/>}
      <details onToggle={e=>{if(!e.currentTarget.open)setConfirm(false)}}><summary>Delete this saved conversation</summary><p>This permanently removes this conversation from the app and excludes it from future recall. It cannot be recovered here. Your current conversation, other history, explanation preference and shared work stay in place.</p>{confirm?<div className="shared-actions"><button disabled={disabled||view.pending} onClick={()=>void onDelete(selected.id)}>Confirm: permanently delete this conversation</button><button disabled={disabled} onClick={()=>setConfirm(false)}>Cancel</button></div>:<button disabled={disabled||view.pending} onClick={()=>setConfirm(true)}>Delete saved conversation…</button>}</details>
    </div>}
  </section>;
}
