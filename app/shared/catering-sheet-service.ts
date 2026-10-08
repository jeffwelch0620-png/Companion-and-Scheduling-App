import {authenticateWorkspace,workspace} from './service';
import {cateringSheet} from './catering-sheet';
import {AppError,id,requireThat} from './validation';
import {requireRestaurantAccess} from './restaurant-access';
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
export async function handleCateringSheet(request:Request,binding?:D1Database){
 try{
  requireThat(request.method==='GET','Method not allowed.',405);const p=new URL(request.url).searchParams,keys=['locationId','recordId','revision'];
  requireThat([...p.keys()].every(k=>keys.includes(k))&&keys.every(k=>p.getAll(k).length===1),'Open one saved event from its restaurant calendar.');
  const locationId=id(p.get('locationId')),recordId=id(p.get('recordId')),version=p.get('revision');requireThat(version&&/^[1-9]\d{0,9}$/.test(version),'Open the latest saved event first.');
  const auth=await authenticateWorkspace(request,binding),initial=await workspace(auth.db,auth.identity,locationId),w=initial.value,r=w.records.find(r=>r.id===recordId&&r.kind==='catering');
  requireThat(r?.kind==='catering','Event not found.',404);const html=cateringSheet(w,r,new Date().toISOString());requireThat(r.revision===Number(version),'This event changed. Refresh the calendar and open its latest sheet.',409);
  const fresh=await authenticateWorkspace(request,binding),current=await fresh.db.prepare('SELECT m.revision AS memberRevision,l.revision AS locationRevision FROM memberships m JOIN locations l ON l.id=m.location_id WHERE m.id=? AND m.location_id=? AND m.auth_user_id=? AND m.active=1').bind(w.me.id,locationId,auth.identity.authUserId).first<{memberRevision:number;locationRevision:number}>();
  await requireRestaurantAccess(fresh.db,fresh.identity,locationId);
  requireThat(fresh.authUserId===auth.authUserId&&current?.memberRevision===initial.membershipRevision&&current?.locationRevision===w.location.revision,'The workspace or your access changed. Refresh before opening an event sheet.',409);
  return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 }catch(e){return Response.json({error:e instanceof AppError?e.message:'The event sheet is unavailable.'},{status:e instanceof AppError?e.status:503,headers:{...headers,...(e instanceof AppError&&e.status===405?{Allow:'GET'}:{})}});}
}
