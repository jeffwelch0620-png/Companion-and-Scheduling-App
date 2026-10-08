import type {PrepPlan,FoodDataset} from './food-workflow-model';
export function prepProgress(plans:PrepPlan[],locationId:string,dataset:FoodDataset){
 const active=plans.filter(p=>p.locationId===locationId&&p.dataset===dataset&&p.status!=='draft');
 return active.map(p=>{
  const needed=p.lines.filter(l=>(l.plannedQty??0)>0);
  return {id:p.id,date:p.targetDate,track:p.track,status:p.status,total:needed.length,
   remaining:needed.filter(l=>!l.completedAt).length,
   unassigned:needed.filter(l=>!l.completedAt&&!l.assignedTo).length,
   shortages:needed.filter(l=>l.completedAt&&l.completedQty!==null&&l.completedQty<(l.plannedQty??0)).map(l=>({title:l.title,planned:l.plannedQty!,actual:l.completedQty!,unit:l.countUnit,note:l.completionNote})),
  };
 }).filter(p=>p.remaining>0||p.shortages.length>0).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
