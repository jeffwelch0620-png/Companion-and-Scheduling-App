# Manager supplement validation and canonicalization

Starts from accepted PR58 main `88a4911d80478e8ac4a6a72c95b1621ec4a75989`, reviewed amended head `6bad27aa186a6a45ebaafdb18901cf898e9d951e`; [exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38978910449) passed 963/963 with fresh migrations/snapshot, strict types and previews. This is the first code slice of the accepted [V3 bridge contract](SOURCE_V3_PREVIEW_BRIDGE_DESIGN.md), isolated from the running app, Inventory and hosted services. It remains a draft requiring separate review and merge approval. No SQL is added; published 001–063, manifest and snapshot are unchanged. Any separately needed SQL starts at the next free corrective number, currently 064.

## Pure API and input schema

`manager-supplement.mjs` exports `parseManagerSupplementFile`, `canonicalizeManagerSupplement` and `reviewManagerSupplementSelections`. It opens no files, database connections or network requests. The parser reuses the accepted bounded JSON/duplicate-key guard and returns a fixed `invalid_supplement_json` error for malformed/oversized/duplicate-key text. It does not authorize or certify the parsed evidence.

The input format is `manager-supplement-v1`. Its exact envelope is `{format, scope, population, revision, reviewer, reviewedAt, choices}`. Scope contains exactly `{organizationId, system, tenant, storeId, externalStoreId}`, with system `toast`; population contains exactly `{revision, effectiveDate}`. The separate binding argument contains `{scope, population}` projected from the current reviewed artifact. Exact scope and population equality are required; either population value differing refuses the whole document with `supplement_population_mismatch`. Supplying a matching binding is evidence, not authentication; the V3 bridge must still validate/recompute the actual preparation and provenance.

Root and choice reviews require a positive safe-integer revision, nonblank reviewer and explicit-offset reviewedAt instant. These are supplied review facts, not permission checks. The canonical output uses reviewedAtMicroseconds strings so equivalent offsets match and microsecond changes remain distinct. Canonical output is a digest representation, not an input envelope to parse again.

| Choice | Exact fields in addition to revision, reviewer and reviewedAt |
| --- | --- |
| job | kind=`job`, token, department, position, allowScheduling boolean |
| tokenReview | kind=`tokenReview`, token, semantics (`provider_job_key`, `retired_job`, `not_a_job`), observedDescriptions set, canonicalDescription (trimmed text or null) |
| member | kind=`member`, sourceId (employee GUID), primaryJobToken, schedulingJobTokens array, scheduleOnly boolean |

Unknown fields, role/grant fields and row scope overrides are refused. Tokens retain exact spelling, including surrounding spaces on nonblank tokens; they are never case-folded or trimmed. Workbook J-keys must be resolved to provider tokens by a separately reviewed capture step. No workbook parser or automatic capture is implemented here.

Within one bound namespace, sort choices ordinally by kind then exact sourceId/token and refuse duplicate keys, even identical duplicates. Sort the documented schedulingJobTokens and observedDescriptions sets and refuse duplicate selections. Other positional arrays retain their order. Scope, population, decisions and root/row review metadata all bind the digest. The existing sourceReviewContextDigest and V1/V2 preview stay unchanged; the next V3 bridge must consume the canonical supplement/digest rather than hashing uncanonicalized choices through the older helper.

Preparation safeguards are 2 MiB JSON, 8,000 choices, 2,000 provider members and 100 jobs per member. These are technical limits, not S05 production-volume/retention selections. Refuse bounds rather than truncating. Every API result retains canApply=false, completenessCertified=false and accessProvisioned=false.

## Selection review boundary

`reviewManagerSupplementSelections(input, binding, providerMembers, configuration)` evaluates job/member choices and explicit token reviews. Provider members are the exact projection `{sourceId, jobs:[{token, description}]}`; configuration contains the supplied target's exact department and job keys as `{departments, jobs}` arrays. These projections are supplied offline evidence, not an authorized target read. Empty provider projections, invalid/duplicate source GUIDs, malformed pairs and invalid configuration shapes refuse without a partial report.

