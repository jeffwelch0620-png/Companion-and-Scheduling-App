// Explicit local input only. Prints a review report; never writes files or opens a database.
import {open} from 'node:fs/promises';
import {TextDecoder} from 'node:util';
import {createHash} from 'node:crypto';
import {parseSourcePreviewFile,previewSourceMapping,sourcePreviewLimits} from './source-preview.mjs';
let handle;
try{
 if(process.argv.length!==3)throw new TypeError('source_snapshot_path_required');
 handle=await open(process.argv[2],'r');const stat=await handle.stat();
 if(!stat.isFile()||stat.size>sourcePreviewLimits.bytes)throw new TypeError('snapshot_byte_limit');
 const buffer=Buffer.alloc(sourcePreviewLimits.bytes+1);let length=0;
 while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
 if(length>sourcePreviewLimits.bytes)throw new TypeError('snapshot_byte_limit');
 let body;try{body=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));}catch{throw new TypeError('invalid_snapshot_encoding');}
 const report=previewSourceMapping(parseSourcePreviewFile(body));report.inputFileDigest=createHash('sha256').update(buffer.subarray(0,length)).digest('hex');process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=report.status==='blocked'?2:report.status==='review_required'?3:0;
}catch(error){const known=['source_snapshot_path_required','snapshot_byte_limit','invalid_snapshot_encoding','invalid_snapshot_json','duplicate_snapshot_key','invalid_snapshot_shape','unsupported_snapshot_version','invalid_snapshot_scope','snapshot_limit_or_shape','empty_snapshot_scope','invalid_person_snapshot','invalid_target_store','invalid_target_member','invalid_target_leave','invalid_mapping_snapshot','duplicate_mapping_snapshot','invalid_source_store','invalid_source_coverage','invalid_member_snapshot','invalid_leave_snapshot','invalid_snapshot_keys'];process.stdout.write(JSON.stringify({status:'blocked',canApply:false,error:known.includes(error.message)?error.message:'source_snapshot_unavailable'})+'\n');process.exitCode=1;
}finally{await handle?.close();}
