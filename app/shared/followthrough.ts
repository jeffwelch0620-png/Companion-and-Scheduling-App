import { manages, type Command, type Member, type WorkRecord, type RecordOf, type Kind, type Workspace, type History, type AssessmentStation } from './types';
import { requireThat, text, instant, object } from './validation';
import { calendarDate } from './schedule-policy';
import {learningGuides, learningReviewer, reviewGuideOptions} from './personal-learning';
import {localDate, localInstant, nextDate} from './local-time';

export type CommandContext = {
  w:Workspace; me:Member; command:Command; input:Record<string,unknown>; at:string;
  member:(id:unknown)=>Member; own:(r:WorkRecord)=>void;
  permitted:(target:Member|WorkRecord,capability:Parameters<typeof manages>[2])=>void;
  find:<K extends Kind>(kind:K,recordId?:string)=>RecordOf<K>;
  save:(r:WorkRecord)=>WorkRecord;
  create:(r:Pick<WorkRecord,'kind'|'data'>,owner?:Member)=>WorkRecord;
  notify:(targets:string[],title:string,body:string,recordId?:string)=>void;
  history:(action:string,note:string)=>History[number];
};

// Reviews have named participants. Draft assessment text is private to its author.
export function visibleDevelopment(r:RecordOf<'development'>,me:Member) {
  return me.position!=='Dishwasher' && (r.ownerId===me.id || r.data.managerId===me.id&&manages(me,r.area,'people.manage') || r.data.approverId===me.id&&manages(me,r.area,'people.approve'));
}
export function redactAssessment(r:RecordOf<'development'>,me:Member):RecordOf<'development'> {
  const hideSelf=!r.data.selfShared&&r.ownerId!==me.id;
  const hideManager=!r.data.managerShared&&r.data.managerId!==me.id;
  return {...r,data:{...r.data,selfSummary:hideSelf?'':r.data.selfSummary,managerSummary:hideManager?'':r.data.managerSummary,stations:r.data.stations.map(s=>({...s,...(hideSelf?{selfScore:null,selfRatingScale:undefined,selfNote:''}:{}),...(hideManager?{managerScore:null,managerRatingScale:undefined,managerNote:''}:{})}))}};
}
export function reviewDueState(r:RecordOf<'development'>,today:string) {
  const overdueDays=Math.max(0,Math.floor((Date.parse(today)-Date.parse(r.data.originalDueDate))/86400000));
  return {overdueDays,responsibleId:r.data.phase==='gm-review'?r.data.approverId:r.data.managerId,level:overdueDays>=7?'owner':overdueDays>=5?'second-reminder':overdueDays>=3?'first-reminder':'normal'};
}

