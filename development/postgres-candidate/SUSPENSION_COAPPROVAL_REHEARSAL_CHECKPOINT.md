# Selected SEC10 M3 governance co-approval rehearsal

Prepared from owner-approved PR69 main `68cfe23f899298a5dc517d9ae70dd60c1a80563f`, reviewed head `0eca2849411a93e00708c88a4fc4db6e4243e1e8`. [Exact-head PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39182070867) and [merged-main push CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39190915128) each passed 1351/1351 on attempt 1 with fresh migrations/snapshot, strict types and previews, the pinned GHCR image, no ECR reference and zero skipped tests. This checkpoint records the preparation slice; subsequent owner-approved acceptance and current next-step evidence appear below.

## Selected rule and remaining policy

The [security/recovery design](SECURITY_RECOVERY_DECISION_DESIGN.md) records Jeff's explicit M3 option A: if a proposed suspension would leave its initiator as the only unsuspended eligible owner, independent governance co-approval is required before effect, with immediate governance escalation. No symmetric-containment fallback is selected. Ownership and objections remain unchanged.

Only that SEC10 subrule is selected. All other SEC decisions, remaining SEC10 authority/lift/deadline details, named governance actors, MFA/freshness, proposal/setup/lease values, retention and infrastructure recovery procedures remain pending. This rehearsal selects none of them and implements no suspension feature. M05 is open and M06 partial; Inventory's tested receiving baseline/catalog/handoff is still required before its shared-ledger port.

## Pure predicate and boundaries

The [module](suspension-coapproval-policy-rehearsal.mjs) is imported only by its [fictional serial tests](suspension-coapproval-policy-rehearsal.test.mjs). Its `rehearseSuspensionCoapproval` function checks supplied owner-to-owner, single-organization, fixed `organization_access` scope examples. Non-owner targets, governance-initiated suspensions, inactive targets, replay/receipt reads and other suspension routes are outside this deliberately narrow fixture model; their refusal here is not an adopted product policy.

Inputs are trusted fictional snapshots, not client permissions or current database evidence. They include a complete owner projection with canonical person eligibility/suspension state, the current initiator fixture, case/owner-set/suspension revisions, reason/audit flags and an optional exactly bound governance approval. The approval supplies a reviewer in the same organization who is verified, eligible, unsuspended, independently distinct from both parties and explicitly governance-authorized. Existing ownership does not substitute for the governance authorization fixture. `approved`, `current`, `evidenceVerified`, `ownersComplete` and `lifecycleVerified` are supplied booleans, not implementations or proofs of authority, freshness, lifecycle continuity, evidence quality, case persistence or completeness.

No timing value, automatic expiry, proof transport, operator designation, secret, access grant or session/owner mutation is installed. Lists are bounded at 200 and revisions at positive safe integers as local input safeguards, not owner-selected organization limits. UUID case variants identify the same person; duplicates and ambiguous/malformed structures are refused through the fixed data-free TypeError `invalid_suspension_coapproval_rehearsal`.

Every result is frozen and contains only fixed codes, the narrow `m3Satisfied`/`governanceRequired` outcome and explicit false `authoritative`, `canApply`, `accessProvisioned` and `completenessCertified` fields. A true M3 result is **not permission to suspend anyone**, not satisfaction of pending SEC policies and not proof a transaction ran. Results expose no IDs, owner counts, scopes or evidence. No active app, adapter, server, CLI or UI imports the predicate.

## Rehearsed cases

