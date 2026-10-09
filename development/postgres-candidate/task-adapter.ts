// Candidate only: trusted backend identity plus a transaction-capable PostgreSQL driver.
// No Supabase credentials, identity verification implementation, or UI wiring here.
export interface QueryResult { rows: Record<string, unknown>[] }
export interface Transaction {
 query(sql: string, values: readonly unknown[]): Promise<QueryResult>;
}
export interface Database {
 transaction<T>(operation: (connection: Transaction) => Promise<T>): Promise<T>;
}
export type TrustedIdentity = { subject: string; membershipId: string };
export type TaskResult = {
 recordId: string; revision: number; workspaceRevision: number;
 requestId: string; appliedAt: string; replayed: boolean;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class CommandError extends Error {
 status: number; code: string;
 constructor(status: number,code: string) { super(code); this.status=status; this.code=code; }
}
function object(value: unknown): Record<string,unknown> {
 if (!value || typeof value!=='object' || Array.isArray(value)) throw new CommandError(400,'invalid_object');
 return value as Record<string,unknown>;
}
function keys(value: Record<string,unknown>, allowed: string[], required: string[]) {
 if(Object.keys(value).some(k=>!allowed.includes(k)) || required.some(k=>!Object.hasOwn(value,k)))
  throw new CommandError(400,'invalid_fields');
}
function identifier(value: unknown): string {
 if(typeof value!=='string'||!uuid.test(value)) throw new CommandError(400,'invalid_identifier'); return value;
}
function string(value: unknown,max: number): string {
 if(typeof value!=='string'||!value.trim()||value.trim().length>max) throw new CommandError(400,'invalid_text');
 return value.trim();
}
function instant(value: unknown): string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))
  throw new CommandError(400,'invalid_time');
 return new Date(value).toISOString();
}
export function parseCommand(raw: unknown, restaurantId: string) {
 const c=object(raw);
 keys(c,['requestId','locationId','action','recordId','expectedRevision','input','clientCapturedAt'],
  ['requestId','locationId','action','input']);
 if(c.locationId!==restaurantId) throw new CommandError(403,'scope_mismatch');
 const requestId=identifier(c.requestId),input=object(c.input);
 let payload: Record<string,unknown>;
 if(c.action==='goal.create'||c.action==='goal.transition'){
  if(c.action==='goal.create'){
   keys(input,['ownerId','managerId','title','definition','type','due','standardId','standardRevision'],['ownerId','managerId','title','definition','type','due']);
   if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision')||!['development','required-correction'].some(t=>t===input.type))throw new CommandError(400,'invalid_goal_fields');
   if(Object.hasOwn(input,'standardRevision')&&(!Number.isSafeInteger(input.standardRevision)||Number(input.standardRevision)<1||Number(input.standardRevision)>2147483646))throw new CommandError(400,'invalid_goal_guide_revision');
   payload={action:c.action,input:{ownerId:identifier(input.ownerId),managerId:identifier(input.managerId),title:string(input.title,200),definition:string(input.definition,2000),type:input.type,due:instant(input.due),...(Object.hasOwn(input,'standardId')?{standardId:identifier(input.standardId)}:{}),...(Object.hasOwn(input,'standardRevision')?{standardRevision:input.standardRevision}:{})}};
  }else{
   keys(input,['step','note'],['step','note']);
   if(!['accept','decline','practice','coach','ready','verify','fix','cancel'].some(s=>s===input.step)||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_goal_transition');
   payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{step:input.step,note:string(input.note,2000)}};
  }
 }else if(c.action==='station.save'){
  const updating=Object.hasOwn(c,'recordId');
  if(updating&&(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)||!updating&&Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'invalid_station_record');
  keys(input,['area','title','levels','independentLevel','status','note','setup'],['title','levels','status','note']);
  payload={action:c.action,input:{...input,title:string(input.title,100),note:string(input.note,2000)}};
  if(updating)payload={...payload,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision};
 }else if(c.action==='request.create'||c.action==='request.review'){
  if(c.action==='request.create'){
   keys(input,['type','start','end','note'],['type','start','end','note']);
   if(input.type!=='time-off'||Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'invalid_time_off_fields');
   for(const k of ['start','end']){
    const value=input[k];
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
     ||!Number.isFinite(Date.parse(value.slice(0,10)+'T12:00:00Z'))||new Date(value.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new CommandError(400,'invalid_time_off_value');
   }
   payload={action:c.action,input:{type:'time-off',start:instant(input.start),end:instant(input.end),note:string(input.note,2000)}};
  }else{
   keys(input,['approve','note','affectedShifts'],['approve','note']);
   if(typeof input.approve!=='boolean'||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_time_off_review');
   let affectedShifts: {id:string;revision:number}[]|undefined;
   if(Object.hasOwn(input,'affectedShifts')){
    if(!Array.isArray(input.affectedShifts)||input.affectedShifts.length>100)throw new CommandError(400,'invalid_time_off_impact');
    affectedShifts=input.affectedShifts.map(v=>{const s=object(v);keys(s,['id','revision'],['id','revision']);if(!Number.isSafeInteger(s.revision)||Number(s.revision)<1||Number(s.revision)>2147483646)throw new CommandError(400,'invalid_time_off_impact');return {id:identifier(s.id),revision:Number(s.revision)};});
   }
   payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{approve:input.approve,note:string(input.note,2000),...(affectedShifts?{affectedShifts}:{})}};
  }
 }else if(c.action==='shift.save'){
  const updating=Object.hasOwn(c,'recordId');
  if(updating&&(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)
   ||!updating&&Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'invalid_draft_record');
  keys(input,['personId','start','end','position','note','stationId'],['personId','start','end','position']);
  for(const k of ['start','end']){
   const value=input[k];
   if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
    ||!Number.isFinite(Date.parse(value.slice(0,10)+'T12:00:00Z'))||new Date(value.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new CommandError(400,'invalid_draft_time');
  }
  if(Object.hasOwn(input,'note')&&(typeof input.note!=='string'||input.note.trim().length>2000))throw new CommandError(400,'invalid_draft_text');
  payload={action:c.action,input:{personId:identifier(input.personId),start:instant(input.start),end:instant(input.end),position:string(input.position,100),note:typeof input.note==='string'?input.note.trim():'',
   ...(Object.hasOwn(input,'stationId')?{stationId:input.stationId===null||input.stationId===''?null:identifier(input.stationId)}:{})}};
  if(updating)payload={...payload,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision};
 }else if(c.action==='availability.save'||c.action==='availability.review'){
  const updating=Object.hasOwn(c,'recordId');
  if(updating&&(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)
    ||!updating&&Object.hasOwn(c,'expectedRevision')||c.action==='availability.review'&&!updating)throw new CommandError(400,'invalid_availability_record');
  if(c.action==='availability.save'){
   keys(input,['personId','startDate','endDate','days','startMinute','endMinute','beforeMinutes','afterMinutes','title','kind','excludedDates','replacesId'],['startDate','endDate','days','startMinute','endMinute','title','kind']);
   payload={action:c.action,input:{...input,startDate:string(input.startDate,10),endDate:string(input.endDate,10),title:string(input.title,150),
    ...(Object.hasOwn(input,'personId')?{personId:identifier(input.personId)}:{}),...(Object.hasOwn(input,'replacesId')?{replacesId:identifier(input.replacesId)}:{})}};
  }else{
   keys(input,['approve','note'],['approve','note']);if(typeof input.approve!=='boolean')throw new CommandError(400,'invalid_availability_review');
   payload={action:c.action,input:{approve:input.approve,note:string(input.note,8000)}};
  }
  if(updating)payload={...payload,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision};
 }else if(c.action==='handoff.create'||c.action==='handoff.transition'){
  if(c.action==='handoff.create'){
   keys(input,['title','detail','outgoingLeadershipId','incomingLeadershipId','incomingId','priority','safeToDefer'],['title','detail','outgoingLeadershipId','incomingLeadershipId','incomingId','priority','safeToDefer']);
   if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision')||input.safeToDefer!==true||!['routine','urgent'].some(p=>p===input.priority))throw new CommandError(400,'invalid_safe_deferral');
   payload={action:c.action,input:{title:string(input.title,200),detail:string(input.detail,4000),outgoingLeadershipId:identifier(input.outgoingLeadershipId),incomingLeadershipId:identifier(input.incomingLeadershipId),incomingId:identifier(input.incomingId),priority:input.priority,safeToDefer:true}};
  }else{
   const replacement=input.step==='offer'||input.step==='recover';keys(input,replacement?['step','note','incomingId','incomingLeadershipId']:['step','note'],replacement?['step','note','incomingId','incomingLeadershipId']:['step','note']);
   if(!['accept','dispute','offer','recover','resolve','cancel'].some(s=>s===input.step)||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_overnight_transition');
   payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{step:input.step,note:string(input.note,4000),...(replacement?{incomingId:identifier(input.incomingId),incomingLeadershipId:identifier(input.incomingLeadershipId)}:{})}};
  }
 }else if(c.action==='task.dish-cycle'){
  keys(input,['amOwnerId','pmOwnerIds','businessDate','title','detail','due'],['amOwnerId','pmOwnerIds','businessDate','title','detail','due']);
  if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision')||!Array.isArray(input.pmOwnerIds)||input.pmOwnerIds.length!==2
   ||typeof input.businessDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate))throw new CommandError(400,'invalid_dish_cycle');
  const am=identifier(input.amOwnerId),pm=input.pmOwnerIds.map(identifier);
  if(new Set([am,...pm]).size!==3)throw new CommandError(400,'distinct_dishwashers_required');
  payload={action:c.action,input:{amOwnerId:am,pmOwnerIds:pm,businessDate:input.businessDate,title:string(input.title,180),detail:string(input.detail,8000),due:instant(input.due)}};
 }else if(c.action==='task.dish-pass'){
  keys(input,['incomingId','note','due'],['incomingId','note','due']);
  if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_dish_pass');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{incomingId:identifier(input.incomingId),note:string(input.note,8000),due:instant(input.due)}};
 }else if(c.action==='close.assign'){
  keys(input,['shiftId','standardId','managerId','verifierId','due','note'],['shiftId','standardId','managerId','due']);
  if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'closing_reassignment_not_supported');
  payload={action:c.action,input:{shiftId:identifier(input.shiftId),standardId:identifier(input.standardId),managerId:identifier(input.managerId),due:instant(input.due),
   note:input.note===undefined?'Assigned with the schedule':string(input.note,8000),...(input.verifierId===undefined?{}:{verifierId:identifier(input.verifierId)})}};
 }else if(c.action==='shift.release'){
  keys(input,['note'],['note']);
  if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_shift_release');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{note:string(input.note,8000)}};
 }else if(c.action==='close.acknowledge'||c.action==='close.correction.assign'){
  keys(input,c.action==='close.acknowledge'?['note']:['personId','note'],c.action==='close.acknowledge'?['note']:['personId','note']);
  if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_closing_support');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{note:string(input.note,8000),
   ...(c.action==='close.correction.assign'?{personId:identifier(input.personId)}:{})}};
 }else if(c.action==='close.transition'){
  keys(input,['step','note','answers','managerAttention'],['step','note']);
  if(typeof input.step!=='string'||!['ready','verify','confirm','fix'].includes(input.step)
   ||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646
   ||input.step!=='ready'&&Object.hasOwn(input,'answers'))throw new CommandError(400,'invalid_closing_transition');
  if(input.step==='ready'&&(!Array.isArray(input.answers)||input.answers.length>100
   ||input.answers.some(a=>!Number.isSafeInteger(a)||a<0||a>99)||new Set(input.answers).size!==input.answers.length))
   throw new CommandError(400,'required_conditions_missing');
  if(Object.hasOwn(input,'managerAttention')&&(input.step!=='fix'||!['repeated','serious','unresolved'].some(reason=>input.managerAttention===reason)))throw new CommandError(400,'invalid_attention_reason');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,
   input:{step:input.step,note:string(input.note,8000),...(input.step==='ready'?{answers:input.answers}:{}),
    ...(Object.hasOwn(input,'managerAttention')?{managerAttention:input.managerAttention}:{})}};
 }else if(c.action==='task.create'){
  keys(input,['title','detail','kind','ownerId','due','incomingId','shiftId'],['title','detail','kind','ownerId','due']);
  if(!['task','issue','handoff'].some(kind=>input.kind===kind)||Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision')
   ||(input.kind==='handoff')!==Object.hasOwn(input,'incomingId'))
   throw new CommandError(400,'invalid_creation');
  payload={action:c.action,input:{title:string(input.title,200),detail:string(input.detail,8000),
   kind:input.kind,ownerId:identifier(input.ownerId),due:instant(input.due),
   ...(input.kind==='handoff'?{incomingId:identifier(input.incomingId)}:{}),
   ...(Object.hasOwn(input,'shiftId')?{shiftId:identifier(input.shiftId)}:{})}};
 }else if(c.action==='task.reassign'){
  keys(input,['ownerId','note'],['ownerId','note']);
  if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)
   throw new CommandError(400,'invalid_reassignment');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,
   input:{ownerId:identifier(input.ownerId),note:string(input.note,8000)}};
 }else if(c.action==='task.transition'){
  keys(input,['step','note'],['step','note']);
  if(!['ready','verify','fix','accept','dispute'].includes(String(input.step))||typeof input.step!=='string'
   ||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)
   throw new CommandError(400,'invalid_transition');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,
   input:{step:input.step,note:string(input.note,8000)}};
 }else throw new CommandError(400,'unsupported_action');
 if(Object.hasOwn(c,'clientCapturedAt')) payload.clientCapturedAt=instant(c.clientCapturedAt);
 return {requestId,payload};
}
export async function executeTask(
 database: Database, identity: TrustedIdentity, restaurantId: string, raw: unknown
): Promise<TaskResult> {
 // The caller must verify the session/token before supplying this identity.
 if(!identity.subject||!uuid.test(identity.membershipId)) throw new CommandError(401,'invalid_identity');
 const command=parseCommand(raw,restaurantId);
 try {
  return await database.transaction(async connection=>{
   const response=await connection.query(
    ['goal.create','goal.transition'].includes(String(command.payload.action))
     ?'SELECT candidate_operations.goal_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='station.save'
     ?'SELECT candidate_operations.save_station($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :['request.create','request.review'].includes(String(command.payload.action))
     ?'SELECT candidate_operations.time_off_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='shift.save'
     ?'SELECT candidate_operations.save_schedule_draft($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :['availability.save','availability.review'].includes(String(command.payload.action))
     ?'SELECT candidate_operations.availability_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :['handoff.create','handoff.transition'].includes(String(command.payload.action))
     ?'SELECT candidate_operations.overnight_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='task.dish-cycle'
     ?'SELECT candidate_operations.assign_dish_cycle($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='close.assign'
     ?'SELECT candidate_operations.assign_close($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
     :command.payload.action==='close.transition'
      ?'SELECT candidate_operations.transition_close($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
      :command.payload.action==='shift.release'
       ?'SELECT candidate_operations.release_shift($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
      :['close.acknowledge','close.correction.assign'].includes(String(command.payload.action))
       ?'SELECT candidate_operations.support_close($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
       :'SELECT candidate_operations.command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result',
    [identity.subject,identity.membershipId,restaurantId,command.requestId,JSON.stringify(command.payload)]
   );
   const result=typeof response.rows[0]?.result==='string'?JSON.parse(response.rows[0].result):response.rows[0]?.result;
   if(!result||!uuid.test(result.recordId)||!Number.isInteger(result.revision)||!Number.isInteger(result.workspaceRevision)
    ||result.requestId!==command.requestId||typeof result.appliedAt!=='string'||typeof result.replayed!=='boolean')
    throw new Error('invalid_database_result');
   return result as TaskResult;
  });
 } catch(error) {
  const e=error as {code?:string;message?:string};
  if(e.code==='42501') throw new CommandError(403,e.message??'denied');
  if(e.code==='P0001'&&['request_payload_conflict','revision_conflict','phase_conflict','shift_conflict','closing_zone_conflict','attention_pending','attention_not_pending','checkout_pending','dish_cycle_conflict','dish_shape_conflict','availability_replacement_conflict','availability_shift_conflict','draft_reference_only','schedule_inputs_incomplete','station_assignment_not_migrated','shift_overlap','approved_time_off_conflict','linked_shift_protected','linked_task_pending','linked_close_protected','time_off_impact_conflict','time_off_cancellation_not_migrated','station_name_immutable','station_title_conflict','station_setup_reference_only','goal_guide_changed'].includes(e.message??''))
   throw new CommandError(409,e.message??'conflict');
  if(e.code?.startsWith('22')||e.code==='23514') throw new CommandError(400,e.message??'invalid_command');
  throw error; // Network/database failures must remain failures, never confirmed empty or applied.
 }
}
