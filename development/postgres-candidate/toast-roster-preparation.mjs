// Recompute supported preparation evidence. Content integrity is not authentication or raw-byte custody.
import {exactShape,trimmedText,sourceUuid,validDay,utcMicroseconds,checkedToastScope,canonicalJson,canonicalJobPairs,fingerprintToastMember,contentDigest} from './source-fingerprint.mjs';
export const toastRosterLimits=Object.freeze({bytes:2*1024*1024,employees:2000,jobsPerEmployee:100,fieldCharacters:2000});
const fail=code=>{throw new TypeError(code);};
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export function checkedToastRosterContext(context){
 exactShape(context,['scope','capturedAt','population','pairing','location']);checkedToastScope(context.scope);utcMicroseconds(context.capturedAt);
 exactShape(context.location,['expectedLabel','reviewer','revision']);
 if(!trimmedText(context.location.expectedLabel)||!trimmedText(context.location.reviewer)||!Number.isSafeInteger(context.location.revision)||context.location.revision<1)fail('invalid_roster_location_binding');
 exactShape(context.population,['kind','effectiveDate','archivedHistory','filterEvidence','reviewer','revision']);
 const p=context.population;
 if(p.kind!=='initial_active_only'||p.archivedHistory!=='excluded'||!validDay(p.effectiveDate)||!trimmedText(p.filterEvidence)||!trimmedText(p.reviewer)||!Number.isSafeInteger(p.revision)||p.revision<1)fail('invalid_roster_population');
 exactShape(context.pairing,['mode','reviewer','revision']);const pairing=context.pairing;
 if(!['unverified','reviewed_positional_pairs'].includes(pairing.mode)||!trimmedText(pairing.reviewer)||!Number.isSafeInteger(pairing.revision)||pairing.revision<1)fail('invalid_roster_pairing');
}

export function prepareToastRoster(members,context,rawFileSha256){
 checkedToastRosterContext(context);if(!hash(rawFileSha256))fail('invalid_roster_raw_hash');canonicalJson(members);
 if(!Array.isArray(members)||!members.length||members.length>toastRosterLimits.employees)fail('roster_row_limit');
 const seen=new Set(),records=members.map(m=>{
  exactShape(m,['sourceId','firstName','lastName','jobs'],'invalid_roster_member');
  if(!sourceUuid(m.sourceId)||seen.has(m.sourceId.toLowerCase())||!trimmedText(m.firstName)||!trimmedText(m.lastName))fail('invalid_roster_member');seen.add(m.sourceId.toLowerCase());
  const member={sourceId:m.sourceId,firstName:m.firstName,lastName:m.lastName,jobs:canonicalJobPairs(m.jobs)},issues=[];
  if(!member.jobs.length)issues.push('source_jobs_missing');
  if(member.jobs.length&&context.pairing.mode==='unverified')issues.push('job_pairing_review_required');
  if(member.jobs.some(j=>!sourceUuid(j.token)))issues.push('job_token_unresolved');
  if(new Set(member.jobs.map(j=>j.token)).size!==member.jobs.length)issues.push('job_token_description_conflict');
  issues.push('manager_supplement_required','identity_mapping_required');
  return {...member,displayName:m.firstName+' '+m.lastName,sourceVersion:fingerprintToastMember(context.scope,member),status:'review_required',issues};
 });
 const descriptionsByToken=new Map();for(const r of records)for(const j of r.jobs){if(!descriptionsByToken.has(j.token))descriptionsByToken.set(j.token,new Set());descriptionsByToken.get(j.token).add(j.description);}
 for(const r of records)if(r.jobs.some(j=>descriptionsByToken.get(j.token).size>1)&&!r.issues.includes('job_token_description_conflict'))r.issues.push('job_token_description_conflict');
 records.sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
 const source={...context.scope,records,families:{roster:{available:true,population:'initial_active_only',archivedHistory:'excluded',coverageClaim:'unverified',count:records.length},timeOff:{available:false}}};
 const provenance={rawFileSha256,normalizedSourceDigest:contentDigest(source),capturedAtMicroseconds:utcMicroseconds(context.capturedAt),population:{...context.population},pairing:{...context.pairing},location:{...context.location}};
 return {format:'toast-roster-preparation-v1',status:'review_required',source,provenance,provenanceDigest:contentDigest(provenance),canApply:false,completenessCertified:false,accessProvisioned:false};
}
function capturedInstant(value){
 if(typeof value!=='string'||!/^(-?[1-9][0-9]*|0)$/.test(value)||value.length>20)fail('invalid_roster_capture_instant');
 const us=BigInt(value),ms=us>=0n?us/1000n:(us-999n)/1000n;let iso;
 try{iso=new Date(Number(ms)).toISOString().slice(0,-1)+String(us-ms*1000n).padStart(3,'0')+'Z';}catch{fail('invalid_roster_capture_instant');}
 if(utcMicroseconds(iso)!==value)fail('invalid_roster_capture_instant');return iso;
}
export function validateToastRosterPreparation(input){
 canonicalJson(input);exactShape(input,['format','status','source','provenance','provenanceDigest','canApply','completenessCertified','accessProvisioned'],'invalid_roster_preparation');
 if(input.format!=='toast-roster-preparation-v1')fail('unsupported_roster_preparation');
 const scopeKeys=['organizationId','system','tenant','storeId','externalStoreId','timezone','sourceFormat','transformVersion'];
 exactShape(input.source,[...scopeKeys,'records','families'],'invalid_roster_preparation');
 const scope=Object.fromEntries(scopeKeys.map(k=>[k,input.source[k]]));checkedToastScope(scope);
 const p=input.provenance;exactShape(p,['rawFileSha256','normalizedSourceDigest','capturedAtMicroseconds','population','pairing','location'],'invalid_roster_provenance');
 if(!hash(p.rawFileSha256)||!hash(p.normalizedSourceDigest)||!hash(input.provenanceDigest))fail('invalid_roster_provenance');
 if(!Array.isArray(input.source.records)||input.source.records.length>toastRosterLimits.employees)fail('roster_row_limit');
 const members=input.source.records.map(r=>{exactShape(r,['sourceId','firstName','lastName','jobs','displayName','sourceVersion','status','issues'],'invalid_roster_preparation_record');return {sourceId:r.sourceId,firstName:r.firstName,lastName:r.lastName,jobs:r.jobs};});
 const expected=prepareToastRoster(members,{scope,capturedAt:capturedInstant(p.capturedAtMicroseconds),population:p.population,pairing:p.pairing,location:p.location},p.rawFileSha256);
 if(canonicalJson(input)!==canonicalJson(expected))fail('roster_preparation_mismatch');return expected;
}
