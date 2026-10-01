# Verification run: Revenue recognition Phase B — fleet bridge (Task 31 browser verification)

- Date: 2026-09-22 (app/DB clock: 2026-09-23 UTC)
- Branch: revenue-recognition-rentals-spec
- Commit: 9d2cf1fcab (HEAD at the time the browser run started; 7cf5f42130 when the task was handed over)
- URL: https://erp.revenue-recognition-rentals-spec.dev (company "Carbon Development", timezone UTC)
- Mode: verify only — no code changes, no DB writes outside the UI; SQL cross-checks are read-only via `pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -tAc`
- Plan: `.ai/plans/2026-09-22-revenue-recognition-and-rentals.md` Task 31; spec `.ai/specs/2026-09-22-revenue-recognition-and-rentals.md` §2; rule `.claude/rules/fixed-asset-lifecycle.md`
- Browser: isolated `agent-browser` session `AGENT_BROWSER_SESSION=revrec-lagos-b`, dev-bypass login as test@carbon.ms
- Environment note: the ERP Vite dev server (pid 27897, `crbn up --all --no-migrate --no-regen`) was mid cold-compile when the run started; `/login` returned no bytes for ~50 min (99 % CPU in rolldown workers) and the first request completed after 294 s, after which the app answered in ~0.1 s.

## Environment note (read first)
The machine restarted after check (b) and the Docker restart recreated the Postgres volume: the company was **re-seeded** (new company id `dapj4unle0g0282krg10`, default seed data only). Checks (a) and (b) and the first W-1 registration were verified against the live database BEFORE the loss and are kept exactly as recorded, but every id in those sections is gone. Check (c) was redone from the beginning and checks (c)–(f) ran on the re-seeded company with new ids (see "ENVIRONMENT RESET" inside check (c) for the SQL proof). Nothing was restored or written outside the UI.

## Starting state (SQL, before any check)
- `companySettings`: accountingEnabled = t, revenueRecognitionEnabled = t (Phase A left it on)
- Asset classes (id | name | isCIP | life | residual % | asset acct | accum acct):
```
dapa1q7520gg2acvqpj0|Buildings|f|468|0|1360|1330
dapgg5v520gghv4vrgc0|Construction in Progress|t|120|0|1390|1330
dapa1q7520gg2acvqpjg|Machinery & Equipment|f|120|0|1350|1330
dapgg5v520gghv4vrgbg|Rental Fleet|f|60|20|1370|1380
dapa1q7520gg2acvqpk0|Vehicles|f|60|0|1310|1330
```
- Accounts: 1210 Raw Materials, 1220 Finished Goods, 1230 Work In Progress (WIP), 1330 Accumulated Depreciation, 1350 Machinery & Equipment, 1370 Rental Fleet, 1380 Accumulated Depreciation – Rental Fleet, 1390 Construction in Progress, 4140 Gain on Disposal, 6310 Depreciation Expense, 6320 Loss on Disposal. Account defaults: WIP 1230, labor absorption 5060, finished goods 1220, raw materials 1210.
- Fixed assets: 4 seeded (FA000001 Clean Room HVAC Active/Buildings 85,000; FA000002 CMM Active/M&E 240,000; FA000003 5-Axis CNC Draft; FA000004 Delivery Van Fully Depreciated/Vehicles 48,000/48,000). `fixedAssetTransfer` 0 rows, `fixedAssetCipCost` 0 rows.
- Journals: 5 (the Phase A set); no `Asset Transfer` journals; NO journal lines on 1230 at all (no job carries WIP yet).
- Depreciation runs: `DR000001` 2026-08-31 **Draft** (seeded).
- Accounting periods: Jan–Dec 2026 exist; Oct 2026 `Locked` (Phase A), the rest Open.
- Serialized items: `RW-010` Reaction Wheel 0.010 Nm (Buy, FIFO, standardCost 14,500; on hand 4 at Manufacturing Plant bin `sh_PhVKpG9VyRCJp7tZFQ2vfa`; Available serials RW010-SN-0051/0052/0053) and `SAT-1000` (Make). `itemSerialSequence`: 0 rows.
- Jobs: J000001 In Progress (SAT-1000 ×3), J000002 Ready (SAT-1000), J000003 Planned, J000004 Draft, J000005 Paused, J000006 Completed, J000007 Closed, J000008 Cancelled — all linked to sales-order lines, so none can be attached to an asset.
- Work centers (labor rate): Clean Room Bay A 95, CNC Mill 85, PCB Lab 90, Potting Station 65, QC Bench 70, TIG Welder Cell 75, TVAC Chamber 1 70.

## Check (a) — Make to Asset (job → two Rental Fleet assets)

### Setup (all through the UI)
- `/x/part/new`: Part ID `VEH-100`, Short Description "Fleet Vehicle 100", Replenishment System **Make** (Default Method Type auto-switched to Make to Order), Tracking Type **Serial**, UoM Each → `requestSubmit` Save → redirected to `/x/part/item_NWaXeMjbnaHKrL36eduEKv/details`. SQL: `item_NWaXeMjbnaHKrL36eduEKv|VEH-100|Serial|Make|Make to Order|t`; make method `make_GVuQSSv8qzQGVgvPj7kfoT` V1 (Active switch on).
- Bill of Process: on `/x/part/<id>/make/<makeMethodId>` → "Add Operation" (inline editor) → Process **MACHINING** (Operation Type Process, description "Machining"), Work center **CNC MILL** (labor 85 / machine 120 per h) → `requestSubmit` Save. SQL: `methodOperation JYy6y9xjuEFoUh2JYefYv|Machining|Process|wc_42raRQhQKfGvCnm35hYG98`. (On the `/details` route the "Add Operation" button does nothing; it works on the `/make/<id>` route. After a history-back the make route rendered "Looks empty here" for the Bill of Process although the row existed — stale client data, unrelated to Phase B.)
- Serial sequence (needed so a 2-unit serial job splits into two numbered units): `/x/settings/serial-numbers/new` → Item `VEH-100 Fleet Vehicle 100`, Prefix `VEH100-`, Current 0, Size 5, Step 1 → Save → list shows `VEH-100 | Fleet Vehicle 100 | VEH100- | 0 | 5 | 1`. SQL: `item_NWaXeMjbnaHKrL36eduEKv|VEH100-|0|5|1`.
- Job: `/x/job/new` → Item `VEH-100`, Quantity 2 (hidden `quantity=2` verified), Location MANUFACTURING PLANT, **Complete To** select (options Inventory / Fixed Asset Class / Asset Under Construction) → **Fixed Asset Class**, then the **Fixed Asset Class** select (options Buildings / Machinery & Equipment / Rental Fleet / Vehicles — the CIP class is correctly hidden) → **Rental Fleet**. Hidden inputs before submit: `quantity=2 completeTo=class fixedAssetClassId=dapgg5v520gghv4vrgbg fixedAssetId= itemId=item_NWaXeMjbnaHKrL36eduEKv`. `requestSubmit` Save → after ~10 s redirected to `/x/job/job_55XBSqZ2tGswDmzduS7Zvw/details`, heading **J000009**, Bill of Process shows "Machining".
- SQL job: `job_55XBSqZ2tGswDmzduS7Zvw|J000009|Draft|2|dapgg5v520gghv4vrgbg(Rental Fleet)|fixedAssetId NULL|loc_DL9rttXaZ26sR2PvLzXxuR`; serial units created at job creation: `uw0LFJn5cUlZ5KShZQEF1|VEH100-00001|Reserved|1`, `QhaC1MqxehP7E0q4e7M0t|VEH100-00002|Reserved|1` (both `{"Job": job_55XB…, "Job Make Method": jmm_8EyLyuaQNbjyJhZDu7W6GZ}`); `jobMakeMethod jmm_8EyLyuaQNbjyJhZDu7W6GZ requiresSerialTracking=t`; operation `jo_7WYdBoX3CacKxzr7K4rEs9|Machining|Todo|CNC Mill|laborRate 85|machineRate 120`.
- Release: job page "Release" → dialog "Release Job J000009" → `requestSubmit` "Release Job" (`action=/x/job/job_55XB…/status?schedule=1`) → header now shows Pause / Release (disabled) / Complete / Cancel. SQL: `J000009|Ready`, operation `Ready`. The Make to Asset release gate accepted the serialized 2-unit job.
- WIP: `/x/job/job_55XB…/events/new` ("Create Production Event") → Operation `Machining`, Work Center `CNC MILL`, Event Type Labor, Start 9/22/2026 8:00 AM, End 9/22/2026 10:00 AM (segment fills; hidden `startTime=2026-09-22T12:00:00.000Z endTime=2026-09-22T14:00:00.000Z`, browser is UTC−4) → `requestSubmit` Save → redirected to `/x/job/job_55XB…/events`, row `Machining | VEH-100 | LABOR | 2 hours | CNC MILL | 9/22/26 8:00 AM | 9/22/26 10:00 AM`. SQL: `productionEvent pe_K67zpBADJ9AtaUBcFG8Vi6|Labor|duration 7200 s|wc_42raRQhQKfGvCnm35hYG98`; the route invoked `post-production-event` synchronously — journal `je_TbjzVSYW6tWGCkyQ19ZdeG` (Production Event):
```
je_TbjzVSYW6tWGCkyQ19ZdeG|1230|Work In Progress (WIP)      | 170|WIP Account             |Production Event|job_55XBSqZ2tGswDmzduS7Zvw
je_TbjzVSYW6tWGCkyQ19ZdeG|5060|Labor & Machine Absorption  |-170|Labor/Machine Absorption|Production Event|job_55XBSqZ2tGswDmzduS7Zvw
```
  → the job carries WIP 170.00 (2 h × 85/h) before completion.

