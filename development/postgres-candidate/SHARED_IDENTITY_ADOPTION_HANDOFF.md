# Shared identity adoption — Inventory receiving handoff

Docs-only draft from accepted Companion PR70 main `ce9ecfe16ea0e4d74a73b2983daa90621651cc25`, reviewed head `1a6aeac59cd8a51c60981f3094bac55f637bbe93`. [Exact-head PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39191854556) and [merged-main push CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39192762047) each passed 1403/1403 on attempt 1 with fresh migrations/snapshot, strict types and previews, the pinned GHCR image, no ECR reference and zero skipped tests. These results validate isolated Companion preparation, not Inventory or a combined application.

## Purpose and current holds

Prepare a concrete receiving review for the shared person/access port, without choosing remaining security policies or inspecting/changing Inventory. The [shared identity design](SHARED_EMPLOYEE_IDENTITY_ACCESS_DESIGN.md), [authorized target-read contract](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md), [security decision package](SECURITY_RECOVERY_DECISION_DESIGN.md), [M3 rehearsal](SUSPENSION_COAPPROVAL_REHEARSAL_CHECKPOINT.md) and [readiness checklist](MIGRATION_READINESS.md) remain governing references. This document organizes their handoff; it is not a new authority model or deployment plan approval.

Inventory owns the single future shared migration ledger; Jeff approves shared-schema changes. Its exact tested receiving commit/catalog/handoff remains **pending**. An older source pin, a claim that testing is nearly complete, an application merge, candidate CI or a local prototype is not that acceptance. Receiving names, installed privileges, actual data and provider configuration are unverified here. No live catalog query, employee import, provider call, cross-chat message or Inventory checkout change was performed.

Only SEC10 M3 option A is selected in the security package: governance co-approval before a suspension that would leave its initiator as the only unsuspended eligible owner. Other SEC decisions and remaining SEC10 details stay pending until owner review. This draft selects no timing, MFA/lease/retention value, operator, governance appointment, recovery exception or automatic deletion. M05 remains open, M06 partial and M09/M12 held for the receiving handoff. Candidate migrations 001–063, migrations.json and schema-snapshot.sql stay immutable; 064 is not needed for this draft.

## Receiving evidence packet

Collect this packet only through separately authorized receiving-repository/catalog access. Do not request or publish credentials, employee records, real mapping reports, provider tokens or private recovery evidence. Sensitive catalog/operator evidence stays in controlled private custody; public PRs may contain minimized conclusions and evidence references only.

| Field | Required evidence | Current state |
| --- | --- | --- |
| Repository and tested source | Receiving repository/ref and full 40-character commit; exact-head test/build/CI results and the owner's confirmation that it is the intended integration baseline | Pending; historical Inventory source pins in the identity design remain reference evidence only. |
| Shared migration ledger | Actual ledger location/runner, ordered accepted heads/checksums/receipts and the reviewed next-step convention | Owner selected: Inventory. Actual ledger head/installation evidence pending. Do not copy or renumber Companion's chain into it. |
| Installed catalog | Relevant relation/column/key/index/constraint/function signatures and definitions; ownership, grants/RLS/policies, extensions/search paths and schema/catalog version, reconciled against accepted migration receipts | Pending. A schema file alone does not prove installed state; sanitize private catalog evidence. |
| Identity/access paths | Current person/store/member/account mappings and writers; authenticated actor resolution, provider namespace/session checks, role/grant entry points and existing bypass/direct-table paths | Pending actual source/catalog reconciliation. Report object names/semantics, not credentials or directory exports. |
| Existing data and dependencies | Whether real records exist, referenced identity/store keys, migration/reconciliation constraints and rollback obligations | Pending. Companion's earlier empty-data assumption does not establish Inventory's data state. |
| Provider and environment | Configured provider/issuer/tenant/audiences, supported server proof/revocation behavior and delivery controls; allowed fixture/sandbox environments | Pending separately authorized verification. Documentation capability is not project-configuration evidence. |
| Recovery evidence | Tested receiving backup/restore procedure and evidence location, responsible approver/operator and stop/rollback procedure for the proposed slice | Pending; no restore or infrastructure recovery procedure is selected by this document. |

A complete packet identifies who verified each item, when, against which full source/catalog version and where minimized evidence can be reviewed. Missing or contradictory evidence is a named hold, not an inferred default. Receiving schema or deployed state changing after review requires renewed reconciliation; a new commit does not silently inherit acceptance from an older one.

## Contract mapping worksheet

The candidate column below identifies review evidence, not a target install specification. The receiving reviewer must fill actual objects/writers after the evidence packet is pinned. Logical relationships in the identity design are proposals until reconciled with those objects; no target name, type conversion or relation creation is selected here.

