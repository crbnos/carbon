# Accounting priorities 1 and 2: end-to-end verification

User authorized /test, database/API setup and the configured Rillet integration. Test the merged branch beginning at84abeb3e3d. Preserve all existing operational records and isolate fixture ownership; no database reset. No Xero/QBO success claim without actual connections.

- [x] Rillet actual sync and independent returned document/ledger comparison: invoices, bills, payments, tax, shipping, original accounts, FX, precision, retries and reversals.
- [x] UI payment creation, discounts/write-offs, credits, memos, refunds and post/void restoration for customer/supplier sides.
- [x] High-rate manual160/160.01 and final0.01 document-unit settlement, including memo credit.
- [x] Actual intercompany seller/buyer posting with300.015 matching key, matching/elimination, partial realization and regeneration.
- [x] Subsidiary-only authenticated report access, parent CTA, inactive historical chart, period columns and CSV parity.
- [x] Sales and purchase invoice posting with tax/shipping/mixed signs, changed defaults, settlement and void with zero tie-out variance.
- [x] Default account setup/save/reload/rejection atomicity, new-company shipping account and >1000-row boundaries.
- [x] Record failures with UI/API/database evidence, continue independent workflows, refresh only successful playbooks and publish a complete report.

Evidence is isolated under `.context/accounting/e2e-20260909/` and `.ai/scratch/e2e/accounting-20260909/`. Root owns payments and sales UI. Disjoint agents own Rillet, reports/defaults/large datasets, and purchasing/intercompany. Each records exact owned local/remote IDs and expected versus actual values. Credentials never enter evidence or tool output.

Completed means executed and adjudicated, not that every test passed. Results and next fixes: [September 9 run](../runs/2026-09-09-accounting-e2e.md).
