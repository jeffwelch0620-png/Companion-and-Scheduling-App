import {applyOpening,openingReader,openingView} from './hiring-openings';
import {applyCatering,cateringReader,cateringView} from './catering';
import {applyStaffIdea,ideaReader} from './staff-ideas';
import {applyRecognition,recognitionReader,recognitionView} from './recognition';
import {applyOperationalLearning,operationalLearningReader,operationalLearningView} from './operational-learning';
import {applyPositionAchievements,achievementReader,achievementView} from './position-achievements';
import { applyIncident, incidentReader } from './incidents';
import {applyShiftCheckin,checkinReader} from './shift-checkin';
import {applyHireHandoff,hireReader,hireCandidateReader} from './hire-handoff';
import {applyHireChecklist,hireChecklistReader} from './hire-checklist';
import {applyMaintenance,maintenanceReader} from './maintenance';
import {applyEquipment,equipmentReader} from './equipment';
import {applyServiceContact,contactReader,contactView} from './service-contacts';
import {applyPromotion,promotionReader,promotionView} from './promotions';
import {applyGuestReview,guestReader} from './guest-reviews';
import {applyCompliance,complianceReader} from './compliance';
import { applyOperations, operationsManager, meetingReader } from './operations';
import {applyFood,foodManager} from './food';
import type {ResolvedFoodOrder} from './food-order-bridge';
import { canDraftStandard, canScheduleJob, personName, has, manages, type Command, type Member, type WorkRecord, type RecordOf, type Kind, type Workspace, type Line, type StandardProvenance } from './types';
import { id, text, object, range, instant, overlaps, requireThat } from './validation';
import {verifyTimeOffImpact} from './time-off-impact';
import { canPublish, canChangePublished, assignedLeader, calendarDate, availabilityConflict } from './schedule-policy';

import { applyFollowthrough, visibleDevelopment, redactAssessment } from './followthrough';

import { localDate, nextDate } from './local-time';

import { coverageDuties, coverageEligible, coverageIssue, coverageReviewers, coverageView, visibleCoverage } from './coverage';

import { closingSelection, closingPublicationIssues, pendingCopiedStaffing } from './publication';

import { canPlan, planningStamp, scheduleReview, weekStaffing } from './schedule-review';

import { weekCopyPlan } from './week-copy';

import { readStationGuide } from './station-knowledge';
import { starterTaskPacks, starterTaskRevision, starterGuide, starterQuestions } from './starter-tasks';
import { guidesForShift } from './shift-learning';
import { closingStatus } from './closing-status';
import { canManageClosing } from './closing-access';
import { readTrainingReview, trainingReviewIssues } from './training-review';
import { recoveredStandards, readSourceAnswers, requireSourceReview } from './recovered-standards';

import { attachMessageContext, messageContextView } from './message-context';

import { correctionPerformer, eligibleCorrectionHelper } from './close-correction';

import { attentionReasons, canAcknowledgeClose, needsCloseAcknowledgment } from './close-attention';

import { applyWorkforce, workforceReader } from './workforce';
import { stationAssignmentIssue, stationById, proposeStationGoals, shiftStationName } from './station-assignment';
import { applyAttendance, canManageAttendance } from './attendance';


export function dishCheckoutCycleStatus(w:Workspace,cycleId:string){
  const checkouts=w.records.filter((r):r is RecordOf<'task'>=>r.locationId===w.location.id&&r.kind==='task'&&r.data.kind==='task'&&r.data.dishCheckout?.cycleId===cycleId);
  const suppliedParticipants=checkouts[0]?.data.dishCheckout?.participantIds;
  const expected=Array.isArray(suppliedParticipants)&&suppliedParticipants.every(id=>typeof id==='string')?suppliedParticipants:[];
  const missingIds=expected.filter(personId=>checkouts.filter(r=>r.ownerId===personId).length!==1);
  const pendingCheckoutIds=checkouts.filter(r=>r.data.phase!=='closed').map(r=>r.id);
  const referenced=[...new Set(checkouts.flatMap(r=>Array.isArray(r.data.dishHandoffs)?r.data.dishHandoffs:[]))];
  const children=w.records.filter((r):r is RecordOf<'task'>=>r.locationId===w.location.id&&r.kind==='task'&&r.data.kind==='task'&&r.data.dishHandoff?.cycleId===cycleId);
  const unavailableHandoffIds=referenced.filter(id=>!children.some(r=>r.id===id));
  const invalidHandoffIds=children.filter(r=>{
    const link=r.data.dishHandoff!;
    const source=checkouts.find(p=>p.id===link.sourceId&&p.data.dishCheckout?.shift==='AM'&&Array.isArray(p.data.dishHandoffs)&&p.data.dishHandoffs.includes(r.id));
    return !source||r.area!==source.area||!expected.slice(1).includes(r.ownerId)||link.businessDate!==source.data.dishCheckout?.businessDate||!!link.acceptedBy&&(link.acceptedBy!==r.ownerId||!link.acceptedAt);
  }).map(r=>r.id);
  const pendingHandoffIds=children.filter(r=>r.data.phase!=='closed'||!r.data.dishHandoff?.acceptedBy).map(r=>r.id);
  const validShape=expected.length===3&&new Set(expected).size===3&&checkouts.length===3&&checkouts.filter(r=>r.data.dishCheckout?.shift==='AM').length===1&&checkouts.filter(r=>r.data.dishCheckout?.shift==='PM').length===2&&checkouts.every(r=>r.area==='BOH'&&JSON.stringify(r.data.dishCheckout?.participantIds)===JSON.stringify(expected)&&/^\d{4}-\d{2}-\d{2}$/.test(r.data.dishCheckout?.businessDate??'')&&r.data.dishCheckout?.businessDate===checkouts[0].data.dishCheckout?.businessDate&&r.data.dishCheckout?.shift===(r.ownerId===expected[0]?'AM':'PM')&&(!r.data.dishHandoffs||Array.isArray(r.data.dishHandoffs)));
  const coverageComplete=validShape&&!missingIds.length&&!unavailableHandoffIds.length&&!invalidHandoffIds.length;
  return {complete:coverageComplete&&!pendingCheckoutIds.length&&!pendingHandoffIds.length,validShape,coverageComplete,missingIds,pendingCheckoutIds,unavailableHandoffIds,pendingHandoffIds,invalidHandoffIds};
}

export function visible(r: WorkRecord, me: Member, w?: Workspace,at=new Date().toISOString()): boolean {

  if (r.locationId !== me.locationId) return false;

  switch (r.kind) {

    case 'fooditem': case 'foodrecipe': return foodManager(me);
    case 'shiftentry': return operationsManager(me,r.area);
    case 'managerlog': return operationsManager(me,r.area);
    case 'incident': return incidentReader(r,me);
    case 'compliance': return complianceReader(r,me);
    case 'shiftcheckin': return checkinReader(r,me);
    case 'hirehandoff': return hireReader(r,me);
    case 'hirechecklist': return hireChecklistReader(r,me);
    case 'equipment': return equipmentReader(r,me);
    case 'maintenance': return maintenanceReader(r,me);
    case 'servicecontact': return contactReader(r,me);
    case 'promotion': return promotionReader(r,me);
    case 'staffidea': return ideaReader(r,me);
    case 'recognition': return recognitionReader(r,me);
    case 'learningcase': return operationalLearningReader(r,me);
    case 'achievement': return achievementReader(r,me);
    case 'catering': return cateringReader(r,me);
    case 'opening': return openingReader(r,me);
    case 'guestreview': return guestReader(r,me);
    case 'meeting': return meetingReader(r,me);
    case 'message': return r.data.recipients.includes(me.id) || !r.data.automated && r.ownerId === me.id;
    case 'attendance': return canManageAttendance(me,r.area);
    case 'feedback': return r.ownerId === me.id || (r.data.shared && manages(me, r.area, 'people.manage'));

    case 'shift': return r.data.published && (r.ownerId === me.id||canManageAttendance(me,r.area)||canManageClosing(me,r.area,'close.confirm')) || manages(me, r.area, 'schedule.manage') || canPublish(me, r.area) || manages(me, r.area, 'schedule.change');
    case 'request': return r.ownerId === me.id || r.data.replacementId === me.id || manages(me, r.area, 'schedule.manage') || manages(me, r.area, 'schedule.change') || r.data.type==='time-off'&&r.data.status==='approved'&&canPublish(me,r.area);

    case 'leadership': return r.ownerId === me.id || canPublish(me, r.area) || manages(me, r.area, 'schedule.manage') || manages(me,r.area,'tasks.manage') || (r.data.active&&r.area===me.area&&!!w?.records.some(s=>s.kind==='shift'&&s.ownerId===me.id&&s.data.published&&!s.data.cancelled&&overlaps(s.data,r.data)));

    case 'availability': return r.ownerId === me.id || manages(me, r.area, 'schedule.manage') || r.data.status==='approved'&&canPublish(me,r.area);

    case 'standard': return me.position==='Dishwasher'?r.data.status==='approved'&&r.area===me.area&&r.data.position==='Dishwasher':r.data.status === 'approved' || canDraftStandard(me,r.area);
    case 'close': return me.position !== 'Dishwasher' && (canPublish(me,r.area) || canManageClosing(me, r.area, 'tasks.manage') || r.data.managerId === me.id || r.data.verifierId === me.id || r.data.correction?.personId===me.id || (r.ownerId === me.id && !!w?.records.some(s => s.kind === 'shift' && s.id === r.data.shiftId && s.data.published)));

    case 'task': return me.position==='Dishwasher'?r.ownerId===me.id&&r.area===me.area&&r.data.kind==='task':r.ownerId === me.id || r.data.incomingId === me.id || r.data.closingHandoff?.outgoingId===me.id || manages(me, r.area, 'tasks.manage') || !!r.data.shiftId&&canManageClosing(me,r.area,'tasks.manage') || r.data.kind==='task'&&!!(r.data.dishCheckout||r.data.dishHandoff)&&operationsManager(me,r.area);

    case 'order': return r.ownerId === me.id || (has(me, 'orders.review') && r.data.status !== 'draft');

    case 'handoff': return me.position!=='Dishwasher'&&(r.ownerId===me.id||r.data.outgoingId===me.id||r.data.incomingId===me.id||manages(me,r.area,'tasks.manage')||r.data.priority==='urgent'&&manages(me,r.area,'operations.escalation'));

    case 'development': return visibleDevelopment(r,me);

    case 'goal': return me.position!=='Dishwasher'&&(r.ownerId===me.id||r.data.managerId===me.id&&manages(me,r.area,r.data.type==='development'?'people.manage':'tasks.manage'));

    case 'coverage': return !!w&&visibleCoverage(w,r,me,at);

    case 'staffing': return canPlan(me,r.area);

    case 'station': return me.position!=='Dishwasher'&&(r.area===me.area||workforceReader(me,r.area)||canManageClosing(me,r.area,'tasks.manage'));

    case 'proficiency': return me.position!=='Dishwasher'&&(r.ownerId===me.id||workforceReader(me,r.area));

  }

}



