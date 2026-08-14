# Docs screenshots — what's missing and how to capture it

Date: 2026-08-12 · Branch: `feat/docs-screenshots`

## Summary

The docs site (`docs/`, Fumadocs) has **38 screenshot slots** and **zero real screenshots**.
Every slot is a `<Screenshot label=… caption=… ratio=… />` placeholder that renders a dashed
grey box with the label text inside (`docs/components/editorial/mdx.tsx:57`). There is no
`src` prop, and `docs/public/` contains no screenshot directory.

So this work is two things:

1. **Code change (small, do first):** teach `<Screenshot>` to accept `src` and render a real
   `<img>` inside the existing `Zoomable` frame, falling back to today's dashed placeholder
   when `src` is absent. That keeps un-captured slots working while we fill them in batches.
2. **Capture + place 38 images** under `docs/public/screens/` and add `src=` to each slot.

Proposed convention: `docs/public/screens/<guide-or-page-slug>-<short-slug>.png`, e.g.
`docs/public/screens/plan-projections.png`. Capture at a fixed viewport (suggest 1600×900 for
`ratio="wide"`, 1200×1600 for `ratio="tall"`), 2× DPR, light theme only (the site is light-only).

## Feasibility at a glance

- **28 of 38** are plain authenticated ERP pages or in-page modals — straightforward.
- **5** live in the MES app on a different port (3001) — same login, just a second browser target.
- **2** are public tokenized share pages (`/share/quote/:externalLinkId`,
  `/share/supplier-quote/:externalLinkId`) — capturable, but the link must be copied out of the
  ERP record first, and should be shot in a clean window so no ERP chrome is in frame.
- **3** need heavy prerequisite data (traceability graph, job production events, RFQ compare)
  — they render an empty state unless a full flow has actually been run.
- **1** is access-gated (`/x/settings/backups`, internal-email only) but **open on local dev**,
  so capture it locally.

