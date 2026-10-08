import { authenticateWorkspace, boundedJson, workspace } from './service';
import {restaurantAccessWriteGuard} from './restaurant-access';
import { companionContext, scopeCurrent } from './companion-context';
import { workforceContext } from './workforce-context';
import {prepQuestion,prepRevision,readPrepContext} from './companion-prep';
import { askCompanion, configuredCompanion } from './openai-companion';
import { CompanionFailure } from './companion-failure';
import { checkedCompanionAnswer } from './companion-requirements';
import { AppError, id, object, requireThat, text } from './validation';
import type { Workspace } from './types';
import type { WorkspaceIdentity } from './employee-session';
import type { ChatSource, ChatTurn, ChatView, ChatArchive, ChatHistoryPage, ArchivedChat } from './companion-chat-types';
import { companionDailyLimit, companionUsage, dailyLimitMessage } from './companion-usage';
import { explanationStyles, readExplanationStyle } from './companion-chat-types';
import {currentFollowupFocus,operationalFollowup} from './companion-followup';
import {companionBackWindowCups,checkedBackWindowTopUp,companionBackWindowAdditionalCups,checkedBackWindowAdditionalCups,companionBackWindowCupReferences} from './companion-back-window-cups';
import {companionClosingNext} from './companion-closing-next';
import {companionCorrectionNote} from './companion-correction-note';
import {checkedPrepHelp} from './companion-prep-help';
import {checkedHostPace} from './companion-host-pace';
import {checkedStockAssumptions} from './companion-stock-assumptions';
import {companionShiftReleaseBoundary} from './companion-shift-release';
import {checkedNoteNotification} from './companion-note-notification';
import {checkedHypotheticalScheduleScope} from './schedule-sales';
import {readCompanionMemory,validMemoryConversations,dependenciesCurrent,memoryReferences,recalledRowsStillPresent,type MemoryTurn} from './companion-memory';

type Database=Pick<D1Database,'prepare'|'batch'>;
type Conversation={id:string;revision:number;membership_revision:number;pending_request:string|null;lease_until:number;last_started:number;explanation_style:string};
type SavedTurn=MemoryTurn;
type Archive={id:string;membership_revision:number;title:string;archived_at:string;turn_count:number};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const failedMessage='JMAX could not finish this answer. Your question is saved; you can ask it again.';

async function conversation(db:Database,w:Workspace,membershipRevision:number){
  await db.prepare('INSERT INTO companion_conversations(location_id,member_id,id,membership_revision) VALUES(?,?,?,?) ON CONFLICT(location_id,member_id) DO NOTHING').bind(w.location.id,w.me.id,crypto.randomUUID(),membershipRevision).run();
  return (await db.prepare('SELECT * FROM companion_conversations WHERE location_id=? AND member_id=?').bind(w.location.id,w.me.id).first<Conversation>())!;
}
async function savedTurns(db:Database,w:Workspace,c:Conversation){
  return (await db.prepare('SELECT * FROM companion_turns WHERE location_id=? AND member_id=? AND conversation_id=? ORDER BY at,request_id LIMIT 41').bind(w.location.id,w.me.id,c.id).all<SavedTurn>()).results;
}
function turnView(row:SavedTurn,c:Conversation,w:Workspace,now:number,foodRevision?:number):ChatTurn{
  const scope=JSON.parse(row.scope) as ChatSource[],stale=!scopeCurrent(scope,w,new Date(now).toISOString(),foodRevision);
  const interrupted=row.status==='pending'&&(c.pending_request!==row.request_id||c.lease_until<=now);
  return {id:row.request_id,question:row.question,answer:stale?'':row.status==='complete'?checkedHypotheticalScheduleScope(row.question,checkedNoteNotification(row.question,checkedCompanionAnswer(w,JSON.parse(row.sources),row.question,row.answer,new Date(now).toISOString(),JSON.parse(row.focus??'null')))):row.answer,at:row.at,status:interrupted?'failed':row.status,stale,error:interrupted?failedMessage:row.error,sources:stale?[]:JSON.parse(row.sources),focus:stale?null:JSON.parse(row.focus??'null')};
}
async function currentTurns(db:Database,w:Workspace,c:Conversation,rows:SavedTurn[],now:number){
  const needsPrep=rows.some(row=>(JSON.parse(row.scope) as ChatSource[]).some(source=>source.kind==='food-prep'));
  const revision=needsPrep?await prepRevision(db,w.location.id):undefined;
  const valid=await validMemoryConversations(db,w,c);
  return rows.map(row=>{const turn=turnView(row,c,w,now,revision);return dependenciesCurrent(row,valid)?turn:{...turn,stale:true,answer:'',sources:[],focus:null};});
}
async function view(db:Database,identity:WorkspaceIdentity,locationId:string,configured:boolean,now:number,dailyLimit:number):Promise<ChatView>{
  const {value:w,membershipRevision}=await workspace(db,identity,locationId);
  const c=await conversation(db,w,membershipRevision),accessChanged=c.membership_revision!==membershipRevision;
  const turns=accessChanged?[]:await currentTurns(db,w,c,await savedTurns(db,w,c),now);
  return {...(w.me.capabilities.includes('location.manage')?{dailyUsage:await companionUsage(db,locationId,w.location.timezone,now,dailyLimit)}:{}),conversationId:c.id,revision:c.revision,configured,accessChanged,pending:!!c.pending_request&&c.lease_until>now,turns,full:turns.length>=40,explanationStyle:readExplanationStyle(c.explanation_style)};
}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}