export function applyFollowthrough(c:CommandContext) {
  const {w,me,command,input,at,member,own,permitted,find,save,create,notify,history}=c;
  const phase=(current:string,allowed:string[])=>requireThat(allowed.includes(current),'This item is not at that step.');
  const notDish=(m:Member)=>requireThat(m.position!=='Dishwasher','Dish uses Schedule and Inbox.');
  const assigned=(personId:string,leadershipId:unknown,area:string)=>{
    const r=w.records.find((r):r is RecordOf<'leadership'>=>r.kind==='leadership'&&r.id===leadershipId&&r.ownerId===personId&&r.area===area&&r.data.active);
    requireThat(r,'Choose an active shift-leadership assignment for this manager.');
    requireThat(manages(member(personId),area,'tasks.manage'),'The assigned manager needs task-management authority.');
    return r;
  };
  const managerFor=(owner:Member,id:unknown,cap:'people.manage'|'tasks.manage')=>{
    const manager=member(id);requireThat(manager.id!==owner.id&&manages(manager,owner.area,cap),'Choose a different authorized manager for this employee.');return manager;
  };
  if(command.action==='handoff.create') {
    notDish(me);permitted(me,'tasks.manage');
    const outgoing=assigned(me.id,input.outgoingLeadershipId,me.area), incoming=member(input.incomingId);
    requireThat(incoming.id!==me.id,'Choose the receiving manager.');
    const opening=assigned(incoming.id,input.incomingLeadershipId,me.area);
    requireThat(opening.data.start>=outgoing.data.end,'Choose an opening assignment after the closing assignment.');
    requireThat(input.safeToDefer===true,'The closing manager must explicitly confirm that this issue can be deferred safely.');
    requireThat(input.priority==='routine'||input.priority==='urgent','Choose a priority.');
    const owners=w.members.filter(m=>manages(m,me.area,'operations.escalation')).map(m=>m.id);
    if(input.priority==='urgent') requireThat(owners.length,'Configure an owner escalation recipient before deferring an urgent issue.');
    const title=text(input.title,'Issue',200), detail=text(input.detail,'Condition, temporary action and next step',4000);
    create({kind:'handoff',data:{title,detail,outgoingId:me.id,incomingId:incoming.id,outgoingLeadershipId:outgoing.id,incomingLeadershipId:opening.id,due:opening.data.start,priority:input.priority,phase:'offered',history:[history('offered','Closing manager confirmed safe deferral; responsibility remains with the closing manager until acceptance.')]}},me);
    notify([incoming.id,...(input.priority==='urgent'?owners:[])],'Overnight handoff needs acceptance',`${title}: ${detail}`);return;
  }
  if(command.action==='handoff.transition') {
    const r=find('handoff'), step=input.step, note=text(input.note,'Condition and next action');
    let next:RecordOf<'handoff'>=r;
    if(step==='accept'||step==='dispute') {
      requireThat(me.id===r.data.incomingId,'Only the named incoming manager can accept or dispute this handoff.',403);
      const incomingAssignment=assigned(me.id,r.data.incomingLeadershipId,r.area);
      if(r.data.history.some(h=>h.action==='recover'))requireThat(incomingAssignment.locationId===r.locationId&&incomingAssignment.data.end>at,'This recovered offer needs current or upcoming active replacement leadership.');
      phase(r.data.phase,['offered']);
      next={...r,ownerId:step==='accept'?me.id:r.ownerId,data:{...r.data,phase:step==='accept'?'accepted':'disputed'}};
    } else if(step==='recover') {
      // The configured department manager or store GM may recover unresolved
      // accepted work when its named owner can no longer follow through. This
      // appoints a new receiver; it never records completion or safety proof.
      notDish(me);permitted(r,'tasks.manage');phase(r.data.phase,['accepted']);
      const incoming=member(input.incomingId),opening=assigned(incoming.id,input.incomingLeadershipId,r.area);
      requireThat(incoming.id!==me.id&&incoming.id!==r.ownerId,'Choose a different replacement manager.');
      requireThat(incoming.locationId===r.locationId&&opening.locationId===r.locationId&&opening.data.end>at,'Choose a current or upcoming active replacement leadership assignment in this restaurant.');
      next={...r,ownerId:me.id,data:{...r.data,incomingId:incoming.id,incomingLeadershipId:opening.id,due:opening.data.start,phase:'offered'}};
    } else if(step==='offer') {
      requireThat(me.id===r.ownerId,'The currently responsible manager must update this handoff.',403);permitted(r,'tasks.manage');phase(r.data.phase,['offered','disputed']);
      const incoming=member(input.incomingId), opening=assigned(incoming.id,input.incomingLeadershipId,r.area);
      const outgoing=w.records.find(x=>x.id===r.data.outgoingLeadershipId&&x.kind==='leadership');
      requireThat(incoming.id!==me.id&&outgoing?.kind==='leadership'&&opening.data.start>=outgoing.data.end,'Choose the next opening manager.');
      if(r.data.history.some(h=>h.action==='recover'))requireThat(opening.locationId===r.locationId&&opening.data.end>at,'Choose current or upcoming active replacement leadership for this recovered offer.');
      next={...r,data:{...r.data,incomingId:incoming.id,incomingLeadershipId:opening.id,due:opening.data.start,phase:'offered'}};
    } else if(step==='resolve') {
      own(r);permitted(r,'tasks.manage');phase(r.data.phase,['accepted']);
      next={...r,data:{...r.data,phase:'resolved'}};
    } else if(step==='cancel') {
      own(r);permitted(r,'tasks.manage');phase(r.data.phase,['offered','disputed']);
      next={...r,data:{...r.data,phase:'cancelled'}};
    } else requireThat(false,'Unsupported handoff action.');
    save({...next,data:{...next.data,history:[...r.data.history,history(String(step),note)]}});
    const escalation=step==='recover'&&r.data.priority==='urgent'?w.members.filter(m=>manages(m,r.area,'operations.escalation')).map(m=>m.id):[];
    if(step==='recover'&&r.data.priority==='urgent')requireThat(escalation.length,'Configure an authorized owner escalation recipient before recovering this urgent issue.');
    notify([r.data.outgoingId,r.data.incomingId,r.ownerId,next.ownerId,next.data.incomingId,...escalation],`${r.data.title}: ${next.data.phase}`,step==='recover'?`${note} Responsibility remains with ${me.name} until the named replacement accepts. The unresolved condition and priority are unchanged.`:note);return;
  }
  if(command.action==='development.create') {
    const owner=member(input.ownerId);notDish(owner);permitted(owner,'people.manage');
    const manager=managerFor(owner,input.managerId,'people.manage'), approver=member(input.approverId);
    requireThat(approver.id!==owner.id&&approver.id!==manager.id&&manages(approver,owner.area,'people.approve'),'Choose an independent GM with review-approval authority.');
    requireThat(!w.records.some(r=>r.kind==='development'&&r.ownerId===owner.id&&!['approved','cancelled'].includes(r.data.phase)),'Complete or cancel the open review for this employee first.');
    const hireDate=calendarDate(input.hireDate,'Hire date'), originalDueDate=calendarDate(input.dueDate,'Original review due date');
    requireThat(originalDueDate>=hireDate,'The review due date must follow the hire date.');
    if(input.guideRefs!==undefined){
      requireThat(Array.isArray(input.guideRefs)&&input.guideRefs.length>0&&input.guideRefs.length<=20,'Choose 1–20 approved guides for this review.');
      const options=reviewGuideOptions(w,owner);
      input.stations=input.guideRefs.map(value=>{const ref=object(value),g=options.find(g=>g.id===ref.id&&g.revision===ref.revision);requireThat(g,'An instruction changed or does not belong to this employee’s job. Refresh the review.',409);return {...g,standardId:g.id,standardRevision:g.revision}});
    }else requireThat(input.validated===true,'Validate the station criteria against the current restaurant source.');
    requireThat(Array.isArray(input.stations)&&input.stations.length>0&&input.stations.length<=20,'Choose 1–20 stations for this review.');
    const stations:AssessmentStation[]=input.stations.map(x=>{const s=object(x);return {name:text(s.name,'Station',input.guideRefs?400:100),definition:text(s.definition,'Observable criteria',input.guideRefs?16000:2000),source:text(s.source,'Current source',2000),...(input.guideRefs?{standardId:String(s.standardId),standardRevision:Number(s.standardRevision)}:{}),selfScore:null,selfNote:'',managerScore:null,managerNote:''}});
    requireThat(new Set(stations.map(s=>s.name.toLowerCase())).size===stations.length,'Use each station only once.');
    create({kind:'development',data:{title:'Development review',managerId:manager.id,approverId:approver.id,hireDate,originalDueDate,stations,phase:'self-assessment',selfShared:false,managerShared:false,submissions:[],selfSummary:'',managerSummary:'',managerDiscussion:'',employeeDiscussion:'',approvalNote:'',history:[history('created','Station criteria validated; original due date set.')] }},owner);
    notify([owner.id,manager.id],'Development review opened',`Self-assessment comes first. Original due date: ${originalDueDate}.`);return;
  }
  if(command.action==='development.assess') {
    const r=find('development'), self=input.by==='employee';
    requireThat(input.by==='employee'||input.by==='manager','Choose the assessment author.');
    if(self){own(r);phase(r.data.phase,['self-assessment']);}else{requireThat(me.id===r.data.managerId,'Only the assigned manager can assess this employee.',403);permitted(r,'people.manage');phase(r.data.phase,['manager-assessment']);}
    requireThat(typeof input.submit==='boolean','Choose save draft or submit.');
    requireThat(Array.isArray(input.ratings)&&input.ratings.length===r.data.stations.length,'Provide a rating entry for each assigned station.');
    const ratings=input.ratings.map(value=>{const entry=object(value),score=entry.score;requireThat(score===null||typeof score==='number'&&Number.isInteger(score)&&score>=0&&score<=10,'Use a whole-number score from 0 to 10.');const note=text(entry.note??'','Station examples',2000,!input.submit);if(input.submit)requireThat(score!==null,'Rate every station before submitting.');if(entry.scale!==undefined)requireThat(entry.scale==='readiness-v1'&&(score===null||[0,1,5,10].includes(Number(score))),'Choose a saved readiness description.');return {score,note,scale:entry.scale===undefined?undefined:String(entry.scale)}});
    const summary=text(input.summary??'','Assessment summary',2000,!input.submit);
    if(input.submit&&ratings.every(r=>r.score===0))requireThat(input.allZeroConfirmed===true&&summary.length>=20,'Explain and explicitly confirm an all-zero assessment; blank answers must not become automatic scores.');
    const stations=r.data.stations.map((station,i)=>({...station,...(self?{selfScore:ratings[i].score,selfRatingScale:ratings[i].scale,selfNote:ratings[i].note}:{managerScore:ratings[i].score,managerRatingScale:ratings[i].scale,managerNote:ratings[i].note})}));
    requireThat(r.data.submissions.length<40,'This review has too many revisions. Have the GM cancel it and open a replacement.');
    const submissions=input.submit?[...r.data.submissions,{by:self?'employee' as const:'manager' as const,actorId:me.id,at,summary,ratings:ratings.map((s,i)=>({name:stations[i].name,score:s.score!,note:s.note,scale:s.scale}))}]:r.data.submissions;
    save({...r,data:{...r.data,stations,submissions,...(self?{selfSummary:summary,selfShared:input.submit}:{managerSummary:summary,managerShared:input.submit}),phase:input.submit?(self?'manager-assessment':'discussion'):r.data.phase,history:[...r.data.history,history(`${self?'employee':'manager'}-${input.submit?'submitted':'draft-saved'}`,input.submit?'Assessment submitted for the next step.':'Private assessment draft saved.')]}});
    if(input.submit)notify(self?[r.data.managerId]:[r.ownerId],self?'Self-assessment ready for manager review':'Development conversation ready','Review the station examples and discuss the differences.');return;
  }
  if(command.action==='development.discuss') {
    const r=find('development');phase(r.data.phase,['discussion']);const note=text(input.note,'Conversation record',4000);
    if(me.id===r.data.managerId) {permitted(r,'people.manage');save({...r,data:{...r.data,managerDiscussion:note,employeeDiscussion:'',history:[...r.data.history,history('manager-discussion',note)]}});notify([r.ownerId],'Development conversation recorded','Confirm the conversation occurred, or explain what still needs discussion.');}
    else {own(r);requireThat(r.data.managerDiscussion,'The manager needs to record the conversation first.');requireThat(typeof input.confirm==='boolean','Confirm the conversation or request further discussion.');save({...r,data:{...r.data,employeeDiscussion:input.confirm?note:'',managerDiscussion:input.confirm?r.data.managerDiscussion:'',history:[...r.data.history,history(input.confirm?'employee-discussion-confirmed':'discussion-requested',note)]}});notify([r.data.managerId],input.confirm?'Employee confirmed the conversation':'More discussion requested',note);}return;
  }
  if(command.action==='development.revise-assessment') {
    const r=find('development');requireThat(me.id===r.data.managerId,'Only the assigned manager can return an assessment for revision.',403);permitted(r,'people.manage');phase(r.data.phase,['discussion','gm-review']);
    requireThat(input.by==='employee'||input.by==='manager','Choose whose assessment needs revision.');const note=text(input.note,'Reason for revision');
    save({...r,data:{...r.data,phase:input.by==='employee'?'self-assessment':'manager-assessment',...(input.by==='employee'?{selfShared:false}:{}),managerShared:false,managerDiscussion:'',employeeDiscussion:'',history:[...r.data.history,history('assessment-revision-requested',`${input.by}: ${note}`)]}});
    notify([r.ownerId,r.data.managerId,r.data.approverId],'Development assessment returned for revision',`${note} The original due date remains unchanged.`);return;
  }
  if(command.action==='development.request-approval') {
    const r=find('development');requireThat(me.id===r.data.managerId,'Only the assigned manager can send this review to the GM.',403);permitted(r,'people.manage');phase(r.data.phase,['discussion']);
    requireThat(r.data.managerDiscussion&&r.data.employeeDiscussion,'Record the manager conversation and employee acknowledgement before GM review.');
    requireThat(manages(member(r.data.approverId),r.area,'people.approve'),'The assigned GM no longer has approval authority.');
    save({...r,data:{...r.data,phase:'gm-review',history:[...r.data.history,history('approval-requested','Both participants recorded the conversation.')]}});notify([r.data.approverId],'Development review needs GM approval','Review both assessments and the conversation record.');return;
  }
  if(command.action==='development.approve') {
    const r=find('development');requireThat(me.id===r.data.approverId&&me.id!==r.ownerId&&me.id!==r.data.managerId,'Only the named independent GM can approve.',403);permitted(r,'people.approve');phase(r.data.phase,['gm-review']);
    requireThat(typeof input.approve==='boolean','Choose approve or return for discussion.');const note=text(input.note,'GM decision');
    save({...r,data:{...r.data,phase:input.approve?'approved':'discussion',approvalNote:note,...(!input.approve?{managerDiscussion:'',employeeDiscussion:''}:{}),history:[...r.data.history,history(input.approve?'gm-approved':'gm-returned',note)]}});
    notify([r.ownerId,r.data.managerId],input.approve?'Development review approved':'Development review returned',note);return;
  }
  if(command.action==='development.reassign') {
    const r=find('development');permitted(r,'people.approve');phase(r.data.phase,['self-assessment','manager-assessment','discussion','gm-review']);
    const owner=member(r.ownerId), manager=managerFor(owner,input.managerId,'people.manage'), approver=member(input.approverId),note=text(input.note,'Reason for reassignment');
    requireThat(approver.id!==owner.id&&approver.id!==manager.id&&manages(approver,r.area,'people.approve'),'Choose an independent authorized GM.');
    const reset=manager.id!==r.data.managerId;
    save({...r,data:{...r.data,managerId:manager.id,approverId:approver.id,...(reset?{stations:r.data.stations.map(s=>({...s,managerScore:null,managerNote:''})),managerShared:false,managerSummary:'',managerDiscussion:'',employeeDiscussion:'',phase:r.data.phase==='self-assessment'?'self-assessment':'manager-assessment'}:{}),history:[...r.data.history,history('reassigned',note)]}});
    notify([r.ownerId,manager.id,approver.id],'Development review responsibility changed',`${note} The original due date is unchanged.`);return;
  }
  if(command.action==='development.cancel') {
    const r=find('development');permitted(r,'people.approve');requireThat(!['approved','cancelled'].includes(r.data.phase),'This review is already complete.');const note=text(input.note,'Reason for cancellation');
    save({...r,data:{...r.data,phase:'cancelled',history:[...r.data.history,history('cancelled',note)]}});notify([r.ownerId,r.data.managerId],'Development review cancelled',note);return;
  }
  if(command.action==='goal.start-learning') {
    notDish(me);
    const guide=learningGuides(w,me).find(g=>g.id===input.standardId&&g.revision===input.standardRevision);
    requireThat(guide,'This learning step changed or is not available for your job. Refresh to see the current path.',409);
    requireThat(!w.learningHistory?.some(h=>h.personId===me.id&&h.standardId===guide.id&&h.standardRevision===guide.revision),'This learning step is already completed.',409);
    requireThat(!w.records.some(g=>g.kind==='goal'&&g.ownerId===me.id&&g.data.standardId===guide.id&&g.data.standardRevision===guide.revision&&g.data.automaticLearning===true&&!['declined','cancelled'].includes(g.data.phase)),'This learning step already has saved progress. Refresh to continue it.',409);
    const reviewer=learningReviewer(w,me,guide);requireThat(reviewer,'A restaurant owner needs to enable a learning reviewer for your department.');
    const title=('Learn '+guide.data.title).slice(0,200);
    const goal=create({kind:'goal',data:{automaticLearning:true,practiceChecks:[],title,definition:guide.data.criteria.join('\n'),type:'development',managerId:reviewer.id,due:localInstant(nextDate(localDate(at,w.location.timezone),7),'23:59',w.location.timezone),phase:'active',standardId:guide.id,standardRevision:guide.revision,standardSource:guide.data.source,history:[history('employee-started','Started from the automatic job and station learning path. No clearance granted.')]}});
    for(const old of w.records)if(old.kind==='goal'&&old.ownerId===me.id&&old.data.automaticLearning&&!['closed','declined','cancelled'].includes(old.data.phase)&&(old.data.standardId===guide.id||old.data.standardId===guide.data.supersedes?.id))save({...old,data:{...old.data,phase:'cancelled',history:[...old.data.history,history('instructions-updated','Continued practice with the new approved instructions.')]}});
    notify([reviewer.id],'Learning started',me.name+' started '+guide.data.title+'.',goal.id);return;
  }
  if(command.action==='goal.create') {
    const owner=member(input.ownerId);notDish(owner);requireThat(input.type==='development'||input.type==='required-correction','Choose a development goal or a required correction.');
    const required=input.type==='required-correction',cap=required?'tasks.manage':'people.manage';
    if(required||owner.id!==me.id)permitted(owner,cap);
    const manager=managerFor(owner,input.managerId,cap),due=instant(input.due,'Goal due time');
    const linked=required||input.standardId!==undefined;
    const standard=linked?w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.id===input.standardId&&r.locationId===owner.locationId&&r.area===owner.area&&r.data.status==='approved'):undefined;
    if(linked){
      requireThat(standard,'Choose a current approved instruction for this employee\'s department.');
      if(!required||input.standardRevision!==undefined)requireThat(Number.isSafeInteger(input.standardRevision)&&input.standardRevision===standard.revision,'This instruction changed. Reopen it and review the current version before saving the goal.',409);
    }
    const title=text(input.title,'Goal',200),definition=text(input.definition,'Observable outcome',2000);
    const active=required||owner.id===me.id;
    create({kind:'goal',data:{title,definition,type:input.type,managerId:manager.id,due,phase:active?'active':'proposed',...(standard?{standardId:standard.id,standardRevision:standard.revision,standardSource:standard.data.source}:{}),history:[history(required?'required-correction-assigned':active?'employee-chosen':'proposed',definition)]}},owner);
    notify([owner.id,manager.id],required?'Required correction assigned':active?'Employee development goal chosen':'Development goal proposed',title);return;
  }
  if(command.action==='goal.transition') {
    const r=find('goal'),step=input.step;
    const guided=r.data.automaticLearning&&['practice','ready'].includes(String(step));
    const note=text(input.note??'', 'Outcome or next action',2000,!!guided)||(step==='ready'?'Practice submitted for manager observation.':'Practice progress saved.');let next=r.data.phase;
    let practiceChecks=r.data.practiceChecks;
    if(guided){const guide=w.records.find((g):g is RecordOf<'standard'>=>g.kind==='standard'&&g.id===r.data.standardId&&g.revision===r.data.standardRevision&&g.data.status==='approved');requireThat(guide,'The approved instructions changed. Open the current learning step.',409);requireThat(Array.isArray(input.checks)&&input.checks.every(i=>Number.isInteger(i)&&Number(i)>=0&&Number(i)<guide.data.criteria.length),'Select the practiced criteria.');practiceChecks=[...new Set(input.checks as number[])];if(step==='ready')requireThat(practiceChecks.length===guide.data.criteria.length,'Practice each criterion before asking for an outcome check.');}
    if(step==='accept'||step==='decline'){own(r);requireThat(r.data.type==='development','Required corrections cannot be declined as optional goals.');phase(r.data.phase,['proposed']);next=step==='accept'?'active':'declined';}
    else if(step==='practice'){own(r);phase(r.data.phase,['active']);}
    else if(step==='coach'){requireThat(me.id===r.data.managerId&&me.id!==r.ownerId,'Only the assigned manager can record coaching for this goal.',403);permitted(r,r.data.type==='development'?'people.manage':'tasks.manage');phase(r.data.phase,['active']);}
    else if(step==='ready'){own(r);phase(r.data.phase,['active']);next='verification';}
    else if(step==='verify'||step==='fix'){requireThat(me.id===r.data.managerId&&me.id!==r.ownerId,'The assigned manager must review the outcome.',403);permitted(r,r.data.type==='development'?'people.manage':'tasks.manage');phase(r.data.phase,['verification']);next=step==='verify'?'closed':'active';}
    else if(step==='cancel'){requireThat(me.id===r.data.managerId||r.ownerId===me.id&&r.data.type==='development','Only the assigned manager can cancel a required correction.',403);if(me.id===r.data.managerId)permitted(r,r.data.type==='development'?'people.manage':'tasks.manage');phase(r.data.phase,['proposed','active','verification']);next='cancelled';}
    else requireThat(false,'Unsupported goal action.');
    if(r.data.standardId&&['accept','practice','coach','ready','verify'].includes(String(step)))requireThat(w.records.some(s=>s.kind==='standard'&&s.id===r.data.standardId&&s.revision===r.data.standardRevision&&s.data.status==='approved'),'The linked instruction changed. Have the manager replace this goal or correction using the current approved instruction.');
    save({...r,data:{...r.data,phase:next,...(practiceChecks?{practiceChecks:step==='fix'?[]:practiceChecks}:{}),history:[...r.data.history,history(String(step),note)]}});
    if(step==='coach')notify([r.ownerId],`${r.data.title}: coaching note`,note);
    else if(step!=='practice')notify([r.ownerId,r.data.managerId],`${r.data.title}: ${next}`,note);
    return;
  }
  requireThat(false,'Unsupported follow-through action.');
}
