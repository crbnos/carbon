# Purchase order PDF supplier part ID

A customer wants the supplier's part number on the purchase order PDF. Their screenshot's "Supplier ID" column shows `supplierPartId`, the supplier's catalog number. It does not identify the supplier company.

Scope: the PO template and PDF, the supplier part number rule they share with the PO email, and the Supplier Parts column label. RFQs and Supplier Returns stay unchanged. No schema change. The email text changes in one case only: it now trims the spaces around a supplier part number.

- [x] Build and test the change in a worktree on `448dbcdf3a`.
- [x] Move the change to a fresh clone of `crbnos/carbon` on `origin/main` at `b249e8bf20`.
- [x] Trace the supplier part number and the PDF layout. The old renderer appended the number to the item ID. The default template truncates that line, and Service lines skipped the number.
- [x] Find the cause in the customer's PDF. The view's `itemReadableId` carries the revision suffix, for example `.001`. The old renderer printed the item ID, the revision and the supplier part number on one line. The default `textOverflow: "truncate"` cut that line after the revision, so the number never showed. The same values without a revision suffix fit.
- [x] Print the number on its own labeled line, `Supplier Part ID:`, which wraps. Keep the item ID, revision and description.
- [x] Rename the Supplier Parts column from "Supplier ID" to "Supplier Part ID". Reuse the existing translations.
- [x] Add the Line Items option `showSupplierPartId` (default on) to `lineItemsOptionsSchema` and `DEFAULT_LINE_ITEMS_OPTIONS`.
- [x] Make the PO `LineItemsBlock` respect the option.
- [x] Move the supplier part number rule into `getLineSupplierPartId` in `utils/purchase-order.ts`. The PDF and the email's `getLineDescription` both use it. The line's number wins, else the supplier part record's. The helper trims spaces, and it returns `null` when the number repeats the item ID.
- [x] Show the "Show Supplier Part ID" switch in `LineItemsConfig` for `purchaseOrder` only. Mark the label with `useLingui`.
- [x] Fill the 12 translations from the glossary term "Supplier Part ID". Extract, clean and compile the catalogs.
- [x] Give sample line 1 the supplier part number `SW-1045-50R`, so the editor preview shows the switch working.
- [x] Add one schema test: a saved `false` survives the parse, and a template saved before the option parses to `true`.
- [x] Test `getLineSupplierPartId` in `purchase-order.test.ts`: the line's number wins, a blank number falls back to the record's, and a blank or repeated number gives `null`. Move the repeated-number test there from `getLineDescription`.
- [x] Verify: typecheck, tests, Biome, 63 PDF scenarios and a browser run against a local stack.
- [x] Fix the 3 CodeRabbit findings on PR #2141. A PDF Service line compares the number with its description. The `ToggleRow` switch gets an `aria-label`. 2 tests cover padded numbers.
- [x] Add docstrings to the 3 functions that the docstring warning lists.

Default on: the user did not choose a default. Default on keeps the earlier intent, which printed supplier part numbers.

Settings → Purchasing → "Show Supplier IDs" controls `supplier.readableId` in supplier lists, forms and dropdowns. It does not control the supplier part number or PO PDFs.

Evidence: `.ai/runs/2026-11-05-po-supplier-id/verification.md`.
