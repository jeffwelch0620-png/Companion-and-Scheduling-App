import { canDraftStandard, type StandardProvenance, type Workspace } from './types';
import { object, text } from './validation';
import { localDate } from './local-time';

export function readTrainingReview(value:unknown):NonNullable<StandardProvenance['review']> {
  const v=object(value);
  return {ownerId:text(v.ownerId??'','Content owner',100,true),reviewedOn:text(v.reviewedOn??'','Review date',10,true),evidence:text(v.evidence??'','Review evidence',2000,true)};
}
export function trainingReviewIssues(w:Workspace,p:StandardProvenance,at:string,area:string):string[] {
  if(!p.intake&&!p.starter)return [];
  const issues:string[]=[],r=p.review;
  const owner=w.members.find(m=>m.id===r?.ownerId&&!m.scheduleOnly);
  if(!owner||!canDraftStandard(owner,area))issues.push('Choose an active content owner with training permissions.');
  const date=r?.reviewedOn??'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>localDate(at,w.location.timezone))issues.push('Enter a real review date that is not in the future.');
  if(!r?.evidence.trim())issues.push('Record the current restaurant evidence used to review this guide.');
  for(const q of p.questions)if(!p.answers[q.id]?.trim())issues.push(q.prompt);
  return issues;
}
