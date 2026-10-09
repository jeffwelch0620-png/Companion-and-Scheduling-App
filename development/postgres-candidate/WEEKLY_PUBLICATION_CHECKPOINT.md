# Weekly staffing-gap review and atomic publication

Isolated preparation on publication-review baseline `5a209d4`. Additive migration 030 adds authenticated weekly review and `shift.publish-batch`. Migrations 001–029 remain unchanged. No active app cutover, Inventory merge, hosted database application or deployment.

## Weekly review

POST `/week-review` accepts a restaurant-local `weekStart` and 1–100 selected draft IDs. Every draft must be available, unpublished, uncancelled, unreleased, start in the displayed local week and be in a department the actor can publish. Duplicate selections fail. Planning visibility follows schedule manage/publish/change scope; publication authority is separately required for selected drafts.

Approved staffing needs are clipped to the seven-local-day period. Staffing boundaries include qualified published shifts and only the selected drafts, with distinct employees counted for each time segment. Invalid job/station assignments, approved availability/time-off conflicts and overlapping assignments do not count toward coverage. Adjacent gap segments with identical scheduled headcounts merge, matching the source `scheduleReview` projection. Unselected drafts cannot make an understaffed selection appear covered. This candidate endpoint returns planned gaps; employee hours, published-gap comparisons and complete weekly screen adoption remain pending.

The review returns a hash token bound to week, sorted selection, scope revision and current candidate scheduling inputs. The snapshot is deliberately conservative: even unrelated restaurant changes can require a new review. It also detects administrative fixture changes to jobs, permissions, staffing, restrictions, stations, shifts, standards, leadership and closing records without relying only on scope revision. Raw snapshot data is not returned.

## Atomic batch publication

The command requires explicit confirmation, the current review token, exact draft revisions and each shift's complete sorted active closing selection (IDs and revisions). Remaining planned gaps require acknowledgment and a nonempty written coverage plan. That exception is retained in the batch audit and each affected shift's publication event; it does not change required headcounts or grant clearance.

All selected shifts publish in start-time order, with ID as a deterministic tie breaker. Station goal deduplication therefore chooses the earliest selected shift regardless of selection order. Individual publication rules are reused through a private core: permissions, eligibility, restrictions, overlaps, copied staffing and independent closing review remain enforced. Approved staffing is bypassed only through the reviewed batch path. Runtime cannot call the private core or set its batch flag.

Publication events, closing linkage revisions, goal proposals, station receipts, notification intents, child request receipts, scope changes and the batch receipt commit together. Failure on a later shift rolls back earlier effects. Repeated delivery creates one batch, and replay rechecks current publisher authority for every selected shift. Existing individual publication continues to require its original evidence and staffing restrictions.

Privileged `weekly_scope_reviews` evidence at the original workspace revision remains required to attest complete source scope. Tests install only fictional evidence; the read endpoint and batch command cannot certify real source completeness. This is not a production ingestion mechanism. Notification delivery, source reconciliation, published-shift edits/cancellations/transfers and UI adoption remain pending. The existing HTTP body limit applies even when the nominal selection limit is 100.

## Validation and next step

Local validation: fresh 30-migration bootstrap, all 323 serial candidate checks, strict adapter types, original-form preview build and coverage inventory. Ten focused checks cover selected-only coverage, source gap parity, acknowledged/written exceptions, stale inputs, scope/week/duplicate/confirmation boundaries, closing selections, concurrent retries/revocation, later-shift rollback, earliest station proposals and authenticated HTTP/private-core protection. GitHub validation is reported separately on the draft PR. These checks do not establish weekly browser adoption.

Next: published-schedule edits/cancellation and associated responsibility transfers. Full application migration and M06 remain open; Inventory integration waits for its tested baseline.
