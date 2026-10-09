# Availability save and independent review

Candidate migration 021 adds `availability.save` and `availability.review` through the existing scoped command HTTP handler. It adds private availability event history and notification outbox tables. Migrations 001–020 are unchanged. The active D1 application and hosted Supabase remain separate.

## Command behavior

`availability.save` accepts the original fields: optional person ID, date range, weekdays, start/end minutes, travel buffers, title, school/unavailable kind, optional exception dates and optional approved rule to replace. New records are pending at revision 1. Edits require record ID and current expected revision; they retain the owner, reset review state and preserve prior event snapshots. Approved availability cannot be overwritten; submit a replacement instead.

Owners may save their own restrictions. Saving for another employee requires scoped `schedule.manage`. There must be an active, non-schedule-only schedule reviewer other than the owner. Scheduled-only roster employees can be the target of a manager's submission, but cannot act as signed-in writers. A title alone grants no authority.

Validation runs in PostgreSQL as well as the command envelope adapter: real date syntax/ranges up to 370 days, nonempty weekdays 0–6, minute boundaries, positive same-day restriction interval, buffers up to 180 minutes, up to 90 in-term exceptions, title/kind and valid replacement ownership/status. Weekdays are deduplicated. Callers cannot supply approval status or arbitrary data fields.

`availability.review` requires current revision, boolean approval and a nonempty review note. A different scoped schedule manager must review a pending record. Declining retains it as declined. Approval checks all of this employee's non-cancelled shifts, including drafts, against the projected approved rules; an unresolved conflict blocks approval and retains pending data. The source's minute-granular local-time matching, weekday anchors, buffers and date exceptions are preserved through repeated/skipped time behavior.

Replacement approval requires the previous rule still to be approved for the same employee and restaurant. It supersedes that rule, records both event snapshots and approves the new rule in one transaction. Other approved restrictions remain in the projected conflict check.

## Atomicity and scope

The command locks the restaurant first, checks auth-linked active/non-schedule-only identity and locks the actor's capability rows. Existing record revisions are checked before mutation. The changed availability rows, event snapshots, notification intents, receipt and workspace revision commit together. Failures roll back all changes. Identical request retries return the original receipt without applying again; changed payloads conflict. Replay rechecks current actor and necessary manager authority.

Future scheduling and administrative writers must use the same restaurant-first coordination before changing shifts or access. This slice does not establish race safety against arbitrary privileged SQL that bypasses that protocol. Runtime has no direct table writes or execution permission on the private time-matching helper. The outbox queues notification intent; delivery remains unimplemented.

These commands are online-only in the candidate. They do not publish, reassign or release any shift, change training clearance, provision access or adopt the candidate into the active workspace. Full availability import/write parity for real snapshots, mobile/browser forms and production lifecycle remain pending.

## Evidence and next step

Eleven new checks cover pending/save/edit and independent approval, original owner/scope restrictions, replacements, draft-shift conflicts, SQL/source time-rule parity through DST/buffers/exceptions, duplicate and concurrent edit/review behavior, invalid input at database boundaries, revocation, actor/reviewer eligibility, outbox failure rollback and session-resolved HTTP save/review. This is candidate command/API/database evidence, not production approval or a new browser test.

Fresh fictional bootstrap applied all 21 manifest-verified migrations. All 216 serial regression checks, strict adapter type validation, original-form preview build and source coverage inventory passed. This focused branch is stacked on the schedule context read draft PR.

Next: schedule draft/edit commands that reuse eligibility and these availability rules, enforce overlap limits, and preserve linked operational work. Published-shift changes, schedule publication/copy/import, swaps/coverage, staffing and attendance remain separate slices. Inventory integration and hosted application are still held.
