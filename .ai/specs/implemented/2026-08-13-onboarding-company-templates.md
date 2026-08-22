# Onboarding Company Templates — one dataset engine, two stories

> Status: draft
> Author: aashu
> Date: 2026-08-13
> Research: [.ai/research/onboarding-templates.md](../research/onboarding-templates.md)

## TLDR

Make onboarding's "Use a demo template" actually populate a new company, and make the
dev seed and the onboarding templates run the **same code over the same data**. The
dev seed's 12 tiers become a runtime-agnostic dataset engine in `@carbon/database`;
the satellite data currently hardcoded inside those tiers moves into a
`satellite` dataset module; a new `robotics` dataset is authored alongside it. The dev
CLI and a new `company-template` Inngest job are two thin callers of the same
`applyDataset()`. No archives, no storage bucket, no build artifacts — adding a third
template later is data-only.

## Problem Statement

Two separate problems that share one root.

**1. The template branch is dead.** `apps/erp/app/routes/onboarding+/industry.tsx`
offers three choices — `template` / `import` / `none`. Only `import` does anything
distinct. At `industry.tsx:149-161` the action resolves a backup Blob **only** for
`import`; `template` therefore reaches `provisionCompanyData` with `backup: null` and
takes the `if (!backup)` clean-seed path (`onboarding.server.ts:45-52`), producing a
company byte-identical to `none`. The only durable trace of the choice is
`company.industryId`.

Around that dead branch sits ~80% of a finished feature: an `industry` catalog table
with three seeded rows, a private `company-templates` storage bucket
(`migrations/20260617100002_onboarding-and-backups.sql:14-35,61-62`), a
`templateIndustryId` parameter threaded through `company-import.ts:50,58,256,416` that
**no caller ever passes**, a `TEMPLATE_BUCKET` constant with zero runtime consumers
(`company-backup.ts:33`), and a manual upload script gated behind `workflow_dispatch`.
The committed `robotics_oem.carbon.json.gz` that would have fed it was deleted in
`d01f0357a`; `packages/database/supabase/backups/` contains only a README.

**2. There is one demo story and we need two.** `pnpm db:seed:dev` fills a company
with a small-satellite manufacturer ("Orbital Systems Inc.") across 12 tiers —
~6,823 lines under `packages/database/src/seed-dev/`. The data is **hardcoded TS
literals inline in each tier file** (`tiers/02-items.ts:22-40`, `tiers/04-sales.ts:141`,
…), so a second industry story cannot exist without copying all twelve files.

The constraint that ties them together: whatever we build, the demo data must live in
**exactly one place**, shared by dev seeding and customer onboarding.

## Proposed Solution

### Shape

Split the existing seed into an **engine** (insertion logic, tier ordering, id refs)
and **datasets** (pure data), then give the engine two callers.

```
packages/database/src/
├── seed-dev.ts                    # dev CLI: resolve/bootstrap company, wipe, applyDataset
└── datasets/                      # was src/seed-dev/
    ├── index.ts                   # applyDataset(), DATASETS registry, datasetForIndustry()
    ├── types.ts                   # Ctx, Tier, SeedRefs, Dataset, ItemRef
    ├── sql.ts                     # insert primitives (unchanged)
    ├── dates.ts                   # NEW — day-offset → calendar date resolution
    ├── bootstrap.ts               # dev-only: auth user + company (unchanged, dev caller only)
    ├── wipe.ts                    # dev-only (unchanged, dev caller only)
    ├── helpers/                   # items.ts, job-method.ts (unchanged)
    ├── tiers/01-foundation.ts …   # generic runners; read ctx.dataset.<slice>
    └── data/
        ├── satellite/             # Orbital Systems Inc. — extracted from today's tiers
        └── robotics/              # NEW — robotics OEM story
```

`bootstrap.ts` and `wipe.ts` stay dev-only and are called by `seed-dev.ts`, never by
the job. The engine's entry point is:

