# Verification run: Revenue recognition Phase C — rental agreements (Task 46 browser verification)

- Date: 2026-09-23 (app/DB clock and `company_today` = 2026-09-23, company timezone UTC)
- Branch / commit: revenue-recognition-rentals-spec @ a6f8de3152
- URL: https://erp.revenue-recognition-rentals-spec.dev, company "Carbon Development" (`dapm0k5hs0gg26itf610`), dev-bypass login test@carbon.ms
- Browser: `AGENT_BROWSER_SESSION=verify-phase-c`
- Mode: verify only, no code changes. Data created through the UI and the route actions it calls. Read-only SQL through `docker exec … psql`; three diagnostic INSERTs ran inside `BEGIN … ROLLBACK` (nothing persisted). **One accidental write**, disclosed under Environment.
- Plan: `.ai/plans/2026-09-22-revenue-recognition-and-rentals.md` Task 46; spec §3 + Acceptance Criteria; user doc `docs/content/docs/reference/rental-agreements.mdx`.

## Result summary

| # | Check | Result |
|---|---|---|
| 0 | Create / edit a rental agreement from the UI | **FAIL (blocker)**: D1. Everything below used a one-field workaround. |
| 0b | Open an agreement by URL (reload, new tab, deep link) | **FAIL**: D2 |
| 1 | Rate ladder on a fleet item, snapshotted at activation | PASS |
| 2 | Calendar Month Advance: 16/30 × 1,500 = 800.00; Generate Invoices; Dr AR / Cr 2160 + Deferral; run releases Dr 2160 / Cr 4060; proposed only once | PASS; the "next period on Oct 1" part is **NOT RUN** (needs Oct 1) |
| 3 | Arrears twin: accrual Dr 1145 / Cr 4060; the invoice consumes the accrual (Cr 1145) | PASS (observation O1) |
| 4 | 120.00 mileage charge: Charge line, Dr AR / Cr 4060, no schedule row | PASS |
| 5 | Deposit 3,000 → apply 500 → refund 2,500; 2110 nets to 0 | PASS |
| 6 | 28 Days Best Rate returns after 3 / 10 / 20 / 35 days | **PARTIAL**: all amounts and tiers correct, but the Return form will not submit (D3) and the re-cut Arrears period keeps its old due date, so it cannot be invoiced (D4) |
| 7 | Advance early return on day 3: −1,200 credit, Dr 2160 / Cr AR, deferral reduced to 300 | PASS (return needed the D3 workaround) |
| 8 | Advance return on day 20: no adjustment | PASS (D3 workaround) |
| 9 | Holdover past the end date on an operating line | PASS (D3 workaround; observation O2) |
| 10 | Return with "Take out of service" → In Maintenance | PASS (D3 workaround) |
| 11 | Return to Inventory refused while on rent | PASS |
| 12 | Close checklist revenue task fails on an unaccrued month, passes after the run | PASS |
| 13 | Rental Utilization report | PASS (every figure matches the arithmetic) |
| 14 | Crafted `/x/sales-invoice/<draft>/<posted-line>/delete` refused | PASS |
| 15 | A Draft agreement holding a deposit can be deleted | PASS |
| + | Future return date refused; a second Generate Invoices is a no-op; deleting a draft invoice releases its period; a duplicate run for a period is refused | PASS |

## Defects