The proposed membership department and position come from the reviewed primary job mapping, including a nonschedulable primary. Missing primary mapping emits blocking `primary_job_mapping_required`, even with an explicitly empty scheduling selection. Missing selected-job mapping emits `job_mapping_required`. An existing reviewed mapping naming a department or job absent from target configuration emits `target_job_configuration_required` instead. Selected jobs in another department emit `cross_department_scheduling_review`; no department switch, duplicate membership or silent selection removal occurs.

Primary/selected tokens must be reported for that employee. Selected jobs must permit scheduling; a nonschedulable primary may coexist with schedulable additional jobs in its own department. Two selected provider tokens mapping to the same canonical scheduling job require review (`duplicate_target_scheduling_job`) rather than silent deduplication. Schedule-only participation is a proposed value without a login or grant.

No-job employees remain in the report with source_jobs_missing and no proposed membership values. A supplied member choice for such an employee produces the specific root diagnostic `member_choice_for_no_job_employee`, without a duplicate generic unused finding. Missing member choices, unresolved token shapes and conflicting descriptions remain explicit findings; adding a mapping does not approve an unresolved source token. Valid coworkers remain in the report. Job choices for reported but unselected jobs are retained normally; choices with no usable source correspondence produce `unused_supplement_choice`. Reports expose source keys/configuration proposals only and remain sensitive operator artifacts; never commit or attach real reports to public PRs.

The report stage is `manager-supplement-selection-review`. A reviewable row means these selection checks passed, not that identity, source completeness, actor authority or application is ready. Requires still include verified source provenance, a current authorized target read, identity/alias review and the V3 preview bridge. No sourceVersion is changed by supplement edits.

## Reviewed token semantics and full-roster contract

A tokenReview shares the envelope's provider/store namespace and population revision/effectiveDate. Its exact observedDescriptions set binds the complete currently observed descriptions for that token; duplicates refuse, order is ordinal and reorder-stable. Review metadata, semantics, descriptions and canonicalDescription bind the supplement digest. Any changed observed set emits blocking job_token_review_stale. A conflict also requires a non-null canonicalDescription acknowledgement; this is a supplement-only display label, never a replacement provider value or a new sourceVersion. A fresh matching provider_job_key review clears job_token_unresolved for a non-UUID token. A mapping alone cannot do so.

Retired_job and not_a_job reviews classify excluded tokens rather than turning them into jobs. Such tokens remain in provider pairs and fingerprints, but job mappings emit job_token_mapping_excluded and primary/scheduling selections emit primary_job_token_excluded / scheduling_job_token_excluded. These rules apply to UUID-shaped tokens too. An excluded unselected token with a current review need not block an otherwise valid employee. Existing UUID-shaped job keys retain the reviewed profile/mapping path when no overriding token review is supplied; shape alone does not establish source semantics or real-file readiness.

Selection review indexes all descriptions from its supplied providerMembers before evaluating any member choices, including coworkers without a member choice. The upcoming V3 bridge MUST validate/recompute the complete store preparation artifact and coverage/counts, pass its full roster to this function, and only then filter any selected/display rows. The pure function cannot prove that a caller supplied the complete artifact. Never use a selected subset as providerMembers: it could conceal description conflicts or stale acknowledgements. Profile/transform support and provenance must be validated by that bridge before review; tokenReview is not authorization or byte-custody proof.

## Validation and next slice

Local serial focused checks passed 122/122, including 42 supplement checks plus accepted source-preview, normalizer and manifest regressions. Candidate adapter/UI strict types and original-form previews passed locally; exact-head full fresh-database CI is recorded in the draft PR after validation. Fixtures are wholly fictional and independently authored; no private roster/workbook values, session JSON or operator output is included.

Next implement preparation/provenance recomputation, the explicit V3 typed source/alias comparison and review-context binding, preserving V1/V2 golden output and unavailable leave. Then add the bounded V3 CLI. Real mapping/effective-date/source semantics review, shared authz/target reads, source certification/application, S02/S05 and hosted/Inventory adoption remain separate. This module does not implement V3 support or connect the real workbooks.
