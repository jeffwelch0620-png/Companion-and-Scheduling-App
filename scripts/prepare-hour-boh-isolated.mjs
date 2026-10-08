import fs from 'node:fs';
import ts from 'typescript';
fs.mkdirSync('.hour-boh-runtime/shared',{recursive:true});
for(const name of fs.readdirSync('app/shared').filter(n=>n.endsWith('.ts'))){
 const output=ts.transpileModule(fs.readFileSync('app/shared/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 fs.writeFileSync('.hour-boh-runtime/shared/'+name.replace('.ts','.mjs'),output);
}
fs.mkdirSync('.hour-boh-tests',{recursive:true});
for(const name of ['hour-berts-boh-continuity.test.mjs','hour-dish-release-scope.test.mjs','ai-task-trial-fixture.mjs','all-position-week-fixture.mjs'])fs.writeFileSync('.hour-boh-tests/'+name,fs.readFileSync('tests/'+name,'utf8').replaceAll('../.sites-runtime/shared/','../.hour-boh-runtime/shared/'));
