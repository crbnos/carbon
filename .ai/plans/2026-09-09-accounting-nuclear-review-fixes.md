# Accounting nuclear-review fixes

Fixes the eight confirmed Must-fix defects from the 2026-09-09 nuclear self-review of
PR #1599, plus the low-risk "cheap win" items. Review record:
[.ai/reviews/2026-09-09-accounting-nuclear-review.md](../reviews/2026-09-09-accounting-nuclear-review.md).

## User decisions (2026-09-09)

- Scope: **Must fix (8) + cheap wins**. Structural extractions and the Risks section
  are out of scope for this pass.
- Refund applications: **restore support**. The `cashIn !== isAR` refusal is treated as
  an accidental regression, not a deliberate scope reduction.
- `sourceAmount` backfill: **premise holds, no change**. Accounting is unused, so the
  deliberate no-backfill design stays. This closes review findings that depended on
  historical settlement data; they are not defects under the premise.

## Tasks

### T1 — Largest-remainder residual distribution (Must fix #1, #4)

- [x] Add `distributeRoundingResidual(exactValues, target, scale)` to
      `packages/database/supabase/functions/shared/precision.ts`. Hamilton/largest-remainder:
      each part moves at most one minor unit; refuses when the residual exceeds one unit
      per part. `precision.ts` is the sanctioned home (it is exempt from `no-raw-rounding`
      as the implementation of rounding).
- [x] Unit tests in `shared/precision.test.ts`.
- [x] Rewrite `reconcileDocument` in `packages/ee/src/accounting/core/sales-document-components.ts`
      to allocate net and tax through the new helper instead of concentrating the whole
      residual on one component.
- [x] Derive `unitAmount` from the reconciled `netAmount` instead of throwing when the
      stored `convertedUnitPrice` mirror and the computed net straddle a rounding tie.
- Verify: `pnpm --dir packages/ee exec vitest run src/accounting` and a regression test
  proving 20 × $1.99 @ 8.25% keeps every component within one minor unit of
  `round(net × taxPercent)`.

### T2 — Intercompany matching scale (Must fix #2)

- [x] `shared/sales-posting-amounts.ts` — `calculateSalesIntercompanyAmount` rounds at
      `SCALE`, matching the buyer's `round(...)` in `post-purchase-invoice/index.ts:2022`.
      The IC amount is an exact matching key, not a settlement amount.
- [x] Drop the now-unused `currencyDecimals` parameter and update the call site.
- Verify: new test asserting both sides agree on a 5dp document amount.

### T3 — Restore refund applications (Must fix #3)

- [x] Remove the `cashIn !== isAR` refusal in
      `post-payment/post-payment-transaction.ts`; the two-axis journal logic in
      `build-payment-journal.ts` already handles it.
- [x] Regression test covering a Disbursement settling a sales invoice and a Receipt
      settling a purchase invoice.

### T4 — Rillet money precision (Must fix #5)

- [x] `providers/rillet/entities/shared.ts` — remove the `decimalPlaces = 2` default so
      the scale is always supplied; replace the `toDocumentAmount(0, rate, 2)` scale
      literal in `toRilletExchangeRate`.
- [x] Thread real `decimalPlaces` through `entities/payment.ts` and `entities/item.ts`.

### T5 — On-account control description (Must fix #6)

- [x] Add the on-account credit role to `shared/accounting-posting.ts` and use it from
      both `post-payment-transaction.ts` and `build-payment-journal.ts`.

### T6 — Report SQL (Must fix #7, #8)

- [x] New migration: align the AR/AP tie-out `payment_unapplied` party filters with
      their aging counterparts.
- [x] `ALTER COLUMN "fxGainLossAmount" SET NOT NULL` (safe: the column was
      `GENERATED ALWAYS` so no row can be NULL).
- [x] Replace the eight bare `round(x,5)` scale literals with a named
      `accounting_internal_scale()` helper.

### T7 — Cheap wins

- [x] Delete dead defaults writers `updateDefaultBalanceSheetAccounts` (zero callers)
      and `updateDefaultIncomeAccounts` (test-only), both still MCP-exposed as
      unvalidated/duplicate `WRITE` tools.
- [x] Delete dead `getSettledInvoiceStatus` and its baselined raw-rounding violations.
- [x] Export `assertExchangeRate` / `assertCurrencyDecimals` from
      `shared/accounting-currency.ts` and replace the discarded-conversion validation
      sites with named assertions.
