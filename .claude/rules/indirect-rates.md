---
paths:
  - "packages/ee/src/indirect-rates/**"
  - "packages/server-functions/src/post-project-burden/**"
  - "packages/jobs/src/inngest/functions/tasks/indirect-rates.ts"
  - "apps/erp/app/modules/accounting/ui/IndirectRates/**"
  - "apps/erp/app/routes/x+/accounting+/indirect-*.tsx"
---

# Indirect rates and burden (Government Contracting Phase 5b)

Fringe, overhead, material handling and G&A pools, their rates, the burden they
put on projects, and burden billing on Cost Plus lines, as Costpoint does them.
Spec `.ai/specs/2026-10-09-government-contracting.md` (Phase 5b); plan
`.ai/plans/2026-10-09-government-contracting-phase-5b.md` (decisions B1–B15 and
an *Execution notes* entry for every deviation). Phase 5a (cost objectives,
unallowable cost, timekeeping) is in `government-contracting.md`.

## Commercial, and where the code lives (B1)

Feature `GOVERNMENT_CONTRACTING` (Business, Partner). The engine is ee code:

| Module | What it holds |
|---|---|
| `@carbon/ee/indirect-rates` (`index.ts`) | Client-safe: validators and enum lists (`models.ts`), the pure rate, burden and billing engine (`compute.ts`), the pure ICE builders (`ice.ts`), row types |
| `@carbon/ee/indirect-rates.server` (`server.ts`) | Authoring (`upsertIndirectPool`, `setIndirectRate`, ceilings, `updateBurdenSettings`), the runs and the readers (`service.server.ts`), `buildIceSchedule` (`ice.server.ts`) |
| `post-project-burden` (community server function) | Writes the Burden rows and the optional applied burden journal in one transaction |

Every authoring function and every run calls `requireEntitlement` first. The
readers do not. The monthly job degrades with `companyHasFeature`. A server
function cannot import `@carbon/ee`, so the ee run computes the rows and calls
`post-project-burden` through `serverFns`.

UI: Accounting → **Indirect Pools** (Configure) and **Indirect Rates** (Closing),
`IndirectRatesUpgradeOverlay` for a gated company; the rate ceilings on a Cost
Plus line's Billing tab (`ContractRateCeilings.ee.tsx`); burden by pool on the
project Costs tab (`ProjectBurdenByPool.ee.tsx`).

## The run order

`runIndirectRatePeriod` runs 3 steps for one accounting period. The first error
stops the run and is written to `indirectRateRun.error`:

1. `computeIndirectRates` — the YTD Actual rate of every active pool, in
   `sequence` order, the Statement of Indirect Expenses
   (`indirectExpenseStatement`) and the `indirectRateRun` row. It writes no
   journal, so any period state is accepted.
2. `computeProjectBurden` — the burden catch-up, posted through
   `post-project-burden`. Needs a **Locked** period (B10).
3. `computeBurdenBilling` — burden billable items on Cost Plus lines.

`runFinalTrueUp` runs steps 2 and 3 at the Final rate of period 12 of a fiscal
year, posted into a Locked period that may sit in the next year. The lock of a
period sends `carbon/indirect-rates.compute` (`periods.$periodId.close.tsx`);
the `indirect-rates` job skips a company without the feature or with no active
pool that applies to projects. The close task "Compute burden for the period"
(`burden-computed`, `burdenComputedCheck`) passes when the period has a run
with `burdenComputedAt`, or when the check does not apply.

## Rates: 2 base sources and the cascade (B2, B3, B4)

A pool's base has 2 sources:

- GL accounts mapped as **Base** (`indirectPoolAccount.role`);
- project ledger cost of projects with cost objective Direct, Commercial, IR&D
  or B&P, by bucket (`PROJECT_BASE_BUCKETS`, `BASE_TYPE_BUCKETS`). A G&A pool
  leaves IR&D and B&P out of its base.

Carbon posts every project's labor and material to one WIP or expense account,
so the GL alone cannot give direct labor dollars. `upsertIndirectPoolAccount`
refuses a Base mapping of `projectExpenseAccount` or
`projectWorkInProgressAccount`.

A journal line matches the most specific mapping: its account plus a dimension
value it carries, else the account alone. One cell is Cost of at most one pool
(`indirectPoolAccount_cost_key`); a cell may be Base of several.