### D1 (blocker): no rental agreement can be created or edited from the UI
- **UI:** New Rental Agreement → Save shows the toast **"Failed to create rental agreement"** and returns to the list. Saving an existing Draft's Terms shows **"Failed to update rental agreement"** (screenshot `.context/phase-c-fail-update-rental-agreement.png`).
- **Wire:** Kong log shows `POST /rest/v1/rentalAgreement?columns=…"exchangeRate"…` → **400**, and `PATCH /rest/v1/rentalAgreement?id=eq.…&status=eq.Draft` → **400**.
- **DB error** (reproduced in a rolled-back transaction): `null value in column "exchangeRate" of relation "rentalAgreement" violates not-null constraint`.
- **Cause:** `rentalAgreementTerms()` (`apps/erp/app/modules/sales/sales.service.ts:7926`) names `exchangeRate: terms.exchangeRate` explicitly. The form (`RentalAgreementForm`) never posts `exchangeRate`, and the validator makes it optional (`sales.models.ts:1359`), so the value is `undefined`. `sanitize()` then turns it into `null` (insert at `sales.service.ts:7951`, update at `:8002`), and the column is `NOT NULL DEFAULT 1` (migration `20260923003525_rental-agreements.sql:47`).
- **Origin:** commit f5b1b8188d ("enforce rental guards on the server") replaced `...sanitize(rentalAgreement)`, where an absent key was never sent, with the explicit field pick.
- **Workaround for this run:** the same form was submitted to the same route action with one extra hidden input, `exchangeRate=1`. The Terms edit path was not used again.

### D2: loading an agreement's URL directly returns a raw React Router error
- **Repro:** Hard-load `/x/rental-agreement/<id>` or `/x/rental-agreement/<id>/details` (reload, new tab, or pasted link). The body is JSON: `You made a GET request to "/x/rental-agreement/<id>/details" but did not provide a loader for route "routes/x+/rental-agreement+/$id.details"`. Opening the agreement by clicking it in the list still works.
- **Cause:** `apps/erp/app/routes/x+/rental-agreement+/$id.details.tsx` exports only an `action`, with no `loader` and no default component, so it is a resource route. Yet `$id._index.tsx:8` and every action redirect to `path.to.rentalAgreementDetails` (`/details`). By comparison, `x+/fixed-asset+/$fixedAssetId.details.tsx` has a default export.

### D3 (high): the Return form never submits for an operating unit
- **Repro:** Line actions → Return → "Return Unit". The click does nothing: no toast, no field error, and no POST reaches the server (checked in the ERP log). The same happens with a valid date (screenshot `.context/phase-c-fail-return-form-no-submit.png`).
- **Cause:** `RentalAgreementReturnForm.tsx:77` renders `<Hidden name="isSalesType" value={isSalesType ? "true" : ""} />`, but the validator declares `isSalesType: zfd.checkbox({ trueValue: "true" })` (`sales.models.ts:1452`). That schema accepts only `"true"` or `undefined`. Running it under `tsx` with `""` gives `invalid_union`. Client-side ValidatedForm validation therefore fails on a hidden field that shows no error. The server action would reject the same body.
- **Origin:** Phase D commit e271366816.
- **Scope:** this blocks every operating return from the UI (early return, day-20, ladder, holdover, take out of service).
- **Workaround for this run:** disable the empty hidden input before `requestSubmit`, so the body omits the field, which is what a correct form sends for an operating line. The route re-reads the classification from the line (`$id.$lineId.return.tsx` action), so this does not bypass any server guard.

### D4 (medium): an Arrears period re-cut by a return keeps its original due date
- **Repro:** RA000008 (28 Days, Arrears, start 2026-09-21), returned on 2026-09-23. The period is correctly re-cut to Sep 21 – Sep 23, 3 days, Day tier, 300.00, but `dueOn` stays **2026-10-18**. "Generate Invoices" answers "Nothing is due on this agreement yet", and the page shows "Due Oct 18, 2026" (screenshot `.context/phase-c-fail-arrears-recut-dueOn.png`).
- **Same on the other re-cut periods:**
  - RA000009 (10 days) is due 10-11.
  - RA000010 (20 days) is due 10-01.
  - RA000011 (35 days) has period 2 due 10-14.
  - RA000012 (holdover) has its re-cut September period due 09-30.
- **Effect:** the final Arrears invoice after a return is held back until the original natural period end, up to 25 days after the unit came back. The agreement also cannot be closed until then. The doc says Arrears is due "on its last [day]", and the spec's return example expects the final period to be proposed at return.
- **Cause:**
  - `RecutPeriod` (`packages/database/supabase/functions/shared/rental-billing.ts:58`) has no `dueOn`.
  - The return's re-cut update (`post-rental-agreement/index.ts:1169-1186`) sets `periodEnd`, `days`, `amount` and `rateUnitApplied`, but not `dueOn`.
  - For Arrears, `dueOn` should become the new `periodEnd`.