| Contract | Companion evidence to inspect | Receiving disposition required |
| --- | --- | --- |
| Organization/store scope | `candidate_identity.restaurants`, current configuration helpers and reviewed store mappings | Map to actual receiving organization/store IDs with explicit aliases. Candidate text restaurant IDs cannot be blindly cast to receiving UUIDs or treated as physical-location/labor-account IDs. |
| Canonical person | `candidate_identity.people`; reviewed UUID/legacy-alias and source-person contracts | Reuse the approved durable person repository; preserve operational/history foreign keys and distinguish a person from login or membership. Resolve duplicate/ambiguous identities explicitly. |
| Provider account link | `candidate_identity.auth_links`, current session-resolution helpers and the onboarding contract | Map provider/issuer/tenant plus subject to the reviewed person, with current-link cardinality, lifecycle and independent evidence checks. The fixture subject mapping is not the shared provider model; names/email never auto-bind. |
| Membership and extra jobs | `candidate_identity.memberships`, `job_assignments`, scheduling eligibility and reviewed manager supplement | Map one approved membership per person/store, extra jobs separately, exact configuration keys and membership epochs. Employment, schedule-only participation, permissions and training clearance stay distinct. |
| Owners/admin and ordinary grants | Selected lifecycle/admin provenance contracts and their fictional rehearsals | Resolve actual organization owner/admin authority and explicit scoped grant writers; preserve outgoing-admin self-grant suspension and independent grants to other people. A job title or old PIN supplies no permission. |
| Reviewer/setup designations | Accepted reviewer level/lifecycle/self-revocation and setup/link authority contracts | Map explicit designations, eligibility counters and distinct-person checks; no default source.certify/setup/access authority. External designated reviewers need no invented employment membership. |
| Application sessions/lifecycle | Candidate session tests, selected semantic-fence contracts and M3 examples | Define app-owned current fences alongside supported provider verification. Routine token refresh does not advance semantic session revision; provider lapse/re-enable must not revive captured access. Do not attach custom triggers to provider-managed auth.sessions. |
| Store jobs/configuration | Configuration-aware candidate forms, exact checkout-role rules and source supplement | Reconcile actual timezone/department/job configuration and revisions, preserving DST and canonical role checks. Never derive global FOH/BOH, checkout labels or departments from unreviewed titles. |
| Audit, receipts and notices | Candidate command receipts/events/outbox plus current shared-owner notice contract | Preserve canonical actor and exact replay/payload semantics, private current-authority reads and atomic intents. Fixture ownership bridges and queued outbox records are not real owner resolution or delivered notifications. |
| Source/alias projection | Bounded V3 preparation/comparison and authorized target-read design | Recompute against actual authorized shared records/aliases/configuration. Capture reviewed bindings/revisions and per-family coverage; an absent source record is not permission to deactivate a person, cancel leave or certify completeness. |

For each row, record actual receiving object/signature, source and catalog evidence, canonical key/alias decision, sole writer, read surface, invariants, tests and unresolved issues. Use `unverified`/`unresolved` when unknown; do not fill a fictitious production object to make the worksheet look complete. Existing `public.people`/legacy account names in historical source notes must be rechecked rather than presumed current.

## Port gates and proposed implementation sequence

These are review gates and future acceptance requirements, not completed milestones or authorization to touch the receiving repository/database.

| Gate | Required result before proceeding | Hold behavior |
| --- | --- | --- |
| PORT01 — receiving baseline | Owner confirms exact tested source and reviewed catalog/ledger packet | No cross-repository implementation or hosted application based on historical pins. |
| PORT02 — reconciliation | Mapping worksheet resolves canonical keys, legacy aliases, real writers, current data and public/private evidence boundaries | No guessed merges, duplicate identity directory or silent foreign-key remap. |
| PORT03 — slice-specific policy | Identify selected contracts and every pending SEC/I/A decision used by the proposed slice | Keep dependent routes/commands disabled until those specific policies are selected. Pending security choices do not become defaults when a design PR merges. |
| PORT04 — explicit local foundation | Separately approve a receiving implementation PR with explicit definitions, least privileges and wholly fictional local fixtures | Do not import the whole candidate schema, regex-rewrite receiving functions or use fixture authority booleans as real authentication. |
| PORT05 — read/authority proof | Implement verified current actor resolution and minimized authorized reads; test semantic revisions and final current-access checks | No private result after a committed revocation observed by the final check; no service-role browser or fallback legacy PIN path. |
| PORT06 — command parity | Separately approve each selected writer, coordination/replay/audit contract and dual-interface positive/negative acceptance | No UI-only permission check, competing writer or partially protected command exposure. |
| PORT07 — operational acceptance | Separately review real provider/device/delivery/restore evidence, rollout controls and migration/rollback approval | Git merge is not database application, a completed restore, restaurant acceptance or deployment. |

After PORT01/PORT02, the first receiving proposal should reconcile the catalog and specify the smallest non-live identity foundation needed for a verified read path. Review explicit shared definitions and the trusted server adapter against the actual ledger before any installation. Only then implement bounded current-authority reads and a selected vertical workflow. Do not expose onboarding, grants, emergency suspension or recovery while its remaining SEC dependencies are pending; no partial implementation may bypass those holds by invoking a rehearsal predicate.

