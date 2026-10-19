# Personal access security and recovery — owner decision package

Docs-only draft from accepted PR68 main `09fa3d9a7d911789a1168d1c0db5424f45749b30`, reviewed head `aa1b4399a451e68e50787e7a8c87f05962a9521d`. [Exact-head PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39177968710) and [merged-main push CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39178690959) each passed 1351/1351 on attempt 1, with fresh migrations/snapshot, strict types and previews. Both pulled the pinned GHCR image, with no ECR reference, retries or skipped tests.

## Outcome and authority boundary

Turn the remaining A05/A06 questions into a reviewable sequence before shared sign-in work. The [personal access lifecycle](PERSONAL_ACCESS_LIFECYCLE_DESIGN.md), [onboarding contract](PERSONAL_ONBOARDING_INTENT_DESIGN.md), [reviewer design](SOURCE_REVIEWER_ACCESS_DESIGN.md) and [admin self-grant rehearsal](ADMIN_SELF_GRANT_POLICY_REHEARSAL_CHECKPOINT.md) remain governing references. This draft proposes procedures and future acceptance cases; merging it does not select the pending policies below.

No SQL, application code, provider calls, keys, account/link/grant/session changes, messages, recovery action or automatic retention/deletion is included. Migrations 001–063, migrations.json and schema-snapshot.sql stay unchanged; 064 is not needed. Inventory owns the future shared ledger and Jeff approves shared-schema changes. Its exact tested receiving baseline/catalog/handoff remains pending for this port. M05 remains open and M06 partial.

## Preserve decisions already selected

| Contract | Accepted boundary |
| --- | --- |
| Normal owner changes | A02 requires different existing eligible owners; the target can explicitly consent as second approver. Non-last voluntary self-removal also needs another owner. An explicit objection holds ordinary removal, including with three or more owners; silence is not consent or an objection. |
| Exceptional owner changes | Initial bootstrap, single-owner addition, contested removal and loss of the last eligible owner remain held for A05. A repository, infrastructure or provider operator is not an application owner merely from that access. |
| Personal onboarding | Setup and linking are separate; a current owner/enabled admin different from issuer and intended person approves the provider link against the selected contact/attestation standard. No usable personal contact means sign-in pending, with scheduling/history preserved. |
| Employment and grants | No pre-staged employment-dependent grants. Lapse or schedule-only status advances the membership epoch; rehire does not revive old grants. Admin reassignment suspends the outgoing person's self-grants; owner reconfirmation is person/scope-specific. |
| Provider uncertainty | Unknown or confirmed-but-unlinked provider outcomes preserve reconciliation through approval expiry/revocation. A second account, automatic deletion or a new subject in the old intent is not a recovery shortcut. |
| Current authority | Final coordinated checks and separate current read-access checks remain mandatory. Session revision does not advance on routine refresh. Recovery does not bypass receipts, consent, independence, source-review eligibility vectors or completed-shift correction rules. |

## Owner decisions still pending

Every SEC row below is **pending owner selection and provider/catalog verification**. Recommendations are proposals only. Affected commands remain unavailable until their dependencies are selected and implemented. Accepting this document does not grant a recovery role or choose any omitted value.

