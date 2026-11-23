# Edits to one document

- **Status:** Implemented on `feat/document-editor-edits` (approved 2026-11-04)
- **Date:** 2026-11-04
- **Slice:** 3 of 3 (1 = editable block content, done; 2 = templates per customer or supplier, later)
- **Builds on:** `.ai/specs/2026-11-04-editable-block-content.md` (commit `63673b788c`)
- **Research:** `.ai/research/2026-11-04-per-document-edits-codebase.md`, `.ai/research/2026-11-04-per-document-edits-market.md`

## TL;DR

- A user opens "Edit document" on one record (PO-001042, an invoice, a quote) and changes how that one document prints.
- The editor opens in a large modal: the same preview, the same text panel, the same click on a word.
- The user can rename words, hide fields and columns, show or hide blocks, and edit the Terms and the Notes.
- The company template stays the same. A word the user did not change still follows the template.
- The edits lock when the record locks (a PO once finalized, a quote once sent, an invoice once posted).
- Every PDF of that record uses the edits: the live preview, the saved PDF, the email attachment.

## Problem

Slice 1 lets a company change the words of a document type for every document. A user cannot change one
document only. Examples: one supplier needs "GST No.:" instead of "Tax ID:" on one PO, a quote needs special
terms, or one invoice must hide the "Tax Value" column. Today the user must change the company template,
download the PDF and change the template back.

The market research found no product that renames printed labels on one document
(`.ai/research/2026-11-04-per-document-edits-market.md`). Products keep one-document text in fields on the
record, such as terms or a message. Carbon goes further on purpose: the template system already stores each
change as a small `text` map and a list of what it hides or shows, so the same shape works for one document.

## Goals

1. A user with edit rights on a record opens "Edit document" from the record's PDF menu.
2. The modal shows a live preview of that real record, with the user's draft edits applied.
3. The user renames any word, hides any field or column, and shows or hides any body block.
4. The user edits the Terms text of this document. The user edits the Notes, which are the record's own notes.
5. Save stores the edits for this document only. Each later render of this record uses them.
6. After the record locks, the modal opens read-only and the server refuses a save.
7. "Reset to template" removes all edits of this document.

## Non-goals

- Templates per customer or supplier (slice 2).
- Per-document changes to block order, fonts, colors, header, logo or footer layout.
- Adding blocks to one document (rich text, key-value, custom field).
- Thermal labels (`trackingLabel`): a label belongs to a tracked item, not to a document.
- Re-creating a PDF that was already saved and sent. A later send saves a new PDF, as today.
- Showing which words differ from the template. The panel shows the current words only (user feedback, slice 1).
- Edits for Stripe-sent invoices: Stripe prints its own PDF and ignores templates.

## Design

### Documents in scope

All 11 page documents. The table maps each one to its record, its lock, its edit permission and its Notes field.

| Document type | Record (`documentId`) | Lock (existing) | Edit permission | Notes field |
|---|---|---|---|---|
| `purchaseOrder` | `purchaseOrder.id` | `isPurchaseOrderLocked` | update purchasing | `purchaseOrder.externalNotes` |
| `purchaseReturnOrder` | `purchaseReturnOrder.id` | `isPurchaseReturnOrderLocked` | update purchasing | `purchaseReturnOrder.externalNotes` |
| `purchasingRfq` | `purchasingRfq.id` | `isRfqLocked` | update purchasing | `purchasingRfq.notes` |
| `quote` | `quote.id` | `isQuoteLocked` | update sales | `quote.externalNotes` |
| `salesOrder` | `salesOrder.id` | `isSalesOrderLocked` | update sales | `salesOrder.externalNotes` |
| `salesReturnOrder` | `salesReturnOrder.id` | `isSalesReturnOrderLocked` | update sales | `salesReturnOrder.externalNotes` |
| `salesInvoice` | `salesInvoice.id` | `isSalesInvoiceLocked` | update invoicing | `salesInvoice.externalNotes` |
| `packingSlip` | `shipment.id` | shipment Posted or Voided | update inventory | `shipment.externalNotes` |
| `stockTransfer` | `stockTransfer.id` | `isStockTransferLocked` | update inventory | no Notes block |
| `jobTraveler` | `job.id` | `JOB_LOCKED_STATUSES` | update production | `job.notes` |
| `issue` | `nonConformance.id` | `isIssueLocked` | update quality | `nonConformance.content` ("Description of Issue") |

