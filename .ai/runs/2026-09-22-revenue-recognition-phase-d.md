# Verification run: Revenue recognition Phase D — sales-type leases (Task 56, step 1 browser verification)

- Date: 2026-09-23 (company today 2026-09-23, timezone UTC)
- Branch / commit: revenue-recognition-rentals-spec @ bbbfc44ff3
- URL: https://erp.revenue-recognition-rentals-spec.dev, company "Carbon Development" (`dapm0k5hs0gg26itf610`), dev-bypass login test@carbon.ms
- Browser: `AGENT_BROWSER_SESSION=verify-phase-d` (closed at the end)
- Mode: verify only. No code changes and no commits. Every record was created through the UI or the route actions its buttons post to. SQL was read-only.
- Sources: plan Task 56 + Execution notes; spec §4 + Acceptance Criteria (Sales-type, Classification); `docs/content/docs/reference/rental-agreements.mdx`.
- Amount conventions:
  - Journal amounts below are as stored: natural-balance signs, so a revenue credit reads positive and an asset credit reads negative.
  - Amounts are kept at internal scale (5 dp). Cent figures are the display values.

## Result summary

| # | Check | Result |
|---|---|---|
| 1 | Create an agreement from the UI (Phase C D1) | **PASS** |
| 2 | Edit a Draft agreement's terms (Phase C D1) | **PASS** |
| 3 | Reload `/x/rental-agreement/<id>/details`; open the bare `/x/rental-agreement/<id>` (Phase C D2) | **PASS** |
| 4 | Return form submits for an operating unit (Phase C D3) | **PASS** |
| A1 | Scenario A classification preview (line form) and Activate commencement preview | **PASS** |
| A2 | Scenario A commencement journal, `sellingProfit`, NI, dimensions | **PASS** |
| A3 | Asset Disposed (Sale) + `fixedAssetDisposal`; fleet reads Sold; tracked entity Consumed with Rental Agreement + Customer; Lease Commencement activity | **PASS** |
| A4 | 36 `rentalLeaseScheduleLine` rows: month 1 185.25 / 814.75 / 36,234.49, last closing 5,000.00 | **PASS** |
| A5 | 36 Planned Interest rows Dr 1160 / Cr 4150 | **PASS** |
| A6 | Month-1 Arrears invoice posts Dr AR 1,000 / Cr 1160 1,000, with no schedule rows | **PASS** |
| A7 | A run posts month-1 interest Dr 1160 185.25 / Cr 4150 185.25 and stamps the schedule line | **PASS** |
| A8 | Net investment report ties to 1160 | **PASS**. A later timing gap on RA000020 is the documented behaviour (see A8). |
| A9 | Months 2–36, Scenario A's own Sell to Customer | **NOT RUN**: date-bound (Sep 30 2026 … Jul 31 2029). The schedule itself is verified (A4). |
| B1 | Scenario B (11 months, ended) commencement ×3 | **PASS** |
| B2 | All 11 periods due; Generate Invoices; Sales-Type Rent lines credit 1160 | **PASS** |
| B3 | Run posts all 11 months of interest per lease; per-line 1160 = closing 3,000.00 | **PASS** |
| B4 | (i) Sell to Customer: option invoice Dr AR / Cr 1160 + **shortfall** Dr 5010 / Cr 1160; line 1160 = 0; line Sold; agreement closes | **PASS** |
| B5 | Purchase option **excess** Dr 1160 / Cr 4070 (extra twin RA000017) | **PASS** |
| B6 | (ii) Return To = Rental fleet: new fleet asset at closing NI, Dr 1370 / Cr 1160, line 1160 = 0; agreement closes | **PASS** |
| B7 | (iii) Return To = Inventory: +1 at closing NI, Dr inventory / Cr 1160, entity Available | **PASS** (observation O2) |
| B8 | Return To left empty is refused with "Choose where the returned unit goes" | **PASS** |
| C1 | Option not certain + fair value 60,000 → Operating (preview and stored) | **PASS** |
| C2 | Open-ended → Operating even with a test met (specialized asset) | **PASS** |
| C3 | Option reasonably certain without End Date is rejected by the form | **PASS** |
| C4 | Mid-month start: whole-periods message in the Activate preview, then Activate refused | **PASS** |
| C5 | Override: reason required; override saved; audit entry `entityType rentalAgreement`; override kept at activation | **PASS** (observation O1). The `update: accounting` denial was code-checked only (single admin user). |
| C6 | Advance-timing sales-type (annuity-due) numbers | **PASS**, with defect **D1** (low) |
| C7 | Sell before End Date refused; sales-type Return before End Date refused; Cancel disabled on a commenced sales-type agreement | **PASS** |
| C8 | Accumulated-depreciation leg with a non-zero value | **NOT RUN**: environment. Every unit had 0 depreciation (see Environment). The builder omits the zero leg, and the preview shows it as $0.00. |