### Observations (not failing a check)
- **O1: pre-delivery rent lands on the period's last day.** On RA000005 (delivered on the last day of its first period), the non-accrued remainder 1,446.43 was deferred as a single row dated 2026-09-23 → 2026-09-23. It was not spread over the billed days Aug 27–Sep 22. This is the documented choice in `post-sales-invoice/rental-posting.ts:167-169` ("deferred from the day after the last accrued day"), and totals are right. The effect is that rent billed for days before delivery is recognized in the month the period ends.
- **O2: holdover periods are cut at activation.** Activation cuts a holdover period even when the fixed term has not ended yet:
  - RA000006 (term Sep 21 – Oct 18, activated Sep 23) got an Oct 19 – Nov 15 period.
  - RA000012 got September and October holdover periods at activation.
  - Cause: `generateRentalBillingPeriods` runs to `through = today + 28` when the end date is earlier (`shared/rental-billing.ts:280`).
  - A return before the end date deletes them (verified), but until then "Unbilled" and the billing table show rent past the term.
- **O3: UI nits.**
  - The run page's **Accruals** "Source" column shows raw line ids (`ragl_…`); Deferrals show invoice numbers.
  - Invoice line descriptions repeat the serial ("… Fleet Vehicle 100 VEH100-001 VEH100-001").
  - A refused crafted line delete shows only "Failed to delete sales invoice line", not the specific reason.
  - Take Out of Service on an On Rent unit, opened from the asset page's Actions menu, is refused, but no toast was visible to the user.
  - The asset page still offers "Return to Inventory" for an On Rent unit; the server refuses it.
- **O4: deposit journal document type.** The deposit journal lines carry `documentType 'Payment'` / the payment id, not the `'Rental Agreement'` / agreement id the spec text describes. The description "Customer Deposit" is present.
- **O5 (pre-existing, not Phase C): empty serial accepted.** The inventory adjustment modal accepted an EMPTY serial number for a serial-tracked item (see Environment).

## Setup (all UI)
- **Revenue recognition:** Settings → Accounting → "Revenue recognition" switch → toast "Revenue recognition enabled"; `companySettings.revenueRecognitionEnabled = t`. Accounting was already on. Account defaults were already mapped:
  - deferred revenue 2160
  - contract assets 1145
  - rental income 4060
  - prepayments 2110
- **Item:** `/x/part/new` → VEH-100 "Fleet Vehicle 100", Buy, Tracking **Serial**, Unit Cost 42,000 → `item_JWryRZm5yBhfFkfW6rdTPt`.
- **Stock:** Inventory → Update Inventory (Positive Adjustment, Manufacturing Plant), five adjustments with serials VEH100-001…005.
- **Fleet:** each serial capitalized through `/x/fixed-asset/capitalize?itemId=…&trackedEntityId=…` (Asset Class preselected "Rental Fleet", transfer 2026-09-23). Result: FA000005–FA000009, each Active, Rental Fleet, cost 42,000, acquired 2026-09-23; `fleetAssets.fleetStatus = Available` for all five.
- **Accounting periods:** auto-created on first posting (September 2026, Open).

## Check 1: Rate ladder: PASS
- Part → Sales tab → "Rental Rates" card (shown for the serial part): Day 100 / Week 500 / Month 1,500 → Save. SQL `itemRentalRate`: `USD|100|500|1500`.
- The Add Unit drawer shows `Day $100.00 · Week $500.00 · Month $1,500.00 — From the item's rental rates. They are snapshotted onto the line when the agreement is activated.`
- After activation, each line carries `dayRate 100, weekRate 500, monthRate 1500`.
- Raising the item's Day Rate to 120 afterwards (Sales tab save, SQL `120|500|1500`) left RA000003/4/5 lines at `100|500|1500`. The rate was then reverted to 100.

