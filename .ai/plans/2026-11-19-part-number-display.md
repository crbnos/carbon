# Part numbers on customer and supplier documents — implementation plan

**Spec:** .ai/specs/2026-11-19-part-number-display.md
**Research:** .ai/research/customer-part-number-display.md
**Closest sibling:** the purchase order and its supplier part number (`purchaseOrderLine.supplierPartId`, `purchaseOrderLines.supplierPartIdFromSupplier`, `getLineSupplierPartId`)
**Branches:**
- Section 1 (shared pieces) and Section 3 (Part II): `eng-140-supplier-part-number-display`, worktree `carbon-supplier-part-number-display`. It lands first.
- Section 2 (Part I, sales): `eng-102-customer-part-number-display`, worktree `carbon-eng-102-customer-part-number-display`, stacked on the shared pieces.

**Rules for every task:**
- Only the main agent runs the `erp` typecheck. A subagent runs Biome and the scoped tests only.
- Start every new source file with its SPDX header: run `pnpm --filter @carbon/checks license-headers`.
- Run `pnpm db:migrate` only on a running stack (`crbn up`). Never rebuild the database.

## Progress

Section 1 — shared pieces (branch `eng-140-supplier-part-number-display`)
- [ ] Task 1: Add the `partNumberDisplay` enum migration
- [ ] Task 2: Regenerate the database types
- [ ] Task 3: Add the shared formatter `part-number.ts`
- [ ] Task 4: Carry a draft display choice through `DocumentEdit`
- [ ] Task 5: Read and save the lines' display choice in the document edit server code
- [ ] Task 6: Add the `PartNumberDisplay` form field and its option labels
- [ ] Task 7: Add the Edit document select (titled "Part Numbers")
- [ ] Task 8: Run the shared gate

Section 2 — Part I, sales (branch `eng-102-customer-part-number-display`)
- [ ] Task 9: Stack the sales branch on the shared pieces
- [ ] Task 10: Add the Part I migration (columns, triggers, views)
- [ ] Task 11: Mark a backup load for the triggers
- [ ] Task 12: Regenerate the types and run the backup check
- [ ] Task 13: Update the demo datasets
- [ ] Task 14: Format sales line part numbers per line
- [ ] Task 15: Add the merge fields and fill them in the line builders
- [ ] Task 16: Update the PDF samples and snapshots
- [ ] Task 17: Pass the draft display choice from the four renderers
- [ ] Task 18: Copy each line's display choice in the conversions
- [ ] Task 19: Add the company default card in Settings > Sales
- [ ] Task 20: Add the customer override to the customer form and operations
- [ ] Task 21: Print each line's part number on the shared quote page
- [ ] Task 22: Turn on the Edit document select for the four sales documents
- [ ] Task 23: Update the docs page and the rules
- [ ] Task 24: Run the Part I gate
- [ ] Task 25: Verify Part I in the browser

Section 3 — Part II, purchasing (branch `eng-140-supplier-part-number-display`, built before Section 2)
- [x] Task 26: Add the Part II migration (columns, 3 triggers, 2 views)
- [x] Task 27: Format purchase order lines per line (PDF and email), with the legacy rows
- [x] Task 28: Add `line.itemId` and `line.supplierPartNumber` to purchase order templates
- [x] Task 29: Pass the draft display choice to the purchase order PDF
- [x] Task 30: Copy the quoted supplier part number in `supplierQuoteToPurchaseOrder`
- [ ] Task 31: Add the company default card in Settings > Purchasing
- [ ] Task 32: Add the supplier override to the supplier form and operations
- [ ] Task 33: Add the Part Numbers select to the purchase order line form
- [ ] Task 34: Turn on the Edit document select for the purchase order
- [ ] Task 35: Update the demo datasets (purchase order lines, one supplier override each)
- [x] Task 36: Update the docs page, the customizer rule and the purchasing AGENTS.md
- [ ] Task 37: Run the Part II gate, then verify Part II in the browser

## Dependencies

- Task 2 needs Task 1. Tasks 3 and 6 need Task 2.
- Task 4 needs Task 3. Task 5 needs Task 4. Task 7 needs Tasks 5 and 6.
- Task 8 needs Tasks 3 to 7.
- Task 9 needs Task 8 committed on `eng-140-supplier-part-number-display`.
- Tasks 10 and 11 need Task 9. They are independent of each other. Task 12 needs Task 10.
- Tasks 13, 14, 18, 19, 20 and 23 need Task 12. They are independent of each other.
- Task 15 needs Task 14. Tasks 16 and 17 need Task 15. Task 21 needs Task 14. Task 22 needs Task 17.
- Task 24 needs Tasks 11 and 13 to 23. Task 25 needs Task 24.

---

# Section 1 — Shared pieces

These tasks add no sales or purchasing behavior. Each document line stores its own display choice (spec Q10). Tasks 5, 6 and 7 take the party ("customer" or "supplier") as a value. Task 3's legacy table names the 5 sales surfaces only, because P5 decides the purchase order's entry. No line table has the column yet, so the Edit document select stays hidden after Section 1.

## Task 1: Add the `partNumberDisplay` enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_part-number-display-enum.sql`

**Steps:**
1. In the worktree `carbon-supplier-part-number-display`, run `pnpm db:migrate:new part-number-display-enum`.
2. Write this SQL into the new file:

```sql
-- Which part numbers a document line prints: ours, the other party's, or both
-- in either order. "Theirs" is the customer on a sales document and the
-- supplier on a purchasing document. Spec: .ai/specs/2026-11-19-part-number-display.md.
DO $$
BEGIN
  CREATE TYPE "partNumberDisplay" AS ENUM (
    'Ours First',
    'Theirs First',
    'Theirs Only',
    'Ours Only'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
```

3. Run `pnpm db:migrate`.

**Verify:**
```bash
psql "$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" -tAc "SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'partNumberDisplay'"
# Expected: Ours First,Theirs First,Theirs Only,Ours Only
```

**Out of scope:** any column that uses the enum. Part I and Part II add their own columns.

## Task 2: Regenerate the database types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts`, `packages/database/src/constants.ts` (generated)

**Steps:**
1. Run `pnpm run generate:types`.
2. Do not edit the generated files by hand.

**Verify:**
```bash
grep -c '"Ours First"' packages/database/src/types.ts
# Expected: a number of 1 or more
```

**Out of scope:** typecheck. Task 8 runs it.

## Task 3: Add the shared formatter `part-number.ts`

**Depends on:** Task 2
**Files:**
- Create: `packages/documents/src/utils/part-number.ts`
- Create: `packages/documents/src/utils/part-number.test.ts`
- Modify: `packages/documents/src/utils/index.ts` — export the new names
- Copy from (precedent): `packages/documents/src/utils/purchase-order.ts` (`getLineSupplierPartId`: trim, blank means none, equal to ours means none)

**Steps:**
1. Create `part-number.ts` with these exports:

```ts
import type { Database } from "@carbon/database";

export type PartNumberDisplay = Database["public"]["Enums"]["partNumberDisplay"];

/** Every value, in the order the selects list them. */
export const PART_NUMBER_DISPLAYS = [
  "Ours First",
  "Theirs First",
  "Theirs Only",
  "Ours Only"
] as const satisfies readonly PartNumberDisplay[];

export function isPartNumberDisplay(value: unknown): value is PartNumberDisplay {
  return (PART_NUMBER_DISPLAYS as readonly unknown[]).includes(value);
}

/**
 * What a legacy line (a null display choice) prints, per surface. Each value
 * repeats what the surface printed before the setting existed.
 */
export const LEGACY_PART_NUMBER_DISPLAY = {
  quote: "Ours First",
  sharedQuote: "Ours Only",
  salesOrder: "Ours First",
  salesInvoice: "Ours Only",
  packingSlip: "Ours Only"
} as const satisfies Record<string, PartNumberDisplay>;

export type PartNumberSurface = keyof typeof LEGACY_PART_NUMBER_DISPLAY;

export function resolvePartNumberDisplay(
  surface: PartNumberSurface,
  stored: PartNumberDisplay | null | undefined
): PartNumberDisplay {
  return stored ?? LEGACY_PART_NUMBER_DISPLAY[surface];
}

/** What the Edit document select shows for a document's lines. */
export type PartNumberDisplaySummary = PartNumberDisplay | "mixed" | null;

export function summarizePartNumberDisplay(
  values: readonly (PartNumberDisplay | null | undefined)[]
): PartNumberDisplaySummary {
  if (values.length === 0) return null;
  const first = values[0] ?? null;
  return values.every((value) => (value ?? null) === first) ? first : "mixed";
}

export function formatPartNumber(
  parts: {
    ours: string | null | undefined;
    theirs: string | null | undefined;
    theirsRevision?: string | null;
  },
  display: PartNumberDisplay
): string
```