## Defects

### D1 (low): an Advance lease that closes on zero writes a −0.00001 Interest row in its last month
- **Where:** RA000020 (Advance, 36 × 1,000, 6 %, no certain option, no residual, so the closing target is 0).
- **Schedule:** the second-to-last line closes on **1,000.00001**. The last line therefore books `interestAmount = −0.00001`, `principal 1,000.00001`, closing 0.
- **Interest row:** activation turned that line into a Planned `Interest` row of **−0.00001**, scheduled 2029-07-31 (Dr 1160 / Cr 4150 with a negative amount).
  ```
  2029-06-30|1995.02489|1000|4.97512|995.02488|1000.00001
  2029-07-31|1000.00001|1000|-0.00001|1000.00001|0
  revenueRecognitionSchedule Interest … scheduledDate 2029-07-31 amount -0.00001
  ```
- **Cause:**
  - `packages/database/supabase/functions/shared/lessor-lease.ts:189-190`: the last line's interest is `round(closingTarget − opening + payment)`. Per-line 5-dp rounding drift can make that negative when the true final interest is 0, which is always the case for Advance with a zero closing target: the last payment lands at the start and nothing earns interest.
  - `packages/database/supabase/functions/post-rental-agreement/lessor.ts:125`: `interestRows` drops only `round(interest) === 0`, so a −0.00001 row survives.
- **Effect:** a sub-cent negative lease-interest line in the July 2029 run. The money is immaterial, but it is a negative interest row on the lease.
- **Date-bound:** it would post in 2029.

No other defects found. Every Phase C fix re-checked here holds (D1, D2, D3).

## Observations (not failing a check)
- **O1: the override audit entry is written even with the audit log OFF.**
  - `company.auditLogEnabled = false` for this company, yet the override created `auditLog_dapm0k5hs0gg26itf610` and wrote the row. `insert_audit_log_batch` calls `create_audit_log_table` itself.
  - The route comment `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.classification.tsx:113` says "a company without audit logging has no audit table", which is not true.
  - The docs (`rental-agreements.mdx:126`) say the change is recorded "with the audit log on".
  - Decide which is intended. Either way the doc and the comment disagree with the code.
- **O2: return to inventory debits the item's inventory account.** For this Buy item that is **1210 Raw Materials**. The spec text says Finished Goods (1220).
  - It is consistent: capitalizing the same unit credited 1210.
  - The docs say "inventory", which matches the code.
- **O3: the run page's Source column shows raw `ragl_…` line ids for Interest rows.** This is the same as Phase C O3 for Accruals.
- **O4: the Close dialog copy is out of date.** It reads "Every unit must be returned and every billing period invoiced" (`RentalAgreementHeader.tsx:116`), but a Sold unit also qualifies (RA000014 closed with its unit Sold).
- **O5: "Sell to Customer" is offered in the line menu before the End Date.** The server refuses with a clear message (C7). The docs describe exactly this.
- **O6: when the start date falls in a month whose run already posted.** RA000020's August interest (160.18, dated 2026-08-31) waits for the next run: RR000003 for Aug 31 was already Posted, and a run is one per period end.
  - Meanwhile the net investment report shows its NI at 33,035.37 while 1160 holds 31,035.37 (two Advance rent invoices posted).
  - This is the documented "report does not tie until the run and the invoices for the same months are both posted" behaviour.