function archiveSummary(row:Archive,membershipRevision:number):ChatArchive{
  const accessChanged=row.membership_revision!==membershipRevision;
  return {id:row.id,title:accessChanged?'Conversation from previous access':row.title,archivedAt:row.archived_at,turnCount:row.turn_count,accessChanged};
}
async function conversationHistory(db:Database,w:Workspace,membershipRevision:number,url:URL,now:number):Promise<ChatHistoryPage|ArchivedChat>{
  const archiveId=url.searchParams.get('archived');
  if(archiveId!==null){
    const row=await db.prepare('SELECT * FROM companion_archives WHERE location_id=? AND member_id=? AND id=?').bind(w.location.id,w.me.id,id(archiveId)).first<Archive>();
    requireThat(row,'This saved conversation is unavailable.',404);
    const summary=archiveSummary(row,membershipRevision);
    const c:Conversation={id:row.id,revision:0,membership_revision:row.membership_revision,pending_request:null,lease_until:0,last_started:0,explanation_style:'balanced'};
    return {...summary,turns:summary.accessChanged?[]:await currentTurns(db,w,c,await savedTurns(db,w,c),now)};
  }
  const cursor=url.searchParams.get('cursor');let before:Archive|null=null;
  if(cursor!==null){
    before=await db.prepare('SELECT * FROM companion_archives WHERE location_id=? AND member_id=? AND id=?').bind(w.location.id,w.me.id,id(cursor)).first<Archive>();
    requireThat(before,'Conversation history changed. Open its first page again.',409);
  }
  const rows=(await db.prepare(`SELECT * FROM companion_archives WHERE location_id=? AND member_id=? ${before?'AND (archived_at<? OR (archived_at=? AND id<?))':''} ORDER BY archived_at DESC,id DESC LIMIT 21`).bind(w.location.id,w.me.id,...(before?[before.archived_at,before.archived_at,before.id]:[])).all<Archive>()).results;
  return {conversations:rows.slice(0,20).map(r=>archiveSummary(r,membershipRevision)),nextCursor:rows.length>20?rows[19].id:null};
}

