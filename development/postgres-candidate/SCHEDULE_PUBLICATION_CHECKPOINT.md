# Individual publication and station learning proposals

Isolated preparation on employee-goals baseline `6fd4e94`. Additive migration 028 implements `shift.publish` for reviewed, command-created, unlinked drafts and station-driven learning proposals. Migrations 001–027 remain unchanged. No active backend cutover, Inventory integration, hosted database application or deployment.

## Scope and review boundary

The source publication command checks copied staffing, approved staffing needs and closing responsibilities. Those full workflows are not migrated. Individual candidate publication therefore requires a privileged `publication_reviews` row attesting no staffing or closing responsibilities for the exact shift and current workspace revisions. Runtime users cannot certify this evidence. Any candidate command that changes the workspace revision requires renewed review. Candidate linked tasks, closes and standard links block publication regardless of the attestation.

The read-only `reviewIndividualPublication` helper flags copied staffing, overlapping approved staffing and closing work in a supplied source workspace. It does not establish that a supplied workspace is a complete export, write review rows, map source identities or authorize production publication. Tests install evidence only for complete fictional fixtures. There is no production certification endpoint; staffing/closing ingestion and reviewed evidence application remain required before real use. This checkpoint does not implement weekly batch publication or staffing exceptions.

## Implemented behavior

Publication rechecks the current authenticated actor, scoped `schedule.publish` grant, shift revision/phase, complete time-off inputs, employee/job eligibility, overlap, approved time off and approved availability. A station assignment must still be eligible and have complete reviewed setup. Published, cancelled, released and imported reference-only shifts remain protected. Scheduling management alone does not grant publication permission.

Future published station shifts propose each template once per station, employee and template ID. The named reviewer must still have independent, scoped people-management authority, including when every template has already been issued. Ended shifts issue no goals. Draft/retired guide templates are skipped without a receipt and may be proposed by a later shift when approved, matching the source. Current approved guide ID/revision is retained; missing source text is not fabricated.

Due dates use the restaurant's local shift-start date plus the template's days at 23:59, preserving daylight saving transitions. Proposals retain station name, ID, template ID and originating shift. Durable issuance receipts remain after goal completion and appear in the scoped station projection. Proposed goals use normal employee acceptance and independent outcome review from migration 027. Goal completion does not grant clearance, proficiency, trainer status or a separate operating check.

Shift publication, station revision/history, goal events, issuance receipts, notification intents, workspace revision and retry receipts commit together under restaurant-first coordination. Failed writes roll back the entire publication. Retries apply once and recheck publisher authorization. Outbox rows are intentions; notification delivery is still pending.

## Validation and next work

Local validation: fresh 28-migration bootstrap, all 300 serial candidate tests, strict adapter types, original-form preview build and source coverage inventory. Sixteen focused tests cover source proposal parity, daylight saving due dates, exact review evidence, permissions/revocation, reviewer independence, guide status, ended/station-free shifts, durable deduplication, stale inputs/eligibility, linked-work protection, late rollback, authenticated reads and the existing goal outcome workflow. Browser adoption of publication/goal screens is not established by these checks. GitHub results are reported separately on the draft PR.

Next: migrate staffing and closing publication review so the evidence gate can be replaced by complete candidate workflow checks, then weekly batch publication. Automatic job learning, complete source ingestion, notification delivery and UI adoption also remain pending. M06 stays open and Inventory integration remains held for its tested baseline.
