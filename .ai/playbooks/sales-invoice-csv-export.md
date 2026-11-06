# Sales invoice CSV export

Last tested: 2026-11-05
Route: /x/invoicing/sales

## Prerequisites
- Fix-branch ERP server with its migrations applied and local Inngest registered to that server.
- Existing local dev-bypass user with sales invoices. Restricted invoice-only access is covered by the SQL permission regression; do not change an existing user's permissions to test it.

## Steps
1. Sign in via the auth skill. Open Invoicing → Sales Invoices. Verify customer names and the row count.
2. Open Columns; enable Invoice Customer; close the dialog. Verify both name columns.
3. Search for one displayed invoice number. Verify exactly that invoice remains.
4. Click Download CSV. Even one row must show the background-export preparation toast.
5. Open Notifications. Wait for Your export is ready; click its link. Verify the CSV has one matching record and readable Customer and Invoice Customer values.
6. Search for a nonexistent value. Verify NO DATA EXISTS and no Download CSV button.
7. Clear the search; export again. Verify the CSV row count and order match the full list and both name columns match their customer records.

## Selector notes
- Notifications gains an unread-count suffix; match its accessible name by prefix.
- Invoice Customer is hidden by default; toggling it without saving a view lasts only for the current mounted table.
- Use the export-ready link directly. The built-in browser's download-event capture can stall independently of a successful HTTP200 download route.

## Setup notes
- An extra worktree sharing dependencies needs its generated PDF font bundle and shared config build available.
- Bind a temporary ERP server to IPv4 localhost, not IPv6-only localhost, so Docker Desktop's host proxy can reach it. Keep it restricted to loopback.
- Restore the original Inngest registration after testing.
