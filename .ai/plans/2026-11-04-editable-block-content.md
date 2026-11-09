# Editable block content — implementation plan

**Spec / source:** `.ai/specs/2026-11-04-editable-block-content.md`
**Research:** `.ai/research/2026-11-04-block-text-inventory.md` (the list of every fixed string, with file:line)
**Branch:** `feat/document-editor-edits` (worktree `/Users/aashu/work/carbon/carbon-feat-document-editor-edits`)

## Progress

- [x] Task 1: Add `text` and `hidden` to the stored template shape
- [x] Task 2: Build the text catalog types and the `makeText` helper
- [x] Task 3: Type the variable catalogs and the `vars.ts` builders
- [x] Task 4: Write `validateTemplateText`
- [x] Task 5: Refuse a bad template in `saveDocumentTemplate`
- [x] Task 6: Make the page footer words editable
- [x] Task 7: Build the editor "Text" section
- [x] Task 8: Purchase order texts
- [x] Task 9: Sales invoice texts
- [x] Task 10: Sales order texts
- [x] Task 11: Quote texts
- [x] Task 12: Sales return order texts
- [x] Task 13: Purchase return order texts
- [x] Task 14: Purchasing RFQ texts
- [x] Task 15: Packing slip texts
- [x] Task 16: Stock transfer texts
- [x] Task 17: Job traveler texts
- [x] Task 18: Issue report texts
- [x] Task 19: Tracking label texts and ZPL fixes
- [x] Task 20: Extract translations and sync the docs
- [x] Task 21: End-to-end check in the running app

## Dependencies

- Task 2 needs Task 1. Tasks 3 and 4 need Task 2. Task 5 needs Task 4.
- Task 6 needs Task 2.
- Task 7 needs Tasks 2 and 4.
- Tasks 8–19 need Tasks 2, 3 and 6. Tasks 8–19 are independent of each other: each owns its own catalog file and block folder.
- 🛑 Run Tasks 8–19 one at a time, not as parallel subagents. The laptop has crashed from parallel typechecks (memory rule).
- Task 20 needs Tasks 7–19. Task 21 needs all tasks.

## Conventions for every task

- Paths are relative to the worktree root.
- Every new source file starts with the SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Before a heavy command (`turbo run typecheck --filter=erp`, a test suite), run `memory_pressure | tail -1`. If free memory is below 25%, wait and ask the user.
- Scoped checks:
  - `pnpm --filter @carbon/documents typecheck`
  - `pnpm --filter @carbon/documents test`
  - `pnpm exec turbo run typecheck --filter=erp` (heavy, run only where a task says so)
  - `pnpm exec biome check <paths>`
- Never commit. The user commits.

### Text key rules (Tasks 8–19)

1. A key is the camelCase form of the default text without trailing punctuation: "Tax ID:" → `taxId`, "Deliver To" → `deliverTo`, "Unit Price" → `unitPrice`.
2. If two texts in one block give the same key, prefix each with its section: PO "Contact:" for the supplier → `supplierContact`, for the buyer → `buyerContact`.
3. `kind` rules:
   - `heading` for a section heading or a document title.
   - `field` for a label printed before one value ("Tax ID:").
   - `column` for a table column header.
   - `text` for everything else: empty-state text, a sentence, a row label ("Subtotal"), a sub-row label ("- Shipping").
4. `default` is the exact string printed today, character for character, including any trailing colon.
5. A text that includes data today stays split: "Sales Order: SO-1" keeps the data outside the text. The text is "Sales Order:".
6. Text inside `(…)` that is data, such as "(USD)", stays code. Only the word before it is a text.

---

## Task 1: Add `text` and `hidden` to the stored template shape

**Depends on:** none
**Files:**
- Modify: `packages/documents/src/template/schema.ts` — `baseFields` and `documentSettingsSchema`
- Modify: `packages/documents/src/template/template.test.ts` — new cases

**Steps:**
1. In `schema.ts`, change `baseFields` to:
   ```ts
   const baseFields = {
     id: z.string(),
     visible: z.boolean().default(true),
     /** Printed texts the user changed, keyed by catalog key. A missing key prints the default. */
     text: z.record(z.string(), z.string()).optional(),
     /** Catalog keys of the fields and columns the user hid. */
     hidden: z.array(z.string()).optional()
   };
   ```
