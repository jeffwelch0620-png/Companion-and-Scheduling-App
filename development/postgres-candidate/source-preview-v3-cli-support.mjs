// Bounded local input and minimized output for the isolated V3 CLI. No service or write path.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourcePreviewLimits,parseSourcePreviewFile} from './source-preview.mjs';
import {previewSourceMappingV3} from './source-preview-v3.mjs';
export const sourceV3CliLimits=Object.freeze({inputBytes:sourcePreviewLimits.bytes,outputBytes:8*1024*1024});
const fail=code=>{throw new TypeError(code);};
export async function readV3Snapshot(path,openInput=open){
 // Refuse URL/UNC/device namespaces before opening; Windows named pipes can block at open.
 if(typeof path!=='string'||!path||/^[\\/]{2}/.test(path)||/^[a-z][a-z0-9+.-]*:/i.test(path)&&!(/^[a-z]:[\\/]/i.test(path)))fail('source_v3_arguments_invalid');
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
const known=new Set(['source_v3_snapshot_path_required','source_v3_arguments_invalid','source_v3_input_unavailable','snapshot_byte_limit','invalid_snapshot_encoding','invalid_snapshot_json','duplicate_snapshot_key','invalid_v3_snapshot','unsupported_v3_snapshot','invalid_v3_access_fence','roster_preparation_mismatch','unsupported_roster_preparation','unsupported_source_profile','supplement_population_mismatch','supplement_scope_mismatch','v3_mapping_scope_mismatch','duplicate_v3_mapping','invalid_v3_mapping','invalid_v3_source_version','unsupported_v3_source_version','canonical_source_limit','snapshot_limit_or_shape','source_v3_report_limit']);
export function v3CliFailure(error){
 return {status:'blocked',error:known.has(error?.message)?error.message:'invalid_v3_input',canApply:false,completenessCertified:false,accessProvisioned:false};
}