## Check 2: Calendar Month Advance (RA000003): PASS, with the October step NOT RUN
- **Setup:** NovaSat Networks, start 2026-09-15, open-ended, Calendar Month, Advance, deposit 3,000 (D1 workaround). Add Unit FA000005 (Best Rate) → toast "Added unit to the agreement" → Activate (confirm "Activate RA000003") → toast "Rental agreement activated".
- **Activation SQL:** header `Active`; line `Pending|Operating`; no journal written (journal count unchanged). Fleet status became **Reserved**.
- **Billing periods:**
```
2026-09-15|2026-09-30|16|Month| 800|due 2026-09-15|Pending   ← 1,500 × 16/30 = 800.00
2026-10-01|2026-10-31|31|Month|1500|due 2026-10-01|Pending
2026-11-01|2026-11-30|30|Month|1500|due 2026-11-01|Pending   (horizon = end of next month + one)
```
- **Deliver:** Line actions → Deliver ("Mark the unit as delivered to the customer today…") → "Unit delivered". Line `On Rent|deliveredAt 2026-09-23`, fleet `On Rent`.
- **Generate Invoices** (confirm "Draft a sales invoice for every billing period and charge due today") → "Drafted 1 rental invoice". Draft AR000002 (`si_GvApMbqVAxDZHLGsXzUYTy`) has:
  - `Rental|Rent|"2026-09-15 – 2026-09-30 · 16 days · Month rate — …"|1 × 800|service 09-15→09-30`
  - the Charge line (check 4)
  - the period stamped `Invoiced` with the line id
- **Idempotent:** a second Generate Invoices → toast "Nothing is due on this agreement yet"; the Rental line count stays 2.
- **Post** AR000002 → "Sales invoice confirmed". Journal JE-2026-09-000015 (natural-balance signs):
```
1110 Accounts Receivable  800  Invoice si_Gv…
1110 Accounts Receivable  120  Invoice si_Gv…
2160 Deferred Revenue     800  Rental Agreement RA000003   ← Cr 2160 800
4060 Rental Income        120  Rental Agreement RA000003   ← charge (check 4)
```
  Schedule row: `Deferral|Planned|2026-09-15→09-30|scheduled 2026-09-30|800|Dr 2160|Cr 4060`.
- **Run:** RR000002 (period end 2026-09-30, see check 12) posted `2160 −800 / 4060 +800 "Revenue recognized" Invoice si_Gv…` and the row became `Posted`.
- **Never twice:**
  - Generate Invoices re-run → nothing due.
  - A second run for 2026-09-30 → toast "A revenue recognition run already exists for this period".
  - The Deferral row is Posted, so it cannot be claimed again.
- **NOT RUN:** proposing the next period on/after Oct 1 needs Oct 1. It currently sits `Pending, due 2026-10-01`, not proposed.

## Check 3: Arrears twin: PASS
- **RA000004:** Apex Space Research, Calendar Month, **Arrears**, start 2026-09-15, FA000006, delivered 2026-09-23.
  - Periods: `09-15→09-30 800 due 09-30`, `10-01→10-31 1500 due 10-31`, `11-01→11-30 1500 due 11-30`.
  - Generate Invoices → "Nothing is due on this agreement yet" (nothing proposed before the period ends).
  - Run accrual: slice Sep 23–30 = 800 × 8/16 = **400.00** `Accrual Dr 1145 / Cr 4060`, posted by RR000002 as `1145 +400 "Unbilled rent accrued" / 4060 +400 "Rental income accrued"` (Rental Agreement RA000004).
- **Invoice consuming the accrual:** the Calendar Month twin's Sep invoice cannot be drafted before Sep 30, so the consumption was exercised on **RA000005**:
  - Setup: PolarView Earth, **28 Days, Arrears**, start 2026-08-27, FA000007, delivered 2026-09-23. Period 1 is `08-27→09-23 28 days Month 1,500 due 09-23`.
  1. Generate Invoices → Draft AR000003 ("2026-08-27 – 2026-09-23 · 28 days · 1 × Month rate").
  2. New Run for 2026-09-30 (RR000001, temporary) synthesized:
     - period 1, Sep 23: 1,500 − round(1,500 × 27/28) = **53.57143**
     - period 2, Sep 24–30: 1,500 × 7/28 = **375.00**
     - RA000004: 400.00
  3. **Post AR000003** → JE-2026-09-000019:
