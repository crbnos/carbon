# Bugfix run: purchase order line description is single-line and cut off on the PDF

- Date: 2026-11-11
- Mode: fully-autonomous
- Request: A purchase order line's Description holds the detail a supplier needs. It must accept line breaks, and the PDF must print all of it, laid out as entered. Today the field takes one line and the PDF prints only its start.
- Phase plan: root-cause [run] · instrument [skip — cause read directly from code, HIGH] · fix [run] · test [run — browser check on the local stack, on ask] · commit [run — asked, with a PR]

## Decisions

- instrument: skip — the clamp and the single-line input are static code, no runtime state — 2026-11-11
- default template: the purchase order's Line Items table wraps by default, as the sales invoice's already does. A saved template keeps its own "Item text" choice — 2026-11-11

## Phase log

- root-cause (HIGH):
  - Entry: `PurchaseOrderLineForm.tsx` renders Description as a one-line `InputControlled` (item lines) and `Input` (G/L account and fixed asset lines), so the user cannot type a line break.
  - Print: the default purchase order template takes `DEFAULT_LINE_ITEMS_OPTIONS.textOverflow = "truncate"` (`template/schema.ts`). `itemTextOverflowStyle` turns that into `maxLines: 1` + ellipsis, so the description cell prints one line of a 22%-wide column. On item lines the details cell joins the line description and the item's own description with `\n`, so the PDF also drops the item's own description.
  - The sales invoice default already sets `textOverflow: "wrap"` for the same reason (`template/defaults.ts`).

- fix:
  - `packages/documents/src/template/defaults.ts`: the purchase order default template wraps its Line Items text. `withWrappedLineItems` now holds the rule, and the sales invoice default uses it too.
  - `PurchaseOrderLineForm.tsx`: Description is a `TextAreaControlled` on item lines and a `Textarea` on G/L account and fixed asset lines.
  - `docs/content/docs/reference/purchase-orders.mdx`: a Description row in Line fields.
- proof (committed, `packages/documents/src/pdf/PurchaseOrderPDF.test.ts`):
  1. Before the fix, the test failed. The PDF printed "Steel Bar, 50mm" and dropped "Cut to 1200 mm", "Deburr both ends" and "Mill cert 3.1".
  2. After the fix, the test passes.
- scratch proof: a description with `\r\n` line endings, a blank line and a long sentence rendered to PNG. The PDF keeps each line break and the blank line, wraps the sentence, and draws no stray glyph for `\r`. Browsers submit a textarea's line breaks as `\r\n`, so this case is the real one.
- gates: biome PASS · typecheck(@carbon/documents, erp) PASS · test(@carbon/documents) 255/255 PASS, printed-text snapshot unchanged · test(@carbon/content) 16/16 PASS · docs mechanical gate PASS (the one long paragraph is in the Dates section, not in this change).
- browser check on the local stack (seed company): a draft purchase order with three lines (Material, Service, G/L Account). Each description has three to five lines.
  - The form keeps every line break, and the database stores them as `\n`.
  - With this change, the PDF prints every line of each description. With the code before it, the PDF prints the first line of each, and the G/L Account line ends in an ellipsis.
  - Before this change, the form shows the description on one line and drops its line breaks.
- not run: a docs site render.

## Outcome

- Committed, PR opened.
- A company that saved its purchase order template before this change keeps the Item text value stored in its Line Items block. If that block has no stored options, the PDF still truncates. That company sets Item text to "Wrap to new lines" in the template editor.
