---
paths: []
triggers: []
promoted: null
---
# A posting that moves held stock must say it is the release

**Context:** The goods-in inspection hold is one statement handler on `itemLedger` (`check_inspection_hold`) plus BEFORE interceptors on `inspection`, `trackedEntity`, `storageUnit`, `location` and `nonConformance`.

**Problem:** A posting that moves stock out of an inspection unit without `setInspectionRelease` is refused with "held for inspection". The quick way out was to set `app.sync_in_progress`, which also switches the hold off. But that flag also stops the event queue, the contact and address sync handlers, the kanban and PMI queues and `queue_model_pipeline`. A company restore set it for its whole load and silenced all of them.

**Rule:** The release flag covers only the write that IS the release: run it through `withInspectionRelease(trx, fn)` (the lot's decision, the NCR's close, a void's cancelled lots), and let the stock moves that follow run with the guard on. A decided lot holds nothing, so the guard lets its stock go and still refuses what another lot holds. A flag left on for a whole posting let an NCR close scrap units of an open lot and a void drain another receipt's held stock. `setInspectionRelease(trx)` for a whole transaction is only for a posting that records reality (a count) or re-checks the hold itself (a return shipment). Never set `app.sync_in_progress` only to get past the hold or to silence events. A company restore or import sets `app.inspection_release` in its load transaction. A posting that runs under the release flag but must not take an open lot's stock checks that itself (`refuseShippingOpenLotStock`).

**Applies to:** Any new posting that writes negative `itemLedger` rows in a non-nettable unit; `company-restore.ts`, `company-import.ts`; every hold interceptor (each honours both flags).