2. Check every block schema in `schema.ts` spreads `...baseFields`. `builtInBlock` (line 27) already does. If a block schema does not spread `baseFields`, add the spread.
3. In `documentSettingsSchema`, add:
   ```ts
   /** Changed texts that belong to the whole document (title, footer words). */
   text: z.record(z.string(), z.string()).optional()
   ```
4. In `template.test.ts`, add a `describe("block text overrides")` with 3 cases:
   - `blockSchema.parse({ id: "p", type: "parties", visible: true, text: { taxId: "GST:" }, hidden: ["eori"] })` keeps `text` and `hidden`.
   - The same parse without `text` and `hidden` gives `undefined` for both.
   - `documentTemplateSchema.parse(...)` with `settings.text = { page: "Seite" }` keeps it.

**Verify:**
```bash
pnpm --filter @carbon/documents typecheck
# Expected: exits 0
pnpm --filter @carbon/documents test -- template.test.ts
# Expected: all tests pass, including "block text overrides"
```

**Out of scope:** Any SQL migration. The columns are JSON and need none.

---

## Task 2: Build the text catalog types and the `makeText` helper

**Depends on:** 1
**Files:**
- Create: `packages/documents/src/template/texts/types.ts`
- Create: `packages/documents/src/template/texts/index.ts`
- Create: `packages/documents/src/template/texts/texts.test.ts`
- Modify: `packages/documents/src/template/index.ts` — add `export * from "./texts";`

**Steps:**
1. In `texts/types.ts`, write:
   ```ts
   import type { DocumentBlockType, DocumentTemplateType } from "../schema";

   export type TextKind = "heading" | "field" | "column" | "text";

   export interface TextEntry {
     key: string;
     kind: TextKind;
     /** The English text printed when the user changed nothing. */
     default: string;
   }

   /** One document's texts: per block type, plus `document` for texts outside any block. */
   export type DocumentTextCatalog = Partial<
     Record<DocumentBlockType | "document", readonly TextEntry[]>
   >;

   export type TextCatalog = Record<DocumentTemplateType, DocumentTextCatalog>;

   export const HIDEABLE_KINDS: readonly TextKind[] = ["field", "column"];
   ```
2. In `texts/index.ts`, write the helper and the catalog:
   ```ts
   import { interpolateString } from "../merge";
   import type { DocumentTemplateType } from "../schema";
   import type { DocumentTextCatalog, TextCatalog, TextEntry } from "./types";
   import { HIDEABLE_KINDS } from "./types";

   export * from "./types";

   type Stored = { text?: Record<string, string>; hidden?: string[] };

   export type TextFn<K extends string> = ((key: K) => string) & {
     shows: (key: K) => boolean;
   };

   /**
    * The printed text for each key of `entries`: the user's text, else the
    * default, with `{variables}` filled. `shows(key)` is false when the user
    * hid that field or column.
    */
   export function makeText<E extends readonly TextEntry[]>(
     entries: E,
     stored: Stored | undefined,
     vars: Record<string, string>
   ): TextFn<E[number]["key"]> {
     const defaults = new Map(entries.map((e) => [e.key, e.default]));
     const fn = ((key: string) => {
       const raw = stored?.text?.[key] ?? defaults.get(key) ?? "";
       return interpolateString(raw, vars);
     }) as TextFn<E[number]["key"]>;
     fn.shows = (key) => !(stored?.hidden ?? []).includes(key);
     return fn;
   }

   export const TEXT_CATALOG: TextCatalog = {
     salesInvoice: {},
     salesOrder: {},
     salesReturnOrder: {},
     purchaseOrder: {},
     purchaseReturnOrder: {},
     purchasingRfq: {},
     quote: {},
     packingSlip: {},
     stockTransfer: {},
     jobTraveler: {},
     issue: {},
     trackingLabel: {}
   };

   /** The text entries of one block type (or "document") of one document type. */
   export function getTextEntries(
     documentType: DocumentTemplateType,
     blockType: keyof DocumentTextCatalog
   ): readonly TextEntry[] {
     return TEXT_CATALOG[documentType]?.[blockType] ?? [];
   }

   export function isHideable(entry: TextEntry): boolean {
     return HIDEABLE_KINDS.includes(entry.kind);
   }
   ```
