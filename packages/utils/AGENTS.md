# @carbon/utils

Pure utility functions shared across all Carbon packages and apps. Covers accounting, arrays, BOM, dates, math, strings, status helpers, storage rules, URL manipulation, and more.

## Always

- Import utilities from `@carbon/utils` — never duplicate utility logic in app code.
- Use `sanitize(obj)` to strip empty values before Supabase insert/update operations.
- Use domain-specific helpers where they exist: `formatCurrency()` for money, `getStatus()` for status resolution, `getBomLevel()` for BOM traversal.
- Keep utilities **pure** — no side effects, no database calls, no env access (except `isBrowser` check). Only `@internationalized/date`, `zod`, and `lodash.template` are allowed runtime deps.

## Ask First

- Adding new dependencies — this package is imported everywhere; new deps increase bundle size across all apps.
- Modifying `storage-rules.ts` — the `Operator` union is shared with `@carbon/workflows`, and the evaluator gates real inventory transactions.
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
| `datetime` | Server-side date derivation with mandatory explicit timezone: `timestamp()`, `today(tz)`, `now(tz)`, `businessDay(instant, tz)`, `weekBounds(tz, offset?, anchor?)` (DST-safe Monday→Sunday instant bounds), `weekNumber(date)`. DST/exotic-zone stress suite in `datetime.test.ts` (gap/overlap disambiguation, midnight-skipping zones, 167/169h weeks, ±30/45-min offsets). Mirrored for Deno at `packages/database/supabase/functions/lib/datetime.ts` — keep in sync |
| `hash` | The repo's stable content hashes — `fnv1a32`/`fnv1a64` (cache and idempotency keys) and `getBucket`. Browser-safe; never add `node:crypto` here |
| `math` | Rounding, precision, numeric utilities |
| `string` | Slugify, truncate, camelCase/titleCase conversions |
| `revalidate` | `isSearchParamOnlyNavigation` — shared by both apps' shell `shouldRevalidate` |
| `status` | Status resolution, status color mapping |
| `storage-rules` | Inventory/storage rule engine: condition AST, the shared `Operator` vocabulary, JIT-compiled evaluator |
| `supabase` | Typed Supabase query helpers |
| `types` | Shared TypeScript types (`Edition`, generic utility types) |
| `field-registry` | Fields a storage rule may test, and which operators each one allows |
| `labels` | Human-readable label generation |
| `url` | URL construction and manipulation |

## Cross-References

- `packages/env/` — imports `Edition` and `isBrowser` from this package
- `packages/database/` — service functions use `sanitize()` from here
- `apps/erp/`, `apps/mes/` — primary consumers of all utility functions
