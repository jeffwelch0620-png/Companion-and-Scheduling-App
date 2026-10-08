import type {FoodRecipe} from './food-model';
import type {FoodDataset,PrepDefinition} from './food-workflow-model';

// This input is supplied by an authenticated server integration, never a browser
// payload. Jeff recommends target PARs; these are not quantities already made.
export type AdvisorRecommendation={id:string;restaurantId:string;recipeId:string;recipeName:string;currentPar:number;recommendedPar:number;reasoning:string;status:string;createdAt:string;unit:string;shelfLife:string;shelfLifeDays:number|null;shelfLifeSource:'recipe';sourceCurrent:boolean};
export type AdvisorPortionMapping={prepItemId:string;recipeId:string;countUnit:string;recipeUnit:string;recipeUnitsPerCountUnit:number;reviewedBy:string;reviewedAt:string;reviewNote:string};
export type AdvisorSnapshot={restaurantId:string;revision:string;generatedAt:string;sparse:boolean;recommendations:AdvisorRecommendation[];portionMappings?:AdvisorPortionMapping[]};
export type AdvisorScope={locationId:string;dataset:FoodDataset;sourceRestaurantId:string;foodRevision:number};
export type AdvisorRecipe={id:string;revision:number;locationId:string;dataset:FoodDataset;recipe:FoodRecipe};
export type AdvisorRow={id:string;title:string;currentPar:number|null;recommendedPar:number|null;unit:string;shelfLife:string;reasoning:string;status:'ready'|'needs-review';reasons:string[];definitionId?:string;definitionRevision?:number;foodRecordId?:string;foodRecordRevision?:number};
export type AdvisorReview={status:'unavailable'|'needs-review'|'ready';locationId:string;dataset:FoodDataset;foodRevision:number;sourceRevision?:string;generatedAt?:string;message?:string;rows:AdvisorRow[]};
export function explicitShelfLifeDays(text:string):number|null{
 const match=/^\s*(\d+(?:\.\d+)?)\s*(days?|hours?)\s*$/i.exec(text);
 if(!match)return null;const n=Number(match[1]);return Number.isFinite(n)&&n>0?(match[2].toLowerCase().startsWith('hour')?n/24:n):null;
}
const quantity=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000;
export function projectFoodAdvisor(scope:AdvisorScope,snapshot:AdvisorSnapshot,recipes:AdvisorRecipe[],definitions:PrepDefinition[]):AdvisorReview{
 const review:AdvisorReview={status:'needs-review',locationId:scope.locationId,dataset:scope.dataset,foodRevision:scope.foodRevision,sourceRevision:snapshot.revision,generatedAt:snapshot.generatedAt,rows:[]};
 if(snapshot.restaurantId!==scope.sourceRestaurantId||!snapshot.revision||!Number.isFinite(Date.parse(snapshot.generatedAt))){review.message='The recommendation source scope or revision needs review.';return review;}
 const duplicateIds=new Set(snapshot.recommendations.filter((r,i,all)=>all.findIndex(x=>x.id===r.id)!==i).map(r=>r.id));
 review.rows=snapshot.recommendations.map(r=>{
  const reasons:string[]=[],row:AdvisorRow={id:r.id,title:r.recipeName,currentPar:null,recommendedPar:null,unit:r.unit,shelfLife:r.shelfLife,reasoning:r.reasoning,status:'needs-review',reasons};
  if(r.restaurantId!==scope.sourceRestaurantId)reasons.push('This recommendation belongs to a different restaurant.');
  if(!r.id||duplicateIds.has(r.id))reasons.push('The recommendation identifier is missing or duplicated.');
  if(r.status!=='pending')reasons.push('This recommendation is no longer pending.');
  if(r.sourceCurrent!==true)reasons.push('The recommendation predates current source recipe or mapping data.');
  if(snapshot.sparse)reasons.push('The source has insufficient history for a reviewed recommendation.');
  if(!quantity(r.recommendedPar)||!quantity(r.currentPar))reasons.push('The source target quantities need review.');
  const canonical=recipes.filter(x=>x.locationId===scope.locationId&&x.dataset===scope.dataset&&x.recipe.source.sourceRestaurantId===scope.sourceRestaurantId&&x.recipe.source.dataset===scope.dataset&&x.recipe.sourceId===r.recipeId&&x.recipe.recipeType==='prep');
  if(canonical.length!==1){reasons.push('A unique canonical prep recipe has not been mapped.');return row;}
  const recipe=canonical[0];row.title=recipe.recipe.title;row.shelfLife=recipe.recipe.shelfLife;
  const shelfDays=explicitShelfLifeDays(recipe.recipe.shelfLife);
  if(shelfDays===null||r.shelfLifeSource!=='recipe'||r.shelfLifeDays!==shelfDays||r.shelfLife.trim()!==recipe.recipe.shelfLife.trim())reasons.push('Canonical recipe shelf life is missing, unsupported or changed.');
  if(!r.unit||r.unit!==recipe.recipe.yieldUOM)reasons.push('The source recipe unit is missing or changed.');
  const defs=definitions.filter(d=>d.locationId===scope.locationId&&d.dataset===scope.dataset&&d.status==='active'&&d.foodKind==='foodrecipe'&&d.foodRecordId===recipe.id&&d.foodRevision===recipe.revision);
  const mappings=snapshot.portionMappings??[];
  const candidates=defs.flatMap(d=>{
   const explicit=mappings.filter(m=>m.recipeId===r.recipeId&&m.countUnit===d.countUnit&&m.recipeUnit===r.unit&&m.prepItemId&&m.reviewedBy&&Number.isFinite(Date.parse(m.reviewedAt))&&m.reviewNote.trim()&&Number.isFinite(m.recipeUnitsPerCountUnit)&&m.recipeUnitsPerCountUnit>0);
   // "cup" in Food recipes is 8 fl oz. A stored 3.25 oz cup is a
   // container capacity, so equal labels alone cannot establish a conversion.
   if(explicit.length===1)return [{d,factor:explicit[0].recipeUnitsPerCountUnit}];
   if(!explicit.length&&d.countUnit===r.unit&&!/\bcups?\b/i.test(r.unit))return [{d,factor:1}];
   return [];
  });
  if(candidates.length!==1){reasons.push('A unique reviewed prep definition and count-unit mapping is required.');return row;}
  const {d,factor}=candidates[0];row.unit=d.countUnit;row.currentPar=d.par;row.definitionId=d.id;row.definitionRevision=d.revision;row.foodRecordId=recipe.id;row.foodRecordRevision=recipe.revision;
  const target=r.recommendedPar/factor;
  if(!quantity(target))reasons.push('The mapped target quantity needs review.');else{row.recommendedPar=target;if(d.quantityMode==='whole-portions'&&!Number.isInteger(target))reasons.push('The mapped target is fractional, but this definition prepares whole portion units. Review a whole-unit target before applying.');}
  if(!reasons.length)row.status='ready';
  return row;
 });
 if(review.rows.length&&review.rows.every(r=>r.status==='ready'))review.status='ready';
 if(!review.rows.length)review.message='No pending recommendations are available from the source.';
 return review;
}
