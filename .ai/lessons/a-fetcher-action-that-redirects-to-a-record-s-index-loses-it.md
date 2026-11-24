---
paths: ["apps/erp/app/routes/x+/purchase-order+/*.tsx"]
triggers: ["path.to.purchaseOrder(", "rootShouldRevalidate"]
promoted: null
---
# A fetcher action that redirects to a record's index loses its toast

**Context:** The purchase order force-delete modal posts through a fetcher, and the
action redirected to `path.to.purchaseOrder(id)` with a flash.

**Problem:** That index route redirects again, to `/details`, in its middleware. The
second hop is a plain GET to the path the form was already on, so
`rootShouldRevalidate` reads it as a search-param-only navigation and skips the
root loader. The flash is never read: no toast, and it surfaces later on an
unrelated page.

**Rule:** Redirect an action straight to the page that renders the record
(`path.to.purchaseOrderDetails(id)`), never to an index that redirects again.

**Applies to:** Any action whose redirect target is a `$id._index.tsx` that
redirects (purchase orders, and the other records with a `/details` index).