Each Notes column comes from the document's `NotesBlock` (`packages/documents/src/pdf/blocks/*/NotesBlock.tsx`).
The Notes edit writes the record's own column, in the same transaction as the edit, and only when the user changed the notes. The modal adds no second copy of the notes.

### Data model

New table `documentEdit`. One row per document that has edits.

| Column | Type | Note |
|---|---|---|
| `id` | `TEXT` | `id('dedit')` |
| `companyId` | `TEXT` | FK `company`, part of the PK `("id", "companyId")` |
| `documentType` | `TEXT` | one of the 11 types above; a CHECK lists them |
| `documentId` | `TEXT` | the record id from the table above; no FK (it points at 11 tables) |
| `blocks` | `JSONB` | per block id: `{ text?, hide?, show?, visible?, content? }` |
| `settings` | `JSONB` | `{ text?, hide?, show? }` for the document's own texts (title, footer words) |
| `createdBy`, `createdAt`, `updatedBy`, `updatedAt` | | standard audit columns |

- `UNIQUE ("companyId", "documentType", "documentId")`: one row per document.
- `blocks` keys are block ids of the company template. Built-in block ids equal their type (`parties`, `lineItems`).
- `text` has the slice 1 shape. `hide` and `show` are this document's own changes to the hidden list, so what the template hides later still reaches it. `visible` shows or hides the block. `content` is the Terms rich text.
- An empty edit is no row. "Reset to template" deletes the row.
- RLS: SELECT for company employees. INSERT, UPDATE and DELETE check the permission of the row's `documentType`
  (the table above). The plan writes the policy with the repo's RLS helpers and the authz manifest.

### Applying the edits at render time

A pure function in `@carbon/documents` applies one `documentEdit` to a resolved template:

```ts
applyDocumentEdit(template: DocumentTemplate, edit: DocumentEditShape | null): DocumentTemplate
```

1. If `edit` is null, return `template` unchanged.
2. For each block with an entry in `edit.blocks`, merge `text` over the block's `text`, apply `hide` and `show` to its `hidden`, and set
   `visible` and `content` when present.
3. Merge `edit.settings.text` over `settings.text`, and apply `hide` and `show` to `settings.hidden`.
4. Ignore an entry for a block id the template no longer has.

A word the document did not change keeps the template's word, so a later template change still reaches it.
A word the document changed keeps the document's word.

Each renderer in research section 1 loads the edit next to the template and calls `applyDocumentEdit` after
`toDocumentTemplate`. The saved PDF at send time comes from the same renderer, so it includes the edits.
A company without a saved template resolves the default template first, so the edit has blocks to land on.

### Saving

A service function `saveDocumentEdit` (module: settings, next to `saveDocumentTemplate`):

1. Check the edit permission of the document type (the table above).
2. Load the record. Refuse when it does not exist in the company.
3. Refuse when the record is locked, with the message "This document is locked."
4. Validate the edit with `validateTemplateText` on the merged template. Refuse unknown words, unknown variables
   and a hide on a word that cannot hide.
5. Upsert the row on `("companyId", "documentType", "documentId")`. If the edit is empty, delete the row.

The Save writes the Notes edit to the record's column in the same transaction, only when the user changed the notes.

### The modal

- Each record's PDF menu gets "Edit document" next to "PDF" (research section 4 lists the 11 places).
- The modal is a large dialog (near full screen) and is one component, `DocumentEditModal`, that any page opens
  with `documentType` and `documentId`.
- It reuses the template editor parts: `PreviewPages`, `BlockConfig` words panel (`TextConfig`), click-to-jump.
- Left: the blocks of the page with an eye each. No add, no drag, no font or color sections.
- Right: the texts of the selected block, one at a time, plus a Terms editor on the Terms block and a Notes editor on
  the Notes block.
- The top bar says "Editing PO-001042 only", with "Reset to template", "Cancel" and "Save".
- The preview renders the real record with the draft edits. The preview route takes the edit as form data, as
  the template preview takes the draft template.