```
1110 Accounts Receivable  1500
1145 Contract Assets      -53.57143   ← Cr 1145 (the accrual), instead of 2160
2160 Deferred Revenue    1446.42857   ← Cr 2160 for the non-accrued remainder
```
     The accrual row is stamped `billedBySalesInvoiceLineId = GfFtQtzo…`. The remainder became `Deferral 09-23→09-23 1446.42857` (O1).
  4. RR000001 (Draft) was deleted ("Successfully deleted revenue recognition run"). The rows were unclaimed and kept, then re-proposed and posted in RR000002.
- **Ledger after RR000002:** 1145 = +1,225.00 (run) − 53.57 (invoice) = **1,171.43**, which is the open unbilled accruals.

## Check 4: Mileage charge: PASS
- RA000003 → Add Charge (unit FA000005, date 2026-09-23, "Mileage overage 400 mi", 120, tax 0%) → "Added charge". SQL: `rentalAgreementCharge Charge|2026-09-23|120`.
- It rode AR000002 as `Rental|Charge|"Mileage overage 400 mi"|120`, and the charge is stamped with the line id.
- Posting: Dr 1110 120 / Cr **4060 120** (above).
- No schedule row: `revenueRecognitionSchedule` rows for AR000002 = only the 800 Deferral.

## Check 5: Deposit 3,000 → apply 500 → refund 2,500: PASS
1. **Receipt:** RA000003 → Deposits → "Record Deposit" → `/x/payments/new?customerId=…&rentalAgreementId=…&amount=3000`. The form is prefilled Payment from Customer / NovaSat / **"Deposit for" RA000003** ("Unapplied cash is held as a customer prepayment…") / 3,000 / 1010. Save → PAY-2026-09-000001 → Post. JE-2026-09-000016: `1010 +3000 "Bank / Cash"`, `2110 +3000 "Customer Deposit"` → **Dr cash 3,000 / Cr 2110 3,000**.
2. **Apply 500:** New zero-cash receipt for NovaSat (PAY-2026-09-000002). Its "Apply to invoices" table shows "On-account credit available $3,000.00". Set AR000002 applied 500 ("Drawing $500.00 from on-account credit") → Save applications → Post.
   - `invoiceSettlement`: `targetSalesInvoiceId si_Gv…|applied 500|sourcePaymentId = PAY-…001`.
   - JE-2026-09-000017: `1110 −500`, `2110 −500 "Customer Deposit (applied)"` → **Dr 2110 500 / Cr AR 500**.
   - AR000002 is Partially Paid, balance 420 (920 − 500).
3. **Refund 2,500:** New payment, Type "Refund to Customer", **"Refund deposit for" RA000003** (the options listed agreements and sales orders), 2,500 → PAY-2026-09-000003 Disbursement → Post. JE-2026-09-000018: `1010 −2500`, `2110 −2500 "Customer Deposit"` → **Dr 2110 2,500 / Cr cash 2,500**.
4. **Σ 2110 = 0.00** (SQL sum over all 2110 lines).

## Check 6: 28 Days Best Rate returns (Arrears): PARTIAL
Each ladder agreement is NovaSat, 28 Days, Arrears, Best Rate, open-ended, on unit FA000008 (reused), delivered and returned on 2026-09-23 (the D3 workaround was needed for every return).

