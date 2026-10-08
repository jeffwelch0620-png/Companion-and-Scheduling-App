import type {Workspace} from './types';
import type {PrepPlan,FoodDataset} from './food-workflow-model';
import {requireThat} from './validation';

// Projection of the existing plan: no duplicate task or inventory mutation.
export function employeePrep(w:Workspace,plans:PrepPlan[],dataset:FoodDataset){
 requireThat(!w.me.scheduleOnly,'Schedule-only access does not include prep.',403);
 return plans.filter(p=>p.locationId===w.location.id&&p.dataset===dataset&&p.kind==='plan'&&p.status==='released')
  .flatMap(p=>p.lines.filter(l=>l.assignedTo===w.me.id&&!l.completedAt&&(l.plannedQty??0)>0)
   .map(l=>({planId:p.id,planRevision:p.revision,definitionId:l.definitionId,foodRecordId:l.foodRecordId,foodRevision:l.foodRevision,title:l.title,quantity:l.plannedQty!,unit:l.countUnit,quantityMode:l.quantityMode??'continuous',targetDate:p.targetDate,track:p.track})))
  .sort((a,b)=>a.targetDate.localeCompare(b.targetDate)||a.title.localeCompare(b.title));
}
export type EmployeePrepIngredient={name:string;quantity:number;unit:string;portionGuidance:string;notice:string};
export type EmployeePrepItem=ReturnType<typeof employeePrep>[number]&{recipe:null|{title:string;procedure:string;equipment:string;portionNote:string;yieldQty:number|null;yieldUOM:string;shelfLife:string;ingredients:EmployeePrepIngredient[]};recipeNotice:string};
