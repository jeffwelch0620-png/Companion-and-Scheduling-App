// Isolated demo data only. Never imported by the application or a migration.
import { handleWorkspace } from '../.sites-runtime/shared/service.mjs';
import { localDate, localInstant, nextDate } from '../.sites-runtime/shared/local-time.mjs';
export async function seedAttendanceReviewFixture(db){
 const today=localDate(new Date().toISOString(),'America/New_York');
 await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind('demo-attendance-worker','attendance-demo@example.test','rudds','DEMO ONLY Alex','BOH','Fry','[]','["Fry"]').run();
 for(const [i,days,type] of [[1,-2,'call-in'],[2,-1,'late']]){
  const day=nextDate(today,days),start=localInstant(day,'16:00','America/New_York'),end=localInstant(day,'21:00','America/New_York');
  const data={personId:'demo-attendance-worker',start,end,position:'Fry',published:true,cancelled:false};
  await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind('demo-attendance-shift-'+i,'rudds','shift','demo-attendance-worker','BOH',1,JSON.stringify(data),start).run();
  const body={requestId:'demo-attendance-entry-'+i,locationId:'rudds',action:'attendance.record',input:{shiftId:'demo-attendance-shift-'+i,shiftRevision:1,type,reportedAt:localInstant(day,i===1?'14:30':'16:10','America/New_York'),note:'Fictional software review only. No real employee event.',facts:{contact:'phone',coverage:i===1?'uncovered':'unknown',emergency:i===1?'reported':'unknown'}}};
  const response=await handleWorkspace(new Request('https://demo.example/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://demo.example','oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test'},body:JSON.stringify(body)}),db);
  if(!response.ok)throw Error('Unable to seed fictional attendance: '+await response.text());
 }
}
