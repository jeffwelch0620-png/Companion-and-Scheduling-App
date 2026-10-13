# Schedule copying and reviewed batch draft editing design

## Scope and approval boundary

Design only, from accepted PR45 main `199e67b9a80c2b8deaed9e74997606b075383b7e`. Its [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38335901326) passed 792/792 tests, fresh migrations/snapshot verification, strict types and preview build. Published migrations 001–058, the manifest and function snapshot remain unchanged by this design.

This package proposes two isolated candidate workflows: copying a reviewed selection into new unpublished drafts, and reviewing changes to existing drafts as one group. It adds no commands, endpoints, SQL or forms. P03 and P05 are selected by the owner as recorded below; the remaining choices are **pending owner selection**. Acceptance of this design PR records the plan; it does not select every recommendation or authorize implementation, hosted application or Inventory integration.

Published shifts keep their existing edit/cancel/coverage paths. Ended published shifts keep the accepted completed-correction policy, including distinct-person approval for one's own shift. Attendance and retrospective leave flags remain separate; copying never creates attendance or worked hours. Real timekeeping and commissary labor allocation are outside this slice.

## Source behavior and candidate gaps

The active Companion source is a workflow reference, not an approved PostgreSQL implementation:

| Source | Observed behavior | Port requirement |
| --- | --- | --- |
| `app/shared/week-copy.ts` | Selects noncancelled draft or published shifts and approved staffing needs in one store/week; later destination on the same weekday, 7–364 days away; 1–100 shifts and up to 100 staffing needs | Confirm the limits and scope; use server-computed proposals and complete bounded reads rather than a browser workspace as authority |
| `app/team/schedule-copy.tsx` | Selection, preview and reason/confirmation; shifts stay unpublished; closing checks restart and staffing needs become drafts | Show explicit copied fields, omitted evidence and every blocker before saving |
| `app/shared/domain.ts`, `shift.copy-week` | Recomputes the proposal stamp; creates shifts, fresh closing assignments and staffing drafts with source provenance | Review must bind exact sources and current destination constraints; writes, receipts, audit and intents must be atomic |
| `app/team/schedule-draft-editor.tsx` | Edits employee, job and start/end for up to 100 selected drafts with before/after review | Decide the editable fields; station and department behavior must be explicit |
| `app/shared/domain.ts`, `shift.save-batch` | Checks exact revisions and week membership, validates replacements without other selected old slots, then checks the final combined schedule | Preserve valid exchanges of draft slots while preventing conflicts between proposed replacements or with unselected records |

Legacy helpers contain hard-coded checkout-role and membership-based conflict checks. The port must instead use current configured roles, person-level overlap and person-wide approved leave, while preserving store-specific availability. The candidate has individual draft/station commands and reviewed weekly publication, but does not implement either copy-week or save-batch. Candidate linked-draft protections require explicit design; do not assume the original source's closing inheritance can be reused unchanged.

## Policy decisions for the owner

Recommendations remain proposals unless the Status column records an explicit owner selection. The owner selected shift/station-only copies and partial valid-row saves; the latter supersedes the original all-or-nothing recommendation.

| ID | Decision | Recommendation | Other option / tradeoff | Status |
| --- | --- | --- | --- | --- |
| P01 | Copy source and destination scope | One store, one source week; selected draft or published shifts; one later week on the same weekday within 52 weeks | Cross-store or arbitrary-date templates require separate identity, department, timezone and authority mapping | Pending owner selection |
| P02 | Preserve assigned employees | Keep the source employee and job only if currently eligible; block affected rows for review | Unassigned templates need a distinct representation and assignment workflow; never substitute a person silently | Pending owner selection |
| P03 | Closing responsibilities | Copy shift/station definitions only; show omitted closing counts and require fresh closing assignment before publication | Fresh closing draft copying is deferred | Owner selected: shifts/stations only; closing duties assigned separately |
| P04 | Staffing needs | Let the manager separately select approved needs to copy as new staffing drafts; require new approval | Shift-only first release is smaller, but staffing must then be entered separately | Pending owner selection |
| P05 | Save outcome | Save valid rows and report rejected rows; preserve rejected records and capture the complete result in one receipt | Owner selected partial success over the original all-or-nothing recommendation; dependency groups must stay together | Owner selected: partial valid-row saves |
| P06 | Duplicate copy | One active copy of a source record into a destination week; refuse duplicates and link its existing draft | Intentional repeated copies need a separately reviewed override or template identity | Pending owner selection |
| P07 | Batch edit scope | Existing future, unpublished, noncancelled, unreleased command-created drafts in one store/week; employee, job and start/end only | Department/station changes, copying to another week or published changes require additional scoped review | Pending owner selection |
| P08 | Batch drafts with linked work | Exclude drafts with linked tasks/closes/standard links initially; explain which link needs individual review | Supporting them requires reviewed close/duty reassignment, exact dependent revisions and atomic protection of completed work | Pending owner selection |
| P09 | Size and authority | Up to 100 shifts per group and up to 100 selected staffing needs; current department-scoped `schedule.manage`; publication and staffing approval remain separate | Smaller limits ease review; larger limits require bounded payload/read planning and measured transaction cost | Pending owner selection |

