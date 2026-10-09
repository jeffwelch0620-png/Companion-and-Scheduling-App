import {readdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...(await readdir(root)).filter(f=>f.endsWith('.test.mjs')).sort()],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});process.exit(result.status??1);
