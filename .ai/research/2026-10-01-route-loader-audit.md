# Route loader audit — where the requests go

Date: 2026-10-01.
Trigger: one BOM click on `/x/part/:itemId/make/:makeMethodId.data` took 2.8 s in
production and fired ~68 PostgREST calls, about 10 of which belonged to the page.

## Status (same day)

Fixed in the same change:

- Both app shells re-run only after a mutation; the ERP shell streams the hub, changelog
  and audit-log flag; the MES shell loads in one wave.
- 186 UI layout loaders under `x+` export `shouldRevalidate` (10 by hand, 176 by codemod).
  The tables in B are the **before** picture.
- `companyPlan` is cached in Redis (60 s, cleared by the Stripe sync) and memoized per
  read request; the changelog entry is cached in Redis (5 min).
- Change notice layout: impact fan-out streams, per-item reads run in one wave, the two
  tag lists are read once instead of once per item.
- Independent serial reads parallelised in `settings+/billing`, `workflows+/runs.$runId`
  and both tracked-pick loaders.

Left open, with reasons, in "Left open" at the end.

## How this was measured

- **Static.** A script walked every file under `apps/erp/app/routes` and
  `apps/mes/app/routes` and read each `loader` body. "Reads" is the number of
  service-function calls (`get*`, `is*`, `find*`, …) plus direct `.from()` /
  `.rpc()` calls written **in the loader body**.
- **It undercounts.** A service function that fans out internally counts as one.
  `part+/$itemId.tsx` scores 14 here and issued about 40 requests in the Vercel log.
  Treat the numbers as a ranking, not a request count.
- **Runtime.** The two Vercel logs for the part route are the only measured data:
  first concurrent wave ~200 ms per call, later calls 30–60 ms, and 1.3–1.8 s per
  call under load.
- "Layout" means the route has child routes: a `_layout.tsx`, or `foo.tsx` with
  `foo.*.tsx` siblings.

## Headline facts

| Fact | Value |
|---|---|
| Route files (ERP / MES) | 1530 / 101 |
| Routes with a loader (ERP / MES) | 864 / 48 |
| Reads written directly in loaders | 2336 (median 1 per loader) |
| Loaders with 10+ reads / 5+ reads | 50 / 135 |
| Layout loaders | 215 |
| Layout loaders with no `shouldRevalidate` | 196 |
| `requirePermissions` call sites in routes | 1839 — one per loader. Claims and the Supabase client are already memoized per read request (`oncePerRead` / `oncePerRequest` in `@carbon/logger`), so this costs a session parse each, not a Redis read each |
| Loaders with 3+ serial awaits and no `Promise.all` | 52 |
| Loaders that await inside a loop | 15 |
| ERP `api+` loaders / with a `clientLoader` cache | 157 / 27 |
| `count: "exact"` in service queries | 154 |
| `select("*")` in service queries | 480 |

## A. Why every ancestor re-runs

React Router 7.18 single fetch passes `defaultShouldRevalidate = true` on every GET
navigation (`singleFetchLoaderNavigationStrategy`). A reused ancestor loader re-runs
unless its route exports `shouldRevalidate`.

| Loader | Reads | Before this branch | Now |
|---|---|---|---|
| ERP shell `x+/_layout.tsx` | ~22 + auth round-trip | re-ran on every pathname change | re-runs only after a mutation |
| MES shell `mes: x+/_layout.tsx` | 15 by this count + auth round-trip | re-ran on every pathname change | re-runs only after a mutation |
| `part` / `material` / `tool` / `consumable` / `service` `$itemId.tsx` + `_layout.tsx` | ~40 for a part | re-ran on every tab and BOM click | skip unless `itemId` / `methodId` change |
| The 196 layouts in B | see B | re-ran on every child navigation | 176 skip unless their params or query string change; 20 left (see "Left open") |

## B. Layout loaders that re-run on every child navigation

Fix for each: `shouldRevalidate` using `isUnaffectedByNavigation(args, { params, search })`
from `@carbon/utils`, naming the params and search params the loader reads.

### B1. Detail layouts (`$id.tsx` with child tabs) — 73 routes, 314 direct reads