```typescript
// packages/database/src/datasets/index.ts
export async function applyDataset(
  client: PoolClient,
  opts: {
    companyId: string;
    userId: string;
    dataset: Dataset;
    timeZone: string;
    tiers?: number[] | null;
    log?: (message: string) => void;
    // Dev-only hook so the CLI's wipe runs inside the same transaction.
    beforeTiers?: (ctx: Ctx) => Promise<void>;
  }
): Promise<void>;
```

It does what `seed-dev.ts:43-71` does today minus bootstrap and wipe: `buildCtx` →
`BEGIN` → `SET LOCAL "app.sync_in_progress" = 'true'` → `ensureSequences` → run tiers
in order → `COMMIT`, rolling back on any throw.

### The `Dataset` type

Tier files keep every line of insertion logic and lose every data literal. A dataset
is a plain object of per-tier slices:

```typescript
// Superseded: the shipped key set is "satellite" | "robotics" | "precision" | "motor",
// and `companyName` was dropped as dead (see the remaining-industry-datasets spec).
export type DatasetKey = "satellite" | "robotics";

export type Dataset = {
  key: DatasetKey;
  label: string;                  // "Aerospace & Satellite"
  industryId: string | null;      // industry.id, or null for dev-only datasets
  companyName: string;            // "Orbital Systems Inc."
  foundation: FoundationData;     // departments, abilities, processes, work centers,
                                  // customers, suppliers, contacts, shipping, posting groups
  items: ItemsData;               // ItemSpec[] per category + BOM lines + BOP operations
  inventory: InventoryData;
  sales: SalesData;
  purchasing: PurchasingData;
  production: ProductionData;
  quality: QualityData;
  changeOrders: ChangeOrderData;
  accounting: AccountingData;
  workflows: WorkflowData;
  planning: PlanningData;
};
```

`Ctx` (`datasets/types.ts:46-54`) gains `dataset: Dataset` and `anchor: CalendarDate`.
`runTier4(ctx)` reads `ctx.dataset.sales` instead of a module-level `const`. The
per-tier slice types are the existing spec types (`ItemSpec`, `JobSpec`, …) lifted out
of the tier files verbatim, so the extraction is mechanical.

### Dates

Every absolute date literal (`orderDate: "2025-10-15"`, `dueDate: "2026-02-27"`,
`openDate: "2025-10-05"`, …) becomes a signed **day offset** from the moment the
dataset is applied:

```typescript
// datasets/dates.ts
export function resolveDate(anchor: CalendarDate, offsetDays: number): string; // "YYYY-MM-DD"
export function resolveTimestamp(anchor: CalendarDate, offsetDays: number, tz: string): string;
```

The anchor is `datetime.today(timeZone)` where `timeZone` comes from
`getCompanyTimeZone(db, companyId)` — per `.claude/rules/date-handling.md`, server code
must never call `getLocalTimeZone()`. Arithmetic is `CalendarDate.add({ days })` from
`@internationalized/date`; no JS `Date`.

Conversion is deterministic, not judgement: each literal's offset is
`literalDate − 2026-08-13`, computed once during the port. Every interval between two
dates (order → promised, released → due, RFQ → expiration) is preserved exactly, so no
invariant can drift.

### Applying at onboarding

A new Inngest task, modelled on `company-import`:

```typescript
// packages/jobs/src/inngest/functions/tasks/company-template.ts
// event: "carbon/company-template"
// data:  { companyId, userId, datasetKey, templateRunId }
// concurrency: { key: "event.data.companyId", limit: 1 }
```

It opens its own `getPostgresConnectionPool(2)` (the engine needs a `PoolClient` for
`BEGIN`/`SET LOCAL`, which the shared Kysely handle does not give), resolves the
company timezone, and calls `applyDataset`. Progress and failure are recorded on
`externalIntegrationMapping` with `integration = "company-template"` — the same marker
pattern `company-export` and `company-restore` already use, so the existing polling UI
conventions apply.

