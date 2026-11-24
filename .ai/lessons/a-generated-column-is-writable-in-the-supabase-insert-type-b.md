---
paths: ["packages/jobs/src/inngest/functions/integrations/ramp-sync-bill*.ts"]
triggers: ["purchaseInvoiceLine", "supplierQuoteLinePrice", "supplierUnitPrice", "GENERATED ALWAYS"]
promoted: null
---
# A generated column is writable in the Supabase Insert type but rejected at runtime

**Context:** The Ramp inbound bill/reimbursement sync inserted `purchaseInvoiceLine` rows with `unitPrice: line.amount` and `exchangeRate: 1`. Since `20260811123616`, `purchaseInvoiceLine.unitPrice`/`totalAmount`/`shippingCost`/`taxAmount` are `GENERATED ALWAYS AS (supplier* / exchangeRate) STORED` — base-currency mirrors of the document-currency `supplier*` columns.

**Problem:** `supabase gen types` lists STORED generated columns in the `Insert`/`Update` types as optional, so `unitPrice: line.amount` typechecks — but Postgres rejects a non-DEFAULT write to a generated column at runtime, and the value never reaches `supplierUnitPrice`, so `post-purchase-invoice` (which posts `quantity * unitPrice`, unitPrice already base) had nothing to post. The path also hardcoded `exchangeRate: 1`, so even when it did post, a foreign-currency bill posted at par. Both are invisible to typecheck and to unit tests that mock the insert.

**Rule:** Write purchase amounts to the `supplier*` document-currency columns (`supplierUnitPrice`, `supplierShippingCost`, `supplierTaxAmount`) plus the real `exchangeRate` (foreign-per-base, from `get_exchange_rate`); never write the generated unprefixed `unitPrice`/`totalAmount`/`shippingCost`/`taxAmount`. A column being present in the generated `Insert` type is NOT proof it is writable — check the migration for `GENERATED ALWAYS`. The generated base column then derives correctly and posts in base currency.

**Applies to:** any code inserting `purchaseInvoiceLine` / `purchaseOrderLine` / `supplierQuoteLinePrice` rows (Ramp `syncBill`/reimbursement path, CSV import, AI extraction), and the general "is this Insert-typed column actually generated?" check before writing a value-bearing purchase column.