| Fixture | Narrow result |
| --- | --- |
| A and B are the only unsuspended eligible owners; A requests B's suspension | `governance_coapproval_required`; no input mutation or side effect. |
| A has current independent exactly bound governance co-approval | `m3_coapproval_satisfied` only; every apply/access field remains false. |
| A and C would remain eligible/unsuspended after B | `m3_not_triggered`; this says nothing about the other suspension prerequisites. |
| A third owner loses eligibility/suspension state after review | Old semantic revisions refuse; a supplied refreshed case recalculates the set and requires co-approval if A would be sole. |
| A and B submit reciprocal unapproved requests | Both remain unsatisfied. A supplied post-A-to-B state refuses B's stale reciprocal request even with its earlier approval. |
| Reviewer is initiator/target, another organization, suspended, unverified, ineligible in the current owner projection or not governance-authorized | Refuse the approval; owner status alone is insufficient. |
| Case, initiator/target, organization or semantic revisions differ | Refuse the stale/mismatched context. Any attached co-approval is validated even when M3 is not triggered; a stale or otherwise invalid one is refused. The shared port must preserve this behavior rather than discard an invalid attached approval. |
| Owner roster order or canonical UUID spelling changes | Same predicate outcome; duplicate person aliases remain invalid. |

The mutual-request test supplies consecutive hypothetical snapshots; it does not execute a suspension, simulate real commits or prove lock serialization. The final shared implementation must obtain a trusted complete canonical owner projection under the same organization coordination used by suspension/owner/eligibility writers, recompute projected state after locks, recheck current initiator/co-approver authority and bind exact payload/case/revisions before writing. It must atomically persist the effective fence/session invalidation metadata/audit/receipt, keep pending cases ineffective without approval, escalate governance, enforce the fence on every relevant path, and keep provider side effects outside SQL retries. None of that infrastructure is supplied here. Remaining SEC policy gates still apply before any command/route is implemented.

## Validation and next gates

- New fictional suite: 52/52 passing, covering two/three-owner projections, stale semantic revisions, reciprocal snapshots, independent reviewer/context binding, malformed/bounded input and non-authoritative immutable outputs.
- Combined serial policy/source checks passed 520/520, including unchanged V1/V2 golden hashes and manifest verification. Strict adapter/UI types, generated references, previews and readiness inventory passed; the existing unresolved logo warning remains and backend cutover remains not ready. 175 relative links passed. Subsequent exact-head and merged-main fresh-database CI passed as recorded below.
- Published migrations 001–063, migrations.json and schema-snapshot.sql remain unchanged; 064 is not needed. No active backend, provider, hosted database, Inventory, real suspension/grant or deployment change is included.
- Preserve the unrelated untracked local duplicates; validate a clean tracked-source snapshot. Review public staged files before push, keep the new PR draft and hold merge for explicit approval.
- Next implementation remains gated by explicit review of the remaining SEC choices, actual governance appointment/evidence, provider feasibility and Inventory's tested receiving baseline/catalog/ledger handoff. Do not expand this oracle into an authentication service to bypass those gates.

## Accepted PR70 and next shared identity handoff

PR70 was owner-approved and squash-merged at `ce9ecfe16ea0e4d74a73b2983daa90621651cc25` from reviewed head `1a6aeac59cd8a51c60981f3094bac55f637bbe93`. [Exact-head PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39191854556) and [merged-main push CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39192762047) each passed 1403/1403 on attempt 1, with fresh migrations/snapshot, strict types and previews, pinned GHCR, no ECR reference and zero skipped tests. The accepted 52-case M3 predicate is fictional/non-authoritative and imported only by its own tests. Remaining SEC decisions and other SEC10 details remain pending. Published 001–063, manifest and snapshot are unchanged.

The next [shared identity adoption handoff](SHARED_IDENTITY_ADOPTION_HANDOFF.md) is a docs-only draft on `codex/companion-shared-identity-handoff`. It consolidates receiving baseline/catalog evidence, canonical relationship/writer mapping, policy/port gates, acceptance and rollback requirements without querying or changing Inventory. It also records that any attached co-approval is validated even when M3 is not triggered, with stale/invalid approvals refused; the shared port must retain that behavior. All remaining SEC policies stay pending. This draft needs separate review and merge approval; Inventory tested receiving baseline/catalog/handoff remains pending, M05 stays open and M06 partial.
