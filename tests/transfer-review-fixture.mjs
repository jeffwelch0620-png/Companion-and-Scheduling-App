// Opt-in fictional local preview. Exercises the compiled route; never runs in app code.
export async function seedTransferReviewFixture(dispatch){
 const call=async(locationId,action,input,record)=>{
  const r=await dispatch('https://test.example/api/food/transfers',{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId,action,input:{dataset:'demo',...input},...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})});
  const result=await r.json();if(!r.ok)throw Error('Fictional transfer review failed: '+JSON.stringify(result));return result;
 };
 for(const label of ['AWAITING','PARTIAL','DAMAGE','SHORT','COMPLETE','VOID']){
  const s=await call('berts','transfer.dispatch',{itemId:'demo-food-WI-001',itemRevision:1,destinationId:'rudds',reference:'DEMO-'+label,quantity:4,dispatchedAt:'2026-09-28T12:00:00Z',note:'Fictional local review only',confirmed:true});
  if(label==='AWAITING')continue;
  if(label==='VOID'){await call('berts','transfer.void',{reason:'Fictional duplicate slip'},s);continue;}
  await call('rudds','transfer.receive',{accepted:label==='COMPLETE'?4:label==='SHORT'?3:1,rejected:label==='DAMAGE'?1:0,missing:label==='SHORT'?1:0,complete:label==='COMPLETE'||label==='SHORT',receivedAt:'2026-09-28T13:00:00Z',reason:['SHORT','DAMAGE'].includes(label)?'Fictional delivery difference':'',note:'Fictional check; quantities cumulative',confirmed:true},s);
 }
}
