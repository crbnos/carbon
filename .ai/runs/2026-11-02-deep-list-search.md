# Deep list search — run log

## Task 1 spike

```
1:
0
2:
[{"purchaseOrderId":"PO000018","searchText":"po000018|cexq4471|celestialelex|pcbbarerev3|barepcbrev34layer|barepcbrev34layer|batliion48v|liionbatterypack48v100wh|liionbatterypack48v100wh"}]
TERM=liionbatterypack48v100wh
3:
[{"purchaseOrderId":"PO000001"}, 
 {"purchaseOrderId":"PO000008"}, 
 {"purchaseOrderId":"PO000018"}]
4:
[]
[]
5:
0.004640
extra cex:
[{"purchaseOrderId":"PO000018"}]
```

All 5 checks pass. A computed field on the view filters and stays out of select=*. Timing: 0.005 s on the satellite seed.

## Task 2

```
== purchaseOrders
0
[{"id":"po_Exii15aW8yeQ8bHtDcYMKV","searchText":"po000001|proptechsolutions|batliion48v|liionbatterypack48v100wh|liionbatterypack48v100wh|rw010|reactionwheel0010nm|reactionwheel0010nm","searchLines":[{"id": "6WuXT8hDzoX5rpDBEoFJj8", "itemName": "Reaction Wheel 0.010 Nm", "quantity": 4.00000, "partNumber": null, "description": "Reaction Wheel 0.010 Nm", "itemReadableId": "RW-010", "unitOfMeasureCod
== supplierQuotes
0
[{"id":"sq_9iMZwwkmHx47jfPzdzZwyX","searchText":"sq000001|cexq4471|celestialelex|batliion48v|liionbatterypack48v100wh|liionbatterypack48v100wh|cexbat48v|pcbbarerev3|barepcbrev34layer|barepcbrev34layer|cexpcbeps3","searchLines":[{"id": "NiX1HgMq4c9rZY7Hiy3MdG", "itemName": "Bare PCB Rev3 (4-layer)", "quantity": [10, 25, 50], "partNumber": "CEX-PCB-EPS3", "description": "Bare PCB Rev3 (4-layer)", "i
== purchasingRfqs
0
[{"id":"dbk6oaok60gg2m4aapj0","searchText":"prfq000001|celestialelex|proptechsolutions|deepspacerf|batliion48v|liionbatterypack48v100wh|48vliionpackflightqualified|pcbbarerev3|barepcbrev34layer|bareepsboardrev3enigfinish","searchLines":[{"id": "dbk6oaok60gg2m4aapjg", "itemName": "Bare PCB Rev3 (4-layer)", "quantity": [10, 25, 50], "partNumber": null, "description": "Bare EPS board, rev 3 — ENIG 
== purchaseInvoices
0
[{"id":"pi_AMcznLZErwDrdauT7HK18V","searchText":"ap000006|celestialelex|pcbbarerev3|barepcbrev34layer|barepcbrev34layer|po000013","searchLines":[{"id": "9btoMTZCKosQeYgjvdqPtS", "itemName": "Bare PCB Rev3 (4-layer)", "quantity": 40.00000, "partNumber": null, "description": "Bare PCB Rev3 (4-layer)", "itemReadableId": "PCB-BARE-REV3", "unitOfMeasureCode": "EA"}]}]
== salesOrders
0
[{"id":"so_4pDfsYkKfxA2frjsbKnXpf","searchText":"so000001|orbsecdefense|sat1000|espaclasssmallsatbuscomplete|espaclasssmallsatbuscomplete|orbbus4400","searchLines":[{"id": "EEd2PfKZAPySCm5NYj6e9Y", "itemName": "ESPA-Class Smallsat Bus (Complete)", "quantity": 3.00000, "partNumber": "ORB-BUS-4400", "description": "ESPA-Class Smallsat Bus (Complete)", "itemReadableId": "SAT-1000", "unitOfMeasureCode
== quotes
0
[{"id":"quote_CMg1FN4jW9QMSNZE8JS4U3","searchText":"q000001|orbsecdefense|sat1000|espaclasssmallsatbuscomplete|espaclasssmallsatbuscomplete","searchLines":[{"id": "HmU4zLcbsFrVSR5WY8g7Vb", "itemName": "ESPA-Class Smallsat Bus (Complete)", "quantity": [3], "partNumber": null, "description": "ESPA-Class Smallsat Bus (Complete)", "itemReadableId": "SAT-1000", "unitOfMeasureCode": "EA"}]}]
== salesRfqs
0
[{"id":"srfq_De4sWNLEAXLFxcP8f4Grda","searchText":"rfq000001|orbsecdefense|sat1000|espaclasssmallsatbuscomplete|espaclasssmallsatbuscomplete|orbsecsat001","searchLines":[{"id": "ZAkA9AwCHsFoYjKQRscJW", "itemName": "ESPA-Class Smallsat Bus (Complete)", "quantity": [3], "partNumber": "ORBSEC-SAT-001", "description": "ESPA-Class Smallsat Bus (Complete)", "itemReadableId": "SAT-1000", "unitOfMeasureCo
== salesInvoices
0
[{"id":"si_2yJ7dbG75DXcpe1R9ZiGYe","searchText":"ar000005|apexspaceresearch|st050|startracker05arcsec|startracker05arcsec|so000017","searchLines":[{"id": "SPC2dKxMaPSACaVy5KDgXF", "itemName": "Star Tracker 0.5 arcsec", "quantity": 1, "partNumber": null, "description": "Star Tracker 0.5 arcsec", "itemReadableId": "ST-050", "unitOfMeasureCode": "EA"}]}]
PGRST205
> tsx src/scripts/check-clobbers.ts

No clobber risks vs origin/main (merge-base 1ea7ba150).
clobbers exit: 0
```

