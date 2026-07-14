# Overhead Absorption in Job Costing: Best Practices Survey

## Summary

Researched how SAP S/4HANA handles overhead absorption in manufacturing job costing — specifically, what happens when a labor time entry is posted to a production order, how overhead is absorbed, and what the COGS/P&L impact is if overhead is never absorbed. Key finding: labor confirmation and overhead absorption are two separate processes with distinct cost element categories. Labor hits the production order immediately via activity confirmation (cat. 43); overhead is absorbed separately at period-end via a costing-sheet calculation (cat. 41). If overhead absorption is skipped, COGS is understated and overhead strands as a period expense.

## Competitors Surveyed

- **SAP S/4HANA** — the reference ERP for discrete manufacturing overhead costing; extensive documentation on CO43, KKS1, CO88 settlement flow

## Research Questions

1. When labor time is posted to a work order, what journal entries are created?
2. Is overhead absorbed at that point, or separately?
3. What accounts are typically hit (WIP, labor absorption, overhead absorption, COGS)?
4. Is it standard to absorb overhead at labor posting time, or as a separate process?
5. What is the COGS impact if overhead is not absorbed?

## Answers to Research Questions

### 1. What happens when labor time is posted?

SAP uses **secondary cost element category 43 (Internal Activity Allocation)** for labor/activity confirmation. When a worker confirms time on a production order:

