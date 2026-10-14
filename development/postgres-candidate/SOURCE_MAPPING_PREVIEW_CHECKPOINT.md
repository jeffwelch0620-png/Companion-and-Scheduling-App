# Read-only source mapping and coverage preview

Preparation from accepted PR51 main `1323c9efd7fcb051213bef4d9183d4dc711952e9`, with [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38503508302) passing 884/884. PR52 was owner-approved and accepted at `65f23e64a1367040f78d8e1a1205af7dc5220f7f` from reviewed head `d3643be799976caa9a7f82b59571ec3004af4e31`; [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38507062766) passed 905/905. This slice implements a local normalized-file preview. It creates no accounts, memberships, grants, audit receipts, database rows or scheduling completeness evidence. Acceptance does not enable shared/hosted adoption.

## Owner selections

The owner selected reviewed snapshot files before live Toast/HotSchedules connections; one person UUID and one membership UUID per person/store with legacy IDs retained as explicit aliases and extra jobs stored separately; and atomic future application per declared completeness scope. Schedule copy/batch partial saves remain unchanged. These selections are recorded in the [identity/access design](SHARED_EMPLOYEE_IDENTITY_ACCESS_DESIGN.md) and [source-ingestion design](SOURCE_INGESTION_DESIGN.md).

Commissary employment, shared migration ownership/adoption baseline, delegated access administration, no-contact onboarding/recovery, field ownership and production retention/limits remain pending. After PR52 acceptance the owner selected explicit scoped source reviewers and reconciliation of omissions while preserving current records; see the [next design](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md). This preview does not implement those permissions, the shared identity schema or an import-application path.

## Run the fictional example

From the repository root:

```sh
npm run source:preview --prefix development/postgres-candidate -- source-preview.example.json
```

The tracked example contains only fictional people, source aliases, stores and timestamps. It demonstrates one human's two store memberships, an unchanged existing membership, a proposed new membership and a proposed leave reference across the repeated daylight-saving hour. Expected counts are two new, one unchanged, and zero changed/omitted/blocked records. Nothing is applied.

`source-preview.mjs` is a pure review module using only Node's hashing library. `source-preview-cli.mjs` reads one explicitly named local regular file, decodes strict UTF-8 and prints JSON to stdout. It has no network or database connection, output-file option, default directory scan, authentication dependency or app route. Preview reports are sensitive operator artifacts: never commit them or attach them to PRs, including generated fictional reports. Redirect retained fictional reports to ignored `work/`; real source/report storage requires authorized restricted handling. Public synthetic input fixtures and aggregate test counts are separate from operator report artifacts.

Exit 0 means the supplied file is reviewable, **not approved or ready to apply**. Exit 2 means the valid envelope has blocking mapping/coverage findings. Exit 3 means `review_required`: omissions/unused aliases need explicit reconciliation without any blockers. Exit 1 means unavailable, malformed or oversized input. Every issue has severity `blocking` or `review_required`; genuine blockers take precedence without dropping review findings. Error output uses fixed codes rather than echoing raw values, paths or parser errors. Duplicate JSON property names, including escaped spellings, are rejected before `JSON.parse` can silently overwrite them. See [normalizer preparation](SOURCE_NORMALIZER_PREPARATION_CHECKPOINT.md) for the draft diagnostic extension.

## Version 1 normalized envelope

This is a deliberately bounded intermediate format, not a raw Toast/HotSchedules importer. See [the full fictional JSON](source-preview.example.json) for exact field names. Unknown fields fail closed rather than being discarded.

| Section | Required facts |
| --- | --- |
| Root | Version 1, organization ID, source, explicit mappings and a supplied target snapshot. Target organization must match. |
| Source | System and tenant namespace, capture timestamp and one or more store scopes. Store IDs and external-store IDs are explicit, unique bindings within that source tenant. |
| Store source scope | Canonical store ID, external-store ID, timezone, watermark, end-of-source marker, separate roster/leave coverage, normalized members and time-off rows. |
| Roster coverage | Explicit complete/count/inactive-included/schedule-only-included declarations. Their truth is asserted by the supplied file, not verified against a provider. |
| Leave coverage | Explicit complete/count and inclusive local-date review window. Include supported pending/approved/declined records overlapping that window, including leave starting earlier. End-at-midnight is exclusive. |
| Normalized member | Source ID/revision, name label, configured department/job keys, active/schedule-only state and scheduling jobs. Names are comparison labels, not identity bindings or person-rename proposals. |
| Normalized leave | Source ID/revision, source member ID, department, exact offset-bearing start/end instants and status. The preview preserves microseconds and compares equivalent offsets by instant. Source cancelled/withdrawn states produce row-level `leave_withdrawal_policy_required` blockers; target states remain pending/approved/declined. |
| Mapping | Store/external-store/kind/source key, source revision, target UUID, mapping revision and expected target revision; member mappings also require a canonical person UUID. Null target revision explicitly means a proposed new record. |
| Supplied target | Organization/capture time, canonical people and configured stores, departments/jobs/input revisions plus member/leave snapshots. This is caller-supplied evidence, not an authorized live database read. |

