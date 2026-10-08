import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const {handleCompanionChat}=await import(pathToFileURL(path.join(input.runtime,'companion-chat.mjs')).href);
const store=openPositionDatabase(input.file);
try{if(input.body&&input.body.action!=='preferences')throw new Error('Restart helper only permits the supported preference write');const request=new Request(`https://hour-trial.example/api/companion?locationId=${input.loc}${input.query??''}`,{method:input.body?'POST':'GET',headers:{'oai-authenticated-user-id':input.actor+'-identity','oai-authenticated-user-email':input.actor+'@example.test',...(input.body?{Origin:'https://hour-trial.example','Content-Type':'application/json'}:{})},...(input.body?{body:JSON.stringify(input.body)}:{})});const r=await handleCompanionChat(request,store.db,{OPENAI_API_KEY:'sk-fictional-only',JMAX_OPENAI_MODEL:'gpt-5.4-mini'},async()=>{throw new Error('Restart verification must not invoke provider');},()=>input.now,'workforce');process.stdout.write(JSON.stringify({status:r.status,data:await r.json()}));}finally{store.close();}
