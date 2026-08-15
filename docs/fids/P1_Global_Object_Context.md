# P1 Global Object Context

P1 reserves a global object-context slot in the canonical navigation bar. It
renders `Object: none selected` until a future route supplies a validated object
reference.

No object is inferred from the current pathname, company, breadcrumbs, or
dashboard cards. P1 does not implement Object 360 or cross-domain object joins.
The slot is deliberately an empty contract boundary for the P2 Production Order
360 implementation.
