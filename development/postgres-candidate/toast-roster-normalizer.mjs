// Exact-profile, bounded, read-only preparation. Deliberately separate from preview envelopes V1/V2.
import {createHash} from 'node:crypto';
import {toastRosterLimits,checkedToastRosterContext,prepareToastRoster} from './toast-roster-preparation.mjs';
export {toastRosterLimits} from './toast-roster-preparation.mjs';
import {trimmedText,sourceUuid,canonicalJobPairs} from './source-fingerprint.mjs';
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
export function normalizeToastRoster(bytes,context){
 checkedToastRosterContext(context);
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
  const emptyJobs=raw['Job GUIDs']===''&&raw['Job Descriptions']==='';
  const tokens=emptyJobs?[]:raw['Job GUIDs'].split(';'),descriptions=emptyJobs?[]:raw['Job Descriptions'].split(';');
  if(tokens.length!==descriptions.length)fail('roster_job_pair_mismatch');
  const jobs=canonicalJobPairs(tokens.map((token,i)=>({token,description:descriptions[i].trim()})));
  records.push({sourceId,firstName:first,lastName:last,jobs});
 }
 return prepareToastRoster(records,context,createHash('sha256').update(bytes).digest('hex'));
}