| ID / parent | Decision to select | Recommended direction | Status |
| --- | --- | --- | --- |
| SEC01 / A05 | Which sensitive actions require MFA and fresh proof? | Require server-verified MFA plus fresh action-bound proof for protected owner/admin changes, operational grant increases/reconfirmation, source/setup designation increases, canonical link/rebind and exceptional recovery. Define distinct requirements for routine reads, emergency revocations and self-relinquishment rather than accidentally blocking those safety paths. | Pending; no factor type, freshness interval or exemption selected. |
| SEC02 / A05 | Reauthentication age, proposal expiry, setup lifetime, attempt/rate limits and provider-operation lease bounds | Select explicit bounded values separately for each purpose. Derive action proof from a supported verified factor event; token refresh/last-seen never creates fresh proof. Reject expired contexts, preserve unresolved provider outcomes and use an explicit retryable lease-busy result. | Pending values and scope/window rules; fixture limits are not product settings. |
| SEC03 / A05 | Does original issuer browser-session expiry invalidate an unused setup approval? | Let it survive ordinary logout/expiry while the issuer's durable authority/eligibility remains valid. Each current requester needs their own valid session; semantic revocation or lifecycle change still stales the relevant context. | Pending owner selection; no current behavior changed. |
| SEC04 / A05 | Owner-removal notice recipients, delivery evidence and minimum response interval | Notify the target and other current owners through reviewed channels before the response interval starts; hold on unresolved delivery. Bind the interval to this exact proposal/revision; substantive changes require new notice. An objection holds ordinary removal; silence after the selected interval supplies no consent. | Pending channels, recipients, interval, expiry and delivery-failure handling. |
| SEC05 / A05 | Initial bootstrap and single-owner addition evidence/approvers | Use an explicitly reviewed initial roster and independent human/provider-link verification. Include two initial owners only when intended and approved. Single-owner addition needs a separately approved exceptional case, never a relaxation of ordinary A02. | Pending named governance approvers, technical executor and evidence standard. |
| SEC06 / A05 | Contested removal and loss-of-last-owner recovery | Keep a manual case hold until separately reviewed governance approval and independently verified identities authorize a narrowly scoped application. No generic operator override, shared PIN, first-login claim or automatic winner. | Pending who may authorize/execute each case, conflicts of interest and unresolved-dispute outcome. |
| SEC07 / A05–A06 | Lost authenticator/contact, provider recovery and canonical rebind | Distinguish recovery of the same provider subject from changing the canonical link. Independently reverify the human and bindings; any rebind is a separate reviewed exception, preserving person/history and reconciling old sessions/lifecycle vectors. | Pending evidence, approvers, supported transport and required invalidations/notices. |
| SEC08 / A06 | Setup delivery and lost-response handling | Prefer provider-managed personal delivery after independent evidence checks. Return only intent/status metadata to issuers; no raw secret in an application receipt. Uncertain delivery leads to inspection or authorized superseding reissue, preserving any provider obligation. | Pending provider behavior, delivery channel and one-time-secret custody. |
| SEC09 / A06/source S05 | Audit, contact/evidence, operational metadata, private reports/workbooks and backup retention | Use the class-specific custody table below, with explicit periods, access, deletion authority and hold/backup handling. Do not copy a current D1 lifetime or infer a cleanup period. | Pending owner policy and operational/legal review where applicable; no automatic deletion. |

The first review should settle SEC01, SEC03 and the governance model for SEC05/SEC06, then select SEC02/SEC04 values and SEC07/SEC08 delivery after provider verification. SEC09 is an independent custody review. Each selection must be recorded in the Status column with its exact scope; unresolved subchoices stay pending. Do not turn a broad “proceed” into approval of an unnamed operator, time interval or retention period.

## Proposed sensitive-action proof contract

This section depends on SEC01/SEC02; it defines no installed endpoint or token format. A future trusted adapter must verify the provider, audience and subject, resolve the current canonical person/session and capture supported fresh-factor evidence. A browser-supplied AAL, boolean, timestamp, factor screenshot or second account is insufficient. Bind the proof to canonical actor, organization, action, exact payload/proposal digest, relevant semantic revisions and a selected expiry. A changed action/target/payload needs fresh review. Do not claim every provider JWT's issue time proves a fresh factor challenge.

At application, coordinate the shared scopes, check current authority, evidence/freshness, target eligibility and exact revisions, then consume any one-use application proof and commit business change/audit/receipt atomically. Provider side effects occur outside SQL locks and retry callbacks. A committed receipt can replay its authorized metadata without rerunning the provider operation; changed payload conflicts, and a revoked actor cannot inspect it. A stale or expired proposal is refused rather than silently extended. Selection of bounded timings does not certify provider idempotency or solve distributed atomicity.

Revocation, personal logout and self-relinquishment require explicit SEC01 treatment so a lost factor cannot force continued access. Any limited safety path must be separately specified by exact subject/scope, cannot grant or broaden access, must retain reason/audit and must not become a replacement account-recovery path. Until selected, this draft creates no exemption to existing checks.

