# Lessee leases — self-review findings (2026-10-11)

Four read-only review agents over `aa5a8a032e..HEAD`. Every item is checked before a fix.

## Jobs and notifications
- [x] M1 `expireLeases` expires a lease with a net ROU asset above 0 (ownership transfers / purchase option reasonably certain) — then Purchase is refused. Expire only when the last schedule line's `closingRouAsset` is 0.
- [x] M2 `stampLeaseReminders` writes the lease's current date, not the reminded date. Write `r.date` where the column still equals it.
- [ ] R digest misses drafts when `lease-billing` throws after partial commits; reminders go to `invoiceNotificationGroup` (AR) — owner may lack purchasing view.
- [ ] S tests for `expireLeases` / `stampLeaseReminders`; one shared billable-status constant; `formatDetailDate` uses JS Date.

## Server functions
- [x] M3 Purchase at end of term counts the option price twice (Pending option row deleted while the carrying liability already excludes it); the test asserts the wrong cost.
- [x] M4 Terminate on the end date strands a reasonably certain option row in the liability.
- [x] M5 Purchase after the option row is Invoiced breaks `leasePayment_unique` (raw 500).
- [x] M6 Modify / Terminate accept a date inside a quarterly or annual payment period.
- [x] M7 Cancel voids only `commencementJournalId`; a Modify journal stays.
- [x] M8 Opening-balance path leaves Pending rows due before the as-of date; the invoice job bills them again.
- [ ] R posting does not compare the Lease line amount with the payment row; posting does not check lease status (Cancelled); lifecycle vs run proposal race (no advisory lock); Short-Term override not re-tested; amortization months after Modify; Cancel loads all accounts; Modify end<effective gives 500.
- [ ] S VOID test; void label for opening journal; `currencyDecimals` import from rental module.

## Database / utils / run engine
- [x] M15 `lease-math` month counting: `addMonths` clamps day 29–31 but `monthsBefore` / `monthsThrough` use `wholeMonthsInTerm` (original day) → wrong payment points for a lease starting on the 31st; `leaseMonthStarting` rejects valid month starts.
- [x] M16 Short-Term test uses rounded-down whole months — 12 months + 15 days classifies Short-Term.
- [x] M17 `leases` view `currentLiability` ignores status (Terminated/Purchased/Cancelled must be 0) and reads `revenueRecognitionSchedule` (accounting RLS) — purchasing users always see `initialLiability`. Read posted state from `leaseScheduleLine`.
- [ ] R schedule / event tables writable through the API; `purchaseInvoiceLineId` no FK (consider a delete trigger); short arrears last period lands early; old posted rev-rec runs holding rental rows; migration section 9 untested; missing lease in `sources.leases` posts without dimensions.
- [ ] S lease-math tests (31st start, escalating operating, short arrears period); one shared run-type filter; dead `RUN_TYPES`/`RUN_LABEL`; stale `Lease` posting-policy comment; linear scans; FKs on `fixedAssetId` / `voidedPurchaseInvoiceId`; `discountRate >= 0` check.

## ERP UI
- [x] M9 `$id.status` cancel deletes a Draft with only `update: purchasing` (bypasses `delete`).
- [x] M10 `upsertLeasePayment` matches the row on id + companyId only — a row from another lease can be moved (MCP tool). Add `.eq("leaseId", …)`.
- [x] M11 Invoice-line validator accepts `leasePaymentId` from the client; a hand-made Lease line can claim a payment row (row stays Pending → billed twice). Strip on create, keep stored value on update.
- [x] M12 Failed Activate redirects to details → setup/payments; use `requestReferrer` like the rental sibling.
- [x] M13 Classification override redirects to details → setup/payments; use referrer / setup accounting.
- [x] M14 `update.tsx` regenerates rows at amount 0 (frequency/timing chosen first) → zero rows enable Next and Activate.
- [ ] R moving commencement earlier marks first payments Skipped; grid edits ignore `invoiceFromDate`; Details/Accounting changes silently replace edited rows; foreign-currency gap links to Details; disabled unit price may post null; Lease Liabilities empty without purchasing_view; `$id.schedule` / `$id.events` show editable page for a Draft.
- [ ] S remove the unreachable Draft branch of `LeasePayments` and the edit route; currency decimals fallback 2; log before error redirects; stale `update.tsx` comment; revenue-recognition messages became generic.

## Status (2026-10-11, after the several-assets change)

Every M item is fixed in `6692835a20`, with a test where one fits (lease-math, post-lease, lifecycle, the report). These R and S items are fixed too:

- Posting compares a capitalized Lease line with its payment row, and refuses a Draft or Cancelled lease.
- Modify refuses an end date before the effective date in its validator, not with a 500.
- ROU amortization after a Modify runs over what is left of the economic life.
- Grid edits of a payment row set Pending or Skipped from `invoiceFromDate`.
- `$id.schedule` and `$id.events` send an editor's Draft to its setup.
- The Draft branch of `LeasePayments` and the `$id.payments.$paymentId` edit route are gone.
- `regenerateLeasePayments` refuses an unknown currency instead of falling back to 2 decimals.
- The cancel void names the voided journal (`VOID <description>`).

Still open:

- R: a lifecycle action and a run proposal can interleave (no advisory lock); the run's out-of-date check catches the result at post time.
- R: `post-lease` imports `currencyDecimals` from the rental module.
- S: one shared billable-status constant (create-lease-invoices and the daily job).
