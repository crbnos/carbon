# Several assets per lease — implementation plan

**Spec:** .ai/specs/2026-10-11-lessee-leases.md → Addendum (A1–A8)
**Research:** .ai/research/2026-10-11-lessee-lease-accounting.md → Addendum
**Closest sibling:** rental agreement (`rentalAgreement` + `rentalAgreementLine`; setup step Units = `RentalUnitsGrid`)
**Review findings folded in:** .ai/runs/2026-10-11-lessee-leases-review.md (M1–M17)

## Progress
- [x] W1: Migration — `leaseLine`, line ids on payments / schedule / events, `leases` view (M17), RLS, types
- [x] W2: Lease math — month counting from the 29th–31st (M15), Short-Term test on the full term (M16)
- [x] W3: ERP models, service, server — line CRUD, rows per line, payment and invoice-line guards (M10, M11, M14)
- [x] W4: `post-lease` activate, cancel, opening balance per line (M7, M8)
- [x] W5: `post-lease` modify per lease, terminate and purchase per line (M3–M6)
- [x] W6: Invoices and posting per line
- [x] W7: Run journals, cutover open items, Lease Liabilities report per line
- [x] W8: Daily job — expiry and reminder stamps (M1, M2)
- [x] W9: UI — Assets step, Payments and Accounting per asset, lease page per asset, route fixes (M9, M12, M13), dead Draft UI removed
- [ ] W10: Docs, AGENTS.md, translations, full verification, browser test

## Dependencies
W1 first (types). W2 independent. W3–W8 need W1. W9 needs W3–W5. W10 last.

---

## W1: Migration

**Files:** new migration `lease-lines`; `packages/database/src/authz/manifest.ts`; `audit.config.ts`; `packages/jobs/src/backups/id-refs.ts`; `types.ts` (generated).

1. Create enum `leaseLineStatus` (`Active`, `Terminated`, `Purchased`, `Expired`). A Draft lease's lines are `Active`; the lease status says Draft.
2. Create `leaseLine` (`id('lsln')`, `companyId`, `leaseId` FK cascade, `description` NOT NULL, `serialNumber`, `locationId`, `paymentAmount` NUMERIC NOT NULL DEFAULT 0 CHECK ≥ 0, `fairValue`, `economicLifeMonths`, `ownershipTransfers`, `specializedAsset`, `purchaseOptionAmount`, `purchaseOptionReasonablyCertain`, `status`, `lesseeClassification`, `classificationInputs`, `classificationOverride` + reason CHECK, `initialLiability`, `initialRouAsset`, `rouAssetCost`, `fixedAssetId` FK set null, `sortOrder`, audit columns).
3. Backfill one line per lease from the header's asset columns (`description` = `lease.name`).
4. Add `leaseLineId` (FK cascade) to `leasePayment`, `leaseScheduleLine`, `leaseEvent`; backfill from the lease's one line; `NOT NULL` on all three: a Modification writes one event per asset. Replace the payment unique index with `(companyId, leaseLineId, dueDate, paymentType)` and the schedule unique with `(companyId, leaseLineId, periodDate)`.
5. Drop the moved header columns (`paymentAmount`, `fairValue`, `economicLifeMonths`, `ownershipTransfers`, `specializedAsset`, `purchaseOptionAmount`, `purchaseOptionReasonablyCertain`, `lesseeClassification`, `classificationInputs`, `classificationOverride`, `classificationOverrideReason`, `initialLiability`, `initialRouAsset`, `rouAssetCost`, `fixedAssetId`). Add `CHECK ("discountRate" >= 0)`.
6. Recreate `leases`: `supplierName`, `assetCount`, `paymentAmount` (sum of lines), `classification` (the one shared value, else `Mixed`), `nextDueDate`, `currentLiability` = per Active line, the closing liability of its last `leaseScheduleLine` with `postedAt` set, else its `initialLiability`; Draft, Cancelled and ended lines count 0 (M17).
7. Authz: `leaseLine` like `leasePayment`; generate the RLS migration. Audit entity `lease` adds `leaseLine`.

**Verify:** `pnpm db:migrate && pnpm run generate:types`; `psql` shows one line per existing lease and no NULL `leaseLineId`.

## W2: Lease math

1. `monthsBefore` / `monthsThrough` / `scheduleSpan` / `leaseMonthStarting` count lease months with `addMonths` (clamped) — one helper `leaseMonthIndex(start, date)`.
2. `classifyLesseeLease` Short-Term test: `endDate <= addMonths(commencement, 12) − 1 day`, passed as a flag, not rounded-down months.
3. Tests: start on the 31st (Advance and Arrears points), 12 months + 15 days is not Short-Term.

## W3: ERP models, service, server

1. `leaseValidator` loses the asset fields; `leaseLineValidator` (description, serial, location, payment amount, fair value, economic life, switches, purchase option).
2. Service: `getLeaseLines`, `upsertLeaseLine` (Draft only), `deleteLeaseLine` (Draft only); `upsertLeasePayment` matches the row's own `leaseId` (M10) and sets Pending / Skipped from `invoiceFromDate`; payments carry `leaseLineId`.
3. `regenerateLeasePayments` cuts rows per line with an amount above 0 (M14); a line with no amount has no rows.
4. Invoicing: strip `leasePaymentId` from a new line and keep the stored one on update (M11).

## W4: post-lease activate, cancel, opening

1. Activate per line: PV, classification (per line override), schedule and run rows per line; one journal per lease with legs per line (`documentLineReference` = line id). Refuse a lease with no line or no row.
2. Opening path: per line; rows due before the as-of date become `Skipped` (M8); schedule lines before the date get `postedAt`.
3. Cancel voids every `Lease` journal of the lease (M7) and refuses after an Invoiced row or a run-posted row.

## W5: Modify, Terminate, Purchase

1. `prepare` refuses a date inside a payment period (M6) and loads carrying amounts per line.
2. Modify (lease): new end date, rate, frequency, escalation and a payment amount per Active line; remeasure each line; one journal.
3. Terminate (line): payload gets `leaseLineId`; delete that line's Pending rows after the date and its option row, counting the option in the carrying liability (M4); lease becomes Terminated when no Active line is left.
4. Purchase (line): reuse an Invoiced option row or refuse cleanly (M5); price not counted twice (M3); fix the test.

## W6–W8

- W6: invoice line description names the asset; posting reads the line's classification; refuse a Lease line of a Cancelled lease.
- W7: run journal lessee rows tag the line; cutover open items and the report per line.
- W8: expiry when every line's last `closingRouAsset` is 0 (M1); stamp `r.date` where unchanged (M2).

## W9: UI

1. Wizard steps Details → Assets → Payments → Accounting → Review (`leaseSetupSteps`). Assets = `LeaseAssetsGrid` copied from `RentalUnitsGrid` (add, delete, cells: description, serial, location, payment, fair value, economic life).
2. Payments: terms + rows grid with an Asset column. Accounting: classification per asset (like `RentalAgreementAccounting`'s unit grid) + switches per asset.
3. Lease page: Assets card with per-asset Terminate / Purchase; Modify takes a payment per asset.
4. M9 (`$id.status` refuses a Draft), M12/M13 (`requestReferrer`), remove the Draft branch of `LeasePayments` and the `$id.payments.$paymentId` edit route.
