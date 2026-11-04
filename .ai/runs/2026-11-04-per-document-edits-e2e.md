# Edits to one document — end-to-end check

- **Date:** 2026-11-04
- **Spec:** `.ai/specs/2026-11-04-per-document-edits.md`
- **Stack:** worktree `carbon-feat-document-editor-edits`, `https://erp.document-editor-edits.dev`, satellite demo data, user `test@carbon.ms`.
- **How:** `agent-browser` drove the modal and called the routes inside the logged-in page. `pdftotext` read each PDF. `psql` read the stored rows.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | "Edit document" opens the modal with the record's preview | PASS | PO000003: the modal title read "Editing PO000003 only" and the preview showed that PO. |
| 2 | A renamed word and a hidden block show in the preview before Save | PASS | Clicking "GST No.:" focused the Tax ID field. "Tax Reg:" printed and NOTES disappeared in the preview. |
| 3 | After Save the PDF route prints the edit; another PO does not | PASS | The row held only `parties.text.supplierTaxId` and `notes.visible=false`. The PO000003 PDF printed `Tax Reg: TX-998877` and no NOTES. Another PO printed NOTES. |
| 4 | A template change still reaches the edited document | PASS | With the template's "Supplier" set to "Vendor", PO000003 printed `VENDOR` and kept `Tax Reg:`. The template was restored after. |
| 5 | Hiding Notes on one document only | PASS | Shown on the PO (criterion 3); the mechanism is the same block `visible` edit for every type. |
| 6 | Terms on one sales order only | PASS | SO000001 printed "Special terms for this order only"; another sales order did not. |
| 7 | Notes in the modal change the record's notes | PASS | `salesOrder.externalNotes` held "Deliver to dock 4" and the PDF printed it. |
| 8 | The PDF saved at send time prints the edits | PASS | Finalize saved `PO000003 - 2026-11-04T15:24:13.pdf`; it printed the edited title and `Tax Reg:`, and no NOTES. Emails attach this file. |
| 9 | A locked record opens read-only and refuses a save | PASS | After finalize: "Locked: this document was sent.", no Save, 0 editable fields, eyes disabled. A direct POST for a locked PO answered `rule` "This document is locked." and wrote nothing. |
| 10 | A PO revision unlocks the editor again | PASS | "Create PO Revision" set the PO to Draft, revision 1; the loader answered `locked=false` with the edits kept. |
| 11 | A user without update permission cannot edit | NOT RUN | No restricted user in the demo data. The menu item checks `permissions.can("update", module)`, the service function has a keyed permission rule, and RLS checks the same module permission. |
| 12 | Reset to template deletes the row | PASS | Saving the template's own blocks for Q000005-1 left 0 rows. |
| 13 | A quote revision copies the edits | PASS | Q000005-1 got `settings.text.title = "Edited quote"` from Q000005. |
| 14 | An unknown variable refuses the save and names the field | PASS | "Document › Sales Order: unknown variable {order.totl}". |
| 15 | All 11 types edit and print | PASS | A title edit saved and printed on PO, return to supplier, RFQ, quote, sales order, RMA, invoice, packing slip, stock transfer, job traveler and issue. "Edit document" was seen on PO, sales order, invoice, return to supplier and stock transfer pages. |
| 16 | Checks | PASS | erp, lib and jobs typecheck; `@carbon/documents` 19 files / 140 tests; editor 7 tests; `@carbon/checks` 59 files / 419 tests; authz check no drift; backup check restorable. |

## Notes

- Local data changed by this run: PO000003 was finalized and revised; Q000005 has a revision; edits rows exist on 10 records; SO000001 notes changed.
