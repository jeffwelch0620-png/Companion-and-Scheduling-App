# Store configuration in candidate forms

This dependent preparation starts at PR30 head `9a319c6`, on top of accepted PR29 main `a344421`. PR30 is a draft dependency, not an accepted baseline. Both packages require separate review and merge approval. Inventory integration still requires its tested baseline commit.

## Scope and policy

Candidate schedule board, individual shift editor, station choices and employee checkout forms consume the configuration introduced in 041. The scheduling loader validates the authenticated location before loading records. Checkout's fictional fixture carries the actual configured restaurant location; its retained offline snapshot is historical display context only. Reconnect still rechecks current authority and work on the server. Missing or malformed mappings and missing/invalid timezones stop loading rather than supplying defaults.

Primary checkout membership remains an exact job comparison. Station exclusions use only the current store's explicit case/whitespace-normalized aliases. Alias membership does not make someone eligible for primary checkout assignment. Mixed jobs and old English labels keep their actual meaning at each store. Person selection also requires this store, its configured checkout department, and sign-in access. Management checks preserve existing capabilities and department scope; configuration names grant nothing. Complete checkout status still requires the original three participants, independent manager checks and every linked incoming acknowledgment/check.

Schedule department ordering follows the configured list. Job labels remain unchanged and displayed shift clocks use the actual store timezone. Command IDs, revisions, uncertain-delivery recovery and authoritative database checks retain their existing contract. This package adds no commands or database migration. Published migrations 001–041, their manifest and function snapshot are unchanged.

## Isolation and source maintenance

The active app source and backend are unchanged. Small candidate derivatives of `schedule-board.tsx`, `shift-editor.tsx`, `dish-checkouts.tsx`, and the checkout-cycle projection in `domain.ts` provide reviewable configuration-aware forms. Other helpers and styles continue to be imported from shared source. `ui-source-baseline.json` pins the LF-normalized source hashes; both test preparation and preview builds fail if that source changes, requiring an explicit review of the derivatives. There is no runtime text rewriting of the forms.

`build-ui-reference.mjs` compiles those actual candidate components into ignored runtime output for rendered regression checks. It does not alter the original shared-module references used by existing parity tests. Candidate UI type checking includes the existing Cloudflare declarations needed by shared data types and runs as part of `check:types`.

Fictional scheduling now uses Service/Kitchen departments and America/Chicago. Fictional checkout uses Service/Kitchen, Steward/Steward PM and Europe/London in a separate restaurant. Neither seed renames or remaps a store with existing history. Runtime fixture sessions and build outputs stay ignored.

## Evidence and remaining work

Thirteen new checks cover explicit metadata, primary/alias distinctions, scoped employee choices, narrow permissions, station restrictions, independent checkout completion, rendered manager/employee forms, neutral handoff labels, actual timezone clocks, department ordering and configuration rejection before reads. Fresh-database, complete regression, types, preview and browser results are recorded in the PR after validation.

Local validation on 2026-10-10 applied all 41 unchanged migrations to `companion_candidate_uiconfig1` and passed 481/481 serial regression checks. Candidate backend/UI types, matching function snapshot, source inventory and preview build passed. Final focused form/loader checks are repeated after preview fixes; exact-head CI is verified separately. A second fresh database, `companion_candidate_uipreview2`, successfully seeded the custom fixtures for browser exercise. No databases were reset or dropped.

Live loopback browser checks verified a Kitchen draft created with its configured grill station and Chicago clocks; the Service manager saw no Kitchen shifts. In the London checkout store, the manager selected the three Steward employees and created three independent checkouts. The AM employee saw only their own checkout and submitted readiness through the existing queue; it remained ready for independent manager validation. Manager setup/release controls were absent from that employee view. These are fictional browser checks, not deployed integration evidence. The preview build retains the existing unresolved logo-path warning.

This is selective UI preparation, not complete shared UI adoption. The original D1 forms and other modules still retain their historical assumptions. Remaining scheduling publication, coverage/swap/leadership interfaces, attendance/corrections and flag resolution need their own reviewed candidate adoption. Closing-detail, overnight and static legacy previews are not claimed to be fully configuration-independent. Real configuration provisioning, shared identity/authz, notification delivery, durable scheduling/prep recovery and the Inventory port remain open. Before integrating, port these reviewed changes into a single shared implementation and retire the candidate derivatives.
