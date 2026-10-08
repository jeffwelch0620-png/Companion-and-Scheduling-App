import { boundedJson } from './service';
import { AppError, object, requireThat } from './validation';
import { fetchToastRoster } from './toast-roster';
import { fetchToastSchedule,ToastScheduleReadError } from './toast-schedule';
import { cachedToastToken,forgetRejectedToastToken } from './toast-auth-cache';

export type ToastConnection={locationId:string;restaurantGuid:string;host:string;clientId:string;clientSecret:string};
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Read only these server bindings. No client-supplied host, credential or restaurant override.
export function configuredToast(bindings:unknown,locationId:string):ToastConnection|null {
  if(!bindings||typeof bindings!=='object')return null;
  const raw=object(bindings),field=(name:string)=>typeof raw[name]==='string'?String(raw[name]).trim():'';
  const host=field('TOAST_API_HOST')||'https://ws-api.toasttab.com',restaurantGuid=field('TOAST_RESTAURANT_GUID');
  const clientId=field('TOAST_CLIENT_ID'),clientSecret=field('TOAST_CLIENT_SECRET');
  if(field('TOAST_LOCATION_ID')!==locationId||!guid.test(restaurantGuid)||!clientId||clientId.length>500||!clientSecret||clientSecret.length>2000||!['https://ws-api.toasttab.com','https://ws-sandbox-api.toasttab.com'].includes(host))return null;
  return {locationId,restaurantGuid,host,clientId,clientSecret};
}
async function authenticateToast(config:ToastConnection,fetcher:typeof fetch) {
  // Called only when the shared encrypted token cache needs a new session.
  // Workers supports manual redirects; reject every non-2xx status below so
  // credentials cannot be forwarded to a redirect destination.
  const auth=await fetcher(`${config.host}/authentication/v1/authentication/login`,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({clientId:config.clientId,clientSecret:config.clientSecret,userAccessType:'TOAST_MACHINE_CLIENT'}),signal:AbortSignal.timeout(15000)});
  if(!auth.ok){await auth.body?.cancel();throw new AppError(auth.status===429?429:503,auth.status===429?'Toast is limiting connection attempts. Try again later.':'Toast could not verify this connection. The saved roster has not changed.');}
  const data=object(await boundedJson(auth.body,64000)),token=object(data.token);
  requireThat(data.status==='SUCCESS'&&token.tokenType==='Bearer'&&typeof token.accessToken==='string'&&token.accessToken.length>0&&token.accessToken.length<=32000&&typeof token.expiresIn==='number'&&token.expiresIn>=45,'Toast returned an unusable connection response.',502);
  return {host:config.host,restaurantGuid:config.restaurantGuid,accessToken:token.accessToken,expiresIn:token.expiresIn};
}
export async function readConnectedToast(config:ToastConnection,fetcher:typeof fetch=fetch,db?:Pick<D1Database,'prepare'>) {
  const session=db?{host:config.host,restaurantGuid:config.restaurantGuid,accessToken:await cachedToastToken(db,config,()=>authenticateToast(config,fetcher))}:await authenticateToast(config,fetcher);
  return fetchToastRoster(session,fetcher);
}
// Administrator preview only. POS shifts do not establish the Sling calendar;
// this reader never imports, publishes or changes the local schedule.
export async function readConnectedToastSchedule(config:ToastConnection,weekStart:string,timezone:string,fetcher:typeof fetch=fetch,db?:Pick<D1Database,'prepare'>) {
  const session=db?{host:config.host,restaurantGuid:config.restaurantGuid,accessToken:await cachedToastToken(db,config,()=>authenticateToast(config,fetcher))}:await authenticateToast(config,fetcher);
  try{return await fetchToastSchedule(session,weekStart,timezone,fetcher)}catch(error){
    if(!(error instanceof ToastScheduleReadError)||error.upstreamStatus!==401)throw error;
    if(db)await forgetRejectedToastToken(db,config,session.accessToken);
    const retry=db?{host:config.host,restaurantGuid:config.restaurantGuid,accessToken:await cachedToastToken(db,config,()=>authenticateToast(config,fetcher))}:await authenticateToast(config,fetcher);
    // Exactly one retry; a second unauthorized result remains unavailable.
    return fetchToastSchedule(retry,weekStart,timezone,fetcher);
  }
}
