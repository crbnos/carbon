# Rillet outbound accounting verification

Last tested: 2026-09-09, including the Rillet accounting corrections.
Routes: `/x/settings/integrations/rillet`; actual provider/syncer/API surface below.

## Prerequisites

- Resolve configured credentials using Carbon's provider integration path and confirm **sandbox**, subsidiary, base currency, and chart without printing vaulted keys.
- Use fresh uniquely named owned documents with no customer email addresses; verify automatic invoice sending/reminders are false. Lifecycle fixtures are consumed by void testing.
- Map source sales/shipping/expense/control accounts to provider accounts. Cash must also link to a **Rillet bank account**, checked with `GET /bank-accounts`. A GL-only account mapping does not establish that bank relationship.
- The test skill/auth workflow applies to browser setup. Backend fixtures and real APIs are appropriate when authorized. Always preserve all source/remote IDs.
- Direct sales invoice fixtures must insert `salesInvoiceShipment`, including a zero-shipping row; the actual posting/void endpoint expects it. Seed original posted journals with the original shipping/AP accounts, which may differ from current defaults.

## Verified successful flows

### Native invoice amounts, fixed FX, and revenue

Create/post a USD invoice with twenty lines at 1.99 and 8.25% tax. Use the actual configured provider and `SyncFactory`, preferably through `reconcileEntities` and `drainSyncOperations`. Independently fetch the remote document: net 39.80, tax 3.28, gross 43.08. In `/reports/journal-entries`, require AR +43.08, tax liability −3.28, revenue −39.80, and Deferred Revenue net 0.

Use merchandise 100, line shipping 10, header shipping 5, and 10% tax on merchandise+line shipping. Require gross 126, native tax 11, shipping 15 across two components; GL revenue −100, original shipping revenue −15, tax −11, AR +126. The tested original shipping account mapped 40120 and differed from the current unmapped shipping default. Current defaults must not replace original posted shipping provenance.

Invoices now use `REVENUE_RECOGNITION_ONLY` with explicit same-day revenue periods. Check the entered posting date (including when issue date differs), fixed exchange-rate date, and recognition date. Carbon stores foreign units per base unit; Rillet receives document→subsidiary and the inverse rate. For base USD 100, EUR rates 0.8/1.2/1 must produce document EUR 80/120/100 and AR/revenue base USD 100. JPY 160 at rate 160 must report base USD 1; BHD 0.462 at rate 0.376 must report base USD 1.23. Independently verify returned rates and ledger amounts; successful HTTP alone is insufficient.

### Bills and payment fanout

Push a bill with posted cost 100 and AP 100. Require expense +100/AP −100, and no AP control line among native bill costs. Repeat EUR rates 0.8/1.2/1: source base 100, document 80/120/100, remote base 100. The tested original AP account differed from today's default.

Post a USD customer receipt 169.08 applied to the 43.08 and 126 invoices, plus a USD supplier disbursement 100 against the bill. Use the actual `post-payment` endpoint and a bank-linked cash account. Reconcile/drain and require Completed operations, exactly two AR native payments and one AP native payment, correct amounts, and PAID documents. Repeat reconciliation; require no new operations or native payments.

### Carbon-originated void round trips

Void the two local payments through `post-payment`, then reconcile/drain. All three native payments must delete and invoices/bill return UNPAID. Carbon's own GL is REVERSED, never deleted: the original cash entries and their `VOID ...` reversal must both remain auditable, with the reported cash balance netting to zero. Check all single/fanout mapping keys retain `origin: carbon` and `voided: true`. A pulled-origin mapping is never echoed back as a deletion. Repeat reconciliation and require no new operation; a remote 204 followed by failed local persistence is safe to retry because only DELETE 404 is accepted as already absent.

Void local invoices/bills through their actual posting endpoints and reconcile/drain after payment reversal. Native GET must return 404. The original AR/AP, tax, shipping, revenue-recognition and cash entries must each net to zero in the reporting GL against their reversal — the original rows stay, because `reverseJournalEntry` posts a reversing entry rather than deleting a posted journal. Retained document mappings must carry `voided: true`. Repeat reconciliation and require no new work. A native deletion rejected due to a remaining/cleared payment must surface a failed operation; bounded automatic re-drive handles payment/document drain ordering.

### Journal reversal

Push an owned inventory journal: inventory debit 100 and adjustment expense credit 100. Reverse locally and push the original ID with `:reversal`. Independently sum original/reversal by provider account; every account must net 0. Replays preserve remote IDs. This flow was verified before the provider corrections and its focused regressions remain green.

## Coverage boundaries

- Outbound native documents, reconciliation/drain, and Carbon-originated USD payment voids were live verified. Full inbound webhook delivery was not verified.
- Xero/QBO were not configured and were not live tested. Their native-void routing remains unchanged.
- Foreign-currency payment push remains an existing explicit unsupported case; fixed FX proof above applies to invoices and bills.
- Shared shipping/cash configuration gaps were intentionally preserved. Use mapped owned accounts for these tests.

## Evidence

Workspace-local report: `.context/accounting/e2e-20260909/fix-rillet-results.md`; JSON/API/GL evidence and fresh fixture IDs are in that directory. The scripts must not be blindly rerun after their local and remote documents have been voided. No browser session was opened for this backend verification.
