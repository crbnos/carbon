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
- Task 14: Select uses a "default" sentinel (Radix refuses an empty item value), sent as "" → null. "Post and email" is filtered out (form Select has no disabled option) with the helper text. Route validates with safeParse (plain object). `types.ts` gains `contactEmail`. The $id.tsx / types.ts hunks for Task 16 are committed with Task 14 (shared files).
- Task 9 (deviations, all in `packages/jobs/src/invoicing/automate-invoice.ts`):
  - The no-email message lives in the shared layer as `INVOICE_SEND_NO_EMAIL` (grill U1: send/hold layer is source-agnostic); `RENTAL_SEND_NO_EMAIL` removed from the planner.
  - `emailPostedInvoice` reads `company.companyGroupId` itself (no `companyGroupId` arg), as Task 10 already said.
  - `sendEmail` returning `{ data: null, error: null }` (no SMTP transport) stamps `sendError` "Email sending is not configured" rather than `sentAt` — nothing was sent.
  - The PDF renders with `SUPABASE_INTERNAL_URL` logos (server fetch), but the email HTML swaps them for `SUPABASE_URL` — the recipient's mail client cannot reach an internal URL.
  - Any load/render/upload failure in the email step stamps `sendError` (the invoice shows "Not sent" in Needs Review) instead of throwing.
  - Party-contact check uses `salesInvoice.customerId`, mirroring the manual post route exactly.
  - Tests follow the ramp-sync-bill precedent (stateful fake rows) and assert on outcomes/stored rows, per testing-no-mock-theater; 14 (12 behavioural + 2 pure header helpers).
- Task 12: email body now spreads the loader's `email` (same sources as the old reads); kept the route's existing timestamped file name; early returns (missing contact/seller) don't stamp sendError.
- Task 17: badges use Status's `tooltip` prop (`title` would add a native tooltip). "Posted" = postingDate set and not Voided, as the header already reads it.
- Task 10: digest results are keyed by `sourceId` (source-agnostic, U4). "N posted" counts every invoice that was posted (emailed and unsent included); Draft Only drafts are not reported; an invoice whose automation step threw is reported as needing review. 5 digest tests (plan's 4 + 'links posted invoices when nothing needs review').
- Task 19:
  - lint, license headers (0 to fix), MCP digest current. Typecheck erp/mes/jobs/lib/database/notifications green. Tests: database 94, jobs 872, lib 68, checks 250 — all pass.
  - Conformance gate (`@carbon/checks` run.test) had 2 new findings: `Math.round` file size in automate-invoice.ts (baselined, like its file-size siblings) and merge fallout — main's new `index-redirect-before-loaders` check vs the branch's `rental-agreement+/$id._index.tsx` (fixed with `redirectBeforeLoaders`).
  - Translations: /translate filled 3,900 strings (325 × 12 locales; erp + mes, mostly strings already pending on the branch, not only this plan's). linguito check exit 0; glossary check exit 0 (advisory hits only). Two zh/ko strings written by hand after round 1.
  - PRE-EXISTING, out of scope: `apps/erp/app/routes/x+/payments+/payment-refund.test.ts` fails (erp: 1 file, 135 pass). Merge fallout: main's module-level `SUPABASE_URL` in settings.service.ts vs the branch's DocumentPage import; with that mocked the loader still redirects because the branch's DocumentPage rewrite of `$paymentId.tsx` (ef532cb35f, before this plan) added reads the test doesn't mock. Not fixed.
