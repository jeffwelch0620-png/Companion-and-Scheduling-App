import {authenticateWorkspace,boundedJson} from './service';
import {context} from './food-service';
import {readOrderGuide,reviewOrderGuide,type GuideItem} from './food-order-guide';
import {has} from './types';
import {AppError,id,object,text,requireThat} from './validation';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
export async function handleOrderGuide(request:Request,binding?:D1Database):Promise<Response>{
 try{
  requireThat(request.method==='POST','Method not allowed.',405);
  requireThat(request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open guide review from your JMAX workspace.',403);
  requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
  const auth=await authenticateWorkspace(request,binding),body=object(await boundedJson(request.body,1600000));
  requireThat(Object.keys(body).every(k=>['locationId','dataset','csv','fileName','confirmed'].includes(k)),'Unexpected guide review fields.');
  const locationId=id(body.locationId),dataset=body.dataset;
  requireThat(dataset==='demo'||dataset==='operating','Choose a food dataset.');
  const initial=await context(auth.db,auth.identity,locationId),w=initial.w;
  requireThat(has(w.me,'location.manage')||has(w.me,'orders.review'),'Guide review requires purchasing access.',403);
  requireThat(body.confirmed===true,'Confirm that this guide belongs to the selected restaurant.');
  requireThat(typeof body.csv==='string','Choose a CSV export of the guide’s Simple sheet.');
  const fileName=text(body.fileName,'Guide file name',200);requireThat(/\.csv$/i.test(fileName)&&!/[\\/\x00-\x1f]/.test(fileName),'Use a CSV filename without a folder path.');
  const table=readOrderGuide(body.csv),at=new Date().toISOString();
  // Read definitions only. No receipts, counts, personnel or catalog writes.
  const rows=await auth.db.prepare("SELECT id,revision,json_object('title',title,'controlNumber',source_key,'active',json_extract(data,'$.active'),'needsReview',json_extract(data,'$.needsReview'),'vendorSkus',json_extract(data,'$.vendorSkus')) AS data FROM food_records WHERE location_id=? AND dataset=? AND kind='fooditem' ORDER BY id LIMIT 5001").bind(locationId,dataset).all<{id:string;revision:number;data:string}>();
  requireThat(rows.results.length<=5000&&rows.results.reduce((n,r)=>n+r.data.length,0)<=5000000,'Catalog too large for guide review.',413);
  const result=reviewOrderGuide(table,rows.results.map(r=>({...r,data:JSON.parse(r.data)})) as GuideItem[]);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.csv))),v=>v.toString(16).padStart(2,'0')).join('');
  const fresh=await authenticateWorkspace(request,binding),current=await context(fresh.db,fresh.identity,locationId);
  requireThat(fresh.authUserId===auth.authUserId&&current.w.me.id===w.me.id&&current.membershipRevision===initial.membershipRevision&&current.revision===initial.revision&&current.w.location.revision===w.location.revision,'The restaurant or catalog changed. Review the guide again.',409);
  return json({locationId,dataset,revision:initial.revision,checkedAt:at,fileName,sha256,table,...result});
 }catch(error){return json({error:error instanceof AppError?error.message:'Order-guide review is unavailable.'},error instanceof AppError?error.status:503)}
}
