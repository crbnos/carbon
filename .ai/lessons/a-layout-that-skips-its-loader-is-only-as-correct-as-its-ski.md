---
paths: ["apps/*/app/routes/**/_layout.tsx", "packages/utils/src/revalidate.ts"]
triggers: ["export const shouldRevalidate"]
promoted: null
---
# A layout that skips its loader is only as correct as its skip rule

**Context:** 186 layouts exported `shouldRevalidate` and skipped a GET navigation that left their params unchanged (`isUnaffectedByNavigation`, 2026-10-01), to save a layout loader run on each click.

**Problem:** The rule inferred "nothing changed" from `formMethod`. React Router passes a fetcher's submission to the first navigation after it only, so a delete that redirected to a record's bare URL, whose index route redirects again, arrived as a plain navigation and every layout kept its data (2026-10-06). An earlier patch had fixed the same blind spot for a revalidation restarting a navigation. 154 of the 186 layouts also declared no realtime tables, so another user's change did not show until the record changed. A module-level "a save happened" flag closed the redirect case and was rejected: one package set it, another cleared it, a third read it.

**Rule:** Layouts do not skip their loaders. Do not export `shouldRevalidate` from a layout to save a loader run; make the loader cheaper instead (one query, the direct connection, shared work through middleware context). The root and the app shell are the only exceptions. To see which loaders a navigation asked for, read the `_routes` query of its `.data` request. Estimated cost of removing the skip, from production traces: 100 to 300 ms on a click that used to skip, until the dozen slow record loaders are optimised.

**Applies to:** every layout route; `packages/utils/src/revalidate.ts`; the record loaders (`purchase-order+/$orderId`, `supplier+/$supplierId`, `sales-invoice+/$invoiceId`, `part+/$itemId`, `sales-order+/$orderId`, `quote+/$quoteId`).