2. Write `formatPartNumber` with these rules:
   1. Trim `ours`, `theirs` and `theirsRevision`. An empty string counts as none.
   2. Build their text: `theirs`, then ` Rev {theirsRevision}` when the revision is not empty.
   3. If `theirs` is none, or `theirs` equals `ours` and there is no revision, return `ours` (or `""`).
   4. If `ours` is none, return their text.
   5. `Ours First` returns `{ours} ({theirs text})`.
   6. `Theirs First` returns `{theirs text} ({ours})`.
   7. `Theirs Only` returns their text. `Ours Only` returns `ours`.
3. Add 6 values to the explicit export list in `utils/index.ts`: `formatPartNumber`, `isPartNumberDisplay`, `LEGACY_PART_NUMBER_DISPLAY`, `PART_NUMBER_DISPLAYS`, `resolvePartNumberDisplay`, `summarizePartNumberDisplay`.
4. Add 3 types to the same list: `PartNumberDisplay`, `PartNumberDisplaySummary`, `PartNumberSurface`.
5. Write `part-number.test.ts` with these `formatPartNumber` cases, from the spec's fixture:

| Input | Display | Expected |
|---|---|---|
| ours `P000123.B`, theirs `C-100`, revision `3` | Ours First | `P000123.B (C-100 Rev 3)` |
| same | Theirs First | `C-100 Rev 3 (P000123.B)` |
| same | Theirs Only | `C-100 Rev 3` |
| same | Ours Only | `P000123.B` |
| ours `P000123.B`, theirs `C-200`, no revision | Ours First | `P000123.B (C-200)` (no space before the bracket) |
| ours `P000123.B`, theirs `""` | each of the 4 | `P000123.B` |
| ours `P000123.B`, theirs `P000123.B` | Ours First | `P000123.B` |
| ours null, theirs `C-100` | Ours First | `C-100` |

6. Add 2 cases for `resolvePartNumberDisplay`: `("sharedQuote", null)` returns `Ours Only`, and `("quote", "Theirs Only")` returns `Theirs Only`.
7. Add 5 cases for `summarizePartNumberDisplay`:

| Values | Expected |
|---|---|
| `[]` | `null` |
| `[null, null]` | `null` |
| `["Ours First", "Ours First"]` | `"Ours First"` |
| `["Ours First", null]` | `"mixed"` |
| `["Ours First", "Theirs Only"]` | `"mixed"` |

**Verify:**
```bash
pnpm --filter @carbon/documents exec vitest run src/utils/part-number.test.ts
# Expected: all tests pass (15 or more)
pnpm --filter @carbon/documents typecheck
# Expected: exit 0
```

**Out of scope:** `getLineDescription` in `quote.ts`, `sales-order.ts`, `sales-invoice.ts` and `purchase-order.ts`. Part I and Part II change them.

## Task 4: Carry a draft display choice through `DocumentEdit`

**Depends on:** Task 3
**Files:**
- Modify: `packages/documents/src/template/edit.ts` — `DocumentEdit`, `editToPrint`
- Modify: `packages/documents/src/template/edit.test.ts`
- Copy from (precedent): the `notes` field of `DocumentEdit` and its pass-through in `editToPrint`, in the same file

**Steps:**
1. Add to the `DocumentEdit` type, after `notes`:

```ts
  /**
   * The modal's unsaved display choice for every line, for a preview or
   * download only. `documentEdit` has no column for it: a save writes it to
   * the document's lines.
   */
  partNumberDisplay?: PartNumberDisplay;
```

2. Import the type from `../utils/part-number`.
3. In `editToPrint`, add `partNumberDisplay?: PartNumberDisplay` to the `draft` type.
4. In its last return, pass it on: `{ edit: { ...edit, notes: draft.notes, partNumberDisplay: draft.partNumberDisplay } }`.
5. In `edit.test.ts`, add 2 cases to the `editToPrint` block:
   1. A draft with `partNumberDisplay: "Theirs Only"` returns an edit with `"Theirs Only"`.
   2. A locked record returns the saved edit, with no `partNumberDisplay`.

**Verify:**
```bash
pnpm --filter @carbon/documents exec vitest run src/template/edit.test.ts
# Expected: all tests pass
```

**Out of scope:** the editor store in the ERP app (Task 7). A locked record keeps printing its lines' stored values, because `editToPrint` returns the saved edit, which has no draft.

## Task 5: Read and save the lines' display choice in the document edit server code

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.utils.ts` — `DocumentEditRecord`, `DOCUMENT_EDIT_RECORDS`
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `getDocumentEditRecord`, `saveDocumentEditRow`
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `saveDocumentEdit` input
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `documentEditValidator`
- Modify: `apps/erp/app/routes/api+/document-edit.$type.$id.preview.ts` — `parseDraft`
- Copy from (precedent): the `notesColumn` handling in the same 5 files

**Steps:**
1. In `DocumentEditRecord`, add this field:

```ts
  /**
   * The lines that store a display choice: their table, the column that names
   * the document, and whose part number "theirs" is. Null: the document has none.
   */
  partNumberLines: {
    table:
      | "quoteLine"
      | "salesOrderLine"
      | "salesInvoiceLine"
      | "shipmentLine"
      | "purchaseOrderLine";
    documentColumn:
      | "quoteId"
      | "salesOrderId"
      | "invoiceId"
      | "shipmentId"
      | "purchaseOrderId";
    party: "customer" | "supplier";
  } | null;
```

2. Set `partNumberLines: null` on all 11 entries of `DOCUMENT_EDIT_RECORDS`.
3. In `getDocumentEditRecord`, after the record read, read the lines when `record.partNumberLines` is not null:

```ts
const lines = record.partNumberLines
  ? await fetchAllFromTable<{ partNumberDisplay: PartNumberDisplay | null }>(
      client,
      record.partNumberLines.table,
      "id, partNumberDisplay",
      (query) =>
        query
          .eq(record.partNumberLines!.documentColumn, documentId)
          .eq("companyId", companyId)
          .order("id")
    )
  : null;
if (lines?.error) return { data: null, error: lines.error };
```

4. Return `partNumberDisplay` in `data`: `lines ? summarizePartNumberDisplay(lines.data.map((line) => line.partNumberDisplay)) : null`.
5. Import `fetchAllFromTable` from `@carbon/database`. Import `summarizePartNumberDisplay` and the type from `@carbon/documents/utils`.
6. In `saveDocumentEditRow`, add `partNumberDisplay?: PartNumberDisplay` to `args`.
7. After the notes write, add this write in the same transaction:

```ts
if (args.partNumberDisplay !== undefined && record.partNumberLines) {
  // Every line of the document takes the one choice the modal made.
  await trx
    .updateTable(record.partNumberLines.table as "quoteLine")
    .set({
      partNumberDisplay: args.partNumberDisplay,
      updatedBy: userId,
      updatedAt: now
    } as never)
    .where(record.partNumberLines.documentColumn as "quoteId", "=", documentId)
    .where("companyId", "=", companyId)
    .execute();
}
```

8. In `saveDocumentEdit` (`settings.server.ts`), add `partNumberDisplay: z.enum(PART_NUMBER_DISPLAYS).optional()` to `input`.
9. In its `run`, refuse a value for a document with no part number lines: `ctx.error("validation", "This document has no part number choice")`.
10. Pass `partNumberDisplay: input.partNumberDisplay` to `saveDocumentEditRow`.
11. In `documentEditValidator`, add `partNumberDisplay: zfd.text(z.enum(PART_NUMBER_DISPLAYS).optional())`.
12. In `parseDraft` of the preview route, read `formData.get("partNumberDisplay")`.
13. If the field is absent, leave it `undefined`. If it is not a `PART_NUMBER_DISPLAYS` value, return `null` (an invalid draft). Else pass it in the draft.

The line tables get the column in Part I and Part II. The `as never` cast keeps this code compiling on a branch where no line table has it yet, as the notes write does.

If `saveDocumentEditRow` no longer locks the record row before its writes, STOP and report. Do not improvise.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/settings/settings.utils.ts apps/erp/app/modules/settings/settings.service.ts apps/erp/app/modules/settings/settings.server.ts apps/erp/app/modules/settings/settings.models.ts "apps/erp/app/routes/api+/document-edit.\$type.\$id.preview.ts"
# Expected: "Checked 5 files" and no errors
```

**Out of scope:** setting `partNumberLines` on any document (Task 22, Part II). The `getDocumentEditor` operation needs no change: it spreads `record.data`.

## Task 6: Add the `PartNumberDisplay` form field and its option labels

