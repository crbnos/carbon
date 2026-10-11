# @carbon/utils

Pure utility functions shared across all Carbon packages and apps. Covers accounting, arrays, BOM, dates, numeric precision and formatting, math, strings, status helpers, the storage/sales rule engine, URL manipulation, and more.

## Always

- Import utilities from `@carbon/utils` — never duplicate utility logic in app code.
- Use `sanitize(obj)` to strip empty values before Supabase insert/update operations.
- Use domain-specific helpers where they exist: `formatCurrency()` for money, `getStatus()` for status resolution, `getBomLevel()` for BOM traversal.
- Keep utilities **pure** — no side effects, no database calls, no env access (except `isBrowser` check). The `async` module is the one exception to "no side effects": it schedules work the caller hands it and holds the host's lifetime hook. Runtime deps are the ones in `package.json`; `@carbon/database` is among them only for the pure subpaths listed under Never.

## Ask First

- Adding new dependencies — this package is imported everywhere; new deps increase bundle size across all apps.
- Modifying `rules.ts` / `field-registry.ts` / `rules-schema.ts` — the rule-evaluation engine (condition AST compiler, operators, field registry) and its zod mirror. The `Operator` union is shared with `@carbon/workflows`; the evaluator gates real inventory transactions and sales-document lines. Used by storage rules (`~/modules/inventory`) and sales rules (`~/modules/sales`) across ERP and MES.
- Changing `Edition` enum or `isBrowser` detection — used by `@carbon/env` and auth logic.

## Never

- Import server-only packages (`@carbon/auth`, `@carbon/database`, `@carbon/kv`) at runtime from here — `@carbon/utils` must remain client-safe (type-only `@carbon/database` imports for the generated `Database` types are fine). The one exception is the pure `@carbon/database` subpaths `./precision`, `./accounting-currency`, `./accounting-posting`, `./sales-posting-amounts` and `./ledger`, which the index re-exports: they live in `@carbon/database` because its posting journal builders need them and `@carbon/database` cannot import this package (the two would form a turbo cycle). Keep their dependency graphs pure.
- Add IO — no network, file, or database access (the one exception is `supabase.ts`, typed wrappers around a client the caller passes in). The `async` helpers orchestrate promises the caller supplies; they perform no IO themselves. File/image handling lives in `@carbon/files`, not here.
- Duplicate what already exists — check the barrel export (`src/index.ts`) before adding a new utility.

## Validation Commands

```bash
pnpm --filter @carbon/utils test        # Runs rule-engine tests etc.
pnpm --filter @carbon/utils typecheck
```

## Key Modules

