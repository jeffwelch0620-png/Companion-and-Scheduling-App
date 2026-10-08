import fs from 'node:fs';
import ts from 'typescript';
fs.mkdirSync('.sites-runtime/shared', { recursive: true });
for (const name of fs.readdirSync('app/shared').filter(n => n.endsWith('.ts'))) {
  const result = ts.transpileModule(fs.readFileSync(`app/shared/${name}`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  fs.writeFileSync(`.sites-runtime/shared/${name.replace('.ts', '.mjs')}`, result);
}
