// Opt-in fictional local preview. This file is never loaded by the application.
export async function seedTransferReceiptUnitsPreview(dispatch){
 const call=async(locationId,endpoint,action,input,record)=>{
  const response=await dispatch('https://test.example/api/'+endpoint,{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId,action,input:{dataset:'demo',...input},...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})});
  const data=await response.json();if(!response.ok)throw Error(JSON.stringify(data));return data;
 };
 const destination=await call('rudds','food','fooditem.import',{sourceRestaurantId:'receipt-units-fixture',sourceLabel:'Fictional receiving-unit preview',destinationLocationId:'rudds',confirmed:true,rows:[{restaurantId:'receipt-units-fixture',name:'Fictional Ground Beef Receiving Tub',controlNumber:'RECEIVING-TUB',purchaseUnit:'tub',packCount:1,unitQty:16,unitUOM:'lb',active:true,countActive:true,needsReview:false,vendorSkus:[]}]});
 const sent=await call('berts','food/transfers','transfer.dispatch',{itemId:'demo-food-WI-001',itemRevision:1,destinationId:'rudds',reference:'UNITS-DEMO-01',quantity:4,dispatchedAt:'2026-09-30T00:00:00Z',note:'Fictional pack conversion review',confirmed:true});
 await call('rudds','food/transfers','transfer.match-item',{itemId:destination.recordId,itemRevision:destination.revision,reason:'Fictional same product: 40 lb dispatch case and 16 lb receiving tub',confirmed:true},sent);
}
