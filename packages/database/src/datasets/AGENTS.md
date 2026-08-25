# datasets — industry demo data + the engine that inserts it

Fills a company with one industry's worth of a working ERP: items, BOMs, customers, quotes,
orders, jobs, non-conformances, change orders, ledger entries, workflows. Two callers share
every line of it — `pnpm db:seed:dev` and onboarding's `company-template` Inngest job.

Four datasets ship today, one per onboarding industry: `satellite` (Orbital Systems, Houston
TX), `robotics` (Helix Robotics, Pittsburgh PA), `precision` (Meridian Precision Works,
Rockford IL) and `motor` (Torque Dynamics, Fort Wayne IN).

Feature-level context (how onboarding reaches this, the failure marker, adding an industry)
lives in `.claude/rules/onboarding-company-templates.md`. This file is about the code shape.

## Two layers, and the boundary matters

| Layer | Where | What it may contain |
|-------|-------|---------------------|
| **Data** | `data/<key>/` | Plain TypeScript literals. No SQL, no ids, no `Date`. One file per slice; `index.ts` assembles them into a `Dataset`. |
| **Art** | `assets/<industryId>/<readableId>.svg` | One vector thumbnail per item, keyed on the dataset's `industryId` and the item's `readableId`. |
| **Engine** | `tiers/01-…` … `tiers/12-…`, `sql.ts`, `helpers/` | Insertion logic. Industry-agnostic — a tier reads `ctx.dataset.<slice>` and knows nothing about which industry it is inserting. |

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

New content goes in `data/`. Touch a tier only to support a new *shape* of data. The one
standing violation is `tiers/workflow-definitions.ts`, which re-exports satellite's workflows
so `@carbon/database/seed-workflows` stays a single import. It also exports
`SEED_WORKFLOW_BUILDERS`, so `seed-workflows.test.ts` validates all four datasets' definitions
— add a new dataset's builder there or its workflows go unchecked.

## `applyDataset` is the only entry point

```typescript
await applyDataset(pgClient, { companyId, userId, dataset, timeZone, tiers?, log?, beforeTiers? });
```

Resolves the anchor, builds `ctx`, opens ONE transaction, sets `app.sync_in_progress`, ensures
sequences, runs the tiers in order, commits — or rolls everything back. A half-seeded company
is not a reachable state. `tiers` and `beforeTiers` are dev-only (`beforeTiers` exists solely so
the CLI's wipe shares the transaction); the job passes neither.

`bootstrap.ts`, `wipe.ts` and `cli.ts` are imported only by `src/seed-dev.ts` and are
unreachable from the `./datasets` export graph. Keep it that way — `bootstrap.ts` contains a
hardcoded dev password.

## Tier order IS the contract

Tiers run in numeric order because each publishes ids the later ones read out of `ctx.refs`.
Tier 4 can build a sales order only because tier 2 already created the item. Reordering them,
or adding a tier that reads a ref an earlier tier didn't write, breaks silently.

`ctx.refs` is keyed by convention, and the prefixes are load-bearing:

| Prefix | Holds |
|--------|-------|
| `refs.items[readableId]` | `ItemRef` — id, name, type, unitOfMeasureCode, unitCost |
| `refs.documents[ref]` | Any seeded document id, under the `ref` its spec declares (`quote:novasat`, `job:in-progress`, `so:polar`) |
| `refs.misc["sp:<supplier>:<process>"]` | supplierProcess |
| `refs.misc["cloc:<customer>"]` / `["sloc:<supplier>"]` | customer / supplier location |
| `refs.misc["procedure:<name>"]`, `["period:weekN"]`, `["sqlink:<key>"]` | as named |

Use `need(map, key)` from `sql.ts` rather than `map[key]!` or a `continue` — node-postgres turns
an `undefined` parameter into `NULL`, so a missing ref writes a null FK instead of failing, and a
silent `continue` drops the row entirely. Tiers 2/3/4/5/6/12 do this; tier 1 still has non-null
assertions in places.

## Rules that are not optional

- **No JavaScript `Date`, and no `CURRENT_DATE` in a tier's SQL.** Every date is a signed
  `DayOffset` resolved against `ctx.anchor` (today in the *company's* timezone) via `dates.ts`.
  The database session's date is UTC and disagrees with the anchor for part of every day.
  Nothing enforces this — `@carbon/checks` does not scan `packages/database/src/**`.
- **Never write a literal primary key.** `externalLink` and `period` are keyed on `id` alone, so
  a fixed literal collides on the second company seeded into the same database. Let the column
  default mint it and read it back with `insertId`.
- **`account` is scoped by `companyGroupId`**, not `companyId`. The client bypasses RLS, so an
  unscoped `LIMIT 1` reaches into another tenant's chart of accounts.
- **Every query gets a tenancy predicate**, even when the id it pins is globally unique. RLS is
  off here; the predicate is the only boundary left.
- **`period` is global** — no `companyId`, no unique key. Tier 12 takes `pg_advisory_xact_lock`
  before its read-then-insert; two companies onboarding at once would otherwise both insert the
  same 48 weeks, visible to every tenant.
- **Shelves are declared, not generated.** `FoundationData.shelves` lists every storage unit by
  name, in an order where a parent precedes its children, and `openingStock[].shelf` joins on
  that name. A name with no matching `ShelfSpec` is a hard error — it used to silently drop the
  company's entire opening stock while still looking provisioned.

## Verifying a change

The tiers are shared, so a refactor that "looks fine" can silently drop rows.

```bash
pnpm db:seed:dev -- --email you@example.com --dataset satellite
```

Diff the printed `Seeded row counts` block against `.ai/runs/2026-08-13-seed-baseline.txt`, and
check the structural sums that counts alone miss (`.ai/runs/2026-08-13-seed-baseline-structural.txt`).
`--tiers 1,2,3` and `--skip-wipe` are dev-only conveniences.

Note `journal` survives the wipe: tier 9 skips an entry whose `journalEntryId` already exists, so
a re-seed will NOT correct a journal you just fixed in the data. Delete the rows first.

## Known rough edges

- `04-sales.ts` / `05-purchasing.ts` key their order-line maps by item, so two lines for the same
  item collapse to the last one — a shipment or invoice line would attach to the wrong order line.
  Key on the line's `ref` if a dataset ever needs that.
- `10-ops.ts` is a reserved, empty slot; it logs and does nothing.
- `sql.ts`'s `columnCache` is module-global and never invalidated. Harmless in the short-lived
  CLI; in the long-running Inngest worker a deploy that adds a column needs a restart.
