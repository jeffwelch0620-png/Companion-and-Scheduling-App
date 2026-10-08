import {authenticateWorkspace,recordFromRow,workspace} from './service';
import {hireCoordinator} from './hire-handoff';
import {buildHireReview,type HireReviewRecord} from './hire-review';
import {has,manages} from './types';
import type {HireDevelopmentRecord} from './hire-development';
import {AppError,id,requireThat} from './validation';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'GET'}:{})}});

export async function handleHireReview(request:Request,binding?:D1Database):Promise<Response>{
 try{
  requireThat(request.method==='GET','Method not allowed.',405);
  const params=new URL(request.url).searchParams;
  requireThat([...params.keys()].every(k=>['locationId','employeeId'].includes(k))&&params.getAll('locationId').length===1&&params.getAll('employeeId').length===1,'Choose one restaurant and one employee.');
  const locationId=id(params.get('locationId')),employeeId=id(params.get('employeeId'));
  const auth=await authenticateWorkspace(request,binding),initial=await workspace(auth.db,auth.identity,locationId),w=initial.value;
  const employee=w.hireCandidates?.find(c=>c.id===employeeId);
  requireThat(employee&&hireCoordinator(w.me,employee.area),'This hire review is unavailable for your department.',403);
  const now=new Date().toISOString();
  const rows=await auth.db.prepare("SELECT * FROM records WHERE location_id=? AND owner_id=? AND area=? AND kind IN ('hirechecklist','hirehandoff') AND json_extract(data,'$.hireDate')=? ORDER BY id LIMIT 21").bind(locationId,employee.id,employee.area,employee.hireDate).all();
  requireThat(rows.results.length<=20,'Too many records match this hire. Review the existing history before continuing.',503);
  const history=rows.results.map(raw=>({...recordFromRow(raw as Parameters<typeof recordFromRow>[0]),archived:!!raw.archived_at})) as HireReviewRecord[];
  // Apply the existing named-participant policy before the bound. Hidden reviews
  // must neither appear nor cause a count/overflow side channel for this viewer.
  const developmentRows=await auth.db.prepare("SELECT * FROM records WHERE location_id=? AND owner_id=? AND area=? AND kind='development' AND json_extract(data,'$.hireDate')=? AND (owner_id=? OR (?=1 AND json_extract(data,'$.managerId')=?) OR (?=1 AND json_extract(data,'$.approverId')=?)) ORDER BY id LIMIT 51").bind(locationId,employee.id,employee.area,employee.hireDate,w.me.id,manages(w.me,employee.area,'people.manage')?1:0,w.me.id,manages(w.me,employee.area,'people.approve')?1:0,w.me.id).all();
  requireThat(developmentRows.results.length<=50,'Too many visible development reviews match this hire. Open the existing training history before continuing.',503);
  const development=developmentRows.results.map(raw=>({...recordFromRow(raw as Parameters<typeof recordFromRow>[0]),archived:!!raw.archived_at})) as HireDevelopmentRecord[];
  // Only administrators already allowed to read employee sign-in audits get
  // this timestamp. No codes, sessions, email or authentication IDs are returned.
  const signIn=has(w.me,'location.manage')?await auth.db.prepare("SELECT MAX(at) AS lastSignedInAt FROM audit_events WHERE location_id=? AND record_id=? AND action='employee.signed-in' AND at<=?").bind(locationId,employee.id,now).first<{lastSignedInAt:string|null}>():null;
  const fresh=await authenticateWorkspace(request,binding),current=await workspace(fresh.db,fresh.identity,locationId);
  requireThat(fresh.authUserId===auth.authUserId&&current.value.me.id===w.me.id&&current.membershipRevision===initial.membershipRevision&&current.value.location.revision===w.location.revision&&current.value.hireCandidates?.find(c=>c.id===employee.id)?.revision===employee.revision,'The workspace changed. Refresh and review the current hire.',409);
  return json(buildHireReview(current.value,employee,history,signIn?.lastSignedInAt??null,now,development));
 }catch(error){return json({error:error instanceof AppError?error.message:'The hire review is unavailable.'},error instanceof AppError?error.status:503);}
}
