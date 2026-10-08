import {authenticateWorkspace,boundedJson} from './service';
import {context as foodContext} from './food-service';
const context=(db:Parameters<typeof foodContext>[0],identity:Parameters<typeof foodContext>[1],locationId:string)=>foodContext(db,identity,locationId,true);
import {handleFoodWorkflows} from './food-workflow-service';
import {foodWorkflowPermissions,type FoodDataset,type PrepDefinition} from './food-workflow-model';
import {projectFoodAdvisor,type AdvisorScope,type AdvisorSnapshot,type AdvisorRecipe,type AdvisorReview} from './food-advisor-bridge';
import {AppError,id,object,requireThat} from './validation';
export type FoodAdvisorProvider={load(scope:AdvisorScope):Promise<AdvisorSnapshot>};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
async function fingerprint(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function handleFoodAdvisor(request:Request,binding?:D1Database,provider?:FoodAdvisorProvider):Promise<Response>{
 try{
  requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
  const {db,identity}=await authenticateWorkspace(request,binding),url=new URL(request.url);
  let body:Record<string,unknown>|null=null;
  if(request.method==='POST'){
   requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);
   requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use JSON for this request.',415);
   body=object(await boundedJson(request.body,16000));
  }
  const locationId=id(body?body.locationId:url.searchParams.get('locationId')),dataset=body?body.dataset:url.searchParams.get('dataset')??'operating';
  requireThat(dataset==='demo'||dataset==='operating','Choose a Food dataset.');
  const ctx=await context(db,identity,locationId);requireThat(foodWorkflowPermissions(ctx.w.me).managePrep,'Prep-management access is required.',403);
  let receiptId='',bodyFingerprint='';
  if(body){
   requireThat(body.confirmed===true,'Confirm review of the target par.');receiptId=id(body.requestId);requireThat(receiptId.length<=95,'Use a shorter request identifier.');receiptId='advr-'+receiptId;
   bodyFingerprint=await fingerprint(body);
   const prior=await db.prepare('SELECT result FROM food_receipts WHERE location_id=? AND actor_id=? AND request_id=?').bind(locationId,ctx.w.me.id,receiptId).first<{result:string}>();
   if(prior){const result=JSON.parse(prior.result);requireThat(result.advisorFingerprint===bodyFingerprint,'This request identifier was used for a different recommendation review.',409);return json(result);}
  }
  const source=await db.prepare('SELECT source_restaurant_id FROM food_sources WHERE location_id=? AND dataset=?').bind(locationId,dataset).first<{source_restaurant_id:string}>();
  const unavailable:AdvisorReview={status:'unavailable',locationId,dataset:dataset as FoodDataset,foodRevision:ctx.revision,rows:[],message:!provider?'The authenticated Food advisor connection has not been configured.':'This restaurant does not have a mapped source Food catalog.'};
  if(!provider||!source){requireThat(!body,unavailable.message!,503);return json(unavailable);}
  const scope:AdvisorScope={locationId,dataset:dataset as FoodDataset,sourceRestaurantId:source.source_restaurant_id,foodRevision:ctx.revision};
  const snapshot=await provider.load(scope);
  // Fingerprint the full authenticated snapshot as well as its source revision,
  // so changed source advice cannot reuse the reviewed browser revision.
  snapshot.revision=await fingerprint({revision:snapshot.revision,snapshot});
  const records=await db.prepare("SELECT id,revision,data FROM food_records WHERE location_id=? AND dataset=? AND kind='foodrecipe' LIMIT 1001").bind(locationId,dataset).all<{id:string;revision:number;data:string}>();
  const defs=await db.prepare("SELECT data FROM food_workflows WHERE location_id=? AND dataset=? AND kind='definition' AND status='active' LIMIT 101").bind(locationId,dataset).all<{data:string}>();
  requireThat(records.results.length<=1000&&defs.results.length<=100,'The Food catalog needs a scoped advisor review.',503);
  const recipes:AdvisorRecipe[]=records.results.map(r=>({id:r.id,revision:r.revision,locationId,dataset:dataset as FoodDataset,recipe:JSON.parse(r.data)}));
  const definitions:PrepDefinition[]=defs.results.map(r=>JSON.parse(r.data));
  const review=projectFoodAdvisor(scope,snapshot,recipes,definitions);
  const after=await context(db,identity,locationId);requireThat(after.revision===ctx.revision&&after.membershipRevision===ctx.membershipRevision&&after.w.location.revision===ctx.w.location.revision,'Food records or access changed. Refresh.',409);
  if(!body)return json(review);
  requireThat(body.sourceRevision===review.sourceRevision&&body.foodRevision===ctx.revision,'The advice or local Food records changed. Refresh before applying.',409);
  const selected=review.rows.find(r=>r.id===body!.recommendationId);requireThat(selected&&selected.status==='ready','This recommendation needs review before applying.');
  requireThat(body.definitionRevision===selected.definitionRevision,'The prep definition changed. Refresh.',409);
  const definition=definitions.find(d=>d.id===selected.definitionId)!;
  const command={requestId:receiptId,locationId,action:'definition.save',recordId:definition.id,expectedRevision:definition.revision,input:{dataset,foodRecordId:selected.foodRecordId,foodRevision:selected.foodRecordRevision,track:definition.track,countUnit:definition.countUnit,par:selected.recommendedPar,reviewNote:'Reviewed Jeff Food recommendation '+selected.id+'; source '+review.sourceRevision,confirmed:true,advisorFingerprint:bodyFingerprint,advisorExpectedFoodRevision:ctx.revision}};
  return handleFoodWorkflows(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(command)}),binding);
 }catch(e){return json({error:e instanceof AppError?e.message:'The authenticated Food advisor source could not be read. No recommendation was applied.'},e instanceof AppError?e.status:503);}
}
