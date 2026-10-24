# Bugfix run: Average costing wrong for purchased items

- Date: 2026-10-23
- Mode: fully-autonomous
- Request: "do we support average cost (in addition to lifo and fifo) and is it correct?" → "ok fix it"
- Phase plan: root-cause [run, inline in conversation] · instrument [skip — static cause is HIGH] · fix [run] · test [skip — pure posting logic, regression tests cover it] · commit [skip — not asked]

## Decisions

- instrument: skip — cause read directly from code, HIGH confidence.
- browser test: skip — no UI change.
- local DB is down (localhost:54322): database regressions are written but skip; pure tests carry the red→green proof. Did not start the shared stack.
- moving-average formula mirrors complete_job_to_inventory: (prior on-hand × cost + value) / (prior + quantity), cost kept when the result has no stock. Keeps valuation (qty × cost) equal to what the journals booked.
- invoice variance on an Average item: on-hand share (company-wide on-hand, shared across the invoice's lines of the item) to inventory, rest to PPV — the same rule the legacy self-heal path already uses.
- updatePurchasedPrices: stops writing unitCost for Average items only; FIFO/LIFO/Standard behavior unchanged (out of scope).

## Phase log

- root-cause (HIGH): Average outbound uses itemCost.unitCost; PO receipts never update it; updatePurchasedPrices overwrites it with a trailing-12-month Σcost/Σqty over every costLedger row (incl. PO planning rows); invoice variance capitalized fully because Average never draws receipt layers down.

- fix: READY. movingAverageUnitCost + applyAverageCostChanges (shared.service.ts); wired into postReceipt post + void, postPurchaseInvoice post (direct received lines, on-hand write-up) + void; buildPurchaseInvoicePostingLines caps an Average item's write-up at on-hand shared across lines; updatePurchasedPrices skips Average.
- gates: biome PASS · typecheck(erp) PASS · erp vitest (DB URL unset) 2744 passed / 473 skipped. average-cost.test.ts (live DB) written, NOT run — DB down.

## Outcome

- READY, not committed. Known gaps left: existing Average costs not backfilled; asset return-to-inventory at NBV, manual unitCost edits, self-heal void for Average items do not move the average.
