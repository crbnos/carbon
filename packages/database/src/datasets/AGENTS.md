# datasets — industry demo data + the engine that inserts it

Fills a company with one industry's worth of a working ERP + MES: items, BOMs, customers,
quotes, orders, returns, jobs, picking, inspections, non-conformances, gauges, change orders,
maintenance, training, timecards, posted journals, payments, accounting periods, workflows and
their run history — every user-reachable status of the major documents included. Two callers
share every line of it — `pnpm db:seed:dev` and onboarding's `company-template` Inngest job.

Four datasets ship today, one per onboarding industry: `satellite` (Orbital Systems, Houston
TX), `robotics` (Helix Robotics, Pittsburgh PA), `precision` (Meridian Precision Works,
Rockford IL) and `motor` (Torque Dynamics, Fort Wayne IN).

Feature-level context (how onboarding reaches this, the two wipes, posted-document
conventions, the drift check, adding an industry) lives in
`.claude/rules/onboarding-company-templates.md`. This file is about the code shape.

## Layers, and the boundary matters

| Layer | Where | What it may contain |
|-------|-------|---------------------|
| **Data** | `data/<key>/` | Plain TypeScript literals. No SQL, no ids, no `Date`. One file per slice (twelve: `foundation`, `items`, `inventory`, `sales`, `purchasing`, `production` + `assembly.ts`, `quality`, `change-orders`, `accounting`, `ops`, `workflows`, `planning`); `index.ts` assembles them into a `Dataset`. |
| **Art** | `assets/<industryId>/<readableId>.svg` | One vector thumbnail per item, keyed on the dataset's `industryId` and the item's `readableId`. |
| **Engine** | `tiers/01-…` … `tiers/12-…`, `sql.ts`, `dates.ts`, `helpers/` | Insertion logic. Industry-agnostic — a tier reads `ctx.dataset.<slice>` and knows nothing about which industry it is inserting. |
| **Checks** | `validate.ts` (+ `validate.test.ts`), `coverage.ts`, `verify.ts` | Pure consistency validator; row-count floors; the apply-and-roll-back drift check. |

