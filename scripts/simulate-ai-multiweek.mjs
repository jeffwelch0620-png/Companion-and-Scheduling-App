import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {configuredCompanion} from '../.sites-runtime/shared/openai-companion.mjs';
import {createMultiweekSession} from '../tests/ai-multiweek-handler-fixture.mjs';
const arg=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3);
const mock=process.argv.includes('--mock');
if(!mock&&!process.argv.includes('--live'))throw Error('Choose explicit --live or --mock.');
let config;
if(mock)config={key:'sk-fictional-multiweek-only',model:'gpt-5.4-mini'};
else{
 const envPath=arg('env-path');if(!envPath)throw Error('Supply the approved existing env path.');
 const text=fs.readFileSync(envPath,'utf8');
 const key=text.match(/^\s*OPENAI_API_KEY\s*=\s*["']?(sk-[A-Za-z0-9_-]+)/m)?.[1];
 config=configuredCompanion({OPENAI_API_KEY:key,JMAX_OPENAI_MODEL:'gpt-5.4-mini'});
 if(!config)throw Error('Existing configuration has no usable key.');
}
const dir=path.resolve('evidence/ai-multiweek'),only=arg('only')?.split(',');
const sourceHash=createHash('sha256');for(const f of fs.readdirSync('app/shared').filter(f=>f.endsWith('.ts')).sort())sourceHash.update(f).update(fs.readFileSync('app/shared/'+f));
const fingerprint=sourceHash.digest('hex');
const runtimeHash=createHash('sha256');for(const f of fs.readdirSync('.sites-runtime/shared').filter(f=>f.endsWith('.mjs')).sort())runtimeHash.update(f).update(fs.readFileSync('.sites-runtime/shared/'+f));const compiledFingerprint=runtimeHash.digest('hex');
const provider=mock?async(_url,init)=>{const input=JSON.parse(init.body).input,ctx=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Use the current saved work and approved instructions. This mock transport does not change operational records.',sourceIds:ctx.evidence.map(e=>e.source.id).slice(0,20)})}]}]});}:fetch;
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('-cases.json')&&(!only||only.includes(f.replace('-cases.json',''))))){
 const slug=file.replace('-cases.json',''),cases=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
 const output=path.join(dir,arg('output')??slug+(mock?'-preflight.json':'-replies.json'));
 const report={at:new Date().toISOString(),role:cases.role,model:config.model,fictional:true,realProvider:!mock,sourceFingerprint:fingerprint,compiledFingerprint,transport:'Actual authenticated Companion handler and persisted chat in one disposable database per role; explicit fixture snapshots model human work events',status:'running',results:[]};
 const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n'),session=createMultiweekSession(config,provider);save();
 try{
  for(const c of cases.cases){const result=await session.run(cases.role,c);report.results.push(result);report.continuity=session.receipt();save();console.log(JSON.stringify({role:slug,week:c.week,day:c.day,turns:result.turns.length,completed:result.turns.filter(t=>t.status==='completed').length}));if(result.turns.some(t=>t.status==='failed')){report.status='handler failure; stopped rather than skipping a day';break;}}
  if(report.status==='running')report.status=mock?'preflight complete; fake replies are not AI evidence':'captured; independent review pending';
  report.continuity=session.receipt();save();
 }finally{session.close();}
 console.log(JSON.stringify({role:slug,status:report.status,days:report.results.length,turns:report.results.reduce((n,r)=>n+r.turns.length,0)}));
 if(report.status.startsWith('handler failure'))process.exitCode=1;
}
