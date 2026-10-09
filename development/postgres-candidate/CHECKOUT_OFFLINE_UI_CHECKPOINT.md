# Checkout offline screen checkpoint

October 9, 2026. Isolated preview only. The original Companion form components, active backend, Inventory and hosted services remain unchanged.

The checkout preview now retains employee readiness through IndexedDB, displays pending/applied/review/login/blocked statuses, and prevents a second unresolved intent for the same work. Readiness becomes server-confirmed only after authenticated delivery. Manager checks, incoming acceptance, assignment and shift release require a connection. Cached records remain historical observations until current server rules are checked.

Previously loaded fictional employee records are cached separately by fixture, employee and workflow. The fixture cache strips session IDs and retains only fictional reference data and subject identifiers. Tokens are obtained on delivery and never persisted. A known authorization denial clears the displayed/cached assignment while retaining blocked submission evidence.

The preview service worker caches only the checkout page and built script/style assets. It ignores token, fixture and API requests, rejects out-of-scope manifest resources, and changes its generated build marker when assets change. It does not cache authenticated responses or deliver commands. Runtime caches and artifacts remain ignored.

## Browser evidence

Closing: loaded a fictional closer assignment; stopped the loopback preview server; reloaded from the cached shell; completed the original checklist form; saved it pending; reloaded again and observed retained evidence. A temporarily unavailable reconnect preserved the pending submission. Once services were restored, reconnect applied it and the original form displayed verification with both answers retained.

Dishwasher: loaded the second PM personal checkout; stopped the server; reloaded; submitted readiness; reloaded again and observed pending evidence. A duplicate attempt was rejected without replacing the evidence. An offline manager correction was rejected. Reconnect applied PM readiness and showed manager validation still needed.

Revocation: queued first-PM readiness, disabled that fictional membership, and reconnected. The screen displayed blocked/access-denied status and removed the cached work detail. The database task remained open at revision 1. Test membership was restored afterward; the blocked queue entry is intentionally not automatically retried.

Actual PostgreSQL readback confirms exactly one readiness event for closing and one for second PM, both at verification, checklist answers `[0,1]`, and zero released shifts. Screenshots and readback JSON remain local under ignored `runtime/`. `checkout-offline-browser-evidence.mjs` reproduces the successful closing/second-PM readback for that fixture.

## Validation and limits

All 174 candidate checks passed against a newly initialized 17-migration database. New tests cover retained screen intent and identity separation, cache-manifest resource restrictions, offline shell fallback and API/token exclusion. Candidate strict types and all three original-form builds pass. No published migration changed. GitHub CI repeats the automated checks; browser outage evidence is from the local run.

This does not establish production offline support. The fictional role selector is a test control, not shared-tablet authentication. The 24-hour queue age is a preview policy, not an adopted operational limit. Production cache retention/encryption, logout/device cleanup, identity recovery, storage eviction handling, explicit resolution of blocked/conflicting work, hosted authentication and mobile-device validation remain pending. A first visit without cached assets and assignments requires connectivity.

This follow-on PR depends on checkout queue PR #2 and foundation PR #1. It remains draft and unmerged. Next preparation work is authoritative employee/schedule/standard reference mapping and production identity/cache policy before active application cutover. Inventory reconciliation still awaits its completed tested baseline.
