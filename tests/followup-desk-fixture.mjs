// Fictional isolated test data; never loaded by the application or a migration.
export const testNow='2026-09-30T05:00:00Z';
export function followupWorkspace(locationId='a'){
 const member=(id,area,caps)=>({id,name:'DEMO '+id,locationId,area,position:'Manager',capabilities:caps,qualifications:[]});
 const owner=member('owner','Executive',['location.manage','schedule.manage']),manager=member('manager','BOH',['tasks.manage','people.manage','schedule.manage']),foh=member('foh','FOH',['tasks.manage','people.manage','schedule.manage']),worker=member('worker','BOH',[]);
 const record=(kind,data)=>({id:kind,kind,locationId,area:'BOH',ownerId:'worker',revision:1,updatedAt:testNow,data:{title:'DEMO '+kind,history:[],...data}});
 const records=[
  record('staffidea',{idea:'PRIVATE idea body',benefit:'PRIVATE benefit',employeeName:worker.name,submittedAt:testNow,status:'reviewing',managerId:manager.id,dueDate:'2026-09-30',responses:[]}),
  record('guestreview',{channel:'In person',reference:'TEST-REV-1',sourceDate:'2026-09-28',sourceUrl:'',evidence:'PRIVATE guest source',feedback:'PRIVATE guest details',rating:null,managerId:manager.id,managerName:manager.name,dueDate:'2026-09-29',ownerNote:'PRIVATE owner note',status:'awaiting-ack',acknowledgment:null,outcome:null,closure:null,versions:[]}),
  record('hirechecklist',{employeeName:worker.name,position:'Manager',hireDate:'2026-09-29',sourceReference:'PRIVATE checklist source',items:[{id:'item1',label:'DEMO source requirement',dueDate:'2026-09-30',check:null}],status:'open',review:null,versions:[]}),
  record('hirehandoff',{employeeName:worker.name,position:'Manager',hireDate:'2026-09-29',schedulerId:manager.id,schedulerName:manager.name,targetDate:'2026-10-01',handoffNote:'PRIVATE hire note',status:'awaiting-ack',acknowledgment:null,confirmation:null,versions:[]}),
  record('compliance',{type:'permit',authority:'DEMO authority',reference:'TEST-PERMIT-1',documentDate:'2026-09-28',dueDate:null,evidence:'PRIVATE document source',sourceUrl:'',summary:'PRIVATE permit details',responsibleId:owner.id,responsibleName:owner.name,status:'needs-review',review:null,resolution:'',versions:[]}),
  record('promotion',{startsOn:'2026-09-29',endsOn:'2026-10-01',offer:'PRIVATE proposed offer',conditions:'PRIVATE conditions',staffBrief:'PRIVATE briefing',audience:['BOH'],managerId:manager.id,managerName:manager.name,status:'review',approval:null,withdrawal:null,acknowledgments:[],internal:{sourceRef:'PRIVATE source',comparisonPlan:'PRIVATE comparison',history:[],versions:[],outcomes:[]}})
 ];
 return {location:{id:locationId,name:'DEMO restaurant '+locationId,timezone:'America/New_York',revision:1},me:owner,members:[owner,manager,foh,worker],records,hireCandidates:[{id:'worker',name:worker.name,area:'BOH',position:'Manager',revision:1,active:true,scheduleOnly:false,hireDate:'2026-09-29',status:'active'}]};
}
export async function seedFollowupDesk(db){
 const w=followupWorkspace('rudds'),ids={owner:'demo-owner-rudds',manager:'demo-rudds-boh',worker:'demo-followup-hire',foh:'demo-rudds-foh'};
 await db.prepare("UPDATE memberships SET capabilities='[\"tasks.manage\",\"people.manage\",\"schedule.manage\"]',revision=revision+1 WHERE id=?").bind(ids.manager).run();
 await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications,employment) VALUES(?,?,?,?,?,?,?,?,?)').bind(ids.worker,'followup-fixture@example.test','rudds','DEMO follow-up hire','BOH','Manager','[]','[]',JSON.stringify({status:'active',hireDate:'2026-09-29'})).run();
 for(let i=0;i<22;i++)w.records.push({...structuredClone(w.records[0]),id:'idea-page-'+String(i).padStart(2,'0'),data:{...structuredClone(w.records[0].data),title:'DEMO extra idea '+String(i).padStart(2,'0'),dueDate:'2026-10-02'}});
 for(const r of w.records){r.id='demo-followup-'+r.id;r.ownerId=ids[r.ownerId];for(const key of ['managerId','schedulerId','responsibleId'])if(r.data[key])r.data[key]=ids[r.data[key]];for(const key of ['managerName','schedulerName'])if(r.data[key])r.data[key]='DEMO BOH manager';r.data.employeeName='DEMO follow-up hire';await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt).run();}
}
