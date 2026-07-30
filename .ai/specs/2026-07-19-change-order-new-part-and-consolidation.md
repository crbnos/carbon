# Change Orders — Replacement Part rename, net-new New Part, and BOM consolidation

> Status: draft
> Author: Brad Barbin (with Claude)
> Date: 2026-07-19

## TLDR

The change-order (ECO) module's `New Part` change type is misnamed: it always
mints a new part number **derived from** the affected part and auto-writes a 1:1
`affectedPart → newPart` `itemSupersession` at release — i.e. it is a
*replacement*, not a new part. This spec (1) **renames `New Part` → `Replacement
Part`**, (2) adds a genuinely net-new **`New Part`** change type — a brand-new
part with **no predecessor and no supersession**, minted and released under the
change order (Make or Buy), and (3) enables **N→1 consolidation** ("3 parts
become 1") as a change to the **parent assembly's** make-method BOM (remove the
old component lines, add the new one) that consumes a `New Part` — expressed
entirely through the existing `diffMethod` engine, with **no supersession**. No
new tables; the work is one enum migration plus additive service/UI paths.
Grounded in `.ai/research/2026-07-19-co-part-consolidation.md` (11 PLM/ERP
systems surveyed).

## Problem Statement

Two related gaps, both discovered while modeling a real ECO: *"I'm not replacing a
part on a BOM — I'm introducing a new way of doing things: 3 parts become 1."*

1. **`New Part` is a misnomer and blocks a genuine new-part use case.** Today the
   change types are `Version` (new make-method version, same item, no
   supersession), `Revision` (new revision item, same readableId, `oldRev →
   newRev` supersession), and `New Part` (new part **number** derived from the
   affected part, `affectedPart → newPart` supersession). All three are anchored
   to an **existing** affected part, and `New Part` **always** writes a 1:1
   supersession (`createChangeOrderDraftMethod` New Part branch,
   `items.service.ts`; the reveal+supersession in `releaseAffectedItem`,
   `items.server.ts:407`). There is **no way to introduce a brand-new part with
   no predecessor** under a change order. `mintPlaceholderPart` exists in
   `items.service.ts` but is wired to nothing (the AGENTS "G3 forward-reference"
   claim is stale).

2. **Consolidation has no home.** A change that removes several components from an
   assembly's BOM and adds one new component is *not* a part-to-part supersession
   — the removed parts are not being replaced everywhere they are used, only
   dropped from **this** assembly. Using `New Part`/`Revision` (which write a
   global-redirect `itemSupersession`, consumed by the supersession redirect map
   in `get-method`/MRP) would wrongly redirect those components in **every other**
   assembly that uses them. There is no supported way to say "restructure this
   assembly's BOM and introduce the consolidated part as part of the same
   controlled change."

Industry practice is unambiguous (research): a new part number that supersedes a
predecessor is universally **Replace/Supersede** (Windchill/Teamcenter
"Supersede", Fusion/NetSuite "Replace a Component", Duro "supersession"); **"New
Part" everywhere means no predecessor**; and **N→1 consolidation is always a
parent-BOM add/remove**, never N supersessions.

## Proposed Solution

### Change-type taxonomy (after this spec)

Two axes — *is there a predecessor?* and *same part number or new one?*:

| Change type | Predecessor | Part number | Supersession at release | Draft |
|---|---|---|---|---|
| **Version** | same part | same # | none | new make-method version on the same item |
| **Revision** | same part | same #, new rev string | `oldRev → newRev` | new inactive revision item |
| **Replacement Part** *(renamed from `New Part`)* | same part | **new #** derived from source | `affectedPart → newPart` | new inactive part, method copied from source |
| **New Part** *(net-new)* | **none** | **new #** from the type sequence | **none** | new inactive part, **empty** draft method (Make) or attrs-only (Buy) |

**Consolidation is not a change type.** It is the combination, in one CO, of:
(a) a **New Part** affected item (the consolidated "1"), and (b) the **assembly**
as a **Version** (or **Revision**) affected item whose draft BOM removes the old
component lines and adds a line referencing the New Part. The `diffMethod` engine
already classifies `added`/`removed` materials (`items.service.ts:6624/6643`), so
the CO renders `− P1 − P2 − P3  + P_new` with no new machinery.

### How a New Part flows

- **Add** — a new "**Create new part**" mode in the add-affected-item flow (a
  minimal new-part form: auto-minted `readableId` with override, name, type
  Part/Tool, replenishment Make/Buy). On submit: mint an **inactive** item +
  (for Make) an **empty** CO-owned draft `makeMethod`, then insert a
  `changeOrderAffectedItem` with `changeType = 'New Part'`.
