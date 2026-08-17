# Plan ahead

> Orders and forecast become jobs and POs.

Creating that first job created demand. Carbon now knows it needs structural frames, battery packs, and machine time. But your sales orders only show part of the picture. The pipeline says more satellite buses are coming, even though no order exists yet.

Planning on confirmed orders alone means you're always reacting. Carbon lets you plan on what you expect, too — and lets each part decide for itself how aggressively to replenish.

## Demand forecasting

Under Production, open Projections and enter what you expect to need in the coming weeks. Here, the pipeline points to two SAT-1000 satellite buses a week for the next fortnight, climbing to four a week by week six, and to the subsystems that ride with them: ADCS-001 and EPS-001. That's real demand with no order behind it yet. Forecasting puts it into the plan anyway.

## Reordering policy

Not every part should wait for demand to pull it. A fast-moving fastener wants a standing buffer; a custom casting wants to be ordered only when a job needs it. Each part carries a reordering policy that tells planning exactly which behavior to use:

- Manual Reorder: planning stays hands-off. You decide when to order. Good for the parts a human should always eyeball.
- Demand-Based Reorder: order just what demand needs, when it needs it, grouped into a demand accumulation period so a week of small pulls becomes one sensible order.
- Fixed Reorder Quantity: when on-hand falls to the reorder point, order a fixed reorder quantity. Predictable, supplier-friendly batch sizes.
- Maximum Quantity: when on-hand falls to the reorder point, top back up to the maximum inventory quantity. Classic min/max for shelf stock.

A part set to Buy turns a replenishment into a purchase order; set to Make, it turns into a job. The reorder quantity and the minimum / maximum order quantities round the raw number into something you can actually order or build.

## Into jobs & POs

Now Carbon turns the whole picture (orders, forecast, and each part's policy) into the work that fulfills it. It nets demand against what you already have (on-hand stock plus open jobs and purchase orders) and proposes the difference: `docs/reference/planning` suggests the jobs to build, purchasing planning suggests the purchase orders to raise.

Purchasing planning applies conversion factors as it goes, so a satellite's worth of demand becomes the right quantity in the units you actually buy. Nothing is committed until you confirm a suggestion. That's the moment a proposed line becomes a real job or a real PO.

Run different plans for different sites, and let each part replenish the way that site needs: full demand-driven planning in one, simple min/max for high-runners in another.

## Receiving

When a purchase order arrives, you receive it. A receipt starts as a Draft against the PO, auto-fills its lines from what was ordered, and validates the quantities; posting it turns the goods into on-hand stock on a shelf.

For a batch-tracked part like the BAT-LIION-48V battery packs, Carbon captures the batch number right on the receipt line, and a conversion factor converts what you bought into what you stock, so a case of ten packs becomes ten units on the shelf. Months later, you can answer exactly which lot of packs went into which satellites.
