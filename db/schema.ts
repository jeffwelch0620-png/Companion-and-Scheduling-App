import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const companionDailyUsage=sqliteTable('companion_daily_usage',{
 locationId:text('location_id').notNull().references(()=>locations.id),
 day:text('day').notNull(),
 count:integer('count').notNull().default(0),
},table=>[primaryKey({columns:[table.locationId,table.day]})]);

// A random browser session is linked to one explicitly approved membership.
// Any membership revision change invalidates it, including archive and rehire.
export const employeeSessions=sqliteTable('employee_sessions',{
  tokenHash:text('token_hash').primaryKey(),
  authUserId:text('auth_user_id').notNull(),
  memberId:text('member_id').notNull().references(()=>memberships.id),
  memberRevision:integer('member_revision').notNull(),
  createdAt:integer('created_at').notNull(),
  expiresAt:integer('expires_at').notNull(),
},t=>[index('employee_sessions_expiry').on(t.expiresAt)]);

export const employeeSetupCodes=sqliteTable('employee_setup_codes',{
  memberId:text('member_id').primaryKey().references(()=>memberships.id),
  codeHash:text('code_hash').notNull(),
  memberRevision:integer('member_revision').notNull(),
  issuedBy:text('issued_by').notNull().references(()=>memberships.id),
  createdAt:integer('created_at').notNull(),
  expiresAt:integer('expires_at').notNull(),
  usedAt:integer('used_at'),
  sessionHash:text('session_hash'),
},t=>[uniqueIndex('employee_setup_code_hash').on(t.codeHash)]);
export const employeeLoginLimits=sqliteTable('employee_login_limits',{
  key:text('key').primaryKey(),windowStart:integer('window_start').notNull(),
  count:integer('count').notNull(),expiresAt:integer('expires_at').notNull(),
});

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  weekStartsOn: integer('week_starts_on').notNull().default(1),
  revision: integer('revision').notNull().default(0),
  lastCommand: text('last_command'),
});

// Membership is provisioned by an administrator, never by a role picker or first login.
export const memberships = sqliteTable('memberships', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  authUserId: text('auth_user_id'),
  locationId: text('location_id').notNull().references(() => locations.id),
  name: text('name').notNull(),
  area: text('area').notNull(),
  position: text('position').notNull(),
  capabilities: text('capabilities').notNull().default('[]'),
  qualifications: text('qualifications').notNull().default('[]'),
  active: integer('active').notNull().default(1),
  // Scheduling records can exist before an employee is approved for sign-in.
  scheduleOnly: integer('schedule_only').notNull().default(0),
  scheduleJobs: text('schedule_jobs').notNull().default('[]'),
  employment: text('employment').notNull().default('{"status":"active","hireDate":null,"endedDate":null,"departureReason":null,"archivedAt":null}'),
  revision: integer('revision').notNull().default(1),
}, t => [uniqueIndex('membership_identity').on(t.email, t.locationId).where(sql`${t.email} <> ''`), uniqueIndex('membership_auth_identity').on(t.authUserId, t.locationId)]);

// Only deployment administration can assign the two owner seats or commissary.
export const restaurantAccess = sqliteTable('restaurant_access', {
 authUserId:text('auth_user_id').primaryKey(),
 kind:text('kind').notNull(),
 homeLocationId:text('home_location_id').notNull().references(()=>locations.id),
 revision:integer('revision').notNull().default(1),
},t=>[uniqueIndex('restaurant_access_owner_seat').on(t.kind).where(sql`${t.kind} IN ('jay','rudd')`)]);

export const records = sqliteTable('records', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().references(() => locations.id),
  kind: text('kind').notNull(),
  ownerId: text('owner_id').notNull().references(() => memberships.id),
  area: text('area').notNull(),
  revision: integer('revision').notNull(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
  archivedAt: text('archived_at'),
  archivedBy: text('archived_by'),
}, t => [index('records_location').on(t.locationId, t.kind),index('records_history').on(t.locationId,t.archivedAt,t.id)]);

export const commandReceipts = sqliteTable('command_receipts', {
  locationId: text('location_id').notNull().references(() => locations.id),
  actorId: text('actor_id').notNull().references(() => memberships.id),
  requestId: text('request_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  result: text('result').notNull(),
}, t => [primaryKey({ columns: [t.locationId, t.actorId, t.requestId] })]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().references(() => locations.id),
  actorId: text('actor_id').notNull().references(() => memberships.id),
  action: text('action').notNull(),
  recordId: text('record_id').notNull(),
  at: text('at').notNull(),
  revision: integer('revision').notNull(),
}, t => [index('audit_location').on(t.locationId, t.at)]);

