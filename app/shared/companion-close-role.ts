import { personName, type RecordOf, type Workspace } from './types';

export function closingRole(w:Workspace,r:RecordOf<'close'>):string {
  const roles:string[]=[];
  if(r.ownerId===w.me.id)roles.push('the assigned closer');
  if(r.data.correction?.personId===w.me.id&&r.ownerId!==w.me.id)roles.push('the assigned correction helper');
  if(r.data.verifierId===w.me.id)roles.push('the named first physical checker');
  if(r.data.managerId===w.me.id)roles.push(r.data.verifierId?'the named closing manager for the separate final physical confirmation':'the named closing manager for the physical check');
  return roles.length?`You are ${roles.join(' and ')} for this assignment.`:`You can review this assignment, but its saved responsibility is assigned to ${personName(w,r.ownerId,'the assigned closer')} and the named checker${r.data.verifierId?'s':''}.`;
}
