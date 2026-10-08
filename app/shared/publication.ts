import { has, manages, type Workspace, type RecordOf } from './types';
import { assignedLeader } from './schedule-policy';
import {guidesForShift} from './shift-learning';
import {canManageClosing} from './closing-access';

export function closingForShift(w:Workspace,shiftId:string):RecordOf<'close'>[] {
  return w.records.filter((r):r is RecordOf<'close'>=>r.kind==='close'&&r.data.shiftId===shiftId&&r.data.phase!=='cancelled').sort((a,b)=>a.id.localeCompare(b.id));
}
export function closingSelection(w:Workspace,shiftId:string) {
  return closingForShift(w,shiftId).map(r=>({id:r.id,revision:r.revision}));
}

export function pendingCopiedStaffing(w:Workspace,shift:RecordOf<'shift'>){
  return w.records.filter((r):r is RecordOf<'staffing'>=>r.kind==='staffing'&&r.area===shift.area&&r.data.status==='draft'&&!!r.data.copiedFrom&&r.data.position===shift.data.position&&r.data.start<shift.data.end&&r.data.end>shift.data.start);
}

export function closingPublicationIssues(w:Workspace,shift:RecordOf<'shift'>){
  return closingForShift(w,shift.id).flatMap(c=>{
    const issues:string[]=[],owner=w.members.find(m=>m.id===shift.ownerId),manager=w.members.find(m=>m.id===c.data.managerId),verifier=w.members.find(m=>m.id===c.data.verifierId);
    const standard=w.records.find(r=>r.kind==='standard'&&r.id===c.data.standardId);
    if(!standard||standard.kind!=='standard'||standard.data.status!=='approved'||standard.revision!==c.data.standardRevision)issues.push('Replace retired closing standards or changed versions before publishing this shift.');
    if(c.ownerId!==shift.ownerId||owner?.position==='Dishwasher'||c.area!==shift.area||!guidesForShift(w,shift).some(g=>g.id===c.data.standardId)||c.data.due<shift.data.start||c.data.due>shift.data.end)issues.push('Correct the closing owner, station or due time.');
    if(!manager||manager.id===shift.ownerId||!canManageClosing(manager,shift.area,'close.confirm')||!has(manager,'location.manage')&&!assignedLeader(w,manager,shift.area,{start:c.data.due,end:c.data.due}))issues.push('Assign an independent closing manager for the new due time.');
    if(c.data.standard.verification==='senior-then-manager'&&(!verifier||verifier.id===shift.ownerId||verifier.id===manager?.id||!canManageClosing(verifier,shift.area,'close.verify')))issues.push('Assign a separate first physical verifier.');
    return issues.map(reason=>({record:c,reason}));
  });
}
