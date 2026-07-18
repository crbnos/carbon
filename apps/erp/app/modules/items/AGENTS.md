# Items Module

Master data for all item types (Parts, Materials, Tools, Consumables, Services), bill of materials (make methods), unit of measure management, material taxonomy, item costing, shelf life, configurations, supersessions, pick methods, and item posting groups.

## Key Domain Concepts

- **Item Types** — Parts (manufactured/purchased goods), Materials (raw materials with taxonomy), Tools, Consumables, Services. All share the `item` table; type-specific tables (`part`, `material`, `tool`, `consumable`, `service`) extend it.
- **Make Method** — versioned manufacturing method on an item: BOM (`methodMaterial`) + routing (`methodOperation`). Statuses: Draft/Active/Archived. MUST create a new version instead of editing Active methods.
- **Material Taxonomy** — structured properties via FK relationships: `materialSubstance` (steel, aluminum), `materialForm` (sheet, plate, roundbar), `materialType`, `materialGrade`, `materialFinish`, `materialDimension`. Global rows (`companyId IS NULL`) are system-seeded.
- **Item Tracking Type** — `Inventory` (quantity only), `Serial` (unique per unit), `Batch` (lot-tracked), `Non-Inventory` (not stocked). Drives behavior in inventory, receipts, and picking.
- **Replenishment System** — `Buy`, `Make`, or `Buy and Make`. Drives MRP planning and method availability. `sourcingType` (`Specified`/`Drop Ship`/`Ship from Inventory`) is item-level and cascades to `methodMaterial` rows.
- **Shelf Life** — batch/serial items can have expiry tracking. Modes: Fixed Duration, Calculated, Set on Receipt.
- **Supersession** — item replacement chain for obsolete parts via `itemSupersession`.

## Safety

### Always
- MUST use `upsertMaterial` for material creation — it handles both `item` and `material` table inserts with `readableId` linkage.
- MUST remember: `material.id` = `item.readableId`, NOT `item.id`. Join via `readableId + companyId`.
- MUST use `assertMethodOperationIsDraft` before deleting method operations — Active/Archived methods are protected.
- MUST use `updateItemMethodAndSourcing` when changing `replenishmentSystem`, `defaultMethodType`, or `sourcingType` — it cascades to Draft method materials.

### Ask First
- Deleting items that have inventory, open POs, or active jobs — `item` FK has `ON DELETE RESTRICT` from `trackedEntity`.
- Changing `itemTrackingType` on items that already have tracked entities — use `cascadeItemTrackingType`.
- Modifying Active method versions — create a new version instead.

### Never
- Directly insert `material` rows without corresponding `item` rows.
- Assume `material` has an `itemId` column — it was dropped; linkage is `material.id = item.readableId`.
- Delete global taxonomy rows (`companyId IS NULL`) — they're system-seeded and shared across companies.
- Edit `methodMaterial.sourcingType`/`methodType` per-row — they're derived from the component item. Change sourcing on the item instead.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `item` | Universal item master: readableId, name, type, tracking, replenishment, UoM |
| `part` / `material` / `tool` / `consumable` / `service` | Type-specific extensions |
| `materialForm` / `materialSubstance` / `materialType` / `materialGrade` / `materialFinish` / `materialDimension` | Material taxonomy (global or company-scoped) |
| `makeMethod` | Versioned manufacturing method header (Draft/Active/Archived) |
| `methodMaterial` / `methodOperation` / `methodOperationStep` / `methodOperationParameter` / `methodOperationTool` | BOM lines, routing steps, and work instruction details |
| `itemCost` / `costLedger` | Standard/average costs and cost history |
| `itemReplenishment` / `itemPlanning` | Manufacturing settings (lot size, lead time, scrap %) and planning params |
| `itemPostingGroup` | Maps item categories to GL accounts |
| `unitOfMeasure` | UoM definitions |
| `configurationParameter` / `configurationRule` / `configurationParameterGroup` | Product configurator |
| `supplierPart` / `supplierPartPrice` | Supplier-item pricing with conversion factors and price breaks |
| `pickMethod` | Default storage unit and pick strategy per item/location |
| `itemShelfLife` | Shelf life tracking configuration per item |
| `itemSupersession` | Item replacement chains |

## Key Service Functions

