# Returns, operation batching, and the Carbon API

> Customer RMAs and supplier returns, job operations that run as one batch across ERP and MES, every service operation reachable over plain HTTP, and keyboard shortcuts everywhere.

Returns now have a home of their own. A `docs/reference/rmas` authorizes what a customer may send back. Its lines can point at the sales order, shipment, or invoice lines they reverse, and the picker only offers quantities that have actually shipped and have not already been authorized. Receiving an RMA goes through the same receipts flow as a purchase order, and a customizable PDF is generated when the RMA is confirmed. `docs/reference/supplier-returns` work the other way round: send received goods back to a supplier, keeping serial or batch identity, claim the credit, and raise a replacement purchase order.

## Job operation batching

Operations from several jobs can now run together as one `docs/reference/batching`: a heat-treat load, a plating tank, an oven cycle. Mark a process as batchable, say whether members run sequentially or simultaneously, and set compatibility rules and a work-center capacity limit. Batches are created, reviewed, released, moved, and dissolved from the Batches list, which also has a bulk "Release N batches" action. Each batch prints a load sheet and appears collapsed on the schedule boards, the job lists, and the MES operation view. Releasing a batch schedules it as a single capacity reservation, and completing it shares one timer across its members with time and cost allocated proportionally.

## The Carbon API

All 1,481 of Carbon's service operations are now reachable at `POST /api/v1/{module}/{operation}`, with an OpenAPI 3 spec at `/api/v1/openapi.json`. The [API docs](/api) have been rebuilt around it. The MCP server, the in-app agent, and workflow actions all run through this same layer now, so the per-operation scope check on an API key is enforced once, the same way, for every caller.

## Keyboard shortcuts everywhere

Press `?` on any page to see every shortcut available there. Save any form with Cmd+Enter (Ctrl+Enter on Windows), press `n` to add a record on a list page, `g` then a letter to jump to a module, and Space to start or pause an operation on the shop floor. Buttons show a small keycap badge for their shortcut, with the right symbol for your platform.

- `docs/reference/import-export` for quotes (whole quotes with lines, headers only, or lines added to existing quotes), plus six new import types: services, units of measure, item groups, storage types, scrap reasons, and departments. The BOM export now includes item attributes, the parts export is importable as-is, and leaving an import in progress asks before discarding it.
- A **Transfer** `docs/reference/kanban` type alongside Buy and Make: scanning it creates a stock transfer from one storage unit to another for the kanban's quantity.
- Early-payment discounts post as a reduction of revenue for customers and a reduction of cost for suppliers, rather than as an operating expense, the same way a credit memo already did.
- The Rillet integration can import customers and vendors, so an invoice raised in Carbon updates the existing Rillet record instead of creating a second one. The Stripe Connect panel now walks through setup.
- Supplier and customer records gained a Documents tab, for files that belong to the company itself rather than to any one order, and a Bank Accounts tab whose fields adapt to the country (IBAN for France, IFSC plus SWIFT for India) with checksum validation.
- `docs/reference/sales-rules`: if-this-then-block-or-warn rules that fire when an item is added to a quote, sales order, or invoice line, built on the same engine as storage rules.
- Item supersession's **Consume First** mode now runs end to end. Job creation, planning, picking, and consumption all agree on the old part's stock, a unit never mixes old and new parts, and you can add a predecessor from the successor's side. A supersession loop is refused instead of silently dropping both rules.
- An ability is now created from a process and takes its name from it, so renaming the process renames the qualification.
- The Bill of Process preview shows every step's slides, with annotation pins aligned to the image.
- Photos taken on an iPhone are converted from HEIC to JPEG at upload, and every image upload runs through one shared pipeline.
- MCP tools can attach files to jobs, items, opportunities, and supplier interactions.
- Self-hosted: app email is sent over SMTP using the same `SMTP_*` variables Supabase Auth uses. An existing Resend key keeps working as a fallback.
- Carbon Cloud: self-signup from free or disposable email domains is declined, whether by email or through Google and Outlook sign-in.
- Pages load faster. The translation catalog is served as a cached static chunk, and the app shell no longer downloads whole tables in the browser.

- Sales orders report the amount actually paid: voided invoices are excluded and partial payments count.
- Paperless Parts webhooks are verified against the raw request body, and their errors are logged instead of swallowed.
- Saving one integration secret no longer wipes the others.
- A unit of measure that is still in use can no longer be deleted.
- Completing a serial job receives exactly the quantity completed, and the outside-operation supplier is resolved from the process when a job is released.
- Issue disposition quantities are editable, and changing an issue task's status or assignee requires the quality permission.
- Re-inviting a user whose invitation was revoked works again, and a permission failure now shows an error instead of doing nothing.
- Forecast rows are labelled by part rather than operation description, and an existing purchase order line is no longer listed twice in the supply and demand card.
- Onshape sync uses the exact released part identity, and legacy invoice settlements without a document principal read correctly.
