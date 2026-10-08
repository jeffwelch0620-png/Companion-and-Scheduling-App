// Optional local browser fixture only: isolated, plainly fictional observations.
export async function seedWasteItemsFixture(db){
 const rows=await db.prepare("SELECT id,data FROM food_records WHERE location_id='berts' AND dataset='demo' AND kind='fooditem'").all();
 const beef=rows.results.find(r=>JSON.parse(r.data).controlNumber==='WI-001'),flour=rows.results.find(r=>JSON.parse(r.data).controlNumber==='PR-001');if(!beef||!flour)throw Error('Fictional food seed missing');
 const observations=[];
 const add=(record,quantity,pack,cost,title,revision)=>{const item=JSON.parse(record.data);observations.push({record,revision,event:{waste:{quantity,reason:'spoilage',note:'Fictional grouped waste preview only',pack,at:'2026-09-29T12:00:00Z',by:'demo-owner-berts',item:{title,controlNumber:item.controlNumber,storageArea:item.storageArea},cost:{estimatedCents:cost,currency:'USD',basis:'catalog-at-entry',sku:null,issues:cost===null?['Fictional missing supplier cost']:[]}}}})};
 for(let n=0;n<25;n++)add(beef,0.1,{purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb'},925,'Demo Ground Beef 80/20',n+100);
 add(beef,0.5,{purchaseUnit:'case',packCount:4,unitQty:5,unitUOM:'lb'},2313,'Demo Ground Beef 80/20',125);
 add(flour,0.25,{purchaseUnit:'bag',packCount:1,unitQty:50,unitUOM:'lb'},null,'Demo AP Flour',100);
 observations.push({record:beef,revision:126,event:{wasteVoid:{wasteRevision:100,at:'2026-09-30T00:00:00Z',by:'demo-owner-berts',reason:'Fictional duplicate observation'}}});
 await db.batch(observations.map(({record,revision,event})=>db.prepare('INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) VALUES(?,?,?,?,?,?)').bind('berts',record.id,revision,'demo-owner-berts',event.waste?.at??'2026-09-30T00:00:00Z',JSON.stringify(event))));
 await db.prepare("INSERT INTO food_state(location_id,revision) VALUES('berts',1) ON CONFLICT(location_id) DO UPDATE SET revision=revision+1").run();
}
