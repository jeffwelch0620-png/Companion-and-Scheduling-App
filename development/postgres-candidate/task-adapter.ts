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
export function parseCopySelection(raw: unknown) {
 const selection=object(raw);keys(selection,['sourceWeek','targetWeek','shifts','staffing'],['sourceWeek','targetWeek','shifts','staffing']);
 for(const key of ['sourceWeek','targetWeek']){
  const day=selection[key];if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)throw new CommandError(400,'invalid_copy_week');
 }
 const days=(Date.parse(String(selection.targetWeek))-Date.parse(String(selection.sourceWeek)))/86400000;
 if(days<7||days>364||days%7!==0)throw new CommandError(400,'invalid_copy_week');
 const checked=(family:'shifts'|'staffing')=>{
  const values=selection[family];if(!Array.isArray(values)||values.length>100||family==='shifts'&&values.length===0)throw new CommandError(400,'invalid_copy_selection');
  const rows=values.map(value=>{const row=object(value);keys(row,['id','revision','startOccurrence','endOccurrence'],['id','revision']);
   if(!Number.isSafeInteger(row.revision)||Number(row.revision)<1||Number(row.revision)>2147483646)throw new CommandError(400,'invalid_revision');
   const occurrence=(key:string)=>{const value=row[key]??'';if(typeof value!=='string'||!['','earlier','later'].includes(value)||Object.hasOwn(row,key)&&row[key]===null)throw new CommandError(400,'invalid_copy_occurrence');return value;};
   return {id:identifier(row.id).toLowerCase(),revision:Number(row.revision),startOccurrence:occurrence('startOccurrence'),endOccurrence:occurrence('endOccurrence')};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new CommandError(400,'invalid_copy_selection');return rows;
 };
 return {sourceWeek:selection.sourceWeek as string,targetWeek:selection.targetWeek as string,shifts:checked('shifts'),staffing:checked('staffing')};
}
export function parseBatchSelection(raw: unknown) {
 const selection=object(raw);keys(selection,['weekStart','drafts'],['weekStart','drafts']);
 const day=selection.weekStart;
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day.startsWith('0000')||!Number.isFinite(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)throw new CommandError(400,'invalid_batch_week');
 if(!Array.isArray(selection.drafts)||selection.drafts.length<1||selection.drafts.length>100)throw new CommandError(400,'invalid_batch_selection');
 const local=(value:unknown)=>{
  if(typeof value!=='string')throw new CommandError(400,'invalid_batch_time');
  const m=/^(\d{4}-\d{2}-\d{2})T([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9])(?:\.([0-9]{1,6}))?)?$/.exec(value);
  if(!m||m[1].startsWith('0000')||!Number.isFinite(Date.parse(m[1]+'T12:00:00Z'))||new Date(m[1]+'T12:00:00Z').toISOString().slice(0,10)!==m[1])throw new CommandError(400,'invalid_batch_time');
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]??'00'}.${(m[5]??'').padEnd(6,'0')}`;
 };
 const drafts=selection.drafts.map(value=>{
  const row=object(value);keys(row,['id','revision','input'],['id','revision','input']);
  if(!Number.isSafeInteger(row.revision)||Number(row.revision)<1||Number(row.revision)>2147483646)throw new CommandError(400,'invalid_revision');
  const input=object(row.input);keys(input,['personId','position','startLocal','endLocal','startOccurrence','endOccurrence'],['personId','position','startLocal','endLocal']);
  const occurrence=(key:string)=>{const choice=input[key]??'';if(typeof choice!=='string'||!['','earlier','later'].includes(choice)||Object.hasOwn(input,key)&&input[key]===null)throw new CommandError(400,'invalid_batch_occurrence');return choice;};
  return {id:identifier(row.id).toLowerCase(),revision:Number(row.revision),input:{personId:identifier(input.personId).toLowerCase(),position:string(input.position,100),startLocal:local(input.startLocal),endLocal:local(input.endLocal),startOccurrence:occurrence('startOccurrence'),endOccurrence:occurrence('endOccurrence')}};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 if(new Set(drafts.map(row=>row.id)).size!==drafts.length)throw new CommandError(400,'invalid_batch_selection');
 return {weekStart:day,drafts};
}
export function parseCommand(raw: unknown, restaurantId: string) {
 const c=object(raw);
 keys(c,['requestId','locationId','action','recordId','expectedRevision','input','clientCapturedAt'],
  ['requestId','locationId','action','input']);
 if(c.locationId!==restaurantId) throw new CommandError(403,'scope_mismatch');
 const requestId=identifier(c.requestId),input=object(c.input);
 let payload: Record<string,unknown>;
 if(c.action==='shift.save-batch'){
  if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'invalid_batch_command');
  keys(input,['weekStart','drafts','reviewToken','note','confirmed'],['weekStart','drafts','reviewToken','note','confirmed']);
  if(input.confirmed!==true||typeof input.reviewToken!=='string'||!/^[0-9a-f]{64}$/.test(input.reviewToken))throw new CommandError(400,'invalid_batch_command');
  const {reviewToken,note,confirmed,...selection}=input;
  payload={action:c.action,input:{...parseBatchSelection(selection),reviewToken,note:string(note,2000),confirmed}};
 }else if(c.action==='shift.copy-week'){
  if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'invalid_copy_command');
  keys(input,['sourceWeek','targetWeek','shifts','staffing','reviewToken','note','confirmed'],['sourceWeek','targetWeek','shifts','staffing','reviewToken','note','confirmed']);
  if(input.confirmed!==true||typeof input.reviewToken!=='string'||!/^[0-9a-f]{64}$/.test(input.reviewToken))throw new CommandError(400,'invalid_copy_command');
  const {reviewToken,note,confirmed,...selection}=input;
  payload={action:c.action,input:{...parseCopySelection(selection),reviewToken,note:string(note,2000),confirmed}};
 }else if(c.action==='leave.resolve'){
  if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2)throw new CommandError(400,'invalid_revision');
  keys(input,['note','reviewToken','evidence'],['note','reviewToken','evidence']);
  if(typeof input.reviewToken!=='string'||!/^[0-9a-f]{64}$/.test(input.reviewToken)||!Array.isArray(input.evidence)||input.evidence.length>20)throw new CommandError(400,'invalid_leave_review_fields');
  const evidence=input.evidence.map(value=>{const e=object(value);keys(e,['kind','id','revision'],['kind','id','revision']);if(typeof e.kind!=='string'||!['attendance','correction'].includes(e.kind)||!Number.isSafeInteger(e.revision)||Number(e.revision)<1||Number(e.revision)>1000)throw new CommandError(400,'invalid_leave_review_evidence');return {kind:e.kind,id:identifier(e.id),revision:e.revision};});
  if(new Set(evidence.map(e=>e.kind+':'+e.id)).size!==evidence.length)throw new CommandError(400,'invalid_leave_review_evidence');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{note:string(input.note,2000),reviewToken:input.reviewToken,evidence}};
 }else if(typeof c.action==='string'&&c.action.startsWith('correction.')){
  if(!['correction.propose','correction.approve','correction.reject','correction.withdraw'].includes(c.action))throw new CommandError(400,'invalid_correction_action');
  const proposing=c.action==='correction.propose';
  if(proposing){
   if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'invalid_correction_fields');
   keys(input,['shiftId','shiftRevision','expectedCorrectionRevision','start','end','position','reason'],['shiftId','shiftRevision','expectedCorrectionRevision','start','end','position','reason']);
   if(!Number.isSafeInteger(input.shiftRevision)||Number(input.shiftRevision)<1||Number(input.shiftRevision)>2147483646
    ||!Number.isSafeInteger(input.expectedCorrectionRevision)||Number(input.expectedCorrectionRevision)<0||Number(input.expectedCorrectionRevision)>1000)throw new CommandError(400,'invalid_revision');
   for(const key of ['start','end']){
    const value=input[key];
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
     ||!Number.isFinite(Date.parse(value.slice(0,10)+'T12:00:00Z'))||new Date(value.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new CommandError(400,'invalid_correction_time');
   }
   payload={action:c.action,input:{shiftId:identifier(input.shiftId),shiftRevision:input.shiftRevision,expectedCorrectionRevision:input.expectedCorrectionRevision,
    start:instant(input.start),end:instant(input.end),position:string(input.position,100),reason:string(input.reason,2000)}};
  }else{
   if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>1000)throw new CommandError(400,'invalid_revision');
   keys(input,['note'],['note']);payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{note:string(input.note,2000)}};
  }
 }else if(typeof c.action==='string'&&c.action.startsWith('attendance.')){
  const creating=c.action==='attendance.record';
  if(!['attendance.record','attendance.correct','attendance.void','attendance.review','attendance.reopen'].includes(c.action))throw new CommandError(400,'unsupported_action');
  if(creating&&(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))||!creating&&(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>1000))throw new CommandError(400,'invalid_revision');
  if(creating||c.action==='attendance.correct'){
   keys(input,creating?['shiftId','shiftRevision','type','reportedAt','note','facts']:['type','reportedAt','note','facts','changeReason'],creating?['shiftId','shiftRevision','type','reportedAt','note']:['type','reportedAt','note','changeReason']);
   if(typeof input.type!=='string'||!['call-in','no-show','late','left-early','other'].includes(input.type))throw new CommandError(400,'invalid_attendance_value');
   const reported=input.reportedAt;
   if(typeof reported!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(reported)||!Number.isFinite(Date.parse(reported))||!Number.isFinite(Date.parse(reported.slice(0,10)+'T12:00:00Z'))||new Date(reported.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==reported.slice(0,10)||Number(reported.slice(11,13))>23)throw new CommandError(400,'invalid_attendance_time');
   if(creating&&(!Number.isSafeInteger(input.shiftRevision)||Number(input.shiftRevision)<1||Number(input.shiftRevision)>2147483646))throw new CommandError(400,'invalid_revision');
   let facts:Record<string,unknown>|undefined;
   if(Object.hasOwn(input,'facts')){
    facts=object(input.facts);keys(facts,['contact','coverage','emergency'],['contact','coverage','emergency']);
    if(typeof facts.contact!=='string'||!['unknown','phone','message','none'].includes(facts.contact)||typeof facts.coverage!=='string'||!['unknown','confirmed','uncovered'].includes(facts.coverage)||typeof facts.emergency!=='string'||!['unknown','reported','not-reported'].includes(facts.emergency))throw new CommandError(400,'invalid_attendance_facts');
   }
   payload={action:c.action,input:{type:input.type,reportedAt:instant(reported),note:string(input.note,2000),...(facts?{facts}:{}),...(creating?{shiftId:identifier(input.shiftId),shiftRevision:input.shiftRevision}:{changeReason:string(input.changeReason,2000)})}};
  }else{
   const key=c.action==='attendance.void'?'changeReason':'note';keys(input,[key],[key]);payload={action:c.action,input:{[key]:string(input[key],2000)}};
  }
  if(!creating)payload={...payload,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision};
 }else if(c.action==='leadership.assign'||c.action==='leadership.revoke'){
  const updating=Object.hasOwn(c,'recordId');
  if(updating&&(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)||!updating&&Object.hasOwn(c,'expectedRevision')||c.action==='leadership.revoke'&&!updating)throw new CommandError(400,'invalid_revision');
  if(c.action==='leadership.assign'){
   keys(input,['personId','area','start','end','note'],['personId','area','start','end','note']);
   for(const k of ['start','end']){const value=input[k];if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value.slice(0,10)+'T12:00:00Z'))||new Date(value.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new CommandError(400,'invalid_leadership_period');}
   payload={action:c.action,input:{personId:identifier(input.personId),area:string(input.area,100),start:instant(input.start),end:instant(input.end),note:string(input.note,2000)}};
  }else{keys(input,['note'],['note']);payload={action:c.action,input:{note:string(input.note,2000)}};}
  if(updating)payload={...payload,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision};
 }else if(typeof c.action==='string'&&c.action.startsWith('coverage.')){
  if(!['coverage.create','coverage.volunteer','coverage.withdraw-volunteer','coverage.withdraw','coverage.approve'].includes(c.action))throw new CommandError(400,'invalid_coverage_action');
  const creating=c.action==='coverage.create';
  if(creating&&(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))||!creating&&(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646))throw new CommandError(400,'invalid_revision');
  if(creating){keys(input,['shiftId','shiftRevision','note'],['shiftId','shiftRevision']);if(!Number.isSafeInteger(input.shiftRevision)||Number(input.shiftRevision)<1||Number(input.shiftRevision)>2147483646)throw new CommandError(400,'invalid_revision');}
  else if(c.action==='coverage.volunteer'){keys(input,['confirmed'],['confirmed']);if(input.confirmed!==true)throw new CommandError(400,'consent_confirmation_required');}
  else if(c.action==='coverage.approve'){keys(input,['personId','confirmed','note'],['personId','confirmed','note']);if(input.confirmed!==true)throw new CommandError(400,'consent_confirmation_required');}
  else keys(input,c.action==='coverage.withdraw'?['note']:[],[]);
  if(Object.hasOwn(input,'note')&&(typeof input.note!=='string'||input.note.trim().length>2000))throw new CommandError(400,'invalid_consent_note');
  payload={action:c.action,input:{...input,...(creating?{shiftId:identifier(input.shiftId)}:{}),...(c.action==='coverage.approve'?{personId:identifier(input.personId),note:string(input.note,2000)}:{}),...(typeof input.note==='string'?{note:input.note.trim()}:{})}};
  if(!creating)payload={...payload,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision};
 }else if(c.action==='request.consent'){
  keys(input,['accept'],['accept']);if(typeof input.accept!=='boolean'||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_swap_consent');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{accept:input.accept}};
 }else if(c.action==='shift.publish-batch'){
  keys(input,['weekStart','drafts','planningReview','confirmed','note','coverageAcknowledged','coverageNote'],['weekStart','drafts','planningReview','confirmed','note']);
  if(Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision')||input.confirmed!==true||!Array.isArray(input.drafts)||input.drafts.length<1||input.drafts.length>100||typeof input.planningReview!=='string'||!/^[0-9a-f]{64}$/.test(input.planningReview)||typeof input.weekStart!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart))throw new CommandError(400,'invalid_week_fields');
  const drafts=input.drafts.map(v=>{const d=object(v);keys(d,['id','revision','closing'],['id','revision','closing']);if(!Number.isSafeInteger(d.revision)||Number(d.revision)<1||Number(d.revision)>2147483646||!Array.isArray(d.closing)||d.closing.length>100)throw new CommandError(400,'invalid_week_selection');return {id:identifier(d.id),revision:Number(d.revision),closing:d.closing.map(v=>{const close=object(v);keys(close,['id','revision'],['id','revision']);if(!Number.isSafeInteger(close.revision)||Number(close.revision)<1||Number(close.revision)>2147483646)throw new CommandError(400,'invalid_week_selection');return {id:identifier(close.id),revision:Number(close.revision)};})};});
  if(Object.hasOwn(input,'coverageAcknowledged')&&typeof input.coverageAcknowledged!=='boolean'||Object.hasOwn(input,'coverageNote')&&(typeof input.coverageNote!=='string'||input.coverageNote.trim().length>2000))throw new CommandError(400,'invalid_week_fields');
  payload={action:c.action,input:{...input,drafts,note:string(input.note,2000)}};
 }else if(c.action==='staffing.save'||c.action==='staffing.approve'||c.action==='staffing.retire'){
  const updating=Object.hasOwn(c,'recordId');
  if(updating&&(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)||!updating&&Object.hasOwn(c,'expectedRevision')||c.action!=='staffing.save'&&!updating)throw new CommandError(400,'invalid_revision');
  if(c.action==='staffing.save'){
   keys(input,['area','title','position','start','end','minimum','source','note'],['area','title','position','start','end','minimum','source']);
   if(!Number.isSafeInteger(input.minimum)||Number(input.minimum)<1||Number(input.minimum)>100||Object.hasOwn(input,'note')&&(typeof input.note!=='string'||input.note.trim().length>2000))throw new CommandError(400,'invalid_staffing_value');
   payload={action:c.action,input:{area:string(input.area,100),title:string(input.title,200),position:string(input.position,100),start:instant(input.start),end:instant(input.end),minimum:input.minimum,source:string(input.source,2000),note:typeof input.note==='string'?input.note.trim():''}};
  }else{
   keys(input,c.action==='staffing.approve'?['note','confirmed']:['note'],c.action==='staffing.approve'?['note','confirmed']:['note']);
   if(c.action==='staffing.approve'&&input.confirmed!==true)throw new CommandError(400,'staffing_confirmation_required');
   payload={action:c.action,input:{note:string(input.note,2000),...(c.action==='staffing.approve'?{confirmed:true}:{})}};
  }
  if(updating)payload={...payload,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision};
 }else if(c.action==='shift.publish'){
  keys(input,['note'],['note']);
  if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_revision');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{note:string(input.note,2000)}};
 }else if(c.action==='goal.create'||c.action==='goal.transition'){
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
   keys(input,input.type==='swap'?['type','start','end','note','shiftId','replacementId','shiftRevision']:['type','start','end','note'],input.type==='swap'?['type','start','end','note','shiftId','replacementId']:['type','start','end','note']);
   if(!['time-off','swap'].includes(String(input.type))||Object.hasOwn(c,'recordId')||Object.hasOwn(c,'expectedRevision'))throw new CommandError(400,'invalid_time_off_fields');
   for(const k of ['start','end']){
    const value=input[k];
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
     ||!Number.isFinite(Date.parse(value.slice(0,10)+'T12:00:00Z'))||new Date(value.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new CommandError(400,'invalid_time_off_value');
   }
   if(input.type==='swap'&&Object.hasOwn(input,'shiftRevision')&&(!Number.isSafeInteger(input.shiftRevision)||Number(input.shiftRevision)<1||Number(input.shiftRevision)>2147483646))throw new CommandError(400,'invalid_revision');
   payload={action:c.action,input:{type:input.type,start:instant(input.start),end:instant(input.end),note:string(input.note,2000),...(input.type==='swap'?{shiftId:identifier(input.shiftId),replacementId:identifier(input.replacementId),...(Object.hasOwn(input,'shiftRevision')?{shiftRevision:input.shiftRevision}:{})}:{})}};
  }else{
   keys(input,['approve','note','affectedShifts','departmentConfirmed'],['approve','note']);
   if(Object.hasOwn(input,'departmentConfirmed')&&typeof input.departmentConfirmed!=='boolean')throw new CommandError(400,'invalid_swap_review');
   if(typeof input.approve!=='boolean'||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_time_off_review');
   let affectedShifts: {id:string;revision:number}[]|undefined;
   if(Object.hasOwn(input,'affectedShifts')){
    if(!Array.isArray(input.affectedShifts)||input.affectedShifts.length>100)throw new CommandError(400,'invalid_time_off_impact');
    affectedShifts=input.affectedShifts.map(v=>{const s=object(v);keys(s,['id','revision'],['id','revision']);if(!Number.isSafeInteger(s.revision)||Number(s.revision)<1||Number(s.revision)>2147483646)throw new CommandError(400,'invalid_time_off_impact');return {id:identifier(s.id),revision:Number(s.revision)};});
   }
   payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{approve:input.approve,note:string(input.note,2000),...(affectedShifts?{affectedShifts}:{}),...(Object.hasOwn(input,'departmentConfirmed')?{departmentConfirmed:input.departmentConfirmed}:{})}};
  }
 }else if(c.action==='shift.cancel'){
  keys(input,['note','closeTransfers'],['note']);
  if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<1||Number(c.expectedRevision)>2147483646)throw new CommandError(400,'invalid_schedule_record');
  if(input.closeTransfers!==undefined&&(!Array.isArray(input.closeTransfers)||input.closeTransfers.length>100))throw new CommandError(400,'invalid_close_transfers');
  const closeTransfers=(input.closeTransfers as unknown[]|undefined??[]).map(v=>{const t=object(v);keys(t,['closeId','closingRevision','shiftId','expectedRevision'],['closeId','closingRevision','shiftId','expectedRevision']);for(const k of ['closingRevision','expectedRevision'])if(!Number.isSafeInteger(t[k])||Number(t[k])<1||Number(t[k])>2147483646)throw new CommandError(400,'invalid_close_transfers');return {closeId:identifier(t.closeId),closingRevision:Number(t.closingRevision),shiftId:identifier(t.shiftId),expectedRevision:Number(t.expectedRevision)};});
  if(new Set(closeTransfers.map(t=>t.closeId)).size!==closeTransfers.length)throw new CommandError(400,'invalid_close_transfers');
  payload={action:c.action,recordId:identifier(c.recordId),expectedRevision:c.expectedRevision,input:{note:string(input.note,2000),closeTransfers}};
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
    command.payload.action==='shift.save-batch'
     ?'SELECT candidate_operations.save_schedule_batch($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='shift.copy-week'
     ?'SELECT candidate_operations.copy_schedule_week($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='leave.resolve'
     ?'SELECT candidate_operations.leave_review_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :String(command.payload.action).startsWith('correction.')
     ?'SELECT candidate_operations.completed_shift_correction_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :String(command.payload.action).startsWith('attendance.')
     ?'SELECT candidate_operations.attendance_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='shift.publish-batch'
     ?'SELECT candidate_operations.publish_week($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :String(command.payload.action).startsWith('staffing.')
     ?'SELECT candidate_operations.staffing_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='shift.publish'
     ?'SELECT candidate_operations.publish_shift($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :['goal.create','goal.transition'].includes(String(command.payload.action))
     ?'SELECT candidate_operations.goal_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='station.save'
     ?'SELECT candidate_operations.save_station($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :['leadership.assign','leadership.revoke'].includes(String(command.payload.action))
     ?'SELECT candidate_operations.leadership_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :typeof command.payload.action==='string'&&command.payload.action.startsWith('coverage.')
     ?'SELECT candidate_operations.schedule_consent_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :['request.create','request.review','request.consent'].includes(String(command.payload.action))
     ?'SELECT candidate_operations.schedule_request_command($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='shift.cancel'
     ?'SELECT candidate_operations.change_schedule($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
    :command.payload.action==='shift.save'
     ?'SELECT candidate_operations.save_shift($1,$2::uuid,$3,$4::uuid,$5::jsonb) AS result'
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
   if(command.payload.action==='shift.copy-week'){
    const selection=command.payload.input as ReturnType<typeof parseCopySelection>,expected=new Set([...selection.shifts.map(row=>'shift:'+row.id),...selection.staffing.map(row=>'staffing:'+row.id)]);
    if(result.recordId!==command.requestId||result.revision!==1||!Array.isArray(result.items)||result.items.length!==expected.size)throw new Error('invalid_copy_result');
    let saved=0;for(const item of result.items){const key=item?.kind+':'+item?.id;
     if(!expected.delete(key)||!['saved','rejected'].includes(item.status)||!Array.isArray(item.issues)||item.status==='saved'&&(!uuid.test(item.recordId)||item.revision!==1||item.issues.length)||item.status==='rejected'&&(!item.issues.length||item.recordId!==undefined))throw new Error('invalid_copy_result');
     if(item.status==='saved')saved++;
    }
    if(result.savedCount!==saved||result.rejectedCount!==result.items.length-saved||!Number.isSafeInteger(result.scheduleRevision)||!Number.isSafeInteger(result.inputRevision))throw new Error('invalid_copy_result');
   }
   if(command.payload.action==='shift.save-batch'){
    const selection=command.payload.input as ReturnType<typeof parseBatchSelection>,expected=new Map(selection.drafts.map(row=>[row.id,row.revision]));
    if(result.recordId!==command.requestId||result.revision!==1||!Array.isArray(result.items)||result.items.length!==expected.size)throw new Error('invalid_batch_result');
    let saved=0;for(const item of result.items){
     const revision=expected.get(item?.id);
     if(revision===undefined||item.kind!=='shift'||item.sourceRevision!==revision||!['saved','rejected'].includes(item.status)||!Array.isArray(item.issues)
      ||item.status==='saved'&&(item.recordId!==item.id||item.revision!==revision+1||item.issues.length)
      ||item.status==='rejected'&&(!item.issues.length||item.recordId!==undefined))throw new Error('invalid_batch_result');
     expected.delete(item.id);if(item.status==='saved')saved++;
    }
    if(result.savedCount!==saved||result.rejectedCount!==result.items.length-saved||!Number.isSafeInteger(result.scheduleRevision)||!Number.isSafeInteger(result.inputRevision))throw new Error('invalid_batch_result');
   }
   return result as TaskResult;
  });
 } catch(error) {
  const e=error as {code?:string;message?:string};
  if(e.code==='XX000'&&e.message==='batch_booking_invariant_failure')throw new CommandError(500,'internal_invariant');
  if(e.code==='P0001'&&['copy_review_changed','batch_review_changed'].includes(e.message??''))throw new CommandError(409,e.message!);
  if(e.code==='42501') throw new CommandError(403,e.message??'denied');
  if(e.code==='P0001'&&['leave_review_changed','leave_review_resolved','leave_review_source_unavailable','leave_review_evidence_changed','correction_source_ineligible','correction_source_conflict','correction_pending','correction_not_pending','correction_history_limit','correction_no_change','ownership_notice_unresolved','attendance_duplicate','attendance_source_ineligible','attendance_voided','attendance_history_limit','attendance_already_reviewed','attendance_not_reviewed','request_payload_conflict','revision_conflict','phase_conflict','shift_ended','active_shift_time_conflict','shift_conflict','closing_zone_conflict','attention_pending','attention_not_pending','checkout_pending','dish_cycle_conflict','dish_shape_conflict','availability_replacement_conflict','availability_shift_conflict','draft_reference_only','schedule_inputs_incomplete','station_assignment_not_migrated','shift_overlap','approved_time_off_conflict','linked_shift_protected','linked_task_pending','linked_close_protected','time_off_impact_conflict','time_off_cancellation_not_migrated','station_name_immutable','station_title_conflict','station_setup_reference_only','goal_guide_changed','publication_review_required','publication_linked_work_held','station_goal_reviewer_unavailable','staffing_overlap','staffing_publication_review_required','closing_publication_review_required','planning_review_conflict','weekly_scope_review_required','closing_selection_conflict','closing_transfer_selection_conflict','completed_close_protected','coverage_offer_exists','offer_changed','volunteer_missing','volunteer_conflict','replacement_consent_required','replacement_no_longer_eligible'].includes(e.message??''))
   throw new CommandError(409,e.message??'conflict');
  if(e.code?.startsWith('22')||e.code==='23514') throw new CommandError(400,e.message??'invalid_command');
  throw error; // Network/database failures must remain failures, never confirmed empty or applied.
 }
}