## Proposed exceptional case sequence

1. Record a minimal private case for one organization/person/action. Capture the accepted source revisions and evidence references, without credentials or an invented employment membership. A case ID confers no access.
2. Identify the independently verified people proposed as governance approvers and technical executor under the separately selected SEC05/SEC06 rules. Bind their current authority and conflicts of interest. Infrastructure access alone cannot count as app-owner consent. If the selected approvers/evidence are unavailable, remain held; do not invent a fallback.
3. Preserve the ordinary A02 route wherever it can succeed. For an explicit objection or missing distinct eligible owner, ordinary application remains refused. Document the exceptional scope and governance disposition separately; a support ticket is not consent and an objection is not withdrawn by timeout.
4. Review exact proposed owner/person/link changes, target notification and response evidence, current roster and source keys. Reverify immediately before application under the shared lock order. A material change stales the case; no SQL script with a guessed person ID is an approved bootstrap roster.
5. Use an explicitly reviewed application path in Inventory's single ledger after the tested catalog handoff. Apply only the approved scope, with current-state checks, audit and receipt; preserve the original person/history. An executor gains no durable ownership or ordinary grant from executing the case.
6. Independently verify the resulting access/link/session state, lifecycle invalidation and minimal owner notice intents. Provider reconciliation and actual notice delivery remain separate obligations. Refusal or ambiguity grants nothing and keeps the case evidence/holds. No such application path is implemented or authorized by this draft.

## Provider evidence and unresolved feasibility

These are documentation observations, not project-configuration or runtime proof. No provider request was made.

