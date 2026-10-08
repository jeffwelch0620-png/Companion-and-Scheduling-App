import {shiftContextWorkspace} from './shift-context';
import {shiftStationName} from './station-assignment';
import {personName} from './types';
import { publicWorkspace } from './domain';
import { companionContext } from './companion-context';
import { currentWeek, scheduleWeekDate, workforceWeek } from './workforce-planning';
import { requireThat } from './validation';
import type { RecordOf, WorkRecord, Workspace } from './types';
import type { ChatSource } from './companion-chat-types';
import { scheduleSalesCheck } from './schedule-sales';
import { myWork } from './my-work';
import {personalLearning} from './personal-learning';
import { displayTime } from './local-time';
import {buildShiftBrief} from './shift-brief';
import {canManageClosing} from './closing-access';
import {closingStatus as requiredClosingStatus} from './closing-status';

const closingLimits=['Saved closing conditions and corrections are evidence of recorded work, not a physical inspection. Explain the assigned next step and the named performer/checkers.','A Companion conversation never saves Ready, passes or fixes a check, verifies work, or releases a shift. Use the linked assignment for a factual submission and the independent assigned checker for physical confirmation; manager checkout remains separate.'];
// A source cited in an earlier answer is a reference, not a permanent topic.
// Keep ordinary checkout language useful without pulling a new service question
// into closing merely because its previous answer happened to cite a close.
export function closingQuestionIntent(question:string,focus:ChatSource[]=[]){
 const words=question.replace(/’/g,"'");
 const direct=/\b(?:closing|checkout|check[ -]?out|side[ -]?work|physical check|remaining work)\b|\bbefore (?:i |we )?(?:leave|go)\b|\b(?:can|may) (?:i|we) (?:leave|go(?: home)?)\b|\b(?:good|okay|ok) to go\b|\bcheck (?:me|us) (?:out|off)\b|\b(?:my |our |the )?shift(?: time)?(?:'s | (?:is |has |has already |is already )?)(?:over|ended|done|finished)\b|\b(?:am i|are we) (?:done|finished)\b/i.test(words);
 if(direct||/\b(?:my|our|this|that|the|assigned|returned|pending)\s+(?:saved\s+|station\s+)?close\b/i.test(words))return true;
 const priorClosing=focus.some(source=>source.kind==='close'||source.kind==='task');
 if(!priorClosing)return false;
 const newServiceTopic=/\b(?:host|podium|arrivals?|arrive|arrived|arriving|guests?|seating|greeting|greet|welcome|drinks?|appetizers?|entrees?|entrées?|dessert|table service|taking orders|service rhythm|food runner|expo|fry|grill|pizza|oven|learning|training|schedule|availability|time off|prep|coaching|sequence)\b/i.test(words);
 if(newServiceTopic)return false;
 if(/\bcorrection\b/i.test(words))return true;
 const pronoun=/\b(?:it|this|that|these|those|they|them|we)\b/i.test(words);
 const continuation=/\b(?:ready|waiting|accepted|next|last|remaining|still|now|check|done|finished|explain|mean|who)\b/i.test(words);
 const shortNext=/^\s*(?:and\s+)?(?:what(?:'s| is| happens) next|what (?:is |are )?(?:still|left|remaining)|who (?:checks|does|verifies))(?:\b|[?])/i.test(words);
 return pronoun&&continuation||shortNext;
}
function closingStatus(w:Workspace,shift:RecordOf<'shift'>,at:string){
 const assignedCloses=w.records.filter((r):r is RecordOf<'close'>=>r.kind==='close'&&r.data.shiftId===shift.id&&r.data.phase!=='cancelled').map(r=>({id:r.id,phase:r.data.phase}));
 const required=requiredClosingStatus(w,shift,{allowProjectedReceipts:true}),linkedTasks=required.tasks.map(r=>({id:r.id,phase:r.data.phase,owner:personName(w,r.ownerId)}));
 const next=buildShiftBrief(w,at).items.find(item=>item.record.id===shift.id);
 return {shiftId:shift.id,releaseRecorded:!!shift.data.releasedAt,assignedCloses,linkedTasks,pendingOutgoingAcceptanceIds:required.pendingDishHandoffIds,complete:required.complete,nextAction:next?.next,reason:next?.reason,meaning:'Recorded workflow state only. Incoming acceptance transfers responsibility; it does not complete PM work. Physical checks and a separate manager release are required; this conversation cannot perform them.'};
}
function closingContextWorkspace(w:Workspace,work:WorkRecord[]):Workspace {
 const ids=new Set(work.map(r=>r.id));
 const people=new Set([w.me.id,...work.map(r=>r.ownerId)]);
 for(const r of work)if(r.kind==='task')for(const personId of [r.data.incomingId,r.data.closingHandoff?.outgoingId,r.data.closingHandoff?.acceptedBy])if(personId)people.add(personId);
 for(const r of work)if(r.kind==='task'&&r.data.shiftId)for(const member of w.members)if(member.id!==r.ownerId&&member.locationId===r.locationId&&canManageClosing(member,r.area,'tasks.manage'))people.add(member.id);
 for(const r of work)if(r.kind==='close'){
  for(const personId of [r.data.managerId,r.data.verifierId,r.data.correction?.personId])if(personId)people.add(personId);
  for(const guide of w.records)if(guide.kind==='standard'&&guide.id===r.data.standardId&&guide.locationId===r.locationId&&guide.area===r.area&&guide.revision===r.data.standardRevision&&guide.data.status==='approved')ids.add(guide.id);
  // Retain only the authorized leadership that establishes this checker's role.
  for(const leader of w.records)if(leader.kind==='leadership'&&leader.locationId===r.locationId&&leader.area===r.area&&leader.data.active&&leader.data.personId===r.data.managerId&&leader.data.start<=r.data.due&&leader.data.end>=r.data.due)ids.add(leader.id);
 }
 return {...w,records:w.records.filter(r=>ids.has(r.id)),members:w.members.filter(m=>people.has(m.id)),learningHistory:[],formerMembers:w.formerMembers?.filter(m=>people.has(m.id))};
}

export function workforceContext(raw:Workspace,question:string,at:string,focus:ChatSource[]=[],selected?:Pick<ChatSource,'id'|'revision'>) {
  const w=publicWorkspace(raw,at),week=selected?scheduleWeekDate(selected.id):null;
  const shift=selected?w.records.find(r=>r.id===selected.id&&r.kind==='shift'):undefined;
  if(shift?.kind==='shift'){
    const scoped=shiftContextWorkspace(w,shift),base=companionContext(scoped,question,at,[],selected,raw);
    return {...base,context:{...base.context,product:'workforce',generalLearningQuestion:false,scopeMode:'selected-shift',selectedEmployee:{id:shift.ownerId,name:personName(w,shift.ownerId)},selectedShift:{id:shift.id,station:shiftStationName(shift),start:shift.data.start,end:shift.data.end},closingStatus:closingStatus(scoped,shift,at),limits:[...base.context.limits,...closingLimits,'Answer only about this selected employee and shift, using the attached saved facts. The signed-in person is the viewer, not necessarily the employee. Other employees, other days and the full restaurant week are outside this view. If the requested information is absent, say so. Never infer a skill rating or clearance.']}};
  }
  const closingWork=selected?w.records.find(r=>r.id===selected.id&&(r.kind==='close'||r.kind==='task')):undefined;
  if(closingWork){
    const linkedShift=w.records.find(r=>r.kind==='shift'&&r.id===(closingWork.kind==='close'?closingWork.data.shiftId:closingWork.kind==='task'?closingWork.data.shiftId:undefined));
    const scoped=closingContextWorkspace(w,[closingWork,...(linkedShift?[linkedShift]:[])]),base=companionContext(scoped,question,at,[],selected,raw);
    return {...base,context:{...base.context,product:'workforce',generalLearningQuestion:false,scopeMode:closingWork.kind==='task'&&!closingWork.data.shiftId?'selected-task':'selected-closing-work',selectedEmployee:{id:closingWork.ownerId,name:personName(w,closingWork.ownerId)},limits:[...base.context.limits,...closingLimits,'Answer only about the attached saved work and its linked shift, if one exists. An unlinked task does not block shift checkout. Do not include other employees, other shifts or unrelated guides. A missing or retired approved method must stay missing; ask the assigned manager for current approved instructions.']}};
  }
  const goal=selected?w.records.find(r=>r.id===selected.id&&r.kind==='goal'):undefined;
  if(goal?.kind==='goal'){
    const records=w.records.filter(r=>r.id===goal.id||r.kind==='standard'&&r.id===goal.data.standardId&&r.revision===goal.data.standardRevision&&r.data.status==='approved'&&r.area===goal.area);
    const people=new Set([w.me.id,goal.ownerId,goal.data.managerId]);
    const scoped={...w,records,members:w.members.filter(m=>people.has(m.id)),learningHistory:[],formerMembers:w.formerMembers?.filter(m=>people.has(m.id))};
    const base=companionContext(scoped,question,at,[],selected,raw);
    return {...base,context:{...base.context,product:'workforce',generalLearningQuestion:false,scopeMode:'selected-learning',selectedEmployee:{id:goal.ownerId,name:personName(w,goal.ownerId)},reportedPractice:{checkedCriteria:goal.data.practiceChecks??[],meaning:'Employee-reported practice only; the reviewing manager confirms the outcome.'},limits:[...base.context.limits,'Answer only about this selected employee and learning goal, using its current approved instructions. The signed-in person is the viewer, not necessarily the learner. Other employees, goals and the restaurant schedule are outside this view. Do not infer station clearance or completed training from checked practice steps.']}};
  }
  const guide=selected?w.records.find(r=>r.id===selected.id&&r.kind==='standard'):undefined;
  if(guide?.kind==='standard'){
    // An explicit guide is a reusable reference, not a schedule snapshot. Only
    // its current revision and the viewer's current access govern continuity.
    // Do not invalidate it when unrelated tasks change the restaurant revision.
    const scoped={...w,records:[guide],members:[w.me],learningHistory:[],formerMembers:[]};
    const base=companionContext(scoped,question,at,[],selected,raw);
    return {...base,context:{...base.context,product:'workforce',generalLearningQuestion:false,scopeMode:'selected-guide',limits:[...base.context.limits,'Answer only about this selected approved guide. It is a learning or operating reference, not a saved assignment, shift, closing check or station clearance. The signed-in person’s recorded station clearances remain the only supplied clearance facts; do not infer permission or completed training from reading or discussing this guide. Current assigned work and the restaurant schedule are outside this reference view. Closing inspection requirements apply only when separately assigned as closing work.']}};
  }
  const learningCase=selected?w.records.find(r=>r.id===selected.id&&r.kind==='learningcase'):undefined;
  if(learningCase?.kind==='learningcase'){
    const scoped={...w,records:[learningCase],members:[w.me],learningHistory:[],formerMembers:[]};
    const base=companionContext(scoped,question,at,[],selected,raw);
    return {...base,context:{...base.context,product:'workforce',generalLearningQuestion:false,scopeMode:'selected-operational-history',limits:[...base.context.limits,'This selected case is an explicitly shared reviewed historical observation, not an approved instruction or a current work assignment. Do not expose private source-task bodies or infer repair authorization, cause, clearance or current restoration.']}};
  }
  if(week)requireThat(selected?.revision===w.location.revision+1,'The schedule or team changed. Review the latest week before asking JMAX.',409);
  const closingFocus=focus.filter(source=>w.records.some(r=>r.id===source.id&&(r.kind==='close'||r.kind==='task'&&!!r.data.shiftId)));
  const closingQuestion=!selected&&!week&&closingQuestionIntent(question,closingFocus);
  if(closingQuestion){
    const own=myWork(w,at),dedicatedIds=new Set(own.shift?requiredClosingStatus(w,own.shift,{allowProjectedReceipts:true}).tasks.map(r=>r.id):[]),work=w.records.filter(r=>r.kind==='close'&&r.data.phase!=='cancelled'&&(r.ownerId===w.me.id||r.data.correction?.personId===w.me.id||r.data.managerId===w.me.id||r.data.verifierId===w.me.id)&&(!['closed'].includes(r.data.phase)||r.data.shiftId===own.shift?.id)||r.kind==='task'&&(dedicatedIds.has(r.id)||!!r.data.shiftId&&(r.data.phase!=='closed'||r.data.shiftId===own.shift?.id)&&(r.ownerId===w.me.id||r.data.incomingId===w.me.id||r.data.closingHandoff?.outgoingId===w.me.id)));
    const shiftIds=new Set(work.flatMap(r=>r.kind==='close'?[r.data.shiftId]:r.kind==='task'&&r.data.shiftId?[r.data.shiftId]:[]));
    if(own.shift)shiftIds.add(own.shift.id);
    const scoped=closingContextWorkspace(w,[...work,...(work.some(r=>r.kind==='close')?[]:own.guides),...w.records.filter(r=>r.kind==='shift'&&shiftIds.has(r.id))]),base=companionContext(scoped,question,at,focus.filter(s=>['close','task','shift','standard'].includes(s.kind)),undefined,raw);
    return {...base,context:{...base.context,product:'workforce',generalLearningQuestion:false,scopeMode:'my-closing-work',closingStatus:own.shift?closingStatus(scoped,own.shift,at):undefined,myShift:own.ambiguous?{status:'conflicting assignments'}:own.shift?{sourceId:own.shift.id,job:own.shift.data.position,station:own.station,stationAssigned:!!own.shift.data.stationId,startLocal:displayTime(own.shift.data.start,w.location.timezone),endLocal:displayTime(own.shift.data.end,w.location.timezone),status:own.checkoutPending?'scheduled shift ended; operational checkout pending':own.current?'currently scheduled':'next published shift'}:{status:'no current or upcoming published shift selected'},limits:[...base.context.limits,...closingLimits,'This closing answer uses only your authorized assigned work or your named checker/helper responsibilities. Other workers and unrelated station methods are outside this view. If no saved assignment or current approved method is supplied, state that gap and ask the manager.']}};
  }
  // Preserve reusable operational context construction, but the active product
  // retrieves only workforce and learning records. Existing private history is
  // retained without treating old ordering/operations answers as current scope.
  const learning={...w,records:w.records.filter(r=>['shift','standard','goal','station','proficiency','availability','request','staffing'].includes(r.kind))};
  const generalLearningQuestion=!selected&&/\b(?:how|what|who|explain)\b/i.test(question)&&/\b(?:a|any) (?:learning |development |training )?goal\b|\blearning goals\b/i.test(question)&&!/\b(?:my|our|this|that|these|those|his|her|their)\s+(?:saved |learning |development )?goals?\b/i.test(question)&&!w.records.some(r=>r.kind==='goal'&&r.data.title.length>5&&question.toLowerCase().includes(r.data.title.toLowerCase()));
  const base=companionContext(generalLearningQuestion?{...learning,records:[]}:learning,question,at,(generalLearningQuestion?[]:focus).filter(s=>['standard','goal','learningcase'].includes(s.kind)),week?undefined:selected,generalLearningQuestion||week?{...raw,records:[]}:raw);
  const snapshot=workforceWeek(w,week??currentWeek(w,at));
  const facts=snapshot.facts;
  const own=myWork(w,at),path=personalLearning(w,at);
  const myShift=own.ambiguous?{status:'conflicting assignments',instruction:'Ask the person to confirm their station with their manager; do not choose one.'}:own.shift?{status:own.checkoutPending?'scheduled shift ended; operational checkout pending':own.current?'currently scheduled':'next published shift',sourceId:own.shift.id,job:own.shift.data.position,station:own.station,stationAssigned:!!own.shift.data.stationId,startLocal:displayTime(own.shift.data.start,w.location.timezone),endLocal:displayTime(own.shift.data.end,w.location.timezone),approvedGuideIds:own.guides.map(g=>g.id),learningGoalIds:own.relatedGoals.map(g=>g.id)}:{status:'no upcoming published shift within seven days',job:w.me.position,stationAssigned:false,approvedGuideIds:own.guides.map(g=>g.id)};
  const salesCheck=scheduleSalesCheck(question,facts.totals);
  const lists=[facts.shifts,facts.staffing,facts.hours,facts.proficiency,facts.availability,facts.trainingOpportunities];
  while(JSON.stringify(facts).length>28000){const longest=lists.filter(a=>a.length).sort((a,b)=>JSON.stringify(b).length-JSON.stringify(a).length)[0];if(!longest)break;longest.pop();facts.omittedRecords++;}
  const evidence=generalLearningQuestion?[]:[{source:snapshot.source,facts,localTimes:{}},...(week?[]:base.evidence)];
  return {scope:generalLearningQuestion?[]:[snapshot.source,...(week?[]:base.scope)],evidence,selectedWork:week?snapshot.source:base.selectedWork,context:{...base.context,generalLearningQuestion,myLearning:{confirmed:path.completed,available:path.items.length,next:path.next?{guideId:path.next.guide.id,guideRevision:path.next.guide.revision,title:path.next.guide.data.title,goalId:path.next.goal?.id,phase:path.next.goal?.data.phase??'available',action:path.next.goal?'Continue the saved learning step in My day.':'Use Start practice in My day; no manager-created goal is needed.'}:null},...(generalLearningQuestion?{learningWorkflow:{purpose:'Agree on an observable learning outcome and practice it with support.',steps:['Approved job and station guides automatically form the employee’s learning path. My day surfaces the current next step.','Start practice saves the guide criteria and reviewer automatically. Custom goals remain optional.','Employee records practice and requests help; reviewer gives coaching.','Employee submits readiness for review.','Assigned reviewing manager verifies the outcome or returns it for more practice.'],limits:'A goal is not an operating procedure, station clearance or completed physical check. Use current approved instructions for the work.'}}:{}),product:'workforce',...(!generalLearningQuestion?{myShift}:{}),selectedWork:week?snapshot.source:base.selectedWork,evidence,salesCheck,omittedRecords:(week?0:base.context.omittedRecords)+facts.omittedRecords,limits:[...facts.limits,'For an attached schedule week, this answer has workforce facts only. For station methods, open Training, choose Guides, open an available approved guide and use its Ask JMAX button. If no approved guide is available, ask the manager to supply and approve it; employees cannot upload or approve guides here.','Ordering, purchasing, inventory, costing and overnight shift-handoff execution are outside the active Companion scope. Assigned closing guidance is supported; chat does not save readiness, perform physical checks or release a shift.']}};
}
