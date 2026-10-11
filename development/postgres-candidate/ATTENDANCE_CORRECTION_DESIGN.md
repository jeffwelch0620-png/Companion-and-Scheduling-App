# Companion Attendance and Completed Shift Correction Design

Port the existing manager attendance workflow to the PostgreSQL candidate first. Add a separate correction history for ended shifts under the owner-selected correction authority and approval rules below. Preserve completed closing work, task verification, receipts and original schedule history throughout. These workflows record reported facts and reviewed changes; they do not establish hours worked or change payroll.

## Scope and acceptance

This design has normally incorporated accepted PR38 main `ddb2f78`. PR37 published editing was accepted at `05db4b1` with 630/630 merged-main checks; PR38 closing transfers and the published-action privacy correction were accepted at `ddb2f78` with 660/660 merged-main checks. Relative to that accepted baseline, this PR changes documentation only: published migrations 001–052, the manifest, function snapshot, application code and candidate runtime are unchanged. Owner policy selections below are recorded separately from design acceptance; neither implements a permission grant or authorizes implementation.

Attendance and correction implementation must use the tracked candidate package and a new corrective migration: use the next free number after the accepted chain at implementation time. The currently accepted chain ends at 052; recheck the chain immediately before choosing a number. Never skip or replace published migrations. Implementation, Git acceptance, hosted database application and Inventory integration remain separate steps.

## Existing workflows to preserve

| Workflow | Existing behavior | PostgreSQL preparation |
| --- | --- | --- |
| Attendance entry | Manager records a call-in, no-show, late arrival, early departure or other note against a published, noncancelled shift | Preserve the categories, current source revision and original employee and shift snapshot |
| Attendance correction | Manager corrects an active entry with a reason; earlier values remain in history | Save an append-only event with before and after values; reopen manager review |
| Void entry | Manager voids a mistaken entry with a reason; history stays available | Retain the entry and events; exclude it from current pattern counts |
| Manager review | Manager records follow-up, then may reopen review with a reason | Keep review status separate from reported facts and scheduling state |
| Ended shift correction | Ordinary candidate edit/cancel commands refuse ended shifts | Add a separately authorized correction ledger; keep ordinary commands protected |
| Retrospective leave flag | Approved leave overlapping an ended shift records a pending flag and preserves that shift | Review the flag explicitly; never turn it automatically into attendance, absence or completed work |

The existing attendance audience is managers with `location.manage` or department-scoped `people.manage`. Schedule publication/change permission alone does not grant attendance access. Candidate enforcement must also require an active, nonschedule-only actor and use the configured checkout position instead of the legacy hard-coded role label. Attendance history remains private to authorized managers; this port does not add employee visibility or self-service reporting.

An attendance entry keeps its original employee identity, department, shift revision and planned start/end/job after later reassignment or cancellation. Display names come from the shared employee repository at read time. Preserve the captured historical name separately and label it "name at time of entry"; a current name change must not rewrite that snapshot. Candidate fixtures resolve current names through candidate identity until the shared identity port exists. Creating a new entry requires a published, noncancelled shift; an ended or released published shift remains eligible under the existing attendance rules. Correcting or voiding an existing entry remains possible after its source shift changes. An expired unpublished draft is not eligible for an attendance entry.

Reported time may be at most 60 seconds ahead of the server clock, matching the existing rule. A no-show cannot be reported before the captured scheduled start. Only one current entry of each attendance type is permitted per original employee and shift; changing a type must check that uniqueness again. Contact, coverage and emergency facts retain explicit unknown values. Existing contact guidance must not become an additional database gate during the port. Counts and timing bands support individual manager review without assigning penalties or inferring an emergency classification.

## Attendance data and command contract

Use a scoped attendance table for the current entry and a separate event table for immutable history. Store the original employee membership/person identity, department and shift snapshot at creation. Capture the store timezone with the snapshot so a later configuration change does not reinterpret historical local dates. Preserve existing names as snapshots; use stable ids for authorization and reconciliation.

