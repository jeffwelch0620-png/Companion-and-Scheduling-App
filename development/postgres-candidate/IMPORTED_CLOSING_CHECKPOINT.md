# Imported shift-standard links and closing rehearsal

The reference mapping/import helpers now accept optional `snapshot.shiftStandardLinks` entries:

```js
{ shiftId: 'source-shift', shiftRevision: 3,
  standardId: 'source-standard', standardRevision: 4 }
```

IDs here are source record IDs, resolved through the explicit mappings. Both revisions must match the reviewed source. The mapped references must share restaurant, department and position. Cancelled shifts and standards that are not approved block the proposal. Duplicate pairs, missing references and extra fields also block it. Omitting this list produces no links; matching names, stations or job titles never create them automatically. Draft shifts may have reviewed links for future publication; a link does not publish a shift.

The importer writes these links in the same transaction as the new reference rows, archive receipt and scope revision. A link insertion failure rolls back all of them. The receipt retains the exact source relationship list and reports the number of links. Existing-reference updates remain unsupported. All published SQL migrations remain unchanged; the existing shift-standard relation is reused.

## End-to-end evidence

`imported-closing.test.mjs` imports a fictional worker, manager, verifier, shift, standard and explicit link. It first proves that imported records alone do not enable an employee session or authorize a closing assignment. The test then performs a separate fictional setup for auth links, sessions, capability grants and station clearances.

Locally signed JWTs pass through the real token verifier and HTTP request handler, which resolves each session against PostgreSQL. Commands use the original closing form's `formCommand` adapter. Employee readiness proceeds to the independent verifier; self-verification is denied and manager confirmation cannot skip verification. The verifier passes the work, then the manager confirms it. Readback preserves the imported standard revision 4 and content version 7, checklist answers and all four history actions. Closing confirmation leaves the shift unreleased with its checkout profile still `unreviewed`.

This is a form-command/API/database rehearsal, not a new browser usability test. Original screens were built successfully; no real account or hosted service was used. Production standard approval, employee access and training clearance still require their own approved workflow.

## Remaining work

Realistic exports and canonical Inventory contracts remain pending. Existing historical closing records and task histories were not imported; full source snapshots are retained for later reconciliation. Next preparation should address the remaining reference/workflow coverage and migration readiness checklist before active cutover. Inventory integration, hosted application and Git merges remain on hold.

## Validation

Fresh fictional PostgreSQL bootstrap applied all 18 unchanged, manifest-verified migrations. The serial suite passed 196 checks, including three new link validator checks and three imported-closing integration checks. Strict adapter type validation and the original-form preview build passed. This checkpoint is stacked on the transactional import draft PR.