The selected P03 policy deliberately narrows the original copy feature for the first candidate slice. Any later proposal to copy fresh closing drafts requires a separate policy decision. In that future design, copy current approved standard definitions and due dates only, reset all completion/submission/check/release state, retain source provenance and treat reviewers as proposals. Require current task-management authority as well as scheduling authority. Never copy old approval, consent, leadership grants, attendance, corrections, leave flags, notification delivery state or receipts.

For P06, request replay and copy duplication are different checks: the same frozen request returns its original result, while a different request selecting an already copied source is refused. Define cancellation/recopy semantics before implementation: recommended active-copy uniqueness excludes cancelled copies but retains immutable provenance/history, and checks staffing retirement similarly. A changed source revision must not silently bypass the active duplicate guard.

## Proposed read, review and write flow

1. Load a complete, bounded authorized source selection and destination context. Keep pagination and range limits explicit; never create a proposal from a silently truncated screen. An unauthorized source must reveal neither linked work nor private people data.
2. The manager selects records and edits permitted fields. The server returns a minimized proposal: source ID/revision, before/after local and UTC times, destination employee/job/station, omitted duties, validation issues, proposed saved/rejected counts and projected staffing gaps. Return action flags from the same authority helpers used by commands.
3. Review the exact selection with a required reason and confirmation. A server-issued token must bind the actor/store, selected source and dependent revisions, destination dates, proposed fields, relevant configuration/eligibility/station context and expiry. Client input alone is not attestation.
4. At save, recheck current authority, source keys, completeness, person bookings/leave, store availability and all applicable linked-work guards in one transaction. A stale row is explicitly rejected and needs a new review; never adjust its input or omit its result silently. A revoked actor, expired/invalid token, unavailable complete context or failure of a store-wide completeness gate refuses the whole request.
5. Write the valid subset, its provenance, before/after events, applicable revision bumps, one complete result receipt and any policy-required outbox intents in a single transaction. Each accepted row and its dependent writes remain atomic; a system failure rolls back the entire attempted transaction. Return every selected row as saved or rejected with a safe reason and resulting ID/revision when saved. New drafts stay private to authorized managers. Publication uses the existing independently reviewed publication command; no publish flag belongs in these inputs.

Do not bind reviews to the global workspace revision: employee tasks, dish checkout, goal practice, attendance and correction activity must not invalidate an otherwise valid draft proposal. Use exact selected/dependent record revisions and a digest of relevant destination constraints. `schedule_revision` can support coherent paging and discovery, but it includes leadership and other scheduling inputs; any broad equality gate must have a documented relevance reason. Source completeness attestation uses the accepted separate input-revision contract.

Copy creation must record a stable source record ID, captured source revision, source/destination weeks, captured timezone, actor, reason and resulting IDs. Historical source snapshots stay informational; compare explicit source keys so unrelated future columns do not invalidate a review. Resolve current names at read time, and label any preserved snapshot as name at time of entry. Do not expose source attendance, correction or private request data through copy provenance.

## Time, conflicts and partial-save safety

Move dates by local calendar days in the configured store timezone, preserving local clock times and overnight date offsets. Do not add seven elapsed 24-hour periods to UTC timestamps. Enforce positive durations of at most 24 elapsed hours. Refuse nonexistent spring-forward times. Require an explicit first/second occurrence for each newly ambiguous start, end or closing due time; do not carry an occurrence choice from an unrelated original time. An unchanged ambiguous timestamp in a batch edit must round-trip exactly.

Validate all proposed replacements against one final schedule, after removing selected old slots for validation. This permits exchanging two draft assignments without a false conflict against the old slots, but still catches overlap among new rows. For partial saves, rejected rows keep their original slots: recompute the resulting schedule with those slots present before choosing a safe subset. Treat interdependent exchanges as indivisible groups and reject the entire group if any member fails. Do not choose an arbitrary winner among conflicting proposals; reject the conflicting group and report why. Freeze the selected subset before writing so validation order cannot change the outcome. Keep unselected drafts, published/released shifts, other-store person bookings and approved person-wide leave in the conflict set. Availability remains store-specific. Department, station, configured checkout role and active job rules remain current at save, not inherited from a copied historical assignment.

Coordinate affected scopes in the established deterministic order. A person's cross-store conflict inputs must not be read outside the accepted coordination/person-booking guarantees. If any dependent scope is busy, return retryable 40001 and roll back every result, counter, receipt, event and outbox intent. Reuse canonical eligibility/closing helpers or prove parity; do not create independent client authority rules.

If linked-draft edits are later selected, require exact close/task revisions and current transfer eligibility. Completed closing work cannot be reset or reassigned by batch editing. A manager must use the accepted individual protected path where applicable, or a separately designed correction workflow for ended records. Batch cancellation and bulk published editing are not implied by this design.

