# P1 Experience Shell Audit

## Scope and baseline

This audit covers the authenticated ERP shell at FIDS v1 baseline commit
`2111e7608` (`factory-os-p0-fids`). It does not audit or change MES screens,
ERPNext, database records, or business workflows.

## Existing shell

- `apps/erp/app/routes/x+/_layout.tsx` owns the authenticated frame, auth gate,
  providers, Topbar, primary navigation, and outlet.
- `apps/erp/app/components/Layout/Topbar` already provides breadcrumbs, company
  context, search, create, notifications, help, and user controls.
- `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx` provides a
  permission-filtered, user-customisable Carbon module rail. It is retained for
  legacy module access and deep-link compatibility.
- `apps/erp/app/hooks/usePermissions.tsx` exposes source-backed roles
  (`employee`, `supplier`, `customer`), feature permissions, and owner status.
- `apps/erp/app/hooks/useUser.tsx` exposes the selected company and user identity.

## Gap findings

1. The shell was Carbon/module-centric rather than Factory OS/workflow-centric.
2. No canonical cross-domain navigation existed for Orders, Materials,
   Equipment, Exceptions, or Decisions.
3. Role context was available in route data but not visible in the shell.
4. There was no explicit global object-context slot.
5. Exceptions and Decisions had no honest P1 destination; adding a fake data
   view would violate the phase boundary.
6. The existing shell already contains the correct legacy routing and responsive
   primitives, so replacing it would create unnecessary migration risk.

## Reuse and constraints

P1 reuses `@carbon/react` primitives, the existing permission hook, path helper,
Topbar, PrimaryNavigation, theme tokens, and route outlet. The new canonical bar
is additive. Existing module URLs remain source-of-truth destinations; no loader,
service, mutation, seed, or database schema is introduced.

## P1 decision

Add a responsive Factory OS canonical navigation bar above the existing Carbon
module rail. Canonical domains are removed from the normal legacy rail to avoid
duplicate primary entries; the rail remains for non-canonical modules and its
customisation/deep-link behavior. Link only to existing ERP destinations, plus
explicit placeholder routes for Exceptions and Decisions. Surface the actual
source role and an empty object-context slot without inferring business roles or
objects.
