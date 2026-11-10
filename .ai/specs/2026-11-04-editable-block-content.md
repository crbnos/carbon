# Editable block content in document templates

- **Status:** Implemented on `feat/document-editor-edits` (approved 2026-11-04)
- **Date:** 2026-11-04
- **Slice:** 1 of 3 (2 = templates per customer or supplier, 3 = edits to one document)
- **Research:** `.ai/research/2026-11-04-block-text-inventory.md`
- **Architecture notes:** `local-docs/document-editor/architecture-review.html` (local only)

## TL;DR

- Every heading, label, column name and empty-state text in the 12 documents becomes editable in the block's side panel.
- Each labelled field and table column gets a "Show" toggle, so a company can hide it.
- Text can hold variables like `{order.currency}`. A save with an unknown variable fails and names the block and the field.
- A template stores only the texts a company changed. Every text left alone follows the default in code.
- Numbers, amounts, dates, addresses and line rows still come from the record. Nobody types them.
- Layout, PDF rendering, ZPL output and the database schema stay the same.

## Problem

Every printed word in the 12 block documents is written into the code, in English. A company cannot rename
"Deliver To" to "Ship To", or "Tax ID:" to "GST No.:", or hide the "EORI:" row. The only texts a user can change
today are the summary tax label, the approval heading and caption, the terms, and the tracking label field names.
The research found about 200 fixed texts (`.ai/research/2026-11-04-block-text-inventory.md`).

This slice is the base for slices 2 and 3. A per-customer template (slice 2) and an edit to one invoice
(slice 3) both change these same texts and toggles.

## Goals

1. A user changes any printed text of a block in the side panel and sees the change in the live preview.
2. A user hides any labelled field or table column of a block.
3. A user resets one text, or a whole block, to the default.
4. A user puts variables in any text. The editor offers only the variables of that document type.
5. The save refuses an unknown variable and an unknown text key, with a message that names the block and the field.
6. The tracking label PDF and its ZPL print the same texts.

## Non-goals

| Not in this slice | Where it goes |
|---|---|
| More than one template per document type, picked per customer or supplier | Slice 2 |
| Edits saved for one document (one invoice, one PO) | Slice 3 |
| Locking or versioning a document after it is sent | Slice 3 |
| A text per language, translated defaults | Slice 2 (a per-language template) |
| Editing amounts, quantities, dates, addresses or line rows | Never. The record is the only source of these values. |
| New layouts: column widths, moving a field to another block, new block types | Later, if users ask |
| Click-to-edit on the PDF preview | Not planned. Editing stays in the side panel. |

## Design

### 1. Text catalog (code)

A new file, `packages/documents/src/template/texts.ts`, lists every editable text. It is the single source
for keys, defaults and the editor labels.

- The catalog has one entry per document type, then one entry per block type.
- Each text has a `key`, a `default` (the English text printed today) and a `kind`:
  - `heading` — a section heading or a document title.
  - `field` — a label in front of a value, for example "Tax ID:". A field is hideable.
  - `column` — a table column header. A column is hideable.
  - `text` — any other printed text: empty-state text, a sentence, a row label such as "Subtotal".
- `field` and `column` texts can be hidden. `heading` and `text` cannot.
- The catalog also has a `document` entry for texts outside any block: the document title, the footer
  words "Page" and "of", and the job traveler materials table.
- The catalog is `as const`, so `TextKey<"purchaseOrder", "parties">` is a type. A block component that asks
  for a key that is not in the catalog fails the type check.

Example entry:

```ts
purchaseOrder: {
  parties: [
    { key: "supplierHeading", kind: "heading", default: "Supplier" },
    { key: "taxId", kind: "field", default: "Tax ID:" },
    { key: "eori", kind: "field", default: "EORI:" },
    { key: "deliverToHeading", kind: "heading", default: "Deliver To" }
  ],
  lineItems: [
    { key: "description", kind: "column", default: "Description" },
    { key: "taxValue", kind: "column", default: "Tax Value" }
  ]
}
```

### 2. Stored shape (database row, no migration)

The `documentTemplate.blocks` JSON gets 2 optional keys on every block. The template gets 1 optional key in `settings`.