- **O7: interest for the ended leases posts on the run's period end.** Interest for Oct 2025 – Jul 2026 on the ended B leases posted in one run at 2026-08-31 (RR000003), because a run claims every Planned row on or before its period end. Posting to 1160/4150 is correct; the P&L timing is the run date.

## Setup (all UI)
- **Item:** `/x/part/new` → **LSE-100** "Lease Excavator 100", Buy, Tracking **Serial**, Unit Cost 30,000 (`item_9EfDBS4TDs9nqow3wmcqkp`).
  - Part → Sales → Rental Rates: Day 60 / Week 300 / Month 1,000.
  - SQL `itemRentalRate`: `USD|60|300|1000`.
- **Stock:** Inventory → Quantities → LSE-100 → Update Inventory (Positive Adjustment, Manufacturing Plant), serials LSE100-001…006. `costLedger`: six layers of 30,000.
- **Fleet:** each serial capitalized through `/x/fixed-asset/capitalize?itemId=…&trackedEntityId=…&locationId=…`; the form preselected Rental Fleet and today, then "Capitalize".
  - Result: FA000010–FA000015, Active, cost 30,000, accumulated depreciation 0, fleet Available.
- **Settings in place:**
  - `revenueRecognitionEnabled = t`; lease policy 75 / 90 / 6.
  - Defaults: 1160 Net Investment in Leases, 4070 Lease Revenue, 4150 Interest Income – Leases, 5010 COGS.
  - Rental Fleet class: asset 1370, accumulated depreciation 1380, 60 months, 20 %.

## Independent expected numbers (own JS, not the app's library)
```
A  36×1,000 Arrears 6% opt 5,000:  pvRent 32,871.01624  pvOpt 4,178.22459  PVpay = NI 37,049.24083
   month 1: int 185.2462  prin 814.7538  close 36,234.48703;  month 36 close 5,000;  Σ interest 3,950.75917
   C = 30,000 → COGS 30,000, selling profit 7,049.24
B  11×1,000 Arrears 6% opt 2,000 certain, URV 1,000:  PVpay 12,570.25646  PVres 946.61487  NI 13,516.87133
   C = 30,000 → COGS 29,053.38513, selling profit −16,483.12867;  Σ interest 483.12867;  closing 3,000
   NI + Σint − 11,000 = 3,000;  option 2,000 < 3,000 → shortfall 1,000
B4 10×1,000 Arrears, option 2,000 NOT certain, URV 500, FV 10,000:  PVpay 9,730.41186 (97.30 % → test d)  PVres 475.67397
   NI 10,206.08583;  COGS 29,524.32603;  Σ interest 293.91417;  closing 500 → option 2,000 → excess 1,500
X4 36×1,000 ADVANCE, no certain option (override Sales-Type):  NI 33,035.37132; month 1 int 160.17686 / prin 839.82314 / close 32,195.54818
Classification op: 32,871.02 / 60,000 = 54.785 %; 36/120 = 30 %
```

## Checks 1–4: Phase C fixes re-confirmed
- **1. Create: PASS.**
  - Clicks: Fleet register (`/x/accounting/fleet`) → FA000010 row menu → **Rent** → `/x/rental-agreement/new?fixedAssetId=…`.
  - Filled: NovaSat Networks, Start 08/01/2026, End 07/31/2029, Calendar Month, **Arrears**, Discount Rate 6, Purchase option 5,000, "Purchase option reasonably certain" ON → Save.
  - Redirected to `/x/rental-agreement/rag_DGn7HHVPhcmCXf65eoduru/details` (**RA000013**).
  - SQL: `Draft|2026-08-01|2029-07-31|Arrears|6|5000|t|exchangeRate 1`. The form posts no `exchangeRate` and the default applied. Twelve more agreements were created the same way (RA000014–RA000021).
