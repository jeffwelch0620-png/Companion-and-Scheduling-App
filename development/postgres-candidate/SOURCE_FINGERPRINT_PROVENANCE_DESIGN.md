# Source content fingerprints and Toast sample intake — draft design

Prepared October 14, 2026, after owner-approved PR55 acceptance at `648b844a6f0b75b38c972d973e3903c42a22317a`, reviewed head `e622ffbaf441b952b0df44ed0945146aadb55892`. Both exact-head runs passed 934/934 with fresh migrations/snapshot, types and previews. This is the next contract review before a raw normalizer. It implements no parser, fingerprint utility, preview version, target reader, grant, certification or application. Published 001–063, the manifest and SQL snapshot remain unchanged.

The owner selected reviewed Toast employee/job snapshots first. The exact export/report, format version, sanitized sample and coverage evidence are still pending. The [accepted normalization design](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md) supplies the canonicalization requirements. The [accepted family checkpoint](SOURCE_FAMILY_COVERAGE_CHECKPOINT.md) supplies independent coverage and inactive-leave rules. No proposed field below claims to describe raw Toast data.

## Proposed version boundary

The accepted preview envelopes V1 and V2 require positive integer `sourceRevision` values, and mappings require matching integer revisions. Preserve those shapes and outputs exactly. A content hash cannot be squeezed into those integers, compared numerically or substituted through unknown extra fields.

Propose preview envelope **V3** for typed source versions and bound provenance. The phrase “V2 fingerprint” in the accepted design describes the canonical fingerprint contract; it does not authorize changing envelope V2. The proposed encoding identifier is `source-content-v2`. V3 is a review proposal, not an accepted or supported CLI format.

| Element | Proposed V3 contract |
| --- | --- |
| Source record version | Replace `sourceRevision` with `sourceVersion`. Require exactly one mode: `{kind:'provider_revision', value:<positive integer>}` or `{kind:'content_fingerprint', encoding:'source-content-v2', algorithm:'sha256', value:<64 lowercase hex characters>}`. A trustworthy supported provider integer revision is preferred; do not invent one. An opaque/noninteger provider token needs a separately reviewed encoding. |
| Reviewed mapping | Replace mapping `sourceRevision` with the exact reviewed `sourceVersion` object. Keep mapping revision, target revision, person UUID and store-scoped aliases distinct and unchanged in meaning. |
| Source profile | Bind one exact `sourceFormat` and `transformVersion` to the normalized source. Raw format support follows sample inspection; unknown profiles fail closed. A transform change requires a new version and mapping re-review. |
| Snapshot provenance | Bind source profile, exact raw-file byte SHA-256, normalized source digest, capture context and per-family coverage evidence to the normalized snapshot. This is private operator material. No raw file path, credential, contact field or private leave reason belongs in the public report. |
| Coverage and targets | Retain V2 family availability/null-versus-empty rules. Target/mapping/input revisions remain trusted integers. Neither a hash nor provenance grants authority or proves completeness. |

Validate the version mode, encoding, profile and exact structural shape before comparisons. Require exact source-version equality for a reviewed mapping. A mismatch requires re-review (`source_mapping_stale`); a profile/namespace mismatch cannot bind another source. Never silently convert V1/V2, regenerate aliases, choose a target by name or update a mapping on the operator's behalf.

## Canonical fingerprint content

Fingerprint the reviewed, supported source record fields and its scope, before any target assignment or access decision. The canonical payload contains the encoding identifier, source format, transform version, organization/system/tenant, canonical/external store bindings, captured store timezone, record kind, exact scoped source ID and supported semantic fields. It contains no target person/member ID, target revision, mapping revision, capture timestamp, page order or file path. Capture context and raw-file hash belong in snapshot provenance: recapturing unchanged data must not create a changed record.

For roster records, semantic fields are the normalized trimmed name, department, primary job/position, active flag, schedule-only flag and additional job set. Provider jobs and status must be explicitly supported by the reviewed adapter; no raw field names or default values are guessed here. For a later supported leave profile, include scoped member source ID, historical department, start/end instants and status. Date-only interpretation uses the selected captured-store calendar boundaries; leave support is outside the first roster-only adapter.

Canonicalize using these rules:

1. Use a strict supported schema and sorted ASCII field keys, compact JSON and UTF-8 bytes. Refuse unknown fields, duplicate keys, duplicate source IDs, malformed values or unsupported profiles rather than hashing silently omitted semantic fields. Do not implement a generic “sort every array” canonicalizer.
2. Strings are exactly the trimmed source values. Preserve internal whitespace, case, accents and Unicode representation. Do not use names/email or Unicode/case folding to form identity keys. Reviewed source-profile transformations must be versioned and explicit.
3. Sort only documented set-valued fields, initially additional jobs, with a fixed ordinal comparison. Reject duplicates after trimming; do not deduplicate silently. Any future positional arrays retain their order and need an explicit profile contract.
4. Represent validated instants as signed decimal UTC microsecond strings with exact arithmetic, including negative/pre-epoch values. Equivalent explicit offsets have identical content. Preserve all six fractional digits; a one-microsecond change must change the hash. Refuse invalid calendar dates, unsupported precision, missing offsets and ambiguous local-time conversion rather than relying on `Date.parse` to repair input.
5. Use SHA-256 of the canonical payload. Scope, encoding, source-format or transform-version changes change the fingerprint. Exclude capture time/file ordering while retaining those facts in bound snapshot provenance.