### Completion
- Job page → "Complete" → dialog text (innerText): `Receive J000009 to Inventory | This job will be received to inventory. It will no longer be available on the shop floor. | Completes to fixed asset class dapgg5v520gghv4vrgbg | Quantity Completed [2] | Serial numbers received | VEH100-00001, VEH100-00002 | Cancel | Complete Job` — no location / bin pickers (hidden `locationId=loc_DL9rttXaZ26sR2PvLzXxuR`, `storageUnitId=` empty). UI observations: the dialog title and body still say "Receive … to Inventory / will be received to inventory" for a Make to Asset job, and the target class is shown as its **raw id** (`dapgg5v520gghv4vrgbg`) rather than "Rental Fleet".
- `requestSubmit` "Complete Job" (`action=/x/job/job_55XB…/complete`) → job header reads `J000009 | COMPLETED`, Pause/Release/Complete/Cancel all disabled.
- SQL job: `J000009|Completed|quantity 2|quantityComplete 2|quantityReceivedToInventory 2|completedDate 2026-09-23 01:29:11+00`.
- SQL fixed assets (id | readable | name | serial | status | class | cost | acqDate | depStart | method | life | residual | location | entity | qty):
```
dapimpv520gi6v4vs3d0|FA000005|Fleet Vehicle 100 VEH100-00001|VEH100-00001|Active|Rental Fleet|85.00|2026-09-23|2026-09-23|Straight Line|60|20|loc_DL9rttXaZ26sR2PvLzXxuR|uw0LFJn5cUlZ5KShZQEF1|1
dapimpv520gi6v4vs3dg|FA000006|Fleet Vehicle 100 VEH100-00002|VEH100-00002|Active|Rental Fleet|85.00|2026-09-23|2026-09-23|Straight Line|60|20|loc_DL9rttXaZ26sR2PvLzXxuR|QhaC1MqxehP7E0q4e7M0t|1
```
  → two Active Rental Fleet assets at 85.00 each = the job's WIP 170.00 ÷ 2 units; class method / life / residual copied; location = the job's.
- SQL transfers:
```
fatr_JgTefGh9VeeG3UnQ9REfg3|FAT000001|Capitalization|Job|FA000005 (dapimpv520gi6v4vs3d0)|item VEH-100|uw0LFJn5cUlZ5KShZQEF1|job_55XB…|loc_DL9r…|1|2026-09-23|85.00|je_VcVmrpSY8UJRJjG23hSd2p|Posted
fatr_LoYmbcZNkqAEFZbu2sUWT7|FAT000002|Capitalization|Job|FA000006 (dapimpv520gi6v4vs3dg)|item VEH-100|QhaC1MqxehP7E0q4e7M0t|job_55XB…|loc_DL9r…|1|2026-09-23|85.00|je_VcVmrpSY8UJRJjG23hSd2p|Posted
```
- SQL journal: `je_VcVmrpSY8UJRJjG23hSd2p|Asset Transfer|Job Completion to Fixed Asset J000009|postingDate 2026-09-23|ap_MuaZV81rC8aXmjKaTN5Ae5 (Sep 2026)`; lines (amount natural-balance signed):
```
je_VcVmrpSY8UJRJjG23hSd2p|1230|Work In Progress (WIP)|Asset|-170|WIP Account |Asset Transfer|job_55XBSqZ2tGswDmzduS7Zvw|job:job_55XBSqZ2tGswDmzduS7Zvw
je_VcVmrpSY8UJRJjG23hSd2p|1370|Rental Fleet          |Asset| 170|Fixed Asset |Asset Transfer|job_55XBSqZ2tGswDmzduS7Zvw|job:job_55XBSqZ2tGswDmzduS7Zvw
```
  → **Dr 1370 Rental Fleet 170.00 / Cr 1230 WIP 170.00**, source type Asset Transfer, both lines `documentId = jobId`. Net by account for `documentId = job_55XB…`: `1230 → 0`, `1370 → 170`, `5060 → −170` — the job's WIP balance nets to zero.
- SQL tracked entities: `uw0LFJn5cUlZ5KShZQEF1|VEH100-00001|Consumed|1|{"Job": …, "Fixed Asset": "dapimpv520gi6v4vs3d0", …}`, `QhaC1MqxehP7E0q4e7M0t|VEH100-00002|Consumed|1|{…"Fixed Asset": "dapimpv520gi6v4vs3dg"…}`; `trackedActivity` `Bo61vwjaCk7VmYTG565ab|Capitalize|Fixed Asset|dapimpv520gi6v4vs3d0|FA000005` and `eZxONGVdGwQmq63JufX0J|Capitalize|Fixed Asset|dapimpv520gi6v4vs3dg|FA000006`, each with the unit as its `trackedActivityInput` (qty 1).
- SQL inventory: `itemLedger` 0 rows, `costLedger` 0 rows, `pickMethod` 0 rows for VEH-100; `itemCost.unitCost` untouched (NULL, FIFO) — VEH-100 on-hand unchanged (never entered stock).

**Check (a) result: PASS** — two Active Rental Fleet assets FA000005 / FA000006 at 85.00 each (WIP 170 ÷ 2), transfers FAT000001 / FAT000002 (Capitalization / Job, Posted), journal `je_VcVmrpSY8UJRJjG23hSd2p` Asset Transfer Dr 1370 170 / Cr 1230 170, both units Consumed with the `Fixed Asset` attribute and a Capitalize activity, no inventory movement. UI nits: complete dialog shows the raw class id and "Receive … to Inventory" wording.

## Check (b) — Capitalize a stocked serialized unit from the item inventory page