Two capture-order dependencies worth planning around: production events (#28) needs time logged
in MES first, and the change-notice diff (#38) needs the notice walked Draft → Implementation
with real draft edits.

## The 38 screenshots

Legend: **App** = erp (port 3000) / mes (port 3001) / share (public page).
`:id` params are DB UUIDs, not the human-readable IDs shown in the UI.

### Guide: quote-to-cash

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 1 | `guides/quote-to-cash.mdx:33` — Quote builder | erp | `/x/quote/:quoteId/:lineId/details` | Quote in Draft with ≥2 lines and multiple `quotePrice` rows (quantity breaks). The line page shows the explorer + the break grid together. |
| 2 | `guides/quote-to-cash.mdx:47` — Digital quote, customer view | share | `/share/quote/:externalLinkId` | Quote status **Sent**, `companySettings.digitalQuoteEnabled`. Copy the link from the quote header's Share button. PO-upload field needs `digitalQuoteIncludesPurchaseOrders`. |
| 3 | `guides/quote-to-cash.mdx:69` — Sales order | erp | `/x/sales-order/:orderId/details` | Order created via the quote header's **Convert to Order**; opens at "To Ship and Invoice". |

### Guide: order

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 4 | `guides/order.mdx:20` — Sales order dashboard | erp | `/x/sales/orders` (list) or `/x/sales-order/:orderId/details` | No "delivery schedule" entity exists — it's per-line `promisedDate`. Use 3 lines of 30 with staggered dates. |
| 5 | `guides/order.mdx:34` — Jobs card + Convert Line to Job dialog | erp | `/x/sales-order/:orderId/:lineId/details`, click **Make to Order** | In-page modal, no URL. Line `methodType = "Make to Order"`. Prefilled qty = remaining, so create 0–2 jobs first to show the 90 → 60 story. |
| 6 | `guides/order.mdx:46` — Job overview with copied method | erp | `/x/job/:jobId/details` | Job must have a populated `jobMakeMethod`, else BoM/BoP cards are empty. |

### Guide: order-to-cash

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 7 | `guides/order-to-cash.mdx:43` — Post shipment | erp | `/x/shipment/:shipmentId/details`, click **Post** | Modal, no URL. Shipment is created only by the sales order header's **Ship** button (`/x/shipment/new` is POST-only). Order must be To Ship / To Ship and Invoice. |
| 8 | `guides/order-to-cash.mdx:51` — Sales invoice | erp | `/x/sales-invoice/:invoiceId/details` | Created from a **posted** shipment. Don't re-hit `/x/sales-invoice/new?...` — it creates a new invoice every load. |

### Guide: ship

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 9 | `guides/ship.mdx:16` — Quality issue | erp | `/x/issue/:id/details` | Issue created at `/x/issue/new` with an item + workflow, then a **job-operation association** added. |
| 10 | `guides/ship.mdx:42` — Procedure version history | erp | `/x/procedure/:id`, open the `V{n}` version dropdown | Needs ≥2 versions (ideally one Active, one Archived). Alternative non-interactive shot: the Versions popover on `/x/production/procedures`. |
| 11 | `guides/ship.mdx:52` — Traceability graph | erp | `/x/traceability/graph?trackedEntityId=<id>` | **Heavy prereq:** a serialized entity with real build activity. Without a tracked param the route redirects to `/x/traceability`; without activity it renders an empty state. |
| 12 | `guides/ship.mdx:60` — Shipment & invoice (partial) | erp | `/x/shipment/:shipmentId/details` then `/x/sales-invoice/:invoiceId/details` | **Two pages, one slot** — either pick the stronger one or composite. Ship 30 of 90; the order stays To Ship and Invoice. |

### Guide: build

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 13 | `guides/build.mdx:45` — BoM Subassembly / Kit toggle | erp | `/x/part/:itemId/make/:makeMethodId`, expand a material row | The toggle renders **only** when the material's `methodType = "Make to Order"`, and only on a **Draft** method. |
| 14 | `guides/build.mdx:57` — Job method explorer | erp | `/x/job/:jobId/details` | Multi-level method (Make-to-Order children with their own materials + ops). Don't shoot from the `operations`/`events` tabs — they auto-collapse the explorer. |

### Guide: floor

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 15 | `guides/floor.mdx:22` — MES schedule board | **mes** | `/x/operations` | Released jobs with operations at work centers **in the user's active location**. |
| 16 | `guides/floor.mdx:39` — Job routing with an outside operation | erp | `/x/job/:jobId/details` (Bill of Process card) | Needs one `Process` op and one `Outside Processing` op with a supplier process attached. |
| 17 | `guides/floor.mdx:45` — Shop-floor work instructions | **mes** | `/x/operation/:operationId` → **Instructions** tab | Tab is React state, not deep-linkable — must be clicked. Operation needs an attached procedure with steps + images. |
| 18 | `guides/floor.mdx:66` — MES operation screen | **mes** | `/x/operation/:operationId` | Operation type must be `Process` (Assembly/Inspection redirect elsewhere). Job Released with materials on the op. |
| 19 | `guides/floor.mdx:87` — Shop-floor scan | **mes** | `/x/assembly/:operationId` → click a tracked material → Issue Material modal | Operation type `Assembly`; parent serial-tracked; a batch/serial-tracked material with available lots. **No physical scanner needed** — the modal has a searchable dropdown. |

### Guide: plan

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 20 | `guides/plan.mdx:18` — Production → Projections | erp | `/x/production/projections` | Needs a location with defaults set; enter quantities for a few weeks. |
| 21 | `guides/plan.mdx:35` — Part: Planning tab | erp | `/x/part/:itemId/planning` | Set a reordering policy, reorder point, lot size; the chart needs some on-hand/demand history. |
| 22 | `guides/plan.mdx:49` — Planning table | erp | `/x/production/planning` (and/or `/x/purchasing/planning`) | Caption says "jobs **and** POs" but these are two separate pages — pick one, or split the slot. Needs open demand + parts with a reordering policy. |
| 23 | `guides/plan.mdx:59` — Receiving a purchase order | erp | `/x/receipt/:receiptId/details`, expand a line | Receipt created from a released PO via **Receive**; PO line must be for a **Batch**-tracked part so the lot field shows inline. Requires the `create` edge function running locally. |

### Guide: job-finish-close / job-costing

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 24 | `guides/job-finish-close.mdx:25` — Job completion | erp | any job page → header **Complete** button → modal | Job not already Completed/Cancelled. Posting is irreversible — use a throwaway job. |
| 25 | `guides/job-costing.mdx:35` — Job production events | erp | `/x/job/:jobId/events` | **Dependency:** needs logged `productionEvent` rows — run Setup/Labor/Machine in MES first (#18), or add events manually at `/x/job/:jobId/events/new`. Work centers need rates for the cost columns to read well. |

### Guide: rfq-to-po

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 26 | `guides/rfq-to-po.mdx:27` — RFQ supplier comparison | erp | `/x/purchasing-rfq/:rfqId` → **Compare Quotes** drawer | **Heavy prereq:** RFQ finalized (Requested) with ≥2 suppliers and >1 *Active* supplier quote actually submitted, else the button doesn't render. |
| 27 | `guides/rfq-to-po.mdx:39` — Supplier quote portal | share | `/share/supplier-quote/:externalLinkId` | Public tokenized page; copy the link from the supplier quote header. Shoot in a clean window. |
| 28 | `guides/rfq-to-po.mdx:51` — Purchase order | erp | `/x/purchase-order/:orderId/details` | Finalized PO, nothing received or invoiced. Watch out: a high-value PO shows "Needs Approval" instead. |

### Guide: receive-and-bill

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 29 | `guides/receive-and-bill.mdx:35` — Post receipt | erp | `/x/receipt/:receiptId/details`, click **Post** | Modal, no URL. Draft receipt from a finalized PO with received quantities. |
| 30 | `guides/receive-and-bill.mdx:55` — Purchase invoice | erp | `/x/purchase-invoice/:invoiceId/details` | Draft invoice created from the receipt/PO **Invoice** button, lines carrying `purchaseOrderLineId`. |

### Guide: fixed assets

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 31 | `guides/fixed-assets-acquire.mdx:31` — Fixed asset register | erp | `/x/fixed-asset/:fixedAssetId/register` (directly linkable drawer) | Asset must be **Draft** — the route redirects otherwise. The accounting *list* pages are behind a beta gate; the detail routes are not. |
| 32 | `guides/fixed-assets-acquire.mdx:45` — Depreciation run | erp | `/x/depreciation-run/:depreciationRunId` | ≥1 Active asset with a depreciation method + start date, open accounting period, run still Draft. |
| 33 | `guides/fixed-assets-sell.mdx:25` — Sell fixed asset | erp | `/x/fixed-asset/:fixedAssetId/sell` (modal, linkable) | Asset must be Active or Fully Depreciated; needs a customer to pick. |

### Guide: change-order

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 34 | `guides/change-order.mdx:40` — New change notice form | erp | `/x/change-notice/new` | Change-notice types must exist (seeded). Capture before any affected item is added. |
| 35 | `guides/change-order.mdx:60` — Affected item + change-type selector | erp | `/x/items/change-notice/:id/:affectedId/details` | Affected item must be a **Part** with a live make method so the draft BoM/BoP renders. |
| 36 | `guides/change-order.mdx:108` — Release diff review (`ratio="tall"`) | erp | `/x/items/change-notice/:id/details` → header **Release** | **Heaviest prereq:** notice must be walked to status **Implementation** one step at a time, with real draft edits (a removed BoM line, a changed attribute), else the diff is empty. Modal state is not routable. |

### Reference / platform pages

| # | Slot | App | Where to capture | Prereqs / notes |
|---|---|---|---|---|
| 37 | `docs/platform/backups.mdx:33` — Settings → Backups | erp | `/x/settings/backups` | **Gated:** internal email or `IS_LOCAL_DEV`. Capture locally. Also open the `i` contents popover for the live per-area counts. |
| 38 | `docs/reference/import-export.mdx:24` — Parts list Download CSV | erp | `/x/items/parts` | The dashed download button only renders when the table has ≥1 row. Hover it if we want the "Download CSV" tooltip in frame. |

## Open questions for the next session

1. **`<Screenshot src>` shape** — plain `<img>` vs Next `<Image>`. Next `<Image>` gives us
   width/height and lazy loading, but needs intrinsic dimensions; plain `<img>` inside the
   existing aspect-ratio box is the smaller change. Recommend plain `<img>` first.
2. **Slot #12 and #22 each describe two pages.** Either capture the stronger single view or
   split the slot into two `<Screenshot>`s. Needs a call.
3. **Data seeding.** Several slots (11, 25, 26, 36) need a flow actually run end to end. Worth
   deciding whether we seed a demo company once and shoot everything against it.
4. **Redaction.** Whatever company we shoot against will have its name, users, and part numbers
   in frame permanently. Recommend a purpose-built demo company matching the guides' robot story.

---

# Data audit — 2026-08-12

Checked against the local dev Postgres for this worktree
(`postgresql://postgres:postgres@localhost:64728/postgres`), company
**Nebula aerospace** (`JdWKt22cuZfGGCmEH6jP7u`), the company owned by
`anshul@carbon.ms`. The other company in the DB (`Carbon Development`,
`d9u72rtbc0gg2fdet3sg`, owned by `test@carbon.ms`) holds an identical copy of the
same seed — same gaps.

Verdict: **the seed fills every list screen, but ~24 of the 38 screenshots would still
come out empty or wrong.** The single biggest hole is that jobs were seeded without any
operations or materials.

## Empty / missing (blocks a screenshot)

| Gap | Evidence | Blocks |
|---|---|---|
| **Jobs have no operations and no materials** | `jobOperation` = 0 and `jobMaterial` = 0 for all 8 jobs, though `jobMakeMethod` = 8 | 6, 14, 15, 16, 17, 18, 19, 24, 25 |
| No procedures at all | `procedure` = 0, `procedureStep` = 0 | 10, 17 |
| No purchasing RFQs or supplier quotes | `purchasingRfq` = 0, `supplierQuote` = 0 | 26, 27, 28 |
| No demand projections | `demandProjection` = 0 | 20 |
| No production events | `productionEvent` = 0 | 25 |
| No tracked activity (no genealogy) | `trackedActivity` = 0; the 8 `trackedEntity` rows are all `sourceDocument = 'Item'` | 11 |
| No depreciation runs | `depreciationRun` = 0 | 32 |
| No quantity-break pricing | `quoteLinePrice` = 0 | 1 |
| Digital quote unreachable | every `quote.externalLinkId` is null, and `companySettings.digitalQuoteEnabled = false` | 2 |
| No issue↔job-operation link | `nonConformanceJobOperation` = 0 | 9 |
| Nothing is batch- or serial-tracked | all 33 items are `itemTrackingType = 'Inventory'` | 19, 23, 11 |
| No outside-processing operations | all 27 `methodOperation` rows are `operationType = 'Process'` (2 `supplierProcess` rows exist but are unused) | 16 |
| No Make-to-Order child materials | all 40 `methodMaterial` rows are `Pull from Inventory`, so no subassembly exists | 13, 14 |
| No order at "To Ship and Invoice" | statuses present: Draft, Confirmed, In Progress, To Ship, Completed, Closed, Cancelled | 3, 7 |
| No PO at "To Receive and Invoice" | present: Draft, To Receive, To Invoice | 28 |
| Thin sales orders | 8 of 9 orders have exactly 1 line; only the `To Ship` order has 2 lines and `promisedDate` set | 4, 5 |
| Only one fixed asset, already Active | `fixedAsset` = 1 (`FA000001`, Active) — the Register drawer needs a **Draft** asset | 31 |

## Already fine

Parts list (22 parts) for 38 · Backups page for 37 (open on local dev) · Draft shipment
from a sales order for 7 · Draft receipt from a PO for 29 · Draft sales invoice for 8 ·
Draft purchase invoice for 30 · `itemPlanning` reordering policies on all 66 rows for 21 ·
the Active fixed asset for 33 · 3 change notices (one at **Implementation**) with one
affected item each for 34/35 — though 36 still needs real draft edits on that affected item
to produce a non-empty diff.

## How to fill the gaps

The dev seed is already well structured — `packages/database/src/seed-dev/tiers/01…12`,
run by `pnpm run db:seed:dev -- --email anshul@carbon.ms`. Extending those tiers is the
right fix: repeatable, reviewable, and it goes through the same code paths the app uses, so
nothing about navigation breaks. Hand-written one-off `INSERT`s would drift and risk
half-built records.

Caveat to confirm before running: `seed-dev.ts` **wipes the company's business data and
rebuilds it** unless `--skip-wipe` is passed. Reference/config data is preserved.

---

# Data fixes applied — 2026-08-12

All gaps were closed by extending the dev seed (`packages/database/src/seed-dev/`), not by
hand-written inserts, so the fix is repeatable: `pnpm run db:seed:dev -- --email anshul@carbon.ms`.

## The root cause behind nine of the empty screenshots

`tiers/06-production.ts` guarded its only `jobOperation` insert on
`ctx.refs.processes["Mechanical Assembly"]` and `ctx.refs.workCenters["Fabrication Bay"]` —
neither name exists (the real ones are "Clean Room Assembly", "CNC Mill", …). The guard was
`if (jmm1 && procAssembly && wcFab)`, so it silently did nothing and **every job shipped with
zero operations and zero materials**.

Fixed properly rather than by renaming the two refs: a new
`helpers/job-method.ts` copies an item's active make method onto a job the way the `get-method`
edge function's `itemToJob` path does — recursively, so subassemblies get their own
`jobMakeMethod`, materials keep the operation they are consumed at, and rates come from the work
center. The seed runs as one SQL transaction and cannot invoke an edge function, which is why
this had to be reimplemented rather than called. It is deliberately narrower than the edge
function: no configuration rules, no supersession redirect, no step/tool/parameter copy.

Result: 81 job operations and 113 job materials across the 8 jobs, 11 levels deep on SAT-1000.

## Everything else

| Gap | Fix | Tier |
|---|---|---|
| No subassemblies (all BOM lines "Pull from Inventory") | `addBomLine` now derives `methodType` from the component's new `isMake` flag and sets `materialMakeMethodId` to the component's active method | `helpers/items.ts` |
| No outside-processing step | Hard-anodize operation on BUS-STR-001 backed by a new AstroMill `supplierProcess` | 01, 02 |
| Nothing batch- or serial-tracked | SAT-1000 + RW-010 Serial; BAT-LIION-48V + MAT-AL7075-PLT Batch | 02 |
| Assembly view unreachable in MES | SAT-1000's integration operation is now `operationType: Assembly` | 02 |
| No procedures | Two procedures with steps; "Structural Frame Assembly" has V1 Archived + V2 Active, attached to real operations | 01, 02 |
| Scan picker empty | Available lots/serials for the tracked buy parts | 03 |
| No production events | Setup/Labor/Machine events + a production quantity on the in-progress job | 06 |
| Traceability graph empty | `SAT1000-SN-0001` with a Produce activity and six Consume activities carrying real inputs | 06 |
| Issue had no association | `nonConformanceJobOperation` + `nonConformanceItem` on NCR000001 | 07 |
| MES board empty even with jobs | The employee sat at Headquarters while every job and work center is at the plant — `employeeJob.locationId` now points at the plant (`userDefaults` is a view over it) | 01 |
| No quantity-break pricing, digital quote unreachable, no "To Ship and Invoice" order, single-line orders | 8 `quoteLinePrice` rows, `digitalQuoteEnabled`, a real `externalLink`, and a 3-line staggered-delivery order | 04 |
| No RFQ, no supplier quotes, no portal link, no PO at "To Receive and Invoice" | One RFQ to 3 suppliers, 3 Active supplier quotes with comparable break pricing and portal links, and PO000004 converted from the winner | 05 |
| One Active fixed asset, no depreciation run | 4 assets (Draft / Active ×2 / Fully Depreciated) + a Draft run with lines | 09 |
| Projections blank | 48-week period horizon + 24 weekly projections for three make parts | 12 |
| Receipt line did not ask for a lot | `requiresBatchTracking` on the battery receipt line | 05 |

## Verified after re-seed

`jobOperation` 81 · `jobMaterial` 113 · `jobMakeMethod` 56 · Assembly ops 2 · Outside Processing
ops 3 · procedures 2 Active + 1 Archived with 11 steps · operations carrying a procedure 5 ·
`trackedActivity` 1 Produce + 6 Consume · `productionEvent` 6 · `demandProjection` 24 ·
`depreciationRun` 1 with 2 lines · fixed assets Draft/Active×2/Fully Depreciated ·
`quoteLinePrice` 8 · digital quote enabled with a live `externalLinkId` · a sales order at
"To Ship and Invoice" · a PO at "To Receive and Invoice" · 3 supplier quotes with portal links ·
`nonConformanceJobOperation` 1 · Make-to-Order BOM lines 10 · tracked items 2 Serial + 2 Batch.

## Change notices + one wipe bug

`changeOrderAffectedItem` rows had `draftMakeMethodId` / `baseMakeMethodId` NULL, so the
affected-item page had nothing to edit and the Release diff was empty. All three notices now
clone the item's method into a CO-owned Draft. CN-000002 (the one at `Implementation`, the
status the Release button needs) diverges from its base on purpose — MAT-KAPTON dropped, the
battery quantity 1→2, HARNESS-001 added, an operation renamed and re-timed, and a description
set that the base does not have — so the diff shows a removal, an addition, a modification and
an attribute change. `changeSummary` is dead code (nothing reads it) and was left null.

Adding supplier quotes exposed a latent bug in `wipe.ts`: `supplierQuoteLine.itemId` has the same
check constraint `salesOrderLine.itemId` does, so `nullNullableReferences` could not null it and
the **second** seed run failed during the wipe. `supplierQuote` and `purchasingRfq` joined the
list of headers deleted before that pass. The seed has since been run twice in a row cleanly.

## Caveat

Everything above is verified at the database level (row counts, statuses, foreign keys), not by
loading each of the 38 pages in a browser. The page-by-page check happens naturally during the
capture pass — anything still empty will be obvious the moment we open it.

---

# Capture spec — 2026-08-12

The shot list, resolved to exact URLs against this worktree's data. Written so a capture run is
mechanical: open URL, do the action, save to the filename.

## Settings (identical for every shot)

- **ERP** `https://erp.docs-screenshots.dev` · **MES** `https://mes.docs-screenshots.dev` ·
  share pages are public routes on the ERP host.
- Sign in as `anshul@carbon.ms`, company **Nebula aerospace**, location **Manufacturing Plant**
  (the MES board and the location-scoped ERP pages read the signed-in user's default location).
- Viewport **1600×1000** at **2× device pixel ratio** for `ratio="wide"`, **1200×1500** for
  `ratio="tall"` (only slot 36). Viewport clip, **not** full-page — a 4000px-tall page scaled into
  a 16:9 figure is unreadable.
- Light theme only; the docs site is light-only and a dark screenshot would fight the paper.
- No browser chrome, no OS window frame, no cursor. Page content only.
- PNG. Collapse the left sidebar only if it crowds the subject; otherwise leave the app's normal
  chrome in frame so readers recognise where they are.
- Wait for skeletons/spinners to clear before capturing. Several of these pages stream.

## Naming and location

`docs/public/screens/<guide-slug>-<subject>.png`, referenced from MDX as
`src="/screens/<file>.png"` (paths under `docs/public/` are served from the site root).

## Shot list

`ratio="wide"` unless noted. Action blank = the URL alone is the shot.

| # | File (`docs/public/screens/…`) | App | URL | Action |
|---|---|---|---|---|
| 1 | `quote-builder.png` | erp | `/x/quote/quote_YRQzVHySHTzr76KwtRAp4u/KaBjBdxm6xTw3ivoapvG9s/details` | Q000002, has the quantity breaks. No Draft quote carries breaks; Sent is fine. |
| 2 | `quote-digital-customer.png` | share | `/share/quote/5eed0000-0000-4000-8000-000000000001` | Clean window, signed out. |
| 3 | `quote-sales-order.png` | erp | `/x/sales-order/so_UpXcS5TNoTCg4PBdR3peqf/details` | SO000009, the only "To Ship and Invoice" order. Frame the header + status band. |
| 4 | `order-dashboard.png` | erp | `/x/sales-order/so_UpXcS5TNoTCg4PBdR3peqf/details` | Same record as 3, framed on the three staggered `promisedDate` lines instead. |
| 5 | `order-convert-line-to-job.png` | erp | `/x/sales-order/so_UpXcS5TNoTCg4PBdR3peqf/PF1EB543BGPgJuuQa65BaR/details` | SAW-001, 30 ea, Make to Order. Click **Make to Order** on the Jobs card. |
| 6 | `order-job-overview.png` | erp | `/x/job/job_8N4xDHh7PkZDHC7zUXWxGT/details` | J000001. |
| 7 | `otc-post-shipment.png` | erp | `/x/shipment/sh_4sYD2sAk34hWensuB3PxLo/details` | Open the **Post** modal. Do not confirm. |
| 8 | `otc-sales-invoice.png` | erp | `/x/sales-invoice/si_BFQ5UXqePsHKen5dbPLVQr/details` | AR000001 Draft. |
| 9 | `ship-quality-issue.png` | erp | `/x/issue/nc_Wfzn2Lyqsbb6wnQyPxvYSJ/details` | NCR000001 — the one carrying the job-operation link. |
| 10 | `ship-procedure-versions.png` | erp | `/x/procedure/pro_YDRL1aV6LKJKaoPhzFUwr5` | Open the `V2` version dropdown (V1 is Archived). |
| 11 | `ship-traceability-graph.png` | erp | `/x/traceability/graph?trackedEntityId=rSMCuSuyt7ZfaIUaM14vJ` | SAT1000-SN-0001. Without the param the route redirects. |
| 12a | `ship-partial-shipment.png` | erp | `/x/shipment/sh_4sYD2sAk34hWensuB3PxLo/details` | Slot split in two — shipment half. |
| 12b | `ship-partial-invoice.png` | erp | `/x/sales-invoice/si_BFQ5UXqePsHKen5dbPLVQr/details` | Slot split in two — invoice half. |
| 13 | `build-subassembly-kit-toggle.png` | erp | `/x/part/item_PsbBdE9LPj13J9rpWegmgH/make/make_LnujjSJLt2XWLMU6outVaJ` | SAT-1000 **v2.00 Draft** — the toggle renders only on a Draft method, on a Make-to-Order line. Expand one. |
| 14 | `build-job-method-explorer.png` | erp | `/x/job/job_8N4xDHh7PkZDHC7zUXWxGT/details` | Expand the explorer. Stay on `details`; other tabs auto-collapse it. |
| 15 | `floor-mes-schedule.png` | **mes** | `/x/operations` | |
| 16 | `floor-outside-operation.png` | erp | `/x/job/job_8N4xDHh7PkZDHC7zUXWxGT/details` | Frame the Bill of Process card — `jo_7riMHK66MAftECyk2nhvcc` is the anodize step at AstroMill. |
| 17 | `floor-work-instructions.png` | **mes** | `/x/operation/jo_B8bp9wUytWkE2uW34Rqyyh` | Click the **Instructions** tab (React state, not deep-linkable). Procedure attached. |
| 18 | `floor-mes-operation.png` | **mes** | `/x/operation/jo_7Z4q5gGdKERVgV7VgEYi5J` | "Machine structural panels" at CNC Mill — `Process`, Ready, on J000001. |
| 19 | `floor-shopfloor-scan.png` | **mes** | `/x/assembly/jo_KazG6bdws4tWUFmWtAZtjT` | Click a tracked material → **Issue Material** modal. Dropdown, no scanner needed. |
| 20 | `plan-projections.png` | erp | `/x/production/projections` | |
| 21 | `plan-part-planning.png` | erp | `/x/part/item_ACg9bW6vQnYRh99VWRwaAj/planning` | Battery — batch-tracked, has a reorder policy. |
| 22a | `plan-production-planning.png` | erp | `/x/production/planning` | Slot split in two — suggested jobs. |
| 22b | `plan-purchasing-planning.png` | erp | `/x/purchasing/planning` | Slot split in two — suggested POs. |
| 23 | `plan-receive-po.png` | erp | `/x/receipt/rec_S7rNbTW4zTAQL4V9nwX2qs/details` | Expand the battery line so the batch/lot field shows. |
| 24 | `job-completion.png` | erp | `/x/job/job_JSiDJmAGFsRq7UAR2EKUYH/details` | J000002 Ready → header **Complete** → modal. **Mutating** — see ordering below. |
| 25 | `job-production-events.png` | erp | `/x/job/job_8N4xDHh7PkZDHC7zUXWxGT/events` | 6 seeded events across two operations. |
| 26 | `rfq-supplier-comparison.png` | erp | `/x/purchasing-rfq/d9u8j2tbc0ghholet58g` | PRFQ000001 Requested → **Compare Quotes** drawer (3 Active quotes). |
| 27 | `rfq-supplier-portal.png` | share | `/share/supplier-quote/5c0e1a3d-7b41-4c92-9f18-2ad6e0b71c01` | Clean window, signed out. |
| 28 | `rfq-purchase-order.png` | erp | `/x/purchase-order/po_TaZiGpDdrPvrCfJzRMvLYU/details` | PO000004, "To Receive and Invoice". |
| 29 | `receive-post-receipt.png` | erp | `/x/receipt/rec_S7rNbTW4zTAQL4V9nwX2qs/details` | Open the **Post** modal. **Mutating if confirmed** — do not confirm. |
| 30 | `receive-purchase-invoice.png` | erp | `/x/purchase-invoice/pi_RiMaXHS9ibtut6RdV29kUS/details` | AP000001 Draft. |
| 31 | `fa-register.png` | erp | `/x/fixed-asset/d9u8j2tbc0ghholet5d0/register` | FA000003, the Draft asset — the route redirects for any other status. |
| 32 | `fa-depreciation-run.png` | erp | `/x/depreciation-run/d9u8j2tbc0ghholet5e0` | Draft run, 2 lines. |
| 33 | `fa-sell.png` | erp | `/x/fixed-asset/d9u8j2tbc0ghholet5c0/sell` | FA000001 Active. |
| 34 | `co-new-notice.png` | erp | `/x/change-notice/new` | Empty form, before any affected item. |
| 35 | `co-affected-item.png` | erp | `/x/items/change-notice/co_Xc8BasAdAcZwgCtGXqL6YV/coai_GddTJkkreziJcnQa4NbAFU/details` | CN-000002's affected item, draft method populated. |
| 36 | `co-release-diff.png` (`ratio="tall"`) | erp | `/x/items/change-notice/co_Xc8BasAdAcZwgCtGXqL6YV/details` | CN-000002 at **Implementation** → header **Release** → diff modal. **Mutating if confirmed** — do not confirm. |
| 37 | `platform-backups.png` | erp | `/x/settings/backups` | Open the `i` contents popover. Gated to internal email / local dev — fine here. |
| 38 | `reference-parts-csv.png` | erp | `/x/items/parts` | Hover the download button so the "Download CSV" tooltip is in frame. |

## Ordering

Shots 1–23 and 25–28, 30–35, 37–38 are read-only. **24 is the only one that changes data** if the
modal is confirmed — leave it last, and never confirm 7, 29 or 36 either. If a retake needs clean
state, re-run `pnpm run db:seed:dev -- --email anshul@carbon.ms` (it wipes and rebuilds the
company's business data, so any manual edits made during capture are lost) and re-resolve the ids
in this table, since they are regenerated on every seed.

## MDX edits that come with this

Slots 12 and 22 each become two `<Screenshot>` elements — `guides/ship.mdx:60` and
`guides/plan.mdx:49`. Their captions need splitting too, one sentence per image. Everything else is
a one-line change: add `src="/screens/<file>.png"` to the existing element.
