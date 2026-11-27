# Untracked draws take stock from the bins that hold it

Date: 2026-11-24. One PR.

## Problem

Several postings take untracked stock out with no bin chosen and book the row at
"no storage unit" (NULL) or at a bin that holds nothing, while another bin holds
the stock. "No bin" goes negative and the real bin keeps its stock. Job issue,
backflush, sales order shipments and picking already choose a bin from stock;
these paths do not. Also: a stock transfer pick never checks that its From bin
still holds the quantity, and an Unconsume returns a serial or batch to an old bin.

## Two rules (shared code, never inlined)

1. **Ordinary stock** (consumption, issue, sale, transfer out):
   `planUntrackedDraw` (`shared.service.ts`): the named bin, else the item's
   nettable default, then the other bins that hold stock, fullest first,
   stripe by stripe. Quarantine (non-nettable) and lineside units are never
   guessed. A document line that names one bin uses `shipmentSourceBinChooser`
   / `chooseSourceBin`.
2. **Nonconforming or returned stock** (NCR Scrap / Return to Supplier, return
   shipments): `planHeldUntrackedDraw` / `chooseHeldStockBin`
   (`@carbon/database/picked-consumption`): the named bin, else held units
   (active, non-nettable, not lineside) first, then the other bins, fullest
   first. That stock is usually set aside in quarantine or a rejected unit.

`BinStock.held` marks a held unit (`getUntrackedBinStock`).

## Tasks

- [x] Shared helpers: `planHeldStockDraw`, `chooseHeldStockBin`
      (pure, `picked-consumption.test.ts`), `planUntrackedDraw`,
      `planHeldUntrackedDraw`, `BinStock.held`.
- [x] Unconsume (`unconsumeTrackedEntities`): the bin and stripe of the unit's
      newest negative Consumption row. `unconsume-tracked-bin.test.ts`.
- [x] Project Issue (`postProjectIssue`, `projects.service.ts`): an untracked
      issue with no bin uses rule 1; a lot's row uses the lot's real bin; the
      Issue modal suggests a bin that holds the stock.
- [x] Stock transfer pick (`postStockTransfer` inventory case,
      `pickUntrackedStockTransferLines`): refuse a pick when the From bin (NULL
      included) holds less untracked stock than the quantity.
- [x] Maintenance spare-part issue (`maintenanceDispatchInventory`): rule 1,
      split across bins.
- [x] Service job part issue (`serviceJobInventory`): rule 1, split across
      bins; `serviceJobUnconsume` returns to the bins the issues drew from.
- [x] Direct sales invoice (`postSalesInvoice`): a line with no bin uses rule 1
      (one bin per line); the void reverses the bin the post used.
- [x] Warehouse transfer outbound shipment (`createDocument`): a line with no
      From bin takes `shipmentSourceBinChooser`.
- [x] Sales and Purchase Return Order shipments: an untracked line with no bin
      takes rule 2 at create; a serial or batch row posts at the bin the unit
      really holds stock in (`getTrackedEntityBins`), as the sales order
      branch does.
- [x] NCR close, untracked Scrap / Return to Supplier not from an inspection
      (`closeIssue`, `quality.service.ts`): rule 2, split across bins.
- [x] Docs: `inventory-system.md`, `.ai/lessons.md`, write-time checklist.
- [ ] Gates: erp typecheck, Biome, `@carbon/checks`, each new database test
      red then green.

## Not in scope

- Blocking or warning on negative stock per location or item (a spec).
- A transfer whose From is "no bin" keeps that From. Moving stock out of no bin
  is a deliberate re-binning. The pick check refuses it only when "no bin"
  holds less than the quantity.
