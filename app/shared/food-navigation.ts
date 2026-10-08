import {has,type Member} from './types';
import {foodManager} from './food';
import {foodWorkflowPermissions} from './food-workflow-model';

export type FoodView='items'|'invoices'|'receiving'|'returns'|'claims'|'transfers'|'waste';
export const foodViews:Record<FoodView,{title:string;description:string}>={
 items:{title:'Food inventory',description:'Count food in its stated purchase unit, review pack definitions and keep the history.'},
 invoices:{title:'Invoice CSV matching',description:'Review saved files or match checked invoice rows to the current restaurant’s supplier packs.'},
 receiving:{title:'Delivery checks',description:'Review invoice quantities, actual delivery checks and extra-goods evidence.'},
 returns:{title:'Supplier returns',description:'Review recorded physical pickups and their issued-credit matches.'},
 claims:{title:'Supplier issues',description:'Review internal follow-up and checked claim evidence. Recording an issue does not contact the supplier.'},
 transfers:{title:'Restaurant transfers',description:'Review recorded transfers, parcel evidence and destination checks for configured routes.'},
 waste:{title:'Waste and estimated costs',description:'Review dated waste entries and their recorded cost evidence.'},
};
const tabs:Record<string,{view:FoodView;recipesOnly?:boolean}>={
 'Food inventory':{view:'items'},'Food recipes':{view:'items',recipesOnly:true},
 'Invoice CSV matching':{view:'invoices'},'Delivery checks':{view:'receiving'},
 'Supplier returns':{view:'returns'},'Supplier issues':{view:'claims'},
 'Restaurant transfers':{view:'transfers'},'Waste report':{view:'waste'},
};
export function foodPurchaser(me:Member){return foodManager(me)&&(has(me,'location.manage')||has(me,'orders.review'));}
// A navigation permission only. Existing scoped API authorization remains authoritative.
export function foodDestination(tab:string,me:Member){const entry=Object.hasOwn(tabs,tab)?tabs[tab]:undefined;return entry&&foodManager(me)&&(entry.view!=='invoices'||foodPurchaser(me))?entry:null;}
export type FoodWorkflowView='prep'|'purchasing';
export function foodWorkflowDestination(tab:string,me:Member):FoodWorkflowView|null{
 const permissions=foodWorkflowPermissions(me);
 if(tab==='Prep production'&&permissions.managePrep)return 'prep';
 if(tab==='Purchasing review'&&(permissions.purchase||permissions.reviewPurchase))return 'purchasing';
 return null;
}
