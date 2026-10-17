// Wholly fictional inputs. Real source/target/operator reports never belong in Git.
import test from 'node:test';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readV3Snapshot,sourceV3CliLimits,v3CliResult,v3CliFailure} from './source-preview-v3-cli-support.mjs';
import {previewSourceMappingV3} from './source-preview-v3.mjs';
import {prepareToastRoster} from './toast-roster-preparation.mjs';
const cli=fileURLToPath(new URL('source-preview-v3-cli.mjs',import.meta.url));
const example=new URL('source-preview-v3.example.json',import.meta.url);
const fixture=()=>JSON.parse(readFileSync(example,'utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex');
const flags=r=>{for(const k of ['canApply','completenessCertified','accessProvisioned'])assert.equal(r[k],false);};
function temp(){
 const root=resolve(tmpdir()),dir=mkdtempSync(join(root,'companion-v3-cli-'));
 return {dir,file:join(dir,'private-v3-input.json'),clean(){const target=resolve(dir);if(dirname(target)!==root||!basename(target).startsWith('companion-v3-cli-'))throw Error('unexpected_cleanup_target');rmSync(target,{recursive:true,force:true});}};
}
function execute(args,options={}){const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024,windowsHide:true,...options});assert.ifError(r.error);assert.equal(r.signal,null);return {...r,report:JSON.parse(r.stdout)};}
function withInput(value,action){const t=temp();try{writeFileSync(t.file,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value));return action(t);}finally{t.clean();}}

