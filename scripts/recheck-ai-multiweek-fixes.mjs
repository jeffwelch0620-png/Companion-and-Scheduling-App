import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {configuredCompanion} from '../.sites-runtime/shared/openai-companion.mjs';
import {createMultiweekSession} from '../tests/ai-multiweek-handler-fixture.mjs';
const envPath=process.argv.find(a=>a.startsWith('--env-path='))?.slice(11);
if(!process.argv.includes('--live')||!envPath)throw Error('Explicit live mode and approved existing environment path required.');
const env=fs.readFileSync(envPath,'utf8'),key=env.match(/^\s*OPENAI_API_KEY\s*=\s*["']?(sk-[A-Za-z0-9_-]+)/m)?.[1];
const config=configuredCompanion({OPENAI_API_KEY:key,JMAX_OPENAI_MODEL:'gpt-5.4-mini'});
if(!config)throw Error('Existing AI configuration unavailable.');
const fingerprint=(dir,ext)=>{const h=createHash('sha256');for(const file of fs.readdirSync(dir).filter(f=>f.endsWith(ext)).sort())h.update(file).update(fs.readFileSync(dir+'/'+file));return h.digest('hex');};
const output='evidence/ai-multiweek/post-fix-rechecks.json';
const report={at:new Date().toISOString(),model:config.model,realProvider:true,fictional:true,sourceFingerprint:fingerprint('app/shared','.ts'),compiledFingerprint:fingerprint('.sites-runtime/shared','.mjs'),scope:'Fresh disposable authenticated session per selected fixture. Targeted two-turn checks; not a full four-week replay or a replacement for its grades.',status:'running',results:[]};
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');save();
for(const [role,days] of [['back-window',[1,6]],['prep-cook',[12]],['gm',[17,24]]]){
 const cases=JSON.parse(fs.readFileSync(`evidence/ai-multiweek/${role}-cases.json`));
 for(const day of days){
  const session=createMultiweekSession(config,fetch);
  try{
   const result=await session.run(role,structuredClone(cases.cases.find(c=>c.day===day)));
   report.results.push(result);save();
   console.log(JSON.stringify({role,day,turns:result.turns.length,completed:result.turns.filter(t=>t.status==='completed').length}));
   if(result.turns.length!==2||result.turns.some(t=>t.status!=='completed'))throw Error('A targeted request failed; preserved evidence must be reviewed.');
  }finally{session.close();}
 }
}
report.status='captured; independent targeted review pending';report.actualReplies=report.results.reduce((n,r)=>n+r.turns.length,0);save();
