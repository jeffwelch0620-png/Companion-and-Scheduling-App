export const employeeReady=(action,input)=>['close.transition','task.transition'].includes(action)&&input?.step==='ready';
export function clearCachedEmployee(storage,prefix,actor){
 for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);
  if(key?.startsWith(prefix+'records:')&&key.slice((prefix+'records:').length).split(':')[1]===actor)storage.removeItem(key);
 }
}
export async function retainReady(queue,subject,scope,command){const entries=await queue.list(subject,scope);if(entries.some(e=>e.command.recordId===command.recordId&&e.status!=='applied'))throw Error('This work already has a saved submission. Reconnect or ask the manager to review its status.');return queue.enqueue(subject,scope,command);}
export function submissionMessage(entry){return entry?.status==='applied'?'Submitted for independent review.':entry?.status==='pending'||entry?.status==='sending'?'Saved on this device; pending submission. This does not pass a check or release a shift.':entry?.status==='needs_auth'?'Sign in again to submit saved work.':entry?.status==='needs_review'?(entry.error==='queue_age_exceeded'?'Saved work is old. Review whether it is still accurate before retrying.':'Saved work needs manager review; current work changed.'):entry?.status==='blocked'?'Saved work is blocked by current permissions.':'Saved work was rejected; review the submission.';}
