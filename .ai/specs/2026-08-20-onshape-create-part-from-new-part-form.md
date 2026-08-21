# Create a part from Onshape in the New Part form

> Status: draft — scoped 2026-08-20, not started
> Author: Raul Soonawala
> Date: 2026-08-20

## TLDR

Fold "From Onshape" into the New Part form so one submission creates the Carbon part, imports its
BOM, and pulls the CAD assets. Today those are three surfaces: `OnshapeCreatePart` (a modal with
two bare Comboboxes, reachable from the Parts table), `OnshapeBomImport` (only on an item that
already exists), and the asset pull that each of them queues separately. The mechanism for all
three already exists and is verified; what is missing is a single entry point that sequences them
and a form that lets Onshape own the identity while Carbon's own fields are filled in normally.

Prerequisite: Onshape v2 (`pipeline: "next"`). On a legacy company none of this renders.

## Problem Statement

- A part created from Onshape today gets Onshape's number, revision, name and model, and NOTHING
  else. `OnshapeCreatePart` collects replenishment system, default method type and tracking type
  through two hand-rolled Comboboxes and hardcodes `unitOfMeasureCode: "EA"`, `unitCost: 0`,
  `lotSize: 0`, `description: ""`. Item posting group, storage, tags and custom fields are not
  collected at all. `PartForm` already collects every one of them.
- An assembly created from Onshape arrives EMPTY. Its BOM is a second, manual trip: open the item,
  find the BoM explorer, run `OnshapeBomImport` against the draft method. Nothing on the created
  item says a BOM is available.
- The two surfaces have diverged in how they treat the same decisions. `OnshapeCreatePart` seeds
  replenishment from the element type (assembly → Make); `onshape-bom-import` derives it for MINTED
  children from whether the row has children. Same question, two implementations.

## What already exists (verified in code 2026-08-20)

| Piece | Where | State |
|---|---|---|
| Released-revision picker | `OnshapeRevisionPicker` | reusable as-is; `hideLinked`, `onlyElementType` |
| Unreleased picker (document → version → assembly) | `OnshapeUnreleasedPicker` | reusable; gated on `allowUnreleasedSync` |
| Create + link + revision provenance + asset queue | `integrations.onshape.v2.create.ts` | complete |
| BOM import validation + link + job dispatch | `integrations.onshape.v2.import.ts` | complete, needs a `makeMethodId` |
| The BOM walk itself | `onshape-bom-import.ts` | complete, incl. its own asset pull |

**The join between create and import is already free.** Every `item` insert of type Part, Tool or
Service fires `sync_create_make_method_related_records`, which inserts a Draft `makeMethod`
(migration `20260707022141`). So the `makeMethodId` that `v2.import` requires exists the instant
`upsertPart` returns — no new table, no new column, no ordering problem.

## Proposed Solution

One server action, not client-side chaining of the two existing routes. Extend `v2.create` (or add
a sibling that reuses its body) to accept the full `partValidator` payload plus an optional
`importBom` flag, and have it queue the BOM import itself once the part and both mappings exist.

Client-side chaining is the tempting shape and is wrong: a closed tab between step one and step two
leaves a linked part with no BOM and nothing recording that one was wanted.

`PartForm` grows a source toggle — Blank | From Onshape. Picking From Onshape opens the existing
picker; the selection then locks the identity fields and the rest of the form is filled in as
normal.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where the flow lives | Inside `PartForm`, replacing the `OnshapeCreatePart` modal | The modal re-implements three fields the form already has and cannot reach the other twelve |
| Server shape | ONE action that creates, links, and queues the import | A tab closed mid-flow must not leave a part that silently never gets its BOM |
| Identity fields | Read-only once a selection exists | Onshape owns number, revision and name; `v2.create` re-resolves them against Onshape and persists ITS values regardless of what the form posts |
| Model dropzone | Hidden under an Onshape selection | `attachOnshapeAssetsToItem` compare-and-sets `item.modelUploadId` against the model it read at start, so a hand-uploaded model is overwritten by the Onshape pull and filed away as a document |
| Asset pull | Import path only, when a BOM import runs | `onshape-bom-import.ts:1022` already pulls the top-level item's own model; also queuing `onshape-v2-item-assets` double-exports the same element against a rate-limited API |
| BOM option availability | Assemblies only (`elementType === 1`) | A Part Studio body has no bill of materials; the picker already supports `onlyElementType: 1` |
| Replenishment when importing a BOM | Force Make / Make to Order | `methodMaterial.methodType` is denormalized from the component's `defaultMethodType`, so a BOM under a Buy part writes a sub-tree that never explodes |

## API / Service Changes

- `integrations.onshape.v2.create.ts` — accept the `partValidator` fields the form already posts
  (description, posting group, unit cost, lot size, storage, tags, custom fields) instead of the
  current four, plus `importBom`. Keep the existing duplicate refusals, the `resolveOnshapeRevision`
  re-check, and both mapping writes unchanged.
- After the mappings, read the auto-created Draft `makeMethod` for the new item and dispatch the
  same `trigger("onshape-bom-import", …)` payload `v2.import` builds. Skip `onshape-v2-item-assets`
  on that branch.
- No data model changes. No migration.

## UI Changes

- `PartForm` — a source toggle, the picker mount, identity fields read-only under a selection,
  `useNextItemId` bypassed, dropzone hidden, an "import the bill of materials" checkbox shown only
  for an assembly selection.
- `PartsTable` — the separate "From Onshape" button becomes redundant; decide whether to keep it as
  a shortcut into the same form or drop it.
- The created part needs an in-progress affordance (see the async gap below).

## The five constraints that decide the design

1. **BOM only for an assembly.** Part Studio bodies have no BOM.
2. **A BOM on a Buy part is a trap.** See the denormalization note above.
3. **Never queue both asset paths.** The import already pulls the top-level model.
4. **Permissions diverge.** Creating a part needs `create: parts`; the BOM import needs `create` +
   `update` + `delete` (it mints parts and deletes material lines). A create-only user must see the
   BOM option disabled UP FRONT, not fail after the part is already made.
5. **The import is asynchronous.** The form redirects to a part whose BOM lands seconds to minutes
   later, and the outcome only surfaces as an in-app notification when `countNeedingAttention > 0`.
   Without an in-progress affordance on the item, a clean import is indistinguishable from one that
   never started. This is the one genuinely new piece of UX in the feature.

## Open Questions

- **Must the Carbon part number be Onshape's?** `v2.create` writes `onshapeRevision.partNumber` as
  `readableId` today. The mapping makes the number a label, so Carbon's own sequence would work —
  but changing it touches the link route, release import, and the BOM import's family probe, all of
  which resolve a family by `readableId`.
- **Which item types?** Only Part, Tool and Service get an automatic `makeMethod`, so the BOM half
  cannot extend to Materials or Consumables. Parts-only for v1 unless there is a real Tool case.
- **Keep or drop the Parts-table "From Onshape" button** once the form covers it.

## Acceptance Criteria

- [ ] With v2 enabled, New Part offers an Onshape source; with legacy or no integration, it does not
- [ ] Selecting a released revision locks number, revision and name, and leaves every other field editable
- [ ] Submitting creates the part, both mappings, and (for an assembly with the box ticked) queues the BOM import in one action
- [ ] A create-only user sees the BOM option disabled with a reason, and the part still creates
- [ ] Exactly one asset path runs per creation — never both
- [ ] The created part shows that an import is running, and says so when it finishes
- [ ] An element already linked to another Carbon item is refused at SELECTION time, not after the form is filled in
