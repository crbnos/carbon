# Release Job — Outside Processing PO modal

Last tested: 2026-09-18
Route: /x/job/$jobId/details (also the per-job Release button on
/x/sales-order/$orderId/details — renders the same `JobStartModal`)

## Prerequisites
- A **Draft** job with at least one `Outside Processing` operation.
- The operation's process has a `supplierProcess` (a supplier configured for it,
  e.g. AstroMill Machining → Clean Room Assembly). The operation's OWN
  `operationSupplierProcessId` may be NULL — the modal falls back to the process's
  sole supplier.

## Steps
### 1. Navigate — open the job details page. Header shows a "Release" button
   (enabled only while status = Draft).
### 2. Click "Release" — opens the `JobStartModal` ("Release Job JNNNNNN").
### 3. Verify the modal (the fix):
   - Shows "Purchase orders required" + the supplier name (e.g. "AstroMill
     Machining") with a "Create New" PO dropdown.
   - Does NOT show "Missing Suppliers".
   - "Release Job" button is ENABLED.
   - **Multiple suppliers on the process:** an extra "These operations use a
     process with multiple suppliers. Choose a supplier for each." section
     appears with a per-operation supplier dropdown (defaulted to the first
     candidate). Changing it re-resolves the PO row to that supplier. On release
     the chosen supplier is stamped onto `jobOperation.operationSupplierProcessId`
     and the PO is created for that supplier.
### 4. Click "Release Job" — plain `fetcher.Form` submit button, a click works
   (not a ValidatedForm; no requestSubmit needed). Modal closes, page reloads.
### 5. Verify results (DB or UI):
   - job.status = "Ready"
   - a Draft `purchaseOrder` (purchaseOrderType "Outside Processing") for the
     supplier, `jobId` set
   - a `purchaseOrderLine` with `jobOperationId` = the outside operation

## Selector Notes
- Release button: header button labelled "Release" (disabled unless Draft).
- Supplier row inside the modal is an avatar + name; the PO picker is a combobox
  defaulting to "Create New" (disabled when no existing draft POs for the supplier).

## Common Failures / History
- Before the fix: an outside operation with a NULL `operationSupplierProcessId`
  showed "Missing Suppliers" + disabled Release, even when the process had exactly
  one supplier. Fixed by resolving effective supplier = op's own
  `operationSupplierProcessId` ?? the process's sole `supplierProcess`, in both
  `JobHeader.tsx` (modal) and `create/index.ts` `purchaseOrderFromJob` (PO build).
- A process with 2+ suppliers shows a per-operation supplier picker defaulting
  to the first candidate; Release stays ENABLED and stamps the chosen (or
  defaulted) supplier on release. Release is blocked only when an operation's
  process has NO suppliers at all (genuine "Missing Suppliers").