Companion and Inventory must resolve the same canonical person/authority semantics through trusted server paths, while retaining their separate UI responsibilities and Inventory's canonical food/stock/order writers. Preserve the future local recovery/reporting-copy architecture without introducing a second writable authority database. No sync or unrestricted dual-write mechanism is designed by this handoff.

## Acceptance matrix for the eventual receiving PRs

These are future tests to implement and evidence to collect, not results claimed by this docs-only draft.

| Scenario | Required result |
| --- | --- |
| Different legacy member/account IDs map to one reviewed person; identical names map to different people | Preserve reviewed namespace/key aliases; do not auto-merge by display name/contact or manufacture duplicate person/store memberships. |
| Ordinary employee uses Companion; manager/owner uses Inventory; direct API access attempts the other role's action | Both interfaces use the same current canonical authority; each command still enforces record/scope/consent/independence rules. UI visibility alone grants nothing. |
| Approved membership ends, becomes schedule-only, then is re-approved | Captured employment epochs invalidate old grants; fresh reviewed grants are required. Historical person/shift attribution remains intact. |
| Admin A is disabled/reassigned to B | A's self-grant obligations remain person-scoped; grants A issued to others retain their own membership lifetime; an owner can reconfirm A without reviving stale provenance. |
| Reviewer designation is revoked or a captured person/link/organization/store lifecycle counter changes during a read | Final current-access check discards private results. Lapse/re-enable needs the accepted fresh designation review; routine refresh alone is not a lapse. |
| A read finishes from a repeatable-read snapshot before revocation commits | Commit that read and use a separate current check as specified by the target-read contract; never reuse the old snapshot to claim current authority. |
| Relevant roster/job/leave/configuration/alias versions change, versus an unrelated task-ready/dish/global workspace write | Relevant context invalidates the review; unrelated global activity alone does not. Return no falsely complete truncated/paged projection. |
| Source provides roster only, a complete empty leave family, an unavailable leave family or withdrawn leave tied to an existing target | Preserve their distinct coverage/status rules and pending reconciliation holds. Source preview never activates a login, grants authority or writes completeness. |
| Two-owner suspension, mutual requests, or a third owner becomes ineligible before application | Preserve selected M3 option A, independent governance binding and current coordinated owner counts; no effect without required co-approval and no stale reciprocal authority. Remaining suspension policies still gate the command. |
| M3 is not triggered and co-approval is absent, versus an attached co-approval is stale/mismatched/unverified | Absence does not itself fail M3; any attached approval is validated and invalidity refuses it. Do not silently drop an invalid attached approval to obtain a passing result. Preserve this behavior in both receiving adapters and shared commands. |
| A writer receives SQLSTATE 40001 or a response is lost after commit | Retry the complete coordinated SQL transaction with the original frozen request/receipt; no external provider effect inside retry callbacks, duplicate command or changed-payload replay. Reauthorize before private receipt reads. |
| Shared identity is adopted while native provider session writes remain outside app-owned coordination | Verify actual provider/application boundaries; candidate session-table triggers do not prove managed Auth compatibility or immediate JWT revocation. |
| A new read/write path lacks selected SEC policy, training/consent evidence or a trusted authority mapping | Keep the path held; fail closed without fixture booleans, title-based grants or silent default permissions. |
| A provider outcome is unknown/confirmed-but-unlinked, or an ownership notice cannot be delivered | Preserve the independent reconciliation/delivery obligation. Transactional intent and account control do not prove a link, ownership or message delivery. |

## Stop and rollback contract

Before a receiving migration or rollout, approve slice-specific stop criteria, backups/restore evidence and the single writer/feature-routing plan. Stop on ledger/catalog mismatch, ambiguous person/store mapping, incomplete enforcement paths, unresolved source/foreign-key drift, failed replay/revocation checks or any dependent pending policy. No instruction here applies a migration or invokes infrastructure break-glass.

Before real shared writes, a failed fictional rehearsal can be discarded only within its disposable test environment. After real writes, turning a UI flag off is not a data rollback: preserve canonical UUIDs, audit, receipts, aliases and unresolved provider outcomes, hold affected writes and reconcile under the approved recovery plan. Do not blindly re-enable legacy D1/PIN writers or restore old access epochs/sessions. Verify actual restore and post-restore authority state before reopening access. The full Companion app remains unready for backend cutover until its remaining workflow inventory is reconciled.

## Next review outcome

This draft is complete when the owner can identify the missing receiving evidence, review the mapping/port gates and hand it to the Inventory review without exposing private data or assuming policy choices. That is preparation only. Receiving baseline/catalog confirmation, remaining SEC review and separate implementation/database/rollout approval are later decisions. No other chat is messaged and no new chat is created by filing this package.
