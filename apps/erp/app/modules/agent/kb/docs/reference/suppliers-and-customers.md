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

Both records carry the same satellite shape: **contacts**, **locations/addresses**, and **payment, shipping, and tax** defaults. Payment terms, currency, and tax settings live on those satellites, not on the core record. Both also have a human-readable id (`SUP…` / `CUS…`) on top of their internal key, and both can expose an external **portal**: suppliers respond to RFQs through a digital-quote link; customers track their orders through a `docs/reference/customer-portal`.

## Bank accounts

Both parties can carry bank accounts: the account you pay a supplier into, and the one you refund a customer to. They live on the **Bank Accounts** tab of the record, and they are reference data. Nothing in Carbon moves money from them; a person reads the details and enters them in their own banking system.

The fields adapt to the account's country, because banking identifiers are not the same everywhere. Pick France and the account field is labelled **"IBAN"** with no routing field, since an IBAN already identifies the bank. Pick India and you get an **"IFSC Code"** field plus a required SWIFT / BIC, because one routes the payment inside the country and the other gets it there.

  - **Name**: Your label for the account, so two accounts at one bank stay distinguishable.
  - **Account Holder**: Only needed when it differs from the party's own name.
  - **Bank Name**: The bank the account sits with.
  - **Bank Address**: Printed onto payment files; correspondent banks route international wires on it.
  - **Country**: Selects which validation rules apply to everything below.
  - **Currency**: The currency the account settles in.
  - **Account Number / IBAN**: Labelled by country. Validated by checksum where the scheme has one.
  - **Routing code**: Named for the country: *Routing Number (ABA)*, *Sort Code*, *BSB*, *IFSC Code*, or *Transit & Institution*. Absent for countries whose IBAN carries it.
  - **SWIFT / BIC**: Required wherever the country expects a cross-border payment to route.
  - **Notes**: Free text for anything the fixed fields do not cover.

Most people who can open a supplier should not see its bank account, so the tab is gated on **accounting** rather than the module that owns the record. Without `accounting` view permission the tab does not appear in the sidebar, and opening its URL directly is refused. Adding, editing, and deleting are gated separately.

Account numbers display masked, showing the last four characters with a toggle to reveal the rest. That deters someone reading over your shoulder or catching it in a screenshot; it is not an access control, and the permission above is what actually protects the data.

A checksum confirms an IBAN was typed correctly. It cannot tell you the account belongs to the supplier you think it does. Confirming that is an out-of-band step, a call to a number you already had, and it is the control that stops payment-redirection fraud.

## Documents

Both records have a **Documents** tab for files that belong to the party itself rather than to one transaction: a W-9, an insurance certificate, a signed master agreement. Drop a file on the tab and it is filed against that record, and it also appears in the shared `docs/reference/documents`, so you can find it either by opening the party or by searching.

## Related

  - Quote to cash How a customer's quote becomes an order.
  - RFQ to bill How a supplier quote becomes a purchase order.
  - Approvals A new supplier can be held at Pending until approved.

## Troubleshooting

### "Cannot edit a protected customer type" / "Cannot edit a protected supplier type"
System-defined types are protected and can't be renamed or deleted. Create a new custom type instead and assign parties to it.

### The purchase order's Finalize button is greyed out
When supplier approval is required, a purchase order can't be finalized while its supplier's status isn't **Active** (it's *Pending*, *Inactive*, or *Rejected*). This is enforced as a disabled button, not an error message. Approve or activate the supplier, then finalize the order — see `docs/reference/purchase-orders`.
