# Source normalization and authorized target reads - design review

Prepared October 13, 2026, from accepted PR52 main `65f23e64a1367040f78d8e1a1205af7dc5220f7f`, reviewed head `d3643be`. The [mapping preview](SOURCE_MAPPING_PREVIEW_CHECKPOINT.md) is accepted isolated preparation. This document defines the next adapter contract; it adds no normalizer, endpoint, database function, access grant or source application. Published 001-063, the manifest and function snapshot stay unchanged. This draft requires its own review and merge approval.

## Owner selections and remaining decisions

| Item | Status and boundary |
| --- | --- |
| File-first input | Selected: reviewed snapshot files before live connectors. No source format or real export has yet been supplied for this adapter. |
| Identity | Selected: canonical person UUID, one membership UUID per person/store, reviewed legacy aliases and separate extra jobs. Names/email/provider roles cannot establish that link or grant access. |
| Review and completeness authority (S01) | Selected October 13: organization owners, currently enabled administrator, and explicitly designated store reviewers may review mappings and certify their authorized store scopes. Designation is explicit, audited and revocable; it is not inferred from GM/title, `location.manage`, employment or provider roles. |
| Source omissions (S04) | Selected October 13: require explicit reconciliation and preserve current employee, job and leave records. No automatic deactivation, deletion, leave withdrawal or implicit approval. |
| Application failure (S03) | Selected: atomic per declared completeness scope, without partial completeness. Copy/batch partial-save policy remains separate. |
| Field ownership (S02) | Pending: provider-specific ownership and newer canonical-edit reconciliation. The read-only adapter must not resolve a write conflict by choosing a winner. |
| Retention and production bounds (S05) | Pending: representative export, coverage guarantees, privacy/retention periods and practical volume. V1's technical limits remain review safeguards, not production selections. |
| Identity administration | I05-I09 remain pending in the [identity design](SHARED_EMPLOYEE_IDENTITY_ACCESS_DESIGN.md). Store source-review designation does not select delegation of identity/access administration or ownership/bootstrap/recovery. |

Owners and enabled admins are eligible through the selected organization policy; store reviewers are eligible only for their explicit organization/store/family designation. Capability names, designation issuer/delegation, certification acknowledgements and implementation are separate review work. Certification proves the reviewed source scope under these rules; it does not authorize an importer to apply changes. Person creation, account linking, membership approval and grants retain their independent workflows. A reviewer without identity-directory permission receives an unresolved link for separate identity review, not an organization-wide person directory.

## What the inspected source can support

These observations concern tracked code at PR52 main, not a verified provider export or current provider specification.

| Source | Observed representation | Adapter implication |
| --- | --- | --- |
| [Original Toast roster code](../../app/shared/toast-roster.ts) | Employee/job GUIDs, archived states, job references, name/email labels and a retrieval timestamp. The fetch reads employees/jobs independently; the returned roster carries no verified pagination/snapshot certificate or provider revision. | Useful identifiers, but insufficient evidence for complete roster certification. A retrieval time is not a source revision. Do not invoke its live fetch from this slice or adopt its email as a login binding. It supplies no leave coverage. |
| [Original HotSchedules parser](../../app/shared/hotschedules-import.ts) | Weekly name-labelled shifts with local date/time, job/schedule labels and source row numbers. No stable employee UUID, leave list or complete inactive roster. | It cannot feed V1 roster/leave completeness by itself. Row numbers and names are not persistent keys; schedule conversion needs its separately reviewed identity/time contract. |
| [PR52 example](source-preview.example.json) | Fictional normalized roster/jobs and leave, integer revisions, explicit aliases, supplied target context and declared counts. | Demonstrates the exact V1 shape. It is not a representative raw export, a target reader or proof that a provider can meet the contract. |
| Earlier reference/reconciliation modules | Opted-in fictional inputs with source archives and target checks. | Preserve their tested invariants; do not connect their privileged fixture clients to an app route or assume they implement shared review authority. |

The first raw adapter must name one exact source/export format and version. Obtain a deliberately authorized sanitized representative sample and its export settings/coverage explanation first. No format is selected simply because a parser already exists. A roster-only file may be inspected independently, but absent leave must be labelled unavailable; it must not become an empty complete leave list to satisfy V1. Extend/version the preview explicitly if independent-family inspection is needed.

