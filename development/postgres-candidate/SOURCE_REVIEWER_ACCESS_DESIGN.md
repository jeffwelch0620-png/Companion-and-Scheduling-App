# Source-reviewer access and authorized target reads — design review

Prepared from accepted PR61 main `02037e732fbf97864f8c45ff6af29fd2f8b5fc8b`, reviewed head `faa6282f191c488c2f5e735ccbe33ae7961d145e`. [Exact-head PR61 CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39079734467) and [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39081149015) passed 1064/1064. This is the next design slice after the [bounded V3 CLI](SOURCE_V3_CLI_CHECKPOINT.md), on `codex/companion-source-reviewer-access-design`. It adds no SQL, route, grant, account, database read or certification. It requires separate review and merge approval.

## Purpose and prerequisites

Replace supplied offline target/access claims with a verified, scoped server read when the shared identity foundation is ready. First define who can review which source families, how owners administer those designations, and how a read detects current revocation. The existing V3 CLI remains an offline comparison accepting supplied evidence; its accessFence and reviewer labels are never authentication.

The [shared identity design](SHARED_EMPLOYEE_IDENTITY_ACCESS_DESIGN.md), [ingestion policy](SOURCE_INGESTION_DESIGN.md) and [target-read contract](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md) govern this package. The shared schema/migration owner, exact tested Inventory baseline/catalog (I06), verified personal account links/session policy and applicable I07–I09 decisions remain dependencies. This design can be reviewed now; it does not authorize their implementation or invent a replacement shared authz service in candidate_identity.

## Selected policy and questions for the owner

| ID | Policy | Status |
| --- | --- | --- |
| R01 | Organization owners and the currently owner-enabled administrator are eligible to review mappings and certify source completeness within their organization. | Selected in PR51/PR53 decisions. Current session, person and resource checks still apply. |
| R02 | Other reviewers require an explicit organization/store/source-family designation. Ordinary manager titles, location.manage, schedule.publish and source job labels do not confer this authority. | Selected in PR51/PR53 decisions. |
| R03 | Only current owners or the currently enabled administrator may designate/revoke another person; no self-designation; every change is audited. | Selected during PR53 review. Compare person UUIDs across all memberships. |
| R04 | An explicitly designated reviewer may serve without store employment. Require a current verified person/account and the explicit organization/store/family designation; never invent employment. | Selected by owner during this review. A store membership is not a prerequisite. |
| R05 | A designation remains effective until explicitly revoked or current person/account/organization/store eligibility ends; no automatic periodic expiry initially. | Selected by owner during this review. This concerns source reviewers only and does not select administrator/session expiry under I08. |
| R06 | Certification and application are separate authorities. Source review never creates/rebinds people, approves membership, provisions sign-in or grants operational permissions. | Existing selected boundary. Certification/application commands remain future work under S02/S03/S05. |

R04/R05 were explicitly selected by the owner in this review, separately from this draft's merge approval. Eligibility means the current verified person/account, organization/store and explicit designation remain valid; employment status alone is not an eligibility gate. The selected active-only initial Toast population remains in force; archived exports are not a prerequisite. Actual manager job mappings, primary choices, token reviews, population dates and provider bindings remain private intake work.

## Logical designation and authority model

These are proposed logical records, not approved DDL/table names:

- Identify a designation by organization, canonical store, person and source family (roster or timeOff), with a stable UUID, revision, effective state and person-level author/revoker attribution. Validate canonical store ownership and supported family; no wildcard organization/all-families designation for ordinary reviewers.
- Keep review designation separate from employment, provider aliases, operational grants, owner seats and the administrator switch. An organization-wide owner/admin reads through current organization authority; enabling/disabling that status never rewrites reviewer history or creates employment.
- A grant/revoke command must derive the actor from verified server identity, require current owner/enabled-admin authority, compare actor/target person IDs, require a reason and expected designation revision, and retain before/after state. A repeated identical receipt returns one result/audit event; changed payload under the same ID conflicts. Semantic no-ops do not advance access revisions or duplicate events.
- Re-granting a revoked designation is an explicit new audited transition with a new revision; account/person reactivation must not silently restore a designation invalidated by loss of eligibility. Ordinary logout/session expiry only ends that session, not the durable designation; a new verified eligible session may use an otherwise valid designation. Ending or reactivating employment alone neither revokes nor creates this independently designated reviewer authority under selected R04. Explicit revocation, person/account eligibility loss or inactive organization/store ends access; preserve an audited invalidation state and require fresh designation review before restoring invalidated access.
- Designation changes can never edit owners, turn the administrator switch on, bind a login or delegate designation management. Do not derive identity-administration rights from certification eligibility. General delegation/bootstrap/recovery under I07–I09 remain separate.
- A schedule-only membership or roster record alone cannot authenticate or establish source-review authority. An independently verified active person may receive the explicit designation without employment under R04; never convert a roster record into an account or treat schedule-only membership as that designation. A disabled/suspended person, invalid/unlinked session, inactive store or organization mismatch denies access regardless of retained historical designation.
- A timeOff-only designation cannot read a roster directory. If resolving that family needs unavailable person/member information, return an unavailable/unresolved affected review rather than broadening authority. Historical time-off departments remain unchanged.
- Source/target alias review can inspect approved links within scope. Creating/rebinding an identity alias or approving new membership uses the independent identity workflow; selecting a matching name never creates an alias.