- **Author** — the New Part's affected-item detail reuses the embedded
  `PartProperties` (attributes) and, for Make, `BillOfMaterial`/`BillOfProcess`
  editors — identical to a Replacement/Revision draft, but starting empty and
  with **no cutover/supersession card** (there is no predecessor).
- **Consume** — the assembly's draft BOM editor can add a line referencing the
  New Part's (inactive) draft item; inactive items are legal BOM components.
- **Release** — `releaseAffectedItem` reveals the New Part active
  (`item.active = true`, stamp `item.changeOrderId`) and activates its draft
  method, but **skips the supersession** (only Revision + Replacement Part write
  one). The assembly's new method version activates in the same run, ordered so
  the New Part is revealed first.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rename the 1:1-supersession type | `New Part` → **`Replacement Part`** | It always writes `affectedPart → newPart` supersession; "New Part" everywhere in industry means *no predecessor* (research consensus, all 11 systems). User-selected. |
| Add a net-new change type | **`New Part`** (no predecessor, no supersession) | Standard PLM behavior (Windchill/Teamcenter/Agile/Fusion/Arena/Duro); unblocks introducing a part under change control. User-selected. |
| New Part item scope | **Make + Buy** | Reuses the existing draft-method + embedded `BillOfMaterial`/`BillOfProcess` editors; the consolidated "1" may itself be a make sub-assembly. Delta vs today = start from an empty draft method instead of copying a source. User-selected. |
| New Part is a first-class **affected item** | Own explorer row + own draft, not an inline BOM-line side effect | Matches Carbon's affected-item-centric model; lets the new part be governed, authored, and released with the CO. Settled by model + research. |
| Standalone New Part | **Allowed** — no assembly change required in the same CO | Supports "introduce a new part under an ECO" on its own; consolidation is just New Part + an assembly Version change bundled. User-selected. |
| Consolidation modeling | **Parent-assembly BOM change** (Version/Revision) via `diffMethod` add/remove — **no** change type of its own, **no** supersession | Unanimous across all 11 systems; N→1 as supersession would wrongly redirect the removed parts everywhere they are used. User-selected framing. |
| Removed components | Surface **where-used** on removed diff lines; **no auto-obsolete** | No surveyed system auto-obsoletes; obsolescence stays a manual, where-used-guided action. Reuses `getPartUsedIn`. User-selected. |
| New Part number assignment | **Auto-mint from the type sequence, user override** | Mirrors `/x/part/new` (`useNextItemId`); Replacement Part keeps its derive-from-source minting (`getNextItemIdFromSource`). |
| Release supersession gating | Supersession only for **Revision** and **Replacement Part**; **New Part** and **Version** write none | New Part has no predecessor; Version edits the same item. One-line change to the `releaseAffectedItem` guard. |
| Change-type switcher | `updateChangeOrderAffectedItemChangeType` offers only {Version, Revision, Replacement Part} for an existing affected item; **cannot switch to/from `New Part`** | A New Part is intrinsically net-new; converting an existing-part change into a no-predecessor part (or vice-versa) is contradictory. |
| New Part item types | **Parts + Tools only** (Materials/Consumables/Services rejected) | Mirrors Replacement Part + the affected-item scope. |
| Data model | **No new tables/columns** | Reuse `changeOrderAffectedItem` (its `itemId`/`newItemId`/`draftMakeMethodId` already carry everything); the change is an enum rename + add and additive logic. |

## Data Model Changes

**No new tables or columns.** One enum migration on `changeOrderChangeType`
(created in `20260716101500_change-orders.sql`):

```sql
-- Rename the 1:1-supersession type. Existing changeOrderAffectedItem rows with
-- changeType = 'New Part' become 'Replacement Part' for free — they all already
-- carry an affected → new itemSupersession, so the relabel is semantically exact.
ALTER TYPE "changeOrderChangeType" RENAME VALUE 'New Part' TO 'Replacement Part';

-- Add the net-new type. NOTE: Postgres cannot use a newly ADDed enum value in the
-- same transaction that adds it, so this ADD VALUE must land (and commit) before
-- any migration/statement references 'New Part'. Keep it in its own migration
-- step; no data backfill (no existing rows are net-new).
ALTER TYPE "changeOrderChangeType" ADD VALUE 'New Part';
```

`changeOrderAffectedItem` field usage per change type (unchanged columns, new
interpretation for `New Part`):

| Field | Version | Revision | Replacement Part | **New Part** |
|---|---|---|---|---|
| `itemId` | the affected item | the affected item | the affected (source) item | **the minted new item** |
| `baseMakeMethodId` | source Active method | source Active method | source Active method | **null** (nothing copied) |
| `draftMakeMethodId` | new draft version | new revision's draft | new part's draft (copied) | **new part's empty draft** (Make) / null (Buy) |
| `newItemId` | null | new revision item | new part item | **the minted new item** (drives reveal) |
| cutover (`supersessionMode`, dates) | n/a | set | set | **n/a** (no predecessor) |

