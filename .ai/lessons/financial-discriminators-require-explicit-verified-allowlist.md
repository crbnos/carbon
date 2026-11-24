---
paths: []
triggers: []
promoted: null
---
# Financial discriminators require explicit verified allowlists

**Context:** Ramp payment methods, reimbursement states, and repayment funding values determine whether Carbon creates a bank settlement, skips a card-funded payment, or leaves an invoice open.

**Problem:** Unknown values fell through to financially meaningful defaults, so new or misunderstood provider enums could debit the statement bank account or mark a reimbursement paid without a verified basis.

**Rule:** Route financial side effects only from an explicit allowlist grounded in the provider contract. Unsupported, missing, or ambiguous discriminator values must fail before mapping or posting; expanding the allowlist requires contract evidence and positive routing tests.

**Applies to:** Ramp bills, reimbursements, repayments, and every integration enum that selects accounts, settlement state, or document type.