The source namespace is organization + system + tenant + external store + kind + external ID. The file contains one system/tenant; mapping keys use structured tuples, not ambiguous delimiter concatenation. Target IDs are checked within their record kinds across stores. Same-person memberships across different stores are valid; duplicate memberships for that person within a store are blocked. Extra jobs remain a list on the membership review, not another membership or person.

V1 accepts explicit integer source revisions from a reviewed normalized file. A provider without reliable revisions needs a reviewed content-fingerprint adapter before use; no revision is fabricated from names, order or capture time. Raw external department/job labels need a separately reviewed normalization/mapping step into the exact configured keys. There is no guessed case conversion, global department list, title-to-role mapping or job-to-clearance conversion.

Qualifications, credentials, login identifiers, capability arrays and unsupported record families are not accepted in this operational preview format. Their presence blocks the file; this is not an exporter that silently drops them. Original source archiving, approval provenance and sanitized real-export adapters remain separately reviewed work. Availability, shifts, standards, linked work and existing-reference command reconciliation are outside V1.

## Report and guarantees

Rows are classified as new, unchanged, changed, omitted or blocked. The report identifies source/target IDs, proposed person links, revisions and changed field names; it does not copy name/note fields or full records into its output. IDs can still identify people, so reports remain private. Omitted target records become review obligations; they are never deactivated, deleted or silently ignored. A person-binding change is blocked and requires identity review. Historical leave retains its original department even after the member changes department; remapping an existing leave record's owner or stored scope is blocked.

Unresolved or duplicate aliases, duplicate same-person/store membership, missing/inactive canonical people, stale source mapping or target revision, wrong store/department/job/timezone, incomplete coverage/count mismatch and outside-window leave produce blocking findings. Omitted targets and valid unused aliases produce review-required findings and preserve targets. Every ambiguous duplicate source member is blocked, including dependent leave references; row order cannot choose a winner. Existing blocked members produce `leave_member_blocked` with `memberSourceId`; absent members remain `leave_member_mapping_required`. Target snapshots must themselves be structurally consistent, with unique typed IDs and resolved member/person links.

Digests cover source, target and mappings using sorted keys/collections with portable code-point ordering. Semantic no-op job ordering remains unchanged; microsecond changes remain visible. CLI reports also include the exact input-file SHA-256. These digests are informational review evidence, not signing tokens, persisted receipts, live freshness proofs or import authorization. A target input-revision change alters the target digest, but the preview cannot detect a newer unseen database write.

Every result has `canApply:false`, `completenessCertified:false` and `accessProvisioned:false`. `declared_complete` means only that the envelope's counts/coverage/end marker agree internally; provider consistency, actual completeness, authorized current target reads and independent access review remain required. The validator does not assess current person-wide bookings, linked shifts, existing duties or all command-specific leave/eligibility rules. A future application path must perform those checks and bind the review to authoritative current context.

Technical preview bounds are 2 MiB UTF-8 total, 20 source/target stores, 2,000 people, 2,000 rows per family/store, 8,000 mappings and 100 configured/job keys per list. Both CLI and programmatic inputs are bounded, including file growth after the initial stat. No list is shortened to fit. These are local review safeguards, not owner-selected production import or retention limits; S05 remains pending until representative authorized exports are available.

## Validation and next slice

The focused preview/reference-mapping/manifest suite passes 33/33, with 21 new checks covering two-store identity, ordering, unmapped same names, stale revisions, ambiguous duplicates, person binding and collisions, inactive people, incomplete/empty coverage, omissions, configured mappings, rejected authority/unsupported fields, overlapping leave/DST/microseconds, target digests, limits, duplicate JSON keys and actual CLI read-only/error behavior. No input fixture changes after CLI use. Fresh fictional application through unchanged 001-063 and schema snapshot verification passed; strict candidate types, workflow inventory and existing UI preview build passed. Exact-head PR CI and merged-main CI both passed 905/905; PR52 records the full evidence. Independent final review re-ran the 33 focused checks before the authorized merge.

Next: review the [normalization/authorized target-read contract](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md), obtain one deliberately authorized sanitized representative source export and resolve remaining format/coverage/field/retention details. Keep this preview read-only while resolving those choices. A real provider connector, shared authz foundation and coordinated import application each require their subsequent authorized slice, tests and separate merge approval. No caller may use this report to flip the existing scheduling review gate.

PR54 accepted the first [normalizer preparation](SOURCE_NORMALIZER_PREPARATION_CHECKPOINT.md) at `fd3dc3c`, with 913/913 merged-main CI. It implements the tracked PR52 severity/exit, source withdrawal-state and blocked-member diagnostics. V1 revisions, target data and application/certification/access flags remain unchanged. The owner selected reviewed Toast employee/job snapshots as the first source family; the exact authorized sanitized representative format and coverage are still needed before raw normalization.

The next [V2 family coverage draft](SOURCE_FAMILY_COVERAGE_CHECKPOINT.md) explicitly distinguishes unavailable source families from available complete empty arrays, adds nullable target leave and per-family report claims/status, and applies the owner-confirmed untracked inactive historical leave rule only in V2. V1 retains the behavior documented above. No cancelled/withdrawn target state is added, and no fingerprint, raw adapter, source certification or shared application is enabled. The synthetic V2 example is normalized test input rather than a provider export.
