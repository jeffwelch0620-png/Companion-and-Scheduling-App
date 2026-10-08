// Fictional local preview only; all entries use the compiled Food route.
export async function seedExtraBillingFixture(dispatch){
 let revision=1;const call=async(action,input)=>{const response=await dispatch('https://test.example/api/food',{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'berts',recordId:'demo-food-WI-001',expectedRevision:revision,action,input})});const result=await response.json();if(!response.ok)throw Error('Fictional billing preview seed failed: '+JSON.stringify(result));revision=result.revision;return revision;};
 const fields={skuId:'vs_demo1',invoiceNumber:'DEMO-ORIGINAL',lineReference:'1',invoiceDate:'2026-09-28',sourceNote:'Fictional preview invoice, not restaurant operations',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case',lineTotal:'200.00',confirmed:true};
 const invoiceRevision=await call('fooditem.invoice',fields);
 await call('fooditem.receive',{invoiceRevision,deliveryReference:'DEMO-DELIVERY',receivedDate:'2026-09-28',accepted:2,rejected:0,rejectionReason:'',confirmed:true});
 await call('fooditem.excess',{invoiceRevision,deliveryReference:'DEMO-EXTRA',observedDate:'2026-09-28',quantity:1,invoiceUnit:'case',evidence:'Fictional count of an extra case',goodsLocation:'Fictional holding shelf',confirmed:true});
 await call('fooditem.invoice',{...fields,invoiceNumber:'DEMO-BILL-EXTRA',quantity:1,lineTotal:'100.00',sourceNote:'Fictional supplier invoice identifying the extra case DEMO-EXTRA'});
}
