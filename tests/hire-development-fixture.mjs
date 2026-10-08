// Fictional local read/review fixtures only. No operating data or app imports.
export async function seedHireDevelopmentFixture(db){
 await db.prepare("UPDATE memberships SET capabilities='[\"location.manage\",\"people.approve\"]',revision=revision+1 WHERE id='demo-owner-rudds'").run();
 await db.prepare("UPDATE memberships SET capabilities='[\"tasks.manage\",\"people.manage\"]',revision=revision+1 WHERE id='demo-rudds-boh'").run();
 await db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications,active,employment) VALUES('demo-review-hire','reviewhire@example.test','rudds','DEMO review hire','BOH','Line Cook','[]','[]',1,?)").bind(JSON.stringify({hireDate:'2026-09-01',status:'active'})).run();
 const base={title:'Development review',managerId:'demo-rudds-boh',approverId:'demo-owner-rudds',hireDate:'2026-09-01',originalDueDate:'2026-09-28',selfShared:true,managerShared:true,submissions:[],selfSummary:'Fictional private assessment',managerSummary:'Fictional private assessment',managerDiscussion:'Fictional private discussion',employeeDiscussion:'Fictional private confirmation',approvalNote:'Fictional private decision',stations:[{name:'Fictional station',definition:'Fictional criteria',source:'Fictional source',standardId:'demo-review-missing-guide',standardRevision:1,selfScore:5,selfNote:'Fictional private note',managerScore:5,managerNote:'Fictional private note'},{name:'Manual source',definition:'Fictional manual criteria',source:'Fictional manual reference',selfScore:5,selfNote:'Fictional private note',managerScore:5,managerNote:'Fictional private note'}]};
 for(const [id,phase,archived,action] of [['demo-review-pending','gm-review',null,'gm-returned'],['demo-review-filed','approved','2026-09-29T20:00:00Z','gm-approved']]){
  await db.prepare("INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at) VALUES(?,'rudds','development','demo-review-hire','BOH',1,?,?,?)").bind(id,JSON.stringify({...base,phase,history:[{actorId:'demo-owner-rudds',action,at:'2026-09-29T14:00:00Z',note:'Fictional private decision evidence'}]}),'2026-09-29T20:00:00Z',archived).run();
 }
}

