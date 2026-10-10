# Paged schedule shift reference reads

Candidate migration 019 adds `list_schedule_shifts` and the isolated HTTP handler exposes `GET /api/operations/{restaurant}/schedule-shifts`. Query parameters are optional UUID `after` and integer `limit` from 1 to 100, default 50. Duplicate parameters, unsupported filters and detail IDs on this list endpoint are rejected.

The response contains `items`, `nextCursor`, `workspaceRevision`, restaurant `timezone`, and `coverage: 'shift-references-only'`. Items retain reference ID, membership owner/person ID, restaurant/department, revision, job, start/end instants, publication/cancellation flags and release state. Pagination filters authorized rows before applying the limit, orders by UUID and fetches one extra authorized row to decide the cursor. Clients should refetch when workspace revisions change; multiple pages are not a frozen snapshot.

## Source visibility parity

The read predicate follows the shift branch of `app/shared/domain.ts`:

- Scoped `schedule.manage`, `schedule.publish` or `schedule.change` grants expose both draft and published shifts; `location.manage` widens their department scope only when paired with the relevant scheduling grant.
- Employees see their own published shifts, including retained cancelled/released references. Their own draft shifts remain hidden without scheduling permission.
- Published shifts are also visible through the source attendance-management or closing-confirmation read scope. Location administration alone can expose published shifts through attendance scope, but does not expose drafts.
- Explicit grants, not the GM title, determine access. The source's closing read helper can permit some explicitly granted reads even when the candidate closing action helper would deny an action; this endpoint preserves that distinction without granting assignment, verification, confirmation or release.

HTTP requests use the existing verified session resolver and restaurant scope. The function independently rejects inactive, schedule-only and mismatched-subject actors. A schedule-only employee can appear as a shift owner to an authorized reader without receiving any auth link or sign-in permission. Revoked grants are read afresh on later requests. Runtime still cannot read the underlying shift table directly.

## Limits

This is a shift-reference read contract, not the full schedule workspace or a replacement for the running D1 route. It does not return the complete roster, scheduling job eligibility, qualifications, availability, leadership records, staffing, requests, coverage or attendance. No date-range filter is implemented yet. Original shift station/import/copy metadata, full history and `updatedAt` are not present in the narrow candidate references; archived import snapshots retain richer source fields for subsequent work.

No schedule write, publication, job assignment, identity grant or availability change was added. Existing operational `read_shift` remains separate. The next slice should define roster/job eligibility and availability reads, then draft/edit writes with overlapping shift, availability and linked-work protection. Final person/membership/job modeling and Inventory integration remain open.

## Validation

Four new integration tests compare candidate shift visibility directly with the original transpiled `visible` function across 30 title/grant profiles and six owner/department/draft/published references. Further checks cover filtered pagination, timezone/instant preservation across a DST transition, retained revisions, schedule-only owners without sign-in, revocation, cross-restaurant/subject denial, bounded query validation, database session revocation and direct table denial. These are source-policy and HTTP/database checks, not a new browser schedule test.

Fresh fictional bootstrap applied all 19 manifest-verified migrations; all 200 serial candidate checks passed. Strict adapter types, original-form preview build and source coverage inventory passed. Shared migrations 001–018 remain unchanged. This focused change is stacked on the migration readiness draft PR.