**Double-apply guard:** before `BEGIN`, the job refuses if the company already has any
`item` rows. A template is a one-shot on a fresh company; re-running it would duplicate
the whole catalog.

`provisionCompanyData` (`apps/erp/app/services/onboarding.server.ts:33-93`) gains a
third branch:

| Choice | Seed | Then |
|---|---|---|
| `none` | full clean `seedCompany` | — |
| `import` | `seedCompany({ identityOnly: true })` | unpack archive → `trigger("company-import")` |
| `template` | full clean `seedCompany` | `trigger("company-template", { datasetKey })` |

The template branch needs the **full** clean seed, not `identityOnly` — the tiers assume
a chart of accounts, `unitOfMeasure` code `EA`, and sequences already exist
(`buildCtx`, `datasets/types.ts:104-136`). The enqueue is awaited and failures throw
loudly, exactly as the import branch does today (`onboarding.server.ts:80-92`) — a
company left with a clean seed while onboarding reported "template applied" is the
failure mode that matters.

### Industry → dataset mapping

`industry.id` values are stable literal strings seeded by migration (`robotics_oem`,
`precision_manufacturing`, `automotive_precision`). The mapping is code, not schema:

```typescript
// packages/database/src/datasets/index.ts
export const DATASETS: Record<DatasetKey, Dataset> = { satellite, robotics };
export function datasetForIndustry(industryId: string | null): Dataset | null;
```

A new migration adds a fourth industry row for the satellite story
(`aerospace_satellite`, "Aerospace & Satellite"). Industries with **no** dataset
(`precision_manufacturing`, `automotive_precision`) keep working exactly as they do
today — they still record `industryId` and still provision a clean seed. No regression,
and the industry choice keeps capturing intent for the `featureRequests` /
`customIndustryDescription` columns.

### Dev CLI

`seed-dev.ts` gains `--dataset <satellite|robotics>` (default `satellite`) alongside
the existing `--email`, `--tiers`, `--skip-wipe`. Everything else about the dev flow —
bootstrap on unknown email, wipe-and-rebuild, summary print — is untouched, so
`crbn up` and `ensureSmokeTestUser` (`packages/dev/src/services/migrations.ts:298-338`)
keep working unchanged.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| How templates are applied | Run the shared tier code directly against the new company | `packages/jobs` already depends on `@carbon/database` and already opens a direct Postgres pool (`packages/jobs/src/db.ts:15`); `@carbon/database` already exports a file from inside the seed folder (`package.json:26`). Same runtime, no porting, no build artifact, no second representation of the data. |
| Rejected: seed → archive → import | No | Reuses the tested import pipeline, but the data would then exist in two forms and need periodic regeneration — the exact duplication this work exists to prevent. |
| Where the engine lives | `packages/database/src/datasets/` (renamed from `seed-dev/`) | The code no longer runs only in dev. `@carbon/database` is already a dependency of both `packages/jobs` and the dev CLI. |
| Refactor depth | Extract **all** data literals from all 12 tiers into dataset modules | A third template then costs data only, zero code. Chosen over parameterising tiers 1–2 alone, which would leave the robotics story thin from inventory downstream. |
| Satellite's industry | New `aerospace_satellite` industry row via migration | Honest labelling; mapping it onto `precision_manufacturing` would show a customer data that contradicts the industry they picked. |
| Dates | Day-offsets from apply time, resolved with `@internationalized/date` | A template applied in 2027 must not show 2025 orders. Offsets are computed mechanically from the existing literals, preserving every interval. |
| Timezone source | `getCompanyTimeZone(db, companyId)` | `.claude/rules/date-handling.md` bans `getLocalTimeZone()` in server paths; enforced by the `no-local-timezone` check in `@carbon/checks`. |
| Execution | Inngest job, fire-and-poll | Matches `company-import`, which onboarding already triggers and returns from. Keeps a multi-thousand-row insert out of the request cycle. |
| Transaction boundary | One transaction for the whole dataset | What the dev seed already does (`seed-dev.ts:46-71`). All-or-nothing: a half-applied demo company is worse than a clean one. |
| Industry→dataset mapping | Code map, not a schema column | `industry.id` values are stable literals; a column would need a migration per template and could drift from what the code can actually apply. |
| Visibility | Keep the internal-email gate | The step is already internal-only (`industry.tsx:87-105`, `_layout.tsx:46-53`). Prove the templates on internal signups first. |
| Industries without a dataset | Clean seed, as today | No regression, and the choice still captures intent. |
| Template assets (CAD, thumbnails) | Out of scope | Confirmed with the user: not using CAD files as template content for now. The `_templates` / `TEMPLATE_ASSET_PREFIX` plumbing stays dormant. |