- **2. Edit: PASS.** RA000020 (Draft) Terms card: Start Date changed 08/15/2026 → 08/01/2026 → Save. Toast **"Updated rental agreement"**; SQL `startDate 2026-08-01`, `exchangeRate 1`.
- **3. Reload: PASS.**
  - `agent-browser reload` on `/x/rental-agreement/rag_DGn…/details` rendered the page (title "Carbon | Rental Agreement", RA000013 visible).
  - Opening the bare `/x/rental-agreement/rag_DGn…` redirected to `/details` and rendered.
- **4. Operating Return: PASS.**
  - RA000021 (Apex, FA000016 = the unit returned to the fleet in B6; open-ended, Calendar Month, Advance, start 2026-09-01) → Activate (Operating) → Deliver → Line actions → **Return** → "Return Unit".
  - The form carries no `isSalesType` / Return To fields for an operating line: `rentalAgreementLineId, returnedAt, meterIn, takeOutOfService`.
  - Toast **"Unit returned"**; line `Returned|2026-09-23`.
  - September re-cut to `09-01→09-23 | 23 days | 766.66667` (23/30 × 1,000).

## Scenario A: RA000013 (NovaSat, FA000010 / LSE100-001, NBV 30,000)
- **A1: previews.**
  - Line → Edit → "Lease classification inputs": Fair Value 38,000, Economic Life 120, residuals 0 → Save.
  - The unit form shows **SALES-TYPE · PREVIEW**: ✓ Purchase option reasonably certain; ✓ PV ≥ 90 % of fair value (**97.498 %**); term 30 %; PV of Payments **$37,049.24**, PV of Residual $0.00, Net Investment $37,049.24 (screenshot `.context/phase-d-a-line-preview.png`). The spec's "97.5 %" is this figure rounded.
  - **Activate** confirmation (`.context/phase-d-a-activate-preview.png`):
    ```
    Net Investment in Leases   $37,049.24
    Cost of Goods Sold         $30,000.00
    Lease Revenue                          $37,049.24
    Accumulated Depreciation   $0.00
    Fixed Asset (at cost)                  $30,000.00
    Selling profit: $7,049.24
    ```
- **A2: Activate → "Rental agreement activated".**
  - Line: `Pending|Sales-Type|initialNetInvestment 37049.24083|sellingProfit 7049.24083`, rates snapshotted `60|300|1000`.
  - JE-2026-09-000036 `Lease`, 2026-09-23, "Lease commencement RA000013 LSE100-001":
    ```
    1160 Net Investment in Leases  37049.24083  (Dr)
    5010 Cost of Goods Sold        30000        (Dr)
    4070 Lease Revenue             37049.24083  (Cr)
    1370 Rental Fleet             -30000        (Cr)   — no 1380 line: accumulated depreciation is 0
    ```
  - All lines have `documentType 'Rental Agreement'`, `documentId rag_DGn…`.
  - Dimensions on all four lines: Customer (NovaSat), Item (LSE-100), Location (Manufacturing Plant).
- **A3: the unit.**
  - `fixedAsset` FA000010: `Disposed|Sale|disposalDate 2026-09-23|saleProceeds 37049.24083`.
  - `fixedAssetDisposal`: `Sale|2026-09-23|proceeds 37049.24083|NBV 30000|gainLoss 7049.24083|journal je_5qm…`.
  - `fleetAssets.fleetStatus` = **Sold**.
  - Tracked entity LSE100-001: **Consumed**, attributes `{"Customer": "cust_2e2u…", "Rental Agreement": "rag_DGn…"}` (Fixed Asset removed).
  - Activities: Capitalize, then **Lease Commencement** (Rental Agreement RA000013).
