---
paths:
  - "apps/erp/app/modules/quality/ui/InboundInspections/**"
  - "apps/erp/app/modules/quality/quality.{server,service,models}.ts"
  - "packages/database/supabase/migrations/*inbound-inspection*.sql"
  - "packages/database/supabase/functions/post-receipt/index.ts"
---

# Inbound Inspection System

Receiving-side quality gate. When a receipt is posted, a **lot-level** inspection is
created for each received line whose item has `requiresInspection = true`. Inspectors
record per-sample pass/fail, then disposition the lot Accept / Reject / Partial.

## Data model (newest migration wins)

The shipped schema is the **Phase 2 rebuild** in `20260419163058_inbound-inspection-sampling.sql`,
which `DROP ... CASCADE`s the original Phase-1 `inboundInspection` table from
`20260419094132_inbound-inspections.sql` and recreates it lot-based. Don't trust the
Phase-1 shape (it was per-tracked-entity with `trackedEntityId`/`inspectedBy` columns).

- `item.requiresInspection` BOOLEAN (default false) — added `20260419094132`.
- `companySettings.samplingStandard` enum `samplingStandard` (`ANSI_Z1_4` | `ISO_2859_1`,
  default `ANSI_Z1_4`) and `companySettings.enforceInspectionFourEyes` BOOLEAN.
- `itemSamplingPlan` (PK = **`itemId`** only, not composite) — per-item plan, created lazily:
  `type` (`samplingPlanType`: All/First/Percentage/AQL), `sampleSize`, `percentage`,
  `aql`, `inspectionLevel` (I/II/III/S1–S4), `severity` (Normal/Tightened/Reduced).
- `inboundInspection` (lot level, PK = `id`) — `inboundInspectionId` (human id, `II` seq,
  unique per company), `receiptLineId` (**unique** — one lot per receipt line), `receiptId`,
  `itemId`, `itemReadableId`, `supplierId`, `lotSize`, snapshot of the resolved plan
  (`samplingStandard`, `samplingPlanType`, `sampleSize`, `acceptanceNumber`,
  `rejectionNumber`, `aql`, `inspectionLevel`, `severity`, `codeLetter`),
  `status` (`inboundInspectionStatus`: Pending/In Progress/Passed/Failed/Partial),
  `dispositionedBy`/`dispositionedAt`. **No `itemTrackingType` column** — joined from `item`.
- `inboundInspectionSample` — one row per recorded result: `inboundInspectionId`,
  `trackedEntityId` (**nullable** since `20260612151947`), `status`
  (`inboundInspectionSampleStatus`: Pending/Passed/Failed), `inspectedBy`/`inspectedAt`.
  A **partial** unique index `inboundInspectionSample_trackedEntityId_key WHERE trackedEntityId
  IS NOT NULL` keeps a serial entity sampleable once while allowing many anonymous samples.
- `inboundInspectionHistory` — one row per disposition (skeleton for future plan auto-switching).
- `nonConformanceInboundInspection` (`20260421091238`) — links an auto-created NCR back to
  the inspection (unique `(nonConformanceId, inboundInspectionId)`).

RLS on all tables: standard SELECT/INSERT/UPDATE/DELETE gated by `quality_view/create/update/delete`.

## Receipt → inspection flow (`post-receipt/index.ts`, Supabase edge fn)

`packages/database/supabase/functions/post-receipt/index.ts` (inserts ~line 630):
1. Loads items (`id, itemTrackingType, requiresInspection`), company `samplingStandard`, and
   `itemSamplingPlan` rows for the receipt.
2. Per receipt line whose item `requiresInspection` and `receivedQuantity > 0`: resolves the
   plan via `resolveSamplingPlan(plan, lotSize, standard)` from
   `packages/database/supabase/functions/shared/sampling-engine.ts` (ANSI Z1.4 / ISO 2859-1
   tables; returns `{ sampleSize, acceptance, rejection, codeLetter }`). No configured plan →
   defaults to `type: "All"`, level `II`, `Normal`. Pushes an `inboundInspection` insert (with
   `inboundInspectionId` from `getNextSequence`).
