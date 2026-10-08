// Explicit fictional equipment seed for the isolated local preview only.
export async function seedMeterOnlyPreview(dispatch){
 const headers={'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'http://localhost','Content-Type':'application/json'};
 const response=await dispatch('http://localhost/api/workspace',{method:'POST',headers,body:JSON.stringify({locationId:'rudds',requestId:'fixture-meter-only-asset',action:'equipment.create',input:{title:'Fictional hour-meter equipment',assetTag:'DEMO-HOURS-1',placement:'Fictional test room',manufacturer:'',model:'Demo model',serial:'Demo serial',sourceRef:'Fictional equipment label for UI testing',note:'Fictional physical identity check',checked:true}})});
 if(!response.ok)throw Error('Fictional meter-only equipment seed failed: '+await response.text());
}
