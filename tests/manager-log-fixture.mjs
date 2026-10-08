// Test infrastructure only. Never imported by the application or a migration.
import fs from 'node:fs';
export const sharedFixture=JSON.parse(fs.readFileSync(new URL('./jmax-manager-log-seven-day-demo.json',import.meta.url),'utf8'));
export const fixtureSource='https://drive.google.com/file/d/1aTxX3OarZvYG-ctmHAhVy-fbTgsnA9C2/view';
export const storeNames={rudds:"Rudd's",berts:"Bert's",papa:"Papa's",comm:'Commissary'};
export const fixtureMember=(store,department)=>`demo-${store}-${department.toLowerCase()}`;
export function fixtureRecords(){
 if(sharedFixture.fixture_type!=='JMAX_MANAGER_LOG_DEMO_ONLY'||sharedFixture.schema_version!=='demo-1')throw Error('Unrecognized demo fixture');
 const issues=sharedFixture.issues.map(issue=>{
  const origin=sharedFixture.shift_entries.find(e=>e.id===issue.origin_entry_id);
  const ownerId=fixtureMember(issue.store_id,origin.department);
  // The source has business dates, not event times. End-of-business-date
  // timestamps are test adapter values, not evidence of actual activity times.
  const history=issue.history.map(h=>({action:h.action,actorId:ownerId,at:`${h.business_date}T23:00:00-04:00`,note:h.outcome??'DEMO role assignment; date-only source history.'}));
  return {id:issue.id,kind:'managerlog',locationId:issue.store_id,area:origin.department,ownerId,revision:1,updatedAt:history.at(-1).at,data:{title:issue.summary,detail:'Fabricated shared fixture. Assigned role: '+issue.assigned_role+'. No real manager, deadline, or notification.',category:issue.category,priority:'routine',due:issue.due_at,status:issue.current_status,acceptedBy:'',resolution:issue.history.at(-1).outcome??'',history}};
 });
 const entries=sharedFixture.shift_entries.map(e=>{
  const ownerId=fixtureMember(e.store_id,e.department);
  return {id:e.id,kind:'shiftentry',locationId:e.store_id,area:e.department,ownerId,revision:1,updatedAt:e.submitted_at,data:{title:`${e.department} ${e.shift} · ${e.business_date}`,businessDate:e.business_date,department:e.department,shift:e.shift==='close'?'closing':'production',status:e.record_state,readiness:e.readiness.replaceAll('_','-'),summary:e.shift_summary,tomorrowNote:e.tomorrow_note,issueIds:[...new Set([...e.opening_carried_issue_ids,...e.new_issue_ids,...e.resolved_issue_ids])],submittedAt:e.submitted_at,history:[{action:'submitted',actorId:ownerId,at:e.submitted_at,note:'Fabricated shared fixture; not a live submission.'}],versions:[]}};
 });
 return [...entries,...issues];
}
export async function seedManagerFixture(db){
 for(const [store,name] of Object.entries(storeNames)){
  await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(store,`DEMO ONLY · ${name}`,'America/New_York').run();
  const departments=[...new Set(sharedFixture.shift_entries.filter(e=>e.store_id===store).map(e=>e.department))];
  for(const [id,email,area,caps] of [
   [`demo-owner-${store}`,'admin@example.test','Executive',['location.manage']],
   [`demo-other-owner-${store}`,'otherowner@example.test','Executive',['location.manage']],
   ...departments.map(d=>[fixtureMember(store,d),`${d.toLowerCase()}@example.test`,d,['tasks.manage']]),
   [`demo-worker-${store}`,'worker@example.test',departments[0],[]]
  ])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,email,store,`DEMO ${area} ${caps.length?'manager':'employee'}`,area,'Manager',JSON.stringify(caps),'[]').run();
 }
 for(const r of fixtureRecords())await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt).run();
}
