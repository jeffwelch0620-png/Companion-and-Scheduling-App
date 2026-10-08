import { authenticateWorkspace, requireLocationAdministrator, memberFromRow, boundedJson } from './service';
import {restaurantAccessWriteGuard} from './restaurant-access';
import { AppError, id, object, requireThat } from './validation';
import { planReviewReminders, type ReminderReceipt, type ReminderState } from './review-reminders';
import type { Location, RecordOf } from './types';

type Database=Pick<D1Database,'prepare'|'batch'>;
type Guard={memberId:string;authUserId:string;revision:number;policy?:{sql:string;values:(string|number)[]}};
type RunRow={checked_at:string;scheduled_at:string|null;delivered:number;issues:string};
type ReviewRow={id:string;location_id:string;owner_id:string;area:string;revision:number;data:string;updated_at:string};
type MemberRow=Parameters<typeof memberFromRow>[0];
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});

export async function reminderState(db:Database,locationId:string):Promise<ReminderState> {
  const row=await db.prepare('SELECT * FROM review_reminder_runs WHERE location_id = ?').bind(locationId).first<RunRow>();
  return row?{checkedAt:row.checked_at,scheduledAt:row.scheduled_at,delivered:row.delivered,issues:JSON.parse(row.issues)}:{checkedAt:null,scheduledAt:null,delivered:0,issues:[]};
}

export async function runLocationReminders(db:Database,locationId:string,at:string,source:'manual'|'scheduled',guard?:Guard):Promise<ReminderState> {
  const rows=await db.batch([
    db.prepare('SELECT id, name, timezone, revision FROM locations WHERE id = ?').bind(locationId),
    db.prepare('SELECT * FROM memberships WHERE location_id = ? AND active = 1').bind(locationId),
    db.prepare("SELECT * FROM records WHERE location_id = ? AND archived_at IS NULL AND kind = 'development' LIMIT 3001").bind(locationId),
    db.prepare('SELECT * FROM review_reminders WHERE location_id = ?').bind(locationId),
    db.prepare('SELECT COUNT(*) AS total FROM records WHERE location_id = ? AND archived_at IS NULL').bind(locationId),
  ]);
  const location=rows[0].results[0] as Location|undefined;requireThat(location,'Restaurant not found.',404);
  requireThat(rows[2].results.length<=3000,'Review storage needs attention.',503);
  const members=(rows[1].results as MemberRow[]).map(memberFromRow);
  const reviews=(rows[2].results as ReviewRow[]).map(r=>({id:r.id,locationId:r.location_id,kind:'development',ownerId:r.owner_id,area:r.area,revision:r.revision,updatedAt:r.updated_at,data:JSON.parse(r.data)} as RecordOf<'development'>));
  const plan=planReviewReminders(location,members,reviews,rows[3].results as ReminderReceipt[],at);
  requireThat(Number((rows[4].results[0] as {total:number}).total)+plan.reminders.length<=3000,'Archive old workspace records before delivering reminders.',503);
  // One location revision covers review phase, recipients and their permissions.
  // Every application mutation uses this same guard; a conflicting run retries fresh.
  const token=crypto.randomUUID(),gated='EXISTS (SELECT 1 FROM locations WHERE id = ? AND last_command = ?)';
  const guardSql=guard?' AND EXISTS (SELECT 1 FROM memberships WHERE id = ? AND auth_user_id = ? AND active = 1 AND revision = ?)'+(guard.policy?' AND '+guard.policy.sql:''):'';
  const statements=[db.prepare('UPDATE locations SET revision = revision + 1, last_command = ? WHERE id = ? AND revision = ?'+guardSql).bind(token,locationId,location.revision,...(guard?[guard.memberId,guard.authUserId,guard.revision,...(guard.policy?.values??[])]:[]))];
  for(const reminder of plan.reminders) {
    const messageId=crypto.randomUUID();
    const data={title:reminder.milestone===7?'Development review needs owner follow-up':'Development review reminder',body:reminder.body,recipients:[reminder.recipient.id],readBy:[],replies:[],recordId:reminder.reviewId,automated:true};
    statements.push(db.prepare(`INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) SELECT ?,?,'message',?,?,1,?,? WHERE ${gated}`).bind(messageId,locationId,reminder.recipient.id,reminder.recipient.area,JSON.stringify(data),at,locationId,token));
    statements.push(db.prepare(`INSERT INTO review_reminders(location_id,review_id,stage,responsible_id,recipient_id,milestone,original_due_date,message_id,at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gated}`).bind(locationId,reminder.reviewId,reminder.stage,reminder.responsibleId,reminder.recipient.id,reminder.milestone,reminder.originalDueDate,messageId,at,locationId,token));
  }
  statements.push(db.prepare(`INSERT INTO review_reminder_runs(location_id,checked_at,scheduled_at,delivered,issues) SELECT ?,?,?,?,? WHERE ${gated} ON CONFLICT(location_id) DO UPDATE SET checked_at=excluded.checked_at,scheduled_at=COALESCE(excluded.scheduled_at,review_reminder_runs.scheduled_at),delivered=excluded.delivered,issues=excluded.issues`).bind(locationId,at,source==='scheduled'?at:null,plan.reminders.length,JSON.stringify(plan.issues),locationId,token));
  const committed=await db.batch(statements);
  requireThat(committed[0].meta.changes,'The restaurant changed during the reminder check. Try again.',409);
  return reminderState(db,locationId);
}

// Called by the platform's scheduled event, never by an unauthenticated HTTP route.
// Hosting must connect a scheduled trigger before unattended delivery is available.
export async function runScheduledReviewReminders(binding:D1Database,at=new Date().toISOString()) {
  const db=binding.withSession('first-primary');let cursor='',failures=0;
  for(;;) {
    const locations=await db.prepare('SELECT id FROM locations WHERE id > ? ORDER BY id LIMIT 25').bind(cursor).all<{id:string}>();
    if(!locations.results.length)break;
    for(const location of locations.results) {
      for(let attempt=0;attempt<3;attempt++) {
        try{await runLocationReminders(db,location.id,at,'scheduled');break}
        catch(error){if(error instanceof AppError&&error.status===409&&attempt<2)continue;failures++;break}
      }
    }
    cursor=locations.results.at(-1)!.id;
  }
  if(failures)throw new Error('One or more restaurant reminder checks failed.');
}

export async function handleReminders(request:Request,binding?:D1Database):Promise<Response> {
  try {
    requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
    const {db,identity,authUserId}=await authenticateWorkspace(request,binding),url=new URL(request.url);
    const locationId=id(url.searchParams.get('locationId'));
    const actor=await requireLocationAdministrator(db,identity,locationId);
    if(request.method==='GET')return json(await reminderState(db,locationId));
    requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);
    requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
    const body=object(await boundedJson(request.body,1024));requireThat(body.action==='run','Unknown reminder action.');
    const policy=await restaurantAccessWriteGuard(db,identity,locationId);
    return json(await runLocationReminders(db,locationId,new Date().toISOString(),'manual',{memberId:actor.member.id,authUserId,revision:actor.revision,policy}));
  }catch(error) {
    if(error instanceof AppError)return json({error:error.message},error.status);
    console.error(JSON.stringify({event:'review_reminder_check_failed',errorType:error instanceof Error?error.name:'unknown'}));
    return json({error:'The reminder check could not be confirmed. Trying again will not duplicate delivered reminders.'},503);
  }
}
