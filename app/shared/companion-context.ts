import {scheduleChangeContext} from './schedule-change-context';
import {prepSourceId} from './companion-prep';
import { publicWorkspace } from './domain';
import { shiftStationName } from './station-assignment';
import { assignedStandardCurrent } from './station-knowledge';
import { buildShiftBrief } from './shift-brief';
import { displayTime } from './local-time';
import { rankedCompanionRecords } from './companion-retrieval';
import { canAskAbout, chatSource } from './companion-focus';
import { requireThat } from './validation';
import { closingRole } from './companion-close-role';
import { personName, type WorkRecord, type Workspace } from './types';
import type { ChatSource } from './companion-chat-types';
import { scheduleWeekDate } from './workforce-planning';
import {operationalLearningContext,operationalLearningSourceCurrent} from './operational-learning-context';

// Build from the same filtered view as the UI, then deliberately leave out
// Inbox text, personal feedback, assessment ratings and unapproved source files.
export function companionContext(raw:Workspace, question:string, at:string, focus:ChatSource[]=[], selected?:Pick<ChatSource,'id'|'revision'>,learningValidationWorkspace:Workspace=raw ) {
  const w=publicWorkspace(raw,at), brief=buildShiftBrief(w,at);
  const selectedRecord=selected?w.records.find(r=>r.id===selected.id):undefined;
  if(selected){
    requireThat(selectedRecord&&canAskAbout(selectedRecord),'This item is no longer available for JMAX guidance. Reopen your work or remove the attachment.',409);
    requireThat(selectedRecord.revision===selected.revision,'This item changed. Review its latest version before asking JMAX.',409);
  }
  const name=(id:string|undefined)=>personName(w,id,'Not assigned');
  const source=(r:WorkRecord,title:string):ChatSource=>({id:r.id,revision:r.revision,title,kind:r.kind});
  const candidates=rankedCompanionRecords(w,question,at,focus,selectedRecord?.id);
  if(selectedRecord){const index=candidates.findIndex(r=>r.id===selectedRecord.id);if(index>=0)candidates.splice(index,1);candidates.unshift(selectedRecord);}
  const learning=operationalLearningContext(learningValidationWorkspace,question,at,selectedRecord);
  const evidence:{source:ChatSource; facts:unknown;localTimes:Record<string,string>}[]=[...learning.evidence],scope:ChatSource[]=[...learning.scope];
  let omitted=learning.omitted,characters=JSON.stringify(learning.evidence).length;
  for(const r of candidates){
    let facts:unknown,title='',dependency:ChatSource|undefined;
    if(r.kind==='standard'){
      if(r.data.status!=='approved')continue;
      title=r.data.title; facts={authority:'approved standard',position:r.data.position,zone:r.data.zone,version:r.data.version,source:r.data.source,criteria:r.data.criteria,guide:r.data.guide,methodAvailable:!!r.data.guide?.steps.length,trainingClearanceRecorded:w.me.qualifications.includes(r.data.position),verification:r.data.verification,verificationScope:'These closing physical checks apply when this guide is assigned as closing work; a guide does not require a closing inspection for each ordinary service item.',requiredPhysicalChecks:r.data.verification==='senior-then-manager'?['Designated capable senior or lead performs the first physical check','Closing manager performs a separate final physical confirmation']:['Closing manager performs the physical check'],clarifications:r.data.provenance?.questions.map(q=>({question:q.prompt,answer:r.data.provenance?.answers[q.id]}))};
    }else if(r.kind==='close'){
      const current=assignedStandardCurrent(w,r),item=brief.items.find(i=>i.record.id===r.id);
      if(r.data.phase==='cancelled'||r.data.phase==='closed'&&!item)continue;
      title=r.data.standard.title;facts={authority:'saved assignment',signedInResponsibilities:closingRole(w,r),owner:name(r.ownerId),due:r.data.due,phase:r.data.phase,nextAction:item?.next,reason:item?.reason,helper:name(r.data.correction?.personId),verifier:name(r.data.verifierId),manager:name(r.data.managerId),approvedInstructionCurrent:current,standardId:r.data.standardId,standardRevision:r.data.standardRevision,conditions:current?r.data.standard.criteria:undefined,guide:current?r.data.standard.guide:undefined,source:current?r.data.standard.source:undefined,verification:r.data.standard.verification,attention:r.data.attention,appWorkflow:{authority:'existing application workflow, not a station operating method',recording:'Open this linked closing assignment. The assigned performer confirms every required condition and adds a factual condition or correction note before choosing Ready for physical check. A chat statement does not check a box or save readiness.',unmetCondition:'If any required condition is not met, leave readiness open, complete the approved correction or ask the assigned checker for missing instructions. An assigned checker can return the work for correction; correction and independent checks are still required.',physicalCheckOrder:r.data.verifierId?[name(r.data.verifierId),name(r.data.managerId)]:[name(r.data.managerId)],currentNextAction:item?.next},lastRecordedSteps:r.data.history.slice(-3).map(h=>({action:h.action,person:name(h.actorId),note:h.note,at:h.at}))};
      if(current){const standard=w.records.find(s=>s.id===r.data.standardId)!;dependency=source(standard,r.data.standard.title);}
    }else if(r.kind==='shift'){
      if(r.data.cancelled||r.id!==selectedRecord?.id&&(!r.data.published||Date.parse(r.data.end)<Date.parse(at)-86400000||Date.parse(r.data.start)>Date.parse(at)+7*86400000))continue;
      title=`${name(r.ownerId)} · ${shiftStationName(r)}`;facts={authority:r.data.published?'published schedule':'saved draft shift',person:name(r.ownerId),...r.data,history:undefined,copiedFrom:undefined,change:scheduleChangeContext(r,w.location.timezone)};
    }else if(r.kind==='leadership'){
      if(!r.data.active||Date.parse(r.data.end)<Date.parse(at)||Date.parse(r.data.start)>Date.parse(at)+86400000)continue;
      title=`${name(r.ownerId)} · shift leadership`;facts={person:name(r.ownerId),area:r.area,start:r.data.start,end:r.data.end};
    }else if(r.kind==='task'){
      if(r.data.phase==='closed'&&!(r.data.dishCheckout?.shift==='AM'&&r.data.dishHandoffs?.length))continue;title=r.data.title;facts={...r.data,owner:name(r.ownerId),incoming:r.data.incomingId?name(r.data.incomingId):undefined,closingHandoff:r.data.closingHandoff?{...r.data.closingHandoff,outgoing:name(r.data.closingHandoff.outgoingId),acceptedBy:name(r.data.closingHandoff.acceptedBy)}:undefined,history:r.data.history.slice(-2)};
    }else if(r.kind==='handoff'){
      if(['resolved','cancelled'].includes(r.data.phase))continue;title=r.data.title;facts={...r.data,outgoing:name(r.data.outgoingId),incoming:name(r.data.incomingId),history:r.data.history.slice(-2)};
    }else if(r.kind==='goal'){
      if(!['active','verification'].includes(r.data.phase))continue;
      const standard=w.records.find(s=>s.kind==='standard'&&s.id===r.data.standardId&&s.revision===r.data.standardRevision&&s.data.status==='approved');
      title=r.data.title;facts={authority:'accepted goal, not an independent operating standard',owner:name(r.ownerId),title:r.data.title,definition:r.data.definition,type:r.data.type,due:r.data.due,phase:r.data.phase,outcomeReview:{reviewer:name(r.data.managerId),workflow:{employeeMustReportReady:true,reviewerMustConfirmOutcome:true},employeeReadinessRecorded:r.data.phase==='verification',completionRecorded:false,grantsStationClearance:false,completesOperatingChecks:false},recentFollowThrough:r.data.history.slice(-2).map(h=>({by:name(h.actorId),action:h.action,note:h.note,at:displayTime(h.at,w.location.timezone)})),manager:name(r.data.managerId),source:r.data.standardSource,standardId:r.data.standardId,approvedInstructionCurrent:!!standard,methodAvailable:standard?.kind==='standard'&&!!standard.data.guide?.steps.length,...(standard?.kind==='standard'?{guide:standard.data.guide,conditions:standard.data.criteria,verification:standard.data.verification}: {})};
      if(standard?.kind==='standard')dependency=source(standard,standard.data.title);
    }else if(r.kind==='order'){
      if(r.data.status==='approved')continue;title='Food order request';facts={owner:name(r.ownerId),...r.data,history:undefined};
    }else continue;
    const localTimes=Object.fromEntries(Object.entries(r.data).filter(([key,value])=>['start','end','due'].includes(key)&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)).map(([key,value])=>[key,displayTime(String(value),w.location.timezone)]));
    let entry={source:source(r,title),facts,localTimes},length=JSON.stringify(entry).length;
    if(length>30000&&['standard','close','goal'].includes(r.kind)){
      // Never send an arbitrarily cut instruction as a complete method. Keep
      // its reference and an explicit gap so the employee can open the guide.
      facts={...(facts as Record<string,unknown>),guide:undefined,criteria:undefined,conditions:undefined,clarifications:undefined,instructionContentOmitted:true};
      entry={source:source(r,title),facts,localTimes};length=JSON.stringify(entry).length;
    }
    if(evidence.length>=20||characters+length>40000){omitted++;continue;}
    characters+=length;evidence.push(entry);scope.push(entry.source);if(dependency)scope.push(dependency);
  }
  const unique=[...new Map(scope.map(s=>[s.id,s])).values()];
  const selectedWork=selectedRecord?chatSource(selectedRecord):undefined;
  requireThat(!selectedWork||evidence.some(e=>e.source.id===selectedWork.id),'This item could not fit safely in the answer context. Open the saved instructions or remove the attachment.',409);
  return {scope:unique,evidence,selectedWork,context:{selectedWork,asOf:at,asOfLocal:displayTime(at,w.location.timezone),restaurant:w.location.name,timezone:w.location.timezone,person:{name:w.me.name,position:w.me.position,area:w.me.area,verifiedStationClearances:w.me.qualifications},evidence,operationalLearning:{caseCount:learning.evidence.length,selection:'Relevant explicitly shared, manager-reviewed historical cases in this selected restaurant; current dependency versions only.',meaning:'An observed outcome is historical evidence, not a new approved operating instruction. Cause uncertainty and failed attempts remain explicit.'},omittedRecords:omitted,limits:['No live Toast schedule, sales, inventory, supplier prices or camera observations are provided.','Saved work status is not a physical inspection.','Private notes, Inbox conversations and assessment scores are not automatically sent to JMAX.','Reviewed operational cases are historical observations; current approved methods and manager direction take precedence.']}};
}

export function scopeCurrent(sources:ChatSource[],raw:Workspace,at:string,foodRevision?:number) {
  const w=publicWorkspace(raw,at);
  // Schedule sources are built from this authenticated person's filtered
  // workspace. Dishwasher's own published schedule is valid context too;
  // role/restaurant visibility remains enforced when that context is built.
  return sources.every(s=>s.kind==='learningcase'?operationalLearningSourceCurrent(s,raw):s.kind==='food-prep'?(!w.me.scheduleOnly&&s.id===prepSourceId(w)&&s.revision===foodRevision):s.kind==='schedule-week'?!!scheduleWeekDate(s.id)&&s.revision===w.location.revision+1:w.records.some(r=>r.id===s.id&&r.revision===s.revision&&(r.kind!=='standard'||r.data.status==='approved')));
}
