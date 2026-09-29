# Functionality — what a Carbon screen must let people DO

A screen that looks like Carbon but can't be worked on is a mock-up, not a Carbon screen.
Users live in these pages all day: they change a quantity, fix a price, move a date, add a
line, confirm the order, ship it. **Design the capabilities first, then the look.** Every
archetype below has a capability contract — the things users expect because every sibling
page gives them. Read the exemplar's *routes*, not just its components: the functionality
lives in the route actions, the fetcher contracts and the lock helpers.

Paths are relative to `apps/erp/app/`.

## Contents
1. How to use this file (the capability pass)
2. Document workspace contract (Archetype B)
3. Item / master record contract (Archetypes C and D)
4. The wiring patterns (how Carbon implements edits)
5. Locks — how "can I edit this?" is decided and enforced
6. Things that are never acceptable

---

## 1. The capability pass (do this before layout)

1. **List the user's jobs** on this screen as verbs: "change the quantity of a line",
   "add a line", "confirm the order", "see what has shipped", "attach the customer PO".
2. **Take the archetype contract below** and tick every row that applies. A row you skip
   needs a reason in the brief ("RMA has no notes — sibling has none").
3. **For each job, name where it happens and what it calls**: the surface (explorer row menu,
   line card, Properties field, header button), the component, and the *existing* route
   action / service it posts to (`path.to.*` helper, verified). If no endpoint exists, the
   job needs one — say so in the brief; don't render a control that goes nowhere.
4. **Mark what locks it** (`is{Entity}Locked(status)`, permission, revision release lock).

A new screen built on an existing record type reuses that record's real endpoints —
`update.tsx` bulk routes, `$id.new`, `$lineId.details` actions, status/confirm routes. A new
UI calling the old actions is how Carbon evolves a page without forking its domain rules
(sales rules, lock guards, MRP triggers, exchange-rate derivation all live in those actions).

## 2. Document workspace (Archetype B) — users must be able to…

| # | Capability | Canonical pattern | Exemplar |
|---|---|---|---|
| 1 | Add a line | Explorer footer "Add Line Item" (+ `EXPLORER_SHORTCUTS.addLine`) opens `<XLineForm type="modal">` (a `ModalCard` in modal mode) posting to `$id.new` | `modules/sales/ui/SalesOrder/SalesOrderExplorer.tsx:259-302`, `routes/x+/sales-order+/$orderId.new.tsx` |
| 2 | Open a line and **edit it in place** — item, quantity, price, dates, tax/shipping/add-ons | Explorer row navigates to `$id.$lineId.details`; the SAME line form renders as a collapsible Card (`ModalCard type="card"`), explicit Save, followed by the line's related cards | `routes/x+/sales-order+/$orderId.$lineId.details.tsx:285-373`, `SalesOrderLineForm.tsx:587-845` |
| 3 | Delete a line | Explorer row ⋮ → confirm modal → `$lineId.delete` guarded by `requireUnlocked` | `SalesOrderExplorer.tsx:430-440`, `$orderId.$lineId.delete.tsx:48-54` |
| 4 | Reorder lines | explicit edit mode: `useLineOrderEditMode` + `ReorderableLineList` → `$id.line-order` | `components/LineReorder/useLineOrderEditMode.ts`, `SalesOrderExplorer.tsx:193-254` |
| 5 | Change header facts (customer, dates, location, contacts, currency, reference) | Properties panel: one tiny `ValidatedForm` per field, inline field, `onUpdate(field, value)` → fetcher posts `ids`,`field`,`value` to the entity's bulk `update.tsx` (switch on field, `requireUnlockedBulk`) | `SalesOrderProperties.tsx:63-83`, `routes/x+/sales-order+/update.tsx` |
| 6 | Assign an owner | `<Assignee variant="inline">` + `useOptimisticAssignment` | `SalesOrderProperties.tsx:104-178` |
| 7 | Custom fields | `CustomFormInlineFields` → `path.to.customFields` | `SalesReturnOrderProperties.tsx` (end of panel) |
| 8 | Move through the lifecycle | status-gated header buttons; the next step is the single primary; confirm modal (`Confirm` or a custom Modal when it needs inputs) → `$id.confirm` / `$id.status`; Reopen in ⋯ posts `status=Draft` | `SalesOrderHeader.tsx:333-445`, `$orderId.status.tsx`, `$orderId.confirm.tsx` |
| 9 | Create / reach downstream documents | header button before any exist, `Receipts ▾` dropdown listing them after | `SalesOrderHeader.tsx:463-647`, `useSalesOrder.ts` |
| 10 | Shipping and payment terms | Cards in the details pane, `ValidatedForm isDisabled={isLocked}` + Save | `SalesOrderShipmentForm.tsx:111`, `SalesOrderPaymentForm.tsx:59` |
| 11 | Notes | Internal / External tabs with the rich `Editor`, debounced autosave | `modules/sales/ui/Opportunity/OpportunityNotes.tsx:55-149` |
| 12 | Attachments | Documents card: dropzone + table (download, delete), deferred load | `OpportunityDocuments.tsx:65-197` |
| 13 | See totals | Summary card computed from the loader's lines | `SalesOrderSummary.tsx:108-303` |
| 14 | Preview / export / email | PDF preview, CSV export of lines, email option in the confirm modal | `SalesOrderHeader.tsx:319-407`, `$orderId.confirm.tsx:145-190` |
| 15 | See history | `useAuditLog` item in ⋯ + drawer | `SalesOrderHeader.tsx:237-242` |
| 16 | Delete the document | ⋯ last item, destructive, `ConfirmDelete`, disabled when locked | `SalesOrderHeader.tsx:348-359` |
| 17 | Get rule feedback | `useRuleViolations` wraps the line form fetcher | `SalesOrderLineForm.tsx:113-120` |

