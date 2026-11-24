---
paths: []
triggers: []
promoted: null
---
# Sales-order Paid Amount uses invoice-target principal

**Context:** Summarizing linked sales-invoice payments on a sales order.

**Problem:** `invoiceSettlement.sourceAmount` is principal in the payment funding source's currency, so it does not represent the amount applied to the invoice. Using it for the order's Paid Amount disagrees with the invoice Payments panel and can mix currency semantics.

**Rule:** Sales-order Paid Amount sums posted payment `appliedAmount` (company base) per invoice, then converts it with that invoice's exchange rate into the matching order currency. Do not use `sourceAmount` for this summary. There is no legacy `baseStatus === "Paid"` fallback that counts the full invoice total — every payment flows through `invoiceSettlement`, so a fully-paid invoice's settlements already sum to its total.

**Applies to:** `getSalesOrderInvoicePaymentsByIds`, the sales-order loader's `invoiceSummary`, and any UI summarizing cash applied to invoice targets.
