# Lease duration, open-ended leases, a shorter Details step

**Spec:** .ai/specs/2026-10-11-lessee-leases.md → Addendum (A9–A11, added by this change)
**Closest sibling:** the AR contract's Term section (`ContractDetailsForm`: a Duration select — fixed months, Open-ended, Custom — with "Ends …" under it, `contractDurations` / `contractEndDate` / `contractDurationOf`) and the rental agreement's Details step (no name; the site in the first section).

## Decisions

| # | Decision |
|---|---|
| A9 | The Details step asks for a **Duration**: 12, 24, 36, 48 or 60 months, Open-ended, or Custom (an End Date). A fixed duration ends the day before the same date N months on. The duration is not stored: it is read back from the dates (`leaseDurationOf`). |
| A10 | An **open-ended** lease (`endDate` NULL) can end on notice, so its term is short (ASC 842-10-30-1): every asset is Short-Term. Activation posts no journal and writes no schedule. Payment rows roll forward: whole periods, never prorated, through the period after the one `asOf` falls in. The daily job and Invoice Now cut the next rows before they draft. No purchase option row. Modify and Purchase do not apply; Terminate ends it. It never expires on its own. |
| A10a | With the company's short-term expedient off, an open-ended lease cannot activate. Every place that says so gives both fixes, linked: turn on **Short-Term Lease Expedient** in Settings → Accounting, or give the lease a fixed **Duration** on the Details step. |
| A11 | The Details step drops the Leased Asset section. `lease.name` becomes optional (the page shows the lease number and the supplier); Description moves under More Details as Notes. Location moves into the first section, beside the supplier. |

## Steps

- [x] 1. Migration: `lease.name` and `lease.endDate` nullable; `lease_dates_check` allows NULL. Types.
- [x] 2. lease-math: `generateLeasePayments` with `endDate: null` and `through` (whole periods, no option row); `openEndedLeaseHorizon(commencementDate, asOf, frequency)`. Tests.
- [x] 3. ERP models: `leaseDurations`, `leaseEndDate`, `leaseDurationOf`; `leaseValidator` `duration`, optional `name` / `endDate`.
- [x] 4. Service and routes: `leaseTerms` resolves the end date; `regenerateLeasePayments` cuts an open-ended lease through the horizon.
- [x] 5. post-lease: activate an open-ended lease as Short-Term, refused without the expedient (message names both fixes); Modify / Purchase refused; `prepare` with no end date.
- [x] 6. create-lease-invoices: roll an open-ended lease's rows forward before drafting. Jobs: reminders and expiry with no end date.
- [x] 7. UI: Details step (Duration, Location in the first section, no Name, Notes under More Details); the open-ended state on the Accounting and Review steps with both fixes linked; summary, header, assets card, properties.
- [x] 8. Tests, docs, translations, verification, browser test (both flows PASS; fixes from the run: Duration required, no repeated supplier name, open-ended Activate text and summary, settings link anchored to the lease card, stable payment order, asset name on one line).