## Task 3

generate:types ran. purchaseOrderLinesToReceive in types.ts: 0. searchLines in types.ts: 10.

## Task 10

Commands:

| Command | Result |
|---|---|
| `pnpm exec turbo run typecheck --filter=erp` | pass (2 tasks successful) |
| `pnpm exec biome check` on the 23 changed or new TS files | pass, no errors (5 warnings in older code this branch does not touch) |
| `vitest run app/utils/search.test.ts app/modules/inventory/inventory.utils.test.ts` | pass, 24 tests |
| `vitest run test/database/create-receipt-draft-reuse.test.ts` | pass, 1 test |
| `pnpm --filter @carbon/checks test` | pass, 406 tests (after `pnpm --filter @carbon/config build`) |
| `pnpm --filter @carbon/content test` | pass, 15 tests |

Browser checks (satellite seed, ERP on localhost:3000):

| # | Result |
|---|---|
| 1 | pass. PO000018 shows, its row is open, and "Battery" is marked on BAT-LIION-48V. |
| 2 | pass. A PO000005 line set to BRK514 by API; "brk-514" finds PO000005 and marks BRK514. The value was reset afterwards. |
| 3 | pass on all 8 lists (an item id from the newest document's lines). Each matching row opens. |
| 4 | pass on all 8 lists. The document number finds 1 row, and the row does not open. |
| 5 | pass on all 8 lists. No rows show (exact count 0). The header still reads "1 row": the `estimated` count gives the planner's estimate for an empty result. This happens with the old search too (`purchaseOrderId=ilike.*zzqq*` also gives `*/1`), so this branch did not cause it. |
| 6 | pass. "ORB BUS 4400" on Sales Orders finds SO000001. |
| 7 | skipped: no invoicing-only user in the seed. Verified by code: with no search the services add no filter, and the party joins are LEFT JOINs. |
| 8 | pass. `/x/purchasing/orders.data` with no search has no `searchText` and no `searchLines`, and the table has no Expand column. With a search, `searchLines` is in the response. |
| 9 | skipped: the seed has fewer than 100 matches for any search. |
| 10 | skipped: the CSV export runs as a background job. Verified by code: the export writes only the columns the browser sends. |
| 11 | pass. `/x/inventory/receiving` is the 404 page, and the Inventory nav has no Receiving link. |
| 12 | pass. List right-click Receive on PO000018 opens the Draft receipt RE000007, and the order keeps 1 receipt. After a receipt exists, the PO page shows no Receive button (behavior before this branch). |
| 13 | pass. Receive on PO000018 with no receipt created RE000007. |
| 14 | pass. A closed row stays closed; after the search changes, every matching row opens again. |

## Review fixes

Typecheck pass. Biome pass (23 files). Unit tests 24 pass. Database tests 5 pass (`deep-list-search.test.ts` 4, `create-receipt-draft-reuse.test.ts` 1). `@carbon/checks` 406 pass. Clobbers: none. Browser: AP000006 found by PO000013 opens to its line with the order number marked; Purchase Orders with no search has no Expand column.
