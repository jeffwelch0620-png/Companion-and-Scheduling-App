// Fictional local review only. Never imported by the application.
import {localDate,nextDate} from '../.sites-runtime/shared/local-time.mjs';
export async function seedCombinedFood(db, dispatchFetch) {
  const rows=await db.prepare("SELECT id,capabilities,email FROM memberships WHERE location_id='berts' AND email IN ('admin@example.test','otherowner@example.test','boh@example.test')").all();
  for(const row of rows.results){
    const capabilities=new Set(JSON.parse(row.capabilities));
    capabilities.add('orders.request');
    if(row.email!=='boh@example.test')capabilities.add('orders.review');
    const displayName=row.email==='admin@example.test'?'DEMO Purchasing requester':row.email==='otherowner@example.test'?'DEMO Purchasing reviewer':'DEMO BOH manager';
    await db.prepare('UPDATE memberships SET name=?,capabilities=? WHERE id=?').bind(displayName,JSON.stringify([...capabilities]),row.id).run();
  }
  for(const recordId of ['demo-food-WI-001','demo-food-WI-002']){
    const response=await dispatchFetch('http://127.0.0.1:6601/api/food',{
      method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:6601','oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test'},
      body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'berts',action:'fooditem.count',recordId,expectedRevision:1,input:{quantity:1,confirmed:true,note:'Fictional review count entered through the normal Food API. No real stock was counted.'}})
    });
    if(!response.ok)throw Error('Unable to seed fictional Food count: '+await response.text());
  }
  const businessDate=localDate(new Date().toISOString(),'America/New_York');
  async function command(path,action,input,record){
    const response=await dispatchFetch('http://127.0.0.1:6601'+path,{
      method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:6601','oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test'},
      body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'berts',action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})
    });
    const result=await response.json();
    if(!response.ok)throw Error('Unable to seed fictional Food workflow: '+JSON.stringify(result));
    return result;
  }
  const definition=await command('/api/food/workflows','definition.save',{dataset:'demo',foodRecordId:'demo-food-WI-001',foodRevision:2,track:'daily',countUnit:'case',par:4,reviewNote:'Fictional walkthrough only: case unit and par chosen for this practice record.',confirmed:true});
  let count=await command('/api/food/workflows','count.create',{dataset:'demo',track:'daily',businessDate});
  count=await command('/api/food/workflows','count.save',{dataset:'demo',lines:[{definitionId:definition.recordId,quantity:1,note:'Fictional evening observation for the walkthrough.'}]},count);
  count=await command('/api/food/workflows','count.submit',{dataset:'demo',confirmed:true},count);
  await command('/api/food/workflows','plan.generate',{dataset:'demo',countId:count.recordId,countRevision:count.revision,targetDate:nextDate(businessDate,1)});
  await command('/api/workspace','order.food-save',{dataset:'demo',countDate:businessDate,lines:[{itemId:'demo-food-WI-001',itemRevision:2,skuId:'vs_demo1',quantity:3}],note:'Fictional internal purchase draft for review. No supplier order.'});
  console.log('FOOD REVIEW: two fictional current-date Food counts, a submitted practice prep count, a draft plan for tomorrow, and an internal purchase draft. Owner requests; second owner reviews. Other Food counts remain missing. No supplier transmission.');
}
