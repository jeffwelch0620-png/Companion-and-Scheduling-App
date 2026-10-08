// One isolated fictional operation in a fresh Node process. No external providers.
import fs from 'node:fs';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleFoodTransfers} from '../.sites-runtime/shared/food-transfer-service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const handlers={'food/transfers':handleFoodTransfers,'food/workflows':handleFoodWorkflows,'food/assigned-prep':handleEmployeePrep};
if(!handlers[input.route])throw new Error('Unsupported fictional trial route');
const store=openPositionDatabase(input.file);
try{const request=new Request(`https://hour-trial.example/api/${input.route}?locationId=${input.loc}&dataset=${input.dataset??'operating'}${input.query??''}`,{headers:{'oai-authenticated-user-id':input.actor+'-identity','oai-authenticated-user-email':input.actor+'@example.test',Origin:'https://hour-trial.example','Content-Type':'application/json'},...(input.body?{method:'POST',body:JSON.stringify(input.body)}:{})});const response=await handlers[input.route](request,store.db);process.stdout.write(JSON.stringify({status:response.status,data:await response.json()}));}finally{store.close();}
