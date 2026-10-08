// Local role-home review only. This launcher never deploys or provisions accounts.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const mode=process.argv[2]??'start';
if(!['check','build','start'].includes(mode))throw Error('Use: node role-review.mjs check | build | start [port]');
const run=args=>{const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1)};
if(mode==='check'){
  run(['scripts/prepare-shared-tests.mjs']);
  run(['--test','tests/role-home.test.mjs','tests/role-home-acceptance.test.mjs']);
}else if(mode==='build')run(['review.mjs','build']);
else{
  const port=Number(process.argv[3]??6801);
  if(!Number.isInteger(port)||port<1024||port>65530)throw Error('Choose a base port from 1024 to 65530; five consecutive ports must be free.');
  console.log(`Local role-home preview: http://127.0.0.1:${port}/role-homes`);
  console.log('Fictional review personas and sample records only. Real account linking and live migration remain on hold.');
  run(['review.mjs','start',String(port)]);
}
