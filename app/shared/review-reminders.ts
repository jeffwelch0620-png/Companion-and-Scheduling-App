import { manages, type Location, type Member, type RecordOf } from './types';
import { localDate } from './local-time';
import { reviewDueState } from './followthrough';
import { calendarDate } from './schedule-policy';

export type ReminderReceipt={review_id:string;stage:string;responsible_id:string;recipient_id:string;milestone:number};
export type ReminderIssue={reviewId:string;employeeName?:string;reason:'missing-manager'|'missing-gm'|'missing-owner'|'invalid-deadline'|'employee-unavailable'};
export type ReviewReminder={reviewId:string;stage:'manager'|'gm';responsibleId:string;recipient:Member;milestone:3|5|7;originalDueDate:string;body:string};
export type ReminderState={checkedAt:string|null;scheduledAt:string|null;delivered:number;issues:ReminderIssue[]};

export function planReviewReminders(location:Location,members:Member[],reviews:RecordOf<'development'>[],receipts:ReminderReceipt[],at:string) {
  const today=localDate(at,location.timezone),reminders:ReviewReminder[]=[],issues:ReminderIssue[]=[];
  for(const r of reviews) {
    if(r.data.phase==='approved'||r.data.phase==='cancelled')continue;
    const employeeName=members.find(m=>m.id===r.ownerId)?.name;
    try{calendarDate(r.data.originalDueDate,'Original due date')}catch{issues.push({reviewId:r.id,employeeName,reason:'invalid-deadline'});continue}
    const due=reviewDueState(r,today);if(due.overdueDays<3)continue;
    const employee=members.find(m=>m.id===r.ownerId&&m.position!=='Dishwasher');
    if(!employee){issues.push({reviewId:r.id,employeeName,reason:'employee-unavailable'});continue}
    const stage=r.data.phase==='gm-review'?'gm':'manager';
    const responsible=members.find(m=>m.id===due.responsibleId&&m.position!=='Dishwasher'&&manages(m,r.area,stage==='gm'?'people.approve':'people.manage'));
    const add=(recipient:Member,milestone:3|5|7)=>{
      if(receipts.some(p=>p.review_id===r.id&&p.stage===stage&&p.responsible_id===due.responsibleId&&p.recipient_id===recipient.id&&p.milestone>=milestone))return;
      // Assessment notes, ratings and employee feedback never enter an escalation.
      reminders.push({reviewId:r.id,stage,responsibleId:due.responsibleId,recipient,milestone,originalDueDate:r.data.originalDueDate,
        body:`${employee.name}'s development review is ${due.overdueDays} days overdue. Original due date: ${r.data.originalDueDate}. Responsible: ${responsible?.name??'assignment needs attention'}. ${stage==='gm'?'Awaiting independent GM approval':'Manager follow-up is required'}. ${milestone===7?'Owner follow-up is required. Contact the assigned review lead; private assessments remain with their named participants.':'Open the review to complete the next step. Reading this reminder does not complete the review.'}`});
    };
    if(responsible)add(responsible,due.overdueDays>=5?5:3);
    else issues.push({reviewId:r.id,employeeName,reason:stage==='gm'?'missing-gm':'missing-manager'});
    if(due.overdueDays>=7) {
      const owners=members.filter(m=>m.position!=='Dishwasher'&&m.id!==due.responsibleId&&m.id!==r.ownerId&&manages(m,r.area,'operations.escalation'));
      if(!owners.length)issues.push({reviewId:r.id,employeeName,reason:'missing-owner'});
      for(const owner of owners)add(owner,7);
    }
  }
  return {reminders,issues};
}