## Source preparation and normalization

1. Record organization, provider/system, tenant and external store bindings from a reviewed connection/export description. A filename, URL, employee name or caller-selected store cannot establish authority. Scope aliases must resolve unambiguously to the intended canonical stores.
2. Register a format/version with exact accepted headers/keys, row families, source statuses and supported time representation. Declare which fields are deliberately excluded as sensitive/irrelevant and why. Unexpected keys, missing required columns or unsupported operational states produce review findings; do not silently discard them and claim complete migration.
3. Sanitize a copy before it is used as a repository fixture. Substitute synthetic names and stable synthetic identifiers consistently across people, stores, jobs and leave. Exclude contact/login data, pay rates, payroll fields, tokens, passwords and PINs. Authorized private originals and any permitted audit metadata require separate restricted storage/retention; credential material is never part of an import archive. Hashes do not anonymize records.
4. Record SHA-256 for the exact authorized input and, separately, any sanitized fixture and normalized semantic payload. Label each hash's bytes and purpose. Sanitized content cannot be used as the original file hash. Hash equality proves content equality only, not trustworthy source, completeness or permission.
5. Preserve source IDs as scoped strings and source state exactly. Use reviewed job/department aliases to exact configured keys. Preserve all assigned jobs, inactive and schedule-only entries required by coverage. A job/title is not a clearance, role or capability. Unknown labels require review rather than a default department, position or timezone.
6. Preserve a real provider revision when available. If absent, design a canonical per-record content fingerprint that includes all relevant supported fields, plus separate snapshot/coverage evidence. It needs a versioned preview/mapping contract because V1 accepts integer revisions. Never squeeze a hash into V1's integer, generate revisions from capture time/page order, or reset a local counter on every run. Parsing success is not source-version proof.
7. Preserve explicit instants to PostgreSQL microsecond precision. For local wall times, use the reviewed store timezone and require an occurrence for repeated times; reject nonexistent times and unclear overnight boundaries. Preserve half-open leave intervals. Interpret coverage dates in that captured timezone, including leave starting before but overlapping the selected window. Do not turn a date-only all-day record into UTC midnight without a reviewed conversion rule.
8. Verify row counts, duplicates, included statuses/departments, inactive/schedule-only coverage, export filters, page/end markers and consistency evidence. Independently fetched employees/jobs or multiple export files require a consistency check. Without a provider snapshot mechanism, document a re-read/reconciliation strategy and unresolved limitations. A declared watermark or manual checkmark alone cannot certify coverage.
9. Produce the bounded normalized source and explicit mapping review inputs with a sidecar of format/transform versions and coverage evidence. Provenance is not added as unknown fields to V1. Select a versioned sidecar binding or V2 before integrating the adapter; keep `canApply:false`, `completenessCertified:false` and `accessProvisioned:false` throughout read-only inspection.

An explicitly verified complete empty scope is different from a missing file, inaccessible family or filtered export. Missing/inactive source rows create reconciliation obligations against retained targets. Removed jobs must consider current memberships and bookings; absent leave cannot imply withdrawal. A certifier cannot resolve an unsupported state by discarding its row. Independently reviewed scopes can progress separately; failure within a declared scope prevents that scope's future application and completeness certification.

## Authorized target-read contract

This is a proposed service contract, not an available route. Authentication comes from the verified current server session/person and organization policy. The client may request a bounded source namespace/store/family/date scope and explicit reviewed alias identifiers. It cannot supply its actor, owner/admin status, permissions, target people or authoritative revisions. The existing CLI continues to accept a supplied target solely as offline review evidence.

Before reading private operational data, resolve every requested store to the actor's current organization and permitted review scopes. Ordinary employees and unrelated managers are denied. A store reviewer cannot query another store's roster or global people merely by supplying its ID. Unauthorized requested scopes fail without partial output or existence/count leakage. Any reduction/redaction that would prevent complete reconciliation is reported as unavailable scope, not a supposedly complete empty list.

