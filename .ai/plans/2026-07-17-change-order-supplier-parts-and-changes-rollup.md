# Change Orders: Supplier Parts on Line Details + Total Changes on Overview

## Context

We decided to **skip the big New Part refactor** — the current flow already supports the
Z1→Z2 scenario (new part is minted inactive at add time, selectable in other affected
items' draft BOMs via `includeInactive`, revealed + superseded at release, part number
never user-editable). Two gaps remain:

1. **Purchased (Buy) new parts release un-purchasable** — the CO line detail has no
   supplier-part management, so supplier / supplier part number / pricing can't be set
   up until after release.
2. **The CO overview has no rollup of what the CO changes** — the per-item diffs exist
   (release dialog + line details) but the top-level `$id.details` page shows only
   narrative + actions.

Scope: (A) embed supplier-part management on Revision/New Part line details for Buy
parts; (B) add a "Changes" rollup card on the CO overview between the Description of
Change card and the Actions card. Plus one small optional presentation fix (C).

**Key facts discovered (reuse, don't rebuild):**
- `$id.tsx` loader **already loads `supplierParts`** into `partData` for Revision/New
  Part lines (`getSupplierParts(client, draftItemId, companyId)`, $id.tsx:157) — no
  loader change needed for the grid.
- `SupplierParts` grid (`ui/Item/SupplierParts/SupplierParts.tsx`) is embeddable: takes
  `deleteSupplierPath` prop, uses **relative** navigation (`navigate("new")`,
  `Hyperlink to={id}`) and renders its own `<Outlet />` — so child routes under the CO
  details route mirror the part purchasing structure exactly.
- `SupplierPartForm` (`ui/Item/SupplierPartForm.tsx`) posts to the **part routes** via
  internal `getAction()`; `useParams().itemId` is absent in CO routes so it falls back
  to `initialValues.itemId` (lines 114–118) — works from the CO page as long as we pass
  the draft item id.
- The part **create** action (`x+/part+/$itemId.purchasing.new.tsx`) returns
  `{ success: true, message }` — already fetcher/embed-friendly.
- The part **edit** action (`x+/part+/$itemId.purchasing.$supplierPartId.tsx:125`)
  `throw redirect(partPurchasing)` on success — would yank the user out of the CO. Must
  change to `return { success: true, message }` (harmonizes with create; the part-page
  drawer still closes via the form's fetcher-success → `onClose` → `navigate`).
- The part **delete** action redirects to `partPurchasing` — CO needs its own tiny
  delete action route instead.
- Overview rollup: `ChangeOrderProperties.tsx:129–133` already builds
  `changes = affectedItems.map(a => ({ id, label, diff }))` for the release dialog,
  rendered as label + `ChangeOrderDiffViewer` (`ChangeOrderReleaseMerge.tsx:86–96`).
  The overview card mirrors this. `ReleaseChange` type is exported from
  `ChangeOrderReleaseMerge.tsx`.

---

## A. Supplier parts on CO line details (Buy Revision/New Part lines)

### A1. Relax the part edit action to be fetcher-friendly
**File:** `apps/erp/app/routes/x+/part+/$itemId.purchasing.$supplierPartId.tsx`
- Replace the success `throw redirect(path.to.partPurchasing(itemId), flash(...))`
  (line 125–128) with `return { success: true, message: "Supplier part updated" }`.
- No other changes. Part-page behavior is preserved: `SupplierPartForm`'s fetcher
  effect (lines 144–151) toasts the message and calls `onClose`, and the route's
  `onClose` already navigates to `partPurchasing` (line 143). Loaders revalidate
  automatically after the fetcher action.

### A2. Read-only support on `SupplierParts`
**File:** `apps/erp/app/modules/items/ui/Item/SupplierParts/SupplierParts.tsx`
- Add optional `isReadOnly?: boolean` prop; when true, suppress `onNewRow` and the
  delete column (so a locked CO shows the grid but no mutations). Backwards-compatible.

### A3. New CO child routes (mirror the part purchasing trio)
All under `apps/erp/app/routes/x+/items+/change-order+/`, nesting inside
`$id.$affectedId.details.tsx` (the `<Outlet />` inside `SupplierParts` mounts them):

1. **`$id.$affectedId.details.new.tsx`** — default export only (no action; the form
   posts to `path.to.newPartSupplier(draftItemId)`, which already returns success).
   Reads `useRouteData(path.to.changeOrder(id))` → find affected item → `partData` for
   `draftItemId` + `unitOfMeasureCode`. Renders `SupplierPartForm` with
   `type="Part"`, seed values (`itemId: draftItemId`, `supplierUnitOfMeasureCode:
   "EA"`, MOQ 1, orderMultiple 1, conversionFactor 1 — mirror
   `$itemId.purchasing.new.tsx`), `onClose: () =>
   navigate(path.to.changeOrderAffectedItem(id, affectedId))`.
2. **`$id.$affectedId.details.$supplierPartId.tsx`** — loader mirrors the part edit
   loader (supplierPart row + price breaks + purchasing history; copy from
   `$itemId.purchasing.$supplierPartId.tsx:15–57`). Default export renders
   `SupplierPartForm` (edit mode — the form posts to
   `path.to.partSupplier(draftItemId, id)`, now returning success per A1); `onClose`
   navigates back to the CO line. No action in this file.
3. **`$id.$affectedId.details.$supplierPartId.delete.tsx`** — action-only (the
   `ConfirmDelete` modal is rendered inline by the grid): `requirePermissions
   { delete: "parts" }` → `deleteSupplierPart(client, supplierPartId, companyId)` →
   `throw redirect(path.to.changeOrderAffectedItem(id, affectedId), flash(...))`
   (redirect back to the page = revalidate + flash; ConfirmDelete's `onSubmit` closes
   the modal). Mirror the part delete route's action shape.

Note: static `new` wins over dynamic `$supplierPartId` in remix-flat-routes — same
pattern as the part purchasing routes.

### A4. Path helper
**File:** `apps/erp/app/utils/path.ts` (keys are biome-sorted — insert alphabetically)
- Add `changeOrderDeleteSupplierPart: (id, affectedId, supplierPartId) =>
  ${x}/items/change-order/${id}/${affectedId}/details/${supplierPartId}/delete`.
  (Create/edit navigation is relative via the grid; only delete needs a helper.)

### A5. Render the card in `AffectedItemDetail`
**File:** `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemDetail.tsx`
- New gate: `showSupplierParts = showAttributes && affected.partData &&
  ["Buy", "Buy and Make"].includes(affected.partData.partSummary?.replenishmentSystem)`.
- Render `<SupplierParts supplierParts={affected.partData.supplierParts}
  isReadOnly={isDisabled} deleteSupplierPath={(spId) =>
  path.to.changeOrderDeleteSupplierPart(changeOrderId, affected.affectedItem.id, spId)} />`
  positioned after the Files card, before the BOM/BOP / cutover cards.
- Data is already in `partData.supplierParts` (loaded by `$id.tsx`); revalidation after
  create/edit/delete refreshes it automatically.

---

## B. "Changes" rollup on the CO overview

### B1. New component `ChangeOrderChanges`
**File:** `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderChanges.tsx` (new)
- Props: `{ changes: ReleaseChange[] }` (import type from `ChangeOrderReleaseMerge`).
- A `Card` titled `Changes` listing, per affected item, the item label (readableId,
  as in the release dialog) + `<ChangeOrderDiffViewer diff={c.diff} />` — mirroring
  `ChangeOrderReleaseMerge.tsx:86–96`. Empty state: "No affected items." Strings via
  Lingui (`Trans`).
- Export from the `ui/ChangeOrder` barrel.

### B2. Wire into the overview
**File:** `apps/erp/app/routes/x+/items+/change-order+/$id.details.tsx`
- Extend the `useRouteData` generic with `affectedItems: AffectedItemDraft[]`.
- Build `changes` exactly as `ChangeOrderProperties.tsx:129–133` does.
- Render `<ChangeOrderChanges changes={changes} />` **between** `ChangeOrderContent`
  (Description of Change) and `ChangeOrderActions`.

---

## C. Optional: show the minted new-part number on New Part lines
**File:** `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderExplorer.tsx` (row) —
when `affectedItem.newItemId` is set, resolve the new item from the `useItems()` store
and render "OLD → NEW" (e.g. `GA-0029 → GA-0030`) so the created part is visible
top-level. Drop this task if unwanted.

---

## Files touched

| File | Change |
|---|---|
| `x+/part+/$itemId.purchasing.$supplierPartId.tsx` | edit action: redirect → `{ success }` |
| `ui/Item/SupplierParts/SupplierParts.tsx` | optional `isReadOnly` prop |
| `x+/items+/change-order+/$id.$affectedId.details.new.tsx` | **new** — create drawer |
| `x+/items+/change-order+/$id.$affectedId.details.$supplierPartId.tsx` | **new** — edit drawer |
| `x+/items+/change-order+/$id.$affectedId.details.$supplierPartId.delete.tsx` | **new** — delete action |
| `utils/path.ts` | `changeOrderDeleteSupplierPart` helper |
| `ui/ChangeOrder/AffectedItemDetail.tsx` | Supplier Parts card |
| `ui/ChangeOrder/ChangeOrderChanges.tsx` | **new** — overview rollup card |
| `ui/ChangeOrder/index.ts` (barrel) | export `ChangeOrderChanges` |
| `x+/items+/change-order+/$id.details.tsx` | render rollup between description and actions |
| `ui/ChangeOrder/ChangeOrderExplorer.tsx` | (optional C) old → new label |

No migrations, no service-file changes, no model changes.

## Verification

1. `pnpm exec turbo run typecheck --filter=@carbon/erp` (scoped; never whole-repo).
2. `pnpm run lint`.
3. Browser (stack via `crbn up`, `/auth` then agent-browser — mandatory for UI):
   - CO with a Buy part added as Revision or New Part → line detail shows **Supplier
     Parts** card; add a supplier part (drawer opens at `.../details/new`, saves,
     toast, grid refreshes, no navigation away); edit it (price breaks persist);
     delete it (confirm modal, stays on CO).
   - Make part on Version → no Supplier Parts card.
   - Part detail page → Purchasing tab: supplier part create/edit/delete still work
     (regression for A1).
   - CO overview: "Changes" card sits between Description of Change and Actions,
     showing each affected item's diff; updates after editing a draft BOM.
   - Locked CO (Done/Cancelled): supplier parts grid read-only.
4. After UI strings: `pnpm lingui:extract` (fill via `/translate` at commit time).

Post-approval: copy this plan to `.ai/plans/2026-07-17-change-order-supplier-parts-and-changes-rollup.md` per repo convention.
