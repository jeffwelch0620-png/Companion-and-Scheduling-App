import { publicWorkspace } from './domain';
import { correctionPerformer, eligibleCorrectionHelper } from './close-correction';
import { attentionReasons, needsCloseAcknowledgment } from './close-attention';
import { assignedLeader, canChangePublished } from './schedule-policy';
import { localDate } from './local-time';
import { operationsManager } from './operations';
import { closingStatus } from './closing-status';
import { canManageClosing } from './closing-access';
import { personName, has, manages, type RecordOf, type WorkRecord, type Workspace } from './types';

export type BriefItem = {
  record: WorkRecord; title: string; next: string; reason: string;
  lane: 'action' | 'waiting' | 'later'; category: 'shift' | 'planning' | 'development';
  due: string; rank: number; person: string; overdue: boolean;
};
export function workTitle(r: WorkRecord) {
  return r.kind === 'close' ? r.data.standard.title : 'title' in r.data ? r.data.title : r.kind === 'order' ? 'Food order request' : r.kind === 'request' ? r.data.type === 'swap' ? 'Shift coverage request' : 'Time-off request' : r.kind === 'shift' ? `${r.data.position} shift` : r.kind;
}

// This is a factual reading of saved work, not a generated judgment about a person.
// Reapply the server visibility rules so callers cannot accidentally brief private work.
export function buildShiftBrief(input: Workspace, now: string) {
  const w = publicWorkspace(input,now), me = w.me, today = localDate(now, w.location.timezone);
  const name = (id?: string) => personName(w,id,'Assigned reviewer');
  const shifts = w.records.filter((r): r is RecordOf<'shift'> => r.kind === 'shift' && r.ownerId === me.id && r.data.published && !r.data.cancelled).sort((a,b) => a.data.start.localeCompare(b.data.start));
  const current = shifts.find(r => !r.data.releasedAt && Date.parse(r.data.start) <= Date.parse(now) && Date.parse(r.data.end) > Date.parse(now));
  const nextShift = shifts.find(r => !r.data.releasedAt && Date.parse(r.data.start) > Date.parse(now));
  const lastToday = shifts.filter(r => localDate(r.data.end,w.location.timezone) === today && Date.parse(r.data.end) <= Date.parse(now)).at(-1);
  const pendingCheckout=shifts.filter(r=>!r.data.releasedAt&&Date.parse(r.data.end)<=Date.parse(now)&&Date.parse(r.data.end)>Date.parse(now)-86400000).sort((a,b)=>b.data.end.localeCompare(a.data.end)||a.id.localeCompare(b.id))[0];
  const shift = current ?? pendingCheckout ?? nextShift;
  const unread = w.records.filter((r): r is RecordOf<'message'> => r.kind === 'message' && (r.data.recipients.includes(me.id)||r.ownerId===me.id&&r.data.replies.some(reply=>reply.actorId!==me.id)) && !r.data.readBy.includes(me.id)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const items: BriefItem[] = [];
  const add = (r: WorkRecord, next: string, reason: string, lane: BriefItem['lane'], rank: number, due = '', category: BriefItem['category'] = 'shift') => {
    const future = due && (due.length === 10 ? due : localDate(due,w.location.timezone)) > today;
    const overdue = !!due && (due.length === 10 ? due < today : Date.parse(due) < Date.parse(now));
    items.push({record:r,title:workTitle(r),next,reason,lane:lane === 'action' && rank >= 30 && future ? 'later' : lane,category,due,rank,overdue,person:name(r.ownerId)});
  };
  for (const r of w.records) {
    if(me.position==='Dishwasher'&&r.kind!=='task'&&r.kind!=='shift')continue;
    const own = r.ownerId === me.id;
    if (r.kind === 'shift' && r.data.published && !r.data.cancelled && !r.data.releasedAt) {
      const closing=closingStatus(w,r,{allowProjectedReceipts:true}),ended=Date.parse(r.data.end)<=Date.parse(now);
      const checkout=closing.complete&&(closing.required||ended);
      if(checkout&&own)add(r,'Waiting for manager checkout','The manager still needs to confirm operational checkout. This does not stop or change your recorded work time.', 'waiting',20,r.data.end);
      else if(checkout&&canManageClosing(me,r.area,'tasks.manage')&&canManageClosing(me,r.area,'close.confirm')&&(has(me,'location.manage')||assignedLeader(w,me,r.area,{start:r.data.end,end:r.data.end})))add(r,'Confirm operational checkout',`The assigned closing checks for ${name(r.ownerId)} are complete. Confirm checkout only after your actual release checks.`, 'action',20,r.data.end);
      else if(own&&!closing.complete&&(ended||closing.tasks.length))add(r,'Closing work remains before manager checkout','The work linked to this shift must finish its required checks before the manager can confirm checkout. Reported readiness and handoff acceptance do not complete those checks.','waiting',45,r.data.end);
    }
    if (r.kind === 'close' && !['closed','cancelled'].includes(r.data.phase)) {
      const p = r.data, s = w.records.find(s => s.id === p.shiftId && s.kind === 'shift');
      const retired = !w.records.some(s => s.kind === 'standard' && s.id === p.standardId && s.data.status === 'approved');
      // Verifiers may see a close without access to the employee's whole schedule.
      const inactive = s?.kind === 'shift' && (!s.data.published || s.data.cancelled || !!s.data.releasedAt);
      const manager = p.managerId === me.id && canManageClosing(me,r.area,'close.confirm') && (has(me,'location.manage') || assignedLeader(w,me,r.area,{start:p.due,end:p.due}));
      const verifier = p.verifierId === me.id && canManageClosing(me,r.area,'close.verify');
      const performer=correctionPerformer(r),helper=p.correction?w.members.find(m=>m.id===p.correction?.personId):undefined,invalidHelper=!!p.correction&&(!helper||!eligibleCorrectionHelper(r,helper));
      if(manager&&needsCloseAcknowledgment(r))add(r,'Acknowledge the closing issue',`${attentionReasons[p.attention!.reason]} reported by ${name(p.attention!.raisedBy)}. Record your response; acknowledgment does not complete the correction or physical checks.`,'action',5,p.due);
      else if (retired || inactive) add(r,'Closing assignment needs manager attention',retired ? 'The linked standard is no longer approved. A manager needs to replace this assignment.' : 'The linked shift is not active and published. This close cannot move forward.', 'waiting',0,p.due);
      else if(invalidHelper&&p.phase==='correction')add(r,'Review the correction assignment','The assigned helper is no longer available or cleared for this station. The closing manager needs to choose who will correct it.',manager?'action':'waiting',5,p.due);
      else if (performer===me.id && ['open','correction'].includes(p.phase)) add(r,p.phase === 'correction' ? 'Correct and request another check' : 'Prepare your closing check',p.phase === 'correction' ? `The correction is still open. ${name(r.ownerId)} remains responsible for the close. Read the reviewer’s instruction, finish the work, then request another physical check.` : `Check the assigned conditions. ${name(p.verifierId ?? p.managerId)} performs the next physical check.`, 'action',p.phase === 'correction' ? 10 : 40,p.due);
      else if (verifier && p.phase === 'verification') add(r,'Perform the first physical check',`${name(performer)} reported ready. Your check comes before ${name(p.managerId)}’s final confirmation.`, 'action',15,p.due);
      else if (manager && p.phase === 'manager-confirmation') add(r,'Perform the final physical check',`${name(performer)} reported the work ready for your final confirmation. Saving a correction sends the work back for another check.`, 'action',15,p.due);
      else add(r,p.phase === 'verification' ? `Waiting for ${name(p.verifierId)}` : p.phase === 'manager-confirmation' ? `Waiting for ${name(p.managerId)}` : `Waiting for ${name(performer)}`,own ? 'Your work remains open until the required physical checks pass.' : 'This responsibility is assigned. It is not awaiting your next approval.', 'waiting',40,p.due);
    }
    if (r.kind === 'task' && r.data.phase !== 'closed') {
      const p=r.data;
      if(own&&p.dishHandoff&&!p.dishHandoff.acceptedBy&&['open','correction'].includes(p.phase))add(r,'Accept unfinished dish work','Read the outgoing AM work and next action. Acceptance records receipt; it does not complete the work.','action',15,p.due);
      else if(own&&p.dishCheckout?.shift==='PM'&&['open','correction'].includes(p.phase)&&w.records.some(child=>child.kind==='task'&&child.ownerId===me.id&&child.data.dishHandoff?.cycleId===p.dishCheckout!.cycleId&&child.data.phase!=='closed'))add(r,'Finish the incoming dish work first','Your PM checkout remains open until your incoming work is accepted, completed and verified.','waiting',10,p.due);
      else if (own && ['open','correction'].includes(p.phase)) add(r,p.phase === 'correction' ? 'Finish the correction' : 'Work through this assignment',(p.phase === 'correction' ? 'Read the latest correction, complete the work and ask for another review.' : 'Use the assigned definition of done, then report ready for review.')+(p.shiftId?' This work is linked to shift checkout and remains required until its checks pass.':''), 'action',p.phase === 'correction' ? 10 : 35,p.due);
      else if (p.phase === 'verification' && !own && (p.shiftId?canManageClosing(me,r.area,'tasks.manage'):manages(me,r.area,'tasks.manage')||p.kind==='task'&&!!(p.dishCheckout||p.dishHandoff)&&operationsManager(me,r.area))) add(r,'Check the completed work',`${name(r.ownerId)} reported ready. Verify the result or return a specific correction.${p.shiftId?' This linked work must pass before shift checkout.':''}`, 'action',20,p.due);
      else if (p.phase === 'acceptance' && p.incomingId === me.id) add(r,'Accept or dispute the station handoff','Check what you are receiving before accepting responsibility.', 'action',15,p.due);
      else add(r,p.phase === 'acceptance' ? `Waiting for ${name(p.incomingId)}` : p.phase === 'verification' ? 'Waiting for a manager’s check' : `Waiting for ${name(r.ownerId)}`,'The assignment stays open until the remaining steps are complete.'+(p.shiftId?' Manager checkout waits for this linked work to pass.':''), 'waiting',40,p.due);
    }
    if (r.kind === 'handoff' && !['resolved','cancelled'].includes(r.data.phase)) {
      const p=r.data;
      if (p.phase === 'offered' && p.incomingId === me.id) add(r,'Review the overnight handoff',`${name(p.outgoingId)} retains responsibility until you accept. Read the condition and next step first.`, 'action',p.priority === 'urgent' ? 0 : 15,p.due);
      else if (p.phase === 'accepted' && own) add(r,'Follow through on the accepted issue','You accepted responsibility. Record what resolved the issue when the work is complete.', 'action',p.priority === 'urgent' ? 0 : 30,p.due);
      else if (p.phase === 'disputed' && p.outgoingId === me.id) add(r,'Resolve the handoff concern','The receiving manager raised a concern. Clarify the plan; responsibility remains with you.', 'action',5,p.due);
      else add(r,`Waiting for ${name(p.phase === 'accepted' ? r.ownerId : p.incomingId)}`,`Responsible now: ${name(r.ownerId)}. ${p.priority === 'urgent' ? 'This handoff is marked urgent by its author.' : 'Acceptance and resolution are separate steps.'}`, 'waiting',30,p.due);
    }
    if (r.kind === 'request' && ['pending','accepted-by-replacement'].includes(r.data.status)) {
      const p=r.data;
      if (p.type === 'swap' && p.replacementId === me.id && p.status === 'pending') add(r,'Respond to the coverage request',`${name(r.ownerId)} is still responsible. Your acceptance must be followed by the shift leader’s approval.`, 'action',25,p.start,'planning');
      else if (!own && p.replacementId !== me.id && (p.type === 'time-off' ? manages(me,r.area,'schedule.manage') : p.type === 'swap' && p.status === 'accepted-by-replacement' && canChangePublished(w,me,r.area,p))) add(r,'Review the schedule request','Check the request and its effect on the published schedule before making your decision.', 'action',25,p.start,'planning');
      else add(r,p.type === 'swap' && p.status === 'pending' ? `Waiting for ${name(p.replacementId)}` : 'Waiting for schedule review','The published schedule stays in effect until approval.', 'waiting',40,p.start,'planning');
    }
    if (r.kind === 'availability' && r.data.status === 'pending') add(r,own ? 'Waiting for availability review' : 'Review availability',own ? 'Your previously approved availability stays in effect until this request is approved.' : 'Check the dates, school blocks, travel buffers and exceptions.', !own && manages(me,r.area,'schedule.manage') ? 'action' : 'waiting',25,'','planning');
    if (r.kind === 'order' && r.data.status !== 'approved') {
      if (r.data.status === 'review' && has(me,'orders.review')) add(r,'Review the food order','Check quantities, product preferences and substitutions. Approval here does not place a supplier order.', 'action',25,'','planning');
      else if (own && ['draft','returned'].includes(r.data.status) && has(me,'orders.request')) add(r,r.data.status === 'returned' ? 'Revise the food order' : 'Finish your food order request',r.data.status === 'returned' ? 'Read the purchaser’s note before resubmitting.' : 'Confirm the products and amounts, then submit for purchaser review.', 'action',40,'','planning');
      else add(r,'Waiting for purchaser review','Rudd or Tim reviews the purchase before supplier placement.', 'waiting',40,'','planning');
    }
    if (r.kind === 'development' && !['approved','cancelled'].includes(r.data.phase)) {
      const p=r.data, manager=p.managerId === me.id && manages(me,r.area,'people.manage'), gm=p.approverId === me.id && manages(me,r.area,'people.approve');
      const self=own && p.phase === 'self-assessment', assess=manager && p.phase === 'manager-assessment', discuss=manager && p.phase === 'discussion' && (!p.managerDiscussion || !!p.employeeDiscussion), confirm=own && p.phase === 'discussion' && !!p.managerDiscussion && !p.employeeDiscussion, approve=gm && p.phase === 'gm-review';
      add(r,self ? 'Prepare your self-assessment' : assess ? 'Review the employee’s station examples' : confirm ? 'Confirm or revisit your development conversation' : discuss ? p.employeeDiscussion ? 'Send the review to the GM' : 'Have the development conversation' : approve ? 'Review the development conversation' : 'Waiting for the next review participant','Make time for a conversation supported by the assigned station criteria. The original due date is preserved.', self||assess||discuss||confirm||approve ? 'action' : 'waiting',50,p.originalDueDate,'development');
    }
    if (r.kind === 'goal' && !['closed','cancelled','declined'].includes(r.data.phase)) {
      const p=r.data, review=p.managerId === me.id && p.phase === 'verification' && manages(me,r.area,p.type === 'development' ? 'people.manage' : 'tasks.manage');
      add(r,own && p.phase === 'proposed' ? 'Choose whether this goal fits you' : own && p.phase === 'active' ? 'Work toward the agreed outcome' : review ? 'Review the goal outcome' : 'Waiting for the next goal step',p.type === 'development' ? 'Development is an employee choice. Review the outcome and support you need.' : 'This required correction is linked to an approved standard.', own && ['proposed','active'].includes(p.phase) || review ? 'action' : 'waiting',p.type === 'development' ? 55 : 30,p.due,p.type === 'development' ? 'development' : 'shift');
    }
    if (r.kind === 'feedback' && r.data.shared && r.data.status !== 'closed') add(r,own ? r.data.status === 'follow-up' ? 'Review the manager’s follow-up' : 'Waiting for a response' : 'Follow up on shared feedback',own ? 'You can confirm resolution or explain what still needs attention.' : 'Record a clear commitment and follow-up time. The employee confirms the outcome.', own && r.data.status !== 'follow-up' ? 'waiting' : 'action',45,r.data.due,'development');
  }
  items.sort((a,b) => a.rank-b.rank || Number(b.overdue)-Number(a.overdue) || (a.due||'9999').localeCompare(b.due||'9999') || a.record.id.localeCompare(b.record.id));
  return {today,shift,current,nextShift,lastToday,unread,items,leadership:w.records.filter((r):r is RecordOf<'leadership'>=>r.kind==='leadership'&&r.ownerId===me.id&&r.data.active&&localDate(r.data.start,w.location.timezone)===today),drafts:w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&!r.data.published&&!r.data.cancelled&&manages(me,r.area,'schedule.manage'))};
}