**Depends on:** Task 2
**Files:**
- Create: `apps/erp/app/components/Form/PartNumberDisplay.tsx`
- Modify: `apps/erp/app/components/Form/index.ts` — import and export `PartNumberDisplay`
- Copy from (precedent): `apps/erp/app/components/Form/DeliveryDateControl.tsx`

**Steps:**
1. Export a hook `usePartNumberDisplayOptions(party: "customer" | "supplier")`. It returns `{ value, label }[]` in `PART_NUMBER_DISPLAYS` order.
2. Key the labels in a `Record<PartNumberDisplay, …>`, so a new enum value fails the typecheck until it has a label.
3. Use these labels, through `useLingui().t`:

| Value | party = customer | party = supplier |
|---|---|---|
| Ours First | Our part number, then the customer's | Our part number, then the supplier's |
| Theirs First | The customer's part number, then ours | The supplier's part number, then ours |
| Theirs Only | The customer's part number only | The supplier's part number only |
| Ours Only | Our part number only | Our part number only |

4. Export the default component `PartNumberDisplay`. It takes `Omit<SelectProps, "options"> & { party: "customer" | "supplier" }`.
5. Render `<Select {...props} options={usePartNumberDisplayOptions(party)} />` from `@carbon/form`.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/components/Form/PartNumberDisplay.tsx apps/erp/app/components/Form/index.ts
# Expected: no errors
```

**Out of scope:** the forms that use the field (Tasks 19, 20).

## Task 7: Add the Edit document select (titled "Part Numbers")

**Depends on:** Tasks 5, 6
**Files:**
- Modify: `apps/erp/app/components/DocumentTemplateEditor/context.tsx` — store state, snapshot, save
- Modify: `apps/erp/app/components/DocumentTemplateEditor/TemplatePreview.tsx` — post the draft
- Modify: `apps/erp/app/components/DocumentEditModalContent.tsx` — seed the store, post on download
- Modify: `apps/erp/app/components/DocumentTemplateEditor/BlockConfig.tsx` — `PartNumberDisplayConfig`
- Modify: `apps/erp/app/components/DocumentTemplateEditor/context.test.ts` — `changedPartNumberDisplay`
- Copy from (precedent): `NotesConfig` in `BlockConfig.tsx`, `changedNotes` in `context.tsx`, the `Select` in `FontConfig.tsx`

**Steps:**
1. In `DocumentMode`, add `partNumberParty: "customer" | "supplier" | null;`.
2. In `EditorSnapshot`, add `partNumberDisplay: PartNumberDisplaySummary;`. Add it to `snapshot()`.
3. Add the prop `initialPartNumberDisplay?: PartNumberDisplaySummary`. Seed the state with `props.initialPartNumberDisplay ?? null`.
4. Add the action `setPartNumberDisplay: (value: PartNumberDisplay) => void`.
5. Export `changedPartNumberDisplay(s)`, next to `changedNotes`. It returns a value only when all 3 conditions hold:
   1. `s.document?.partNumberParty` is not null.
   2. `isPartNumberDisplay(s.partNumberDisplay)` is true.
   3. The value differs from `s.baseline.partNumberDisplay`.
6. Otherwise `changedPartNumberDisplay` returns `undefined`.
7. In `save`, append `partNumberDisplay` to the form data when `changedPartNumberDisplay(s)` returns a value.
8. In `TemplatePreview.tsx`, append the same field next to `notes`.
9. In `DocumentEditModalContent.tsx`, set `partNumberParty: DOCUMENT_EDIT_RECORDS[documentType].partNumberLines?.party ?? null` on `document`.
10. Pass `initialPartNumberDisplay={editor.partNumberDisplay}` to the provider.
11. In the download handler, append the field as step 7 does.
12. In `BlockConfig.tsx`, render `<PartNumberDisplayConfig />` when `isDocument && block.type === "lineItems"`.
13. Write `PartNumberDisplayConfig` as follows:
    1. If the store's `document?.partNumberParty` is null, return null.
    2. Render a `RememberedSection` with id `document:part-numbers` and title "Part Numbers", inside `ReadOnlyWhenLocked`.
    3. Render a `@carbon/react` `Select` with the options of `usePartNumberDisplayOptions(party)`.
    4. Pass the value only when `isPartNumberDisplay(value)` is true.
    5. If the value is `"mixed"`, show the placeholder "Mixed".
    6. If the value is null, show the placeholder "Not set: prints as before".
    7. A pick calls `setPartNumberDisplay`, which sets every line on save.
14. In `context.test.ts`, test `changedPartNumberDisplay` with 4 cases:
    1. No party.
    2. An unchanged value.
    3. A pick over a null baseline.
    4. A `"mixed"` baseline with no pick.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/components/DocumentTemplateEditor/context.test.ts
# Expected: all tests pass
```

**Out of scope:** the company template editor (`x+/templates+/`): it has no record, so `document` is undefined and the Edit document select does not show.

## Task 8: Run the shared gate

**Depends on:** Tasks 3 to 7
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated)

**Steps:**
1. Run `pnpm lingui:extract`.
2. Run `/translate` to fill the new strings in every locale.
3. Run `pnpm --filter @carbon/checks license-headers`.
4. Run `pnpm exec biome check --write` on every file Tasks 3 to 7 changed.
5. Run `pnpm --filter @carbon/documents test` and `pnpm --filter @carbon/documents typecheck`.
6. Main agent only: run `pnpm exec turbo run typecheck --filter=erp --concurrency=1`.
7. Commit through `/check-and-commit` on `eng-140-supplier-part-number-display`, with the spec, research and this plan. Never stage `.ai/runs/`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: "Tasks: 1 successful" for erp, no type errors
```

**Out of scope:** pushing the branch. Opening a PR needs Raul's yes through `crbnos-pr`.

---

# Section 2 — Part I, sales documents

## Task 9: Stack the sales branch on the shared pieces

**Depends on:** Task 8
**Files:** none

**Steps:**
1. In `carbon-eng-102-customer-part-number-display`, run `git status --short`.
2. If the output lists any tracked change, STOP and report.
3. Run `git rebase eng-140-supplier-part-number-display`.
4. If the rebase stops on a conflict, load `.claude/skills/resolving-merge-conflicts/SKILL.md` first.

**Verify:**
```bash
git merge-base --is-ancestor eng-140-supplier-part-number-display HEAD && echo stacked
# Expected: stacked
ls .ai/specs/2026-11-19-part-number-display.md packages/documents/src/utils/part-number.ts
# Expected: both paths print
```

**Out of scope:** any change to `eng-140-supplier-part-number-display`. The untracked run record in the sales worktree stays as it is.

## Task 10: Add the Part I migration (columns, triggers, views)

**Depends on:** Task 9
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_customer-part-number-display.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261104063711_rental-agreement-contacts.sql` (a BEFORE trigger that corrects `NEW`, `SECURITY DEFINER`, `SET search_path = public`)

🛑 The document tables (`quote`, `salesOrder`, `salesInvoice`, `shipment`) get no column. The views `quotes`, `salesOrders` and `salesInvoices` stay as they are.

The trigger functions read the customer and the company default inline. The migration creates no helper function, because a `public` function is an RPC. A trigger function is not: the `public-definer-function-authorizes-caller` invariant leaves out `RETURNS TRIGGER` functions.

**Steps:**
1. Run `pnpm db:migrate:new customer-part-number-display`.
2. Write the columns:

```sql
-- Part I of .ai/specs/2026-11-19-part-number-display.md: which part numbers
-- customer documents print. Each line stores its choice. A null choice is a
-- legacy line: it prints as its surface printed before this migration.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "customerPartNumberDisplay" "partNumberDisplay" NOT NULL DEFAULT 'Ours First';

ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";

ALTER TABLE "quoteLine" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";
ALTER TABLE "salesInvoiceLine" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";
ALTER TABLE "shipmentLine" ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay";

-- The order line also keeps a copy of the customer part number from when it
-- was saved. Null on every line that exists now; those lines keep the live
-- cross-reference.
ALTER TABLE "salesOrderLine"
  ADD COLUMN IF NOT EXISTS "partNumberDisplay" "partNumberDisplay",
  ADD COLUMN IF NOT EXISTS "customerPartId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerPartRevision" TEXT;
```

3. Write the line stamp function and its 4 triggers:

```sql
-- Fills a new line's display choice from its document's customer: the
-- customer's override, else the company default. A line whose document has no
-- customer stays null. A dataset apply (app.sync_in_progress) and a backup load
-- (app.backup_load) bring their own values, so it skips them. PL/pgSQL compiles
-- a trigger function per trigger, so each branch reads its own table's NEW.
CREATE OR REPLACE FUNCTION stamp_line_customer_part_number_display()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id TEXT;
BEGIN
  IF NEW."partNumberDisplay" IS NOT NULL
    OR current_setting('app.sync_in_progress', true) = 'true'
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'quoteLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "quote" d
    WHERE d."id" = NEW."quoteId" AND d."companyId" = NEW."companyId";
  ELSIF TG_TABLE_NAME = 'salesOrderLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "salesOrder" d
    WHERE d."id" = NEW."salesOrderId" AND d."companyId" = NEW."companyId";
  ELSIF TG_TABLE_NAME = 'salesInvoiceLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "salesInvoice" d
    WHERE d."id" = NEW."invoiceId" AND d."companyId" = NEW."companyId";
  ELSIF TG_TABLE_NAME = 'shipmentLine' THEN
    SELECT d."customerId" INTO v_customer_id FROM "shipment" d
    WHERE d."id" = NEW."shipmentId" AND d."companyId" = NEW."companyId";
  END IF;
  IF v_customer_id IS NULL THEN
    RETURN NEW;
  END IF;
  NEW."partNumberDisplay" := COALESCE(
    (SELECT c."partNumberDisplay" FROM "customer" c
      WHERE c."id" = v_customer_id AND c."companyId" = NEW."companyId"),
    (SELECT s."customerPartNumberDisplay" FROM "companySettings" s
      WHERE s."id" = NEW."companyId")
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "quoteLine_stamp_part_number_display" ON "quoteLine";
CREATE TRIGGER "quoteLine_stamp_part_number_display"
  BEFORE INSERT ON "quoteLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesOrderLine_stamp_part_number_display" ON "salesOrderLine";
CREATE TRIGGER "salesOrderLine_stamp_part_number_display"
  BEFORE INSERT ON "salesOrderLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesInvoiceLine_stamp_part_number_display" ON "salesInvoiceLine";
CREATE TRIGGER "salesInvoiceLine_stamp_part_number_display"
  BEFORE INSERT ON "salesInvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();

DROP TRIGGER IF EXISTS "shipmentLine_stamp_part_number_display" ON "shipmentLine";
CREATE TRIGGER "shipmentLine_stamp_part_number_display"
  BEFORE INSERT ON "shipmentLine"
  FOR EACH ROW EXECUTE FUNCTION stamp_line_customer_part_number_display();
```

4. Write the order line copy function and its trigger:

```sql
-- A new order line copies the customer part number of its item for the
-- order's customer, unless the insert sets one. An item change copies it again.
CREATE OR REPLACE FUNCTION copy_sales_order_line_customer_part()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_part TEXT;
  v_revision TEXT;
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true'
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."customerPartId" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."itemId" IS NOT DISTINCT FROM OLD."itemId" THEN
    RETURN NEW;
  END IF;
  SELECT cp."customerPartId", cp."customerPartRevision"
    INTO v_part, v_revision
  FROM "salesOrder" so
  JOIN "customerPartToItem" cp
    ON cp."customerId" = so."customerId"
   AND cp."itemId" = NEW."itemId"
   AND cp."companyId" = so."companyId"
  WHERE so."id" = NEW."salesOrderId" AND so."companyId" = NEW."companyId";
  NEW."customerPartId" := v_part;
  NEW."customerPartRevision" := v_revision;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "salesOrderLine_copy_customer_part" ON "salesOrderLine";
CREATE TRIGGER "salesOrderLine_copy_customer_part"
  BEFORE INSERT OR UPDATE OF "itemId" ON "salesOrderLine"
  FOR EACH ROW EXECUTE FUNCTION copy_sales_order_line_customer_part();
```

5. Write the customer change function and its 4 triggers:

```sql
-- A customer change gives every line that has a display choice the new
-- customer's value. A legacy line (null) keeps its null. On a sales order,
-- every line also takes the new customer's part number, so an order never
-- prints another customer's numbers.
CREATE OR REPLACE FUNCTION restamp_customer_part_number_display()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_display "partNumberDisplay";
  v_user TEXT := COALESCE(NEW."updatedBy", NEW."createdBy");
BEGIN
  IF NEW."customerId" IS NULL
    OR current_setting('app.sync_in_progress', true) = 'true'
    OR current_setting('app.backup_load', true) = 'on' THEN
    RETURN NULL;
  END IF;
  v_display := COALESCE(
    (SELECT c."partNumberDisplay" FROM "customer" c
      WHERE c."id" = NEW."customerId" AND c."companyId" = NEW."companyId"),
    (SELECT s."customerPartNumberDisplay" FROM "companySettings" s
      WHERE s."id" = NEW."companyId")
  );
  IF TG_TABLE_NAME = 'quote' THEN
    UPDATE "quoteLine"
    SET "partNumberDisplay" = v_display, "updatedBy" = v_user, "updatedAt" = NOW()
    WHERE "quoteId" = NEW."id" AND "companyId" = NEW."companyId"
      AND "partNumberDisplay" IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'salesOrder' THEN
    UPDATE "salesOrderLine" sl
    SET "partNumberDisplay" =
          CASE WHEN sl."partNumberDisplay" IS NULL THEN NULL ELSE v_display END,
        "customerPartId" = (
          SELECT cp."customerPartId" FROM "customerPartToItem" cp
          WHERE cp."customerId" = NEW."customerId"
            AND cp."itemId" = sl."itemId" AND cp."companyId" = sl."companyId"),
        "customerPartRevision" = (
          SELECT cp."customerPartRevision" FROM "customerPartToItem" cp
          WHERE cp."customerId" = NEW."customerId"
            AND cp."itemId" = sl."itemId" AND cp."companyId" = sl."companyId"),
        "updatedBy" = v_user,
        "updatedAt" = NOW()
    WHERE sl."salesOrderId" = NEW."id" AND sl."companyId" = NEW."companyId";
  ELSIF TG_TABLE_NAME = 'salesInvoice' THEN
    UPDATE "salesInvoiceLine"
    SET "partNumberDisplay" = v_display, "updatedBy" = v_user, "updatedAt" = NOW()
    WHERE "invoiceId" = NEW."id" AND "companyId" = NEW."companyId"
      AND "partNumberDisplay" IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'shipment' THEN
    UPDATE "shipmentLine"
    SET "partNumberDisplay" = v_display, "updatedBy" = v_user, "updatedAt" = NOW()
    WHERE "shipmentId" = NEW."id" AND "companyId" = NEW."companyId"
      AND "partNumberDisplay" IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "quote_restamp_part_number_display" ON "quote";
CREATE TRIGGER "quote_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "quote"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesOrder_restamp_part_number_display" ON "salesOrder";
CREATE TRIGGER "salesOrder_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "salesOrder"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();

DROP TRIGGER IF EXISTS "salesInvoice_restamp_part_number_display" ON "salesInvoice";
CREATE TRIGGER "salesInvoice_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "salesInvoice"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();

DROP TRIGGER IF EXISTS "shipment_restamp_part_number_display" ON "shipment";
CREATE TRIGGER "shipment_restamp_part_number_display"
  AFTER UPDATE OF "customerId" ON "shipment"
  FOR EACH ROW WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION restamp_customer_part_number_display();
```

6. Recreate the 4 line views with `DROP VIEW IF EXISTS` and `CREATE VIEW … WITH(SECURITY_INVOKER=true)`. Each selects `x.*` before aliased columns, so the new table columns land in the middle. `CREATE OR REPLACE` would then fail (`.ai/lessons.md`, "`CREATE OR REPLACE VIEW` cannot reorder columns"). No SQL function or view depends on these 4 views.
7. `quoteLines`: copy the body from `20260811123619_widen-sales-production-scale.sql` (lines 358 to 377). Change only `CREATE OR REPLACE VIEW` to `CREATE VIEW`. `ql.*` now carries `partNumberDisplay`.
8. `salesOrderLines`: copy the `DROP VIEW` and `CREATE VIEW` block from `20261117063412_delivery-date-check.sql` (lines 39 to 72).
   1. Change `cp."customerPartId",` to `cp."customerPartId" AS "customerPartIdFromCustomer",`.
   2. Change `cp."customerPartRevision",` to `cp."customerPartRevision" AS "customerPartRevisionFromCustomer",`.
   3. Change nothing else. `sl.*` now carries `partNumberDisplay` and the line copy.
