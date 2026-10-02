# Grill — subscriptions / recurring invoicing (spec in design)

Resolutions carried into `.ai/specs/2026-10-02-subscriptions.md` when it is written.
Research: `.ai/research/subscription-recurring-invoicing.md`.

## Settled by the codebase (no question)

- Foreign currency: Service-line deferral in `post-sales-invoice` already posts in base
  (`amountBase: charges.amounts.salesRevenueBase`), so subscriptions are not restricted to
  base currency the way rental agreements are.

## Resolved with the user

- [x] **Q1 — What can a subscription line bill?** — **Answer:** Service items only. Recurring
  physical goods (shipping, stock) are recurring sales orders, a different feature; usage-based
  (metered, in arrears) billing is out of v1.
- [x] **Q2 — Billing frequencies** — **Answer:** Daily, Weekly, Monthly, Quarterly, Annually.
  (Whether this is the invoice rhythm or the unit the rate is quoted in — see Q2b.)
