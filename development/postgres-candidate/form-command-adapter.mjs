// Original closing form includes disabled checklist values on checker actions.
// Only readiness submits answers; the source reducer ignores answers otherwise.
export function formCommand(action,input,record,locationId){
 const normalized={...input};if(action==='close.transition'&&input.step!=='ready')delete normalized.answers;
 return {requestId:crypto.randomUUID(),locationId,action,input:normalized,...(record?{recordId:record.id,expectedRevision:record.revision}:{})};
}