- `getItem` / `getPart` / `getMaterial` / `getConsumable` / `getTool` / `getService` — item reads by type (RPCs `get_part_details`, `get_material_details`, `get_service_details`, etc.)
- `upsertService` — creates/updates a Service item; always `itemTrackingType = 'Non-Inventory'` (never shipped/received/stocked), replenishment `Buy` or `Make` only. The `service` row is keyed by `item.readableId` (like tool/material). Legacy `service.serviceType` is defaulted and no longer read.
- `upsertMaterial` — creates/updates material with taxonomy FKs and `item`/`material` linkage
- `getMakeMethods` / `getMethodMaterials` / `getMethodOperations` / `getMethodTreeArray` — BOM/routing reads
- `copyItem` / `copyMakeMethod` — duplicates via edge function
- `createRevision` / `activateMethodVersion` — revision and version management
- `updateItemMethodAndSourcing` — cascades replenishment/sourcing changes to Draft method materials
- `getItemCost` / `getItemQuantities` / `getItemDemand` / `getItemSupply` — cost and planning reads
- `getSupplierParts` / `getSupplierPriceBreaksForItems` / `lookupBuyPrice` — vendor pricing
- `upsertPickMethodWithShelfLife` — pick method with shelf life configuration
- `getConfigurationParameters` / `getConfigurationRules` — product configurator

## Key Exports

```typescript
import { getItem, upsertMaterial, getMakeMethods } from "~/modules/items";
import { itemValidator, itemTrackingTypes, itemReplenishmentSystems } from "~/modules/items";
```

## Change Orders (sub-area)

Engineering-change-order (ECO) workflow — a **top-to-bottom**, affected-items-first process: the user picks the parts/tools to change, sets a **per-item change type** (`Version` / `Revision` / `New Part`), edits each item's BOM/BOP/attributes directly on a **real CO-owned Draft `makeMethod`** (via the normal embedded editors), and releases the CO — which activates each draft and propagates via supersession. Lives **inside** the Items module (not a standalone module). Permission key is `parts` — loaders/actions use `requirePermissions(request, { view | update | delete | create: "parts" })`. Routes live under `apps/erp/app/routes/x+/items+/change-order+/` (detail + `affected`/`action` child mutations) and `x+/items+/change-orders+/` (list + Types config); URLs are `/x/items/change-order(s)…`. The **create form is the exception**: it lives at a top-level `apps/erp/app/routes/x+/change-order+/new.tsx` (URL `/x/change-order/new`, path helper `path.to.newChangeOrder`) so it renders with the app sidebar like `/x/part/new` and `/x/sales-order/new`, not nested under the Items module layout. Navigation is a "Change Orders" group in the Items sidebar (`useItemsSubmodules`). The `$id` **detail page uses the standard 3-pane detail convention** (`PanelProvider` + `ResizablePanels` from `~/components/Layout/Panels`, like sales-order / job): `ChangeOrderExplorer` (affected-items list) is the explorer, the `$id.details` Outlet (CO-wide stage flow + actions above the selected affected item's detail) is the content, and `ChangeOrderProperties` (fields + details + actions + impact + release dialog, self-contained via `useRouteData`) is the properties panel. `$id.tsx` keeps `hideModuleSidebar: true` so the Items grouped sidebar doesn't stack next to the explorer.

**No staged mirror tables.** The v1 `changeOrderStaged*` tables were deleted. A CO's per-affected-item edits now live on a **real Draft `makeMethod`** whose `makeMethod.changeOrderId` points at the CO (hidden from version lists until release), edited via the embedded real `BillOfMaterial` / `BillOfProcess` editors on the CO detail page.

Service code is split by concern (every file < 1000 lines, G4): `changeOrder.service.ts` (header CRUD + guarded stage transition + Types config + affected-item CRUD + the CO-owned Draft orchestration `createChangeOrderDraftMethod` / `addChangeOrderAffectedItem` / `updateChangeOrderAffectedItemChangeType` / cutover + `mintPlaceholderPart` + `getTopLevelProductsForItems` rollup), `changeOrder.diff.ts` (`diffMethod` pure engine + `getChangeOrderDiff` authoring-diff wrapper), `changeOrder.reads.ts` (item↔CO traceability reads + linked-NCR reverse), `changeOrder.actions.ts` (freeform action-task CRUD), `changeOrder.server.ts` (server-only: `applyChangeOrder` release orchestration + `releaseAffectedItem` + notifications), `changeOrder.models.ts` (validators + state machine + `changeOrderChangeTypes` + diff types). All non-server files are re-exported from the Items barrel — import from `~/modules/items`; the server file imports directly from `~/modules/items/changeOrder.server`.

**Approvals are not in V1.** No approval gate, reviewer/approval-task machinery, or toggle — stages advance freely; a CO reaches Done via `applyChangeOrder`. **Same-part parallel COs are now allowed** — the one-open-CO-per-part guard was dropped; `findOtherOpenChangeOrdersForItem` still exists but is advisory (no route/service enforces it).

### Key CO concepts

