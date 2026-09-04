# Period closing, AR/AP payments, and company backups

> Close accounting periods, set budgets, reconcile bank statements, record receivable and payable payments, and back up or restore a whole company.

Accounting gained period closing, budgeting, and bank reconciliation, with drill-down from any account into the entries behind it. AR/AP payments record what customers pay and what you pay suppliers. Company backups export everything a company owns and restore it, with real progress and faster downloads.

## Onboarding, revamped

Onboarding was rebuilt around the Implementation Hub and a Setup Map, and a new company can start from demo data.

- Manufacturer Part Number on items.
- An aggregated stock movements view.
- Document templates support registration numbers, and PDFs auto-fill.
- Supersession shows on material, tool, and consumable pages, with lifecycle badges and mode help.
- Shift-select in tables, better inline editing, and CSV exports that respect the current view.
- Download links for files.
- Job order status tracks supply jobs and material shortfalls.
- Self-hosting: auth providers are configurable from .env.

- Quote-to-order financials are derived server-side, and quote acceptance is guarded against replay and stale status.
- Invoice tax, the WIP ledger, editing production events, and dimension labels fixed.
- Invoicing works without accounting enabled.
- A job's shipped quantity is no longer overwritten on completion.
- Negative adjustment errors surface in the modal.
- File previews are authorized by company.
- Backup restore hardening, and transient MRP tables are excluded from backups.
- Auto-completed job operations record who completed them.
- The number input allows direct typing.
