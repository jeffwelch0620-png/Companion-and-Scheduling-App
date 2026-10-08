// Portable, loopback-only app review. Never deploy this test harness.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import {createHash} from 'node:crypto';
process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const require=createRequire(import.meta.url), mode=process.argv[2]??'start';
if(!['build','start','check'].includes(mode))throw Error('Use: node review.mjs build | start [port] | check');
if(Number(process.versions.node.split('.')[0])<22)throw Error('Use Node.js 22.13 or newer.');
// A short OS temp path avoids Windows SQLite path-length failures after extraction.
const temp=path.resolve(process.env.JMAX_REVIEW_TEMP??path.join(os.tmpdir(),'jmax-review-'+createHash('sha256').update(process.cwd()).digest('hex').slice(0,8)));fs.mkdirSync(temp,{recursive:true});
const env={...process.env,TEMP:temp,TMP:temp,WRANGLER_WRITE_LOGS:'false',MINIFLARE_REGISTRY_PATH:path.resolve('.wrangler/registry')};
// Ignore preview flags inherited from another build or local session.
for(const key of Object.keys(env))if(key.startsWith('JMAX_PREVIEW_')||key==='JMAX_TEST_DIST')delete env[key];
const run=args=>{const result=spawnSync(process.execPath,args,{stdio:'inherit',env});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);};
run(['scripts/prepare-shared-tests.mjs']);
if(mode==='build'){
 run([require.resolve('typescript/bin/tsc'),'--noEmit','--incremental','false']);
 run([path.join(path.dirname(fileURLToPath(import.meta.resolve('vinext'))),'cli.js'),'build']);
}else if(mode==='check'){
 run(['--test','tests/operations-home.test.mjs','tests/food-navigation.test.mjs','tests/food-navigation-render.test.mjs','tests/food-workflows.test.mjs','tests/workspace-context.test.mjs','tests/schedule-review.test.mjs','tests/schedule-requests.test.mjs','tests/personal-week.test.mjs','tests/shift-planning.test.mjs']);
}else{
 if(!fs.existsSync('dist/server/index.js'))throw Error('Build first: node review.mjs build');
 const port=Number(process.argv[3]??6601);
 if(!Number.isInteger(port)||port<1024||port>65530)throw Error('Choose a base port from 1024 to 65530; five consecutive ports must be free.');
 env.JMAX_PREVIEW_PORT=String(port);
 env.JMAX_PREVIEW_COMBINED_SCHEDULE='1';
 console.log('JMAX COMBINED-SHELL REVIEW ONLY: fictional records; local memory; external services disabled. Type stop or press Ctrl+C to finish.');
 run(['tests/operations-preview.mjs']);
}