| Route | Reads | Serial awaits |
|---|---|---|
| `x+/items+/change-notice+/$id.tsx` | 24 | 6 |
| `x+/quote+/$quoteId.tsx` | 13 | 4 |
| `x+/assembly+/$id.tsx` | 12 | 0 |
| `x+/purchase-order+/$orderId.tsx` | 11 | 1 |
| `x+/inspection+/$id.tsx` | 11 | 1 |
| `x+/sales-order+/$orderId.tsx` | 11 | 1 |
| `x+/supplier-quote+/$id.tsx` | 11 | 3 |
| `x+/payments+/$paymentId.tsx` | 10 | 3 |
| `x+/sales-invoice+/$invoiceId.tsx` | 10 | 1 |
| `x+/receipt+/$receiptId.tsx` | 9 | 3 |
| `x+/purchase-invoice+/$invoiceId.tsx` | 9 | 0 |
| `x+/inventory-count+/$id.tsx` | 9 | 1 |
| `api+/integrations.$id.connect.ts` | 8 | 2 |
| `x+/templates+/$type.tsx` | 8 | 0 |
| `x+/job+/$jobId.tsx` | 8 | 1 |
| `x+/issue+/$id.tsx` | 8 | 0 |
| `x+/supplier+/$supplierId.tsx` | 6 | 0 |
| `x+/maintenance+/$dispatchId.tsx` | 6 | 0 |
| `mes: x+/dispatch.$dispatchId.tsx` | 6 | 2 |
| `x+/shipment+/$shipmentId.tsx` | 5 | 1 |
| `x+/purchasing-rfq+/$rfqId.tsx` | 5 | 1 |
| `x+/customer+/$customerId.tsx` | 5 | 0 |
| `x+/invoicing+/charges.$id.tsx` | 5 | 1 |
| `share+/customer.$id.tsx` | 5 | 2 |
| `x+/picking-list+/$pickingListId.tsx` | 4 | 0 |
| `x+/sales-rfq+/$rfqId.tsx` | 4 | 2 |
| `x+/journal-entry+/$journalEntryId.tsx` | 4 | 2 |
| `x+/part+/$itemId.sales.tsx` | 4 | 0 |
| `x+/tool+/$itemId.purchasing.tsx` | 3 | 0 |
| `x+/tool+/$itemId.purchasing.$supplierPartId.tsx` | 3 | 1 |

The other 43 have 3 or fewer direct reads each.

### B2. List pages that parent a drawer (`foo.tsx` + `foo.new.tsx` / `foo.$id.tsx`) — 109 routes, 239 direct reads

Opening or closing the drawer changes the pathname, so the table query behind it runs again.

| Route | Reads | Serial awaits |
|---|---|---|
| `x+/priority+/people.tsx` | 20 | 3 |
| `x+/priority+/operations.tsx` | 10 | 4 |
| `x+/inventory+/quantities.tsx` | 8 | 3 |
| `x+/inventory+/storage-units.tsx` | 6 | 5 |
| `x+/priority+/dates.tsx` | 6 | 2 |
| `x+/reports+/inventory-valuation.tsx` | 5 | 2 |
| `x+/settings+/printing.tsx` | 5 | 0 |
| `x+/invoicing+/payables.tsx` | 5 | 2 |
| `x+/invoicing+/receivables.tsx` | 5 | 2 |
| `x+/users+/employees.tsx` | 4 | 0 |
| `x+/inventory+/kanbans.tsx` | 4 | 2 |
| `x+/sales+/price-list.tsx` | 4 | 0 |
| `x+/purchasing+/planning.tsx` | 4 | 4 |
| `x+/production+/planning.tsx` | 4 | 4 |
| `x+/production+/demand-forecasts.tsx` | 4 | 4 |
| `api+/traceability.sidebar.ts` | 3 | 3 |
| `api+/integrations.ramp.oauth.ts` | 3 | 5 |
| `x+/users+/suppliers.tsx` | 3 | 0 |
| `x+/users+/customers.tsx` | 3 | 0 |
| `x+/documents+/search.tsx` | 3 | 1 |

The other 89 have 3 or fewer direct reads each.

### B3. Module `_layout.tsx` loaders — 14 routes