- [x] Docs freshness: `payments.mdx` (settlement field table, the CHECK sentence, the
      FX plug sentence), `accounting.mdx` (shipping revenue), glossary term, and the two
      unsupported `packages/utils/AGENTS.md` claims.

## Verification gates

`pnpm run lint` · scoped typechecks (`erp`, `@carbon/ee`, `@carbon/utils`, `@carbon/database`)
· `@carbon/utils`, `@carbon/ee` accounting, ERP accounting/invoicing/reports, `@carbon/checks`
· `deno test` for the pure edge helpers · `pnpm run generate:types` after the migration
· `pnpm db:check:datasets` and `pnpm db:check:backups` before committing.

## Verification results (2026-09-09)

A local database was reachable, so the DB-backed regressions that normally cannot run
were executed via the tracked runner.

| Gate | Result |
|---|---|
| `pnpm run lint` | 35/35 tasks |
| Scoped typecheck (erp, ee, utils, database, glossary, checks, workflows) | 8/8 tasks |
| Edge functions (`deno test`, **with** `SUPABASE_DB_URL`) | **195 passed, 0 failed** (was 163 passed / 20 env-failed) |
| `@carbon/utils` | 177 passed |
| `@carbon/ee` accounting | 665 passed |
| ERP accounting + invoicing + reports | 312 passed |
| `@carbon/checks` conformance | 100 passed |
| SQL suites (5) | 93 + 10 + 13 + 4 + 8 pass notices, all `ROLLBACK` |
| `pnpm db:check:datasets` | 4/4 |
| `pnpm db:check:backups` | restorable |
| `pnpm run check:workflow-catalog` | ok |

Red→green proofs recorded for the residual allocator (4/5 cases fail on the old code with
deviations of 0.08/0.11/0.20/0.07 against a 0.01 envelope), the Rillet decimals fix
(4 tests, JPY/BHD), the SQL party-filter fix, and the de-tautologised defaults test.

## Deliberately NOT done (still open from the review)

- The whole **Risks / questions** section — invoice-poster TOCTOU and row locks, the
  purchase-side fixed-asset writes outside the Kysely transaction, payment-UI stale
  `rows` state and raw engine errors surfaced to users, `new.tsx` loader/action
  asymmetry, `getCompanyHasOpenCredits` regression, unbounded `FOR UPDATE`, the Xero
  explicit `CurrencyRate: 1` reversal and 3-decimal refusal, the inbound Xero
  `taxPercent` 100x, and the two questionable new MCP tools.
- The **structural** items — edge-function extraction, `invoicing.service.ts` (3,188 lines)
  and `accounting.ee.service.ts` (6,849 lines) splits, the duplicated currency-decimals
  loader and double-spend block, and wiring `apps/erp` + `packages/database` into CI's
  `turbo run test` (today `pnpm test` runs neither, so ~7,400 lines of this branch's
  tests are unenforced — the single highest-leverage follow-up).
- `sourceAmount` backfill — the user's "accounting is unused" premise holds, so the
  deliberate no-backfill design stays.

## Follow-up: the pre-existing failing tests (2026-09-09)

Turning CI on required both suites to be green first. They were not. All were
**pre-existing** — none caused by this branch.

| Suite | Before | After |
|---|---|---|
| `apps/erp` (vitest) | 978 passed / **11 failed** (4 files) | **990 passed / 0 failed** (80 files) |
| `packages/database` (deno, no DB) | 254 passed / **21 failed** | **257 passed / 0 failed / 20 ignored** |
| `packages/database` (deno, with DB) | — | **277 passed / 0 failed** |

### Root causes

- **9 of the 11 ERP failures trace to ONE commit**, `7f5f1d2145` (#1151, the
  `x/schedule` → `x/priority` route move plus in-process scheduling). It renamed
  `path.to.scheduleDatesUpdate` → `priorityDatesUpdate` and replaced
  `invoke("schedule")` with `runLocationSchedule`. Two test files were never
  re-pointed. In `drag-lifecycle.test.tsx` the stale `~/utils/path` mock made
  `path.to.priorityDatesUpdate` `undefined`, which both blanked the submitted
  `action` AND silently disabled the pending-fetcher merge, so two guard tests
  had quietly become no-ops. Both fixes are test-side; the production ordering
  and routing are correct, proven by mutation (reordering the route, or reverting
  the mock, makes them fail again).
- **`lib/response.test.ts`** asserted a ZodError is suppressed entirely. The code
  deliberately surfaces a compact `zodIssueSummary` instead — documented at
  length in `response.ts`, and matching the existing lesson about sanitization
  eating legible messages. Stale test; replaced with three assertions covering
  the summary, the five-issue cap and the empty-issues case.
