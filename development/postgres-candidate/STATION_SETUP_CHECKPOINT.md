# Station setup checkpoint

Isolated preparation on station-scheduling baseline `7348830`. Additive migration 026 implements `station.save` and extends scoped station reads with setup, proficiency scales, thresholds and definition revisions. Earlier migrations remain unchanged. No active backend cutover, Inventory merge, hosted migration or deployment is included.

## Preserved definition behavior

An active authenticated, non-schedule-only actor needs explicit scoped `people.manage`; schedule or location administration alone does not authorize editing. Station names and departments stay fixed on edits. Case-insensitive duplicate names are rejected within restaurant/department, including archived stations. New records retain the creating membership; existing ownership stays unchanged.

Scales may be empty or have 2–10 ordered levels. Labels are distinct without regard to case, with bounded definitions. The independent-readiness threshold must refer to a defined level with an observable definition. Changing levels, threshold or station status advances the definition revision to the new record revision, matching the source's proficiency-version behavior. Setup-only edits preserve the definition revision. This does not assess an employee or convert legacy scores.

## Setup selections

Jobs must exist for eligible restaurant/department members and must not be Dish-only. Explicit station members need at least one matching underlying job, the same restaurant/department, and a non-Dish-only title. Guide selections accept current draft/approved references and reject retired or foreign guides. Duplicate selections and source array limits are enforced.

Up to five unique goal templates retain ID, title, observable definition, 1–90 due days and an optional guide from the selected guide list. Goals require a current scoped people-management reviewer. For an explicit station member list, that reviewer cannot also be selected for the station unless all-job eligibility is enabled, matching the source setup rule. Publication will separately need to reject self-review for each assigned employee and recheck the reviewer and approved guide before issuing a goal.

Provided setup replaces jobs/member links atomically and stores the complete normalized guide/reviewer/goal setup. Omitting setup preserves a previously reviewed setup. A configured scheduling-only reference without complete setup data requires explicit setup review (`station_setup_reference_only`); the command does not fabricate or discard unknown guide/goal fields. Historical fictional reference rows receive empty unassessed scales on migration; these defaults are not reconstruction of a real source station.

## Audit and access

Definition/setup, normalized job/member links, station history snapshot/reason, workspace revision and retry receipt commit together. Exact retries apply once; changed payloads, stale edits and revoked authorization fail. Raw runtime writes remain denied. Existing shifts retain their station name/version snapshot; station setup changes do not rewrite shift history or linked work.

The station list now includes scoped people managers as well as scheduling readers, and returns stored setup/scale/threshold/definition fields. This remains a candidate management projection, not the full employee training view. Existing HTTP body limits still apply. No notifications or employee learning goals are issued by a definition save, consistent with the source command.

## Validation and remaining work

Local validation passed: fresh 26-migration bootstrap, all 272 serial candidate tests, strict adapter types, original-form preview build and coverage inventory. Eleven focused checks cover complete normalized setup, source helper parity, definition revisions, immutable/duplicate names, permissions/scope, scale/threshold validation, job/member/guide/goal/reviewer restrictions, preservation/reference review, retries/revocation, rollback and HTTP sessions. Command/API evidence does not establish browser adoption of original station forms. GitHub validation is reported separately on the draft PR.

Next: station-driven learning goal proposals and review, then schedule publication with current guide/reviewer/eligibility checks. Proficiency assessments, source-issued-goal receipts, full station source ingestion, training UI and hosted adoption remain pending. M06 remains open; defining a template is not assigning a goal or granting clearance.
