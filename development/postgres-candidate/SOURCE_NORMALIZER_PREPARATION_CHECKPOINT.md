# Read-only source normalizer preparation

Preparation from accepted PR53 main `aa9557b007c1134252f81f19601ac5e78c10beee`, reviewed head `ac5df8e7a8601597d89534d34520af4cd6eca6ad`. PR54 was separately approved and accepted at `fd3dc3cc2422aa53a76c7b8b3439fbabd86f9ed0` from reviewed head `847bcb8`; [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38563485997) passed 913/913, fresh migrations/snapshot, strict types and previews. This accepted V1 slice implements the first preview carry-overs from the [normalization/target-read design](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md). Its acceptance does not enable shared/hosted adoption.

## Behavior added

| Finding | Result and operator action |
| --- | --- |
| Omitted target member/leave reference, or a valid unused alias | Global issue severity `review_required`. When no blockers exist the report status is `review_required`, CLI exit 3. Retain current targets and explicitly reconcile; this is not approval or deletion. Existing row categories/counts remain new/unchanged/changed/omitted/blocked. |
| Invalid identity/configuration/revision/coverage or another genuine blocker | Severity `blocking`, report status `blocked`, CLI exit 2. Blocking takes precedence without hiding review-required issues. Malformed/unavailable/oversized input remains exit 1; a reviewable comparison remains exit 0. |
| Source leave status `cancelled` or `withdrawn` | Structurally accepted for inspection, then blocked at row level with `leave_withdrawal_policy_required`. Preserve any existing target leave; resolve the separate cancellation/withdrawal policy first. Other valid rows still appear in the comparison. No leave decision is applied. |
| Source member exists but its row failed review | Dependent leave has `leave_member_blocked` and `memberSourceId`, in both row diagnostics and the corresponding global issue. This applies even when the leave's own alias is missing. |
| Source member is absent | `leave_member_mapping_required` with the source member ID distinguishes absence from an existing blocked row. The dependency remains non-actionable. |

Only source leave inspection gains cancelled/withdrawn states. Supplied target states remain the supported pending/approved/declined contract; no database state, migration, canonical withdrawal command or approved-leave resolution is introduced. Policy-required withdrawal findings are blockers in this slice, not a softer omission review.

V1 input and integer revision semantics remain intact. Reports add issue severity, a third overall status and minimal dependent source IDs; scripts consuming reports must handle `review_required`/exit 3 explicitly. Duplicate leave with different member/withdrawal findings stays blocked and receives a deterministic diagnostic tie-breaker; input order cannot choose a winner or change the report. No application consumes this candidate CLI, and it adds no app route or UI. The fictional example remains two new and one unchanged comparison.

Every report still has `canApply:false`, `completenessCertified:false` and `accessProvisioned:false`. A valid or review-required comparison cannot open scheduling, approve memberships, invite users or grant authority. Supplied target snapshots and coverage declarations remain offline evidence rather than live authorization/freshness or completeness proof.

## Privacy and scope

Preview reports are sensitive operator artifacts: never commit them or attach them to PRs, including generated fictional reports. Retained private source/report material requires authorized restricted storage; fictional working evidence belongs in ignored `work/`. Public synthetic input fixtures and aggregate test results remain separate. Reports expose only the already-reviewed identifiers, revisions, field names and issue codes; dependency diagnostics add source member IDs without names, job labels, contact details or leave notes. Tests verify input bytes and targets remain unchanged.

Only the tracked candidate preview/CLI/tests and documentation change. Published 001-063, `migrations.json`, `schema-snapshot.sql`, active Companion, Inventory and hosted services remain unchanged. This does not implement V2 fingerprints, raw-file parsing, current target reads, source-review grants/certification, imports or notification delivery.

## Selected first source and next implementation

On October 14 the owner selected **reviewed Toast employee/job snapshot files** as the first raw-file source family. This does not select a live connection or certify those snapshots. The exact file/export schema/version, authorized sanitized representative sample, export filters/inactive coverage, namespace/store/job mappings and consistency evidence still need review. The inspected Toast code supplies no verified provider revision or leave coverage. Never fabricate integer source revisions or complete empty leave to make those files pass V1.

Next review the representative format and versioned content-fingerprint/provenance contract, then implement a pure bounded file normalizer with fictional fixtures. Roster-only inspection needs an explicit supported family/version rather than fabricating leave. Keep S02 field ownership and S05 retention/production limits pending; shared identity/read dependencies and importer application remain separate. The selected calendar-day leave and owner/admin-only reviewer designation rules remain documented policies, not implemented permissions or date-only parsing in this slice.

## Validation

The focused preview/follow-up/reference-mapping/manifest suite passes 41/41, including eight new checks. They cover review-only versus mixed severities, unchanged valid comparisons, cancelled/withdrawn new and existing leave, retained targets, unsupported source/target statuses, stale/job/duplicate member dependencies, absent versus blocked members with missing leave aliases, duplicate leave permutation with different findings, actual CLI exit 3/2/1, byte preservation and minimized diagnostics. Existing 21 preview and 11 mapping checks plus manifest validation remain intact.

Fresh fictional loopback application through unchanged 001-063 and function snapshot comparison passed. Candidate type/preview checks and full exact-head CI are recorded on the draft PR after completion. Acceptance scenarios in the design for live target access, V2 fingerprints and source coverage remain future implementation tests, not results of these preview checks.

PR54 final review re-ran 41/41 focused checks before the authorized merge; exact-head and merged-main CI passed 913/913. The next separately drafted [V2 family coverage slice](SOURCE_FAMILY_COVERAGE_CHECKPOINT.md) preserves these V1 behaviors, declares unavailable families explicitly and adds the owner-confirmed inactive historical leave exception only under V2. Fingerprint/Toast normalization awaits the owner-supplied authorized sanitized sample, schema and coverage evidence. Cancelled/withdrawn target states remain unsupported until the shared cancellation/read contract is ported.
