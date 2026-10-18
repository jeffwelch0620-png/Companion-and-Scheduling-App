# Personal onboarding intent and account-link contract

Prepared from owner-approved PR65 main `9770b01c7f1a7b560dfc5143d7419e794eda413d`, reviewed head `006d3e550f27fa4571cd0f04b28e98d791d6bcd5`. [Exact-head PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39099308931) and [branch CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39099304976/attempts/2) passed 1162/1162. [PR65 merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39100225938) passed 1162/1162 on its first attempt, including fresh migrations/snapshot, strict types and previews. This docs-only draft on `codex/companion-onboarding-intent-design` requires its own review and merge approval; it creates no accounts, setup approvals, links, grants, routes or SQL.

## Selected A04 authority and remaining holds

This contract refines the [personal-access lifecycle](PERSONAL_ACCESS_LIFECYCLE_DESIGN.md), [shared identity design](SHARED_EMPLOYEE_IDENTITY_ACCESS_DESIGN.md) and accepted [fictional rehearsal](ACCESS_LIFECYCLE_POLICY_REHEARSAL_CHECKPOINT.md). Owner selections made for this step are recorded separately from implementation and provider feasibility.

| Decision | Rule | Status |
| --- | --- | --- |
| A04.1 Setup issuance | Current organization owners, currently enabled admin, and explicitly designated store setup issuers may issue setup approvals for an already reviewed person. Setup grants neither identity proof, account rebind nor operational permissions. | Owner-selected in this review. |
| A04.2 Link approval | Only current organization owners and currently enabled admin approve the canonical person-to-provider-account link in the first release; no delegated identity reviewers. | Owner-selected in this review. |
| A04.3 Self-directed ordinary grant increases | Owners and currently enabled admin may increase their own explicitly granted ordinary operational permissions with a required reason and audit. No second actor is required merely because the grant target is the actor. | Owner-selected in this review, superseding A04's earlier proposed no-self-increase rule. |
| A05 Dependent security/provider settings | Exact setup/proposal validity, attempt/rate/lease limits, sensitive-action reauthentication, target notification/response rules, owner exception/recovery proof and supported provider transport/reconciliation. | Pending; no product timing values, provider APIs or operator bypass are selected here. |
| A06 / S05 Metadata custody | Contact/setup/recovery/audit retention, deletion and supported enrollment/recovery delivery. | Pending; no new credential archive or default cleanup period. |

Setup-issuer authority is an explicitly registered store permission administered under A01 by owners/currently enabled admin; a GM title or source-review designation does not imply it. A store issuer is limited to already approved, non-schedule-only people in that store, and cannot enumerate unrelated people, issue for another store or use that role for non-employed organization actors. Store employment-dependent issuer grants follow the membership epoch and no-pre-staging rules. Organization owners/admin may use their separate organization policy to onboard explicitly reviewed non-employed owners or external reviewers without fabricated employment. Issuer authority still needs its own implementation and current-state checks; no permission name or default role grant is installed by this document.

Self-increases remain bounded by A01's registered capabilities, exact scopes, approved non-schedule-only employment at grant creation and the current membership epoch where employment-dependent. A self-grant cannot create an owner seat, enable the administrator switch, create a source-certification designation or bypass any command's consent/independence rules. schedule.correct stays explicitly granted, initially to nobody; authoring a correction to one's own shift still needs a different authorized person to approve. Organization policy authority is not expanded by an operational self-grant, and an ordinary manager gains no grant-administration power. Required reason/audit applies to every permitted self-increase; this selects no silent default grant.

## Source evidence and boundary

Read-only inspection at PR65 main found one-use hashed setup codes, attempt limits, membership-revision checks and audited issuance/revocation in `app/shared/employee-login.ts`; `employee-session.ts` binds current D1 sessions to membership revisions. `access-service.ts` has separate administrator invitation/recovery state and guarded writes. These are source observations, not hosted/provider proof. Existing fixed durations, D1 identifiers and code-to-session behavior are not shared defaults. The future flow keeps four separate decisions: setup issuance, verified provider authentication, reviewed person/account binding and operational grants.

Inventory owns the future single shared migration ledger, with Jeff approving shared changes. Its exact tested baseline/catalog remains pending. This contract does not change Inventory, the active D1 application, candidate migrations 001–063, migrations.json, schema-snapshot.sql, hosted services or a provider account. SQL 064 is not needed.

## Intent envelope and separate state axes