The cascade carries burden 3 ways:

1. Pool Q's rate × a GL cell that is Q's Base and P's Cost goes into P's cost
   (fringe on indirect labor goes into overhead).
2. Q's burden on IR&D and B&P project cost goes into the next G&A pool's cost.
3. A Total Cost Input base takes every earlier pool's burden; a Value Added base
   takes every earlier pool's burden except Material Handling. Single-element
   bases take none. Only pools that apply to projects carry burden into a base.

Unallowable cost leaves the numerator (it shows in its own column) and stays in
the base (CAS 405-40(e)). The GL readers count journals with status Posted or
Reversed (`GL_JOURNAL_STATUSES`).

Users enter Provisional, Target and Final rates "from period N": `setIndirectRate`
writes periods N to 12 with `periodRate = ytdRate` (B12). It refuses Actual.

## Burden: the catch-up key (B8)

Burden is computed per element. The catch-up key is project × element × pool ×
unallowable flag: the target (YTD base × rate) less the Burden rows already
posted for that key. Burden on an unallowable base is an unallowable row. An
element with posted burden and no cost catches up to zero.

Burden rows are `projectLedger` rows with `costType = 'Burden'`,
`indirectPoolId`, `indirectRateType` and `burdenFiscalYear`. The Final true-up
can post after the year ends, so the year never comes from `postingDate`.
`companySettings.burdenRateType` (Provisional or Actual, default Provisional)
picks the rate.

## Memo rows or applied burden (B10, B13)

Burden rows are memo rows by default: no journal, because the GL already holds
the pool cost. With `companySettings.postAppliedBurden`, `post-project-burden`
writes a journal for Contract projects: Dr the project account / Cr the pool's
applied account, signed by account class. The journal follows
`journalPostingStatus` (Provisional before the accounting cutover, Posted in the
given period after it). It is an accounting adjustment: a Locked period accepts
it, a Closed one refuses it.

Memo rows stay out of project cost relief with no code: Phase 4b relieves only
ledger rows whose journal debit line is on an Asset account. Applied burden is
relieved with the rest of the cost.

## Billing by difference (B5, B6)

A Burden row creates no billable item: `generateCostPlusItems` skips it and the
Time & Materials pricer returns null for it. `computeBurdenBilling` bills burden
per Cost Plus line × pool × fiscal year by difference:

    target = billable base × billing rate × (1 + fee %) − every burden item already created

The billing rate is the Final rate when one exists, else the Provisional rate,
capped by the line's ceiling (`customerContractRateCeiling`). One rule covers
first billing, re-burden and the true-up, and never touches a posted invoice.
A burden item has no `projectLedgerId` (nullable since 5b) and carries
`indirectPoolId`, `fiscalYear`, `burdenRate`, `burdenBase` and `postingDate`.
The billing readers left-join `projectLedger` and date an item by
`COALESCE(pl."postingDate", b."postingDate")`.

## Absorbed overhead (B7)

`offsetAbsorbedOverhead` (Overhead pools only): the rate uses the gross pool
cost. A project's target burden on that pool = max(0, rate × base − the
project's YTD Overhead ledger rows). The statement shows the absorbed overhead
as an `'Absorbed Overhead'` credit line on `accountDefault.overheadAbsorptionAccount`;
it never reduces the numerator and is never claimed.

## The ICE export (B15)

`buildIceSchedule` builds Schedules A, B, C, E, G, H, I, K and L at export time
from the same readers as the run; `api+/indirect-rates.ice[.]csv.ts` serves one
CSV (402 without the feature). Schedule G reconciles the project ledger to the
journal lines behind it. The claimed rate of a year is the Final rate of period
12, else the Actual rate of the last computed period.

## Gotchas

- `@carbon/ee/indirect-rates` must stay client-safe: `types.ts` derives its
  types from `@carbon/database`, never from `service.server.ts`.
- The statement has 2 foreign keys to `indirectPool`, so its reader reads pool
  names separately; an embed of the pool is ambiguous.
- When `accountingPeriod.fiscalYear` or `periodNumber` is null, the loaders
  derive them with `fiscalYearAndPeriodFor` (B14).
- The demo datasets seed pools and Provisional and Target rates in satellite
  only (`seedIndirectPools`, tier 09), with no Burden rows and no Actual rates.
