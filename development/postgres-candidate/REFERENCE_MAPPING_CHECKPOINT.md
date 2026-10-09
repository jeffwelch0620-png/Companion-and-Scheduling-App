# Employee, schedule and standard mapping review

This checkpoint adds a read-only mapping contract in `reference-mapping.mjs`. It does not import data, change tables, grant access or connect either running application. The next ingestion step must separately check the live target and write through a reviewed transaction.

## Input contract

Call `reviewReferenceMapping({ restaurantId, members, records, mappings })` with a complete snapshot for the intended scope of this review:

- `members`: `{ member, revision, active }` entries. `member` is Companion's shared Member shape. Revision and active state must come from persisted membership rows; the employee UI projection does not contain them.
- `records`: Companion WorkRecord snapshots for shifts and standards. Other kinds block this review rather than disappear silently. Scope this input deliberately; this is not an exporter for the entire application.
- `mappings`: explicit `{ kind, sourceId, sourceRevision, restaurantId, targetId }` entries with kind `member`, `shift` or `standard`. Membership mappings additionally require `personId`. Target IDs and person IDs must be UUIDs. IDs are chosen in a separate identity review, never inferred from names, emails or job titles.

The function returns issues and either a reviewable set of proposals or no proposals when blocked. A reviewable result is not an import approval. It does not verify that target UUIDs exist, that target revisions still match, or that an approver is authorized. It makes no database calls and does not mutate input.

## Field relationships

| Companion source | Candidate proposal | Review rule |
| --- | --- | --- |
| Member.id | memberships.id | Explicit membership mapping; distinct from person_id |
| Member.locationId / area | restaurant_id / department | Same restaurant; source department retained |
| Persisted active / scheduleOnly | active / schedule_only | Retain flags; no sign-in provisioning |
| Persisted membership revision | source_revision | Review evidence, not a new candidate column |
| Shift.data.personId | shift_references.member_id | This source field refers to Member.id, despite its name |
| Shift.start / end | starts_at / ends_at | Explicit timezone offset required; positive interval |
| Shift published / cancelled | published / cancelled | Preserve flags; importing published schedules still needs authorization |
| WorkRecord.revision | reference revision | Preserve independently of Standard.version |
| Standard criteria/status/verification | standard reference fields | Validate supported reference shape; retain draft/approved/retired state as a proposal |

Source text IDs are valid; they must not be cast directly to PostgreSQL UUIDs. Multiple source memberships for the same mapped person in one restaurant block the proposal because the current candidate has a unique person/restaurant membership. Final multi-job modeling remains a decision for review.

Existing released shifts require separate checkout/audit reconciliation. Missing owners, employee references, stale mappings, duplicate mappings, unused mappings, cross-scope records, empty criteria and unsupported record kinds block the entire proposal.

## Required follow-up before ingestion

1. Retain a complete source archive including standard guides, provenance, history, shift station/import details and original IDs. The narrow reference proposals do not contain the complete application record.
2. Review person identity, canonical restaurant IDs and membership/job modeling against the eventual tested Inventory baseline.
3. Review access independently. Capabilities, auth links, owner seats, scheduleJobs, qualifications, station clearances, leadership coverage and checkout profiles are not granted by this mapping. Source standard approval is not proof of authorized target approval.
4. Add target existence/conflict/version checks and atomic ingestion with audit evidence. Preserve candidate guards for linked work; do not overwrite references already used by tasks or closings.
5. Design explicit shift-standard links and historical closing snapshots. This review does not derive links from matching station names, positions or titles.
6. Validate realistic export snapshots and the shared Inventory contracts before active backend cutover or hosted changes.

All current examples are fictional. No production employee or scheduling data has been imported. This focused branch is stacked on the offline UI checkpoint while earlier draft PRs await review; merging remains a separate decision.

## Validation

Fresh fictional PostgreSQL bootstrap applied all 17 unchanged migrations. The serial candidate suite passed 182 checks, including eight mapping tests. Strict adapter type validation and original-form preview build passed. These checks validate the isolated preparation package, not production ingestion or Inventory integration.
