# Lessee leases — strict self-review fixes

Source: the strict self-review of `lessee-leases-purchasing` (2026-10-12). Every
Must fix, Risk, Suggestion and Docs item is in scope; the user asked to "fix it
all". Work is split into packages that own DISJOINT files so they can run in
parallel. Phase 2 starts after Phase 1 is merged into the working tree.

Shared rules for every package:
- Read root `AGENTS.md`, `.ai/lessons.md`, and the AGENTS.md / `.claude/rules` for
  the files you touch. No JS `Date`; no raw rounding; companyId on every query;
  Kysely for multi-row writes; log before throw; SPDX header on new files.
- Touch ONLY the files your package owns. Other agents edit other areas at the
  same time, so a typecheck error in a file you do not own is not yours to fix —
  report it.
- Never touch `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` or
  `packages/react/src/Button.tsx` (the user's uncommitted work).
- Red → green: every behaviour fix gets a test that fails without it.
- Do not commit. Leave changes in the working tree; the orchestrator runs the
  gates and commits.
- Database tests: `export SUPABASE_DB_URL=$(grep -E '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)`.

## Decisions (made by the orchestrator; do not re-litigate)

- D1 (#9) Lease tables over the API: keep `purchasing_*` RLS for Draft editing,
  and add BEFORE INSERT/UPDATE/DELETE triggers on `lease`, `leaseLine`,
  `leasePayment` that, for an API role (`coalesce(current_setting('role', true),
  'none') IN ('anon','authenticated')`, the idiom in
  `check_accounting_config_locked`), refuse any write whose lease is not Draft —
  EXCEPT an Active/ended lease's non-accounting fields on `lease` (`name`,
  `description`, `assignee`, `noticeDate`, `customFields`, `updatedAt`,
  `updatedBy`). For an API role they also refuse any change to
  `leaseLine.classificationOverride`, `classificationOverrideReason`,
  `lesseeClassification`, `classificationInputs`, `initialLiability`,
  `initialRouAsset`, `rouAssetCost`, `status`, `fixedAssetId`, and to
  `lease.status`, `commencementJournalId`. The override route already writes with
  the service role. Server functions (Kysely, not an API role) are unaffected.
- D2 (#6) An asset whose ownership transfers may be "purchased" with no purchase
  option: price 0 (Purchase refuses only when neither `purchaseOptionAmount` nor
  `ownershipTransfers`). The UI offers the action for such an asset.
- D3 (#2) Modify keeps escalation anniversaries on the ORIGINAL commencement:
  rows are generated from `lease.commencementDate` and only those from the
  effective date on are kept; the payment entered in Modify is the payment AT the
  effective date (the modal pre-fills the current escalated rate).
- D4 (#4) Activation refuses a Skipped row due on or after
  `max(commencementDate, openingAsOf ?? commencementDate)`; `invoiceFromDate` is
  only for payments made before the opening balance.
- D5 (#3) The opening balance skips exactly the payments the schedule already
  deducted before the as-of date: decide by the schedule month a row belongs to
  (`paymentMonthIndex`), not by `dueDate`.
- D6 Lease Liabilities current portion = principal of the next 12 schedule lines
  after as-of (`slice(0, 12)`), not a date window.
- D7 Lease owner, notice date, name and notes stay editable after activation
  (`update.tsx` + `LeaseProperties`); every ASC 842 term stays Modify-only.
- D8 A classification override can be removed while Draft (intent on the
  classification route; service role write; audit-logged like setting it).
- Not changed (explain in the PR): the GL current/non-current split of the lease
  liability stays a reporting reclass (the Lease Liabilities report), not a second
  GL account.

## Phase 1 (parallel)

### A — `post-lease` server function
Owns `packages/server-functions/src/post-lease/**`, new `packages/server-functions/src/lib/*` files it creates, and the void/journal call sites it rewires in `post-rental-agreement/`, `post-charge/`.
- Must: D3 Modify escalation; D5 opening balance; D4 Skipped-row refusal;
  Terminate/Purchase refuse a date not after commencement; Cancel refuses once an
  asset is not Active or any `leaseEvent` exists; D2 purchase with ownership
  transfer at price 0.
- Risks: Modify with Skipped rows on/after the date (refuse with a clear 400);
  29th–31st leases — generate rows and schedule as months of the ORIGINAL
  commencement so later boundaries line up; `purchaseLines` negative cost →
  `InvalidInputError`; remove `cancel`'s Draft-delete branch (ERP uses
  `$id.delete`); cancel reads `journalPostingStatus` directly.
- Suggestions: drop unused `today` params; throw instead of
  `?? "Operating"` on Active lines; remove `as unknown as Json` /
  `as LeaseAccount` casts; carry `serialNumber` onto the purchased fixed asset;
  extract a shared "void journal as negated copy" helper into `src/lib` used by
  `post-lease`, `post-charge` void and the reimbursement void IF behaviour is
  identical (tests green), and batch `voidLeaseJournal` reads (no per-journal
  query loop).
- Tests: mid-month advance fixture before the cutover; escalation + modify;
  cancel after purchase refused; terminate asserts journal amounts and gainLoss;
  a run-posted row (with `runLineId`) for cancel's refusal.

### B — purchase invoice posting, legacy, jobs, digest link
Owns `packages/server-functions/src/post-purchase-invoice/**`,
`packages/server-functions/src/activate-accounting/legacy/purchase-invoice.ts`,
`packages/jobs/**`, `packages/notifications/**`, `packages/lib/src/events.ts`,
`apps/erp/app/routes/api+/link.ts`, `apps/erp/app/components/Layout/Topbar/Notifications.tsx`.
- Must: a capitalized Lease line debits Lease Liabilities with the NOMINAL amount
  only; its tax / shipping / header-freight share go to Operating Lease Expense
  (Short-Term/variable lines unchanged); compare `nominalBaseCost` with
  `payment.amount` using `equals` from the precision API.
- Risk: refuse posting unless `payment.purchaseInvoiceLineId === invoiceLine.id`.
- Suggestion: extract `lease-lines.ts` (`resolveLeasePostingLine`) beside
  `posting-lines.ts`, used by posting AND the legacy activate-accounting path (so
  the legacy path gains the Draft/Cancelled/other-lease/amount checks); type the
  lease map with DB enums; drop the `projectId` cast.
- Digest: carry an explicit document kind in the recurring-invoicing digest
  (`documentType`), route on it in `link.ts` and `Notifications.tsx` (no `pi_`
  sniffing); when a digest mixes sales review items and lease drafts, send the
  lease drafts as their own notification.
- Jobs: named tolerance instead of `> 0.005`; one exported ended/billable status
  constant (define it in jobs; do not edit create-lease-invoices — phase 2 D wires
  it); move `remindLeaseDates` loading into `lease-reminders.ts`.
- Tests: posting a Lease line per classification, tax on a capitalized line,
  amount mismatch, Draft/Cancelled lease, row of another invoice line; void
  returns rows to Pending; `stampLeaseReminders` date-moved guard; expireLeases.

### C — database + lease math
Owns `packages/database/**` (migrations, manifest, `run-journals.ts`,
`accounting-cutover/open-items.ts`, generated types), `packages/utils/src/lease-math*.ts`,
`packages/utils/src/lessor-lease*.ts`.
- Must: D1 triggers (new migration; event-system / RLS rules per
  `.claude/rules/authz-manifest.md` — triggers are ordinary migration DDL).
- Risks: cutover open items add back payments due by the last pre-cutover line
  that are Pending or on an invoice not posted before the cutover (and the same
  gap in `getLeaseNetInvestmentItems` if confirmed); `leasePayment.purchaseInvoiceLineId`
  release — AFTER DELETE trigger on `purchaseInvoiceLine` returning matching rows
  to Pending (+ CHECK `(status = 'Invoiced') = (purchaseInvoiceLineId IS NOT NULL)`
  if the data allows); `leases` view: `nextDueDate` only for Active/ended (not
  Draft/Cancelled), `classification` / `paymentAmount` / `assetCount` over Active
  assets (ended lease: all), one `LEFT JOIN LATERAL` aggregate instead of
  correlated subqueries.
- Suggestions: CHECKs (`fairValue > 0`, `economicLifeMonths > 0`,
  `purchaseOptionAmount >= 0`, `annualEscalationPercent > -100`); composite FK
  `(leaseLineId, leaseId, companyId)` on `leasePayment`, `leaseScheduleLine`,
  `leaseEvent` (needs a unique `(id, leaseId, companyId)` on `leaseLine`);
  `revenueRecognitionSchedule` lease pairing CHECK; `leaseEvent.fixedAssetId` FK;
  `run-journals.ts`: non-optional lease maps and throw when a lessee row's lease
  or asset is missing; edit `20261011163211` section 9 to delete only the runs
  the release emptied (the branch is unmerged).
- lease-math: Feb 29 `isTermWithinTwelveMonths`; a 0-month term refused with a
  clear message (not "needs a whole number of months"); leftover days get their
  share of cost (no cost-free final part-month); share `monthlyRate` / PV with
  `lessor-lease`; tests for escalation, initial direct costs, quarterly,
  leftover days, finance `amortizationMonths` ≠ term, Feb 29, 0 months; remove
  the `as never` casts in tests.
- Run `pnpm db:migrate` then `pnpm run generate:types`.

### E — accounting module, report, docs
Owns `apps/erp/app/modules/accounting/**` (except `ui/useAccountingSubmodules.tsx`),
`apps/erp/app/routes/x+/accounting+/**`, `apps/erp/app/routes/x+/revenue-recognition-run+/**`,
`apps/erp/app/routes/x+/reports+/lease-liabilities.tsx`, `packages/server-functions/src/lib/run-type.ts`,
`packages/ee/src/accounting/core/models.ts` (read only unless needed),
`.claude/rules/accounting-sync-handlers.md`, `apps/erp/app/modules/accounting/AGENTS.md`,
`.ai/specs/**`, `docs/content/docs/reference/accounting.mdx`.
- Risk: D6; report requires `view: purchasing` too (or shows a notice); a
  "lease run not posted through X" banner when the latest posted month is before
  as-of; use the asset's own end (its Termination/Purchase event date) not
  `lease.endDate`; page `getLeaseLiabilities` reads and limit them to kept assets.
- Suggestions: one client-safe run-type descriptor (filter, label, list path)
  replacing `scheduleRowsOfRunType`, the three labels and four path ternaries,
  and the hand-written unions (use the DB enum); fix `deleteRevenueRecognitionRun`
  message; move the lease liabilities helpers to `accounting/lease-liabilities.ts`;
  drop the `$runId.tsx` breadcrumb cast.
- Close checklist text: drop "rent to accrue" from revenue recognition.
- Tests: lease run post → reverse stamps and clears `leaseScheduleLine`;
  `getLeaseLiabilities` mapping; mid-month and leap-year as-of; truncated
  termination schedule.
- Docs: sync-handlers rule (`Lease Run`, what `Lease` carries, the sync-policy
  migration); accounting AGENTS.md (unpost path exists, nav Closing, test scope);
  spec line 443 `Lease Run`; scope note on `2026-07-04-lease-accounting.md`.

## Phase 2 (after Phase 1)

### D — ERP lease routes, service, models, server + row cutter
Owns `apps/erp/app/routes/x+/lease+/**`, `apps/erp/app/routes/x+/purchasing+/leases.tsx`,
`apps/erp/app/modules/purchasing/purchasing.{service,models,server}.ts` (+ tests),
`apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools.ts`,
`packages/server-functions/src/create-lease-invoices/**`, and the Modify row-cutting
call in `post-lease/lifecycle.ts`.
- Must: payment add/delete routes require `create` / `delete`; delete checks a
  row was deleted.
- Risks: write + recut in ONE Kysely transaction for all four routes; block or
  fix the MCP `upsertLeaseLine` / `updateLease` recut gap; invoice-from follows
  commencement in the Details step (one shared `resolveLeaseDates`); page the
  lease reads past 1000 rows; ISO-date refine on lease date fields + guard refine
  3; `new.tsx` logs and flashes a failed settings read; `$id.invoice.tsx` logs.
- D7 (`update.tsx` allows the four non-accounting fields while not Draft); D8
  remove-override intent.
- Suggestions: drop the route-level Draft re-checks; one export of the recut
  field sets; setup index → `assets`; drop `Number(...)` on parsed numerics; early
  return on no lines; `leaseRefusal` without the cast; deletes report not-found;
  validator tests (terminate, purchase, classification, malformed date,
  invoice-from).
- Row cutter: ONE `cutLeasePaymentRows` used by `regenerateLeasePayments`,
  `rollOpenEndedLeasePayments` and Modify; wire B's status constant into
  create-lease-invoices.

### U — lease screens
Owns `apps/erp/app/modules/purchasing/ui/Leases/**`, and moves pure lifecycle math
into `packages/utils/src/lease-math.ts` / a client-safe export shared with
`post-lease/lessee.ts`.
- Must: header shows Purchase Invoices whenever there are invoices and Invoice
  Now unless Draft/Cancelled.
- D2 / D3 / D7 / D8 in the UI; the Purchase modal refuses a price the server
  refuses; the Modify modal warns on a Short-Term asset past 12 months.
- Risks / suggestions: one shared lifecycle math (carrying, add-back, measuring,
  journal legs) used by UI and server; `LeaseSummary` reuses the liability
  helper (move `leaseAssetLiability` to `utils.ts`); payment / asset count over
  Active assets; `LeaseProperties` drop the dead Draft wiring (keep D7 fields);
  remove the dead header Activate path; fix the "Assets card" hint; split
  `LeaseClassificationPreview.tsx` and reuse `LeaseJournalPreview`; rename
  `useAssetPreviews`; `<Plural>` for the two hand plurals; one
  `useLeaseFrequencyLabel`; type `LeasePaymentInvoiceLinks.status` with the enum
  (drop both casts), drop the other casts; surface real errors from
  `previewLesseeClassification`; trim unused barrel exports and `LeaseListItem`;
  promote one money component shared with `RentalMoney`.
