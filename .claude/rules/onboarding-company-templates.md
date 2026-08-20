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
`wipeFirst: false`). `bootstrap.ts` and `cli.ts` are dev-only; `wipe.ts` is now shared,
reachable only through `wipeFirst`.

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

`previousMonthEnd(anchor)` is the one exception-shaped helper: the depreciation period end
must land on a real month end, so it is derived rather than offset.

Never use JavaScript `Date` here, and never `CURRENT_DATE` in a tier's SQL — the anchor is
the company's day, the database session's is UTC, and the two disagree for a slice of every
day. Note there is NO automated guard: `@carbon/checks` scans `apps/mes/app/services`,
`packages/jobs/src`, `packages/database/supabase/functions` and the ERP module/route files,
none of which covers `packages/database/src/**`. This is convention only.

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
assembler run at seed time** — `seedAssembly` in `tiers/06-production.ts` writes a `modelUpload`
row whose `modelPath`/`glbPath`/`graphPath` are those bundled paths, `processingStatus` already
`Success`, then an `assemblyInstruction` + its `assemblyInstructionStep` rows, and finally points
`item.modelUploadId` at it.

The data is `ProductionData.assembly` (`AssemblySpec`), authored in `data/<key>/assembly.ts`. It
is **optional** — a dataset with a null `industryId` has nowhere to resolve a model from and is
skipped. A step's `componentNodeIds` are real node ids read out of that exact `graph.json`; they
are the frozen join key between the graph, the GLB node extras and the step rows, so a step
naming an absent node renders but animates nothing. Regenerate them from the graph rather than
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

## The drift check

The tiers build every INSERT from `information_schema` at runtime (`datasets/sql.ts`), so no
typecheck knows a dataset references a column — a migration that drops one breaks the demo
templates silently, and only when somebody seeds.

```bash
pnpm db:check:datasets                       # all four
pnpm db:check:datasets -- --dataset motor    # one
```

It applies each dataset to a throwaway company and **always rolls back**
(`datasets/verify.ts` — there is no `COMMIT` in that file, and the `ROLLBACK` is in a
`finally`), so it writes nothing and is safe to point at your own development database. It is
reached by extracting two transaction bodies: `seedCompanyReferenceData` (out of `bootstrap`)
and `applyDatasetTiers` (out of `applyDataset`). Both extracted functions own no transaction,
which is exactly what lets one caller commit and the other roll back.

The scratch company is attributed to the `system` user, never a real developer's.

It runs from `.husky/pre-commit` whenever a staged file is under `packages/database/`
(~3s for all four); `CARBON_SKIP_DATASET_CHECK=1` skips it. It exits 0 with a warning when
the database is unreachable, has no `user` table, or has no users — a hook that fails for
reasons you cannot fix is a hook you learn to bypass, and every one of those is the
developer's environment rather than drift.

Three honest limits. A hook is bypassable with `--no-verify`, so this is a safety net rather
than a gate (CI was declined on cost). It proves only that the datasets still APPLY — not
that they still produce the same rows; that is the baseline diff below. And it reads the
LIVE schema, so a migration you have written but not yet applied is invisible to it — commit
a column drop before `pnpm db:migrate` and the check passes green, which is exactly the state
the migration's own author is most likely to be in.

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