Resolve mappings from the reviewed alias repository using organization + system + tenant + external store + kind + source ID, with exact mapping revision. An operational reviewer may examine an already verified link within their authorized scope; creating/rebinding a person or approving a new store membership routes to the separate identity workflow. Proposed new UUIDs remain proposals until that workflow supplies the approved links. Do not enumerate every organization employee to aid a store reviewer.

| Target projection | Minimum required data / restriction |
| --- | --- |
| Store context | Canonical ID, configured timezone/departments/jobs and relevant configuration version/content; no provider secrets, payroll or Inventory financial settings. Do not synthesize configuration from titles encountered in source rows. |
| Canonical people | Only explicitly mapped/authorized people needed for this scope, with person ID, current active state and permitted display name. Names are read labels, not account/contact data or a binding. Missing authorization/identity is unresolved rather than guessed. |
| Memberships/jobs | Complete authorized store roster including relevant inactive/schedule-only records, membership/person IDs, exact record revisions, configured department/position, active/schedule-only state and active scheduling jobs. Extra jobs do not create another membership. |
| Time off | Exact source/target reference IDs/revisions, owner membership, original stored department, supported status and offset-bearing start/end; include all rows overlapping the reviewed date range, not only rows starting in it. Omit reason/note, medical detail and attachments. |
| Reviewed aliases | Scoped IDs, person/target bindings and alias revisions needed by this review; no unrelated external identities, login emails, PINs or account-recovery history. |
| Review context | Per-store input/configuration context, relevant identity/membership/job/alias/access versions and one consistent snapshot marker. Workspace revision may be metadata; it is not the freshness fence. |

Historical leave retains its original department after an employee transfer. The reader must not rewrite it from current membership. Candidate request/leave representations with incompatible statuses/fields require a reviewed projection/version; silently dropping them would make the requested coverage false. Unsupported or oversized scope returns a bounded review obligation and no complete result.

Person-wide leave/conflicts from other stores need a separate authorized minimal conflict projection. Store source-review designation does not reveal their rosters, notes or full leave history. Missing cross-store authority/evidence leaves the later application plan unresolved; a read-only V1 report is not proof that person-wide booking/leave checks passed. Cross-store facts cannot be injected into the requesting store's source coverage as if it exported them.

## Snapshot, freshness and privacy

Prefer one bounded read-only repeatable-read transaction that assembles the required target and alias/configuration context. Validate current session and access before private reads, and check current access again before returning; a relevant revocation/change refuses the result. The shared implementation must specify how that final check obtains current committed access state rather than rereading the same old repeatable-read snapshot. No operational write, receipt, completeness update or row-for-update lock is needed for this read.

If the selected source volume requires paging, define stable ordering by immutable IDs and a bounded private continuation bound to actor/organization/scope, snapshot/context and exact date range. The client drains every required page before showing a complete comparison. Do not combine pages from different snapshots, silently return the first N records or present a scope as complete after a page cap. A relevant fence change restarts the whole bounded read, at most three attempts; repeated drift asks the reviewer to refresh. Large scopes require a reviewed narrower scope or server snapshot mechanism, not truncation that invents omissions.

Bind review context to exact selected/dependent record and alias revisions and semantic store/input configuration. Existing `input_revision` supplies scheduling-input drift, but does not stand in for future person/link/access revisions. Routine task-ready, dish, goals, attendance and unrelated global workspace writes do not restart source reads. Relevant roster/job/leave/alias/configuration changes do. Revocation/session changes are a separate access fence, checked for every read and later command.

Use a recomputed digest of normalized supported source content, verified coverage evidence, mapping/format versions and authoritative relevant target context for a future application review. V1's informational source/target/mapping hashes are not that final token. No secret or stored token is required; do not advertise an expiry until selected. A later application must recheck current authority, exact reviewed context and person-wide dependencies under the shared coordination contract; a read snapshot or old digest cannot authorize writes. Preserve global, input, schedule, attendance and correction counters and whole-transaction `40001` retry behavior.