- **Stage flow** — `changeOrderStatus`: `Draft` → `Start` → `Engineering Complete` → `Implementation` → `Done`. Forward-only, one step (`changeOrderStatusTransitions` / `isAllowedChangeOrderTransition`). `isChangeOrderLocked(status)` is true only at `Done` (closed, read-only); `canEditChangeOrder` is its inverse. `changeOrderOpenStatuses` = every stage before Done. `Start`/`Implementation`/`Done` broadcast a team notification (`changeOrderBroadcastStages`).
- **Change type (capability matrix)** — `changeOrderAffectedItem.changeType` ∈ `Version | Revision | New Part` (`changeOrderChangeTypes`) drives both the editable surface and the release action:
  - `Version` — a new Draft method version on the **same item** (BoM/BoP edits); **no** supersession.
  - `Revision` — a new inactive revision item with **both BoM/BoP and attributes/docs**; the draft method is edited via the embedded `BillOfMaterial`/`BillOfProcess`, and the draft item's attributes + files via the embedded `PartProperties` (`embedded` variant) on the CO card; auto oldRev→newRev supersession at release. (BoM/BoP on a Revision was a client ask — a revision can carry a manufacturing change, not just a doc/spec change.)
  - `New Part` — a new part number derived from the affected part, BoM/BoP **and** attributes (embedded `PartProperties`); auto affectedPart→newPart supersession at release. Restricted to Parts + Tools (Materials/Consumables/Services rejected). Embedded attribute editing is currently wired for **Parts** only.
  - **Buy (purchased) items have no BoM/BoP** — `isManufactured = replenishmentSystem !== "Buy"` gates the embedded editors (mirrors the part page). `Version` is hidden from the change-type picker for Buy items, and `addChangeOrderAffectedItem` coerces a Buy item's default `Version` → `Revision` on add; the card shows a "purchased item — no BoM/BoP" note if a Buy item is on Version/New Part.
- **Draft creation (`createChangeOrderDraftMethod`, called by `addChangeOrderAffectedItem`)** — per change type: `Version` → `upsertMakeMethodVersion` + `copyMakeMethod` on the same item; `Revision` → `createRevision(active:false)`; `New Part` → mint a new numeric `readableId` + `copyItem`. The resulting Draft method's `changeOrderId` is stamped to the CO (and the new item's, for Revision/New Part). The draft refs (`draftMakeMethodId`, `baseMakeMethodId`, `newItemId`) are written back onto the affected-item row. **The Version draft is numbered `max(all versions)+1`, not `active+1`** (with a unique-violation retry) so parallel COs on the same part get distinct versions instead of colliding on `makeMethod (itemId, version)`. **Switching change type discards + recreates the draft** (`updateChangeOrderAffectedItemChangeType`), resetting edits. Removing an affected item discards its draft. A BOM line may forward-reference a not-yet-synced part, minted as a real inactive item (`mintPlaceholderPart`, G3).
- **Authoring diff (git-style end-state)** — `getChangeOrderDiff` + pure `diffMethod` (unit-tested in `changeOrder.diff.test.ts`) diffs the CO-owned Draft method against the **base Active method** the draft was copied from (both real methods), correlating rows by natural key (material → component `itemId`, operation → `order`, operation children → `name`/`key`/`toolId`) since the copied draft carries no back-pointer ids. Classifies each material/operation/attribute added/removed/modified/unchanged. Rendered **read-only** by `ChangeOrderReview` (shown during authoring, not just at release).
- **Release confirmation** — `ChangeOrderReleaseMerge` (properties panel, at Implementation) is a plain review-then-confirm dialog: it shows each affected item's authoring diff (`getChangeOrderDiff`) and posts Implementation → Done. **No merge/conflict step** — releasing a Version just appends a new Active version and archives the prior one, so a same-part parallel CO that released first is not clobbered (its version stays as method history). The old 2-way merge / conflict-resolver UI + `getChangeOrderReleaseDiff` / `reconcileDraftWithLive` were removed.
- **Release (`applyChangeOrder` → `releaseAffectedItem`)** — the Implementation → Done action. Dispatch by change type per affected item: `Version` activates the Draft (prior Active → Archived), no new item, no supersession; `Revision`/`New Part` activate the Draft, reveal the new item (`item.active = true`, stamp `item.changeOrderId`), and auto-write the affected→new `itemSupersession`. Final Kysely CAS flip to Done. Idempotent: a released draft has its `makeMethod.changeOrderId` cleared, so a re-run skips it.
- **Supersession propagation (no parent cascade)** — changing a component does **not** re-BOM its parents. Propagation is via supersession chains (`itemSupersession`): the auto affected→new cutover per Revision/New Part affected item. `item.changeOrderId` is the revision→CO back-link powering the "Created by CO-…" chip and part-side change history.
- **Impact panel** — read-only "where used" view: for each affected item, where it is referenced across the system (jobs, job materials, POs, receipts, sales orders, shipments, quotes, methods, NCRs, …), reusing the part detail page's `getPartUsedIn` data + the shared `UsedInItem` tree rows (`ImpactPanel` maps one where-used group per affected item; empty categories are dropped). Always shown in the properties panel. Loaded per affected item in the CO `$id` loader via `getPartUsedIn(client, affectedItem.itemId, companyId)` → `impactUsedIn`. (The old `getChangeOrderImpact` open-PO/jobs/sales table was removed.)
- **Linked NCR** — a CO may reference a non-conformance (`changeOrder.nonConformanceId`), cross-linked both ways with the Issue detail.