## Delivery, retries and UI adoption

Use one frozen request ID and payload after uncertain delivery. On a known partial result, mark saved IDs and revisions clearly and retain each rejected row with its reason. Never retry the whole selection under a new ID; a new review/request contains only the revised rejected rows, with current revisions and destination context. Same-ID replay returns the original complete saved/rejected result and does not try rejected rows again. Retry the original submission for temporary coordination/outage failures; altered selections require resolving the uncertain command first. A real source/revision conflict requires refresh and a new reviewed proposal, not repeated submission. On reload, show that the result was uncertain and direct the manager to inspect current drafts before resubmitting unless durable replay recovery has been explicitly implemented. Never imply an unsent browser proposal was saved.

No employee notices are proposed for unpublished draft creation or editing. Preserve normal publication notices. Audit events and atomic outbox intents are not delivery; shared recipient resolution and the delivery worker remain open.

The next implementation PR touching `task-http` or `schedule-screen-client` should fold in PR45's optional precision fix: match SQLSTATE `40001` **and** `scope_coordination_retry`, return HTTP 503 `coordination_retry`, and show "Another store is updating these records. Retry the original submission." Preserve frozen-request retry and distinguish real outages as `service_unavailable`. Update the client's explicit 503 branch and the existing cross-store HTTP regression; adding a message dictionary entry alone is insufficient. This docs-only PR does not implement that fix.

Reconcile original schedule copy/draft editor components during candidate form preparation; document any temporary candidate derivatives. Shared UI adoption must fold reviewed behavior into original components and retire derivatives/adapters. Keep the current narrow copied-component source gate intact until validated adoption. An additional copied source needs its own documented drift strategy; do not silently enlarge or disable the existing gate.

## Implementation sequence after policy selection

1. Record the owner's selected P01–P09 choices, resolve any combinations that imply fresh closing drafts or linked-edit support, and confirm the smallest backend slice.
2. Design and validate the selected partial-save receipt/result and dependency-group rules before adding commands. Add focused copy proposal/command preparation from current accepted main. Use explicit SQL definitions in the next free corrective migration after the accepted chain (currently 058); update manifest and regenerate the snapshot on a fresh fictional PostgreSQL 17 database. Do not rewrite published migrations or use regex patches for the shared port.
3. Add batch draft proposal/command preparation with final-schedule valid-subset validation and rollback/replay checks. Keep it separate from copy if review size warrants it. All backend PRs remain draft until separately reviewed and approved.
4. Prepare bounded copy/batch forms from the original UI, then verify privacy, authority, DST and uncertainty recovery in the fictional preview. Require separate approval for each merge.
5. Address source completeness/shared authz and component retirement before real-store use; integrate only from the confirmed tested Inventory baseline with one canonical manifest. Git merges do not apply a database or deploy an app.

## Required acceptance scenarios for implementation

| Area | Evidence required before an implementation PR is accepted |
| --- | --- |
| Partial save and transaction safety | Mixed independent valid/invalid selection saves only valid rows and returns every outcome; invalid rows and their dependencies remain unchanged; forced audit/outbox/receipt failure rolls back the whole transaction; same-ID replay returns the exact complete saved/rejected result without trying rejected rows again |
| Copy duplicates | Concurrent different requests cannot create two active copies for the same source/week; changed payload on an existing request conflicts; cancellation/recopy follows selected policy |
| Final batch schedule | A legal exchange saves together; one failed exchange participant rejects its dependency group; rejected old slots remain in final conflict checks; overlapping proposed replacements and cross-store conflicts reject the affected groups without blocking independent valid rows |
| Date/DST | Overnight copy, spring gap refusal, per-field fall occurrence selection, unchanged ambiguous round-trip and 24 elapsed-hour duration boundary |
| Authority/privacy | Department manager, location scope, checkout role, inactive/schedule-only actor, revoked capability after review and private linked-work/source facts |
| Current inputs | Changed job/station/standard/leave or source revision invalidates affected proposals; unrelated task/checkout/goal/attendance activity does not; source completeness remains required |
| Linked records | Excluded links produce actionable blockers; if allowed by policy, reads and commands agree on every transfer issue and completed work remains protected |
| Boundaries | Limit, duplicate ID, incomplete paging and token expiry refuse safely; no partial selection is represented as complete |
| Recovery | Held cross-store scope gives whole-transaction retry without writes; frozen retry after release applies the valid subset once; real outage stays distinct; row conflicts need fresh review of rejected rows; reload uncertainty and known partial results stay visible |
| Publication separation | Copied/edited shifts remain unpublished; copied staffing stays unapproved; no copied completion/consent/authority/attendance evidence and no employee draft notices |

Current design validation checks documentation consistency, coverage inventory, unchanged migration/manifest/snapshot, candidate types/build and the existing fresh-database CI suite. It is not evidence that copying or batch editing works in PostgreSQL; the scenarios above are future implementation requirements.
