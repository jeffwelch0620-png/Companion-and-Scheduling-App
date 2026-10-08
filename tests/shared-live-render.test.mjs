import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const output=path.resolve('.sites-runtime/shared-live-render');
const visited=new Set();
function compile(file){
 if(visited.has(file))return;visited.add(file);
 const relative=path.relative(path.resolve('app'),file),destination=path.join(output,relative.replace(/\.tsx?$/,'.mjs'));
 let js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 js=js.replace(/import ['"][^'"]+\.css['"];?/g,'').replace(/from (['"])(\.\.?\/[^'"]+)\1/g,(_,quote,specifier)=>{
  const base=path.resolve(path.dirname(file),specifier),dependency=['.ts','.tsx'].map(ext=>base+ext).find(candidate=>fs.existsSync(candidate));
  if(!dependency)throw new Error('Missing render dependency: '+base);
  compile(dependency);return `from ${quote}${specifier}.mjs${quote}`;
 });
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,js);
}
compile(path.resolve('app/team/operations.tsx'));
const {ManagerLog}=await import(pathToFileURL(path.join(output,'team/operations.mjs')));
// Exercise the actual session transport helpers without mounting the full shell.
const entry=ts.transpileModule(fs.readFileSync('app/shared-live/shared-live-entry.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 .replace(/import ConnectedWorkspace from ['"][^'"]+['"];?/,'const ConnectedWorkspace=()=>null;')
 .replace(/import ['"][^'"]+\.css['"];?/g,'');
fs.writeFileSync(path.join(output,'session-entry.mjs'),entry+'\nexport {sessionStatus,changeSession};\n');
const {sessionStatus,changeSession}=await import(pathToFileURL(path.join(output,'session-entry.mjs')));
const me={id:'fixture-manager',name:'Fixture manager',position:'BOH manager',area:'BOH',capabilities:['tasks.manage']};
const issue={id:'fixture-issue',kind:'managerlog',locationId:'fixture-restaurant',revision:1,ownerId:me.id,area:'BOH',data:{title:'Fixture cooler gasket',detail:'Inspect the seal.',status:'open',priority:'routine',category:'Maintenance',due:'2026-10-01T14:00:00Z',history:[{action:'created',actorId:me.id,at:'2026-09-30T14:00:00Z',note:'Inspect the seal.'}]}};
const w={location:{id:'fixture-restaurant',name:'Fictional restaurant',timezone:'America/New_York'},me,members:[me],records:[issue]};
const render=props=>renderToStaticMarkup(React.createElement(ManagerLog,{w,send:async()=>true,busy:false,now:'2026-09-30T15:00:00Z',...props}));

test('shared Manager Log renders saved issues and history with only supported note actions',()=>{
 const html=render({limitedToNotes:true});
 assert.match(html,/New issue/);assert.match(html,/Fixture cooler gasket/);assert.match(html,/Add note/);assert.match(html,/Entry history \(1\)/);assert.match(html,/Fixture manager/);
 assert.doesNotMatch(html,/Shift summaries|Accept handoff|Resolve with outcome|Change responsibility|Reopen|Service calls|Save call report/);
 assert.match(html,/Refresh to see updates from other devices/);
});
test('shared Manager Log retains restaurant and department filtering',()=>{
 const html=render({limitedToNotes:true,w:{...w,records:[issue,{...issue,id:'foreign',locationId:'other-restaurant',data:{...issue.data,title:'Foreign store secret'}},{...issue,id:'foh',area:'FOH',data:{...issue.data,title:'Other department secret'}}]}});
 assert.match(html,/Fixture cooler gasket/);assert.doesNotMatch(html,/Foreign store secret|Other department secret/);
});
test('existing local Manager Log retains its shift summaries and full issue actions',()=>{
 assert.match(render({}),/Shift summaries/);
 const html=render({initialIssueId:issue.id});
 assert.match(html,/Accept handoff/);assert.match(html,/Resolve with outcome/);assert.match(html,/Change responsibility/);
});
test('unconfigured shared saving remains unavailable and does not load a sample workspace',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous});
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/shared-store/session');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');return Response.json({configured:false,signedIn:false});};
 assert.deepEqual(await sessionStatus(),{configured:false,signedIn:false});
});
test('an expired shared cookie permits a fresh sign-in',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous});
 globalThis.fetch=async()=>Response.json({error:'Token expired'},{status:401});
 const session=await sessionStatus();assert.equal(session.configured,true);assert.equal(session.signedIn,false);assert.match(session.message,/Sign in again/);
});
test('unknown connection failures do not become a signed-in session',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous});
 globalThis.fetch=async()=>Response.json({error:'Shared store unavailable'},{status:503});
 await assert.rejects(sessionStatus(),/Shared store unavailable/);
});
test('shared sign-in sends existing credentials only to the session route with same-origin cookies',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous});
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/shared-store/session');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.deepEqual(JSON.parse(options.body),{action:'sign-in',email:'fixture@example.test',password:'synthetic password'});return Response.json({signedIn:true});};
 assert.deepEqual(await changeSession({action:'sign-in',email:'fixture@example.test',password:'synthetic password'}),{signedIn:true});
});