| Route | Reads | Reads |
|---|---|---|
| `x+/accounting+/_layout.tsx` | 5 | getAccountsList, getBaseCurrency, getCompaniesInGroup, getIntegrationIdsByRole |
| `x+/get-started+/_layout.tsx` | 5 | getImplementationHub, getImplementationCheckStates, getImplementationFieldValues, getImplementationRows, detectImplementationSignals |
| `x+/customer+/_layout.tsx` | 3 | getCustomerTypes, getCustomerStatuses, getShippingTermsList |
| `x+/inventory+/_layout.tsx` | 2 | getUnitOfMeasuresList, getLocationsList |
| `x+/supplier+/_layout.tsx` | 2 | getSupplierTypes, getShippingTermsList |
| `select-company+/_layout.tsx` | 1 | getMESUrl |
| `x+/quote+/_layout.tsx` | 0 | auth only |
| `x+/assembly+/_layout.tsx` | 0 | auth only |
| `x+/inspection+/_layout.tsx` | 0 | auth only |
| `x+/job+/_layout.tsx` | 0 | auth only |
| `x+/invoicing+/_layout.tsx` | 0 | auth only |
| `x+/supplier-quote+/_layout.tsx` | 0 | auth only |
| `x+/person+/_layout.tsx` | 0 | auth only |
| `mes: display+/_layout.tsx` | 0 | auth only |


Worst single case: `x+/items+/change-notice+/$id.tsx`. Its loader calls
`getPartUsedIn` (about 15 queries) once per affected item, plus a per-item batch, and
it is a layout — so that whole fan-out repeats on every tab click inside a change notice.

## C. Heaviest leaf loaders (not layouts)

| Route | Reads | Serial awaits | Promise.all |
|---|---|---|---|
| `file+/shipment+/$id[.]pdf.tsx` | 35 | 14 | 11 |
| `mes: x+/operation.$operationId.tsx` | 27 | 6 | 3 |
| `x+/settings+/integrations.$id.tsx` | 26 | 16 | 1 |
| `mes: x+/assembly.$operationId.tsx` | 24 | 4 | 4 |
| `x+/scheduling+/forecast.tsx` | 19 | 7 | 3 |
| `file+/quote+/$id[.]pdf.tsx` | 19 | 5 | 2 |
| `x+/traceability+/graph.tsx` | 18 | 12 | 3 |
| `api+/production.kpi.$key.ts` | 17 | 1 | 3 |
| `file+/sales-invoice+/$id[.]pdf.tsx` | 17 | 6 | 2 |
| `mes: x+/inspection.$operationId.tsx` | 17 | 5 | 2 |
| `file+/job+/$jobId.traveler[.]pdf.tsx` | 16 | 15 | 2 |
| `file+/issue+/$id[.]pdf.tsx` | 16 | 8 | 2 |
| `api+/resources.kpi.$key.ts` | 15 | 0 | 5 |
| `api+/quality.kpi.$key.ts` | 15 | 6 | 3 |
| `file+/sales-return-order+/$id[.]pdf.tsx` | 15 | 4 | 2 |
| `file+/purchase-order+/$orderId[.]pdf.tsx` | 15 | 5 | 2 |
| `file+/purchase-return-order+/$id[.]pdf.tsx` | 15 | 4 | 2 |
| `file+/sales-order+/$id[.]pdf.tsx` | 15 | 5 | 2 |
| `share+/quote.$id.tsx` | 15 | 4 | 2 |
| `x+/inventory+/quantities+/$itemId.details.tsx` | 14 | 7 | 4 |
| `x+/quote+/$quoteId.$lineId.details.tsx` | 12 | 4 | 2 |
| `file+/traveler+/$id[.]pdf.tsx` | 12 | 7 | 2 |
| `api+/sales.kpi.$key.ts` | 11 | 0 | 4 |
| `api+/items.$id.$locationId.forecast.ts` | 11 | 3 | 1 |
| `x+/job+/$jobId.details.tsx` | 11 | 3 | 1 |

## D. Waterfalls — 3+ serial awaits and no `Promise.all` (52 loaders)

