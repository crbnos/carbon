# Editable block content — end-to-end check

- **Date:** 2026-11-04
- **Spec:** `.ai/specs/2026-11-04-editable-block-content.md`
- **Stack:** worktree `carbon-feat-document-editor-edits`, `crbn up --no-portless` (http://localhost:3000), satellite demo data, user `test@carbon.ms`.
- **How:** the editor was driven with `agent-browser`. Each PDF was fetched inside the logged-in page and read with `pdftotext`. Stored rows were read with `psql`.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Change "Tax ID:" to "GST No.:" in the editor; the preview shows it | PASS | The live preview showed the changed Parties heading at once. The panel kept "GST No.:" in its input. |
| 2 | After save and reload, the panel and the PO PDF print "GST No.:" | PASS | `/file/purchase-order/po_UeRp…pdf` printed `GST No.: TX-998877`. The demo supplier got a tax ID for this check. |
| 3 | Hide "EORI:"; the PO has no EORI row | PASS | The supplier also had EORI `GB123456789000`. The PDF did not print it. |
| 4 | Hide "Tax Value"; the PO table has 8 columns and Description is wider | PASS | The header printed `# Description Qty UOM Required Unit Price Net Value Total`. |
| 5 | A variable in a text prints its value | PASS | "Grand total in {order.currency}" printed `Grand total in USD (USD)`. |
| 6 | `{order.totl}` refuses the save and names the field | PASS | The panel showed "Summary › Total: unknown variable {order.totl}". No row was written. |
| 7 | Reset removes the key from `text` | PASS | After Reset on "Supplier" and a save, the stored Parties `text` held only `supplierTaxId`. |
| 8 | A template with no saved change renders as before | PASS | The text of 10 documents, re-downloaded with no template saved, matched the 2026-11-03 copies. The one difference was the quote's "Date:" line, which prints today's date. |
| 9 | Changing "Rev" changes the label PDF and the ZPL | PASS | Both printed `Version: 0`. |
| 10 | A `^` in label text does not end the ZPL field | PASS | Unit test `productLabelZPL.test.ts` ("escapes a caret"). The live ZPL showed `^FH^FD…` on every text field. |
| 11 | The quote summary prints its tax label | PASS | Q000001 and Q000003 printed `VAT (USD)` after the tax label was set to "VAT". |
| 12 | A Text field block prints on an invoice | PASS | AR000002 printed `Bank: Pay to account 12345 for AR000002`. |
| 13 | Every document has a "Text" section | PASS | The first content block of PO, sales order, sales return order, purchase return order, RFQ, packing slip, stock transfer and job traveler showed 5–17 text inputs. Issue report, quote and invoice were checked by render tests. The UI check of the issue report did not run: the Mac restarted during it. |
| 14 | Type check, Biome and the `@carbon/documents` tests pass | PASS | The documents, erp, mes, lib, jobs and printing type checks passed. Biome reported no errors on 143 changed files. 18 test files and 132 tests passed. |

## Notes

- The proxy for `*.dev` URLs needs sudo after a reboot, so the stack ran in localhost mode.
- Demo data changed for checks 2–3: `supplierTax` for supplier `sup_NZk2AtT3bvTCwYcHsfZrpr` got a tax ID and an EORI number. This is local data only.
- The saved templates (purchase order, quote, sales invoice, tracking label) stay in the local database.
