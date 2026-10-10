// Read-only source scope review. No database certification or production application.
import {pendingCopiedStaffing,closingForShift} from './runtime/closing-reference/publication.mjs';
export function reviewIndividualPublication(workspace,shiftId){
 if(!workspace?.location?.id||!Array.isArray(workspace.records)||!Array.isArray(workspace.members))throw Error('Complete source workspace required');
 const shift=workspace.records.find(r=>r.id===shiftId&&r.kind==='shift'&&r.locationId===workspace.location.id);
 if(!shift)throw Error('Source shift required');
 const issues=[];
 if(shift.data.published||shift.data.cancelled||shift.data.releasedAt)issues.push('Shift is not an unpublished active draft');
 if(pendingCopiedStaffing(workspace,shift).length)issues.push('Copied staffing needs require review');
 if(workspace.records.some(r=>r.kind==='staffing'&&r.locationId===workspace.location.id&&r.area===shift.area&&r.data.status==='approved'&&r.data.start<shift.data.end&&r.data.end>shift.data.start))issues.push('Approved staffing needs require weekly publication review');
 if(closingForShift(workspace,shift.id).length)issues.push('Closing publication remains outside the individual candidate slice');
 return {sourceShiftId:shift.id,sourceRevision:shift.revision,eligible:issues.length===0,issues,coverage:'individual-scope-review-only',requiresCompleteSourceAttestation:true};
}