After the migration, run `pnpm run generate:types`; regenerate the
`changeOrderChangeTypes` const array + `ChangeOrderChangeType` type in
`items.models.ts` to match (`Version`, `Revision`, `Replacement Part`, `New Part`).

## API / Service Changes

All in the Items module's canonical files (per the one-service/models/server
convention — no `changeOrder.*` files).

- **`items.models.ts`** — `changeOrderChangeTypes` becomes `["Version",
  "Revision", "Replacement Part", "New Part"]`. Add a validator for the new-part
  add form (`changeOrderNewPartValidator`: `readableId?`, `name`, `type`
  ∈ {Part, Tool}, `replenishmentSystem` ∈ {Buy, Make, Buy and Make}).
- **`items.service.ts`**
  - `createChangeOrderDraftMethod` — the existing `changeType === "New Part"`
    branch (copy-from-source + mint derived number) is **renamed** to
    `"Replacement Part"` (logic unchanged, incl. `getNextItemIdFromSource` and
    the Parts/Tools guard). Add a **new** `"New Part"` branch: mint an inactive
    item (auto number from the type sequence or the supplied override), create an
    **empty** CO-owned draft `makeMethod` when Make (none for Buy), stamp
    `changeOrderId`, write draft refs (`newItemId = itemId = minted id`,
    `baseMakeMethodId = null`).
  - `addChangeOrderAffectedItem` — accept a `newPart?: {...}` payload; when
    present, mint the item first (via `createChangeOrderDraftMethod`'s New Part
    path) and insert the affected-item row with `changeType = 'New Part'`. The
    existing "must be an existing itemId" path is unchanged for the other types.
  - `updateChangeOrderAffectedItemChangeType` — reject transitions into or out of
    `New Part`; the picker only exposes {Version, Revision, Replacement Part}.
  - Every `=== "New Part"` string branch (currently meaning *replacement*) is
    audited and updated to `"Replacement Part"`; genuinely-net-new logic lives in
    the new `"New Part"` branches. (`grep -rn '"New Part"'` before/after.)
- **`items.server.ts`** — `releaseAffectedItem`:
  - Change the supersession guard from `if (changeType !== "Version" &&
    newItemId)` to only Revision + Replacement Part; `New Part` reveals its item
    (active + `changeOrderId` stamp) and activates its draft **without**
    supersession.
  - `applyChangeOrder` orders releases so a New Part affected item is revealed
    before any assembly (Version/Revision) affected item whose BOM references it;
    keep the per-item idempotency (a released draft has `changeOrderId` cleared).
- **Where-used** — reuse `getPartUsedIn` to compute, for each **removed** BOM line
  on an assembly draft, whether the component is still used by *other* parents
  (count excluding the assembly being edited). No new service; a thin wrapper /
  the existing `impactUsedIn` loader data on the CO `$id` route.

## UI Changes

- **Add-affected-item flow** (`AffectedItemForm.tsx`) — add a **change-type
  `Select`** at the top of the modal (Version / Revision / Replacement Part /
  New Part) as the single control that drives the form: Version/Revision/
  Replacement Part reveal today's `<Item>` picker over existing Parts/Tools;
  **New Part** reveals a minimal new-part mini-form (auto-minted readableId with
  override via `useNextItemId`, name, type Part/Tool, replenishment Buy/Make).
  Posts to `path.to.changeOrderAffected`; the action branches on `changeType`
  (New Part → `changeOrderNewPartValidator` + mint; others → existing path).
  This replaces the old add-then-switch-type default and makes the change type
  explicit at add time.
- **Change-type picker** (`AffectedItemDetail.tsx`) — rename the `New Part`
  option label to **Replacement Part**; the picker for an existing affected item
  offers {Version, Revision, Replacement Part} only. A `New Part` line shows its
  type as a read-only "New Part" (no switcher).
- **Affected-item detail for New Part** — reuse `PartProperties` (attributes) and,
  for Make, `BillOfMaterial`/`BillOfProcess`; **hide** the cutover/Part
  Supersession card (extend `showCutover` to also exclude `New Part`), since there
  is no predecessor. Part number editable (fresh number), like today's New Part.
- **Badge** (`ChangeTypeBadge.tsx`) — labels: `Version N`, `New Revision`
  (existing), **`Replacement`** for Replacement Part, **`New`** for New Part
  (green). Reserve the plain "New" for the genuinely-new type.
