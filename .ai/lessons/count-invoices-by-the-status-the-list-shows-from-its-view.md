---
paths: ["apps/erp/app/modules/*/ui/**/*Dashboard*"]
triggers: ["baseStatus", "from(\"purchaseInvoice\")", "from(\"salesInvoice\")"]
promoted: null
---
# Count invoices by the status the list shows, from its view

**Context:** The purchasing dashboard's Open Purchase Invoices card counted `purchaseInvoice` rows by status, and its link opens the Purchase Invoices list filtered on the same statuses.

**Problem:** The list reads the `purchaseInvoices` view, which derives `Partially Paid`, `Paid` and `Overdue` from settlements and the due date. The table stores the posted status (`Open`, or `Submitted` on sales) and keeps it once the invoice is paid. Counting the table missed every posted bill, and adding `Open` to the table filter would have counted paid bills too.

**Rule:** Count, filter or badge invoices by status from `salesInvoices` / `purchaseInvoices`, the views the lists read. Read the table's `status` (the views' `baseStatus`) only for a rule about the stored state, such as whether the invoice is posted.

**Applies to:** dashboards, KPIs and cards that count sales or purchase invoices by status.
