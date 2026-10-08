"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {people,tasksFor,type TeamMessage} from './demo-data';
import {seedState,parseState,taskKey,isLeader,canOrder,canSeeMessage,DEMO_DAY,shiftLabel,type State} from './workflow-model';
import {answerFromContext} from './companion-context';
import {NavIcon,TeamToday,RoleSwitcher,ControlCenter,TutorialOverlay,InboxView,MessageDrawer,ComposeDrawer,CompanionView,routeMessageAudience} from './legacy-views';
import {TaskFlow,EventQueue,ScheduleFlow,DevelopmentFlow,OrdersFlow,Notice} from './workflows';
import {IntegrationFlow,OperatingFlow} from "./admin-flows";
const STORAGE='jmax-workflow-review-v2';
export default function Workspace(){
 const [personId,setPersonId]=useState('eli'),[tab,setTab]=useState('Schedule'),[state,update]=useState<State>(seedState),[ready,setReady]=useState(false),[storageError,setStorageError]=useState('');
 const [controlOpen,setControlOpen]=useState(false),[switcher,setSwitcher]=useState(false),[tourStep,setTourStep]=useState<number|null>(null),[taskId,setTaskId]=useState<string|null>(null),[message,setMessage]=useState(''),[listening,setListening]=useState(false),[openMessageId,setOpenMessageId]=useState<string|null>(null),[composeOpen,setComposeOpen]=useState(false);
 const threads=state.threads??{};
 const shellRef=useRef<HTMLDivElement>(null),person=people.find(p=>p.id===personId)!,dish=person.position==='Dishwasher';
 const assigned=state.shifts.find(s=>s.personId===person.id&&s.date===DEMO_DAY),workingPerson=useMemo(()=>assigned?{...person,shift:shiftLabel(assigned)}:person,[person,assigned]);
 const tasks=useMemo(()=>tasksFor(workingPerson),[workingPerson]),selected=tasks.find(t=>t.id===taskId),nav=dish?['Schedule','Inbox']:['JMAX','Today','Schedule','Inbox'];
 // Browser storage is an external system; hydration is gated before the first write.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{try{const saved=localStorage.getItem(STORAGE);if(saved)update(parseState(saved));if(!localStorage.getItem('jmax-guided-tour-v2'))setTourStep(0)}catch{setStorageError('Saved review data could not be loaded. The existing browser copy has not been overwritten.')}setReady(true)},[]);
 // Surface persistence failures instead of silently claiming that work was saved.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(!ready||storageError)return;try{localStorage.setItem(STORAGE,JSON.stringify(state))}catch{setStorageError('Changes could not be saved in this browser. Keep this page open and export the review before continuing.')}},[state,ready,storageError]);
 const finishTour=()=>{try{localStorage.setItem('jmax-guided-tour-v2','complete')}catch{}setTourStep(null)};
 const navigate=(next:string,context?:string)=>{setTab(dish&&['JMAX','Today','Growth'].includes(next)?'Schedule':next);setTaskId(null);setControlOpen(false);setOpenMessageId(null);setComposeOpen(false);if(context)setMessage(context);requestAnimationFrame(()=>{shellRef.current?.scrollTo({top:0});window.scrollTo({top:0})})};
 const choose=(id:string)=>{const p=people.find(p=>p.id===id)!;setPersonId(id);setSwitcher(false);setControlOpen(false);setTaskId(null);setOpenMessageId(null);setComposeOpen(false);setMessage('');setListening(false);setTab(p.position==='Dishwasher'?'Schedule':'JMAX')};
 const send=(text?:string)=>{const question=(text??message).trim();if(!question||dish)return;const answer=answerFromContext(question,workingPerson,state);update(s=>({...s,threads:{...s.threads,[person.id]:[...(s.threads?.[person.id]??[]),{from:'me',text:question},{from:'ai',text:answer}]}}));setMessage('')};
 const opened=state.messages.find(m=>m.id===openMessageId&&canSeeMessage(m,person));
 const completed=tasks.filter(t=>{const key=taskKey(person,t.id),event=state.events.find(e=>e.taskKey===key);return state.tasks[key]?.submitted&&(!event||event.phase==='closed')}).map(t=>t.id);
 const exportReview=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='jmax-local-review.json';a.click();URL.revokeObjectURL(url)};
 return <div className="prototype-stage"><div className="app-shell" ref={shellRef}>
 <header className="topbar"><button className="brand" onClick={()=>navigate(dish?'Schedule':'JMAX')}><span className="brand-mark">J</span><span><strong>MAX</strong><small>Operations Companion</small></span></button><button className="identity" onClick={()=>setControlOpen(true)}><span className="avatar">{person.initials}</span><span><small>Bert’s · BUILD REVIEW</small><strong>{person.name} · {person.position}</strong></span><span>⌄</span></button></header>
 <div className="review-banner">Fictional review day · saved on this browser · no live orders or employee access<br/><a href="/team">Open your shared workspace →</a></div>
 {storageError&&<div className="storage-alert"><Notice text={storageError}/><button onClick={exportReview}>Export current review</button></div>}
 <main>{!ready?<p className="page-wrap">Loading your saved review…</p>:<>
 {tab==='JMAX'&&!dish&&<><CompanionView key={person.id} person={workingPerson} state={state} chat={threads[person.id]??[]} message={message} listening={listening} setMessage={setMessage} setListening={setListening} send={send} onToday={()=>navigate('Today')}/><div className="page-wrap"><EventQueue person={person} state={state} update={update}/></div></>}
 {tab==='Today'&&!dish&&<>{!isLeader(person)&&<TeamToday person={workingPerson} tasks={tasks} completed={completed} onTask={setTaskId}/>}<div className="page-wrap"><EventQueue person={person} state={state} update={update}/>{canOrder(person)&&<button className="order-entry" onClick={()=>navigate('Orders')}>Food orders · requests & review →</button>}</div></>}
 {tab==='Schedule'&&<ScheduleFlow key={person.id} person={person} state={state} update={update}/>}
 {tab==='Inbox'&&<InboxView key={person.id} person={person} messages={state.messages} onOpen={setOpenMessageId} onCompose={()=>setComposeOpen(true)}/>}
 {tab==='Growth'&&!dish&&<DevelopmentFlow key={person.id} person={person} state={state} update={update}/>}
 {tab==='People'&&isLeader(person)&&<DevelopmentFlow key={person.id} person={person} state={state} update={update} team/>}
 {tab==='Orders'&&<OrdersFlow key={person.id} person={person} state={state} update={update}/>}
 {tab==='Operate'&&isLeader(person)&&<OperatingFlow person={person}/>}
 {tab==='Toast'&&['GM','Owner'].includes(person.tier)&&<IntegrationFlow person={person} state={state} update={update}/>}
 {tab==='Health'&&person.tier==='Owner'&&<OperatingFlow person={person}/>}
 </>}</main>
 <nav className="workday-dock" style={{gridTemplateColumns:`repeat(${nav.length},1fr)`}} aria-label="Primary navigation">{nav.map(item=><button key={item} className={tab===item?'active':''} onClick={()=>navigate(item)}><NavIcon item={item}/><span>{item}</span></button>)}</nav>
 {controlOpen&&<ControlCenter person={person} onClose={()=>setControlOpen(false)} onNavigate={navigate} onSwitchRole={()=>{setControlOpen(false);setSwitcher(true)}} onReplayTour={()=>{setControlOpen(false);setTourStep(0)}}/>}
 {switcher&&<RoleSwitcher current={person.id} onClose={()=>setSwitcher(false)} onChoose={choose}/>}
 {selected&&!dish&&<TaskFlow key={`${person.id}:${selected.id}`} person={person} task={selected} state={state} update={update} onClose={()=>setTaskId(null)} onAsk={()=>navigate('JMAX',`Help me with ${selected.title}`)}/>}
 {opened&&<MessageDrawer key={opened.id} person={person} message={opened} onClose={()=>setOpenMessageId(null)} onAcknowledge={()=>update(s=>({...s,messages:s.messages.map(m=>m.id===opened.id?{...m,acknowledgedBy:[...new Set([...m.acknowledgedBy,person.id])]}:m)}))} onReply={text=>update(s=>({...s,messages:s.messages.map(m=>m.id===opened.id?{...m,replies:[...m.replies,{from:person.name,text,time:'Now'}]}:m)}))} onAsk={()=>navigate('JMAX',`Summarize this message and help me respond: ${opened.subject}`)}/>}
 {composeOpen&&<ComposeDrawer key={person.id} person={person} onClose={()=>setComposeOpen(false)} onSend={draft=>{const routing=routeMessageAudience(draft);const m:TeamMessage={id:crypto.randomUUID(),...draft,...routing,from:person.name,fromRole:person.tier,time:'Now',ackRequired:draft.kind==='Announcement',acknowledgedBy:[],replies:[]};update(s=>({...s,messages:[m,...s.messages]}));setComposeOpen(false)}}/>}
 {tourStep!==null&&<TutorialOverlay dish={dish} step={tourStep} onStep={setTourStep} onFinish={finishTour}/>}
 </div></div>
}
