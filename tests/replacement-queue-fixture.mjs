import {seedReplacementFixture} from './replacement-fixture.mjs';
// Fictional partial and complete replacement arrivals for queue review only.
export async function seedReplacementQueueFixture(dispatch){
 await seedReplacementFixture(dispatch);let revision=3;
 const post=async(action,input)=>{const r=await dispatch('https://test.example/api/food',{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'berts',recordId:'demo-food-WI-001',expectedRevision:revision,action,input})});const v=await r.json();if(!r.ok)throw Error('Fictional queue fixture failed: '+JSON.stringify(v));revision=v.revision;return revision;};
 await post('fooditem.replacement',{receivingRevision:3,quantity:.5,invoiceUnit:'case',deliveryReference:'DEMO-PARTIAL-REPLACEMENT',receivedDate:'2026-09-28',evidence:'Fictional accepted half case',confirmed:true});
 const invoiceRevision=await post('fooditem.invoice',{skuId:'vs_demo1',invoiceNumber:'DEMO-FULLY-REPLACED',lineReference:'1',invoiceDate:'2026-09-28',sourceNote:'Fictional second invoice',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case',lineTotal:'200.00',confirmed:true});
 const receivingRevision=await post('fooditem.receive',{invoiceRevision,deliveryReference:'DEMO-SECOND-DELIVERY',receivedDate:'2026-09-28',accepted:1,rejected:1,rejectionReason:'Fictional damaged case',confirmed:true});
 await post('fooditem.replacement',{receivingRevision,quantity:1,invoiceUnit:'case',deliveryReference:'DEMO-COMPLETE-REPLACEMENT',receivedDate:'2026-09-28',evidence:'Fictional accepted full case',confirmed:true});
}