- **CO only**: DR Production Order / CR Work Center Cost Center — both under a cat-43 secondary cost element
- No FI/GL document is created at this moment in SAP (the cost center's FI debit happened earlier when payroll was posted as a primary cost)

Carbon differs from SAP: Carbon creates actual GL journal entries when labor time is posted (DR WIP / CR Labor Absorption). This is effectively combining the CO allocation + the FI side that SAP only surfaces at period-end settlement.

### 2. Is overhead absorbed when labor is posted?

**No — they are separate in SAP.** Two distinct mechanisms:

| Mechanism | SAP Transaction | Cost Element Category | Timing |
|---|---|---|---|
| Labor/activity confirmation | Activity confirmation (CATS/CO11N) | Category 43 | Real-time at confirmation |
| Overhead surcharge (costing sheet) | CO43 / KGI2 | Category 41 | Period-end process |

Both credit the cost center and debit the production order, but they run at different times and use different cost elements. Overhead absorption (CO43) must be run explicitly — it does not trigger automatically from labor posting.

### 3. What accounts are hit?

**At labor confirmation (activity allocation):**
- DR: Production Order (WIP) via cat-43 secondary cost element
- CR: Work Center Cost Center via cat-43 secondary cost element
- (CO-only; no FI document)

**At overhead absorption (CO43):**
- DR: Production Order (WIP) via cat-41 secondary cost element
- CR: Overhead Cost Center via cat-41 secondary cost element
- (CO-only; no FI document)

**At goods receipt from production (movement 101):**
- DR: Finished Goods Inventory (at standard cost, which includes overhead rate)
- CR: Production Order / Change in Stock

**At settlement (CO88):**
- DR: Price Difference / Production Variance GL account (OBYC: PRD/PRF)
- CR: Production Order (clears balance)
- This is when the "actual overhead absorbed" vs "standard overhead in cost estimate" variance finally hits FI

In S/4HANA with Universal Journal, all CO postings also write to ACDOCA — so CO and FI are always in sync.

### 4. Is it standard to absorb overhead at labor posting time or separately?

**Depends on the flow.** In the classic costing-sheet flow, overhead is absorbed
separately at period-end:

1. **CO43** — Overhead calculation (debits production orders, credits cost centers using costing sheet rates)
2. **KKAO** — WIP calculation
3. **KKS1** — Variance calculation (assigns total variance to categories)
4. **CO88** — Settlement (posts variance to FI/GL)

S/4HANA's recommended event-based flow (scope item 3F0, "Event-Based Production
Cost Posting") instead posts overhead with each activity confirmation — no
period-end run. Event-based is the modern reference model and the closer
comparison for Carbon, which posts per production event.

Quote from SAP Community: "If you don't run KGI2 [CO43], there will not be any change in your actual overhead, which is entirely wrong practice. It will impact on the WIP, Variance and settlement values."

### 5. COGS impact if overhead is not absorbed?

**Significant understatement of COGS:**

- Overhead costs hit the overhead cost center as FI primary postings (payroll, utilities, depreciation)
- Without CO43, those costs stay on the cost center forever — never transferred to production orders
- Production orders show understated actual costs → WIP is understated → COGS is understated
- The overhead appears as a period operating expense on the cost center P&L (via KSU5 assessment to CO-PA) — it lands **below gross profit** as an operating expense instead of **inside COGS**
- Under GAAP (ASC 330) and IFRS (IAS 2), production overhead allocated at normal capacity must be inventorialized — it should flow through WIP → Finished Goods → COGS. (Unallocated fixed overhead from abnormally low production is expensed in the period, not capitalized.)

**Dual P&L impact when overhead is unabsorbed:**
- Production order overhead variance (COGS-level): difference between standard overhead in cost estimate and actual overhead applied to order → settles via CO88 to price difference account
- Cost center residual (operating-level): unabsorbed overhead remaining on cost center → assessed via KSU5 to CO-PA at operating profit level, below gross margin

## Variance Category for Missing Overhead

When CO43 is skipped and KKS1 (variance calculation) runs:
- Missing overhead falls into **Remaining Input Variance** (overhead lacks a quantity basis, so it can't be Input Price or Input Quantity variance)
- If lot size differs from costing lot size, fixed overhead may land in **Lot Size Variance**
- There is NO dedicated "overhead variance" category in SAP — it disperses across Remaining Input and Lot Size Variance

At CO88 settlement, ALL variance categories aggregate to a single **PRD** (price difference) GL account unless "Variance Split" is configured in SPRO to give each category its own account.

## Cost Center Residual: Does It Automatically Hit P&L?

Yes — but not through overhead absorption. The cost center's P&L impact happens in two stages:

1. **Immediate FI posting**: Payroll, utilities, depreciation hit the cost center as primary cost element (cat-1) postings. These ARE FI documents — they hit P&L expense accounts the moment they post.
2. **CO reclassification**: CO43 credits the cost center under a cat-41 secondary cost element, moving the cost from "overhead expense" to "overhead absorbed by production orders." This reclassification is CO-only.

If CO43 never runs: the overhead stays classified as a cost center expense (already on P&L as operating expense), and production orders never see it. Total P&L expense is correct in aggregate, but the *classification* is wrong — overhead appears as operating expense instead of COGS.

## Retroactive Overhead Calculation

CO43 CAN be run retroactively if:
- The CO period (OKP1) is reopened by an authorized user
- The FI period is open
- The production order status is not CLSD (closed orders are skipped)

If the period can't be reopened (audited/reported year), the workaround is a manual journal entry to post the missing overhead directly.

## Recommended Approach for Carbon

Carbon's job costing posts actual GL journal entries at labor time (not CO-only like SAP). This means Carbon's overhead absorption should also create GL journal entries when it runs.

**Three viable patterns:**

### Option A: Period-End Overhead Absorption (classic SAP pattern)
- Run a job at period close that reads each open work order's actual costs, applies the overhead rate from the routing/work center, and posts DR WIP / CR Overhead Absorbed
- Pros: overhead rate applies to actual costs of the period
- Cons: requires a period-close workflow; COGS is inaccurate intra-period

### Option B: Absorb at Work Order Receipt/Close (simpler)
- When a work order is received into inventory, calculate and post the overhead absorption based on actual quantities × overhead rate
- Pros: no separate period-close process; ties out at order close
- Cons: doesn't match intra-period WIP balances; may miss partial completions

### Option C: Absorb per Production Event (event-based; IMPLEMENTED)
- When each production event posts, apply the work center's overhead rate to the event's hours and post DR WIP / CR Overhead Absorption alongside the labor lines
- Matches S/4HANA's recommended event-based flow (3F0); WIP is accurate intra-period with no period-close dependency
- Cons: overhead is only as accurate as the per-work-center rate; rate changes don't retro-apply to posted events
- This is what Carbon implemented in `post-production-event` (overhead rate on `workCenter.overheadRate`, credit to `accountDefault.overheadAbsorptionAccount`)

### Data model needed (any pattern):
- Overhead rates defined per work center or cost center (% of labor, % of machine time, $/hour, etc.)
- A new journal entry source type (e.g., `overheadAbsorption`)
- GL accounts: Overhead Absorbed (credit, income-statement contra), WIP (debit) for the absorption entry
- At COGS recognition: DR COGS / CR Finished Goods (the overhead absorbed flows through naturally if included in WIP valuation)

## Sources

- [SAP Overhead Rate Application — SAP Press Blog](https://blog.sap-press.com/overhead-rate-application-for-period-end-closing-with-sap)
- [SAP Costing Sheets — ERPcorp](https://erpcorp.com/sap-controlling-blog/sap-costing-sheets-allocate-overhead)
- [CO43 Run Overhead Calculation — SAP Help S/4HANA Cloud](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c56f622a2edf491b9f1b596b55587009/2dffbf5362ebb44ce10000000a174cb4.html)
- [Primary and Secondary Costs in SAP S/4HANA — SAP Press Blog](https://blog.sap-press.com/primary-and-secondary-costs-in-sap-s4hana)
- [Back to Basics: Secondary Cost Elements 101 — SAP Community](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/back-to-basics-secondary-cost-elements-101/ba-p/12898940)
- [Basics of Variance Calculation — SAP Community Blog](https://community.sap.com/t5/enterprise-resource-planning-blogs-by-members/basics-of-variance-calculation-understanding-period-end-activities-wip-and/ba-p/13238029)
- [Understanding Production Order Variance Part 2 — SAP Community](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/understanding-production-order-variance-part-2-the-sap-perspective/ba-p/12937397)
- [Production Order Costing — mps4hana.com](https://mps4hana.com/finance-integration/3-ppfi/production-order-costing-planned-vs-actual-order-balance-settlement-rule/)
- [How to Configure Variance Split in SAP S/4HANA — SAP Press Blog](https://blog.sap-press.com/how-to-configure-variance-split-in-sap-s4hana)
- [Over/Under Absorption of Overheads — SAP Community](https://community.sap.com/t5/enterprise-resource-planning-q-a/over-under-absorption-of-overheads/qaq-p/3478668)
- [Period-End Closing CO-OM-CCA — SAP S/4HANA Help](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/5e23dc8fe9be4fd496f8ab556667ea05/ed0cd553088f4308e10000000a174cb4.html)
- [KSU5/KSV5 Period-End Cost Allocation — Econvera](https://econvera.org/2025/09/30/sap-ksu5-ksu6-and-ksv5-period-end-cost-allocation-and-distribution-strategic-and-technical-guide/)
- [Variance Categories — SAP Documentation](https://help.sap.com/saphelp_me61/helpdata/EN/c4/324152fe4eaa1ae10000000a445394/content.htm)
- [Under-Absorption and Over-Absorption — AccountingTools](https://www.accountingtools.com/articles/what-is-under-absorption-and-over-absorption-of-overhead.html)
