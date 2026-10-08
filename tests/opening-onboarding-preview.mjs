// Opt-in fictional preview only. Uses the same commands as the built application.
export async function seedOpeningOnboardingPreview(dispatch){
 const headers=id=>({'oai-authenticated-user-id':id+'-fixture','oai-authenticated-user-email':id+'@example.test',Origin:'http://localhost','Content-Type':'application/json'});
 const command=async(id,action,input,r)=>{const response=await dispatch('http://localhost/api/workspace',{method:'POST',headers:headers(id),body:JSON.stringify({locationId:'rudds',requestId:crypto.randomUUID(),action,input,...(r?{recordId:r.recordId,expectedRevision:r.revision}:{})})});if(!response.ok)throw Error('Fictional onboarding preview failed: '+await response.text());return response.json();};
 const response=await dispatch('http://localhost/api/workspace?locationId=rudds',{headers:headers('admin')});if(!response.ok)throw Error('Fictional workspace unavailable');const w=await response.json(),person=w.hireCandidates.find(p=>p.id==='demo-rudds-hire');
 let h=await command('admin','hirehandoff.create',{employeeId:person.id,employeeRevision:person.revision,schedulerId:'demo-rudds-boh',targetDate:'2026-09-30',handoffNote:'DEMO only: arrange a first shift for the existing fictional hire.'});
 h=await command('boh','hirehandoff.accept',{note:'DEMO scheduling responsibility accepted.',accepted:true},h);
 await command('boh','hirehandoff.confirm',{note:'DEMO published shift checked.',shiftId:'demo-hire-first-shift',shiftRevision:1,checked:true},h);
 let o=await command('admin','opening.create',{title:'DEMO evening cook',department:'BOH',positions:1,neededOn:'2026-10-15',shiftPlan:'DEMO weekday evenings, with a reviewed first-shift handoff.',reason:'DEMO coverage need for an isolated interface test.',sourceRef:'Fictional local preview only',managerId:'demo-rudds-boh'});
 o=await command('admin','opening.submit',{note:'DEMO staffing facts checked.',checked:true},o);
 await command('admin','opening.approve',{note:'DEMO owner approval for interface testing only.',approved:true},o);
}