export function publicWorkspace(w: Workspace,at=new Date().toISOString()): Workspace {

  const records=w.records.filter(r => visible(r, w.me, w,at)).map(r=>{
    if(r.kind==='task'&&r.data.dishCheckout?.shift==='AM'){
      // Expose only the receipt of this person's outgoing work, never the PM
      // assignment body, later checks or private conversation. The marker is a
      // server projection, not persisted command input; repeated sanitization
      // can retain that already checked receipt when the child is out of view.
      const acceptances=(r.data.dishHandoffs??[]).flatMap(id=>{
        const child=w.records.find(p=>p.id===id&&p.kind==='task');
        if(!child)return r.data.dishHandoffReceiptView===true?(r.data.dishHandoffAcceptances??[]).filter(a=>a.handoffId===id):[];
        const link=child.kind==='task'?child.data.dishHandoff:undefined;
        if(child.kind!=='task'||child.data.kind!=='task'||child.locationId!==r.locationId||child.area!==r.area||!r.data.dishCheckout!.participantIds.slice(1).includes(child.ownerId)||link?.sourceId!==r.id||link.cycleId!==r.data.dishCheckout!.cycleId||link.businessDate!==r.data.dishCheckout!.businessDate||link.acceptedBy!==child.ownerId||!link.acceptedAt||!Number.isFinite(Date.parse(link.acceptedAt)))return [];
        // A current valid legacy child can establish its narrow receipt even
        // when it predates persisted AM acknowledgment. Never backfill its body.
        return [{handoffId:id,acceptedBy:link.acceptedBy,acceptedAt:link.acceptedAt}];
      });
      const knownIds=[...new Set([...(r.data.dishHandoffs??[]),...w.records.filter(p=>p.kind==='task'&&p.locationId===r.locationId&&p.data.dishHandoff?.sourceId===r.id).map(p=>p.id),...(r.data.dishHandoffReceiptView===true?r.data.dishHandoffPendingIds??[]:[])])];
      const pendingIds=knownIds.filter(id=>!acceptances.some(a=>a.handoffId===id));
      return {...r,data:{...r.data,dishHandoffAcceptances:acceptances,dishHandoffReceiptView:true,dishHandoffPendingIds:pendingIds}};
    }
    if(r.kind==='station'&&!workforceReader(w.me,r.area)){const setup=r.data.setup;return {...r,data:{...r.data,issuedGoals:undefined,setup:setup?{...setup,memberIds:setup.memberIds.filter(id=>id===w.me.id),goals:[],standardIds:setup.standardIds.filter(id=>w.records.some(g=>g.id===id&&g.kind==='standard'&&g.data.status==='approved'))}:undefined}};}
    if(r.kind==='message'){const message=messageContextView(w,r,(record,member,workspace)=>visible(record,member,workspace,at));return r.data.automated?{...message,data:{...message.data,recipients:[w.me.id],readBy:message.data.readBy.includes(w.me.id)?[w.me.id]:[]}}:message;}
    if(r.kind==='servicecontact')return contactView(r,w.me);
    if(r.kind==='promotion')return promotionView(r,w.me);
    if(r.kind==='opening')return openingView(r,w.me);
    if(r.kind==='catering')return cateringView(r,w.me);
    if(r.kind==='recognition')return recognitionView(r,w.me);
    if(r.kind==='learningcase')return operationalLearningView(w,r);
    if(r.kind==='achievement')return achievementView(r,w);
    if(r.kind==='development')return redactAssessment(r,w.me);

    if(r.kind==='coverage')return coverageView(w,r,at);

    if(r.kind==='leadership'&&r.ownerId!==w.me.id&&!canPublish(w.me,r.area)&&!manages(w.me,r.area,'schedule.manage')&&!manages(w.me,r.area,'tasks.manage'))return {...r,data:{...r.data,note:''}};

    if(r.ownerId!==w.me.id&&canPublish(w.me,r.area)&&!manages(w.me,r.area,'schedule.manage')){

      if(r.kind==='request'&&r.data.type==='time-off'&&!manages(w.me,r.area,'schedule.change'))return {...r,data:{...r.data,note:'',decision:undefined}};

      if(r.kind==='availability')return {...r,data:{...r.data,title:'Approved availability',decision:''}};

    }

    return r;

  });

  // Display labels only for people referenced by records this viewer can read.

  // Inactive members never enter assignment lists, permissions or coverage counts.

  const referenced=new Set<string>();

  for(const r of records){

    referenced.add(r.ownerId);const d=r.data as unknown as Record<string,unknown>;

    for(const key of ['schedulerId','personId','managerId','verifierId','incomingId','outgoingId','approverId','reviewerId','replacementId','selectedId'])if(typeof d[key]==='string')referenced.add(d[key] as string);
    if(Array.isArray(d.history))for(const h of d.history)if(h&&typeof h.actorId==='string')referenced.add(h.actorId);
    if(r.kind==='equipment'){referenced.add(r.data.checkedBy);for(const h of r.data.history)referenced.add(h.actorId);for(const v of r.data.versions)referenced.add(v.by);}
    if(r.kind==='maintenance'){referenced.add(r.data.checkedBy);referenced.add(r.data.managerId);for(const h of r.data.history)referenced.add(h.actorId);for(const s of r.data.services){for(const cost of s.costHistory??[])referenced.add(cost.by);referenced.add(s.by);referenced.add(s.plan.managerId);if(s.voided)referenced.add(s.voided.by);}for(const v of r.data.versions){referenced.add(v.by);referenced.add(v.facts.managerId);}}
    if(r.kind==='servicecontact'){referenced.add(r.data.verifiedBy);for(const h of r.data.internal?.history??[])referenced.add(h.actorId);for(const v of r.data.internal?.versions??[]){referenced.add(v.by);referenced.add(v.verifiedBy);}}
    if(r.kind==='recognition'){referenced.add(r.data.recipientId);if(r.data.publication)referenced.add(r.data.publication.by);for(const h of r.data.internal?.history??[])referenced.add(h.actorId);}
    if(r.kind==='managerlog')for(const a of r.data.contactAttempts??[]){referenced.add(a.by);referenced.add(a.contact.verifiedBy);}
    if(r.kind==='catering'){if(r.data.publication)referenced.add(r.data.publication.by);if(r.data.notice)referenced.add(r.data.notice.by);for(const h of r.data.internal?.history??[])referenced.add(h.actorId);}
    if(r.kind==='opening'){for(const a of r.data.applicants??[])for(const e of a.events)referenced.add(e.by);if(r.data.approval)referenced.add(r.data.approval.by);for(const v of r.data.versions){referenced.add(v.by);referenced.add(v.facts.managerId);if(v.approval)referenced.add(v.approval.by);}for(const l of r.data.onboarding?.links??[]){for(const review of l.reviews)referenced.add(review.by);if(l.released)referenced.add(l.released.by);}}
    if(r.kind==='promotion'){
      if(r.data.approval)referenced.add(r.data.approval.by);
      if(r.data.withdrawal)referenced.add(r.data.withdrawal.by);
      for(const a of r.data.acknowledgments)referenced.add(a.by);
      for(const h of r.data.internal?.history??[])referenced.add(h.actorId);
      for(const v of r.data.internal?.versions??[])referenced.add(v.by);
      for(const o of r.data.internal?.outcomes??[])referenced.add(o.by);
    }
    if(Array.isArray(d.recipients))for(const id of d.recipients)if(typeof id==='string')referenced.add(id);

    if(Array.isArray(d.replies))for(const h of d.replies)if(h&&typeof h.actorId==='string')referenced.add(h.actorId);

    if(r.kind==='message'&&r.data.context?.assignment)referenced.add(r.data.context.assignment.ownerId);

    if(r.kind==='close'&&r.data.correction)referenced.add(r.data.correction.personId);

    if(r.kind==='close'&&r.data.attention){referenced.add(r.data.attention.raisedBy);if(r.data.attention.acknowledgment)referenced.add(r.data.attention.acknowledgment.by);}

    if(r.kind==='message'&&r.data.context?.assignment?.helperId)referenced.add(r.data.context.assignment.helperId);

  }

  return {...w,hireCandidates:w.hireCandidates?.filter(c=>hireCandidateReader(c,w)),learningHistory:w.learningHistory?.filter(h=>h.personId===w.me.id),activeRecordCount:has(w.me,'location.manage')?w.records.length:undefined,records,recoveredStandards:w.recoveredStandards?.filter(s=>w.me.position!=='Dishwasher'&&(manages(w.me,s.area,'tasks.manage')||manages(w.me,s.area,'standards.approve')))??[],formerMembers:w.formerMembers?.filter(m=>referenced.has(m.id)).map(m=>({id:m.id,name:m.name}))};
}



// Only explicit commands can change records. Client snapshots and selected roles are never accepted.

