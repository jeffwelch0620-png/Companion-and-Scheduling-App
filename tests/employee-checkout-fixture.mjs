// Opt-in disposable preview only. Never imported by application code.
export function employeeCheckoutRecords(at=new Date().toISOString()){
 const end=new Date(Date.parse(at)-30*60000).toISOString(),start=new Date(Date.parse(end)-6*3600000).toISOString();
 const employeeId='demo-worker-rudds',managerId='demo-rudds-foh',locationId='rudds';
 const record=(id,kind,ownerId,data)=>({id,kind,ownerId,locationId,area:'FOH',revision:1,updatedAt:at,data});
 const standard=record('journey-server-guide','standard',managerId,{title:'DEMO ONLY · Server side work',zone:'Server section',position:'Server',criteria:['Bag silverware and complete the assigned section cleanup.'],source:'Fictional software checkout case using the 2026-10-07 owner-confirmed shared Server duties. Not a live restaurant approval.',version:1,status:'approved',validationNote:'Approved state is simulated for this disposable software test only.',verification:'manager',history:[],guide:{purpose:'Practice the employee-to-manager checkout flow using fictional saved work.',preparation:['Finish existing guest responsibilities after the manager stops new seating.'],steps:['Bag silverware and finish your assigned section cleanup.','Report the saved conditions ready for the manager’s physical check.','Wait for the manager, FOH manager or shift lead to check side work and settle the server bank before release.'],troubleshooting:['Report unfinished work to the manager rather than marking it complete.'],escalation:'Server banking is the manager’s responsibility at checkout. This practice case records no money or payroll changes.'}});
 const shift=record('journey-server-shift','shift',employeeId,{personId:employeeId,position:'Server',start,end,published:true,cancelled:false,history:[]});
 const close=record('journey-server-close','close',employeeId,{shiftId:shift.id,standardId:standard.id,standardRevision:1,standard:standard.data,managerId,due:end,phase:'open',history:[]});
 const leadership=record('journey-server-leader','leadership',managerId,{personId:managerId,area:'FOH',start,end,active:true,note:'Fictional assigned closing manager for this isolated checkout test.'});
 return {at,employeeId,managerId,standard,shift,close,leadership,records:[standard,shift,close,leadership]};
}
export async function seedEmployeeCheckout(db){
 const f=employeeCheckoutRecords();
 await db.batch([
  db.prepare("UPDATE memberships SET name='DEMO frontline server',area='FOH',position='Server',qualifications=? WHERE id=? AND location_id='rudds'").bind(JSON.stringify(['Server']),f.employeeId),
  db.prepare("UPDATE memberships SET capabilities=? WHERE id=? AND location_id='rudds'").bind(JSON.stringify(['tasks.manage','close.confirm','people.manage']),f.managerId),
  ...f.records.map(r=>db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt))
 ]);
 console.log('EMPLOYEE CHECKOUT QA: Rudd’s fictional Server side work → manager physical check → separate checkout. No money, payroll or external system changes.');
 return f;
}