| Module | Provides |
|--------|----------|
| `accounting` | Currency formatting, financial calculations; re-exports the ledger helpers (`AccountType`, `credit`, `debit`, …) from `@carbon/database/ledger` |
| `accounting-currency` | Explicit foreign-per-base conversion and settlement FX (re-exported from `@carbon/database/accounting-currency`) |
| `accounting-posting` | (Re-exported from `@carbon/database/accounting-posting`.) Original journal role vocabulary: `classifyAccountingPostingRole` maps a journal line's description by EXACT match — `Accounts Receivable`/`IC Receivables` → Receivables, `Accounts Payable`/`IC Payables` → Payables, `Shipping Revenue`, `Sales Account` — and returns `null` for anything else, which is how a `VOID: …` reversal line falls out (there is no explicit void branch) |
| `payment-funding` | Shared effective-settlement, invoice/funding balance reducers and exact document-principal allocation; a source with a deposit `scope` funds only requests whose invoice bills that rental agreement / sales order (`fundingScopeCovers`, `fundableDocumentAmounts`); callers own tenant/status/reservation queries |
| `sales-posting-amounts` | Pure sales component normalization and posting calculations (re-exported from `@carbon/database/sales-posting-amounts`) |
| `batch-compatibility` / `batch-time-split` / `batch-pick-split` | Job-operation batching: per-process compatibility rules, proportional time split + completion planning, pro-rata material pick split across members |
| `batch-split` / `batch-merge` | Tracked-entity record builders: `buildBatchSplitRecords` / `buildMergeRecords` and the one split gate `isFullDraw`; `buildBatchMergeRecords` for a deliberate lot merge (see `.claude/rules/traceability-model.md`) |
| `entity-drain` | `settleQuantity` / `statusAfterQuantityChange` — round, refuse a negative, and flip a drained lot to `Consumed` |
| `pick-guards` | `resolvePick` / `assertEntityCoversPick` / `PickGuardError` (a 400) — a pick accumulates onto the line's running total |
| `resolve-tracked-entity-bin` | The bin a tracked entity holds stock in, by net on-hand per bin |
| `resolve-return-cost` / `purchase-cost-adjustment` | Sales-return re-entry unit cost; invoice-vs-receipt variance split across FIFO layers (inventory vs PPV) |
| `journal-dimensions` / `intercompany-capture` | Automatic `journalLineDimension` rows for posted journal lines; intercompany posting-line classification |
| `short-close` | Short-close-aware billable / remaining-to-invoice PO line quantities |
| `calculate-due-date` | `calculateDueDate` / `DEFAULT_PAYMENT_TERM` — an invoice's due date from its payment term (shared by the ERP and invoice posting) |
| `revenue-schedule` | Re-exports `@carbon/database/revenue-schedule` (moved there so the contract revenue planner and the demo dataset share it): ISO-date arithmetic on `YYYY-MM-DD` strings (`parseIsoDate`, `formatIsoDate`, `daysInMonth`, `monthEnd`, `daysBetweenInclusive`, `addDays`) and `spreadStraightLine` (a revenue schedule spread over days with cumulative rounding) — used by the `post-sales-invoice` server function's deferrals and the rental/lease modules |
| `rental-periods` | Rental billing period math: `rateCharge`, `periodCharge`, `calendarMonthCharge`, `defaultRentalRates` (a unit's starting rate per frequency: customer → customer type → item), `billingHorizon`, `generateRentalBillingPeriods` (create / recut / early-return adjustments against persisted periods). Shared by the `post-rental-agreement` and `create-rental-invoices` server functions and the ERP |
| `lessor-lease` | ASC 842 lessor math: `presentValue`, `classifyLessorLease`, `buildLessorSchedule`, `wholeMonthsInTerm`, `leasePaymentTerms`, `certainPurchaseOption`, `classifyRentalLine`, `salesTypeRequirementError` (end date, fair value, whole billing periods), `earnsInterest` (whether a lease schedule month books interest — the recognition run reads it). One function for the ERP's Draft preview and what activation stores |
| `rental-invoice-plan` | Invoice automation's pure planner: `planRentalInvoices` (one combined invoice under `Draft Only`, else rent + a held charges invoice; holds for early-return credits and re-bills of a voided invoice), `effectiveInvoiceAutomation`, the hold messages, and the `InvoiceAutomation` type. Used by the `create-rental-invoices` server function and the invoice automation job |
| `async` | The `async` object: `Promise.all`, `Promise.allSettled` and `items.map` with a limit on how many run at once (`DEFAULT_CONCURRENCY`, 8, unless `{ concurrency }` says otherwise). `map(items, mapper)` follows p-map, `all(tasks)` and `allSettled(tasks)` take FUNCTIONS (a promise is already running) and keep the tuple's types, `limit(n)` follows p-limit. After a failure `map` / `all` start nothing further. Database calls inside a request need no limit of their own — the client `requirePermissions` returns has at most 8 in flight. `background(task, onError)` is fire-and-forget with a required error handler. `onBackground(hook)` registers what keeps the process alive for that work — both apps register Vercel's `waitUntil` in `entry.server.tsx` — so use `background` (never a bare unawaited promise) for anything a request leaves running |
| `errors` | `getErrorMessage(error, fallback)` — the error's own message, else the caller's copy (server functions leave `message` empty for data-layer failures so the fallback wins); `isUniqueViolation(error)` / `isForeignKeyViolation(error)` — the Postgres SQLSTATE checks (23505 / 23503) on a Supabase result or a thrown Kysely error; `getDatabaseErrorMessage(error, fallback, { duplicate?, referenced? })` — the caller's copy for the constraint Postgres named |
| `avatar` | Generated-avatar values in `user.avatarUrl` (`dicebear:<style>:<seed>[:<rrggbb>]` — the optional background is lowercase hex without `#`, absent = the style's own): `GENERATED_AVATAR_STYLES` (only ever add — a removed style's existing avatars fall back to initials), `parseGeneratedAvatar`, `formatGeneratedAvatar`, `isGeneratedAvatar`, `newGeneratedAvatar(style?, background?)`, `normalizeAvatarBackground` (picker input → stored form), `avatarSrc(value, toUrl)` (a stored value → an `<img>` `src`, used by every app's `Avatar` wrapper), and what a user may store (`isOwnAvatarUpload`, `isAllowedAvatarValue`). Rendering lives in `@carbon/react` |
| `arrays` | Array manipulation, grouping, deduplication |
| `bom` | Bill of Materials traversal and level computation |
| `date` | Date formatting, parsing, range helpers (uses `@internationalized/date`); `HOUR_MS`/`DAY_MS` millisecond constants for instant arithmetic |
| `datetime` | Server-side date derivation with mandatory explicit timezone: `timestamp()`, `today(tz)`, `now(tz)`, `businessDay(instant, tz)`, `weekBounds(tz, offset?, anchor?)` (DST-safe Monday→Sunday instant bounds), `weekNumber(date)`. DST/exotic-zone stress suite in `datetime.test.ts` (gap/overlap disambiguation, midnight-skipping zones, 167/169h weeks, ±30/45-min offsets). Pair with `getCompanyTimeZone` / `getLocationTimeZone` from `@carbon/database` |
| `headers` | Request facts from the proxy in front of the app: `getClientIp` (LAST `X-Forwarded-For` entry — the one a caller cannot forge; the ALB appends to a caller's header), `getRequestProtocol`, `getRequestHost`, `getRequestOrigin` (the public origin — `request.url` is the internal one behind the proxy). The host is caller-influenced behind the ALB: compare with it, never build a link someone else opens from it (use `getAppUrl()`). Raw reads are refused by `no-raw-forwarded-headers`. Also `getPreferenceHeaders` (locale, platform) |
| `hash` | The repo's stable content hashes — `fnv1a32`/`fnv1a64` (cache and idempotency keys) and `getBucket`. Browser-safe; never add `node:crypto` here |
| `math` | `clamp`/`lerp`/`inverseLerp` only — it re-exports nothing |
| `mode` | Light / dark / system. `getModeFromCookies` resolves the root loader's `mode` (what to render) and `modePreference` (what the user chose): the explicit `mode` cookie wins, else the OS hint cookie, else light. `colorSchemeHintScript` is the inline `<head>` script that writes the OS hint and reloads once when a `system` user was rendered in the wrong mode. The browser-side halves (`useMode`, `useModePreference`, `getSystemMode`) live in `@carbon/react` |
| `planning-sizing` | `computePlanningOrders` — reorder-quantity sizing for the four reordering policies (`ComputePlanningOrdersInput` — `{ reorderingPolicy, periods, projections, todayDate, params: PlanningSizingParams }` — in, `PlanningOrderSuggestion[]` out). Pure and clock-free (`todayDate` is injected). Also `orderSizingRules(policyName, params)` — how ONE order of a policy is sized (per-order quantity, daily vs spread, maximum, minimum, multiples) — shared by MRP's change actions and the planning pages: `splitIntoOrders` (a week's summed action back into its orders; `lotSizeBatches` is the batch case) and `reducedOrderQuantity` (a Decrease's floor and multiples). Shared by the MRP engine and the item planning tab's `ItemReorderPolicy`, so both size an order the same way; `planning-sizing.test.ts` pins it against hand-computed results of the SQL `calculate_quantity_to_order` |
| `precision` | The whole numeric-precision API (re-exported from `@carbon/database/precision`): `SCALE`, `EPSILON`, `RoundingMode`, `round`, `distributeRoundingResidual`, `scrapAllowance`, `applyRate`, `deriveRate`, `isBalanced`, `assertBalanced` |
| `format` | The ONLY place display/input digit counts are chosen: `moneyFormatOptions` (settlement — the currency's decimals are floor AND ceiling), `rateFormatOptions` (per-unit RATE — those decimals are only the floor, ceiling is `SCALE`), the `PERCENT_FORMAT` / `PERCENT_POINTS_FORMAT` / `SCALE_FORMAT` constants, `cldrCurrencyDecimals`, their `format*` helpers, and `INPUT_FORMAT` / `INPUT_STEP` for editable fields. Call sites pick a KIND, never a digit count |
| `string` | Slugify, truncate, camelCase/titleCase conversions |
| `items` | Item lookups and `getReadableIdWithRevision` (`readableId.revision`) |
| `revalidate` | `shouldRevalidate` predicates: `isSearchParamOnlyNavigation` (the root loader only; layouts do not skip their loaders, see `coding-conventions.md` → Routes) |
| `prefetch` | `prefetchCacheMiddleware` — root `middleware` of every app: a prefetch response (`Sec-Purpose: prefetch`) gets `private, max-age=5`, so the click reuses it instead of asking again and waiting behind it. Navigations and revalidations stay uncached |
| `redirect` | `redirect(to, init?)` — the only redirect a loader or action uses: a path on this origin, anything else lands on the home page (`no-raw-redirect` check); `redirectExternal(url, init?)` to leave the origin on purpose with a URL the server built; `safePath(to, fallback)` for a destination that is stored or forwarded rather than redirected to. `redirectBeforeLoaders(loader)` — route middleware for an index route that only redirects, so the redirect runs before its parents' loaders |
| `status` | Status resolution, status color mapping |
| `rules` | Rule engine: condition AST, the shared `Operator` vocabulary, JIT-compiled evaluator + surfaces for storage rules and sales rules |
| `rule-filters` | Item scoping for broadcast rules (`ItemFilter`, `ruleAppliesToItem`, `toItemFilter`) — family-neutral, split out of `rules.ts` |
| `rules-schema` | Zod mirror of the rule AST (`conditionAstSchema`, `conditionAstFormField`, `RULE_OPERATORS`/`RULE_MATCH_KINDS`/`RULE_SEVERITIES`). Shared by both ERP rule form validators so neither module imports the other |
| `supabase` | Typed Supabase query helpers |
| `types` | Shared TypeScript types (`Edition`, generic utility types, `TrackedEntityAttributes`) |
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