## Data Model Changes

One migration, one row. No new tables.

```sql
-- Satellite/aerospace demo story needs an industry to attach to.
INSERT INTO "industry" ("id", "name", "description", "iconName", "sortOrder", "active")
VALUES (
  'aerospace_satellite',
  'Aerospace & Satellite',
  'Small-satellite and spacecraft subsystem manufacturing',
  'satellite',
  4,
  TRUE
)
ON CONFLICT ("id") DO NOTHING;
```

`industry` is a global catalog with no `companyId` and RLS allowing authenticated
SELECT only (`20260617100002_onboarding-and-backups.sql:14-41`) — the standard
company-scoped table template does not apply. Create the file with
`pnpm db:migrate:new add-aerospace-industry` and a non-`000000` HHMMSS.

`industry.tsx:71-75` maps only `bot` / `cog` / `wrench` to icons with an `LuFactory`
fallback; add a `satellite` entry so the new row renders correctly.

## API / Service Changes

- **`packages/database/src/datasets/index.ts`** (new) — `applyDataset()`, `DATASETS`,
  `datasetForIndustry()`, `DatasetKey`.
- **`packages/database/package.json`** — add `"./datasets": "./src/datasets/index.ts"`
  to `exports`. **Repoint the existing `"./seed-workflows"` subpath** from
  `./src/seed-dev/tiers/workflow-definitions.ts` to its new path — it has an external
  consumer and a silent break here is invisible until runtime.
- **`packages/lib/src/events.ts`** — add the `carbon/company-template` event with
  `{ companyId, userId, datasetKey, templateRunId }`.
- **`packages/jobs/src/inngest/functions/tasks/company-template.ts`** (new) — the task,
  registered in the functions barrel.
- **`apps/erp/app/services/onboarding.server.ts`** — `provisionCompanyData` and
  `provisionOnboardingCompany` take `template: DatasetKey | null` alongside `backup`.
- **`apps/erp/app/routes/onboarding+/industry.tsx`** — the action resolves the selected
  `industryId` through `datasetForIndustry` and passes the key down.

## UI Changes

Minimal — the three-way picker already exists and already collects the industry.

- `industry.tsx:230-250` — the `template` card's copy stops implying data appears
  instantly; it now describes an in-progress setup, matching the async job.
- `industry.tsx:71-75` — icon map gains `satellite`.
- Industry options that have no dataset render normally (no "coming soon" state) —
  they behave as they do today.

## Acceptance Criteria

- [ ] `pnpm db:seed:dev -- --email dev@carbon.ms --dataset satellite` produces the same
      company contents as the current seed: `printSummary` row counts match the
      pre-change run across all 27 reported tables.
- [ ] `pnpm db:seed:dev -- --email dev@carbon.ms --dataset robotics` produces a robotics
      company: every ERP list screen has rows and every detail screen opens, with
      robotics item ids and no `SAT-`/`BUS-`/`EPS-` prefixes present.
- [ ] Omitting `--dataset` still seeds satellite, and `crbn up` still bootstraps
      `test@carbon.ms` with no flag change.
- [ ] Signing up with an internal email, choosing "Use a demo template" + "Robotics",
      and completing onboarding produces a company whose Parts list is non-empty within
      one minute, with a `company-template` marker on `externalIntegrationMapping` that
      clears on success.
