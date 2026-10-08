// Runs only local acceptance tests. Does not sign in, provision or deploy.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
process.chdir(path.dirname(fileURLToPath(import.meta.url)));
if(Number(process.versions.node.split('.')[0])<22)throw Error('Use Node.js 22.13 or newer.');
const runtime=path.resolve(process.env.PGLITE_RUNTIME_ROOT??'.sites-runtime/shared-store-validation');
if(!fs.existsSync(path.join(runtime,'node_modules/@electric-sql/pglite/dist/index.js')))
 throw Error('Install the isolated local test runtime first: pwsh -NoProfile -File scripts/install-shared-store-test-runtime.ps1');
const run=args=>{const result=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,PGLITE_RUNTIME_ROOT:runtime}});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1)};
run(['scripts/prepare-shared-tests.mjs']);
run(['--test','tests/shared-store.test.mjs','tests/shared-store-postgres.test.mjs','tests/shared-live-render.test.mjs']);
