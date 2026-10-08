'use client';
import { myWork } from '../shared/my-work';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Workspace, WorkRecord } from '../shared/types';
import type { ChatView, ChatSource, ExplanationStyle } from '../shared/companion-chat-types';
import { CompanionTurns } from './companion-turns';
import { CompanionHistory } from './companion-history';
import { scheduleWeekDate, scheduleWeekSource } from '../shared/workforce-planning';
import { canAskAbout, chatSource } from '../shared/companion-focus';

class ChatRequestError extends Error {constructor(public status:number,message:string){super(message);}}
async function readChatResponse(response:Response):Promise<ChatView>{
  let data:ChatView & {error?:string};
  try{data=await response.json();}catch{throw new ChatRequestError(response.status,'JMAX could not confirm the response. Reload the conversation to check for your saved answer.');}
  if(!response.ok)throw new ChatRequestError(response.status,typeof data?.error==='string'&&data.error.length<=600?data.error:'Could not confirm this conversation change. Reload the conversation.');
  if(!data||typeof data.conversationId!=='string'||!Array.isArray(data.turns)||typeof data.revision!=='number')throw new ChatRequestError(502,'JMAX could not read the conversation. Please reload it.');
  return data;
}

export function CompanionChat({w,apiRoot,onOpen,focus=null,onFocusChange,onSchedule,shiftMode=false,learningMode=false}:{shiftMode?:boolean;learningMode?:boolean;w:Workspace;apiRoot:string;onOpen:(r:WorkRecord)=>void;focus?:ChatSource|null;onFocusChange?:(focus:ChatSource|null)=>void;onSchedule?:(start:string)=>void}){
  const embedded=shiftMode||learningMode;
  const manager=w.me.capabilities.some(c=>['location.manage','schedule.manage','people.manage'].includes(c));
  const [view,setView]=useState<ChatView|null>(null),[question,setQuestion]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [styleDraft,setStyleDraft]=useState<ExplanationStyle|null>(null),[preferenceSaved,setPreferenceSaved]=useState(false),[busyAction,setBusyAction]=useState<'ask'|'clear'|'preferences'|'start-new'|'delete-history'|null>(null),[historyOpen,setHistoryOpen]=useState(false),[confirmClear,setConfirmClear]=useState(false);
  const alive=useRef(true),request=useRef<AbortController|null>(null),serial=useRef(0),busyRef=useRef(false),composer=useRef<HTMLTextAreaElement|null>(null);
  const postRequest=useRef<AbortController|null>(null),askAttempt=useRef<{requestId:string;conversationId:string;question:string;focusKey:string}|null>(null);
  const [uncertain,setUncertain]=useState(false);
  const log=useRef<HTMLDivElement|null>(null),follow=useRef(true);
  const endpoint=apiRoot+'/companion';
  const focusedRecord=focus?w.records.find(r=>r.id===focus.id&&canAskAbout(r)):undefined;
  const focusedWeek=focus?.kind==='schedule-week'?scheduleWeekDate(focus.id):null;
  const focusChanged=!!focus&&(focusedWeek?w.location.revision+1:focusedRecord?.revision)!==focus.revision;
  const focusedStarters=focusedWeek?(manager?['Where is coverage weak, and what should I change?','Who could train together this week?']:['What are my published shifts this week?','What training is planned for me?']):focus?.kind==='close'?['Walk me through this close.','Who has the next required check?']:focus?.kind==='task'?['What must be true when this work is done?','Who has the next step for this work?']:['Walk me through this.','What should I learn next?'];
  const acceptView=useCallback((data:ChatView)=>{
    setView(data);setUncertain(false);
    const attempt=askAttempt.current;
    if(!attempt)return;
    if(data.accessChanged||data.conversationId!==attempt.conversationId){askAttempt.current=null;return;}
    const saved=data.turns.find(turn=>turn.id===attempt.requestId);
    if(saved?.status==='complete'){
      setQuestion(current=>current.trim()===attempt.question?'':current);setError('');askAttempt.current=null;
    }else if(saved?.status==='failed'){
      // A confirmed failure may be asked again with a new id and fresh context.
      // An ambiguous transport failure retains its original id instead.
      setError('');askAttempt.current=null;
    }else if(saved?.status==='pending')setError('');
  },[]);
  const load=useCallback(async()=>{
    const token=++serial.current,controller=new AbortController();request.current?.abort();request.current=controller;
    try{
      const response=await fetch(`${endpoint}?locationId=${encodeURIComponent(w.location.id)}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const data=await readChatResponse(response);
      if(!alive.current||token!==serial.current)return;
      acceptView(data);
    }catch(e){if(alive.current&&token===serial.current&&!controller.signal.aborted){if(e instanceof ChatRequestError&&[401,403].includes(e.status)){setView(null);askAttempt.current=null;setUncertain(false);}setError(e instanceof ChatRequestError?e.message:'Could not reload your conversation. Check your connection and try Reload conversation.');}}
    finally{if(alive.current&&token===serial.current)setLoading(false);}
  },[endpoint,w.location.id,acceptView]);
  useEffect(()=>{alive.current=true;const invalidate=()=>{serial.current++;request.current?.abort();postRequest.current?.abort();};queueMicrotask(()=>{if(alive.current)void load()});return()=>{alive.current=false;invalidate();}},[load]);
  useEffect(()=>{
    if(!view?.pending||busy)return;
    let stopped=false;
    const poll=async()=>{await load();if(!stopped)timer=window.setTimeout(()=>{void poll()},2500)};
    let timer=window.setTimeout(()=>{void poll()},2500);
    return()=>{stopped=true;window.clearTimeout(timer)};
  },[view?.pending,busy,load]);
  useEffect(()=>{const refresh=()=>{if(!busyRef.current)void load()};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh)},[load]);
  useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent<string>).detail===w.location.id&&!busyRef.current)void load()};window.addEventListener('jmax-conversation-saved',refresh);return()=>window.removeEventListener('jmax-conversation-saved',refresh)},[load,w.location.id]);
  useEffect(()=>{if(follow.current&&log.current)log.current.scrollTop=log.current.scrollHeight},[view]);
  useEffect(()=>{if(focus&&!loading&&!view?.accessChanged){composer.current?.scrollIntoView({block:'center'});composer.current?.focus()}},[focus,loading,view?.accessChanged]);
  async function act(action:'ask'|'clear'|'preferences'|'start-new'|'delete-history',archivedId?:string){
    if(!view||busyRef.current||uncertain)return;
    const submitted=question.trim();if(action==='ask'&&(!submitted||focusChanged))return;
    if(action==='ask'){
      const focusKey=focus?`${focus.id}:${focus.revision}`:'',previous=askAttempt.current;
      if(!previous||previous.conversationId!==view.conversationId||previous.question!==submitted||previous.focusKey!==focusKey)askAttempt.current={requestId:crypto.randomUUID(),conversationId:view.conversationId,question:submitted,focusKey};
    }
    busyRef.current=true;if(action!=='preferences')follow.current=true;setBusy(true);setBusyAction(action);setError('');request.current?.abort();serial.current++;
    const controller=new AbortController();postRequest.current=controller;
    const deadline=window.setTimeout(()=>controller.abort(),55000);
    try{
      const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({action,locationId:w.location.id,conversationId:view.conversationId,expectedRevision:view.revision,...(action==='ask'?{requestId:askAttempt.current!.requestId,question:submitted,...(focus?{focus:{id:focus.id,revision:focus.revision}}:{})}:action==='preferences'?{explanationStyle:styleDraft??view.explanationStyle}:action==='start-new'?{}:{confirmed:true,...(archivedId?{archivedId}:{})})})});
      const data=await readChatResponse(response);if(!alive.current)return;
      acceptView(data);window.dispatchEvent(new CustomEvent('jmax-conversation-saved',{detail:w.location.id}));if(action==='clear')setConfirmClear(false);if(action==='preferences'){setStyleDraft(null);setPreferenceSaved(true);}
    }catch(e){if(alive.current){if(e instanceof ChatRequestError&&[401,403].includes(e.status))setView(null);setUncertain(action==='ask');setError(e instanceof ChatRequestError?e.message:'Could not confirm the answer. Reload the conversation to check for your saved answer.');await load();}}
    finally{window.clearTimeout(deadline);postRequest.current=null;busyRef.current=false;if(alive.current){setBusy(false);setBusyAction(null);}}
  }
  const unavailable=loading||!view||!view.configured||view.accessChanged||view.full||view.pending||busy||uncertain;
  const thinking=busyAction==='ask'||view?.pending;
  const preferenceUnavailable=loading||!view||view.accessChanged||view.pending||busy||uncertain;
  const visibleTurns=embedded?view?.turns.filter(t=>t.focus?.id===focus?.id)??[]:view?.turns??[];
  const dayWork=myWork(w,new Date().toISOString());
  return <section className="jmax-chat" aria-label="Conversation with JMAX">
    <div className="jmax-chat-heading"><div>{embedded?<h3>{learningMode?"Help with this practice":"Ask about this shift"}</h3>:<h1>JMAX</h1>}{!embedded&&<p>{dayWork.shift?(dayWork.current?'With you on ':'Next shift: ')+dayWork.station:'Your schedule and learning companion'}</p>}</div></div>
    {loading&&<p role="status">Opening your conversation…</p>}
    {view&&!view.configured&&<p className="shared-notice">Live chat has not been connected in this environment yet. Your saved work is available below.</p>}
    {view?.accessChanged&&<div className="shared-notice" role="status"><p>Your account was updated. Continue with your current access to ask JMAX again. Your previous conversation stays saved; earlier content remains protected by its original access.</p><button className="shared-primary" disabled={busy||loading} onClick={()=>{void act('start-new')}}>{busyAction==='start-new'?'Opening JMAX…':'Continue with JMAX'}</button></div>}
    <div ref={log} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80}} className="jmax-chat-turns" role="log" aria-label="JMAX conversation" aria-live="polite" aria-relevant="additions text">
      {view&&<CompanionTurns turns={visibleTurns} w={w} onOpen={onOpen} disabled={unavailable} onSchedule={onSchedule} onReuse={turn=>{setQuestion(turn.question);onFocusChange?.(turn.focus);composer.current?.focus();}}/>}
    </div>
    {view?.configured&&!focus&&!view.turns.length&&!view.accessChanged&&<div className="jmax-chat-starters">{(manager?['Where does this week need attention?','Who could train together?','What should I learn next?']:[dayWork.shift?'Help me prepare for my '+dayWork.station+' shift.':'When is my next shift?','What should I learn next?','How do I request time off?']).map(q=><button key={q} disabled={unavailable} onClick={()=>{setQuestion(q);composer.current?.focus();}}>{q}</button>)}</div>}
    {error&&<p className="shared-error" role="alert">{error}</p>}
    {view?.full&&<div><p>This conversation is full. Open a new conversation; JMAX can still use relevant saved history from your account in this restaurant.</p><button disabled={busy||loading||uncertain||view.pending} onClick={()=>{void act('start-new')}}>New conversation, keep memory</button></div>}
    {!embedded&&focus&&<details className="jmax-chat-focus" aria-label="Attached work" open={focusChanged}><summary>{focus.title}{focusChanged?' · Needs refresh':' · Attached'}</summary><div><span className="shared-kicker">Asking about · {focusedWeek?'Selected schedule week':focus.kind==='standard'?'Approved guide':focus.kind==='close'?'Closing assignment':'Saved work'}</span><strong>{focus.title}</strong><p>{focusChanged?'This item changed or is no longer available. Review the latest work before sending.':'This exact item will be included when you send your question.'}</p></div><div className="shared-actions">{focusedWeek&&<button disabled={busy||uncertain} onClick={()=>onSchedule?.(focusedWeek)}>Open selected week</button>}{focusChanged&&focusedWeek&&<button disabled={busy||uncertain} onClick={()=>onFocusChange?.(scheduleWeekSource(w,focusedWeek))}>Use latest version</button>}{focusedRecord&&<button disabled={busy||uncertain} onClick={()=>onOpen(focusedRecord)}>Open attached work</button>}{focusChanged&&focusedRecord&&<button disabled={busy||uncertain} onClick={()=>onFocusChange?.(chatSource(focusedRecord))}>Use latest version</button>}<button disabled={busy||uncertain} onClick={()=>onFocusChange?.(null)}>Remove attachment</button></div>{!focusChanged&&<div className="jmax-chat-starters">{focusedStarters.map(q=><button key={q} disabled={unavailable} onClick={()=>{setQuestion(q);composer.current?.focus()}}>{q}</button>)}</div>}</details>}
    {embedded&&!visibleTurns.length&&<p className="shared-muted">{learningMode?"Your question stays attached to this person’s practice and approved instructions.":"Ask about this person’s shift or its approved instructions."}</p>}
    {embedded&&focusChanged&&<p role="status">{learningMode?"This practice changed. Close this view and reopen it to use the latest details.":"This shift changed. Close this view and reopen the shift to use its current details."}</p>}
    <form className="jmax-chat-composer" onSubmit={e=>{e.preventDefault();void act('ask')}}>
      <label htmlFor={learningMode?'jmax-learning-question':embedded?'jmax-shift-question':'jmax-question'}>Ask JMAX<textarea ref={composer} id={learningMode?'jmax-learning-question':embedded?'jmax-shift-question':'jmax-question'} rows={2} maxLength={2000} value={question} disabled={unavailable} placeholder={focus?.kind==='close'?'Ask about this close, its checks, or the next step…':focus?.kind==='task'?'Ask about this work, its checks, or the handoff…':'Ask about your shift, closing, schedule, or training…'} onChange={e=>setQuestion(e.target.value)} onInput={e=>setQuestion(e.currentTarget.value)}/></label>
      <div><span>{thinking?'JMAX is thinking…':'You review any changes.'}</span><button className="shared-primary" type="submit" disabled={unavailable||focusChanged||!question.trim()}>{thinking?'Thinking…':'Send'}</button></div>
    </form>
    {embedded?<button type="button" className="inline-action" disabled={busy||loading} onClick={()=>{void load()}}>{learningMode?"Reload practice conversation":"Reload shift conversation"}</button>:<details className="jmax-settings"><summary>Conversation options</summary><div><button disabled={busy||loading} onClick={()=>{setError('');void load()}}>Reload conversation</button>
    {view?.dailyUsage&&<details><summary>Restaurant AI allowance</summary><p>{view.dailyUsage.used} of {view.dailyUsage.limit} answer attempts today. Resets at midnight here. This limits requests, not dollars; failed attempts count. Only owners see this total.</p></details>}
    {view&&<details className="jmax-chat-preference"><summary>How JMAX explains things</summary><p>Choose your usual level of detail. You can ask for a different style in any message. Required instructions and checks always apply.</p><label htmlFor="jmax-explanation-style">My explanation preference<select id="jmax-explanation-style" value={styleDraft??view.explanationStyle} disabled={preferenceUnavailable} onChange={e=>{setStyleDraft(e.target.value as ExplanationStyle);setPreferenceSaved(false);}}><option value="balanced">Balanced — explanation and next step</option><option value="brief">Brief — keep it concise</option><option value="step-by-step">Step by step — walk me through it</option></select></label><button disabled={preferenceUnavailable||styleDraft===null||styleDraft===view.explanationStyle} onClick={()=>{void act('preferences')}}>{busyAction==='preferences'?'Saving…':'Save my preference'}</button>{preferenceSaved&&<p role="status">Saved. Your preference applies to new answers.</p>}<p>This choice is saved for your account in this restaurant. It is not shared with managers or used to rate your ability. Choose Balanced to return to the default.</p></details>}
    {view&&<div className="jmax-chat-history-actions"><p>A new conversation keeps your saved history. JMAX selects useful excerpts from your own conversations in this restaurant and checks current assignments and instructions before answering.</p>{!view.accessChanged&&<button disabled={busy||loading||uncertain||view.pending||!view.turns.length} onClick={()=>{void act('start-new')}}>{busyAction==='start-new'?'Saving conversation…':'New conversation, keep memory'}</button>}<button aria-expanded={historyOpen} onClick={()=>setHistoryOpen(!historyOpen)}>{historyOpen?'Hide conversation history':'My conversation history'}</button></div>}
    {view&&historyOpen&&<CompanionHistory key={view.conversationId+':'+view.revision+':'+w.location.revision} w={w} endpoint={endpoint} view={view} onOpen={onOpen} disabled={busy||loading||uncertain} onDelete={id=>act('delete-history',id)}/>}
    <details className="jmax-chat-privacy" onToggle={e=>{if(!e.currentTarget.open)setConfirmClear(false)}}><summary>Conversation privacy & clearing</summary><p>Your questions and answers are saved for you. This chat does not send messages to managers or change your tasks. Private feedback, Inbox text and legacy review scores are excluded. Relevant manager-recorded station levels, trainer designation and next learning steps can be included. Your question, explanation preference and relevant work context are processed by OpenAI.</p><p>New conversation, keep memory saves this conversation for later. JMAX can select relevant excerpts from your saved conversations in this restaurant to help future answers. It does not recall every old message, and earlier conversations from before an account-access change are excluded. Current assignments and approved instructions are checked again; conversations do not automatically train the AI or change restaurant policy.</p><p>Clearing permanently removes only the current conversation from this app and excludes it from future recall; it cannot be recovered here. Earlier conversations can be deleted individually in My conversation history, and deleted history is also excluded from future recall. Your explanation preference, schedule, tasks, goals and station standards stay in place.</p>{confirmClear?<div className="shared-actions"><button disabled={busy||uncertain||!view} onClick={()=>{void act('clear')}}>{busyAction==='clear'?'Clearing…':'Confirm: permanently clear current conversation'}</button><button disabled={busy||uncertain} onClick={()=>setConfirmClear(false)}>Cancel</button></div>:<button disabled={busy||uncertain||!view||(!view.turns.length&&!view.accessChanged&&!view.pending)} onClick={()=>setConfirmClear(true)}>Clear current conversation…</button>}</details>
    </div></details>}
  </section>;
}
