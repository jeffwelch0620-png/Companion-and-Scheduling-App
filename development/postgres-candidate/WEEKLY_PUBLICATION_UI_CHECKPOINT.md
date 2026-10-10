# Weekly publication UI preparation

Focused candidate work from accepted Companion main `79f3bf9` (PR31), whose merged-main CI passed 519/519 checks. The active D1 backend, Inventory and hosted services remain separate. This is candidate UI adoption, not PostgreSQL backend cutover or deployment.

## Reviewed selection and publication

The configured scheduling preview connects the existing weekly review and atomic `shift.publish-batch` command. Only current-store, non-ended, active drafts in the displayed restaurant-local week and the viewer's publication scope can enter a selection. At most 100 drafts are reviewed. Management titles and ordinary schedule drafting capability do not grant publication authority; primary checkout employees and schedule-only sign-in actors remain excluded.

Review begins with the server planning token, loads each selected shift's publication details and every staffing page, then rechecks the token and current viewer. Any changed workspace/shift revision, planning token, permission, missing detail or cycling pagination rejects the entire review. The UI does not certify source completeness. It shows exact selected shift revisions, sorted active closing responsibilities and their revisions, approved staffing needs and the server's selected-only coverage gaps. Only published shifts and selected drafts count toward planned coverage.

Publication requires explicit selection/closing/coverage confirmation and a nonempty reason. Remaining staffing gaps also require acknowledgment and a written plan; that exception is retained by the existing transactional command and does not alter required headcounts. Closing problems, copied staffing awaiting review and incomplete source attestation disable publication. Current authority, ended-shift cutoff, person conflicts, input completeness, linked work, station setup and atomic rollback remain enforced by the database.

## Additive read support and recovery

Migration 044 explicitly replaces only `read_publication_review`, preserving its STABLE read behavior, fixed search path, configured checkout-role exclusion and existing planning-department authorization. It adds complete active closing snapshots and a boolean reporting existing weekly source-review evidence at the current scope revision. It grants no new write or raw-table access. Published migrations 001–043 are unchanged; the hash manifest adds 044 and the generated function snapshot changes only this function.

Known 4xx refusals clear uncertain submission state and require correction/current review. Station, closing, source-input and ended-shift refusals carry useful messages. A network failure or 5xx keeps a deep-copied original command and request ID; editing, week navigation, actor switching and reload controls are frozen until the original submission is retried. Retry sends the unchanged receipt envelope. This is in-page recovery only: publication is online and is not persisted in the employee task offline queue. Closing duties are not verified or employees released by publication.

## Fictional evidence and limits

The preview separates employee, schedule manager, publisher and other-department roles. Its publisher's station is provisioned through the tested station setup command. Two future drafts are seeded, plus an approved two-person staffing need and explicit privileged complete-source evidence after all fictional inputs. Only the seed/operator can attest that scope; reading or publishing cannot renew the evidence.

Focused validation passed 15 client/render/recovery checks plus four PostgreSQL/HTTP read-and-publication checks and the ten existing screen-client cases. The integration check publishes an exactly reviewed shift with attached closing duties, replays the same receipt and leaves the unselected draft unpublished. Raw closing-table access remains denied, and publisher/session revocation narrows later reads.

Live browser rehearsal on fictional `companion_candidate_weeklyui3` displayed the selected-only staffing gap, required the written coverage plan and confirmations, then published the selected future shift. The previous incomplete station fixture was correctly refused before it was replaced with complete command-created setup. The unselected following-week draft stayed unpublished, and publication was disabled when the existing source attestation no longer matched the scope revision. A Service publisher saw no Kitchen shifts or publication controls. Other preview records remain fictional; these checks are not production adoption proof. Full fresh-database regression, snapshot, type, build and final CI results are recorded after validation.

## Remaining work

M06 stays open for coverage/swap/leadership interfaces, published-change and completed-record correction UI, attendance, copying/batch editing and trustworthy source ingestion. Shared identity/authz, real notification delivery and store provisioning remain open. Before shared/PostgreSQL UI adoption, fold the candidate changes into one original/shared implementation and retire the copied components and baseline gate as already tracked. Inventory integration still needs its tested baseline commit. This branch remains a draft PR until separately reviewed and approved.

Final local validation: fresh `companion_candidate_weeklyui2` applied all 44 migrations and passed 537 behavioral checks in the full 538-case run; the sole failure was the manifest test still expecting 43 files. After updating that assertion to 044, the final 26-case manifest/client/render/screen subset passed 26/26. The function snapshot, backend/UI types, preview build and readiness inventory passed. Corrected seeds and browser rehearsal passed on separate fresh `companion_candidate_weeklyui3`. All 001–043 migration bytes and existing manifest entries were independently verified unchanged. Exact-head clean full-suite CI is recorded separately in the draft PR. The preview retains the existing unresolved logo-path build warning.
