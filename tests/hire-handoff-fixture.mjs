// Opt-in fictional browser fixture only; never imported by app code or migrations.
export async function seedHireHandoffFixture(db){
 await db.prepare("UPDATE memberships SET capabilities='[\"tasks.manage\",\"schedule.manage\",\"schedule.publish\"]',revision=revision+1 WHERE id='demo-rudds-boh'").run();
 await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications,active,employment) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('demo-rudds-hire','fictionalhire@example.test','rudds','DEMO new cook','BOH','Line Cook','[]','["Line Cook"]',1,JSON.stringify({status:'active',hireDate:'2026-09-29',endedDate:null,departureReason:null,archivedAt:null})).run();
 await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind('demo-hire-first-shift','rudds','shift','demo-rudds-hire','BOH',1,JSON.stringify({start:'2026-09-30T15:00:00Z',end:'2026-09-30T21:00:00Z',position:'Line Cook',published:true}),'2026-09-29T10:00:00Z').run();
}
