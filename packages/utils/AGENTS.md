# @carbon/utils

Pure utility functions shared across all Carbon packages and apps. Covers accounting, arrays, BOM, dates, math, strings, status helpers, storage rules, URL manipulation, and more.

## Always

- Import utilities from `@carbon/utils` — never duplicate utility logic in app code.
- Use `sanitize(obj)` to strip empty values before Supabase insert/update operations.
- Use domain-specific helpers where they exist: `formatCurrency()` for money, `getStatus()` for status resolution, `getBomLevel()` for BOM traversal.
- Keep utilities **pure** — no side effects, no database calls, no env access (except `isBrowser` check). Only `@internationalized/date`, `zod`, and `lodash.template` are allowed runtime deps.

## Ask First

- Adding new dependencies — this package is imported everywhere; new deps increase bundle size across all apps.
- Modifying `storage-rules.ts` — affects Supabase storage bucket policies and file access patterns.
- Changing `Edition` enum or `isBrowser` detection — used by `@carbon/env` and auth logic.

## Never

- Import server-only packages (`@carbon/auth`, `@carbon/database`, `@carbon/kv`) from here — `@carbon/utils` must remain client-safe.
- Add async/IO operations — utilities should be synchronous pure functions (the one exception is `supabase.ts` helpers which are typed wrappers).
- Duplicate what already exists — check the barrel export (`src/index.ts`) before adding a new utility.

## Validation Commands

```bash
pnpm --filter @carbon/utils test        # Runs storage-rules tests etc.
pnpm --filter @carbon/utils typecheck
```

## Key Modules

| Module | Provides |
|--------|----------|
| `accounting` | Currency formatting, financial calculations |
| `arrays` | Array manipulation, grouping, deduplication |
| `bom` | Bill of Materials traversal and level computation |
| `date` | Date formatting, parsing, range helpers (uses `@internationalized/date`) |
| `math` | Rounding, precision, numeric utilities |
| `string` | Slugify, truncate, camelCase/titleCase conversions |
| `status` | Status resolution, status color mapping |
| `storage-rules` | Supabase storage bucket access policies |
| `supabase` | Typed Supabase query helpers |
| `types` | Shared TypeScript types (`Edition`, generic utility types) |
| `field-registry` | Dynamic field registration for custom fields |
| `labels` | Human-readable label generation |
| `url` | URL construction and manipulation |

## Cross-References

- `packages/env/` — imports `Edition` and `isBrowser` from this package
- `packages/database/` — service functions use `sanitize()` from here
- `apps/erp/`, `apps/mes/` — primary consumers of all utility functions