// The latest normalized read is a review source, never employee access or payroll.
export const toastRosters=sqliteTable('toast_rosters',{
  locationId:text('location_id').primaryKey().references(()=>locations.id),
  restaurantGuid:text('restaurant_guid').notNull(),
  data:text('data').notNull(),
  retrievedAt:text('retrieved_at').notNull(),
  requestedBy:text('requested_by').notNull().references(()=>memberships.id),
});
export const integrationAttempts=sqliteTable('integration_attempts',{
  locationId:text('location_id').notNull().references(()=>locations.id),
  provider:text('provider').notNull(),
  token:text('token').notNull(),
  startedAt:integer('started_at').notNull(),
},t=>[primaryKey({columns:[t.locationId,t.provider]})]);

// Complete exported weeks are administrator-only source snapshots. Employee
// names are not account identifiers and these records cannot publish shifts.
export const scheduleImports=sqliteTable('schedule_imports',{
  id:text('id').primaryKey(),
  locationId:text('location_id').notNull().references(()=>locations.id),
  weekStart:text('week_start').notNull(),
  sourceHash:text('source_hash').notNull(),
  data:text('data').notNull(),
  importedAt:text('imported_at').notNull(),
  importedBy:text('imported_by').notNull().references(()=>memberships.id),
  transferredAt:text('transferred_at'),
},t=>[uniqueIndex('schedule_import_source').on(t.locationId,t.weekStart,t.sourceHash)]);

// Reviewed roster decisions are separate from live access. Saving a draft never
// provisions a membership. Applied links retain the precise upstream identity.
export const accessReviews=sqliteTable('access_reviews',{
  id:text('id').primaryKey(),
  locationId:text('location_id').notNull().references(()=>locations.id),
  restaurantGuid:text('restaurant_guid').notNull(),
  employeeId:text('employee_id').notNull(),
  sourceAt:text('source_at').notNull(),
  source:text('source').notNull(),
  data:text('data').notNull(),
  status:text('status').notNull(),
  memberId:text('member_id').references(()=>memberships.id),
  revision:integer('revision').notNull(),
  updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('access_review_source').on(t.locationId,t.restaurantGuid,t.employeeId),uniqueIndex('access_review_member').on(t.locationId,t.memberId)]);

export const accessChanges=sqliteTable('access_changes',{
  id:text('id').primaryKey(),
  locationId:text('location_id').notNull().references(()=>locations.id),
  actorId:text('actor_id').notNull().references(()=>memberships.id),
  targetId:text('target_id').notNull(),
  action:text('action').notNull(),
  before:text('before'),
  after:text('after').notNull(),
  note:text('note').notNull(),
  at:text('at').notNull(),
},t=>[index('access_changes_location').on(t.locationId,t.at)]);

// Delivery evidence is committed with the Inbox message, never before it.
export const reviewReminders=sqliteTable('review_reminders',{
  locationId:text('location_id').notNull().references(()=>locations.id),
  reviewId:text('review_id').notNull().references(()=>records.id),
  stage:text('stage').notNull(),
  responsibleId:text('responsible_id').notNull(),
  recipientId:text('recipient_id').notNull().references(()=>memberships.id),
  milestone:integer('milestone').notNull(),
  originalDueDate:text('original_due_date').notNull(),
  messageId:text('message_id').notNull().references(()=>records.id),
  at:text('at').notNull(),
},t=>[primaryKey({columns:[t.locationId,t.reviewId,t.stage,t.responsibleId,t.recipientId,t.milestone]})]);

export const reviewReminderRuns=sqliteTable('review_reminder_runs',{
  locationId:text('location_id').primaryKey().references(()=>locations.id),
  checkedAt:text('checked_at').notNull(),
  scheduledAt:text('scheduled_at'),
  delivered:integer('delivered').notNull(),
  issues:text('issues').notNull(),
});