3. If `DocumentTemplateType` has a member that is not in step 2's object, add it with `{}`. If step 2 lists a member that the type does not have, STOP and report.
4. In `texts.test.ts`, test `makeText`:
   - It returns the default when `stored` is undefined.
   - It returns the stored text when present.
   - It returns `""` for a stored empty string. An empty string is a real value.
   - It fills `{order.currency}` from `vars`.
   - `shows("eori")` is false when `hidden` holds `"eori"`.
5. In `texts.test.ts`, add a catalog sanity test that loops over every document and block in `TEXT_CATALOG`. It checks that keys are unique within a block and that no default is empty. This test keeps passing as Tasks 8–19 fill the catalog.

**Verify:**
```bash
pnpm --filter @carbon/documents typecheck
# Expected: exits 0
pnpm --filter @carbon/documents test -- texts.test.ts
# Expected: all tests pass
```

**Out of scope:** Filling the catalog. Tasks 8–19 do that.

---

## Task 3: Type the variable catalogs and the `vars.ts` builders

**Depends on:** 2
**Files:**
- Modify: `packages/documents/src/template/merge.ts`
- Modify: the 12 builders: `packages/documents/src/pdf/blocks/vars.ts`, and `vars.ts` in `salesOrder`, `salesReturnOrder`, `purchaseOrder`, `purchaseReturnOrder`, `purchasingRfq`, `quote`, `packingSlip`, `stockTransfer`, `jobTraveler`, `issue`, `trackingLabel` under `packages/documents/src/pdf/blocks/`
- Modify: `packages/documents/src/zpl/ProductLabelZPL.tsx` — `labelVars` (lines 11-21)
- Create: `packages/documents/src/template/merge.test.ts`

**Steps:**
1. In `merge.ts`, make every catalog array `as const satisfies readonly MergeField[]`, starting with `COMPANY_MERGE_FIELDS`.
2. Change `MERGE_FIELDS` to `as const satisfies Record<DocumentTemplateType, readonly MergeField[]>`.
3. Export:
   ```ts
   export type MergeToken<D extends keyof typeof MERGE_FIELDS> =
     (typeof MERGE_FIELDS)[D][number]["token"];
   ```
4. Keep `getMergeFields(documentType: string): readonly MergeField[]` working for callers that pass a plain string.
5. Add `company.name`, `company.city` and `company.country` to `TRACKING_LABEL_MERGE_FIELDS` (research finding 6). Use group "Company" and the labels that `COMPANY_MERGE_FIELDS` uses.
6. Change each builder's return type to `Record<MergeToken<"<docType>">, string>`. Example: `buildPurchaseOrderVars(...): Record<MergeToken<"purchaseOrder">, string>`.
7. Run the typecheck. For each error:
   - If the builder misses a catalog token, add the token to the builder with the value its name says.
   - If the builder returns a key the catalog does not have, add the key to the catalog.
8. Make ZPL `labelVars` return `Record<MergeToken<"trackingLabel">, string>`. Fill the 3 company tokens the same way `pdf/blocks/trackingLabel/vars.ts` does.
9. ~~In `merge.test.ts`, call each builder with its sample data.~~ **Deviation (2026-11-04):** not written. The return type `Record<MergeToken<D>, string>` already fails the type check when a builder misses a token or adds an extra one, so a runtime test would repeat it (`.claude/rules/testing.md`, question 1). ZPL `labelVars` now calls `buildLabelVars`, so the two cannot drift.
   Original step: call each builder with its sample data. Assert that the result has every token of its catalog. Take the samples from `packages/documents/src/pdf/preview-documents.tsx` (`DOCUMENT_PDFS[type].sample`).

**Verify:**
```bash
pnpm --filter @carbon/documents typecheck
# Expected: exits 0
pnpm --filter @carbon/documents test -- merge.test.ts
# Expected: one passing case per document type (12)
```

**Out of scope:** Changing token names or values. Only add missing tokens.

If a builder's arguments cannot be built from the preview sample, STOP and report. Do not invent sample data.

---

## Task 4: Write `validateTemplateText`

**Depends on:** 2, 3
**Files:**
- Create: `packages/documents/src/template/texts/validate.ts`
- Modify: `packages/documents/src/template/texts/index.ts` — `export * from "./validate";`
- Create: `packages/documents/src/template/texts/validate.test.ts`

