# Authentication and saved-submission recovery

Candidate follow-up on `codex/companion-auth-offline-recovery`, based on the unmerged database coordination checkpoint `a3bf7c6` (PR 26). The user authorized continuing isolated preparation. Keep this dependency explicit: review/accept PR 26 before accepting this follow-up. Neither package enables the running Companion, Inventory or hosted services.

## Authentication outcomes

Missing, malformed, expired or invalid signed credentials return 401 `authentication_required`. Unknown signing keys also require renewed credentials. A database session that is absent, expired, revoked or bound to another subject now returns 401 at the identity resolver. Valid sessions with denied membership, location or action permissions still return 403. Signing-key transport, timeout, malformed key-service data and other unexpected verification failures return a sanitized retryable 503; database failures continue to return 503. No failed verification grants access or enters a database transaction.

The change uses the existing private SQL session resolver error contract. Published migrations 001–036 remain byte-identical; no new migration is required. Read snapshots and write coordination from PR 26 are preserved. A 401 only means fresh credentials are required; it does not restore revoked membership or capabilities. Automatic Supabase refresh, sign-in/out, onboarding and session synchronization are still production integration work.

## Retained work and recovery

The durable IndexedDB queue still supports only employee task/closing readiness, including Dishwasher readiness represented as task transitions. Tokens are supplied at delivery time and never stored with commands. Expired/revoked sessions retain the exact command as `needs_auth`; permission denial blocks automatic resubmission. Temporary service failures and uncertain delivery remain pending. Login-provider errors raised before an HTTP command response receive the same classification.

The task and closing previews expose saved notes, creation time, delivery attempts and plain-language outcomes. An explicit retry keeps request ID, command, expected revision and original creation time. Reviewing old work permits another age-limited attempt without editing the original intent; changed work still returns a conflict. No automatic retry changes a held command or grants permissions. Rejected/applied commands cannot be retried through this control. An expired crash lease can be recovered; an active delivery lease prevents retry, discard and clear.

Discard and employee device-data cleanup require separate on-screen confirmation. They remove local copies, not server work; uncertain delivery must be checked with the manager before creating another submission. Clearing a selected subject atomically removes that subject's queue entries across locations, preserving other subjects and refusing active delivery. Checkout assignment caches for the selected preview actor are also removed, including prior fixture runs. The fixture directory/shared shell remain because they contain only fictional preview data. Clearing preview data is not hosted sign-out or remote-session revocation.

Subject partitions prevent accidental cross-employee delivery/display in these candidate screens; they are not an encryption or security boundary against another user of the same browser profile. Production shared-tablet authentication, logout cache retention, storage eviction/quota behavior, durable scheduling retries and phone/tablet checks remain open. Food prep queues require the Inventory data contract and are not implemented here.

## Validation

Validation results are recorded on the draft PR's exact pushed head. New regressions cover key outages, credential failures, revoked/expired sessions and renewal, unchanged permission denial, database outages, one-effect recovery, age/conflict review, scoped cleanup, active delivery refusal and expired-lease recovery. Full fresh-database migrations, serial regressions, strict candidate types and preview build remain required before pushing. Actual Supabase authentication and Inventory concurrency remain unvalidated.

The final local run on fresh fictional `companion_candidate_auth_recovery3` applied all 36 published migrations and passed **413/413** serial checks (0 failures). Strict adapter/HTTP/driver types, preview build and source coverage inventory passed. All 36 migration hashes remain unchanged. No active application source was changed; root application checks were not rerun for this candidate-only change.

Browser verification on the separate loopback port 6620 confirmed offline retention through reload, retry without delivery while delayed, separate discard confirmation, reconnect to independent verification, and confirmed employee-data cleanup surviving reload. A database readback verified exactly one closing ready event and zero released shifts. This is fictional runtime evidence, not a Supabase login or real device security check. Runtime evidence and screenshots are kept locally under ignored `work/postgres-candidate/runtime`; fixture sessions and tokens are excluded from Git.

Use `CANDIDATE_PREVIEW_PORT` to run this fictional loopback preview on a separate port while an earlier preview stays open; the default is 6610. This is a local fixture-token server and must never be deployed.

Next: scheduling/workflow policy decisions and remaining UI adoption, then canonical identity/data and employee prep integration after Inventory's tested baseline is available. Notifications, actual hosted identity/RLS, backup/restore and rollout remain separate gates.
