# JMAX editable source for Jeff

This October 8, 2026 snapshot contains the current editable Companion app, its blue JM branding, and the updated employee home with Today, Learning, and Progress tabs. It includes source, schema and migrations, tests, fictional fixtures, dependency lockfile, and local launchers. It is a development handoff, not a deployed restaurant system.

## Open the current local preview

Extract into a new folder and open PowerShell in JMAX-Review. Use Node.js 22.13 or newer. Install dependencies and build:

```powershell
npm ci
node review.mjs build
```

Run the current operations preview directly. Do not use `node review.mjs start` for this snapshot: its older combined scheduling fixture currently needs its review-restaurant access mapping corrected.

```powershell
$env:JMAX_PREVIEW_PORT = '6601'
$env:JMAX_PREVIEW_EMPLOYEE_JOURNEY = '1'
Remove-Item Env:JMAX_PREVIEW_COMBINED_SCHEDULE -ErrorAction SilentlyContinue
Remove-Item Env:JMAX_PREVIEW_TOAST_SCHEDULE -ErrorAction SilentlyContinue
node tests/operations-preview.mjs
```

Five consecutive ports must be free. Open http://127.0.0.1:6601/team for the owner view, 6602 for FOH manager, 6603 for BOH manager, 6604 for employee, and 6605 for a separate owner identity. A 390 by 844 browser viewport shows the phone layout. Enter `stop` or press Ctrl+C to stop. If Windows blocks its temporary directory, create a short writable folder and set TEMP and TMP to that folder before launching; the build launcher supports JMAX_REVIEW_TEMP.

The preview uses fictional identities and an ephemeral database. It blocks external services and is only for the computer running it. It is not a shared hosted address, production sign-in, or evidence that live AI, Toast, Food, or Supabase connections are configured. Staff using the real app must retain their restaurant boundaries. Development access does not make Jeff an all-restaurant operational owner; only Jay and Rudd have that authority.

## Work with the source

Modify app and schema files in a separate checkout. The archive has no Git remote and is not an invitation to a canonical repository. Coordinate the destination branch with Jay and Rudd before combining it with Jeff's Food project. Preserve existing source identity and avoid replacing a full backend with this snapshot.

The tests and fixture helpers are included for local development. Prepare their shared modules before selected local checks:

```powershell
node scripts/prepare-shared-tests.mjs
node --test tests/workspace-context.test.mjs tests/openai-companion.test.mjs
```

Historical audit tests that read archived evidence or prior model-response files require their separate evidence packages. Those bulky historical records are intentionally omitted; a broad test glob is not promised to pass on this compact source handoff. No real provider tests should be run without a deliberate secure configuration and review of what data they transmit.

## Shared project materials

- JMAX decisions and build status: https://chatgpt.com/space/page_6abd2330b148819189fc5f9a79583020
- JMAX logo assets: https://chatgpt.com/space/page_6ac7b59505888191888c896315b778c2
- JMAX Food and Labor Library: https://drive.google.com/drive/folders/1TndpEqI3vYwjIoTaSX8Bc3xPnX02O7aV

Jeff's existing Google account jeff.welch0620@gmail.com has editor access to the Space and writer access to the shared library. Email coordination uses jeff.welch0620@outlook.com. Database migrations are editable source only and have not been applied by this handoff. Credentials, environment files, dependencies, compiled output, local runtime databases, private keys, and bulky evidence are omitted.

SOURCE-MANIFEST.json hashes every archived file except itself. Package verification checks archive CRC, duplicate names, safe relative paths, file sizes, and all hashes. This proves file integrity; it does not establish receiving-machine startup, deployment, or live integration acceptance.
