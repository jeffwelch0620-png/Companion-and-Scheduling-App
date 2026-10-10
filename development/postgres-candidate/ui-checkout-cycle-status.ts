// Candidate-only cycle projection from app/shared/domain.ts at 9a319c6.
import type {Workspace,RecordOf} from '../../app/shared/types';
import {storeConfiguration} from './ui-store-configuration.mjs';
export function dishCheckoutCycleStatus(w:Workspace,cycleId:string){
  const checkouts=w.records.filter((r):r is RecordOf<'task'>=>r.locationId===w.location.id&&r.kind==='task'&&r.data.kind==='task'&&r.data.dishCheckout?.cycleId===cycleId);
  const suppliedParticipants=checkouts[0]?.data.dishCheckout?.participantIds;
  const expected=Array.isArray(suppliedParticipants)&&suppliedParticipants.every(id=>typeof id==='string')?suppliedParticipants:[];
  const missingIds=expected.filter(personId=>checkouts.filter(r=>r.ownerId===personId).length!==1);
  const pendingCheckoutIds=checkouts.filter(r=>r.data.phase!=='closed').map(r=>r.id);
  const referenced=[...new Set(checkouts.flatMap(r=>Array.isArray(r.data.dishHandoffs)?r.data.dishHandoffs:[]))];
  const children=w.records.filter((r):r is RecordOf<'task'>=>r.locationId===w.location.id&&r.kind==='task'&&r.data.kind==='task'&&r.data.dishHandoff?.cycleId===cycleId);
  const unavailableHandoffIds=referenced.filter(id=>!children.some(r=>r.id===id));
  const invalidHandoffIds=children.filter(r=>{
    const link=r.data.dishHandoff!;
    const source=checkouts.find(p=>p.id===link.sourceId&&p.data.dishCheckout?.shift==='AM'&&Array.isArray(p.data.dishHandoffs)&&p.data.dishHandoffs.includes(r.id));
    return !source||r.area!==source.area||!expected.slice(1).includes(r.ownerId)||link.businessDate!==source.data.dishCheckout?.businessDate||!!link.acceptedBy&&(link.acceptedBy!==r.ownerId||!link.acceptedAt);
  }).map(r=>r.id);
  const pendingHandoffIds=children.filter(r=>r.data.phase!=='closed'||!r.data.dishHandoff?.acceptedBy).map(r=>r.id);
  const validShape=expected.length===3&&new Set(expected).size===3&&checkouts.length===3&&checkouts.filter(r=>r.data.dishCheckout?.shift==='AM').length===1&&checkouts.filter(r=>r.data.dishCheckout?.shift==='PM').length===2&&checkouts.every(r=>r.area===storeConfiguration(w).dishDepartment&&JSON.stringify(r.data.dishCheckout?.participantIds)===JSON.stringify(expected)&&/^\d{4}-\d{2}-\d{2}$/.test(r.data.dishCheckout?.businessDate??'')&&r.data.dishCheckout?.businessDate===checkouts[0].data.dishCheckout?.businessDate&&r.data.dishCheckout?.shift===(r.ownerId===expected[0]?'AM':'PM')&&(!r.data.dishHandoffs||Array.isArray(r.data.dishHandoffs)));
  const coverageComplete=validShape&&!missingIds.length&&!unavailableHandoffIds.length&&!invalidHandoffIds.length;
  return {complete:coverageComplete&&!pendingCheckoutIds.length&&!pendingHandoffIds.length,validShape,coverageComplete,missingIds,pendingCheckoutIds,unavailableHandoffIds,pendingHandoffIds,invalidHandoffIds};
}