3. **Tracked entities for inspection-required items are set to `"On Hold"` at receipt** (not
   Available); everything else flips to `Available`. They are released individually by sample
   inspection or en masse by lot disposition.

## Tracking types

All four `itemTrackingType` values support inbound inspection (the only UI gate is purchased
items — see Code map). Serial parts produce N tracked entities and the inspector scans/selects a
discrete entity per sample; non-serial (Batch/Inventory/Non-Inventory) record pass/fail with
`trackedEntityId = NULL` (same UI, no scan). Inventory items that aren't tracked have no per-row
status to flip, so a Reject posts a compensating ledger entry instead (see disposition).

## Code map (ERP)

- **Items toggle**: `apps/erp/app/modules/items/ui/{Parts,Materials,Tools,Consumables}/*Properties.tsx`
  render the `requiresInspection` checkbox only when `replenishmentSystem?.includes("Buy")` (i.e.
  purchased items) — **gated by Buy replenishment, NOT by tracking type**.
- **Sampling plan editor**: `apps/erp/app/modules/quality/ui/SamplingPlan/SamplingPlanForm.tsx`,
  mounted on `routes/x+/{part,material,tool,consumable}+/$itemId.quality.tsx`.
- **Inspection detail drawer**: `.../ui/InboundInspections/InboundInspectionLotView.tsx` — progress,
  samples table, Accept/Reject/Partial. Branches on `isSerial = itemTrackingType === "Serial"`.
  Reject modal has an "Open an NCR" checkbox (`createNcr`, defaults on).
- **Sample modal**: `.../ui/InboundInspections/ScanInspectionSample.tsx` — `isSerial` prop; serial
  shows Scan/Select tabs (entity required), non-serial shows just Notes + Pass/Fail.
- **Routes** `apps/erp/app/routes/x+/quality+/`: `inbound-inspections.tsx` (list),
  `.$id.tsx` (loader passes `itemTrackingType`), `.$id.sample.tsx`, `.$id.{accept,reject,partial}.tsx`.
- **Server** `quality.server.ts`:
  - `upsertInboundInspectionSample` — flips entity status + writes `trackedActivity` input/output
    only when `trackedEntityId` is present; anonymous (null) samples are always inserts (no dedupe).
  - `dispositionInboundInspection` — Accept releases un-sampled entities to Available; Reject flips
    all lot entities to Rejected (and for a non-tracked Inventory item posts an `itemLedger`
    `Inbound Inspection` negative adjustment, doc-type added `20260619142853`); Partial leaves
    entities; always writes `inboundInspectionHistory`.
  - NCR auto-creation lives in the **reject route** (`.$id.reject.tsx`), optional via `createNcr`,
    linking through `nonConformanceInboundInspection`.
- **Service** `quality.service.ts`: `getInboundInspections` (list), `getInboundInspection` (selects
  `item(... itemTrackingType)`), `getInboundInspectionLotTrackedEntities`.
- **Validators** `quality.models.ts`: `inboundInspectionSampleValidator` (`trackedEntityId`
  optional), `itemSamplingPlanValidator`, `inboundInspectionDispositionValidator`.

## Gotchas

- **Lot-based, not entity-based.** The Phase-1 per-entity `inboundInspection` was dropped; read
  the `20260419163058` migration (and newer) for the real shape. `receiptLineId` is unique — one
  inspection lot per received line.
- **Inspection-required tracked entities post `On Hold`, not Available.** They are not on-hand
  until released by sampling/disposition.
- **`trackedEntityId` is nullable** on samples; serial uniqueness is enforced by a *partial* index.
- **Don't confuse with inspection *documents*.** `inspectionDocument`/`inspectionFeature`/`balloon`
  + `save_inspection_document_atomic` (`20260526142837`, `20260526153412`) are the first-article /
  ballooned-drawing feature — a separate system from this receiving lot flow.
