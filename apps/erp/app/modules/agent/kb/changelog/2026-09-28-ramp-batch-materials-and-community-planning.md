# Ramp card transactions, batch materials, and a larger community edition

> Ramp card spend and AP flow into the ledger, batches share materials and plan their output lots, quotes predict lead time from the real schedule, and planning, the configurator, and accounting join the community edition.

Carbon can now act as Ramp's accounting provider. Connect the integration and Carbon pushes its chart of accounts and cost centers to Ramp, then pulls card transactions, transfers, cashbacks, repayments, bills, reimbursements, and payments back. Card spend arrives as a new card transaction document (Draft, Posted, or Voided) that posts into the general ledger. Bills and payments flow through accounts payable, and Carbon's purchase orders and posted invoices go out to Ramp for bill matching. Sync Activity shows every record's outcome, and the integration panel reports its health.

## Batches share materials and plan their output

The second half of `docs/reference/batching`. Issuing a lot-tracked material to a batch splits it across the member jobs in proportion to what each still needs: one trip to the shelf, one consumption record per job. Output lots are planned when the batch is built, either one per member or a single combined lot, so the operator never types a lot number at completion, and a combined batch's lots are merged as soon as it completes. Operations can be removed from a batch in its drawer, and batch views show the item each operation produces rather than the job's top-level part. Jobs are still never merged: costing and genealogy stay per job throughout.

## A larger community edition

Material planning (MRP and the finite scheduler), the configurator rules engine, and accounting are now part of the community edition under AGPLv3. Every commercial feature's code now lives in one place, `packages/ee`, so the boundary between the editions is the boundary in the source tree, and the licensing docs name the two editions CE and EE throughout.

## Quotes predict lead time from the schedule

A **Predict** button on the quote line pricing grid runs the line's routing through the finite scheduler without saving anything and answers for every quantity break: **End of queue** behind released work, **Best case** with open jobs excluded, or against a **Target date**, telling you whether the line lands on time, only by expediting, or not even then. Quantity breaks now sort smallest to largest in the form, the grid, and the `docs/reference/quotes` PDF.

## Demo data for everyone

Every new signup now gets the "How would you like to start?" step in `docs/reference/onboarding` and can begin with an industry demo company instead of an empty one. The demo data fills every major ERP and MES screen, with documents in every status a user can reach, posted documents carry the ledger entries and stock movements real posting would create, and planning and scheduling run right after the data lands so the shop floor is scheduled, not blank.

- The 3D assembly viewer can see past parts that are already fitted, with four named views (**Build**, **Focus**, **Isolate**, and **Full**) in both the ERP assembly editor and the MES shop-floor screen.
- Each company's files now live in their own storage bucket. Backups restored into a different company come back whole: items keep their part numbers and 3D assemblies load.
- Default accounts can be exported as CSV.
- The Bill of Process preview shows pin labels and tool descriptions.
- Login pages on Carbon Cloud use Vercel BotID for bot protection. Self-hosted instances choose between BotID and Turnstile with `BOT_PROTECTION`.
- Self-hosted: setting `ADMIN_EMAIL` seeds the instance admin's account on a fresh install, and the first admin of an empty instance can reach onboarding.
- Security hardening: tenant scoping on every path that does not go through row-level security, webhook and OAuth verification that fails closed, hashed MES console PINs (operators pin in again once after the deploy), uploaded SVG and HTML served as downloads, and cross-site request forgery protection with a report-only content security policy.
- Page headlines are set in Hedvig Letters Serif.
- The item sales rules card moved to the Sales tab, and unit of measure is editable on consumables and tools.

- Completing a job completes its operation quantities, and estimates vs. actual shows the real completed quantity.
- Completing a serial job from the desk no longer asks for serial numbers it already has.
- A forced logout now says why instead of failing silently.
- Tracked lots keep their quantities honest: values are rounded when stored so float residue never reaches the ledger, stock-transfer picks are idempotent, adjustments and counts can no longer leave a zero or negative Available lot, and the MES Complete Batch grid accepts decimals.
- A receipt's batch-tracking status settles with its quantity, and the stock transfer wizard shows negative storage-unit balances instead of hiding them.
- The item planning chart includes demand projections.
- Large backup uploads no longer fail with Request Entity Too Large.
- MES operation cards open again for companies with a copied twin, and batch numbers are searchable on the shop-floor board.
- Material edits made over MCP save and follow the properties panel's rules.
