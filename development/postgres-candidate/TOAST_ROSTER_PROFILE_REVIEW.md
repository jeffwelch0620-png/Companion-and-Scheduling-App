# Toast roster CSV — sample profile review

Prepared October 14, 2026, within the draft [fingerprint/provenance contract](SOURCE_FINGERPRINT_PROVENANCE_DESIGN.md). The owner supplied a roster export and identified its store. The original file, employer-specific values, employee identifiers, names, contacts, compensation, row counts and byte hash stay in private local evidence. This document records only the observed schema and prospective adapter requirements. It changes no code, input version, source certification, database, permissions or running app.

The owner's report name is Roster. The owner confirmed active-only filtering and subsequently clarified on October 16 that archived employees cannot be obtained in this format without individually unarchiving them. The owner selected an [initial active-only start](ACTIVE_ONLY_ROSTER_START_DESIGN.md), excluding historical import. An archived export is no longer a prerequisite; current active-scope evidence still requires review. Formal export version and job-list semantics remain unconfirmed. The active-only selection comes from the owner's confirmation, not from inferring a filename. No Toast API schema has been inspected, and compatibility with a future API is not asserted.

## Observed header schema

The inspected CSV is UTF-8 without a BOM, uses comma-separated fields and LF record endings, and has this ordered header. CSV quoting matters: a name field can contain a comma. Use a real CSV parser, not string splitting. These are sample observations, not guarantees for every future export.

| Column | Prospective handling and evidence boundary |
| --- | --- |
| `Location` | Display label only. Resolve a reviewed tenant/external-store/canonical-store binding separately; never infer authority or timezone from the label. |
| `GUID` | Employee identifiers are populated, unique and UUID-shaped in this sample. Proposed store/provider-scoped source key, subject to report/API identity semantics review. Retain as a reviewed external alias; do not reuse automatically as the canonical person or membership UUID. |
| `Last Name`, `First Name` | Name components are populated. A deterministic reviewed display-name transformation must preserve trimmed source spelling, internal whitespace and punctuation. No name-based identity matching. |
| `Email`, `Phone Number` | Contact columns exist and contain personal data. Exclude from the scheduling-source projection, record fingerprint and public diagnostics. No account creation, matching or permissions follow from contact values. |
| `Employee ID` | Contains blanks and repeated values in the sample. Optional legacy/display reference only; cannot serve as a unique identity key or be filled from a name. Preserve as text where separately authorized. |
| `Job GUIDs` | Semicolon-separated tokens; multiple jobs occur. Some tokens are not UUID-shaped and their meaning is unknown. Do not coerce, discard, replace or assume they are valid/missing IDs. Confirm the profile's identifier/sentinel contract before accepting them. |
| `Job Descriptions` | Semicolon-separated labels. Token counts align with `Job GUIDs`, and observed positional associations are consistent, but provider pairing/order guarantees remain unconfirmed. The first job is not proven to be primary. |
| `Wages` | Compensation column exists. Exclude values entirely from the scheduling normalizer, source fingerprints, fixtures and public diagnostics. Payroll/labor-rate ingestion is a separate authorized contract. |

Known excluded contact/compensation columns may be recognized and skipped by a reviewed profile; unknown additional headers still need explicit format-drift review. Never hash unsupported private fields just because they appear in the export. Produce fictional fixtures from the schema rather than copying, editing or pseudonymizing the real employee records into Git.

## Missing semantics and coverage

The sample has no explicit active/inactive status, department, primary-job marker, schedule-only flag, per-record revision, external store GUID, timezone, leave or completeness/end marker. Those omissions are unknowns. Do not invent required booleans, primary position, department, active job eligibility, provider revisions or complete coverage to make the current preview schema accept the rows.

1. The owner selected active-only initial scope on October 16 and excluded archived history. Review the active-export scope, effective date and current target reconciliation; do not wait for an archived/all-employee export or unarchive records. This requires the explicit new scope contract, not a false legacy `inactiveIncluded:true` claim. A parsed row count is not a coverage proof, and source omission cannot deactivate a member.
2. On October 14 the owner selected manager-reviewed job-to-department mappings and an explicit primary-job choice for each employee. The actual mappings and per-employee selections have not yet been supplied. Bind these reviews to scoped job IDs and the employee GUID, with explicit reviewer/revision evidence. Preserve the source job set separately from these reviewed supplements; bind supplement revisions to the future review context so a changed primary job or department cannot reuse an old review. Do not label the supplement as a provider field or grant ownership, management access or eligibility from a title or the first listed job. This design records the choice; it implements no mapping editor or approval.
3. Clarify the non-UUID job tokens. Their shape alone proves neither an error nor a legitimate provider key. Until clarified, keep affected records unresolved rather than manufacturing IDs or reducing their job set.
4. Retain missing source revisions as missing. The proposed typed fingerprint envelope requires separate contract approval before it can replace accepted V1/V2 integer revisions. Do not derive revisions from filename timestamps or export row order.
5. Keep leave unavailable for this roster-only file. Current reviewed source/target/alias context remains necessary; no shared identity or permissions are created by sample acceptance.

Once the profile and supplement semantics are reviewed, the file adapter may feed the same normalized model as a later API adapter. Independently inspect API identifiers, revisions, fields, paging and coverage before sharing a profile or asserting API/report equivalence. A matching employee name or job description is not proof of an API binding.

## Fictional regression requirements before implementation

Test quoted commas/escaped quotes, semicolon job lists, missing/duplicate legacy employee IDs with distinct employee GUIDs, duplicate employee GUIDs, blank or mismatched job lists, non-UUID/unknown job tokens, reordered job pairs and formatting variants. Pair IDs and descriptions before sorting an approved job set; sorting each source column separately would corrupt their associations. Do not treat semicolon order as primary-job evidence.

Test that name/contact/compensation data does not enter diagnostics and that excluded contacts/wages do not affect scheduling fingerprints. Supported semantic/job changes must affect fingerprints. Unknown status/department/primary-job/schedule-only fields must remain unresolved until supplied through a reviewed source or explicitly approved supplement. Active-only and missing leave coverage must never become complete absent data.

The original sample was read without modification. Local evidence uses the owner-selected store and an exact byte hash but is ignored by Git; no real file, report, identifier, employment count or compensation is attached to the public PR. The [normalization design](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md) and [readiness checklist](MIGRATION_READINESS.md) retain the implementation/authorization gates. These regression cases are requirements, not tests already implemented.
