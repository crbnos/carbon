# Feature run: change a posted invoice line's GL account; reopen a closed period

- Date: 2026-11-14
- Mode: autonomous (dev queue build agent; decisions recorded, not asked)
- Request: change the GL account of a posted sales or purchase invoice line through a correcting journal, without an approval request; make a historical, Closed period correctable by reopening it.
- Spec: `.ai/specs/2026-11-14-invoice-line-gl-reclass.md`. Plan: `.ai/plans/2026-11-14-invoice-line-gl-reclass.md`.
- Branch: `feat/invoice-line-gl-reclass` off `origin/main` `b84fe506db`.

## Findings that shaped the build

- The sales invoice posting credits `accountDefault.salesAccount` for every plain line; `salesInvoiceLine.accountId` is never read and may hold a value converted from the order. Purchase **G/L Account** lines debit `purchaseInvoiceLine.accountId`; item lines post through inventory, GR/IR, WIP or indirect cost.
- No journal line names its invoice line: each line's legs share one random `journalLineReference`. The change matches the group by the keys the posting copies.
- An invoice void reverses every `documentType 'Invoice'` line of the document, so lines with the original's keys are reversed with it.
- `reopenAccountingPeriod` had no operation, route or button, so a Closed period could not be reopened. Its reverse-sequential rule and snapshot delete were sound.
- After a reopen, only manual journals (and now account changes) post into a past month: invoices, receipts and voids post with today's date.

## Decisions

- Permission for the change: `update: ["invoicing", "accounting"]`.
- Permission for reopen: `update` and `delete: accounting` (the period-closing spec's choice, plus update for the RLS writes).
- Period: Open only; Locked and Closed are refused with the period named.
- Source type: the invoice's own, as the void.
- Eligible lines: plain sales revenue lines and purchase G/L Account lines; target classes Revenue and Expense, as the posting and the line form.

## Phase log

- Investigation, spec, plan, execute: 2026-11-14.
- Verification 2026-11-15: `vitest run app/modules/invoicing app/modules/accounting/accounting.periods.test.ts test/invoicing-operations.test.ts test/accounting-operations.test.ts test/mcp-tool-permissions.test.ts test/posting-permissions.test.ts` 12 files, 334 tests passed; `turbo run typecheck --filter=erp` passed; `check:manifest` ok (1812 operations, digest current); Biome clean; license headers 0 fixed.
- Not run: the live-database path of `changeInvoiceLineAccount` and `reopenPeriod` (no stack for this worktree). The self-test steps are in the PR body.

## Addendum 2026-11-15: fixes from testing in the app

- Rebased onto `origin/main` `63d7140760`: no conflicts.
- Fixed: the Change GL Account button covered the line card's collapse chevron; it now sits in a header `CardAction` beside it.
- Fixed: nothing showed which account a line is on. The dialog reads the posted account on open through `getSalesInvoiceLinePostedAccount` / `getPurchaseInvoiceLinePostedAccount`, from the same journal match the change uses (not `salesInvoiceLine.accountId`).
- Fixed: View Period on a Closed period showed "Cannot close yet" and task actions. A Closed period's checklist is now read-only; Reopen Period stays.
- Decision: the two reads are not `@mcp`. The change result already returns `fromAccountId`; publishing the reads is a follow-up if API callers need them.

## Addendum 2026-11-15: review fixes

- Reopen: a failed "later period Closed" count now refuses the reopen instead of reading as none, before any snapshot is deleted.
