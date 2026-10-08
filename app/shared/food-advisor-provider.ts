import type {AdvisorScope,AdvisorSnapshot} from './food-advisor-bridge';

export type FoodAdvisorConfiguration={FOOD_ADVISOR_SOURCE_URL?:string;FOOD_ADVISOR_SOURCE_TOKEN?:string;FOOD_ADVISOR_RESTAURANT_BINDINGS?:string};
type Provider={load(scope:AdvisorScope):Promise<AdvisorSnapshot>};
const fail=()=>{throw new Error('The Food advisor source configuration or response needs review.');};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const str=(v:unknown,max=1500):string=>typeof v==='string'&&v.length<=max?v:fail();
const num=(v:unknown):number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000000?v:fail();
const date=(v:unknown):string=>{const s=str(v,80);return Number.isFinite(Date.parse(s))?s:fail();};

// Only server configuration selects the source and its restaurant binding.
// The caller cannot submit a URL, access token, restaurant ID or source snapshot.
export function configuredFoodAdvisorProvider(config:FoodAdvisorConfiguration,fetcher:typeof fetch=fetch):Provider|undefined{
 if(!config.FOOD_ADVISOR_SOURCE_URL||!config.FOOD_ADVISOR_SOURCE_TOKEN||!config.FOOD_ADVISOR_RESTAURANT_BINDINGS)return undefined;
 let base:URL,bindings:Record<string,unknown>;
 try{base=new URL(config.FOOD_ADVISOR_SOURCE_URL);bindings=obj(JSON.parse(config.FOOD_ADVISOR_RESTAURANT_BINDINGS));}catch{return {async load(){return fail();}};}
 const loopback=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
 if((base.protocol!=='https:'&&!(base.protocol==='http:'&&loopback))||base.username||base.password||base.search||base.hash)return {async load(){return fail();}};
 const token=config.FOOD_ADVISOR_SOURCE_TOKEN;
 return {async load(scope){
  if(scope.dataset!=='operating'||bindings[scope.locationId]!==scope.sourceRestaurantId||!scope.sourceRestaurantId)return fail();
  const url=new URL(`/api/integration/food-advisor/${encodeURIComponent(scope.sourceRestaurantId)}`,base);
  const response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return fail();
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>524288)return fail();
  if(!response.body)return fail();const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>524288){await reader.cancel();return fail();}parts.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  let raw:Record<string,unknown>;try{raw=obj(JSON.parse(new TextDecoder().decode(bytes)));}catch{return fail();}
  if(raw.restaurantId!==scope.sourceRestaurantId||typeof raw.sparse!=='boolean'||!Array.isArray(raw.recommendations)||raw.recommendations.length>50)return fail();
  const recommendations=raw.recommendations.map(value=>{const r=obj(value);
   if(r.restaurantId!==scope.sourceRestaurantId||r.shelfLifeSource!=='recipe'||typeof r.sourceCurrent!=='boolean')return fail();
   return {id:str(r.id,200),restaurantId:str(r.restaurantId,200),recipeId:str(r.recipeId,200),recipeName:str(r.recipeName,300),currentPar:num(r.currentPar),recommendedPar:num(r.recommendedPar),reasoning:str(r.reasoning,8000),status:str(r.status,30),createdAt:date(r.createdAt),unit:str(r.unit,80),shelfLife:str(r.shelfLife,300),shelfLifeDays:r.shelfLifeDays===null?null:num(r.shelfLifeDays),shelfLifeSource:'recipe' as const,sourceCurrent:r.sourceCurrent};
  });
  if(raw.portionMappings!==undefined&&(!Array.isArray(raw.portionMappings)||raw.portionMappings.length>100))return fail();
  const portionMappings=(raw.portionMappings as unknown[]|undefined)?.map(value=>{const m=obj(value),factor=num(m.recipeUnitsPerCountUnit);if(factor<=0)return fail();return {prepItemId:str(m.prepItemId,200),recipeId:str(m.recipeId,200),countUnit:str(m.countUnit,80),recipeUnit:str(m.recipeUnit,80),recipeUnitsPerCountUnit:factor,reviewedBy:str(m.reviewedBy,200),reviewedAt:date(m.reviewedAt),reviewNote:str(m.reviewNote)};});
  return {restaurantId:str(raw.restaurantId,200),revision:str(raw.revision,200),generatedAt:date(raw.generatedAt),sparse:raw.sparse,recommendations,portionMappings};
 }};
}
