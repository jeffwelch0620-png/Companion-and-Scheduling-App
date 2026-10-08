// Workflow adaptation from Jeff Welch's source handoff, main-source/backend/server.py
// prepcount / preplists / prep-items. Canonical Food IDs and JMAX authentication
// replace the source app's independent catalog and caller-supplied actor names.
import type {Member,RecordOf} from './types';
import type {FoodCount,FoodPack,FoodSku} from './food-model';
import {has} from './types';
import {foodManager} from './food';
import {requireThat} from './validation';

export type FoodDataset='demo'|'operating';
export type PrepTrack='daily'|'bulk';
// Reviewed production semantics, independent of the free-text measuring unit.
// A recipe measured in cups can remain continuous; ready portion cups are whole.
export type PrepQuantityMode='continuous'|'whole-portions';
export type PrepBase={id:string;locationId:string;dataset:FoodDataset;revision:number;createdAt:string;createdBy:string;updatedAt:string};
export type PrepDefinition=PrepBase&{kind:'definition';status:'active'|'retired';track:PrepTrack;foodRecordId:string;foodRevision:number;foodKind:'fooditem'|'foodrecipe';title:string;countUnit:string;quantityMode?:PrepQuantityMode;par:number;reviewNote:string;reviewedBy:string;reviewedAt:string};
export type PrepCountLine={definitionId:string;definitionRevision:number;foodRecordId:string;foodRevision:number;title:string;countUnit:string;quantityMode?:PrepQuantityMode;par:number;quantity:number|null;note:string};
export type PrepCount=PrepBase&{kind:'count';status:'draft'|'submitted';businessDate:string;track:PrepTrack;lines:PrepCountLine[];submittedAt:string|null;submittedBy:string|null};
export type PrepPlanLine=PrepCountLine&{plannedQty:number|null;completedQty:number|null;completedAt:string|null;completedBy:string|null;completionNote:string;assignedTo?:string};
export type PrepPlan=PrepBase&{kind:'plan';status:'draft'|'released'|'completed';targetDate:string;track:PrepTrack;countId:string;countRevision:number;lines:PrepPlanLine[];blockers:string[];releasedAt:string|null;releasedBy:string|null};
export type PrepWorkflow=PrepDefinition|PrepCount|PrepPlan;
export type PrepEvent={revision:number;action:string;at:string;by:string;byName:string;note:string;snapshot:PrepWorkflow};
export type FoodOrderLineSource={itemId:string;itemRevision:number;controlNumber:string;count:FoodCount;countPack:FoodPack;sku:FoodSku;suggestedPacks:number;lineTotalCents:number};
export type FoodOrderSource={dataset:FoodDataset;countDate:string;vendor:string;totalCents:number;preparedByPrincipal:string;capturedAt:string};
export type FoodWorkflowPermissions={managePrep:boolean;purchase:boolean;reviewPurchase:boolean};
export type FoodWorkflowPage={foodRevision:number;definitions:PrepDefinition[];counts:PrepCount[];plans:PrepPlan[];purchases:RecordOf<'order'>[];permissions:FoodWorkflowPermissions;more:{counts:boolean;plans:boolean;purchases:boolean}};
export type FoodWorkflowDetail={record:PrepWorkflow;history:PrepEvent[];next:number|null};
export function foodWorkflowPermissions(me:Member):FoodWorkflowPermissions{
 const food=foodManager(me)&&!me.scheduleOnly;
 return {managePrep:food&&(has(me,'tasks.manage')||has(me,'location.manage')),purchase:food&&has(me,'orders.request'),reviewPurchase:food&&has(me,'orders.review')};
}
export function prepQuantity(value:unknown,name:string,nullable=false):number|null{
 if(nullable&&value===null)return null;
 requireThat(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000,`${name} must be an explicit number from 0 to 1,000,000${nullable?' or null for uncounted':''}.`);
 return value;
}
export function prepQuantityMode(value:unknown):PrepQuantityMode{
 requireThat(value===undefined||value==='continuous'||value==='whole-portions','Choose continuous quantities or whole portion units.');
 return value??'continuous';
}
export function completedPrepQuantity(value:unknown,mode:PrepQuantityMode|undefined):number{
 const quantity=prepQuantity(value,'Completed quantity')!;
 requireThat(mode!=='whole-portions'||Number.isInteger(quantity),'Completed portion units must be a whole number.');
 return quantity;
}
export function planLines(count:PrepCount):PrepPlanLine[]{return count.lines.map(line=>{const deficit=line.quantity===null?null:Math.max(0,line.par-line.quantity);return {...line,plannedQty:deficit===null?null:line.quantityMode==='whole-portions'?Math.ceil(deficit):Math.round(deficit*10000)/10000,completedQty:null,completedAt:null,completedBy:null,completionNote:''};});}
export function missingCountBlockers(lines:PrepCountLine[]):string[]{return lines.filter(l=>l.quantity===null).map(l=>`${l.title}: evening count is missing.`);}