This is a deterministic content comparison, not a signature, secret, chronological sequence, source authentication, permission or live freshness proof. A forged self-consistent file remains untrusted evidence. Current authorized target reads, reviewed aliases and later separately approved certification/application remain required.

## Bound provenance and read-only limits

The future normalizer must hash the exact input bytes, identify its supported profile/transform and emit a bounded normalized source with a versioned provenance block. Define one unambiguous canonical normalized-source digest excluding the provenance block itself, so no circular digest is possible. Bind the reviewed version mode and family declarations as well as records. A separate sidecar is acceptable only if the adapter verifies the same binding and refuses swapped/stale sidecars; do not accept provenance supplied independently of the normalized source.

Compare recaptured records through source versions, not the raw-file hash: row ordering or export formatting can change file bytes without changing record content. Raw-byte and normalized-snapshot digests remain separate. A provider revision or fingerprint must not establish the export's end marker, inactive inclusion, total row count, tenant authority or missing-record semantics.

The first Toast adapter is roster/jobs only. Leave is `{available:false}` with null records unless a separately supported and reviewed leave source is supplied. Complete roster coverage requires actual export evidence. Missing coverage stays incomplete; parsing a nonempty sample cannot certify it. Keep all reports at `canApply:false`, `completenessCertified:false`, `accessProvisioned:false`. Preserve S04 reconciliation holds and PR55's exact-member/window absence and stale-alias rules.

S02 field ownership/newer-edit reconciliation and S05 retention/production bounds remain pending for implementation slices that need them. This draft selects neither a write winner nor a retention period. No route, provider connection, shared-authz lifecycle or database application follows from approving this contract.

## Sample intake checklist

The owner can provide local paths to restricted sanitized files and export/schema notes. Do not put real exports or preview reports in Git or attach them to a public PR.

| Required evidence | What to retain for review |
| --- | --- |
| Export identity | Exact Toast report/export name, file type, schema/API version if available, relevant column definitions and an authorization statement for this reviewed use. No account credentials or live fetch is needed. |
| Scope | Reviewed tenant/external-store bindings and store timezone. Preserve stable pseudonymous IDs and relational links across files/stores; do not infer bindings from filenames or employee names. |
| Representative shape | Sanitized employee and job records showing actual identifier, primary/additional job, active/inactive and schedule-only semantics where present. Preserve missing/null, duplicate, array, CSV quoting, casing, whitespace and timestamp distinctions. Document anything removed or transformed by sanitization. |
| Source versions | Explain whether a trustworthy per-record revision exists and its type/meaning. If none exists, record that fact; do not add invented counters to the sample. |
| Coverage | Export filters, all pages/end marker, total/count reconciliation, inactive and additional-job inclusion, exclusions and capture consistency. If Toast does not supply a guarantee, record “unavailable/unverified,” not “complete.” |
| Privacy | Replace names/contact details and external IDs consistently; remove passwords, PINs, tokens, compensation, private notes and unneeded personal data. Preserve shape and identity relationships needed for validation. The original remains under the owner's restricted control. |
| Public fixture derivation | After inspection, create wholly fictional fixtures matching the reviewed shape. The representative sample and generated reports stay private; only synthetic input and aggregate test evidence may be committed. |

A field omitted from an export is unknown, not false/active/empty. An inactive or missing employee is not automatically deactivated. An employee appearing in several stores still needs explicit reviewed per-store membership and person bindings. The sample review must identify unsupported states before implementation, with no silent row discard.

## Required implementation acceptance cases

| Case | Required outcome once implemented |
| --- | --- |
| Equivalent supported records, object-key/job order changed | Same source fingerprint; positional arrays are not sorted implicitly. |
| Offset-equivalent timestamp with six fractional digits; pre-epoch instant | Same exact UTC microseconds/fingerprint; one microsecond differs. |
| Leading/trailing source whitespace only | Same trimmed value; changes to internal whitespace, case or accents remain distinct. |
| Relevant field, scope, kind, source ID, format or transform changes | Different fingerprint; an old reviewed mapping is stale, never rebound automatically. |
| Recapture time/raw file order differs, semantics unchanged | Record version stays unchanged; raw-file/snapshot provenance may change independently. |
| Unknown profile, duplicate trimmed job, malformed date/precision, unknown field or mismatched sidecar | Fixed minimized failure with no partial or certifying output; no source names/paths leaked. |
| Invalid fingerprint shape, wrong encoding/mode, or source/mapping version mismatch | Refuse or require mapping re-review; never manufacture integers or mix namespaces. |
| V1/V2 inputs and accepted fixtures | Byte-compatible output; no fingerprint field accepted through either legacy envelope. |
| Roster-only Toast profile without leave evidence | Leave unavailable, never a complete empty family; actual roster coverage remains a separate obligation. |
| Normalizer/preview invocation | No database/network writes, grants, source certification, retained real-data fixture or external side effect. |

These are future acceptance requirements, not tests already run. After review of this version boundary and the authorized representative sample, implement a focused pure fingerprint utility and exact-profile bounded normalizer with fictional fixtures, then separately prepare the shared target reader. Shared authz, notifications, copied-UI retirement and Inventory integration from its confirmed tested baseline remain later work. Any new SQL uses the next free corrective number, currently 064, only if separately needed.
