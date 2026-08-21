# Purchasing

> Shop the McMaster-Carr catalog with your account pricing and exchange cXML documents from Carbon.

## McMaster-Carr

Buy from McMaster-Carr without leaving Carbon. The integration does two things over
[cXML](https://en.wikipedia.org/wiki/CXML): a **Level-1 punchout** that lets you shop McMaster's
catalog with your account pricing and bring the cart back as a draft purchase order,
and a **document exchange** that swaps purchase orders, order confirmations, ship notices, and
invoices server-to-server. Confirmations update your promised dates automatically, ship notices
attach tracking numbers, and invoices are held for a person to review.

The supplier-neutral cXML core is shared, so a second punchout supplier is a matter of
configuration rather than new protocol code. Today the one shipping supplier is McMaster-Carr.

## Set up the connection

McMaster-Carr provisions punchout during a **~30-day onboarding**. Email
**eProcurement@mcmaster.com** from the account holder with your McMaster account number to start.
McMaster issues separate **punchout** and **order-posting** URLs plus your shared secrets.

Turning on punchout changes your McMaster payment options, credit card versus AP billing. Confirm
the payment model with your McMaster rep before you switch it on.

  
  ### Start onboarding with McMaster

  Email eProcurement@mcmaster.com from the account holder. About 30 days later McMaster sends your
  punchout URL, order-posting URLs (test and production), the sender and receiver identities, and
  two shared secrets.
  
  
  ### Fill in the integration settings

  Pick the Carbon supplier that represents McMaster-Carr, paste the URLs and identities, and store
  both shared secrets (below). The secrets are encrypted in the vault, so an empty secret field on a
  later save keeps the one already stored.
  
  
  ### Give McMaster your webhook URL

  Carbon shows a webhook URL of the form `https://your-carbon-origin/api/webhook/mcmaster-carr/<companyId>`.
  Give it to McMaster for order confirmations, ship notices, and invoices, and allow-list your Carbon
  origin as the punchout return (BrowserFormPost) origin.
  

  - **Supplier**: Which Carbon supplier is McMaster-Carr. This is the supplier the shop button and cXML documents map to.
  - **Environment**: **Test** or **Production**. Selects which order URL Carbon posts to. Defaults to **Test**.
  - **Punchout URL**: The `PunchOutSetupRequest` endpoint from your onboarding packet.
  - **Order URL (Test)**: Where cXML `OrderRequest` documents post in the Test environment.
  - **Order URL (Production)**: Where cXML `OrderRequest` documents post in Production.
  - **From/Sender Identity (NetworkID)**: Your sender identity on outbound cXML.
  - **From/Sender Domain**: The domain qualifying the sender identity. Defaults to `NetworkID`.
  - **To Identity**: McMaster's receiver identity. Defaults to McMaster's DUNS number.
  - **To Domain**: The domain qualifying the receiver identity. Defaults to `DUNS`.
  - **Shared Secret**: The **outbound** credential, signing the punchout setup and `OrderRequest`. Stored as an encrypted secret.
  - **Inbound Shared Secret**: Verifies the confirmations, ship notices, and invoices McMaster posts back to your webhook. Stored as an encrypted secret.
  - **Default expense account for unmatched items**: The G/L account a cart line posts to when no supplier part matches it (below).

## Shop the catalog

From the **Purchase Orders** list, or from a draft purchase order for the mapped supplier, click
**"Add from McMaster-Carr"**. Carbon opens McMaster in a popup where you shop with your account
pricing. Check out there and your cart comes back to Carbon as a **draft purchase order**, a fresh
one, or appended to the draft you started from.

Carbon resolves each cart line against your supplier part
cross-references for that supplier:

| Cart line | Becomes |
| --- | --- |
| A supplier part matches the McMaster part number (case-insensitive) | A **Part** line, carrying that cross-reference's unit of measure and conversion factor. |
| Nothing matches | A **G/L Account** line posted to the configured default expense account, keeping the McMaster description. The McMaster part number still rides the line. |

A cart line's McMaster tax and shipping are estimates, so Carbon does not write them onto the
purchase order. If the cart uses a unit of measure your company doesn't have, the line falls back to
**EA** and records an issue so you can fix it. Prices pass through as shopped.

## Inbound documents

Once you send a purchase order (below), McMaster posts documents back to your webhook. Some apply
themselves; invoices wait for a person.

| Document | What Carbon does |
| --- | --- |
| **Order confirmation** | Applied automatically. Carbon records McMaster's order number as the supplier reference, sets each line's promised date, and sets the delivery's promised receipt date to the earliest of them. Recorded **"Posted"**. |
| **Ship notice** | Applied automatically. Carbon attaches the tracking number to the delivery, last one wins. Recorded **"Posted"**. |
| **Invoice / credit memo** | Held at **"Needs Review"**, never applied automatically. One click on **"Create invoice"** builds a **draft** purchase invoice you post yourself. |

Everything McMaster sends lands in **Purchasing → Documents**, the cXML document queue. Open a row
for its detail drawer: the parsed payload, any issues Carbon flagged, the linked purchase order, and
the actions that apply to it, **Create invoice**, **Reject**, or **Resend**.

## Send a purchase order

When you finalize a purchase order for the mapped supplier, the **"Send Via"** choice offers
**"Send via cXML to McMaster-Carr"**. Choosing it transmits the order to McMaster as a cXML
`OrderRequest`, server-to-server through a background job, and records it as an **Outbound** document
that reads **"Sent"** or **"Failed"**. A failed send exposes a **Resend** action in the document
drawer.

McMaster ships the **same or next day**. Cancelling a purchase order in Carbon does **not** cancel
the order with McMaster. To cancel, call McMaster directly.

## Related

  - Purchase orders The document a shopped cart becomes, and what you send back over cXML.
  - Invoices Where a reviewed McMaster invoice becomes a draft purchase invoice.
  - Suppliers The supplier record you map McMaster-Carr to, and its supplier parts.