The details pane (no line selected) is a stack of **working** cards: state → Summary →
Notes → Documents → the header's form cards (shipping, payment). The line pane is: line form
card → line notes → line-specific cards (jobs, shipments, method, costing) → documents.

## 3. Item / master record (Archetypes C, D) — users must be able to…

| # | Capability | Canonical pattern | Exemplar |
|---|---|---|---|
| 1 | Switch facets by URL | route tabs from a `use{Entity}Navigation` hook into `DetailsTopbar` (gated by role/permission/record state, ⌘⇧ shortcuts) | `modules/items/ui/Parts/usePartNavigation.tsx:35-97`, `components/Layout/Navigation/DetailsTopbar.tsx` |
| 2 | Edit attributes inline | Properties autosave → `path.to.bulkUpdateItems` (`{items, field, value}`), toast on error | `PartProperties.tsx:173-202`, `routes/x+/items+/update.tsx` |
| 3 | Edit grouped settings | a Card per concern with `ValidatedForm` + explicit Save; one action routed by `intent` | `ItemManufacturingForm.tsx`, `routes/x+/part+/$itemId.details.tsx:179-238` |
| 4 | Edit the structure (BoM / operations) | cards with Add, per-line Save, delete, drag-reorder, optimistic pending rows | `modules/items/ui/Item/BillOfMaterial.tsx:279-365`, `BillOfProcess.tsx` |
| 5 | Navigate structure | explorer tree with URL selection (`?materialId=`) that swaps Properties to the node | `components/BoMExplorer/BoMExplorer.tsx:179-195` |
| 6 | See and adjust stock | per-location (`?location`, user default fallback) quantities + an adjustment modal | `routes/x+/part+/$itemId.inventory.tsx:46-77`, `InventoryStorageUnits.tsx:362-559` |
| 7 | See supply & demand over time | planning chart + Supply & Demand card with document links | `ItemPlanningChart.tsx` |
| 8 | Versions and revisions | New / Duplicate / Set Active in method tools; revisions from Used In | `MakeMethodTools.tsx:311-380` |
| 9 | Where used | Used In tree grouped by module | `routes/x+/part+/$itemId.tsx:294-408` |
| 10 | Notes, files, tags, custom fields | `ItemNotes` (debounced), `ItemDocuments`, tags + custom fields in Properties | `$itemId.details.tsx:336, 392`, `PartProperties.tsx:205-240` |
| 11 | Delete / change notice / audit | header ⋯ | `PartHeader.tsx:82-133` |

## 4. Wiring patterns (reuse them exactly)

- **Autosave a field**: per-field `ValidatedForm` (validator = one zod field) around an
  `inline` form field; `onChange`/`onBlur` → `onUpdate(field, value)` → `useFetcher().submit`
  to the bulk update route; `useEffect` toasts `fetcher.data.error`. Skip the post when the
  value didn't change.
- **Explicit-save card**: `ValidatedForm` + zod validator from `{module}.models.ts` +
  `Card` + `CardFooter <Submit>`; the route action validates with
  `validator(schema).validate(formData)`, calls the service, `throw redirect(...)` with
  flash on success (`.claude/rules/conventions-forms.md`).
- **Line form, two containers**: one component, `type="modal" | "card"`, wrapped by
  `ModalCardProvider`; create in a modal from the explorer, edit as a card in the content
  pane (`packages/react/src/ModalCard.tsx`).
- **Status transition**: `useFetcher` or `Confirm action={path.to.xStatus(id)}` with a hidden
  `status` input; the route checks permissions and the transition.
- **Optimistic state**: read `fetcher.formData` / `useFetchers()` for pending values rather
  than local state (`BillOfMaterial.tsx:1366-1389`).
- **Where a real page's form component can be reused, reuse it** (the line form, the notes,
  the documents card). Redesigning a page means rearranging and improving the experience —
  it does not mean re-implementing validated forms and domain rules from scratch.

## 5. Locks

- The client asks the model helper: `isSalesOrderLocked`, `isQuoteLocked`,
  `isPurchaseOrderLocked`, `isSalesReturnOrderLocked` (`modules/sales/sales.models.ts:1094`,
  `modules/purchasing/purchasing.models.ts`), plus `permissions.can("update", module)`.
  Locked forms get `isDisabled`; explorers disable Add/Delete.
- The server enforces it: `requireUnlocked` (redirect + flash) and `requireUnlockedBulk`
  (error object for bulk updates) in `utils/lockedGuard.server.ts:23-67`.
- Items: revision release lock and change-notice draft lock (`BillOfMaterial.tsx:194-198`,
  `ReleaseLockAlert.tsx`, `items.server.ts:202-230`); a lock icon tooltip explains why.
- A locked control stays visible and says why (tooltip or the status pill itself).

## 6. Never acceptable

- A read-only rendition of a page whose sibling is editable ("sample", "preview", "v1").
- Disabled placeholder buttons standing in for actions you didn't wire.
- New UI that re-implements a mutation the record's existing route already performs.
- Dropping a capability the sibling has (notes, documents, reorder, audit log) without
  saying why in the brief.