9. `salesInvoiceLines`: copy the `DROP VIEW` and `CREATE VIEW` block from `20261006221401_sales-invoice-discount-and-ship-to.sql` (lines 30 to 53). The alias `sl` is the invoice line there.
   1. Replace the `(SELECT cp."customerPartId" … LIMIT 1) as "customerPartId"` subquery with `CASE WHEN sol."customerPartId" IS NOT NULL THEN sol."customerPartId" ELSE cp."customerPartId" END AS "customerPartId"`.
   2. Add the next column: `CASE WHEN sol."customerPartId" IS NOT NULL THEN sol."customerPartRevision" ELSE cp."customerPartRevision" END AS "customerPartRevision"`.
   3. Add `LEFT JOIN "salesOrderLine" sol ON sol.id = sl."salesOrderLineId"`.
   4. Add `LEFT JOIN "customerPartToItem" cp ON cp."customerId" = si."customerId" AND cp."itemId" = i.id`.
   5. `customerPartToItem` is unique on (`customerId`, `itemId`), so the join adds no row.
10. `shipmentLines`: copy the body from `20260417000300_storage-unit-recreate-dependents.sql` (lines 1674 to 1685). Write it as `DROP VIEW` plus `CREATE VIEW`.
    1. Add 2 last columns, `customerPartId` and `customerPartRevision`, each a `CASE` on `sol` as in step 9.
    2. Add `LEFT JOIN "shipment" s ON s.id = sl."shipmentId"`.
    3. Add `LEFT JOIN "salesOrderLine" sol ON s."sourceDocument" = 'Sales Order' AND sol.id = sl."lineId"`.
    4. Add `LEFT JOIN "customerPartToItem" cp ON cp."customerId" = s."customerId" AND cp."itemId" = sl."itemId"`.
11. Recreate `customers` with `CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true)`:
    1. Copy the body from `20260521124731_supplier-customer-readable-id.sql` (after its `DROP VIEW IF EXISTS "customers"`).
    2. Add `c."partNumberDisplay"` as the last column, after `pc."fax" AS "fax"`.
    3. Do not copy the `DROP VIEW`: a column added at the end keeps the view's dependents.
12. Run `pnpm db:migrate`.

If `pnpm db:migrate` fails with "record "new" has no field", STOP and report. Do not split the functions on your own.
If a `DROP VIEW` fails because another object depends on the view, STOP and report the object.

**Verify:**
```bash
DB="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
psql "$DB" -tAc "SELECT count(*) FROM pg_trigger WHERE tgname IN ('quoteLine_stamp_part_number_display','salesOrderLine_stamp_part_number_display','salesInvoiceLine_stamp_part_number_display','shipmentLine_stamp_part_number_display','salesOrderLine_copy_customer_part','quote_restamp_part_number_display','salesOrder_restamp_part_number_display','salesInvoice_restamp_part_number_display','shipment_restamp_part_number_display')"
# Expected: 9
psql "$DB" -tAc "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'salesOrderLines' AND column_name LIKE 'customerPart%'"
# Expected: customerPartId,customerPartIdFromCustomer,customerPartRevision,customerPartRevisionFromCustomer
psql "$DB" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('quoteLines','salesOrderLines','salesInvoiceLines','shipmentLines') AND column_name = 'partNumberDisplay'"
# Expected: 4
psql "$DB" -tAc "SELECT count(*) FROM pg_class c WHERE c.relname IN ('quoteLines','salesOrderLines','salesInvoiceLines','shipmentLines','customers') AND c.reloptions::text LIKE '%security_invoker=true%'"
# Expected: 5
```

Then prove the stamp and its skip on a copy of a real quote line, in a transaction that rolls back:

```bash
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE probe ON COMMIT DROP AS SELECT * FROM "quoteLine" LIMIT 1;
UPDATE probe SET id = 'probe-stamped', "partNumberDisplay" = NULL;
INSERT INTO "quoteLine" SELECT * FROM probe;
SET LOCAL app.backup_load = 'on';
UPDATE probe SET id = 'probe-loaded';
INSERT INTO "quoteLine" SELECT * FROM probe;
SELECT id, "partNumberDisplay" FROM "quoteLine" WHERE id IN ('probe-stamped', 'probe-loaded') ORDER BY id;
ROLLBACK;
SQL
# Expected: probe-loaded with an empty display, probe-stamped with "Ours First" (or the customer's override)
```

If the probe prints no row, the database has no quote line. Seed one with `pnpm db:seed:dev -- --email test@carbon.ms --dataset satellite --skip-plan`, then run the probe again. If the INSERT fails for another reason, STOP and report the error.

**Out of scope:** the `quotes`, `salesOrders`, `salesInvoices` and `quoteLinePrices` views. `quoteLinePrices` also expands `ql.*`, but no reader needs the new column there. Purchasing tables (Part II).

## Task 11: Mark a backup load for the triggers

**Depends on:** Task 9
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-restore.ts` — `wipeAndLoad` (line 156)
- Modify: `packages/jobs/src/inngest/functions/tasks/company-import.ts` — the load transaction (line 306)
- Copy from (precedent): the `SET LOCAL app.inspection_release = 'on'` line in each file

A restore and an import load with `session_replication_role = 'replica'` when the connection may set it, and then no trigger runs. Without it, the load runs with triggers on, and the stamp trigger would give a legacy line a value. The setting below makes the Task 10 triggers skip that load too.

**Steps:**
1. In `wipeAndLoad`, after `SET LOCAL app.inspection_release = 'on'`, add:

```ts
    // The triggers that fill a document line's part number display choice
    // leave a backup's values as they are, also when replica mode is off.
    await sql`SET LOCAL app.backup_load = 'on'`.execute(trx);
```

2. In `company-import.ts`, add the same 2 lines after its `SET LOCAL app.inspection_release = 'on'`.

**Verify:**
```bash
grep -c "app.backup_load" packages/jobs/src/inngest/functions/tasks/company-restore.ts packages/jobs/src/inngest/functions/tasks/company-import.ts
# Expected: 1 for each file
pnpm --filter @carbon/jobs typecheck
# Expected: exit 0
```

**Out of scope:** `datasets/index.ts`: the dataset apply already sets `app.sync_in_progress`, which the triggers read.

## Task 12: Regenerate the types and run the backup check

**Depends on:** Task 10
**Files:**
- Modify: `packages/database/src/types.ts`, `packages/database/src/constants.ts` (generated)

**Steps:**
1. Run `pnpm run generate:types`.
2. Run `pnpm db:check:backups`.
3. Run `pnpm --filter @carbon/checks clobbers`.

**Verify:**
```bash
grep -c "customerPartIdFromCustomer" packages/database/src/types.ts
# Expected: 1 or more
pnpm db:check:backups
# Expected: exit 0
```

**Out of scope:** `ID_REF_COLUMNS` and `TABLE_RENAMES`: the new columns hold no row id, and no table changes name.

## Task 13: Update the demo datasets

**Depends on:** Task 12
**Files:**
- Create: `packages/database/src/datasets/helpers/part-number-display.ts`
- Modify: `packages/database/src/datasets/index.ts` — `applyDatasetTiers`, after the tier loop
- Modify: `packages/database/src/datasets/types.ts` — `CustomerSpec`
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — the customer insert (line 374)
- Modify: `packages/database/src/datasets/data/{defense,motor,precision,robotics,satellite}/foundation.ts` — one customer override each
- Modify: `packages/database/src/datasets/validate.ts` — `COVERAGE` (line 193) and the `foundation` rule (line 1317)
- Copy from (precedent): `ensureUnitsOfMeasure` (`helpers/units-of-measure.ts`) for the helper shape; `procedureStatus` in `COVERAGE` and its `ctx.cover` call in `foundation`

The triggers skip a dataset apply (`app.sync_in_progress`), so the apply stamps the seeded lines itself. One step after the tiers covers every tier that inserts sales lines: sales, rentals, service and contracts.

**Steps:**
1. Create the helper:

```ts
import type { Ctx } from "../types";

/**
 * Stamps every seeded sales line with its customer's part number display
 * choice, else the company default, as the line triggers do outside a seed.
 * Then copies the customer part number onto the seeded order lines.
 */
export async function stampPartNumberDisplay(ctx: Ctx): Promise<void> {
  await ctx.client.query(STAMP_SQL, [ctx.companyId]);
}
```

2. Set `STAMP_SQL` to these 5 statements, joined in one string:

```sql
UPDATE "quoteLine" l
SET "partNumberDisplay" = COALESCE(c."partNumberDisplay", s."customerPartNumberDisplay")
FROM "quote" d
JOIN "customer" c ON c."id" = d."customerId" AND c."companyId" = d."companyId"
JOIN "companySettings" s ON s."id" = d."companyId"
WHERE l."quoteId" = d."id" AND l."companyId" = d."companyId"
  AND d."companyId" = $1 AND l."partNumberDisplay" IS NULL;

