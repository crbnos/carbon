# External sharing

> How Carbon's private, login-free links work — a customer accepts a quote, a supplier prices a request or answers a SCAR, a buyer watches order status.

Some of Carbon's work happens with people who don't have a Carbon login. Rather than email a PDF and wait, Carbon hands them a **private link** to a single, live document: open it and you act right there in the browser — no account, no password, just the one record the link points at. The link is the only credential, so guard it like a password: whoever holds the URL gets in.

Four things reach an outside party this way. Each is documented where the feature lives:

  - Digital quotes A **"Sent"** quote the customer accepts or rejects.
  - Supplier quotes A request the supplier prices and submits, line by line.
  - Customer portal A standing, read-only view of a customer's orders and shop-floor progress.
  - SCARs A supplier corrective action request the supplier responds to.

Each link is only as live as the record behind it: an expired or answered quote turns its page read-only, and a closed issue locks its SCAR. There is no separate link-revocation step to remember.

Two other pages *look* shared but aren't: the RFQ preview is an internal view of how a supplier's request will look (purchasing login required), and training assignments require an employee login. Neither hands anything to an outside party.