**Deferred (not yet built):** Embedded attribute editing for **Tool** Revision/New Part (Parts only today).

### CO Safety

- MUST advance stages only through `updateChangeOrderStatus` — the single guarded writer (forward-only + compare-and-swap on `fromStatus`).
- MUST check `isChangeOrderLocked(status)` (Done) before editing header/content.
- MUST add affected items through `addChangeOrderAffectedItem` — it spins the CO-owned Draft method and writes the draft refs back; a bare `changeOrderAffectedItem` insert leaves the diff/release with no draft to activate.
- MUST use `applyChangeOrder` (the Implementation → Done "release") for the release lifecycle — never re-implement `activateMethodVersion`/`itemSupersession` inline. It orchestrates canonical helpers via edge-function calls, so it is **not** one transaction (G2); only the final flip to Done is a Kysely CAS. It is idempotent per affected item (a Draft whose `changeOrderId` is already cleared is skipped) and CO-wide (the closing CAS on `status='Implementation'`).
- `findChangeOrdersForItem` (`changeOrder.reads.ts`) is G6 — the single canonical "change orders referencing this item" query (spans affected items, BOM components on CO-owned draft methods, manual supersession predecessor/successor, and the `item.changeOrderId` reverse link on released revisions), scoped by `readableId`. Flat queries + JS union (no PostgREST embeds — TS2589 budget). Powers the part/tool detail history + open-CO alert. Do not add a second query for this.
- Never scatter CO files — the concern-split set is `changeOrder.{service,diff,reads,actions,models,server}.ts`; add functions to the file that owns the concern, keep each < 1000 lines.

### CO data model

| Table / Column | Purpose |
|---|---|
| `changeOrder` | Header: `changeOrderId`, `name`, `status`, `changeOrderTypeId`, `type` (legacy), `priority`, `nonConformanceId`, dates, `assignee`, `reasonForChange`/`description` |
| `changeOrderType` | The "Category" lookup (configured like Issue Types) |
| `changeOrderAffectedItem` | The items the CO changes — user-selected first. Carries `changeType` (`Version`/`Revision`/`New Part`), the CO-owned Draft refs `draftMakeMethodId` + `baseMakeMethodId` (the source Active method), the revealed item `newItemId` (Revision/New Part; also the release idempotency marker), and cutover config (`supersessionMode`, `discontinuationDate`, `successorEffectivityDate`) |
| `makeMethod.changeOrderId` | Draft-method → CO link: a Draft `makeMethod` with a non-null `changeOrderId` is CO-owned + hidden from version lists; cleared at release |
| `changeOrderSupersession` | MANUAL different-part obsolescence declarations (`predecessorItemId` → `successorItemId`). **Table retained** (still read by `findChangeOrdersForItem`) but the create UI + CRUD were removed — no v2 path writes rows; the auto affected→new cutover covers same-part supersession |
| `changeOrderActionTask` | Freeform non-gating tasks (Actions) |
| `item.changeOrderId` | Revision/new-part → CO back-link, stamped at release; powers change history + revision-centric audit |

## Related Modules

- **purchasing** — supplier parts pricing; PO lines reference items; `conversionFactor` on `supplierPart`; CO impact panel reads open PO lines (`openPurchaseOrderLines`) for deleted parts
- **inventory** — quantities tracked per item/location; tracking type drives receipt/picking behavior
- **production** — jobs manufacture items; make methods copied to jobs via `get-method` edge function
- **sales** — quote lines and sales order lines reference items; `itemUnitSalePrice` is base price
- **accounting** — `itemPostingGroup` maps items to GL accounts
- **quality** — `requiresInspection` flag on items; inspection documents reference parts

## Rules References

- `.ai/rules/material-tables.md` — material taxonomy schema, linkage, and the `material.id = item.readableId` gotcha
- `.ai/rules/method-material-sourcing.md` — how methods determine Buy/Make/Pull sourcing and cascade rules
