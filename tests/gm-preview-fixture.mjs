// Optional loopback QA identity. Never deployed or imported by application code.
export async function seedGmPreview(db){
 await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind('demo-gm-berts','gm@example.test','berts','DEMO General manager','Executive','General manager',JSON.stringify(['tasks.manage','operations.store']),'[]').run();
 console.log('GM QA: separate fictional restaurant operations identity. No owner, access-administration or purchasing grants.');
}