test('V3 CLI defaults to a minimized review-required summary with exact input-byte digest',()=>{
 const before=readFileSync(example),r=execute([fileURLToPath(example)]);assert.equal(r.status,3);assert.equal(r.stderr,'');assert.equal(r.report.outputMode,'summary');assert.equal(r.report.status,'review_required');assert.equal(r.report.inputFileDigest,digest(before));assert.deepEqual(r.report.counts,{new:1,unchanged:1,changed:0,omitted:0,blocked:0,review_required:0});assert.deepEqual(r.report.issues,[{code:'active_population_review_required',severity:'review_required',count:1}]);flags(r.report);assert.deepEqual(readFileSync(example),before);
 for(const privateValue of ['Avery','Rowan','fictional-organization','fictional-store','4abcde00','Fictional Cook',fileURLToPath(example)])assert.ok(!r.stdout.includes(privateValue));
 for(const key of ['source','target','rows','organizationId','mappingDigest'])assert.ok(!Object.hasOwn(r.report,key));
});
test('explicit private report contains complete helper results and sensitive-output labeling',()=>{
 const input=fixture(),expected=previewSourceMappingV3(input),r=execute([fileURLToPath(example),'--private-report']);assert.equal(r.status,3);assert.equal(r.stderr,'');assert.equal(r.report.outputMode,'private-report');assert.equal(r.report.sensitiveOperatorArtifact,true);assert.deepEqual(r.report.rows,expected.rows);assert.deepEqual(r.report.scopes,expected.scopes);assert.equal(r.report.reviewContextDigest,expected.reviewContextDigest);assert.ok(r.stdout.includes(input.mappings[0].targetId));flags(r.report);
});
test('blocking rows exit 2 and summary findings aggregate without per-record identifiers',()=>{
 const input=fixture();input.mappings=[];withInput(input,t=>{const before=readFileSync(t.file),r=execute([t.file]);assert.equal(r.status,2);assert.equal(r.report.status,'blocked');assert.equal(r.report.counts.blocked,2);assert.ok(r.report.issues.some(i=>i.code==='identity_mapping_required'&&i.count===2&&i.severity==='blocking'));assert.ok(!r.stdout.includes(input.preparation.source.records[0].sourceId));assert.deepEqual(readFileSync(t.file),before);flags(r.report);});
});
test('archived-target reactivation remains blocking at the CLI boundary',()=>{
 const input=fixture();input.target.stores[0].members[0].active=false;withInput(input,t=>{const r=execute([t.file,'--private-report']);assert.equal(r.status,2);const row=r.report.rows.find(r=>r.sourceId===input.mappings[0].sourceId);assert.equal(row.status,'blocked');assert.ok(row.issues.includes('target_membership_reactivation_review'));assert.deepEqual(row.changedFields,[]);});
});
test('missing, extra, stdin and unknown-option arguments are refused without echoing values',()=>{
 for(const args of [[],['--private-report'],['-'],[fileURLToPath(example),'--secret-value'],[fileURLToPath(example),'--private-report','fictional-secret']]){const r=execute(args);assert.equal(r.status,1);assert.equal(r.stderr,'');assert.ok(['source_v3_snapshot_path_required','source_v3_arguments_invalid'].includes(r.report.error));assert.ok(!r.stdout.includes('fictional-secret'));assert.ok(!r.stdout.includes(fileURLToPath(example)));flags(r.report);}
});
test('missing files and directories are fixed unavailable errors without paths or stacks',()=>{
 const t=temp();try{for(const path of [join(t.dir,'fictional-secret-missing.json'),t.dir]){const r=execute([path]);assert.equal(r.status,1);assert.equal(r.report.error,'source_v3_input_unavailable');assert.equal(r.stderr,'');assert.ok(!r.stdout.includes(t.dir));assert.ok(!r.stdout.includes('fictional-secret'));flags(r.report);}}finally{t.clean();}
});
test('oversized input refuses with exit 1 and is never truncated into a report',()=>{
 withInput(Buffer.alloc(sourceV3CliLimits.inputBytes+1,32),t=>{const r=execute([t.file]);assert.equal(r.status,1);assert.equal(r.report.error,'snapshot_byte_limit');assert.ok(!Object.hasOwn(r.report,'counts'));assert.equal(r.stderr,'');});
});
test('regular-file size is checked before reading and the descriptor is always closed',async()=>{
 for(const stat of [{isFile:()=>true,size:sourceV3CliLimits.inputBytes+1},{isFile:()=>false,size:1}]){let reads=0,closed=0;await assert.rejects(readV3Snapshot('fictional-input',async()=>({stat:async()=>stat,read:async()=>{reads++;},close:async()=>{closed++;}})),/snapshot_byte_limit|source_v3_input_unavailable/);assert.equal(reads,0);assert.equal(closed,1);}
});
test('short reads are accumulated and a growing file is bounded after its initial stat',async()=>{
 let position=0,closed=0;const source=Buffer.from('abc');const bytes=await readV3Snapshot('fictional-input',async()=>({stat:async()=>({isFile:()=>true,size:3}),read:async(buffer,offset)=>{if(position===source.length)return {bytesRead:0};buffer[offset]=source[position++];return {bytesRead:1};},close:async()=>{closed++;}}));assert.deepEqual(bytes,source);assert.equal(closed,1);
 let remaining=sourceV3CliLimits.inputBytes+1;closed=0;await assert.rejects(readV3Snapshot('fictional-growing-input',async()=>({stat:async()=>({isFile:()=>true,size:1}),read:async(buffer,offset,length)=>{const bytesRead=Math.min(length,8192,remaining);remaining-=bytesRead;return {bytesRead};},close:async()=>{closed++;}})),/snapshot_byte_limit/);assert.equal(remaining,0);assert.equal(closed,1);
});
test('unexpected read/open and cleanup errors never expose private exception text',async()=>{
 await assert.rejects(readV3Snapshot('fictional-secret',async()=>{throw Error('fictional-secret-path');}),e=>e.message==='source_v3_input_unavailable');
 const bytes=await readV3Snapshot('fictional-secret',async()=>({stat:async()=>({isFile:()=>true,size:0}),read:async()=>({bytesRead:0}),close:async()=>{throw Error('fictional-secret-close');}}));assert.equal(bytes.length,0);
 assert.deepEqual(v3CliFailure(Error('fictional-secret-unknown-error')),{status:'blocked',error:'invalid_v3_input',canApply:false,completenessCertified:false,accessProvisioned:false});
});
test('invalid UTF-8 and malformed JSON have minimized errors in both output modes',()=>{
 for(const value of [Buffer.from([0xc3,0x28]),'{"fictional-secret":'])for(const flag of [[],['--private-report']])withInput(value,t=>{const r=execute([t.file,...flag]);assert.equal(r.status,1);assert.ok(['invalid_snapshot_encoding','invalid_snapshot_json'].includes(r.report.error));assert.equal(r.stderr,'');assert.ok(!r.stdout.includes('fictional-secret'));assert.ok(!r.stdout.includes(t.dir));flags(r.report);});
});
test('duplicate and escaped-duplicate keys are rejected before V3 evaluation',()=>{
 for(const value of ['{"version":3,"version":3}','{"version":3,"\\u0076ersion":3}','{"nested":{"private":"fictional-secret","private":"other"}}'])withInput(value,t=>{const r=execute([t.file]);assert.equal(r.status,1);assert.equal(r.report.error,'duplicate_snapshot_key');assert.equal(r.stderr,'');assert.ok(!r.stdout.includes('fictional-secret'));});
});
test('BOM removal affects decoding only; original-byte hashes remain exact',()=>{
 const original=readFileSync(example),bom=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),original]);withInput(bom,t=>{const r=execute([t.file]);assert.equal(r.status,3);assert.equal(r.report.inputFileDigest,digest(bom));assert.notEqual(r.report.inputFileDigest,digest(original));assert.equal(r.report.reviewContextDigest,JSON.parse(v3CliResult(original).json).reviewContextDigest);});
});
test('altered preparation refuses without a partial report or source values',()=>{
 const input=fixture();input.preparation.source.records[0].firstName='Fictional Secret';withInput(input,t=>{const r=execute([t.file,'--private-report']);assert.equal(r.status,1);assert.equal(r.report.error,'roster_preparation_mismatch');assert.ok(!r.stdout.includes('Fictional Secret'));assert.ok(!Object.hasOwn(r.report,'rows'));assert.equal(r.stderr,'');});
});
test('population, typed-version and duplicate-alias refusals retain fixed public codes',()=>{
 for(const [change,code] of [[i=>i.supplement.population.revision++,'supplement_population_mismatch'],[i=>i.mappings[0].sourceVersion=1,'invalid_v3_source_version'],[i=>i.mappings.push({...i.mappings[0],sourceId:i.mappings[0].sourceId.toUpperCase(),targetId:'4abcde00-0000-0000-0000-000000000999'}),'duplicate_v3_mapping']]){const input=fixture();change(input);withInput(input,t=>{const r=execute([t.file]);assert.equal(r.status,1);assert.equal(r.report.error,code);assert.equal(r.stderr,'');flags(r.report);});}
});
test('legacy versions, unknown nested fields and excessive nesting cannot bypass strict validation',()=>{
 for(const value of [JSON.stringify({version:2}),JSON.stringify({...fixture(),extra:'fictional-secret'}),'['.repeat(25)+'0'+']'.repeat(25)])withInput(value,t=>{const r=execute([t.file]);assert.equal(r.status,1);assert.ok(!r.stdout.includes('fictional-secret'));assert.equal(r.stderr,'');flags(r.report);});
});
test('default summary never echoes source job tokens from row findings',()=>{
 const input=fixture(),p=input.preparation,scope=Object.fromEntries(['organizationId','system','tenant','storeId','externalStoreId','timezone','sourceFormat','transformVersion'].map(k=>[k,p.source[k]])),members=p.source.records.map(({sourceId,firstName,lastName,jobs})=>({sourceId,firstName,lastName,jobs}));members[0].jobs=[{token:'fictional-secret-token',description:'Fictional Secret Job'}];input.preparation=prepareToastRoster(members,{scope,capturedAt:'2035-11-04T12:00:00.123456Z',population:p.provenance.population,pairing:p.provenance.pairing,location:p.provenance.location},p.provenance.rawFileSha256);withInput(input,t=>{const r=execute([t.file]);assert.equal(r.status,2);assert.ok(r.report.issues.some(i=>i.code==='job_token_unresolved'));assert.ok(!r.stdout.includes('fictional-secret'));assert.ok(!Object.hasOwn(r.report,'rows'));const detail=execute([t.file,'--private-report']);assert.ok(detail.report.issues.some(i=>i.code==='job_token_unresolved'&&i.token==='fictional-secret-token'));});
});
test('CLI cannot open services, spawn helpers or write files when those operations are fenced',()=>{
 const t=temp();try{writeFileSync(t.file,JSON.stringify(fixture()));const guard=join(t.dir,'no-side-effects.mjs');writeFileSync(guard,[
 "import fs from 'node:fs';import fsp from 'node:fs/promises';import net from 'node:net';import http from 'node:http';import https from 'node:https';import dns from 'node:dns';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';",
 "const deny=()=>{throw Error('forbidden_v3_side_effect');};const original=fsp.open;fsp.open=async(path,flags,...args)=>{if(typeof flags==='string'?flags!=='r':!!(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)))deny();return original(path,flags,...args);};",
 "for(const key of ['writeFile','appendFile','mkdir','rm','unlink','rename','truncate'])fsp[key]=deny;for(const key of ['writeFileSync','appendFileSync','mkdirSync','rmSync','unlinkSync','renameSync','truncateSync'])fs[key]=deny;",
 "net.Socket.prototype.connect=deny;net.connect=deny;net.createConnection=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;dns.lookup=deny;dns.resolve=deny;globalThis.fetch=deny;for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny;syncBuiltinESMExports();"
 ].join('\n'));const before=readFileSync(t.file),r=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,cli,t.file],{encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,DATABASE_URL:'postgresql://fictional-invalid.example.invalid/no-database',HTTP_PROXY:'http://fictional-invalid.example.invalid:1'}});assert.ifError(r.error);assert.equal(r.status,3,r.stderr||r.stdout);assert.equal(r.stderr,'');assert.equal(JSON.parse(r.stdout).status,'review_required');assert.deepEqual(readFileSync(t.file),before);}finally{t.clean();}
});
test('closed stdout pipe exits cleanly without an uncaught stack or private stderr',async()=>{
 const t=temp();try{writeFileSync(t.file,JSON.stringify(fixture()));const child=spawn(process.execPath,[cli,t.file,'--private-report'],{stdio:['ignore','pipe','pipe'],windowsHide:true});let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdout.destroy();const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('cli_pipe_timeout'));},15000);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});assert.equal(result.code,1);assert.equal(result.signal,null);assert.equal(stderr,'');}finally{t.clean();}
});

