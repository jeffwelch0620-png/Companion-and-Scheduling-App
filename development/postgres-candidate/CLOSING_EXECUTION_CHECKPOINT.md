# Closing Execution Checkpoint

October 9, 2026. Isolated local PostgreSQL candidate after the closing-assignment checkpoint. No Inventory merge, hosted deployment or active application changes.

## Implemented workflow

Migration 008 adds `close.transition` with employee `ready`, assigned senior `verify`, assigned closing manager `confirm`, and assigned checker `fix` actions. Work requires an active published, unreleased shift and a currently approved standard reference. Shift and close revisions prevent stale work from silently applying.

Employee submission must confirm every numeric checklist index exactly once. The required criteria come from the assignment's saved standard snapshot. Manager-only work moves directly to manager confirmation; senior verification work must pass the assigned independent verifier first. Final confirmation closes the assignment and does not release the shift.

An assigned eligible checker may return unfinished work for correction. Current answers reset to an empty list; historical submissions retain their checklist evidence. Resubmission follows the same required verification path. Closed work cannot be reopened by these commands.

Reviewer authorization is checked on every command and receipt replay. Manager confirmation also checks leadership coverage at the assignment due time or explicit location authority. Role names alone grant nothing; unassigned managers cannot replace the named checker. Revoked employee memberships and verifier/manager capabilities deny replay.

Each transition atomically commits state, checklist answers, event history, workspace revision, stable retry receipt and notification intent. Concurrent identical retries commit once. A replay returns the original receipt and does not overwrite the current phase; callers should refresh the close detail to obtain current state. Notifications target the next checker, or the employee and manager when correction is requested. Delivery is still separate work.

## Validation and evidence

- 96 regression checks passed across ordinary tasks, authentication/offline queue, capability permissions, issues/reassignment, handoffs, linked shifts, closing assignments and closing execution; zero failed or skipped. Evidence: `runtime/closing-execution-regression-results.txt`.
- All 14 closing-execution checks passed on the separately provisioned fresh-schema database with migrations 001–008 and fictional fixtures. Evidence: `runtime/closing-execution-fresh-results.txt`.
- Strict TypeScript compilation passed for the candidate command adapter and HTTP handler.
- Checks cover full manager-only and senior paths, correction evidence, missing/duplicate/string checklist indices, independent actors, revoked replay, leadership loss, draft shifts, retired standards, stale revisions, concurrent retry, notification recipients and transaction rollback.

The HTTP tests inject a trusted verified-session stub, then exercise real PostgreSQL session resolution and permission checks. Existing authentication regression tests cover signed-token verification. Closing execution has not yet been verified in the original forms in a browser, on remote devices or against hosted Supabase.

## Scope and next work

Attention flags, their manager acknowledgment, correction helpers, reassignment/cancellation commands and full shift release remain unimplemented. The adapter and SQL reject unsupported input fields, including manager-attention flags, rather than silently dropping them. These fixtures do not contain flagged/helper assignments; this slice establishes ordinary closing execution only.

The existing original forms remain unchanged. Closing commands are not yet enabled in the offline queue or candidate form preview. Reference standards, station clearances, guide links, leadership and shifts remain fictional projections awaiting authoritative mapping.

Next work should implement manager-attention acknowledgment and correction-helper rules before completing the final checkout/release workflow. Final release must account for all linked tasks and specialty requirements, including Dishwasher cycles and overnight handoffs. Prep and stock posting must continue through Inventory's reviewed operations.

All candidate files remain ignored and local; no commit or push was made. The local test cluster contains fictional data only and is stopped after verification. Runtime data, fixtures and machine-specific test setup must be excluded from any future reviewed production integration.
