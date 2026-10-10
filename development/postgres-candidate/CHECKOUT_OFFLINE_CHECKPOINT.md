# Employee checkout queue checkpoint

October 9, 2026. Candidate queue support only; the running Companion, Inventory and hosted services are unchanged.

The existing durable queue now accepts employee `close.transition` readiness submissions with checklist answers. Existing `task.transition` readiness submissions also work for Dishwasher tasks, subject to current database workflow checks. Request identity, expected revision and answer evidence survive storage reopen and uncertain delivery. Bearer tokens are supplied at send time, never stored. Pending submission remains distinct from server-confirmed readiness, manager validation and shift release.

The queue rejects closing verification/confirmation/correction, incoming acceptance, passing work, reassignment and shift release. These connected authority or responsibility actions are outside this offline slice. Reconnecting uses current server authorization and workflow rules; an outage does not freeze permission or bypass current work dependencies.

Eight new integration checks verify closing persistence, lost-response replay with one audit effect, revoked membership, changed shift references, manager correction during outage, pending incoming Dishwasher work, independent second-PM readiness, concurrent flushers and rejected authority/invalid-answer commands. The tests use actual local PostgreSQL and the HTTP/session handler with fictional verifier fixtures; durable storage is exercised through fake IndexedDB. These tests are not a new real-browser offline demonstration. Earlier signed-JWT and browser queue evidence remains in its original checkpoint.

The full candidate suite passes 171 checks with zero failures or skips after a fresh 17-migration setup. Candidate strict types and all three original-form preview builds pass. No migration file was changed.

This is a small follow-on branch based on the unmerged foundation PR. Its draft PR targets `codex/companion-postgres-migration` to show only this change. After the foundation is accepted, reconcile the follow-on with the reviewed `main` baseline before merging it. Neither PR authorizes an Inventory merge or deployment.

Remaining: connect these queue operations to employee forms with clear pending/review/login states and exercise browser offline/reload/reconnect behavior. The checkout preview remains connected-only until that wiring is implemented. Production queue age, shared-tablet identity, reference ingestion and Inventory prep contracts still need their respective decisions and integration.
