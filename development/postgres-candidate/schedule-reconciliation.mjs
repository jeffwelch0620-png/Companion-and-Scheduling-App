// Local fictional rehearsal only; never grants authentication or access.
import pg from 'pg';import {createHash} from 'node:crypto';import {connection} from './test-config.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v,max=100)=>typeof v==='string'&&v.trim().length>0&&v===v.trim()&&v.length<=max;
const rev=v=>Number.isSafeInteger(v)&&v>0&&v<2147483647;
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)===v.slice(0,10);
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
export function reviewScheduleReconciliation(source){
 const issues=[],roster=[],timeOff=[],fail=code=>issues.push(code);
 if(!source||!text(source.restaurantId)||!text(source.timezone)||source.completeRoster!==true||source.completeTimeOff!==true||!Array.isArray(source.members)||!Array.isArray(source.timeOff))return {status:'blocked',issues:['complete_source_required'],proposals:null};
 const ids=new Set(),people=new Set(),sourceIds=new Set();
 for(const m of source.members){
  if(!m||!text(m.sourceId)||!rev(m.sourceRevision)||!uuid(m.id)||!uuid(m.personId)||!text(m.name,200)||!text(m.department)||!text(m.position)||typeof m.active!=='boolean'||typeof m.scheduleOnly!=='boolean'||!Array.isArray(m.qualifications)||!Array.isArray(m.scheduleJobs)||![...m.qualifications,...m.scheduleJobs].every(v=>text(v))) {fail('invalid_member');continue;}
  const id=m.id.toLowerCase(),personId=m.personId.toLowerCase();if(ids.has(id)||people.has(personId)||sourceIds.has(m.sourceId)){fail('duplicate_member');continue;}ids.add(id);people.add(personId);sourceIds.add(m.sourceId);
  if(new Set(m.qualifications).size!==m.qualifications.length||new Set(m.scheduleJobs).size!==m.scheduleJobs.length){fail('duplicate_job');continue;}
  roster.push({...m,id,personId});
 }
 const requests=new Set(),requestSources=new Set();
 for(const r of source.timeOff){
  const member=roster.find(m=>m.sourceId===r?.memberSourceId);
  if(!r||!text(r.sourceId)||!rev(r.sourceRevision)||!uuid(r.id)||!member||!instant(r.start)||!instant(r.end)||Date.parse(r.end)<=Date.parse(r.start)||Date.parse(r.end)-Date.parse(r.start)>1440*3600000||!['pending','approved','declined'].includes(r.status)||typeof r.note!=='string'||r.note.length>2000||typeof r.decision!=='string'||r.decision.length>2000){fail('invalid_time_off');continue;}
  const id=r.id.toLowerCase();if(requests.has(id)||requestSources.has(r.sourceId)){fail('duplicate_time_off');continue;}requests.add(id);requestSources.add(r.sourceId);
  timeOff.push({...r,id,memberId:member.id,department:member.department,start:new Date(r.start).toISOString(),end:new Date(r.end).toISOString()});
 }
 return {status:issues.length?'blocked':'reviewable',issues,proposals:issues.length?null:{roster,timeOff}};
}
export async function rehearseScheduleReconciliation({snapshot,batchId,expectedScopeRevision,reviewNote,allow}){
 if(allow!=='fictional-local-only')throw Error('fictional_reconciliation_acknowledgment_required');
 if(!uuid(batchId)||!Number.isSafeInteger(expectedScopeRevision)||expectedScopeRevision<0||expectedScopeRevision>=2147483647||!text(reviewNote,2000))throw Error('invalid_reconciliation_review');
 const source=JSON.parse(JSON.stringify(snapshot)),review=reviewScheduleReconciliation(source);if(review.status!=='reviewable')throw Error('reconciliation_blocked');
 const hash=createHash('sha256').update(JSON.stringify(stable({source,expectedScopeRevision,reviewNote}))).digest('hex');
 const client=new pg.Client({...connection,user:'candidate_owner'});await client.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT candidate_operations.lock_scope($1)',[source.restaurantId]);const scope=(await client.query('SELECT revision,timezone FROM candidate_identity.restaurants WHERE id=$1',[source.restaurantId])).rows[0];if(!scope)throw Error('restaurant_mapping_required');
  const prior=(await client.query('SELECT source_hash,result FROM candidate_operations.schedule_reconciliation_receipts WHERE batch_id=$1',[batchId])).rows[0];
  if(prior){if(prior.source_hash!==hash)throw Error('reconciliation_batch_conflict');await client.query('COMMIT');return {...prior.result,replayed:true};}
  if(scope.revision!==expectedScopeRevision)throw Error('target_scope_revision_conflict');if(scope.timezone!==source.timezone)throw Error('timezone_conflict');
  const {roster,timeOff}=review.proposals;
  const target=(await client.query('SELECT m.*,p.name FROM candidate_identity.memberships m JOIN candidate_identity.people p ON p.id=m.person_id WHERE m.restaurant_id=$1 ORDER BY m.id FOR SHARE OF m,p',[source.restaurantId])).rows;
  if(target.length!==roster.length||roster.some(m=>{const t=target.find(t=>t.id===m.id);return !t||t.person_id!==m.personId||t.name!==m.name||t.department!==m.department||t.position!==m.position||t.active!==m.active||t.schedule_only!==m.scheduleOnly;}))throw Error('target_roster_conflict');
  const existing=(await client.query('SELECT * FROM candidate_operations.time_off_references WHERE restaurant_id=$1 ORDER BY id FOR UPDATE',[source.restaurantId])).rows;
  if(existing.some(t=>!timeOff.some(r=>r.id===t.id)))throw Error('target_time_off_omitted');
  const same=(t,r)=>equal({memberId:t.member_id,department:t.department,start:t.starts_at.toISOString(),end:t.ends_at.toISOString(),status:t.status,note:t.note,decision:t.decision,revision:t.revision},{memberId:r.memberId,department:r.department,start:r.start,end:r.end,status:r.status,note:r.note,decision:r.decision,revision:r.sourceRevision});
  if(existing.some(t=>!same(t,timeOff.find(r=>r.id===t.id))))throw Error('target_time_off_conflict');
  const collision=(await client.query('SELECT 1 FROM candidate_operations.time_off_references WHERE id=ANY($1::uuid[]) AND restaurant_id<>$2',[timeOff.map(r=>r.id),source.restaurantId])).rowCount;if(collision)throw Error('target_time_off_conflict');
  const shifts=(await client.query('SELECT * FROM candidate_operations.shift_references WHERE restaurant_id=$1 AND NOT cancelled',[source.restaurantId])).rows;
  for(const s of shifts){const m=roster.find(m=>m.id===s.member_id);if(!m||( !m.active&&!m.scheduleOnly)||![...m.qualifications,...m.scheduleJobs].includes(s.position))throw Error('existing_shift_job_conflict');if(timeOff.some(r=>r.memberId===s.member_id&&r.status==='approved'&&Date.parse(r.start)<s.ends_at.getTime()&&Date.parse(r.end)>s.starts_at.getTime()))throw Error('existing_shift_time_off_conflict');}
  await client.query('DELETE FROM candidate_identity.schedule_eligibility WHERE member_id=ANY($1::uuid[])',[roster.map(m=>m.id)]);
  for(const m of roster)for(const [kind,jobs] of [['qualification',m.qualifications],['schedule-job',m.scheduleJobs]])for(const job of jobs)await client.query('INSERT INTO candidate_identity.schedule_eligibility VALUES($1,$2,$3,true)',[m.id,job,kind]);
  for(const r of timeOff.filter(r=>!existing.some(t=>t.id===r.id)))await client.query('INSERT INTO candidate_operations.time_off_references(id,restaurant_id,member_id,department,starts_at,ends_at,status,revision,note,decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[r.id,source.restaurantId,r.memberId,r.department,r.start,r.end,r.status,r.sourceRevision,r.note,r.decision]);
  const archived=(await client.query("SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') AS refs FROM candidate_operations.time_off_references r WHERE restaurant_id=$1",[source.restaurantId])).rows[0].refs;
  const revision=(await client.query('UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=$1 RETURNING revision',[source.restaurantId])).rows[0].revision;
  const result={batchId:batchId.toLowerCase(),restaurantId:source.restaurantId,sourceHash:hash,workspaceRevision:revision,members:roster.length,timeOff:timeOff.length};
  await client.query('INSERT INTO candidate_operations.schedule_reconciliation_receipts(batch_id,restaurant_id,source_hash,source_snapshot,target_time_off,review_note,expected_scope_revision,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[batchId,source.restaurantId,hash,JSON.stringify(source),JSON.stringify(archived),reviewNote,expectedScopeRevision,JSON.stringify(result)]);
  await client.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at,evidence_batch_id) VALUES($1,true,clock_timestamp(),$2) ON CONFLICT(restaurant_id) DO UPDATE SET time_off_complete=true,reviewed_at=excluded.reviewed_at,evidence_batch_id=excluded.evidence_batch_id',[source.restaurantId,batchId]);
  await client.query('COMMIT');return {...result,replayed:false};
 }catch(error){await client.query('ROLLBACK');if(error.code==='42501'&&error.message==='scope_denied')throw Error('restaurant_mapping_required');throw error;}finally{await client.end();}
}
