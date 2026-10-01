paths:
  - "packages/database/supabase/functions/lib/supersession-pick.ts"
  - "packages/database/supabase/functions/get-method/**"
  - "packages/planning/src/mrp/**"
  - "apps/erp/app/modules/inventory/supersession-pick.ts"
  - "apps/erp/app/modules/items/ui/Item/ItemSupersessionForm.tsx"

# Item Supersession

"This part is being phased out, use its successor instead." One row per item in
`itemSupersession` (PK is `("itemId")` alone — not the usual composite), holding
`supersessionMode`, `successorItemId`, `successorEffectivityDate`,
`discontinuationDate` and `conversionFactor` (1 old = N new).

Authored at **Part → Planning → Supersession** (`ItemSupersessionForm`, rendered
by `x+/part+/$itemId.planning.tsx`). The same card lists the parts that name
this item as their successor ("Supersedes", from `getItemSupersededBy`) and has
an **Add Predecessor** modal (`predecessorSupersessionValidator`, intent
`supersession-predecessor`) that writes the row on the OLD item with this item
as successor — a planner starts from the new BOM, so the rule must be
authorable from the successor side. The row still lives on the predecessor;
the engines need no reverse lookup.

`upsertItemSupersession` refuses a **loop** (A→B plus B→A, any length) with
`SUPERSESSION_CYCLE_CODE`; the route surfaces it as a field error. Before this
guard the redirect map silently dropped both entries and neither part ever
swapped, which reads as "working" in a trial.

`discontinuationDate` only suppresses NEW purchase suggestions for the old part
(`purchasing-planning` views); it never stops picking or production. It is
optional for `Consume First` — that mode switches when stock runs out, not on a
date.

## Three consumers, three different questions

Do not assume one rule. Each answers something different, deliberately.

| Consumer | Source | Question |
|---|---|---|
| **MRP** (`runMrp`, `@carbon/planning` — `packages/planning/src/mrp/mrp.ts`) | live, every run | what should we replenish (buy or make), and how should existing supply change? |
| **Job creation** (`get-method`) | live at creation, then **frozen** | what does this job consume? (a `Consume First` predecessor with stock at the job's location keeps its Pull from Inventory lines, bought or made — the item-level `withoutStockedConsumeFirst` filter in `loadSupersessionRedirect` is provisional and `settleConsumeFirstLines` applies the per-line whole-assembly rule after insert. A made predecessor's **Make to Order** line follows the same rule by becoming a Pull from Inventory line on the predecessor when its stock covers at least one whole assembly — a Make to Order line is built in the job and never consumes stock, so pulling it is the only way the old sub-assemblies get used; with no whole assembly in stock it swaps to the successor's method and is built) |
| **Picking** (`inventory/supersession-pick.ts`) | live, at pick time | what do we pull off the shelf? |

A `jobMaterial` row is a **snapshot**. Editing a supersession afterwards never
rewrites existing rows — but picking re-evaluates live, so the same job can be
picked differently tomorrow. That split is intentional; don't "fix" it.

## Mode gating — three modes redirect

`REDIRECTING_MODES = { "Consume First", "Prefer New", "Stock Only" }`
(`lib/supersession-pick.ts`). `Stock Only` is "service reserve, no production
use", so production demand moves to the successor like a phase-out mode; only
the predecessor's OWN replenishment is reserve-governed (the planning views top
it up to `minimumReserveQuantity`). Leaving it out made a job's BOM name the
spares-only part and dropped the successor demand from purchasing. `No Stock`
has no successor and never redirects.

**The single most common way to set up a test that proves nothing** — seed
`No Stock`, or a two-row loop, watch nothing swap, conclude the feature works.

Picking is stock-aware on purpose
(`apps/erp/app/modules/inventory/supersession-pick.ts`, mirrored by
`get_picking_schedule`, migration `20260908211552`). The supersession row is
looked up by `resolvePickRule`: the row's OWN item's rule when its successor is
the `substitutedFromItemId` (a line pulled back onto the predecessor — the
column holds the successor), else the `substitutedFromItemId`'s rule (a line
swapped at creation — the column holds the predecessor), else the row's own.
Keying on the material's own item alone found no row for a swapped line, so
`Consume First` never consumed the predecessor for any job created after the
effectivity date; trusting the column FIRST inverted the roles on a pulled-back
line whenever the successor had a rule of its own (NEW → NEWER) and sent the
pick back to NEW. The SQL's lateral `ORDER BY` encodes the same precedence.

