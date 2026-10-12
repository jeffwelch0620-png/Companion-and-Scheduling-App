# Retrospective time-off review candidate

This focused draft starts from accepted PR43 main `3022ff6`, whose merged-main CI passed 766/766 tests. Corrective migration 058 adds manager review of migration 040's existing time-off flags. Published 001–057 remain immutable. This package requires separate review and merge approval. It does not adopt PostgreSQL into the active app, apply a hosted migration, deliver notifications or change Inventory.

## Owner-selected rules

- An authorized manager at the affected store may review a cross-store flag using only approved-leave dates/status and identifiers needed to reference the request. No origin-store membership is required. Origin membership, department, private request note and approval narrative are excluded from reads. The origin command remains the authority for leave approval.
- An authorized manager may resolve a flag concerning their own person, with a required recorded reason. This closes a review obligation only. Attendance policy and the distinct-person approval requirement for a completed planned-shift correction are unchanged.
- Explicit `schedule.manage` is required, with department authority over both the original and current shift (or `location.manage`). Active membership, current authenticated person and configured checkout-role exclusion are enforced at every read/write/replay. Titles alone grant nothing; schedule-only members and employees cannot read this manager queue.

## What resolution records

The original flag, shift revision and snapshot remain immutable. New flags capture the original person/membership, department, store timezone, local date and employee name. Existing flags are backfilled with provenance `migration058`: their names are labelled as captured during migration, not invented as historical names. Existing resolved flags without an audit retain that legacy limitation explicitly.

One `leave.resolve` command changes pending to resolved, records a required reason, reviewer person/membership/name, server time, source context and optional evidence references, and creates one immutable before/after event and original-command receipt in the same transaction. It changes neither the request nor the shift, bookings, attendance, completed-shift corrections or ownership-notification intents. An ended unpublished draft resolves as reviewed planning history; it is never retrospectively published or converted to attendance. A future uncancelled cross-store shift remains held for schedule-conflict handling.

Attendance remains a separate confirmed operation. The detail can open eligible current published-shift attendance, with its existing permission checks and form. Reassigned-person and unpublished/cancelled sources offer no recording shortcut for the original flagged person. A leave request alone proves neither absence, hours worked, physical completion nor pay.

Optional attendance/correction references must belong to the same original person, affected store and shift, have the reviewed revision, and be independently readable by the resolver. Resolution does not grant evidence access. Reads filter retained references when that separate access is later revoked, while the immutable private audit preserves what was reviewed. Private attendance narratives are not copied into the leave board. Reviewers should keep resolution reasons operational and minimal.

## Coordination and freshness

Commands acquire affected-store coordination before rows, then coordinate a foreign origin with NOWAIT. A `40001 scope_coordination_retry` requires retrying the whole transaction with the same original request ID/payload. Reads use the existing authenticated nonlocking repeatable-read HTTP path. Read/replay authority is always checked again; receipt lookup precedes mutable source/status/evidence checks.

A review token binds the flag revision, stable original/current shift field set and minimal current approved-leave facts. Meaningful source changes require reload; adding an unrelated shift table column does not invalidate review. Timestamp comparisons normalize the saved offset to the same real instant, so a server/session timezone change does not create a false source-change warning. The original snapshot remains unchanged. Source identity drift or no longer approved leave holds resolution for reconciliation. An explicitly reviewed changed shift can close the original obligation without modifying that shift.

The separate `leave_review_revision` changes on flag insertion/resolution, while the global workspace revision still changes on commands. Resolution leaves scheduling, source-input, attendance and correction counters unchanged. The UI fences queue pages with the leave revision and current viewer authorization, and double-reads details before offering a decision. The server revalidates tokens and evidence under coordinated locks. Other-store leave/source changes may stale a visible token without bumping the local flag counter; the command then refuses it and requires reload.

## Private UI and paging

The queue is a separate private `leave-review` projection, not a new shared WorkRecord kind or ordinary employee workspace record. It defaults to all pending dates so old unresolved obligations are not silently hidden. Each page contains at most 50 authorized flags, with explicit next/first-page controls. Optional paired inclusive dates filter the captured original local date (including DST), and status selects pending/resolved/all. Page totals are never presented as all-history totals. Malformed items are isolated with no actions; a malformed page/fence or changed authorization holds the read.

The detail presents original/current shift, minimal approved leave, retained capture provenance, source warnings, required reason/confirmation and optional authorized references. Uncertain saves retain the exact in-memory command for replay; private review payloads are not added to the employee offline queue or persisted on the device. A reload loses that in-memory request and requires checking current resolved history before starting another review.

## Validation and adoption limits

Fresh fictional PostgreSQL 17 application, manifest/snapshot checks, backend/HTTP/client/rendered regressions, candidate strict types and preview builds are required before pushing. Tests cover cross-store privacy, own-person resolution, stale source/evidence, replay/competing commands, atomic failure, origin coordination, date/DST paging, denied read access and separately authorized evidence. The fictional preview seeds approved requests through commands.

Before shared adoption, replace candidate identity/authz with the shared employee and ownership repositories; verify source completeness and historical identity retention; reconcile these forms into the original app; design retention and any resolution reopening/correction policy; test actual device/logout/reload recovery and notification delivery separately. No attendance or Inventory labor consumer derives hours from leave flags. The Inventory port still requires its exact tested baseline and separately approved integration work.

Local validation: fresh fictional PostgreSQL 17 migrations through 058 and snapshot/hash checks passed. All 25 new leave backend/HTTP/client/rendered checks and 8 original adapter checks passed (33/33). Strict types, workflow coverage inventory and preview build passed. The broader initial run exposed the offset-warning regression and a missing local psql path; both were corrected and the affected checks rerun. Exact-head full CI is tracked on the draft PR. Actual isolated browser rehearsal verified employee control exclusion, own-person resolution with a reason, resolved-history browsing and retained reviewer/time/reason. Database readback confirmed one self-resolution event, zero source-shift changes and zero attendance/correction entries in that preview store. Runtime screenshots and session fixtures remain ignored.
