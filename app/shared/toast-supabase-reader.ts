import {AppError,requireThat} from './validation';
import {sharedResponse} from './shared-store-transport';
import type {ToastDayReader} from './toast-day-service';
import type {ToastDayMapping} from './toast-day';

export type ToastReadBindings={SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string;SUPABASE_SECRET_KEY?:string};
const mappings:ReadonlyMap<string,ToastDayMapping>=new Map([
 ['berts',{locationId:'berts',restaurantGuid:'6e09b799-f05e-4a86-9867-511b0bb23325',timezone:'America/New_York'}],
 ['rudds',{locationId:'rudds',restaurantGuid:'95ac8855-65c8-4a49-9d3d-d25e36351edc',timezone:'America/New_York'}],
 ['papa',{locationId:'papa',restaurantGuid:'ddebbf7f-b32a-4df7-b75f-9428daffd946',timezone:'America/New_York'}],
]);
// The existing route verifies local restaurant membership before and after reads.
// Credentials are Worker server bindings; never accepted from the browser.
export function configuredToastDayReader(bindings:ToastReadBindings,fetcher:typeof fetch=fetch):ToastDayReader|undefined{
 const serverKey=bindings.SUPABASE_SECRET_KEY??bindings.SUPABASE_SERVICE_ROLE_KEY;
 if(!bindings.SUPABASE_URL||!serverKey)return undefined;
 let url:URL;try{url=new URL(bindings.SUPABASE_URL)}catch{return undefined}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))return undefined;
 return {mappings,read:async scope=>{
  const mapped=mappings.get(scope.locationId);
  requireThat(mapped?.restaurantGuid===scope.restaurantGuid&&mapped.timezone===scope.timezone,'Restaurant mapping needs review.',503);
  const headers:Record<string,string>={apikey:serverKey,'Content-Type':'application/json'};
  if(!serverKey.startsWith('sb_secret_'))headers.Authorization='Bearer '+serverKey;
  let response:Response;
  try{response=await fetcher(url.origin+'/rest/v1/rpc/jmax_toast_read_day',{method:'POST',redirect:'error',cache:'no-store',signal:scope.signal,headers,body:JSON.stringify({p_store_id:scope.locationId,p_business_date:scope.businessDate})});}
  catch{throw new AppError(503,'Toast saved data is unavailable.')}
  if(response.status!==200){await response.body?.cancel();throw new AppError(503,'Toast saved data is unavailable.');}
  return sharedResponse(response,64000);
 }};
}