| Route | Serial awaits | Reads |
|---|---|---|
| `mes: x+/start.$operationId.tsx` | 11 | 10 |
| `api+/integrations.xero.oauth.ts` | 10 | 6 |
| `file+/stock-transfer+/$id.labels[.]pdf.tsx` | 8 | 6 |
| `file+/entity+/$id.labels[.]pdf.tsx` | 7 | 5 |
| `api+/integrations.jira.oauth.ts` | 5 | 5 |
| `file+/stock-transfer+/$id.labels[.]zpl.tsx` | 5 | 5 |
| `download.$token.tsx` | 5 | 3 |
| `api+/integrations.ramp.oauth.ts` | 5 | 3 |
| `api+/integrations.slack.oauth.ts` | 5 | 1 |
| `api+/integrations.quickbooks.oauth.ts` | 4 | 4 |
| `x+/workflows+/runs.$runId.tsx` | 4 | 4 |
| `x+/picking-list+/$pickingListId.tracked.$lineId.tsx` | 4 | 4 |
| `x+/purchasing+/planning.tsx` | 4 | 4 |
| `x+/settings+/billing.tsx` | 4 | 4 |
| `x+/production+/planning.tsx` | 4 | 4 |
| `x+/production+/demand-forecasts.tsx` | 4 | 4 |
| `file+/entity+/$id.labels[.]zpl.tsx` | 4 | 4 |
| `mes: x+/picking.$pickingListId.tracked.$lineId.tsx` | 4 | 4 |
| `x+/inventory+/quantities+/$itemId.tsx` | 4 | 3 |
| `api+/model.artifacts.$modelUploadId.ts` | 4 | 2 |
| `x+/settings+/audit-logs.tsx` | 4 | 2 |
| `x+/sales-invoice+/new.tsx` | 4 | 2 |
| `mes: api+/model.artifacts.$modelUploadId.ts` | 4 | 2 |
| `api+/settings.backup-archive.$file.ts` | 4 | 1 |
| `api+/integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts` | 3 | 8 |
| `x+/reports+/purchases.tsx` | 3 | 5 |
| `x+/workflow+/$id.tsx` | 3 | 5 |
| `_public+/login.tsx` | 3 | 5 |
| `mes: _public+/login.tsx` | 3 | 5 |
| `api+/production.release-readiness.ts` | 3 | 4 |

## E. Await inside a loop or `.map(async …)` (15 loaders)

| Route | Reads | Layout |
|---|---|---|
| `x+/items+/change-notice+/$id.tsx` | 24 | yes |
| `file+/job+/$jobId.traveler[.]pdf.tsx` | 16 |  |
| `mes: x+/dispatch.$dispatchId.tsx` | 6 | yes |
| `file+/batch+/$id[.]pdf.tsx` | 5 |  |
| `file+/kanban+/labels.$action[.]pdf.tsx` | 4 |  |
| `api+/integrations.radan.$version.ts` | 3 |  |
| `api+/model.download.$modelUploadId.ts` | 3 |  |
| `x+/documents+/search.tsx` | 3 | yes |
| `mes: api+/model.download.$modelUploadId.ts` | 3 |  |
| `api+/sales-rfq.$rfqId.map-lines.ts` | 2 |  |
| `api+/purchase-invoice.$invoiceId.map-lines.ts` | 2 |  |
| `api+/settings.backup-summary.ts` | 2 |  |
| `api+/model.artifacts.$modelUploadId.ts` | 2 |  |
| `mes: api+/model.artifacts.$modelUploadId.ts` | 2 |  |
| `api+/settings.backup-archive.$file.ts` | 1 |  |
The PDF and label routes (`file+/…`) dominate C and D. They are document renders, not
navigations, so they cost the user a wait on print rather than slowing the app shell.

## F. KV (Redis) caching candidates

Already cached in Redis: user claims, custom-field schemas, company integrations and
their health, company/location time zones, Stripe customer, printer config.

| Read | Call sites | Writers | Why it fits | Catch |
|---|---|---|---|---|
| `companyPlan` (`readCompanyPlan` in `@carbon/ee/plan.server`) | shell + 55 `requireFeature` + 19 `companyHasFeature` | 2 | Service-role read of one row, on every gated loader and action; changes only on a billing event. Seen twice in one request in the log. | Invalidate in the two writers; a stale plan gates or ungates a paying customer, so no long TTL without invalidation. |
| `getChangelogPanelEntry` | every shell load | none in the app (written by the changelog dispatch) | One global row, identical for every user and company. | Needs a short TTL or a delete from the dispatch job. |
| `getCompanySettings` | 87 (66 loaders) | 46 | The most-read row in the app; also read by `getReleaseControl` on every method mutation. Seen twice in one request. | 46 write sites. Route them through one helper that invalidates, or use a short TTL, before caching. |
| `company` row — `getCompany` (44), `getBaseCurrency` (14), `isAuditLogEnabled` (3) | 61 | not counted | Three functions read the same row, often in the same request. | One cached row with field pickers; invalidate on company update. |
| `getFiscalYearSettings`, `getCurrencyByCode` | 12, 17 | settings only | Slow-changing accounting reference data read on posting and report loaders. | Currency is group-scoped — key by `companyGroupId`. |
| `getTagsList` (45), `getLocationsList` (33), `getPaymentTermsList` (14), `getShippingMethodsList` (8), `getUnitOfMeasuresList` (8) | 108 | CRUD routes | Small company lists fetched by many detail and form loaders. | These go through the user's RLS client today. A KV copy bypasses RLS, so confirm every employee may read them first. Most of the cost disappears anyway once the layouts in B stop re-running. |
| Per-user shell reads — `getUser`, `getUserDefaults` (28), `getUserGroups`, `getModulePreferences`, `getCompanies` | shell | account/settings routes | Read on every shell run. | Low value now that the ERP shell only runs after mutations. |

