import { AppError, requireThat } from './validation';
import type { ToastConnection } from './toast-connection';
type Database=Pick<D1Database,'prepare'>;
type Entry={encrypted_token:string;expires_at:number;retry_at:number};
const encoder=new TextEncoder(),cooldown=30*60*1000;
const bytes=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encoded=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
async function material(config:ToastConnection){
 const identity=JSON.stringify([config.host,config.clientId,config.clientSecret,config.restaurantGuid,config.locationId]);
 const digest=await crypto.subtle.digest('SHA-256',encoder.encode('jmax-toast-cache-id-v1:'+identity));
 const cacheKey=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode('jmax-toast-cache-encryption-v1:'+identity)),{name:'AES-GCM'},false,['encrypt','decrypt']);
 return {cacheKey,key};
}
export class ToastAuthWait extends AppError{
 constructor(public nextAttemptAt:string,message='Toast authentication is cooling down. The saved employee roster is still available.') {super(429,message)}
}
// Discard only the session that the upstream rejected. A concurrent refresh or
// another restaurant's session must survive this bounded recovery attempt.
export async function forgetRejectedToastToken(db:Database,config:ToastConnection,rejectedToken:string){
 const {cacheKey,key}=await material(config);
 const row=await db.prepare('SELECT encrypted_token,expires_at,retry_at FROM toast_auth_cache WHERE cache_key=?').bind(cacheKey).first<Entry>();
 if(!row?.encrypted_token)return;
 let token:string;
 try{const [iv,cipher]=row.encrypted_token.split('.');token=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:encoder.encode(cacheKey)},key,bytes(cipher)))}catch{return;}
 if(token!==rejectedToken)return;
 await db.prepare("UPDATE toast_auth_cache SET encrypted_token='',expires_at=0,retry_at=0 WHERE cache_key=? AND encrypted_token=? AND expires_at=? AND retry_at=?").bind(cacheKey,row.encrypted_token,row.expires_at,row.retry_at).run();
}
export async function cachedToastToken(db:Database,config:ToastConnection,authenticate:()=>Promise<{accessToken:string;expiresIn:number}>,clock=()=>Date.now()){
 const {cacheKey,key}=await material(config),now=clock();
 const row=await db.prepare('SELECT encrypted_token,expires_at,retry_at FROM toast_auth_cache WHERE cache_key=?').bind(cacheKey).first<Entry>();
 if(row?.encrypted_token&&row.expires_at>now+30000){
  try{const [iv,cipher]=row.encrypted_token.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:encoder.encode(cacheKey)},key,bytes(cipher)))}catch{/* Corrupt cache data is never used or logged; the auth cooldown still applies. */}
 }
 if(row&&row.retry_at>now)throw new ToastAuthWait(new Date(row.retry_at).toISOString());
 const lease=crypto.randomUUID(),retryAt=now+cooldown;
 const reserved=await db.prepare("INSERT INTO toast_auth_cache(cache_key,encrypted_token,expires_at,retry_at,lease_id) VALUES(?,'',0,?,?) ON CONFLICT(cache_key) DO UPDATE SET retry_at=excluded.retry_at,lease_id=excluded.lease_id WHERE toast_auth_cache.retry_at<=?").bind(cacheKey,retryAt,lease,now).run();
 if(!reserved.meta.changes)throw new ToastAuthWait(new Date(retryAt).toISOString(),'Another Toast authentication is in progress. Reload the saved roster in a moment.');
 let token:{accessToken:string;expiresIn:number};
 try{token=await authenticate()}catch(error){if(error instanceof AppError&&error.status===429)throw new ToastAuthWait(new Date(retryAt).toISOString(),'Toast is limiting authentication attempts. The saved employee roster is still available.');throw error}
 requireThat(Number.isFinite(token.expiresIn)&&token.expiresIn>=45&&token.expiresIn<=7*86400&&token.accessToken.length>0&&token.accessToken.length<=32000,'Toast returned an unusable connection response.',502);
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(cacheKey)},key,encoder.encode(token.accessToken)));
 const saved=await db.prepare('UPDATE toast_auth_cache SET encrypted_token=?,expires_at=?,retry_at=0 WHERE cache_key=? AND lease_id=?').bind(encoded(iv)+'.'+encoded(cipher),now+token.expiresIn*1000,cacheKey,lease).run();
 requireThat(saved.meta.changes,'The Toast connection changed while authenticating. Reload the saved roster.',409);
 return token.accessToken;
}
