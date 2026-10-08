import type { Capability, Member } from './types';
import type { ToastPerson, ToastRoster } from './toast-roster';

export type AccessProfile={name:string;email:string;area:string;position:string;capabilities:Capability[];qualifications:string[]};
export type AccessReview={id:string;restaurantGuid:string;employeeId:string;sourceAt:string;source:ToastPerson;profile:AccessProfile;note:string;status:'draft'|'excluded'|'applied';memberId:string|null;revision:number;updatedAt:string};
export type Employment={status:'onboarding'|'active'|'archived';hireDate:string|null;endedDate:string|null;departureReason:'quit'|'terminated'|'other'|null;archivedAt:string|null};
export type ResponsibilityCount={category:string;count:number};
export type AccessHistory={id:string;actorId:string;targetId:string;action:string;note:string;at:string;employment?:Employment};
export type AdministratorRequest={requestId:string;kind:'invitation'|'recovery';status:'invited'|'requested'|'approved'|'cancelled';verifiedEmail:string|null;verifiedAt:string|null;expiresAt:string};
export type AccessAccount=Member&{email:string;claimed:boolean;active:boolean;revision:number;outstanding:number;employment:Employment;responsibilities:ResponsibilityCount[];administratorRequest?:AdministratorRequest};
export type AccessState={accounts:AccessAccount[];reviews:AccessReview[];roster:ToastRoster|null;rosterMismatch:boolean;history:AccessHistory[]};
export type AccessResult={recordId:string;revision:number};
export type AccessCommand={requestId:string;locationId:string;action:'administrator.add'|'administrator.approve'|'administrator.cancel'|'administrator.resend'|'review.save'|'review.apply'|'account.save'|'account.suspend'|'hire.save'|'hire.activate'|'account.archive'|'account.rehire';recordId?:string;expectedRevision?:number;input:Record<string,unknown>};
export const capabilityLabels:Record<Capability,string>={
  'schedule.manage':'Draft schedules and review availability',
  'schedule.publish':'Publish schedules and assign shift leadership',
  'schedule.change':'Change published shifts within assigned authority',
  'tasks.manage':'Assign operational tasks and closing work',
  'operations.store':'Manage front and back of house operating logs and Food/prep (requires task management)',
  'close.verify':'Perform the senior closing check',
  'close.confirm':'Give final manager closing confirmation',
  'standards.approve':'Approve operating standards',
  'orders.request':'Submit internal food needs',
  'orders.review':'Review food orders for purchasing',
  'people.manage':'Manage development and employee follow-up',
  'people.approve':'Give independent GM review approval',
  'operations.escalation':'Receive owner escalations',
  'location.manage':'Administer restaurant access and integrations',
};
