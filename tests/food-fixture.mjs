// Original fabricated sample from Jeff's pinned source. Never imported by app code.
import fs from 'node:fs';
import {parseFoodItem,parseFoodRecipe} from '../.sites-runtime/shared/food.mjs';
export const jeffDemo=JSON.parse(fs.readFileSync(new URL('./jeff-food-demo.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
export async function seedFoodFixture(db){
 const store='berts',ownerId='demo-owner-berts',at='2026-09-28T12:00:00Z';
 const source={dataset:'demo',sourceRestaurantId:'demo_diner',label:'Jeff source sample · '+jeffDemo.sourceCommit,importedAt:at,importedBy:ownerId};
 for(const [kind,rows,parse] of [['fooditem',jeffDemo.items,parseFoodItem],['foodrecipe',jeffDemo.dishes,parseFoodRecipe]]){
  for(const row of rows){const data=parse(row,source);data.history=[{actorId:ownerId,action:'demo-fixture',note:'Fabricated source sample in ephemeral local test storage.',at}];const id='demo-food-'+(data.controlNumber??data.sourceId);
   await db.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,storage_area,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,store,kind,source.dataset,source.sourceRestaurantId,data.controlNumber??data.sourceId,data.title,data.storageArea??'',ownerId,'BOH',1,JSON.stringify({...data,history:[]}),at).run();
   await db.prepare('INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) VALUES(?,?,?,?,?,?)').bind(store,id,1,ownerId,at,JSON.stringify({action:'demo-fixture',history:data.history})).run();
  }
 }
 await db.prepare('INSERT INTO food_state(location_id) VALUES(?)').bind(store).run();
 await db.prepare('INSERT INTO food_sources(location_id,dataset,source_restaurant_id) VALUES(?,?,?)').bind(store,source.dataset,source.sourceRestaurantId).run();
 // Fictional, test-only route. App migrations deliberately configure no operating routes.
 await db.prepare("INSERT INTO food_transfer_routes(source_id,destination_id,dataset,active) VALUES('berts','rudds','demo',1)").run();
}