export function applyCommand(w: Workspace, command: Command, at: string, makeId = () => crypto.randomUUID() as string, publicationReviewed=false,sourceDraft?:StandardProvenance,resolvedFoodOrder?:ResolvedFoodOrder): WorkRecord[] {
  if(command.action==='shift.copy-week'){

    const input=command.input;

    requireThat(!command.recordId&&input.confirmed===true,'Review and confirm the new week before creating drafts.');

    requireThat(Array.isArray(input.shiftIds)&&Array.isArray(input.staffingIds),'Select the shifts and staffing needs to copy.');

    const options={sourceWeek:calendarDate(input.sourceWeek,'Source week'),targetWeek:calendarDate(input.targetWeek,'Destination week'),shiftIds:input.shiftIds.map(id),staffingIds:input.staffingIds.map(id),repeated:text(input.repeated??'','Repeated-hour option',10,true)};

    requireThat(options.targetWeek>=localDate(at,w.location.timezone),'Choose a destination week that has not started in the past.');

    const note=text(input.note,'New-week review note'),plan=weekCopyPlan(w,options);

    requireThat(input.reviewStamp===plan.stamp,'The source week or destination constraints changed. Review the copy again.',409);

    const copied=(r:WorkRecord)=>({id:r.id,revision:r.revision,sourceWeek:options.sourceWeek,targetWeek:options.targetWeek});

    const history=(r:WorkRecord)=>[{actorId:w.me.id,action:'copied-as-draft',at,note:`From ${options.sourceWeek}, record ${r.id}, revision ${r.revision}. ${note}`}];

    const all:WorkRecord[]=[];let projected=w;

    for(const item of plan.shifts){

      const changes=applyCommand(projected,{...command,action:'shift.save',input:{personId:item.employee.id,position:item.source.data.position,stationId:item.source.data.stationId??null,start:item.start,end:item.end,note}},at,makeId);
      const created=changes.find((r):r is RecordOf<'shift'>=>r.kind==='shift')!;

      created.data.copiedFrom=copied(item.source);created.data.history=history(item.source);all.push(...changes);

      for(const close of item.closes){

        // Proposed reviewers are copied into an unpublished assignment only.

        // Publication rechecks their current capabilities and dated leadership.

        all.push({id:makeId(),kind:'close',locationId:w.location.id,area:created.area,ownerId:created.ownerId,revision:1,updatedAt:at,data:{shiftId:created.id,standardId:close.standard.id,standardRevision:close.standard.revision,standard:close.standard.data,managerId:close.source.data.managerId,...(close.source.data.verifierId?{verifierId:close.source.data.verifierId}:{}),due:close.due,phase:'open',answers:[],history:history(close.source)}});

      }

      projected={...w,records:[...w.records,...all]};

    }

    for(const item of plan.staffing)all.push({id:makeId(),kind:'staffing',locationId:w.location.id,area:item.source.area,ownerId:w.me.id,revision:1,updatedAt:at,data:{title:item.source.data.title,position:item.source.data.position,start:item.start,end:item.end,minimum:item.source.data.minimum,source:item.source.data.source,status:'draft',history:history(item.source),copiedFrom:copied(item.source)}});

    return all;

  }

  if(command.action==='shift.save-batch'){

    const start=calendarDate(command.input.weekStart,'Week starting'),end=nextDate(start,7),note=text(command.input.note,'Draft change review',2000);

    requireThat(command.input.confirmed===true,'Confirm the draft changes before saving.');

    requireThat(!command.recordId&&Array.isArray(command.input.drafts)&&command.input.drafts.length>0&&command.input.drafts.length<=100,'Select 1–100 shift drafts.');

    const selections=command.input.drafts.map(value=>{

      const selection=object(value),recordId=id(selection.id);

      const draft=w.records.find((r):r is RecordOf<'shift'>=>r.id===recordId&&r.kind==='shift'&&visible(r,w.me,w));

      requireThat(draft,'A selected draft is unavailable.',404);

      requireThat(!draft.data.published&&!draft.data.cancelled&&!draft.data.releasedAt,'Only active unpublished drafts can be edited together.');

      requireThat(manages(w.me,draft.area,'schedule.manage'),'You cannot edit drafts for this department.',403);

      requireThat(Number.isInteger(selection.revision)&&selection.revision===draft.revision,'A selected draft changed. Review its latest version.',409);

      const day=localDate(draft.data.start,w.location.timezone);requireThat(day>=start&&day<end,'Every selected draft must start in this displayed week.');

      return {draft,input:{...object(selection.input),note}};

    });

    const selectedIds=new Set(selections.map(s=>s.draft.id));requireThat(selectedIds.size===selections.length,'A draft was selected more than once.');

    const allChanges=new Map<string,WorkRecord>();

    // Remove the other selected drafts while validating each replacement. This

    // allows a legitimate exchange of two draft slots without an artificial

    // conflict with the old slots. Existing close records remain available.

    for(const selection of selections){

      const independent={...w,records:w.records.filter(r=>!selectedIds.has(r.id)||r.id===selection.draft.id)};

      const changes=applyCommand(independent,{...command,action:'shift.save',recordId:selection.draft.id,expectedRevision:selection.draft.revision,input:selection.input},at,makeId);

      for(const r of changes)allChanges.set(r.id,r);

    }

    const projected={...w,records:[...w.records.filter(r=>!allChanges.has(r.id)),...allChanges.values()]};
    // Recheck every proposed assignment against the entire resulting schedule,

    // including all selected replacements. Validation makes no durable writes.
    // inheritCloses uses only this shift and its unchanged close records in pass
    // one. In pass two its target already matches; discard duplicate history
    // and retain the original transfer evidence from pass one.
    for(const selection of selections){

      const changed=allChanges.get(selection.draft.id)!;

      applyCommand(projected,{...command,action:'shift.save',recordId:changed.id,expectedRevision:changed.revision,input:selection.input},at,makeId);

    }

    return [...allChanges.values()];

  }

  if(command.action==='shift.publish-batch'){

    const start=calendarDate(command.input.weekStart,'Week starting'),end=nextDate(start,7),note=text(command.input.note,'Publication review',2000);

    requireThat(command.input.confirmed===true,'Confirm the selected shifts before publishing.');

    requireThat(!command.recordId&&Array.isArray(command.input.drafts)&&command.input.drafts.length>0&&command.input.drafts.length<=100,'Select 1–100 shift drafts.');

    const selected=command.input.drafts.map(value=>id(object(value).id));

    const staffing=weekStaffing(w,start);

    let staffingException='';

    if(staffing.length||command.input.planningReview!==undefined)requireThat(command.input.planningReview===planningStamp(w,start,selected),'Staffing or the proposed schedule changed. Review the week again before publishing.',409);

    if(staffing.length){

      const review=scheduleReview(w,start,selected);

      if(review.plannedGapCount){

        requireThat(command.input.coverageAcknowledged===true,'Review the remaining staffing gaps and explicitly acknowledge them before publishing.');

        staffingException=text(command.input.coverageNote,'Plan for the remaining staffing gaps',2000);

      }

    }

    const seen=new Set<string>(),allChanges=new Map<string,WorkRecord>();

    let projected=w;

    // Propose station learning from the earliest selected shift, regardless of
    // the order the manager selected the drafts or storage returned them.
    const ordered=[...command.input.drafts].sort((a,b)=>{
      const startOf=(value:unknown)=>{const recordId=id(object(value).id);return w.records.find((r):r is RecordOf<'shift'>=>r.id===recordId&&r.kind==='shift')?.data.start??'';};
      return startOf(a).localeCompare(startOf(b));
    });
    for(const value of ordered){
      const selection=object(value),recordId=id(selection.id);

      requireThat(!seen.has(recordId),'A shift was selected more than once.');seen.add(recordId);

      requireThat(Number.isInteger(selection.revision)&&Number(selection.revision)>0,'Every selected draft needs an exact revision.');

      const draft=w.records.find((r):r is RecordOf<'shift'>=>r.id===recordId&&r.kind==='shift'&&visible(r,w.me,w));

      requireThat(draft,'A selected shift is unavailable.',404);

      requireThat(canPublish(w.me,draft.area),'Only the authorized publisher can publish this department.',403);

      requireThat(Array.isArray(selection.closing)&&JSON.stringify(selection.closing)===JSON.stringify(closingSelection(w,draft.id)),'Closing responsibilities changed or were not reviewed. Refresh and review the weekly selection again.',409);

      const day=localDate(draft.data.start,w.location.timezone);

      requireThat(day>=start&&day<end,'Every selected shift must start in this displayed week.');

      // Reuse every single-shift rule. Nothing reaches storage unless all

      // selected revisions, people, availability and closing standards pass.

      const changes=applyCommand(projected,{...command,action:'shift.publish',recordId,expectedRevision:Number(selection.revision),input:{note}},at,makeId,true).map(r=>r.kind==='shift'&&staffingException?{...r,data:{...r.data,history:[...(r.data.history??[]),{actorId:w.me.id,action:'staffing-exception',note:staffingException,at}]}}:r);

      for(const r of changes)allChanges.set(r.id,r);

      const changedIds=new Set(changes.map(r=>r.id));

      projected={...projected,records:[...projected.records.filter(r=>!changedIds.has(r.id)),...changes]};

    }

    return [...allChanges.values()];

  }

  const me = w.me, input = command.input, changes = new Map<string, WorkRecord>();

  const member = (value: unknown) => { const target = w.members.find(m => m.id === id(value)); requireThat(target, 'Choose an active employee at this restaurant.'); return target; };

  const own = (r: WorkRecord) => requireThat(r.ownerId === me.id, 'This belongs to another employee.', 403);

  const permitted = (target: Member | WorkRecord, capability: Parameters<typeof manages>[2]) => requireThat(manages(me, target.area, capability), 'You do not have permission for this department.', 403);

  const find = <K extends Kind>(kind: K, recordId = command.recordId): RecordOf<K> => {

    const r = w.records.find(r => r.id === recordId && r.kind === kind);

    requireThat(r && visible(r, me, w,at), 'Record not found.', 404);

    requireThat(Number.isInteger(command.expectedRevision) && r.revision === command.expectedRevision, 'This changed since you opened it. Refresh and review the latest version.', 409);

    return r as RecordOf<K>;

  };

  const save = (r: WorkRecord) => { const result = { ...r, revision: r.revision + 1, updatedAt: at }; changes.set(result.id, result); return result; };

  const create = (value: Pick<WorkRecord, 'kind' | 'data'>, owner = me): WorkRecord => {

    const r = { ...value, id: makeId(), locationId: me.locationId, area: owner.area, ownerId: owner.id, revision: 1, updatedAt: at } as WorkRecord;

    changes.set(r.id, r); return r;

  };

  const notify = (targets: string[], title: string, body: string,recordId?:string) => {

    const recipients = [...new Set(targets)].filter(target => w.members.some(m => m.id === target));

    const related=[...changes.values()].find(r=>r.kind===command.action.split('.')[0]&&(!command.recordId||r.id===command.recordId));

    const linkedId=recordId??related?.id;

    if (recipients.length) create({ kind: 'message', data: { title, body, recipients, readBy: [], replies: [], automated: true,...(linkedId?{recordId:linkedId}:{}) } });
  };

  const coverageNotice=(r:RecordOf<'coverage'>,targets:string[],title:string,body:string)=>{

    // Store one notice; publicWorkspace exposes only the viewer's recipient/read entry.
    notify(targets,title,body,r.id);
  };

  const reviewers = (area: string, capability: Parameters<typeof manages>[2]) => w.members.filter(m => manages(m, area, capability)).map(m => m.id);
  const closingReviewers = (area:string) => w.members.filter(m=>canManageClosing(m,area,'tasks.manage')).map(m=>m.id);

  const history = (action: string, note: string) => ({ actorId: me.id, action, note, at });

  if(['station','proficiency'].includes(command.action.split('.')[0])) {
    applyWorkforce({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});

    requireThat(changes.size>0,'No change to save.');return [...changes.values()];

  }

  if(['fooditem','foodrecipe'].includes(command.action.split('.')[0])) {
    applyFood({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    requireThat(changes.size>0,'No change to save.');return [...changes.values()];
  }
  if(command.action.startsWith('shiftcheckin.')){
    applyShiftCheckin({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }
  if(command.action.startsWith('learningcase.')){
    applyOperationalLearning({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    requireThat(changes.size>0,'No change to save.');return [...changes.values()];
  }
  if(command.action.startsWith('achievement.')){
    applyPositionAchievements({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }
  if(command.action.startsWith('equipment.')){
    applyEquipment({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});return [...changes.values()];
  }
  if(command.action.startsWith('maintenance.')){
    applyMaintenance({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }
  if(command.action.startsWith('servicecontact.')||command.action==='managerlog.contact'){
    applyServiceContact({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }
  if(command.action.startsWith('opening.')){
    applyOpening({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }
  if(command.action.startsWith('promotion.')){
    applyPromotion({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }else if(command.action.startsWith('hirechecklist.')){
    applyHireChecklist({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }else if(command.action.startsWith('hirehandoff.')){
    applyHireHandoff({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }else if(command.action.startsWith('catering.')){
    applyCatering({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }else if(command.action.startsWith('recognition.')){
    applyRecognition({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }else if(command.action.startsWith('staffidea.')){
    applyStaffIdea({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }else if(command.action.startsWith('guestreview.')){
    applyGuestReview({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    return [...changes.values()];
  }
  if(command.action.startsWith('compliance.')) {
    applyCompliance({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    requireThat(changes.size>0,'No change to save.');return [...changes.values()];
  }
  if(command.action.startsWith('incident.')) {
    applyIncident({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    requireThat(changes.size>0,'No change to save.');return [...changes.values()];
  }
  if(['managerlog','meeting','shiftentry'].includes(command.action.split('.')[0])) {
    applyOperations({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    requireThat(changes.size>0,'No change to save.');return [...changes.values()];
  }
  if(command.action.startsWith('attendance.')) {
    applyAttendance({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});
    requireThat(changes.size>0,'No change to save.');return [...changes.values()];
  }
  if(['handoff','development','goal'].includes(command.action.split('.')[0])) {

    applyFollowthrough({w,me,command,input,at,member,own,permitted,find,save,create,notify,history});

    requireThat(changes.size>0,'No change to save.');return [...changes.values()];

  }

  const projectedRecords = () => w.records.map(r => changes.get(r.id) ?? r);

  const activeShifts = () => projectedRecords().filter((r): r is RecordOf<'shift'> => r.kind === 'shift' && !r.data.cancelled);

  const checkAssignment = (target: Member, period: {start: string; end: string}, position: string, excludedId?: string, stationId?:string|null) => {
    const selected=stationId===undefined?w.records.find((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.id===excludedId)?.data.stationId:stationId;
    const stationIssue=stationAssignmentIssue(w,target,position,selected);requireThat(!stationIssue,stationIssue);
    requireThat(canScheduleJob(target, position), 'Review this employee’s scheduling jobs before assigning this station.');

    requireThat(!activeShifts().some(s => s.id !== excludedId && s.ownerId === target.id && overlaps(s.data, period)), 'This employee already has an overlapping shift.');

    requireThat(!w.records.some(r => r.kind === 'request' && r.ownerId === target.id && r.data.type === 'time-off' && r.data.status === 'approved' && overlaps(r.data, period)), 'This conflicts with approved time off.');

    const blocked = availabilityConflict(w, target.id, period);

    requireThat(!blocked, `This conflicts with approved availability${blocked ? `: ${blocked.data.title}` : ''}.`);

  };

  const stationLearning=(shift:RecordOf<'shift'>)=>proposeStationGoals({w,me,command,input,at,member,own,permitted,find,save,create,notify,history},shift);
  const shiftCloses = (shiftId: string) => projectedRecords().filter((r): r is RecordOf<'close'> => r.kind === 'close' && r.data.shiftId === shiftId && r.data.phase !== 'cancelled');

  const swapReviewers = (area:string, period:{start:string;end:string}, excluded:string[]) => w.members.filter(m=>!excluded.includes(m.id)&&canChangePublished(w,m,area,period)).map(m=>m.id);

  const publishedPermission = (s: RecordOf<'shift'>, period = s.data) => requireThat(canChangePublished(w, me, s.area, period), 'A leader assigned to this shift and department must make this published schedule change.', 403);

  const mutableShift = (s: RecordOf<'shift'>) => requireThat(!s.data.cancelled && !s.data.releasedAt, 'This shift was cancelled or released.');

  const inheritCloses = (s: RecordOf<'shift'>, target: Member, period = s.data) => {

    const linked=closingStatus({...w,records:projectedRecords()},s).tasks;
    requireThat(!linked.length||target.id===s.ownerId&&target.area===s.area&&period.start===s.data.start&&period.end===s.data.end&&period.position===s.data.position,'Keep linked checkout work on its original shift; review that work before moving or transferring the schedule.');

    for (const c of shiftCloses(s.id)) {

      requireThat(target.position !== 'Dishwasher', 'Dish cannot inherit operational closing work.');
      requireThat(target.qualifications.includes(c.data.standard.position),'Review this employee’s closing-station clearance before transferring assigned closing work.');

      requireThat(target.area === c.area && guidesForShift(w,{...s,ownerId:target.id,area:target.area,data:{...s.data,...period}}).some(g=>g.id===c.data.standardId), 'Reassign or cancel the existing closing work before changing this shift to a different department or station.');

      requireThat(c.data.due >= period.start && c.data.due <= period.end, 'Adjust the closing due time before shortening or moving this shift.');

      requireThat(target.id !== c.data.managerId && target.id !== c.data.verifierId, 'Assign a different verifier before transferring this close to its verifier.');

      const changed=target.id!==c.ownerId||period.start!==s.data.start||period.end!==s.data.end||period.position!==s.data.position;

      if(changed){

        requireThat(c.data.phase!=='closed','Completed closing work cannot be reassigned or moved with a schedule edit. Use a separate reviewed correction.');

        const note=target.id!==c.ownerId?`${c.ownerId} → ${target.id}; new closer must complete and submit the work.`:'The shift times changed; review and submit the closing conditions again.';

        save({ ...c, ownerId: target.id, area: target.area, data: { ...c.data, phase: 'open', answers:[], correction:undefined, history: [...c.data.history, history(target.id!==c.ownerId?'coverage-transferred':'schedule-changed',note)] } });

        if(s.data.published)notify([target.id,c.data.managerId,...(c.data.verifierId?[c.data.verifierId]:[]),...(c.data.correction?[c.data.correction.personId]:[])],'Closing responsibility changed',`${c.data.standard.title}. ${note}`,c.id);

      }

    }

  };

  const transferCancelledCloses = (s: RecordOf<'shift'>, cancelledIds: string[] = [s.id]) => {

    requireThat(closingStatus({...w,records:projectedRecords()},s).pendingTasks.length===0,'Finish and independently verify linked checkout work before cancelling this shift.');

    for (const c of shiftCloses(s.id).filter(c => c.data.phase !== 'closed')) {

      const mappings = Array.isArray(input.closeTransfers) ? input.closeTransfers.map(object) : [];

      const mapping = mappings.find(x => x.closeId === c.id);

      const replacement = activeShifts().find(x => x.id === mapping?.shiftId && !cancelledIds.includes(x.id) && !x.data.releasedAt);

      requireThat(replacement, 'Reassign every unfinished close to a covering shift before cancelling this shift.');

      requireThat(replacement.area === c.area && (!s.data.published || replacement.data.published), 'Choose a published covering shift in the same department.');

      requireThat(guidesForShift(w,replacement).some(g=>g.id===c.data.standardId), 'The covering shift must work the station required by this closing standard.');

      if (replacement.data.published) publishedPermission(replacement); else permitted(replacement, 'schedule.manage');

      requireThat(replacement.data.start <= c.data.due && replacement.data.end >= c.data.due, 'The covering shift must include the closing due time.');

      const target = member(replacement.ownerId);
      requireThat(target.qualifications.includes(c.data.standard.position),'Review the covering employee’s closing-station clearance before transferring assigned closing work.');

      requireThat(target.position !== 'Dishwasher' && target.id !== c.data.managerId && target.id !== c.data.verifierId, 'Choose an eligible closer with independent verification.');

      requireThat(!shiftCloses(replacement.id).some(x => x.data.standard.zone === c.data.standard.zone), 'That covering shift already owns this closing area.');

      save({ ...c, ownerId: target.id, data: { ...c.data, shiftId: replacement.id, phase: 'open', answers:[], correction:undefined, history: [...c.data.history, history('reassigned', `${s.id} → ${replacement.id}; ${c.ownerId} → ${target.id}`)] } });

      notify([target.id, c.data.managerId,...(c.data.correction?[c.data.correction.personId]:[])], 'Closing work reassigned', c.data.standard.title,c.id);

    }

  };



  switch (command.action) {

    case 'staffing.save': {

      const previous=command.recordId?find('staffing'):null,area=text(input.area,'Department',100);

      requireThat(me.position!=='Dishwasher'&&manages(me,area,'schedule.manage'),'Drafting staffing needs requires schedule management for this department.',403);

      if(previous){requireThat(manages(me,previous.area,'schedule.manage'),'No access to the prior department.',403);requireThat(previous.data.status==='draft','Create a new staffing need; approved needs cannot be silently edited.');}

      requireThat(w.members.some(m=>m.area===area),'Choose an existing department.');

      requireThat(Number.isInteger(input.minimum)&&Number(input.minimum)>=1&&Number(input.minimum)<=100,'Use a required headcount from 1 to 100.');

      const data={title:text(input.title,'Staffing need',200),position:text(input.position,'Station / position',100),...range(input,24),minimum:Number(input.minimum),source:text(input.source,'Source or operating reason',2000),status:'draft' as const,...(previous?.data.copiedFrom?{copiedFrom:previous.data.copiedFrom}:{}),history:[...(previous?.data.history??[]),history('drafted',text(input.note??'','Draft note',2000,true)||'Awaiting publisher approval.')]};

      if(previous)save({...previous,area,data});else{const r=create({kind:'staffing',data});changes.set(r.id,{...r,area});}break;

    }

    case 'staffing.approve': case 'staffing.retire': {

      const r=find('staffing'),approving=command.action==='staffing.approve';

      requireThat(me.position!=='Dishwasher'&&(canPublish(me,r.area)||!approving&&r.data.status==='draft'&&manages(me,r.area,'schedule.manage')),'Approval of staffing needs requires the department publisher.',403);

      requireThat(approving?r.data.status==='draft':r.data.status!=='retired','This staffing need is not at this step.');

      if(approving){

        requireThat(input.confirmed===true,'Confirm the staffing headcount, times and source.');

        requireThat(!w.records.some(other=>other.id!==r.id&&other.kind==='staffing'&&other.area===r.area&&other.data.position===r.data.position&&other.data.status==='approved'&&overlaps(other.data,r.data)),'An approved need already covers this station and time. Retire or split the earlier need to avoid conflicting headcounts.');

      }

      save({...r,data:{...r.data,status:approving?'approved':'retired',history:[...r.data.history,history(approving?'approved':'retired',text(input.note,'Review reason',2000))]}});break;

    }

    case 'coverage.create': {

      const s=w.records.find((s):s is RecordOf<'shift'>=>s.kind==='shift'&&s.id===input.shiftId&&s.ownerId===me.id);

      requireThat(s,'Choose your own published shift.',404);mutableShift(s);

      requireThat(s.data.published&&Date.parse(s.data.start)>Date.parse(at),'Only a published shift that has not started can be offered.');

      requireThat(input.shiftRevision===s.revision,'The shift changed. Refresh before offering it.',409);

      requireThat(!w.records.some(r=>r.kind==='coverage'&&r.data.shiftId===s.id&&!coverageIssue(w,r,at)),'This shift already has an open coverage offer.',409);

      const offer={kind:'coverage' as const,data:{title:`${s.data.position} shift coverage`,shiftId:s.id,shiftRevision:s.revision,position:s.data.position,start:s.data.start,end:s.data.end,duties:coverageDuties(w,s.id),note:text(input.note,'Private note for schedule reviewers',2000,true),status:'open' as const,volunteers:[],history:[history('offered','The original employee remains responsible until an assigned shift leader approves a replacement.')]}};

      const r=create(offer) as RecordOf<'coverage'>;

      requireThat(!coverageIssue(w,r,at),coverageIssue(w,r,at));

      const eligible=w.members.filter(m=>coverageEligible(w,r,m,at)).map(m=>m.id);

      coverageNotice(r,[...eligible,...coverageReviewers(w,r)],'A shift is available for coverage',`${me.name} offered a ${r.data.position} shift. Review its times and assigned duties before volunteering. The original employee remains responsible until approval.`);

      break;

    }

    case 'coverage.volunteer': {

      const r=find('coverage');requireThat(!coverageIssue(w,r,at),coverageIssue(w,r,at),409);

      requireThat(coverageEligible(w,r,me,at),'This shift does not match your current station clearance, availability or assignment requirements.',403);

      requireThat(!r.data.volunteers.some(v=>v.personId===me.id),'You have already volunteered for this shift.',409);

      requireThat(input.confirmed===true,'Confirm that you reviewed the shift times and inherited closing duties.');

      requireThat(r.data.volunteers.length<100,'This offer already has the maximum number of volunteers.');

      save({...r,data:{...r.data,volunteers:[...r.data.volunteers,{personId:me.id,at}],history:[...r.data.history,history('volunteered','Volunteered for the stated shift and closing duties; manager approval is still required.')]}});

      coverageNotice(r,[r.ownerId,...coverageReviewers(w,r,me.id)],'Shift coverage needs a decision',`${me.name} volunteered. The published shift has not changed.`);break;

    }

    case 'coverage.withdraw-volunteer': {

      const r=find('coverage');requireThat(r.data.status==='open'&&r.data.volunteers.some(v=>v.personId===me.id),'There is no open volunteer offer to withdraw.',409);

      save({...r,data:{...r.data,volunteers:r.data.volunteers.filter(v=>v.personId!==me.id),history:[...r.data.history,history('volunteer-withdrawn','The volunteer withdrew before approval.')]}});

      coverageNotice(r,[r.ownerId,...coverageReviewers(w,r,me.id)],'Coverage volunteer withdrew',`${me.name} is no longer volunteering. The original employee remains responsible.`);break;

    }

    case 'coverage.withdraw': {

      const r=find('coverage');own(r);requireThat(r.data.status==='open','This coverage offer is no longer open.',409);

      save({...r,data:{...r.data,status:'withdrawn',history:[...r.data.history,history('withdrawn',text(input.note,'Withdrawal note',2000,true)||'The original employee withdrew this offer.')]}});

      coverageNotice(r,[...r.data.volunteers.map(v=>v.personId),...coverageReviewers(w,r)],'Coverage offer withdrawn','The published shift remains with its original employee.');break;

    }

    case 'coverage.approve': {

      const r=find('coverage'),target=member(input.personId);

      requireThat(me.id!==r.ownerId&&me.id!==target.id&&canChangePublished(w,me,r.area,r.data),'A different authorized leader assigned to this shift must approve coverage.',403);

      requireThat(!coverageIssue(w,r,at),coverageIssue(w,r,at),409);

      requireThat(r.data.volunteers.some(v=>v.personId===target.id),'The replacement must still be volunteering.',409);

      requireThat(input.confirmed===true,'Confirm the exact replacement, shift and inherited duties.');

      requireThat(coverageEligible(w,r,target,at),'The replacement is no longer eligible under the configured station, availability or assignment rules.',409);

      const s=w.records.find((s):s is RecordOf<'shift'>=>s.kind==='shift'&&s.id===r.data.shiftId)!;

      const note=text(input.note,'Coverage decision');checkAssignment(target,s.data,s.data.position,s.id);inheritCloses(s,target);

      const changed=save({...s,ownerId:target.id,area:target.area,data:{...s.data,personId:target.id,history:[...(s.data.history??[]),history('coverage-approved',note)]}}) as RecordOf<'shift'>;stationLearning(changed);
      save({...r,data:{...r.data,status:'approved',selectedId:target.id,history:[...r.data.history,history('approved',note)]}});

      coverageNotice(r,[r.ownerId,target.id,...r.data.volunteers.map(v=>v.personId)],'Shift coverage approved',`${target.name} now owns the published ${r.data.position} shift and its assigned closing duties. Other volunteer offers for this shift are finished.`);break;

    }

    case 'leadership.assign': {

      const target = member(input.personId), area = text(input.area, 'Department', 100);

      requireThat(canPublish(me, area), 'Schedule publication authority is required to assign shift leadership.', 403);

      requireThat(target.area === area || has(target, 'location.manage'), 'The leader needs authority for that department.');

      requireThat(has(target, 'schedule.change') || has(target, 'close.confirm'), 'Grant this person the required leadership capability first.');

      const period = range(input, 24), note = text(input.note, 'Leadership assignment reason');

      const previous = command.recordId ? find('leadership') : null;

      if (previous) requireThat(canPublish(me, previous.area), 'No authority for the previous department.', 403);

      const data = { ...period, personId: target.id, area, active: true, note };

      if (previous) save({ ...previous, area, ownerId: target.id, data });

      else { const created = create({ kind:'leadership', data }, target); changes.set(created.id, { ...created, area }); }

      notify([target.id], 'Shift leadership assigned', `${area}: ${period.start} to ${period.end}. ${note}`);

      break;

    }

    case 'leadership.revoke': {

      const r = find('leadership'); requireThat(canPublish(me, r.area), 'Only a schedule publisher can change shift leadership.', 403);

      save({ ...r, data: { ...r.data, active:false, note:text(input.note, 'Reason') } }); break;

    }

    case 'availability.save': {

      const previous = command.recordId ? find('availability') : null;

      const owner=member(input.personId??previous?.ownerId??me.id);

      if(owner.id!==me.id)permitted(owner,'schedule.manage');

      requireThat(!previous||previous.ownerId===owner.id,'Availability cannot move to another employee.');

      if (previous) { requireThat(previous.data.status !== 'approved', 'Submit a new request to change approved availability.'); }

      const startDate = calendarDate(input.startDate, 'First date'), endDate = calendarDate(input.endDate, 'Last date');

      requireThat(endDate >= startDate && Date.parse(endDate) - Date.parse(startDate) <= 370 * 86400000, 'Use a term of up to 370 days.');

      requireThat(Array.isArray(input.days) && input.days.length > 0 && input.days.length <= 7 && input.days.every(d => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6), 'Choose the affected weekdays.');

      const number = (value: unknown, maximum: number) => { requireThat(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum, 'Use a valid time or travel buffer.'); return value; };

      const startMinute = number(input.startMinute, 1439), endMinute = number(input.endMinute, 1440);

      requireThat(endMinute > startMinute, 'The end must follow the start. Split overnight restrictions at midnight.');

      requireThat(input.kind === 'school' || input.kind === 'unavailable', 'Choose school or unavailable.');

      const data: RecordOf<'availability'>['data'] = { startDate, endDate, days:[...new Set(input.days as number[])], startMinute, endMinute, beforeMinutes:number(input.beforeMinutes ?? 0,180), afterMinutes:number(input.afterMinutes ?? 0,180), title:text(input.title,'Availability',150), kind:input.kind, status:'pending', decision:'' };

      requireThat(input.excludedDates === undefined || (Array.isArray(input.excludedDates) && input.excludedDates.length <= 90),'Use at most 90 specific calendar exceptions.');

      data.excludedDates = (input.excludedDates as unknown[] ?? []).map(d=>calendarDate(d,'Exception date'));

      requireThat(data.excludedDates.every(d=>d>=startDate&&d<=endDate),'Calendar exceptions must fall within this term.');

      if(input.replacesId) { const old=w.records.find(r=>r.id===input.replacesId&&r.kind==='availability'&&r.ownerId===owner.id&&r.data.status==='approved'); requireThat(old,'Choose this employee’s current approved availability to replace.'); data.replacesId=old.id; }

      requireThat(reviewers(owner.area,'schedule.manage').some(x => x !== owner.id), 'Assign a schedule reviewer first.');

      if (previous) save({ ...previous, data }); else create({ kind:'availability', data },owner);

      notify(reviewers(owner.area,'schedule.manage').filter(x => x !== owner.id), 'Availability review', `${owner.name}: ${data.title}`); break;

    }

    case 'availability.review': {

      const r = find('availability'); permitted(r,'schedule.manage'); requireThat(me.id !== r.ownerId, 'A different manager must review availability.',403);

      requireThat(r.data.status === 'pending' && typeof input.approve === 'boolean', 'This availability is not awaiting a decision.');

      const data: RecordOf<'availability'>['data'] = { ...r.data, status:input.approve ? 'approved' : 'declined', decision:text(input.note,'Review note') };

      const updated = { ...r, data };

      if (input.approve) {

        if(r.data.replacesId) requireThat(w.records.some(x=>x.id===r.data.replacesId&&x.kind==='availability'&&x.ownerId===r.ownerId&&x.data.status==='approved'),'The prior availability changed; submit a fresh update.',409);

        const projected = { ...w, records:w.records.filter(x=>x.id!==r.data.replacesId).map(x => x.id === r.id ? updated : x) };

        const conflict = activeShifts().find(s => s.ownerId === r.ownerId && availabilityConflict(projected, r.ownerId, s.data));

        requireThat(!conflict, 'Reassign or correct conflicting shifts before approving this availability.');

        const old=w.records.find((x):x is RecordOf<'availability'>=>x.kind==='availability'&&x.id===r.data.replacesId);

        if(old) save({...old,data:{...old.data,status:'superseded',decision:`Replaced by approved request ${r.id}.`}});

      }

      save(updated); notify([r.ownerId], `Availability ${data.status}`, data.decision); break;

    }

    case 'standard.from-source': {
      requireThat(!command.recordId&&sourceDraft?.intake,'Open an original source before creating a training draft.');
      const area=text(input.area,'Department',100);
      requireThat(has(me,'location.manage')&&canDraftStandard(me,area),'You cannot create source-linked training for this restaurant.',403);
      requireThat(!w.records.some(r=>r.kind==='standard'&&r.data.status!=='retired'&&r.data.provenance?.sourceId===sourceDraft.sourceId),'A guide from this source already exists. Open it or draft its next version.',409);
      const zone=text(input.zone,'Training topic',100),position=text(input.position,'Station / role',100);
      requireThat(position!=='Dishwasher','Dish uses Schedule and Inbox. Keep this source for owner reference.');
      const version=1+Math.max(0,...w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.area===area&&r.data.zone===zone).map(r=>r.data.version));
      create({kind:'standard',data:{title:text(input.title,'Guide title',200),zone,position,version,criteria:[],source:sourceDraft.intake.title,verification:'manager',status:'draft',validationNote:'',history:[history('source-linked','Original source linked for review. No instructions or approval were inferred.')],provenance:{...sourceDraft,importedAt:at}}},{...me,area});break;
    }
    case 'standard.preload-starters': {
      requireThat(!command.recordId,'Starter tasks create new drafts.');
      requireThat(input.catalogRevision===starterTaskRevision,'The starter lists changed. Refresh before adding them.',409);
      requireThat(Array.isArray(input.templateIds)&&input.templateIds.length>0&&input.templateIds.length<=20&&new Set(input.templateIds).size===input.templateIds.length,'Choose 1–20 different job lists.');
      const packs=input.templateIds.map(templateId=>{const pack=starterTaskPacks.find(p=>p.id===templateId);requireThat(pack,'This starter job list is unavailable.',404);requireThat(canDraftStandard(me,pack.area),'You cannot draft training for this department.',403);return pack});
      const missing=packs.filter(p=>!w.records.some(r=>r.kind==='standard'&&r.locationId===me.locationId&&r.data.status!=='retired'&&r.data.provenance?.starter?.templateId===p.id));
      requireThat(missing.length,'These job lists are already saved. Open the existing drafts.',409);
      for(const pack of missing){
        const zone=pack.role+' daily routine';
        const version=1+Math.max(0,...w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.area===pack.area&&r.data.zone===zone).map(r=>r.data.version));
        create({kind:'standard',data:{title:pack.role+' — daily tasks',zone,position:pack.role,version,criteria:['Explain the approved opening, service and closing responsibilities for this role.','Demonstrate the reviewed routine with the designated trainer.','Identify when to stop and ask the manager for help.'],source:'JMAX starter draft — general job routines proposed for restaurant review.',verification:'manager',guide:starterGuide(pack),status:'draft',validationNote:'',history:[history('starter-added','Suggested role tasks saved for restaurant review. No operating approval or employee assignment.')],provenance:{starter:{templateId:pack.id,catalogRevision:starterTaskRevision},sourceId:'starter:'+pack.id,sourceRevision:starterTaskRevision,restaurant:w.location.name,sourceDate:localDate(at,w.location.timezone),attribution:'AI-proposed general job routines requested by the owner. Not an approved restaurant SOP or recovered Walter source.',references:[],questions:starterQuestions(pack),answers:{},importedBy:me.id,importedAt:at}}},{...me,area:pack.area});
      }break;
    }
    case 'standard.import': {

      requireThat(!command.recordId,'Import creates a separate draft.');

      const source=recoveredStandards.find(s=>s.id===input.sourceId);

      requireThat(source,'The recovered source is unavailable.',404);

      requireThat(canDraftStandard(me,source.area),'You cannot draft standards for this department.',403);
      requireThat(source.revision===input.sourceRevision,'The recovered source changed. Review it again.',409);

      requireThat(!w.records.some(r=>r.kind==='standard'&&r.data.provenance?.sourceId===source.id&&r.data.status==='draft'),'A draft from this source already exists. Open and continue that draft.',409);

      const version=1+Math.max(0,...w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.area===source.area&&r.data.zone===source.zone).map(r=>r.data.version));

      const data:RecordOf<'standard'>['data']={title:source.title,zone:source.zone,position:source.position,criteria:[...source.criteria],source:source.source,version,verification:source.verification,guide:source.guide,status:'draft',validationNote:'',history:[history('source-imported','Recovered material saved for restaurant review; no operating approval.')],provenance:{sourceId:source.id,sourceRevision:source.revision,restaurant:source.restaurant,sourceDate:source.sourceDate,attribution:source.attribution,references:source.references,questions:source.questions,answers:{},importedBy:me.id,importedAt:at}};

      create({kind:'standard',data},{...me,area:source.area});break;

    }

    case 'standard.save': {

      const previous = command.recordId ? find('standard') : null; const draftPermission=(area:string)=>requireThat(canDraftStandard(me,area),'You cannot draft training for this department.',403);
      if (previous) { draftPermission(previous.area); requireThat(previous.data.status === 'draft', 'Create a new version; approved standards cannot be silently edited.'); }
      const base=input.basedOnId?w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.id===input.basedOnId):undefined;

      if(input.basedOnId){requireThat(base&&!previous&&base.revision===input.basedOnRevision&&base.data.status!=='draft','The source standard changed. Reload it before drafting its next version.',409);draftPermission(base.area);requireThat(input.zone===base.data.zone&&input.position===base.data.position&&Number(input.version)>base.data.version,'A new version must preserve its closing area and station, and use a higher version number.');}
      const draftArea=previous?.area??base?.area??(input.area===undefined?me.area:text(input.area,'Department',100));
      requireThat(input.area===undefined||input.area===draftArea,'An existing guide keeps its original department.');
      requireThat(draftArea===me.area||w.members.some(m=>m.area===draftArea)||w.records.some(r=>r.kind==='station'&&r.area===draftArea),'Choose an existing restaurant department.');
      draftPermission(draftArea);
      const original=previous?.data.provenance??base?.data.provenance;
      const needsReview=!!(original?.intake||original?.starter);
      requireThat(Array.isArray(input.criteria) && (input.criteria.length > 0||needsReview) && input.criteria.length <= 30, 'Supply 1–30 observable completion criteria.');
      requireThat(input.verification === 'manager' || input.verification === 'senior-then-manager', 'Choose the verification chain.');

      requireThat(Number.isInteger(input.version) && Number(input.version) > 0, 'Supply a positive standard version.');

      const guide=readStationGuide(input.guide,needsReview);
      requireThat(input.provenance===undefined,'Recovered source references are supplied by the server and cannot be replaced.');

      const provenance=original?{...original,review:needsReview?(input.sourceReview===undefined?(previous?original.review:undefined):readTrainingReview(input.sourceReview)):undefined,answers:input.sourceAnswers===undefined?(previous?original.answers:{}):readSourceAnswers(input.sourceAnswers,original)}:undefined;
      requireThat(input.sourceAnswers===undefined||!!original,'This standard has no recovered source questions.');

      const data: RecordOf<'standard'>['data'] = { title:text(input.title,'Title',200), zone:text(input.zone,'Area',100), position:text(input.position,'Position',100), criteria:input.criteria.map(c=>text(c,'Criterion',500)), source:text(input.source,'Source',2000), version:Number(input.version), verification:input.verification, status:'draft', validationNote:'', ...(guide?{guide}:{}), ...((base||previous?.data.supersedes)?{supersedes:base?{id:base.id,revision:base.revision}:previous?.data.supersedes}:{}), history:[...(previous?.data.history ?? []),history('drafted','Pending explicit validation and approval.')] };

      if(provenance)data.provenance=provenance;

      if(previous?.data.supersedes)requireThat(data.zone===previous.data.zone&&data.position===previous.data.position,'A revised version keeps the source closing area and station.');

      if (previous) save({ ...previous, data }); else create({ kind:'standard', data },{...me,area:draftArea}); break;
    }

    case 'standard.approve': case 'standard.retire': {

      const r = find('standard'); permitted(r,'standards.approve');

      const approving = command.action === 'standard.approve';

      requireThat(approving ? r.data.status === 'draft' : ['draft','approved'].includes(r.data.status), 'The standard is not at this step.');
      if (approving) {

        requireThat(input.validated === true, 'Confirm validation against the current restaurant source before approval.');

        requireSourceReview(r.data.provenance);
        if(r.data.provenance?.intake||r.data.provenance?.starter){requireThat(r.data.guide&&readStationGuide(r.data.guide)&&r.data.criteria.length,'Complete the guide instructions and observable learning conditions before approval.');const issues=trainingReviewIssues(w,r.data.provenance,at,r.area);requireThat(!issues.length,issues[0]??'Complete the source review.');}
        requireThat(!w.records.some(x=>x.kind==='standard'&&x.id!==r.id&&x.area===r.area&&x.data.zone===r.data.zone&&x.data.version>=r.data.version&&x.data.status!=='draft'),'Use a newer version number for this closing area.');

        for(const old of w.records) if(old.kind==='standard'&&old.id!==r.id&&old.area===r.area&&old.data.zone===r.data.zone&&old.data.status==='approved') save({...old,data:{...old.data,status:'retired',history:[...old.data.history,history('superseded',`Replaced by ${r.id}, version ${r.data.version}`)]}});

      }

      const note = text(input.note,'Validation and approval note');

      save({ ...r, data:{ ...r.data, status:approving ? 'approved':'retired', validationNote:note, history:[...r.data.history,history(approving?'approved':r.data.status==='draft'?'withdrawn':'retired',note)] } }); break;
    }

    case 'close.assign': {

      const shift = activeShifts().find(s => s.id === input.shiftId); requireThat(shift,'Choose an active shift.'); mutableShift(shift); requireThat(canManageClosing(me,shift.area,'tasks.manage'),'You do not have closing permission for this department.',403);

      const owner = member(shift.ownerId); requireThat(owner.position !== 'Dishwasher','Dish uses Schedule and Inbox.');

      const standard = w.records.find((r):r is RecordOf<'standard'> => r.kind === 'standard' && r.id === input.standardId && r.data.status === 'approved' && r.area === shift.area);

      requireThat(standard && guidesForShift(w,shift).some(guide=>guide.id===standard.id), 'Choose an approved standard for this restaurant, department and station.');
      requireThat(owner.qualifications.includes(standard.data.position),'Review this employee’s closing-station clearance before assigning closing work.');

      const previous = command.recordId ? find('close') : null;

      if (previous) { requireThat(canManageClosing(me,previous.area,'tasks.manage'),'You do not have closing permission for this department.',403); requireThat(!['closed','cancelled'].includes(previous.data.phase),'Completed closes cannot be reassigned.'); }

      requireThat(!shiftCloses(shift.id).some(c=>c.id!==previous?.id && c.data.standard.zone === standard.data.zone), 'This shift already owns that closing area.');

      const manager = member(input.managerId), due = instant(input.due,'Closing due time');

      requireThat(due >= shift.data.start && due <= shift.data.end,'The close must be due during its assigned shift.');

      requireThat(manager.id !== owner.id && canManageClosing(manager,shift.area,'close.confirm') && (has(manager,'location.manage') || assignedLeader(w,manager,shift.area,{start:due,end:due})), 'Choose an independent manager assigned to this close.');

      const verifier = standard.data.verification === 'senior-then-manager' ? member(input.verifierId) : null;

      if (verifier) requireThat(verifier.id !== owner.id && verifier.id !== manager.id && canManageClosing(verifier,shift.area,'close.verify'), 'Choose a separate verifier with close-verification capability.');

      const data: RecordOf<'close'>['data'] = {shiftId:shift.id,standardId:standard.id,standardRevision:standard.revision,standard:standard.data,managerId:manager.id,...(verifier?{verifierId:verifier.id}:{}),due,phase:'open',...(previous?.data.attention?{attention:{...previous.data.attention,...(previous.data.managerId!==manager.id?{acknowledgment:undefined}:{})}}:{}),history:[...(previous?.data.history ?? []),history(previous?'reassigned':'assigned',text(input.note??'Assigned with the schedule','Assignment note'))]};

      if(previous) save({...previous,ownerId:owner.id,area:owner.area,data}); else create({kind:'close',data},owner);

      if(shift.data.published) notify([owner.id,manager.id,...(verifier?[verifier.id]:[]),...(previous?.data.correction?[previous.data.correction.personId]:[])],'Closing assignment',`${data.standard.title}: due ${due}.`); break;

    }

    case 'close.correction.assign': {

      const r=find('close');

      requireThat(r.data.phase==='correction','Return the work for correction before assigning a helper.');

      const shift=activeShifts().find(s=>s.id===r.data.shiftId);

      requireThat(shift?.data.published&&!shift.data.releasedAt,'This correction needs an active published closing assignment.');

      requireThat(me.id===r.data.managerId&&canManageClosing(me,r.area,'tasks.manage')&&canManageClosing(me,r.area,'close.confirm')&&(has(me,'location.manage')||assignedLeader(w,me,r.area,{start:r.data.due,end:r.data.due})),'Only the assigned closing manager with task authority can assign correction help.',403);

      requireThat(w.records.some(s=>s.kind==='standard'&&s.id===r.data.standardId&&s.revision===r.data.standardRevision&&s.data.status==='approved'),'Assign the current approved standard before arranging correction help.');

      const person=member(input.personId),note=text(input.note,'Correction assignment and reason');

      requireThat(eligibleCorrectionHelper(r,person),'Choose an active person in this department with reviewed station clearance who is not a checker.');

      const detail=`${person.name} will complete the correction; ${personName(w,r.ownerId)} remains responsible for the close. ${note}`;

      save({...r,data:{...r.data,answers:[],correction:{personId:person.id,assignedBy:me.id,assignedAt:at,note},history:[...r.data.history,history('correction-assigned',detail)]}});

      notify([r.ownerId,person.id,r.data.managerId,...(r.data.correction?[r.data.correction.personId]:[])],`${r.data.standard.title}: correction assignment`,detail,r.id);break;

    }

    case 'close.acknowledge': {

      const r=find('close');

      requireThat(canAcknowledgeClose(w,r),'Only the assigned closing manager can acknowledge this issue.',403);

      requireThat(!['closed','cancelled'].includes(r.data.phase)&&needsCloseAcknowledgment(r),'This close has no pending manager acknowledgment.');

      const note=text(input.note,'Manager response and next step');

      save({...r,data:{...r.data,attention:{...r.data.attention!,acknowledgment:{by:me.id,at,note}},history:[...r.data.history,history('manager-acknowledged',note)]}});

      notify([r.ownerId,r.data.attention!.raisedBy,...(r.data.correction?[r.data.correction.personId]:[])],`${r.data.standard.title}: manager acknowledged`,`${note} Correction and physical checks remain separate.`,r.id);break;

    }

    case 'close.transition': {

      const r = find('close'), step = text(input.step,'Action',30), note = text(input.note,'Evidence or correction');

      const shift = activeShifts().find(s=>s.id===r.data.shiftId); requireThat(shift?.data.published && !shift.data.releasedAt,'This close needs an active published shift.');

      requireThat(w.records.some(s=>s.kind==='standard'&&s.id===r.data.standardId&&s.data.status==='approved'),'This standard was retired. A manager must assign the current approved version.');

      const isManager = me.id === r.data.managerId && canManageClosing(me,r.area,'close.confirm') && (has(me,'location.manage') || assignedLeader(w,me,r.area,{start:r.data.due,end:r.data.due}));

      const isVerifier = me.id === r.data.verifierId && canManageClosing(me,r.area,'close.verify');

      requireThat(input.managerAttention===undefined||step==='fix'&&typeof input.managerAttention==='string'&&Object.hasOwn(attentionReasons,input.managerAttention),'Choose a supported manager-attention reason only when returning a correction.');

      let phase: RecordOf<'close'>['data']['phase'];

      if(step==='ready') { requireThat(me.id===correctionPerformer(r),'Only the person assigned to complete this work can request the check.',403);requireThat(!r.data.correction||eligibleCorrectionHelper(r,me),'The correction assignment needs current station clearance and independent checkers.');requireThat(['open','correction'].includes(r.data.phase),'This close is not awaiting work.'); requireThat(Array.isArray(input.answers)&&input.answers.length===r.data.standard.criteria.length&&r.data.standard.criteria.every((_,index)=>(input.answers as unknown[]).includes(index)), 'Confirm every required condition before requesting the physical check.'); phase = r.data.verifierId ? 'verification':'manager-confirmation'; }

      else if(step==='verify') { requireThat(isVerifier && me.id!==correctionPerformer(r) && r.data.phase==='verification','Only the assigned independent verifier can pass this step.',403); phase='manager-confirmation'; }

      else if(step==='confirm') { requireThat(isManager && me.id!==correctionPerformer(r) && r.data.phase==='manager-confirmation','The independent closing manager must perform final confirmation after the required check.',403); requireThat(!needsCloseAcknowledgment(r),'Acknowledge the flagged issue before final physical confirmation.'); phase='closed'; }

      else if(step==='fix') { requireThat((isVerifier||isManager)&& !['closed','cancelled'].includes(r.data.phase),'Only an assigned checker can return this work.',403); phase='correction'; }

      else { requireThat(false,'Unsupported closing action.'); }

      const data={...r.data,phase,answers:step==='ready' ? input.answers as number[] : phase==='correction' ? [] : r.data.answers,history:[...r.data.history,history(step,note)]};

      if(step==='fix'){

        delete data.correction;

        if(input.managerAttention!==undefined){

          const reason=input.managerAttention as keyof typeof attentionReasons;

          data.attention={reason,raisedBy:me.id,raisedAt:at,note};

          data.history.push(history('manager-attention-required',`${attentionReasons[reason]}: ${note}`));

        }

      }

      save({...r,data});

      const targets=phase==='verification' && r.data.verifierId ? [r.data.verifierId] : phase==='manager-confirmation' ? [r.data.managerId] : phase==='correction' ? [r.ownerId,r.data.managerId] : [r.ownerId];

      notify([...targets,...(r.data.correction?[r.data.correction.personId]:[])],`${r.data.standard.title}: ${step==='fix'&&input.managerAttention?'manager acknowledgment needed':phase}`,step==='fix'&&r.data.correction?`${note} The correction is returned to ${personName(w,r.ownerId)}; the previous helper assignment has ended.`:note,r.id); break;

    }

    case 'close.cancel': {

      const r=find('close'); requireThat(canManageClosing(me,r.area,'tasks.manage'),'You do not have closing permission for this department.',403); requireThat(!['closed','cancelled'].includes(r.data.phase),'This close is already finished.');

      requireThat(!needsCloseAcknowledgment(r),'The closing manager must acknowledge the flagged issue before this assignment can be cancelled.');

      const note=text(input.note,'Why this closing responsibility is no longer required');

      save({...r,data:{...r.data,phase:'cancelled',history:[...r.data.history,history('cancelled',note)]}});

      notify([r.ownerId,r.data.managerId,...(r.data.correction?[r.data.correction.personId]:[])],'Closing assignment cancelled',note,r.id); break;

    }

    case 'shift.release': {

      const r=find('shift'); mutableShift(r); requireThat(r.data.published,'Publish the shift first.');

      requireThat(canManageClosing(me,r.area,'close.confirm') && me.id!==r.ownerId && (has(me,'location.manage')||assignedLeader(w,me,r.area,{start:r.data.end,end:r.data.end})),'The assigned closing manager must confirm operational release.',403);

      requireThat(shiftCloses(r.id).every(c=>c.data.phase==='closed'),'Complete every assigned close and final manager check before release.');
      requireThat(closingStatus({...w,records:projectedRecords()},r).pendingTasks.length===0,'Complete and independently verify every task required for this shift’s checkout before release.');

      const note=text(input.note,'Release confirmation'); save({...r,data:{...r.data,releasedAt:at,history:[...(r.data.history??[]),history('released',note)]}});

      notify([r.ownerId],'Shift checkout confirmed',`${note} This does not change your recorded work time.`); break;

    }

    case 'shift.save': {

      const previous = command.recordId ? find('shift') : null;

      if (previous) { mutableShift(previous); if (previous.data.published) publishedPermission(previous); else permitted(previous, 'schedule.manage'); }

      const target = member(input.personId);

      const period = range(input, 24), position = text(input.position, 'Station', 100);

      if (previous?.data.published) requireThat(canChangePublished(w, me, target.area, period), 'The changed shift is outside your assigned leadership responsibility.', 403);

      else permitted(target, 'schedule.manage');

      const stationId=input.stationId===undefined?previous?.data.stationId:input.stationId?text(input.stationId,'Station',100):undefined;
      checkAssignment(target, period, position, previous?.id,stationId??null);
      const station=stationById(w,stationId);
      if (previous) { requireThat(previous.data.stationId===stationId||!w.records.some(r=>r.kind==='close'&&r.data.shiftId===previous.id&&r.data.phase!=='cancelled'),'Review the attached closing assignment before changing this shift’s station.'); inheritCloses(previous, target, { ...previous.data, ...period, position }); }
      const reason = text(input.note ?? '', 'Change reason', 2000, !previous?.data.published);

      const data = { personId: target.id, ...period, position,...(station?{stationId:station.id,stationName:station.data.title}:{}), published: previous?.data.published ?? false, cancelled: false,...(previous?.data.copiedFrom?{copiedFrom:previous.data.copiedFrom}:{}), ...(previous?.data.importedFrom?{importedFrom:previous.data.importedFrom}:{}), history: [...(previous?.data.history ?? []), history(previous ? 'edited' : 'drafted', reason)] };
      if (previous) { const changed=save({ ...previous, ownerId: target.id, area: target.area, data }) as RecordOf<'shift'>; if(data.published)stationLearning(changed); if (data.published) notify([previous.ownerId, target.id], 'Your schedule changed', `${station?.data.title??position}${station?' ('+position+')':''}: ${period.start} to ${period.end}. Check Schedule for the latest assignment.`); }
      else create({ kind: 'shift', data }, target);

      break;

    }

    case 'shift.publish': case 'shift.cancel': {

      const r = find('shift'); mutableShift(r); const publishing = command.action === 'shift.publish';

      if (publishing) {

        requireThat(canPublish(me, r.area), 'This account cannot publish the schedule.', 403); requireThat(!r.data.published, 'This shift is already published.'); checkAssignment(member(r.ownerId), r.data, r.data.position, r.id);

        requireThat(!pendingCopiedStaffing(w,r).length,'Review or withdraw copied staffing needs before publishing affected shifts.');

        requireThat(publicationReviewed||!w.records.some(n=>n.kind==='staffing'&&n.area===r.area&&n.data.status==='approved'&&overlaps(n.data,r.data)),'Use the weekly publication review to check approved staffing needs before publishing this shift.');

        const issues=closingPublicationIssues(w,r);requireThat(!issues.length,issues[0]?.reason??'Review closing responsibilities before publishing.');

      }

      else { if (r.data.published) publishedPermission(r); else permitted(r, 'schedule.manage'); transferCancelledCloses(r); }

      const reason = text(input.note ?? '', 'Change reason', 2000, publishing || !r.data.published);

      save({ ...r, data: { ...r.data, published: publishing || r.data.published, cancelled: !publishing, history: [...(r.data.history ?? []), history(publishing ? 'published' : 'cancelled', reason)] } });

      if(publishing)stationLearning({...r,data:{...r.data,published:true}});
      if (publishing || r.data.published) notify([r.ownerId], publishing ? 'Shift published' : 'Shift cancelled', `${shiftStationName(r)}${r.data.stationId?' ('+r.data.position+')':''}: ${r.data.start} to ${r.data.end}.`);
      break;

    }

    case 'request.create': {

      requireThat(['time-off', 'swap'].includes(String(input.type)), 'Use the school and availability form for recurring restrictions.');

      const period = range(input), note = text(input.note, 'Request details');

      const data: RecordOf<'request'>['data'] = { ...period, type: input.type as 'time-off' | 'swap' | 'availability', note, status: 'pending' };

      if (data.type === 'swap') {

        const s = w.records.find((r): r is RecordOf<'shift'> => r.kind === 'shift' && r.id === input.shiftId && r.ownerId === me.id && r.data.published && !r.data.cancelled);

        requireThat(s, 'Choose your published shift.');

        const replacement = member(input.replacementId);

        requireThat(replacement.id !== me.id, 'Choose a different employee.');

        checkAssignment(replacement, s.data, s.data.position, s.id);

        Object.assign(data, { start: s.data.start, end: s.data.end, shiftId: s.id, replacementId: replacement.id });

        notify([replacement.id], 'Shift swap needs your response', `${me.name} requested coverage. Accepting sends it to a manager; it does not change the schedule.`);

      }

      const reviewersIds = data.type === 'swap' ? swapReviewers(me.area,data,[me.id,data.replacementId!]) : reviewers(me.area, 'schedule.manage').filter(x => x !== me.id);

      requireThat(reviewersIds.length, 'A schedule reviewer needs to be assigned for your department.');

      create({ kind: 'request', data });

      if(data.type !== 'swap') notify(reviewersIds, 'Schedule request', `${me.name}: ${data.type}. ${note}`);

      break;

    }

    case 'request.consent': {

      const r = find('request');

      requireThat(r.data.type === 'swap' && r.data.replacementId === me.id && r.data.status === 'pending', 'Only the requested replacement can respond at this step.', 403);

      requireThat(typeof input.accept === 'boolean', 'Choose accept or decline.');

      save({ ...r, data: { ...r.data, status: input.accept ? 'accepted-by-replacement' : 'declined', decision: input.accept ? undefined : 'Replacement declined' } });

      notify([r.ownerId, ...(input.accept ? swapReviewers(r.area,r.data,[r.ownerId,me.id]) : [])], input.accept ? 'Swap ready for manager review' : 'Swap declined', `${me.name} ${input.accept ? 'accepted the proposed coverage' : 'declined the proposed coverage'}.`);

      break;

    }

    case 'request.review': {

      const r = find('request');

      requireThat(r.data.type !== 'availability','Replace this old availability note with a recurring availability request before review.');

      if (r.data.type === 'swap') requireThat(canChangePublished(w, me, r.area, r.data), 'The leader responsible for that shift must review this swap.', 403);

      else permitted(r, 'schedule.manage');

      requireThat(me.id !== r.ownerId && me.id !== r.data.replacementId, 'A different authorized manager must review this request.', 403);

      requireThat(['pending', 'accepted-by-replacement'].includes(r.data.status), 'This request has already been reviewed.');

      requireThat(typeof input.approve === 'boolean', 'Choose approve or decline.');

      const decision = text(input.note, 'Review note');

      if (input.approve && r.data.type === 'time-off') {

        const cancelled=activeShifts().filter(s => s.ownerId === r.ownerId && overlaps(s.data, r.data));
        if(input.affectedShifts!==undefined)verifyTimeOffImpact(cancelled,input.affectedShifts);
        for (const shift of cancelled) { mutableShift(shift); if (shift.data.published) publishedPermission(shift); transferCancelledCloses(shift,cancelled.map(s=>s.id)); save({ ...shift, data: { ...shift.data, cancelled: true, history: [...(shift.data.history ?? []), history('time-off-approved', decision)] } }); }

      }

      if (input.approve && r.data.type === 'swap') {

        requireThat(r.data.status === 'accepted-by-replacement', 'The replacement must accept before manager approval.');

        const shift = activeShifts().find(s => s.id === r.data.shiftId && s.ownerId === r.ownerId && s.data.published);

        requireThat(shift && shift.data.start === r.data.start && shift.data.end === r.data.end, 'The original shift changed. Submit a new swap request.', 409);

        mutableShift(shift);

        const replacement = member(r.data.replacementId); requireThat(canChangePublished(w, me, replacement.area, shift.data), 'Replacement is outside your assigned schedule authority.', 403);

        checkAssignment(replacement, shift.data, shift.data.position, shift.id);

        inheritCloses(shift, replacement);

        const changed=save({ ...shift, ownerId: replacement.id, area: replacement.area, data: { ...shift.data, personId: replacement.id, history: [...(shift.data.history ?? []), history('swap-approved', decision)] } }) as RecordOf<'shift'>;stationLearning(changed);
      }

      save({ ...r, data: { ...r.data, status: input.approve ? 'approved' : 'declined', decision } });

      notify([r.ownerId, ...(r.data.replacementId ? [r.data.replacementId] : [])], `${r.data.type} ${input.approve ? 'approved' : 'declined'}`, decision);

      break;

    }

    case 'task.dish-cycle': {
      requireThat(!command.recordId,'Create a new dishwasher checkout cycle.');
      requireThat(Array.isArray(input.pmOwnerIds)&&input.pmOwnerIds.length===2,'Choose two PM dishwashers.');
      const people=[member(input.amOwnerId),...input.pmOwnerIds.map(value=>member(value))];
      requireThat(new Set(people.map(p=>p.id)).size===3,'AM and both PM checkouts require three distinct people.');
      requireThat(people.every(p=>p.locationId===me.locationId&&p.area==='BOH'&&p.position==='Dishwasher'&&!p.scheduleOnly),'Choose three active BOH dishwashers with sign-in access at this restaurant.');
      requireThat(operationsManager(me,'BOH'),'Dishwasher checkout assignment requires this restaurant’s BOH manager or authorized GM.',403);
      const businessDate=calendarDate(input.businessDate,'Checkout business date'),title=text(input.title,'Checkout title',200),detail=text(input.detail,'Checkout requirements'),due=instant(input.due,'Checkout due time'),cycleId=makeId();
      requireThat(!w.records.some(r=>r.kind==='task'&&r.data.dishCheckout?.businessDate===businessDate),'A dishwasher checkout cycle already exists for this business date.');
      for(const [index,person] of people.entries()){
        const checkout=create({kind:'task',data:{title:`${index===0?'AM':'PM'} checkout: ${title}`,detail,kind:'task',phase:'open',due,history:[history('assigned',detail)],dishCheckout:{cycleId,shift:index===0?'AM':'PM',participantIds:people.map(p=>p.id),businessDate}}},person);
        notify([person.id],'Dishwasher checkout assigned',title,checkout.id);
      }
      break;
    }

    case 'task.dish-pass': {
      const r=find('task');own(r);
      requireThat(me.position==='Dishwasher'&&r.data.kind==='task'&&r.data.dishCheckout?.shift==='AM','Only your AM dishwasher checkout can pass unfinished work.',403);
      requireThat(['open','correction'].includes(r.data.phase),'Pass unfinished work before submitting your checkout.');
      const incoming=member(input.incomingId),metadata=r.data.dishCheckout!;
      requireThat(incoming.id!==me.id&&incoming.position==='Dishwasher'&&!incoming.scheduleOnly&&incoming.area===r.area&&incoming.locationId===r.locationId&&Array.isArray(metadata.participantIds)&&metadata.participantIds.slice(1).includes(incoming.id),'Choose an incoming PM dishwasher from this checkout cycle.');
      const pm=w.records.find(p=>p.kind==='task'&&p.data.dishCheckout?.cycleId===metadata.cycleId&&p.data.dishCheckout.shift==='PM'&&p.ownerId===incoming.id);
      requireThat(pm&&pm.kind==='task'&&['open','correction'].includes(pm.data.phase),'The incoming PM checkout must still be available and awaiting work.');
      const note=text(input.note,'Unfinished work and next action'),due=instant(input.due,'Remaining work due time');
      const child=create({kind:'task',data:{title:`Unfinished AM work: ${r.data.title}`,detail:note,kind:'task',phase:'open',due,history:[history('passed',note)],dishHandoff:{sourceId:r.id,cycleId:metadata.cycleId,businessDate:metadata.businessDate,acceptedBy:'',acceptedAt:null}}},incoming);
      save({...r,data:{...r.data,dishHandoffs:[...(r.data.dishHandoffs??[]),child.id],history:[...r.data.history,history('passed',`${note} Incoming dishwasher: ${incoming.name}; linked work: ${child.id}.`)]}});
      notify([incoming.id],'Unfinished AM dish work awaits acceptance',note,child.id);break;
    }

    case 'task.create': {

      requireThat(me.position!=='Dishwasher','Task assignment requires manager access.',403);

      const target = member(input.ownerId);
      const shiftId=input.shiftId===undefined||input.shiftId===''?undefined:id(input.shiftId);
      if(shiftId)requireThat(canManageClosing(me,target.area,'tasks.manage'),'You do not have closing permission for this department.',403);else permitted(target,'tasks.manage');

      const kind = input.kind; requireThat(kind === 'task' || kind === 'issue' || kind === 'handoff', 'Choose a task type.');
      requireThat(target.position !== 'Dishwasher' || kind === 'task', 'Assign ordinary work to a dishwasher; operational issues and handoffs require another eligible person.');

      const incoming = kind === 'handoff' ? member(input.incomingId) : null;

      if (incoming) { if(shiftId)requireThat(canManageClosing(me,incoming.area,'tasks.manage'),'You do not have closing permission for the incoming department.',403);else permitted(incoming,'tasks.manage'); requireThat(incoming.id !== target.id && incoming.position !== 'Dishwasher', 'Choose a different incoming employee with task access.'); }

      const due=instant(input.due,'Due time');
      if(shiftId){
        const shift=w.records.find((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.id===shiftId&&r.locationId===w.location.id&&r.ownerId===target.id&&r.area===target.area&&r.data.published&&!r.data.cancelled&&!r.data.releasedAt);
        requireThat(shift,'Choose this employee’s active published shift in this department.');
        requireThat(due>=shift.data.start&&due<=shift.data.end,'Checkout work must be due during its linked shift.');
      }
      create({ kind: 'task', data: { title: text(input.title, 'Task', 200), detail: text(input.detail, 'Definition of done'), kind, phase: 'open', due, ...(shiftId?{shiftId}:{}), ...(incoming ? { incomingId: incoming.id } : {}), history: [history('assigned', text(input.detail, 'Definition of done'))] } }, target);

      notify([target.id], 'Task assigned', text(input.title, 'Task', 200));

      break;

    }

    case 'task.transition': {

      const r = find('task'), step = input.step, note = text(input.note, 'Evidence or next action');

      requireThat(me.position!=='Dishwasher'||r.ownerId===me.id&&r.data.kind==='task'&&(step==='ready'||step==='accept'&&!!r.data.dishHandoff),'Only your own task submission or incoming dishwasher acceptance is available.',403);
      const dishManaged=()=>{if(r.data.kind==='task'&&(r.data.dishCheckout||r.data.dishHandoff))requireThat(operationsManager(me,r.area),'Checkout verification requires this department’s manager or authorized store GM.',403);else if(r.data.shiftId)requireThat(canManageClosing(me,r.area,'tasks.manage'),'Checkout verification requires closing authority for this department.',403);else permitted(r,'tasks.manage');};
      const dishReviewers=()=>w.members.filter(m=>m.locationId===r.locationId&&operationsManager(m,r.area)).map(m=>m.id);
      const requireIncomingSource=()=>{
        const link=r.data.dishHandoff;
        if(!link)return;
        const source=w.records.find((p):p is RecordOf<'task'>=>p.id===link.sourceId&&p.kind==='task'&&p.locationId===r.locationId&&p.area===r.area&&p.data.kind==='task'&&p.data.dishCheckout?.shift==='AM'&&p.data.dishCheckout.cycleId===link.cycleId&&p.data.dishCheckout.businessDate===link.businessDate&&p.data.dishCheckout.participantIds.slice(1).includes(r.ownerId)&&!!p.data.dishHandoffs?.includes(r.id));
        requireThat(source,'The original unfinished-work link is missing or changed. Ask a manager to review it.');
        return source;
      };

      if(step==='accept'&&r.data.dishHandoff){
        own(r);requireThat(me.position==='Dishwasher'&&['open','correction'].includes(r.data.phase)&&!r.data.dishHandoff.acceptedBy,'Only the incoming dishwasher can accept this pending work.',403);const source=requireIncomingSource();requireThat(source,'The original unfinished-work link is missing.');
        save({...r,data:{...r.data,dishHandoff:{...r.data.dishHandoff,acceptedBy:me.id,acceptedAt:at},history:[...r.data.history,history('accepted',note)]}});
        save({...source,data:{...source.data,dishHandoffAcceptances:[...(source.data.dishHandoffAcceptances??[]).filter(a=>a.handoffId!==r.id),{handoffId:r.id,acceptedBy:me.id,acceptedAt:at}],history:[...source.data.history,history('incoming-accepted',`Incoming responsibility accepted for handed-off work ${r.id}.`)]}});
        notify(dishReviewers(),'Incoming dishwasher accepted unfinished work',note,r.id);break;
      }

      if(step==='accept'&&r.data.shiftId&&r.data.kind==='handoff'){
        requireThat(r.data.incomingId===me.id&&r.data.phase==='acceptance'&&!r.data.closingHandoff,'Only the incoming employee can receive this checkout work.',403);
        const incoming=member(me.id);
        requireThat(incoming.position!=='Dishwasher'&&incoming.locationId===r.locationId,'Choose an active incoming employee at this restaurant.');
        const shift=w.records.find((s):s is RecordOf<'shift'>=>s.kind==='shift'&&s.id===r.data.shiftId&&s.locationId===r.locationId&&s.ownerId===r.ownerId&&s.data.published&&!s.data.cancelled&&!s.data.releasedAt);
        requireThat(shift,'The original checkout shift changed. Ask a manager to review this handoff.');
        // Receipt changes who performs the remaining work, not whether it is done.
        // Retain the original department and shift link for its independent checker.
        save({...r,ownerId:incoming.id,data:{...r.data,phase:'open',closingHandoff:{outgoingId:r.ownerId,acceptedBy:incoming.id,acceptedAt:at},history:[...r.data.history,history('accepted',note)]}});
        notify([incoming.id,r.ownerId,...closingReviewers(r.area)],'Checkout work received',`${note} Complete the remaining work and request independent verification before checkout.`,r.id);break;
      }

      let phase: RecordOf<'task'>['data']['phase'];

      if (step === 'ready') { own(r); requireThat(['open', 'correction'].includes(r.data.phase), 'This is not awaiting work.');requireIncomingSource();requireThat(!r.data.dishHandoff||r.data.dishHandoff.acceptedBy===me.id,'Accept the unfinished work before reporting it ready.');
        if(r.data.dishCheckout?.shift==='PM'){
          const cycle=dishCheckoutCycleStatus(w,r.data.dishCheckout.cycleId);
          requireThat(cycle.coverageComplete,'The expected checkout or unfinished work record is missing or inconsistent. Ask a manager to review the cycle.');
          requireThat(!w.records.some(p=>p.kind==='task'&&p.ownerId===me.id&&p.data.dishHandoff?.cycleId===r.data.dishCheckout!.cycleId&&p.data.phase!=='closed'),'Your unfinished incoming work must be completed and verified before submitting PM checkout.');
        }
        phase = 'verification'; }

      else if (step === 'fix') { dishManaged(); requireThat(r.data.phase !== 'closed', 'This task is closed.'); phase = 'correction'; }

      else if (step === 'verify') { dishManaged(); requireThat(me.id !== r.ownerId, 'Someone else must verify the work.', 403); requireThat(r.data.phase === 'verification', 'The employee must report ready first.'); phase = r.data.kind === 'handoff'&&!r.data.closingHandoff ? 'acceptance' : 'closed'; }

      else if (step === 'accept' || step === 'dispute') { requireThat(r.data.incomingId === me.id && r.data.phase === 'acceptance', 'Only the incoming employee can respond at this step.', 403); phase = step === 'accept' ? 'closed' : 'correction'; }

      else { requireThat(false, 'Unsupported task step.'); }

      save({ ...r, data: { ...r.data, phase, history: [...r.data.history, history(String(step), note)] } });

      notify(phase === 'verification' ? r.data.dishCheckout||r.data.dishHandoff?dishReviewers():r.data.shiftId?closingReviewers(r.area):reviewers(r.area, 'tasks.manage') : phase === 'acceptance' && r.data.incomingId ? [r.data.incomingId] : [r.ownerId], `${r.data.title}: ${phase}`, note);

      break;

    }

    case 'task.reassign': {

      requireThat(me.position!=='Dishwasher','Task reassignment requires manager access.',403);

      const r=find('task');permitted(r,'tasks.manage');requireThat(r.data.phase!=='closed','This task is complete.');
      requireThat(!r.data.dishCheckout&&!r.data.dishHandoff,'Keep checkout and incoming work with their original assigned dishwasher.');

      const target=member(input.ownerId);permitted(target,'tasks.manage');requireThat((target.position!=='Dishwasher'||r.data.kind==='task')&&target.area===r.area&&target.id!==r.data.incomingId,'Choose an eligible person in this department.');
      requireThat(!r.data.shiftId||target.id===r.ownerId,'Keep required checkout work with its linked shift; use the designated incoming handoff for remaining work.');

      const note=text(input.note,'Reason and remaining work');

      save({...r,ownerId:target.id,data:{...r.data,phase:'open',history:[...r.data.history,history('reassigned',`${r.ownerId} → ${target.id}: ${note}`)]}});

      notify([r.ownerId,target.id],'Task responsibility changed',`${r.data.title}: ${note}`);break;

    }

    case 'order.save': case 'order.food-save': {

      requireThat(has(me, 'orders.request'), 'Ordering requests are not enabled for this account.', 403);

      const r = command.recordId ? find('order') : null;
      const foodLinked=command.action==='order.food-save';
      requireThat(!foodLinked||resolvedFoodOrder,'Food purchasing must resolve its source records before saving.');
      requireThat(!r?.data.food||foodLinked,'Edit this food-linked request from Food purchasing.');

      if (r) { own(r); requireThat(['draft', 'returned'].includes(r.data.status), 'Return or withdraw the order before editing it.'); }

      requireThat(foodLinked||Array.isArray(input.lines) && input.lines.length > 0 && input.lines.length <= 200, 'An order needs 1–200 items.');

      const lines: Line[] = foodLinked?resolvedFoodOrder!.lines:(input.lines as unknown[]).map(value => { const l = object(value); requireThat(typeof l.quantity === 'number' && Number.isFinite(l.quantity) && l.quantity > 0 && l.quantity <= 10000, 'Every quantity must be greater than zero and at most 10,000.'); return { name: text(l.name, 'Item', 200), quantity: l.quantity, unit: text(l.unit, 'Unit', 40), productId: text(l.productId ?? '', 'Product number', 100, true), note: text(l.note ?? '', 'Item note', 500, true) }; });

      requireThat(!foodLinked||(r?.data.foodVersions?.length??0)<40,'This request has 40 saved versions. Start a new purchasing request.');
      const data: RecordOf<'order'>['data'] = { lines, note: text(input.note ?? '', 'Order note', 2000, true), status: 'draft', history: [...(r?.data.history ?? []), history('saved', 'Internal request saved')],...(foodLinked?{food:resolvedFoodOrder!.source,foodVersions:[...(r?.data.foodVersions??[]),...(r?.data.food?[{at,by:me.id,food:r.data.food,lines:r.data.lines}]:[])]}:{}) };

      if (r) save({ ...r, data }); else create({ kind: 'order', data });

      break;

    }

    case 'order.submit': case 'order.withdraw': {

      const r = find('order'); own(r); requireThat(has(me, 'orders.request'), 'Ordering requests are not enabled.', 403);

      const submit = command.action === 'order.submit';

      requireThat(submit ? ['draft', 'returned'].includes(r.data.status) : r.data.status === 'review', 'The order is not at this step.');

      const purchasers = w.members.filter(m => has(m, 'orders.review')&&(!r.data.food||m.id!==r.ownerId)).map(m => m.id);

      requireThat(purchasers.length, 'An order reviewer needs to be assigned for this restaurant.');

      save({ ...r, data: { ...r.data, status: submit ? 'review' : 'draft', history: [...r.data.history, history(submit ? 'submitted' : 'withdrawn', 'Internal review only; no supplier purchase')] } });

      if (submit) notify(purchasers, 'Order ready for review', `${me.name} submitted ${r.data.lines.length} items.`);

      break;

    }

    case 'order.review': {

      const r = find('order'); requireThat(has(me, 'orders.review'), 'This account cannot approve purchases.', 403); requireThat(r.data.status === 'review', 'This order is not awaiting review.');
      requireThat(!r.data.food||r.ownerId!==me.id,'A different authenticated purchasing reviewer must review this request.',403);

      requireThat(typeof input.approve === 'boolean', 'Choose approve or return.');

      const note = text(input.note, 'Review note');

      save({ ...r, data: { ...r.data, status: input.approve ? 'approved' : 'returned', reviewerId: me.id, approvedRevision: input.approve ? r.revision : undefined, history: [...r.data.history, history(input.approve ? 'approved' : 'returned', note)] } });

      notify([r.ownerId], input.approve ? 'Order approved for supplier preparation' : 'Order needs changes', `${note} No supplier order has been placed.`);

      break;

    }

    case 'message.send': {

      requireThat(Array.isArray(input.recipients) && input.recipients.length > 0 && input.recipients.length <= 100, 'Choose 1–100 recipients.');

      const recipients = [...new Set(input.recipients.map(value => member(value).id))];

      const context=attachMessageContext(w,input.context,recipients.map(member),at,(record,target,workspace)=>visible(record,target,workspace,at));

      create({ kind: 'message', data: { title: text(input.title, 'Subject', 200), body: text(input.body, 'Message', 4000), recipients, readBy: [me.id], replies: [],...(context?{context,recordId:context.recordId}:{}) } });

      break;

    }

    case 'message.read': case 'message.reply': {

      const r = find('message');

      if (command.action === 'message.read') save({ ...r, data: { ...r.data, readBy: [...new Set([...r.data.readBy, me.id])] } });

      else { requireThat(!r.data.automated, 'Open the related review to act on this reminder.'); requireThat(r.data.replies.length < 100, 'Start a new message to continue this conversation.'); save({ ...r, data: { ...r.data, readBy:[me.id], replies: [...r.data.replies, { actorId: me.id, text: text(input.text, 'Reply', 4000), at }] } }); }

      break;

    }

    case 'feedback.save': {

      requireThat(me.position !== 'Dishwasher', 'Dish uses Schedule and Inbox.');

      const r = command.recordId ? find('feedback') : null;

      if (r) { own(r); requireThat(!r.data.shared, 'Shared feedback cannot be silently rewritten.'); }

      requireThat(typeof input.shared === 'boolean', 'Choose whether to share this.');

      const data: RecordOf<'feedback'>['data'] = { text: text(input.text, 'Note', 4000), shared: input.shared, status: input.shared ? 'submitted' : 'private', response: '', due: '', history: [] };

      if (r) save({ ...r, data }); else create({ kind: 'feedback', data });

      if (data.shared) notify(reviewers(me.area, 'people.manage'), 'Employee feedback shared', `${me.name} shared feedback for follow-up.`);

      break;

    }

    case 'feedback.respond': {

      const r = find('feedback'); permitted(r, 'people.manage'); requireThat(r.data.shared && r.ownerId !== me.id && r.data.status !== 'closed', 'This is not open shared feedback.', 403);

      const response = text(input.response, 'Manager commitment'), due = instant(input.due, 'Follow-up time');

      save({ ...r, data: { ...r.data, status: 'follow-up', response, due, history: [...r.data.history, history('commitment', response)] } });

      notify([r.ownerId], 'Manager follow-up', `${response} Follow-up: ${due}.`); break;

    }

    case 'feedback.close': {

      const r = find('feedback'); own(r); requireThat(r.data.status === 'follow-up', 'A manager commitment must come first.');

      save({ ...r, data: { ...r.data, status: 'closed', history: [...r.data.history, history('confirmed', text(input.note, 'Outcome'))] } }); break;

    }

    case 'feedback.reopen': {

      const r=find('feedback');own(r);requireThat(r.data.shared&&['follow-up','closed'].includes(r.data.status),'Only shared feedback with a manager response can be reopened.');

      const note=text(input.note,'What still needs attention');save({...r,data:{...r.data,status:'submitted',history:[...r.data.history,history('reopened',note)]}});

      notify(reviewers(r.area,'people.manage'),'Employee feedback needs further follow-up',note);break;

    }

    default: requireThat(false, 'Unsupported action.');

  }

  // Any change to the offered shift or its duties invalidates old consent in

  // the same transaction. The approval above has already closed its own offer.

  const projected={...w,records:[...w.records.filter(r=>!changes.has(r.id)),...changes.values()]};

  for(const r of projected.records)if(r.kind==='coverage'&&r.data.status==='open') {

    const issue=coverageIssue(projected,r,at);

    if(issue){

      save({...r,data:{...r.data,status:'invalidated',history:[...r.data.history,history('invalidated',issue)]}});

      coverageNotice(r,[r.ownerId,...r.data.volunteers.map(v=>v.personId)],'Coverage offer needs a fresh review',issue);

    }

  }

  requireThat(changes.size > 0, 'No change to save.');

  return [...changes.values()];

}