| Key | Where | Shape | Meaning |
|---|---|---|---|
| `text` | every block | `Record<string, string>` | Only the texts the user changed. A missing key prints the default. |
| `hidden` | every block | `string[]` | Keys of the `field` and `column` texts the user hid. |
| `text` | `settings` | `Record<string, string>` | Changed texts of the `document` entry. |
| `hidden` | `settings` | `string[]` | Hidden `column` texts of the `document` entry (the job traveler materials table, which is not a block). |

- `schema.ts` adds `text` and `hidden` to `baseFields`, so every block type accepts them. Today zod strips unknown
  keys on save (research, finding 5), so this change is required.
- An empty string is a real value. It prints nothing. "Reset" deletes the key.
- No SQL migration. The columns are JSON. Old rows have no `text` key and print the defaults.

### 3. Rendering

One helper in `packages/documents/src/template/texts.ts` serves every block component:

```ts
const t = blockText(block, data.vars, "purchaseOrder", "parties");
t("taxId")        // the user's text or the default, with variables filled
t.shows("eori")   // false when the user hid it
```

1. The helper reads `block.text[key]`. If the key is missing, it takes the catalog default.
2. The helper fills variables with the existing `interpolateString` (`merge.ts:24`).
3. Each block component replaces each fixed string with `t(key)`.
4. Each block component wraps each hideable field or column in `t.shows(key)`.
5. When a column is hidden, the line-items block gives its width to the "Description" column. The table still fills the page.
6. The footer, the document title and the materials table read `settings.text` the same way.

The tracking label ZPL (`zpl/ProductLabelZPL.tsx`) reads texts through the same helper. It also escapes every
text with the existing `zplFieldData` (`zpl/utils.ts:50`). User text now reaches the printer, so a `^` or `~`
must not break the label.

### 4. Variables

- `merge.ts` makes each catalog `as const`, so the token names of each document type are a type.
- Each `vars.ts` builder returns `Record<TokenOf<docType>, string>`. A builder that misses a token in its catalog fails the type check.
- A new test renders each builder with sample data and checks that it fills every token of its catalog.
- The tracking label catalog gets the `company.*` tokens that its builder already fills (research, finding 6).

### 5. Validation on save

`saveDocumentTemplate` (`settings.server.ts:1529`) runs one new pure function, `validateTemplateText`
(`packages/documents/src/template/texts.ts`), before it writes. The function returns a list of problems. A
non-empty list refuses the save with a field error.

It refuses:

1. A `text` key that is not in the catalog for that document type and block type.
2. A `hidden` key that is not a `field` or `column` text of that block.
3. A variable that is not in the catalog for that document type. This check runs on every text in the template:
   the new `text` maps, rich text, key-value rows, field values, terms, the approval caption and the footer
   registration line.

The error message names the block and the text, for example: "Parties › Tax ID: unknown variable `{order.totl}`".
The editor shows the error next to that text and selects that block.

A template saved before this change can hold an unknown variable in its rich text. Such a template still renders
as it does today. The editor shows the error only when the user saves it again.

### 6. Editor

In `apps/erp/app/components/DocumentTemplateEditor/`:

1. Every block panel gets a "Text" section, built from the catalog. Blocks without a panel today (parties, notes,
   details, jobDetails, issueDetails, associations, actionTasks, reviewers) get a panel with only this section.
2. Each row shows the editor label, an input with the current text, and the variable menu (`MergeFieldMenu`).
3. Each `field` and `column` row also shows a "Show" switch.
4. A changed row shows a "Reset" button. The block panel has "Reset all text".
5. The variable menu inserts the token at the cursor, not at the end of the input (today it appends, research §4).
6. The template-level texts (title, footer words, materials table) go in the existing footer and header panels.
7. All new editor copy uses Lingui (`useLingui().t` or `<Trans>`). The printed defaults stay English, by decision Q3.
8. The preview updates as today: the draft blocks POST to `$type.preview.tsx`.

### 7. Bugs fixed on the way

| Bug | Fix |
|---|---|
| The quote summary ignores the tax label (`quote/registry.tsx:28`) | The quote summary reads its texts from the catalog. |
| The PO summary falls back to "Tax", not "Taxes" (`purchaseOrder/SummaryBlock.tsx:21`) | One catalog default for every summary. |
| A "Text field" block prints nothing on invoices (`B/registry.tsx:81`) | The invoice registry uses the shared `extensionBlocks`. |
| ZPL prints ": value" for a custom field with no label (`ProductLabelZPL.tsx:193`) | ZPL prints the value alone, like the PDF. |
| ZPL does not escape label text | ZPL uses `zplFieldData`. |

