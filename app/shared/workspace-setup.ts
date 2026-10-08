import { boundedJson } from './service';
import { AppError, id, object, requireThat, text } from './validation';
import type { Capability } from './types';

export type InitialWorkspace = {locationId:string;name:string;timezone:string;ownerEmail:string;ownerName:string};
export type WorkspaceSetup = {plan:InitialWorkspace;complete:boolean};
const ownerCapabilities:Capability[]=['location.manage','schedule.manage','schedule.publish','schedule.change','standards.approve','people.manage','people.approve'];
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
function configured(bindings:unknown):InitialWorkspace {
  const raw=bindings&&typeof bindings==='object'?(bindings as Record<string,unknown>).JMAX_INITIAL_WORKSPACE:null;
  requireThat(typeof raw==='string'&&raw.length<4000,'Owner setup has not been enabled.',404);
  const p=object(JSON.parse(raw));
  const plan={locationId:id(p.locationId),name:text(p.name,'Restaurant name',120),timezone:text(p.timezone,'Time zone',80),ownerEmail:text(p.ownerEmail,'Owner email',254).toLowerCase(),ownerName:text(p.ownerName,'Owner name',100)};
  requireThat(plan.locationId.length<=60&&!['review','owner-review'].includes(plan.locationId)&&!plan.locationId.startsWith('owner-review-'),'Use a real restaurant workspace.');
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(plan.ownerEmail),'Owner setup email is invalid.');
  new Intl.DateTimeFormat('en-US',{timeZone:plan.timezone}).format();
  return plan;
}

// Explicit server configuration authorizes one owner and one restaurant.
// This is never first-login signup, a review role, or an employee invitation.
export async function handleWorkspaceSetup(request:Request,binding?:D1Database,bindings?:unknown):Promise<Response> {
  try {
    requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
    const plan=configured(bindings),email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase(),identity=request.headers.get('oai-authenticated-user-id');
    requireThat(identity&&identity.length<=200&&email,'Sign in to set up your workspace.',401);
    requireThat(email===plan.ownerEmail,'Only the designated owner can complete this setup.',403);
    requireThat(binding,'Shared storage is not connected.',503);
    const db=binding.withSession('first-primary'),memberId='initial-owner-'+plan.locationId;
    const existing=async()=>{
      const rows=await db.batch([
        db.prepare('SELECT id FROM locations WHERE id=?').bind(plan.locationId),
        db.prepare('SELECT email,auth_user_id,active,capabilities FROM memberships WHERE id=? AND location_id=?').bind(memberId,plan.locationId),
        db.prepare("SELECT id FROM audit_events WHERE location_id=? AND actor_id=? AND action='workspace.initialize' LIMIT 1").bind(plan.locationId,memberId),
      ]);
      if(!rows[0].results.length)return false;
      const m=rows[1].results[0] as {email:string;auth_user_id:string;active:number;capabilities:string}|undefined;
      requireThat(m&&m.email===email&&m.auth_user_id===identity&&m.active===1&&JSON.parse(m.capabilities).includes('location.manage')&&rows[2].results.length,'This restaurant already exists. Use its current administrator to review access.',409);
      return true;
    };
    if(request.method==='GET')return json({plan,complete:await existing()} satisfies WorkspaceSetup);
    const url=new URL(request.url);
    requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open setup from your JMAX workspace.',403);
    requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
    const input=object(await boundedJson(request.body,6000));
    requireThat(Object.keys(input).every(k=>['confirmed','plan'].includes(k))&&input.confirmed===true,'Review the restaurant and owner before creating the workspace.');
    const supplied=object(input.plan);
    requireThat(Object.keys(supplied).length===Object.keys(plan).length&&Object.entries(plan).every(([k,v])=>supplied[k]===v),'Setup details changed. Reload and review the restaurant again.',409);
    if(await existing())return json({plan,complete:true} satisfies WorkspaceSetup);
    const token=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM locations WHERE id=? AND last_command=?)';
    await db.batch([
      db.prepare('INSERT INTO locations(id,name,timezone,revision,last_command) VALUES(?,?,?,0,?) ON CONFLICT(id) DO NOTHING').bind(plan.locationId,plan.name,plan.timezone,token),
      db.prepare(`INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) SELECT ?,?,?,?,?,?,?,?,'[]',1 WHERE ${gate}`).bind(memberId,email,identity,plan.locationId,plan.ownerName,'Management','Owner',JSON.stringify(ownerCapabilities),plan.locationId,token),
      db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,'workspace.initialize',?,?,0 WHERE ${gate}`).bind(token,plan.locationId,memberId,plan.locationId,new Date().toISOString(),plan.locationId,token),
    ]);
    requireThat(await existing(),'Setup could not be confirmed. Reload before trying again.',409);
    return json({plan,complete:true} satisfies WorkspaceSetup);
  }catch(error){
    if(error instanceof AppError)return json({error:error.message},error.status);
    return json({error:'Workspace setup could not be confirmed. Reload before trying again.'},503);
  }
}