Proposed capability vocabulary, for implementation review: source.review for bounded target/mapping review and source.certify for future completeness certification. They must be evaluated through the same shared policy, scoped to organization/store/family, and not be independently assignable shortcuts around R01–R05. Designation management is the protected owner/enabled-admin predicate, not an ordinary grantable source.reviewer.manage capability. No capability is registered or granted here. Application requires its own separately designed permission and command, even for owners.

## Minimal server contract and projection

The future trusted backend accepts only requested organization/store, reviewed provider namespace/families, supported leave dates and explicit alias references. It derives person/session/authority and authoritative revisions on the server. Refuse the whole requested unauthorized scope without partial rows or store-existence/count leakage. Limit scopes before reading; do not accept caller-supplied target people, owner flags or accessFence as proof.

| Projection | Read rule |
| --- | --- |
| Store | Exact configured timezone, department/job keys and relevant configuration revision; no financial settings or provider secrets. |
| Roster | Complete authorized store membership scope needed for reconciliation, including relevant inactive/schedule-only targets, person/member UUIDs, current names, revisions, department/position and scheduling jobs. A filtered active-only provider source does not hide retained inactive target members. |
| People | Only explicitly mapped and authorized identities needed by that scope. A missing directory permission leaves linking unresolved; it does not enumerate organization employees or guess a person. |
| Aliases | Only reviewed organization/system/tenant/external-store/kind/source-ID links and revisions required by this read. Preserve exact source spelling; duplicate identity comparisons retain the accepted case-insensitive UUID rules. No login/contact/recovery data. |
| Leave | Only authorized overlapping intervals in the requested range, IDs/revisions, owner membership, original department and supported status. No medical detail, reason or attachments. Unsupported target cancellation states make the family unavailable pending its reviewed port; never drop them and imply completeness. |
| Context | Exact relevant source-input/configuration/alias/identity revisions and an opaque snapshot/context digest. Workspace revision may be metadata, never the source-read fence. The actor's verified access/session fence is separate. |

A store reviewer does not receive another store's directory or leave records because one person works in both stores. Future application uses a separately authorized minimal person-wide conflict projection, not another store's roster under the source-review grant. Unavailable evidence prevents later application without expanding disclosure.

Source input remains subject to the V3 recomputation, provider-only sourceVersion, population-bound supplement and full-store selection review. Supplement/reviewer changes stale the review context without rewriting provider fingerprints. A provider name/job change changes sourceVersion and requires alias re-review. Never overwrite a target on the basis of a content hash or manufacture current target revisions.

## Read protocol and access fences

1. Verify the personal provider session through the shared server boundary, resolve a current person and organization, validate every requested store/family, and capture the relevant current access fence before private reads.
2. Assemble all target rows, aliases, relevant context and access evidence in one bounded REPEATABLE READ, READ ONLY transaction. Use immutable-ID ordering. Reads need no store coordination or FOR UPDATE locks; privileged fixture clients are not an authorization layer.
3. Commit that transaction. In a separate short READ COMMITTED transaction, re-resolve current session/person/owner-admin/designation eligibility and compare its fence with the initial one. A fence includes changes to session/link/person state, owner/admin policy, relevant designation, store state and any explicit eligibility dependency. Store employment is not such a dependency under selected R04. Use monotonic revisions so revoke/re-enable cannot produce an ABA match.
4. If authorization is invalid or that access fence moved, discard the complete assembled result; return a fixed refusal/refresh outcome without target fragments. Never check current access through the old repeatable-read snapshot. A revocation committed before this final access check must be detected. This cannot retract already delivered data or guarantee detection of a commit after the final check; every subsequent read/command rechecks current authority.
5. Relevant source-input, target/person/alias/configuration changes require a coherent refresh rather than combining snapshots. Retry relevant data drift at most three whole attempts; recheck access every attempt and stop immediately on a true denial. Routine task/dish/goal/attendance workspace writes do not cause a restart. Unknown/unavailable state never yields an empty complete target.

Prefer one bounded response for the first implementation. The accepted technical caps remain safeguards rather than selected production limits: at most 20 stores and 2000 rows per supported family/store, with existing byte and mapping limits enforced. If serialization or required target context exceeds its bound, return a fixed narrower-scope/review obligation, no truncated successful response. One unsupported or oversized family cannot masquerade as complete; independent source-family availability remains explicit.

If pagination is later necessary, it requires a separately reviewed coherent server snapshot/continuation protocol bound to person/session/organization/scope/date range/context. Independent READ COMMITTED pages plus a global workspace fence are insufficient. Do not add durable employee snapshots while S05 retention is pending.

## Coordination, audit and privacy

