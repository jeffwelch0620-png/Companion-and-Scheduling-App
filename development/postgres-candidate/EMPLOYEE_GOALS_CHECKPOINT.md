# Employee goal assignment and independent outcome review

Isolated preparation on station-setup baseline `ae14ffb`. Additive migration 027 implements manual `goal.create`, `goal.transition` and paged authenticated `/goals` reads. Migrations 001–026 remain unchanged. No active application cutover, Inventory integration, hosted application or deployment is included.

## Implemented behavior

An employee may choose a development goal with a different authorized people manager; it starts active. A scoped people manager may propose a development goal for another employee; the employee accepts or declines it. Required corrections require task-management authority and an approved department instruction, start active and cannot be declined or cancelled by the employee. The assigning manager may name a different authorized reviewer without gaining continued visibility into that goal.

The employee records practice and submits readiness. Only the assigned manager with current scoped authority records coaching, returns the outcome for further work or verifies completion. Development goals may be cancelled by their employee or assigned manager; required corrections require the assigned manager. Terminal goals cannot resume. Independent outcome verification never grants station clearance, proficiency, trainer status or a separate operating check.

Linked instructions retain their ID and exact revision. Development links require the caller to review the current approved revision; a required correction may use the current revision if none is supplied, matching the source. Accept, practice, coach, ready and verify recheck that the linked instruction remains approved at that revision. Returning work or cancelling remains available when instructions change. Existing reference data does not contain the original instruction `source` text; no `standardSource` is fabricated. Complete guide/source ingestion remains pending before application adoption.

Reads follow the source's named-participant visibility: the employee or the assigned currently authorized reviewer. Unassigned managers and unrelated departments cannot read goal details. Dish employees and schedule-only/inactive actors are excluded. Scope, actor and exact action permissions are enforced by the backend functions; runtime connections cannot read/write raw goal tables or call the private authority helper.

Restaurant-first transactions coordinate membership/grant locks, revisions, goal events, notification intents, scope revision and request receipts. Retries produce one effect and recheck current authorization. Outbox rows are durable intents, not proof of delivered notifications. Practice saves do not notify; coaching targets the employee; other changes target the employee and reviewer.

## Validation and remaining work

Local validation: fresh 27-migration bootstrap, all 284 serial candidate tests, strict adapter types, original-form preview build and coverage inventory. Twelve focused checks cover original follow-through phase parity, self-chosen/proposed/required goals, independent outcomes, changed instructions, exact participant visibility, permission/type/scope boundaries, concurrent retries, stale versions, revoked replay, audit rollback and HTTP sessions/pagination. These checks establish command/API behavior, not browser adoption of goal screens. GitHub validation is reported separately on the draft PR.

Automatic job learning (`goal.start-learning`, automatic practice criteria/history and supersession), station-driven issuance, complete source goal ingestion, goal screen adoption and offline goal delivery are not implemented. Station templates issue only from published shifts in the source; that work is held for the next schedule-publication slice, including reviewer/approved-guide rechecks and durable employee/template deduplication. Development assessments and proficiency remain separate outstanding workflows. M06 and Inventory integration remain open.