**Steps:**
1. Write this function in `validate.ts`:
   ```ts
   export interface TextProblem {
     /** The block id, or "document" for settings.text. */
     blockId: string;
     /** The catalog key or the field name ("content", "rows", "label"…). */
     field: string;
     message: string;
   }

   export function validateTemplateText(
     template: Pick<DocumentTemplate, "documentType" | "blocks" | "settings">,
     extraTexts?: { id: string; label: string; text: string }[]
   ): TextProblem[]
   ```
2. Build the set of known tokens with `getMergeFields(template.documentType).map((f) => f.token)`.
3. Write a local `tokensIn(text: string): string[]` with the same regex as `TOKEN_RE` in `merge.ts`. Export `TOKEN_RE` from `merge.ts` if it is not exported.
4. Write a local `textsIn(content: JSONContent): string` that joins every `text` node of a rich-text document.
5. For each block, check these 3 things in this order:
   1. If a `text` key is not in `getTextEntries(documentType, block.type)`, add the problem "unknown text".
   2. If a `hidden` key is not a hideable entry of that block, add the problem "cannot be hidden".
   3. If a variable is not a known token, add the problem "unknown variable `{x}`". Check these places:
      - every value of `block.text`
      - richText `content` and `title`
      - keyValue `rows` labels and values
      - field `label` and `value`
      - terms `content`
      - approval `heading` and `content`
      - summary `options.taxLabel`
      - customField and label-block `label`
      - labelEntityId and labelBarcode `value`
6. Check `settings.text` keys against `getTextEntries(documentType, "document")`, with `blockId: "document"`.
7. Check each `extraTexts` item for unknown variables. Task 5 passes the footer registration line here.
8. Write each message as `"<Block label> › <text default or field name>: <problem>"`. Take the block label from `BLOCK_META[block.type].label` (`defaults.ts`).
9. In `validate.test.ts`, cover these cases:
   - a clean template returns `[]`
   - an unknown text key
   - hiding a `heading`
   - `{order.totl}` in `block.text`
   - `{order.totl}` in richText content
   - an unknown key in `settings.text`
   - a known token (`{order.number}` on purchaseOrder) passes

**Verify:**
```bash
pnpm --filter @carbon/documents test -- validate.test.ts
# Expected: all cases pass
```

**Out of scope:** Rendering. This function only reads.

---

## Task 5: Refuse a bad template in `saveDocumentTemplate`

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `saveDocumentTemplate` (line 1529)

**Steps:**
1. Import `validateTemplateText` from `@carbon/documents/template`.
2. At the top of `run`, call `validateTemplateText({ documentType, blocks, settings })`.
3. Pass the footer registration line as `extraTexts` when the template has a `footerSectionId`:
   1. Read the section with `service.resolveSections`, the same way the header code does at lines 1545-1560.
   2. Read `config.registrationNumber` from the section.
4. If the result is not empty, return `ctx.error("validation", problems.map((p) => p.message).join("\n"))`. The editor's `useAction` shows it as a toast.

**Verify:**
```bash
memory_pressure | tail -1
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
pnpm exec biome check apps/erp/app/modules/settings/settings.server.ts
# Expected: no errors
```

**Out of scope:** The section modal's own save (`upsertDocumentSection`). It keeps its current behavior in this slice.

---

## Task 6: Make the page footer words editable

**Depends on:** 2
**Files:**
- Create: `packages/documents/src/template/texts/shared.ts`
- Modify: `packages/documents/src/pdf/components/Footer.tsx` — lines 49-67
- Modify: `packages/documents/src/pdf/components/Template.tsx` — pass the words through

**Steps:**
1. In `texts/shared.ts`, export:
   ```ts
   export const FOOTER_TEXTS = [
     { key: "page", kind: "text", default: "Page" },
     { key: "of", kind: "text", default: "of" }
   ] as const satisfies readonly TextEntry[];
   ```
2. In `Footer.tsx`, add the props `pageLabel = "Page"` and `ofLabel = "of"`. Use them in the `render` callback in place of the literals at lines 66-67.
3. In `Template.tsx`, add an optional prop `footerText?: { pageLabel: string; ofLabel: string }`. Pass it on to `Footer`.
4. Tasks 8–19 spread `...FOOTER_TEXTS` into each document's `document` entries. Each driver passes `footerText` from `makeText`.