`helpers/`: `items.ts` (`createItem`, `addBomLine`, material classification), `job-method.ts`
(`copyMethodToJob` — the seed's narrower copy of `get-method`'s `itemToJob`),
`inspection.ts` (pure sampling-plan / sample-status math shared by tier 07 AND the validator,
so seeded sample statuses equal what the engine derives) and `bootstrap-lookup.ts`
(`bootstrapIdByName` — a bootstrap lookup row by name, cached in `ctx.refs.misc`, never module
scope, which would leak across the drift check's four scratch companies).

## Part thumbnails are bundled, not uploaded

`createItem` writes `item.thumbnailPath = "_templates/<industryId>/<readableId>.svg"`, and
`assets.ts` (exported as `@carbon/database/dataset-assets`) resolves that prefix to the
bundled asset via `import.meta.glob`. Both apps' `getPrivateUrl` call it first and fall back
to the storage proxy for everything else, so a demo thumbnail is never a storage object and
the `_templates/` prefix is never served by `file+/preview+/$bucket.$.tsx`.

Adding an item to a dataset means adding its SVG. A missing one is not fatal:
`getDatasetAssetUrl` returns `null` and `ItemThumbnail` renders the type icon. A dataset with
`industryId: null` gets `null` and keeps the icon for every item.

`assets.ts` needs a bundler — never import it from a tier, `seed-dev.ts`, or `@carbon/jobs`,
which run under plain Node/tsx where the glob is never transformed and `import.meta.glob` is
undefined. It IS safe in `path.ts` (a loader/action graph module) because vite treats linked
workspace packages as non-external and so bundles it, transforming the glob at build time —
the literal asset map is in both apps' `build/server/index.js`. Adding `@carbon/database` to
`ssr.external` in either app's `vite.config.ts` would break that and crash the server on boot.
(`validate.ts` reads `graph.json` sidecars with `node:fs` for the same reason.)

New content goes in `data/`. Touch a tier only to support a new *shape* of data. The one
standing violation is `tiers/workflow-definitions.ts`, which re-exports satellite's workflows
so `@carbon/database/seed-workflows` stays a single import. It also exports
`SEED_WORKFLOW_BUILDERS`, so `packages/ee/src/workflows/seed-workflows.test.ts` validates all
four datasets' definitions — add a new dataset's builder there or its workflows go unchecked.

## `applyDataset` is the only entry point

```typescript
await applyDataset(pgClient, { companyId, userId, dataset, timeZone, tiers?, log?, onProgress?, wipeFirst? });
```

Resolves the anchor, builds `ctx`, opens ONE transaction, sets `app.sync_in_progress`, ensures
sequences, optionally wipes (`wipeFirst`), runs the tiers in order, commits — or rolls
everything back. A half-seeded company is not a reachable state. `tiers` is dev-only;
`onProgress` feeds the template job's progress UI and must not touch the client.
`applyDatasetTiers` is the same run WITHOUT the transaction, for `verify.ts` to roll back.

`bootstrap.ts` and `cli.ts` are dev tooling (`src/seed-dev.ts`, and the drift check:
`verify.ts` uses `seedCompanyReferenceData`, `check-datasets.ts` uses `loadEnv`); neither is
reachable from the `./datasets` export graph. Keep it that way — `bootstrap.ts` contains a
hardcoded dev password. `wipe.ts` IS in that graph (imported by `index.ts`) but not exported:
`wipeFirst` is the only way in.

## Tier order IS the contract

Tiers run in numeric order because each publishes ids the later ones read out of `ctx.refs`.
Tier 4 can build a sales order only because tier 2 already created the item. Reordering them,
or adding a tier that reads a ref an earlier tier didn't write, breaks.

`ctx.refs` is keyed by convention, and the prefixes are load-bearing:

| Prefix | Holds |
|--------|-------|
| `refs.items[readableId]` | `ItemRef` — id, name, type, unitOfMeasureCode, unitCost |
| `refs.documents[ref]` | Any seeded document id, under the `ref` its spec declares (`quote:novasat`, `job:in-progress`, `so:polar`); plus `poline:<poRef>:<item>`, `rline:<receiptRef>:<item>`, `memo:<key>` |
| `refs.misc["sp:<supplier>:<process>"]` | supplierProcess |
| `refs.misc["cloc:<customer>"]` / `["sloc:<supplier>"]` | customer / supplier location |
| `refs.misc["sinv:<key>"]` / `["pinv:<key>"]` | keyed sales / purchase invoices the payments settle |
| `refs.misc["te:<readableId>"]` | a seeded lot / serial (trackedEntity) |
| `refs.misc["pterm:"/"ctype:"/"stype:"/"nqr:"/"mat*:"…]` | bootstrap or foundation lookups by name (payment term, customer/supplier type, no-quote reason, material taxonomy) |
| `refs.misc["procedure:<name>"]`, `["period:weekN"]`, `["sqlink:<key>"]` | as named |

Use `need(map, key)` from `sql.ts` rather than `map[key]!` or a `continue` — node-postgres turns
an `undefined` parameter into `NULL`, so a missing ref writes a null FK instead of failing, and a
silent `continue` drops the row entirely. Every tier resolves authored refs through `need()`
now; the former silent skips in tiers 01/03/04/06/09/12 throw a named `Seed:` error.

## Rules that are not optional

- **No JavaScript `Date`, and no `CURRENT_DATE` in a tier's SQL.** Every date is a signed
  `DayOffset` resolved against `ctx.anchor` (today in the *company's* timezone) via `dates.ts`
  (`resolveDate`, `resolveTimestamp`, `previousMonthEnd`, `monthBack`). The database session's
  date is UTC and disagrees with the anchor for part of every day. The validator bounds offset
  values (planning horizon, `NOT_CLOSED_MIN_OFFSET` / `OPEN_PERIOD_MIN_OFFSET` against the
  seeded Closed/Locked periods, chronology), but nothing scans for `Date` usage —
  `@carbon/checks` does not cover `packages/database/src/**`.
- **Posted states carry their downstream rows**, authored in the same tier in the shape the
  posting function writes them (`itemLedger` entry/document types, `invoiceSettlement`,
  tracked entities). Details in the rule file.
- **Never write a literal primary key.** `externalLink` and `period` are keyed on `id` alone, so
  a fixed literal collides on the second company seeded into the same database. Let the column
  default mint it and read it back with `insertId`.
- **`account` is scoped by `companyGroupId`**, not `companyId` — as are `dimension` /
  `dimensionValue`. The client bypasses RLS, so an unscoped `LIMIT 1` reaches into another
  tenant's rows.
- **Never write the global `exchangeRate` table** — company rates go to `exchangeRateOverride`.
- **Every query gets a tenancy predicate**, even when the id it pins is globally unique. RLS is
  off here; the predicate is the only boundary left.
- **`period` is global** — no `companyId`, no unique key. Tier 12 takes `pg_advisory_xact_lock`
  before its read-then-insert; two companies onboarding at once would otherwise both insert the
  same 48 weeks, visible to every tenant.
- **Shelves are declared, not generated.** `FoundationData.shelves` lists every storage unit by
  name, in an order where a parent precedes its children, and `openingStock[].shelf` joins on
  that name. A name with no matching `ShelfSpec` is a hard error.

## Verifying a change

```bash
pnpm --filter @carbon/database test        # validate.test.ts: every dataset → [] + negative cases
pnpm --silent db:check:datasets            # pure validator, then apply + floors + rollback, ×4
pnpm db:seed:dev -- --email you@example.com --dataset satellite
```

`db:check:datasets` runs `validateDataset` first with no database (it still blocks when the
stack is down), then applies each dataset to a scratch company, asserts the `COVERAGE_FLOORS`
row counts, and rolls back. On failure it prints the violation list or the error plus the last
12 tier log lines.

After a real seed, diff the printed `Seeded row counts` block against
`.ai/runs/2026-09-23-seed-baseline-<key>.txt`, and check the structural sums counts alone miss
(`.ai/runs/2026-09-23-seed-baseline-satellite-structural.txt`, queries included). Changed a
status? Compare with `.ai/runs/2026-09-23-demo-data-status-audit.txt` and the `REQUIRED_*`
sets in `validate.ts`. Added or removed rows on purpose? Update `coverage.ts` in the same
change. `--tiers 1,2,3` and `--skip-wipe` are dev-only conveniences.

Note `journal` / `journalLine` survive the wipe: tier 9 adopts an entry whose `journalEntryId`
already exists and skips it, so a re-seed will NOT correct a journal you just fixed in the
data, and a second dataset applied over the first keeps the first one's journal text. Delete
the rows first.

## Known rough edges

- `04-sales.ts` / `05-purchasing.ts` key their order-line maps by item, so two lines for the same
  item collapse to the last one — a shipment or invoice line would attach to the wrong order line.
  Key on the line's `ref` if a dataset ever needs that.
- `sql.ts`'s `columnCache` is module-global and never invalidated. Harmless in the short-lived
  CLI; in the long-running Inngest worker a deploy that adds a column needs a restart.