The future app-owned intent binds organization, approved canonical person UUID, optional store/membership scope, immutable intent/receipt identity, initiating actor, reason, exact payload digest, relevant person/link/membership/input revisions and issuer authority/eligibility fence. Store issuer scope is rechecked against its current grant and employment epoch; a source email/name, Toast GUID or claimed manager role cannot select the human. Record setup approval hash/validity/attempt metadata separately from provider operation references and reviewed link evidence. Do not store raw credentials, setup secrets, provider access/refresh tokens or credential snapshots in the intent, receipt, audit or source archive.

The following are logical state axes, not installed columns or endpoint names. Keeping them separate prevents expiry/revocation from erasing an unresolved provider side effect.

| Axis | Proposed states / meaning |
| --- | --- |
| Setup approval | proposed, approved, consumed, expired, revoked; one-use approval targets the exact reviewed person/context. |
| Provider operation | not_started, pending, unknown, confirmed, refused; unknown is a timeout/ambiguous outcome, never proof of absence. |
| Link review | not_requested, pending, linked, refused; confirmed provider proof alone does not commit a person link. |
| Reconciliation | none, required, resolved; may remain required even after setup expiry/revocation. Resolution needs supported verified provider evidence and current authority. |

Provider/intent/approval versions and semantic revisions remain distinct from routine token refresh or unrelated workspace activity. The shared implementation must capture trusted lifecycle continuity; fictional supplied flags from the rehearsals are never a substitute. Current request authentication and current actor authority precede private intent/receipt reads, with no existence leakage to unrelated issuers or stores.

## Proposed progression and failure contract

1. An authorized issuer requests setup for an already reviewed person within their scope. Refuse an existing active primary provider link in the ordinary first-link flow; route replacement/rebind to separately reviewed recovery. A03 keeps people without usable personal email/phone pending for sign-in while preserving their scheduling/employment/history; do not invent contact information or substitute a shared PIN.
2. In a coordinated app transaction, recheck current issuer authority, person/membership scope, relevant revisions and exact payload, then record the intent/one-use approval and minimal audit/receipt outcome. The setup code approves proceeding with setup; it is not personal authentication and cannot establish the provider subject or create permissions.
3. Before any provider side effect, durably record the specific operation against that intent through the future trusted adapter. Perform provider enrollment/authentication outside SQL locks and retry callbacks. Use only supported provider idempotency/reconciliation guarantees; if those cannot be proven, hold progression rather than create another account after a timeout. Lease/attempt bounds remain A05 selections, not copied constants.
4. Bind verified provider proof to the exact intent, canonical person proposal, configured provider/issuer/tenant namespace and subject, supported audience/challenge and current validity. Browser-selected actor IDs, possession of the setup code, matching email/name or a provider account-creation response alone cannot approve the human binding. A source export never provisions a login or operational authority.
5. A04.2 owner/admin reviews the person-to-subject match. Under shared coordination, recheck the current reviewer/session, issuer authority/fence, person/link/membership context, approval state, supported provider proof and exact expected revisions. Enforce one current person per provider identity and at most one active primary link per person, including concurrent intents. Commit link, approval consumption, audit and receipt atomically or none; no operational capability is created. A stale or revoked reviewer/issuer cannot finish from old setup evidence.
6. Reuse the same intent/receipt for retry or uncertain-response inspection after current authorization. Same identity/payload yields the already committed metadata; changed payload conflicts. A committed link is never duplicated by replay. Do not put a raw setup secret in a durable receipt merely to make it replayable. Safe one-time delivery and lost-issuance-response behavior must be selected under A05/A06 before implementation; metadata-only replay with an explicit superseding reissue is a proposal, not an adopted delivery mechanism.
7. Timeout or lost provider response leaves provider=unknown and reconciliation=required. Verify the original operation with the trusted adapter; do not search by name/email to infer a match, create a second human/account, delete a possibly successful account or clear the obligation on expiry. If provider creation succeeded but local authority was lost, preserve the reconciliation record and grant no access. Account cleanup/rebind requires separately authorized identity/recovery review.
8. Expiry/revocation/ordinary reissue invalidates superseded local setup approval under coordination but does not rewrite people, memberships, past actors or an unknown external outcome. Concurrent reissue/redemption must serialize; exactly one valid approval may be consumed for the reviewed link. Exceptions, reauthentication, actual delivery and provider-side cancellation remain explicit A05/A06/provider decisions.

