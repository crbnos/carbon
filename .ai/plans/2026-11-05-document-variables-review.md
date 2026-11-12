# Review — values as variables on all page documents

- **Target:** uncommitted work on `feat/document-editor-edits` on top of `7d02ac3c00`: 105 files, +4,766 / −2,328.
- **Base:** `7d02ac3c00`. Earlier commits on this branch have their own review (`.ai/plans/2026-11-04-per-document-edits-review.md`).
- **Evidence runs:** a catalog audit of all 11 documents, old/new PDF text diffs, render and click timings, `@carbon/checks`, real-record renders.

## Blockers

### B1. A variable typo in a catalog default is silent

`validateTemplateText` checks only the words a user stored (`template/texts/validate.ts`). Nothing checks `entry.default`. A default of `{order.dat}` compiles, passes every test, and drops its row from every printed document because `t.prints` sees an empty variable. The audit found no such typo today, but 300+ new defaults have no guard, and `of` and `row` are unchecked strings too.

**Fix:** a test in `texts.test.ts` that walks `TEXT_CATALOG`: every `{token}` in a default is a document variable or one of the entry's `row` variables; every `of` names a key in the same block; every `row` has variables.

### B2. No committed test covers the new builders

The old/new comparison was a throwaway harness. After it was deleted, nothing stops a builder from throwing on a document's sample, and no test pins that a comment line prints only its description.

**Fix:** a test that renders every `DOCUMENT_PDFS` sample, and a test of the comment-line rule.

### B3. Values print the words "null" and "undefined"

- `pdf/blocks/salesOrder/vars.ts:162` `String(line.saleQuantity)` prints `null EA`.
- `pdf/blocks/stockTransfer/vars.ts:55-56` `String(line.quantity)`, `String(line.unitOfMeasure)` print `7 null`.
- `pdf/jobTraveler.samples.ts:56` uses the unit "Hours", which `formatFactor` (`packages/utils/src/duration.ts:29`) does not know, so the template editor's preview prints `Setup: 0.5 undefined`.

The first two were kept to match old output. This code is new; it should use `str`.

### B4. Banned date calls moved into the builders

- `pdf/blocks/issue/vars.ts:84` `new Date(record.createdAt).toISOString()`.
- `pdf/blocks/quote/vars.ts:64` `today(getLocalTimeZone())`: the server's zone, so a quote printed near midnight shows the wrong day.

Both came from old block code. Moved code is new code, and `.claude/rules/date-handling.md` bans both on a server path. `no-local-timezone` does not scan `packages/documents`, so the check stays green.

**Fix:** take the date part of the stored instant; the quote's print date comes from the company's time zone, passed in by the renderer.

### B5. Words printed in the header sit in the footer panel

`HEADER_TEXT_KEYS` (`template/texts/index.ts`) lists `title` and `documentNumber`. `supplierRmaNumber` (purchase return), `salesOrderPrefix` (job traveler) and `rentalTitle` (packing slip) print in the header too, so the editor offers them under the footer, and a click on them opens the footer panel.

## Code-judo / simplification

### J1. `t.prints` should know a value's owner

`entry.of` already says which row owns a value, and `makeText` holds the entries. Every call site repeats `t.shows("customer") && t.prints("customerValue")` by hand: 15 sites in `jobTraveler/JobDetailsBlock.tsx`, `purchasingRfq/PartiesBlock.tsx`, `purchaseOrder/PartiesBlock.tsx` and `issue/ActionTasksBlock.tsx`. One forgotten `t.shows` prints a value the user hid. Teach `prints` the owner and the guards disappear.

### J2. An address is one concept, written out 12 times in 4 places

Twelve parties across 7 documents each have 6 merge fields, 6 catalog entries, 6 variables and 6 `row()` calls: about 700 lines, nearly half of `merge.ts`'s growth (302 → 813 lines). The `AddressBlock` component this work stopped using is left as dead code (`pdf/components/index.ts:5`).

**Simpler:** `addressFields(prefix, party)`, `addressTexts(key, prefix)`, `addressVars(prefix, address)` and `<AddressRows>`, typed with template literals so the `Record<MergeToken<…>>` check still holds. Delete `AddressBlock`. RFQ and stock transfer print a different address shape and stay as they are.

### J3. The same helpers pasted across documents

`const str` is in 11 `vars.ts` files, `statePostal` in 7, the incoterm sentence in 4, `row`/`boldRow` closures in 11 blocks with `Parameters<typeof t>[0]`, and the row-token type is spelled three ways (`issue/vars.ts:15`, `quote/vars.ts:27`, `packingSlip/vars.ts:67`).

**Simpler:** one `pdf/blocks/textVars.ts`, one `useTextRows(t)`, one `RowVars<Doc, Prefix>` in `merge.ts`.

## Performance

- **PDF render:** 300-line purchase order, old 3,778 / 3,518 ms, new 3,504 / 3,398 ms. No regression. PDF size is 2.7% smaller.
- **Click:** `findPrintedText`, 69 texts over 120 lines: 1.6 ms.
- No query, list or default page path changed. The database passes do not apply.