UPDATE "salesOrderLine" l
SET "partNumberDisplay" = COALESCE(c."partNumberDisplay", s."customerPartNumberDisplay")
FROM "salesOrder" d
JOIN "customer" c ON c."id" = d."customerId" AND c."companyId" = d."companyId"
JOIN "companySettings" s ON s."id" = d."companyId"
WHERE l."salesOrderId" = d."id" AND l."companyId" = d."companyId"
  AND d."companyId" = $1 AND l."partNumberDisplay" IS NULL;

UPDATE "salesInvoiceLine" l
SET "partNumberDisplay" = COALESCE(c."partNumberDisplay", s."customerPartNumberDisplay")
FROM "salesInvoice" d
JOIN "customer" c ON c."id" = d."customerId" AND c."companyId" = d."companyId"
JOIN "companySettings" s ON s."id" = d."companyId"
WHERE l."invoiceId" = d."id" AND l."companyId" = d."companyId"
  AND d."companyId" = $1 AND l."partNumberDisplay" IS NULL;

UPDATE "shipmentLine" l
SET "partNumberDisplay" = COALESCE(c."partNumberDisplay", s."customerPartNumberDisplay")
FROM "shipment" d
JOIN "customer" c ON c."id" = d."customerId" AND c."companyId" = d."companyId"
JOIN "companySettings" s ON s."id" = d."companyId"
WHERE l."shipmentId" = d."id" AND l."companyId" = d."companyId"
  AND d."companyId" = $1 AND l."partNumberDisplay" IS NULL;

UPDATE "salesOrderLine" sl
SET "customerPartId" = cp."customerPartId",
    "customerPartRevision" = cp."customerPartRevision"
FROM "salesOrder" so, "customerPartToItem" cp
WHERE sl."salesOrderId" = so."id"
  AND so."companyId" = $1
  AND cp."companyId" = so."companyId"
  AND cp."customerId" = so."customerId"
  AND cp."itemId" = sl."itemId"
  AND sl."customerPartId" IS NULL;
```

3. In `applyDatasetTiers`, after the tier loop, call `await stampPartNumberDisplay(ctx)`.
4. Add `partNumberDisplay?: Database["public"]["Enums"]["partNumberDisplay"];` to `CustomerSpec`, with the comment "Omitted = the company default".
5. In the customer insert, pass `partNumberDisplay: spec.partNumberDisplay ?? null`.
6. In each of the 5 `foundation.ts` files, set `partNumberDisplay: "Theirs First"` on one customer.
7. Pick a customer that the dataset's `items.ts` names in `customerParts`.
8. In `COVERAGE`, add this entry:

```ts
  customerPartNumberDisplay: {
    values: ["Theirs First"],
    missing: (value) =>
      `foundation.customers: no customer with partNumberDisplay "${value}"`
  },
```

9. In `foundation`, call `ctx.cover({ customerPartNumberDisplay: new Set(f.customers.flatMap((c) => (c.partNumberDisplay ? [c.partNumberDisplay] : []))) })`.

`coverage.ts` holds row counts per table only. The value coverage table in `validate.ts` is the place for "a customer with an override". The 6th dataset, `motor-line`, is a walkthrough with no customers, and its coverage checks are off.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: every dataset applies and rolls back, no validation message
```

**Out of scope:** the purchasing shipment in `05-purchasing.ts` (line 616): its shipment has no customer, so its lines stay null.

## Task 14: Format sales line part numbers per line

**Depends on:** Task 12
**Files:**
- Modify: `packages/documents/src/utils/part-number.ts` — `lineCustomerPart`
- Modify: `packages/documents/src/utils/quote.ts` — `getLineDescription`
- Modify: `packages/documents/src/utils/sales-order.ts` — `getLineDescription`, `getLineDescriptionDetails`
- Modify: `packages/documents/src/utils/sales-invoice.ts` — `getLineDescription`
- Create: `packages/documents/src/utils/sales-line-part-number.test.ts`
- Copy from (precedent): `getLineSupplierPartId` in `utils/purchase-order.ts`

**Steps:**
1. Add to `part-number.ts`, and add it to the export list in `utils/index.ts`:

```ts
/** A sales order line's customer part: its own copy, else the live cross-reference. */
export function lineCustomerPart(line: {
  customerPartId?: string | null;
  customerPartRevision?: string | null;
  customerPartIdFromCustomer?: string | null;
  customerPartRevisionFromCustomer?: string | null;
}): { id: string | null; revision: string | null } {
  return line.customerPartId?.trim()
    ? { id: line.customerPartId, revision: line.customerPartRevision ?? null }
    : {
        id: line.customerPartIdFromCustomer ?? null,
        revision: line.customerPartRevisionFromCustomer ?? null
      };
}
```

2. Give each `getLineDescription` a second, optional parameter `draft?: PartNumberDisplay`. A draft is the Edit document modal's unsaved pick.
3. In each, resolve the line's display as `resolvePartNumberDisplay(surface, draft ?? line.partNumberDisplay)`.
4. Change the part-number return of each to `formatPartNumber({ ours, theirs, theirsRevision }, display)`:

| File | Surface | Return to change | `ours` | `theirs`, `theirsRevision` |
|---|---|---|---|---|
| `quote.ts` | `"quote"` | the only return (the function has no branches) | `line.itemReadableId` | `line.customerPartId`, `line.customerPartRevision` |
| `sales-order.ts` | `"salesOrder"` | the `default` branch | `line.itemReadableId` | `lineCustomerPart(line)` |
| `sales-invoice.ts` | `"salesInvoice"` | the `default` branch, when `isItemlessServiceLine(line)` is false | `line.itemReadableId` | `line.customerPartId`, `line.customerPartRevision` |

5. Keep the `Fixed Asset` and `Comment` branches as they are. Keep the itemless Service return of `sales-invoice.ts` too.
6. In `sales-order.ts` `getLineDescriptionDetails`, remove the customer part text. It returns `distinctItemText(line.itemReadableId, line.description) ?? ""`.
7. Write the test with 6 cases:
   1. A sales order line with a copy prints the copy, not `customerPartIdFromCustomer`.
   2. A sales order line with no copy prints `customerPartIdFromCustomer`.
   3. `getLineDescriptionDetails` of a sales order line never contains the customer part number.
   4. A quote line with no revision prints `P000123.B (C-200)`.
   5. An invoice line with a null `partNumberDisplay` prints `P000123.B`, its legacy output.
   6. A draft of `"Ours Only"` wins over a line value of `"Theirs Only"`.

**Verify:**
```bash
pnpm --filter @carbon/documents exec vitest run src/utils/sales-line-part-number.test.ts src/utils/part-number.test.ts
# Expected: all tests pass
```

`SalesOrderEmail` and `SalesInvoiceEmail` call `getLineDescription(line)` with no draft. Each line now prints its own stored choice, so the emails need no change.

**Out of scope:** `utils/purchase-order.ts` (Part II).

## Task 15: Add the merge fields and fill them in the line builders

**Depends on:** Task 14
**Files:**
- Modify: `packages/documents/src/template/mergeFields.ts` — `LINE`, `LINE_MERGE_FIELDS`
- Modify: `apps/erp/app/components/DocumentTemplateEditor/mergeFieldNames.ts` — 2 names
- Modify: `packages/documents/src/pdf/blocks/quote/vars.ts`, `quote/LineItemsBlock.tsx`, `quote/types.ts`
- Modify: `packages/documents/src/pdf/blocks/salesOrder/vars.ts`, `salesOrder/LineItemsBlock.tsx`, `salesOrder/types.ts`
- Modify: `packages/documents/src/pdf/blocks/vars.ts` (`buildSalesInvoiceLineVars`), `blocks/LineItemsBlock.tsx`, `blocks/types.ts`
- Modify: `packages/documents/src/pdf/blocks/packingSlip/vars.ts`, `packingSlip/LineItemsBlock.tsx`, `packingSlip/types.ts`
- Modify: `packages/documents/src/pdf/QuotePDF.tsx`, `SalesOrderPDF.tsx`, `SalesInvoicePDF.tsx`, `PackingSlipPDF.tsx` — the new prop
- Modify: `packages/documents/src/pdf/blocks/lineVars.test.ts`
- Copy from (precedent): `LINE.supplierPartId` and `"line.supplierPartId"` in `purchaseOrder/vars.ts`

**Steps:**
1. Add to `LINE`:

```ts
  customerPartId: value("line.customerPartId", "Line Customer Part ID", "Line"),
  customerPartRevision: value(
    "line.customerPartRevision",
    "Line Customer Part Revision",
    "Line"
  ),
```

