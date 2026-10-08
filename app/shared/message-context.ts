import type { Member, MessageContext, RecordOf, WorkRecord, Workspace } from './types';
import { id, object, requireThat } from './validation';

type CanRead=(record:WorkRecord,member:Member,w:Workspace)=>boolean;
export function canReceiveContext(w:Workspace,record:WorkRecord,member:Member,canRead:CanRead){
  return member.locationId===w.location.id&&member.position!=='Dishwasher'&&canRead(record,member,w);
}

export function attachMessageContext(w:Workspace,value:unknown,recipients:Member[],at:string,canRead:CanRead):MessageContext|undefined{
  if(value===undefined)return undefined;
  const selection=object(value);
  requireThat(Object.keys(selection).every(k=>k==='recordId'||k==='revision'),'Choose the saved record and revision; attached instructions come from the server.');
  const recordId=id(selection.recordId),record=w.records.find(r=>r.id===recordId&&r.locationId===w.location.id);
  requireThat(record&&['standard','close'].includes(record.kind)&&canReceiveContext(w,record,w.me,canRead),'This guide or assignment is not available to attach.',404);
  requireThat(Number.isInteger(selection.revision)&&record.revision===selection.revision,'The attached work changed. Review the latest context or send without the attachment.',409);
  const standard=record.kind==='standard'?record:record.kind==='close'?w.records.find((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.id===record.data.standardId&&r.revision===record.data.standardRevision):undefined;
  requireThat(standard&&standard.locationId===w.location.id&&standard.data.status==='approved','This guide is no longer current. Ask the manager to review it, or send your question without the attachment.',409);
  requireThat(recipients.every(m=>canReceiveContext(w,record,m,canRead)&&canReceiveContext(w,standard,m,canRead)),'An attachment can only go to people who already have access to this guide or assignment. Choose another recipient or remove the attachment.',403);
  const s=standard.data;
  return {recordId:record.id,revision:record.revision,kind:record.kind as 'standard'|'close',capturedAt:at,standardId:standard.id,standardRevision:standard.revision,instruction:{title:s.title,zone:s.zone,position:s.position,version:s.version,source:s.source,criteria:[...s.criteria],verification:s.verification,...(s.guide?{guide:structuredClone(s.guide)}:{})},clarifications:s.provenance?.questions.map(q=>({question:q.prompt,answer:s.provenance!.answers[q.id]??''}))??[],...(record.kind==='close'?{assignment:{ownerId:record.ownerId,due:record.data.due,phase:record.data.phase,...(record.data.correction?{helperId:record.data.correction.personId}:{})}}:{})};
}

// Recheck attachment access on every read. A message is not a grant of access to work.
export function messageContextView(w:Workspace,message:RecordOf<'message'>,canRead:CanRead):RecordOf<'message'>{
  const context=message.data.context;if(!context)return message;
  const source=w.records.find(r=>r.id===context.recordId&&r.kind===context.kind),standard=w.records.find((r):r is RecordOf<'standard'>=>r.id===context.standardId&&r.kind==='standard');
  if(!source||!standard||!canReceiveContext(w,source,w.me,canRead)||!canReceiveContext(w,standard,w.me,canRead)){
    const data={...message.data};delete data.context;return {...message,data:{...data,contextStatus:'unavailable'}};
  }
  const current=source.revision===context.revision&&standard.revision===context.standardRevision&&standard.data.status==='approved';
  return {...message,data:{...message.data,contextStatus:current?'current':'changed'}};
}