Future designation/identity writes must use the shared lock order and explicit definitions from the identity/coordination designs, not regex patches or custom triggers on provider-managed auth.sessions. Coordinate the affected organization/store/person scopes before mutation; revalidate that scope set after locks. Deletes and eligibility-driven revocations must coordinate while their parent context still exists. SQLSTATE 40001 retries the whole transaction with the same frozen request; preserve HTTP 503 coordination_retry. Provider side effects do not belong in that transaction retry callback.

Access changes advance relevant monotonic policy/designation/identity fences, while semantic no-ops preserve them. They are not routine workspace changes and must not invalidate unrelated attendance/correction drains. Changing roster eligibility still follows the existing relevant-column input/schedule invalidation rules. Certification freshness at future application time must be checked against current authorized context; a former reviewer's historical signature is audit evidence, not present application authority.

Audit includes actor/target person UUIDs, store/family, action, before/after revision/state, reason, time and receipt identity. Current display names come from the shared person repository; retained entry names are labelled name at time of entry. Preserve history if employment/login ends. Final audit/log retention, reader visibility, source-file custody and production bounds remain S05/I08 decisions; no automatic deletion interval is selected here.

Target responses and private workbooks/reports stay in owner-controlled storage under the accepted custody boundary. No public cache, browser localStorage/sessionStorage employee export, report attachment to PRs, plaintext credentials, contact/payroll data or raw input in logs. Public fixtures are wholly fictional. Error codes are fixed and data-free. Ordinary runtime credentials expose reviewed functions only; server privilege does not make caller-supplied scope authoritative.

## Required future acceptance scenarios

These are implementation requirements, not completed tests:

| Scenario | Required result |
| --- | --- |
| Owner without employment, enabled admin, designated reviewer, ordinary manager | First three pass only within their eligible scope; ordinary manager denied; no fictitious owner membership. |
| Admin disabled, actor suspended/unlinked, session revoked, store deactivated | Current reads refused even with a historical designation or valid-looking JWT. |
| Owner/admin self-designates through another membership | Refused by person-level comparison; another authorized actor may designate only under selected eligibility. |
| Reviewer attempts designation, cross-store read or family expansion | Refused without partial data, unauthorized names, counts or existence leak. |
| Person has two store memberships with a designation at only one | One canonical person, scoped access; other-store facts remain unavailable. |
| Designated non-employed reviewer; employment ends or becomes schedule-only | Explicit designation still required and independent; employment alone neither grants nor revokes it. No dummy employment is created. |
| R05 selected: explicit revocation or person/store eligibility ends during read | Current effective state enforced by final check; no automatic periodic expiry is introduced. |
| Concurrent grant/revoke, same receipt replay, changed payload, semantic no-op | Revision conflict or serialized audited transition; one event on replay; no-op preserves relevant epochs. |
| Revocation after read commit but before final access check; revoke/regrant ABA | Assembled private target discarded; changed monotonic access fence refused. |
| Target/person/alias/config changes mid-read or refresh; unrelated workspace write | Consistent target or bounded refresh for relevant drift; routine workspace write succeeds without restart. |
| 2001 required target rows, oversized serialization, inaccessible family | No truncation/empty-complete success; fixed bounded unavailable/narrower-scope response. |
| Active-only source with inactive target; unknown alias; missing directory permission | Explicit retained reconciliation/unresolved link; no person merge, archive/reactivation or access grant. |
| Minimal leave read and cross-store person conflict | Original department/interval preserved; no notes/medical detail or other-store directory. |
| Supplied owner flags, fake accessFence, stale reviewer metadata | Cannot authorize the endpoint, designation, certification or application. |
| Restricted runtime attempts direct identity/grant/audit write | Denied; only reviewed scoped entry points callable. |
| Any failure or read-only preview | No import, completeness update, receipt write, account provisioning or operational mutation. |

## Implementation sequence and stop conditions

1. Review this package with owner-selected R04/R05 recorded above. Confirm I06's shared migration owner and exact tested Inventory source/catalog before adopting shared DDL. Resolve required personal-session/link and protected administration contracts; do not bootstrap the first owner from a source file.
2. Prepare an isolated shared identity/access foundation and audited reviewer-designation functions with wholly fictional fixtures. Use the next free corrective migration only when separately implementing SQL (currently 064); leave published 001–063, manifest and snapshot unchanged in this PR.
3. Test positive/negative authority, person-level no-self-designation, revisions, coordinated eligibility revocation, retry/replay and restricted runtime grants. Retain explicit function definitions and the shared coordination contract.
4. Build a bounded target-reader adapter against that foundation; test separate final access checks, minimal projections, whole-scope refusals and coherent refresh before exposing any route. Never adapt candidate_identity fixture subjects into production authorization.
5. Reconcile authorized target/alias reads with the private V3 review flow. Obtain actual reviewed mappings/population/provider bindings; do not run a real file with invented values. Current CLI success remains offline evidence with all three safety flags false.
6. Design certification and atomic application separately under S02/S03/S05 and identity approvals. Shared schema adoption, hosted application, active Companion cutover, notification delivery, copied-component retirement and Inventory integration remain independent later work.

M05 remains open and M06 partial. This draft defines the next access boundary; it completes no production identity, source certification or deployment milestone.
