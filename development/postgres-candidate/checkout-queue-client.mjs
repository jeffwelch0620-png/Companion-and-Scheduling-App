export const employeeReady=(action,input)=>['close.transition','task.transition'].includes(action)&&input?.step==='ready';
export const employeeRecordCacheKey=(closeId,actor,mode)=>'records:'+ [closeId,actor,mode].map(encodeURIComponent).join(':');
export function clearCachedEmployee(storage,prefix,actor){
 for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);
  if(!key?.startsWith(prefix+'records:'))continue;
  const parts=key.slice(prefix.length).split(':');
  if(parts.length!==4&&!(parts.length===5&&parts[4]==='selected'))continue;
  try{const [closeId,cachedActor,mode]=parts.slice(1,4).map(decodeURIComponent);
   if(cachedActor===actor&&key===prefix+employeeRecordCacheKey(closeId,actor,mode)+(parts.length===5?':selected':''))storage.removeItem(key);
  }catch{/* Preserve malformed/unrelated keys rather than guessing their owner. */}
 }
}
export async function retainReady(queue,subject,scope,command){return queue.enqueue(subject,scope,command);}
export function submissionMessage(entry){return entry?.status==='applied'?'Submitted for independent review.':entry?.status==='pending'||entry?.status==='sending'?'Saved on this device; pending submission. This does not pass a check or release a shift.':entry?.status==='needs_auth'?'Sign in again to submit saved work.':entry?.status==='needs_review'?(entry.error==='queue_age_exceeded'?'Saved work is old. Review whether it is still accurate before retrying.':'Saved work needs manager review; current work changed.'):entry?.status==='blocked'?'Saved work is blocked by current permissions.':'Saved work was rejected; review the submission.';}
