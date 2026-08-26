paths:
  - "packages/database/supabase/functions/lib/supersession-pick.ts"
  - "packages/database/supabase/functions/get-method/**"
  - "packages/database/supabase/functions/mrp/**"
  - "apps/erp/app/modules/inventory/supersession-pick.ts"
  - "apps/erp/app/modules/items/ui/Item/ItemSupersessionForm.tsx"

# Item Supersession

"This part is being phased out, use its successor instead." One row per item in
`itemSupersession` (PK is `("itemId")` alone — not the usual composite), holding
`supersessionMode`, `successorItemId`, `successorEffectivityDate`,
`discontinuationDate` and `conversionFactor` (1 old = N new).

Authored at **Part → Planning → Supersession** (`ItemSupersessionForm`, rendered
by `x+/part+/$itemId.planning.tsx`).

## Three consumers, three different questions

Do not assume one rule. Each answers something different, deliberately.

| Consumer | Source | Question |
|---|---|---|
| **MRP** (`mrp/index.ts`) | live, every run | what should we BUY? |
| **Job creation** (`get-method`) | live at creation, then **frozen** | what does this job consume? |
| **Picking** (`inventory/supersession-pick.ts`) | live, at pick time | what do we pull off the shelf? |

A `jobMaterial` row is a **snapshot**. Editing a supersession afterwards never
rewrites existing rows — but picking re-evaluates live, so the same job can be
picked differently tomorrow. That split is intentional; don't "fix" it.

## Mode gating — only two modes redirect

`REDIRECTING_MODES = { "Consume First", "Prefer New" }`
(`lib/supersession-pick.ts`). `Stock Only` keeps its successor as a
reserve-governed reference; `No Stock` has no successor.

**This is the single most common way to set up a test that proves nothing** —
seed `Stock Only`, watch nothing swap, conclude the feature works.

Picking uses a *different* rule set on purpose
(`apps/erp/app/modules/inventory/supersession-pick.ts`, mirrored by
`get_picking_schedule`):

- `No Stock` → skip
- `Stock Only` → pick the successor (never the spares-only predecessor)
- `Prefer New` → successor, falling back to the predecessor until effective
- `Consume First` → predecessor **until it has no warehouse stock**, then successor

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
- **Cycles are dropped, not collapsed.** A two-row cycle (`A→B` plus `B→A`) is
  writable from the UI — only *self*-reference is blocked, by both the DB CHECK
  and the zod refine. Collapsing one produced `A → A` with the cycle's factor
  product, so an item superseded itself and its quantities were multiplied by
  garbage. The walk builds into a SECOND map; mutating in place made the result
  depend on iteration order. Pinned by `lib/supersession-pick.test.ts`.

## get-method: three flows, one invariant

`itemToJob`, `itemToJobMakeMethod`, `quoteLineToJob` each build `jobMaterial`
rows independently. **Resolve the swap BEFORE any field derives from the item.**

Building the row first and patching it afterwards is how
`itemScrapPercentage` was left on the predecessor for years: the patch list was
hand-written and the field was simply absent from it. All three now resolve
`itemId` at the top of the row builder, so every derived field — scrap rate,
bin, cost, tracking flags — follows automatically, including fields added later.

`swapMadeSubAssembly` is the exception: a made sub-assembly must be inserted
before it can be re-exploded, so it genuinely patches. It restates item-derived
fields by spreading `itemDerivedJobMaterialFields()` rather than listing them.

Made lines cascade `target + scrap` to their children, so a wrong scrap rate
there under-explodes the entire sub-tree — every row below looks individually
correct on a wrong base.

`loadSupersessionRedirect` is loaded **once per request**, before the
transaction, in all three flows. It pages with `fetchAll` + `.order("itemId")`;
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

- `quoteLineToJob` never swaps **made** sub-assemblies — documented as "a later
  layer". Fail-safe (you get the quoted structure), but it disagrees with
  MRP, which has already redirected that demand.
- A Make→Buy successor leaves the line on the predecessor, and that fallthrough
  is indistinguishable from "successor's make method isn't Active" or "item read
  failed".
- `jobBuildDate` falls back to **UTC today** when a job has neither start nor due
  date — which is the default creation path (`No Deadline` renders no due-date
  field). MRP uses the company timezone; this is where the shared-map guarantee
  breaks. Baselined in `packages/checks/src/conformance/baseline.json`.