**Verify:**
```bash
pnpm --filter @carbon/documents typecheck
# Expected: exits 0
pnpm --filter @carbon/documents test
# Expected: all tests pass (the defaults keep today's output)
```

**Out of scope:** The registration line sentence (`utils/shared.ts:43-45`). It stays fixed in this slice.

---

## Task 7: Build the editor "Text" section

**Depends on:** 2, 4
**Files:**
- Create: `apps/erp/app/components/DocumentTemplateEditor/TextConfig.tsx`
- Modify: `apps/erp/app/components/DocumentTemplateEditor/BlockConfig.tsx` — `hasOwnConfig` (lines 141-154), the panel body, header and footer panels
- Modify: `apps/erp/app/components/DocumentTemplateEditor/context.tsx` — `textErrors` state, `save` (line 360)
- Modify: `apps/erp/app/components/DocumentTemplateEditor/MergeFieldMenu.tsx` — no change to its API; the cursor insert lives in `TextConfig`
- Copy from (precedent): `SummaryConfig` in `BlockConfig.tsx:370-392` (Label + Input + `updateBlock`) and `FieldConfig` in `labelConfigs.tsx:34+` (an input with `MergeFieldMenu`)

**Steps:**
1. Write `TextConfig({ block })` in `TextConfig.tsx`:
   1. Read `documentType` and `updateBlock` from `useDocumentTemplate()`.
   2. Read the entries with `getTextEntries(documentType, block.type)`. If there are none, return `null`.
   3. Render a heading "Text" with `<Trans>`.
   4. Render one row per entry:
      - a `Label` with the entry's `default`
      - an `Input` whose value is `block.text?.[key] ?? default`
      - a `MergeFieldMenu`
      - for a hideable entry, a `Switch` (`@carbon/react`) labelled "Show"
      - when `block.text` has the key, an `IconButton` labelled "Reset"
   5. On input change, call `updateBlock(block.id, { text: { ...block.text, [key]: value } })`.
   6. On Reset, remove the key from `block.text`.
   7. On Show off, add the key to `block.hidden`. On Show on, remove it.
   8. Below the rows, render "Reset all text". It sets `text: undefined` and `hidden: undefined`.
2. Insert a variable at the cursor:
   1. Keep a `ref` per input.
   2. On insert, read `selectionStart` and `selectionEnd`.
   3. Splice `mergeToken(token)` into the value at that range.
   4. Restore the caret after the token.
3. Show an error under a row when `textErrors[`${block.id}:${key}`]` exists. Use `text-destructive` text.
4. Write `DocumentTextConfig({ keys })` in `TextConfig.tsx`, with the same rows. It reads and writes `settings.text` through the store's settings setter in `context.tsx`. If the store has no settings setter, add `updateSettings(patch)` next to `updateBlock`.
5. In `BlockConfig.tsx`:
   - Render `<TextConfig block={block} />` after the block's own config, for every block.
   - Treat a block with catalog entries as having its own config in `hasOwnConfig`, so the "Reorder or show/hide" hint goes away.
   - In the header panel (`ChromeConfig kind="header"`), render `DocumentTextConfig` for the `title` key.
   - In the footer panel (`FOOTER_BLOCK_ID`), render `DocumentTextConfig` for every `document` key except `title`.
6. In `context.tsx`, change `save`:
   1. Before `fetcher.submit`, run `validateTemplateText({ documentType, blocks, settings })`.
   2. If it returns problems, store them as `textErrors` keyed `${blockId}:${field}`.
   3. Then call `select(firstProblem.blockId)`.
   4. Then show `toast.error` with the first message, and return without submitting.
   5. Clear `textErrors` on every block or settings change.
7. Write all new UI copy (`Text`, `Show`, `Reset`, `Reset all text`, `Document text`) with `useLingui().t` or `<Trans>`.

**Verify:**
```bash
memory_pressure | tail -1
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
pnpm exec biome check apps/erp/app/components/DocumentTemplateEditor
# Expected: no errors
```

**Out of scope:** Changing the existing panels (summary tax label, approval, label field name). They stay as they are (spec §8).

---

## Task 8: Purchase order texts

