# Fictional source-reviewer policy rehearsal

Starts from owner-approved PR62 main `eabfadc0ae10abe4b0011ba01b9a06b15a442ae2`, reviewed head `83ea0b6e1be73a83406dd3fdf336c79db9f3d1ff`. [PR62 exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39089739747) passed 1064/1064; its duplicate [branch check](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39089737754/attempts/4) also passed 1064/1064 after image-download retries, before merging. [PR62 merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39090764584/attempts/2) passed 1064/1064 after one image-download retry. The [accepted design](SOURCE_REVIEWER_ACCESS_DESIGN.md) governs this isolated implementation slice on `codex/companion-source-reviewer-policy-rehearsal`. This new slice requires its own draft review and separate merge approval.

## Outcome and boundary

The owner selected Inventory's repository as the future single shared migration-ledger owner, with Jeff approving shared-schema changes. Inventory is still finishing testing; its exact tested commit/catalog handoff remains pending. Keep this Companion package as rehearsal. No shared DDL is adopted here, no SQL 064 is needed, and published 001–063, migrations.json and schema-snapshot.sql are unchanged.

The pure `source-reviewer-policy-rehearsal.mjs` module is an executable reference model for selected reviewer-policy cases and later shared-implementation parity tests. Only its fictional tests import it. It is not authentication, shared authz, a target reader, a capability/grant service or a production permission answer. No active app, HTTP adapter, browser, existing CLI, provider or database path calls it.

Every result has purpose=fictional_source_reviewer_policy_rehearsal, authoritative=false, canApply=false, completenessCertified=false and accessProvisioned=false. The eligible field means only that the supplied fictional snapshot satisfies this model's rule. A caller can fabricate snapshots; verified=true and lifecycleVerified=true are supplied assertions, not provider verification. Passing this rehearsal does not establish any current user's identity or authority.

## Supplied snapshot and supported operations

A version-1 snapshot supplies exactly one organization/store/viewer, an account link, session, organization-authority evidence and a bounded designation list. Identifiers are synthetic UUIDs. It supplies person/account-link/organization/store eligibility counters, record/policy revisions, the designation's captured vector, total active-membership count and global workspace revision. Extra keys, unsupported levels/actions/families, invalid booleans/counters, duplicate identities or person/store/family designations, sparse/overlong arrays and unreviewed shapes refuse with a fixed data-free TypeError.

Bounds of 100 designations and 100 author UUIDs are technical rehearsal safeguards, not S05 production limits. This module does not load or truncate a real roster, designation directory or source file.

| Export | What the rehearsal evaluates | What it does not implement |
| --- | --- | --- |
| rehearseSourceReviewer | Supplied session/person/link/scope eligibility; organization owner/enabled-admin path; explicit store/family review versus review_and_certify; captured/current eligibility equality; self-revocation eligibility | Token/session/provider validation, new grants/restores/revokes, context certification, reason/revision command validation, authorization persistence |
| rehearseSourceReviewerFinalAccess | Initial and final supplied snapshots must both be eligible and have the same relevant access fence | Real REPEATABLE READ/READ COMMITTED transactions, provider-event collection, snapshot transport or protection against a commit after the final check |
| rehearseSourceReviewerAdvisories | Last active-membership count crossing to zero or person becoming inactive proposes fixed advisory kinds | Owner list, durable advisory items, lifecycle event IDs, queue deduplication, outbox delivery or automatic revocation |

The source.review/source.certify distinction follows R07; review_and_certify is explicit, and a qualified author is not disqualified from certifying their own context. Supplied author UUIDs are shape-checked audit context only and never create authority. Scope matches organization/store/family/person; a manager title or membership count never substitutes for a designation. Organization owners/admin do not need fictitious employment or a designation vector.

A designee's captured eligibilityRevision must match all current counters even on a fresh request after lapse/re-enable. Explicitly updated fictional restore snapshots demonstrate the comparison, not a working restore command. Organization-policy reads use their current policy/session checks. Ordinary logout/session expiry affects the supplied session, not the durable vector.

Self-revocation is a narrow relinquishment eligibility check on the viewer's own explicit record. It does not require certification or a current captured designation epoch; it does require current eligible personal identity/session/lifecycle evidence. An inactive store does not prevent this relinquishment check. Another person's record is refused even for an owner using this specific action. Already-revoked returns a no-op proposal; no audit/receipt is written and no authority is restored. Actual reason, revision, replay and person-level restore controls remain requirements of the future command.

The final-access fence includes the relevant person/link/session, organization/store policy and selected designation. A review sees a selected designation revision or scope change; an unrelated family's designation revision, global workspace write or employment-count change does not invalidate it. Revoke/restore between snapshots changes the fence even if both endpoints are eligible. Relevant operational target/configuration revisions need their separate coherent data snapshot; they are not implemented by this access-only model.

## Local verification

Run serially from the repository root:

~~~sh
node --test --test-concurrency=1 development/postgres-candidate/source-reviewer-policy-rehearsal.test.mjs
~~~

Thirty-four wholly fictional tests cover owner/admin and non-employed reviewers, review-only versus certification, author self-certification, scope/person mismatch, lifecycle and current-session denials, each captured epoch, reviewed restore snapshots, revocation/final-fence changes, employment advisories, irrelevant workspace/family changes, self-revocation and no-op proposals, strict bounds/shapes and frozen-input purity. Every result retains the non-authoritative flags. These tests use no database, filesystem output, network service, provider account or private roster.

The combined serial source/normalizer/supplement/manifest/rehearsal suite must preserve V1/V2 golden outputs. Strict candidate adapter/UI types, original-form preview builds, fresh fictional migrations/snapshot and exact-head CI remain required. The local serial combined suite passed 215/215, including all 34 new rehearsal checks and the unchanged V1/V2 golden bytes. Strict candidate adapter/UI types and original-form previews passed (existing unresolved logo warning). All 160 relative document links resolve; inspection found no active app or existing candidate entry-point reference to this module. Fresh-database/snapshot and exact-head CI results are recorded separately in the draft PR. The original-form preview build is a regression check, not a UI for this rehearsal.

## Remaining implementation gates

1. Obtain Inventory's exact tested baseline and authorized catalog/migration handoff. Ledger ownership and Jeff's approval role are selected; they do not authorize changes in that repository or a hosted database.
2. Resolve the shared identity/session/account lifecycle and required I07–I09 policy/provider dependencies. Build explicit shared definitions in the selected ledger only in a separately reviewed adoption slice.
3. Implement audited grants, level changes, restore, revoke and self-revoke commands with current authority, reasons, revisions, coordination, receipt/replay and least privilege. This pure evaluator supplies no bootstrap or default grant.
4. Implement the owner/admin designation list, durable advisory items and deduplication. Employment end remains advisory only. Persist monotonic lapse counters through trusted lifecycle writes/provider reconciliation before restoring eligibility; missing lifecycle continuity fails closed. This rehearsal supplies no event adapter.
5. Add the real bounded target reader and separate current access transaction, minimal projections and coherent relevant-data refresh. The accepted proposed three-total-attempt safeguard and HTTP 503 source_review_refresh_required exhaustion are still future transport work.
6. Enforce identity-workflow candidate proposals, exact source/supplement/context binding, certification and independently authorized atomic application. No actual certification, source completeness, person creation, login linking or operational grant follows from these tests.

M05 stays open and M06 partial. Inventory integration, active Companion cutover, hosted services, notification delivery, copied-component retirement and remaining workflows remain separate.
