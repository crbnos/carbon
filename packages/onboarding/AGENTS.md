# @carbon/onboarding

Implementation Hub — onboarding blueprint, pure logic, server DB helpers, and presentational UI for company setup.

## Always

- **Use the three-export structure**: `@carbon/onboarding` (logic + types), `@carbon/onboarding/server` (DB helpers), `@carbon/onboarding/ui` (React components)
- **Follow Carbon service convention** — server functions take supabase client as first arg, return `{ data, error }` (never throw)
- **Keep logic pure and client-safe** — `src/logic/` contains visibility, timeline, board, guide, and overlay logic with no server deps
- **Use zustand for UI state** — `hubStore` manages the Implementation Hub's client-side state via `HubProvider`

## Ask First

- Modifying the `TEMPLATE_KEY` or `TEMPLATE_VERSION` constants (affects enrolled companies)
- Adding new DB tables or columns (needs migration + RLS)
- Changing the onboarding step ordering or visibility logic

## Never

- Import server-only modules (`@supabase/supabase-js`, DB client) from the client-safe barrel export
- Hardcode company-specific setup steps — use the template/content system

## Validation Commands

```bash
pnpm --filter @carbon/onboarding test        # vitest
pnpm --filter @carbon/onboarding typecheck   # tsgo --noEmit
```

## Key Patterns

- **Content-driven**: `src/content.ts` defines the template blueprint (steps, sections, exclusions)
- **Logic layer**: `src/logic/` — pure functions for visibility, timeline, board layout, guide flow
- **UI primitives**: `src/ui/primitives/` — `PageHeader`, `Section`, `StatusToggle`, `EditableInput`, `DerivedStatus` (display-only ring for auto-derived items)
- **Views**: `ScopeView`, `RolesView`, `DataMigrationView`, `TrainingView`, `GoLiveView`, etc.

## Cross-References

- `packages/database/` — `implementationHub`, `implementationCheckState`, `implementationFieldValue`, `implementationRow` tables
- `packages/form/` — form primitives used by onboarding UI
- `packages/react/` — shared React components