- If the record is locked, every control is read-only and a line says "Locked: this record can no longer change."
- The modal's data comes from one resource route that returns the resolved template, the edit row, the lock and
  the record's notes.

### Copies of a record

- A quote revision (a new quote row) copies the source quote's `documentEdit` row.
- Every other conversion (quote → sales order, sales order → invoice) starts with no edits: it is another
  document type.

## Design decisions

| # | Decision | Why |
|---|---|---|
| D1 | Store edits in a new `documentEdit` table, not on each record table | 11 record tables; one table, one service and one RLS policy set. No record table has a free JSON column for this (research section 5). |
| D2 | Store only the changes (`text`, `hide`, `show`, `visible`, `content`), keyed by block id | Same shape as slice 1, so `makeText` prints the edits with no renderer change. A template change still reaches unchanged words. |
| D3 | Apply edits after `toDocumentTemplate` in each renderer | That is the one merge point every render path shares (research section 5). |
| D4 | Lock with each record's existing `is<Doc>Locked` | Chosen: "when the record locks". It follows reopen and revision too. |
| D5 | Edit permission = the record's own update permission | Editing how a PO prints is editing the PO. The template editor keeps update settings. |
| D6 | Notes edit the record's notes field | One copy of the notes. |
| D7 | The editor opens in a modal | A modal opens anywhere. |
| D8 | No re-render of an already saved PDF on edit | A saved PDF is what the customer or supplier got. The next send saves a new one, as today. |
| D9 | Quote revisions copy the edits; conversions do not | A revision is the same document again; a conversion is a new document type with other blocks. |
| D10 | Labels are out of scope | A label has no document record or lock. |

## Acceptance criteria

1. On a Draft PO, "Edit document" opens the modal with a preview of that PO.
2. Rename "Tax ID:" to "GST No.:" and hide "Tax Value"; the preview shows both before Save.
3. After Save, `file+/purchase-order+/<id>.pdf` prints "GST No.:" and no Tax Value column. Another PO still prints "Tax ID:".
4. The company template editor still shows "Tax ID:". Change the template's "Supplier" to "Vendor"; the edited PO prints "Vendor" and "GST No.:".
5. Hide the Notes block on one quote; that quote's PDF has no Notes block, another quote does.
6. Edit the Terms on one sales order; only that order prints the new terms.
7. Edit Notes in the modal; the record page shows the same new notes.
8. Finalize the PO; the saved PDF in Documents and the email attachment print "GST No.:".
9. After finalize, the modal opens read-only, and a direct save request gets "This document is locked." and writes nothing.
10. Reopen the PO as a revision; the modal can save again.
11. A user without update purchasing does not see "Edit document" on a PO, and the server refuses the save.
12. "Reset to template" deletes the row; the PDF prints the template's words again.
13. Revise a quote that has edits; the new quote prints the same edits.
14. An unknown variable `{order.totl}` in the modal refuses the save and names the field.
15. All 11 document types show "Edit document", and a renamed word prints on each one.
16. Typecheck, Biome, `@carbon/documents` tests and the new database test pass.

## Open questions (resolved)

- [x] What can one document change? — **Answer:** words, hiding fields and columns, showing or hiding blocks, Terms and Notes. No order, fonts or colors.
- [x] When do a document's edits lock? — **Answer:** when the record locks, with each record's existing lock.
- [x] Which documents are in this phase? — **Answer:** all 11 page documents; labels are out.
- [x] How does a user open the editor? — **Answer:** in a modal that any page can open ("Edit document" next to the PDF).
- [x] How do Notes work? — **Answer:** the modal edits the record's own notes field; there is one copy of the text.

## Changelog

- 2026-11-04 — Draft written after the interview.
- 2026-11-04 — Built. Changes while building: the save writes the record's notes column in its own transaction under the keyed permission, instead of calling each module's update function; `RelatedDocument` takes an `onClick` so the packing slip and stock transfer rows can open the modal; only a quote revision copies edits, a duplicated quote starts clean. Run log: `.ai/runs/2026-11-04-per-document-edits-e2e.md`.
- 2026-11-05 — Values became variables on all 11 page documents: every single-line value prints from an editable text with variable chips, including one set of row variables per table (`{line.*}`, `{operation.*}`, `{task.*}`). Tracking labels are not included.