### Prerequisite (no real serial stock existed)
- Starting state: NO `itemLedger` row in the company carries a `trackedEntityId` (the seeded RW-010 serials RW010-SN-0051/52/53 are `Available` tracked entities with no ledger or cost rows; RW-010's on-hand 4 is one untracked `Positive Adjmt.` row) — so the storage-unit table showed one aggregated row `A2-L2 | 4` with no Tracking ID and no "Capitalize as Fixed Asset" action. A unit had to be put into stock through the UI first.
- `/x/part/item_Qr9PVVG5FuJrgVkGXWwjw7/costing` ("Costing & Posting"): Unit Cost `$0.00` → `14500` (fill + Tab; hidden `unitCost=14500`, costingMethod FIFO) → `requestSubmit` Save → field shows `$14,500.00`, toast. SQL `itemCost`: `14500|14500.00000|FIFO`.
- `/x/part/item_Qr9P…/inventory` → "Update Inventory" → modal "Inventory Adjustment": Location MANUFACTURING PLANT (read-only), Storage Unit `A2-L2 Aisle-A`, Adjustment Type `Positive Adjustment`, Serial Number `RW010-SN-0061`, Quantity 1 (locked for a serial). Hidden: `trackedEntityId=odlynOciy-gi9U-v8e4mC readableId=RW010-SN-0061 adjustmentType=Positive Adjmt. quantity=1 storageUnitId=sh_PhVKpG9VyRCJp7tZFQ2vfa locationId=loc_DL9rttXaZ26sR2PvLzXxuR requiresSerialTracking=true` → `requestSubmit` Save (`action=/x/inventory/quantities/<item>/adjustment`) → page now `/x/inventory/quantities/item_Qr9P…/details`, Quantity on Hand **5**, Storage Units rows `A2-L2 | 4 | (no tracking id)` and `A2-L2 | 1 | RW010-SN-0061` (with its own Actions menu).
- SQL: entity `odlynOciy-gi9U-v8e4mC|RW010-SN-0061|Available|1|Item|item_Qr9P…`; `itemLedger il_MmEkJYwYgPrQjRTyRm3T5p|Positive Adjmt.|qty 1|trackedEntityId odlynOciy-gi9U-v8e4mC|sh_PhVKpG9VyRCJp7tZFQ2vfa|2026-09-23`; `costLedger cl_XyXUnu4ecSCJ74FKZRdvKg|Direct Cost|qty 1|cost 14500|remaining 1`; adjustment journal `je_KwCEr1FgErdM4xGVGucMvL|Inventory Adjustment`: Dr 1210 Raw Materials 14,500 / Cr 5310 Inventory Adjustment 14,500. RW-010 is a **Buy** item, so its inventory account is 1210 Raw Materials (not 1220).

### Capitalize
- Row action: the `A2-L2 | 1 | RW010-SN-0061` row's Actions menu lists `Update Quantity | Print Label | Capitalize as Fixed Asset -> /x/fixed-asset/capitalize?itemId=item_Qr9PVVG5FuJrgVkGXWwjw7&trackedEntityId=odlynOciy-gi9U-v8e4mC&locationId=loc_DL9rttXaZ26sR2PvLzXxuR&storageUnitId=sh_PhVKpG9VyRCJp7tZFQ2vfa` (the aggregated untracked row has no Capitalize item). Automation note: `agent-browser click` on the row's "Actions" button did not open this Radix dropdown (aria-expanded stayed false); it opened with synthetic pointer events via `eval`, and the same URL was then opened directly.
- Modal "Capitalize as Fixed Asset" (`/x/fixed-asset/capitalize?…`): `Item RW-010 — Reaction Wheel 0.010 Nm | Serial Number RW010-SN-0061 | Estimated Cost $14,500.00 | The unit leaves stock and becomes an asset at its carrying cost… | Asset Class [Rental Fleet] (preselected) | Name [Reaction Wheel 0.010 Nm RW010-SN-0061] | Transfer Date 9/23/2026`. Hidden inputs: `itemId=item_Qr9P… trackedEntityId=odlynOciy-gi9U-v8e4mC locationId=loc_DL9r… storageUnitId=sh_PhVK… fixedAssetClassId=dapgg5v520gghv4vrgbg transferDate=2026-09-23`. `requestSubmit` "Capitalize" → toast, redirect to `/x/fixed-asset/dapiq2f520gid8kvs3j0`.
- Asset page text: `FA000007 | ACTIVE | Acquisition Cost $14,500.00 | Accum. Depreciation $0.00 | Net Book Value $14,500.00 | Name Reaction Wheel 0.010 Nm RW010-SN-0061 | Asset Class RENTAL FLEET | Serial Number RW010-SN-0061 | Location MANUFACTURING PLANT | Work Center — | Straight Line | 60 months | Residual 20% | Acquisition Date Sep 23, 2026 | Depreciation Start Sep 23, 2026 | Transfers: FAT000003 CAPITALIZATION INVENTORY Sep 23, 2026 View $14,500.00`.
- SQL asset: `dapiq2f520gid8kvs3j0|FA000007|Reaction Wheel 0.010 Nm RW010-SN-0061|RW010-SN-0061|Active|Rental Fleet|14500|2026-09-23|2026-09-23|loc_DL9r…|item_Qr9P…|odlynOciy-gi9U-v8e4mC|qty 1`
- SQL transfer: `fatr_YcKo71n1T5d7z2WTWa7YX2|FAT000003|Capitalization|Inventory|dapiq2f520gid8kvs3j0|item_Qr9P…|odlynOciy-gi9U-v8e4mC|jobId NULL|loc_DL9r…|sh_PhVK…|1|2026-09-23|14500|je_9AyUJUPpeUJqtC8BdvVbat|Posted`
- SQL journal `je_9AyUJUPpeUJqtC8BdvVbat|Asset Transfer|Capitalize RW-010 RW010-SN-0061 → FA000007|2026-09-23`:
```
1210|Raw Materials|-14500|Raw Materials Account     |Asset Transfer|fatr_YcKo71n1T5d7z2WTWa7YX2
1370|Rental Fleet | 14500|Fixed Asset Acquisition   |Asset Transfer|fatr_YcKo71n1T5d7z2WTWa7YX2
```
  → **Dr 1370 Rental Fleet 14,500 / Cr 1210 Raw Materials 14,500** at the unit's carrying cost (RW-010 is a Buy item → raw-materials inventory account; 1220 would apply to a made item).
- SQL ledgers: `itemLedger il_RXo5zeKcWwHeUh5WA8NuG9|Negative Adjmt.|Asset Transfer|fatr_YcKo…|-1|odlynOciy-gi9U-v8e4mC|sh_PhVK…|2026-09-23`; on-hand Σ = **4** (5 → 4); `costLedger cl_XfjyJkRAe6hoR2QXnr5pBs|Direct Cost|Asset Transfer|-1|-14500` consuming layer `cl_XyXUnu4ecSCJ74FKZRdvKg` (remaining 1 → 0).
- SQL entity: `odlynOciy-gi9U-v8e4mC|RW010-SN-0061|Consumed|1|{"Fixed Asset": "dapiq2f520gid8kvs3j0", …}`; activity `3SIfLwSt8Z88LI-X6dAvT|Capitalize|Fixed Asset|FA000007|inputs odlynOciy-gi9U-v8e4mC`.

**Check (b) result: PASS** — FA000007 Active in Rental Fleet at 14,500 with the serial, Dr 1370 / Cr 1210 at carrying cost, on-hand −1, entity Consumed, transfer FAT000003 Posted. (Precondition: the seeded serials had no ledger rows, so a unit was adjusted in through the UI first — see above.)

## Check (c) — Construction in Progress (W-1)

### Create + register in the CIP class
- `/x/accounting/fixed-assets/new` ("New Fixed Asset" modal): Name `W-1`, Asset Class **CONSTRUCTION IN PROGRESS** (options BUILDINGS / CONSTRUCTION IN PROGRESS / MACHINERY & EQUIPMENT / RENTAL FLEET / VEHICLES); the class filled Straight Line / 120 months. Hidden `fixedAssetClassId=dapgg5v520gghv4vrgc0`. `requestSubmit` Save → toast "Fixed asset created", redirect `/x/fixed-asset/dapiqtf520giencvs3mg`.
- Asset page text: `FA000008 | DRAFT | Acquisition Cost $0.00 | … | Name W-1 | Asset Class CONSTRUCTION IN PROGRESS | … | Useful Life 120 months | Residual Value 0% | Acquisition Date — | Depreciation Start — | Construction in Progress: "No cost has been recorded against this asset yet."` (the CIP card renders for a CIP-class asset).
- `/x/fixed-asset/dapiqtf520giencvs3mg/register` ("Register Existing Asset" drawer): cost 0 was refused — form errors **"Acquisition cost must be positive"** and **"Depreciation start date is required"** (the latter even for a CIP asset that will not depreciate — UI observation). Registered with Acquisition Cost `500`, Acquisition Date 9/23/2026, Depreciation Start Date 9/23/2026 (hidden `acquisitionCost=500 acquisitionDate=2026-09-23 accumulatedDepreciation=0 depreciationStartDate=2026-09-23` verified before `requestSubmit` "Register"). The drawer sat on "Loading" for ~10 s (the dev server was recompiling) but the write had landed.
- SQL asset: `FA000008|Under Construction|acquisitionCost 500|acquisitionDate 2026-09-23|depreciationStartDate 2026-09-23` → a CIP-class registration lands at **Under Construction**.
- SQL journal `je_J9nDqfgxKPVMxsH2kuWwA5|Manual|Asset Registration: FA000008|2026-09-23`:
```
1390|Construction in Progress|500|Capitalize fixed asset at cost
3100|Retained Earnings       |500|Direct asset registration (owner equity)
```
  → Dr 1390 CIP 500 / Cr 3100 Retained Earnings 500 (the ordinary registration entry, but into the CIP asset account).
- SQL CIP cost row #1: `facc_LbSNoFHPppvrPnfaDsuMF9|dapiqtf520giencvs3mg|Manual|amount 500|costDate 2026-09-23|journal je_J9nDqfgxKPVMxsH2kuWwA5`.

### ENVIRONMENT RESET (between the registration above and the attach-job step)
The machine restarted mid-run and the stack came back with a **re-seeded database** (Postgres container age 2 min at 02:01 UTC, `.env.local` rewritten 21:58 local; same ports/URLs). SQL on the fresh DB at 02:01 UTC: company `dapj4unle0g0282krg10|Carbon Development|accountingEnabled t|revenueRecognitionEnabled f` (the id was `dapa1q7520gg2acvqpfg` before, and Phase A had left the toggle ON); `item WHERE readableId='VEH-100'` → 0; `itemSerialSequence` → 0; jobs J000001–J000008 only (no J000009); `fixedAsset` → only the seeded FA000001–FA000004 with NEW ids (`dapj4unle0g0282krgjg…`); `fixedAssetCipCost` 0; `fixedAssetTransfer` 0; `journal` 1 row (the seeded ORBSEC entry, now dated 2026-01-10); no accounting periods from Phase A (October is no longer Locked). The `fleetAssets` view now also exposes `rentalAgreementId`, `customerId`, `customerLocationId` (rental migrations applied).

Consequence: every id recorded for checks (a), (b) and the W-1 registration above (FA000005–FA000008, FAT000001–3, `je_VcVm…`, `je_9AyU…`, `je_J9nD…`, `facc_LbSN…`) **no longer exists**. Those sections stand as observations that were cross-checked against the live database at the time; they are not reproducible from the current DB. Nothing was restored or reset by this run. The remaining checks re-create only the prerequisites they need through the UI, on the fresh seed, and re-record ids from scratch below.

### (c) redone from the beginning on the re-seeded company
- Pre-check (SQL at 02:01 UTC, fresh seed): classes `Buildings|1360/1330`, `Construction in Progress|1390/1330|120 mo`, `Machinery & Equipment|1350/1330|120 mo`, `Rental Fleet|1370/1380|60 mo|20 %`, `Vehicles|1310/1330`; accounts 1370/1380/1390 present; `depreciationRun` = seeded `DR000001 2026-08-31 Draft`; `accountingPeriod` 0 rows; `/x/accounting/asset-classes` lists BUILDINGS · CONSTRUCTION IN PROGRESS · MACHINERY & EQUIPMENT · RENTAL FLEET · VEHICLES.
- **Seed gap found:** on the fresh seed the "Construction in Progress" class row had `isConstructionInProgress = f` (all five classes `f`, created by `system` at 01:59:22 by the dev bootstrap; `functions/lib/seed.data.ts` line 972 sets `true` for the onboarding `seed-company` path, so this is a dev-bootstrap-only gap). The class edit form (`/x/accounting/asset-class/<id>`, "Edit Asset Class") has **no control for the flag** (fields: Name, Description, Depreciation Method, Useful Life, Residual %, seven account pickers), so it cannot be repaired from the UI. The coordinator set the flag directly (out of band, before any W-1 registration on this DB); SQL now reads `dapj4unle0g0282krg6g|Construction in Progress|t`. No other data was touched.
- **W-1 (again, fresh DB):** `/x/accounting/fixed-assets/new` → Name `W-1`, Asset Class CONSTRUCTION IN PROGRESS (hidden `fixedAssetClassId=dapj4unle0g0282krg6g`, method Straight Line, life 120) → Save → `/x/fixed-asset/dapj8fnle0g08u2ks090`, page `FA000005 | DRAFT | … | Construction in Progress: No cost has been recorded against this asset yet.` (Automation note: the first submit lost the typed values on a modal re-render and the form answered "Name is required"; re-filled and submitted with a verify-then-submit eval.)
- Register (`/x/fixed-asset/dapj8fnle0g08u2ks090/register`): Acquisition Cost 500, Acquisition Date 9/23/2026, Depreciation Start Date 9/23/2026 (the drawer still requires both a positive cost and a depreciation start date for a CIP asset). Hidden `acquisitionCost=500 acquisitionDate=2026-09-23 accumulatedDepreciation=0 depreciationStartDate=2026-09-23` verified, `requestSubmit` Register → asset page: `FA000005 | UNDER CONSTRUCTION | Acquisition Cost $500.00 | Accum. Depreciation $0.00 | Net Book Value $500.00 | … | Acquisition Date Sep 23, 2026 | Depreciation Start Sep 23, 2026 | Construction in Progress: Sep 23, 2026 MANUAL — View $500.00 | Total $500.00`. (Automation note: `agent-browser fill` on the react-aria money field committed `0.01` once; the value was set through the visible input with the native value setter + blur, and the eval refused to submit until the hidden inputs read exactly 500 / 2026-09-23 / 0 / 2026-09-23.)
- SQL asset: `FA000005|Under Construction|500|2026-09-23|2026-09-23|locationId NULL`.
- SQL journal `je_RJyrC4P7VchJruZonNmv7q|Manual|Asset Registration: FA000005|2026-09-23`:
```
1390|Construction in Progress|500|Capitalize fixed asset at cost
3100|Retained Earnings       |500|Direct asset registration (owner equity)
```
- SQL CIP cost row #1: `facc_85qccrJvrd1PUt7gqjcrp5|dapj8fnle0g08u2ks090|Manual|amount 500|costDate 2026-09-23|journal je_RJyrC4P7VchJruZonNmv7q`.

### Job with WIP to attach (fresh DB)
- Item: `/x/part/new` → Part ID `W1-ASSY`, "W-1 Machine Assembly", Replenishment **Make**, Tracking **Inventory** (a non-serial item with a quantity-one job satisfies the Make to Asset guard and avoids serial handling for the CIP case) → Save → `/x/part/item_F973E88AzvtsxioVFuqPb8/details`. SQL: `item_F973E88AzvtsxioVFuqPb8|W1-ASSY|Inventory|Make|Make to Order`, make method `make_3RrMEoqc3i6Ncpw5zC7sGD` V1.
- Bill of Process on `/x/part/item_F973…/make/make_3RrMEoqc3i6Ncpw5zC7sGD` → Add Operation → Process MACHINING (type Process, "Machining"), Work center CNC MILL → Save. SQL: `methodOperation 7hQUPw1xK4HDdAC3padzb|Machining|Process|wc_LUqpXYqEAv6ndVdyY9uUbQ (CNC Mill, labor 85 / machine 120)|pr_Bh1wDESrC9QYagjP2maRX7`.
- Job: `/x/job/new` → Item `W1-ASSY W-1 Machine Assembly`, Quantity 1, Location MANUFACTURING PLANT, Complete To left at Inventory (hidden `itemId=item_F973… quantity=1 fixedAssetClassId= fixedAssetId=` verified) → Save → `/x/job/job_HvPNRCne8DzFHibqwxJEE2/details`, heading **J000009**. Release → "Release Job" dialog → `requestSubmit` (`/x/job/job_HvPN…/status?schedule=1`) → header `J000009 | RELEASED`. SQL: `job_HvPNRCne8DzFHibqwxJEE2|J000009|Ready|qty 1|fixedAssetClassId NULL|fixedAssetId NULL|salesOrderLineId NULL|loc_3nHYBiQEPRqga5g7bpcwNh`; operation `jo_3T3MtFLgUBE5X5GJecM9Yy|Machining|Ready|CNC Mill|laborRate 85`.
- WIP: `/x/job/job_HvPN…/events/new` → Operation Machining, Work Center CNC Mill, Labor, 9/22/2026 8:00 AM → 10:00 AM (hidden `startTime=2026-09-22T12:00:00.000Z endTime=2026-09-22T14:00:00.000Z`; browser local time is UTC−4) → Save → events list `Machining | LABOR | 2 hours | CNC MILL`. SQL: `productionEvent pe_XCi56RGWY8APyy6YeSn4qb|Labor|7200 s|wc_LUqp…`; journal `je_TxYLzR8xoeZZTrMMNqwnXh` (Production Event): Dr 1230 WIP 170 (`WIP Account`) / Cr 5060 Labor & Machine Absorption 170, both `documentId = job_HvPNRCne8DzFHibqwxJEE2` → the job carries **WIP 170.00** before attachment.

### Attach the job (sweep of the current WIP balance)
- `/x/fixed-asset/dapj8fnle0g08u2ks090/attach-job` ("Attach Job": "The job's work-in-progress balance moves to this asset now, and completing the job sweeps the rest. Only open jobs that are not linked to a sales order or another asset are listed."). Job combobox options: **only `J000009 W1-ASSY · W-1 Machine Assembly`** (the eight seeded jobs are all sales-order-linked and correctly absent). Hidden `jobId=job_HvPNRCne8DzFHibqwxJEE2` → `requestSubmit` Attach → toast "Job attached", asset page: `FA000005 | UNDER CONSTRUCTION | Acquisition Cost $670.00 | NBV $670.00 | Location MANUFACTURING PLANT (filled from the job) | Construction in Progress: Sep 23, 2026 MANUAL — $500.00 · Sep 23, 2026 JOB J000009 $170.00 · Total $670.00 | Transfers: FAT000001 CAPITALIZATION JOB Sep 23, 2026 View $170.00`.
- SQL job: `J000009|In Progress|fixedAssetId dapj8fnle0g08u2ks090|fixedAssetClassId NULL` (status moved Ready → In Progress when the labor event was logged).
- SQL transfer: `fatr_JdpWKKdxZCAZdKRJnk4XnW|FAT000001|Capitalization|Job|dapj8fnle0g08u2ks090|job_HvPN…|loc_3nHY…|qty 1|2026-09-23|170|je_ETqKtRCqDDuBsSDMqG2BFW|Posted`.
- SQL CIP cost row #2: `facc_BaN1DWiMNFyVZWHyt2p7Gq|Job|jobId job_HvPN…|170|2026-09-23|je_ETqKtRCqDDuBsSDMqG2BFW`.
- SQL journal `je_ETqKtRCqDDuBsSDMqG2BFW|Asset Transfer|Attach job J000009 → FA000005|2026-09-23`:
```
1230|Work In Progress (WIP)  |-170|WIP Account            |Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|FAT000001
1390|Construction in Progress| 170|Fixed Asset Acquisition|Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|FAT000001
```
  → **Dr 1390 CIP 170 / Cr 1230 WIP 170** for the job's WIP balance, both lines `documentId = jobId`, transfer in `documentLineReference`. Net by account for the job: `1230 → 0`, `1390 → 170`, `5060 → −170`.
- Second labor event after attachment (so completion has something to sweep): 9/22/2026 8:00 → 9:00 AM Labor at CNC Mill (`startTime …T12:00:00Z endTime …T13:00:00Z`) → events list `1 hour`, `2 hours`. SQL: `pe_4oQSa1EYJakmNWwusp7R3|3600 s`; journal `je_GYWyvgkwD9ksRd8P6mxpkC` (Production Event) Dr 1230 85 / Cr 5060 85. Net for the job before completion: `1230 → 85`, `1390 → 170`, `5060 → −255`.

### Complete the attached job (sweep of the remainder)
- Job page → "Complete" → dialog: `Receive J000009 to Inventory | This job will be received to inventory. It will no longer be available on the shop floor. | Sweeps cost to asset dapj8fnle0g08u2ks090 | Quantity Completed [0] | Cancel | Complete Job` — no location/bin pickers; the target asset is shown as its **raw id** (`dapj8fnle0g08u2ks090`, not "FA000005 W-1") and the title/body still talk about receiving to inventory. The quantity field opened at **0** for this untracked one-unit job (hidden `quantityComplete=0`); set to 1 through the visible input (hidden verified `quantityComplete=1 locationId=loc_3nHY…`) → `requestSubmit` "Complete Job" (`/x/job/job_HvPN…/complete`) → header `J000009 | COMPLETED`.
- SQL job: `J000009|Completed|qty 1|quantityComplete 1|quantityReceivedToInventory 1|fixedAssetId dapj8fnle0g08u2ks090`.
- SQL asset: `FA000005|Under Construction|acquisitionCost 755 (500 + 170 + 85)|2026-09-23|2026-09-23|loc_3nHY…` — status unchanged (still Under Construction; a job completion into a CIP asset never activates it).
- SQL CIP cost row #3: `facc_CEpqKib8E7VV9c1Rm8t6NK|Job|jobId job_HvPN…|85|2026-09-23|je_Pe5MC2H8TQN1RYQwgrt4SS`. Transfer `FAT000002|Capitalization|Job|job_HvPN…|qty 1|2026-09-23|85|je_Pe5MC2H8TQN1RYQwgrt4SS|Posted`.
- SQL journal `je_Pe5MC2H8TQN1RYQwgrt4SS|Asset Transfer|Job Completion to Fixed Asset J000009|2026-09-23`:
```
1230|Work In Progress (WIP)  |-85|WIP Account |Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|job:job_HvPNRCne8DzFHibqwxJEE2
1390|Construction in Progress| 85|Fixed Asset |Asset Transfer|job_HvPNRCne8DzFHibqwxJEE2|job:job_HvPNRCne8DzFHibqwxJEE2
```
  → Dr 1390 CIP 85 / Cr 1230 WIP 85 for the WIP accumulated after attachment. Net for the job: `1230 → 0`, `1390 → 255`, `5060 → −255`. W1-ASSY: `itemLedger` 0, `costLedger` 0 — nothing was received to stock.
- Asset page: `FA000005 | Under Construction | Acquisition Cost $755.00 | NBV $755.00 | Construction in Progress: Sep 23 Manual — $500.00 · Sep 23 Job J000009 $170.00 · Sep 23 Job J000009 $85.00 · Total $755.00 | Transfers: FAT000001 Capitalization Job $170.00 · FAT000002 Capitalization Job $85.00`.

---

## Re-run on the recreated stack (2026-09-23)

- Date: 2026-09-23 (company today 2026-09-23, timezone UTC). Branch `revenue-recognition-rentals-spec`, HEAD `f7a8a721ed`.
- Stack: recreated again since the section above (company `dapm0k5hs0gg26itf610` "Carbon Development"); every id above is gone. Phase C/D fleet data reused: VEH-100 units FA000005–FA000009 (Rental Fleet, cost 42,000, 60 mo, 20 %), rental agreements RA000003–RA000005 On Rent on FA000005–FA000007.
- Browser: `AGENT_BROWSER_SESSION=verify-phase-b`, dev-bypass login `test@carbon.ms`. All data created through the UI; SQL was read-only (`docker exec carbon-carbon-revenue-recognition-rentals-spec-postgres-1 psql`). Sign convention in journal lines: natural-balance signed (asset/expense debit +, asset credit −, liability/revenue credit +, contra-asset debit +).
- Pre-check: `Construction in Progress` class `dapm0k5hs0gg26itf66g` has `isConstructionInProgress = t` on this seed (the bootstrap fix from Task 35 holds; no hand patch needed). `depreciationRun`: only the seeded `DR000001 2026-08-31 Draft`.
- Browser-environment note: an ERROR flash thrown from a LOADER redirect never renders as a toast on this stack (both the new on-rent refusal and the pre-existing "Only Draft assets can be purchased" redirect showed an empty Notifications region), while action success toasts ("Asset taken out of service", "Asset returned to service") render. Refusals were therefore verified by the 302 response + unchanged DB state rather than toast text.

### Check (c) — CIP: attach job, complete, Fixed Asset PO line, capitalize, depreciation

**Setup (UI).** `/x/part/new` → `W1-ASSY` "W-1 Machine Assembly", Replenishment Make, Tracking Inventory → `item_LGKPZxihZtJdX2zMjYPxAL` (make method `make_CNhy6pUMSRACa9FMtJBFoG`). Bill of Process on `/x/part/<id>/make/<mm>` → Add Operation → Machining / CNC MILL (labor 85/h) → `methodOperation V28MdINIXISiOB6c965xF`.

**First CIP asset W-1 (FA000017, `dapu5ilhs0grt4qtfuk0`).** `/x/accounting/fixed-assets/new` → Name W-1, class CONSTRUCTION IN PROGRESS (Straight Line, 120 mo) → Draft, CIP card "No cost has been recorded against this asset yet." Not registered (Attach Job is offered while Draft).
- Job `/x/job/new` → W1-ASSY qty 1, Complete To left at Inventory → `job_Mnix7KuUjw8dBKj8BEMA7m` **J000009**; Release → `Ready`. Labor event 9/23 8:00–10:00 AM, CNC Mill → `pe_PApzoh5CGMiu9511xsxP5Z` 7200 s; journal `je_9YVAtcHqDaZh1HM33KBacJ` Production Event: 1230 +170 / 5060 −170 → **WIP 170.00**.
- Asset Actions (Draft): Edit · Register · Purchase · Attach Job. Attach Job dialog lists only `J000009 W1-ASSY · W-1 Machine Assembly` (the eight seeded jobs are all sales-order-linked). Attach → asset page `FA000017 | UNDER CONSTRUCTION | Acquisition Cost $170.00 | Location MANUFACTURING PLANT | CIP: Sep 23, 2026 JOB J000009 $170.00 | Transfers: FAT000013 CAPITALIZATION JOB $170.00`.
  - SQL: job `J000009|In Progress|fixedAssetId dapu5ilhs0grt4qtfuk0`; CIP row `facc_PgHoyQpeQSJgeEP2j5s32V|Job|170|2026-09-23|je_BrHeAd8JM5kxqaem8GqJiW`; transfer `FAT000013|Capitalization|Job|qty 1|170|Posted`.
  - Journal `je_BrHeAd8JM5kxqaem8GqJiW` Asset Transfer "Attach job J000009 → FA000017" 2026-09-23: `1230 WIP −170 (WIP Account)` / `1390 CIP +170 (Fixed Asset Acquisition)`, both `documentId = job_Mnix…`, `documentLineReference FAT000013` → **Dr 1390 170 / Cr 1230 170**. PASS.
- Second event 10:00–11:00 → `je_YWiiy3n5FJWT34Mc6zAB3V` 1230 +85 / 5060 −85. Complete dialog: `Receive J000009 to Inventory | This job will be received to inventory… | Sweeps cost to asset dapu5ilhs0grt4qtfuk0 | Quantity Completed [0]` (same nits as before: raw asset id, inventory wording, quantity opens at 0 with Complete Job disabled). Increase → 1 → Complete Job → `J000009 | COMPLETED`.
  - SQL: `J000009|Completed|quantityComplete 1|quantityReceivedToInventory 1`; asset `Under Construction|acquisitionCost 255`; CIP row #2 `facc_KSFoMc8SuijUdCLW9j77kp|Job|85|je_5CGZ8tSrB85A5keU9c3YRw`; transfer `FAT000014|Capitalization|Job|85|Posted`; journal `je_5CGZ8tSrB85A5keU9c3YRw` "Job Completion to Fixed Asset J000009": 1230 −85 / 1390 +85. Net by account for the job: `1230 → 0`, `1390 → 255`, `5060 → −255`; W1-ASSY `itemLedger` 0 rows. PASS.
- **Fixed Asset PO line for W-1 — FAIL (UI cannot target an Under Construction asset).** Asset Actions after attach: Edit · Attach Job · Capitalize (Purchase gone). `/x/fixed-asset/<W-1>/purchase` loader refuses "Only Draft assets can be purchased". The PO line form's Fixed Asset picker and the purchase invoice line form's picker both query `status = 'Draft'` only, so once a CIP asset has its first cost (Under Construction) no new Fixed Asset PO/PI line can name it. The spec (§2 CIP, acceptance line 650) orders the PO line AFTER the job cost. The posting side supports it (`post-receipt` only flips `Draft`; an Under Construction asset keeps its status and gets a `Receipt` CIP row — proven below). W-1 (FA000017) was left `Under Construction` at 255.

**Replacement CIP asset W-1B (FA000018, `dapu85ths0gs23qtfv2g`), used for the rest of (c).** The only UI route to a PO line on a CIP asset is to raise it while the asset is still Draft, so:
- New asset W-1B in CONSTRUCTION IN PROGRESS → Draft. Actions → Purchase → Supplier AstroMill Machining → Create Purchase Order → `po_RizCkokiq9xTEy7WGcXR1j` **PO000005** with line `4ctf5cpJiStW1SicinptHA|Fixed Asset|assetId dapu85ths0gs23qtfv2g|qty 1|price 0`. Line edited: Unit Price 6000 (fill + blur, hidden `supplierUnitPrice=6000`) → Save → SQL `unitPrice 6000|supplierExtendedPrice 6000`. PO left un-received for now.
- Job `job_4oFfyohEBoMnospzxX6S11` **J000010** (W1-ASSY qty 1) → Release → labor 8:00–10:00 → `je_Ks4qt9f9PubtsXwJhWiTiL` 1230 +170 / 5060 −170.
- Attach Job on W-1B (list shows only `J000010`; completed J000009 correctly absent) → `FA000018 | UNDER CONSTRUCTION | $170.00`. SQL: CIP row #1 `facc_9wk9LB9AVkpYTThuV9YmaG|Job|170|je_U8qvH8j2vLbSsm4zRZy1wc`; `FAT000015|Capitalization|Job|170|Posted`; journal `je_U8qvH8j2vLbSsm4zRZy1wc` "Attach job J000010 → FA000018": **1230 −170 / 1390 +170**, `documentId = job_4oFf…`, ref FAT000015.
- Labor 10:00–11:00 (`je_TMsNMGKz1ZYMDxxhRxsagf` 1230 +85 / 5060 −85) → Complete (qty 0 → 1) → `J000010|Completed|fixedAssetId dapu85ths0gs23qtfv2g`. CIP row #2 `facc_JRWDfA9dNXtUWJKq5AR13h|Job|85|je_L34WbFEeFVUndqEBZA81BM`; `FAT000016|Capitalization|Job|85|Posted`; journal `je_L34WbFEeFVUndqEBZA81BM` "Job Completion to Fixed Asset J000010": **1230 −85 / 1390 +85**. Job net `1230 → 0`, `1390 → 255`, `5060 → −255`. Asset `Under Construction|255`.
- PO000005: Finalize → `To Receive and Invoice`; Receive → `rec_BHm1ZJ4d5YyovTf25F9JZy` **RE000002** (Receipt Lines empty, Fixed Assets section "W-1B FA000018") → Post Receipt → `Posted`.
  - Journal `je_TCnFN9GFCGjpaiq4421ky9` Purchase Receipt: **1390 CIP +6000 (Fixed Asset Acquisition) / 2125 GR/IR Clearing +6000 (credit)**.
  - CIP row #3 `facc_Qgrck95d5UMcwZiwyBc2Cq|Receipt|sourceDocumentId rec_BHm1…|lineId Xy2ybFb4LGm2FgUwoAUcyF|6000|je_TCnFN9GFCGjpaiq4421ky9`; asset `Under Construction|acquisitionCost 6255|acquisitionDate 2026-09-23|depreciationStartDate NULL` (status kept, no depreciation start — correct for a CIP asset).
- PO → Invoice → `pi_DqKkwK6eMEcF16pfRD2rTe` **AP000002** ($6,000.00) → Post Invoice → `Open`. Journal `je_Lb62bgBj5dydBY1SyPfRvJ`: 2125 GR/IR −6000 (debit) / 2010 AP +6000. **No second CIP row** (the invoice clears GR/IR against the receipt; the asset stays at 6,255) — no double count.
- **Capitalize** (`/x/fixed-asset/<W-1B>/capitalize`): dialog `Total Construction Cost: $6,255.00`, class options Buildings / Machinery & Equipment / Rental Fleet / Vehicles (CIP hidden), in-service defaulted to today; chose **Machinery & Equipment**, In-Service Date **10/01/2026** (hidden `toClassId=dapm0k5hs0gg26itf650 inServiceDate=2026-10-01`); preview "Debit Machinery & Equipment · Credit Construction in Progress · $6,255.00" → Capitalize → `FA000018 | ACTIVE | $6,255.00 | MACHINERY & EQUIPMENT | Acquisition Date Oct 1, 2026 | Depreciation Start Oct 1, 2026 | Transfers FAT000017 CAPITALIZATION CONSTRUCTION IN PROGRESS Oct 1, 2026 $6,255.00`.
  - SQL asset: `FA000018|Active|Machinery & Equipment|6255|2026-10-01|2026-10-01|120|0|Straight Line`; Σ CIP rows = 6255.
  - Transfer `FAT000017|Capitalization|Construction in Progress|fromClassId dapm0k5hs0gg26itf66g|transferDate 2026-10-01|inServiceDate 2026-10-01|6255|je_5s6FQMpZ7SXBLgKvmt1bC|Posted`.
  - Journal `je_5s6FQMpZ7SXBLgKvmt1bC` Asset Transfer "Capitalize FA000018 — Construction in Progress → Machinery & Equipment", postingDate 2026-10-01 (October period auto-created): **1350 +6255 / 1390 −6255**. PASS.
- **Depreciation.** (Dev seed run DR000001 was **posted** through the UI — Aug 31, FA000001 20,187.50 + FA000002 30,400.00 — so the next run could be made.)
  - Expected: W-1B excluded from any run ending before 2026-10-01; first eligible month October = 6,255 × (1 − 0 %) / 120 = 52.125 → **52.13**.
  - Accounting → Depreciation → Run Next Period → "period ending Sep 30, 2026" → **DR000002** (`dapub75hs0gs24itfvv0`): FA000001 672.92, FA000002 1,900.00, FA000016 40.00, FA000005–FA000009 560.00 each; **FA000018 absent**. Posted (Sept is the earlier month → excluded; PASS).
  - Run Next Period → "Oct 31, 2026" → **DR000003** (`dapucslhs0gs99qtg0jg`) Draft: **FA000018 W-1B $6,255.00 → $52.13, NBV after $6,202.87** (plus the eight others). PASS. DR000003 was then **deleted** through the UI (More options → Delete) so a future-period draft is not left holding a line for FA000008, which (f) returns to stock.

**Check (c) result: PASS for the posting chain; FAIL for the UI step "Fixed Asset PO line against the asset after it is Under Construction".** Attach (Dr 1390 / Cr 1230 170), completion sweep (85), Receipt CIP row (6,000; invoice adds none), capitalization Dr 1350 / Cr 1390 6,255, Active, excluded from September, 52.13 in October all verified on W-1B. The PO line had to be raised while W-1B was still Draft because no UI path names an Under Construction asset on a PO/PI line (defect D1).

### Check (d) — work-center link and Capital Cost panel

- W-1B → Actions → Edit (`/x/fixed-asset/dapu85ths0gs23qtfv2g/details`): Work Center picker → CNC MILL (hidden `workCenterId=wc_GFFqpoM5i457cSgTygxvju` verified) → Save → redirected to the asset page, which still reads **Work Center —**. SQL: `FA000018|workCenterId NULL`. Screenshot `.context/phase-b-d-workcenter-not-saved.png`. **FAIL (defect D2).**
- Panel proof on a separate asset (the create action spreads every validated field, so the link is saved there): `/x/accounting/fixed-assets/new` → "WC Panel Check Mill Fixture", MACHINERY & EQUIPMENT, Work Center CNC MILL → `FA000019` (`dapue1lhs0gsc8atg0og`, `workCenterId wc_GFFq…`) → Register: cost 12,000, acquired 9/23/2026, depreciation start 10/1/2026 → Active; journal `je_LYoe7tWfnya8R96TaXyqjr` Manual: 1350 +12,000 / 3100 +12,000.
- `/x/resources/work-centers/wc_GFFqpoM5i457cSgTygxvju` → Edit Work Center drawer, section **CAPITAL COST**: `Asset | Name | Net Book Value | Monthly Depreciation — FA000019 | WC Panel Check Mill Fixture | $12,000.00 | $100.00 — Total $12,000.00 $100.00` (12,000 / 120 = 100). Screenshot `.context/phase-b-d-capital-cost-panel.png`.

**Check (d) result: FAIL** — the panel works, but an existing asset (the capitalized W-1B) cannot be linked to a work center: the edit action drops `workCenterId`.

### Check (e) — out of service / return to service, and the On Rent guard

- Fleet register (`/x/accounting/fleet`): FA000005–07 ON RENT, FA000008 AVAILABLE, FA000009 IN MAINTENANCE ("Brake inspection", from Phase C/D).
- **On Rent guard.** Row menu for FA000005 (On Rent): **only "View Asset"** — Take Out of Service (and Return to Inventory) hidden. PASS.
  - The asset page (`/x/fixed-asset/dapt1dths0gplaitff30`) Actions menu still lists `Edit · Sell · Return to Inventory · Take Out of Service · Dispose` for the On Rent unit; clicking Take Out of Service lands back on the asset page (no modal).
  - Loader: `GET …/out-of-service.data` → `SingleFetchRedirect` 302 → `/x/fixed-asset/dapt1dths0gplaitff30`.
  - Action: `POST …/out-of-service.data` with `reason=Verify guard - should be refused` → 302 to the asset page; SQL afterwards `FA000005|outOfServiceSince NULL|outOfServiceReason NULL`, `fleetStatus On Rent`. Refused on both loader and action. PASS. (The refusal text "The asset is on rent on RA…; …" is not shown — see the loader-flash note at the top; screenshot `.context/phase-b-e-onrent-refused.png`.)
- **Take out of service.** FA000008 row menu `View Asset · Rent · Take Out of Service · Return to Inventory` → Take Out of Service modal ("…Depreciation continues and its accounting is unchanged.") → Reason "Tyre replacement (Phase B check e)" → toast **"Asset taken out of service"**. SQL: `FA000008|Active|outOfServiceSince 2026-09-23|Tyre replacement (Phase B check e)`, `fleetStatus In Maintenance`. PASS.
- **Still depreciates.** DR000002 (posted, Sept) charged FA000009 (out of service since 9/23) 560.00: journal `je_EZ8KVQsQoAsgcXvm4KhxSy` 6310 +560 / 1380 −560. DR000003 (Oct draft, created while FA000008 was In Maintenance) included **FA000008 560.00**. Expected 42,000 × 80 % / 60 = 560.00. PASS.
- **Return to service.** Fleet row menu (In Maintenance) `View Asset · Return to Service · Return to Inventory` → Return to Service → toast **"Asset returned to service"**. SQL `FA000008|Active|outOfServiceSince NULL|reason NULL`, `fleetStatus Available`. PASS.

**Check (e) result: PASS.** Observation: the asset page's own Actions menu does not hide Take Out of Service / Return to Inventory for an On Rent unit (only the fleet table does). The server refuses both, as the rule documents.

### Check (f) — return to inventory at NBV, then sell

- Starting NBV for FA000008: cost 42,000 − accumulated 560 (DR000002) = **41,440**. VEH-100 is a Buy item, so the inventory account is 1210 Raw Materials.
- Expected journal: Dr 1210 41,440 / Dr 1380 560 / Cr 1370 42,000.
- Fleet row → Return to Inventory → modal `Current Net Book Value: $41,440.00 | … no gain or loss | Location MANUFACTURING PLANT | Storage Unit A1-L1 | Transfer Date 9/23/2026` → submit → asset page `FA000008 | DISPOSED | … | Transfers FAT000018 RETURN TO INVENTORY $41,440.00 | Disposal Method Transfer to Inventory | NBV at Disposal $41,440.00 | Proceeds $0.00 | Gain/Loss $0.00`.
  - Transfer `fatr_L5C1xrP5baHfHcDodZVPhp|FAT000018|Return to Inventory|Inventory|amount 41440|accumulatedDepreciation 560|sh_ErfmBvipEsfNkDhVkADw1J|je_6qzryvaRR9DajPGcuJ8SgU|Posted`.
  - Journal `je_6qzryvaRR9DajPGcuJ8SgU` Asset Transfer "Return to inventory FA000008 → VEH-100 VEH100-004": **1210 +41,440 / 1380 +560 (debit) / 1370 −42,000**.
  - Asset `Disposed|Transfer to Inventory|2026-09-23`; `fixedAssetDisposal` `Transfer to Inventory|NBV 41440|gainLoss 0|proceeds 0`; `fleetStatus Returned to Stock`.
  - Entity `-w10J4sVHxWrFc8eEb2ky VEH100-004|Available`, `Fixed Asset` attribute removed. `itemLedger` +1 `Positive Adjmt.`/Asset Transfer at A1-L1; cost layer `cl_63TUYxF5TeSnrwnwUkdifT|Direct Cost|Asset Transfer|1|41440|remaining 1`. Return: PASS.
- **Sell.** `/x/sales-order/new` → NovaSat Networks → **SO000011** (`so_YEmx3fU3kakyiYYzoFAvR1`); line Part VEH-100 qty 1 at 45,000 (Pull from Inventory; picker showed "VEH-100 … 5 EA") → Confirm → `To Ship and Invoice` → Ship → **SHP000002** (`sh_5pV2ABg9gUjjAaNVUkVSZu`); Tracking Number 1 → "Show available tracking numbers" → `VEH100-004` (the other four offered were blank-serial Phase C units) → Post Shipment → `Posted`.
  - Shipment journal `je_9Sqmy3fqf8m7ZgmFekMDdT`: **5010 COGS +42,000 / 1210 −42,000**. The cost ledger consumed `cl_SeqDaFURjBUznQAFxcbH4Z` (42,000, the oldest layer). The NBV layer `cl_63TU…` (41,440) is **still remaining 1**. Entity VEH100-004 `Consumed`.
  - Expected COGS was **41,440** (the NBV the unit came back at). **FAIL (defect D3).** Screenshot `.context/phase-b-f-shipment-cogs-fifo.png`.
- SO → Invoice → **AR000016** (`si_TpGd84C9aZBm6QKbwvW1Ah`, $45,000) → Post Invoice → `Submitted`. Journal `je_JYQAicMbJ2dbhCxtGNXEGq`: **1110 AR +45,000 / 4010 Sales +45,000**; SO000011 `Completed`. Revenue: PASS.
- Aggregates stay consistent: 4 units on hand, remaining layers 3 × 42,000 + 41,440 = 167,440. So the GL is not out of balance; the specific unit's cost is simply not what COGS used.
- Side observation (pre-existing, outside Phase B): the shipment's `itemLedger` row has no `storageUnitId`, because the SO/shipment line's bin was blank. VEH-100 bins now read A1-L1 +1 (where VEH100-004 was) and unassigned 3, even though VEH100-004 left from A1-L1. `post-shipment` takes the bin from `shipmentLine.storageUnitId` (e.g. `post-shipment/index.ts:358`), not from the tracked entity.

**Check (f) result: return to inventory PASS; sale PARTIAL — revenue correct, COGS 42,000 instead of the 41,440 NBV** because other VEH-100 stock with older FIFO layers existed.

### Summary (re-run)

| Check | Result | Notes |
|---|---|---|
| (a) Make to Asset | PASS (earlier run, pre-reset) | not re-run |
| (b) Capitalize stocked serial | PASS (earlier run, pre-reset) | not re-run |
| (c) CIP | PASS posting chain / **FAIL** one UI step | W-1B: 170 + 85 + 6,000 = 6,255 → Dr 1350 / Cr 1390, Active, excluded Sept, 52.13 Oct; PO line on an Under Construction asset impossible in UI (D1) |
| (d) Work-center link | **FAIL** | edit drops `workCenterId` (D2); panel itself verified via an asset linked at creation |
| (e) Out of service | PASS | In Maintenance, still depreciates, Available on return; On Rent hidden in fleet table and refused by loader and action |
| (f) Return + sell | Return PASS / sale **PARTIAL** | Dr 1210 41,440 / Dr 1380 560 / Cr 1370 42,000; revenue 45,000 OK; COGS 42,000 not 41,440 (D3) |

### Defects (diagnosis only — not fixed)

- **D1 — a Fixed Asset PO/PI line cannot name an asset once it is Under Construction.**
  - Where: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx:248` and `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceLineForm.tsx:190` load picker options with `.eq("status", "Draft")`. `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.purchase.tsx:49` refuses non-Draft ("Only Draft assets can be purchased"), and `$fixedAssetId.tsx:259` shows Purchase only `isDraft`.
  - Why it matters: the spec's CIP flow adds PO cost after the job cost; posting already supports it (`post-receipt` flips only Draft, and a receipt against Under Construction appended the `Receipt` CIP row above).
  - Likely fix: also admit `Under Construction` assets whose class `isConstructionInProgress`.
- **D2 — editing an asset never saves its work center.**
  - Where: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.details.tsx:53-71` passes an explicit field list to `updateFixedAsset` and omits `workCenterId`. The validator (`accounting.models.ts:1003`) and `updateFixedAsset` (`accounting.service.ts:6278`) both accept it; the create route spreads `...d`, so only creation links.
  - Consequence: an existing or capitalized asset can never be linked, so the capital-cost panel can't show it.
- **D3 — a unit returned to inventory at NBV is costed FIFO at sale, not at its NBV.**
  - Where: `packages/database/supabase/functions/shared/calculate-cogs.ts:56-82` selects the item's layers ordered by `postingDate, createdAt` with no tracked-entity (specific identification) filter. `post-shipment/index.ts:1088` calls it per item.
  - Consequence: the Return-to-Inventory layer (`post-asset-transfer` return, 41,440) sits behind older same-day 42,000 layers. COGS differs from NBV whenever other stock of the item exists; it matches only when the returned unit's layer is the oldest remaining.
  - Classification: a costing-model gap (serialized FIFO items are not specifically identified), not a regression in the transfer itself. The spec's "sold later like any other stock … COGS at NBV" holds only for a sole or oldest unit.

### Minor UI observations (unchanged from the earlier run)

- Make to Asset / sweep complete dialog: title and body still say "Receive … to Inventory / will be received to inventory".
- The same dialog shows the target asset as a raw id ("Sweeps cost to asset dapu5ilhs0grt4qtfuk0").
- Quantity Completed opens at 0 for an untracked one-unit job.
- Loader-redirect error flashes don't render as toasts on this stack (general, not Phase B specific).
- Asset page Actions menu shows Take Out of Service / Return to Inventory for On Rent units (server refuses).

### Data left behind (all via the UI)

- Items and assets: W1-ASSY; FA000017 W-1 (Under Construction, 255); FA000018 W-1B (Active M&E 6,255); FA000019 (Active M&E 12,000, CNC Mill).
- Documents: J000009 / J000010 Completed; PO000005 / RE000002 / AP000002; SO000011 / SHP000002 / AR000016.
- Depreciation: DR000001 and DR000002 Posted; DR000003 created then deleted.
- Fleet units: FA000008 Disposed (Transfer to Inventory), with VEH100-004 sold; FA000005 unchanged.
