import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const target=path.resolve('evidence/operational-learning/isolated-runtime');
fs.mkdirSync(path.join(target,'.sites-runtime/shared'),{recursive:true});fs.mkdirSync(path.join(target,'tests'),{recursive:true});
for(const file of fs.readdirSync('app/shared').filter(file=>file.endsWith('.ts'))){const compiled=ts.transpileModule(fs.readFileSync(path.join('app/shared',file),'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});const errors=(compiled.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error);if(errors.length)throw Error(file+': '+errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; '));const result=compiled.outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");fs.writeFileSync(path.join(target,'.sites-runtime/shared',file.replace(/\.ts$/,'.mjs')),result);}
for(const file of fs.readdirSync('tests').filter(file=>file.endsWith('.mjs')))fs.copyFileSync(path.join('tests',file),path.join(target,'tests',file));
process.stdout.write('Isolated source snapshot prepared for operational-learning tests.\n');
