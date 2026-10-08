// Fictional demonstration only; never imported into operating data or migrations.
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
export async function seedShiftCheckinFixture(db){
 for(let i=1;i<=6;i++){
  const start=`2026-09-${10+i}T16:00:00Z`,end=`2026-09-${10+i}T22:00:00Z`,id='demo-checkin-shift-'+i;
  const data={personId:'demo-worker-berts',start,end,position:'Fictional practice shift',published:true,cancelled:false};
  await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(id,'berts','shift','demo-worker-berts','FOH',JSON.stringify(data),start).run();
  if(i>4)continue;
  const response=await handleWorkspace(new Request('https://demo.example/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://demo.example','oai-authenticated-user-id':'worker-fixture','oai-authenticated-user-email':'worker@example.test'},body:JSON.stringify({requestId:'demo-checkin-'+i,locationId:'berts',action:'shiftcheckin.submit',input:{shiftId:id,shiftRevision:1,experience:i<=3?'rough':'good',note:'Fictional check-in for software demonstration only.',shareConfirmed:true}})}),db);
  if(!response.ok)throw Error('Cannot seed fictional check-in: '+await response.text());
 }
}
