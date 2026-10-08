// Fictional preview fixture only; no operating records or supplier calls.
export async function seedMaintenanceCostFixture(dispatch){
 const call=async(action,input,r)=>{const res=await dispatch('http://localhost/api/workspace',{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({locationId:'rudds',requestId:crypto.randomUUID(),action,input,...(r?{recordId:r.recordId,expectedRevision:r.revision}:{})})});const data=await res.json();if(!res.ok)throw Error(JSON.stringify(data));return data;};
 const facts={title:'DEMO cooler service',equipment:'DEMO unit C-1',task:'Fictional completed task for software review only',sourceRef:'Fictional service agreement TEST-1',initialDue:'2026-10-01',intervalDays:30,warningDays:5,managerId:'demo-rudds-boh',checked:true,note:'Fictional source checked'};
 let r=await call('maintenance.create',facts);
 r=await call('maintenance.service',{date:'2026-09-28',performedBy:'Fictional technician',evidence:'DEMO report SVC-1',note:'Fictional entire task completed',completed:true},r);
 const response=await dispatch('http://localhost/api/workspace?locationId=rudds',{headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test'}}),w=await response.json(),entry=w.records.find(x=>x.id===r.recordId).data.services[0];
 r=await call('maintenance.cost',{serviceId:entry.id,amount:'185.50',documentDate:'2026-09-28',sourceRef:'DEMO invoice INV-101 · fictional test folder',allocation:'This service only: labor, parts and allocated tax',note:'Fictional invoice amount checked',confirmed:true},r);
 return {record:r,serviceId:entry.id};
}
