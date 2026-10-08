import { assignedLeader } from './schedule-policy';
import { has, manages, type Member, type RecordOf, type Workspace } from './types';
import {canManageClosing} from './closing-access';

export const attentionReasons = { repeated:'Repeated miss', serious:'Serious issue', unresolved:'Unresolved problem' } as const;
export function needsCloseAcknowledgment(r:RecordOf<'close'>){
  return !!r.data.attention && r.data.attention.acknowledgment?.by!==r.data.managerId;
}
export function canAcknowledgeClose(w:Workspace,r:RecordOf<'close'>,person:Member=w.me){
  return person.position!=='Dishwasher'&&person.id===r.data.managerId&&canManageClosing(person,r.area,'close.confirm')&&(has(person,'location.manage')||assignedLeader(w,person,r.area,{start:r.data.due,end:r.data.due}));
}
