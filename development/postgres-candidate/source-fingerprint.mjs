// Pure preparation helpers. A digest proves content equality, never authority or completeness.
import {createHash} from 'node:crypto';
export const toastRosterProfile=Object.freeze({sourceFormat:'toast-roster-csv-v1',transformVersion:'toast-roster-provider-v1'});
export const sourceEncoding='source-content-v2';
const fail=code=>{throw new TypeError(code);};
export function exactShape(value,keys,code='invalid_source_shape'){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.getOwnPropertySymbols(value).length||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail(code);
}
export const trimmedText=(v,max=200)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v);
export const sourceUuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function validDay(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))return false;
 const [y,m,d]=v.split('-').map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 return m>=1&&m<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
export function utcMicroseconds(v){
 const m=typeof v==='string'&&/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
 if(!m||!validDay(m[1])||+m[2]>23||+m[3]>59||+m[4]>59||m[6]!=='Z'&&(+m[6].slice(1,3)>23||+m[6].slice(4)>59))fail('invalid_source_instant');
 const ms=Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
 if(!Number.isFinite(ms))fail('invalid_source_instant');
 return String(BigInt(ms)*1000n+BigInt((m[5]??'').padEnd(6,'0')));
}
export function canonicalJson(value){
 const seen=new Set();
 function visit(v,depth){
  if(depth>20)fail('canonical_source_limit');
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'&&Number.isSafeInteger(v))return v;
  if(typeof v!=='object'||seen.has(v))fail('invalid_canonical_source');
  seen.add(v);let result;
  if(Array.isArray(v)){
   if(v.length>8000||Object.keys(v).length!==v.length||Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(v,i)))fail('canonical_source_limit');
   result=v.map(x=>visit(x,depth+1));
  }else{
   if(Object.getPrototypeOf(v)!==Object.prototype||Object.getOwnPropertySymbols(v).length||Object.keys(v).some(k=>!/^[A-Za-z][A-Za-z0-9]*$/.test(k)))fail('invalid_canonical_source');
   result=Object.fromEntries(Object.keys(v).sort().map(k=>[k,visit(v[k],depth+1)]));
  }
  seen.delete(v);return result;
 }
 const json=JSON.stringify(visit(value,0));if(Buffer.byteLength(json)>2*1024*1024)fail('canonical_source_limit');return json;
}
export const contentDigest=value=>createHash('sha256').update(canonicalJson(value),'utf8').digest('hex');
export function checkedToastScope(scope){
 exactShape(scope,['organizationId','system','tenant','storeId','externalStoreId','timezone','sourceFormat','transformVersion']);
 if(Object.values(scope).some(v=>!trimmedText(v))||scope.system!=='toast'||scope.sourceFormat!==toastRosterProfile.sourceFormat||scope.transformVersion!==toastRosterProfile.transformVersion)fail('unsupported_source_profile');
 try{new Intl.DateTimeFormat('en',{timeZone:scope.timezone}).format(0);}catch{fail('invalid_source_timezone');}
 return {...scope};
}
export function canonicalJobPairs(jobs){
 if(!Array.isArray(jobs)||!jobs.length||jobs.length>100)fail('invalid_source_jobs');
 const seen=new Set(),pairs=jobs.map(j=>{
  exactShape(j,['token','description']);
  if(typeof j.token!=='string'||!j.token.trim()||j.token.length>200||/[\x00-\x1f\x7f]/.test(j.token)||!trimmedText(j.description))fail('invalid_source_jobs');
  const k=JSON.stringify([j.token,j.description]);if(seen.has(k))fail('duplicate_source_job_pair');seen.add(k);return {...j};
 });
 return pairs.sort((a,b)=>a.token<b.token?-1:a.token>b.token?1:a.description<b.description?-1:a.description>b.description?1:0);
}
export function fingerprintToastMember(scope,member){
 const checked=checkedToastScope(scope);exactShape(member,['sourceId','name','jobs']);
 if(!sourceUuid(member.sourceId)||!trimmedText(member.name))fail('invalid_source_member');
 const payload={encoding:sourceEncoding,...checked,kind:'member',sourceId:member.sourceId,name:member.name,jobs:canonicalJobPairs(member.jobs)};
 return {kind:'content_fingerprint',encoding:sourceEncoding,algorithm:'sha256',value:contentDigest(payload)};
}
export function sourceReviewContextDigest(context){
 exactShape(context,['provenanceDigest','supplement','targetInputRevision','accessFence']);
 exactShape(context.supplement,['revision','reviewer','choices']);
 if(!/^[0-9a-f]{64}$/.test(context.provenanceDigest)||!Number.isSafeInteger(context.supplement.revision)||context.supplement.revision<1||!trimmedText(context.supplement.reviewer)||!Number.isSafeInteger(context.targetInputRevision)||context.targetInputRevision<0||!trimmedText(context.accessFence))fail('invalid_source_review_context');
 if(!Array.isArray(context.supplement.choices))fail('invalid_source_review_context');
 // Choices are bound as supplied, including order. This helper does not validate or approve a supplement.
 return contentDigest(context);
}