2. Add `LINE.itemId`, `LINE.customerPartId` and `LINE.customerPartRevision` to the `quote`, `salesOrder`, `salesInvoice` and `packingSlip` line fields. None of the 4 sets has `LINE.itemId` now.
3. Add `"Line Customer Part ID"` and `"Line Customer Part Revision"` to `MERGE_FIELD_NAMES`, with `msg`. The labels follow the sibling label "Line Supplier Part ID".
4. Add `partNumberDisplayDraft?: PartNumberDisplay` to `QuoteData`, `SalesOrderData`, `SalesInvoiceData` and `PackingSlipData`.
5. Add the same optional prop to each of the 4 driver props. Put it in the driver's `data` object.
6. Give each line builder the draft:
   1. `buildQuoteLineVars(line, rowNumber, draft?)` and `buildPackingSlipLineVars(line, serialBatch, draft?)` take a third parameter.
   2. `buildSalesOrderLineVars` and `buildSalesInvoiceLineVars` add `"partNumberDisplayDraft"` to their `data` `Pick`.
   3. Each `LineItemsBlock` passes `data.partNumberDisplayDraft`.
7. In each builder:
   1. `line.description` (quote, order, invoice) is `getLineDescription(line, draft)`.
   2. `line.item` (packing slip) is `formatPartNumber` of the line's numbers and `resolvePartNumberDisplay("packingSlip", draft ?? line.partNumberDisplay)`.
   3. `line.itemId` is `str(line.itemReadableId)`.
   4. `line.customerPartId` and `line.customerPartRevision` hold the line's customer part, whatever the display choice.
   5. A sales order line reads them through `lineCustomerPart`.
8. In `lineVars.test.ts`, add 3 cases:
   1. A line with `Ours Only` still fills `line.customerPartId`.
   2. A line with `Theirs Only` still fills `line.itemId` with our part number.
   3. A packing slip line with `Theirs Only` and the draft `Ours Only` prints our part number in `line.item`.

**Verify:**
```bash
pnpm --filter @carbon/documents test
# Expected: all tests pass except the 2 PDF snapshot files, which Task 16 updates
cd apps/erp && pnpm exec vitest run app/components/DocumentTemplateEditor/mergeFieldNames.test.ts
# Expected: pass
```

**Out of scope:** the default texts in `template/texts/`: they keep `{line.description}` and `{line.item}`.

## Task 16: Update the PDF samples and snapshots

**Depends on:** Task 15
**Files:**
- Modify: `packages/documents/src/pdf/quote.samples.ts`, `salesOrder.samples.ts`, `packingSlip.samples.ts`
- Modify: `packages/documents/src/pdf/samples.ts` — `SAMPLE_SALES_INVOICE` (the invoice has no samples file of its own)
- Modify: `packages/documents/src/pdf/__snapshots__/preview-documents.test.ts.snap`
- Modify: `apps/erp/app/components/DocumentTemplateEditor/__snapshots__/previewClick.pdf.test.ts.snap`

**Steps:**
1. Give one line of each sales sample the customer part `C-100`, revision `3`, and `partNumberDisplay: "Ours First"`.
2. On the sales order sample line, set the line copy fields. Set `customerPartIdFromCustomer` to null.
3. Run `pnpm --filter @carbon/documents exec vitest run src/pdf/preview-documents.test.ts -u`.
4. Run `cd apps/erp && pnpm exec vitest run app/components/DocumentTemplateEditor/previewClick.pdf.test.ts -u`.
5. Read the snapshot diff. Each sales sample prints `(C-100 Rev 3)` once on the line heading.
6. If a snapshot changes on a purchasing sample, STOP and report.

**Verify:**
```bash
git diff --stat -- '*.snap'
# Expected: only the 2 snapshot files above
pnpm --filter @carbon/documents test
# Expected: all tests pass
```

**Out of scope:** the purchase order sample.

## Task 17: Pass the draft display choice from the four renderers

**Depends on:** Task 15
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.pdf.tsx` — `renderQuotePdf` (line 75), `renderSalesOrderPdf` (line 251)
- Modify: `packages/lib/src/sales-invoice-document.server.tsx` — `loadSalesInvoiceDocument` (line 50)
- Modify: `packages/lib/src/packing-slip-document.server.tsx` — `loadPackingSlipDocument` (line 86)
- Copy from (precedent): how each renderer passes `edit` to `getPrintedTemplate`

Each line carries its own display choice through its view (`quoteLines`, `salesOrderLines`, `salesInvoiceLines`, `shipmentLines`). A renderer reads no document column. It passes only the modal's draft, which is set on a preview or download.

**Steps:**
1. In `renderQuotePdf` and `renderSalesOrderPdf`, pass `partNumberDisplayDraft={edit?.partNumberDisplay}` to the PDF driver.
2. In `loadSalesInvoiceDocument`, put `partNumberDisplayDraft: args.edit?.partNumberDisplay` in `pdfProps`. Leave `email` as it is.
3. In `loadPackingSlipDocument`, put `partNumberDisplayDraft: args.edit?.partNumberDisplay` in `pdfProps`.

`loadSalesInvoiceDocument` also feeds the invoice email, the print job (`print-job/resolvers.ts`) and `automate-invoice.ts`. Those callers pass no `edit`, so each line prints its stored choice.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/sales/sales.pdf.tsx packages/lib/src/sales-invoice-document.server.tsx packages/lib/src/packing-slip-document.server.tsx
# Expected: no errors
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: exit 0
```

**Out of scope:** `apps/erp/app/modules/inventory/packing-slip.pdf.tsx` and the file routes: they call the loaders and need no change. The saved quote PDF at finalize also calls `renderQuotePdf`.

## Task 18: Copy each line's display choice in the conversions

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — 4 cases of `convertDocument`

The trigger fills only a null, so a copied value wins. Each source line comes from its table through `many(db, …)`, so it carries `partNumberDisplay`.

**Steps:**
1. `quoteToSalesOrder`: in each `salesOrderLineInserts` row (built at line 9984), add 3 fields:
   1. `partNumberDisplay: line.partNumberDisplay`
   2. `customerPartId: line.customerPartId`
   3. `customerPartRevision: line.customerPartRevision`
2. `salesOrderToSalesInvoice`: in the `acc.push` row (line 10317), add `partNumberDisplay: line.partNumberDisplay`.
3. `shipmentToSalesInvoice`: in the `acc.push` row (line 10973), add `partNumberDisplay: line.partNumberDisplay`.
4. `shipmentFromSalesOrder`: in the 2 `shipmentLine` inserts (lines 14572 and 14664), add `partNumberDisplay: salesOrderLine.partNumberDisplay`.
5. If the `line` of step 3 is not a `salesOrderLine` row, STOP and report.

The quote revision (`quoteToQuote`, `production.service.ts` line 23458) spreads each source `quoteLine` row, so it already copies the column. Make no change there.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/shared/shared.service.ts
# Expected: no errors
grep -c "partNumberDisplay: " apps/erp/app/modules/shared/shared.service.ts
# Expected: 5
```

**Out of scope:** the RFQ-to-quote conversion (line 10650): it has no source value, so the trigger stamps it. The empty `shipmentLineItems` list of `shipmentFromSalesOrder` (line 14692) gets no row in that case.

## Task 19: Add the company default card in Settings > Sales

**Depends on:** Task 12
**Files:**
- Create: `apps/erp/app/modules/settings/ui/Sales/PartNumbersCard.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `partNumberDisplaySettingsValidator`
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `updateSalesSettings` input
- Modify: `apps/erp/app/routes/x+/settings+/sales.tsx` — form union, card placement
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Sales/DeliveryDateCheckCard.tsx`

**Steps:**
1. Add `partNumberDisplaySettingsValidator = z.object({ customerPartNumberDisplay: z.enum(PART_NUMBER_DISPLAYS) })`.
2. Add `customerPartNumberDisplay: z.enum(PART_NUMBER_DISPLAYS).optional()` to `updateSalesSettings` input.
3. Add to `salesSettingsForm`: `partNumberDisplaySettingsValidator.extend({ intent: z.literal("customerPartNumberDisplay") }).transform(({ customerPartNumberDisplay }) => ({ customerPartNumberDisplay }))`.
4. Build `PartNumbersCard` from the precedent:
   1. Title "Part Numbers on Documents".
   2. Description "Choose which part numbers new quote, order, invoice and packing slip lines print. A customer can override this choice."
   3. One `PartNumberDisplay` field with `party="customer"`, `name="customerPartNumberDisplay"` and the label "Print".
   4. A hidden `intent` of `customerPartNumberDisplay`, and the toast "Part numbers on documents updated".
5. Render the card in `sales.tsx` in the Documents section, before the "Customers" section header.
6. Give the card `companySettings.customerPartNumberDisplay ?? "Ours First"` as its initial value.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/settings/ui/Sales/PartNumbersCard.tsx "apps/erp/app/routes/x+/settings+/sales.tsx"
# Expected: no errors
```