- **`i18n-react-macros.test.ts`** banned the `@lingui/core/macro` MODULE, flagging
  **284** files for importing `msg` — the exact pattern
  `.claude/rules/i18n-lingui-system.md` prescribes for route breadcrumbs. The gate
  contradicted the documented convention, so it could never pass. Narrowed to what
  the rule actually prohibits: `t` from `core/macro` (0 offenders) and unwrapping a
  literal at runtime, `i18n._(msg`…`)` (3 offenders, fixed — `i18n._(dynamicDescriptor)`
  from a lookup map, as in `workflows/ui/Builder/catalog.ts`, is legitimate and is
  deliberately not matched).
- **`localized-submodule-ui.test.ts`** had two bugs. `.test()` on a shared `/g`
  regex is stateful, so a match in one file made the next start mid-string and
  under-report. And the `>Label<` patterns match `<Trans>Edit</Trans>`, because
  that string *contains* `>Edit<` — so they flagged correctly-localized JSX, and
  the suite could only be satisfied by UNDOING the localization it exists to
  enforce. Fixed by resetting `lastIndex`, stripping `<Trans>…</Trans>` before
  scanning, and requiring non-whitespace content in the card-attribute pattern.
  One genuinely raw label (`CustomerHeader` "Tax Status") was localized. Mutation-
  tested: a raw `<span>Edit</span>` and a raw `<CardAttributeLabel>` are still caught.
- **The 20 deno failures** were the `SUPABASE_DB_URL` gate throwing. They now SKIP
  via `databaseTest` (`ignore: !hasLocalDatabase`) — a bare `deno test` is green on
  a clean checkout, which is the prerequisite for ever putting it in CI.

### Still blocking full CI adoption

`deno task test` typechecks and fails with **8 pre-existing type errors** (6 from
the kysely/deno-postgres `Pool` impedance in `lib/postgres/index.ts`, plus a TS2589
in `get-next-sequence.ts`). `packages/database/tsconfig.json` includes only `src`
and `supabase/functions/lib/postgres/**`, so **the rest of the edge-function tree —
all of the accounting posting logic — is typechecked by nothing in CI.** Running
the deno tests with `--no-check` gets the tests into CI today; closing the type gap
is separate work.

## CI wiring (2026-09-09)

Both suites now run on every PR.

- `apps/erp/package.json` gains `"test": "vitest run"`. `turbo run test` picks it up,
  so the existing `test` job in `.github/workflows/check.yml` gains **990 tests** with
  no infrastructure change (`pnpm test`: 28/28 tasks, was 27).
- New `edge-functions` job in `check.yml` — `denoland/setup-deno` then `deno task test`
  from `packages/database/supabase/functions`, covering **257 tests** (20 DB-backed ones
  skip). Deliberately NOT added to `turbo run test`, so `pnpm test` keeps working for
  anyone without Deno installed.
- `deno.json`'s `test` task is now `deno test --no-lock --no-check --allow-all`. It
  previously typechecked and failed on 8 pre-existing errors, so it could never have
  been used as a gate.
- `hasLocalDatabase` catches `PermissionDenied` as well as an absent variable, because
  it runs at module scope — without that, `deno test` with no permission flags died
  before a single pure test could run.

### CI-equivalent verification

| Job | Command | Result |
|---|---|---|
| Lint | `pnpm exec biome check` | 35/35 |
| Typecheck | `pnpm run typegen && pnpm run typecheck` | 31/31 |
| Lingui | `pnpm run lingui:check` | pass |
| Catalog | `pnpm run check:workflow-catalog` | ok |
| Test | `pnpm test` | 28/28, erp 990 passed |
| Edge Functions | `deno task test` | 257 passed, 0 failed, 20 ignored |

### Known limitation, deliberately accepted

The edge-function job runs `--no-check`. `packages/database/tsconfig.json` covers only
`src` and `supabase/functions/lib/postgres/**`, so the rest of that tree — including all
the accounting posting logic — is typechecked by **nothing**. `deno check` reports 8
pre-existing errors (6 kysely/deno-postgres `Pool` typings, 1 TS2589 in
`get-next-sequence.ts`). Getting the tests running was worth more than blocking on the
types; closing the type gap is the next follow-up.

The 20 DB-backed regressions still only run locally, via
`pnpm exec tsx scripts/run-local-accounting-check.ts`. Provisioning Postgres + migrations
in CI so they and the 5 SQL suites run is the remaining piece.