Keep authorized reports/source files private. A target read is not exposed with service-role credentials in the browser, and a privileged fixture connection is not an authorization layer. No public cache or sessionStorage/localStorage persistence of employee exports, names, aliases or leave. Error responses use fixed issue codes and authorized row references, excluding raw values, file paths, other-store counts and reasons. Logging/retention/deletion periods need S05 selection; do not introduce a durable source archive while those choices are pending.

## Acceptance scenarios for the next implementation

These are required future tests, not results claimed by this document.

| Scenario | Required result |
| --- | --- |
| Owner, enabled admin, designated store reviewer, ordinary manager/employee; admin disabled or designation revoked | Positive scoped read/certification eligibility only for the selected eligible actors; denials for others. No implicit identity/access grant and no cross-store directory disclosure. |
| Same human has two approved store memberships; identical names or provider IDs in separate tenants | Explicit UUID aliases preserve one human and namespace isolation. No name/email auto-link or duplicate person/store membership. |
| Unknown raw column/state, duplicate key/record/job, missing member, unsupported family or credential input | Bounded sanitized findings; no silent winner, discarded record or false complete scope. Sensitive fields excluded by the reviewed format policy never enter the public fixture/report. |
| No reliable source revision; export rows reordered; supported field changes | Versioned fingerprints remain stable on ordering-only changes and differ on relevant content. No invented integer/capture-time revision. |
| Roster-only file, filtered inactive export, mixed watermarks, truncated pages, explicitly verified empty scope | Missing coverage stays unavailable; only proven declared empty coverage is empty. No fabricated leave list or publication gate change. |
| Departed source member, removed job or absent approved leave with existing target records | Current target and history stay intact; explicit reconciliation is required, without automatic disablement, withdrawal or booking cancellation. |
| DST repetition/nonexistence, offset-equivalent times, microseconds, leave beginning before the window and exact end-at-midnight | Deterministic reviewed conversion; exact interval and overlapping coverage preserved; ambiguous times refused until resolved. |
| Historical leave department differs from current member department | Preserve the leave owner/original scope; no implicit rebind. |
| Authorized reader has more source/target rows than the bound, or lacks a necessary family/person permission | Entire affected review remains incomplete/unavailable; no truncation-induced omission or private spill. |
| Target membership/job/leave/alias/configuration/access changes between pages or before response | Consistent snapshot or bounded restart/refusal, including current final-access check. No stale review accepted for application. |
| Unrelated task/dish/goal/attendance write during target drain | Relevant source-input/access context remains valid; no global workspace fence failure. |
| Store B leave affects a store A plan | Only permitted minimal cross-store conflict facts; no other-store roster/reason. Missing evidence blocks future application, not privacy controls. |
| Source normalization and target-reader invocation | No database changes, auth provisioning, source completeness updates, provider fetches or external side effects. Report flags remain false. |

## Implementation order and handoff

1. Accept this contract and choose one representative source/export format. Record a deliberately authorized sanitized sample, export settings and coverage guarantees; confirm unsupported/inactive/leave limitations. No real export is currently attached to this draft.
2. Resolve the format/fingerprint/provenance version and relevant S02/S05 decisions. Implement a pure bounded read-only file normalizer and fictional tests; keep its public fixture demonstrably synthetic. A normalizer does not require connecting the live provider.
3. Resolve shared designation issuance and identity/read dependencies, then prepare a current authorized target reader against a fictional shared foundation. Implement positive/negative scope cases and the fresh final-access check before exposing any route. Do not use `candidate_identity` fixture access as the production authority model.
4. Reconcile the two into a private read-only review flow. Test complete snapshots, omissions, person-wide privacy, format/version drift and bounded refresh without certifying/applying. Preserve V1 or explicitly version it; remove no existing test gates.
5. Design and separately approve certification/application functions after field ownership, full dependencies and coverage are proven. Preserve receipts/audit/coordination/replay and semantic no-op revision behavior. Source-review designation alone cannot execute them.
6. Port selected contracts only after the user confirms Inventory's exact tested baseline and shared schema/migration owner. Hosted application, deployment, live connector credentials and automation remain separate actions.

M05 remains open; M06 remains partial. Shared identity/access lifecycle, real source completeness, notification delivery, copied-component retirement and the remaining operational services have not been completed by this design.
