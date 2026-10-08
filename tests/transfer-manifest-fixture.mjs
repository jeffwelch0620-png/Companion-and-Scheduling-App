import fs from 'node:fs';
export async function seedManifest(db){
 for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,'Fictional '+id,'America/New_York').run();
 for(const [id,loc,area,caps] of [['sender','a','BOH',['tasks.manage']],['receiver','b','BOH',['tasks.manage']],['outsider','c','BOH',['location.manage']],['worker','a','BOH',[]],['foh','a','FOH',['tasks.manage']]])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,'Manager',?,'[]',1)").bind(id,id+'@example.test',id+'-identity',loc,'Fictional '+id,area,JSON.stringify(caps)).run();
 await db.prepare("INSERT INTO food_state(location_id,revision) VALUES('a',7),('b',8),('c',1)").run();
}
export const manifestHeaders=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
export const parcel=(id,overrides={})=>({id,tripReference:'Trip 1',parcelReference:id,quantity:2,departedAt:'2026-09-28T12:00:00Z',note:'Private transport note excluded',recorded:{by:'sender',byName:'Fictional sender',at:'2026-09-28T12:00:00Z'},...overrides});
export async function addManifestTransfer(db,id,overrides={}){
 const d={id,sourceId:'a',destinationId:'b',sourceName:'Fictional a',destinationName:'Fictional b',dataset:'demo',revision:2,status:'sent',dispatch:{reference:id,quantity:10,dispatchedAt:'2026-09-28T00:00:00Z',note:'Private dispatch note excluded',by:'sender',byName:'Fictional sender',recordedAt:'2026-09-28T00:00:00Z',item:{id:'item-'+id,revision:1,title:'Fictional flour',controlNumber:'FLOUR',pack:{purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb'}}},receipt:null,parcels:[parcel('p-'+id)],...overrides};
 await db.prepare('INSERT INTO food_transfers(id,source_id,destination_id,dataset,reference_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,d.sourceId,d.destinationId,d.dataset,id,d.revision,d.status,JSON.stringify(d),'2026-09-28T12:00:00Z').run();return d;
}
