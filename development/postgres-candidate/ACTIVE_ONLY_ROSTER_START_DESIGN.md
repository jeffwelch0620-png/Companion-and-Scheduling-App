# Initial active-only roster — owner-selected scope

Selected October 16, 2026. The owner clarified that archived employees cannot be obtained in the supplied CSV format without individually unarchiving them and approved starting with active employees rather than importing historical employees. This supersedes the earlier request to wait for an inactive/all-employee export. Do not unarchive employees or manufacture historical records for migration preparation.

This is a scope/design update within draft PR56, not an implemented import or supported input version. Accepted main remains PR55 at `648b844`; V1/V2 behavior, published 001–063, the manifest and SQL snapshot remain unchanged. See the [fingerprint contract](SOURCE_FINGERPRINT_PROVENANCE_DESIGN.md) and [observed CSV profile](TOAST_ROSTER_PROFILE_REVIEW.md).

## Initial population and truthful coverage

- Declare the population as **initial active employees only**, for a named reviewed store/tenant and effective roster date. Archived/history coverage is excluded and not supplied; never represent it as an empty complete historical family.
- The effective date and current active population require manager review. A filename timestamp or the workbook creation date is not a cutover approval. Refresh the active export or reconcile changes if staff changed after the sample was supplied.
- Bind actual active-export scope/filter, parsed row/identity checks, count reconciliation and reviewer evidence to the declared population. An active-only review can cover that population; it cannot certify all historical employees or unrelated source families.
- Review current target people, memberships and aliases before application. Preserve every existing identity/history reference. Any existing active target member absent from the source requires explicit reconciliation; a missing source row never means inactive, archived or deleted. Existing archived target references need not be replaced from a provider export to remain intact.
- A later rehire or newly discovered person receives explicit reviewed identity linking. Do not match by name/email, invent another person or grant access merely because a source record appears.

## Completeness implementation boundary

The current V1/V2 preview explicitly requires `inactiveIncluded:true` for complete roster coverage. Keep that rule and legacy outputs unchanged. Do **not** set that flag to true for this export, remove the global guard, or reuse the fictional direct-certification shortcut.

The proposed V3 extension must carry an explicit population/scope declaration and distinguish active-population coverage from excluded archived history. Bind population, effective date, profile, source versions, reviewed mapping/supplement revisions and relevant target context into the review/provenance contract. Approval must not be replayed for a broader/different population or a later changed target. If later candidate SQL needs a scope-aware certification change, add the next free corrective migration (currently 064); no SQL is part of this draft.

Retain S03 atomic application per declared completeness scope. Unresolved identity, job, supplement or target reconciliation findings keep that application's scope incomplete; inspection and preparation of other work can continue. Copy/batch partial-save policy is separate.

Approved current/future time off, availability and person-wide conflict evidence remain separate scheduling inputs. Do not turn unavailable leave into an empty approved set or bypass weekly publication checks. Existing target leave is preserved. This active-only choice removes the need for provider archived history, not the need for current scheduling evidence.

## Private manager mapping instrument

The source provides names, employee GUIDs and job lists. A private workbook can prefill only those useful source fields and present these decisions:

| Review level | Manager supplies |
| --- | --- |
| Once per source job | Department, whether the job may be scheduled, reviewer/date and exception notes. Preserve the original job identifier and label. |
| Per employee | Primary job from that person's reported jobs, additional scheduling-job choice, regular versus schedule-only participation, reviewer/date and exception notes. |
| Once per initial roster | Effective date, current roster reviewer and confirmation that the supplied active export was reviewed for this scope. |

The workbook must leave decisions blank, distinguish source from editable fields and flag unknown job-ID semantics. A workbook J-key is a local review reference, not a new provider/canonical identifier. “No scheduling jobs” can retain a primary employment position without proposing scheduling eligibility. Limited additional-job selections remain individually reviewed rather than silently approving every job. No account, capability or database update follows from a completed worksheet.

The worksheet excludes contacts and compensation, remains outside Git, and is not attached to a public PR or shared Space without an explicit delivery request. Public documentation records schema/policy and aggregate validation only. Preserve the original source file. Create wholly fictional public test fixtures independently, not by modifying real employee rows.

## Required implementation cases

1. A reviewed active-only initial population can proceed through its explicitly supported new scope without any archived export; the result does not claim historical coverage.
2. Legacy V1/V2 active-only input remains incomplete under its existing contract. False `inactiveIncluded`, absent leave and incomplete source evidence are never relabelled as complete.
3. Missing existing active target identities, duplicate GUIDs, stale aliases, unresolved jobs or supplements refuse application for the declared scope without writes, receipts or completeness advancement.
4. Later source omission preserves membership, access, historical shifts and leave; it creates a reconciliation obligation rather than deactivation or deletion.
5. Changing population, effective date, mapping/primary-job selection, source version or relevant target/access context invalidates the old review.
6. Retained archived target references and explicit rehire identity links survive without historical provider import. Cross-store authority and person-wide conflict protection remain.
7. Current time-off/availability or authorization failures still block the relevant scheduling actions. No direct fixture certification path is exposed to production.

These are future acceptance cases. Next work is to review this contract and the private mapping instrument, then implement the pure fingerprint/normalizer preparation with fictional fixtures. Authorized shared target reads, application/certification, active backend adoption, Inventory integration and hosted rollout remain separate work.