The issuing actor's durable authority/eligibility is revalidated; do not treat routine refresh, last-seen changes or unrelated workspace writes as revocation. Whether expiration of the original issuer browser session affects an already issued approval must be settled in the A05 session contract; no requirement for the issuer to remain continuously logged in is silently introduced. The actor making each current request always needs their own valid verified session. Setup/link access and receipt fences must detect relevant committed revocation before returning private results, using the [separate current final-access check](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md).

## Coordination, audit and privacy requirements

Use Inventory's reviewed shared organization/store/person lock order and explicit write definitions after the tested handoff. Revalidate affected scopes after locks, retry whole SQLSTATE 40001 transactions with the original receipt/payload, and keep provider side effects outside those retries. Do not attach custom lifecycle triggers to provider-managed auth.sessions. No SQL, lock, retry, provider call or concurrency test is implemented by this design.

Audit the canonical actor/person, exact scope/action, reason, expected/current revisions, proposal/intent/receipt/operation references and approved before/after link or grant metadata. Current display names come from the shared employee projection; a historical name is labelled name at time of entry. Setup issuers receive only their authorized setup status, not other-store rosters, contacts, unrelated owner records or provider credentials. Operator diagnostics and real intake reports stay outside Git/PR artifacts; use only fictional public fixtures and aggregate evidence. Transactional notice intent does not prove delivery.

## Required future acceptance scenarios

These are implementation requirements, not tests passed by this docs-only PR.

| Scenario | Required result |
| --- | --- |
| Owner/admin or designated store issuer; ordinary GM or source reviewer without setup grant | Selected issuer only, exact scope/current membership epoch; title/designation alone does not authorize setup. |
| Store issuer targets another store, a schedule-only record or a non-employed organization actor | Refuse; legitimate non-employed owner/reviewer setup uses separately authorized organization authority without fabricated employment. |
| Setup issuer tries to approve a provider link or grant operational permissions | Refuse unless independently authorized by A04.2 or A01; issuing a code supplies neither power. |
| Owner/admin increases their own ordinary grant; ordinary manager tries the same | Owner/admin self-increase may pass with required reason, audit and all grant prerequisites; ordinary manager fails. No protected owner/admin/designation workflow or own-correction independence bypass. |
| Setup code is copied, expired, already consumed or for a different intent/person | No identity or grant from the code alone; refuse stale/replayed consumption and disclose no unrelated identity. |
| Two intents race to link one provider subject or add two primary links for one person | Coordinated current uniqueness checks allow only the reviewed single current binding; no duplicate link or guessed merge. |
| Provider response is lost, then setup expires or issuer is revoked | Preserve unknown-provider reconciliation; no second account, automatic deletion or access grant; current authority required for inspection/resolution. |
| Issuer/reviewer loses authority or a membership epoch/person/link changes before final commit | Refuse stale context after locks; no partial link, approval consumption, audit or receipt. Routine token refresh/unrelated workspace write alone does not stale it. |
| Same receipt/payload replay; altered payload; replay after access loss | One metadata outcome, payload conflict, or current-access denial respectively; no raw-secret replay, duplicate link or duplicate notice intent. |
| Ordinary reissue encounters an existing linked account or ambiguous provider outcome | Route to reviewed recovery/reconciliation; never silently rebind or erase an unresolved external operation. |
| Target read completes, then revocation commits before final access check | Discard the private result using a separate current check; no stale repeatable-read authorization. |
| No usable personal contact; source roster claims an owner/manager role | Preserve records and pending sign-in; no fabricated contact or imported authority. |

## Delivery order and remaining decisions

1. Review this draft and record the selected A04 choices without granting anything. A04.1–A04.3 are selected; A05/A06 still gate their dependent commands and actual provider delivery.
2. Pin Inventory's tested baseline/catalog/migration handoff and provider feasibility. Review exact proof, reauthentication, limits, notification/recovery and one-time secret-delivery/replay choices before implementation.
3. Rehearse the intent/reconciliation transitions with wholly fictional input; then implement explicit shared definitions and a trusted verified provider adapter in the one approved ledger. Treat existing pure oracles as comparison fixtures, never authentication services.
4. Test actual transactions/uniqueness/revocation/receipt privacy and provider-timeout reconciliation before exposing setup/link or grant endpoints. Keep actual shared target reads, source certification/application, live notifications and hosted deployment separately reviewed.

M05 remains open and M06 partial. This contract and its merge do not complete personal sign-in, provider integration or Inventory adoption, or select pending A05/A06 values and operator exceptions.
