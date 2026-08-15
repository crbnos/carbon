# P1 QA Report

## Baseline and shell architecture

The P1 worktree starts at `2111e7608`. The shell change is limited to the ERP
authenticated frame (`apps/erp/app/routes/x+/_layout.tsx`), the additive
canonical navigation component, two placeholder routes, and path helpers. The
P0 worktree remains clean at the protected baseline.

## Navigation, role, and object context

The canonical bar exposes the nine P1 areas and keeps the existing Carbon module
rail for compatibility. Feature visibility is permission-backed; the displayed
role is limited to the existing employee/supplier/customer contract. Executive,
Planner/Manager, and Operator distinctions are `REQUIRES_DOMAIN_CONFIRMATION`.
The object slot is intentionally empty and has no object loader or mutation.

## Legacy routing

ERP destinations remain existing path-helper targets. MES URLs remain owned by
the separate MES app and are not rewritten by this change. The two new semantic
entry points are explicit placeholders only.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm --filter erp typegen` | PASS |
| `pnpm --filter erp typecheck` | PASS |
| `pnpm --filter erp exec vitest run app/routes/x+/p1-experience-shell.test.ts` | PASS — 4/4 |
| `pnpm --filter erp build` | PASS |
| Biome on new P1 component, placeholder, and contract-test files | PASS |
| `git diff --check` | PASS |

The production build emitted existing chunk-size and Node-module externalisation
warnings; it completed successfully and produced both client and server builds.

## Accessibility review

- Canonical navigation uses a labelled `<nav>` and `aria-current="page"`.
- Every icon is decorative or paired with visible text; the Factory OS home link
  has an explicit accessible name.
- Focus-visible rings are present on navigation and placeholder links.
- The object context slot is announced as text and does not pretend to be an
  interactive object selector.
- Existing Topbar and Carbon module-rail accessibility behavior is preserved.

## Responsive review

- The canonical nav uses horizontal overflow at narrow widths rather than
  clipping or wrapping into unusable controls.
- Role and object context collapse below the large breakpoint so primary links
  retain their hit area.
- Existing mobile Topbar behavior and the desktop Carbon module rail remain
  unchanged.

## Manual boundary

No visual regression runner exists in this repository. Manual QA is therefore
recorded as source-level responsive/accessibility inspection plus successful
production build. A future visual runner should capture authenticated desktop
and narrow-width states before replacing the P1 placeholders with P2–P4 work.

## Regression risk and domain confirmations

Residual risk is visual integration with authenticated tenant data because this
worktree has no visual regression runner. The production build and route
type-generation cover compile and route-registration regressions. Domain
confirmation remains required for cross-system identity reconciliation,
equipment taxonomy, material supply-state mapping, evidence freshness
thresholds, exception lifecycle/severity ownership, and action authorization.
