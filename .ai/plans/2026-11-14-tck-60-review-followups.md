# TCK-60 review followups

- [x] Confirm that the invoice SQL is scoped, indexed, and consistent with the intended line-account semantics using Carbon's database rules and PlanetScale's Postgres guidance.
- [x] Pin the specialized and unassigned invoice-line cases in the SQL regression test.
- [x] Update the invoicing and CSV-export guides to describe the lookup and server-only export behavior.
- [x] Run the SQL regressions, scoped ERP typecheck, and focused repository checks; review the final diff.

The GL Codes column reports explicit invoice-line account numbers, plus the Sales account default for ordinary sales lines without an account. It does not claim to list every account in the posted journal.

Review evidence: both rollback-only SQL tests passed; the scoped ERP typecheck and focused Biome check passed. Existing `invoiceId` indexes support the batched line lookups. The view's appended name columns remain in the public `getSalesInvoices` response. The list also uses the guarded RPC so invoice-only users receive names. Removing those view columns would change that API response and require an invasive view migration; no measured query problem justifies it here.