- **A4: schedule.** 36 rows, 2026-08-31 → 2029-07-31, Σ interest 3,950.75917, Σ principal 32,049.24083.
  ```
  2026-08-31|37049.24083|1000|185.2462 |814.7538 |36234.48703
  2026-09-30|36234.48703|1000|181.17244|818.82756|35415.65947
  2029-06-30| 6935.47192|1000| 34.67736|965.32264| 5970.14928
  2029-07-31| 5970.14928|1000| 29.85072|970.14928| 5000
  ```
  Billing periods: 36 × 1,000, each due on its period end (Arrears), all Pending.
- **A5: interest rows.** 36 × `Interest|Planned`, Σ 3,950.75917, Dr **1160** / Cr **4150**. The first is `2026-08-01→08-31 scheduled 08-31 185.2462`.
- **A6: month-1 invoice.**
  - Line actions → Deliver ("Mark the unit as delivered… today") → **"Unit delivered"** (`On Rent|2026-09-23`).
  - Header **Generate Invoices** → Draft **AR000008**: `Rental` line "2026-08-01 – 2026-08-31 · 31 days · Month rate — …", 1 × 1,000.
  - Only August was due (Arrears; September is due 09-30).
  - Invoice → Post → "Post Invoice". JE-2026-09-000037: `1110 +1000 (Invoice) / 1160 −1000 (Rental Agreement RA000013)`. No `revenueRecognitionSchedule` row for the line.
  - The header **Cancel** button is disabled on this commenced sales-type agreement.
- **A7: run.**
  - Accounting → Revenue Recognition → **New Run**, period end 08/31/2026 → **RR000003** (34 Interest lines, $1,634.63 = A 185.25 + 3 × B 483.13) → **Post Run** → `Posted`.
  - JE-2026-09-000044, `Revenue Recognition`, posting date 2026-08-31: `1160 +1634.63221 / 4150 +1634.63221`. RA000013's lines: `1160 185.2462 "Net investment interest"`, `4150 185.2462 "Lease interest income"`.
  - All 34 schedule rows `Posted`; the 34 `rentalLeaseScheduleLine` rows have `journalId` and `postedAt` stamped.
- **A8: net investment report.**
  - Accounting → Reports → "Net Investment in Leases" (`/x/reports/lease-net-investment`), As of 9/23/2026, before end of term (`.context/phase-d-ni-report-before-end.png`):
    - RA000013: At commencement $37,049.24 · collected $814.75 · NI **$36,234.49** · next interest $181.17 Sep 30 2026 · FY2026 $4,000 / FY2027 $12,000 / FY2028 $12,000 / FY2029 $7,000 · residual+option $5,000.
    - RA000014/15/16: $13,516.87 · $10,516.87 · **$3,000.00** each.
    - **Total $45,234.49.**
  - SQL Σ 1160 = **45,234.48703**. The report **ties**.
  - Final state (`.context/phase-d-ni-report-final.png`):
    - Sold and returned lines have dropped out.
    - RA000013 $36,234.49 plus RA000020 $33,035.37; total $69,269.86 vs 1160 $67,269.86.
    - The 2,000 gap is RA000020's two Advance rent invoices, with no interest run yet (O6, documented).

## Scenario B: ended leases (start 2025-10-01, end 2026-08-31, Calendar Month, Arrears, 1,000/month, 6 %, option 2,000 reasonably certain, fair value 14,000, life 120, URV 1,000)
Agreements, all created with the same form (Rent URL):

| Agreement | Customer | Unit |
|---|---|---|
| RA000014 | Apex | FA000011 / LSE100-002 |
| RA000015 | ORBSEC | FA000012 / LSE100-003 |
| RA000016 | PolarView | FA000013 / LSE100-004 |