## Risks / questions

- **R1. Money is now free text.** A user with update rights can replace `{order.total}` on an unlocked document with typed digits, and the PDF then disagrees with the ledger. The lock covers sent documents only. Open decision: leave it, or refuse a save that removes the variable from an amount.
- **R2. Chip names are English only.** About 250 new merge-field labels sit in `@carbon/documents`, which `lingui.config.js` does not extract. The earlier labels have the same gap. New copy is meant to be translatable.
- **R3. Saved labels print without their value.** A stored `"Tax ID:"` now prints no value. Verified not to reach production: `git log origin/main -- packages/documents/src/template/texts` is empty. Local test rows only.
- **R4. Same-word rows.** Clicks on two rows with the same words ("Contact:") are told apart by print order, and a row of only variables lands on the row above. Accepted; documented in the rule.
- **R5. Tracking labels are not included.** Agreed scope; values print beside the blocks' `label` in both PDF and ZPL.
- **Passes that do not apply:** security (no new query, route or role; variables hold what the PDF already printed), concurrency (no new write), deploy (no migration; tool manifest digest unchanged).

## Docs freshness

- `.claude/rules/pdf-generation-patterns.md:41` lists `AddressBlock`.
- `.claude/rules/document-template-customizer.md` "the 9 supported types": there are 12.
- `packages/documents/AGENTS.md` says never print a label as a literal; it should say the same of a value.
- `.ai/lessons.md`: a default that holds a variable changes what a saved word means.

## TLDR

- **B1** Typos in catalog defaults are silent; no integrity test.
- **B2** No committed test covers the builders.
- **B3** Quantities and units can print "null" and "undefined".
- **B4** `new Date` and server-zone "today" moved into builders.
- **B5** Three header words live in the footer panel.
- **J1** `t.prints` should honor `of`; 15 hand-written guards go away.
- **J2** Addresses repeated 12 times in 4 places, about 700 lines; `AddressBlock` is dead.
- **J3** `str`, `statePostal`, incoterm, `row` closures and the row-token type are pasted around.
- **Perf** No regression: 3.5 s for 300 lines, 1.6 ms per click.
- **R1–R5** Money as free text; English chip names; saved labels; same-word clicks; labels out of scope.
- **Docs** Four stale or missing lines.

## Verdict

**Block.** B1–B5 are small and fixable. J2 leaves a large, clear simplification on the table.

## Fixes (2026-11-05)

Not committed.

| Item | Fix | Proof |
|---|---|---|
| B1 | `texts.test.ts` checks every default's variables, `of` and `row`. | A typo put into a default failed the test; removed again. |
| B2 | `pdf/preview-documents.test.ts` renders all 12 samples; `pdf/blocks/lineVars.test.ts` pins comment lines, missing values and `addressVars`. | Reverting each rule failed its test: a builder that throws, the comment-line rule, `String` for `str`. |
| B3 | Quantities and units use `str`; the job traveler sample uses a real unit. | `lineVars.test.ts`. |
| B4 | `inspection.date` takes the date part of the stored instant. A quote's `printDate` comes from the company's time zone (`sales.pdf.tsx`, `buildPreviewProps`). | Old/new diff shows only the quote's date line changed. |
| B5 | `HEADER_TEXT_KEYS` lists `rentalTitle`, `salesOrderPrefix`, `supplierRmaNumber`. | Editor typecheck and click tests. |
| J1 | `t.prints` honors `of`; the hand-written guards are gone. | Removing the owner check failed `texts.test.ts`. |
| J2 | `addressFields`, `addressTexts`, `addressVars`, `AddressRows`; `AddressBlock` deleted. `merge.ts` 813 → 677 lines. | Old/new text diff of 55 cases across 11 documents: only the quote's date differs. |
| J3 | `textVars.ts`, `useTextRows`, `RowVars`. | Typecheck. |
| Docs | Rule, patterns, AGENTS and lessons updated. | |

| R1 | Chose to protect amounts. Money tokens carry `amount: true`; `validateTemplateText` refuses a stored text that drops one (`amountRemoved`). Words around it and hiding its column stay allowed. | In the modal, typing 99.00 over Unit Price showed the error and saved nothing. A direct POST replacing the total answered `validation`. |
| R2 | Chose to translate now. `MERGE_FIELD_NAMES` holds 224 names with `msg`; `useMergeFieldName` reads them in `TextConfig` and `MergeFieldMenu`. 170 strings (132 names plus this editor's untranslated copy) were added to all 12 languages. | `mergeFieldNames.test.ts`; `pnpm lingui:compile`; a scan found no mixed scripts or lost placeholders. |

All 11 real records render the same text as before the fixes, with no stray `{codes}` or "null". `@carbon/documents` 163 tests, editor 15, `@carbon/checks` 419; erp, mes, jobs, lib and documents typecheck.
