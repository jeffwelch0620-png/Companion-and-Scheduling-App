import fs from 'node:fs';
import ts from '../../node_modules/typescript/lib/typescript.js';
import {verifyUiSourceBaseline} from './ui-source-baseline.mjs';
await verifyUiSourceBaseline();
const out=new URL('./runtime/ui-reference/',import.meta.url);
fs.mkdirSync(out,{recursive:true});
for(const name of ['ui-station-assignment.ts','ui-checkout-cycle-status.ts','ui-schedule-board.tsx','ui-shift-editor.tsx','ui-dish-checkouts.tsx','../../app/team/workspace-icon.tsx']) {
 const code=ts.transpileModule(fs.readFileSync(new URL(name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  .replace(/from ['"]\.\.\/\.\.\/app\/shared\/([^'"]+)['"]/g,"from '../closing-reference/$1.mjs'")
  .replace(/from ['"]\.\.\/\.\.\/app\/team\/workspace-icon['"]/g,"from './workspace-icon.mjs'")
  .replace(/from ['"]\.\/(ui-[^'"]+)['"]/g,(_,n)=>n.endsWith('.mjs')?"from '../../"+n+"'":"from './"+n+".mjs'");
 fs.writeFileSync(new URL(name.split('/').at(-1).replace(/\.tsx?$/,'.mjs'),out),code);
}