**Out of scope:** the purchasing settings card (Part II).

## Task 20: Add the customer override to the customer form and operations

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `customerValidator`
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — `createCustomer`, `updateCustomer` inputs
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerForm.tsx` — the field
- Modify: `apps/erp/app/routes/x+/customer+/$customerId.details.tsx` — `initialValues`
- Copy from (precedent): the `currencyCode` field in the same 4 files

**Steps:**
1. Add `partNumberDisplay: zfd.text(z.enum(PART_NUMBER_DISPLAYS).optional())` to `customerValidator`.
2. Add `partNumberDisplay: z.enum(PART_NUMBER_DISPLAYS).nullable().optional()` to both operation inputs.
3. Import `PartNumberDisplay` from `~/components/Form` in `CustomerForm`.
4. Add this field after `Currency`:

```tsx
<PartNumberDisplay
  party="customer"
  name="partNumberDisplay"
  label={t`Part Numbers on Documents`}
  isOptional
  placeholder={t`Company default`}
/>
```

5. In `initialValues`, add `partNumberDisplay: routeData?.customer?.partNumberDisplay ?? undefined`.

An empty field reaches `upsertCustomer` as `undefined`, and `sanitize` writes null. So "Company default" saves null.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/sales/sales.models.ts apps/erp/app/modules/sales/sales.server.ts apps/erp/app/modules/sales/ui/Customer/CustomerForm.tsx "apps/erp/app/routes/x+/customer+/\$customerId.details.tsx"
# Expected: no errors
```

**Out of scope:** the customer CSV import (`imports.models.ts`).

## Task 21: Print each line's part number on the shared quote page

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/routes/share+/quote.$id.tsx` — loader line map (line 253), heading (line 539)

**Steps:**
1. In the loader's `quoteLines` map, add `partNumber`.
2. Compute it as `formatPartNumber({ ours: line.itemReadableId, theirs: line.customerPartId, theirsRevision: line.customerPartRevision }, resolvePartNumberDisplay("sharedQuote", line.partNumberDisplay))`.
3. In the line heading, print `line.partNumber` in place of `line.itemReadableId`.
4. Keep `itemReadableId` for the image `alt` and the line name.
5. Import both functions from `@carbon/documents/utils`. The page is browser code, so never import from `./pdf`.

**Verify:**
```bash
pnpm exec biome check "apps/erp/app/routes/share+/quote.\$id.tsx"
# Expected: no errors
```

**Out of scope:** the shared quote PDF route: it serves the PDF saved at finalize.

## Task 22: Turn on the Edit document select for the four sales documents

**Depends on:** Task 17
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.utils.ts` — 4 entries of `DOCUMENT_EDIT_RECORDS`

**Steps:**
1. Set `partNumberLines` on these 4 entries:

| Entry | `table` | `documentColumn` | `party` |
|---|---|---|---|
| `quote` | `quoteLine` | `quoteId` | `customer` |
| `salesOrder` | `salesOrderLine` | `salesOrderId` | `customer` |
| `salesInvoice` | `salesInvoiceLine` | `invoiceId` | `customer` |
| `packingSlip` | `shipmentLine` | `shipmentId` | `customer` |

**Verify:**
```bash
grep -c 'party: "customer"' apps/erp/app/modules/settings/settings.utils.ts
# Expected: 4
```

**Out of scope:** `salesReturnOrder`: it is not one of the 7 surfaces.

## Task 23: Update the docs page and the rules

**Depends on:** Task 12
**Files:**
- Modify: `docs/content/docs/reference/suppliers-and-customers.mdx`
- Modify: `.claude/rules/document-template-customizer.md` — "Edits to one document"
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — Key Data Model

**Steps:**
1. Load the `carbon-docs` skill.
2. Add a section "Part numbers on documents" to the docs page. Cover the 4 choices, the company default, the customer override and the Edit document select.
3. Say that each line keeps its choice, and that a locked document cannot change it.
4. Ground every claim in the code of Tasks 14 to 22.
5. In the rule's "Save" bullet, add: `saveDocumentEdit` also writes a picked `partNumberDisplay` to every line in `DOCUMENT_EDIT_RECORDS[type].partNumberLines`, in the same transaction.
6. In the sales `AGENTS.md` data model, add the `salesOrderLine` line copy (`customerPartId`, `customerPartRevision`) and `partNumberDisplay` on the 4 sales line tables.

**Verify:**
```bash
pnpm --filter docs build
# Expected: exit 0
```

**Out of scope:** the changelog entry. Write it with the `changelog-entry` skill at ship time. Name the `salesOrderLines.customerPartId` change in it.

## Task 24: Run the Part I gate

**Depends on:** Tasks 11 and 13 to 23
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated)

**Steps:**
1. Run `pnpm lingui:extract`, then `/translate`.
2. Run `pnpm --filter @carbon/checks license-headers`.
3. Run `pnpm exec biome check --write` on every changed file.
4. Run `pnpm --filter @carbon/documents test` and `pnpm --filter @carbon/checks test`.
5. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.
6. Main agent only: run `pnpm exec turbo run typecheck --filter=erp --concurrency=1`.
7. Commit through `/check-and-commit` on `eng-102-customer-part-number-display`. Never stage `.ai/runs/`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no type errors
```

**Out of scope:** pushing. Opening a PR needs Raul's yes through `crbnos-pr`.

## Task 25: Verify Part I in the browser

**Depends on:** Task 24
**Files:** none

**Steps:**
1. Boot the stack in `carbon-eng-102-customer-part-number-display`.
2. Run `/test` against the acceptance criteria of the spec's Part I.
3. Set up the spec's fixture: item P000123 Rev B, customer A with C-100 Rev 3, customer B with C-200.
4. Check each criterion and record PASS or FAIL in the run record.
5. For the restore criterion, record the result of the Task 10 probe.
6. For the dataset criterion, record the result of `pnpm db:check:datasets` from Task 24.
7. Check the settings card, the customer form and the Edit document select in light and dark themes.

**Verify:**
```bash
grep -c "PASS" .ai/runs/2026-11-19-customer-part-number-display.md
# Expected: 18 (one per acceptance criterion)
```

**Out of scope:** purchasing documents.

---

# Section 3 — Part II, purchasing documents

The review of 2026-11-19 moved Part II ahead of Part I. The spec's "Part II design" section is the source. The tasks reuse Section 1.

## Task 26: Add the Part II migration

**Files:** `packages/database/supabase/migrations/20261119123627_supplier-part-number-display.sql`

1. Add `companySettings.supplierPartNumberDisplay` (NOT NULL, default `Theirs First`), `supplier.partNumberDisplay` and `purchaseOrderLine.partNumberDisplay`.
2. Add the BEFORE INSERT stamp trigger on `purchaseOrderLine`.
3. Add the line copy trigger: BEFORE INSERT OR UPDATE OF `itemId` on `purchaseOrderLine`. It copies `supplierPart.supplierPartId` when the write sets none.
4. Add the AFTER UPDATE OF `supplierId` trigger on `purchaseOrder`.
5. Drop and create `purchaseOrderLines`. Append `partNumberDisplay` to `suppliers`.

## Task 27: Format purchase order lines per line

**Files:** `packages/documents/src/utils/purchase-order.ts`, `packages/documents/src/pdf/blocks/purchaseOrder/vars.ts`

1. The email title (`getLineDescription`) prints `formatPartNumber` per the line's choice. A legacy line prints `Ours First`.
2. The PDF title (`line.description`) prints the same. A legacy line prints our part number.
3. `line.supplierPartId` holds the supplier part number only where the title leaves it out: a legacy item line, and a Service line unless the choice is `Ours Only`.

## Task 33: Add the Part Numbers select to the purchase order line form

1. Add `partNumberDisplay` to `purchaseOrderLineValidator` and to the inputs of `createPurchaseOrderLine` and `updatePurchaseOrderLine`.
2. An empty select on a new line saves null, so the stamp applies. An empty select on an existing line leaves the value as it is.

## Task 34: Turn on the Edit document select for the purchase order

Set `partNumberLines` on the `purchaseOrder` entry of `DOCUMENT_EDIT_RECORDS`: `purchaseOrderLine`, `purchaseOrderId`, `supplier`.

## Task 37: Run the Part II gate

1. Run `pnpm lingui:extract` and `/translate`.
2. Run the license header fixer and Biome on every changed file.
3. Run the `@carbon/documents` tests, the ERP tests next to the change, `pnpm db:check:datasets` and `pnpm db:check:backups`.
4. Main agent only: run the `erp` typecheck and `pnpm generate:mcp`.
5. Verify the spec's Part II acceptance criteria in the browser, and render the PDF and the email for each of the 4 choices.