Support `attendance.record`, `attendance.correct`, `attendance.void`, `attendance.review` and `attendance.reopen`. Recording supplies the shift id and exact source revision. Later commands supply the attendance id and its exact revision. Validate allowed keys, category, timestamps, facts and reason lengths on the server. Keep the existing 1,000-history-entry limit; page history reads rather than returning an unbounded payload. A correction clears the current review while preserving its previous review in the event. Voiding preserves the full entry and previous review.

Each command uses `lock_scope`, trusted signed identity, current department authority, a frozen request id and an exact payload receipt. On replay, return the existing result subject to current access instead of adding another event. Coordinate policy writers and retry the whole transaction on `40001` with the original request identity. An event, entry revision, receipt and any applicable notification intent commit together. Restricted runtime credentials cannot write tables directly or bypass entry points.

Provide a manager-only paged list, detail and history reads under one read-only repeatable-read transaction per request. Filter store and department before pagination or aggregation. The schedule viewer must expose the relevant server-computed attendance actions and allow historical published shift access for eligible people managers; it must not expose private notes in general employee shift reads. A read helper must not acquire command or policy row locks.

Attendance writes may advance the general workspace revision. They must not change scheduling or source-input revisions, invalidate weekly publication review, change a shift, transfer coverage, approve time off, release checkout responsibility or alter completed work. Attendance pattern totals use current entries and distinct original shifts and must indicate whether a date range is fully loaded.

Published-change and cancellation reviews bind the relevant record revisions, not exact equality to the global workspace revision. PR38's follow-up accepts a valid review workspace revision at least as new as the loaded workspace while requiring the original shift revision and unfinished closing count to match. Submission still binds exact source, closing and receiving-shift revisions and rechecks policy under coordination. An unrelated attendance write must not prevent reviewing or submitting a still-current schedule change. Receiving-shift revisions do not advance merely because closing responsibility transfers to them; the closing/workspace revisions expose that transfer.

## Proposed ended shift correction workflow

Preserve the canonical ended shift and every existing link. Store a correction alongside it, with an immutable original snapshot, the currently effective corrected summary, a reason, author identity, server timestamps, expected original/correction versions and approval history. Reports show the original and the latest applied correction with clear labels. A later amendment appends another version; it never rewrites a prior event or erases an applied correction.

Planned-hours and planned-labor reporting uses the effective corrected summary after application/approval, or the original planned summary when no applied correction exists. Pending or rejected proposals do not alter report totals. Retain both values in audit detail and label planned figures clearly; they do not establish actual worked hours or pay. Attendance is never converted into hours. No Inventory or labor-reporting consumer may read attendance until shared reporting, privacy and access contracts are designed and reviewed; this preparation adds no such consumer.

The proposed first scope is correction of recorded planned start/end/job details for ended, published shifts. Keep employee identity, store, department, station, publication and cancellation/release state outside that initial form. Identity or source mapping errors require a separate reconciliation workflow. Capture the original timezone, require an explicit repeated-clock-hour choice where needed, reject missing clock hours and invalid periods, and require the corrected end to remain in the past. Recheck the server clock after coordination. These fields remain planned schedule details, not actual clock-in/out measurements.

Completed closing submissions, answers, independent checks, task verification, guide snapshots and old receipts stay attached to the original shift. Historical corrections do not alter live bookings, staffing, leadership, availability or source attestation. Any warning about inconsistency with those original links is visible to the reviewer. Active/future shift changes continue through the already-reviewed published editing workflow.

| Policy decision | Owner-selected first version | Status |
| --- | --- | --- |
| Who may correct ended shift details | Explicit correction capability for GM/ownership and designated department managers, scoped to authorized stores/departments | Owner selected 2026-10-11: also designated department managers; no new grant or command is implemented |
| Independent approval | Required when the subject is the correcting manager; other authorized corrections apply with a reason and ownership notice | Owner selected 2026-10-11: approval only for the author's own shift; no approval command is implemented |
| Employee visibility of their own attendance | Preserve manager-only access in the first attendance release | Owner selected 2026-10-11: keep attendance manager-only initially; no employee read or self-service grant is implemented |

Role titles must never grant this permission. Resolve the selected rule to explicit store/department capability checks and reconcile it with shared authz during integration. Do not assume that an existing location-management capability identifies an ownership notification recipient.