Material still on the predecessor:

- `No Stock` → skip
- `Stock Only` → pick the successor (never the spares-only predecessor)
- `Prefer New` → successor when effective, falling back to the predecessor
  while the successor has no warehouse stock and the predecessor does
- `Consume First` → predecessor **until it has no warehouse stock**, then successor

Material swapped at creation (`substitutedFromItemId` set, quantity in
successor units; effectivity is not re-checked — for `Consume First` this only
happens when the predecessor had no stock at creation):

- `Consume First` → predecessor while it has warehouse stock, then successor
- `Prefer New` → successor, unless it has no stock and the predecessor does
- anything else → successor

Pulling the predecessor converts the quantity by `1 / substitutionFactor`.
A row the BOM's successor pulled onto the predecessor carries the successor in
`substitutedFromItemId`; `resolvePickRule` reads it as an unswapped line on the
predecessor (see above), whether or not the successor has a rule of its own.

**Whole assemblies.** A unit that needs N of the part gets N of the SAME
part — two of the old or two of the new, never one of each. Every Consume
First consumer rounds the predecessor's usable on-hand DOWN to a multiple of
the line's per-assembly quantity with `consumableInWholeAssemblies(onHand,
perAssembly)` (`lib/supersession-pick.ts`; `RoundingMode.Down` exists for it).
2 per assembly and 3 on the shelf fits ONE assembly: 2 old, the rest new, and
the odd part stays in stock. Units of one batch may differ from each other; a
single unit never mixes. This came from a customer who would rather leave one
old part on the shelf than fit a mismatched pair — the unit-level split before
it did exactly that. A row's `quantity` is the per-assembly quantity in the
row's own units; a row swapped at creation holds successor units, so the
predecessor's per-assembly quantity is `quantity / substitutionFactor`
(`perAssemblyOld` in `generatePickingList` and the SQL).

**Partial stock.** A job line is never split at creation: a Consume First
line stays whole on the predecessor whenever it covers at least one assembly,
and the job materials page shows "N in stock, for K assemblies; the remaining
M will be picked as NEW" (`consumeFirstByItemId` in `$jobId.materials.tsx`,
computed live from the row's on-hand, rounded as above).
`generatePickingList` is where the split happens: it picks the predecessor for
the whole assemblies the warehouse covers and the successor for the rest, as
two pick lines on one material, and the page then shows the pick-based note
instead. `settleConsumeFirstLines` (get-method, after every row of a job is
inserted, all four flows) settles every Pull from Inventory line, bought or
made. The decision per line is the pure `settleConsumeFirstLine`
(`lib/supersession-pick.ts`, with `buildConsumeFirstRules` and the shared
threshold `keepsLineOnPredecessor`), pinned by `lib/supersession-pick.test.ts`;
get-method only loads stock and writes the row. Three cases — a row SWAPPED at creation from a Consume First predecessor that covers
one assembly is reverted onto it with no provenance (the BOM named it; the
provisional map swaps a made predecessor regardless of stock, for its Make to
Order lines); a row on the successor with a predecessor that covers one
assembly becomes the predecessor (`substitutedFromItemId` = the successor,
`substitutionFactor` = `1 / factor`); a row kept on a predecessor whose
on-hand covers no whole assembly of it is pushed to the successor. The
item-level `withoutStockedConsumeFirst` filter only asks "any stock" and is
provisional; the settle pass is what applies the per-line rule.
The job materials **Order Status** column (`getJobMaterialShortfallByItem`)
nets a Consume First shortfall against the successor's on-hand and incoming
supply in a second pass; `ItemOrderStatus.substituteItemId` tells the badge to
say "In stock, the remainder as NEW" or "Order N × NEW for this job". The
successor's own supply also drives the badge: `getJobMaterialsOrderStatus`
loads PO lines and supply jobs for every substitute item that is not itself a
material of the job, and `getJobOrderStatusByMaterial` reads a line's own item
AND its substitute — so a job raised for the NEW remainder shows "Planned job"
on the OLD line instead of no badge at all.
The item planning tab's supply/demand list (`api+/items.$id.$locationId.forecast.ts`,
`getRedirectedOpenJobMaterials`) applies the same split to open job material
lines so the rows match the bars: the predecessor keeps what its on-hand
covers, the successor lists the remainder "via <predecessor>".
`hasWarehouseStock` / the SQL `EXISTS … GROUP BY storageUnitId HAVING SUM > 0`
both count any single non-lineside bin (including the unassigned bin) with
positive on-hand.

**Lineside credit.** Before anything is picked, material already at the
operation's lineside bin is credited, and both the generator and the schedule
use ONE definition (`linesideCredit` in `lib/picked-consumption.ts`, exported
to Node through `@carbon/database/picked-consumption`; `get_lineside_credit`
in SQL): the material's OWN live pick lines to that bin (picked − returned,
less the job's consumption of the item) plus whatever on-hand at the bin no
LIVE job's live pick line claims — a claim is Σ(picked − returned) of a job's
non-cancelled lines to the bin minus that job's consumption, and only jobs in
Planned / Ready / In Progress / Paused hold claims (a finished job never
consumes its leftover pick; a cancelled list's picked material is simply
unclaimed). For a Consume First line the credit is taken in whole assemblies
across predecessor AND successor (`splitConsumeFirstPick`, ERP
`supersession-pick.ts`, tested) — one assembly of each already at the bin
means nothing to pick — and the generator keeps a running `unclaimedRemaining`
per (item, bin) so two materials in one list cannot credit the same stock.
Consumption sees the same stock: `getPickedBudgets` takes the operation's
lineside bin (`getOperationLinesideBin`) and adds the unclaimed on-hand of the
line's item, its predecessor and its successor as budgets, and
`allocateAcrossBudgets` takes a PREDECESSOR budget only in whole assemblies
(`perAssembly`, the material's per-parent quantity), so a unit is never
completed with one old and one new part out of the bin. The schedule hides an
operation only while it is on an OPEN list (Draft / In Progress / Partial),
not forever after a completed one, so a job whose quantity grows after
picking gets a card for the remainder.

Inside `generatePickingList` the predecessor's stock test is the **running
balance** (`warehouseRemaining`, seeded from `getWarehouseOnHand` and drawn
down by every earlier line of the list) and nothing else — an `||
hasWarehouseStock` fallback let a later line pick the predecessor in full after
earlier lines had used it up, and never split. The "already staged at the op's
lineside bin" check runs BEFORE the split, so material sitting at the machine
neither charges the balance nor raises a successor line for nothing.

**Make to Order lines.** The row builders of `itemToJob` and
`itemToJobMakeMethod` resolve a Make to Order child against
`consumeFirstOnHand` (the second value `loadSupersessionRedirect` returns: the
job-location on-hand of every MADE Consume First predecessor whose rule is
effective) BEFORE the row is built: when
`consumableInWholeAssemblies(onHand, quantity) > 0` the row's `methodType`
becomes `Pull from Inventory` on the predecessor, so it is inserted as a
picked row — no `jobMakeMethod` is created (the insert interceptor keys on
`methodType`), nothing is exploded, and picking splits it per unit like any
other Consume First line. Otherwise `swapMadeSubAssembly` swaps it to the
successor and explodes the successor's method. `madeChildren` is therefore
derived from the BUILT rows' `methodType`, not the BOM lines' — the two are
paired by index in the made-children loop, and a converted row must drop out
of both. This is per unit, never per batch: a batch of five may use old
sub-assemblies on three units and new on two, but one unit never mixes.
Converting to Pull from Inventory (rather than splitting the line into a
picked half and a built half) is what keeps it stable under `recalculate`,
which rebuilds every line as per-assembly quantity × parent quantity and
would inflate a split back to two full lines.

**Picking never stages a Make to Order line** (`generatePickingList`
`.neq("methodType", "Make to Order")`, `get_picking_schedule` migration
`20260908211552`). The parent operation never consumes such a line from stock
(`issue`'s backflush skips it), so a pick only moved material to lineside that
nothing would use. Since unassigned materials were attributed to the first
operation of their method (`20260720160557`) every Make to Order sub-assembly
was scheduled that way — visible as a second, phantom pick (old and new from
the shelf) for a sub-assembly the job was already building as its successor.

`settleConsumeFirstLines` is scoped to the rows the calling flow **just
inserted** (`jobMaterialIds`, collected at every `jobMaterial` insert of the
four flows) and skips any row with issued quantity. Get Method on one
sub-method rebuilds only that sub-method's rows; the job-wide read it started
with rewrote lines on other sub-methods — some already issued in successor
units. The moved row's quantities come from `pullBackQuantities`
(`lib/supersession-pick.ts`), which is direction-agnostic despite its name:
recover the source's target (`estimatedQuantity − scrapQuantity` on a Buy/Pick
row), convert, and re-derive scrap at the TARGET item's rate — the rate the
row now carries.

Cancelling a job (`$jobId.status.tsx`) returns the staged material first, then
`cancelOpenPickingListsForJob` cancels its lines on every open list and the
lists that have no live line left; a list shared with other jobs stays open.
`get_picking_schedule` ignores a cancelled LINE as well as a cancelled list, so
a reopened job's operation returns to the schedule. Its Consume First
predecessor stock test is the whole-assembly one (warehouse on-hand ≥
`perAssemblyOld`, migration `20260908211552`); Prefer New keeps the any-bin
test because it never splits.

The substituted pick line's note (ERP `PickingListLines`, MES picking route)
says how many assemblies it covers — "8 × NEW in place of OLD, for 4
assemblies" — from the job material's `quantity` and factor; the select embeds
`jobMaterial(quantity, substitutionFactor, item(itemSupersession(conversionFactor)))`
for that. Only shown when it is a whole number.

## Consumption follows what was picked

`lib/picked-consumption.ts`. A pick can bring a different part than the job
material names (a Consume First split, a Prefer New fallback, a Stock Only
redirect), and the material row is never rewritten after creation — so the
consumers read the pick lines instead of the row:

- `getPickedBudgets` — per picked item for one material: staged at lineside
  (`Σ picked − returned` over live lines) minus what the job has already
  consumed of that item (`itemLedger` "Job Consumption" rows for the job at
  the location), the lineside bin, and the line-units→item-units factor
  (`pickFactor`, from the supersession rule in either direction, else the
  row's `substitutionFactor`).
- `orderOldFirst` — predecessors first, then the line's own item, then the
  rest. Partial completions therefore use up the old part before touching the
  new one.
- `allocateAcrossBudgets` — spreads a line-unit quantity across the budgets;
  what no pick covered is returned as `remaining` and the caller falls back to
  the material's own item from its own bin (the pre-existing behaviour).

**A budget is two pools, and only one is shared.** `own` is the material's
OWN live pick (scoped by `jobMaterialId`, so private to that material, at
the bin its pick lines went to); `unclaimed` is what sits at the operation's
lineside bin that no live job's pick claims, shared by every material of the
operation. `available` is their sum. `allocateAcrossBudgets` attributes each
take own-first (`fromOwn` / `fromShared`), `recordSharedTakes` accumulates
ONLY the shared portion per (item, bin) into a `SharedTakes` map, and
`getPickedBudgets` subtracts that map from `unclaimed` alone. The backflush
loops over every material of the operation before inserting its ledger rows,
so without the map two materials sharing a picked item were both offered the
same unclaimed stock; but recording the WHOLE take, keyed by item, let
material A's private pick zero out material B's private pick, and B fell
back to the warehouse while its staged stock sat at the machine.
`splitTakeByBin` turns a take back into ledger rows — the own portion
against the pick bin, the shared portion against the lineside bin — so a
take that draws on both pools is never charged to one bin.

Used by `issue` (`issueJobOperationMaterials` completion backflush and
`partToOperation` manual/step issue, negative adjustments only) and by
`post-picking` (`returnUntrackedMaterialRemainder` holds `owed` back
predecessor-first and returns the rest per item; `maybeRestoreJobMaterialSource`
keeps the lineside pointer while any budget is still available). Pinned by
`lib/picked-consumption.test.ts`.

Consumed-so-far is attributed per (job, item), not per material — two
materials on one job sharing an item share one counter.

## `buildSupersessionRedirectMap` — the shared builder

`lib/supersession-pick.ts`, used by MRP and `get-method` so both resolve a
supersession by the same rules. It does NOT make their answers identical: each
caller passes its own `asOfDate` (below), so a date-effective supersession can
apply to one and not the other. Collapses `A→B→C` to `A→C` with the product of
the factors.

- Effectivity: `!date || date <= asOfDate`, lexicographic on `YYYY-MM-DD`
  (all three columns are `DATE`, so string order is chronological).
- `asOfDate` differs by caller: MRP uses today in the **company timezone**;
  `get-method` uses the job's build date (`jobBuildDate`).
- **MRP nets a Consume First component's on-hand, bought or made.** Top-level
  demand (Phase 4.5) draws the old item's on-hand down first; the BOM rewrite
  leaves every Consume First child on the old part and passes the rule to the
  engine as `consumeFirstRedirect` (`lib/mrp-engine.ts`), with the engine's
  starting on-hand for the old part overlaid from `remainingConsumeFirstOnHand`.
  When the engine reaches the old part it nets its running balance **per
  contributor in whole assemblies** (`redirectConsumeFirstShortfall`: each
  contributor is one parent's demand and carries `perAssemblyQuantity`, the
  IMMEDIATE parent's per-unit need stamped by the cascade — `parentItemId` is
  the root source's item and cannot answer that for a sub-sub-assembly — so a
  parent needing two per unit draws only multiples of two, at any depth) and moves the shortfall (× factor, stamped
  `redirectedFromItemId`) to the successor — in the old part's period, or
  EARLIER by the difference when the successor's lead time is longer (the
  parent needs it by the same date); never later, since the old part's period
  may already be floored at period[0]. The old part
  never explodes its own BOM; the successor is planned as itself at a deeper
  level — its BOM explodes for exactly the shortfall when it is Make, and it
  surfaces as a buy when it is Buy. The supersession is a synthetic edge in
  `computeLowLevelCodes` for that: a successor that also sits shallower in
  another BOM would otherwise be planned before the redirect reaches it.
  Phase 4.5 (demand on the old part ITSELF — its own sales lines and existing
  job lines) nets the same way through the shared `netConsumeFirstContributors`
  (`lib/mrp-engine.ts`): a Job Material contributor carries
  `perAssemblyQuantity` from `openJobMaterialLines.quantityPerParent`, so an
  open job line needing two per unit draws only multiples of two, and only the
  MOVED contributors are stamped onto the successor (before this every
  contributor was copied over at full quantity). Sales lines and projections
  have no per-assembly quantity and net by the unit. Pinned by
  `lib/mrp-engine.test.ts`.
- **The redirect also moves the ACTUAL demand rows.** Phase 4.5 rewrites
  `jobMaterialDemandByKey` / `salesDemandByKey` in the same proportion it
  moves `grossDemand`, so `demandActual` (which `get_purchasing_planning`,
  `get_production_planning` and the item planning chart read) shows the
  predecessor with only what its stock covers and the successor with the rest
  in successor units. Before this, planning suggested buying the predecessor
  while the successor sat in stock.
- **Consume First walks its chain one hop at a time.** The collapsed map
  (`A→B→C` to `A→C`) is right for Prefer New / Stock Only, where B is being
  skipped, but B's own shelf stock must be used before Consume First demand
  moves on. `buildConsumeFirstHops` (same file) maps each effective Consume
  First item to the NEXT Consume First item in its chain, collapsing only
  through non-Consume-First hops and multiplying their factors; a chain that
  never terminates is dropped. MRP passes every hop as `consumeFirstRedirect`
  (a middle hop gets demand only through the redirect and must still net its
  stock) and Phase 4.5 moves a Consume First shortfall to the hop, not the
  collapsed terminal. Job creation walks the same hops for a Make to Order
  line (`firstStockedInConsumeFirstChain`): the first item in the chain with
  a whole assembly in stock becomes the Pull from Inventory line, recorded as
  a swap when it is not the BOM's own item. With no stock anywhere in the
  chain and a BOUGHT successor (`boughtSuccessors`, the fourth value the
  loader returns: every redirect target whose effective replenishment is not
  Make), the line becomes a Pull from Inventory line on the successor — it is
  purchased — instead of falling through `swapMadeSubAssembly` (no make
  method on a bought item) to building the phased-out part. A Pull from
  Inventory line needs no walk — `settleConsumeFirstLine` already pulls it
  back onto any direct stocked predecessor of the item it landed on.
  Phase 4.5 iterates redirected items predecessor-first along the hops
  (`redirectOrder`), so a hop's own pass sees the demand, actuals and
  contributors its predecessor just moved onto it and splits them again;
  a moved contributor keeps its ORIGINAL `redirectedFromItemId` and has its
  `perAssemblyQuantity` converted by the factor.
- **Cycles are dropped, not collapsed.** A two-row cycle (`A→B` plus `B→A`) is
  writable from the UI — only *self*-reference is blocked, by both the DB CHECK
  and the zod refine. Collapsing one produced `A → A` with the cycle's factor
  product, so an item superseded itself and its quantities were multiplied by
  garbage. The walk builds into a SECOND map; mutating in place made the result
  depend on iteration order. Pinned by `lib/supersession-pick.test.ts`.

## get-method: four flows, one invariant

`itemToJob`, `itemToJobMakeMethod`, `quoteLineToJob`, `jobToJob` each build
`jobMaterial` rows independently. **Resolve the swap BEFORE any field derives from the item.**

Building the row first and patching it afterwards is how
`itemScrapPercentage` was left on the predecessor for years: the patch list was
hand-written and the field was simply absent from it. All four now resolve
`itemId` at the top of the row builder, so every derived field — scrap rate,
bin, cost, tracking flags — follows automatically, including fields added later.

`swapMadeSubAssembly` is the exception: a made sub-assembly must be inserted
before it can be re-exploded, so it genuinely patches. It restates item-derived
fields by spreading `itemDerivedJobMaterialFields()` rather than listing them.

Made lines cascade `target + scrap` to their children, so a wrong scrap rate
there under-explodes the entire sub-tree — every row below looks individually
correct on a wrong base.

`loadSupersessionRedirect` is loaded **once per request**, before the
transaction, in all four flows, and returns a `SupersessionContext`
(`lib/supersession-pick.ts`: the collapsed `redirect` map, `consumeFirstHops`,
`consumeFirstOnHand`, `boughtSuccessors`); `resolveMadeLinePull(itemId,
perAssembly, ctx)` is the one decision for a Make to Order line — stocked
chain hop first, then a bought successor, else null (build). `supersessionMode`
is typed everywhere as the DB enum
(`Database["public"]["Enums"]["supersessionMode"]`, re-exported from the lib
as `SupersessionMode`), never `string`. It pages with `fetchAll` + `.order("itemId")`;
a bare select stops at PostgREST's 1000-row cap and would silently redirect a
different subset than MRP.

## Columns and what is visible

`jobMaterial.substitutedFromItemId` / `substitutionFactor` record provenance.
`methodMaterial` has **no** equivalent — so `jobToItem` (Save Method) writes
swapped items into the master BOM untraceably.

`jobMaterial.itemScrapPercentage` is `NOT NULL`, and `recalculate` only
re-derives it when the stored value is NULL — which a NOT NULL column never is.
**A wrong scrap rate is permanent.** It is surfaced by
`get_job_quantity_on_hand` but rendered nowhere; the substitution indicator in
`JobMaterialsTable` is the only supersession UI on a job.

## Known gaps

- `quoteLineToJob` and `jobToJob` never swap **made** sub-assemblies —
  documented as "a later layer". Fail-safe (you get the quoted/copied
  structure), but it disagrees with MRP, which has already redirected that
  demand.
- A Make→Buy successor now becomes a Pull from Inventory line on the bought
  successor at job creation (see the chain paragraph above); the remaining
  fallthrough is a MADE successor whose make method isn't Active, or an item
  read failure — both leave the line on the predecessor, indistinguishably.
- A Make to Order line pulled from a Consume First predecessor's stock is a
  Pull from Inventory line for the WHOLE quantity: the units the shelf does
  not cover are picked as the successor from stock, or planned by MRP (which
  nets the same predecessor stock and moves the shortfall to the successor).
  The job never builds the successor remainder itself. Splitting the line
  into a picked half and a built half would need `recalculate`'s quantities
  engine to know about the split.
- `jobBuildDate` falls back to **UTC today** when a job has neither start nor due
  date — which is the default creation path (`No Deadline` renders no due-date
  field). MRP uses the company timezone; this is where the shared-map guarantee
  breaks. Baselined in `packages/checks/src/conformance/baseline.json`.