Not a KV problem, but the same symptom — **the same row read more than once in one
request** (from the log: `companySettings` ×2, `companyPlan` ×2, `companies` ×2,
`item` ×6, `makeMethod` ×5). The request-scoped memo for this already exists
(`oncePerRead` in `@carbon/logger/middleware.server`, used for claims); `companyPlan` now
uses it too. It cannot wrap `getCompanySettings` as written, because that lives in a
`.service.ts` that is bundled for the browser.

## G. Other measured or counted costs

| Place | Fact | Fix |
|---|---|---|
| `RealtimeDataProvider.tsx` | Pulls whole tables from the browser on a cold load (`item`, `supplier`, `customer`, `employees`, `itemSupersession`), ~950 ms each when measured 2026-09-18 | Server-provided or paged data (measured on another branch; not re-measured here) |
| ERP `api+` loaders | 130 of 157 have no `clientLoader` cache, so each selector or combobox that loads one refetches | Add the existing `clientLoader` + `window.clientCache` pattern to the reference-list ones |
| List services | 154 queries ask for `count: "exact"`, a second full count per table page | `estimated` or a deferred count on large tables |
| Shell deferral | Still awaited in the ERP shell: companies, plan, custom fields, integrations, company settings, saved views, user, claims, groups, defaults, module preferences, printer routes, ITAR | These gate rendering or are read synchronously app-wide; deferring them needs each consumer changed |

## Left open

| Item | Why it was not changed |
|---|---|
| Company settings in Redis | 46 write sites and no single helper to invalidate from; a stale toggle reads as "the setting didn't save". With the shells and layouts no longer re-running, what remains is one primary-key read per loader that needs it. |
| `count: "exact"` — **done after sign-off** | The 111 paged list queries (those using `setGenericQueryFilters`) now use `LIST_COUNT` (`estimated`): exact up to PostgREST's 1,000 max-rows, planner estimate beyond. The pager decides "next" from the rows returned (`pageBounds`), so a low estimate cannot hide rows. The 45 `head: true` counts and 29 unpaged ones drive logic and stay exact. |
| `clientLoader` caches on 130 `api+` loaders | Each needs its invalidation mapped in every mutation route, or selectors go stale. Needs a per-endpoint pass. |
| Serial awaits in the other ~29 UI loaders | Reviewed: dependent chains (location → periods → data; guard → write → re-read). MES `start`/`end` loaders write as they go. |
| `x+/priority+/people.tsx` | Reads a cookie for its default scope; its only child is an action route, so there is no child navigation to save. |
| `share+/customer.$id.tsx` | Public portal layout; its loader is the access and plan gate, so it stays evaluated on every navigation. |
| `api+` / webhook routes in the "layout" count | Resource routes, not navigations — false positives of the file-name heuristic. |
| N+1 inside `getPartUsedIn` | Fixed 2026-10-05: one `get_item_used_in` RPC per item. Was ~15 queries per item; it now streams and no longer repeats per tab click, but batching it across items is its own change. |

## Suggested order (as written before the fixes)

1. MES shell: same change as the ERP shell (one file).
2. `shouldRevalidate` on the B1 detail layouts, top of the table first — change notice,
   quote, assembly, purchase order, inspection, sales order.
3. Cache `companyPlan` and the changelog entry in Redis (few writers, read everywhere).
4. Request-scoped context for session, claims, company settings and plan.
5. `shouldRevalidate` on the B2 list-plus-drawer parents.
6. Company settings in Redis, after its 46 writers go through one helper.
