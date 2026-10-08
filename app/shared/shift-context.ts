import {guidesForShift} from './shift-learning';
import {type RecordOf,type Workspace} from './types';
import {closingStatus} from './closing-status';

// Called only with the viewer's authorized workspace. Narrow context without
// impersonating the employee or granting access to their private conversation.
export function shiftContextWorkspace(w:Workspace,shift:RecordOf<'shift'>):Workspace {
 const guides=guidesForShift(w,shift),ids=new Set(guides.map(g=>g.id));
 const closes=w.records.filter((r):r is RecordOf<'close'>=>r.kind==='close'&&r.locationId===shift.locationId&&r.area===shift.area&&r.data.shiftId===shift.id&&r.ownerId===shift.ownerId&&r.data.phase!=='cancelled');
 // A close may use an approved guide that is separately named from the job.
 // Never recover its embedded method when the saved approved version is absent.
 for(const close of closes)if(w.records.some(r=>r.kind==='standard'&&r.id===close.data.standardId&&r.locationId===shift.locationId&&r.area===shift.area&&r.revision===close.data.standardRevision&&r.data.status==='approved'))ids.add(close.data.standardId);
 const closeIds=new Set(closes.map(r=>r.id)),taskIds=new Set(closingStatus(w,shift,{allowProjectedReceipts:true}).tasks.map(r=>r.id));
 const records=w.records.filter(r=>r.id===shift.id||ids.has(r.id)||closeIds.has(r.id)||r.kind==='leadership'&&r.locationId===shift.locationId&&r.area===shift.area&&r.data.active&&closes.some(c=>c.data.managerId===r.data.personId&&r.data.start<=c.data.due&&r.data.end>=c.data.due)||r.kind==='task'&&taskIds.has(r.id)||r.kind==='goal'&&r.ownerId===shift.ownerId&&['active','verification'].includes(r.data.phase)&&(!!shift.data.stationId&&r.data.stationLearning?.stationId===shift.data.stationId||!!r.data.standardId&&ids.has(r.data.standardId)));
 const people=new Set([w.me.id,shift.ownerId,...records.flatMap(r=>r.kind==='goal'?[r.data.managerId]:r.kind==='close'?[r.data.managerId,...(r.data.verifierId?[r.data.verifierId]:[]),...(r.data.correction?[r.data.correction.personId]:[])]:r.kind==='task'?[r.ownerId,...(r.data.incomingId?[r.data.incomingId]:[]),...(r.data.closingHandoff?[r.data.closingHandoff.outgoingId,r.data.closingHandoff.acceptedBy]:[])]:[])]);
 return {...w,members:w.members.filter(m=>people.has(m.id)),records,learningHistory:[],formerMembers:w.formerMembers?.filter(m=>people.has(m.id))};
}
