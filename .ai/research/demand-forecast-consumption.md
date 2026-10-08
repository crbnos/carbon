# Demand Forecast Consumption Research: Best Practices Survey

## Summary

Surveyed how SAP, Oracle (EBS + Fusion), NetSuite, Dynamics 365 SCM, Epicor Kinetic,
Infor (SyteLine + LN), Plex, Odoo, and MRPeasy reconcile demand forecasts with actual
sales orders / production orders in MRP, with emphasis on the zero-forecast-gap problem
(an order landing in a bucket with no forecast) and configuration surface. Two families
emerged. The **classical APICS model** (SAP, Oracle, Epicor, SyteLine, LN): net demand =
actual orders + *unconsumed forecast remainder*, computed by decrementing individual
forecast entries within a backward/forward consumption window — precise, but the window
arithmetic is the #1 practitioner footgun (gaps double-count, overlaps over-consume).
The **modern bucket-native model** (Odoo MPS, MRPeasy, D365's "dynamic period"): per-bucket
greater-of / interval-owned consumption with no day-window arithmetic — trades entry-level
precision for eliminating the whole gap/window bug class. Nearly every modern engine
computes consumption **regeneratively at plan-run time** (SAP is dynamic-at-read; Fusion,
D365, LN recompute per run); only Oracle EBS persists consume/unconsume state, at the cost
of a background process and reconciliation reports. Universally, **only demand consumes
forecast** — production orders are supply and are netted by the planning balance, never by
forecast consumption (SAP strategy 70 / LN dependent-demand consumption being the deliberate
component-level exception).

## Competitors Surveyed

- **SAP S/4HANA / ECC PP** — the reference model: planning strategies, consumption modes 1–5, PIR reduction
- **Oracle EBS / Fusion Cloud Supply Planning** — richest windowing rules (workdays, bucket eligibility, overconsumption records)
- **Oracle NetSuite** — Oracle-derived but simplified; per item-location windows
- **Microsoft Dynamics 365 SCM** — reduction keys + the "dynamic period" alternative to windows
- **Epicor Kinetic** — mid-market discrete; days-before/days-after windows and their documented failure modes
- **Infor SyteLine (CSI)** — the most explicit backward/forward walk (`Look Behind`/`Look Ahead`); original vs outstanding quantity
- **Infor LN** — period-sequential consumption with backward/forward day parameters; "Nonconsumed Forecast" field
- **Plex** — negative result: no public consumption engine; demand arrives as EDI releases; real planning delegated to a separate product
- **Odoo MPS / MRPeasy** — the modern simplified bucket-native take

## Key Consensus Patterns

### 1. Net demand = actuals + unconsumed forecast remainder (never a blind sum)

- **SAP** (strategy 40): sales orders consume PIRs; remaining PIR + full sales orders drive MRP. Worked example: PIR 100, SO 90 → demand 90 (SO) + 10 (PIR) = 100. When actuals exceed forecast, excess stands as net additional demand ("the system automatically adjusts the master plan").
- **Oracle**: identical principle; forecast entries carry original vs current quantity; sales orders remain full demand, forecast floors at 0.
- **SyteLine**: `Original Quantity` vs `Outstanding Requirement`; the outstanding remainder is what plans.
- **Rationale**: reproduces `max(forecast, actual)` per bucket in the same-bucket case, while remaining well-defined when consumption crosses buckets. All three user cases fall out: 10F/10SO→10, 10F/5SO→10, 10F/12SO→12.

### 2. Consumption is regenerative, not stored state (modern consensus)

- **SAP**: allocation is dynamic — "nothing is changed on the database"; MD04 derives it at read time from sales requirements (VBBE) vs PIR tables. Order changes/cancellations self-heal on next read. (Permanent PIR *reduction* is a separate mechanism, at goods issue.)
- **Oracle Fusion**: consumption computed inside every plan run from the open-SO snapshot; a cancelled/shipped order simply isn't in the next snapshot.
- **D365**: reduction recomputed during each master-planning (regenerative) run; no consumed-qty on the forecast line.
- **Oracle EBS** is the counterexample — persisted consume/deconsume via the Planning Manager background process — and carries exactly the complexity you'd expect: deconsumption rules per change type, RMA/new-forecast edge cases, rebuild reports.
- **Rationale**: recomputing from the live order set is what makes forecasts "self-heal" with zero communication between sales and production — nothing to un-consume, no drift, no repair jobs.

### 3. Backward first, then forward (when windows exist)

- **SAP** mode 2 (backward then forward) is the conventional choice; search is nearest-date-first outward, in **workdays**.
- **Oracle** EBS/Fusion: exact-date match → backward day-by-day → forward.
- **SyteLine**: exact due-date match → backward (Look Behind) → forward (Look Ahead), in working days.
- **D365 Planning Optimization** (reduction-key overflow): previous period first, then next.
- **Rationale**: an order arriving "late" relative to its bucket was almost certainly part of the just-passed forecast; forward consumption is the fallback, and oversizing it "carries forecast demand deep into the period even when the likelihood of orders is diminishing" (Infor's own warning).

### 4. Window sized to the bucket — or replaced by the bucket

- **Oracle** weekly-bucket rule: once the window *touches* a week, the **whole week's** forecast is eligible — so "backward ≈ one work-week" suffices for weekly buckets; Fusion encodes the recommendation as a checkbox, "Consume by forecast bucket".
- **D365 "Transactions – dynamic period"**: each forecast entry owns the interval from its date until the next entry's date — zero-forecast gaps *between entries* cannot exist by construction; only orders before the first entry consume nothing. Excess is dropped, never forwarded.
- **Epicor/SyteLine** leave window sizing to the customer, and the epiusers threads document the result: monthly forecast + too-narrow window = orders at month-end "doubled up on expected demand," with no clean in-product fix — the exact bug this feature exists to solve.
- **Rationale**: day-granular windows on bucketed forecasts is complexity without benefit; bucket-granular consumption (same bucket, then N buckets back, then M forward) is where both Oracle and D365 landed.

### 5. Only demand consumes forecast; production orders are supply

- **SAP** strategy 40: production orders/stock never consume VSF PIRs — they net in the requirements calculation. (Strategy 70/dependent-requirements consumption is the deliberate assembly-level exception.)
- **Oracle**: WIP jobs trigger *production relief of the MPS* — a supply-side dedup, explicitly not forecast consumption.
- **Epicor**: "Forecast will only be consumed by Sales Orders, and nothing else."
- **D365** offers "Reduce forecast by: All transactions" (any issue transaction, incl. production consumption of BOM lines) as the opt-in broader mode.
- **Rationale**: a make-to-stock job *covers* the forecast (supply vs demand netting); making it also consume the forecast double-relieves. Component-level actual demand (job materials) consuming component-level forecast is the legitimate variant (LN dependent demand, SAP 70).

### 6. Past-due forecast must expire

- **SAP**: no automatic cleanup — stale PIRs keep driving supply until MD74/75/76 reorganization jobs zero them; a documented operational burden.
- **D365**: the opposite pole — all forecast dated on/before today is ignored wholesale by the run.
- **Epicor**: unconsumed past forecast generates backdated PO suggestions until manually deactivated (documented complaint).
- **NetSuite/Oracle**: demand time fence — inside the fence only actual orders count.
- **Rationale**: a forecast bucket in the past that didn't materialize is exactly the "sales didn't tell production" staleness this feature is meant to absorb; D365's drop-the-past rule is the self-healing default.

## Answers to Research Questions

1. **Canonical algorithm; run-time vs stored state** — Actuals + unconsumed forecast remainder per bucket (== `max` in the same-bucket case), computed regeneratively each plan run / at read time (SAP, Fusion, D365, LN). Stored consumed-state (EBS) is the legacy exception and brings deconsumption machinery with it.
2. **Window mechanics** — Exact bucket/date first; backward before forward everywhere except SAP mode 3/4 opt-ins; units are workdays (SAP, Oracle, SyteLine) or whole periods (D365 reduction keys, SAP mode 5, Oracle Fusion buckets); excess beyond the window's forecast stands as additional net demand (never forced onto out-of-window forecast; D365 drops rather than forwards overflow across entries).
3. **Configuration surface** — SAP: material master MRP 3 (per item) with MRP-group fallback (per plant). Oracle EBS: forecast set; Fusion: plan options. NetSuite: item-location. Epicor: company default + part/site override. SyteLine: site Planning Parameters + product-code override. D365: master plan (method) + coverage group (reduction key, what consumes). Standard names: *consumption mode*, *backward/forward consumption period* (SAP); *backward/forward consumption days* (Oracle/NetSuite); *reduction principle/key* (D365); *forecast window days before/after* (Epicor); *look behind/look ahead* (SyteLine). "Forecast consumption" is the industry term to adopt.
4. **Do jobs consume forecast?** — No, in every default configuration (jobs are supply; supply nets in the balance). Component-level dependent demand consuming component forecast is an explicit opt-in (LN, SAP 70, D365 "All transactions"). Shipped demand: handled by a *separate* relief/exclusion mechanism (SAP reduction at goods issue; D365 excludes invoiced/delivered by default in Planning Optimization — a known double-count gap they later patched; regenerative engines simply drop closed orders from the snapshot).
5. **Bucket granularity & the past** — Dated entries (SAP/Oracle/D365/Epicor) vs fixed buckets (Odoo/MRPeasy; Carbon's model). Oracle's whole-bucket-eligibility rule bridges the two. Past unconsumed forecast: dropped wholesale (D365), fenced (Oracle/NetSuite DTF), or a manual cleanup burden (SAP MD74, Epicor) — the burden is the anti-pattern.
6. **Terminology** — "Forecast consumption" (consume/consumed-by), "consumption window" (backward/forward), "net forecast" / "unconsumed forecast remainder". Avoid "reduction" (SAP/D365 use it for the *permanent* burn-down at goods movement, a different mechanism).

## Competitor-Specific Details

### SAP
Consumption modes: 1 backward, 2 backward+forward, 3 forward, 4 forward+backward, 5 period-based (S/4 only — consume only within the PIR's own planning period ± N periods). Periods in workdays, up to 999; **no periods maintained → only same-day PIRs consume** (classic gotcha). Fallback default mode 1 / 999 days via MRP group. Allocation is nearest-date-first, first-come-first-served across orders. Consumption (dynamic, at order entry) vs reduction (persisted, at goods issue — delivery GI for strategies 10/40, GR for 11) are distinct mechanisms.

### Oracle
EBS: backward/forward consumption days on the forecast set, workdays only; overconsumption creates an informational negative forecast entry at set level; outlier update percent caps one order's bite of any entry; demand classes fence who may consume what. Weekly/periodic bucket rule: window touching a bucket ⇒ whole bucket eligible; mixed granularity consumes daily entries → weekly → periodic. Fusion: per-plan options; "Consume by forecast bucket" checkbox; recomputed every run.

### Dynamics 365
Four methods on the plan: None / Percent–reduction key (time-based decay, orders irrelevant) / Transactions–reduction key (orders consume within calendar buckets from the key; Planning Optimization spills backward-then-forward, classic engine doesn't) / **Transactions–dynamic period** (each forecast entry owns [its date, next entry's date); no windows, no gaps possible; excess dropped). What consumes: coverage group "Reduce forecast by" = Orders | All transactions; intercompany opt-in. All forecast before today is excluded. Recomputed per regenerative run.

### Epicor Kinetic
Days Before/Days After around each forecast entry's date; company default + part/site override. No one-to-one tracking (one lingering order can eat multiple entries). Gap orders are additive demand — documented, unsolved, with workarounds being pure date arithmetic. Only sales orders consume; a real job against forecast double-counts until the forecast is manually deactivated. "MPS wins" over forecast when both exist.

### Infor SyteLine / LN
SyteLine: Forecast Look Behind/Look Ahead in working days, backward first; original vs outstanding qty; site default + product-code override; changing the window re-runs consumption for all items (documented as slow). Item parameter "Use CO or Forecast: Both" gates netting. LN: period-sequential consumption bounded by backward/forward day params; "Nonconsumed Forecast" field; optional dependent-demand consumption; ATP updates consume same-period only.

### Odoo MPS / MRPeasy (modern bucket-native)
Odoo: weekly/monthly grid; forecast drives replenishment; actuals displayed alongside with red "Forecast Too Low" flags; human raises the forecast (Odoo 19 adds one-click fill-from-actuals ± factor). No automatic netting. MRPeasy: cleanest automatic rule found — `GREATER OF(Forecast, Firm orders)` per period for future periods, **current period uses firm orders only**; same greater-of drives BOM-exploded dependent demand. No windows, no consumption bookkeeping.

### Plex (negative result)
No public forecast-consumption engine; core MRP sums firm releases/orders/forecasts from EDI release schedules; statistical planning lives in the separate DemandCaster-based Supply Chain Planning product. Do not cite Plex as precedent.

## Recommended Approach for Carbon

Carbon's forecast is already bucket-native (`demandProjection` keyed on weekly `periodId`),
which puts it in the Odoo/MRPeasy/D365-dynamic-period family — the day-window arithmetic
that generates Epicor/SyteLine's documented failure modes has no reason to exist here.

1. **Consume regeneratively inside `runMrp`, persist nothing on the forecast** (SAP/Fusion/D365 pattern). Every run: load open actual demand + projections, run consumption, use the remainder. Self-healing falls out — cancelled orders, changed dates, and edited forecasts all re-net on the next run with no deconsumption machinery. This also matches Carbon's existing wipe-and-rewrite MRP outputs.
2. **Per-bucket remainder algorithm** (APICS net): per (item, location), walk actual demand chronologically; each actual consumes forecast in its own bucket first, then backward up to N buckets, then forward up to M buckets (Oracle/SyteLine search order at bucket granularity — Oracle's own docs show whole-bucket eligibility is the effective semantics anyway). Net demand per bucket = actuals + unconsumed remainder. Reproduces the user's three cases and fixes the gap case.
3. **Window in weeks, not days**, with a small company-level default (backward ≈ 4 weeks / forward ≈ 1, or D365-style "back to the previous forecast entry") — flat config, no matrices; per-item override only if demanded later. Every vendor that exposed day-granular windows produced a support-forum genre of window-sizing bugs.
4. **Only demand consumes**: sales order lines and job-material lines consume projections on their own item. Make-to-stock jobs stay pure supply (already netted by the running balance — verified in the Phase-0 audit). Do not add D365's "All transactions" mode initially.
5. **Drop past forecast from the demand set** (D365 rule): unconsumed forecast in past buckets must not drive supply — this is the second half of "self-healing" and avoids SAP's MD74 cleanup-job burden.
6. **Compute the net once, read it everywhere.** The Phase-0 audit found four read sites re-implementing the demand union; consumption must be computed in one place (the MRP run) and persisted as output rows the RPCs/UI read, or the grid and the engine will disagree.

## Sources

### SAP
- https://help.freedsap.com/ENHELPhtml/PPMPDEM/ConsumptionStrategiesandLogic.html
- https://help.freedsap.com/ENHELPhtml/PPMPDEM/PlanningwithFinalAssembly41.html
- https://help.freedsap.com/ENHELPhtml/PPMPDEM/SampleScenarioStrategy41.html
- https://help.sap.com/docs/SUPPORT_CONTENT/mrp/3138698453.html (PIR reorganization)
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9905622a5c1f49ba84e9076fc83a9c2c/a628a484ef6e4b0fbef4fce7eabc6dd6.html
- https://blogs.sap.com/2017/05/04/s4-hana-new-consumption-mode-for-planned-independent-requirements/ (mode 5, KBA 2939973)
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/pir-consumption-amp-reduction-mechanism/ba-p/13633872
- https://blog.sap-press.com/4-strategies-for-make-to-stock-production-with-sap-s4hana
- https://userapps.support.sap.com/sap/support/knowledge/en/3704214

### Oracle / NetSuite
- https://docs.oracle.com/cd/E26401_01/doc.122/e48795/T478564T483393.htm (EBS forecast consumption)
- https://docs.oracle.com/cd/A60725_05/html/comnls/us/mrp/timefo01.htm (weekly buckets)
- https://docs.oracle.com/cd/A60725_05/html/comnls/us/mrp/consum04.htm (windows + overconsumption)
- https://docs.oracle.com/cd/E26401_01/doc.122/e48795/T478564T478750.htm (shipment/production relief)
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fausp/forecast-consumption.html (Fusion)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1495718329.html (NetSuite examples)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159172238892.html (NetSuite item-location params)
- https://docs.oracle.com/en/applications/jd-edwards/supply-chain-manufacturing/9.2/eoarp/understanding-forecast-consumption.html

### Dynamics 365
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/demand-forecast
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/reduction-keys
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/deprecated-master-plans
- https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/reduction-keys-form

### Epicor / Infor / Plex / Odoo / MRPeasy
- https://www.epiusers.help/t/forecast-window-by-part/111390
- https://www.epiusers.help/t/forecast-consumption/131684
- https://www.epiusers.help/t/how-to-consume-forecast-qty-now-real-job-exists/123948
- https://www.epiusers.help/t/forecast-window-within-a-calendar-month-rather-than-a-window-of-days-before-and-days-after/76733
- https://docs.infor.com/csi/9.01.x/en-us/csbiolh/lsm1454144400143.html (SyteLine Look Ahead/Behind)
- https://docs.infor.com/ln/2023.x/en-us/lnolh/cpordplanug/cpom000331.html (LN consumption)
- https://plex.rockwellautomation.com/en-us/blog/leveraging-demand-and-supply-planning-unlock-value-mrp.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/workflows/use_mps.html
- https://www.mrpeasy.com/resources/user-manual/settings/system/enterprise-functions/master-production-schedule-mps/
- https://frepple.com/blog/forecast-consumption/