test('non-regular pipe inputs cannot block the bounded reader before file validation',async()=>{
 const t=temp();try{
  if(process.platform==='win32'){
   let read=false;await assert.rejects(readV3Snapshot('fictional-pipe',async()=>({stat:async()=>({isFile:()=>false,size:0}),read:async()=>{read=true;},close:async()=>{}})),/source_v3_input_unavailable/);assert.equal(read,false);
  }else{
   const pipe=join(t.dir,'fictional-input-pipe');const setup=spawnSync('mkfifo',[pipe],{encoding:'utf8',timeout:5000});assert.ifError(setup.error);assert.equal(setup.status,0);const r=execute([pipe],{timeout:3000});assert.equal(r.status,1);assert.equal(r.report.error,'source_v3_input_unavailable');assert.equal(r.stderr,'');
  }
 }finally{t.clean();}
});

test('URL, UNC and Windows device paths refuse before any filesystem opener is called',async()=>{
 for(const path of ["https://fictional-secret.example.invalid/input.json","file:///fictional-secret.json","//fictional-server/private.json","\\\\fictional-server\\private.json","\\\\.\\pipe\\fictional-private-input"]){
  let opened=false;await assert.rejects(readV3Snapshot(path,async()=>{opened=true;throw Error('unexpected_open');}),/source_v3_arguments_invalid/);assert.equal(opened,false);const r=execute([path]);assert.equal(r.status,1);assert.equal(r.report.error,'source_v3_arguments_invalid');assert.ok(!r.stdout.includes('fictional'));assert.equal(r.stderr,'');
 }
});

