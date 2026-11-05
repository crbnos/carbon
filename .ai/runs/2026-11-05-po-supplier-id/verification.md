# Purchase order PDF supplier part ID: verification

Base: `origin/main` at `b249e8bf20`, in a fresh clone of `crbnos/carbon`.

## What changed

- The PO PDF prints the supplier part number on its own wrapping line, `Supplier Part ID: <number>`. The item ID with its revision and the description stay.
- `getLineSupplierPartId` picks the number. The line's own `supplierPartId` wins. If it is blank, the helper uses `supplierPartIdFromSupplier` from the supplier part record.
- The helper trims spaces. It returns `null` when the number repeats the identifier the line already prints. That is the item ID, or the description on a PDF Service line.
- Every line type except Comment, G/L Account and Fixed Asset prints the number. Service lines print it too.
- The PDF prints the label only when a number exists.
- Templates → Purchase Order → Line Items has a "Show Supplier Part ID" switch. It writes `showSupplierPartId` into the block options. The default is on.
- The switch shows only for `purchaseOrder`. Other documents ignore the option.
- The Supplier Parts table column reads "Supplier Part ID", not "Supplier ID".
- The email's `getLineDescription` calls `getLineSupplierPartId` too. The email text changes in one case only: a number with spaces around it prints trimmed. A number of only spaces falls back to the record's number.
- `pnpm generate:mcp` changed 2 hashes in `tool-manifest.digest.json`: the schema of `settings_saveDocumentTemplate` and the response of `settings_getDocumentTemplateConfig`. The new option causes both.

## Cause

The customer's PDF shows the item ID with its revision suffix, then an ellipsis. The view's `itemReadableId` carries that suffix, for example `.001`.

1. The old renderer printed `<item ID>.<revision> (<supplier part number>)` on one line.
2. The Description column is 22% of the page width.
3. The default `textOverflow: "truncate"` cut the line after the revision, so the number never showed.

The same values without a revision suffix fit on the line. Service lines also omitted the number. The new layout prints the number on its own line, so neither case can hide it.

## Checks in the fresh clone

| Check | Result |
|---|---|
| `pnpm --filter @carbon/documents typecheck` | pass |
| `pnpm exec turbo run test --filter=@carbon/documents --force` | 17 files, 118 tests pass (4 new, 1 moved) |
| `pnpm exec turbo run typecheck --filter=erp` | pass, no cache |
| `pnpm exec biome check` on the 8 changed TS files | pass (the Biome config ignores the digest JSON) |
| `pnpm lingui:extract`, then `lingui:clean` | the new string has a translation in all 13 locales |
| `pnpm check:manifest` | pass, digest current |
| PDF proof: real `renderToStream` PDFs from this clone's source | 63 scenarios pass |

`main` already had 13 untranslated strings in each locale before this change. This change adds none.

The 63 PDF scenarios cover 10 cases × 3 option states × 2 text modes, plus the editor sample in 3 option states.

- Cases: the screenshot pair, supplier-record fallback, line value over record value, a long number, no number, Service and Comment. Three more cases cover a revisioned item ID (`ITEM-0001.001`), a number equal to the item ID, and a number of only spaces.
- Option states: absent (a template saved before the option), `true` and `false`.
- Text modes: truncate and wrap.
- Each block goes through `blockSchema` (the preview route and the save validator) and `resolveTemplate` (the file route) before the render.

Three red checks showed that the proofs can fail:

1. The new schema test failed when `showSupplierPartId` left the schema.
2. The PDF proof failed when the renderer ignored the option.
3. Two `getLineSupplierPartId` tests failed against a helper without the trim and the repeated-number check.

## Browser run

The browser run used a local stack on the earlier base `448dbcdf3a`, with the first version of the 6 changed source files. It ran before the `getLineSupplierPartId` change, which the unit tests and the PDF proof cover. It signed in with the dev bypass login and did these steps:

1. Read the Supplier Parts headers on PCB-BARE-REV3: "Supplier | Supplier Part ID | Unit Price | …".
2. Saved a test supplier part number on the CelestialElex supplier part through its form.
3. Downloaded the PO000003 PDF with no saved template: it prints `Supplier Part ID:` with that number.
4. Opened the editor: the switch is on, and the sample preview prints 1 label.
5. Switched off: the live preview hides the number and keeps `STEEL-BAR-50` and its description.
6. Saved: the stored option is `false`, and after a reload the switch is still off.
7. Downloaded the PO000003 PDF: no label, and `PCB-BARE-REV3` and its description stay.
8. Previewed PO000003 as the real record: on shows the number, off hides it.
9. Switched on and saved: after a reload the switch is on, and the PDF prints the number again.
10. Opened the Sales Order Line Items: no "Show Supplier Part ID" switch.

The PDFs, screenshots and proof scripts stayed out of the repo.

## Review follow-up

CodeRabbit left 3 findings on PR #2141. This commit fixes all 3.

| Finding | Fix |
|---------|-----|
| A Service line lost a number equal to its item ID. The PDF prints the description there, not the item ID. | `getLineSupplierPartId` takes an optional `shownId`: the identifier the line prints. `LineItemsBlock` passes the description for an indirect line. The email keeps the item ID default. |
| The `ToggleRow` switch had no accessible name. | `ToggleRow` passes its label to the `Switch` as `aria-label`. Every toggle in the template editor gets the name. |
| No test covered a padded number. | 2 tests: a padded number comes back trimmed, and a padded copy of the item ID gives `null`. |

The docstring warning listed `getLineDescription`, `LineItemsBlock` and `LineItemsConfig`. Each has a docstring now.

| Check | Result |
|-------|--------|
| `pnpm exec turbo run test --filter=@carbon/documents --force` | 17 files, 120 tests pass |
| `pnpm exec turbo run typecheck --filter=@carbon/documents --filter=erp` | pass, no cache |
| `pnpm exec biome check` on the 5 changed files | pass |
| The new `shownId` test against a helper that ignores `shownId` | fails as expected, then restored |
| PDF proof: 6 cases with real `renderToStream` PDFs | 6 pass |
| The same proof against the PR head's `LineItemsBlock` | 2 fail as expected, then restored |

The 2 cases that failed on the PR head:

1. A Service line with the number equal to its item ID printed no label.
2. A Service line with the number equal to its description printed the description twice.

No deployment, customer data or production setting changed.
