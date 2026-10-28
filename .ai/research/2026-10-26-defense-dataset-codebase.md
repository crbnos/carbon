# Research — what the codebase requires of a 5th (defense drone) demo dataset

Date: 2026-10-26. Read-only research on `main` at `/Users/aashu/work/carbon/carbon`. Every claim
cites the file and line it was read from. "Not found" means a search turned up nothing. Notes marked
"(inference)" are reasoning, not something read directly.

Paths under `datasets/` mean `packages/database/src/datasets/`.

---

## 1. How a dataset is structured and registered

### The `Dataset` type and its 12 slices

- `datasets/types.ts:2227-2244`: `Dataset = { key, label, industryId, foundation, items, inventory,
  sales, purchasing, production, quality, changeOrders, accounting, ops, workflows, planning }`.
  That is 12 slices plus 3 identity fields. `industryId` is "industry.id this dataset backs, or null
  for dev-only datasets" (`types.ts:2230-2231`).
- `datasets/types.ts:2222-2223`: `DatasetKey = "satellite" | "robotics" | "precision" | "motor"`, with
  the comment "Must stay in step with DATASETS in index.ts".
- Each slice is one file under `data/<key>/`, and the CAD assembly is a 13th file, `assembly.ts`. The
  files are `accounting, assembly, change-orders, foundation, index, inventory, items, ops, planning,
  production, purchasing, quality, sales, workflows` (14 files, from `ls data/satellite`).
  `data/satellite/index.ts:23-39` puts them together (`key: "satellite"`, `label: "Aerospace &
  Satellite"`, `industryId: "aerospace_satellite"`).
- Layer rules (`datasets/AGENTS.md`, "Layers" table):
  - Data is plain TypeScript literals. No SQL, no ids, no `Date`.
  - Tiers do not know which industry they are seeding.
  - Change a tier only to support a new *shape* of data.

### Registry and lookup (`datasets/index.ts`)

- `DATASETS: Record<DatasetKey, Dataset> = { satellite, robotics, precision, motor }` (`index.ts:34-39`).
- `getDataset(key)` checks with `hasOwn` (`index.ts:41-46`). `datasetKeys()` is `index.ts:48-50`.
- `datasetForIndustry(industryId)` (`index.ts:52-57`): `Object.values(DATASETS).find(d => d.industryId ===
  industryId) ?? null`. So **one dataset per industry**. If two datasets share an `industryId`, the
  first one wins.

### `industry` table and its migrations

- `supabase/migrations/20260617100002_onboarding-and-backups.sql:14-23` creates the table.
  - Columns: `id TEXT PK, name, description, iconName, sortOrder, active, createdAt, updatedAt`.
  - It is a global catalog with no `companyId`.
- Rows from that migration (`:25-35`):
  - `robotics_oem` (icon `bot`, sort 1)
  - `precision_manufacturing` (`cog`, 2)
  - `automotive_precision` "Motor Assembly" (`wrench`, 3)
- `20260813023744_add-aerospace-industry.sql:5-13` adds `aerospace_satellite` (icon `satellite`, sort 4)
  with `ON CONFLICT ("id") DO NOTHING`. It is the template for a new row.
- RLS for the table: `src/authz/manifest.ts:648` `industry: policies({ select: authenticated })`. A
  row-only migration needs no policy change.
- `company.industryId` is an FK to `industry.id` with `ON DELETE SET NULL`
  (`20260617100002…sql:46-47`).

### How onboarding picks a dataset (`apps/erp/app/routes/onboarding+/industry.tsx`)

- Loader:
  - `getIndustries(client)` (`settings.service.ts:420-426`) selects `id, name, description, iconName`
    where `active = true`, ordered by `sortOrder`.
  - It then filters to `industries.filter(i => datasetForIndustry(i.id))` (`industry.tsx:107-112`).
    An industry with no dataset is hidden.
- Action:
  - `datasetForIndustry(companyData.industryId)` (`:175-187`). When no dataset matches, it returns a
    field error ("No demo data is available for that industry yet").
  - Otherwise it passes `template = dataset.key` to `provisionOnboardingCompany`.
  - That function fires `trigger("company-template", { datasetKey: template, … })`
    (`apps/erp/app/services/onboarding.server.ts:132-135`).
- Icons: `INDUSTRY_ICONS` maps `iconName` to a Lucide icon (`industry.tsx:75-82`: `bot`, `cog`,
  `satellite`, `wrench`). An unknown `iconName` falls back to `LuFactory` (`:263`).
  **A new icon name (e.g. a drone or shield icon) needs a new entry here.** The rule file's checklist
  does not list this step.
- Job: `company-template.ts:199-206` resolves `getDataset(datasetKey)` and fails the marker with
  `Unknown dataset` when the key is not registered. The per-company concurrency key is at `:35-38`.

### How Settings → Demo Data picks a dataset (`apps/erp/app/routes/x+/settings+/demo-data.tsx`)

- The loader builds `datasets = datasetKeys().map(key => ({ key, label: DATASETS[key].label }))`
  (`:45-51`). A new dataset appears there automatically under its `label`.
