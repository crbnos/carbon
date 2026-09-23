paths:
  - "packages/database/src/datasets/**"
  - "packages/jobs/src/inngest/functions/tasks/company-template.ts"
  - "packages/jobs/src/demo-planning.ts"
  - "packages/jobs/src/scripts/plan-company.ts"
  - "apps/erp/app/routes/onboarding+/industry.tsx"
  - "apps/erp/app/services/onboarding.server.ts"

# Onboarding Company Templates

Onboarding's third data choice — "Use a demo template" — fills a brand-new company with a
full industry story: items, BOMs, customers, quotes, orders, returns, jobs, picking,
inspections, non-conformances, gauges, change orders, maintenance, training, timecards,
posted journals, payments, accounting periods, workflows and their run history, sales /
storage rules, approvals, customer portals, and a live shop floor whose schedule and
material plan come from a post-commit MRP + scheduler run — with every user-reachable
status of the major documents represented and every in-scope ERP / MES screen showing
rows. The same data and the same insertion code back
`pnpm db:seed:dev`. **There is exactly one copy of both.**

Grounded against `packages/database/src/datasets/`,
`packages/jobs/src/inngest/functions/tasks/company-template.ts`,
`apps/erp/app/services/onboarding.server.ts`, and `apps/erp/app/routes/onboarding+/industry.tsx`.

## The shape of it

