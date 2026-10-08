# Shared Manager Log connection — local validation stage

Shared rollout and real account provisioning are on hold at Rudd's request until Rudd's and Jay's exact sign-in identities and Bert's roles are confirmed. No live schema change, real membership, shared record, or deployment is part of this local delivery.

The existing combined app remains the foundation. `/shared-live` reuses its shell and Manager Log component. This first connection supports creating an entry and adding an attributed note. The completed local Food preview and its acceptance evidence remain a separate completed milestone. Other centers have not been moved to Supabase by this package.

## Source and authority mapping

| Existing source | Shared mapping | Boundary |
| --- | --- | --- |
| Companion restaurant identity | `public.stores.id` plus `jmax_app.locations` | Use the canonical restaurant code, reviewed timezone and week start. No new store is invented. |
| Signed-in person | Supabase Auth user verified by the server, linked through `public.people.auth_user_id` | Company project ownership is not an individual app login. Do not auto-link by display name or email alone. |
| Restaurant and role | Existing `public.store_roles`, plus explicit `jmax_app.memberships` | Preserve the Companion member ID when deliberately mapping an existing person. Department and approved capabilities are explicit. No role selector grants access. |
| Companion `WorkRecord` | `jmax_app.records` | Preserve IDs, restaurant, owner, department, revision, full data and history. New records receive one server-generated ID. |
| Saved revision and action history | `jmax_app.record_history` and `audit_events` | Full saved snapshot and authenticated actor attribution are committed with the record. Historical identities survive revoked access. |
| Retry receipt | `jmax_app.command_receipts` | One request ID and fingerprint per actor/restaurant; exact retries return the original result. Reuse with different content fails. |
| Historical `public.manager_log` spine | Not silently imported or dual-written | Reconcile existing rows and choose one writer before live cutover. This staged path preserves the richer Companion model. |
| Food catalog, counts, prep, purchases | Existing shared tables remain untouched | No Food migration, supplier submission, stock mutation or catalog duplication is included. |

The September 29 inspection receipt identified the existing project and its canonical tables. That receipt is historical evidence, not proof that the current schema, grants or users are unchanged. The migration intentionally fails if its schema already exists rather than overwriting another builder's work.

## Server and database contract

The server validates the user's access token with Supabase Auth on each request. It never accepts a user ID or role supplied in the command body, never trusts the preview's identity headers, and never falls back to local saving after a shared failure. Browser sign-in uses a separate Secure, HttpOnly cookie. Passwords and server credentials are not saved in the source or returned to the browser.

The server retains Companion's `applyCommand` validation for the initial create/note actions. Four database functions provide membership listing, scoped workspace reading, exact-retry lookup and atomic commit. Only the server role can execute them. Ordinary anonymous or authenticated clients cannot invoke the trusted commit or read/write the private tables directly. See [Supabase database function permissions](https://supabase.com/docs/guides/database/functions) and [API access controls](https://supabase.com/docs/guides/api/securing-your-api).

The commit locks the restaurant and rechecks the canonical person, restaurant, role and mapped membership. It then checks workspace/membership revisions, assigned-manager authority, record identity, record revision and appended history. Record, full revision snapshot, audit and receipt are one PostgreSQL transaction. A conflict or later failure rolls the entire transaction back. Reads filter both restaurant and department.

This initial mapping grants only `tasks.manage` and, when explicitly approved for an owner or GM, `location.manage`. It does not assign the rest of the app's permissions. Multiple-source identity reconciliation and broader shared-center rollout remain later packages.

## Local validation

Local tests use fictional identities and a real embedded PostgreSQL runtime. Authentication-provider responses are simulated only inside the test transport; that is not evidence of real Supabase sign-in or hosted access. Runtime dependencies are isolated from the app. The test must execute the staged migration and actual application command handler, not substitute a mocked transaction.

Required outcomes: account A creates an entry; account B reopens the same ID/revision and adds a note; A reopens attributed history; exact retry adds nothing; altered retry is rejected; wrong restaurant/department and revoked access are denied; a stale edit changes no saved tables; forced late transaction failure rolls back all tables; database reopen retains the record and receipt. Keep results pending until the recorded command finishes successfully.

From the extracted `JMAX-Review` folder, with Node 22.13+ and the app dependencies already installed:

```powershell
pwsh -NoProfile -File scripts/install-shared-store-test-runtime.ps1
node shared-review.mjs
node review.mjs build
```

The first command installs only the pinned PGlite 0.5.8 test runtime under `.sites-runtime/shared-store-validation`, verifies the official npm archive's SHA512, and executes no package lifecycle scripts. It needs internet access once. `shared-review.mjs` then runs the application transport/session tests, real PostgreSQL transaction tests and Manager Log rendering checks. It needs no Supabase credentials and does not contact a shared database. To use an existing isolated runtime instead, set `PGLITE_RUNTIME_ROOT` to its directory before running the command. The normal combined-app dependency setup is described in `START-HERE.md`.

## Before any live rollout

1. Confirm the current shared schema and ownership of the Manager Log writer. Reconcile any existing `public.manager_log` records rather than create two competing writable copies.
2. Confirm Rudd's and Jay's exact sign-in identities and approved Bert's roles. Provision no guessed users. Explicitly map reviewed member IDs, departments and capabilities to canonical people/store roles.
3. Review the staged migration against current schema. It creates a private app schema and narrowly granted server functions; it does not seed or alter people, Food records or operating data. Apply only when the rollout hold is lifted.
4. Configure the server through its normal secret mechanism: `SUPABASE_URL`, a publishable/anon key, and a server secret/service-role key. Do not put server credentials in client environment variables, screenshots, source packages or Pages.
5. Use a verified HTTPS host. The new route authenticates itself; other existing app routes still depend on their established Sites identity boundary. This package does not make the entire existing Worker safe for an unreviewed public deployment.
6. Run the first live Bert's check with the two separately authenticated accounts, then prove denied wrong-store access and a stale edit without changed history. Record live results separately from local test evidence.

The existing `node review.mjs start` continues to launch the local fictional Food demo. It does not configure Supabase or create real memberships. The new shared entry reports missing setup instead of presenting demo records as shared data.