- [ ] The same flow with "Aerospace & Satellite" produces the satellite catalog.
- [ ] Choosing "Precision Manufacturing" (no dataset) produces exactly the same company
      as choosing "I don't need data" — a clean seed, no error, no marker.
- [ ] A company seeded today shows its most recent sales order dated within the last
      30 days; re-running the same dataset a week later shifts that date forward by
      seven days.
- [ ] Ordering invariants survive the date port: for every seeded sales order,
      `orderDate <= promisedDate`; for every job, `releasedDate <= dueDate`.
- [ ] Triggering `company-template` against a company that already has `item` rows is an
      idempotent no-op: it writes no rows, clears the marker and returns
      `{ skipped: true, alreadyApplied }`. It must NOT fail, or onboarding re-entry and a
      retry whose first attempt already committed would both be recorded as broken.
- [ ] Forcing a mid-tier throw leaves the company with zero dataset rows (transaction
      rolled back) and a `failed` marker.
- [ ] `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/jobs`
      passes; `pnpm exec biome check` reports no new errors; `pnpm run test` passes.
- [ ] `.claude/rules/company-backup-restore.md` ("Onboarding seed" section) and
      `packages/database/supabase/backups/README.md` describe the implemented behaviour;
      `packages/database/AGENTS.md` ("Dev Seed") points at `src/datasets/`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Mechanical extraction of ~6.8k lines silently drops or alters satellite data | High | Capture `printSummary` counts before the refactor and diff after; the satellite dataset must produce identical counts. Extract tier-by-tier, running the seed after each. |
| Long single transaction exceeds an Inngest step's limit | Med | Run the whole apply inside one `step.run` and measure wall-clock on a real dataset first. If it does not fit, split by tier with per-tier savepoints rather than abandoning atomicity. |
| Seed code was written for dev and now runs against customer databases | Med | Replace `console.log` with the job logger, guard double-apply, keep the rollback path, and keep the internal-only gate until it has run on real signups. |
| `"./seed-workflows"` export path breaks on the directory rename | Med | Repoint the subpath in the same commit; it is an explicit acceptance item. |
| Date-offset port breaks an ordering invariant | Med | Offsets are derived arithmetically from the existing literals, so intervals cannot change; the invariant assertions above are explicit acceptance criteria. |
| Robotics dataset is authored content and may be shallow or implausible | Low | Mirror the satellite dataset's shape tier-for-tier — the row counts are the coverage contract. |
| `templateIndustryId` in `company-import` stays dead | Low | Documented as dormant here; deleting it is a separate cleanup, not this change. |

## Open Questions

> All resolved with the user before this spec was written.

- [x] How should a template be produced and applied? — **Answer:** Direct insert. Run
      the shared tier code against the new company via an Inngest job. Initially
      recommended seed→archive→import to reuse the tested import pipeline; the user
      pushed back, and verification showed the assumed blocker (cross-runtime porting)
      does not exist — `packages/jobs` already has `@carbon/database` and a direct
      Postgres pool. Direct insert wins on the single-source-of-truth constraint.
- [x] Where does the existing satellite dataset fit against the `industry` catalog? —
      **Answer:** Add a new `aerospace_satellite` industry row; robotics maps to the
      existing `robotics_oem`. Two templates ship; the other two industries are
      unchanged.
- [x] How far should the 12 tiers be refactored? — **Answer:** Extract all data
      literals into per-dataset modules so a third template is data-only.
- [x] Who sees the template picker? — **Answer:** Keep the existing internal-email
      gate for now.
- [x] Do dates need re-basing? — **Answer:** Yes — day-offsets resolved at apply time.
      Raised after discovering the seed's dates are absolute literals, so direct insert
      alone would not have produced fresh data (correcting an earlier claim of mine).
- [x] Do templates carry CAD files / storage assets? — **Answer:** No, out of scope for
      now (user).

## Changelog

- 2026-08-13: Created. Architecture decided as direct insert after the archive-based
  approach was rejected on the single-source-of-truth constraint.