- **B1: commencement.**
  - Activate preview: `NI $13,516.87 / COGS $29,053.39 / Lease Revenue $12,570.26 / Accumulated Depreciation $0.00 / Fixed Asset $30,000.00 / Selling profit -$16,483.13` (a selling loss, because C = 30,000).
  - Stored: `Sales-Type|13516.87133|-16483.12867`.
  - JE-000038/39/40, e.g. 038:
    ```
    5010  29053.38513 / 1160 13516.87133 / 4070 12570.25646 / 1370 -30000
    ```
  - Schedule (11 rows):
    ```
    2025-10-31 67.58436/932.41564/12584.45569 … 2026-07-31 24.77661/975.22339/3980.09949 … 2026-08-31 19.90051/980.09949/3000
    ```
  - Σ interest 483.12867 (11 Interest rows). Billing periods 11 × 1,000, due 2025-10-31 … 2026-08-31.
- **B2: invoices.**
  - Deliver ×3 → "Unit delivered".
  - Generate Invoices ×3 → AR000009 / AR000010 / AR000011, each 11 Rental lines Σ 11,000 → Post ×3.
  - JE-000041/42/43 each: `1110 +11000 (11 lines) / 1160 −11000 (11 lines)`. 0 schedule rows; 33 periods `Invoiced`.
- **B3: interest.** RR000003 (above) posted each lease's 11 months. Per-agreement 1160 after the run: RA000014 / 15 / 16 = **3,000.00000** each (= 13,516.87133 + 483.12867 − 11,000).
- **B4 (i): Sell to Customer on RA000014.**
  - Line actions → **Sell to Customer** ("A purchase option charge of $2,000.00 is billed today and its invoice drafted…") → toast **"Purchase option invoice drafted. Posting it transfers the unit to the customer."**
  - Charge row `Purchase Option|2026-09-23|2000|"Purchase option exercised"` → AR000012 line kind `Purchase Option` 2,000 → Post.
  - JE-2026-09-000045:
    ```
    1110 Accounts Receivable                 2000   (Dr AR)
    1160 Net Investment in Leases           -2000   (Cr — option)
    5010 Cost of Goods Sold - Lease Residual  1000  (Dr — shortfall 3,000 − 2,000)
    1160 Net Investment in Leases           -1000   (Cr — shortfall)
    ```
  - RA000014 1160 = **0.00000**; line **Sold**.
  - Header **Close** → "Close RA000014…" → **Closed** (`closedAt` set).
- **B5: excess leg (twin RA000017, NovaSat, FA000014).**
  - Terms: start 2025-10-01, end 2026-07-31 (10 months), option 2,000 **not** certain, URV 500, FV 10,000.
  - Preview and stored tests `{d: true}` only → Sales-Type. NI 10,206.08583, COGS 29,524.33, selling profit −19,793.91.
  - Schedule Σ interest 293.91417, closing 500.
  - Deliver → Generate Invoices → AR000013 (10 × 1,000) → Post.
  - New Run **2026-07-31** → RR000004 (10 lines, $293.91) → Post (JE-000050, posting date 2026-07-31). RA000017 1160 = **500.00000**.
  - Sell to Customer → AR000014 → Post. JE-2026-09-000051:
    ```
    1110 +2000 / 1160 -2000 (option) / 1160 +1500 / 4070 +1500 (excess: Dr 1160 / Cr Lease Revenue)
    ```
  - RA000017 1160 = **0.00000**; line **Sold**.