**Depends on:** 2, 3, 6
**Files:**
- Create: `packages/documents/src/template/texts/purchaseOrder.ts`
- Modify: `packages/documents/src/template/texts/index.ts` — set `purchaseOrder: purchaseOrderTexts` in `TEXT_CATALOG`
- Modify: `packages/documents/src/pdf/blocks/purchaseOrder/{HeaderBlock,PartiesBlock,NotesBlock,LineItemsBlock,SummaryBlock,TermsBlock}.tsx`
- Modify: `packages/documents/src/pdf/PurchaseOrderPDF.tsx` — title, footer text, `data.texts`
- Modify: `packages/documents/src/pdf/blocks/purchaseOrder/types.ts` — add `documentTitle: string` to `PurchaseOrderData`

**Steps:**
1. In `purchaseOrder.ts`, export `purchaseOrderTexts` (`as const satisfies DocumentTextCatalog`) with these block keys:
   - `document`: `title` ("Purchase Order", heading), then `...FOOTER_TEXTS`.
   - `parties`, `notes`, `lineItems`, `summary`, `terms`: every string the research file lists under "purchaseOrder", one entry per string, keys by the Text key rules.
   - `summary`: include "Subtotal", "Shipping", "Total". Do NOT add the tax label; it stays `options.taxLabel` (spec §8).
