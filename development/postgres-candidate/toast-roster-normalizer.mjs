// Exact-profile, bounded, read-only preparation. Deliberately separate from preview envelopes V1/V2.
import {createHash} from 'node:crypto';
import {exactShape,trimmedText,sourceUuid,validDay,utcMicroseconds,checkedToastScope,canonicalJobPairs,fingerprintToastMember,contentDigest} from './source-fingerprint.mjs';
export const toastRosterLimits=Object.freeze({bytes:2*1024*1024,employees:2000,jobsPerEmployee:100,fieldCharacters:2000});
export const toastRosterHeaders=Object.freeze(['Location','GUID','Last Name','First Name','Email','Phone Number','Employee ID','Job GUIDs','Job Descriptions','Wages']);
const fail=code=>{throw new TypeError(code);};
function csvRows(text){
 const rows=[];let row=[],field='',state='plain',started=false;
 function cell(){row.push(field);field='';state='plain';if(row.length>toastRosterHeaders.length)fail('invalid_roster_columns');}
 function record(){cell();rows.push(row);row=[];started=false;if(rows.length>toastRosterLimits.employees+1)fail('roster_row_limit');}
 for(let i=0;i<text.length;i++){
  const c=text[i];started=true;
  if(state==='quoted'){
   if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else state='closed';}else field+=c;
  }else if(c===','){cell();}
  else if(c==='\n'||c==='\r'){
   if(c==='\r'){if(text[i+1]!=='\n')fail('invalid_roster_csv');i++;}record();
  }else if(state==='closed')fail('invalid_roster_csv');
  else if(c==='"'){if(field)fail('invalid_roster_csv');state='quoted';}
  else field+=c;
  if(field.length>toastRosterLimits.fieldCharacters)fail('roster_field_limit');
 }
 if(state==='quoted')fail('invalid_roster_csv');if(started||row.length||field)record();return rows;
}
function checkedContext(context){
 exactShape(context,['scope','capturedAt','population','pairing','location']);checkedToastScope(context.scope);utcMicroseconds(context.capturedAt);
 exactShape(context.location,['expectedLabel','reviewer','revision']);
 if(!trimmedText(context.location.expectedLabel)||!trimmedText(context.location.reviewer)||!Number.isSafeInteger(context.location.revision)||context.location.revision<1)fail('invalid_roster_location_binding');
 exactShape(context.population,['kind','effectiveDate','archivedHistory','filterEvidence','reviewer','revision']);
 const p=context.population;
 if(p.kind!=='initial_active_only'||p.archivedHistory!=='excluded'||!validDay(p.effectiveDate)||!trimmedText(p.filterEvidence)||!trimmedText(p.reviewer)||!Number.isSafeInteger(p.revision)||p.revision<1)fail('invalid_roster_population');
 exactShape(context.pairing,['mode','reviewer','revision']);const pairing=context.pairing;
 if(!['unverified','reviewed_positional_pairs'].includes(pairing.mode)||!trimmedText(pairing.reviewer)||!Number.isSafeInteger(pairing.revision)||pairing.revision<1)fail('invalid_roster_pairing');
}
export function normalizeToastRoster(bytes,context){
 checkedContext(context);
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>toastRosterLimits.bytes)fail('roster_byte_limit');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('invalid_roster_encoding');}
 const rows=csvRows(text),header=rows.shift();
 if(!header||JSON.stringify(header)!==JSON.stringify(toastRosterHeaders))fail('unsupported_roster_header');
 if(!rows.length)fail('empty_roster_requires_review');
 const seen=new Set(),records=[];let location;
 for(const cells of rows){
  if(cells.length!==header.length)fail('invalid_roster_columns');
  const raw=Object.fromEntries(header.map((h,i)=>[h,cells[i]])),sourceId=raw.GUID.trim();
  if(!sourceUuid(sourceId)||seen.has(sourceId.toLowerCase()))fail('invalid_or_duplicate_employee_guid');seen.add(sourceId.toLowerCase());
  const rowLocation=raw.Location.trim();if(!trimmedText(rowLocation)||rowLocation!==context.location.expectedLabel||location!==undefined&&location!==rowLocation)fail('mixed_or_missing_roster_location');location=rowLocation;
  const first=raw['First Name'].trim(),last=raw['Last Name'].trim();if(!trimmedText(first)||!trimmedText(last))fail('invalid_source_member');
  // Keep token text exactly; only descriptions and name components are trimmed.
  const tokens=raw['Job GUIDs'].split(';'),descriptions=raw['Job Descriptions'].split(';');
  if(tokens.length!==descriptions.length)fail('roster_job_pair_mismatch');
  const jobs=canonicalJobPairs(tokens.map((token,i)=>({token,description:descriptions[i].trim()})));
  const member={sourceId,name:first+' '+last,jobs},issues=[];
  if(context.pairing.mode==='unverified')issues.push('job_pairing_review_required');
  if(jobs.some(j=>!sourceUuid(j.token)))issues.push('job_token_unresolved');
  if(new Set(jobs.map(j=>j.token)).size!==jobs.length)issues.push('job_token_description_conflict');
  issues.push('manager_supplement_required','identity_mapping_required');
  records.push({...member,sourceVersion:fingerprintToastMember(context.scope,member),status:'review_required',issues});
 }
 const descriptionsByToken=new Map();for(const r of records)for(const j of r.jobs){if(!descriptionsByToken.has(j.token))descriptionsByToken.set(j.token,new Set());descriptionsByToken.get(j.token).add(j.description);}
 for(const r of records)if(r.jobs.some(j=>descriptionsByToken.get(j.token).size>1)&&!r.issues.includes('job_token_description_conflict'))r.issues.push('job_token_description_conflict');
 records.sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
 const source={...context.scope,records,families:{roster:{available:true,population:'initial_active_only',archivedHistory:'excluded',coverageClaim:'unverified',count:records.length},timeOff:{available:false}}};
 const provenance={rawFileSha256:createHash('sha256').update(bytes).digest('hex'),normalizedSourceDigest:contentDigest(source),capturedAtMicroseconds:utcMicroseconds(context.capturedAt),population:{...context.population},pairing:{...context.pairing},location:{...context.location}};
 return {format:'toast-roster-preparation-v1',status:'review_required',source,provenance,provenanceDigest:contentDigest(provenance),canApply:false,completenessCertified:false,accessProvisioned:false};
}