// Private conversations never enter shared work records, manager views or Inbox.
export const companionConversations=sqliteTable('companion_conversations',{
  locationId:text('location_id').notNull().references(()=>locations.id),
  memberId:text('member_id').notNull().references(()=>memberships.id),
  id:text('id').notNull(),revision:integer('revision').notNull().default(1),
  membershipRevision:integer('membership_revision').notNull(),
  pendingRequest:text('pending_request'),leaseUntil:integer('lease_until').notNull().default(0),
  lastStarted:integer('last_started').notNull().default(0),
  explanationStyle:text('explanation_style').notNull().default('balanced'),
},t=>[primaryKey({columns:[t.locationId,t.memberId]})]);
export const companionTurns=sqliteTable('companion_turns',{
  locationId:text('location_id').notNull().references(()=>locations.id),memberId:text('member_id').notNull().references(()=>memberships.id),
  requestId:text('request_id').notNull(),conversationId:text('conversation_id').notNull(),fingerprint:text('fingerprint').notNull(),
  question:text('question').notNull(),answer:text('answer').notNull().default(''),status:text('status').notNull(),
  sources:text('sources').notNull().default('[]'),scope:text('scope').notNull().default('[]'),
  focus:text('focus'),memoryRefs:text('memory_refs').notNull().default('[]'),
  error:text('error').notNull().default(''),model:text('model').notNull().default(''),at:text('at').notNull(),
},t=>[primaryKey({columns:[t.locationId,t.memberId,t.requestId]}),index('companion_turn_conversation').on(t.locationId,t.memberId,t.conversationId,t.at)]);
export const companionLimits=sqliteTable('companion_limits',{
  locationId:text('location_id').notNull().references(()=>locations.id),memberId:text('member_id').notNull().references(()=>memberships.id),
  hour:integer('hour').notNull(),count:integer('count').notNull().default(0),
},t=>[primaryKey({columns:[t.locationId,t.memberId]})]);

// Archived conversations remain private and may supply scoped recall excerpts.
export const companionArchives=sqliteTable('companion_archives',{
  locationId:text('location_id').notNull().references(()=>locations.id),
  memberId:text('member_id').notNull().references(()=>memberships.id),
  id:text('id').notNull(),membershipRevision:integer('membership_revision').notNull(),
  title:text('title').notNull(),archivedAt:text('archived_at').notNull(),
  turnCount:integer('turn_count').notNull(),
},t=>[primaryKey({columns:[t.locationId,t.memberId,t.id]}),index('companion_archive_page').on(t.locationId,t.memberId,t.archivedAt,t.id)]);


// A setup code may connect the same person's existing browser account to the
// internal principal. Both identities retain one membership and one history.
export const browserIdentityLinks=sqliteTable('browser_identity_links',{
  subjectId:text('subject_id').primaryKey(),
  principalId:text('principal_id').notNull(),
  linkedAt:integer('linked_at').notNull(),
},t=>[uniqueIndex('browser_identity_principal').on(t.principalId)]);

// Encrypted server-only Toast tokens. No roster or workspace response reads this table.
export const toastAuthCache=sqliteTable('toast_auth_cache',{
 cacheKey:text('cache_key').primaryKey(),
 encryptedToken:text('encrypted_token').notNull().default(''),
 expiresAt:integer('expires_at').notNull().default(0),
 retryAt:integer('retry_at').notNull().default(0),
 leaseId:text('lease_id').notNull(),
});

// A verified browser identity requests access; a different administrator approves it.
// Existing code-only owners keep their access until recovery is explicitly approved.
export const administratorRequests=sqliteTable('administrator_requests',{
  memberId:text('member_id').primaryKey().references(()=>memberships.id),
  requestId:text('request_id').notNull(),
  kind:text('kind').notNull(),
  status:text('status').notNull(),
  memberRevision:integer('member_revision').notNull(),
  requestedAuthUserId:text('requested_auth_user_id'),
  browserSubject:text('browser_subject'),
  verifiedEmail:text('verified_email'),
  createdAt:text('created_at').notNull(),
  verifiedAt:text('verified_at'),
  expiresAt:text('expires_at').notNull(),
});

// Food is a separately paged domain. Daily operations never load its catalog/history.
export const foodRecords=sqliteTable('food_records',{
 id:text('id').primaryKey(),locationId:text('location_id').notNull().references(()=>locations.id),
 kind:text('kind').notNull(),dataset:text('dataset').notNull(),sourceRestaurantId:text('source_restaurant_id').notNull(),sourceKey:text('source_key').notNull(),
 title:text('title').notNull(),storageArea:text('storage_area').notNull().default(''),
 ownerId:text('owner_id').notNull().references(()=>memberships.id),area:text('area').notNull(),revision:integer('revision').notNull(),
 data:text('data').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('food_source_key').on(t.locationId,t.dataset,t.kind,t.sourceKey),index('food_page').on(t.locationId,t.dataset,t.kind,t.id)]);
