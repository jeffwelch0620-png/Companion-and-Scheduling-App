import type {RecordOf} from './types';
import type {CommandContext} from './followthrough';
import {openingOwner,openingManager} from './hiring-openings';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';
import {checkedHiringReview,type HiringReview} from './hiring-policy';

export const applicantStages={received:'Application received',contacted:'Contact recorded',planned:'Interview planned',interviewed:'Interview completion recorded',withdrawn:'Withdrawal recorded',closed:'Tracking closed'} as const;
export type ApplicantStage=keyof typeof applicantStages;
export type ApplicantFacts={name:string;reference:string;receivedOn:string;sourceRef:string};
export type ApplicantState=ApplicantFacts&{stage:ApplicantStage;followupOn:string;interview:{date:string;interviewer:string;evidence:string}|null;approvalRevision:number|null;hiringReview?:HiringReview|null};
export type OpeningApplicant=ApplicantState&{id:string;events:{action:string;at:string;by:string;note:string;state:ApplicantState}[]};
export const applicantActive=(a:Pick<ApplicantState,'stage'>)=>!['withdrawn','closed'].includes(a.stage);
export const applicantCurrent=(r:RecordOf<'opening'>,a:OpeningApplicant)=>r.data.status==='open'&&!!r.data.approval&&a.approvalRevision===r.data.approval.revision;
const referenceKey=(s:string)=>s.normalize('NFKC').trim().toLowerCase();
export function applyOpeningApplicant(c:CommandContext,r:RecordOf<'opening'>){
 const {w,me,input,command,at,save}=c;
 requireThat(openingOwner(me),'Only current restaurant owners and administrators can read or change applicant tracking.',403);
 const action=command.action.slice('opening.applicant-'.length);
 requireThat(['add','correct','update','recheck','reopen','hiring-review'].includes(action),'Unknown applicant tracking action.');
 requireThat(input.checked===true,'Confirm that you checked these applicant facts against the source.');
 const note=text(input.note,'Private source or change note',1500),today=localDate(at,w.location.timezone),all=r.data.applicants??[];
 const currentOpening=()=>{
  requireThat(r.data.status==='open'&&r.data.approval,'The current staffing request must be approved before tracking can progress.');
  requireThat(w.members.some(m=>m.id===r.data.managerId&&openingManager(m)),'Review the responsible manager’s current access first.',409);
  return r.data.approval.revision;
 };
 const facts=():ApplicantFacts=>{
  const receivedOn=calendarDate(input.receivedOn,'Application received date');requireThat(receivedOn<=today,'An application received date cannot be in the future.');
  const reference=text(input.reference,'Application source reference',200);
  requireThat(!all.some(a=>a.id!==input.applicantId&&referenceKey(a.reference)===referenceKey(reference)),'This application reference is already recorded for this request, including closed tracking.',409);
  return {name:text(input.name,'Applicant name',200),reference,receivedOn,sourceRef:text(input.sourceRef,'Checked application source',1500)};
 };
 const followup=(received:string)=>{const date=calendarDate(input.followupOn,'Owner follow-up date');requireThat(date>=received,'Follow-up cannot precede the application.');return date};
 let a:OpeningApplicant;
 if(action==='add'){
  requireThat(!input.applicantId,'Open the existing applicant record to make changes.');requireThat(all.length<50,'This staffing request has reached its applicant history limit.');
  const approvalRevision=currentOpening(),f=facts();a={...f,id:crypto.randomUUID(),stage:'received',followupOn:followup(f.receivedOn),interview:null,approvalRevision,events:[]};
 }else{
  const existing=all.find(a=>a.id===input.applicantId);requireThat(existing,'Applicant record not found in this staffing request.',404);requireThat(existing.events.length<50,'This applicant record has reached its retained update limit.');requireThat(existing.events.length<49||action==='update'&&['closed','withdrawn'].includes(String(input.stage)),'The final history entry is reserved for closing this applicant tracking.');a={...existing};
  if(action==='hiring-review'){
   requireThat(applicantActive(a),'Reopen applicant tracking before recording hiring approval.');currentOpening();requireThat(applicantCurrent(r,a),'Review this applicant against the current opening first.',409);
   a={...a,hiringReview:checkedHiringReview(input,w.members,r.locationId,a.receivedOn,today,me.id,at)};
  }else if(action==='correct'){
   const f=facts();requireThat(!a.interview||a.interview.date>=f.receivedOn,'Correct the interview record before moving the application date past it.');
   a={...a,...f,followupOn:applicantActive(a)?followup(f.receivedOn):'',approvalRevision:null,hiringReview:null};
  }else if(action==='recheck'){
   requireThat(applicantActive(a),'Reopen closed tracking before reviewing it.');a.approvalRevision=currentOpening();a.hiringReview=null;
  }else if(action==='reopen'){
   requireThat(!applicantActive(a),'This applicant tracking is already active.');a={...a,stage:'received',followupOn:followup(a.receivedOn),interview:null,approvalRevision:currentOpening(),hiringReview:null};
  }else{
   requireThat(applicantActive(a),'Reopen closed tracking before updating it.');
   requireThat(typeof input.stage==='string'&&Object.hasOwn(applicantStages,input.stage),'Choose a supported factual tracking stage.');const stage=input.stage as ApplicantStage;
   if(applicantActive({stage})){currentOpening();requireThat(applicantCurrent(r,a),'The staffing approval or application facts changed. Review this applicant against the current opening first.',409);}
   let interview:ApplicantState['interview']=null;
   if(stage==='planned'||stage==='interviewed'){
    const date=calendarDate(input.interviewDate,'Interview date');requireThat(date>=a.receivedOn,'The interview date cannot precede the application.');requireThat(stage!=='interviewed'||date<=today,'A completed interview cannot be recorded in the future.');
    interview={date,interviewer:text(input.interviewer,'Named interviewer',200),evidence:text(input.interviewEvidence,'Interview source evidence',1500)};
   }
   a={...a,stage,followupOn:applicantActive({stage})?followup(a.receivedOn):'',interview};
  }
 }
 const {id,events,...state}=a;a={...a,events:[...events,{action,at,by:me.id,note,state}]};
 // Private activity has its own bounded history; never exhaust the public staffing history.
 save({...r,data:{...r.data,applicants:action==='add'?[...all,a]:all.map(x=>x.id===id?a:x)}});
}
