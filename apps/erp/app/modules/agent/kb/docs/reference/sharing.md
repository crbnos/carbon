# External sharing and portals

> Private, login-free links that let a customer accept a quote, a supplier price an RFQ or answer a SCAR, and a buyer watch order status, all without a Carbon account.

Some of Carbon's work happens with people who don't have a Carbon login: the customer deciding whether to accept a quote, the supplier pricing your request, the buyer wondering where their order is. Rather than email a PDF and wait, Carbon hands each of them a **private link** to a single, live document. Open it and you act right there in the browser: no account, no password, just the one record the link points at.

Every one of these links resolves through an `externalLink` row. Sending a shareable document creates that row and stamps its id into the source record (`quote.externalLinkId`, `supplierQuote.externalLinkId`, and so on); the link you copy is `/share/<type>/<externalLinkId>`. The public page loads with a service-role client and no permission check, so anyone with the link gets in. Guard the link like a password: possession is the only credential.

## What can be shared

Four things reach an outside party through a public link. Each maps to an `externalLinkDocumentType` value and a `/share/...` route.

  - **Digital quote**: A **"Sent"** quote a customer can accept or reject. `documentType` **"Quote"**.
  - **Supplier quote**: An RFQ a supplier prices and submits. `documentType` **"SupplierQuote"**.
  - **Customer portal**: A live view of a customer's open orders and their shop-floor progress. `documentType` **"Customer"**. 
  - **SCAR**: A supplier corrective action request the supplier responds to. `documentType` **"Non-Conformance Supplier"**.

Two other routes live under `/share/` but are **not** public links, so they don't belong on this list. `/share/purchasing-rfq/:id` is an internal *preview* of how a supplier's request will look, gated by `requirePermissions` with purchasing view. `/share/training/:id` is an internal training assignment that requires an employee login. Neither hands anything to an outside party.

The public share pages skip authentication and load with a service-role client keyed on the `externalLinkId`. There is no password and no account behind the link, so whoever holds the URL can open the document. Send it to the right person, and don't post it anywhere public.

## Digital quotes

A **"Sent"** quote can be shared with the customer over its private link. The page shows the quote lines with images, the quantity-break pricing, the totals (subtotal, discount, tax, shipping), the shipping method and payment term, and any external notes. Internal notes are stripped before anything renders, so the customer never sees your working comments.

From that page the customer does one of two things. They **accept**, entering their name and email and optionally attaching a purchase-order PDF, and Carbon converts the quote straight to a sales order, stamping who accepted it. Or they **reject**, again with a name and email, and the quote moves to **"Lost"**. Line selection is per quantity break, so the customer can accept the tier they want.

Both actions are gated: the quote must be **"Sent"**. A quote that's already **"Ordered"**, **"Partial"**, **"Cancelled"**, or expired is read-only, its buttons gone. Expiry is automatic: once a **"Sent"** quote's `expirationDate` passes, the link shows an *expired* state and can no longer be accepted.

The `externalLink` row (and the quote's `externalLinkId`) is created when the quote is set up and again at finalization. The shareable URL is `/share/quote/<externalLinkId>`, surfaced in the quote's share dialog. See `docs/reference/quotes` for the quote lifecycle behind it.

## Supplier quotes

The mirror image, for the buy side. When you send a supplier quote, Carbon emails the supplier a link to `/share/supplier-quote/<externalLinkId>` along with the request. The supplier opens it with no login and prices the work directly on the page: for each quantity they choose, they enter a **unit price**, **lead time** in days, **shipping cost**, and **tax**, and can attach a note per line.

When every selected line has both a price and a lead time, the **"Submit Quote"** button lights up; the supplier enters their name and email and submits. They can instead **"Decline Quote"**, optionally leaving a reason. Both flows are open only while the quote is in **"Draft"**; once submitted or declined, the page is read-only. The link also expires: a **"Draft"** quote past its `expirationDate` shows the expired state. Each visit stamps `externalLink.lastAccessedAt`, so you can see whether the supplier has opened it.

`/share/purchasing-rfq/:id` is a preview for *your* team, showing how the request will look to a supplier with all the price cells blank. It requires a purchasing login and hands nothing to the supplier. The supplier-facing document is the supplier quote above. See `docs/reference/supplier-quotes` for the full flow.

## Customer portal

The customer portal is a **standing, read-only window** into a customer's work, not a one-document link. It's gated behind the `CUSTOMER_PORTALS` plan feature, so a company on a plan without it gets a 404. Where a digital quote is about closing one deal, the portal is about visibility after the deal: the buyer opens `/share/customer/<externalLinkId>` and watches their orders move.

The portal lists the customer's sales order lines with their status, the buyer and engineer contacts, order and due dates, part number and revision, quantity complete, quantity shipped, and per-operation job progress. There are no forms: the customer can look, not act. A splat route (`/share/customer/:id/*`) lets them download files attached to those job operations, rate-limited to ten downloads a minute per IP and scoped so the file must belong to that customer's own jobs.

A digital quote closes the sale; the customer portal is what the buyer watches afterward as the work proceeds. The two are the customer-facing bookends of an order.

## Supplier corrective action requests

When a supplier-caused defect needs the supplier to act, Carbon shares the corrective action externally as a SCAR (Supplier Corrective Action Request). The link points at `/share/scar/<externalLinkId>`, which resolves through the `externalLink` row to the underlying `docs/reference/issues` (a non-conformance) and its supplier.

The supplier sees the non-conformance details, the current status, the supplier's own name, and the list of **action tasks** assigned to them. For each task they can update the status and write notes in a rich-text editor that auto-saves as they type; entering notes on a **"Pending"** task promotes it to **"In Progress"** automatically. Once the parent issue is **"Closed"**, the record locks and the supplier can no longer make changes.

The SCAR shares the specific action tasks meant for the supplier, not the whole issue. The rest of the non-conformance workflow, dispositions, approvals, and closure stays internal. See `docs/reference/issues` for the action-task lifecycle that a SCAR plugs into.

## Troubleshooting

Exact messages and gates behind the public share links (digital quotes, supplier quotes, customer portal, SCAR).

### "This quote is no longer available for a response."
A customer tried to accept or reject a digital quote whose status is no longer `Sent` (it's already `Ordered`, `Partial`, `Cancelled`, or similar). Only a `Sent` quote can be answered — the accept/reject buttons are hidden once it leaves that state.

### "Oops! The link you're trying to access has expired or is no longer valid." (Quote expired)
A `Sent` quote (or a `Draft` supplier quote) is past its `expirationDate`, so the public page shows the expired state and can no longer be accepted or submitted. Re-send a fresh quote with a new expiration date; the old link stays expired.

### "Issue has been closed already. Unable to make changes"
A supplier tried to update a SCAR action task after the parent non-conformance issue was set to `Closed`. Once the issue is Closed the SCAR is read-only. Reopen the issue internally if further supplier action is needed.

### Why does the customer portal link show "Not found" / a 404?
The customer portal is gated behind the `CUSTOMER_PORTALS` plan feature (Business plan). A company without it gets a 404 on `/share/customer/…` (and a 403 on the file-download splat route). Upgrade the plan to enable the portal.

### Why is the supplier's "Submit Quote" button disabled?
Submit lights up only when every selected line has both a unit price and a lead time greater than zero, and only while the quote is in `Draft`. Fill in price and lead time for each selected quantity; once submitted or declined the page is read-only.

### Why did downloads from the customer portal start failing (HTTP 429)?
File downloads on the portal are rate-limited to ten per minute per IP. Wait a minute and retry; the limit is per requesting IP address, not per file.
