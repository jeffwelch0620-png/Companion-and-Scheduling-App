import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {handleCateringSheet} from '../.sites-runtime/shared/catering-sheet-service.mjs';
import {facts,review} from './catering-fixture.mjs';
export const lines=[{item:'Fictional boxed meal',quantity:24,unit:'boxes',reference:'Fixture item1',notes:'Fixture note'},{item:'Fictional salad',quantity:1.5,unit:'trays',reference:'Fixture item2',notes:''}];
export async function sheetFixture(t){const f=await fixture(t);
 const publish=async(input={})=>{let r=ok(await f.call('manager','catering.create',{...facts,menuLines:lines,...input}));r=ok(await f.call('manager','catering.submit',review,r));return ok(await f.call('owner','catering.publish',review,r));};
 const sheet=async(actor,r,query={},binding=f.db,method='GET')=>{const p=new URLSearchParams({locationId:'a',recordId:r.recordId??r.id,revision:String(r.revision),...query});const url='http://localhost/api/operations/catering-sheet?'+p;const init={method,headers:actor?{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}:{}};const res=f.compiled?await f.dispatch(url,init):await handleCateringSheet(new Request(url,init),binding);return {status:res.status,text:await res.text(),headers:res.headers};};
 return {...f,publish,sheet};
}
