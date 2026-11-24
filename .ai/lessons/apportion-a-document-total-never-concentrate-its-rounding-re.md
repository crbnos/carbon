---
paths: ["packages/ee/src/accounting/core/sales-document-components.ts", "packages/database/src/sales-posting-amounts.ts", "packages/ee/src/accounting/core/document-costing.ts"]
triggers: ["distributeRoundingResidual", "residual"]
promoted: null
---
# Apportion a document total, never concentrate its rounding residual

**Context:** Sales invoices push to QuickBooks/Xero/Rillet as components (merchandise, add-ons, line shipping, header shipping), each rounded at the document currency's precision, and the sum must equal the authoritative document total.

**Problem:** Rounding N components independently leaves a residual of up to N/2 minor units. Assigning that whole residual to one component broke that component's own percent/amount pair — a 20 x $1.99 @ 8.25% invoice gave one line $0.24 tax on $1.99 net (12.06% against a stated 8.25%). QuickBooks re-derives `round(net x percent)` within one minor unit and refused the invoice with `UNMAPPED_TAX_CODES`, a message blaming the customer's QuickBooks configuration, which they cannot act on. A randomised sweep put this at 1.6% of invoices; some cases produced a negative tax on positive revenue, which Xero accepts and posts.

**Rule:** Use `distributeRoundingResidual` (`@carbon/utils`) whenever a total is apportioned across parts — largest remainder, at most one minor unit moved per part. Never hand-roll "assign the difference to the biggest line". Order the parts by a stable business key (component id) before distributing, because the distributor's own tie-break is positional and the same invoice must allocate identically whatever order its lines arrive in. Where a derived value must reproduce the reconciled amount (a unit price times its quantity), derive it and then VERIFY — refuse when no representable value works, rather than emitting an inconsistent one.

**Applies to:** `packages/ee/src/accounting/core/sales-document-components.ts`, `packages/database/src/sales-posting-amounts.ts`, `packages/ee/src/accounting/core/document-costing.ts`, Ramp card/repayment allocation, and any future provider document mapper.