| Agreement | Start | Days used | Periods after return | Expected | Due (D4) |
|---|---|---|---|---|---|
| RA000008 | 09-21 | 3 | `09-21→09-23 3 Day 300` | 3 × 100 = 300 | 10-18 (should be 09-23) |
| RA000009 | 09-14 | 10 | `09-14→09-23 10 Week 1000` | 2 × 500 = 1,000 (ties 10 × 100; larger unit wins) | 10-11 |
| RA000010 | 09-04 | 20 | `09-04→09-23 20 Month 1500` | 1 × 1,500 (ties 3 × 500) | 10-01 |
| RA000011 | 08-20 | 35 | `08-20→09-16 28 Month 1500` + `09-17→09-23 7 Week 500` | 1,500 + 500 = **2,000** | 09-16 / 10-14 |

- Tiers and amounts all match.
- Before each return the line had three 28-day 1,500 periods. The return deleted the Pending periods after the return date and re-cut the one it fell in.
- **FAIL part (D4):** the re-cut periods keep their pre-return due dates, so Generate Invoices on RA000008 answers "Nothing is due". The invoice text "10 days · 2 × week rate" could not be observed for that reason.
- **Line text seen instead:** RA000011's period 1 (due 09-16) drafted AR000007 as "2026-08-20 – 2026-09-16 · 28 days · 1 × Month rate …". Deleting that draft ("Delete AR000007") set the period back to `Pending` with no stamp, so a deleted draft invoice releases its period.

## Check 7: Advance early return on day 3 (RA000006): PASS
- **Setup:** ORBSEC, 28 Days, **Advance**, Best Rate, 2026-09-21 → 2026-10-18 (exactly 28 days), FA000008.
- **Activation periods:** `09-21→10-18 28 Month 1500 due 09-21`, plus a holdover period `10-19→11-15` (O2).
- **Advance invoice:** Generate Invoices → AR000004 → Post → JE-2026-09-000020: Dr 1110 1,500 / Cr 2160 1,500. Deferral rows:
  - `09-21→09-30 535.71429` (10/28)
  - `10-01→10-18 964.28571` (18/28)
- **Future-date check:** delivered, then the Return form with date 2026-09-24 → toast **"The return date cannot be in the future"** (line still On Rent).
- **Return on 2026-09-23** (day 3) → "Unit returned":
  - line `Returned`, fleet `Available`
  - the holdover period was deleted
  - new adjustment row `09-21→10-18|3|Day|-1200|isAdjustment|due 09-23` = 1,500 − 3 × 100
- **Credit invoice:** Generate Invoices → AR000005 "Early return credit — 3 days used …" 1 × −1,200 → Post → JE-2026-09-000021: `1110 −1200 / 2160 −1200` → **Dr 2160 1,200 / Cr AR 1,200**.
- **Deferral effect:** negative rows `10-01→10-18 −964.28571` and `09-21→09-30 −235.71429` (latest first). Net Planned by date: **2026-09-30 = 300.00**, 2026-10-18 = 0.00. RR000002 recognized 535.71 − 235.71 = **300.00** for September.

## Check 8: Return on day 20 (RA000007): PASS
- **Setup:** ORBSEC, 28 Days, Advance, 2026-09-04 → 2026-10-01, FA000008.
- AR000006 1,500 posted (JE-2026-09-000022, Dr 1110 / Cr 2160 1,500). Deferrals `09-04→09-30 1446.42857` and `10-01 53.57143`.
- Delivered, then returned 2026-09-23 (day 20). Periods afterwards: only the invoiced `09-04→10-01 1500`.
- **No adjustment row**: 20 days at best rate is the month tier, 1,500, and 1,500 − 1,500 = 0. The holdover period 10-02 was dropped.

## Check 9: Holdover (RA000012): PASS
- **Setup:** Apex, Calendar Month, Arrears, 2026-08-01 → 2026-08-31, FA000009, delivered 2026-09-23 (after the end date).
- **Periods at activation:** `08-01→08-31 1500`, `09-01→09-30 1500`, `10-01→10-31 1500` (holdover at the same rate).
- The header reads **"ACTIVE · PAST END DATE"**, Term "Aug 1, 2026 – Aug 31, 2026", Unbilled $4,500.00 (screenshot `.context/phase-c-holdover-header.png`).
- **Return 2026-09-23:**
  - September re-cut to `09-01→09-23 23 Month` **1,150.00** (1,500 × 23/30)
  - October deleted
  - August untouched
  - the September due date stays 09-30 (D4)