### 8. Existing editable texts

Four texts are already editable in their own fields. They stay where they are, and the catalog does not repeat them:
the summary `options.taxLabel`, the approval `heading`, the label `label` (Rev, Qty, S/N, Batch) and the custom
field `label`. The variable check (section 5) covers them too.

## Design decisions

| # | Decision | Options considered | Why |
|---|---|---|---|
| D1 | Store only changed texts; defaults live in code | Store every text in the row | Developers can improve a default and every unchanged template gets it. Rows stay small. |
| D2 | `text` and `hidden` on `baseFields` | A new key per block type | One shape for every block. Slice 3 can reuse the same shape for one document. |
| D3 | A typed catalog in `texts.ts` | Strings left in each component | One list for the editor, the renderer, the ZPL and the validator. The type check catches a wrong key. |
| D4 | Only `field` and `column` texts can hide | Hide any text | Hiding a heading leaves an empty box. Hiding a whole section is the block's own on/off switch. |
| D5 | Hidden column gives its width to "Description" | Leave a gap; recompute every width | It is simple and the table stays full width. |
| D6 | Keep the 4 existing text fields (section 8) | Move them into `text` | No data migration. Saved values keep working. |
| D7 | Old templates with bad variables still render | Refuse to render | Customers keep getting their documents. The fix happens at the next save. |
| D8 | No SQL migration | Add columns | The template is JSON. Old rows print the defaults. |
| D9 | Escape ZPL text | Leave it | User text now reaches the printer. |

## Acceptance criteria

1. A user opens the purchase order template, selects Parties, changes "Tax ID:" to "GST No.:" and the preview shows "GST No.:".
2. After a save and a reload, the panel still shows "GST No.:". The PDF from `/file/purchase-order/{id}.pdf` prints "GST No.:".
3. A user turns off "Show" for "EORI:". The preview and the downloaded PO have no EORI row.
4. A user hides the "Tax Value" column. The PO line table has 8 columns, and "Description" is wider.
5. A user types `Total ({order.currency})` into a summary text. The PDF prints "Total (USD)" for a USD order.
6. A user types `{order.totl}` and saves. The save fails with "Summary › Total: unknown variable `{order.totl}`". The template in the database does not change.
7. A user clicks "Reset" on a changed text. The default comes back, and after save the `text` map has no such key.
8. A template saved before this change renders exactly as before, in all 12 documents.
9. A user changes "Rev" on the tracking label. The label PDF and the ZPL file both print the new text.
10. A part number that contains `^` prints as text in the ZPL. It does not end the field.
11. The quote summary prints the tax label set in its panel.
12. A "Text field" block on an invoice prints its text.
13. Every one of the 12 documents has a "Text" section in each block panel, and every fixed string from the research file appears in it.
14. Type check, Biome and the `@carbon/documents` tests pass. A new test checks every `vars.ts` builder against its catalog.

## Open questions (resolved)

- [x] Q1. What can a user change in a block? — **Answer:** every printed text, and a Show switch for every field and column.
- [x] Q2. What happens on a save with an unknown variable? — **Answer:** the save fails and points at the block and the field.
- [x] Q3. One text, or one text per language? — **Answer:** one text for now. Per-language text comes with templates per customer (slice 2).
- [x] Q4. How many documents in this slice? — **Answer:** all 12, built one document at a time in the plan.

## Changelog

- 2026-11-04 — First draft, after interview Q1–Q4.
- 2026-11-04 — Approved. Built on `feat/document-editor-edits`. Changes made while building:
  - `settings.hidden` was added. The job traveler materials table is not a block, so its hidden columns need a place in the template settings.
  - The issue report footer label "Issue #" became the `document` text `issueNumber`.
  - Drivers stopped taking a `title` prop. The template's `document.title` text owns the title. The packing slip takes `kind: "packingSlip" | "deliveryTicket"` in its place.
  - The sales invoice registry now spreads `extensionBlocks`, so every extension block renders on invoices, not only the field block.
  - No runtime test checks the `vars.ts` builders. Their typed return value catches a missing or extra variable at compile time.
