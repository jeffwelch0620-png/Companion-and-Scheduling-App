import fs from 'node:fs';
import ts from 'typescript';
const path=process.argv[2];
if(!path)throw Error('Pass the extracted Main.dc.html source path.');
const html=fs.readFileSync(path,'utf8');
const start=html.indexOf('const G = ['),end=html.indexOf('const groups = G.map',start);
if(start<0||end<0)throw Error('Gap catalog not found.');
const source=ts.createSourceFile('gaps.js',html.slice(start,end),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=source.statements[0]?.declarationList?.declarations[0];
function literal(node){
  if(ts.isArrayLiteralExpression(node))return node.elements.map(literal);
  if(ts.isStringLiteral(node))return node.text;
  throw Error('Only literal arrays and strings are accepted; source code is never executed.');
}
const groups=literal(declaration.initializer).map(([name,items])=>({name,items:items.map(([sourceStatus,title,note])=>({sourceStatus,title,note}))}));
fs.writeFileSync('app/shared/gap-decisions.json',JSON.stringify({source:'https://drive.google.com/file/d/1en-9SkifC7jdi_haP6vXzkt4DtMC4p3d/view',sourceDate:'2026-09-28',groups},null,2)+'\n');
console.log(`Imported ${groups.reduce((n,g)=>n+g.items.length,0)} source decisions in ${groups.length} groups.`);
