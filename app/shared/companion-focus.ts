import type { ChatSource } from './companion-chat-types';
import type { WorkRecord } from './types';

// Eligibility is shared with the UI. The server must also resolve the record
// from publicWorkspace and check the exact revision before sending any context.
export function canAskAbout(r:WorkRecord):boolean {
  if(r.kind==='learningcase')return r.data.status==='reviewed'&&!!r.data.review;
  if(r.kind==='shift')return !r.data.cancelled;
  if(r.kind==='standard')return r.data.status==='approved';
  if(r.kind==='close')return !['closed','cancelled'].includes(r.data.phase);
  if(r.kind==='task')return r.data.phase!=='closed';
  if(r.kind==='handoff')return !['resolved','cancelled'].includes(r.data.phase);
  if(r.kind==='goal')return ['active','verification'].includes(r.data.phase);
  return false;
}
export function chatSource(r:WorkRecord):ChatSource {
  return {id:r.id,revision:r.revision,kind:r.kind,title:r.kind==='shift'?`${r.data.stationName??r.data.position} shift`:r.kind==='close'?r.data.standard.title:'title' in r.data?r.data.title:r.kind};
}
