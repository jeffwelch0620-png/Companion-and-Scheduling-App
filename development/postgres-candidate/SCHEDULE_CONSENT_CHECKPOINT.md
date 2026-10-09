# Coverage volunteers and named replacement consent

Isolated preparation from published-schedule baseline `0a3c7d2`. Additive migration 032 preserves migrations 001–031. No active Companion cutover, Inventory merge, hosted database application or deployment is included.

## Responsibility and approval

`coverage.create` offers the owner's current, unreleased published shift before it starts. One open coverage offer is allowed per shift. Coworkers explicitly confirm the stated times and closing duties when volunteering; they can withdraw before approval, and the original employee can withdraw the offer. None of these actions changes the published employee assignment.

`request.create` with type `swap` names a replacement. Only that employee can accept or decline through `request.consent`. Acceptance sends the request to independent review and leaves ownership unchanged. An authorized leader can decline a pending request; approval requires prior acceptance. The existing time-off request path remains separate and retains its previous rules.

Both approval paths require an independent reviewer with current published-change authority covering the original and replacement departments/period. Current employee/job/station eligibility, overlaps, approved restrictions and complete candidate scheduling inputs are rechecked. A volunteer must still be volunteering. Closing clearance and independent checkers remain required. Approved replacement changes use migration 031's transaction path: closing submission resets, station learning receipts, protected completed closes and linked checkout tasks remain enforced. Imported shift-reference approval remains held by that shared path.

## Consent snapshots and invalidation

Offers capture the shift revision, owner, department, job, times and complete noncancelled closing-duty snapshot. Closing snapshots use stable UTC instants so different database session time zones cannot invalidate unchanged work.

Shift/closing/guide/owner changes invalidate stale offers with an audit event and notification intents in the same transaction. Physical readiness/checking changes that leave the captured duties unchanged do not by themselves invalidate consent. Eligibility changes are checked again at approval. Elapsed start time makes coverage unavailable when read or acted on; there is no background timer delivery service.

The original coverage model already requires current shift and duty snapshots. This candidate also binds named swaps to exact shift/duty snapshots and marks changed swaps invalidated, requiring a fresh request and consent. That strengthens the source swap path, which primarily compares owner and shift times. The candidate `invalidated` swap state and snapshot presentation must be supported explicitly during future scheduling UI adoption; the current UI has not been connected to these endpoints.

## Scoped reads and reliable submission

Authenticated `/schedule-coverage` and `/schedule-swaps` reads filter scope/visibility before pagination. Owners and scoped scheduling coordinators see coverage notes and history. Other eligible coworkers see only their own volunteer entry, with private notes/history and other volunteers hidden. Swap reads are limited to participants and scoped scheduling coordinators. The existing `/schedule-requests` endpoint continues to serve time off only.

Restaurant-first locks, exact offer revisions and command receipts protect concurrent submissions. Approval, shared shift/closing effects, invalidation of competing offers, history, notification intents and parent/child receipts commit together. Replay rechecks active trusted identity and current reviewer authority, including replacement department scope. Automatic invalidation events identify a system action with no impersonated employee actor. Runtime cannot write raw offer/audit/outbox tables or invoke private invalidation helpers.

Notifications are durable intents; real delivery remains pending. Unconfigured labor/minor rules or proficiency scores are not treated as clearance evidence. Source ingestion, real authentication adoption, offline consent and full UI adoption remain pending.

## Validation and next step

Local validation passed: fresh application of all 32 migrations, all 358 serial candidate checks, strict adapter types, original-form preview build and coverage inventory. Twenty focused checks cover original source eligibility/privacy parity, stable timestamps, cross-department replay, offer ownership/current versions, confirmation, scoped paging, withdrawals, independent approval, current restrictions and clearance, automatic invalidation, closing readiness, protected linked work, concurrent retries, late failure rollback, swap acceptance/decline, authenticated endpoints and direct SQL validation/private access.

Next: dated leadership assignment and complete scheduling workspace/form adoption. M06 remains open; Inventory integration waits for its tested baseline and reviewed identity/schema contracts.
