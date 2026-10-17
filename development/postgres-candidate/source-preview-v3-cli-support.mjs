// Bounded local input and minimized output for the isolated V3 CLI. No service or write path.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourcePreviewLimits,parseSourcePreviewFile} from './source-preview.mjs';
import {previewSourceMappingV3} from './source-preview-v3.mjs';
export const sourceV3CliLimits=Object.freeze({inputBytes:sourcePreviewLimits.bytes,outputBytes:8*1024*1024});
const fail=code=>{throw new TypeError(code);};
export async function readV3Snapshot(path,openInput=open){
 // Apply Windows device-name refusal on every platform, before any filesystem opener.
 const reserved=/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;
 if(typeof path!=='string'||!path||/^[\\/]{2}/.test(path)||/^[a-z][a-z0-9+.-]*:/i.test(path)&&!(/^[a-z]:[\\/]/i.test(path)))fail('source_v3_arguments_invalid');
 if(path.split(/[\\/]/).some(segment=>reserved.test(segment.replace(/[. ]+$/g,'').split('.')[0].replace(/[. ]+$/g,''))))fail('source_v3_arguments_invalid');
 let handle;
 try{
  // O_NONBLOCK avoids waiting on a FIFO before fstat can refuse it (zero on unsupported platforms).
  handle=await openInput(path,constants.O_RDONLY|(constants.O_NONBLOCK??0));
  const stat=await handle.stat();if(!stat.isFile())fail('source_v3_input_unavailable');
  if(stat.size>sourceV3CliLimits.inputBytes)fail('snapshot_byte_limit');
  const bytes=Buffer.alloc(sourceV3CliLimits.inputBytes+1);let length=0;
  while(length<bytes.length){const {bytesRead}=await handle.read(bytes,length,bytes.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>sourceV3CliLimits.inputBytes)fail('snapshot_byte_limit');
  return bytes.subarray(0,length);
 }catch(error){if(error?.message==='snapshot_byte_limit')throw error;fail('source_v3_input_unavailable');}
 finally{try{await handle?.close();}catch{/* Never leak a path/error during cleanup. No writes were made. */}}
}
export function v3CliResult(bytes,privateReport=false){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>sourceV3CliLimits.inputBytes)fail('snapshot_byte_limit');
 let body;try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('invalid_snapshot_encoding');}
 const report=previewSourceMappingV3(parseSourcePreviewFile(body));
 const inputFileDigest=createHash('sha256').update(bytes).digest('hex');
 let output;
 if(privateReport)output={...report,inputFileDigest,sensitiveOperatorArtifact:true,outputMode:'private-report'};
 else{
  const grouped=new Map();for(const issue of report.issues){const key=JSON.stringify([issue.code,issue.severity]);if(!grouped.has(key))grouped.set(key,{code:issue.code,severity:issue.severity,count:0});grouped.get(key).count++;}
  output={purpose:report.purpose,version:3,status:report.status,canApply:false,completenessCertified:false,accessProvisioned:false,scopeCount:report.scopes.length,counts:report.counts,issues:[...grouped.values()].sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:a.severity<b.severity?-1:a.severity>b.severity?1:0),inputFileDigest,reviewContextDigest:report.reviewContextDigest,requires:report.requires,outputMode:'summary'};
 }
 const json=JSON.stringify(output,null,2)+'\n';if(Buffer.byteLength(json)>sourceV3CliLimits.outputBytes)fail('source_v3_report_limit');
 return {json,exitCode:report.status==='blocked'?2:report.status==='review_required'?3:0};
}
// Exact, data-free TypeError codes only; regression coverage scans the V3 validation chain.
const known=new Set([
 'canonical_source_limit',
 'duplicate_scheduling_job_selection',
 'duplicate_snapshot_key',
 'duplicate_source_job_pair',
 'duplicate_supplement_choice',
 'duplicate_token_review_description',
 'duplicate_v3_mapping',
 'empty_supplement_provider_projection',
 'invalid_canonical_source',
 'invalid_leave_snapshot',
 'invalid_member_snapshot',
 'invalid_person_snapshot',
 'invalid_roster_capture_instant',
 'invalid_roster_location_binding',
 'invalid_roster_member',
 'invalid_roster_pairing',
 'invalid_roster_population',
 'invalid_roster_preparation',
 'invalid_roster_preparation_record',
 'invalid_roster_provenance',
 'invalid_roster_raw_hash',
 'invalid_scheduling_job_selection',
 'invalid_snapshot_encoding',
 'invalid_snapshot_json',
 'invalid_snapshot_keys',
 'invalid_snapshot_scope',
 'invalid_snapshot_shape',
 'invalid_source_instant',
 'invalid_source_jobs',
 'invalid_source_member',
 'invalid_source_review_context',
 'invalid_source_shape',
 'invalid_source_timezone',
 'invalid_supplement_binding',
 'invalid_supplement_choice',
 'invalid_supplement_job',
 'invalid_supplement_json',
 'invalid_supplement_member',
 'invalid_supplement_population',
 'invalid_supplement_provider_member',
 'invalid_supplement_provider_projection',
 'invalid_supplement_review',
 'invalid_supplement_scope',
 'invalid_supplement_shape',
 'invalid_supplement_target_configuration',
 'invalid_target_leave',
 'invalid_target_member',
 'invalid_target_store',
 'invalid_token_review',
 'invalid_token_review_descriptions',
 'invalid_v3_access_fence',
 'invalid_v3_mapping',
 'invalid_v3_snapshot',
 'invalid_v3_source_version',
 'roster_preparation_mismatch',
 'roster_row_limit',
 'snapshot_byte_limit',
 'snapshot_limit_or_shape',
 'source_v3_arguments_invalid',
 'source_v3_input_unavailable',
 'source_v3_report_limit',
 'source_v3_snapshot_path_required',
 'supplement_byte_limit',
 'supplement_choice_limit',
 'supplement_member_limit',
 'supplement_population_mismatch',
 'supplement_scope_mismatch',
 'unsupported_roster_preparation',
 'unsupported_source_profile',
 'unsupported_supplement_format',
 'unsupported_v3_snapshot',
 'unsupported_v3_source_version',
 'v3_mapping_limit',
 'v3_mapping_scope_mismatch'
]);
export function v3CliFailure(error){
 return {status:'blocked',error:error instanceof TypeError&&known.has(error.message)?error.message:'invalid_v3_input',canApply:false,completenessCertified:false,accessProvisioned:false};
}
