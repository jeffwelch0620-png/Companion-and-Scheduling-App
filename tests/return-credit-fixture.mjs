// Fictional local preview only. Writes through the compiled Food route.
export async function seedReturnCreditFixture(dispatch){
 let revision=1;
 const call=async(action,input)=>{
  const response=await dispatch('https://test.example/api/food',{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'berts',recordId:'demo-food-WI-001',expectedRevision:revision,action,input})});
  const result=await response.json();if(!response.ok)throw Error('Fictional return-credit fixture failed: '+JSON.stringify(result));revision=result.revision;return revision;
 };
 const invoiceRevision=await call('fooditem.invoice',{skuId:'vs_demo1',invoiceNumber:'DEMO-MATCH-0929',lineReference:'1',invoiceDate:'2026-09-28',sourceNote:'Fictional preview invoice; no operating data',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case',lineTotal:'200.00',confirmed:true});
 const receivingRevision=await call('fooditem.receive',{invoiceRevision,deliveryReference:'DEMO-DELIVERY-1',receivedDate:'2026-09-28',accepted:1.5,rejected:.5,rejectionReason:'Fictional torn package',confirmed:true});
 await call('fooditem.return',{receivingRevision,returnReference:'DEMO-PICKUP-1',returnDate:'2026-09-28',accepted:.25,rejected:.5,reason:'Fictional damaged goods',evidence:'Fictional pickup ticket DEMO-PICKUP-1',confirmed:true});
 await call('fooditem.credit',{invoiceRevision,creditNumber:'DEMO-CREDIT-1',lineReference:'1',creditDate:'2026-09-28',sourceNote:'Fictional issued credit refers to pickup DEMO-PICKUP-1',reason:'returned',quantity:.5,amount:'50.00',confirmed:true});
}
