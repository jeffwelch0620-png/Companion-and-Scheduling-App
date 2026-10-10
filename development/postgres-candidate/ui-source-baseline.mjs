import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from '../../node_modules/typescript/lib/typescript.js';
export const copiedUiPaths=['app/team/shift-editor.tsx','app/team/schedule-board.tsx','app/team/dish-checkouts.tsx'];
const domainPath='app/shared/domain.ts',projection='dishCheckoutCycleStatus';
export function uiSourceFingerprint(path,source) {
 source=source.replace(/\r\n?/g,'\n');
 if(path===domainPath){
  const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const functions=file.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===projection);
  if(functions.length!==1||!functions[0].body)throw Error('Expected one '+projection+' function body in '+path);
  source=functions[0].body.getText(file);
 }else if(!copiedUiPaths.includes(path))throw Error('Invalid UI source baseline path: '+path);
 return createHash('sha256').update(source).digest('hex');
}
export async function verifyUiSourceBaseline({readSource=path=>readFile(new URL('../../'+path,import.meta.url),'utf8'),baseline}={}) {
 baseline??=JSON.parse(await readFile(new URL('./ui-source-baseline.json',import.meta.url),'utf8'));
 const paths=[...copiedUiPaths,domainPath];
 if(Object.keys(baseline).length!==paths.length||!paths.every(p=>Object.hasOwn(baseline,p)))throw Error('Expected only three copied components and the checkout-cycle projection in the UI source baseline');
 for(const path of paths){
  const expected=baseline[path];
  if(path===domainPath&&(!expected||expected.function!==projection||typeof expected.sha256!=='string'))throw Error('Expected a function-body baseline for '+domainPath);
  if(uiSourceFingerprint(path,await readSource(path))!==(path===domainPath?expected.sha256:expected))throw Error('Candidate UI copy is out of date: '+path+'. Reconcile the copy, then update ui-source-baseline.json in the same PR.');
 }
}
