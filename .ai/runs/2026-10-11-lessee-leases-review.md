# Lessee leases — self-review findings (2026-10-11)

Four read-only review agents over `aa5a8a032e..HEAD`. Every item is checked before a fix.

## Jobs and notifications
- [ ] M1 `expireLeases` expires a lease with a net ROU asset above 0 (ownership transfers / purchase option reasonably certain) — then Purchase is refused. Expire only when the last schedule line's `closingRouAsset` is 0.
- [ ] M2 `stampLeaseReminders` writes the lease's current date, not the reminded date. Write `r.date` where the column still equals it.
- [ ] R digest misses drafts when `lease-billing` throws after partial commits; reminders go to `invoiceNotificationGroup` (AR) — owner may lack purchasing view.
- [ ] S tests for `expireLeases` / `stampLeaseReminders`; one shared billable-status constant; `formatDetailDate` uses JS Date.

## Server functions
- [ ] M3 Purchase at end of term counts the option price twice (Pending option row deleted while the carrying liability already excludes it); the test asserts the wrong cost.
- [ ] M4 Terminate on the end date strands a reasonably certain option row in the liability.
- [ ] M5 Purchase after the option row is Invoiced breaks `leasePayment_unique` (raw 500).
- [ ] M6 Modify / Terminate accept a date inside a quarterly or annual payment period.
- [ ] M7 Cancel voids only `commencementJournalId`; a Modify journal stays.
- [ ] M8 Opening-balance path leaves Pending rows due before the as-of date; the invoice job bills them again.
- [ ] R posting does not compare the Lease line amount with the payment row; posting does not check lease status (Cancelled); lifecycle vs run proposal race (no advisory lock); Short-Term override not re-tested; amortization months after Modify; Cancel loads all accounts; Modify end<effective gives 500.
- [ ] S VOID test; void label for opening journal; `currencyDecimals` import from rental module.

## Database / utils / run engine
- [ ] M15 `lease-math` month counting: `addMonths` clamps day 29–31 but `monthsBefore` / `monthsThrough` use `wholeMonthsInTerm` (original day) → wrong payment points for a lease starting on the 31st; `leaseMonthStarting` rejects valid month starts.
- [ ] M16 Short-Term test uses rounded-down whole months — 12 months + 15 days classifies Short-Term.
- [ ] M17 `leases` view `currentLiability` ignores status (Terminated/Purchased/Cancelled must be 0) and reads `revenueRecognitionSchedule` (accounting RLS) — purchasing users always see `initialLiability`. Read posted state from `leaseScheduleLine`.
- [ ] R schedule / event tables writable through the API; `purchaseInvoiceLineId` no FK (consider a delete trigger); short arrears last period lands early; old posted rev-rec runs holding rental rows; migration section 9 untested; missing lease in `sources.leases` posts without dimensions.
- [ ] S lease-math tests (31st start, escalating operating, short arrears period); one shared run-type filter; dead `RUN_TYPES`/`RUN_LABEL`; stale `Lease` posting-policy comment; linear scans; FKs on `fixedAssetId` / `voidedPurchaseInvoiceId`; `discountRate >= 0` check.

## ERP UI
- [ ] M9 `$id.status` cancel deletes a Draft with only `update: purchasing` (bypasses `delete`).
- [ ] M10 `upsertLeasePayment` matches the row on id + companyId only — a row from another lease can be moved (MCP tool). Add `.eq("leaseId", …)`.
- [ ] M11 Invoice-line validator accepts `leasePaymentId` from the client; a hand-made Lease line can claim a payment row (row stays Pending → billed twice). Strip on create, keep stored value on update.
- [ ] M12 Failed Activate redirects to details → setup/payments; use `requestReferrer` like the rental sibling.
- [ ] M13 Classification override redirects to details → setup/payments; use referrer / setup accounting.
- [ ] M14 `update.tsx` regenerates rows at amount 0 (frequency/timing chosen first) → zero rows enable Next and Activate.
- [ ] R moving commencement earlier marks first payments Skipped; grid edits ignore `invoiceFromDate`; Details/Accounting changes silently replace edited rows; foreign-currency gap links to Details; disabled unit price may post null; Lease Liabilities empty without purchasing_view; `$id.schedule` / `$id.events` show editable page for a Draft.
- [ ] S remove the unreachable Draft branch of `LeasePayments` and the edit route; currency decimals fallback 2; log before error redirects; stale `update.tsx` comment; revenue-recognition messages became generic.
