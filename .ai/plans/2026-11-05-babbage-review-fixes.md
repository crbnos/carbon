# Babbage branch review fixes

- [x] Persist and consume deposit refunds against original prepayments; preserve carrying amounts/accounts, cap refunds, restore funding on void, block original-source void while refunded.
- [x] Regenerate database types using supported generation tooling.
- [x] Compare cumulative shipped and invoiced quantities in period-close warning; prove partial shipment case.
- [x] Page supplier prepayment references and closed PO lookups.
- [x] Run scoped tests, lint, typechecks and self-review; update affected documentation.

Worktree: /tmp/carbon-babbage-review at a36b56ed62. Existing user's checkout is untouched.
Refund schema extension approved by the user on 2026-11-05. invoiceSettlement remains the authoritative application ledger; refund targets are derived only at posting.
