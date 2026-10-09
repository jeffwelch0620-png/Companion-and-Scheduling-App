# Closing and Dishwasher UI checkpoint

October 9, 2026. Two completed sections in the isolated PostgreSQL candidate. No Inventory merge, active Companion change, hosted Supabase change, deployment, Git commit or push.

## 1. Original-form adapters and scoped reads

`checkout-preview.jsx` imports the existing `RecordDetail`, `DishCheckoutCycles` and `FollowDetail` without changing their source. `form-command-adapter.mjs` supplies request identity, location and expected revision. Closing forms submit checklist answers on checker actions too; the adapter removes those ignored values on non-ready actions while preserving actual ready answers and correction flags. Server validation and authorization remain authoritative.

Migration 016 preserves the existing scoped Dishwasher summary and adds original-form records with checkout metadata, incoming acceptance and event history. Managers see the full cycle. Employees see their assigned checkout and incoming work; AM employees receive narrow acknowledgment receipts rather than PM work details. The underlying summary function is inaccessible to the runtime role. A new scoped shift read supports the preview's separate manager checkout control.

The loopback preview uses individual, short-lived fictional signed tokens through the real JWT/session handler. Fixtures include fictional members, clearance and standards. These are test projections, not authoritative ingestion or restaurant instructions. `/checkout-forms` runs on port 6610 only while the candidate database and harness are running.

## 2. Original-form browser verification

Closing: closer checked both conditions and submitted work; independent first checker returned a serious correction; manager acknowledged it and assigned a cleared helper; helper resubmitted corrected conditions; independent first checker passed; final manager physically confirmed the close. The shift was then released through the separate preview control. Original closer responsibility remained visible throughout helper work.

Dishwasher: manager created one AM and two PM checkouts; AM passed unfinished work to the named first PM and submitted the AM checkout; manager validated AM. Release before incoming acceptance failed with `checkout_pending`. Named PM accepted; AM release succeeded while PM work remained open. PM checkout readiness stayed disabled until its incoming work was independently validated. Each PM submitted a separate checkout, received manager validation and was released separately. The final original cycle form showed 3 of 3 checkouts and all linked incoming work manager validated.

Database readback confirms closing phase `closed`, three checkout phases `closed`, accepted incoming work phase `closed`, and four separate released shift references. Evidence: `runtime/checkout-browser-database-evidence.json`. Screenshots: `runtime/closing-ui-pass.png` and `runtime/dish-checkout-ui-pass.png`.

## Validation

- 162 full regression checks passed, with zero failed or skipped: `runtime/checkout-ui-regression-results.txt`.
- Six new adapter/read checks passed in both the main candidate and the separately migrated database: `runtime/checkout-reads-results.txt` and `runtime/checkout-reads-fresh-results.txt`.
- Strict TypeScript validation passed for the candidate adapter and HTTP handler; Vite built all three original-form preview entries.
- Read tests cover employee visibility, AM receipts, scoped shift identity, HTTP dispatch and runtime denial of direct tables/summary functions. Existing tests cover concurrency, stale revisions, revoked permissions, atomic rollback and checkout gates.
- Browser mutations persisted through the authenticated HTTP adapter to actual local PostgreSQL. Separate database readback verified their final state.

## Limits and next discussion

This validates workflow compatibility in a connected local candidate. It does not migrate the full Companion app or constitute an Inventory merge. The manager shift-release control belongs to this preview; production schedule navigation remains pending. Closing cancellation/editing and other source commands outside the supported candidate vocabulary remain unsupported.

Membership, clearance, standards, leadership and schedule references still need authoritative ingestion and shared employee identifiers. Hosted authentication/roles, production permission administration, notification delivery, remote devices and deployment remain pending. The fixture-token endpoint must never be deployed.

Offline queuing for closing and Dishwasher commands remains pending; this preview explicitly requires a connection and generates a new request ID for each intentional submission. Production retries must retain stable command identity. Candidate title validation currently allows 180 characters whereas the original cycle form allows 200; reconcile deliberately before cutover. The preview preserves component behavior but does not claim full production shell styling parity.

Next work can address authoritative reference mapping and reliable queued submission for these workflows. Inventory reconciliation waits for the Inventory merge to be ready. Candidate files remain ignored and local, with no GitHub backup. Runtime identities, data and machine-specific files must be excluded from a reviewed integration package. Temporary services are stopped after verification. Stop here after these two sections.
