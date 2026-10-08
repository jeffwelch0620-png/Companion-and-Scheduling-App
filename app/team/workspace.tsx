'use client';
import { schedulingNoticeText } from '../shared/message-display';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createWorkspaceLoader, restaurantPreference, WorkspaceRequestError as RequestError, type WorkspaceMembership as Membership } from '../shared/workspace-context';
import { personName, has, manages, type Command, type Workspace, type WorkRecord, type RecordOf } from '../shared/types';
import {DishCheckoutCycles} from './dish-checkouts';
import { displayTime, localDate, nextDate } from '../shared/local-time';
import { RecordDetail, WorkspaceForm, type FormKind } from './workspace-forms';
import { ToastSetupPanel } from './toast-setup';
import { EmployeeWelcome } from './employee-welcome';
import { AccessSetupPanel } from './access-setup';
import { ScheduleWeek } from './schedule-week';
import { ScheduleRequests } from './schedule-requests';
import { requestTitle } from '../shared/schedule-requests';
import { ScheduleTransfer } from './schedule-transfer';
import { ReminderSetup } from './reminder-setup';
import { CompanionChat } from './companion-chat';
import { EmployeePrep } from './employee-prep';
import {PrepProgress} from './prep-progress';
import {CommissaryFood} from './commissary-food';
import {foodWorkflowPermissions} from '../shared/food-workflow-model';
import { TeamWorkforce } from './team-workforce';
import { IncidentReports } from './incidents';
import {HireHandoffs} from './hire-handoff';
import {HireChecklists} from './hire-checklist';
import {HireReviews} from './hire-review';
import {hireCoordinator,hireScheduler} from '../shared/hire-handoff';
import {MaintenancePlans} from './maintenance';
import {ServiceContacts} from './service-contacts';
import {Promotions} from './promotions';
import {HiringOpenings} from './hiring-openings';
import {followupTarget,followupReader} from '../shared/followup-desk';
import {FollowupDesk} from './followup-desk';
import {StaffIdeas} from './staff-ideas';
import {RecognitionBoard} from './recognition';
import {CateringCalendar} from './catering';
import {GuestReviews} from './guest-reviews';
import {ShiftCheckins} from './shift-checkin';
import {ComplianceRecords} from './compliance';
import { AttendanceHistory } from './attendance';
import { canManageAttendance } from '../shared/attendance';
import { scheduleWeekSource } from '../shared/workforce-planning';
import { WorkHistory } from './work-history';
import { TrainingHub } from './training-hub';
import { WorkspaceIcon } from './workspace-icon';
import { StarterTasks } from './starter-tasks';
import { RecoveredStandards } from './standard-sources';
import { SourceLibraryReview } from './source-library';
import { canAskAbout, chatSource } from '../shared/companion-focus';
import type { ChatSource } from '../shared/companion-chat-types';
import './workspace.css';
import './schedule-mobile.css';
import './companion-flow.css';
import './employee-shift.css';
import { MyDay } from './my-day';
import {OperationalLearning,OperationalLearningHome} from './operational-learning';
import {PositionAchievements} from './position-achievements';
import { ManagerLog, ManagerMeetings } from './operations';
const FoodWorkspace=lazy(()=>import('./food').then(module=>({default:module.FoodWorkspace})));
const FoodWorkflows=lazy(()=>import('./food-workflows').then(module=>({default:module.FoodWorkflows})));
import {foodDestination,foodWorkflowDestination} from '../shared/food-navigation';
import {foodManager} from '../shared/food';
import { BuildGaps } from './build-gaps';
import { operationsManager } from '../shared/operations';
import { OperationsHome, OperationsDirectory, OperationsRail } from './operations-home';
import {RestaurantTools} from './restaurant-tools';
import {LearningHelp} from './learning-help';
import {EmployeeShiftWeek} from './employee-shift-week';
import {ConnectedRoleHome} from './connected-role-home';
import {buildShiftBrief} from '../shared/shift-brief';
import {closingStatus} from '../shared/closing-status';
import {canManageClosing} from '../shared/closing-access';
import {resolveRoleHomeTarget} from '../shared/role-home-target';
import type {RoleHomeAttention,RoleHomeKind} from '../shared/role-home';
import './jmax-shell.css';
import './inviting-theme.css';

