import {authenticateWorkspace,requireLocationAdministrator} from './service';
import {AppError,id,requireThat} from './validation';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {missingToastDay,projectToastDay,toastDayFreshnessSeconds,validateToastDayMapping,type ToastDayMapping,type ToastDayScope} from './toast-day';

// Only server code may supply this reader and the independently reconciled
// restaurant mapping. The ingestion POST endpoint is not a reader.
export type ToastDayReader = {
  mappings:ReadonlyMap<string,ToastDayMapping>;
  read(scope:Readonly<ToastDayScope>&{restaurantGuid:string;signal:AbortSignal}):Promise<unknown>;
};
const timeoutMs=5000;
function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'GET'}:{})}});}

export async function handleToastDay(request:Request,binding?:D1Database,reader?:ToastDayReader):Promise<Response>{
  try{
    requireThat(request.method==='GET','Method not allowed.',405);
    const {db,identity}=await authenticateWorkspace(request,binding);
    const params=new URL(request.url).searchParams;
    requireThat([...params.keys()].every(k=>['locationId','businessDate'].includes(k)) && params.getAll('locationId').length===1 && params.getAll('businessDate').length===1,'Choose one restaurant and one business date.');
    const locationId=id(params.get('locationId')), businessDate=calendarDate(params.get('businessDate'),'Business date');
    const actor=await requireLocationAdministrator(db,identity,locationId);
    const location=await db.prepare('SELECT timezone FROM locations WHERE id=?').bind(locationId).first<{timezone:string}>();
    requireThat(location,'No access to this restaurant.',403);
    requireThat(businessDate<=localDate(new Date().toISOString(),location.timezone),'Choose today or an earlier business date.');
    const scope={locationId,businessDate,timezone:location.timezone};
    const base={schemaVersion:'jmax-toast-day-status.v1',...scope,source:'toast',freshnessWindowSeconds:toastDayFreshnessSeconds};
    const mapping=reader?.mappings.get(locationId);
    if(!reader || !mapping)return json({...base,connection:'not-connected',...missingToastDay()});
    validateToastDayMapping(mapping,scope);
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let day:ReturnType<typeof projectToastDay>|undefined,failed=false;
    try{
      const timedOut=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);});
      const value=await Promise.race([Promise.resolve().then(()=>reader.read({...scope,restaurantGuid:mapping.restaurantGuid,signal:controller.signal})),timedOut]);
      day=projectToastDay(value,scope,mapping,Date.now());
    }catch{
      // Provider errors, including AppError-shaped exceptions, are never public.
      failed=true;
    }finally{clearTimeout(timer);controller.abort();}
    // Reauthenticate after the asynchronous read: both membership and device
    // sessions may be revoked while an upstream request is in flight.
    const currentIdentity=await authenticateWorkspace(request,binding);
    const current=await requireLocationAdministrator(currentIdentity.db,currentIdentity.identity,locationId);
    requireThat(currentIdentity.authUserId===identity.authUserId && current.member.id===actor.member.id && current.revision===actor.revision,'Your access changed. Open the latest workspace.',409);
    const currentLocation=await currentIdentity.db.prepare('SELECT timezone FROM locations WHERE id=?').bind(locationId).first<{timezone:string}>();
    requireThat(currentLocation?.timezone===scope.timezone,'Restaurant settings changed. Open the latest workspace.',409);
    if(failed || !day)return json({...base,connection:'unavailable',...missingToastDay(),error:'Toast day data could not be verified. Try again later.'},503);
    return json({...base,connection:'connected',...day});
  }catch(error){
    return json({error:error instanceof AppError?error.message:'Toast day data is unavailable.'},error instanceof AppError?error.status:503);
  }
}