export async function handleCompanionChat(request:Request,binding?:D1Database,bindings?:unknown,fetcher:typeof fetch=fetch,clock=()=>Date.now(),product:'legacy'|'workforce'='legacy'):Promise<Response>{
  let cleanup:((message:string)=>Promise<void>)|undefined;
  const diagnosticId=crypto.randomUUID(),startedAt=Date.now();
  let stage='authenticate';
  try{
    requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
    const {db,identity,authUserId}=await authenticateWorkspace(request,binding),url=new URL(request.url),config=configuredCompanion(bindings),dailyLimit=companionDailyLimit(bindings);
    let body:Record<string,unknown>={};
    if(request.method==='POST'){
      requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open JMAX chat from your workspace.',403);
      requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
      body=object(await boundedJson(request.body,14000));
      requireThat(Object.keys(body).every(k=>['locationId','conversationId','expectedRevision','requestId','question','action','confirmed','explanationStyle','focus','archivedId'].includes(k)),'JMAX uses your server-verified identity and work context.');
      requireThat(body.archivedId===undefined||body.action==='delete-history','Choose a saved conversation only when deleting history.');
      requireThat(body.focus===undefined||body.action==='ask','Attach work only to a question.');
      requireThat(body.explanationStyle===undefined||body.action==='preferences','Save your explanation preference separately from a question.');
    }
    const locationId=id(request.method==='GET'?url.searchParams.get('locationId'):body.locationId);
    const {value:w,membershipRevision}=await workspace(db,identity,locationId);
    if(request.method==='GET')return json(url.searchParams.get('history')==='1'||url.searchParams.has('archived')?await conversationHistory(db,w,membershipRevision,url,clock()):await view(db,identity,locationId,!!config,clock(),dailyLimit));
    const c=await conversation(db,w,membershipRevision),conversationId=id(body.conversationId);
    requireThat(c.id===conversationId,'This conversation changed. Reload JMAX before sending another question.',409);
    requireThat(Number.isInteger(body.expectedRevision)&&Number(body.expectedRevision)>0,'Reload the conversation before continuing.');
    const policy=await restaurantAccessWriteGuard(db,identity,locationId);
    const authority='EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND active=1 AND revision=?) AND ('+policy.sql+')';
    const authorityValues=[w.me.id,authUserId,membershipRevision,...policy.values];
    if(body.action==='delete-history'){
      stage='delete-history';
      requireThat(Object.keys(body).every(k=>['locationId','conversationId','expectedRevision','action','archivedId','confirmed'].includes(k))&&body.confirmed===true,'Confirm deleting this saved conversation.');
      const archivedId=id(body.archivedId);
      requireThat(await db.prepare('SELECT id FROM companion_archives WHERE location_id=? AND member_id=? AND id=?').bind(locationId,w.me.id,archivedId).first(),'This saved conversation is unavailable.',404);
      const gate=`EXISTS(SELECT 1 FROM companion_conversations WHERE location_id=? AND member_id=? AND id=? AND revision=? AND (pending_request IS NULL OR lease_until<=?)) AND ${authority}`;
      const values=[locationId,w.me.id,c.id,Number(body.expectedRevision),clock(),...authorityValues];
      const result=await db.batch([
        db.prepare(`DELETE FROM companion_turns WHERE location_id=? AND member_id=? AND conversation_id=? AND ${gate}`).bind(locationId,w.me.id,archivedId,...values),
        db.prepare(`DELETE FROM companion_archives WHERE location_id=? AND member_id=? AND id=? AND ${gate}`).bind(locationId,w.me.id,archivedId,...values),
        db.prepare(`UPDATE companion_conversations SET revision=revision+1 WHERE location_id=? AND member_id=? AND ${gate}`).bind(locationId,w.me.id,...values),
      ]);
      requireThat(result[2].meta.changes,'Wait for any pending answer, then reload before deleting history.',409);
      return json(await view(db,identity,locationId,!!config,clock(),dailyLimit));
    }
    if(body.action==='clear'){
      requireThat(body.confirmed===true,'Confirm clearing this private conversation.');
      const next=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM companion_conversations WHERE location_id=? AND member_id=? AND id=?)';
      const result=await db.batch([
        db.prepare(`UPDATE companion_conversations SET id=?,revision=revision+1,membership_revision=?,pending_request=NULL,lease_until=0 WHERE location_id=? AND member_id=? AND id=? AND revision=? AND ${authority}`).bind(next,membershipRevision,locationId,w.me.id,c.id,Number(body.expectedRevision),...authorityValues),
        db.prepare(`DELETE FROM companion_turns WHERE location_id=? AND member_id=? AND conversation_id=? AND ${gate}`).bind(locationId,w.me.id,c.id,locationId,w.me.id,next),
      ]);
      requireThat(result[0].meta.changes,'The conversation changed. Reload before clearing it.',409);
      return json(await view(db,identity,locationId,!!config,clock(),dailyLimit));
    }
    if(body.action==='start-new'){
      stage='start-new';
      requireThat(Object.keys(body).every(k=>['locationId','conversationId','expectedRevision','action'].includes(k)),'Start a fresh conversation using the saved conversation reference.');
      const accessChanged=c.membership_revision!==membershipRevision;
      requireThat(accessChanged||!c.pending_request||c.lease_until<=clock(),'Wait for the current answer before starting a fresh conversation.',409);
      const turns=await savedTurns(db,w,c);requireThat(turns.length||accessChanged,'This conversation is already empty.',409);
      // Rotate under current authority, but archive under the original authority.
      // Changing the id also prevents an old in-flight answer from being saved.
      const next=crypto.randomUUID(),gate=`EXISTS(SELECT 1 FROM companion_conversations WHERE location_id=? AND member_id=? AND id=? AND revision=? ${accessChanged?'':'AND (pending_request IS NULL OR lease_until<=?)'}) AND ${authority}`;
      const values=[locationId,w.me.id,c.id,Number(body.expectedRevision),...(accessChanged?[]:[clock()]),...authorityValues];
      const result=await db.batch([
        ...(turns.length?[db.prepare(`INSERT INTO companion_archives(location_id,member_id,id,membership_revision,title,archived_at,turn_count) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(locationId,w.me.id,c.id,c.membership_revision,turns[0].question.slice(0,120),new Date(clock()).toISOString(),turns.length,...values)]:[]),
        db.prepare(`UPDATE companion_conversations SET id=?,revision=revision+1,membership_revision=?,pending_request=NULL,lease_until=0 WHERE location_id=? AND member_id=? AND ${gate}`).bind(next,membershipRevision,locationId,w.me.id,...values),
      ]);
      requireThat(result.every(r=>r.meta.changes),'This conversation changed. Reload before starting fresh.',409);
      return json(await view(db,identity,locationId,!!config,clock(),dailyLimit));
    }
    requireThat(c.membership_revision===membershipRevision,'Your account was updated. Choose Continue with JMAX to use your current access and keep the previous conversation saved.',409);
    if(body.action==='preferences'){
      stage='preferences';
      requireThat(Object.keys(body).every(k=>['locationId','conversationId','expectedRevision','action','explanationStyle'].includes(k)),'Choose only your explanation preference.');
      requireThat(typeof body.explanationStyle==='string'&&explanationStyles.some(s=>s===body.explanationStyle),'Choose brief, balanced or step-by-step explanations.');
      requireThat(!c.pending_request||c.lease_until<=clock(),'Wait for the current answer before changing your explanation preference.',409);
      const saved=await db.prepare(`UPDATE companion_conversations SET explanation_style=?,revision=revision+1,pending_request=NULL,lease_until=0 WHERE location_id=? AND member_id=? AND id=? AND revision=? AND (pending_request IS NULL OR lease_until<=?) AND ${authority}`).bind(body.explanationStyle,locationId,w.me.id,c.id,Number(body.expectedRevision),clock(),...authorityValues).run();
      requireThat(saved.meta.changes,'Your conversation or preference changed. Reload before saving again.',409);
      return json(await view(db,identity,locationId,!!config,clock(),dailyLimit));
    }
    requireThat(body.action==='ask','Choose a supported conversation action.');
    let selected:Pick<ChatSource,'id'|'revision'>|undefined;
    if(body.focus!==undefined){
      const ref=object(body.focus);
      requireThat(Object.keys(ref).length===2&&Object.keys(ref).every(k=>['id','revision'].includes(k)),'Attach only the saved item reference.');
      requireThat(Number.isSafeInteger(ref.revision)&&Number(ref.revision)>0,'Reopen the item before asking JMAX.');
      selected={id:id(ref.id),revision:Number(ref.revision)};
    }
    const requestId=id(body.requestId),question=text(body.question,'Question',2000),fingerprint=await digest(conversationId+'\n'+question+(selected?'\n'+JSON.stringify(selected):''));
    const previous=await db.prepare('SELECT * FROM companion_turns WHERE location_id=? AND member_id=? AND request_id=?').bind(locationId,w.me.id,requestId).first<SavedTurn>();
    if(previous){
      requireThat(previous.conversation_id===c.id&&previous.fingerprint===fingerprint,'That request identifier belongs to a different question.',409);
      return json(await view(db,identity,locationId,!!config,clock(),dailyLimit));
    }
    stage='configuration';
    requireThat(config,'Live JMAX chat has not been connected in this environment yet.',503);
    stage='limits';
    const now=clock(),hour=Math.floor(now/3600000),at=new Date(now).toISOString();
    const turns=await savedTurns(db,w,c);requireThat(turns.length<40,'This conversation is full. Start a fresh conversation to keep this one in your private history.',409);
    requireThat(!c.pending_request||c.lease_until<=now,'JMAX is already answering. Reload the conversation in a moment.',409);
    requireThat(c.last_started<=now-5000,'Give JMAX a few seconds before asking another question.',429);
    const usage=await db.prepare('SELECT hour,count FROM companion_limits WHERE location_id=? AND member_id=?').bind(locationId,w.me.id).first<{hour:number;count:number}>();
    requireThat(!usage||usage.hour!==hour||usage.count<30,'You have reached this hour’s JMAX conversation limit. Try again next hour.',429);
    const daily=await companionUsage(db,locationId,w.location.timezone,now,dailyLimit);
    requireThat(daily.used<dailyLimit,dailyLimitMessage,429);
    stage='context';
    const validTurns=(await currentTurns(db,w,c,turns,now)).filter(t=>t.status==='complete'&&!t.stale&&(product==='legacy'||t.sources.every(s=>['schedule-week','shift','goal','standard','food-prep','close','task','handoff','leadership'].includes(s.kind)))).slice(-8);
    const previousRow=[...turns].reverse().find(t=>t.status==='complete');
    const previousWork=previousRow?{focus:JSON.parse(previousRow.focus??'null') as ChatSource|null,sources:JSON.parse(previousRow.sources) as ChatSource[]}:undefined;
    const inferredFocus=product==='workforce'&&!selected?currentFollowupFocus(w,question,at,previousWork):undefined;
    const current=(product==='workforce'?workforceContext:companionContext)(w,question,at,validTurns.at(-1)?.sources??[],selected??inferredFocus);
    const prepFollowup=!!previousWork?.sources.some(s=>s.kind==='food-prep')&&operationalFollowup(question);
    const guidePrep=!!selected&&current.selectedWork?.kind==='standard'&&prepQuestion(question);
    const prep=(!selected&&!inferredFocus||guidePrep)&&!w.me.scheduleOnly&&(prepQuestion(question)||prepFollowup)?await readPrepContext(db,w):null;
    if(prep){
      const entry={source:prep.source,facts:prep.facts,localTimes:{}};
      current.scope.push(prep.source);current.evidence.push(entry);
      Object.assign(current.context,{assignedPrep:prep.facts});
    }
    const cupCalculation=companionBackWindowCups(question,current.evidence);
    if(cupCalculation)Object.assign(current.context,{backWindowCupCalculation:cupCalculation});
    if(previousRow&&!validTurns.some(t=>t.id===previousRow.request_id)&&operationalFollowup(question))Object.assign(current.context,{previousWorkChanged:{meaning:'The previous answer is stale or no longer authorized. Use only the current supplied records. If a previous assignment is now absent, do not assume it is still owned by this person, complete, transferred, or approved; distinguish the user’s report from verified current ownership.'}});
    const gate='EXISTS(SELECT 1 FROM companion_conversations WHERE location_id=? AND member_id=? AND id=? AND pending_request=?)';
    const gateValues=[locationId,w.me.id,c.id,requestId];
    stage='reserve';
    const start=await db.batch([
      db.prepare(`UPDATE companion_conversations SET pending_request=?,lease_until=?,last_started=?,revision=revision+1 WHERE location_id=? AND member_id=? AND id=? AND revision=? AND (pending_request IS NULL OR lease_until<=?) AND last_started<=? AND ${authority} AND EXISTS(SELECT 1 FROM locations WHERE id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM companion_limits WHERE location_id=? AND member_id=? AND hour=? AND count>=30) AND NOT EXISTS(SELECT 1 FROM companion_daily_usage WHERE location_id=? AND day=? AND count>=?)`).bind(requestId,now+60000,now,locationId,w.me.id,c.id,Number(body.expectedRevision),now,now-5000,...authorityValues,locationId,w.location.revision,locationId,w.me.id,hour,locationId,daily.day,dailyLimit),
      db.prepare(`INSERT INTO companion_daily_usage(location_id,day,count) SELECT ?,?,1 WHERE ${gate} ON CONFLICT(location_id,day) DO UPDATE SET count=companion_daily_usage.count+1`).bind(locationId,daily.day,...gateValues),
      db.prepare(`INSERT INTO companion_limits(location_id,member_id,hour,count) SELECT ?,?,?,1 WHERE ${gate} ON CONFLICT(location_id,member_id) DO UPDATE SET hour=excluded.hour,count=CASE WHEN companion_limits.hour=excluded.hour THEN companion_limits.count+1 ELSE 1 END`).bind(locationId,w.me.id,hour,...gateValues),
      db.prepare(`UPDATE companion_turns SET status='failed',error=? WHERE location_id=? AND member_id=? AND conversation_id=? AND status='pending' AND ${gate}`).bind(failedMessage,locationId,w.me.id,c.id,...gateValues),
      db.prepare(`INSERT INTO companion_turns(location_id,member_id,request_id,conversation_id,fingerprint,question,status,scope,at,focus) SELECT ?,?,?,?,?,?,'pending',?,?,? WHERE ${gate}`).bind(locationId,w.me.id,requestId,c.id,fingerprint,question,JSON.stringify(current.scope),at,JSON.stringify(current.selectedWork??null),...gateValues),
    ]);
    if(!start[0].meta.changes){const latest=await companionUsage(db,locationId,w.location.timezone,now,dailyLimit);requireThat(latest.used<dailyLimit,dailyLimitMessage,429);}
    requireThat(start[0].meta.changes,'The conversation or your work changed. Reload before trying again.',409);
    cleanup=async(message)=>{await db.batch([
      db.prepare(`UPDATE companion_turns SET status='failed',error=? WHERE location_id=? AND member_id=? AND request_id=? AND status='pending' AND ${gate}`).bind(message,locationId,w.me.id,requestId,...gateValues),
      db.prepare('UPDATE companion_conversations SET pending_request=NULL,lease_until=0,revision=revision+1 WHERE location_id=? AND member_id=? AND id=? AND pending_request=?').bind(...gateValues),
    ]);};
    const history=('generalLearningQuestion' in current.context&&current.context.generalLearningQuestion?[]:'scopeMode' in current.context&&String(current.context.scopeMode).startsWith('selected-')?validTurns.filter(t=>t.focus?.id===current.selectedWork?.id&&t.focus?.revision===current.selectedWork?.revision):validTurns).map(t=>({question:t.question,answer:t.answer,focus:t.focus}));
    const recalled=await readCompanionMemory(db,w,c,question,now,{excludeIds:validTurns.map(t=>t.id),selectedWork:current.selectedWork,generalLearningQuestion:'generalLearningQuestion' in current.context&&!!current.context.generalLearningQuestion,workforce:product==='workforce'});
    const usedHistory=turns.filter(row=>history.some(t=>t.question===row.question&&t.answer===row.answer));
    const memoryRefs=memoryReferences([...usedHistory,...recalled.rows],c.id);
    Object.assign(current.context,{priorConversationMemory:{entries:recalled.entries,selection:'Relevant excerpts from retained conversations for this employee in this restaurant, plus recent context. This is not the complete history.',limits:['Historical user statements are reports, not approved operating instructions.','Current authorized work and approved methods supersede earlier answers.','Do not claim to remember details not supplied.']}});
    const additionalCups=companionBackWindowAdditionalCups(question,current.evidence,history);
    if(additionalCups)Object.assign(current.context,{backWindowAdditionalCups:additionalCups});
    stage='provider';
    const reply=await askCompanion(config,{...current.context,communicationPreference:{explanationStyle:readExplanationStyle(c.explanation_style)}},history,question,current.evidence.map(e=>e.source),fetcher);
    if(current.selectedWork&&!reply.sources.some(s=>s.id===current.selectedWork!.id))reply.sources.unshift(current.selectedWork);
    reply.answer=checkedCompanionAnswer(w,reply.sources,question,reply.answer,at,current.selectedWork);
    reply.answer=companionClosingNext(w,reply.sources,question,reply.answer,at,current.selectedWork)??reply.answer;
    reply.answer=companionCorrectionNote(w,reply.sources,question,reply.answer,at,current.selectedWork);
    const prepAnswer=checkedPrepHelp(current.context,prep?[...reply.sources,prep.source]:reply.sources,question,reply.answer);
    if(prepAnswer!==reply.answer&&prep&&!reply.sources.some(s=>s.id===prep.source.id))reply.sources.push(prep.source);
    reply.answer=prepAnswer;
    const topUpAnswer=checkedBackWindowTopUp(question,reply.answer,current.evidence);
    if(topUpAnswer!==reply.answer)for(const e of current.evidence)if(e.source.kind==='standard'&&!reply.sources.some(s=>s.id===e.source.id))reply.sources.push(e.source);
    reply.answer=topUpAnswer;
    const paceAnswer=checkedHostPace(current.context,question,reply.answer);
    if(paceAnswer!==reply.answer)for(const e of current.evidence)if(e.source.kind==='standard'&&!reply.sources.some(s=>s.id===e.source.id))reply.sources.push(e.source);
    reply.answer=paceAnswer;
      reply.answer=checkedStockAssumptions(current.context,question,reply.answer,history);
    const additionalAnswer=checkedBackWindowAdditionalCups(question,reply.answer,current.evidence,history);
    if(additionalAnswer!==reply.answer&&additionalCups)for(const source of additionalCups.sources)if(!reply.sources.some(s=>s.id===source.id&&s.revision===source.revision))reply.sources.push(source);
    reply.answer=additionalAnswer;
    const cupReferences=companionBackWindowCupReferences(question,current.evidence);
    if(cupReferences){
      reply.answer=cupReferences.answer;
      for(const source of cupReferences.sources)if(!reply.sources.some(s=>s.id===source.id&&s.revision===source.revision&&s.kind===source.kind))reply.sources.push(source);
    }
    const shiftRelease=companionShiftReleaseBoundary(current.context,question);
    if(shiftRelease&&shiftRelease.sources.every(source=>current.evidence.some(e=>e.source.id===source.id&&e.source.revision===source.revision&&e.source.kind===source.kind))){
      reply.answer=shiftRelease.answer;
      reply.sources=shiftRelease.sources;
    }
    reply.answer=checkedNoteNotification(question,reply.answer);
    reply.answer=checkedHypotheticalScheduleScope(question,reply.answer);
    stage='verify';
    const fresh=await workspace(db,identity,locationId);
    requireThat(fresh.membershipRevision===membershipRevision&&fresh.value.location.revision===w.location.revision,'Your access or saved work changed while JMAX was answering. Ask again with the latest information.',409);
    requireThat(await recalledRowsStillPresent(db,fresh.value,c,[...usedHistory,...recalled.rows]),'Saved conversation memory changed while JMAX was answering. Ask again with the latest information.',409);
    const memoryFoodRevision=recalled.validationSources.some(s=>s.kind==='food-prep')?await prepRevision(db,locationId):undefined;
    requireThat(scopeCurrent(recalled.validationSources,fresh.value,new Date(clock()).toISOString(),memoryFoodRevision),'Remembered work or instructions changed while JMAX was answering. Ask again with the latest information.',409);
    const currentFoodRevision=current.scope.some(source=>source.kind==='food-prep')?await prepRevision(db,locationId):undefined;
    requireThat(scopeCurrent(current.scope,fresh.value,new Date(clock()).toISOString(),currentFoodRevision),'Current work or instructions changed while JMAX was answering. Ask again with the latest information.',409);
    if(prep)requireThat(await prepRevision(db,locationId)===prep.source.revision,'Prep assignments changed while JMAX was answering. Ask again with the latest information.',409);
    const finishGate=`${gate} AND ${authority} AND EXISTS(SELECT 1 FROM locations WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM companion_conversations WHERE location_id=? AND member_id=? AND lease_until>?)${prep?' AND COALESCE((SELECT revision FROM food_state WHERE location_id=?),0)=?':''}`;
    const finishValues=[...gateValues,...authorityValues,locationId,w.location.revision,locationId,w.me.id,clock(),...(prep?[locationId,prep.source.revision]:[])];
    stage='persist';
    const saved=await db.batch([
      db.prepare(`UPDATE companion_turns SET answer=?,sources=?,status='complete',model=?,memory_refs=? WHERE location_id=? AND member_id=? AND request_id=? AND status='pending' AND ${finishGate}`).bind(reply.answer,JSON.stringify(reply.sources),reply.model,JSON.stringify(memoryRefs),locationId,w.me.id,requestId,...finishValues),
      db.prepare(`UPDATE companion_conversations SET pending_request=NULL,lease_until=0,revision=revision+1 WHERE location_id=? AND member_id=? AND ${finishGate}`).bind(locationId,w.me.id,...finishValues),
    ]);
    requireThat(saved[0].meta.changes&&saved[1].meta.changes,'This conversation changed before the answer could be saved. Reload JMAX.',409);
    cleanup=undefined;
    return json(await view(db,identity,locationId,true,clock(),dailyLimit));
  }catch(error){
    const shouldLog=!!cleanup||error instanceof CompanionFailure||!(error instanceof AppError)||stage==='configuration';
    const publicMessage=(error instanceof AppError?error.message:failedMessage)+(shouldLog?` Reference: ${diagnosticId}`:'');
    let cleanupSucceeded:boolean|undefined;
    try{if(cleanup){await cleanup(publicMessage);cleanupSucceeded=true;}}catch{cleanupSucceeded=false;}
    if(shouldLog){
      const message=error instanceof Error?error.message:'';
      const category=error instanceof CompanionFailure?error.category:stage==='configuration'?'configuration':error instanceof AppError?'work-or-access-changed':/illegal invocation/i.test(message)?'invocation':/certificate|tls/i.test(message)?'transport-trust':/timeout|timed out/i.test(message)?'timeout':/D1_ERROR|SQLITE/i.test(message)?'database':'unexpected';
      console.error(JSON.stringify({event:'companion_request_failed',diagnosticId,stage,category,elapsedMs:Math.max(0,Date.now()-startedAt),...(error instanceof CompanionFailure?{providerStatus:error.providerStatus}:{}),...(cleanupSucceeded!==undefined?{cleanupSucceeded}:{})}));
    }
    return json({error:publicMessage,...(shouldLog?{reference:diagnosticId}:{})},error instanceof AppError?error.status:503);
  }
}
