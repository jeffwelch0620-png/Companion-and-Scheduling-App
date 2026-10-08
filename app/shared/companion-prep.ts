import {employeePrep} from './employee-prep';
import type {PrepPlan} from './food-workflow-model';
import type {Workspace} from './types';
import type {ChatSource} from './companion-chat-types';
import {requireThat} from './validation';

type Database=Pick<D1Database,'prepare'>;
export const prepSourceId=(w:Workspace)=>`food-prep:${w.location.id}:${w.me.id}`;
export function prepQuestion(question:string){return /\b(prep|preparation|portions?|ingredients?|dressing|ranch|bulk|cook|cooking)\b|\b(?:my work|what.*(?:today|assigned))\b/i.test(question);}
export async function prepRevision(db:Database,locationId:string){
 return (await db.prepare('SELECT revision FROM food_state WHERE location_id=?').bind(locationId).first<{revision:number}>())?.revision??0;
}
export function prepContext(w:Workspace,plans:PrepPlan[],revision:number){
 const all=employeePrep(w,plans,'operating'),items=all.slice(0,20);
 const source:ChatSource={id:prepSourceId(w),revision,title:'Your assigned prep',kind:'food-prep'};
 return {source,facts:{authority:'saved released assignments, not an approved operating method',items,omittedItems:all.length-items.length,workflow:{open:'Open Your assigned prep in My day or on your role home.',instructions:'Read the current recipe shown with the assignment. If unavailable or changed, ask the manager for current instructions.',completion:'Record the actual quantity and any shortage in that assignment. Chat does not complete prep or change inventory.'}}};
}
export async function readPrepContext(db:Database,w:Workspace){
 requireThat(!w.me.scheduleOnly,'Schedule-only access does not include prep.',403);
 const before=await prepRevision(db,w.location.id);
 const rows=await db.prepare("SELECT data FROM food_workflows WHERE location_id=? AND dataset='operating' AND kind='plan' AND status='released' AND EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.lines')) WHERE json_extract(value,'$.assignedTo')=?) ORDER BY updated_at DESC LIMIT 101").bind(w.location.id,w.me.id).all<{data:string}>();
 requireThat(rows.results.length<=100,'Too many active prep lists; ask your manager to review them.',503);
 const result=prepContext(w,rows.results.map(row=>JSON.parse(row.data) as PrepPlan),before);
 requireThat(await prepRevision(db,w.location.id)===before,'Prep changed while JMAX was reading it. Ask again with the latest assignments.',409);
 return result;
}
