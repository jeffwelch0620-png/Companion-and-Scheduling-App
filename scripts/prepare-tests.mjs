import fs from 'node:fs';
import ts from 'typescript';
fs.mkdirSync('.sites-runtime/tests',{recursive:true});
for(const name of ['demo-data','workflow-model','companion-context']){
 const source=fs.readFileSync(`app/${name}.ts`,'utf8');
 const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll("'./demo-data'","'./demo-data.mjs'").replaceAll("'./workflow-model'","'./workflow-model.mjs'");
 fs.writeFileSync(`.sites-runtime/tests/${name}.mjs`,result);
}
