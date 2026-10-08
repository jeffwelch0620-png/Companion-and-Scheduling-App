// Opt-in fictional local read review; exercises existing compiled dispatch/receipt API.
export async function seedTransferWindowPreview(dispatch){
 const call=async(locationId,action,input,record)=>{
  const r=await dispatch('https://test.example/api/food/transfers',{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId,action,input:{dataset:'demo',...input},...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})});
  const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value;
 };
 for(let i=0;i<24;i++){
  const at=i<21?'2026-09-28T12:00:00Z':i===21?'2026-09-29T03:59:59.999Z':i===22?'2026-09-29T04:00:00.000Z':'2026-09-27T12:00:00Z';
  const record=await call('berts','transfer.dispatch',{itemId:'demo-food-WI-001',itemRevision:1,destinationId:'rudds',reference:'DATE-DEMO-'+String(i+1).padStart(2,'0'),quantity:4,dispatchedAt:at,note:'Fictional date review only',confirmed:true});
  if(i===0)await call('rudds','transfer.receive',{accepted:3,rejected:1,missing:0,receivedAt:'2026-09-30T01:00:00Z',reason:'Fictional damage checked on later day',confirmed:true},record);
 }
}
