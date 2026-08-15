# P1 Migration Notes

## Migration posture

P1 is an additive shell migration. Existing ERP routes, loaders, services,
permissions, company selection, breadcrumbs, and the Carbon module rail remain
the compatibility layer.

## What changed

- Added a canonical Factory OS navigation bar to the authenticated ERP frame;
  canonical domains no longer appear twice in the normal legacy rail.
- Added `Factory OS` shell identity and document title.
- Added source-backed role context and an empty global object-context slot.
- Added explicit Exceptions and Decisions placeholder routes.
- Added path helpers for the two placeholder destinations.

## What did not change

- No ERPNext or MES route, workflow, service, schema, seed, or data changed.
- No new production metrics or fabricated dashboard cards were added.
- No legacy deep link was redirected or removed.
- No P2, P3, or P4 workspace was implemented.

## Follow-up migration notes

P2 should replace only the empty object-context contract with a validated
Production Order 360 reference and retain the canonical shell. P3 and P4 should
replace the two placeholders with governed evidence and decision contracts,
respectively. Before each replacement, confirm source ownership and permissions
with the domain owners.
