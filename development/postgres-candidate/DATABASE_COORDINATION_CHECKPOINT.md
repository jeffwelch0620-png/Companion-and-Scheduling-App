# Candidate database coordination checkpoint

Accepted preparation baseline: Companion main `4a15a70` (PR 25). Branch: `codex/companion-database-coordination`. This is the first post-merge reliability package, separate from the running Companion backend, Inventory and hosted Supabase. It is preparation, not a platform cutover.

## Resulting behavior

- Corrective migration 036 gives Companion writes a private coordination row per location. Commands acquire that row before locking actors, permissions or operational records. Existing shared location revision updates remain, but commands no longer take an explicit exclusive lock on the shared location record. Inserts in another subsystem that merely reference the location can proceed; updates to that same location record can still wait. Same-location Companion writes remain deliberately serialized.
- Identity reads and every candidate read entry use non-locking authorization helpers. Stable SQL entry points share one statement snapshot; HTTP reads use a read-only repeatable-read transaction covering both session resolution and data. Items, policy and workspace revision describe the same committed snapshot. A read already in progress can finish from its authorized snapshot; the next request observes a committed revocation. Write session resolution retains its current permission/session locks and receipt replay reauthorization.
- Urgent overnight escalation locks grants only for the issue's location. Offer invalidation no longer takes an exclusive shared location lock inside its row trigger. Source/policy triggers coordinate the affected locations with a non-blocking attempt: if a transaction already owns a source row but another command owns coordination, it aborts with `40001 scope_coordination_retry` rather than forming a reverse-order wait cycle. A policy update that has not acquired its source row yet may safely wait for an already-authorized command to finish.
- Candidate reference imports and schedule reconciliation acquire private coordination before reads/writes. Their existing missing-location error remains compatible. `privilegedScopeTransaction` acquires explicit scopes in sorted order before a SQL-only privileged callback. Concurrent fictional actor batches use this contract and roll back partial people, membership and grant creation atomically. It does not expose an owner-level HTTP path or grant runtime access to private locks.

## Privileged writer contract

All future trusted roster/policy/reference ingestion must acquire the affected scope locks before changing rows. Use one transaction and sorted explicit scopes for multi-location batches. The row guards cover location metadata, memberships, capabilities, eligibility, auth links/sessions and shift/standard/closing references; they are a backstop, not blanket coordination of arbitrary superuser SQL. Other privileged operational writes must follow the same coordination contract. Retry an entire failed transaction on `40001` with the same import/command identifiers; never retry only the last statement. SQL-only callbacks must not perform external side effects. Runtime coordination access remains revoked. Server write errors remain retryable service failures under the existing HTTP/queue contract; authentication error classification is a separate next package.

The migration uses explicit routine lists with fail-closed counts to replace scope locking while preserving original record/policy locks. Read-helper variants are private and use the same authorization predicates. Later corrective changes to a shared authorization helper must update its read variant and tests together. Published migrations 001–035 and their hashes remain unchanged; 036 is appended to the manifest.

## Acceptance evidence

New regression cases exercise held-write/non-blocking HTTP reads, independent-location commands/policy changes, an Inventory-style foreign-key insert, a deterministic row-first roster/command race, permission revocation and denied replay, next-request session revocation, a staffing update between HTTP authorization and data reads with matching snapshot/revision, stable/private read helpers, location-scoped urgent escalation, and concurrent/failed privileged roster batches. These are fictional loopback tests, not proof against Inventory's eventual schema or real hosted services.

Final fresh-database suite, strict candidate types, original-form preview build, ordered hashes and public staged-file review are required before pushing. Results are recorded below after completion. The correction was also applied separately to a fictional database containing the accepted 001–035 baseline, verifying its upgrade path.

## Remaining work

Next: expired/revoked authentication versus permanent permission denial, transient JWKS/database error handling, queue review/discard and shared-device recovery. Scheduling policy decisions, roster completeness/recertification, person-level cross-location conflicts, remaining UI/module adoption, real identity/RLS, notifications and local backup/recovery remain open. Inventory food/prep/order contracts require its tested baseline and shared schema agreement. No merge, hosted database application or deployment is authorized by this checkpoint.

## Completed local validation

Fresh fictional database `companion_candidate_coordination4` applied all 36 ordered migrations and passed **401/401** serial checks (0 failures), including ten new coordination/privileged-ingestion cases. Strict adapter/HTTP/driver types, source coverage inventory and original-form previews passed. Upgrade from the accepted fictional 001–035 baseline also succeeded. No active app source changed; its prior build/lint evidence remains historical and is not claimed as rerun here. GitHub checks on the pushed PR head remain the authority for CI.
