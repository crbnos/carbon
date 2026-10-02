# @carbon/utils

Pure utility functions shared across all Carbon packages and apps. Covers accounting, arrays, BOM, dates, numeric precision and formatting, math, strings, status helpers, the storage/sales rule engine, URL manipulation, and more.

## Always

- Import utilities from `@carbon/utils` — never duplicate utility logic in app code.
- Use `sanitize(obj)` to strip empty values before Supabase insert/update operations.
- Use domain-specific helpers where they exist: `formatCurrency()` for money, `getStatus()` for status resolution, `getBomLevel()` for BOM traversal.
- Keep utilities **pure** — no side effects, no database calls, no env access (except `isBrowser` check). The `async` module is the one exception to "no side effects": it schedules work the caller hands it and holds the host's lifetime hook. Only `@internationalized/date`, `zod` and `lodash.template` (plus `nanoid` and `@supabase/supabase-js` for the typed `supabase.ts` wrappers) are allowed runtime deps.

## Ask First

- Adding new dependencies — this package is imported everywhere; new deps increase bundle size across all apps.
- Modifying `rules.ts` / `field-registry.ts` / `rules-schema.ts` — the rule-evaluation engine (condition AST compiler, operators, field registry) and its zod mirror. The `Operator` union is shared with `@carbon/workflows`; the evaluator gates real inventory transactions and sales-document lines. Used by storage rules (`~/modules/inventory`) and sales rules (`~/modules/sales`) across ERP and MES.
- Changing `Edition` enum or `isBrowser` detection — used by `@carbon/env` and auth logic.

## Never

