# Suppliers & customers

> The parties you buy from and sell to, and the ways their records differ.

**Suppliers** and **customers** are the two trading parties. They look symmetrical, but Carbon models them through different modules with a few deliberate differences worth knowing.

## Suppliers

A supplier lives in purchasing and anchors the buy side: purchase orders, supplier quotes, and bills all reference it. Its **status** is a fixed set: *Active*, *Inactive*, *Pending*, *Rejected*. A supplier links to the items you buy through **supplier parts**, each carrying the supplier's own part number, a minimum order quantity, and a conversion factor from their pack to your stock unit.

A supplier part has **no lead time** — purchasing lead time is set per item, not per supplier-part. The supplier part is about identity and pack size, not delivery time.

## Customers

A customer lives in sales and anchors the sell side: quotes, orders, and invoices reference it. Unlike supplier status, **customer status is a configurable list** you define, not a fixed enum. Customers don't have a supplier-part analog; pricing instead comes from **price overrides** and **pricing rules**, which can target a whole customer type and stack with quantity breaks.

The asymmetry to remember: **supplier status is a fixed four-value set; customer status is a company-configurable lookup.** Their type catalogs (supplier type, customer type) are both user-defined.

## What they share

Both records carry the same satellite shape: **contacts**, **locations/addresses**, and **payment, shipping, and tax** defaults. Payment terms, currency, and tax settings live on those satellites, not on the core record. Both also have a human-readable id (`SUP…` / `CUS…`) on top of their internal key, and both can expose an external **portal**: suppliers respond to RFQs through a digital-quote link; customers track their orders through a customer portal.

## Related

  - Quote to cash How a customer's quote becomes an order.
  - RFQ to bill How a supplier quote becomes a purchase order.
  - Approvals A new supplier can be held at Pending until approved.

## Troubleshooting

### "Cannot edit a protected customer type" / "Cannot edit a protected supplier type"
System-defined types are protected and can't be renamed or deleted. Create a new custom type instead and assign parties to it.

### "Cannot finalize: supplier is not approved (Active)"
Raised when finalizing a purchase order for a supplier whose status isn't **Active** (it's *Pending*, *Inactive*, or *Rejected*). Approve/activate the supplier, then finalize the order — see `docs/reference/purchase-orders`.