- **B6 (ii): Return To = Rental fleet on RA000015.**
  - Line actions → **Return**. The form shows "This is a sales-type lease… The unit can be returned on or after the end date, Aug 31, 2026…".
  - Submitting with no choice → field error **"Choose where the returned unit goes"** (line still On Rent).
  - Chose "Rental fleet, as a new fleet asset", notes → Return Unit → line `Returned|2026-09-23`.
  - JE-2026-09-000046 `Lease` "Lease return RA000015 LSE100-003": `1370 +3000 / 1160 −3000`.
  - New asset **FA000016**: Active, Rental Fleet, cost **3,000**, acquired/depreciation start 2026-09-23, 60 months / 20 %, same serial / trackedEntity.
  - Transfer FAT000012 `Capitalization|Inventory|3000`, with a journal.
  - Entity `Consumed` with `Fixed Asset` = FA000016 (Rental Agreement / Customer removed). Fleet: FA000016 Available, FA000012 Sold.
  - RA000015 1160 = **0.00000**; its 11 schedule lines are kept, all posted. Close → "Rental agreement closed".
- **B7 (iii): Return To = Inventory on RA000016.**
  - → `Returned`. JE-2026-09-000047: `1210 Raw Materials +3000 / 1160 −3000` (O2).
  - `itemLedger` `Positive Adjmt.` +1, `documentType 'Rental Agreement'`; `costLedger` layer +1 at **3,000**.
  - Entity LSE100-004 **Available** with attributes cleared, and a `Return to Inventory` activity. RA000016 1160 = **0.00000**.
- Every `Lease` journal (000036/38/39/40/46/47/48/52) balances to 0.00000.

## Classification checks (unit FA000015 / LSE100-006, reused through Cancel)
- **C1: RA000018** (ORBSEC, 2026-08-01 → 2029-07-31, Arrears, option 5,000 not certain, FV 60,000, life 120).
  - The unit form shows **OPERATING · PREVIEW**: term 30 %, PV **54.785 %**, PV $32,871.02 (`.context/phase-d-x1-operating-preview.png`).
  - The Activate confirmation lists no commencement.
  - Activate → stored `Operating`, tests all false, `pvToFairValuePercent 54.78503`, `termToLifePercent 30`; no journal, no schedule; fleet Reserved.
  - Cancel → "Cancel Agreement" → `Cancelled`, unit Available.
- **C2: RA000019**, open-ended, "Specialized asset" ON, FV 38,000.
  - Preview: **OPERATING**, with "An open-ended agreement is always an operating lease: a sales-type lease needs an end date."
  - Activate → stored `Operating` with tests `{e: true}`, no journal. Cancelled.
- **C3:** new agreement, no End Date, option 5,000, "Purchase option reasonably certain" ON → Save.
  - Form error **"A purchase option that is reasonably certain needs an end date"**. The URL stays on `/new`; agreement count 17 → 17 (`.context/phase-d-x3-option-no-end.png`).
- **C4: RA000020** (Advance, start **2026-08-15**, end 2029-07-31, option 5,000 not certain, FV 60,000; overridden to Sales-Type in C5).
  - The Activate confirmation shows, under the unit, **"FA000015 · … is a sales-type lease, which runs whole billing periods: start on the first of a month and end on a month end"** (`.context/phase-d-x4-midmonth-preview.png`).
  - Activate → toast **"FA000015 is a sales-type lease, which runs whole billing periods: start on the first of a month and end on a month end"**; agreement stays Draft.
- **C5: override on RA000020's line.**
  - Unit form → **Override** → "Override Classification" (Classification Sales-Type, Reason).
  - Submitting with an empty Reason → **"A reason is required"**, nothing saved.
  - Reason "Custom-built attachment, no alternative use for us" → toast **"Classified as Sales-Type"**. Line `classificationOverride t|Sales-Type|<reason>`.
  - Audit row in `auditLog_dapm0k5hs0gg26itf610`:
    ```
    rentalAgreementLine|rentalAgreement|rag_7ew2…|ragl_Mszx…|UPDATE|<user>|{"lessorClassification":{"new":"Sales-Type","old":null},"classificationOverride":{"new":true,"old":false},"classificationOverrideReason":{"new":"Custom-built…","old":null}}|{"origin":"web"}
    ```
    Written although `company.auditLogEnabled = false` (O1).
  - Route permission `requirePermissions(request, { update: "accounting" })` (`$id.$lineId.classification.tsx:27-29`). A denial was not exercised: only one admin user.
  - After fixing the start date (check 2) → Activate preview `NI $33,035.37 / COGS $30,000.00 / Lease Revenue $33,035.37 / Selling profit $3,035.37` → **"Rental agreement activated"**.
  - Stored `Sales-Type`, `classificationOverride t`, tests **all false**: the override is kept over the tests' Operating. Commencement JE-2026-09-000052.
