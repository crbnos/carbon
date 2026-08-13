paths:
  - "packages/database/src/datasets/**"
  - "packages/jobs/src/inngest/functions/tasks/company-template.ts"
  - "apps/erp/app/routes/onboarding+/industry.tsx"
  - "apps/erp/app/services/onboarding.server.ts"

# Onboarding Company Templates

Onboarding's third data choice — "Use a demo template" — fills a brand-new company with a
full industry story: items, BOMs, customers, quotes, orders, jobs, non-conformances,
change orders, ledger entries, workflows. The same data and the same insertion code back
`pnpm db:seed:dev`. **There is exactly one copy of both.**

Grounded against `packages/database/src/datasets/`,
`packages/jobs/src/inngest/functions/tasks/company-template.ts`,
`apps/erp/app/services/onboarding.server.ts`, and `apps/erp/app/routes/onboarding+/industry.tsx`.

## The shape of it

A **dataset** is data only — plain TypeScript literals, no SQL, no ids. It is a `Dataset`
object (`packages/database/src/datasets/types.ts`) with eleven slices: `foundation`,
`items`, `inventory`, `sales`, `purchasing`, `production`, `quality`, `changeOrders`,
`accounting`, `workflows`, `planning`. Each slice lives in its own file under
`data/<key>/`, and `data/<key>/index.ts` assembles them.

The **tiers** are the engine — `tiers/01-foundation.ts` … `tiers/12-planning.ts`, run in
numeric order. The ordering IS the contract: tier 4 can only build a sales order because
tier 2 already created the item and put its id in `ctx.refs`. Tiers read the dataset and
know nothing about which industry they are inserting.

`applyDataset()` in `datasets/index.ts` is the single entry point both callers use:

```typescript
await applyDataset(pgClient, { companyId, userId, dataset, timeZone, tiers?, log?, beforeTiers? });
```

It resolves today in the company's timezone, builds the context, opens ONE transaction,
sets `app.sync_in_progress`, ensures sequences, runs the selected tiers in order, and
commits — or rolls the whole thing back. A half-seeded company is not a possible outcome.

`beforeTiers` exists for one reason: the dev CLI's wipe has to run inside that same
transaction. Nothing else should use it.

## Two callers, one code path

**Dev CLI** — `packages/database/src/seed-dev.ts`. Bootstraps a user + company if the
email is unknown, wipes the company's business data, then calls `applyDataset`.

```bash
pnpm db:seed:dev -- --email you@example.com --dataset satellite
```

`--tiers 1,2,3` and `--skip-wipe` are dev-only conveniences. `bootstrap.ts` and `wipe.ts`
are dev-only and are never reachable from onboarding.

**Onboarding** — the browser flow. `industry.tsx` maps the chosen industry to a dataset
key with `datasetForIndustry(companyData.industryId)`, passes it to
`provisionOnboardingCompany` as `template`, and that function fires the
`carbon/company-template` event as its **last** step. Last is deliberate: the tiers need
the Headquarters location row, which `upsertLocation` creates further up the function.
Enqueuing earlier is a race.

`companyTemplateFunction` (`packages/jobs/.../tasks/company-template.ts`) handles the
event, `concurrency: { key: "event.data.companyId", limit: 1 }` so one company can never
apply two templates at once, and calls the same `applyDataset`. It runs in Node inside
`@carbon/jobs` — **not** in a Supabase edge function, and it does not go through an
archive, an upload, or an import.

### Progress and failure

The job writes a marker row in `externalIntegrationMapping` with
`integration = "company-template"` and clears it on success. So:

- no marker, data present → applied
- marker with `status: "running"` → in flight
- marker with `status: "failed"` + `error` → it did not land, and the error says why

An empty company on its own cannot tell you which of those happened; that is what the
marker is for.

Two guards refuse rather than corrupt: an unknown `datasetKey`, and a company that
already has `item` rows (re-applying would duplicate the entire catalog).

## Dates are offsets, never literals

Every date in a dataset is a `DayOffset` — a signed number of days from the moment the
dataset is applied — resolved by `resolveDate` / `resolveTimestamp` in `datasets/dates.ts`
against `ctx.anchor` (today in the company's timezone). A template seeded next year shows
orders from last month, not from 2025. The satellite offsets were derived against a
reference date of 2026-08-13, so every interval between two dates is preserved exactly.

`previousMonthEnd(anchor)` is the one exception-shaped helper: the depreciation period end
must land on a real month end, so it is derived rather than offset.

Never use JavaScript `Date` here, and never `CURRENT_DATE` in a tier's SQL — the anchor is
the company's day, the database session's is UTC, and the two disagree for a slice of every
day. Note there is NO automated guard: `@carbon/checks` scans `apps/mes/app/services`,
`packages/jobs/src`, `packages/database/supabase/functions` and the ERP module/route files,
none of which covers `packages/database/src/**`. This is convention only.

## Adding an industry

1. `data/<key>/` — one file per slice, mirroring `data/robotics/` (the newest and closest
   model). All eleven slices are required; none may be empty.
2. Register it in `DATASETS` in `datasets/index.ts`.
3. Add `"<key>"` to `DatasetKey` in `types.ts`.
4. Set `industryId` on the dataset to the matching `industry` row id, and add that row in
   a migration if it does not exist yet (`aerospace_satellite` was added by
   `20260813023744_add-aerospace-industry.sql`; the other three shipped in
   `20260617100002_onboarding-and-backups.sql`).

Volume is the coverage contract: match the existing datasets' row counts roughly, so every
list screen in the ERP has rows and every detail screen opens.

All four industries have a dataset today. An industry without one is **hidden** from the
onboarding picker (`industry.tsx` filters on `datasetForIndustry`) rather than silently
provisioning a clean company — a card promising sample data that delivers none is worse
than no card.

## Verifying a change to the tiers

The tiers are shared, so a refactor that "looks fine" can silently drop rows. Seed, then
diff the printed `Seeded row counts` block against a known-good run, and check the
structural sums that counts alone would not catch (`methodMaterial` count + quantity sum,
`methodOperation` count + time sums, `salesOrderLine` count + quantity sum). Baselines
live in `.ai/runs/2026-08-13-seed-baseline.txt` (satellite, with structural sums in the
sibling `-structural.txt`), plus `-robotics-`, `-precision-` and `-motor-baseline.txt`.

## What is NOT how this works

There is no archive, no `.carbon.json.gz`, no `company-templates` storage bucket in this
path — that was an earlier unfinished design. `packages/database/supabase/backups/` is
unused; its README lists the dormant code left behind. Backup export/restore for real
customer companies is a separate feature and is unaffected.

## Local development note

The dev CLI path needs only Postgres, so it works whenever your local database is up. The
browser onboarding flow additionally calls the `seed-company` **edge function** (for the
chart of accounts and other reference data) before the template step ever runs — so if the
local edge runtime is unhealthy, onboarding fails before reaching any of this, and the CLI
remains the way to exercise a dataset.
