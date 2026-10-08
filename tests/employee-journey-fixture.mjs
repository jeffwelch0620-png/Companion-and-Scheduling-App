// Optional loopback QA fixture only. Not an operating par or a production record.
import {localDate,nextDate} from '../.sites-runtime/shared/local-time.mjs';
export async function seedEmployeeJourney(db){
 const at=new Date().toISOString(),day=nextDate(localDate(at,'America/New_York'),1);
 const title='DEMO ONLY · Portion dressing cups';
 const recipe={title,procedure:'Practice case only. Portion fictional ready-made dressing into sample cups. The 75-cup quantity is invented for interface verification, not an approved restaurant par.',equipment:'Sample cups and lids',portionNote:'3.25-ounce cups',yieldQty:75,yieldUOM:'cups',shelfLife:'',lines:[]};
 await db.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind('journey-recipe','berts','foodrecipe','operating','berts','journey-recipe',title,'demo-owner-berts','BOH',1,JSON.stringify(recipe),at).run();
 const line={definitionId:'journey-line',foodRecordId:'journey-recipe',foodRevision:1,title,countUnit:'cups',par:75,quantity:0,plannedQty:75,completedQty:null,completedAt:null,completedBy:null,completionNote:'',assignedTo:'demo-worker-berts'};
 const plan={id:'journey-plan',locationId:'berts',dataset:'operating',revision:1,kind:'plan',status:'released',targetDate:day,track:'daily',countId:'journey-count',countRevision:1,lines:[line],blockers:[],createdBy:'demo-owner-berts',createdAt:at,updatedAt:at,releasedBy:'demo-owner-berts',releasedAt:at};
 await db.prepare('INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(plan.id,'berts','operating','plan','journey:'+day,1,'released',JSON.stringify(plan),at).run();
 console.log('EMPLOYEE JOURNEY QA: fictional assigned 75-cup prep case. Not an approved par; no stock change or external connection.');
}