- **C6: Advance numbers (RA000020).**
  - Month 1 `33035.37132|1000|160.17686|839.82314|32195.54818`; month 2 `155.97774`, matching annuity-due, interest on the balance after the payment.
  - Billing periods due on the 1st (Aug 1 and Sep 1 due) → Generate Invoices → AR000015 (2 × 1,000) → JE-000053 `1110 +2000 / 1160 −2000`.
  - **D1**: the last line's interest is −0.00001.
- **C7: early-exit guards on RA000020.**
  - Sell to Customer → toast **"The purchase option is exercised at the end of the term (2029-07-31); early termination of a sales-type lease is a manual journal"**; no charge row.
  - Return (Rental fleet) → toast **"Early termination of a sales-type lease is a manual journal"**; line still On Rent.
  - Header Cancel is disabled on commenced sales-type agreements (RA000013, RA000014).

## Final state (SQL)
- **Agreements:**
  - RA000013 Active (On Rent)
  - RA000014 Closed (Sold)
  - RA000015 Closed (Returned)
  - RA000016 Active (Returned)
  - RA000017 Active (Sold)
  - RA000018 / RA000019 Cancelled
  - RA000020 Active (On Rent)
  - RA000021 Active (Returned, operating)
- **1160 by agreement:** RA000013 36,234.48703 · RA000020 31,035.37132 · all others 0 · total 67,269.85835.
- **LSE units:** FA000010–15 Disposed (Sale), fleet Sold; FA000016 Active / Available (the returned residual).
- **Invoices (all Submitted):** AR000008–AR000015.
- **Runs:** RR000003 (2026-08-31) and RR000004 (2026-07-31), both Posted.
- **Accounting periods** 2026-07 and 2026-08 were auto-created by the back-dated runs, and `accountingPeriod.status` follows the latest posting. This is existing behaviour, and September is Active again.

## Environment notes
- **No depreciation on the LSE units (C8 NOT RUN).** "Run Next Period" on Depreciation is disabled by a seeded Draft run **DR000001** (2026-08-31, 2 lines, 50,587.50). Posting or deleting it would have changed seeded data, so every commencement ran with accumulated depreciation 0. The builder omits the zero 1380 leg; the preview shows it as $0.00.
- **Date-bound items NOT RUN:**
  - RA000013 months 2–36 (next due 2026-09-30), and its end-of-term Sell (2029-07-31). The schedule is proven to close at 5,000.00.
  - RA000020's first-month interest (2026-08-31) waits for a future run (O6).
- **Scenario A start date.** It used **2026-08-01** rather than 2026-09-01, so the month-1 Arrears invoice and the month-1 interest run fall due today. The 36-period numbers are identical.
- **Run period end.** The Scenario A/B interest run used period end 2026-08-31. RR000002 (2026-09-30, Phase C) already exists, and a run is one per period end.
- **Workarounds.** None were needed. Twin agreements were created by opening the same `/x/rental-agreement/new?fixedAssetId=…` URL the fleet "Rent" action opens (the first one through a real Rent click).
- **Residue in the dev company:**
  - item LSE-100 with one unit back in stock (LSE100-004 at 3,000);
  - FA000016;
  - the agreements, invoices and runs above;
  - `auditLog_dapm0k5hs0gg26itf610` (created by the override, O1).
- **Screenshots:** `.context/phase-d-*.png` (evidence; no FAIL screenshots, since the one defect is a data finding).
