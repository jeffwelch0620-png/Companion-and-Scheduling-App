// Private operator output: never commit/attach real normalized records or reports to a PR.
import {open} from 'node:fs/promises';
import {parseSourcePreviewFile} from './source-preview.mjs';
import {normalizeToastRoster,toastRosterLimits} from './toast-roster-normalizer.mjs';
async function boundedFile(path,limit){
 const handle=await open(path,'r');try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw Error('input');
  const bytes=Buffer.alloc(limit+1);let length=0;
  while(length<bytes.length){const {bytesRead}=await handle.read(bytes,length,bytes.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>limit)throw Error('input');return bytes.subarray(0,length);
 }finally{await handle.close();}
}
try{
 if(process.argv.length!==4)throw Error('input');
 const bytes=await boundedFile(process.argv[2],toastRosterLimits.bytes),contextBytes=await boundedFile(process.argv[3],16*1024);
 const context=parseSourcePreviewFile(new TextDecoder('utf-8',{fatal:true}).decode(contextBytes));
 const result=normalizeToastRoster(bytes,context);process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=3;
}catch{
 // Fixed message: never echo paths, source values, parser fragments or exception details.
 process.stdout.write(JSON.stringify({status:'blocked',error:'toast_roster_input_refused',canApply:false,completenessCertified:false,accessProvisioned:false})+'\n');process.exitCode=1;
}
