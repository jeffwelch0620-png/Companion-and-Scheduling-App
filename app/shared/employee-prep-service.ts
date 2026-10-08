import {authenticateWorkspace,workspace} from './service';
import {employeePrep,type EmployeePrepItem} from './employee-prep';
import {AppError,id,requireThat} from './validation';
import type {PrepPlan,FoodDataset} from './food-workflow-model';
import type {FoodRecipe,FoodItem} from './food-model';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
export async function handleEmployeePrep(request:Request,binding?:D1Database){
 try{
  requireThat(request.method==='GET','This prep view is read-only.',405);
  const url=new URL(request.url),loc=id(url.searchParams.get('locationId'));
  const ds=url.searchParams.get('dataset')??'operating';requireThat(ds==='demo'||ds==='operating','Choose a food dataset.');
  const {db,identity}=await authenticateWorkspace(request,binding),ctx=await workspace(db,identity,loc);
  requireThat(!ctx.value.me.scheduleOnly,'Schedule-only access does not include prep.',403);
  const before=await db.prepare('SELECT revision FROM food_state WHERE location_id=?').bind(loc).first<{revision:number}>();
  const rows=await db.prepare("SELECT data FROM food_workflows WHERE location_id=? AND dataset=? AND kind='plan' AND status='released' AND EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.lines')) WHERE json_extract(value,'$.assignedTo')=?) ORDER BY updated_at DESC LIMIT 101").bind(loc,ds,ctx.value.me.id).all<{data:string}>();
  requireThat(rows.results.length<=100,'Too many active prep lists; ask your manager to review them.',503);
  const items:EmployeePrepItem[]=[];
  for(const item of employeePrep(ctx.value,rows.results.map(r=>JSON.parse(r.data) as PrepPlan),ds as FoodDataset)){
   const source=await db.prepare("SELECT kind,revision,data,source_restaurant_id FROM food_records WHERE id=? AND location_id=? AND dataset=?").bind(item.foodRecordId,loc,ds).first<{kind:string;revision:number;data:string;source_restaurant_id:string}>();
   let recipe:EmployeePrepItem['recipe']=null,recipeNotice='Ask your manager for the current preparation instructions.';
   if(source?.kind==='foodrecipe'&&source.revision===item.foodRevision){
    const r=JSON.parse(source.data) as FoodRecipe,ingredients:NonNullable<EmployeePrepItem['recipe']>['ingredients']=[];
    // Read only dependencies of this assigned recipe in its exact source scope.
    // Ingredient counts are source portions/yield units, never guessed pack units.
    const lines=Array.isArray(r.lines)?r.lines:[];requireThat(lines.length<=100,'The assigned recipe needs manager review.',503);
    for(const line of lines){
     const kind=line.sourceType==='item'?'fooditem':'foodrecipe',key=line.sourceType==='item'?line.controlNumber:line.recipeId;
     const row=await db.prepare('SELECT data FROM food_records WHERE location_id=? AND dataset=? AND source_restaurant_id=? AND kind=? AND source_key=?').bind(loc,ds,source.source_restaurant_id,kind,key).first<{data:string}>();
     const ingredient=row?JSON.parse(row.data) as FoodItem|FoodRecipe:null;
     const portion=line.sourceType==='item'&&ingredient?ingredient as FoodItem:null;
     const sub=line.sourceType==='prep'&&ingredient?ingredient as FoodRecipe:null;
     ingredients.push({name:ingredient?.title??'Ingredient not mapped',quantity:line.qty,unit:line.sourceType==='item'?'portion(s)':sub?.yieldUOM||'yield unit(s)',portionGuidance:portion&&portion.portionSize!==null&&portion.portionSize!==undefined&&portion.portionUOM?`Each portion: ${portion.portionSize} ${portion.portionUOM}`:'',notice:!ingredient?'Ask your manager to review this ingredient mapping.':line.sourceType==='item'&&(!portion?.portionSize||!portion.portionUOM)?'Portion measure is not supplied; ask your manager.':line.sourceType==='prep'&&!sub?.yieldUOM?'Yield unit is not supplied; ask your manager.':''});
    }
    recipe={title:r.title,procedure:r.procedure,equipment:r.equipment,portionNote:r.portionNote,yieldQty:r.yieldQty,yieldUOM:r.yieldUOM,shelfLife:r.shelfLife??'',ingredients};recipeNotice='';
   }
   else if(source&&source.revision!==item.foodRevision)recipeNotice='The recipe or item changed after this list was prepared. Ask your manager to review it.';
   items.push({...item,recipe,recipeNotice});
  }
  const check=await workspace(db,identity,loc);
  const after=await db.prepare('SELECT revision FROM food_state WHERE location_id=?').bind(loc).first<{revision:number}>();
  requireThat((after?.revision??0)===(before?.revision??0),'Prep assignments or recipes changed. Refresh.',409);
  requireThat(check.membershipRevision===ctx.membershipRevision&&check.value.location.revision===ctx.value.location.revision,'Access or assignments changed. Refresh.',409);
  return json({locationId:loc,dataset:ds,items});
 }catch(e){return json({error:e instanceof AppError?e.message:'Assigned prep could not be loaded.'},e instanceof AppError?e.status:503);}
}
