# Execution log — rental invoice automation

Plan: `.ai/plans/2026-10-02-rental-invoice-automation.md`. Context: `.ai/runs/2026-10-02-grill-subscriptions.md` (U1–U4, G7).

## Task 1 — baseline
- Committed the uncommitted spec/plan docs (c59a49e52d), merged origin/main (a528a17865). 24 conflicts, none in the plan's stop-list files. Main's side of the 13 UI conflicts was only the `MENU_ITEM_SHORTCUTS` Delete/Edit shortcut; HEAD had moved those menus into `*Header` components (DocumentPage), so HEAD was kept and the shortcut re-applied there. `invoicing.service.ts` / `sales.service.ts`: main's column-strip destructure combined with HEAD's service period. Fixed-asset docs: HEAD text kept (describes building/capitalizing/work-center link). MCP digest regenerated.
- `pnpm db:migrate` applied main's migrations.
- Environment: the shell profile exports `SUPABASE_DB_URL` on port 54322, overriding this worktree's `.env.local` (58145). DB gates and `@carbon/database` tests need `SUPABASE_DB_URL` from `.env.local`; with it, everything passes.
- Baseline: typecheck erp, mes, jobs, lib, database, documents, utils — all green. Tests: jobs 853 passed, database 82 passed, lib 44 passed.
- Task 5b: the plan's deno-check verify greps colour-coded output and always counts 0; ran with NO_COLOR=1 — 41 identical lines before/after. rental-posting tests 15/15.
- Task 18: nav entry omits `table: "salesInvoice"` (it would list the saved views twice). Known limit: the sidebar highlights by pathname, so Sales Invoices stays highlighted on the filtered page.
- Task 13: named the notification validator/service/intent source-agnostically (`invoiceNotificationValidator`, `updateInvoiceNotificationSetting`, intent `invoiceNotifications`) per grill U1 — the group is company-wide for every recurring source. Added labels "When an invoice is created" / "Email".
- Task 11: `body` reaches the topbar only through `description` ("Recurring invoicing: 2 posted, …"); defaults copied from Workflow's [InApp, Email] (no Sales event sends email by default). notify logs a 'not digest-capable' note when documentIds has >1 entry — harmless.
- Task 7: prop types derived via `Parameters<typeof SalesInvoicePDF>[0]` (documents exports none); renders by calling `SalesInvoicePDF(props)` (no JSX toolchain in @carbon/lib); the salesInvoices read is also scoped by companyId (service-role callers).