A **dataset** is data only — plain TypeScript literals, no SQL, no ids. It is a `Dataset`
object (`packages/database/src/datasets/types.ts`) with twelve slices: `foundation`,
`items`, `inventory`, `sales`, `purchasing`, `production`, `quality`, `changeOrders`,
`accounting`, `ops`, `workflows`, `planning`. Each slice lives in its own file under
`data/<key>/` (the items slice's CAD assembly additionally in `assembly.ts`), and
`data/<key>/index.ts` assembles them. `ops` (tier 10) holds maintenance schedules and
dispatches, trainings, timecards, suggestions and person notes; `workflows` also carries
the seeded run history (`runs`).

The **tiers** are the engine — `tiers/01-foundation.ts` … `tiers/12-planning.ts`, run in
numeric order. The ordering IS the contract: tier 4 can only build a sales order because
tier 2 already created the item and put its id in `ctx.refs`. Tiers read the dataset and
know nothing about which industry they are inserting.

`applyDataset()` in `datasets/index.ts` is the single entry point every caller uses:

```typescript
await applyDataset(pgClient, { companyId, userId, dataset, timeZone, tiers?, log?, wipeFirst? });
```

It resolves today in the company's timezone, builds the context, opens ONE transaction,
sets `app.sync_in_progress`, ensures sequences, runs the selected tiers in order, and
commits — or rolls the whole thing back. A half-seeded company is not a possible outcome.

`wipeFirst` clears the company's existing business data inside that same transaction,
so apply-onto-a-used-company is all-or-nothing: a tier that throws rolls the wipe back
too. It replaced an older `beforeTiers` callback that existed only so the dev CLI could
inject its wipe.

## The two wipes are not interchangeable

There are two wipes in this repo and they preserve **opposite** things. Getting this
wrong is the single easiest way to break a template apply.

| | `datasets/wipe.ts` (`wipeCompanyBusinessData`) | `company-backup.ts` (`selectWipeableTables` + `wipeScopedData`) |
|---|---|---|
| Reached by | `applyDataset({ wipeFirst: true })` | `wipeAndLoad` in restore / revert |
| Scope columns | `companyId` only | `companyId` **and** `companyGroupId` |
| Chart of accounts, `unitOfMeasure`, `sequence`, `paymentTerm`, `location` | **preserved** | **deleted** |
| Assumes afterwards | the tiers run against surviving config | a backup reloads everything |

The tiers REQUIRE that config — `buildCtx` resolves the chart of accounts, `EA` and the
sequences before tier 1. So **apply** uses the dataset wipe, and **revert** uses the
restore wipe (the snapshot carries the config back, so nothing needs keeping). The
asymmetry is deliberate: each wipe is paired with whatever repopulates after it.

`wipeCompanyBusinessData` is NOT exported on its own — `wipeFirst` is the only way to
reach it, so no caller can wipe without also re-seeding.

Because the datasets now seed posted/paid documents, the dataset wipe does these things
around its generic FK-null + topological delete, all inside the apply transaction:

0. **It refuses two company states before any write** (`assertWipeable`): intercompany
   customers/suppliers (`intercompanyCompanyId` set) and non-Draft `cardTransaction` rows.
   Both are trigger-protected and FK-linked to rows the wipe must delete, so the apply
   throws a `Seed: this company trades with other companies in its group …` /
   `Seed: this company has N posted or voided card transaction(s) …` error, which the
   template job writes to its marker as `failed`. Then it **voids posted document
   journals** (`reverseDocumentJournals`): every Posted journal of a `DOCUMENT_JOURNAL_SOURCES`
   type (invoices, payments, memos, receipts, shipments, `Inventory Adjustment`) whose
   lines — or `payment`/`memo.journalId` — point at a row it is about to delete gets a
   negated Posted `VOID …` entry dated today, the original left Posted, as the posting
   functions void.
1. **Non-Draft `salesInvoice` / `purchaseInvoice` rows are set back to `Draft`.** The
   `prevent_posted_{sales,purchase}_invoice_deletion` sync interceptors refuse deleting any
   other status and run even under `app.sync_in_progress`. This is a re-seed clear, not an
   app-level delete of a posted document.
2. **`invoiceSettlement`, `payment` and `memo` are deleted first.** Settlements hold
   ON DELETE RESTRICT FKs to their invoice/memo; payment and memo carry a
   customer-XOR-supplier CHECK the FK-nulling pass would violate.
3. The existing header-first deletes (invoices, orders, quotes, RFQs), MRP output, and
   the four model-only step-slide tables (`MODEL_SLIDE_TABLES`) — their
   `imagePath OR modelUploadId` CHECK cannot survive the FK-nulling pass.
4. After the delete pass, **orphaned customer/supplier org groups and customer/supplier
   type groups are removed** — the partner interceptors mint one `group` per partner and
   type, and `group` is preserved, so without this every re-apply left the previous
   story's partners in the group pickers. Bootstrap's root groups (kept by their
   `getGroupId` ids) and employee-type groups are untouched.

These deliberately survive a cross-dataset re-apply:

- **`journal` / `journalLine` / `accountingPeriod`** are in `PRESERVED_TABLES` (posted
  journals are trigger-immutable — `journal_posted_immutable` refuses even the UPDATE that
  nulling their `accountingPeriodId` would be, so the periods they point at must survive
  too; a company that posted real material issues before applying hit exactly that). Tier
  09 adopts each month's existing period — by `(fiscalYear, periodNumber)`, else by
  `startDate`, since job-costing SQL mints periods with no fiscal numbers and the app
  resolves a period by date range — rather than insert an overlapping one. Tier 09 also
  adopts an existing authored entry by `journalEntryId` (`JE-SEED-00x`; a company's one
  Posted Opening Balance by source type) and skips it, so after applying dataset B over dataset A the journal
  text is still A's, and a re-seed will not pick up a journal you just edited in the
  data — delete those rows by hand first. Because journals survive, the `journalEntry`
  counter does too: `sql.ts` `PRESERVED_SEQUENCES` keeps `resetSequences` from rewinding
  it, and `nextJournalEntryId` skips any id a preserved journal already holds.
- **`customField` / `userAttributeCategory`** are preserved too (they may be the user's);
  tier 10 adopts its rows by name (category by `(companyId, name)`, attribute by
  `(category, name)`, value `ON CONFLICT (userAttributeId, userId)`, custom field
  `ON CONFLICT (table, name, companyId)`) and updates them to the dataset's values, never
  deleting. `webhook` is preserved and deliberately NOT seeded — its sync interceptor
  refuses the seed's session, and spoofing `service_role` to get past it was rejected.
- **`dimension` / `dimensionValue`** are `companyGroupId`-scoped, and a company wipe must
  never touch group-shared rows. Each distinct dataset applied adds its own name-keyed
  custom dimension (bounded at one per dataset); tier 09 looks it up before inserting.

`externalIntegrationMapping` is in that wipe's `PRESERVED_TABLES` because the wipe runs
INSIDE the job whose own marker lives in that table. Without it the apply deleted the row
holding `snapshotPath`, the `ready` write re-inserted a bare one, and the revert then had
nothing to put back — a silent, unrecoverable loss of the user's pre-apply data.

## Three callers, one code path

**Dev CLI** — `packages/database/src/seed-dev.ts`. Bootstraps a user + company if the
email is unknown, wipes the company's business data, then calls `applyDataset`.

```bash
pnpm db:seed:dev -- --email you@example.com --dataset satellite
```

`--tiers 1,2,3` and `--skip-wipe` are dev-only conveniences (`--skip-wipe` just passes
`wipeFirst: false`). After the seed commits, the CLI runs the planning step below by
spawning `pnpm --filter @carbon/jobs plan:company -- --company <id> --user <id>`
(`@carbon/database` cannot import `@carbon/planning`, which depends on it); `--skip-plan`
opts out, and a failed run only prints a warning with that command to re-run. Under
portless the spawn adds `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem` when that file exists and
the variable is unset — without it the engines' supabase-js reads fail with
`SELF_SIGNED_CERT_IN_CHAIN`; run the script directly and you must set it yourself. `bootstrap.ts` and `cli.ts` are dev tooling — used by `seed-dev.ts`
and the drift check (`verify.ts` / `check-datasets.ts`), never by the `./datasets` export;
`wipe.ts` is shared, reachable only through `wipeFirst`.

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

### Planning runs after the commit

The planning screens (Material Planning, Demand Forecasts, Scheduling, Priorities, Resource
Planning, the MES schedule) are filled by the **real engines**, not seeded rows.
`planDemoCompany({ companyId, userId })` (`packages/jobs/src/demo-planning.ts`) calls
`runMrp(…, { type: "company", … })`, then `runLocationSchedule` for every location with a
Ready / In Progress / Paused job — the same calls the MRP cron and `api+/schedule.ts` make.
It must run after the seed commits (both engines read over PostgREST and open their own
transactions), and it never throws: it returns `{ mrp, schedule[] }` with `"ok"` or the
error message per step.

- **Template job** — a second `step.run("plan-template")` after `apply-template`,
  **non-fatal**: a failure is logged and, only while the marker still belongs to this run,
  written as `metadata.planningError` (a new apply resets it to `null`); marker status is
  never changed. On the `snapshot: false` path the marker is already cleared, so the
  failure is only logged (re-writing it would resurrect the marker as `running`). The
  3-hourly MRP cron is the backstop — for MRP only.
- **Dev CLI** — the spawned `plan:company` script (above). `plan-company.ts` loads
  `demo-planning.ts` through `createRequire` so tsx compiles the graph as CJS; as ESM,
  `@carbon/planning`'s named imports from `@carbon/database` fail to link. It exits 0 even
  when a step fails, 1 only on bad arguments.

Engine output is therefore invisible to the drift check (`verify.ts` rolls back before any
engine could run), which is why the screen matrix below exists.

**Settings → Demo Data** — `apps/erp/app/routes/x+/settings+/demo-data.tsx`, gated by
`canAccessBackups` (internal email or local dev), the same gate Backups uses. Lists every
key in `DATASETS` by its own `label`, read in the loader so a new dataset appears with no
second edit. Applying fires the same `carbon/company-template` event. This is what makes
a template a thing you can do at any time, not only at signup.

### Snapshot, keep, revert

The event carries `snapshot?: boolean`. Both the Settings page and onboarding set it;
it is what turns a one-shot into a reversible operation, and it drives `wipeFirst` too —
wiping without a snapshot would be unrecoverable, so the two never diverge.

With `snapshot: true` the job takes `buildCompanyBackup` into `_pre-template-<runId>`,
then runs the wipe and tiers in one transaction. The snapshot is **idempotent** — a retry
reuses `metadata.snapshotPath` rather than retaking it, or an attempt that ran after the
apply committed would capture the SEEDED state and destroy the user's real data. This is
the same reuse rule `company-restore.ts` follows, for the same reason.

### Progress

Both the apply and the revert are ONE durable `step.run` lasting minutes, so
`metadata.progress` (`{ phase, done, total }`) is the only thing between the user and a
page that looks frozen. Phases are stable KEYS — `snapshot`, `seed` (per tier, from
`applyDataset`'s `onProgress`), `wipe`, `load` (per table, from `wipeAndLoad`), `files` —
and `TemplateReviewRow` owns the human copy for each, so the job never bakes in display
text. It is cleared (`progress: null`) on every terminal write.

Every writer goes through `throttleProgress` in `company-backup.ts`, shared with
`company-restore.ts`'s `makeProgressReporter`: same-phase ticks inside 250 ms are dropped,
a phase change or a terminal `done === total` always flushes. Unthrottled this is a
read-then-write on a JSONB column per table — a few hundred tables becomes a thousand
round-trips. The write itself goes over supabase-js, its own connection, so it is safe to
call from inside `wipeAndLoad`'s and `applyDataset`'s open transactions.

The page revalidates its loader every 2.5 s; there is no status API route.

### Recovering a stalled run

If the process dies mid-run, no `catch` fires, and the marker sits on `running` /
`reverting` forever with every button disabled — the marker's existence is what gates
Apply. So the review row keeps the Revert button PRESENT (spinning) for the whole run
rather than hiding it, and after `STALLED_AFTER_MS` (5 min) turns it into "Retry revert",
enabled only when `hasSnapshot`. Re-firing the revert is safe: it re-reads the snapshot
from the marker, and the shared concurrency key serialises it behind anything still live.

Only Keep and Dismiss hide their row optimistically — they clear the marker through a job,
so the row would otherwise linger a poll longer and read as "nothing happened". A revert
must NOT do that: it keeps running, and the row is the only thing reporting that it is.

Two more Inngest functions finish the story, sharing one env-scoped concurrency key
(`'company-template-' + companyId`) with the apply so the three never overlap:

- `companyTemplateFinalizeFunction` (`carbon/company-template-finalize`) — resolves a
  **settled** run: drops the snapshot folder, then clears the marker. It backs BOTH the
  Keep button (on `ready`) and Dismiss (on `failed`) — the same operation under two
  labels. It refuses a `running` or `reverting` marker.
- `companyTemplateRevertFunction` (`carbon/company-template-revert`) — Revert. Reloads
  the snapshot through the restore engine's `wipeAndLoad`, restores its assets, then
  drops the snapshot and clears the marker. On failure it leaves the snapshot on the
  marker so the revert can be retried.

Nothing outside these functions may delete the marker row. A failed revert keeps its
`snapshotPath` on purpose, so a bare row-delete from app code strands the only copy of
the user's pre-apply data in the bucket with nothing pointing at it — which is why
Dismiss goes through finalize rather than deleting the row itself.

### Progress and failure

The job writes a marker row in `externalIntegrationMapping` with
`integration = "company-template"`. So:

- no marker, data present → applied and resolved
- `status: "running"` → the apply is in flight
- `status: "ready"` → applied, waiting on the user's keep/revert decision
- `status: "reverting"` → the undo is in flight
- `status: "failed"` + `error` → it did not land, and the error says why

An empty company on its own cannot tell you which of those happened; that is what the
marker is for. On the legacy `snapshot: false` path the marker is cleared on success
instead of settling on `ready`.

Two guards refuse rather than corrupt: an unknown `datasetKey`, and a marker for a
DIFFERENT run that is not `failed` — a pending keep/revert owns the only snapshot of the
user's real data, so a second apply would overwrite it. (This replaced an older
`item`-rows guard, whose retry-idempotency job `wipeFirst` plus snapshot reuse now does
structurally.)

## Dates are offsets, never literals

Every date in a dataset is a `DayOffset` — a signed number of days from the moment the
dataset is applied — resolved by `resolveDate` / `resolveTimestamp` in `datasets/dates.ts`
against `ctx.anchor` (today in the company's timezone). A template seeded next year shows
orders from last month, not from 2025. The satellite offsets were derived against a
reference date of 2026-08-13, so every interval between two dates is preserved exactly.

`previousMonthEnd(anchor)` and `monthBack(anchor, n)` are the exception-shaped helpers:
depreciation period ends, the 12 seeded `accountingPeriod` months and fixed-asset usage
logs must land on real month boundaries, so they are derived rather than offset.

Seeded periods are Closed at months −11/−10, Locked at −9 and Open after, so posting
dates are constrained: `dates.ts` exports `NOT_CLOSED_MIN_OFFSET` (−273, never in a Closed
month — the floor for Draft journals) and `OPEN_PERIOD_MIN_OFFSET` (−242, always in an
Open month — the floor for posted journals, payments, memos and disposals), both proven
for any anchor, and the validator enforces them.

Never use JavaScript `Date` here, and never `CURRENT_DATE` in a tier's SQL — the anchor is
the company's day, the database session's is UTC, and the two disagree for a slice of every
day. The pure validator checks offset VALUES (planning horizon, period floors, document
chronology) but nothing scans for `Date` / `CURRENT_DATE` usage: `@carbon/checks` covers
`apps/mes/app/services`, `packages/jobs/src`, `packages/database/supabase/functions` and
the ERP module/route files, none of which is `packages/database/src/**`. That part is
convention only.

## The shop floor lives at the plant

Every job and work center is at the dataset's plant, so tier 01 creates the **shifts at the
plant** (the work-center shift picker, the scheduler and Resource Planning read the work
centers' own location) and links them per work center (`FoundationData.workCenterShifts`).
It **upserts** the applying user's `employeeJob` (plant, title, department, shift, start
date — `ON CONFLICT ("id", "companyId") DO UPDATE`), because a company created outside
bootstrap has no row and the old UPDATE was a silent no-op; the MES and the ERP's
location-scoped pages read the user's default location from it. HQ keeps one work center
(`FoundationData.hqWorkCenter`, no shift or operations) with maintenance, plus HQ planning
rows, so lists that default to the first location are not empty.

No other person is ever created (no new global `user` rows) — the applying user is the one
employee every people screen shows. Volume: `validate.ts` requires `MIN_JOBS` (18) jobs per
dataset, every open job due within `OPEN_JOB_DUE_WINDOW` (−3…+21 days), open operations on
every plant work center and running work on several.

## Posted documents carry their downstream rows

Posted receipts and shipments, completed returns / transfers / picking lists / counts,
Paid and Partially Paid invoices, disposed assets and Posted journals are all seeded. The
posting edge functions cannot run inside the one seed transaction (and a post-commit call
would break all-or-nothing apply and the drift check's rollback), so each posted state is
**hand-authored together with the rows its posting path would have written** —
`itemLedger`, `invoiceSettlement`, tracked entities/activities, receipt/shipment lines —
in the same tier. Conventions, each mirroring the real code path:

- **Ledger rows copy the posting function's `entryType` / `documentType`**, not a guess:
  posted shipment `Negative Adjmt.` / `Sales Shipment`; posted receipt `Positive Adjmt.` /
  `Purchase Receipt`; completed RMA `Positive Adjmt.` / `Sales Return Receipt`; completed
  purchase return `Negative Adjmt.` / `Purchase Return Shipment`; picking and stock
  transfers `Transfer` / `Direct Transfer`; warehouse transfers `Transfer` /
  `Transfer Shipment` + `Transfer Receipt`; maintenance spare-part issue `Consumption` / `Maintenance
  Consumption`; scrapped lot `Negative Adjmt.` / `Scrap`. Posted PO receipts, SO
  shipments and scrapped lots carry GL and `costLedger` rows (below); other inventory
  postings (RMA receipts, returns, jobs, adjustments, opening stock) carry none — opening
  stock value sits in the authored Opening Balance entry.
- **Posted documents carry their journal, as with accounting enabled** — tier 09
  (`helpers/post-documents.ts`) journals every non-Draft sales/purchase invoice (plus a
  `VOID` entry for a Voided one), Posted memo, Posted payment (`payment.journalId` /
  `memo.journalId` set), posted PO receipt (plus its FIFO `costLedger` layer) and SO
  shipment (a `costLedger` draw on those layers, else `itemCost.unitCost` = the item's
  `standardCost`) and scrapped lot (post-inventory-adjustment's `Inventory Adjustment`
  shape, CR inventory / DR `scrapAccount`), whether or not `accountingEnabled` is on,
  through the edge functions'
  own builders (`buildSalesPostingLines`, `buildPaymentJournal`, `buildMemoJournal`) or
  copies of their inline shapes (`helpers/posting-journals.ts`). Ids come from the
  `journalEntry` sequence, which the wipe never rewinds. Payments stay USD at rate 1,
  `bankAccount` = `accountDefault.bankCashAccount`; `invoiceSettlement` rows ARE the
  allocation (validator: Paid = fully settled, Partially Paid = strictly between, others
  unsettled). Draft payments are unapplied and unjournaled. Memos tie to their invoice
  through a zero-cash Posted payment's credit settlement (`memoId` + `appliedViaPaymentId`).
- **Journals carry the adopted period's `accountingPeriodId`**. A Reversed manual entry
  is inserted Posted then flipped with `reversedById` (the one UPDATE the trigger allows).
  On re-apply the wipe voids every journal of a document it is about to delete (see the
  wipe list above).
- **Company exchange rates go to `exchangeRateOverride`**, never the platform-global
  `exchangeRate` table (a tenant template must not publish rates to every company). Rates
  are foreign units per 1 base unit (EUR ≈ 0.92).

The full decision log, with the code each convention was copied from, is
`.ai/specs/2026-09-22-demo-data-completeness.md` and
`.ai/specs/2026-09-23-demo-data-screen-coverage.md` → Autonomous Decisions.

## Part thumbnails ship with the app

Every seeded item gets `item.thumbnailPath = "_templates/<industryId>/<readableId>.svg"`,
written by `createItem`. **That is not a storage object.** The artwork is 132 committed
vector files under `packages/database/src/datasets/assets/<industryId>/`, exposed by
`@carbon/database/dataset-assets` and resolved by both apps' `getPrivateUrl`, which tries
`getDatasetAssetUrl(path)` before falling back to `/file/preview/private/${path}`. So the
`_templates/` prefix never reaches `file+/preview+/$bucket.$.tsx` and its companyId
authorization is untouched.

Bundling rather than uploading is deliberate: the files are vector and tiny, so they work in
local dev, preview builds and self-hosted installs with no upload step, no bucket, and no
read-only storage exception. A missing SVG degrades to the type icon (`getDatasetAssetUrl`
returns `null`), and `ItemThumbnail` in both apps additionally falls back on an image load
error, so a broken-image glyph is not a reachable state.

Do NOT connect this to `TEMPLATE_ASSET_PREFIX` / `company-templates` in
`packages/jobs/src/inngest/functions/tasks/company-backup.ts`. That is the dormant archive
design described below and shares nothing with this path but a string.

## CAD assemblies ship the same way

Each industry also seeds ONE 3D assembly, so a demo company has something real to open in the
viewer and step through in the assembler. It rides the exact mechanism the thumbnails do:
`assets/<industryId>/models/<name>.glb` plus its `<name>.graph.json` sidecar are committed,
`assets.ts` globs them alongside the SVGs, and `getDatasetAssetUrl` resolves the `_templates/`
path before the storage proxy is ever reached. So there is **no bucket object, no upload, and no
assembler run at seed time** — `seedAssembly` in `tiers/02-items.ts` writes a `modelUpload`
row whose `modelPath`/`glbPath`/`graphPath` are those bundled paths, `processingStatus` already
`Success`, then an `assemblyInstruction` + its `assemblyInstructionStep` rows, points
`item.modelUploadId` at it, and links the item's Assembly `methodOperation` — before the method
is released, so quote lines (tier 04) and jobs (tier 06) both copy the link.

The data is `ItemsData.assembly` (`AssemblySpec`), authored in `data/<key>/assembly.ts`. It
is **optional** — a dataset with a null `industryId` has nowhere to resolve a model from and is
skipped. A step's `componentNodeIds` are real node ids read out of that exact `graph.json`; they
are the frozen join key between the graph, the GLB node extras and the step rows, so a step
naming an absent node would render but animate nothing — the pure validator now fails it
(and a `componentCount` that disagrees with the graph) before commit. Regenerate them from the graph rather than
hand-editing, and never re-bake a model without re-deriving them — `nodeId` is a hash of the
tessellation, so ANY change to the mesh (including a different `linearDeflection`) invalidates
every id in the dataset.

The `.glb` files are baked ONCE by running the upstream STEP through a locally-built
`apps/assembler` (`POST /v1/convert` at `linearDeflection: 2.0`, `angularDeflection: 1.0` — the
default 0.1 produces a 30 MB GLB where the coarse setting produces 2.7 MB, with no visible
difference at demo scale). The STEP sources are deliberately NOT committed. Both the recipe and
the upstream licenses live in `assets/ATTRIBUTION.md` and
`.ai/plans/2026-08-20-demo-cad-models.md` — three of the four models are CC BY or CC0 and legally
REQUIRE that attribution to survive redistribution, so that file is not optional documentation.

Two things needed no change and should stay that way: `wipe.ts` discovers tables by their
`companyId` column rather than a hard-coded list, so `modelUpload` and every `assembly*` table are
already cleaned on re-apply (verified — applying a second dataset leaves exactly one model row);
and because the artifacts are bundled rather than stored, a backup/restore or template revert
carries the paths across intact with nothing to re-upload.

## Adding an industry

1. `data/<key>/` — one file per slice, mirroring `data/satellite/` (the canonical pattern;
   the other three mirror its shape). All twelve slices, `ops` included, are required, and
   the new-shape fields are non-optional, so the compiler enforces parity. The validator
   additionally requires the listed arrays to be non-empty and every `COVERAGE` set
   in `validate.ts` (quote / sales-order / invoice / PO / receipt / job-op /
   NCR / change-order / journal / dispatch / workflow-run statuses and more) to be exhibited
   somewhere in the dataset — so a new dataset must cover the full status matrix, not just
   type-check.
2. Register it in `DATASETS` in `datasets/index.ts`.
3. Add `"<key>"` to `DatasetKey` in `types.ts`.
4. Set `industryId` on the dataset to the matching `industry` row id, and add that row in
   a migration if it does not exist yet (`aerospace_satellite` was added by
   `20260813023744_add-aerospace-industry.sql`; the other three shipped in
   `20260617100002_onboarding-and-backups.sql`).
5. Add its workflow builder to `SEED_WORKFLOW_BUILDERS` (`tiers/workflow-definitions.ts`)
   so `packages/ee/src/workflows/seed-workflows.test.ts` validates its definitions.
6. Verify: `pnpm db:check:datasets -- --dataset <key>` (runs the validator, then applies it and checks
   the `coverage.ts` row-count floors).

Volume is the coverage contract: match the existing datasets' row counts roughly, so every
list screen in the ERP has rows and every detail screen opens.

All four industries have a dataset today. An industry without one is **hidden** from the
onboarding picker (`industry.tsx` filters on `datasetForIndustry`) rather than silently
provisioning a clean company — a card promising sample data that delivers none is worse
than no card.

## The drift check

```bash
pnpm db:check:datasets                       # all four
pnpm db:check:datasets -- --dataset motor    # one
```

`src/check-datasets.ts` runs two layers, in this order.

### Layer 1 — the pure validator (no database)

`validateDataset` (`datasets/validate.ts`) runs FIRST, before any connection is opened, and
needs nothing but the dataset literals. So it blocks the commit even when the local stack is
down — the DB-down skip below applies only to layer 2. It returns a list of violations, each
naming the slice and the offending key (`purchasing.lifecycleRfqs "prfq:star-tracker":
unknown item "ST-050-BOGUS"`), and on any violation the script prints them all, says "The demo
datasets are internally inconsistent", and exits 1 without touching the database.

What it checks, in summary: every string reference resolves inside the dataset (items,
parties, processes, work centers, shelves, document refs, bootstrap names such as scrap /
return reasons, NCR / change-order types, UoM codes, CoA account numbers); required arrays
are non-empty; every `COVERAGE` status/enum set is exhibited (an enum-backed set is the
generated DB enum minus its reasoned `except` entries, so a new enum value fails until a
dataset exhibits it); net on-hand per
(item, shelf) stays ≥ 0 after every authored movement (opening stock, counts, transfers,
posted receipts and shipments, returns, picks, scraps, maintenance issues); every journal
balances; invoice status agrees with its settlements (Paid fully settled, Partially Paid
strictly between, others unsettled); the EUR rate is in the "EUR per 1 USD" direction
(0.5–1, "is it inverted?"); document chronology and the period-offset floors; planning
horizon; assembly `componentNodeIds` exist in the bundled `graph.json`; inspection sample
statuses equal what the engine's rules derive.

### Layer 2 — apply and roll back (needs the database)

The tiers build every INSERT from `information_schema` at runtime (`datasets/sql.ts`), so no
typecheck knows a dataset references a column — a migration that drops one breaks the demo
templates silently, and only when somebody seeds.

It applies each dataset to a throwaway company and **always rolls back**
(`datasets/verify.ts` — there is no `COMMIT` in that file, and the `ROLLBACK` is in a
`finally`), so it writes nothing and is safe to point at your own development database. It is
reached by extracting two transaction bodies: `seedCompanyReferenceData` (out of `bootstrap`)
and `applyDatasetTiers` (out of `applyDataset`). Both extracted functions own no transaction,
which is exactly what lets one caller commit and the other roll back.

The scratch company is attributed to the `system` user, never a real developer's.

After the tiers and before the rollback, `findCoverageShortfalls` (`verify.ts`) counts every
table in `COVERAGE_FLOORS` (`datasets/coverage.ts` — 255 tables, measured across all four
datasets: floor = the smallest count any dataset produced, ×0.8 for volume tables) in one
`UNION ALL` query and fails the dataset with every shortfall listed as
`table: expected ≥ N, got M`. That is what catches a tier that silently writes nothing. Most
tables are counted by `companyId`; `COVERAGE_SCOPES` counts `dimension` / `dimensionValue`
by the scratch company's `companyGroupId` and the three favorites tables through their parent
document; the global `period` table is not counted. Removing data on purpose means lowering
the floor in the same change; adding a table means measuring and adding it.

Tier `ctx.log` lines are buffered per dataset and printed (the last 12) only when that
dataset fails, so the error is placed inside the tier sequence without drowning a green run.

It runs from `.husky/pre-commit` whenever a staged file is under `packages/database/`
(a few seconds for all four); `CARBON_SKIP_DATASET_CHECK=1` skips both layers. Layer 2 exits
0 with a warning when the database is unreachable, has no `user` table, or has no users — a
hook that fails for reasons you cannot fix is a hook you learn to bypass, and every one of
those is the developer's environment rather than drift. Layer 1 never skips.

Honest limits. A hook is bypassable with `--no-verify`, so this is a safety net rather than
a gate (CI was declined on cost). With the database down only layer 1 runs, so schema drift
and floor shortfalls go unnoticed until someone commits with the stack up. Layer 2 proves the
datasets still APPLY and meet their floors — not that they produce the same rows; that is the
baseline diff below. And it reads the LIVE schema, so a migration you have written but not
yet applied is invisible to it — commit a column drop before `pnpm db:migrate` and the check
passes green, which is exactly the state the migration's own author is most likely to be in.
When layer 2 fails and migrations are pending on disk, the message says so first.

## Verifying a change to the tiers

The tiers are shared, so a refactor that "looks fine" can silently drop rows. Seed, then
diff the printed `Seeded row counts` block against a known-good run, and check the
structural sums that counts alone would not catch (`methodMaterial` count + quantity sum,
`methodOperation` count + time sums, `salesOrderLine` count + quantity sum, `itemLedger`
count + quantity sum per entry/document type, per-journal balance). Current baselines:
`.ai/runs/2026-09-23-seed-baseline-{satellite,robotics,precision,motor}.txt`, with
satellite's structural sums (and the exact queries) in
`.ai/runs/2026-09-23-seed-baseline-satellite-structural.txt`. Journal amounts are signed by
the account's natural balance, so a raw Σ`amount` is non-zero by design; the per-journal
debit-minus-credit is what must be 0.

The status matrix — every DISTINCT status per document table after a satellite seed, each
absent value classified — is `.ai/runs/2026-09-23-demo-data-status-audit.txt`. Re-run the
same query when you add or remove a status. Enum-backed `COVERAGE` sets in
`validate.ts` pick up a new enum value on their own; for a text-typed set, add
the value by hand so it cannot silently disappear.

The screen-level reference is the **screen matrix**:
`.ai/runs/2026-09-23-screen-matrix-{satellite,robotics,precision,motor}.txt` — one count
query per ERP/MES screen data source, with the screen's own filters, against a real seeded
AND planned company (so it covers the engine output the floors cannot), each row PASS /
FAIL / EXCLUDED with the exclusion's reason. All four read FAIL 0. Its script lived in a
session scratchpad and is not committed, so rebuild the checks from those rows when you
change what a screen shows. The status audit answers "is every status present", the matrix
answers "does every screen have rows".

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
