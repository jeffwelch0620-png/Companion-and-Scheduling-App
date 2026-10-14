# Bounded copy and batch draft form preparation

Preparation from accepted PR48 main `c1b6ec9aee9e84114f82634beca139fd76e352c5`, whose [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38490598901) passed 851/851. Published migrations 001–062, manifest and function snapshot remain unchanged. This UI slice requires its own draft PR, review and separate owner merge approval.

## Forms and server contract

`ui-copy-batch.tsx` adapts the original `app/team/schedule-copy.tsx` and `schedule-draft-editor.tsx` select/edit/review layout and existing shared styles. It does not import their local conflict planners, closing-copy behavior or all-or-nothing writes. The original active backend and original forms are unchanged. The fictional `/schedule-forms` preview exposes the new controls only to current scheduling managers; commands independently recheck authority.

The server computes the complete bounded review in one `/copy-review` or `/batch-review` call. The client validates exact selected IDs, kinds/revisions, coverage marker, canonical selection, captured timezone, safe issue shape and required ready-row timestamps. It never calculates person conflicts, valid-subset closure or review digests. Hidden/unavailable sources keep minimal refusals, and other-store leave/booking contents are not displayed.

Copy accepts 1–100 shifts plus up to 100 independent approved staffing needs, to a later same-weekday week within 52 weeks. Source selectors show 20 rows per page, retain selections across pages and state the total and maximum. “Select first 100” is explicit rather than silently shortening an arbitrary selection. Shifts/stations are copied without closing duties or completed evidence. Staffing remains unapproved and its overlap-at-approval warning is visible. Each selected shift/staffing row has separate start and end occurrence choices, reset when the destination week changes.

Batch editing changes employee, job and start/end on future unpublished drafts in the selected local week. The retained station is displayed, never silently cleared. Linked/imported/started sources receive server rejection reasons requiring individual review. Unchanged local-minute fields retain original seconds/microseconds; ordinary prefills do not choose a repeated-hour occurrence. Changed dates/times clear that side's occurrence choice. Local fields and independent choices go to PostgreSQL, which resolves gaps/folds and validates elapsed duration. The server keeps authority, eligibility and dependency decisions.

## Partial results and fresh review

Reviews show every ready/rejected outcome, before/after dates where authorized, omitted closing counts, retained stations, independent staffing warnings and safe dependency causes. A reason and confirmation are required. When source completeness is missing or no row is ready, the form cannot save. Valid rows remain unpublished; publication is a separate review.

Success is accepted only when the complete receipt matches the frozen request: exact outcome IDs/kinds/source revisions, saved IDs/revisions, counts, counters, applied timestamp and replay flag. Missing/malformed HTTP 200 results remain uncertain and retain the frozen submission. Results display saved status and every rejected reason; expandable record references retain exact source/saved IDs and revisions. “Reload and revise rejected rows only” fetches current records, excludes all saved sources from both the initial selection and the follow-up source picker, and requires a fresh review/request; it never resends saved rows under a new ID.

The accepted copy envelope requires at least one shift. If only staffing rows remain rejected after a partial save, the form explains that those needs require individual review and disables the group retry. It never adds an already saved shift as filler. Staffing-only copying is a tracked later backend/form gap. If a rejected batch source is no longer editable, current results remain available and the manager is directed to individual review.

`copy_review_changed` / `batch_review_changed` clear the known refused request, invalidate the review and prompt to reload current drafts and refresh. Passing `copy_destination_started`, `batch_source_started` or `batch_destination_started` thresholds and changes to hidden selected old slots also stale the server digest. The client does not tie its review to unrelated global/schedule counters or expose hidden changes.

Optional staffing selection drains the existing store-wide paged endpoint completely, checks consistent revision, strict cursor progress, identity/configuration fence and duplicate IDs, then filters approved sources to the selected local week. A 100-page limit refuses the whole staffing selection with no partial history. This endpoint has no server date filter; larger histories require a separately reviewed bounded backend read. Selection limits do not imply that every historical source was loaded if the complete-read guard fails.

## Frozen uncertainty and reload

Copy/batch sends share the existing `ScheduleScreenSender`. Connection loss, `503 coordination_retry`, other uncertain failures and malformed success keep the same request ID and payload; changed proposals are refused until the original outcome is resolved. A known final booking invariant returns `500 internal_invariant`, clears the failed submission and directs the manager to reload and contact an administrator. The accepted coordination message remains distinct from an actual outage.

The preview keeps known partial results visible instead of closing the form or showing a generic all-saved message. Global original-submission retry routes a confirmed group receipt back to the same result display. Actors and navigation cannot change during uncertainty. Scheduling proposals do not enter the employee offline queue.

Before a group request, session storage records only store, actor, action and request ID; no employee details, reason or proposal payload is persisted. Valid full results and known refusals clear the marker. After reload an actor/store-scoped banner directs the manager to check current drafts and copied staffing, and new group actions stay disabled until acknowledged. The warning includes read-only copied-staffing inspection; acknowledgement stays disabled until that complete current read succeeds, while the schedule remains available for inspecting shifts. This is a recovery warning, not durable request replay across reloads. Unsaved proposals are never represented as stored.

## Drift and retirement

The existing `ui-source-baseline.json` remains unchanged and restricted to its three components/domain projection. A separate `copy-batch-source-baseline.json` fingerprints only the two original copy/batch forms with portable LF normalization. Test preparation and preview builds enforce both gates. When either original changes, reconcile this candidate derivative/client first, then update its separate baseline in the same PR; required CI blocks otherwise. Fingerprint-only updates do not reconcile behavior.

Shared adoption must fold the reviewed server-review, partial-save and recovery changes into the original copy/draft components and shared client, then remove `ui-copy-batch`, its isolated client and the separate baseline gate after validating the unified forms. Real shared authz/owner model, source completeness, notification delivery and Inventory integration from a tested baseline remain separate.

## Validation

Fresh fictional PostgreSQL 17 application through 062 and function snapshot verification passed. The initial relevant serial backend/coordination/copy/batch/UI/manifest suite passed 106/106, zero failures/skips. Updated UI/HTTP/sender checks passed 35/35 after follow-up picker, recovery inspection and date/time event refinements; strict backend/UI types, coverage inventory and preview build passed. These focused refresh counts overlap the initial suite and are not summed as distinct tests. Complete exact-head CI is recorded on the draft PR.

Fictional browser checks verified employee control hiding; shift/station copying without closings; a 9-saved/1-rejected group including independent unapproved staffing; retained per-row rejection reasons and expandable references; rejected-only source restriction; changed destination dates; a 4 PM → 5 PM batch start change with retained station; server outage retaining frozen inputs and successful original retry to the complete two-row result; and actor-specific reload warning blocking new group actions. The final recovery panel displayed the current unapproved copied staffing, kept acknowledgement disabled until the complete read succeeded, then restored group controls after inspection and acknowledgement. Screenshots remain ignored local evidence; no real-store use or deployment is claimed. No hosted database, active backend, Inventory or deployment is changed.
