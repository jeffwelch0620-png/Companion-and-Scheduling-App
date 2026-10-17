// Explicit local JSON only. Default stdout is minimized; --private-report opts into sensitive detail.
import {readV3Snapshot,v3CliResult,v3CliFailure} from './source-preview-v3-cli-support.mjs';
let result;
try{
 const args=process.argv.slice(2);
 if(!args.length)throw new TypeError('source_v3_snapshot_path_required');
 if(args.length>2||!args[0]||args[0]==='-'||args[0].startsWith('--')||args.length===2&&args[1]!=='--private-report')throw new TypeError('source_v3_arguments_invalid');
 result=v3CliResult(await readV3Snapshot(args[0]),args[1]==='--private-report');
}catch(error){result={json:JSON.stringify(v3CliFailure(error))+'\n',exitCode:1};}
// A closed output pipe must not produce an uncaught stack trace or repeat private report fragments.
process.stdout.on('error',()=>{process.exitCode=1;});
try{await new Promise((resolve,reject)=>process.stdout.write(result.json,error=>error?reject(error):resolve()));process.exitCode=result.exitCode;}
catch{process.exitCode=1;}