test('fixed V3 validation-chain codes are explicitly covered; other error types collapse',()=>{
 const ts=createRequire(import.meta.url)('typescript'),codes=new Set();
 // Intentionally empty: every scanned fixed literal is safe to expose as a TypeError.
 const deliberatelyCollapsed=new Map();
 const helpers=new Set(['validateSourceTarget','memberShape','leaveShape','names','list','shape','parseSourcePreviewFile']);
 for(const file of ['toast-roster-preparation.mjs','manager-supplement.mjs','source-fingerprint.mjs','source-preview-v3.mjs','source-preview.mjs']){
  const tree=ts.createSourceFile(file,readFileSync(new URL(file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const walk=node=>{
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)){
    if(['fail','bad'].includes(node.expression.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))codes.add(node.arguments[0].text);
    if(node.expression.text==='exactShape'&&node.arguments[2]&&ts.isStringLiteral(node.arguments[2]))codes.add(node.arguments[2].text);
   }
   if(ts.isFunctionDeclaration(node)&&node.name?.text==='exactShape')for(const parameter of node.parameters)if(parameter.initializer&&ts.isStringLiteral(parameter.initializer))codes.add(parameter.initializer.text);
   ts.forEachChild(node,walk);
  };
  if(file==='source-preview.mjs'){for(const statement of tree.statements)if(ts.isFunctionDeclaration(statement)&&helpers.has(statement.name?.text))walk(statement);}else walk(tree);
 }
 assert.ok(codes.size>60);
 for(const code of codes){
  assert.equal(v3CliFailure(new TypeError(code)).error,deliberatelyCollapsed.has(code)?'invalid_v3_input':code,code);
  assert.equal(v3CliFailure(new Error(code)).error,'invalid_v3_input',code);
  assert.equal(v3CliFailure({message:code}).error,'invalid_v3_input',code);
 }
 for(const [code,reason]of deliberatelyCollapsed){assert.ok(codes.has(code));assert.ok(reason.length>0);}
 assert.equal(v3CliFailure(new TypeError('fictional-secret-unknown-code')).error,'invalid_v3_input');
});

test('reserved Windows basenames in any segment are refused before opening on all platforms',async()=>{
 const slash=String.fromCharCode(92);
 for(const path of ['NUL','nul.json','dir'+slash+'COM1','CONOUT$','nested/aux.txt','nested/PRN...   ','C:'+slash+'safe'+slash+'LPT².log','dir/COM³.data','dir/conin$.txt','dir/nul .json','dir/NUL/ordinary.json','dir'+slash+'lpt0'+slash+'ordinary.json']){
  let opened=false;
  await assert.rejects(readV3Snapshot(path,async()=>{opened=true;throw Error('unexpected_open');}),error=>error instanceof TypeError&&error.message==='source_v3_arguments_invalid',path);
  assert.equal(opened,false,path);
  const result=execute([path]);assert.equal(result.status,1);assert.equal(result.report.error,'source_v3_arguments_invalid');assert.equal(result.stderr,'');
 }
});

test('ordinary path names and drive paths still reach the read-only opener',async()=>{
 const slash=String.fromCharCode(92);
 for(const path of ['connection.json','com10.json','nulled.json','auxiliary.json','dir'+slash+'company.json','C:'+slash+'safe'+slash+'input.json']){
  let opened=false,closed=false;
  const bytes=await readV3Snapshot(path,async actual=>{assert.equal(actual,path);opened=true;return {stat:async()=>({isFile:()=>true,size:0}),read:async()=>({bytesRead:0}),close:async()=>{closed=true;}};});
  assert.equal(opened,true,path);assert.equal(closed,true,path);assert.equal(bytes.length,0);
 }
});
