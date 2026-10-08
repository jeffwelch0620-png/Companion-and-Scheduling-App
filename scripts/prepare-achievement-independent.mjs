import fs from 'node:fs';import ts from 'typescript';import {createHash} from 'node:crypto';
fs.mkdirSync('.hour-achievement-review-runtime/shared',{recursive:true});
for(const name of fs.readdirSync('app/shared').filter(n=>n.endsWith('.ts'))){const output=ts.transpileModule(fs.readFileSync('app/shared/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");fs.writeFileSync('.hour-achievement-review-runtime/shared/'+name.replace('.ts','.mjs'),output);}
fs.mkdirSync('.hour-achievement-review-tests',{recursive:true});
for(const name of ['ai-task-trial-fixture.mjs','all-position-week-fixture.mjs'])fs.writeFileSync('.hour-achievement-review-tests/'+name,fs.readFileSync('tests/'+name,'utf8').replaceAll('../.sites-runtime/shared/','../.hour-achievement-review-runtime/shared/'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHashes=Object.fromEntries(fs.readdirSync('app/shared').filter(n=>n.endsWith('.ts')).sort().map(n=>[n,hash('app/shared/'+n)]));
const runtimeHashes=Object.fromEntries(fs.readdirSync('.hour-achievement-review-runtime/shared').filter(n=>n.endsWith('.mjs')).sort().map(n=>[n,hash('.hour-achievement-review-runtime/shared/'+n)]));
fs.writeFileSync('evidence/hour-trial/berts-boh/achievement-review-source-manifest.json',JSON.stringify({compiledAt:new Date().toISOString(),isolation:'Dedicated local transpilation; global application runtime untouched',sourceHashes,runtimeHashes},null,2)+'\n');
