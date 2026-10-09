import fs from 'node:fs';
import ts from '../../node_modules/typescript/lib/typescript.js';
const out=new URL('./runtime/closing-reference/',import.meta.url);
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(new URL('../../app/shared/',import.meta.url)).filter(n=>n.endsWith('.ts'))){
 const code=ts.transpileModule(fs.readFileSync(new URL('../../app/shared/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 fs.writeFileSync(new URL(name.replace('.ts','.mjs'),out),code);
}
