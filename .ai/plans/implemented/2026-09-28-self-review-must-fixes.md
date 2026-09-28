# Fix the strict self-review findings on PR #1740

Branch `rillet-ramp-accounting-provider`. Source: the `/self-review` strict pass
over `4df5f8c9bd...HEAD`, five areas. Every item below was verified against the
code before being listed. Checkboxes are the progress record.

## Decisions taken (flagged for veto)

- **D-1 `item` in the master-data sweep.** `MASTER_DATA_SWEEP_TARGETS` pushes 500
  unmapped items/hour, which reinstates the catalog mirroring that commit
  `0f54877c0e` removed the subscription to stop. DECISION: drop the `item` target
  from the sweep. The JIT `ensureDependencySynced("item")` path from orders and
  inventory adjustments still pushes the items a synced document names, which is
  the whole set that belongs in a provider. The one-shot **Push customers,
  vendors & items** action stays for a deliberate full import.
- **D-2 The document-level contact field.** `requiredContactField` on six
  documents breaks editing an existing document for an unrelated reason, is absent
  from all six CREATE actions, and asks the wrong question — Ramp needs the
  SUPPLIER to have an emailable contact, not the document to name one. DECISION:
  delete the field-level requirement and the six `make*Validator` factories; keep
  `checkPartyContactRequirement` at the six release/post boundaries as the single
  bar. Fixes both findings by deleting the mechanism rather than patching it.
- **D-3 Memo direction.** Restore an explicit stored `direction` rather than
  deriving it from the party, so all four legal party×direction combinations stay
  authorable and an existing row is never rewritten on save.
- **D-4 Memo void on Xero/QBO.** Out of scope for this pass: it is a new remote
  lifecycle, not a defect fix. Declare it instead — a `MEMO_NATIVE_VOID_PROVIDERS`
  set naming Rillet only, so the hole is visible in code and in the rule.

## Batch 1 — silent wrong numbers and data corruption

- [x] 1.1 Fixed Asset lines push as sales revenue. `SalesDocumentComponent` gains
  `invoiceLineType`; the three invoice mappers exclude `Fixed Asset` components
  from the sales-revenue product/account, and an invoice whose only revenue is a
  disposal reports an actionable reason instead of "Sales Revenue account missing".
  Pin with a `loadSalesInvoices` test that asserts `salesRevenueAccountId` from a
  `"Sales Account"` line, plus a mixed part+asset mapper test per provider.
- [x] 1.2 `MemoForm` stops overwriting the stored `direction` (D-3).
- [x] 1.3 `purchase-invoice+/$invoiceId.post.tsx` and the sales sibling: scope the
  supplier/customer read by `companyId`, check `error`, and fail CLOSED.
- [x] 1.4 `post-reimbursement-void.ts`: refuse a consumed reimbursement, mirroring
  `post-memo-transaction.ts`.
- [x] 1.5 `computeReconcileDecision`: add the `creditMemo`/`supplierCredit` arms and
  their `MAPPED_TYPES` entries; golden cases for both.

## Batch 2 — jobs and edge functions

- [x] 2.1 `resolveMemoJournalParty` resolves through `journalLine.documentType = 'Memo'`
  so a VOID journal resolves its party.
- [x] 2.2 `isHourlyPass` comes from the run's scheduled time, not wall clock inside
  a per-company step.
- [x] 2.3 `topology.ts` throws on `rows.error` instead of returning an empty topology.
- [x] 2.4 `pageChangedMasterDataIds` pages like `pageIds` (ascending from the floor).
      Shipped WITHOUT a unit test: `accounting-outbound-sweep.ts` cannot be imported under
      vitest (module-scope `@carbon/env` validation), and hand-rolling a Supabase builder
      fake is what `testing-no-mock-theater.md` forbids. Covered by typecheck plus the seven
      document families already exercising `pageIds`. Bound is now MAX_PAGES × PAGE_SIZE.
- [x] 2.5 Drop the `item` master-data sweep target (D-1).
- [x] 2.6 `post-payment-transaction.ts`: seed `targetControlById` for a reimbursement
  only from a posted journal, so the missing-control guard still bites.
- [x] 2.7 `datasets/wipe.ts`: `assertWipeable` refuses non-Draft reimbursements and
  `DOCUMENT_JOURNAL_SOURCES` gains `Reimbursement`.
- [x] 2.8 Ramp reimbursement payout intent: record it on an already-mapped
  reimbursement instead of returning before `payout` is built; retire the test that
  pins the broken behaviour.

## Batch 3 — spend / sync / ramp

- [x] 3.1 Delete `pushPurchaseOrder` + `pushInvoiceDraftBill`, their types, the
  `service.ts` re-exports and `draft-bill-push.test.ts`.
