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

Engineering-change-order (ECO) workflow — a **top-to-bottom**, affected-items-first process: the user picks the parts/tools to change, sets a **per-item change type** (`Version` / `Revision` / `Replacement Part` / `New Part`), edits each item's BOM/BOP/attributes directly on a **real CO-owned Draft `makeMethod`** (via the normal embedded editors), and releases the CO — which activates each draft and propagates via supersession (except a net-new `New Part`, which has no predecessor). Lives **inside** the Items module (not a standalone module). Permission key is `parts` — loaders/actions use `requirePermissions(request, { view | update | delete | create: "parts" })`. Routes live under `apps/erp/app/routes/x+/items+/change-order+/` (detail + `affected`/`action` child mutations) and `x+/items+/change-orders+/` (list + Types config); URLs are `/x/items/change-order(s)…`. The **create form is the exception**: it lives at a top-level `apps/erp/app/routes/x+/change-order+/new.tsx` (URL `/x/change-order/new`, path helper `path.to.newChangeOrder`) so it renders with the app sidebar like `/x/part/new` and `/x/sales-order/new`, not nested under the Items module layout. Navigation is a "Change Orders" group in the Items sidebar (`useItemsSubmodules`). The `$id` **detail page uses the standard 3-pane detail convention** (`PanelProvider` + `ResizablePanels` from `~/components/Layout/Panels`, like sales-order / job): `ChangeOrderExplorer` (affected-items list) is the explorer, the content is a URL-addressed `Outlet`, and `ChangeOrderProperties` (header fields + affected assemblies + impact + release dialog, self-contained via `useRouteData`) is the properties panel. `$id.tsx` keeps `hideModuleSidebar: true` so the Items grouped sidebar doesn't stack next to the explorer. **The content follows the sales-order top-level-detail + line-route split:** `$id.details.tsx` is the **CO overview** (the `ChangeOrderStatusFlow` state bar + the two rich-text narrative fields `reasonForChange` / `description` via `ChangeOrderContent`, edited exactly like the quality issue's description — debounced direct `carbon.from("changeOrder").update` of tiptap JSON — plus the **CO-wide Changes rollup** (`ChangeOrderChanges` — every affected item's authoring diff, rendered between the description and the actions, same label+`ChangeOrderDiffViewer` list as the release dialog) and the action tasks via the shared `ActionTaskList` + "Add Actions" modal, reconciled through `$id.action`); each affected item is its own **line route** `$id.$affectedId.details.tsx` (URL `/x/items/change-order/$id/$affectedId/details`, `path.to.changeOrderAffectedItem`, rendering `AffectedItemDetail`), linked from the explorer (Revision / Replacement Part rows show "OLD → NEW" with the minted item's number, resolved from the items store; a **New Part shows a single id** — it is net-new, so its `newItemId` equals its `itemId` and there is no predecessor to arrow from, guarded by `newItemId !== itemId`). **Purchasable draft items get supplier-part management on the line**: a Revision/New Part line whose draft part is `Buy`/`Buy and Make` renders the embedded `SupplierParts` grid (data from `partData.supplierParts`, already in the `$id` loader); its create/edit drawers are child routes `$id.$affectedId.details.new.tsx` / `$id.$affectedId.details.$supplierPartId.tsx` (the `SupplierPartForm` posts to the PART purchasing actions — the part edit action returns `{ success }` instead of redirecting so embedded callers stay put), and delete is the action-only `$id.$affectedId.details.$supplierPartId.delete.tsx` (`path.to.changeOrderDeleteSupplierPart`). `$id._index` redirects to the overview; the header CO-id links back to it. Plain-text reason/description entered on the create form are converted to tiptap JSON on insert (`toRichText` in `x+/change-order+/new.tsx`).

**No staged mirror tables.** The v1 `changeOrderStaged*` tables were deleted. A CO's per-affected-item edits now live on a **real Draft `makeMethod`** whose `makeMethod.changeOrderId` points at the CO, edited via the embedded real `BillOfMaterial` / `BillOfProcess` editors on the CO detail page. The **same** draft method also surfaces on the affected item's own master page (`/x/part|tool/$itemId/details`): the item-detail loaders (`x+/part+/$itemId{.,}.tsx`, `x+/tool+/$itemId.details.tsx`) select it like any other method and **no longer exclude `changeOrderId`-stamped drafts**, so a revision/new-part item created by an open CO shows its BOM/BOP on the item master too — the two surfaces edit the same rows and stay in sync. (`Active` is still preferred as the default selection, so a `Version` CO's existing item keeps its live method by default.) `changeOrderId` is cleared at release.

Change-order code follows the one-service/models/server-per-module convention — it lives in the module's canonical files, NOT separate `changeOrder.*` files: `items.service.ts` holds header CRUD + guarded stage transition + Types config + affected-item CRUD + the CO-owned Draft orchestration (`createChangeOrderDraftMethod` / `addChangeOrderAffectedItem` / `updateChangeOrderAffectedItemChangeType` / cutover + `mintPlaceholderPart` + `getTopLevelProductsForItems` rollup) + the `diffMethod` pure engine + `getChangeOrderDiff` authoring-diff wrapper + item↔CO traceability reads (`findChangeOrdersForItem`, linked-NCR reverse) + freeform action-task CRUD; `items.server.ts` holds the server-only release path (`applyChangeOrder` orchestration + `releaseAffectedItem` + notifications); `items.models.ts` holds the validators + state machine + `changeOrderChangeTypes` + diff types. Non-server exports come through the Items barrel — import from `~/modules/items`; the server file is imported directly from `~/modules/items/items.server`.

**Approvals are not in V1.** No approval gate, reviewer/approval-task machinery, or toggle — stages advance freely; a CO reaches Done via `applyChangeOrder`. **Same-part parallel COs are now allowed** — the one-open-CO-per-part guard was dropped; `findOtherOpenChangeOrdersForItem` still exists but is advisory (no route/service enforces it).

### Key CO concepts

- **Stage flow** — `changeOrderStatus`: `Draft` → `Start` → `Engineering Complete` → `Implementation` → `Done`. Forward-only, one step (`changeOrderStatusTransitions` / `isAllowedChangeOrderTransition`). `isChangeOrderLocked(status)` is true only at `Done` (closed, read-only); `canEditChangeOrder` is its inverse. `changeOrderOpenStatuses` = every stage before Done. `Start`/`Implementation`/`Done` broadcast a team notification (`changeOrderBroadcastStages`).
- **Change type (capability matrix)** — `changeOrderAffectedItem.changeType` ∈ `Version | Revision | Replacement Part | New Part` (`changeOrderChangeTypes`) drives both the editable surface and the release action. Two axes: *is there a predecessor* and *same part number*. The **Add Affected Item** modal (`AffectedItemForm`) is **Parts-only**: the existing-item picker filters to `validItemTypes={["Part"]}` and the New Part mini-form always mints a Part — no Tool path in the UI (the service's `addChangeOrderAffectedItem`/`createChangeOrderDraftMethod` still technically accept Tools, but no route surfaces them). The modal's two branches (New Part vs existing-item) are separate `ValidatedForm`s that MUST carry distinct `key` props — same-slot same-type reconciliation would otherwise share one RVF store, hydrating controlled-field defaults only for whichever branch mounts first (New Part's replenishment/tracking Selects would then submit `""` → enum error).
  - `Version` — a new Draft method version on the **same item** (BoM/BoP edits); **no** supersession.
  - `Revision` — a new inactive revision item (same #, new rev) with **both BoM/BoP and attributes/docs**; the draft method is edited via the embedded `BillOfMaterial`/`BillOfProcess`, and the draft item's attributes + files via the embedded `PartProperties` (`embedded` variant) on the CO card; auto oldRev→newRev supersession at release. (BoM/BoP on a Revision was a client ask — a revision can carry a manufacturing change, not just a doc/spec change.) The **Add Affected Item** modal shows a `revision` text input for a Revision change so the user can name the revision (e.g. `A`); blank → `createChangeOrderDraftMethod` auto-computes the next revision via `getNextRevision`. (The optional `revision` threads validator → `$id.affected` route → `addChangeOrderAffectedItem` → `createChangeOrderDraftMethod`.)
  - `Replacement Part` — a new part **number** derived from the affected part, BoM/BoP **and** attributes (embedded `PartProperties`); auto affected→new supersession at release. The 1:1 replacement (renamed from the old "New Part"). Restricted to Parts. Embedded attribute editing is currently wired for **Parts** only.
  - `New Part` — a **net-new** part (no predecessor, **no supersession**) minted + released under the CO (Make or Buy). Used to introduce a part under change control, including the consolidated "1" in an N→1 assembly BOM change. Added via the "Add Affected Item" modal's change-type Select → create-new-part mini-form (`changeOrderNewPartValidator` — Part Number, Name, Replenishment System, Tracking Type; **no Part/Tool choice — always a Part**; `addChangeOrderAffectedItem`'s `newPart` path mints the item with the chosen `itemTrackingType`). Its type **cannot** be switched (net-new by construction), and it shows no cutover card. Restricted to Parts.
  - **Buy (purchased) items have no BoM/BoP** — `isManufactured = replenishmentSystem !== "Buy"` gates the embedded editors (mirrors the part page). `Version` is hidden from the change-type picker for Buy items, and `addChangeOrderAffectedItem` coerces a Buy item's default `Version` → `Revision` on add. Complementarily, the Add Affected Item item picker restricts to **Make parts** (`Item` `replenishmentSystem="Make"` → `Make` or `Buy and Make`) whenever the selected change type is `Version`, so a Buy part can't be picked for a Version in the first place; other change types show all Parts.
- **Draft creation (`createChangeOrderDraftMethod`, called by `addChangeOrderAffectedItem`)** — per change type: `Version` → `upsertMakeMethodVersion` + `copyMakeMethod` on the same item; `Revision` → `createRevision(active:false)`; `Replacement Part` → mint a new numeric `readableId` derived from the source (`getNextItemIdFromSource`) + `copyItem`; `New Part` → the item is minted by `addChangeOrderAffectedItem`'s `newPart` path (net-new, no source copy), and this just stamps its trigger-created Draft method CO-owned (`baseMakeMethodId` null). The resulting Draft method's `changeOrderId` is stamped to the CO (and the new item's, for Revision/Replacement Part/New Part). The draft refs (`draftMakeMethodId`, `baseMakeMethodId`, `newItemId`) are written back onto the affected-item row. **The Version draft is numbered `max(all versions)+1`, not `active+1`** (with a unique-violation retry) so parallel COs on the same part get distinct versions instead of colliding on `makeMethod (itemId, version)`. **Switching change type discards + recreates the draft** (`updateChangeOrderAffectedItemChangeType`), resetting edits — but a `New Part` cannot be switched to/from. Removing an affected item discards its draft. (`mintPlaceholderPart` exists but is **not wired** into any current path — the old G3 forward-reference claim is stale.)
- **Authoring diff (git-style end-state)** — `getChangeOrderDiff` + pure `diffMethod` (unit-tested in `changeOrder.diff.test.ts`) diffs the CO-owned Draft method against the **base Active method** the draft was copied from (both real methods), correlating rows by natural key (material → component `itemId`, operation → `order`, operation children → `name`/`key`/`toolId`) since the copied draft carries no back-pointer ids. Classifies each material/operation/attribute added/removed/modified/unchanged. For a Revision/Replacement Part/New Part draft item it also surfaces the draft's **supplier parts** as additions — the source item's suppliers are NOT copied to the draft, so `getChangeOrderDiff` (via `readDraftSupplierParts`) emits each `supplierPart` row as `added`; a `Version` shares the live item's suppliers and shows none. Rendered **read-only** by `ChangeOrderDiffViewer` — the single diff renderer, reused by the affected-item "Changes" card (`AffectedItemDetail`), the CO-wide `ChangeOrderChanges` rollup on the overview, and the release dialog (shown during authoring, not just at release).
- **Release confirmation** — `ChangeOrderReleaseMerge` (properties panel, at Implementation) is a plain review-then-confirm dialog: it shows each affected item's authoring diff (`getChangeOrderDiff`) and posts Implementation → Done. **No merge/conflict step** — releasing a Version just appends a new Active version and archives the prior one, so a same-part parallel CO that released first is not clobbered (its version stays as method history). The old 2-way merge / conflict-resolver UI + `getChangeOrderReleaseDiff` / `reconcileDraftWithLive` were removed.
- **Release (`applyChangeOrder` → `releaseAffectedItem`)** — the Implementation → Done action. Dispatch by change type per affected item: `Version` activates the Draft (prior Active → Archived), no new item, no supersession; `Revision`/`Replacement Part` activate the Draft, reveal the new item (`item.active = true`, stamp `item.changeOrderId`), and auto-write the affected→new `itemSupersession`; `New Part` activates the Draft + reveals the net-new item but writes **no** supersession (no predecessor). `applyChangeOrder` releases **New Part items first** (stable sort) so a parent assembly's BOM line resolves to an already-active new part. Final Kysely CAS flip to Done. Idempotent: a released draft has its `makeMethod.changeOrderId` cleared, so a re-run skips it.
- **Supersession propagation (no parent cascade)** — changing a component does **not** re-BOM its parents. Propagation is via supersession chains (`itemSupersession`): the auto affected→new cutover per Revision/Replacement Part affected item (a net-new New Part has no predecessor, so no supersession). **N→1 consolidation** ("3 parts become 1") is modeled as a parent-assembly `Version`/`Revision` change whose draft BOM removes the old component lines and adds a `New Part` line — surfaced by `diffMethod` as removed + added, **not** as supersessions. `item.changeOrderId` is the revision→CO back-link powering the "Created by CO-…" chip and part-side change history.
- **Impact panel** — read-only "where used" view: for each affected item, where it is referenced across the system (jobs, job materials, POs, receipts, sales orders, shipments, quotes, methods, NCRs, …), reusing the part detail page's `getPartUsedIn` data + the shared `UsedInItem` tree rows (`ImpactPanel` maps one where-used group per affected item; empty categories are dropped). Always shown in the properties panel. Loaded per affected item in the CO `$id` loader via `getPartUsedIn(client, affectedItem.itemId, companyId)` → `impactUsedIn`. (The old `getChangeOrderImpact` open-PO/jobs/sales table was removed.)
- **Linked NCR** — a CO may reference a non-conformance (`changeOrder.nonConformanceId`), cross-linked both ways with the Issue detail.
- **Change-orders list** (`ChangeOrdersTable`, `x+/items+/change-orders+/_index.tsx`) — reads the `changeOrders` view. Rows are **expandable** (`renderExpandedRow`/`canExpandRow`, storage-units spine style) to reveal each affected item (readableId + `ChangeTypeBadge` + OLD→NEW for Revision/Replacement Part; a New Part shows a single id — net-new, `newItemId === itemId`), and an **Item** filter (`isArray` static filter → `filter=itemIds:contains:<id>` → `.overlaps("itemIds", …)`) narrows COs to those affecting the selected items. The `itemIds` column is hidden by default (`defaultColumnVisibility`) — it still drives the filter and CSV export.

**Deferred (not yet built):** Tool affected items — the Add Affected Item modal is Parts-only, so there is no UI path to add a Tool (or edit Tool attributes) under a CO today, even though the service layer still accepts Tools.

### CO Safety

- MUST advance stages only through `updateChangeOrderStatus` — the single guarded writer (forward-only + compare-and-swap on `fromStatus`).
- MUST check `isChangeOrderLocked(status)` (Done) before editing header/content.
- MUST add affected items through `addChangeOrderAffectedItem` — it spins the CO-owned Draft method and writes the draft refs back; a bare `changeOrderAffectedItem` insert leaves the diff/release with no draft to activate.
- MUST use `applyChangeOrder` (the Implementation → Done "release") for the release lifecycle — never re-implement `activateMethodVersion`/`itemSupersession` inline. It orchestrates canonical helpers via edge-function calls, so it is **not** one transaction (G2); only the final flip to Done is a Kysely CAS. It is idempotent per affected item (a Draft whose `changeOrderId` is already cleared is skipped) and CO-wide (the closing CAS on `status='Implementation'`).
- `findChangeOrdersForItem` (in `items.service.ts`) is G6 — the single canonical "change orders referencing this item" query (spans affected items, BOM components on CO-owned draft methods, manual supersession predecessor/successor, and the `item.changeOrderId` reverse link on released revisions), scoped by `readableId`. Flat queries + JS union (no PostgREST embeds — TS2589 budget). Powers the part/tool detail history + open-CO alert. Do not add a second query for this.
- Never split CO code into separate `changeOrder.*` service/models/server files — it lives in the module's canonical `items.service.ts` / `items.models.ts` / `items.server.ts` (the one-service/models/server-per-module convention). Add CO functions there, alongside the rest of the items module.

### CO data model

| Table / Column | Purpose |
|---|---|
| `changeOrder` | Header: `changeOrderId`, `name`, `status`, `changeOrderTypeId`, `type` (legacy), `priority`, `nonConformanceId`, dates, `assignee`, `reasonForChange`/`description` |
| `changeOrders` (view) | List-view rollup of `changeOrder` + `itemIds` (text[] of affected item ids — powers the list's **Item** filter via `.overlaps`) + `affectedItems` (jsonb `{id,itemId,changeType,newItemId}[]` — powers the list's **expandable rows**). `getChangeOrders` reads this view (not the base table); the single-CO `getChangeOrder` still reads the base table, so `ChangeOrder` (list, nullable view cols) and the detail shape are distinct types (`ChangeOrderListItem` vs `ChangeOrder`) |
| `changeOrderType` | The "Category" lookup (configured like Issue Types) |
| `changeOrderAffectedItem` | The items the CO changes — user-selected first (or minted, for a net-new `New Part`). Carries `changeType` (`Version`/`Revision`/`Replacement Part`/`New Part`), the CO-owned Draft refs `draftMakeMethodId` + `baseMakeMethodId` (the source Active method; null for a net-new `New Part`), the revealed item `newItemId` (Revision/Replacement Part/New Part; also the release idempotency marker), and cutover config (`supersessionMode`, `discontinuationDate`, `successorEffectivityDate` — not used by `New Part`) |
| `makeMethod.changeOrderId` | Draft-method → CO link: a Draft `makeMethod` with a non-null `changeOrderId` is CO-owned. Shown/edited both in the CO workspace and on the affected item's own master page (item-detail loaders select it in sync — they do **not** exclude `changeOrderId` drafts); cleared at release |
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

- `.claude/rules/material-tables.md` — material taxonomy schema, linkage, and the `material.id = item.readableId` gotcha
- `.claude/rules/method-material-sourcing.md` — how methods determine Buy/Make/Pull sourcing and cascade rules