2. In each block component:
   1. Build `const t = makeText(purchaseOrderTexts.<block>, block, data.vars)`.
   2. Replace each literal with `t("<key>")`.
   3. Wrap each `field` row and each `column` (its header cell AND each row's cell) in `t.shows("<key>") ? … : null`.
   4. Change the registry entry to pass `block` where the block needs it (`registry.tsx`).
3. In `LineItemsBlock.tsx`, add the widths of hidden columns to the "Description" column so the table stays full width.
4. Fix the summary tax fallback. Line 21 becomes `block.options?.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel`.
5. In `PurchaseOrderPDF.tsx`:
   1. Build `const dt = makeText(purchaseOrderTexts.document, settings, vars)`.
   2. Set `data.documentTitle = dt("title")`.
   3. Use `dt("title")` for `title` (keep the `: {displayId}` suffix) and for `meta.subject`.
   4. Pass `footerText={{ pageLabel: dt("page"), ofLabel: dt("of") }}` to `Template`.
6. `HeaderBlock` uses `data.documentTitle`.

**Verify:**
```bash
pnpm --filter @carbon/documents typecheck
# Expected: exits 0
pnpm --filter @carbon/documents test
# Expected: all tests pass, including the catalog sanity test
grep -rn '"Supplier"\|"Deliver To"\|"Subtotal"' packages/documents/src/pdf/blocks/purchaseOrder/*.tsx
# Expected: no output (all moved to the catalog)
```

**Out of scope:** The approval block (it already has its own fields).

---

## Tasks 9–18: one task per document

Each of these tasks uses the same steps as Task 8, with the names below.
Each task follows the Task 8 steps fully. Each one also has these extra steps:

1. Create `packages/documents/src/template/texts/<doc>.ts` exporting `<doc>Texts`. Fill it from the research file's section for that document.
2. Set the document's key in `TEXT_CATALOG`.
3. Replace literals in every block file of `pdf/blocks/<folder>/`.
4. Set the title, `meta.subject` and `footerText` in the driver.
5. Run the Task 8 Verify block, with the grep pointed at that folder and 3 of its strings.

### Task 9: Sales invoice texts
- Catalog `texts/salesInvoice.ts`; blocks are the ROOT files `pdf/blocks/{HeaderBlock,PartiesBlock,NotesBlock,LineItemsBlock,SummaryBlock,TermsBlock}.tsx`; driver `pdf/SalesInvoicePDF.tsx`; title default "Invoice".
- Extra step: fix the field bug. In `pdf/blocks/registry.tsx`, spread `...extensionBlocks` first and delete the `field: () => null` entry at line 81.
- Summary: keys for "Subtotal", "Discount", "Add-Ons", "Shipping", "Total".
- Line items: the sub-rows ("Tax & Fees", "- Shipping", "- Add-On", "- Non-Taxable Add-On", "- Tax") are `text`. "EA" stays code; it is a unit fallback, not a label.

### Task 10: Sales order texts
- Catalog `texts/salesOrder.ts`; blocks `pdf/blocks/salesOrder/`; driver `pdf/SalesOrderPDF.tsx`; title "Sales Order".

### Task 11: Quote texts
- Catalog `texts/quote.ts`; blocks `pdf/blocks/quote/`; driver `pdf/QuotePDF.tsx`; title "Quote".
- Extra step: fix the tax label bug.
  1. In `quote/registry.tsx` line 28, pass `block` to the summary.
  2. In the quote `SummaryBlock`, replace the fixed "Taxes" with `block.options?.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel`.
- "N day(s)" and `{qty} EA` stay code (they are data with a unit).

### Task 12: Sales return order texts
- Catalog `texts/salesReturnOrder.ts`; blocks `pdf/blocks/salesReturnOrder/`; driver `pdf/SalesReturnOrderPDF.tsx`; title "Return Merchandise Authorization".

### Task 13: Purchase return order texts
- Catalog `texts/purchaseReturnOrder.ts`; blocks `pdf/blocks/purchaseReturnOrder/`; driver `pdf/PurchaseReturnOrderPDF.tsx`; title "Return to Supplier".
- The header sub-id "Supplier RMA #:" is a `document` text keyed `supplierRmaNumber`.

### Task 14: Purchasing RFQ texts
- Catalog `texts/purchasingRfq.ts`; blocks `pdf/blocks/purchasingRfq/`; driver `pdf/PurchasingRfqPDF.tsx`; title "Request for Quote".
- The 4 `QUOTATION_CONTENTS` sentences (`PartiesBlock.tsx:17-22`) are 4 `text` entries: `includes1` … `includes4`.
- The letter sentences ("Dear Supplier,", the invitation, "Thank you…", "Sincerely,") are `text` entries.

### Task 15: Packing slip texts
- Catalog `texts/packingSlip.ts`; blocks `pdf/blocks/packingSlip/`; driver `pdf/PackingSlipPDF.tsx`.
- `document` entries: `title` ("Packing Slip") and `rentalTitle` ("Delivery Ticket").
- Extra steps:
  1. In `PackingSlipPDF.tsx`, replace the `title` prop with `kind?: "packingSlip" | "deliveryTicket"` (default `"packingSlip"`).
  2. The driver prints `dt(kind === "deliveryTicket" ? "rentalTitle" : "title")`.
  3. Update the 5 callers in `apps/erp/app/modules/inventory/packing-slip.pdf.tsx` (lines 224, 347, 463, 576, 688). The caller at line 688 passes `kind="deliveryTicket"`. The others pass nothing.
  4. Run `pnpm exec turbo run typecheck --filter=erp` after this task (check memory first).
- `{sourceDocument}:` (`PartiesBlock.tsx:67`) stays code. The label is data.

### Task 16: Stock transfer texts
- Catalog `texts/stockTransfer.ts`; blocks `pdf/blocks/stockTransfer/`; driver `pdf/StockTransferPDF.tsx`; title "Stock Transfer".
- `C/Summary.tsx` appends ":" and prints "Phone:", "Email:", "Website:". Pass these 3 as props from the stock transfer details block. Make them `field` entries of `details`.

### Task 17: Job traveler texts
- Catalog `texts/jobTraveler.ts`; blocks `pdf/blocks/jobTraveler/`; driver `pdf/JobTravelerPDF.tsx`; title "Job Traveler".
- The materials table (`MaterialsBlock.tsx`, rendered at `JobTravelerPDF.tsx:119`, not a block) puts its 3 column texts in `document` with keys `materialsItem`, `materialsDescription`, `materialsQuantity` (`column`).
- `{trackingType} Number:` keeps the tracking type as data. The text is " Number:".
- Check the second render path: `renderJobTravelerPdf` in `apps/erp/app/modules/production/production.pdf.tsx`. If it builds its own page without `JobTravelerPDF`, STOP and report.

### Task 18: Issue report texts
- Catalog `texts/issue.ts`; blocks `pdf/blocks/issue/`; driver `pdf/IssuePDF.tsx`; title "Issue Report".
- The association group labels (`AssociationsBlock.tsx:24-33`) are 8 `text` entries.
- Do not touch the JS `Date` use in `ActionTasksBlock.tsx:135-137`. It is outside this slice.

---

## Task 19: Tracking label texts and ZPL fixes

**Depends on:** 2, 3
**Files:**
- Create: `packages/documents/src/template/texts/trackingLabel.ts`
- Modify: `packages/documents/src/template/texts/index.ts`
- Modify: `packages/documents/src/zpl/ProductLabelZPL.tsx`
- Modify: `packages/documents/src/zpl/productLabelZPL.test.ts`

**Steps:**
1. Create `trackingLabelTexts` with `document: []` only. The label blocks already hold their texts in `label` (spec §8). The catalog file exists so the editor and the validator know the label has no extra texts.
2. In `ProductLabelZPL.tsx`, replace each `^FD${text}^FS` in `textLine` and in the `labelEntityId` case with `zplFieldData(text)` from `./utils`.
3. In the `customField` case (line 193), print `value` alone when `block.label` is empty. Otherwise print `${block.label}: ${value}`.
4. In `productLabelZPL.test.ts`, add 2 cases:
   - An item id `AB^CD` produces `^FH^FDAB_5ECD^FS`. Check the escape format in `zplFieldData` first and use its real output.
   - A custom field with an empty label prints the value without ": ".

**Verify:**
```bash
pnpm --filter @carbon/documents test -- productLabelZPL.test.ts
# Expected: all cases pass
```

**Out of scope:** Kanban and storage unit labels.

---

## Task 20: Extract translations and sync the docs

**Depends on:** 7–19
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated)
- Modify: `.claude/rules/document-template-customizer.md`
- Modify: `packages/documents/AGENTS.md`