- The action checks `datasetKeys().includes(datasetKey)` (`:71`, `:158`).
- Gate: the loader calls `requirePermissions(request, { update: "settings" })` (`:38-41`).
  - The rule says this page is "gated by `canAccessBackups`" (`onboarding-company-templates.md:204-205`).
  - **I could not verify that.** `demo-data.tsx` imports no `canAccessBackups`. The nav entry is plain
    `role: "employee"` (`useSettingsSubmodules.tsx:205-210`).

### Other places that list every dataset

- The dev CLI: `seed-dev.ts:47` `parseSeedArgs(datasetKeys())`. The default is `satellite` (`cli.ts:61,76`).
- `check-datasets.ts:83` `const keys = datasetKeys()`. With no `--dataset` flag it validates every
  registered key (`:96`).
- `tiers/workflow-definitions.ts:9-22` `SEED_WORKFLOW_BUILDERS = { satellite, robotics, precision,
  motor }`. This one is **manual**.
  - `packages/ee/src/workflows/seed-workflows.test.ts:23` iterates over it.
  - So a dataset left out of it has its workflow definitions untested.
- `validate-assembly.test.ts:6` imports satellite only. It needs no change.

### "Adding an industry" (rule file `.claude/rules/onboarding-company-templates.md:506-533`), checked against code

| # | Rule step | Verified? | Evidence |
|---|---|---|---|
| 1 | `data/<key>/` with all 12 slices; the compiler enforces parity; the validator requires non-empty arrays and full `COVERAGE` | Yes | `types.ts:2227-2244` has non-optional slices; non-empty list at `validate.ts:1234-1312`; `COVERAGE` at `validate.ts:178-478` |
| 2 | Register in `DATASETS` | Yes | `index.ts:34-39` |
| 3 | Add to `DatasetKey` | Yes | `types.ts:2223` (`Record<DatasetKey, Dataset>` forces 2 and 3 together) |
| 4 | Set `industryId`; add an `industry` row by migration | Yes | `datasetForIndustry` `index.ts:52-57`; template migration `20260813023744…sql` |
| 5 | Add the builder to `SEED_WORKFLOW_BUILDERS` | Yes, manual | `workflow-definitions.ts:18-23` |
| 6 | Verify with `pnpm db:check:datasets -- --dataset <key>` | Yes (command exists) | `check-datasets.ts:83-130` |
| — | **Missing from the rule:** add the icon to `INDUSTRY_ICONS` | Gap | `industry.tsx:77-82,263` |
| — | **Missing from the rule:** bundle assets (`assets/<industryId>/*.svg`, `models/*.glb` + `.graph.json`) | Gap | `assets.ts:15-38`; validator fails when the graph is missing: `validate.ts:4010-4014` |
| — | **Missing from the rule:** a baseline `.ai/runs/…-seed-baseline-<key>.txt` + `screen-matrix-<key>.txt` | Convention | rule `:618-644` |

**Files a new industry touches:**

- `data/<key>/*.ts` (14 new files)
- `datasets/types.ts` (`DatasetKey`)
- `datasets/index.ts` (import + registry)
- `tiers/workflow-definitions.ts`
- a new migration under `supabase/migrations/` (the `industry` row)
- `apps/erp/app/routes/onboarding+/industry.tsx` (`INDUSTRY_ICONS`, only for a new icon name)
- `assets/<industryId>/` (thumbnails, `models/`)
- `assets/ATTRIBUTION.md` (a model row)
- docs:
  - the rule file
  - `datasets/AGENTS.md` (it says "Four datasets ship today")
  - `packages/database/AGENTS.md` ("Four keys ship today")
  - `coverage.ts` only if floors move

**Doc drift:** the rule says `COVERAGE_FLOORS` has "255 tables" (`:592`). It currently holds 261 entries
(counted in `coverage.ts`).

---

## 2. How robotics, precision and motor were made relative to satellite

### Method: copy-and-rewrite against satellite's shape

- Spec: `.ai/specs/implemented/2026-08-13-remaining-industry-datasets.md`.
  - Goal: "Adding a fifth industry costs data only" (`:42`).
  - Decision: "Full satellite parity" (`:175`).
  - It also contains the tier refactor that took satellite's identity out of tier 01 (`:77-146`).
- Plan: `.ai/plans/2026-08-13-remaining-industry-datasets.md`.
  - Task 8 (`:418-440`): "Create, each mirroring its `data/satellite/` counterpart … Copy from
    (precedent): the same-named file under `data/satellite/` … write the robotics version with the
    same **structure and cardinality**, substituting robotics items, customers and suppliers."
  - The plan recovered robotics `foundation.ts` and `items.ts` from a git stash, 525 + 746 lines
    (`:386-401`).
  - Precision and motor (Tasks 10-11, `:489-511`) were "data-only … satellite-parity volume, no empty
    slice". They "may run as parallel subagents" (`:28`).
