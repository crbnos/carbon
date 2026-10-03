# Document page layout — rollout

Move the "single column with a big header card" pages onto `DocumentPage`
(`apps/erp/app/components/DocumentPage/`): a flat, pinned `DocumentPageHeader`
(id, copy, ⋯, status, a muted created/posted line, actions with the next step as
the one primary) over flat detail fields, and a resizable, collapsible
`DocumentSidebar` with **Documents** (one ungrouped `RelatedDocumentGroup`) and
**Activity** (the inline `AuditLogFeed`).

Shipment is the reference: `routes/x+/shipment+/$shipmentId.tsx`,
`modules/inventory/ui/Shipments/Shipment{Header,Documents,Form}.tsx`.

## Per page

1. `XHeader.tsx` — lift the title / status / ⋯ menu / actions / modals out of the
   form's `DocumentHeader`. Drop the ⋯ History item (Activity replaces it) and
   any cross-link buttons (Documents replaces them).
2. `XDocuments.tsx` — the counterparty (customer / supplier) first, then the
   source document, downstream documents with their status, then generated
   files (`external`) only when they can be produced.
3. `XForm` — flat: no `Card`, no `DocumentHeader`, hidden fields grouped in one
   `div.hidden`, grids on container queries (`@xl:`), not viewport breakpoints.
4. Route shell — `<DocumentPage header sidebar>` with `activity.entityType`
   set to the audited table and `refreshKey` = `updatedAt:status`.
5. Line components that sat in a `max-w-5xl` column: switch `md:` / `lg:`
   layouts to `@container` queries — the pane is now resizable.
6. Verify at 1440 / 1024 / 390 px, the Activity tab with audit logging on, the
   panel collapse persisting across reloads; typecheck, Biome, `lingui:extract`.

## Pages

- [x] Shipment — `routes/x+/shipment+/$shipmentId.tsx`
- [x] Receipt — `routes/x+/receipt+/$receiptId.tsx` (`ReceiptForm` + `DocumentHeader`)
- [x] Journal entry — `routes/x+/journal-entry+/$journalEntryId.tsx`
- [x] Warehouse transfer — `routes/x+/warehouse-transfer+/$transferId.tsx` (`WarehouseTransferForm` + `DocumentHeader`)
- [x] Stock transfer — `routes/x+/stock-transfer+/$id.tsx` (`StockTransferHeader`)

## Same shape

- [x] Picking list — `routes/x+/picking-list+/$pickingListId.tsx` (`PickingListHeader`)
- [x] Reimbursement — `routes/x+/reimbursements+/$reimbursementId.tsx`
- [x] Fixed asset — `routes/x+/fixed-asset+/$fixedAssetId.tsx` (`DocumentHeader`)
- [x] Payment — `modules/invoicing/ui/Payment/PaymentForm.tsx` (`DocumentHeader`)
- [x] Memo (credit) — `routes/x+/credits+/$memoId.tsx` (`MemoForm` + `DocumentHeader`)
- [x] Depreciation run — `routes/x+/depreciation-run+/$depreciationRunId.tsx`
- [x] Revenue recognition run — `routes/x+/revenue-recognition-run+/$runId.tsx`

Every page passes `activity`: its record is in `auditConfig.entities`. Journal
entry, payment, memo, reimbursement, picking list and the two runs were added
for this (with their line tables; `invoiceSettlement` is a child of both payment
and memo), and migration `20261002234926_audit-posting-documents.sql` attaches
the async event triggers their tables lacked. A record that is not audited may
omit `activity`; the panel then shows Documents alone.

When the last `DocumentHeader` caller is gone, delete
`components/DocumentHeader.tsx` and update the posting-document archetype in
`.claude/skills/carbon-design/references/page-archetypes.md` §7 and
`.claude/rules/shipments-receipts-ui-patterns.md` (Components → Form).
