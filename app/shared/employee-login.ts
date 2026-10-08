import { authenticateWorkspace, boundedJson, requireLocationAdministrator } from './service';
import { AppError, id, object, requireThat } from './validation';
import { cookieValue, employeeCookie, randomToken, sessionCookie, sessionSeconds, tokenHash } from './employee-session';
import {requirePersonalRestaurantAssignment,restaurantAccessWriteGuard} from './restaurant-access';

type Database=Pick<D1Database,'prepare'|'batch'>;
type Person={id:string;location_id:string;name:string;email:string;auth_user_id:string|null;active:number;revision:number;position:string;capabilities:string;restaurant_name?:string};
const json=(value:unknown,status=200,cookie?:string)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
function secret(bindings:unknown):string|null {const value=bindings&&typeof bindings==='object'?(bindings as Record<string,unknown>).JMAX_LOGIN_SECRET:undefined;return typeof value==='string'&&/^[a-f0-9]{64,128}$/i.test(value)?value:null;}
async function keyedHash(key:string,value:string){const imported=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',imported,new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function setupCode(){let result='';while(result.length<12){for(const byte of crypto.getRandomValues(new Uint8Array(20))){if(byte<250)result+=String(byte%10);if(result.length===12)break;}}return result;}
async function rate(db:Database,key:string,now:number,period:number,limit:number){
  const window=Math.floor(now/period)*period;
  const result=await db.prepare('INSERT INTO employee_login_limits(key,window_start,count,expires_at) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN employee_login_limits.window_start=excluded.window_start THEN employee_login_limits.count+1 ELSE 1 END,expires_at=excluded.expires_at WHERE employee_login_limits.window_start<>excluded.window_start OR employee_login_limits.count<?').bind(key,window,window+period,limit).run();
  requireThat(result.meta.changes,'Too many sign-in attempts. Wait a few minutes, then try again.',429);
}
// No Toast passcode, email provider, employee-selected identity or public sign-up
// is involved. Administrators issue a short-lived code for an enabled record.
export async function handleEmployeeLogin(request:Request,binding?:D1Database,bindings?:unknown):Promise<Response>{
  try{
    requireThat(['GET','POST'].includes(request.method),'Method not allowed.',405);
    const key=secret(bindings);
    const url=new URL(request.url);
    if(request.method==='GET'){
      if(!url.searchParams.has('memberId'))return json({available:!!key});
      const {db,identity}=await authenticateWorkspace(request,binding),locationId=id(url.searchParams.get('locationId')),memberId=id(url.searchParams.get('memberId'));
      await requireLocationAdministrator(db,identity,locationId);
      const person=await db.prepare('SELECT id,active,revision,auth_user_id FROM memberships WHERE id=? AND location_id=?').bind(memberId,locationId).first<{id:string;active:number;revision:number;auth_user_id:string|null}>();
      requireThat(person,'Employee account not found.',404);
      const signIn=await db.prepare("SELECT MIN(at) AS firstSignedInAt,MAX(at) AS lastSignedInAt FROM audit_events WHERE location_id=? AND record_id=? AND action='employee.signed-in'").bind(locationId,memberId).first<{firstSignedInAt:string|null;lastSignedInAt:string|null}>();
      const grant=await db.prepare('SELECT created_at,expires_at,used_at FROM employee_setup_codes WHERE member_id=?').bind(memberId).first<{created_at:number;expires_at:number;used_at:number|null}>();
      return json({active:!!person.active,claimed:!!person.auth_user_id,revision:person.revision,firstSignedInAt:signIn?.firstSignedInAt??null,lastSignedInAt:signIn?.lastSignedInAt??null,codeIssuedAt:grant?new Date(grant.created_at).toISOString():null,codeExpiresAt:grant?new Date(grant.expires_at).toISOString():null,codeUsedAt:grant?.used_at?new Date(grant.used_at).toISOString():null});
    }
    requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open sign-in from your JMAX app.',403);
    requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
    const input=object(await boundedJson(request.body,3000));
    requireThat(['verify','issue','revoke','logout'].includes(String(input.action)),'Choose a supported sign-in action.');
    requireThat(binding,'Sign-in storage is not available yet.',503);
    const db=binding.withSession('first-primary');
    if(input.action==='logout'){
      requireThat(Object.keys(input).every(k=>k==='action'),'Unexpected sign-out fields.');
      let token:string|null=null;try{token=cookieValue(request,employeeCookie)}catch{/* Clear a malformed cookie as well. */}
      if(token&&/^[a-f0-9]{64}$/.test(token))await db.prepare('DELETE FROM employee_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
      return json({signedOut:true},200,sessionCookie('',0));
    }
    requireThat(key,'Employee setup codes are not enabled yet. Your manager can finish sign-in setup.',503);
    const now=Date.now();
    if(input.action==='issue'||input.action==='revoke'){
      requireThat(Object.keys(input).every(k=>['action','locationId','memberId','expectedRevision'].includes(k)),'Unexpected employee setup fields.');
      const {identity,authUserId}=await authenticateWorkspace(request,binding),locationId=id(input.locationId),memberId=id(input.memberId);
      const actor=await requireLocationAdministrator(db,identity,locationId);
      requireThat(locationId!=='owner-review','Setup codes are for approved restaurant employees.',403);
      const results=await db.batch([
        db.prepare('SELECT * FROM memberships WHERE id=? AND location_id=?').bind(memberId,locationId),
        db.prepare('SELECT revision FROM locations WHERE id=?').bind(locationId),
      ]);
      const person=results[0].results[0] as Person|undefined,location=results[1].results[0] as {revision:number}|undefined;
      requireThat(person&&location,'Employee account not found.',404);
      requireThat(person.active===1,'Review and enable this employee’s access before creating a setup code.');
      if(input.action==='issue')await requirePersonalRestaurantAssignment(db,person.email,locationId,person.auth_user_id);
      requireThat(Number.isInteger(input.expectedRevision)&&person.revision===input.expectedRevision,'This employee’s setup changed. Reload it before continuing.',409);
      const administrator=(JSON.parse(person.capabilities) as string[]).includes('location.manage');
      requireThat(input.action!=='issue'||!administrator||actor.member.id===person.id,'Administrators create their own phone codes while signed in. If they cannot sign in, have them use Owner sign-in so another owner can review account recovery.',403);
      const code=input.action==='issue'?setupCode():null,hash=code?await keyedHash(key,'setup:'+code):null,token=crypto.randomUUID(),expiresAt=now+30*60*1000;
      const gate='EXISTS(SELECT 1 FROM locations WHERE id=? AND last_command=?)';
      const policy=await restaurantAccessWriteGuard(db,identity,locationId);
      const commands=[db.prepare(`UPDATE locations SET revision=revision+1,last_command=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND active=1 AND revision=?) AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND active=1 AND revision=?) AND ${policy.sql}`).bind(token,locationId,location.revision,actor.member.id,authUserId,actor.revision,memberId,person.revision,...policy.values)];
      if(code)commands.push(db.prepare(`INSERT INTO employee_setup_codes(member_id,code_hash,member_revision,issued_by,created_at,expires_at,used_at,session_hash) SELECT ?,?,?,?,?,?,NULL,NULL WHERE ${gate} ON CONFLICT(member_id) DO UPDATE SET code_hash=excluded.code_hash,member_revision=excluded.member_revision,issued_by=excluded.issued_by,created_at=excluded.created_at,expires_at=excluded.expires_at,used_at=NULL,session_hash=NULL`).bind(memberId,hash,person.revision,actor.member.id,now,expiresAt,locationId,token));
      else{
        commands.push(db.prepare(`DELETE FROM employee_setup_codes WHERE member_id=? AND ${gate}`).bind(memberId,locationId,token));
        commands.push(db.prepare(`DELETE FROM employee_sessions WHERE member_id=? AND ${gate}`).bind(memberId,locationId,token));
        // Owner browser sign-in remains the independent recovery route when
        // their JMAX phone-code sessions are revoked.
        if(!administrator)commands.push(db.prepare(`DELETE FROM browser_identity_links WHERE principal_id=(SELECT auth_user_id FROM memberships WHERE id=?) AND ${gate}`).bind(memberId,locationId,token));
        // Revision also stops in-flight code issuance or code consumption.
        commands.push(db.prepare(`UPDATE memberships SET revision=revision+1 WHERE id=? AND ${gate}`).bind(memberId,locationId,token));
      }
      commands.push(db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(token,locationId,actor.member.id,code?'employee.code-issued':'employee.devices-revoked',memberId,new Date(now).toISOString(),location.revision+1,locationId,token));
      const saved=await db.batch(commands);requireThat(saved[0].meta.changes,'Access changed while saving. Reload this employee and try again.',409);
      return json(code?{code:code.match(/.{4}/g)!.join(' '),name:person.name,issuedAt:new Date(now).toISOString(),expiresAt:new Date(expiresAt).toISOString()}:{revoked:true});
    }
    requireThat(Object.keys(input).every(k=>['action','code'].includes(k)),'Only the setup code is needed to sign in.');
    // Bounded attempts before parsing avoid a free high-volume malformed path.
    const ip=request.headers.get('cf-connecting-ip')??'unavailable';
    await rate(db,await keyedHash(key,'verify-ip:'+ip),now,10*60*1000,100);
    await rate(db,'verify-global',now,60*60*1000,1000);
    requireThat(typeof input.code==='string'&&input.code.length<=32,'Enter the 12-digit setup code from your manager.');
    const code=input.code.replace(/[\s-]/g,'');requireThat(/^\d{12}$/.test(code),'Enter all 12 digits of the setup code.');
    const hash=await keyedHash(key,'setup:'+code);
    const grant=await db.prepare('SELECT c.member_id,c.member_revision,c.issued_by FROM employee_setup_codes c JOIN memberships m ON m.id=c.member_id WHERE c.code_hash=? AND c.used_at IS NULL AND c.expires_at>? AND m.active=1 AND m.revision=c.member_revision AND m.location_id<>?').bind(hash,now,'owner-review').first<{member_id:string;member_revision:number;issued_by:string}>();
    requireThat(grant,'That code is incorrect, expired or already used. Ask your manager for a new code.',401);
    const person=await db.prepare('SELECT m.*,l.name AS restaurant_name FROM memberships m JOIN locations l ON l.id=m.location_id WHERE m.id=?').bind(grant.member_id).first<Person>();
    requireThat(person?.active===1&&person.revision===grant.member_revision,'Your access changed. Ask your manager for a new code.',401);
    requireThat(!(JSON.parse(person.capabilities) as string[]).includes('location.manage')||grant.issued_by===person.id,'This administrator code needs to be created from their own signed-in account. Use Owner sign-in for account recovery.',403);
    await requirePersonalRestaurantAssignment(db,person.email,person.location_id,person.auth_user_id);
    const principal=person.auth_user_id??'employee-'+crypto.randomUUID(),session=randomToken(),sessionHash=await tokenHash(session);
    const policy=person.auth_user_id?await restaurantAccessWriteGuard(db,{source:'sites',authUserId:person.auth_user_id},person.location_id):{sql:"NOT EXISTS(SELECT 1 FROM memberships WHERE active=1 AND location_id<>? AND email<>'' AND lower(email)=lower(?))",values:[person.location_id,person.email]};
    const gate='EXISTS(SELECT 1 FROM employee_setup_codes WHERE member_id=? AND session_hash=?)';
    const browserSubject=request.headers.get('oai-authenticated-user-id'),browserEmail=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    // The valid, single-use code proves access. Matching contact information only
    // avoids linking another person's ambient browser login; it never grants access.
    const linkBrowser=!!browserSubject&&browserSubject.length<=200&&browserSubject!==principal&&browserEmail===person.email.toLowerCase();
    const consumed=await db.batch([
      db.prepare(`UPDATE employee_setup_codes SET used_at=?,session_hash=? WHERE member_id=? AND code_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND active=1 AND revision=?) AND ${policy.sql}`).bind(now,sessionHash,person.id,hash,now,person.id,person.revision,...policy.values),
      db.prepare(`UPDATE memberships SET auth_user_id=?,revision=revision+1 WHERE id=? AND auth_user_id IS NULL AND ${gate}`).bind(principal,person.id,person.id,sessionHash),
      db.prepare(`INSERT INTO employee_sessions(token_hash,auth_user_id,member_id,member_revision,created_at,expires_at) SELECT ?,auth_user_id,id,revision,?,? FROM memberships WHERE id=? AND active=1 AND ${gate}`).bind(sessionHash,now,now+sessionSeconds*1000,person.id,person.id,sessionHash),
      db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,'employee.signed-in',?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),person.location_id,person.id,person.id,new Date(now).toISOString(),person.revision,person.id,sessionHash),
      ...(linkBrowser?[db.prepare(`INSERT OR IGNORE INTO browser_identity_links(subject_id,principal_id,linked_at) SELECT ?,?,? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM memberships WHERE auth_user_id=? AND auth_user_id<>?)`).bind(browserSubject,principal,now,person.id,sessionHash,browserSubject,principal)]:[]),
      db.prepare('DELETE FROM employee_sessions WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM employee_login_limits WHERE expires_at<?').bind(now-24*60*60*1000),
    ]);
    requireThat(consumed[0].meta.changes===1&&consumed[2].meta.changes===1,'That code has already been used or your access changed. Ask your manager for a new code.',401);
    return json({memberId:person.id,name:person.name,position:person.position,locationId:person.location_id,restaurantName:person.restaurant_name},200,sessionCookie(session));
  }catch(error){if(error instanceof AppError)return json({error:error.message},error.status);return json({error:'JMAX could not complete sign-in. Please try again. If a setup code was just created, generate a new one before sharing it.'},503);}
}