**Steps:**
1. Run `pnpm lingui:extract`.
2. Run `pnpm lingui:clean`.
3. In `document-template-customizer.md`, add a section "Editable texts". It must say 5 things:
   1. The catalog lives in `template/texts/` and stores defaults in code.
   2. Blocks carry `text` and `hidden`.
   3. `settings.text` holds the document texts.
   4. `makeText` renders, and `validateTemplateText` guards the save.
   5. A new fixed string in a block must go into the catalog.
4. In `packages/documents/AGENTS.md` "Always", add one line: "Never write a printed label as a literal in a block. Add it to `template/texts/<doc>.ts` and read it with `makeText`."

**Verify:**
```bash
git -C . status --short packages/locale | head
# Expected: modified erp.po files
grep -n "Editable texts" .claude/rules/document-template-customizer.md
# Expected: one match
```

**Out of scope:** `pnpm translate`. The user runs it.

---

## Task 21: End-to-end check in the running app

**Depends on:** all
**Files:** none changed

**Steps:**
1. Run `pnpm db:migrate`. Main brought one new migration when the worktree moved forward.
2. Check the stack is up: `curl -sk -o /dev/null -w "%{http_code}" https://erp.document-editor-edits.dev/login`. If the code is not 200, start it:
   1. Check the portless proxy runs as root (`ps -p $(cat ~/.portless/proxy.pid) -o user=`).
   2. Run `CARBON_DEV_APPS=erp crbn up` in the background.
3. Log in with `agent-browser` as `test@carbon.ms`, with `AGENT_BROWSER_SESSION=doc-editor-edits` (`.claude/skills/auth/SKILL.md`).
4. Check spec acceptance criteria 1–7 and 11–13 in the template editor at `/x/templates/purchaseOrder`, `/x/templates/quote` and `/x/templates/salesInvoice`.
5. For each check, download the PDF from inside the browser (`fetch` in `agent-browser eval`, as done on 2026-11-03).
6. Run `pdftotext` on each download and grep for the expected text.
7. For criteria 9–10, open `/x/templates/trackingLabel`. Change "Rev" and check the ZPL from `/file/entity/<id>/labels.zpl?labelSize=label2x1`.
8. For criterion 8, download one PDF of each of the 12 types with no template saved. Compare its `pdftotext` output with the samples in `~/Downloads/carbon-pdf-samples/`. The only allowed difference is dates that moved.
9. Write the results, one line per criterion with PASS or FAIL, to `.ai/runs/2026-11-04-editable-block-content-e2e.md`.
10. Close the browser session: `agent-browser --session doc-editor-edits close`.

**Verify:**
```bash
grep -c "PASS" .ai/runs/2026-11-04-editable-block-content-e2e.md
# Expected: 14
grep -c "FAIL" .ai/runs/2026-11-04-editable-block-content-e2e.md
# Expected: 0
```

**Out of scope:** Fixing failures inside this task. Report each FAIL and go back to the task that owns it.
