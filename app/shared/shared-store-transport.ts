import {AppError,requireThat,object} from './validation';
import {sharedStoreCookie,type SharedStoreBindings,type SharedStoreConfig,type SharedStoreUser} from './shared-store-contract';

const unavailable='The shared connection is not configured yet. Local review records are separate.';
export function sharedStoreConfig(bindings:SharedStoreBindings):SharedStoreConfig {
 const publicKey=bindings.SUPABASE_PUBLISHABLE_KEY??bindings.SUPABASE_ANON_KEY;
 const serverKey=bindings.SUPABASE_SECRET_KEY??bindings.SUPABASE_SERVICE_ROLE_KEY;
 requireThat(bindings.SUPABASE_URL&&publicKey&&serverKey,unavailable,503);
 let url:URL;try{url=new URL(bindings.SUPABASE_URL)}catch{throw new AppError(503,unavailable)}
 requireThat(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&['','/'].includes(url.pathname),unavailable,503);
 requireThat(!publicKey.startsWith('sb_secret_')&&publicKey!==serverKey,unavailable,503);
 return {url:url.origin,publicKey,serverKey};
}
export function sharedStoreToken(request:Request):string|null {
 const authorization=request.headers.get('Authorization');
 if(authorization!==null){requireThat(/^Bearer [A-Za-z0-9_.-]{16,8192}$/.test(authorization),'Sign in to the shared app again.',401);return authorization.slice(7)}
 const cookies=(request.headers.get('Cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(sharedStoreCookie+'='));
 requireThat(cookies.length<=1,'Sign in to the shared app again.',401);
 if(!cookies.length)return null;
 const token=cookies[0].slice(sharedStoreCookie.length+1);requireThat(/^[A-Za-z0-9_.-]{16,8192}$/.test(token),'Sign in to the shared app again.',401);return token;
}
export function sharedStoreSessionCookie(token:string,seconds:number){return `${sharedStoreCookie}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`;}
export async function sharedFetch(fetcher:typeof fetch,url:string,init:RequestInit):Promise<Response>{
 try{return await fetcher(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)})}catch{throw new AppError(503,'The shared service did not confirm this request. Retry the same saved request when the connection returns.')}
}
export async function sharedResponse(response:Response,limit=2_000_000):Promise<unknown>{
 const reader=response.body?.getReader();requireThat(reader,'The shared service returned an invalid response.',503);
 let length=0;const chunks:Uint8Array[]=[];
 for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>limit){await reader.cancel();throw new AppError(503,'The shared response is too large. Narrow the requested workspace.')}chunks.push(part.value)}
 const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new AppError(503,'The shared service returned an invalid response.')}
}
export async function verifySharedUser(config:SharedStoreConfig,token:string,fetcher:typeof fetch):Promise<SharedStoreUser>{
 const response=await sharedFetch(fetcher,config.url+'/auth/v1/user',{headers:{apikey:config.publicKey,Authorization:'Bearer '+token}});
 if(!response.ok){if(response.status===401||response.status===403)throw new AppError(401,'Your shared sign-in expired or was rejected. Sign in again.');throw new AppError(503,'Shared sign-in verification is unavailable. No record was changed.')}
 const user=object(await sharedResponse(response,64000));requireThat(typeof user.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)&&user.is_anonymous!==true,'Use an approved shared account.',401);
 return {id:user.id,...(typeof user.email==='string'?{email:user.email}: {})};
}
export async function sharedRpc(config:SharedStoreConfig,name:string,args:object,fetcher:typeof fetch):Promise<unknown>{
 // New secret keys go in apikey only. Legacy service-role JWTs also use Authorization.
 // The user's token is never replaced by this key until /auth/v1/user verified it.
 const headers:Record<string,string>={apikey:config.serverKey,'Content-Type':'application/json'};
 if(!config.serverKey.startsWith('sb_secret_'))headers.Authorization='Bearer '+config.serverKey;
 const response=await sharedFetch(fetcher,config.url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args)});
 const result=await sharedResponse(response);
 if(!response.ok){
  if([400,401,403,404,409].includes(response.status)&&result&&typeof result==='object'&&'code'in result&&result.code===`PT${response.status}`&&'message'in result&&typeof result.message==='string')throw new AppError(response.status,result.message.slice(0,500));
  throw new AppError(503,'Shared storage did not confirm the operation. Retrying the same request is safe.');
 }
 return result;
}

