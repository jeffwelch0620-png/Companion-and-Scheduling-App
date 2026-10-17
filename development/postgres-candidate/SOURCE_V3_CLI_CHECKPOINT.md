# Bounded V3 roster preview CLI

Starts from owner-approved PR60 main 33fc059f822e50319eef29483e8752be7e4ba748, reviewed head 067a2022e8dc1f4a295401382fe515fb2f4ef8f9. [Exact-head PR60 CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38995739373) passed 1040/1040 after image-pull infrastructure retries. [Merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38996743438) also passed 1040/1040. This slice remains isolated on codex/companion-source-v3-cli and requires its own draft review and separate merge approval. No SQL is added; published 001–063, migrations.json and schema-snapshot.sql are unchanged. Any separately needed corrective SQL starts at the next free number, currently 064.

## Run the fictional example

From the repository root:

~~~sh
npm run --silent source:preview:v3 --prefix development/postgres-candidate -- source-preview-v3.example.json
~~~

The new package script invokes source-preview-v3-cli.mjs. It accepts exactly one local JSON path, followed optionally by --private-report. It refuses stdin, URLs, UNC shares and Windows device/pipe namespaces before opening, and does not read multiple input files, includes or references. Relative paths resolve from the process working directory; npm runs the script in the candidate package. The example is wholly fictional, including identities, provider bytes/hash and supplied review metadata. It reports one new and one unchanged member, keeps active-only coverage unverified and timeOff unavailable, and exits 3. A successful parse is not import/certification approval.

~~~sh
npm run --silent source:preview:v3 --prefix development/postgres-candidate -- source-preview-v3.example.json --private-report
~~~

The detailed output is printed only after that explicit flag. No report file is created. On real inputs, detailed reports contain private organization/store identifiers, source/target/person UUIDs and possibly source job tokens in findings. They carry sensitiveOperatorArtifact=true and outputMode=private-report. Keep them in owner-controlled private storage if redirecting stdout; never commit them, attach them to public PRs or paste them into public CI logs. Even minimized real-data summaries/digests are operator artifacts, not approved public examples. The CLI does not enforce shell redirection destinations or OS retention policy; S05 remains pending.

## Bounded input and refusal behavior

The reader opens the explicitly named input read-only. It uses nonblocking open where supported so a FIFO cannot stall before regular-file validation, then fstat refuses non-files and sizes above 2 MiB. A fixed limit-plus-one buffer and accumulated short reads enforce the same byte cap if a file grows after stat. Close descriptors on success and failure; cleanup exceptions never echo private paths. These are technical preparation bounds, not an owner-selected production-volume policy.

Decode fatal UTF-8, then reuse the accepted bounded JSON parser with duplicate and escaped-duplicate key refusal. A leading BOM is removed for decoding only; inputFileDigest is SHA-256 over exact original bytes, including BOM/whitespace. The full supported V3 envelope then passes through the accepted preparation/provenance recomputation, full-store supplement review, typed alias comparison and shared target checks. Unsupported versions, unknown fields, altered fingerprints/digests/counts, mismatched population/scope and duplicate aliases cannot become a partial success. The source/target/preparation/supplement remain embedded supplied evidence; no secondary file or service is opened.

Malformed/refused input prints one minimized JSON error with false application, certification and access flags. Errors use a fixed allowlist; unknown exception details become invalid_v3_input, and file failures become source_v3_input_unavailable. Never echo parser fragments, file paths, names, IDs, tokens or exception stacks. stderr stays empty for handled errors. Broken stdout terminates with exit 1 without an uncaught stack or retrying report fragments. Serialized output is capped at 8 MiB and refused without truncation if exceeded.

## Summary, details and exit statuses

Default stdout has outputMode=summary, aggregate row counts, grouped code/severity/count findings, scopeCount, exact inputFileDigest, complete reviewContextDigest, remaining requirements and the three false safety flags. It omits names, per-record IDs, store/provider namespace values, rows, target snapshots and source job tokens. The explicit private mode returns the complete accepted helper report plus exact input digest and private-output labeling. Both modes preserve review context and do not change source versions, aliases or source/target state.

| Exit | Meaning |
| --- | --- |
| 1 | Invalid/refused/unavailable input or output failure; no usable partial report |
| 2 | Valid input evaluated with blocking findings; unresolved rows remain in detailed output |
| 3 | Review-required result; scope/reconciliation obligations remain |
| 0 | Reserved convention for a future reviewable result; the current unverified active-only V3 path always retains its review obligation |

Keep source ownership S02 pending: archived target memberships emit blocking target_membership_reactivation_review, even with matching revisions. Case-insensitive duplicate aliases refuse; exact-spelling row lookup and original fingerprints remain unchanged. Leave stays unavailable. No import, source certification, identity provisioning, capability grant, authority check or background synchronization is implemented. accessFence is supplied evidence; a future authorized reader must retain the separate final-access/session check.

## Validation and next work

Twenty-one wholly fictional CLI checks cover summary/private output, exit statuses, exact byte hashes/BOM, byte limits and growing/short reads, URL/UNC/device refusal before open, non-regular inputs (including an actual FIFO on POSIX), fixed error privacy, duplicate/escaped keys, malformed UTF-8/JSON, provenance/alias/population failures, archived membership protection and closed stdout. A fenced subprocess refuses file writes, service/network connections and spawned helpers while the CLI still completes. Inputs are hashed/read back unchanged. V1/V2 golden output and existing source regressions remain required.

The local combined serial source/normalizer/supplement/manifest suite passed 178/178 (21 new CLI checks). Strict candidate types, original-form previews and exact-head fresh-database CI are recorded separately in the draft PR after validation. No real roster/workbook/target data or operator report is included in public fixtures or logs.

The CLI completes the isolated programmatic-to-file preview boundary. Real manager supplement capture, current reviewed population/provider bindings, authorized target/session reads and shared identity adoption remain separate, as do source certification/application under S02/S03/S05, notification delivery, copied-component retirement and Inventory integration from its tested baseline. Do not run real files with invented bindings or treat fictional CI as rollout approval.
