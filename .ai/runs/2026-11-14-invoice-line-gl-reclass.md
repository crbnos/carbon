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
- Close checklist: Mark Done and Skip now read the task's period and refuse a Closed one on the server (`closeTaskChangeRefusal`, `accounting.utils.ts`, with the Auto and Blocker refusals it replaced inline); tested in `accounting.periods.test.ts`.
- Position finder: dimensions and the amount the posting computed are now match checks for every group, a sole one too, not tie-breakers. No match refuses (`missing`); two or more refuse as `ambiguous` (two identical lines can no longer change account, which retires the known limit on identical lines with a legacy `accountId`). Before, a line whose own group no longer matched could take another line's sole group: A posting 100 Sales + 10 Shipping and B posting 40 Sales, A moved to Shipping, then the Sales fallback accepted B's 40. Proved red against the previous finder with a scratch copy; tests in `invoicing.line-account.test.ts`.
- Target account: a new account the line's own group already holds another amount on (a sales line's shipping account) is refused, naming it (`lineAccountChangeTargetRefusal`; `InvoiceLinePosition.otherAccountIds` nets the group's other legs per account, so an account a change emptied again is allowed). Before, the move was accepted and the group then held revenue and shipping together, which no later read or change could match. Chose the refusal over tracking the moved amount: tracking needs the finder to split a held total by origin. Tests in `invoicing.line-account.test.ts`.
- Void race: both invoice voids now lock the invoice `FOR UPDATE` right after their posting-status read inside the transaction, and read the journal lines they reverse (and, for purchases, the journal's Average-cost write-ups) after it: the change's lock and order. The purchase void still decides outside whether it needs a period from its earlier read, since a change only adds lines to a posting that has some. Behaviour otherwise unchanged. Database test `apps/erp/test/database/invoice-line-account-void.test.ts` (both sides: a void after a change nets every account to zero; a void started while a change waits on the held journal entry sequence waits on the change's invoice lock and reverses it). Not run: no local database in this worktree (`SUPABASE_DB_URL` unset, 4 skipped). Lesson added to `.ai/lessons.md`.
- Reopen vs close: `reopenAccountingPeriod` is one Kysely transaction on `ctx.asSystem.pg` (lock, read the period `FOR NO KEY UPDATE`, later-Closed check, snapshot delete, status update), stamping `datetime.timestamp()`. Close and reopen both take `lockPeriodLifecycle` (a transaction advisory lock keyed on the company) as their first statement; close takes it before its period row lock and re-checks the earlier periods under it. An advisory lock rather than `FOR UPDATE` on every period of the company: that would stop every posting company-wide for the length of a close and block the close's own task inserts (their foreign key check needs a key share lock on the period). Close's pre-transaction earlier-period count now reads its error too (the item 1 bug). Close otherwise unchanged. Database test added to `period-close-concurrency.test.ts` (a reopen of August waits for September's close in flight, then refuses); not run here (needs the local stack).