- **Assembly BOM editor within a CO** (`BillOfMaterial.tsx`) — the add-material
  `<Item>` picker must be able to reference the current CO's **New Part** draft
  items (inactive). Include the CO's New Part drafts in the pickable set for an
  affected-assembly draft BOM.
- **Removed-component where-used** — on the assembly's authoring diff
  (`ChangeOrderDiffViewer` removed rows / the affected-item `AffectedItemDetail`),
  show a small "used in N other assemblies" indicator per removed component,
  linking to that part's where-used. No obsolete action in v1.
- **Explorer** (`ChangeOrderExplorer.tsx`) — a New Part row shows "NEW → {minted
  number}" (no "OLD →"), consistent with the existing OLD→NEW rows.

## Acceptance Criteria

- [ ] The change-type enum reads `Version, Revision, Replacement Part, New Part`;
      an existing CO whose affected item was `New Part` now displays
      **Replacement Part** with its `affectedPart → newPart` supersession intact
      after release (behavior unchanged, label changed).
- [ ] From a change order, "Create new part" mints an inactive Part with an
      auto-minted number (overridable), adds it as a **New Part** affected item
      with its own explorer row and draft; the affected-item detail shows
      attributes and (for Make) empty BOM/BOP editors and **no** cutover card.
- [ ] Releasing a CO with a **New Part** activates the new item (`active = true`,
      `changeOrderId` stamped) and its draft method, and writes **no**
      `itemSupersession` for it; the item appears as a normal active part.
- [ ] Consolidation end-to-end: on an assembly, a Version change removes 3
      component lines and adds a line referencing a New Part (added in the same
      CO); the CO's Changes diff shows `−`×3 and `+`×1; after release the
      assembly's active method has the new BOM and the 3 removed parts are
      untouched everywhere else (no supersession redirect fires for them in
      `get-method`/MRP).
- [ ] The change-type switcher on an existing affected item cannot select
      `New Part`; a `New Part` affected item cannot be switched to another type.
- [ ] Each removed component on the assembly diff shows how many other assemblies
      still use it (where-used), with no auto-obsolete action taken.
- [ ] `New Part` is rejected for Materials/Consumables/Services.
- [ ] Typecheck, biome, and the items unit tests pass; `diffMethod` add/remove
      classification is covered by a test for the consolidation case.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| The string `'New Part'` currently means *replacement*; after migration it means *net-new*. Missed branches silently change behavior. | High | Enumerate every `=== "New Part"` / `"New Part"` literal (grep) and re-point to `"Replacement Part"`; add the net-new branches separately. Cover with the acceptance test that an old New Part still supersedes as "Replacement Part". |
| Postgres `ADD VALUE` can't be used in the same txn that references it. | Med | Land RENAME + ADD in a migration that does not itself reference the new value; regenerate types after apply. |
| Assembly BOM editor can't pick an inactive New Part draft, breaking consolidation. | Med | Explicitly include the CO's New Part drafts in the affected-assembly BOM item picker; inactive items are already legal BOM components. |
| Release ordering: assembly method activates while its New Part is still inactive. | Med | `applyChangeOrder` reveals New Part affected items before assembly affected items; idempotent per item on retry. |
| Scope creep into global mass-replace / auto-obsolete. | Low | Explicitly out of scope for v1 (research: local per-BOM replace + manual obsolete is the norm). |
| Renaming a live enum value touches the `changeOrders` view / generated types. | Low | Enum value rename does not change columns; `CREATE OR REPLACE`/regen only if a view string-matches the value (none do); run `generate:types`. |

## Open Questions

> Resolved with the user before writing (Step 5). Audit trail — all answered.

- [x] **New Part item scope: Make + Buy, or Buy-only for v1?** — **Answer:**
      **Make + Buy.** Reuses the existing embedded BOM/BOP editors; the delta is
      an empty draft method vs a copied one. Lets the consolidated "1" be a make
      sub-assembly.
- [x] **Can a CO add a New Part standalone (no assembly change)?** — **Answer:**
      **Yes.** A New Part can be introduced on its own; consolidation is New Part
      + an assembly Version change bundled. Also supports plain "new part under an
      ECO".
- [x] **Name for the renamed 1:1-supersession type?** — **Answer:**
      **Replacement Part.** Industry-legible (Replace/Supersede vocabulary);
      reads clearly beside Version/Revision/New Part.
- [x] **What does v1 do about components removed from the assembly's BOM?** —
      **Answer:** **Show where-used, manual obsolete.** Surface where the removed
      parts are used elsewhere (reuse `getPartUsedIn`); never auto-obsolete —
      matches every surveyed system.

## Changelog

- 2026-07-19: Created. Research (`.ai/research/2026-07-19-co-part-consolidation.md`,
  11 PLM/ERP systems) + 4 open questions resolved with the user before writing.