## Check 10: Return with "Take out of service": PASS
- Same RA000012 return: Take out of service ON, Out of Service Reason "Brake inspection", Meter Reading 12450, Return Notes "Returned after holdover" → "Unit returned".
- SQL: line `Returned`, `meterIn 12450`, `returnNotes` saved. `fleetAssets`: **FA000009 | In Maintenance | Brake inspection**.

## Check 11: Return to Inventory blocked while on rent: PASS
- FA000009, while On Rent on RA000012 → asset page Actions (Edit / Sell / Return to Inventory / Take Out of Service / Dispose) → Return to Inventory → submit.
- Toast: **"Asset FA000009 is on rent on rental agreement RA000012; return it from the agreement first"**. Asset still `Active`, fleet still `On Rent`.
- Take Out of Service from the same menu, and loading `/out-of-service` directly, were refused as well (no dialog, asset unchanged; O3: no toast visible).

## Check 12: Close checklist and the September run: PASS
- **Before any run:** `/x/accounting/periods/<Sep>/close` shows "Recognize revenue for the period | Auto | WARNING | **OPEN**". Cause: a Planned 800 deferral is due, and RA000004/RA000005 were on rent with no accrual.
- **Just before the final run:** still **OPEN**, with 8 Planned rows due ≤ 09-30 totalling 4,821.43.
- **RR000002** (New Run, period end 9/30/2026; the dialog defaulted to 8/31) → the run page lists:
  - **Deferrals** (5 lines, **3,992.86**):
    - AR000003 1,446.43
    - AR000004 535.71
    - AR000006 1,446.43
    - AR000002 800.00
    - AR000005 −235.71
  - **Accruals** (8 lines, **1,225.00**):
    - RA000004 400
    - RA000008 100 (300 − 200)
    - RA000005 375
    - RA000011 71.43 (500 − 428.57)
    - RA000005 53.57
    - RA000009 100 (1,000 − 900)
    - RA000012 50 (1,150 − 1,100)
    - RA000010 75 (1,500 − 1,425)

  Each accrual is the cumulative-rounding slice for the delivery day.
- **Post Run** → `Posted`, JE-2026-09-000023, source type Revenue Recognition, posting date **2026-09-30**:
```
1145 Contract Assets   8 lines  +1,225.00000   (Dr)
2160 Deferred Revenue  5 lines  −3,992.85714   (Dr)
4060 Rental Income    13 lines  +5,217.85714   (Cr)   balanced
```
- **After:** the close task reads **DONE** (screenshot `.context/phase-c-close-task-after-run.png`). A second run for 2026-09-30 → "A revenue recognition run already exists for this period".
- **Remaining Planned rows** (all after Sep 30): RA000007 10-01 53.57; RA000006 10-18 +964.29 / −964.29. The 2160 balance is 53.57, which matches them.

## Check 13: Rental Utilization, 2026-09-01 → 2026-09-30 (30 days): PASS
Every unit was acquired on 2026-09-23, so fleet days = Sep 23–30 = 8. Income is the Posted 4060-credit schedule rows plus posted Charge lines. Dollar utilization = income × 365/30 ÷ 42,000. Screenshot `.context/phase-c-rental-utilization-sep.png`.

| Unit | Fleet | On rent | Time | Income (expected) | Dollar (expected) | UI |
|---|---|---|---|---|---|---|
| FA000005 | 8 | 8 (open line, Sep 23–30) | 100% | 800 + charge 120 = 920 | 920 × 12.1667 / 42,000 = 26.651% | 8 · 8 · 100% · $920.00 · 26.651% |
| FA000006 | 8 | 8 | 100% | accrual 400 | 11.587% | matches |
| FA000007 | 8 | 8 | 100% | 53.57 + 375 + 1,446.43 = 1,875 | 54.315% | matches |
| FA000008 | 8 | 1 (six lines, all Sep 23, unioned) | 12.5% | 300 + 1,446.43 + 100 + 100 + 75 + 71.43 = 2,092.86 | 60.626% | matches |
| FA000009 | 8 | 1 | 12.5% | 50 | 1.448% | matches |
| **Total Rental Fleet** | 40 | 26 | **65%** | **5,337.86** (= run 5,217.86 + charge 120) | 5,337.86 × 12.1667 / 210,000 = **30.926%** | matches |

