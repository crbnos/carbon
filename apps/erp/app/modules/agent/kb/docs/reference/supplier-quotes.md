# Supplier quotes

> A supplier's priced response to your RFQ, one per supplier, ready to convert into a purchase order.

A **supplier quote** is a vendor's priced answer to a purchasing RFQ: for the items you asked about, at the quantities you named, here's my price, my lead time, and my shipping. It's the buy side of a quote, and it is not a sales quote. A sales quote is what *you* send a customer; a supplier quote is what a *supplier* sends *you*.

You keep one quote per supplier per exchange, and once you've compared them you convert the winner into a purchase order. Converting also writes the supplier's prices back onto the item's supplier part, so the next order already knows what this vendor charges.

## Where a quote comes from

Most quotes are the response half of an RFQ. You send a purchasing RFQ to several suppliers, and each supplier's reply becomes its own supplier quote, all hanging off the same request. A quote can also be entered directly, without a preceding RFQ, when you already have pricing to record.

Either way the quote lives under a **supplier interaction**, the umbrella record that ties this supplier's quote, RFQ, and any resulting purchase order together so you can trace the whole exchange in one place.

A supplier quote is single-supplier by design. When you fan an RFQ out to five vendors you get five quotes back, not one quote with five columns. The side-by-side comparison is a separate view that reads across the sibling quotes, not a field on any one of them.

## Lines and pricing

A quote line names one item (or a G/L account line for non-stock spend) and the quantities you're pricing. Because you usually ask for a price at several volumes, the line's requested quantities are an **array**, and each quantity carries its own price row. This is the quantity-break table: a lead time, a unit price, and a shipping cost per quantity.

  - **Item**: The part, material, tool, consumable, or service being priced. A `G/L Account` line prices non-stock spend instead.
  - **Quantity**: The quantities you're asking the supplier to price. Each one gets its own price row.
  - **Unit price**: The supplier's price at that quantity, in the supplier's currency. `unitPrice` in your base currency is derived from the exchange rate.
  - **Lead time**: Days to deliver at that quantity.
  - **Shipping cost**: Per-unit shipping at that quantity, in the supplier's currency.
  - **Conversion factor**: Inventory units per one purchase unit, when the supplier sells in a different unit than you stock in.

The unit price, shipping, and extended price you type are the supplier's numbers, in the supplier's currency. Carbon stores the base-currency equivalents as generated columns using the quote's exchange rate, so the comparison and the resulting purchase order are always in your currency. Change the header exchange rate and every price row re-derives.

## Lifecycle

A quote is editable only while it's a **"Draft"**. Finalizing moves it to **"Active"**, which is the state comparison and conversion read from. Everything past Draft is locked.

  - **Draft**: Being built. The only editable state: you can add lines, enter prices, and adjust dates here.
  - **Active**: Finalized. Locked, and the state the comparison and convert-to-order flows read.
  - **Expired**: Past its expiration date. Pricing is no longer trustworthy.
  - **Declined**: The supplier declined to quote.
  - **Cancelled**: Withdrawn before it went anywhere.

Any status other than Draft locks the quote. If a supplier revises their pricing after you've finalized, you record the new numbers on a fresh quote rather than editing the old one, which keeps the paper trail intact for the comparison.

## From quote to purchase order

When you've picked a winning quote, **"Convert to Order"** turns it into a purchase order. You choose which lines and which quantity tier to buy, and Carbon raises a purchase order for that supplier with the item lines, the supplier's contact and location, and the exchange rate all carried across from the quote. If the quote came from an RFQ, the new order is linked back to that RFQ.

Converting does one more thing that matters: it updates the item's **supplier part**. For each converted line Carbon writes the quantity-break prices onto that supplier's `supplierPart` for the item (source: `Purchase Order`), and sets the supplier part's headline unit price to the best tier. So the quote doesn't just produce one order, it teaches Carbon what this vendor charges for the part going forward.

The quantity-break prices land on the supplier part in *inventory* units: the supplier's per-purchase-unit price is divided by both the exchange rate and the conversion factor before it's stored. That's why a quote in another currency, in the supplier's pack size, still shows a sensible per-stock-unit cost afterward.

For the full narrative, from sending the RFQ through comparing quotes to raising the order, see the `guides/rfq-to-po`. For what happens to the order once it exists, see `docs/reference/purchase-orders`.

## Troubleshooting

Exact errors and gates for supplier quotes, finalizing, and converting to a purchase order.

### "Expiration date must be today or after"
The quote's expiration date is in the past. Set it to today or a future date.

### "Supplier contact is required for email"
Finalizing with the notification method set to `Email` but no supplier contact selected. Pick a supplier contact, or change the notification method.

### "Cannot convert to order: supplier is not approved (Active)"
Your company requires supplier approval, and this supplier's status isn't `Active`. Approve the supplier (set them to Active) before converting the quote, or the Convert to Order action stays blocked.

### "Failed to convert quote to order"
The convert edge function returned an error. Common underlying causes: the quote or its lines were not found, or required supplier payment/shipping records are missing. Confirm the quote has lines and the supplier's payment and shipping terms are set, then retry.

### Why is the quote read-only / why can't I edit lines?
A supplier quote is editable only while its status is `Draft`. Any other status (`Active`, `Expired`, `Declined`, `Cancelled`) locks it. Record revised pricing on a fresh quote rather than editing a finalized one.

### Why is the Finalize or Send button disabled?
Finalize/Send require the purchasing update permission and at least one line on the quote. Send is also disabled once the quote is already `Active`. Delete additionally requires the purchasing delete permission, an unlocked (Draft) quote, and an employee login.