export type Send = (action:string,input:Record<string,unknown>,record?:WorkRecord)=>Promise<boolean>;
async function read<T>(url:string,options?:RequestInit):Promise<T> {
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const data:unknown=await response.json(); if(!response.ok) throw new RequestError(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:'The request could not be completed.',response.status); return data as T;
}
export default function ConnectedWorkspace({signInPath,apiRoot='/api',sharedStore,roleHome}:{signInPath:string;apiRoot?:string;sharedStore?:{onSignOut:()=>Promise<void>};roleHome?:{role:RoleHomeKind;initialLocation?:string}}) {
  const shared=!!sharedStore,workspaceEndpoint=shared?apiRoot:apiRoot+'/workspace';
  const [commissaryFoodLocations,setCommissaryFoodLocations]=useState<Membership[]>([]);
  const [memberships,setMemberships]=useState<Membership[]>([]),[w,setWorkspace]=useState<Workspace|null>(null),[tab,setTab]=useState(shared?'Manager Log':'Schedule week');
  const [toolsReturn,setToolsReturn]=useState('Schedule week');
  const [toolsChild,setToolsChild]=useState(false);
  const [followupFocus,setFollowupFocus]=useState<string|undefined>();
  const [logFocus,setLogFocus]=useState<string|undefined>();
  const [summaryFocus,setSummaryFocus]=useState<string|undefined>();
  const [foodHomeFocus,setFoodHomeFocus]=useState<{id:string;dataset:'operating'|'demo'}|undefined>();
  const [homeOpening,setHomeOpening]=useState(false),homeOpeningRef=useRef(false),homeGeneration=useRef(0);
  const [chatFocus,setChatFocus]=useState<ChatSource|null>(null);
  const [trainingStation,setTrainingStation]=useState<string|undefined>();
  const [scheduleView,setScheduleView]=useState<'day'|'people'|'mine'>();
  const [shiftDay,setShiftDay]=useState('');
  const [detailReturn,setDetailReturn]=useState<WorkRecord|null>(null);
  const [draftNeed,setDraftNeed]=useState<RecordOf<'staffing'>|undefined>();
  const [now,setNow]=useState(()=>new Date().toISOString()),[helpContext,setHelpContext]=useState<WorkRecord|undefined>();
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[workspaceError,setWorkspaceError]=useState(''),[status,setStatus]=useState(0);
  const [selected,setSelected]=useState<WorkRecord|null>(null),[form,setForm]=useState<FormKind|null>(null),[day,setDay]=useState('');
  const [foodBusy,setFoodBusy]=useState(false),foodBusyRef=useRef(false);
  const [pendingCommand,setPendingCommand]=useState<Command|null>(null);
  const [recoveryVersion,setRecoveryVersion]=useState(0);
  const pending=useRef<Command|null>(null),busyRef=useRef(false),locationRef=useRef('');
  const context=useMemo(()=>createWorkspaceLoader<Workspace>({
    memberships:()=>read<{memberships:Membership[];commissaryFoodLocations?:Membership[]}>(workspaceEndpoint),
    workspace:locationId=>read<Workspace>(`${workspaceEndpoint}?locationId=${encodeURIComponent(locationId)}`),
    preference:restaurantPreference(apiRoot,()=>window.sessionStorage),
  }),[apiRoot,workspaceEndpoint]);
  const lockFood=useCallback((v:boolean)=>{foodBusyRef.current=v;setFoodBusy(v);if(v)context.invalidate()},[context]);
  const moreRef=useRef<HTMLDetailsElement>(null);
  const viewportRef=useRef<HTMLElement>(null),viewRef=useRef<HTMLDivElement>(null);
  const fitMoreMenu=useCallback(()=>{
    const menu=moreRef.current,panel=menu?.querySelector<HTMLElement>(':scope > div');
    if(!menu?.open||!panel)return;
    const navigation=viewportRef.current?.parentElement?.querySelector(':scope > nav');
    const navigationBox=navigation?.getBoundingClientRect();
    const bottom=Math.min(window.innerHeight,navigationBox&&navigationBox.height>0?navigationBox.top:window.innerHeight);
    panel.style.maxHeight=`${Math.max(0,bottom-panel.getBoundingClientRect().top-12)}px`;
  },[]);
  useEffect(()=>{
    const dismiss=(event:PointerEvent)=>{
      const menu=moreRef.current;
      if(menu?.open&&event.target instanceof Node&&!menu.contains(event.target))menu.open=false;
    };
    document.addEventListener('pointerdown',dismiss);
    window.addEventListener('resize',fitMoreMenu);
    return()=>{document.removeEventListener('pointerdown',dismiss);window.removeEventListener('resize',fitMoreMenu)};
  },[fitMoreMenu]);
  useLayoutEffect(()=>{
    // Reset the shared viewport before the new section is painted, without
    // remounting JMAX or losing its unsent question and attached work.
    viewportRef.current?.scrollTo({top:0,left:0,behavior:'instant'});
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const transition=viewRef.current?.animate([
      {opacity:.55,transform:'translateY(6px)'},
      {opacity:1,transform:'translateY(0)'},
    ],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
    return()=>transition?.cancel();
  },[tab,w?.location.id,w?.me.id]);
  const load=useCallback(async(locationId?:string)=>{
    const result=await context.load(locationId);if(!result)return;
    const {workspace:value,memberships,commissaryFoodLocations,changed}=result;
    if(shared&&!operationsManager(value.me))throw new RequestError('Manager Log access is not assigned for this restaurant.',403);
    if(changed){
      setSelected(null);setForm(null);setDetailReturn(null);setDraftNeed(undefined);setHelpContext(undefined);
      setFollowupFocus(undefined);setLogFocus(undefined);setSummaryFocus(undefined);setFoodHomeFocus(undefined);setChatFocus(null);setTrainingStation(undefined);setScheduleView(undefined);setShiftDay('');
      setToolsChild(false);setToolsReturn('Schedule week');setError('');setNotice(result.notice);
      setTab(shared?'Manager Log':roleHome?'Role home':operationsManager(value.me)?'Operations home':value.me.position==='Dishwasher'?'My day':!value.me.capabilities.some(c=>['location.manage','people.manage','people.approve','schedule.manage','schedule.publish','schedule.change'].includes(c))?'My day':'Schedule week');
    }
    locationRef.current=value.location.id;setMemberships(memberships);setCommissaryFoodLocations(commissaryFoodLocations);setWorkspace(value);setWorkspaceError('');setStatus(0);setLoading(false);setNow(new Date().toISOString());
    if(!shared&&value.me.position==='Dishwasher')setTab(previous=>['Inbox','JMAX','Schedule week','Schedule requests','Work history',...(roleHome?['Role home','Legacy duties','Training']:[])].includes(previous)?previous:roleHome?'Role home':'Schedule week');
    setDay(previous=>!changed&&previous?previous:weekStart(localDate(new Date().toISOString(),value.location.timezone),value.location.weekStartsOn));
    return value;
  },[context,shared,roleHome]);
  const failed=useCallback((e:unknown,source:'load'|'action'='load')=>{(source==='load'?setWorkspaceError:setError)(e instanceof Error?e.message:source==='load'?'Could not load your workspace.':'Could not complete that change.');setStatus(e instanceof RequestError?e.status:0);setLoading(false);if(e instanceof RequestError&&[401,403].includes(e.status)){context.clear();locationRef.current='';setWorkspace(null);setSelected(null);setForm(null);pending.current=null;setPendingCommand(null)}},[context]);
  useEffect(()=>{let active=true;void Promise.resolve().then(()=>active?load(roleHome?.initialLocation):undefined).catch(failed);return()=>{active=false;context.invalidate()}},[load,failed,context,roleHome?.initialLocation]);
  useEffect(()=>{const refresh=()=>{if(locationRef.current&&!busyRef.current&&!foodBusyRef.current&&!pending.current&&!context.isLoading())load().catch(failed)};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh)},[load,failed,context]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date().toISOString()),60000);return()=>window.clearInterval(timer)},[]);
  const execute=async(command:Command):Promise<boolean>=>{
    if(busyRef.current||command.locationId!==locationRef.current)return false;
    if(context.isLoading()){setError('Your restaurant is refreshing. Try saving again once it has finished.');return false}
    const recovering=pending.current?.requestId===command.requestId;
    // Invalidate any old read before a mutation; its result must not replace the
    // post-save refresh or erase a current error.
    context.invalidate();busyRef.current=true;setBusy(true);setError('');setNotice('');pending.current=command;setPendingCommand(command);
    try {
      const result=await read<{recordId:string}>(workspaceEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});
      // A child form's initial submit already returned false after an uncertain
      // response. Once the exact retry succeeds, discard that submitted draft
      // too so another Save cannot create a second entry.
      if(recovering)setRecoveryVersion(version=>version+1);
      pending.current=null;setPendingCommand(null);if(command.action!=='goal.transition')setSelected(null);setForm(null);setHelpContext(undefined);setDraftNeed(undefined);setNotice('Saved.');if(command.action==='goal.create')setTab('Training');
      try {const refreshed=await load(command.locationId);const returnShift=selected?.kind==='shift'?selected:detailReturn?.kind==='shift'?detailReturn:null;if(returnShift&&refreshed)setSelected(refreshed.records.find(r=>r.id===returnShift.id)??null);if((['standard.from-source','goal.create','goal.start-learning'].includes(command.action)||command.action==='goal.transition'&&selected?.kind!=='shift')&&refreshed)setSelected(refreshed.records.find(r=>r.id===result.recordId)??null)} catch(e){failed(e);setNotice('Your change was saved. Refresh to see the latest state.')} return true;
    } catch(e) {
      // A gateway/server failure can follow a committed change. Retain its
      // request identity until acknowledgement; only a definite rejection
      // allows the form to submit a different command.
      if(e instanceof RequestError && e.status<500){pending.current=null;setPendingCommand(null);if(e.status===409)await load(command.locationId).catch(failed)}
      failed(e,'action');return false;
    } finally {busyRef.current=false;setBusy(false)}
  };
  const send:Send=async(action,input,record)=>{
    if(!w||pending.current)return false;
    return execute({requestId:crypto.randomUUID(),locationId:w.location.id,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})});
  };
  const navigate=(next:string)=>{if(homeOpeningRef.current||foodBusyRef.current||shared&&next!=='Manager Log')return;homeGeneration.current++;setToolsChild(false);setFollowupFocus(undefined);setLogFocus(undefined);setSummaryFocus(undefined);setFoodHomeFocus(undefined);setDetailReturn(null);setTrainingStation(undefined);setDraftNeed(undefined);if(moreRef.current)moreRef.current.open=false;if(next===tab)viewportRef.current?.scrollTo({top:0,left:0,behavior:'instant'});setTab(next);setSelected(null);setForm(null);setHelpContext(undefined);setNotice('')};
  const openFollowup=(id:string)=>{if(!w||foodBusyRef.current)return;const target=followupTarget(w,now,id);if(!target){setError('This follow-up changed or is no longer accessible. Refresh and review the current list.');return;}navigate(target.tab);setFollowupFocus(target.id)};
  const show=(record:WorkRecord)=>{setDetailReturn(record.kind==='shift'?null:selected?.kind==='shift'?selected:detailReturn);setDraftNeed(undefined);if(moreRef.current)moreRef.current.open=false;setSelected(record);setForm(null);setHelpContext(undefined);setError('');setNotice('')};
  const openHomeWorkflow=async(item:RoleHomeAttention)=>{
    if(!roleHome||homeOpeningRef.current||busyRef.current||foodBusyRef.current||pending.current||context.isLoading())return;
    const token=++homeGeneration.current;homeOpeningRef.current=true;setHomeOpening(true);setError('');
    try{
      const fresh=await load(item.locationId);if(!fresh||token!==homeGeneration.current)return;
      const target=resolveRoleHomeTarget(fresh,item,new Date());homeOpeningRef.current=false;
      navigate(target.tab);
      if(target.mode==='issue')setLogFocus(target.record.id);
      else if(target.mode==='summary')setSummaryFocus(target.record.id);
      else if(target.mode==='followup')setFollowupFocus(target.record.id);
      else if(target.mode==='food-order'&&target.record.kind==='order'&&target.record.data.food)setFoodHomeFocus({id:target.record.id,dataset:target.record.data.food.dataset});
      else{show(target.record);setDetailReturn(null);if(target.record.kind==='shift')setDay(weekStart(localDate(target.record.data.start,fresh.location.timezone),fresh.location.weekStartsOn));}
    }catch(e){if(e instanceof RequestError&&[401,403].includes(e.status))failed(e);else setError(e instanceof Error?e.message:'The original workflow could not be reopened.');setTab('Role home');}
    finally{homeOpeningRef.current=false;setHomeOpening(false)}
  };
  const askJmax=(record:WorkRecord)=>{if(['standard','goal'].includes(record.kind)&&canAskAbout(record)&&w?.me.position!=='Dishwasher'){setChatFocus(chatSource(record));navigate('JMAX');}};
  const openStationTraining=(station:string)=>{navigate('Training');setTrainingStation(station)};
  const askShiftWeek=(shift:RecordOf<'shift'>)=>{if(!w||w.me.position==='Dishwasher')return;const start=weekStart(localDate(shift.data.start,w.location.timezone),w.location.weekStartsOn);setChatFocus(scheduleWeekSource(w,start));navigate('JMAX')};
  const planLearningGoal=(record:WorkRecord)=>{setSelected(null);setHelpContext(record);setForm('goal');setError('')};
  const askForHelp=(record?:WorkRecord)=>{setSelected(null);setHelpContext(record);setForm('message');setError('')};
  const rows=w?.records??[], me=w?.me, dish=me?.position==='Dishwasher';
  const personal=!!me&&!dish&&!me.capabilities.some(c=>['location.manage','people.manage','people.approve','schedule.manage','schedule.publish','schedule.change'].includes(c));
  const manager=!!me&&operationsManager(me);
  const nav=shared?['Log']:roleHome?['Home',...(dish?['Schedule','Inbox','JMAX']:manager?['Log','Schedule','Areas']:['Schedule','Training','Inbox'])]:dish?['Home','Schedule','Inbox','JMAX']:manager?['Home','Log','Schedule','Areas','JMAX']:me&&foodManager(me)?['Areas','Schedule','Training','JMAX']:personal?['My day','Schedule','Training','JMAX']:['Schedule','Training','Team','JMAX'];
  const navTab=(name:string)=>({'Home':roleHome?'Role home':dish?'My day':'Operations home','Log':'Manager Log','Schedule':'Schedule week','Areas':'All areas'} as Record<string,string>)[name]??name;
  const activeNav=nav.indexOf(['Schedule week','Schedule requests','Attendance'].includes(tab)?'Schedule':tab==='Manager Log'||tab==='Repairs'?'Log':tab==='Operations home'||tab==='Role home'||dish&&tab==='My day'?'Home':tab==='All areas'?'Areas':tab);
  const today=w?localDate(now,w.location.timezone):'';
  const title=(r:WorkRecord)=>r.kind==='close'?r.data.standard.title:r.kind==='shift'?`${personName(w,r.ownerId,'Employee')} · ${r.data.position}`:r.kind==='request'?`${requestTitle(r)} · ${personName(w,r.ownerId,'Employee')}`:r.kind==='order'?`${personName(w,r.ownerId,'Employee')} · ${r.data.lines.length} items`:r.kind==='leadership'?`${personName(w,r.ownerId)} · ${r.data.area}`:r.kind==='feedback'?`${personName(w,r.ownerId,'Employee')} · ${r.data.shared?'Feedback':'Private note'}`:r.kind==='development'?`${personName(w,r.ownerId,'Employee')} · Development review`:r.kind==='goal'?`${personName(w,r.ownerId,'Employee')} · ${r.data.automaticLearning?'Training':r.data.title}`:'title' in r.data?r.data.title:r.kind;
  const state=(r:WorkRecord)=>r.kind==='message'?(r.data.readBy.includes(me?.id??'')?'Read':'Unread'):'phase' in r.data?r.data.phase.replaceAll('-',' '):'status' in r.data?r.data.status:r.kind==='shift'?r.data.cancelled?'Cancelled':r.data.releasedAt?'Checked out':r.data.published?'Published':'Draft':r.kind==='leadership'?r.data.active?'Assigned':'Revoked':'';
  const list=(items:WorkRecord[],empty:string)=>items.length?<div className="shared-list">{items.map(r=><button key={r.id} onClick={()=>show(r)}><span><strong>{title(r)}</strong><small>{r.kind==='shift'||r.kind==='leadership'?displayTime(r.data.start,w!.location.timezone):r.kind==='close'||r.kind==='task'||r.kind==='handoff'||r.kind==='goal'?`${r.kind==='goal'&&r.ownerId!==me?.id?personName(w,r.ownerId)+' · ':''}Due ${displayTime(r.data.due,w!.location.timezone)}`:r.kind==='development'?`Original due date: ${r.data.originalDueDate}`:r.kind==='message'?(r.data.replies.length?personName(w,r.data.replies.at(-1)!.actorId)+': '+r.data.replies.at(-1)!.text:schedulingNoticeText(r.data.title,r.data.body,w!.location.timezone)):r.kind==='standard'?`Version ${r.data.version}`:''}</small></span><em>{(state(r)||'Open').replace(/^./,c=>c.toUpperCase())}</em></button>)}</div>:<p className="shared-empty">{empty}</p>;
  const foodEntry=w?foodDestination(tab,w.me):null;
  const foodWorkflow=w?foodWorkflowDestination(tab,w.me):null;
  const stale=!!selected&&rows.find(r=>r.id===selected.id)?.revision!==selected.revision;
  const checkoutBrief=w?buildShiftBrief(w,now).items.filter(i=>i.record.kind==='shift'&&(i.lane==='action'||i.record.ownerId===w.me.id)):[];
  const checkoutShifts=w?rows.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===w.location.id&&r.data.published&&!r.data.cancelled&&!r.data.releasedAt&&Date.parse(r.data.start)<=Date.parse(now)&&(checkoutBrief.some(i=>i.record.id===r.id)||closingStatus(w,r,{allowProjectedReceipts:true}).required&&!closingStatus(w,r,{allowProjectedReceipts:true}).complete&&(r.ownerId===w.me.id||canManageClosing(w.me,r.area,'tasks.manage')))):[];
  const detail=selected&&w?<RecordDetail apiRoot={apiRoot} key={`${selected.id}:${selected.revision}`} record={selected} w={w} send={send} onError={setError} onOpen={show} onGuides={openStationTraining} onAskWeek={askShiftWeek} onWeek={r=>{if(r.kind==='shift'){const date=localDate(r.data.start,w.location.timezone);setDay(weekStart(date,w.location.weekStartsOn));navigate('Schedule week')}}} now={now}/>:null;
  return <div className={`shared-ui shared-flow jmax-combined${manager&&!shared?' jmax-manager':''}${shared?' shared-live-workspace':''}`} data-location-theme={/papa/i.test(w?.location.name??'')?'papa':/rudd/i.test(w?.location.name??'')?'rudds':/commissary/i.test(w?.location.name??'')?'comm':'berts'}><div className="shared-shell">
    <header><a className="shared-brand" aria-label="JayMax Operations home" href={shared?'/shared-live':apiRoot==='/api'?'/team':'/review'}><span className="jmax-brand-icon" aria-hidden="true"/><span className="jmax-wordmark"><span className="jmax-brand-compact" aria-hidden="true"/><small>OPERATIONS</small></span></a>
    <div className="jmax-header-context"><strong>{tab==='Operations home'?'Daily brief':tab==='Schedule week'?'Schedule':tab==='Legacy duties'?'Shift duties & checkout':tab}</strong><span>{shared?'Shared Manager Log':'Local review · sample data'}</span></div>
    {w&&<div className="jmax-location-context">{memberships.length>1?<label><span className="schedule-sr-only">Current restaurant</span><select aria-label="Current restaurant" value={w.location.id} disabled={busy||!!pendingCommand||foodBusy||homeOpening} onChange={e=>{if(homeOpeningRef.current||busyRef.current||foodBusyRef.current||pending.current||context.isLoading())return;setChatFocus(null);setSelected(null);setForm(null);setWorkspace(null);setLoading(true);setError('');setNotice('');load(e.target.value).catch(failed)}}>{memberships.map(m=><option key={m.id} value={m.locationId}>{m.locationName}</option>)}</select></label>:<strong>{w.location.name}</strong>}<small>{w.me.position} · {w.me.area}</small></div>}
    {w&&<div className="shared-toolbar">{!shared&&!dish&&<button aria-label="Inbox" aria-current={tab==='Inbox'?'page':undefined} onClick={()=>navigate('Inbox')}><WorkspaceIcon name="Inbox"/></button>}<details ref={moreRef} onToggle={e=>{if(e.currentTarget.open)e.currentTarget.querySelector(':scope > div')?.scrollTo({top:0,left:0,behavior:'instant'});fitMoreMenu()}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false}} onKeyDown={e=>{if(e.key==='Escape'&&e.currentTarget.open){e.preventDefault();e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}} onClick={e=>{if((e.target as HTMLElement).closest('button'))e.currentTarget.open=false}}><summary aria-label="Account"><span className="account-avatar">{me?.name?.split(/\s+/).map(n=>n[0]).slice(0,2).join('')}</span></summary><div><div className="account-identity"><strong>{me?.name}</strong><span>{me?.position} · {w.location.name}</span></div>{memberships.length>1&&<label>Restaurant<select value={w.location.id} disabled={busy||!!pendingCommand||foodBusy||homeOpening} onChange={e=>{if(homeOpeningRef.current||busyRef.current||foodBusyRef.current||pending.current||context.isLoading())return;setChatFocus(null);setSelected(null);setForm(null);setWorkspace(null);setLoading(true);setError('');setNotice('');load(e.target.value).catch(failed)}}>{memberships.map(m=><option key={m.id} value={m.locationId}>{m.locationName}</option>)}</select></label>}<button disabled={busy||!!pendingCommand||foodBusy||homeOpening} onClick={()=>{if(homeOpeningRef.current||busyRef.current||foodBusyRef.current||pending.current||context.isLoading())return;setError('');load().catch(failed)}}>Refresh</button>{!shared&&<>{personal&&<button onClick={()=>navigate('Team')}>My profile</button>}{!dish&&w.me.capabilities.some(c=>['location.manage','people.manage','tasks.manage','schedule.manage','schedule.publish','standards.approve'].includes(c))&&<button onClick={()=>{setToolsReturn(tab);navigate('Restaurant tools')}}>Manage restaurant</button>}{followupReader(w.me)&&<button onClick={()=>navigate('Follow-up desk')}>Follow-up desk</button>}{manager&&<button onClick={()=>navigate('Who to call')}>Who to call</button>}{!dish&&<button onClick={()=>navigate('Promotions')}>Offers and promotions</button>}{!shared&&commissaryFoodLocations.length>0&&<button onClick={()=>navigate('Commissary Food')}>Commissary Food work</button>}{!dish&&!w.me.scheduleOnly&&<><button onClick={()=>navigate('Catering calendar')}>Catering calendar</button><button onClick={()=>navigate('Staff ideas')}>Staff ideas</button><button onClick={()=>navigate('Recognition')}>Recognition</button></>}{!dish&&<button onClick={()=>navigate('Shift check-ins')}>Shift check-ins</button>}{!w.me.scheduleOnly&&<><button onClick={()=>navigate('Shift lessons')}>Shift lessons</button><button onClick={()=>navigate('Your progress')}>Your progress</button></>}<button onClick={()=>navigate('Work history')}>Work history</button><a href="/shared-live" onClick={e=>{if(busyRef.current||foodBusyRef.current||pending.current)e.preventDefault()}}>Shared Manager Log</a></>}<button disabled={busy||!!pendingCommand||foodBusy||homeOpening} onClick={async()=>{if(busyRef.current||foodBusyRef.current||pending.current)return;try{if(sharedStore){await sharedStore.onSignOut();context.clear();locationRef.current='';setWorkspace(null);return}await read('/api/employee-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});context.clear();locationRef.current='';setWorkspace(null);window.location.assign('/signout-with-chatgpt?return_to=%2Flogin')}catch(e){failed(e,'action')}}}>Sign out</button></div></details></div>}
    </header>
    <div aria-live="polite">{roleHome&&<div className="module-review-label">LOCAL WORKFLOW REVIEW · Fictional accounts and saved local records · Home choice does not change permissions.</div>}{pendingCommand&&!busy&&<p className="shared-notice">This change is still waiting for confirmation at {w?.location.name??'its original restaurant'}. Retry the same change before switching restaurants.</p>}{workspaceError&&<div className="shared-error" role="alert">{workspaceError}</div>}{notice&&<p className="shared-notice">{notice}</p>}{error&&<div className="shared-error" role="alert">{error}{pendingCommand&&<button disabled={busy} onClick={()=>execute(pendingCommand)}>Retry the same change</button>}</div>}</div>
    {manager&&w&&!shared&&<OperationsRail w={w} tab={roleHome&&tab==='Role home'?'Operations home':tab} onNavigate={next=>navigate(roleHome&&next==='Operations home'?'Role home':next)}/>}
    <main ref={viewportRef} aria-busy={loading||busy}>
      {!w?<div className="shared-welcome"><h1>Your JMAX workspace</h1>{loading?<p>Loading your restaurant…</p>:status===401?<a className="shared-primary" href={signInPath} target="_top">{shared?'Sign in to shared JMAX':apiRoot==='/api'?'Sign in to JMAX':'Sign in with ChatGPT'}</a>:<button onClick={()=>{setLoading(true);load().catch(failed)}}>Try again</button>}<p>Access is assigned to your account and restaurant.</p>{sharedStore&&<button onClick={()=>void sharedStore.onSignOut().catch(e=>failed(e,'action'))}>Sign out</button>}{status===403&&apiRoot==='/api'&&<><p><a className="shared-primary" href="/login" target="_top">Sign in with a JMAX setup code</a></p><details><summary>Set up a new restaurant</summary><a href="/setup">Restaurant owner? Finish workspace setup</a></details></>}</div>:<div key={w.location.id+':'+w.me.id+':'+recoveryVersion} ref={viewRef} className="shared-view">{!shared&&(w.activeRecordCount??0)>=2400&&has(w.me,'location.manage')&&<div className="shared-notice"><p>The active workspace is getting full. File older completed work in history to keep room for new schedules and updates.</p><button onClick={()=>navigate('Work history')}>Review work history</button></div>}
      {apiRoot==='/api'&&!roleHome&&<EmployeeWelcome key={w.location.id+':'+w.me.id} w={w} onNavigate={navigate} onOpen={show}/>}
      {roleHome&&tab!=='Role home'&&<div className="module-home-return"><button disabled={busy||!!pendingCommand||foodBusy||homeOpening} onClick={()=>{navigate('Role home');void load().catch(failed)}}>← Back to home</button><span>{w.location.name} · {w.me.name}</span></div>}
      {roleHome&&tab==='Role home'&&<ConnectedRoleHome key={w.location.id+':'+w.me.id+':'+roleHome.role} w={w} memberships={memberships} role={roleHome.role} now={now} endpoint={workspaceEndpoint} busy={busy||!!pendingCommand||foodBusy||homeOpening} onOpen={item=>void openHomeWorkflow(item)}/>}
      {homeOpening&&<p role="status">Refreshing the original restaurant and record…</p>}
      {roleHome&&tab==='Role home'&&foodWorkflowPermissions(w.me).managePrep&&<PrepProgress key={apiRoot+':'+w.location.id+':'+w.me.id} w={w} apiRoot={apiRoot} onNavigate={navigate}/>} 
      {dish&&tab==='Training'&&<section><h1>Approved position instructions</h1><p>Read the approved instructions assigned to your position.</p>{list(rows.filter(r=>r.kind==='standard'&&r.data.status==='approved'&&r.data.position==='Dishwasher'),'No approved Dishwasher instructions are available.')}</section>}
      {toolsChild&&<button className="compact-back" onClick={()=>navigate('Restaurant tools')}>‹ Manage restaurant</button>}
      {tab==='Follow-up desk'&&followupReader(w.me)&&<FollowupDesk key={w.location.id+':'+w.me.id} w={w} now={now} onOpen={openFollowup}/>}
      {tab==='Operations home'&&manager&&<OperationsHome w={w} now={now} onFollowup={openFollowup} onNavigate={navigate} onIssue={id=>{navigate('Manager Log');setLogFocus(id)}}/>}
      {!shared&&tab==='Operations home'&&manager&&foodWorkflowPermissions(w.me).managePrep&&<PrepProgress key={apiRoot+':'+w.location.id+':'+w.me.id} w={w} apiRoot={apiRoot} onNavigate={navigate}/>}
      {!shared&&commissaryFoodLocations.length>0&&(tab==='Role home'||tab==='Operations home'||tab==='My day')&&<section className="food-flow-panel"><h2>Commissary Food work</h2><p>Open approved prep, counts and transfers for Bert’s or Rudd’s.</p><button disabled={busy||!!pendingCommand||foodBusy} onClick={()=>navigate('Commissary Food')}>Open commissary Food work</button></section>}
      {!shared&&tab==='Commissary Food'&&commissaryFoodLocations.length>0&&<CommissaryFood key={apiRoot+':'+w.me.id+':'+commissaryFoodLocations.map(m=>m.id).join(':')} locations={commissaryFoodLocations} apiRoot={apiRoot} busy={busy||!!pendingCommand||foodBusy} onBusy={lockFood}/>}
      {tab==='All areas'&&(manager||foodManager(w.me))&&<OperationsDirectory key={w.location.id+':'+w.me.id} w={w} onNavigate={navigate}/>}
      {tab==='My day'&&(personal||dish)&&<MyDay key={w.location.id+':'+w.me.id} onLessons={()=>navigate('Shift lessons')} send={send} busy={busy||!!pendingCommand||foodBusy} onProgress={()=>navigate('Your progress')} onIdeas={dish?undefined:()=>navigate('Staff ideas')} onPromotions={dish?undefined:()=>navigate('Promotions')} onStart={guide=>{void send('goal.start-learning',{standardId:guide.id,standardRevision:guide.revision})}} w={w} now={now} onOpen={show} onTraining={()=>navigate('Training')} onSchedule={()=>navigate('Schedule week')} onDuties={()=>navigate('Legacy duties')} onAsk={shift=>{setChatFocus(shift?chatSource(shift):null);navigate('JMAX')}}/>}
      {!shared&&!w.me.scheduleOnly&&(tab==='Role home'||tab==='Operations home')&&<OperationalLearningHome w={w} onOpen={show} onShare={()=>navigate('Shift lessons')}/>}
      {!shared&&!w.me.scheduleOnly&&(tab==='Role home'||tab==='Operations home')&&<PositionAchievements w={w} send={send} busy={busy||!!pendingCommand||foodBusy} onOpen={show} compact onMore={()=>navigate('Your progress')}/>}
      {!shared&&tab==='Shift lessons'&&!w.me.scheduleOnly&&<OperationalLearning key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} onOpen={show} onBack={()=>navigate(roleHome?'Role home':manager?'Operations home':'My day')}/>}
      {!shared&&tab==='Your progress'&&!w.me.scheduleOnly&&<PositionAchievements w={w} send={send} busy={busy||!!pendingCommand||foodBusy} onOpen={show}/>}
      {!shared&&!dish&&!w.me.scheduleOnly&&(tab==='My day'||roleHome?.role==='frontline'&&tab==='Role home')&&<EmployeePrep key={apiRoot+':'+w.location.id+':'+w.me.id} w={w} apiRoot={apiRoot} onBusy={lockFood}/>}
      {!shared&&<div className="chat-pane" hidden={tab!=='JMAX'}><CompanionChat key={apiRoot+':'+w.location.id+':'+w.me.id} w={w} apiRoot={apiRoot} onOpen={show} focus={chatFocus} onFocusChange={setChatFocus} onSchedule={start=>{setDay(start);navigate('Schedule week')}}/></div>}
      {tab==='Training'&&!dish&&<TrainingHub onStart={guide=>{void send('goal.start-learning',{standardId:guide.id,standardRevision:guide.revision})}} now={now} key={w.location.id+':'+w.me.id+':'+(trainingStation??'')} w={w} initialStation={trainingStation} onOpen={show} onHelp={askForHelp} onAskJmax={askJmax} onPlanGoal={planLearningGoal} onCreateGoal={()=>setForm('goal')} onCreateReview={()=>setForm('development')} onContent={()=>navigate('Standards')} onHistory={()=>navigate('Work history')}/>}
      {tab==='Legacy duties'&&<section><div className="shared-heading"><h1>Shift duties &amp; checkout</h1>{!dish&&w.members.some(m=>canManageClosing(w.me,m.area,'tasks.manage'))&&<button disabled={busy||!!pendingCommand||foodBusy} onClick={()=>setForm('task')}>Assign work</button>}</div><p>Open required work for its next check, then open the shift for manager checkout.</p><DishCheckoutCycles w={w} send={send} busy={busy||!!pendingCommand||foodBusy} onOpen={show}/>{list([...rows.filter(r=>r.kind==='close'&&!['closed','cancelled'].includes(r.data.phase)||r.kind==='task'&&r.data.phase!=='closed'||r.kind==='handoff'&&!['resolved','cancelled'].includes(r.data.phase)),...checkoutShifts],'No outstanding duties or shift checkouts.')}</section>}
      {tab==='Schedule week'&&apiRoot==='/api'&&has(w.me,'location.manage')&&<ScheduleTransfer w={w} onChanged={async start=>{await load();setDay(start);navigate('Schedule week')}}/>}

      {tab==='Schedule requests'&&<ScheduleRequests key={w.location.id+':'+w.me.id} w={w} now={now} busy={busy||!!pendingCommand||foodBusy} onBack={()=>navigate('Schedule week')} onTimeOff={()=>setForm('time-off')} onAvailability={()=>setForm('availability')} onOpen={show}/>}
      {tab==='Attendance'&&!dish&&canManageAttendance(w.me)&&<AttendanceHistory key={w.location.id+':'+w.me.id} w={w} now={now} onOpen={show} onBack={()=>navigate('Schedule week')}/>}
      {tab==='Work history'&&<WorkHistory key={w.location.id+':'+w.me.id} w={w} apiRoot={apiRoot} onChanged={async()=>{await load()}} onBack={()=>navigate('Schedule week')} onCheckins={()=>navigate('Shift check-ins')}/>}
      {tab==='Inbox'&&<section><div className="shared-heading"><h1>Inbox</h1><button onClick={()=>setForm('message')}>New message</button></div>{list(rows.filter(r=>r.kind==='message'),'No messages.')}</section>}
      {tab==='Orders'&&!dish&&<section><div className="shared-heading"><h1>Food orders</h1>{has(w.me,'orders.request')&&<button onClick={()=>setForm('order')}>New request</button>}</div><p>Submit an internal request for purchaser review. Supplier placement remains a separate step.</p>{list(rows.filter(r=>r.kind==='order'),'No order requests.')}</section>}
      {(tab==='Manager Log'||tab==='Repairs')&&manager&&<ManagerLog limitedToNotes={shared} onContacts={shared?undefined:()=>navigate('Who to call')} onGuests={shared?undefined:()=>navigate('Guest reviews')} key={w.location.id+':'+w.me.id+':'+tab+':'+(logFocus??summaryFocus??'')} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} initialIssueId={logFocus} initialEntryId={summaryFocus} repairMode={tab==='Repairs'}/>}
      {tab==='Onboarding review'&&hireCoordinator(w.me)&&<HireReviews key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} busy={busy||!!pendingCommand||foodBusy} onNavigate={navigate}/>}
      {tab==='Onboarding checklist'&&hireCoordinator(w.me)&&<HireChecklists initialRecordId={followupFocus} key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onNavigate={navigate}/>}
      {tab==='First-shift handoff'&&(hireCoordinator(w.me)||hireScheduler(w.me))&&<HireHandoffs initialRecordId={followupFocus} key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onNavigate={navigate}/>}
      {tab==='Scheduled maintenance'&&manager&&<MaintenancePlans key={w.location.id+':'+w.me.id} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')} onContacts={()=>navigate('Who to call')}/>}
      {tab==='Who to call'&&manager&&<ServiceContacts w={w} send={send} busy={busy||!!pendingCommand||foodBusy} onHistory={()=>navigate('Work history')}/>}
      {tab==='Promotions'&&!dish&&<Promotions key={w.location.id+':'+w.me.id+':'+(followupFocus??'')} initialRecordId={followupFocus} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')}/>}
      {tab==='Catering calendar'&&!dish&&!w.me.scheduleOnly&&<CateringCalendar key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')}/>}
      {tab==='Recognition'&&!dish&&!w.me.scheduleOnly&&<RecognitionBoard key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')}/>}
      {tab==='Hiring and open positions'&&manager&&!w.me.scheduleOnly&&<HiringOpenings onHandoffs={()=>navigate('First-shift handoff')} key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')}/>}
      {tab==='Staff ideas'&&!dish&&!w.me.scheduleOnly&&<StaffIdeas initialRecordId={followupFocus} key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')}/>}
      {tab==='Guest reviews'&&manager&&<GuestReviews initialRecordId={followupFocus} key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')}/>}
      {tab==='Shift check-ins'&&!dish&&<ShiftCheckins key={w.location.id+':'+w.me.id+':'+recoveryVersion} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now} onHistory={()=>navigate('Work history')}/>}
      {tab==='Inspections and permits'&&has(w.me,'location.manage')&&!dish&&<ComplianceRecords initialRecordId={followupFocus} key={w.location.id+':'+w.me.id} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now}/>}
      {tab==='Incident reports'&&manager&&<IncidentReports key={w.location.id+':'+w.me.id} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now}/>}
      {tab==='Manager one-on-ones'&&!dish&&<ManagerMeetings key={w.location.id+':'+w.me.id} w={w} send={send} busy={busy||!!pendingCommand||foodBusy} now={now}/>}
      {foodEntry&&<Suspense fallback={<p role="status">Opening food workspace…</p>}><FoodWorkspace key={w.location.id+':'+w.me.id+':'+tab} w={w} apiRoot={apiRoot} recipesOnly={foodEntry.recipesOnly} initialView={foodEntry.view} onBusy={lockFood}/></Suspense>}
      {foodWorkflow&&<Suspense fallback={<p role="status">Opening food workflow…</p>}><FoodWorkflows key={w.location.id+':'+w.me.id+':'+tab+':'+(foodHomeFocus?.id??'')} w={w} apiRoot={apiRoot} view={foodWorkflow} initialOrderId={foodHomeFocus?.id} initialDataset={foodHomeFocus?.dataset} onBusy={lockFood} busy={busy||!!pendingCommand} send={send} onNavigate={navigate}/></Suspense>}
      {tab==='Build progress'&&!dish&&has(w.me,'location.manage')&&<BuildGaps/>}
      {tab==='Restaurant tools'&&!dish&&<RestaurantTools w={w} onNavigate={next=>{navigate(next);setToolsChild(true)}} onLeadership={()=>{setForm('leadership');setSelected(null)}} onBack={()=>navigate(toolsReturn)}/>}
      {tab==='Toast setup'&&!dish&&has(w.me,'location.manage')&&<ToastSetupPanel key={w.location.id} w={w} apiRoot={apiRoot}/>}
      {tab==='Review follow-up'&&!dish&&has(w.me,'location.manage')&&<ReminderSetup key={w.location.id} w={w} apiRoot={apiRoot} onChanged={()=>load().then(()=>{}).catch(failed)}/>}
      {tab==='Employee access'&&!dish&&has(w.me,'location.manage')&&<AccessSetupPanel key={w.location.id} w={w} apiRoot={apiRoot} onChanged={()=>load().then(()=>{}).catch(failed)}/>}
      {tab==='Team'&&!dish&&<TeamWorkforce w={w} send={send} busy={busy||!!pendingCommand||foodBusy} onAccess={()=>navigate('Employee access')} onAttendance={()=>navigate('Attendance')}/>}
      {tab==='Schedule week'&&<ScheduleWeek view={scheduleView} onViewChange={setScheduleView} key={w.location.id+':'+day} w={w} now={now} start={day} setStart={setDay} onAskWeek={()=>{setChatFocus(scheduleWeekSource(w,day));navigate('JMAX')}} onRequests={()=>navigate('Schedule requests')} onAttendance={()=>navigate('Attendance')} onHistory={()=>navigate('Work history')} onAdd={date=>{setShiftDay(date);setForm('shift')}} onStaffing={()=>setForm('staffing')} onCover={r=>{setDraftNeed(r);setSelected(null);setForm('shift')}} onOpen={show} send={send} busy={busy||!!pendingCommand||foodBusy}/>}

      {tab==='Feedback'&&!dish&&<section><div className="shared-heading"><h1>Notes & feedback</h1><button onClick={()=>setForm('feedback')}>Write a note</button></div><p>Your private notes stay with you until you choose to share them.</p>{list(rows.filter(r=>r.kind==='feedback'),'No notes or feedback.')}</section>}
      {tab==='Standards'&&!dish&&<section><div className="shared-heading"><h1>Training content</h1>{(has(w.me,'tasks.manage')||has(w.me,'standards.approve'))&&<button onClick={()=>setForm('standard')}>Draft guide</button>}</div><p>Use a current restaurant source and observable conditions. A draft needs validation and approval before assignment.</p>{apiRoot==='/api'&&has(w.me,'location.manage')&&<SourceLibraryReview key={w.location.id} w={w} send={send} onOpen={show}/>}<StarterTasks w={w} send={send} onOpen={setSelected}/><RecoveredStandards w={w} send={send} onOpen={show}/>{list(rows.filter(r=>r.kind==='standard'&&r.data.status!=='retired'),'No training guides yet.')}<details><summary>Retired guides and removed drafts</summary>{list(rows.filter(r=>r.kind==='standard'&&r.data.status==='retired'),'No retired guides or removed drafts.')}</details></section>}
    </div> }</main>
    {w&&<nav aria-label="Primary navigation" style={{'--nav-count':nav.length,'--nav-index':Math.max(0,activeNav),'--nav-visible':activeNav<0?0:1} as CSSProperties}>{nav.map((n,i)=><button key={n} aria-current={i===activeNav?'page':undefined} onClick={()=>{if(n==='Schedule')setDay(weekStart(day,w.location.weekStartsOn));navigate(navTab(n))}}><WorkspaceIcon name={n}/><span>{n}</span></button>)}</nav>}
    {w&&(selected||form)&&<WorkspaceDialog employee={selected?.kind==='shift'?personName(w,selected.ownerId):undefined} title={selected?title(selected):({'time-off':'Request time off',availability:'Set availability',task:'Assign work',handoff:'Overnight handoff',development:'Open a development review',goal:'Choose or propose a goal',feedback:'Write a note'} as Record<string,string>)[form!]??form!.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase())} onClose={()=>{if(!busy){setDetailReturn(null);setSelected(null);setForm(null);setHelpContext(undefined);setDraftNeed(undefined)}}}>
      {detailReturn&&selected&&selected.id!==detailReturn.id&&<button className="detail-back" disabled={busy||!!pendingCommand||foodBusy||homeOpening} onClick={()=>{setSelected(rows.find(r=>r.id===detailReturn.id)??null);setDetailReturn(null);setError('')}}>‹ Back to shift</button>}
      {stale&&<div className="shared-error">This item changed since you opened it.<button onClick={()=>{setSelected(rows.find(r=>r.id===selected?.id)??null);setError('')}}>Review the latest version</button></div>}
      {error&&<p className="shared-error" role="alert">{error}</p>}
      {selected&&!dish&&selected.kind==='standard'&&canAskAbout(selected)&&<button className="shared-primary" disabled={busy||stale||!!pendingCommand} onClick={()=>askJmax(selected)}>Ask JMAX about this</button>}
      <fieldset disabled={busy||stale||!!pendingCommand}>{selected?(selected.kind==='shift'?<EmployeeShiftWeek key={selected.ownerId} w={w} shift={selected} onSelect={show}>{detail}</EmployeeShiftWeek>:detail):<WorkspaceForm key={form} kind={form!} draftNeed={form==='shift'?draftNeed:undefined} record={form==='message'||form==='goal'?helpContext:undefined} w={w} day={form==='time-off'||form==='availability'?today:form==='shift'?shiftDay||day:day} send={send} onError={setError}/>}</fieldset>
      {selected?.kind==='goal'&&!dish&&canAskAbout(selected)&&<fieldset disabled={busy||stale||!!pendingCommand}><LearningHelp key={selected.id} goal={selected} w={w} apiRoot={apiRoot}/></fieldset>}
      {pendingCommand&&<button disabled={busy} onClick={()=>execute(pendingCommand)}>Retry the same change</button>}
    </WorkspaceDialog>}
  </div></div>;
}

function WorkspaceDialog({title,employee,onClose,children}:{title:string;employee?:string;onClose:()=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();const current=ref.current;return()=>current?.close()},[]);
  return <dialog className={`shared-dialog shared-ui${employee?' employee-shift-dialog':''}`} ref={ref} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="shared-dialog-title"><div className="shared-dialog-heading">{employee?<div className="employee-sheet-identity"><span aria-hidden="true">{employee.split(/\s+/).map(n=>n[0]).slice(0,2).join('')}</span><div><small>Employee schedule</small><h2 id="shared-dialog-title">{employee}</h2></div></div>:<h2 id="shared-dialog-title">{title}</h2>}<button onClick={onClose} aria-label="Close details">{employee?'×':'Close'}</button></div>{children}</dialog>;
}

function weekStart(day:string,start=1){return day?nextDate(day,-((new Date(day+'T12:00:00Z').getUTCDay()-start+7)%7)):day;}