- Later passes changed all four datasets together:
  - `.ai/specs/2026-09-22-demo-data-completeness.md` (Goal 4: "All four industries stay in rough
    volume parity … enforced structurally by required (non-optional) slice fields")
  - `.ai/specs/2026-09-23-demo-data-screen-coverage.md`
  - The plan for the latter says "Author `data/satellite/` first, then robotics / precision / motor
    with … the same shape and volume" (`.ai/plans/2026-09-23-demo-data-screen-coverage.md:17`).

### Size

Counted with `wc -l` on `data/<key>/*.ts`:

| Dataset | Files | Lines |
|---|---|---|
| satellite | 14 | 7,552 |
| robotics | 14 | 7,496 |
| precision | 14 | 7,470 |
| motor | 14 | 7,600 |

Per-file sizes are nearly identical across the four, for example:

- `sales.ts`: 1067 / 1067 / 1068 / 1068
- `workflows.ts`: 548 in all four
- `planning.ts`: 81 in all four
- `change-orders.ts`: 142 / 142 / 143 / 142

This is the signature of copy-and-rewrite.

### Timeline

- All four datasets first landed in one commit, `c6365ff5fe` "Feat/onboarding templates (#1387)",
  2026-08-21 (from `git log --diff-filter=A`). The spec is dated 2026-08-13.
- The original generated CAD models landed in `ec1cf85838` (2026-09-30).
- Robotics data has 12 commits in its history (`git log -- data/robotics`).

### Hard requirements a new dataset must satisfy

#### A. Compile time

All 12 slices are required, and most fields inside them are too (`types.ts`). For example,
`ProductionData.eventsJobKey` / `genealogyJobKey` (`types.ts:1349`) and `genealogyAssembly` (`:1347`).

#### B. Pure validator (`validateDataset`, `validate.ts:6874-6878`; 30 rules at `:6841-6872`)

It runs on every pre-commit that touches `packages/database/` (rule `:603-607`).

1. **Non-empty arrays** (`validate.ts:1234-1312`):
   - departments, abilities, processes, work centers, customers (+contacts), suppliers (+contacts),
     procedures, shipping methods, warehouses, shelves, shifts, holidays, tags
   - all six material-taxonomy lists
   - every item category (buy/material/consumable/tool/service/make), methods, supplier links,
     batch properties, supersessions, customer parts, price overrides, pricing rules, revision ladder
   - opening stock, tracked stock, kanban, counts, shelf lives, stock and warehouse transfers
   - opportunities, status orders, released orders, sales returns, contracts
   - RFQ lines/quotes, lifecycle RFQs, POs
   - jobs, genealogy inputs, picking lists
   - NCR workflows, NCRs, inspections, quality docs, gauges, risks, change orders
   - fixed assets, journal entries
   - maintenance schedules/dispatches, replacement parts, trainings, timecards, suggestions, notes
   - workflow runs, planning buy/make ids, demand projections
2. **`COVERAGE` status sets** must each appear at least once (`validate.ts:178-478`). Most of them are
   "the DB enum minus a reasoned `except`", so a new enum value fails every dataset until one shows it.
   - Sales: every `salesRfqStatus`, `quoteStatus`, `quoteLineStatus` and `salesOrderStatus`.
     Shipments, sales invoices and RMAs minus a few exceptions. AR aging buckets Current / 1-30 /
     31-60 / 61-90.
   - Purchasing: every `purchaseOrderStatus`, `receiptStatus`, `purchaseInvoiceStatus`,
     `purchaseReturnOrderStatus`, `supplierQuoteStatus` and `purchasingRfqStatus`. Approval request
     types `purchaseOrder` and `supplier`.
   - Inventory and production: procedure statuses, tracked-entity statuses On Hold / Rejected /
     Scrapped, all four job `deadlineType`, job-operation overrides, production quantity types
     Production / Scrap / Rework, picking list In Progress / Completed.
   - Quality: every NCR status, priority, source and task status (minus Skipped), quality document
     status, gauge status, gauge calibration status, risk status, risk source, risk type, inspection
     status, inspection source.
   - Change orders: every change order status and change order task status.
   - Accounting: journal status (minus Provisional / Superseded), memo direction, payment type
     (posted and Draft), period close task Open / Done / Skipped, fixed-asset status (minus Under
     Construction).
   - Ops: maintenance dispatch status, severity, source, OEE impact; training status;
     workflow runs Succeeded / Failed / Skipped.
   - User attributes: Date / List / User.
   - Custom fields: `part|Text`, `customer|User`, `job|Yes/No`.
   - Print jobs: completed / failed / queued and auto / manual / reprint.
   - Rules: sales, storage:item and storage:workCenter rules; sales rule severity error / warn.
3. **Volume and floor-life minimums** (`validate.ts:3613-3620`):
   - `MIN_JOBS = 18`, `MIN_OPEN_OPERATIONS_PER_WORK_CENTER = 2`, `MIN_RUNNING_WORK_CENTERS = 4`
   - `MIN_ASSIGNED_OPEN_OPERATIONS = 6`, `MIN_MAKE_TO_STOCK_JOBS = 2`, `MIN_RECENTLY_COMPLETED_JOBS = 3`
   - `MIN_OPERATIONS_WITH_TOOLS = 3`, `MIN_OPERATIONS_WITH_PARAMETERS = 3`
   - `OPEN_JOB_DUE_WINDOW = { min: -3, max: 21 }` (`:3235`)
   - Others: `MIN_PARTNERS = 2` and `MIN_PROCEDURES_WITH_PARAMETERS = 2` (`:1227-1228`), customer
     portals ≥ 2 (`:2315`), NCR workflows ≥ 3 (`:4339`), timecards ≥ 5 (`:5730`), maintenance
     schedules ≥ 3 (`:5952`), replacement parts ≥ 3 (`:5958`), people-assignment days ≥ 5 on ≥ 3
     work centers (`:6318-6319`).
4. **Consistency checks:**
   - every reference resolves
   - net on-hand stays ≥ 0 per (item, shelf)
   - journals balance
   - invoice status matches its settlements
   - EUR rate between 0.5 and 1
   - chronology and period floors: `NOT_CLOSED_MIN_OFFSET = -273`, `OPEN_PERIOD_MIN_OFFSET = -242`
     (`dates.ts:53-55`)
   - 48-week planning horizon (`HORIZON_DAYS`, `validate.ts:87`)
   - inspection sample math
   - Source: rule `:553-565`.
5. **Assembly rules** (see §3).

#### C. Database floors (`COVERAGE_FLOORS`, `coverage.ts:10+`)

- 261 tables must each reach a row count. Floor = the smallest count any dataset produced, ×0.8 for
  volume tables (`coverage.ts:5-9`).
- `findCoverageShortfalls` (`verify.ts:67-133`) checks them inside an apply that `verify.ts` always rolls back.
- Examples:

  | Table | Floor | Table | Floor |
  |---|---|---|---|
  | `item` | 29 | `job` | 16 |
  | `jobOperation` | 76 | `jobMaterial` | 77 |
  | `makeMethod` | 24 | `methodMaterial` | 40 |
  | `salesOrder` | 19 | `purchaseOrder` | 18 |
  | `quote` | 8 | `opportunity` | 25 |
  | `trackedEntity` | 49 | `customer` | 4 |
  | `supplier` | 11 | `workCenter` | 8 |
  | `nonConformance` | 5 | `changeOrder` | 6 |
  | `gauge` | 3 | `riskRegister` | 5 |
  | `training` | 3 | `assemblyInstructionStep` | 5 |
  | `modelUpload` | 1 | `workflow` | 7 |

#### D. Content rules stated in the rule file

- Open change notices may lock only **two leaf make parts** per dataset (rule `:378-383`).
- Make methods stay Draft (rule `:368-376`).
- Every date is a `DayOffset` (rule `:291-315`).
- No new `user` rows: the applying user is the only employee (rule `:329-331`).
- The dataset declares every shelf up front (`datasets/AGENTS.md` "Rules").
- **One country for every customer and supplier address.** Tier 01 writes every party address from
  `foundation.partyAddress{City,StateProvince,PostalCode,CountryCode}` (`types.ts:247-251`;
  `tiers/01-foundation.ts:379-385`, `436-442`). So a dataset **cannot** seed a foreign customer
  address. A dataset can author an "export blocked to a non-US ship-to" rule. No seeded order can show
  it firing.

---

## 3. How the assembly model is wired

### Types (`types.ts`)

- `ItemsData.assembly?: AssemblySpec` is optional (`types.ts:537-545`). The seed skips it when `industryId`
  is null.
- `AssemblySpec` (`types.ts:1288-1310`):

  | Field | Meaning |
  |---|---|
  | `model` | file stem under `assets/<industryId>/models/` |
  | `name` | display name |
  | `item?` | the BOM item the assembly documents |
  | `componentCount` | must equal the graph's count |
  | `operation` | 1-based BOP position of the item's Assembly op |
  | `motionsBakedFor?` | fingerprint |
  | `steps` | the build steps |
  | `componentMappings` | `{ geometryHash, item }` pairs |

- `AssemblyStepSpec` (`types.ts:1241-1279`):

  | Field | Meaning |
  |---|---|
  | `title`, `instruction?` | what the operator reads |
  | `componentNodeIds` | graph node ids this step installs |
  | `materials?`, `tools?` | `{ item, quantity }[]` |
  | `key?` | needed when another step names this one |
  | `isSubAssembly?` | a header row: no node ids, materials or tools |
  | `parent?` | the header a member step belongs to |
  | `usedIn?` | headers only: the later step that fits the finished unit |
  | `motion?` | `linear` or `L` segments |
  | `view?` | `[x,y,z]` camera hint |
  | `blockedBy?` | node ids |

### The satellite file (`data/satellite/assembly.ts`)

- `model: "smallsat"`, `item: "SAT-1000"`, `componentCount: 266`, `operation: 1`,
  `motionsBakedFor: "3f7f48a0eeda4931"` (`:17-23`).
- 40 steps, 5 sub-assembly headers.
  - Headers: `sa-wings` usedIn `eps-wings`; `sa-adcs` usedIn `av-adcs`; `sa-prop` usedIn `main-prop`;
    `sa-eps` usedIn `main-eps`; a fifth for avionics (`:112-115`, `:237-240`, `:349-352`, `:450-453`,
    `:459+`).
  - A member step can itself be the `usedIn` target of an earlier sub-assembly (`eps-wings` is a member
    of `sa-eps`, `:416-418`).
- 16 `motion`, 33 `view`, 11 `blockedBy`, 13 component mappings (counted with grep).
- The other datasets, from the same grep:

  | Dataset | Steps | Headers | Leaves |
  |---|---|---|---|
  | robotics | 43 | 6 | 161 |
  | precision | 29 | 5 | 150 |
  | motor | 29 | 4 | 150 |

### Validator rules for the assembly (`validate.ts:4001-4125`)

- A `graph.json` must exist at `assets/<industryId>/models/<model>.graph.json`. `loadAssemblyGraph` reads
  it with `node:fs` (`:531-556`).
- `componentCount` must equal the graph's (`:4016-4019`).
- Every `componentNodeIds` and `blockedBy` id must exist in the graph (`:4023-4033`).
- A blocked step may carry no motion (`:4034-4038`).
- If any step has a baked `motion` / `view` / `blockedBy`, then `motionsBakedFor` must equal
  `assemblyStructureFingerprint(steps)` (`:4040-4051`; function at `:3914`).
  - Otherwise: "re-bake them, or drop motion/view/blockedBy".
  - So **motions are optional**. With none, a step's parts fade in (`types.ts:1268-1273`).
- Sub-assembly rules (`assemblySubAssemblies`): members sit directly before their header, no nesting,
  `usedIn` points forward (rule `:495-498`).
- Step materials must be on the item's BOM, with no duplicates and positive quantities. Tools must be
  Tool items (`:4056-4097`).
- At least 2 step materials (`MIN_ASSEMBLY_STEP_MATERIALS`, `:4001`), at least 1 tool (`:4103-4105`),
  at least 2 component mappings (`MIN_ASSEMBLY_COMPONENT_MAPPINGS`, `:4002`). Every mapping hash
  must be a leaf `geometryHash` in the graph and must map to a BOM item (`:4106-4124`).
- **Not checked by the validator:** "every leaf in exactly one step". Only the local
  `gen_assembly.py:81-82` (outside the repo) asserts it.

### Assets

- `assets.ts:15-25` globs `./assets/**/*.{svg,glb,json}` with `?url`. `getDatasetAssetUrl` resolves
  `_templates/<industryId>/…` (`:27-38`).
- Per industry, one model: `assets/<industryId>/models/<name>.glb` + `<name>.graph.json` (`ls`).

  | File | Size |
  |---|---|
  | `smallsat.glb` | 1.43 MB |
  | `robot-arm-6ax.glb` | 0.76 MB |
  | `hpu-manifold.glb` | 2.27 MB |
  | `servo-motor-9000.glb` | 0.93 MB |

- `graph.json` shape (read from `smallsat.graph.json`):
  - top level `{ componentCount, root, sourceUnit, unit, version }`
  - each node `{ bbox, children, color, geometryHash, isAssembly, name, nodeId, transform, volume }`
  - `componentCount` equals the leaf count (266)
- `tiers/02-items.ts:51` `seedAssembly` (called at `:318`) writes:
  - a `modelUpload` with bundled paths and status `Success`
  - an `assemblyInstruction` and its steps
  - `item.modelUploadId`
  - the link to the Assembly `methodOperation` (rule `:451-462`)
- `assets/ATTRIBUTION.md:1-22`:
  - Every model is "original work: a model generated in CadQuery … product tree mirrors that dataset's
    top-level BOM".
  - The author baked each model once through a local `apps/assembler` (`POST /v1/convert`, `linearDeflection 0.5`,
    `angularDeflection 0.3`).
  - Re-baking changes every node id. The ISR-4 needs a new row in this file.

### Model pipeline (outside the repo, read for context)

- Spec `.ai/specs/2026-09-30-demo-models-robotics-precision-motor.md:29-33`:
  - The pipeline is CadQuery STEP → assembler convert at 0.5 / 0.3 (fall back to 2.0 / 1.0 if the GLB
    is over 3.5 MB) → `.glb` + `.graph.json` → a generated `assembly.ts`.
  - Acceptance criteria: GLB ≤ 3.5 MB, about 150–450 leaves, ≥ 8 colours, every leaf in one step
    (`:115`).
- Satellite spec: every product name must be unique so node ids never collide (`.ai/specs/2026-09-30-satellite-demo-cad-model.md:38-39`).
- Local tooling: `/Users/aashu/work/carbon/plans/satellite-model/`. It holds `cadlib.py`, `bake.py`,
  `gen_assembly.py`, `steps_<model>.py` and `motions/`.
  - `gen_assembly.py` emits the `assembly.ts` and asserts that every node id lands in a step.
  - `bake.py:22` hardcodes a worktree path, `/Users/aashu/work/carbon/carbon-feat-sub-assemblies`,
    which **no longer exists** (`ls`). It needs re-pointing before reuse.
- An ISR quad generator already exists at `/Users/aashu/work/carbon/plans/quad-model/quad.py`
  (371 lines).
  - It builds `AFR-100 Airframe`, `ARM-200`, `PRP-300`, `AVN-500`, `BAT-700`, `COM-800`, `PLD-900`,
    `LDG-950`, `VNS-850`, `LGT-700` and `TRC-100` sub-assemblies (`quad.py:124-356`).
  - Its output `out/isr-quad.glb` is **9.0 MB** and came straight from CadQuery's `exportGLTF`
    (`quad.py:368-370`). It is not an assembler bake, and **no `graph.json` exists yet**.
  - So node ids, geometry hashes and the 3.5 MB budget are all still open. I did not verify the
    139-part count.

### Thumbnails (`assets/<industryId>/<readableId>.svg`)

- 33 SVGs per industry, 132 in total (`ls` count). They are 1024×1024 vector art with gradients
  (`SAT-1000.svg` header). Sizes are about 128 B to 59 KB.
- **No generator in the repo.** `.ai/plans/2026-08-14-demo-template-part-images.md` says:
  - "the generation prompts that produced the current artwork were lost … would have to be
    regenerated to re-render or extend the set" (`:20-22`)
  - the throwaway `generate-images.mjs` read `OPENAI_API_KEY` and the plan deleted it (`:60-64`)
  - check that no SVG has `<script>` or `on*=` handlers before commit (`:66-70`)
- `createItem` writes `item.thumbnailPath = "_templates/<industryId>/<readableId>.svg"`, or
  `ItemSpec.thumbnail` when set (`types.ts:291-295`; `datasets/AGENTS.md` "Part thumbnails").
- A missing SVG falls back to the type icon. In satellite, the two contract services and the
  supersession successor `VLV-SOLENOID-LP2` have no SVG (diff of readableIds against files).

---

## 4. Defense-relevant capabilities that already exist, and whether a dataset can seed them

| Capability | What exists (evidence) | Seedable by a dataset? |
|---|---|---|
| **`CONTROLLED_ENVIRONMENT`** | Deployment env flag, "true for an ITAR / controlled deployment" (`packages/env/src/schema.ts:116-118`; `env/src/index.ts:116-118`). See the list below the table. | **No.** Deployment-wide, not per company. The spec lists "subsidiaries/ITAR (env- or credential-gated)" as a non-goal (`.ai/specs/2026-09-23-demo-data-screen-coverage.md:25`). |
| **ITAR attestation** | `itarCertification` table: entity Rider and user US-Person attestations with version, hash, signer, IP, 365-day expiry; server-only writes (`migrations/20260812151247_itar-certification.sql:1-60`). Settings → ITAR Certifications, shown only in a controlled environment (`useSettingsSubmodules.tsx:217-223`). | **No.** No slice field (grep of `types.ts`). Excluded in `2026-09-22-demo-data-completeness.md:21`. |
| **Export-control fields (ECCN / USML / country of origin / HTS)** | **Not found** as columns. The `item` columns are `active, assignee, changeOrderId, …, itemTrackingType, mpn, …, thumbnailPath, trackingMethod, type, unitOfMeasureCode` (generated `types.ts` `item` Row). | **Partly, as a custom field.** Satellite seeds `{ table: "part", name: "Export classification (ECCN)", dataType: "Text" }` (`data/satellite/ops.ts:506-510`). `CustomFieldSpec` defines a field but carries **no per-part value** (`types.ts:2069-2075`). |
| **Export rule on sales docs** | Sales enforcement rules can test `customer.location.countryCode` and customer type. Satellite seeds "ITAR spacecraft — US ship-to only", severity error, on SO and invoice lines for `SAT-1000` and `ADCS-001` (`data/satellite/items.ts:948-961`). | **Yes** (`items.enforcementRules`, `types.ts:535`; spec `:455-491`). It cannot be shown firing, because every party shares one country (§2D). |
| **Serial and lot tracking** | `ItemSpec.trackingType: "Inventory" \| "Non-Inventory" \| "Serial" \| "Batch"` (`types.ts:283`). Satellite: `SAT-1000` and `RW-010` Serial; `BAT-LIION-48V` and `MAT-AL7075-PLT` Batch (`data/satellite/items.ts:36-60,153-156,285-290`). Serial sequences: `ops.serialSequences` (`types.ts:2077-2088`; satellite `ops.ts:512-516`). Lot attributes: `items.batchProperties`, e.g. "Heat number", "Mill cert received" (`data/satellite/items.ts:1029-1040`). Shelf life: `inventory.shelfLives` (`types.ts:662`). | **Yes** |
| **Traceability graph** | `trackedEntity` nodes and `trackedActivity` + Input/Output edges (`.claude/rules/traceability-model.md:11-20`); route group `apps/erp/app/routes/x+/traceability+/`. | **Yes.** `inventory.onHandTracked` with statuses Available / On Hold / Rejected / Scrapped (`types.ts:560-580`), `production.genealogyInputs` + `genealogyAssembly` (finished serial built from consumed lots) (`types.ts:1206-1236,1346-1347`). |
| **Certificate of conformance** | **Not found** as a document or PDF. `packages/documents/src/pdf/` has no CoC (file list). CoC appears only as text: an inspection step "Certificate of conformance matches PO and drawing revision" (`data/satellite/quality.ts:348`) and the quality-doc templates (`apps/erp/app/modules/quality/quality-document-templates.ts:3265`). | Only as a step or text inside a quality document or inspection |
| **First article inspection** | **No FAI module.** `inspectionDocumentUsage` enum is `'Receipt'` only, "extensible: 'FAI', 'Production' later" (`migrations/20260722040401_inbound-inspection-execution.sql:5-7`; generated `types.ts` `inspectionDocumentUsage: ["Receipt"]`). Precision fakes it with a procedure ("Report format: AS9102 FAI form 3", `data/precision/foundation.ts:658-709`), a training (`precision/ops.ts:361-383`) and a `job` Yes/No custom field "First article required" (`precision/ops.ts:506`). | Only by imitation (procedure + quality document + custom field) |
| **Inspection plans and sampling** | `items.inspectionPlans` (drawing number, AQL, features) (`types.ts:505-515,534`). `quality.inspections` covers receipt and job-operation lots (`types.ts:1521`). Z1.4 / ISO 2859-1 sampling (`packages/database/AGENTS.md` `./sampling`). | **Yes** |
| **NCR / CAPA / issues** | 21 `nonConformance*` tables incl. `nonConformanceRequiredAction`, `ApprovalTask`, `Reviewer` (generated types). Workflows set required actions and MRB, e.g. "Supplier Escape — Flight Hardware": Containment, Root Cause, Corrective Action, `mrb: true` (`data/satellite/quality.ts:18-31`). | **Yes.** `quality.workflows` + `quality.nonConformances` with links to supplier, PO line, customer, SO line, tracked entity, inspection, RMA line and return line, plus action tasks and MRB (`types.ts:1393-1462`). |
| **Gauges and calibration** | `gauge`, `gaugeCalibrationRecord`, `gaugeType` (generated types). | **Yes.** `quality.gauges` with Pass / Fail calibration history; status derived (`types.ts:1555-1590`). |
| **Training and qualifications** | `training`, `trainingAssignment`, `trainingCompletion`, `trainingQuestion`; `ability`, `employeeAbility`, `contractorAbility` (generated types). | **Yes, with limits.** `ops.trainings` (`types.ts:1974-1988`). Abilities come from `foundation.abilities`. The applying user gets the first two abilities with `lastTrainingDate` −30 (`tiers/01-foundation.ts:666-674`). The seed creates no other employee (rule `:329-331`). |
| **Change orders / notices** | `changeOrder*` tables (generated types). | **Yes.** `changeOrders.changeOrders`: Version / Revision / New Part, affected items, action tasks, NCR link (`types.ts:1696-1700` region; ChangeOrderSpec). Max two leaf make parts locked (rule `:378-383`). |
| **Supplier approval (approved supplier list)** | No ASL or supplier-certification table (searched `supplierApproval`, `supplierQualification`, `supplierCertification`: not found). What exists: `supplier.supplierStatus` enum `Active \| Inactive \| Pending \| Rejected` (generated `types.ts:95683`), approval rules and requests for `supplier` documents (`approvalDocumentType`). | **Yes.** `SupplierSpec.status` (`types.ts:78-89`); `purchasing.approvalRules` (`documentType: "purchaseOrder" \| "supplier"`) + `approvalRequests` (`types.ts:1089-1104,1116-1117`). Satellite: a Pending supplier ("Ionix Thrusters") with an approval request (`data/satellite/foundation.ts:349-355`; `purchasing.ts:640-652`). |
| **Customer types** | Free-text names. | **Yes.** `foundation.customerTypes`. Satellite: Government / Commercial / Research / Internal (`data/satellite/foundation.ts:225-230`). Sales and pricing rules can key on them (`types.ts:445`, `PricingRuleSpec.customerType`). |
| **Customer contracts (recurring revenue)** | `customerContract*` tables. | **Yes.** `sales.contracts` (`types.ts:877-905,912`) on Service items. |
| **Rental agreements / leases** | `rentalAgreement*`, `lease*` tables exist (generated types). | **No.** No slice field ("rental" / "lease" not found in `datasets/types.ts`). |
| **Risk register** | `riskRegister`. | **Yes.** `quality.risks`, Risk / Opportunity, sources General / Customer / Supplier / Item / Job / Work Center (`types.ts:1592-1612`). |
| **Approvals** | `approvalRequest`, `approvalRule` (EE). | **Partly.** PO and supplier only. The `approvalRequestType` coverage set excludes the `qualityDocument` and `changeOrder` types (`validate.ts` `except` list). |
| **Audit log** | Per-company `auditLog_{companyId}` tables fed by the event pipeline. On by default and cannot be turned off under `CONTROLLED_ENVIRONMENT` (`.claude/rules/audit-log-system.md:13-16,74-83`). | **No.** Excluded: "needs a per-company DDL table … the wipe cannot manage" (`2026-09-23-demo-data-screen-coverage.md:23`). Also, the apply sets `app.sync_in_progress`, which "Suppresses dispatch_event_batch" (`datasets/index.ts:128-130`). (Inference) Seeded rows therefore leave no audit entries. |
| **Document control** | `qualityDocument` (versioned, Draft / Active / Archived, typed steps) and versioned `procedure`s. | **Yes.** `quality.qualityDocuments` (`types.ts:1532-1553`) and `foundation.procedures` (versions + statuses, `types.ts:37-48`). The completeness spec excludes file attachments (non-goal "Files"). |
| **Customer portals** | `externalLink` Customer. | **Yes.** `sales.customerPortals: string[]` (`types.ts:913-914`), at least 2. |
| **Supersession / revision ladder / configurator** | — | **Yes.** `items.supersessions`, `revisionLadder`, `configuration` (`types.ts:528-536`). |

What `CONTROLLED_ENVIRONMENT` changes:

- The app shell forces MFA on for every user (`apps/erp/app/routes/x+/_layout.tsx:316-320`;
  `.claude/rules/authentication-system.md:332-338`).
- The app shell queries the ITAR certification status (`_layout.tsx:173-177,357-366`).
- Sessions get a 15-minute idle lock and a 12-hour absolute cap (`env/src/index.ts:224-229`).
- Audit logging is mandatory (`.claude/rules/audit-log-system.md:74-83`; enable at
  `commercial-licensing.md` "Audit log").
- Default URLs move to `itar.carbon.ms` (`env/src/index.ts:320-340`).
- The Onshape panel follows the same session policy (`.claude/rules/onshape-panel.md`, "Panel auth").

**Satellite already has defense flavour.** This matters for keeping the two stories distinct:

- a "Government" customer, "ORBSEC Defense", on the hero job and with a customer portal
  (`data/satellite/foundation.ts:241-247`; `production.ts:15-24`; `sales.ts:1022`)
- the ITAR US-only sales rule
- the ECCN custom field

---

## 5. Satellite story outline (the volume to mirror)

| Aspect | Satellite (evidence) |
|---|---|
| Company | Orbital Systems Inc. (`data/satellite/index.ts:20`). The seeded company name itself comes from the user or `DEV_COMPANY_NAME` (`bootstrap.ts:36`). |
| Locations | 2: the plant "Manufacturing Plant", 4500 Space Commerce Drive, Houston TX 77058, `America/Chicago` (`foundation.ts:148-156`), plus the bootstrap HQ. Floor: `location: 2`. |
| Departments / abilities / processes | 4 / 6 / 9 (`foundation.ts:27-56`) |
| Work centers | 7 at the plant (`foundation.ts:57-107`) + 1 HQ maintenance work center, "Flatsat Test Lab" (`:468-474`) |
| Customers | 4 (`foundation.ts:241-270`): ORBSEC Defense (Government), NovaSat Networks (Commercial), Apex Space Research (Research), PolarView Earth (Commercial, Lead) |
| Suppliers | 11 (floor 11). 7 trading suppliers (CelestialElex, SpaceGrade Fasteners, Orbital Composites, PropTech Solutions, Deep Space RF, AstroMill Machining, …) plus status showcases: Legacy Harness Co (Inactive), Ionix Thrusters (Pending), BargainSat Components, and Rheinland Precision Bearings GmbH (the EUR vendor) (`foundation.ts:303-446`) |
| Items | 36 (readableIds in `items.ts`): 12 buy parts (incl. the supersession successor `VLV-SOLENOID-LP2`), 6 materials, 2 consumables, 2 tools, 3 services, 11 make parts (`items.ts:33-378`). Floor `item: 29` (min 37 incl. bootstrap). |
| Top-level product | `SAT-1000` ESPA smallsat, Serial, std cost 990,000, price 1,800,000 (`items.ts:285-293`) |
| BOM | 11 make methods. `SAT-1000` → `BUS-STR-001`, `EPS-001`, `ADCS-001`, `COMMS-001`, `PROP-001`, `HARNESS-001`, `CN-MLI-001` (`items.ts:685-694`). Depth is 3 make levels (`SAT-1000` → `EPS-001` → `SAW-001` / `PCB-EPS-R1` → bought parts and materials; `items.ts:441-563`). |
| Routing (hero) | 3 ops: Clean Room Assembly (operationType Assembly, procedure), TVAC test, final inspection (`items.ts:695-726`) |
| Jobs | 21 (`production.ts:14-337`). Hero job `in-progress` is 3 × `SAT-1000` for ORBSEC, Hard Deadline (`:15-24`). Floor `job: 16`; `MIN_JOBS = 18`. |
| Sales | 11 opportunities + 6 status orders + 14 released orders (`sales.ts:51,389,449`). Baseline counts: `salesOrder 20`, `quote 8`, `shipment 5`, `salesInvoice 7` (`.ai/runs/2026-09-23-seed-baseline-satellite.txt`). |
| Purchasing | 18 PO specs (`purchasing.ts:162-535`); baseline `purchaseOrder 17`, `receipt 5`, `purchaseInvoice 7`, `purchasingRfq 3`, `supplierQuote 6` |
| Quality | 3 NCR workflows, 5 NCRs, 3 quality docs, 3 gauges, 5 risks (`quality.ts`, counted) |
| Change orders | 6 (`change-orders.ts`); floor `changeOrder: 6` |
| Ops | 3 trainings (`ops.ts`); custom fields ECCN / Program manager / Flight hardware (`ops.ts:506-510`) |
| Accounting / workflows | 6 fixed assets, 7 workflows (baseline) |
| CAD | `smallsat`: 266 leaves, 40 steps, 5 sub-assemblies |

The `.ai/runs/2026-09-23-seed-baseline-satellite.txt` baseline shows `job 8`, but the data holds 21
jobs. (Inference) The baseline predates the screen-coverage pass that raised the job count. Use
`coverage.ts` floors plus a fresh seed for volume, not that file.