- Import server-only packages (`@carbon/auth`, `@carbon/database`, `@carbon/kv`) from here — `@carbon/utils` must remain client-safe. **Deliberate edge-shared utilities:** `precision.ts`, `accounting-currency.ts`, `accounting-posting.ts`, `payment-funding.ts`, `sales-posting-amounts.ts`, `batch-time-split.ts`, and `batch-compatibility.ts` each re-export their namesake under `packages/database/supabase/functions/shared/` by relative path (`math.ts` consumes `precision.ts`). Those implementations live there because the Supabase edge runtime only mounts `supabase/functions/`; re-exporting rather than duplicating keeps ONE source of truth so the Node and Deno sides never drift. They are client-safe source imports, not imports of the server/database package, and not something to "fix" (same pattern as `packages/database/src/sampling.ts`). Keep their dependency graphs pure.
- Add async/IO operations — utilities should be synchronous pure functions (the exceptions are the `supabase.ts` helpers, which are typed wrappers, and the `async` module, which runs the caller's own async work and does no IO itself). File/image handling lives in `@carbon/files`, not here.
- Duplicate what already exists — check the barrel export (`src/index.ts`) before adding a new utility.

## Validation Commands

```bash
pnpm --filter @carbon/utils test        # Runs rule-engine tests etc.
pnpm --filter @carbon/utils typecheck
```

## Key Modules

| Module | Provides |
|--------|----------|
| `accounting` | Currency formatting, financial calculations |
| `accounting-currency` | Explicit foreign-per-base conversion and settlement FX |
| `accounting-posting` | Original journal role vocabulary: `classifyAccountingPostingRole` maps a journal line's description by EXACT match — `Accounts Receivable`/`IC Receivables` → Receivables, `Accounts Payable`/`IC Payables` → Payables, `Shipping Revenue`, `Sales Account` — and returns `null` for anything else, which is how a `VOID: …` reversal line falls out (there is no explicit void branch) |
| `payment-funding` | Shared effective-settlement, invoice/funding balance reducers and exact document-principal allocation; callers own tenant/status/reservation queries |
| `sales-posting-amounts` | Pure sales component normalization and posting calculations |
| `arrays` | Array manipulation, grouping, deduplication |
| `async` | The `async` object: `Promise.all`, `Promise.allSettled` and `items.map` with a limit on how many run at once (`DEFAULT_CONCURRENCY`, 8, unless `{ concurrency }` says otherwise). `map(items, mapper)` follows p-map, `all(tasks)` and `allSettled(tasks)` take FUNCTIONS (a promise is already running) and keep the tuple's types, `limit(n)` follows p-limit. After a failure `map` / `all` start nothing further. Database calls inside a request need no limit of their own — the client `requirePermissions` returns has at most 8 in flight. `background(task, onError)` is fire-and-forget with a required error handler. `onBackground(hook)` registers what keeps the process alive for that work — both apps register Vercel's `waitUntil` in `entry.server.tsx` — so use `background` (never a bare unawaited promise) for anything a request leaves running |
| `bom` | Bill of Materials traversal and level computation |
| `date` | Date formatting, parsing, range helpers (uses `@internationalized/date`); `HOUR_MS`/`DAY_MS` millisecond constants for instant arithmetic |
| `datetime` | Server-side date derivation with mandatory explicit timezone: `timestamp()`, `today(tz)`, `now(tz)`, `businessDay(instant, tz)`, `weekBounds(tz, offset?, anchor?)` (DST-safe Monday→Sunday instant bounds), `weekNumber(date)`. DST/exotic-zone stress suite in `datetime.test.ts` (gap/overlap disambiguation, midnight-skipping zones, 167/169h weeks, ±30/45-min offsets). Mirrored for Deno at `packages/database/supabase/functions/lib/datetime.ts` — keep in sync |
| `headers` | Request facts from the proxy in front of the app: `getClientIp` (LAST `X-Forwarded-For` entry — the one a caller cannot forge; the ALB appends to a caller's header), `getRequestProtocol`, `getRequestHost`, `getRequestOrigin` (the public origin — `request.url` is the internal one behind the proxy). The host is caller-influenced behind the ALB: compare with it, never build a link someone else opens from it (use `getAppUrl()`). Raw reads are refused by `no-raw-forwarded-headers`. Also `getPreferenceHeaders` (locale, platform) |
| `hash` | The repo's stable content hashes — `fnv1a32`/`fnv1a64` (cache and idempotency keys) and `getBucket`. Browser-safe; never add `node:crypto` here |
| `math` | `clamp`/`lerp`/`inverseLerp` only — it re-exports nothing |
| `precision` | The whole numeric-precision API, re-exported from the edge-runtime module: `SCALE`, `EPSILON`, `RoundingMode`, `round`, `distributeRoundingResidual`, `scrapAllowance`, `applyRate`, `deriveRate`, `isBalanced`, `assertBalanced` |
| `format` | The ONLY place display/input digit counts are chosen: `moneyFormatOptions` (settlement — the currency's decimals are floor AND ceiling), `rateFormatOptions` (per-unit RATE — those decimals are only the floor, ceiling is `SCALE`), the `PERCENT_FORMAT` / `PERCENT_POINTS_FORMAT` / `SCALE_FORMAT` constants, `cldrCurrencyDecimals`, their `format*` helpers, and `INPUT_FORMAT` / `INPUT_STEP` for editable fields. Call sites pick a KIND, never a digit count |
| `string` | Slugify, truncate, camelCase/titleCase conversions |
| `revalidate` | `shouldRevalidate` predicates: `isSearchParamOnlyNavigation` (root loaders), `isUnaffectedByNavigation` (detail layouts — names the route/search params the loader reads) |
| `redirect` | `redirectBeforeLoaders(loader)` — route middleware for an index route that only redirects, so the redirect runs before its parents' loaders |
| `status` | Status resolution, status color mapping |
| `rules` | Rule engine: condition AST, the shared `Operator` vocabulary, JIT-compiled evaluator + surfaces for storage rules and sales rules |
| `rule-filters` | Item scoping for broadcast rules (`ItemFilter`, `ruleAppliesToItem`, `toItemFilter`) — family-neutral, split out of `rules.ts` |
| `rules-schema` | Zod mirror of the rule AST (`conditionAstSchema`, `conditionAstFormField`, `RULE_OPERATORS`/`RULE_MATCH_KINDS`/`RULE_SEVERITIES`). Shared by both ERP rule form validators so neither module imports the other |
| `supabase` | Typed Supabase query helpers |
| `types` | Shared TypeScript types (`Edition`, generic utility types) |
| `field-registry` | Fields a rule may test, which operators each one allows, and which fields the builder/evaluator may reference |
| `labels` | Human-readable label generation |
| `url` | URL construction and manipulation |

## Numeric precision

Every price, rate, quantity and amount follows the standard in
`.claude/rules/numeric-precision.md`: internal values at `SCALE = 5`, settlement
values at the currency's `decimalPlaces` (the DB column, authoritative over
Intl/CLDR), rounding only at persist / display / compare. Three checks in
`@carbon/checks` enforce it (`no-raw-rounding`, `no-inline-fraction-digits`,
`no-derived-percent-column`) and they scan this package.

## Cross-References

- `packages/env/` — imports `Edition` and `isBrowser` from this package
- `packages/database/` — service functions use `sanitize()` from here
- `apps/erp/`, `apps/mes/` — primary consumers of all utility functions