If independent approval is required, a proposal stays pending and does not affect reports until approved. An approver must be a distinct person from the author and the subject, including across different memberships for the same person. Recheck current authority and the original/effective versions at approval. A rejected or withdrawn proposal remains in history. Changed versions require renewed review; revocation prevents new approval or unauthorized receipt disclosure.

An applied correction records a notification intent for ownership recipients in the same transaction. Recipients follow the shared owner model: owners plus an administrator whose owner-notification access is explicitly enabled by an owner. GM/location-management grants or an administrator title alone must not add recipients. Read the current shared owner configuration; never freeze a separate candidate recipient list as the production authority. Hold application when required recipients cannot be resolved. The intent contains a correction reference and a minimal summary; private attendance narratives remain behind authorized reads. Replays do not duplicate intents. Actual delivery and recipient provisioning belong to the separately reviewed notification/shared-authz work.

## Retrospective leave flags

Migration 040 already stores `time_off_shift_flags` with the request, shift, saved revision, original snapshot, reason and pending/resolved status. Its raw flag is a review obligation. A sick-day request is not evidence of a no-show, and an expired draft is not evidence that a shift was worked or missed.

Add an explicit resolution event with reviewer, reason, evidence references and server time before enabling flag resolution. Verify access to both the request and the affected shift; cross-store flags require affected-store authority. Keep attendance entry creation a separate confirmed action against an eligible published shift. If the flag concerns an unused draft, resolve it as reviewed planning history without retrospectively publishing, cancelling or creating attendance for that draft. Keep the original flag/snapshot and any correction reference after resolution.

## Implementation sequence and acceptance checks

1. **Attendance backend.** Add the scoped tables, events, uniqueness, private authority/action helpers, five commands, receipts and paged reads. Preserve the existing attendance contract. Verify current and revoked access, checkout-role exclusion, cross-store/department privacy, duplicates, ended/released published sources, protected unpublished/cancelled sources, immutable snapshots, review reopening, void history and atomic failure/replay.
2. **Attendance forms.** Adopt the existing create/correct/void/review/history forms with configured role checks and server-projected actions. Add a history view for ended published shifts, store-local clock validation and complete date-range coverage. Malformed records fail closed without exposing private notes. Verify that attendance activity does not stale weekly planning/source review. Manager attendance submissions require a connection and keep frozen original retries; durable recovery after reload remains a separate tracked task.
3. **Ended shift correction backend.** After separate implementation authorization, add the selected explicit capability checks, correction ledger and independent proposal/approval for the author's own shift. Preserve owner-selected manager-only attendance access. Verify same-person independence, revoked author/approver access, current-version races, before/after chains, recipient configuration and notification/receipt rollback. Assert that source shifts, bookings, completed tasks/closes and their receipts remain unchanged.
4. **Correction and retrospective review forms.** Show the original record, proposed/effective correction, required reason, approval status and ownership notice. Add explicit flag resolution with source/evidence references. Verify expired-draft handling and cross-store authority, with no inferred attendance or physical completion.
5. **Review and adoption.** Use focused `codex/` branches and separate draft PRs. Keep published migrations immutable, update the manifest and regenerate the function snapshot. Run fresh loopback PostgreSQL migrations, serial regressions, candidate types, previews and browser rehearsals before acceptance. Pin each exact tested head. Integrate selected workflows into Inventory only after its tested baseline and shared identity contracts are confirmed; hosted application and rollout need separate authorization.

## Source contracts

- [Attendance commands and visibility](../../app/shared/attendance.ts) and [workspace visibility](../../app/shared/domain.ts).
- [Attendance facts and pattern summaries](../../app/shared/attendance-review.ts).
- [Existing attendance forms](../../app/team/attendance.tsx) and [manager review forms](../../app/team/attendance-review.tsx).
- [Candidate retrospective flags and ended shift guards](040_person_time_off_and_active_shift_policy.sql).
- [Repository Git workflow](../../docs/GIT_WORKFLOW.md) and [migration readiness](MIGRATION_READINESS.md).