| Official reference | Documented feature | What must still be verified for JMAX |
| --- | --- | --- |
| [Supabase MFA guide](https://supabase.com/docs/guides/auth/auth-mfa) and [assurance API](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel) | Supabase exposes MFA assurance levels, including aal2 for a verified second factor. | Selected factor availability/configuration, server proof verification, current lifecycle/session state and a supported way to establish action-specific freshness. An old aal2 JWT alone is not proof of a fresh action challenge. |
| [Supabase password recovery](https://supabase.com/docs/guides/auth/passwords) | Its password-reset flow sends a recovery email and does not disclose account existence through the request response. | Configured delivery/redirects, personal evidence, quotas, lost delivery/response, expired/replayed links, session effects and same-subject versus canonical-rebind behavior. Password reset does not approve a person link or app ownership. |
| [Supabase generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) | The admin API can generate email links/OTPs for custom delivery. | Whether this is needed at all; trusted server-only execution, secret custody and provider-side effects/idempotency before considering custom transport. It is not an approved implementation or a guarantee that a lost response can be replayed safely. |

After the receiving baseline is pinned, review the actual auth project/configuration, deployed provider version, supported verification/revocation semantics and delivery controls through separately authorized access. Record evidence without keys/tokens/private contacts. Select concrete transport only after that review; fake provider fixtures cannot certify it. Do not attach custom triggers to provider-managed auth.sessions. Reconcile provider-side lapses through a trusted mechanism and monotonic semantic counters; re-enabling a person does not revive captured designations or employment grants.

## Proposed custody classes

All periods, deletion authority and hold procedures remain SEC09 pending. No raw credential is a retention class; passwords, refresh tokens, setup/recovery secrets and factor seeds stay out of application audit, receipts, source archives, Git and PR artifacts.

| Class | Proposed content/access | Decision still required |
| --- | --- | --- |
| Durable access audit and owner cases | Canonical actor/target, action, scope, reason, revisions and evidence references; narrowly authorized owner/governance readers | Period, conflict/legal hold process, executor oversight and deletion authorization; no private evidence copied into event messages. |
| Contact/link evidence | Controlled person repository and attestation references; independently authorized link/recovery reviewers | Minimum evidence, period, redaction and access revocation; never retain a credential snapshot as identity proof. |
| Intent, receipt, lease and reconciliation metadata | Only necessary correlation/state/revision; current-authority private reads | Per-state periods; unresolved provider outcomes must not disappear under a generic expiry/cleanup rule. |
| Delivery diagnostics | Minimal provider correlation and outcome; restricted delivery operators | Failure/retry policy, periods and redaction; tokens/links/contact values excluded from unrestricted logs. |
| Private source reports and manager workbooks | Owner custody outside public Git; real names/GUIDs/jobs remain private | Source S05 / SEC09 archival/deletion after reviewed supplement capture, authorized recipients and holds. Existing files are not deleted by this draft. |
| Backup/recovery copies | Encrypted controlled backups with a reviewed restore process | Expiry/rotation, custody, deletion propagation or documented isolation, and restore reconciliation so revoked access/retired evidence is not silently revived. |

## Future acceptance cases

These are requirements for later tests, not executed or claimed results of this docs-only package.

| Case | Required outcome after dependent policy selection |
| --- | --- |
| Old aal2 proof is refreshed without a new factor event | Routine refresh does not satisfy the chosen fresh-action requirement. |
| Proof is valid but actor, payload, target, relevant revision or expiry changes | Refuse the stale/mismatched sensitive action; no partial business mutation. |
| Same original command receipt is replayed after success or authority loss | One authorized metadata result, or current-access denial; never duplicate provider work or expose secrets. |
| Issuer logs out, versus issuer's durable authority is revoked | Follow the explicit SEC03 selection for ordinary session expiry; semantic authority loss refuses stale progression in either case. |
| Removal target is silent, objects, or the proposal changes during the response interval | Silence supplies no consent; recorded objection holds ordinary removal; material change requires renewed context/notice under SEC04. |
| Owner notice delivery is unresolved | Follow selected delivery-failure policy; no silent immediate-removal fallback. |
| Initial roster intends two owners, or a single owner requests a second | Reviewed bootstrap roster can include the intended two; single-owner addition follows its separately selected exception, not ordinary A02. |
| Two owners attempt contested removal or the last owner loses eligibility | Hold ordinary processing; no repository/provider operator becomes owner automatically. |
| Recovery proof controls a new account but does not establish the canonical human | Refuse link/rebind; do not match by name/email or invent an employment record. |
| Same provider subject recovers credentials, versus a new subject is proposed | Preserve the current link in ordinary provider recovery; new subject requires the distinct reviewed rebind path. |
| Delivery/provider response is lost, then approval expires or is revoked | Preserve unknown or confirmed-but-unlinked reconciliation; do not create another account or delete the possible existing one. |
| Admin seat moves while a sensitive self-increase or owner reconfirmation is reviewed | Current seat/revision checks refuse stale self-increase; A's pending scopes remain A's and owner reconfirmation still targets A. |
| Lifecycle lapse is followed by re-enable, or a backup is restored | Monotonic lifecycle evidence and captured epochs do not revive old grants/designations. Reconcile restored state before exposing access. |
| Retention job encounters unresolved reconciliation or an active case hold | Follow selected state/hold policy; refuse unapproved deletion, with no raw-secret archive. |
| Read completes before committed revocation is observed by the separate final check | Discard private results; a repeatable-read snapshot is not a current final-access check. |

## Delivery gates

1. Review this draft and select pending SEC rows explicitly. Amend the selected decision table before dependent code; leave unresolved values/operator identities as holds.
2. Obtain Inventory's exact tested receiving baseline, catalog and migration handoff; verify supported provider evidence/transport through separately authorized access. No cross-repository SQL or hosted mutation is authorized here.
3. Add focused fictional policy cases for selected decisions where useful. Keep them isolated comparison fixtures, with no claim of real authentication, delivery, operator verification or transactional concurrency.
4. Implement explicit shared definitions and trusted provider adapters in the single approved ledger only after review/authorization. Test races, expiry/revocation, response loss, secret/receipt privacy, lifecycle continuity and restore behavior using fictional local services first.
5. Perform separately approved hosted/provider/device acceptance and recovery rehearsal before rollout. A Git merge of design or candidate code is not deployment, a verified restore or completed M05/M11/M12.