- [x] 3.2 Delete `sync/defer.ts` + `defer.test.ts`.
- [x] 3.3 `parties.ts`: the sole-contact fallback replaces the WHOLE contact.
- [x] 3.4 `parties.ts`: order the locations read and prefer an address that
  satisfies the state rule.
- [x] 3.5 `ramp/entities/bill.ts`: move the already-mapped check into `shouldSync`.
- [x] 3.6 `sync/party-contact.ts`: surface the pre-read error; type the client as
  `SupabaseClient<Database>`.
- [x] 3.7 Log the swallowed failures in `sync-confirmation.ts` and `connection.ts`.
- [x] 3.8 Correct the disproven Ramp bill↔PO matching claims in `gates.ts`,
  `bill.ts` and `.claude/rules/ramp-integration.md`.

## Batch 4 — ERP app

- [x] 4.1 Remove the document-level contact requirement (D-2), covering both the
  create-route gap and the existing-document breakage.
- [x] 4.2 `ReimbursementEditForm`: wire `ExchangeRate` and re-derive the money
  formatters from the selected currency.
- [x] 4.3 `charges.$id.void.tsx`: rethrow a `Response` before the generic catch.
- [x] 4.4 `InstallModeDialog`: use `RadioGroupButton` from `@carbon/react`.
- [x] 4.5 Remove the `DIAGNOSTIC` header logging from the unauthenticated Ramp webhook.

## Batch 5 — accounting providers

- [x] 5.1 QBO memo applications send `sourceAmount`, and refuse a cross-currency
  application as Xero does.
- [x] 5.2 QBO records each applied settlement inside the loop.
- [x] 5.3 Rillet `resolveMemoSyncGate` refuses a Voided memo with no mapping.
- [x] 5.4 Reimbursement employee vendor/contact re-reads its mapping per record.
- [x] 5.5 `counterpart.ts` returns a candidate only when unclaimed; the Rillet
  vendor caller links before it updates.
- [x] 5.6 Declare `MEMO_NATIVE_VOID_PROVIDERS` (D-4).

## Batch 6 — migration and docs

- [x] 6.1 Restore `20260927002910_require-party-contact.sql` to the content that was
  pushed, and add a new forward migration that renames the columns, guarded for both
  start states. The runner keys on version alone
  (`packages/dev/src/services/migrations.ts:237`), so any database that applied the
  old file never receives the edited one.
- [x] 6.2 `apps/erp/app/modules/invoicing/AGENTS.md` (via `/create-agents-md`).
- [x] 6.3 Stale lines: `packages/ee/AGENTS.md`, `settings/AGENTS.md`,
  `purchasing/AGENTS.md`, `accounting/AGENTS.md`, `jobs/AGENTS.md`,
  `.claude/rules/{ramp-integration,accounting-sync-handlers}.md`,
  `.claude/rules/environment-configuration.md`.
- [~] 6.4 DROPPED — the review item was wrong. All five specs this branch adds are
  explicitly `Status: draft`, and at least `memo-external-gl-representation` has
  known unshipped holes (credit memos did not reconcile at all until 1.5, and
  Xero/QBO still have no memo void path — declared, not implemented). Moving them
  to `implemented/` would assert something false. Left in place deliberately.

## Gates per batch

`pnpm exec biome check --write <files>`, then the scoped typechecks and tests for
the packages touched, then `pnpm --filter @carbon/checks test`. Commit per batch.

## Outcome

All 36 items resolved: 34 fixed, 1 dropped with reasoning (6.4), 1 shipped without a
unit test and said so (2.4). Gates at completion: `@carbon/ee` 1808, `@carbon/jobs`
768, `erp` 1509, `@carbon/checks` 175 — 4260 tests, five typechecks, Biome, and the
demo-dataset check all green.

Three review findings were REJECTED on inspection rather than implemented:

- The hand-written `CREATE POLICY` blocks in `20260922195151` / `20260923231244` are
  inside `no-authz-ddl-in-migrations`' documented pre-cutoff window (`SINCE =
  "20260927000000"`) and are already superseded by the generated authz migration.
  Redundant SQL, not a violation.
- "Move the five shipped specs to `implemented/`" — all five are explicitly
  `Status: draft`, and `memo-external-gl-representation` has holes that were still
  open when the review ran. Moving them would assert something false.
- `MEMO_NATIVE_VOID_PROVIDERS` tripping `no-integration-id-branching` was the check
  matching a provider id quoted in a DOC COMMENT. The code is the approved
  capability-set shape; the comment was reworded rather than the baseline widened.

The backup-compatibility check could not run on the migration commit (the local
database is one migration behind by construction — it cannot see the change being
committed). The migration was instead validated by hand against the live schema in a
rolled-back transaction from both possible start states.