## Check 14: Crafted invoice-line delete: PASS
- Opened `/x/sales-invoice/si_ET7qUpVkfiavuCDr4f65Aw/QAE1JGUx15pQQzLWzqjozJ/delete`: draft AR000003 in the URL, with AR000002's **posted** Rent line.
- The confirm dialog renders ("…delete the sales invoice line for 1 2026-09-15 – 2026-09-30 · 16 days…?"). Delete → toast "Failed to delete sales invoice line".
- SQL: the line still exists on `si_Gv…` (AR000002), and its period is still `Invoiced` with the stamp.

## Check 15: Delete a Draft agreement holding a deposit: PASS
- On Draft `RA-TEST-ROLLBACK` (see Environment): "Record Deposit" → PAY-2026-09-000004 (3,000, Draft, `rentalAgreementId = rag_Ncx1…`).
- Agreement header ⋯ → "Delete Agreement" → confirm → toast "Deleted rental agreement".
- SQL: the agreement is gone; the payment has `rentalAgreementId NULL` and `companyId dapm0k5hs0gg26itf610` kept, so the composite SET NULL fix works.
- The payment was left Draft to keep 2110 clean. The FK path is the same for a posted deposit.

## Final state (SQL)
- **Agreements:** RA000003–RA000012 all Active. RA000001 and RA000002 were consumed by the two failed D1 attempts.
- **Lines:**
  - RA000003/4/5 On Rent (FA000005/6/7)
  - RA000006–011 Returned (FA000008)
  - RA000012 Returned (FA000009)
- **Fleet:** FA000005–007 On Rent, FA000008 Available, FA000009 In Maintenance.
- **Invoices:**
  - AR000002 Partially Paid 420
  - AR000003 1,500
  - AR000004 1,500
  - AR000005 −1,200
  - AR000006 1,500 (all Submitted)
  - AR000001 is the seeded draft
- **Rental-activity balances since 13:19 UTC** (natural signs):
  - 1010: +500 (3,000 − 2,500)
  - 1110: +3,720 (920 + 1,500 + 1,500 − 1,200 + 1,500 − 500)
  - 1145: +1,171.43
  - 2110: 0
  - 2160: 53.57
  - 4060: 5,337.86

## Environment notes (read these)
- **Accidental write.** While diagnosing D1, a `curl` POST to PostgREST with `Prefer: tx=rollback` was NOT rolled back: the server ignores that preference under its default config. It committed one Draft agreement, `RA-TEST-ROLLBACK` (`rag_Ncx1pNzyzPDr7SV74AZ9e5`). It was later deleted through the UI in check 15, and it is the agreement the Draft deposit PAY-2026-09-000004 was recorded against.
- **Leftover draft deposit.** PAY-2026-09-000004 (3,000, Draft, no document) remains. It counts in "Post pending operational documents" on the September close.
- **Blank-serial units.** Four VEH-100 units with **blank serial numbers** are in stock (Positive Adjmt., 42,000 each): a shell loop filled the serial field with an empty string and the modal accepted it (O5). Real serials VEH100-001…005 were adjusted in afterwards and capitalized. The four blanks sit in inventory and appear in no fleet or rental data. They were not removed, because doing so would need more adjustments.
- **Workarounds used:** D1 (injected `exchangeRate=1` hidden input on agreement create) and D3 (omitted the empty `isSalesType` hidden input on return). Both went through the same route actions the UI calls; neither bypasses a server guard.
- **Accruals on same-day delivery.** Dates were re-based to 2026-09-23. With Deliver stamping today, every accrual covers only days from Sep 23. Units delivered and returned on the same day give one on-rent day.
