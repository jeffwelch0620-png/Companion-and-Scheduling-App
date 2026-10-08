import type {Member} from './types';
import {has} from './types';
import {openingManager,openingOwner} from './hiring-openings';
import {calendarDate} from './schedule-policy';
import {requireThat,text} from './validation';

export type HiringReview={candidateType:'frontline'|'management'|'gm';interviews:{personId:string;date:string;evidence:string}[];approverId:string;evidence:string;by:string;at:string};
// Existing explicit approval access is required as well as the GM assignment.
// A job title alone must never grant hiring authority.
export function hiringGM(m:Member){return !m.scheduleOnly&&['General Manager','GM'].includes(m.position)&&has(m,'people.approve');}
export function hiringManager(m:Member){return !m.scheduleOnly&&m.position!=='Dishwasher'&&(has(m,'tasks.manage')||hiringGM(m));}
export function checkedHiringReview(input:Record<string,unknown>,members:Member[],locationId:string,receivedOn:string,today:string,by:string,at:string):HiringReview{
 const candidateType=input.candidateType;requireThat(candidateType==='frontline'||candidateType==='management'||candidateType==='gm','Choose frontline, management, or GM hiring.');
 requireThat(Array.isArray(input.interviews)&&input.interviews.length>0&&input.interviews.length<=10,'Record the completed required interviews.');
 const interviews=(input.interviews as Record<string,unknown>[]).map(i=>{
  requireThat(i&&typeof i==='object','Record each interview’s checked facts.');
  const personId=text(i.personId,'Interviewing manager or owner',200),person=members.find(m=>m.id===personId&&m.locationId===locationId);
  requireThat(person&&(openingManager(person)||openingOwner(person)),'Interview evidence must identify a current manager or owner in this restaurant.');
  const date=calendarDate(i.date,'Completed interview date');requireThat(date>=receivedOn&&date<=today,'Completed interviews must be between the application date and today.');
  return {personId,date,evidence:text(i.evidence,'Completed interview source',1500)};
 });
 const approverId=text(input.approverId,'Final hiring approver',200),approver=members.find(m=>m.id===approverId&&m.locationId===locationId);
 const managers=new Set(interviews.filter(i=>hiringManager(members.find(m=>m.id===i.personId)!)).map(i=>i.personId));
 requireThat(managers.size>=2,'Every position requires completed interviews by two distinct authorized managers. A GM can be one; a peer interview does not replace either.');
 if(candidateType==='frontline'){
  requireThat(approver&&hiringGM(approver),'Frontline final hiring approval must be from the explicitly authorized GM.');
 }else{
  // The current membership contract does not distinguish owners from access
  // administrators. Neither location.manage nor an Owner title proves ownership.
  // Keep these decisions blocked until explicit owner identity is available.
  requireThat(false,'Management and GM hiring require an owner interview and owner final offer approval. Explicit owner identity is not configured; administrator access cannot substitute.',409);
 }
 requireThat(input.offerApproved===true,'Confirm final hiring/offer approval was actually given.');
 return {candidateType,interviews,approverId,evidence:text(input.approvalEvidence,'Final approval source',1500),by,at};
}