export const foodHistory=sqliteTable('food_history',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),locationId:text('location_id').notNull().references(()=>locations.id),
 recordId:text('record_id').notNull().references(()=>foodRecords.id),revision:integer('revision').notNull(),actorId:text('actor_id').notNull(),at:text('at').notNull(),event:text('event').notNull(),
},t=>[uniqueIndex('food_history_revision').on(t.recordId,t.revision),index('food_history_page').on(t.locationId,t.recordId,t.sequence)]);
export const foodState=sqliteTable('food_state',{
 locationId:text('location_id').primaryKey().references(()=>locations.id),revision:integer('revision').notNull().default(0),lastCommand:text('last_command'),
});
export const foodSources=sqliteTable('food_sources',{
 locationId:text('location_id').notNull().references(()=>locations.id),dataset:text('dataset').notNull(),sourceRestaurantId:text('source_restaurant_id').notNull(),
},t=>[primaryKey({columns:[t.locationId,t.dataset]})]);
export const foodReceipts=sqliteTable('food_receipts',{
 locationId:text('location_id').notNull().references(()=>locations.id),actorId:text('actor_id').notNull().references(()=>memberships.id),requestId:text('request_id').notNull(),fingerprint:text('fingerprint').notNull(),result:text('result').notNull(),
},t=>[primaryKey({columns:[t.locationId,t.actorId,t.requestId]})]);

// Explicitly reconciled restaurant routes. Empty by default; never infer cross-store access from names.
export const foodTransferRoutes=sqliteTable('food_transfer_routes',{
 sourceId:text('source_id').notNull().references(()=>locations.id),destinationId:text('destination_id').notNull().references(()=>locations.id),
 dataset:text('dataset').notNull(),active:integer('active').notNull().default(0),
},t=>[primaryKey({columns:[t.sourceId,t.destinationId,t.dataset]})]);
export const foodTransfers=sqliteTable('food_transfers',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull(),sourceId:text('source_id').notNull().references(()=>locations.id),
 destinationId:text('destination_id').notNull().references(()=>locations.id),dataset:text('dataset').notNull(),referenceKey:text('reference_key').notNull(),
 revision:integer('revision').notNull(),status:text('status').notNull(),data:text('data').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('food_transfer_id').on(t.id),index('food_transfer_source').on(t.sourceId,t.dataset,t.sequence),index('food_transfer_destination').on(t.destinationId,t.dataset,t.sequence),index('food_transfer_reference').on(t.sourceId,t.dataset,t.referenceKey)]);
export const foodTransferEvents=sqliteTable('food_transfer_events',{
 transferId:text('transfer_id').notNull().references(()=>foodTransfers.id),revision:integer('revision').notNull(),event:text('event').notNull(),
},t=>[primaryKey({columns:[t.transferId,t.revision]})]);

// Original valid UTF-8 CSV, preserving BOM and line endings. Never loaded by catalog/day reads.
export const invoiceFiles=sqliteTable('invoice_files',{
 locationId:text('location_id').notNull().references(()=>locations.id),dataset:text('dataset').notNull(),sha256:text('sha256').notNull(),
 fileName:text('file_name').notNull(),byteLength:integer('byte_length').notNull(),rowCount:integer('row_count').notNull(),csv:text('csv').notNull(),
 createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull().references(()=>memberships.id),
},t=>[primaryKey({columns:[t.locationId,t.dataset,t.sha256]})]);

// Prep workflow state references canonical Food sources in its versioned snapshots.
export const foodWorkflows=sqliteTable('food_workflows',{
 id:text('id').primaryKey(),locationId:text('location_id').notNull().references(()=>locations.id),dataset:text('dataset').notNull(),kind:text('kind').notNull(),naturalKey:text('natural_key').notNull(),revision:integer('revision').notNull(),status:text('status').notNull(),data:text('data').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('food_workflow_natural').on(t.locationId,t.dataset,t.kind,t.naturalKey),index('food_workflow_page').on(t.locationId,t.dataset,t.kind,t.updatedAt)]);
export const foodWorkflowEvents=sqliteTable('food_workflow_events',{
 workflowId:text('workflow_id').notNull().references(()=>foodWorkflows.id),revision:integer('revision').notNull(),event:text('event').notNull(),
},t=>[primaryKey({columns:[t.workflowId,t.revision]})]);
