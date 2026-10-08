import type {RecordOf,Workspace} from './types';
import {localDate} from './local-time';

// Explicit shift links and the owner's dated dedicated Dish checkout belong to
// checkout. General issues, other dates and other employees do not block it.
export function closingStatus(w:Workspace,shift:RecordOf<'shift'>,options:{allowProjectedReceipts?:boolean}={}){
 const scoped=w.records.filter(r=>r.locationId===w.location.id&&r.locationId===shift.locationId);
 const closes=scoped.filter((r):r is RecordOf<'close'>=>r.kind==='close'&&r.data.shiftId===shift.id&&r.data.phase!=='cancelled');
 const businessDate=localDate(shift.data.start,w.location.timezone);
 const ownDish=shift.data.position==='Dishwasher'?scoped.filter((r):r is RecordOf<'task'>=>r.kind==='task'&&r.ownerId===shift.ownerId&&r.data.dishCheckout?.businessDate===businessDate):[];
 const ownCycles=new Set(ownDish.map(r=>r.data.dishCheckout!.cycleId));
 const outgoingFor=(source:RecordOf<'task'>)=>[...new Set([...(source.data.dishHandoffs??[]),...(options.allowProjectedReceipts&&source.data.dishHandoffReceiptView===true?source.data.dishHandoffPendingIds??[]:[]),...scoped.filter(r=>r.kind==='task'&&r.data.dishHandoff?.sourceId===source.id).map(r=>r.id)])];
 const outgoingIds=new Set(ownDish.filter(r=>r.data.dishCheckout?.shift==='AM').flatMap(outgoingFor));
 const tasks=scoped.filter((r):r is RecordOf<'task'>=>{
  if(r.kind!=='task')return false;
  if(r.data.shiftId===shift.id||ownDish.some(d=>d.id===r.id))return true;
  if(shift.data.position!=='Dishwasher'||r.data.dishHandoff?.businessDate!==businessDate||!ownCycles.has(r.data.dishHandoff.cycleId))return false;
  // PM remains responsible until incoming work is independently verified.
  if(r.ownerId===shift.ownerId)return true;
  // AM must obtain an explicit, current-owner acceptance before leaving, but
  // does not wait for accepted PM work or the other PM employee's checkout.
  return outgoingIds.has(r.id)&&(r.data.dishHandoff.acceptedBy!==r.ownerId||!r.data.dishHandoff.acceptedAt);
 });
 const pendingCloses=closes.filter(r=>r.data.phase!=='closed');
 const pendingTasks=tasks.filter(r=>r.data.phase!=='closed');
 const pendingDishHandoffIds:string[]=[];
 for(const source of ownDish.filter(r=>r.data.dishCheckout?.shift==='AM'))for(const id of outgoingFor(source)){
  const child=scoped.find((r):r is RecordOf<'task'>=>r.kind==='task'&&r.id===id),link=child?.data.dishHandoff;
  const currentAccepted=(source.data.dishHandoffs??[]).includes(id)&&!!child&&child.data.kind==='task'&&child.area===source.area&&source.data.dishCheckout!.participantIds.slice(1).includes(child.ownerId)&&link?.sourceId===source.id&&link.cycleId===source.data.dishCheckout!.cycleId&&link.businessDate===businessDate&&link.acceptedBy===child.ownerId&&!!link.acceptedAt&&Number.isFinite(Date.parse(link.acceptedAt));
  // Only explicitly sanitized readers may use this narrow receipt. Command
  // authority inspects the actual current child, never the view marker.
  const projectedAccepted=!child&&options.allowProjectedReceipts===true&&source.data.dishHandoffReceiptView===true&&source.data.dishHandoffAcceptances?.some(a=>a.handoffId===id&&source.data.dishCheckout!.participantIds.slice(1).includes(a.acceptedBy)&&!!a.acceptedAt&&Number.isFinite(Date.parse(a.acceptedAt)));
  if(!currentAccepted&&!projectedAccepted){pendingDishHandoffIds.push(id);if(!pendingTasks.some(r=>r.id===source.id))pendingTasks.push(source);}
 }
 return {closes,tasks,pendingCloses,pendingTasks,pendingDishHandoffIds,required:closes.length+tasks.length>0,complete:pendingCloses.length+pendingTasks.length===0};
}
