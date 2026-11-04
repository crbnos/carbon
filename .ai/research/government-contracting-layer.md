# Government Contracting and Control Layer Research: Best Practices Survey

> Research date: 2026-10-09. This file is the input to the Phase 5 spec of
> `.ai/specs/2026-10-03-projects.md` (*Phase 5: government contracting and control*).
> It builds on `.ai/research/projects-wbs-pmmo.md`. That file already covers these
> topics, and this file does not repeat them:
> - pattern 8: charge numbers, Costpoint PLC and GLC, and charge trees
> - pattern 9: the billable-item engine, the Costpoint fee sequence and funding limits
> - pattern 10: provisional and actual rates, and the FAR 52.216-7 time limit
> - answer 7: the list of 18 criteria in DFARS 252.242-7006
> - recommendation 8: the list of later layers
>
> Related: `.ai/research/budgeting.md` (SAP plan versus budget, cost-center AVC) and
> `.ai/research/overhead-absorption-job-costing.md` (work-center overhead absorption).

## Summary

We surveyed how 7 products model the government contracting layer of an ERP. The
products are Deltek Costpoint, Unanet GovCon, SAP S/4HANA, Oracle Fusion Project
Costing, Microsoft Dynamics 365, IFS and Epicor. We also read the rules that drive the
layer:
- FAR 31.2, FAR 42.7, FAR 52.216-7 and FAR 52.232-20/-22
- CAS 401, 402, 405, 410, 418 and 420
- DFARS 252.242-7006 and DoD class deviation 2026-O0011
- the DCAA Contract Audit Manual (CAM, February 2025), DCAAM 7641.90 and the ICE model
- EIA-748-E and the IPMDAR
- IRC §174A and Form 6765 Section G

Key findings:

1. **Of the 7 products, only 2 have a native pool engine.** Costpoint and Unanet compute
   pool ÷ base rates from the general ledger. Oracle applies burden through
   multiplier schedules. SAP, D365, IFS and Epicor need a partner add-on (Cognitus,
   RSM GovCon, GovCon365) or have none.
2. **Monthly rates are a cumulative catch-up.** Costpoint computes the year-to-date
   (YTD) rate. It applies the rate to the YTD base and posts only the difference from
   the amount it posted before. So a rate change inside the year needs no separate
   re-burden job.
3. **Unallowable costs leave the pool but stay in the base.** CAS 405-40(e) makes an
   unallowable cost absorb its share of G&A. The claim excludes it. Costpoint marks
   whole pools Unallowable, and the usual practice is separate unallowable accounts.
4. **Timekeeping fails audits more often than any other area.** The current CAM
   moved labor controls to 5-304 (DFARS criteria 9 and 10). DCAA wants daily entry,
   all hours, certification, a correction trail with the employee's agreement, and a
   labor distribution that reconciles to payroll.
5. **DCAA forbids charging by funding.** No product checks funding or budget at
   timesheet entry. A funding control on time must warn and escalate. It must never
   hide the true charge.
6. **Thresholds moved in 2025–2026.** The FY2026 NDAA raised CAS coverage to $35M
   (full coverage $100M) and exempted nontraditional defense contractors from the
   business-system rules. EVM applies at ≥ $50M and a validated EVMS at ≥ $100M.
   EIA-748-E (March 2026) cut the guidelines from 32 to 27.
7. **The ERP owns actual cost; the EVM engine owns the baseline.** The ERP supplies
   ACWP by charge number, period and element of cost. A scheduler (P6 or MS Project)
   supplies the schedule. An EVM engine (Cobra) builds BCWS, BCWP and the IPMDAR
   dataset.
8. **Cost-type government contracts are usually funded research.** Under
   §41(d)(4)(H) their costs are not qualified research expenses (QREs). R&D tax
   tagging matters mostly for IR&D and fixed-price work.
9. **An SF 1408 survey checks design, not operation.** The first 7 needs are job cost
   by contract under GL control, direct/indirect segregation, timekeeping, labor
   distribution, unallowable exclusion, pool design and a monthly close. EVM, the ICE
   submission and R&D tax play no part in it.

## Competitors Surveyed

- **Deltek Costpoint** — the market reference for US defense contractors. It has a
  native pool engine, CLIN and ACRN billing, T&E timekeeping and a Cobra interface.
- **Unanet GovCon** — the main mid-market rival to Costpoint. It has cost pools,
  Dilution for uncompensated overtime and funding alerts.
- **SAP S/4HANA (PS, overhead costing, availability control)** — the enterprise
  reference for costing sheets, budget availability control and progress analysis. It
  has no native government rate engine.
- **Oracle Fusion Project Costing** — the reference for burden schedules with
  provisional and actual versions, and for project budgetary control.
- **Microsoft Dynamics 365 Project Operations and Finance** — contract-line funding
  and not-to-exceed limits. Government contracting comes from ISVs.
- **IFS Cloud and Epicor Kinetic** — mid-market manufacturing ERPs, closest to
  Carbon's buyers. Neither has a documented government pool engine.
- **Regulators and auditors** — FAR, CAS, DFARS, DCAA, DCMA, NDIA, IRS.

## Key Consensus Patterns

### 1. Indirect rates come from ordered pools over the general ledger

- **Costpoint**: each pool maps an **account × organization** set to 4 roles: pool
  cost accounts, base accounts, allocation debit accounts and credit accounts. A
  processing sequence number orders the cascade, so fringe computes before overhead.
- **Oracle**: a burden structure is *precedence* (each code burdens the running
  total) or *additive* (each code burdens raw cost). Precedence gives the fringe →
  overhead → G&A cascade.
- **Unanet**: a Cost Pool Group defines the calculation for one legal entity. Each
  pool holds Target, Provisional and Actual rates per fiscal year.
- **SAP**: a costing sheet sets a base (cost elements), an overhead rate and a credit
  key. An overhead key on the WBS element picks the rate. SAP has no pool ÷ base
  computation from the GL.
- **Rationale**: CAS 418 wants homogeneous pools and a causal base. CAS 410 fixes the
  G&A base. An ordered cascade over GL accounts is the only shape that meets both and
  stays reconcilable to the books.

### 2. Burden is a project-ledger value; the pool allocation is a GL entry

- **Costpoint**: the pool computation posts a cost transfer entry to the pool's debit
  and credit (applied) accounts. Project burden lives in the project tables
  (`PROJ_BURD_SUM`), not in the GL.
- **Oracle**: a project-type option decides if burden posts to the GL or stays for
  reporting only. Oracle warns that posting the burdened cost can double-count raw
  cost.
- **Rationale**: one GL entry per pool per period keeps the books clean. Per-project
  burden then feeds billing, the ICE schedules and EVM without one journal line per
  charge.

### 3. Rate changes recompute and re-bill by difference

- **Costpoint**: Compute Burden Costs multiplies cost by the current rates.
  Calculate Retroactive Billings multiplies billed cost by the new provisional rates.
  Then it subtracts the burden billed before. The difference is the true-up
  invoice.
- **Oracle**: when an actual schedule version replaces a provisional version, Oracle
  reprocesses the affected expenditure items. Recalculate Burden Cost creates the
  adjusting items.
- **Rationale**: FAR 42.704 lets either party change provisional rates "prospectively
  or retroactively". Difference-based re-billing never rewrites a posted invoice.

### 4. Period, class and audit trail control timekeeping

- **Costpoint**: a Timesheet Class sets Revision Explanation to Disabled, Optional or
  Required. The Revision Audit records who changed what, when and why. Daily Floor
  Check lists employees with no time for a day.
- **Unanet**: `unatime.audit` asks for a change reason per cell and keeps the before
  and after values. Submit shows a certification popup with separate text for exempt
  and non-exempt users.
- **Rationale**: DCAAM 7641.90 asks for daily entry, certification, a supervisor
  cosign and a correction that shows the original, the new value and the employee's
  agreement.

### 5. Contract lines track funding as dated modifications

- **Costpoint**: Manage Modifications keeps two parallel sets, value and funding. Each
  set has cost, fee, fee % and total. Manage Total Ceilings uses the lower of value
  and funding.
- **Unanet**: a contract modification updates Current Funded Cost, Funded Fee, Total
  Cost and Total Fee on the CLIN project.
- **D365**: not-to-exceed limits apply at 4 levels: customer on the line, line,
  customer and contract.
- **Rationale**: LoC and LoF notices compare incurred cost with allotted funds. Fee
  billing must also fit inside the allotment.

### 6. The ERP feeds an EVM engine; it does not replace the scheduler

- **Costpoint → Cobra**: charge templates map project and organization ids to
  control accounts and work packages. Cobra imports actuals, imports the P6 schedule
  and exports the IPMDAR dataset.
- **Unanet**: it integrates with separate EVM tools (Empower, EVMS for Project). It
  claims no native EVM engine.
- **SAP**: progress analysis computes BCWS and BCWP with 8 measurement methods.
- **Rationale**: EIA-748-E guideline 15 asks the accounting system for actual cost by
  element of cost, reconciled to the GL. The baseline and status are a scheduling
  problem.

## Answers to Research Questions

### 1. Indirect rate pools and burdening

**Pool structure.** A typical defense manufacturer runs this cascade:

| Pool | Typical base | Receives burden from |
|---|---|---|
| Fringe | Total labor $ (direct + indirect) | none |
| Overhead (one per site or function) | Direct labor $ or direct labor hours | fringe on its own indirect labor |
| Material handling | Direct material $ | fringe and overhead on its own labor |
| G&A | Total cost input (TCI), value-added or single element | all lower pools, through the TCI base |
| Facilities capital cost of money (optional) | Net book value per pool (CASB-CMF) | an imputed factor, not a pool |

- **Base types.** Costpoint's Basis Type is Dollars, Hours or Units. Units is for
  service centers only.
- **G&A base (CAS 410).** TCI is "generally acceptable". Value-added (TCI minus
  material and subcontracts) applies when material would distort the allocation.
  Single element (direct labor $ or hours) applies only when it is equitable.
- **Other pool types (Costpoint).** A service center allocates by headcount or square
  feet and shows no rate. An intermediate pool shows a rate but applies no cost to
  projects.

**Rate types.**

| Rate type | Who sets it | Where it lives |
|---|---|---|
| Provisional | The contracting officer or auditor (FAR 42.704) | Costpoint `Pd Prov` / `YTD Prov` |
| Target (budget) | The contractor's annual budget | Costpoint `Pd Tgt` / `YTD Tgt` |
| Actual | Computed from the GL each period | Costpoint `Pd Act` / `YTD Act`, user can override |
| Ceiling | A contract clause (FAR 42.707) | Costpoint Manage Burden Cost Ceilings, per project |
| Final (negotiated) | The contracting officer or auditor (FAR 42.705) | UNVERIFIED as a separate Costpoint column |
| Forward pricing | A forward pricing rate agreement (FAR 42.17) | UNVERIFIED in Costpoint |

Costpoint's Pool Rates subtask holds one row per pool × fiscal year × period. If
the base is Hours, the rate shows as $/hour.

**Monthly computation (Costpoint Indirect Rate Computation).**

1. Read the posted GL (`FS_SUM`) and the unposted allocation journal for the pool's
   accounts.
2. Divide YTD pool cost by YTD base to get the YTD rate.
3. Apply the rate to each base account and organization.
4. Subtract the amounts posted before. Post the difference for this period.
5. Repeat the computation for the period-to-date rate.
6. Write the Pool Rate table and the Statement of Indirect Expenses.

Step 4 is a cumulative catch-up. The current month carries every correction to the
year so far.

**Costpoint process order.**

1. Run "Compute/Print Pool Rates".
2. Run "Post Pool Journals" (the GL allocation to applied accounts).
3. Run "Compute Burden Costs" (project burden at the chosen rate type).
4. Run "Compute Revenue".

"Build Rate Application Table" must run again after any change to the pool structure
or sequence.

**Oracle burden schedules.**

1. A **burden structure** has cost bases. Each cost base has burden cost codes.
   Expenditure types map to cost bases.
2. A **burden schedule** has **versions** with effective dates. Multipliers sit per
   organization in a hierarchy.
3. A *firm* schedule allows one version per date range. A *provisional* schedule
   allows a provisional and an actual version on the same dates.
4. When the actual version is built, Oracle reprocesses the affected items.
5. The project type decides where burden lands. The 3 choices are the same
   expenditure item, one item per burden component, or one summarized Burden
   Transaction item.

**GL treatment.** Costpoint posts the pool allocation to the GL and keeps project
burden as project data. Oracle offers both, with a double-count warning. A
named under/over-absorption variance account is UNVERIFIED in vendor documentation.

**Re-burden and year-end true-up.** *Re-burden* recomputes project burden at new
rates. A *true-up invoice* bills or credits the difference to the customer.

- **Re-burden.** Recompute the pool rates for any period, then run Compute Burden
  Costs again. A setting decides if YTD burden is YTD cost × YTD rate or the sum of
  period burdens (Costpoint).
- **True-up invoice.** Calculate Retroactive Billings computes billed cost × new
  provisional rate − burden billed before. "Print Retroactive Billing Worksheet"
  supports it (Costpoint).
- **FAR 52.216-7 deadlines.** The final indirect cost rate proposal is due 6 months
  after each fiscal year ends. The completion voucher is due 120 days after final
  rates settle for all years of a physically complete contract.
- **Quick closeout (FAR 42.708).** FAR allows it when unsettled cost is no more than
  the lesser of $1,000,000 or 10% of the contract value. Its rates bind only that
  contract.

### 2. Unallowable costs

**Rules.**

- **FAR 31.201-6.** The contractor must identify 3 kinds of cost: expressly
  unallowable, mutually agreed unallowable, and their *directly associated costs*.
  It must exclude them from every billing, claim and proposal. A directly associated
  cost exists "solely as a result of incurring another cost".
- **CAS 405-40.** Paragraphs (a)–(d) require identification and exclusion. Paragraph
  (e) says unallowable costs follow the same allocation rules as allowable costs. So
  an unallowable cost stays in the base and absorbs its G&A.
- **Penalties (FAR 42.709).** An expressly unallowable cost in an incurred cost
  claim costs the disallowed amount plus interest. If the government
  determined the cost unallowable before submission, the penalty is two times that amount. The rule
  applies to contracts over $1M, except fixed-price contracts without cost incentives.

**How products exclude them.**

- **Costpoint.** The pool "Unallowable" check box stops revenue on that pool. It has
  "the same effect as placing a burden cost ceiling of zero" on every project. Users
  normally post unallowable costs to separate accounts. An account-level allowable
  flag is UNVERIFIED.
- **RSM GovCon for D365 Finance.** It segregates direct, indirect and unallowable
  costs.
- **ICE Schedule B.** It shows G&A expense by account, with the unallowable amounts in
  their own column. So the system must report unallowables per account, not only
  total them.

**FAR 31.205 categories that contractors flag most often.**

| Section | Topic |
|---|---|
| 31.205-1 | Advertising and public relations |
| 31.205-3 | Bad debts |
| 31.205-6(p) | Compensation above the cap: $671,000 for 2025; $695,000 for 2026 (calculated by Redstone; official notice UNVERIFIED) |
| 31.205-8 | Contributions and donations |
| 31.205-13 | Employee morale (gifts, recreation) |
| 31.205-14 | Entertainment |
| 31.205-15 | Fines and penalties |
| 31.205-20 | Interest |
| 31.205-22 | Lobbying |
| 31.205-27 | Organization costs |
| 31.205-46 | Travel above per diem and above the lowest customary coach fare |
| 31.205-47 | Legal proceedings |
| 31.205-51 | Alcoholic beverages |

The RFO Part 31 model deviation (July 2025) removed 3 small paragraphs only. They
are 31.205-6(m)(2), 31.205-33(f) and 31.205-35(c).

### 3. DCAA timekeeping controls

**Where the rules live now.** The February 2025 CAM has no section 5-900. CAM 5-304
covers labor under DFARS criterion 9 (timekeeping) and criterion 10 (labor
distribution). CAM 6-400 covers floor checks and labor audits.

| Control | Rule | Product behavior |
|---|---|---|
| Daily entry | DCAAM 7641.90 §3.c(4): record time "on a daily basis". Offsite staff need a written procedure. | Costpoint Daily Floor Check and "Timesheet Missing at Status Check" events. Unanet Minimum Hours Email Reminder. |
| No entry in advance | Floor checks ask "Do you ever record your time in advance?" | Costpoint charge attributes "Allow hours to be charged to future date" and "Can you charge this UDT in advance?" |
| Total time accounting | Record all hours worked, paid or not (DCAAM 7641.90; CAM 6-410). | Unanet Dilution; Costpoint Auto-Adjust (see below). |
| Certification | §3.c(8): the employee certifies that the hours "reflect the hours worked and the appropriate cost objective". The supervisor cosigns. | Costpoint Signature/Approval Text subtask. Unanet `timesheet.submit.confirm.exempt` and `.nonexempt`. |
| Correction | §3.c(6): show "the original time charge, the corrected time charge, and documentation from the employee indicating his/her concurrence". | Costpoint Revision Explanation + Revision Audit + new signature and approval. Unanet change reason per cell. |
| Entry by another person | §3.c(5): a supervisor enters time only during a prolonged absence. The employee submits a replacement on return. | Unanet `unatime.req_non_owner_submit_comment` and owner review after a non-owner edit. |
| Separation of duties | §3.b(1): supervisors who own budgets must not start employee time charges. CAM 6-406: payroll staff are independent of timekeeping. | Unanet `unanet.approve.self` off. |
| Charge restrictions | Employees use only the project numbers in the written list (§3.b–c). | Costpoint Charge Trees, Resource Groups, project workforce dates. Unanet project assignments. |
| Auditor access | CAM 6-405.3e(5): auditors may download timesheets before the interview. | A read-only snapshot or export. |

**Example certification texts.** Unanet's knowledge base gives two texts (search
snippet, UNVERIFIED in the page):

- "I hereby certify that I worked and properly recorded the hours indicated."
- "I hereby certify that all hours are true, accurate and complete to the best of my
  knowledge."

**Uncompensated overtime.** FAR 52.237-10 defines it as hours above an average of 40
per week by exempt direct-charge employees. CAM 6-410.4 accepts 3 methods:

| Method | Calculation | CAM status |
|---|---|---|
| Effective rate | Salary ÷ total hours, applied to every charge | Acceptable (6-410.4a). The CAM's worked example uses it. |
| Pro rata | Salary shared by hours | Acceptable (6-410.4b) |
| Standard rate | Annual salary ÷ expected annual hours; the variance goes to the overhead pool | Acceptable (6-410.4c) |
| First 40 hours only | Excess hours charged to overhead | Needs further evaluation (6-410.5) |

The CAM example: a $2,000 weekly salary over 50 hours gives $40/h. If 40 of the 50
hours are on project A, project A gets $1,600, not the full $2,000.

- **Unanet** calls it "Dilution". It runs per period when timesheets reach COMPLETED,
  only for users with the Exempt classification. Leave pay codes stay undiluted.
- **Costpoint** has Selective and Automatic Auto-Adjust. These adjust "the hourly rate
  and labor cost on all timesheet lines so that the labor cost matches the salary
  amount". "Use Standard Rates" applies to Salaried Fixed employees.
- **Oracle EBS** has a "Total Time Costing" option (search summary, UNVERIFIED in the
  guide).

**Labor distribution.** CAM 5-304 (criterion 10) asks for hours from timesheets and
dollars from payroll, by employee, by project and by indirect account. It must
reconcile to the job cost ledger and the GL. Leave and holidays are fringe costs (FAR
31.205-6(m)(1)).

**Recurring timekeeping deficiencies (synthesis; no source publishes frequencies).**

1. Time not entered daily, entered in advance, or not signed (Redstone #1, DoD IG).
2. Not all hours recorded (Redstone #2, CAM 6-410).
3. Supervisors change time without the employee's knowledge or with no reason (Redstone
   #3, DoD IG).
4. Approvals that rubber-stamp (Cherry Bekaert).
5. No formal training, and indirect codes too broad to understand (Cherry Bekaert).
6. Labor distribution not reconciled to payroll or the GL (CAM 5-304, 6-405.3s).
7. The same role charged direct on one contract and indirect on another (Redstone #6).
8. Charging that follows budget or funding (CAM 6-404.6(7) and (10)).

**2025–2026 changes.** The CAM now makes real-time labor testing risk-based. It
allows telephone and video floor checks. RFO Part 37 keeps 52.237-10 text unchanged.

### 4. CLIN, SLIN and ACRN

**Regulation (DFARS 204.71).**

| Concept | Rule |
|---|---|
| CLIN | 4 digits, 0001–9999. A separate CLIN needs a single price, one identification, its own delivery schedule and one accounting citation. |
| Informational SLIN | 2 digits after the CLIN (000101). No separate price or delivery date. |
| Separately identified SLIN | 2 letters after the CLIN (0001AA). Used when lines have different funds, delivery dates or destinations. I and O are never used. |
| ACRN | 2 characters that link one accounting citation to line items. Only the contracting office assigns ACRNs. |
| Payment allocation across ACRNs | PGI 204.7108: line-item proration for cost vouchers, oldest funds first for shipbuilding, contract-wide proration for progress payments. |

**Billing.** DFARS 252.204-7006 asks a cost voucher to show a separate amount for
each CLIN. In WAWF/PIEE, a Cost Voucher covers cost-type, T&M and labor-hour lines.
If a CLIN has more than one ACRN, the ACRN amounts must equal the CLIN amount.

**How products map a CLIN.**

| Product | Model |
|---|---|
| Costpoint | The top project level is the contract. Funding can sit at any level and adds up. Manage CLIN Information links billable items to CLINs. Manage ACRN Bills holds ACRN, line item, value, allocation and expiration. Allocation methods: FIFO, LIFO, Proration, Earliest Expiring Funds. |
| Unanet | A CLIN is a project or a task under a project. One contract links to many CLIN projects. |
| Oracle | A contract line has associated projects and tasks with a funded amount (partly UNVERIFIED). |
| D365 | A contract line maps to a whole project or to selected tasks, each with its own billing method and not-to-exceed limit. |
| SAP | The billing element is a WBS element. SAP has no native CLIN or ACRN. Partners (Cognitus, Dassian) add them (UNVERIFIED). |

**Incurred cost submission (ICE model).** The ERP must produce these schedules:

| Schedule | Contents |
|---|---|
| A | Claimed indirect rates: pool, base and rate per pool |
| B | G&A expense by account, with unallowable amounts |
| C | Overhead expense (final pools) |
| D | Occupancy, fringe and other intermediate pools |
| E | Claimed allocation bases by element of cost |
| F | Facilities capital cost of money factors |
| G | Reconciliation of the books to claimed direct costs |
| H | Direct costs by contract, with indirect cost at claimed rates |
| H-1 | Government participation % per pool base |
| I | Cumulative direct and indirect cost claimed and billed, by contract |
| J | Subcontract information |
| K | Hours and amounts on T&M and labor-hour contracts |
| L | Total payroll per Form 941, reconciled to labor distribution |
| M | Decisions, agreements and accounting changes |
| N | Certificate of final indirect costs |
| O | Closing information for contracts physically complete in the year |

Schedules H, I, J, K and O need cost by contract and CLIN. Schedule I is the
cumulative claimed-versus-billed figure that drives the true-up invoice. DCAA's own
ICE manual returned HTTP 403, so these titles come from FAR 52.216-7(d)(2)(iii) and 2
consultant sites. H-2 to H-4 and I-1 are UNVERIFIED.

### 5. Funding, Limitation of Cost and Limitation of Funds

| Clause | Trigger | Contractor's position |
|---|---|---|
| FAR 52.232-20 Limitation of Cost (fully funded) | Incurred cost + cost expected in the next 60 days > 75% of estimated cost | Notify with a revised estimate, exclusive of fee. No duty to continue past the estimated cost. |
| FAR 52.232-22 Limitation of Funds (incrementally funded) | Incurred cost + cost expected in the next 60 days > 75% of allotted funds | Notify with the funds needed. Also notify 60 days before the funded period ends. The government owes nothing above the allotment. |
| Variable limits (52.232-22) | The contract may set the window from 30 to 90 days and the % from 75 to 85 | — |
| FAR 52.242-15 Stop-Work | A stop-work order, 90 days unless extended | Stop at once and minimize cost. Ask for an equitable adjustment within 30 days after the stop ends. |

- **Fee and the allotment.** The LoF trigger compares cost only. But "paid and
  payable" includes billed fee, so the allotment must cover cost plus fee. Unanet's
  Funded Value includes the funded fixed fee. Costpoint modifications carry cost and
  fee.
- **FAR 32.704.** The contracting officer answers a notice in 1 of 4 ways: add funds,
  refuse funds, terminate, or say the decision is pending.

**How products track and enforce funding.**

| Product | Tracks | Enforces |
|---|---|---|
| Costpoint | Value and funding sets, cumulative per modification. Ceiling codes: R (revenue), B (billing), A (all), N (none). The "Projects Over x% Funding" dashpart defaults to 80%. | Active and Allow Charging flags at entry. A T&E hard edit blocks a stopped project, and a soft edit warns. Workforce dates block charges outside them. |
| Unanet | Total value, funded value, ceiling, burn and remaining funds. | Alerts at a funding threshold. Only Active project statuses take time. "Allow the budget to be exceeded", when cleared, blocks submit above the person's budget. |
| Oracle | Billing controls per contract or line. | A hard limit stops invoice and revenue. A soft limit warns once. |
| D365 | Not-to-exceed at 4 levels; funding sources with an on-hold source. | An amount above the limit goes to the on-hold funding source. |

**Practitioner advice.** Track incurred cost, estimate to complete (ETC) and estimate
at completion (EAC) per contract, CLIN and ACRN. Show the funding exhaustion date
(remaining ÷ burn rate) and the notice due date. For a stop-work order, put a hard
edit on the charge number. Put at-risk work on a separate WBS node, and let a billing
ceiling block its invoice (Redstone).

### 6. Budget availability control

| Product | Control levels | Where the check fires |
|---|---|---|
| SAP classic PS | Tolerance per activity group as usage %, with action 1 warning, 2 warning + mail to the person responsible, 3 error. Activation 0 none, 1 on budget allocation, 2 above a usage %. | Any posting that creates cost or commitment on the WBS: purchase requisition, purchase order, invoice. |
| SAP S/4HANA AVC | "All Activity Groups (++)" is required. Purchase requisition and purchase order groups are optional. Warning lets the posting continue; error blocks it. | Consumable budget versus commitments + actuals. |
| Oracle Fusion | Absolute (reserve only if funds exist), Advisory (reserve and notify), Track, None. A tolerance % per control budget. The level can only go down after baseline. | Requisitions, purchase orders, supplier costs, labor. Levels: project, task, resource, funding source. |
| Costpoint | "Over Budget Validation" on purchase requisitions. An over-budget requisition cannot be approved until "Compute Over Budget Transactions" releases it. | Purchase requisitions. No budget check on timesheets is documented. |
| Unanet | "Allow the budget to be exceeded" per person assignment. | Timesheet submit. |

SAP budget documents are original budget (CJ30), release (CJ32), supplement
(CJ36/CJ37), return (CJ35/CJ38) and transfer (CJ34). CJ36 and CJ38 come from a
secondary source (UNVERIFIED).

**The DCAA constraint.** CAM 6-404.6(10) lists "labor accounting by funding" as a
mischarging risk. DCAAM 7641.90 §3.c(2) says the nature of the work decides the
charge, not the funds available. So availability control may block a purchase order.
On a timesheet it may only warn and escalate.

### 7. Earned value

**EIA-748-E.** SAE published revision E in March 2026. It has 27 guidelines in 5
categories:
- Organization (1–4)
- Planning, Scheduling and Budgeting (5–13)
- Progress Assessment and Data Collection (14–16)
- Analysis and Management Reports (17–23)
- Revisions and Data Maintenance (24–27)

| Guideline (rev E) | What the ERP must support |
|---|---|
| E3 | A control account is one WBS × OBS intersection with one control account manager (CAM). Actuals collect at least at control account level. |
| E14 | Material earned value is never earlier than receipt and never later than consumption. "The M/ERP must support the determination of physical progress at the work package level." |
| E15 | Actual cost, direct and indirect, by element of cost, from the general books. Estimated actuals where actuals do not exist yet. A mapping from charge numbers to control accounts. |
| E16 | All purchased material, including residual inventory. Issues, returns, scrap and residuals. |
| E24–E27 | Retroactive changes only for error correction, routine accounting adjustments, rate changes, economic price adjustments and definitization. |

**Budget terms.** PMB = control account budgets + summary level planning packages +
undistributed budget. Contract budget base = PMB + management reserve. A planning
package has no earned value technique.

**Earned value techniques.** Each work package has exactly one technique.

| Technique | Rule |
|---|---|
| 0/100, 100/0 | Starts and finishes in the same period |
| 50/50, X/Y | Runs at most 2 periods |
| Weighted milestones | Preferred for work packages longer than 2 periods; NDIA recommends milestones at most 1 month apart |
| Percent complete, units complete | Allowed with objective indicators; NDIA allows them for small projects |
| Level of effort (LOE) | EV = BCWS, so no schedule variance. Only for work that cannot be measured. DoD sets no % cap. |
| Apportioned effort | % complete from a base discrete account, with a documented factor |
| PERT cost formula | BCWP = (ACWP ÷ EAC) × BAC, only for bulk low-risk material |

**Metrics (DAU Gold Card).**

| Metric | Formula |
|---|---|
| CV / SV | BCWP − ACWP / BCWP − BCWS |
| CPI / SPI | BCWP ÷ ACWP / BCWP ÷ BCWS |
| EAC (CPI) | ACWPcum + (BAC − BCWPcum) ÷ CPIcum |
| EAC (composite) | ACWPcum + (BAC − BCWPcum) ÷ (CPIcum × SPIcum) |
| VAC | BAC − EAC |
| TCPI | (BAC − BCWPcum) ÷ (EAC − ACWPcum) |

**Material timing (EVMSIG GL 21).** Material actuals must enter EVM in the same
period as the material earned value. If the GL books a cost before the point of
measurement, the system holds it back. If earned value comes first, the system posts
an estimated actual. For MRP with grouping, pegging and distribution, DoD requires
grouping breakpoints that align to cost collection points. It also requires control of
retroactive cost changes from re-pegging.

**Baseline control.** Customer changes go through undistributed budget. Internal
replans stay inside the contract budget base. A freeze period limits changes to
customer actions, rate changes and economic price adjustments. An over-target
baseline needs a request to the contracting officer (252.234-7999(h)).

**IPMDAR.** It has 3 deliverables: the Contract Performance Dataset (CPD), the
schedule (Native Schedule File + Schedule Performance Dataset) and the Performance
Narrative. Submission is monthly. The notional plan is SPD at 5 working days, CPD at
10 and the narrative at 16. The current DID is revision C (August 2021). Secondary
sources say DoD issued revision D on 12 March 2026 (UNVERIFIED in ASSIST).

**CPD format (File Format Specification v1.0).** The CPD is a ZIP of UTF-8 JSON
tables: WBS, OBS, ControlAccounts, WorkPackages, ReportingCalendar, BCWS_ToDate,
BCWP_ToDate, ACWP_ToDate, BCWS_ToComplete, EST_ToComplete and others.

- Each BCWS, BCWP and ACWP row carries `Value_Dollars`, `Value_Hours`, `_LAB`, `_MAT`,
  `_ODC`, `_SUB` (each with a `_Direct` variant), `_OH`, `_COM` and `_GA`.
- `ControlAccounts` points at a leaf WBS and a leaf OBS element.
- `WorkPackages` holds `EarnedValueTechniqueID`, with values such as `FIXED_0_100`,
  `MILESTONE`, `PERCENT_COMPLETE` and `LEVEL_OF_EFFORT`.

**Who produces what.**

| Data | ERP | Scheduler (P6 / MS Project) | EVM engine (Cobra) |
|---|---|---|---|
| ACWP by charge number, period, element of cost, hours and dollars | Yes | | |
| Indirect burden | Yes | | |
| Estimated actuals | Yes | | Often here instead |
| Material receipt and issue events | Yes | | |
| Native schedule and SPD | | Yes | |
| BCWS, BCWP from status, EAC, management reserve and undistributed budget logs | | | Yes |
| CPD export | | | Yes |

**Thresholds (DFARS 234.201-70, class deviation 2026-O0011 Rev 1, 5 August 2026).**

| Contract | Requirement |
|---|---|
| Cost or incentive, ≥ $100M | An EVMS that the cognizant agency (DCMA) found compliant |
| Cost or incentive, ≥ $50M | An EVMS that complies with EIA-748, with no formal determination |
| Cost or incentive, < $50M | Optional, risk-based, after a cost-benefit analysis |
| Firm-fixed-price | Discouraged; needs a waiver |

Software contracts and nontraditional defense contractors are exempt (FY2026 NDAA
§1826). The integrated baseline review is due within 180 days of award.

**SAP** progress analysis has 8 measurement methods: start-finish (0-100, 20-80),
estimate, milestone, time-proportional, cost-proportional, quantity-proportional,
degree of processing and secondary proportionality. **Oracle** P6 EPPM computes EV
fields; Fusion Project Performance Reporting EV measures are UNVERIFIED. **D365** EV
support is UNVERIFIED and limited.

### 8. R&D tax: §174A and Form 6765 Section G

**§174A (P.L. 119-21).**

| Rule | Detail |
|---|---|
| Domestic research or experimental (R&E) cost | Deductible in the year paid or incurred, for tax years beginning after 2024 |
| Election to capitalize | §174A(c): amortize over at least 60 months |
| Software | All software development is R&E |
| Foreign R&E | Stays under §174, amortized over 15 years |
| Unamortized 2022–2024 domestic R&E | Deduct in the first year after 2024, or spread over 2025 and 2026 |
| Small-business look-back | Gross receipts ≤ $31M may apply §174A to years after 2021. The filing deadline (6 July 2026) has passed. |

**Domestic versus foreign.** The test is where the researcher does the work
(Notice 2023-63). The ERP needs a work country on each labor charge, not the employee's home
office. Contract research needs the contractor's work country plus 2 contract terms:
who carries the financial risk, and who has the right to use the result. Overhead
such as rent and utilities counts as R&E. G&A and interest do not.

**Form 6765 Section G (Rev. December 2025).** Section G is optional for tax years
beginning before 2026. The IRS requires it for tax years beginning after 2025, with 2
exceptions:
- a qualified small business that elects the payroll credit
- an original return with QREs ≤ $1.5M and gross receipts ≤ $50M

| Column | Field |
|---|---|
| 49(a)–(b) | Entity EIN and principal business activity code |
| 49(c) | Business component name or id |
| 49(d) | Type: Product, Process or All Others |
| 49(e) | Software type: internal use, dual function, non-internal use, excepted |
| 49(f) | Information sought to be discovered (amended returns only) |
| 50 / 51 / 52 | Wage QREs: direct research, direct supervision, direct support |
| 54 / 55 / 56 | Supplies, computer rental, contract research (65%, or 75%/100% for named bodies) |

- **The 80% rule.** Report the components that make up 80% of QREs, at most 50, in
  descending order. Put the rest in one aggregate row.
- **Section E.** It asks for officers' wages in QREs and 3 yes/no flags.
- **Wages.** QRE wages are W-2 box 1 wages. If 80% or more of an employee's work
  qualifies, all wages count.

**Funded research, the critical rule for a defense contractor (§41(d)(4)(H)).**
Research that the government pays for qualifies only if 2 tests pass. First, the
contractor's payment depends on the success of the research (risk test). Second, the
contractor keeps substantial rights in the result (rights test). In *Dynetics* (2015), 3 CPFF, 3 FPLOE and 1 T&M contracts were all funded, so none gave
QREs. *Fairchild* (1995) let a fixed-price incentive contract pass the risk test.

**How tools capture it.** Payroll-based tools (Neo.Tax through Gusto, MainStreet)
take wages per employee from payroll. They take a qualified-time % from a survey or
project time, supplies from GL accounts and contract research from vendor invoices.
Costpoint project user-defined fields can carry a class. Dedicated R&D fields in
Costpoint, SAP, Oracle or Unanet are UNVERIFIED.

### 9. What a mid-size CPFF contractor needs first (SF 1408)

**SF 1408 criteria (Rev. 1/2014).** The system must be in accord with GAAP and
provide:

- 2(a) segregation of direct from indirect costs
- 2(b) direct costs by contract
- 2(c) logical, consistent allocation of indirect costs
- 2(d) costs under general ledger control
- 2(e) timekeeping by cost objective
- 2(f) labor distribution of direct and indirect labor
- 2(g) at least monthly cost by contract from the books
- 2(h) exclusion of FAR 31 unallowable costs
- 2(i) costs by contract line item and unit, if the contract requires it
- 2(j) segregation of preproduction from production costs
- 3(a) information for limitation of cost or funds
- 3(b) support for progress payments
- 4 reliable data for pricing follow-on work
- 5 full operation, or a statement of which parts are in operation

DCAA audit program 17740 evaluates "only … the design effectiveness, not the
operating effectiveness" (search text; the PDF returned 403). FAR 16.301-3(a)(3)
allows a cost-type contract only with an adequate system. DFARS 252.242-7006 adds 6
post-award criteria with no SF 1408 equivalent:
- internal control
- subledger reconciliation
- approval of adjusting entries
- management review
- billings reconcilable to cost accounts
- CAS

**Ranked by necessity to pass an SF 1408 survey.**

| Rank | Capability | SF 1408 item | Evidence |
|---|---|---|---|
| 1 | Job cost by contract (and CLIN) under GL control | 2(b), 2(d), 2(i) | The core of FAR 16.301-3. Spreadsheet segregation outside the GL fails (practitioner blogs). |
| 2 | Direct/indirect segregation in the chart of accounts | 2(a) | A flat chart of accounts is a common small-firm failure. |
| 3 | Timekeeping: daily entry, all hours, certification, correction trail, charge restrictions | 2(e) | The top deficiency in DCAA reports (Redstone). |
| 4 | Labor distribution reconciled to payroll and the GL | 2(f) | CAM 5-304, criterion 10. |
| 5 | Unallowable exclusion by account, with a written policy | 2(h) | Unallowables found only at year end fail. |
| 6 | Indirect pools and bases (design and a sample computation) | 2(c) | The survey checks the design. Provisional rates come with the contract (52.216-7(e)). |
| 7 | Monthly close with cost by contract | 2(g) | "At least monthly". A quarterly close fails. |
| 8 | Contract funding, EAC and LoC/LoF notice data | 3(a) | 52.232-20 needs a revised estimate at 75%. |
| 9 | Preproduction segregation and progress-payment data | 2(j), 3(b) | Relevant to a manufacturer. |
| 10 | Billing from the books (cost voucher by CLIN) | DFARS (c)(16) only | Billing problems show up after award. |
| 11 | Incurred cost submission (ICE schedules) | none | Due 6 months after fiscal year end. |
| 12 | Earned value | none | Only at ≥ $50M cost-type. |
| 13 | R&D tax tagging | none | Most CPFF work gives no QREs. |

The contractor must have items 1–7 working and documented on the day of the survey. SF 1408 item 5 asks
if the system is "in full operation", so the contractor must show real or test
transactions. Items 8–10 must work by the first invoice. Items 11–13 come after
award or above a threshold.

## Competitor-Specific Details

### Deltek Costpoint

- **Screens.**
  - Manage Allocation Groups (group 1 posts; other groups are informational)
  - Manage Cost Pools, with subtasks Pool Cost, Pool Base and Pool Rates
  - Manage Pool Processing Sequence Numbers and Build Rate Application Table
  - Compute/Print Pool Rates, Post Pool Journals and Compute Burden Costs
  - Manage Burden Cost Ceilings and Calculate Retroactive Billings
- **Pool Details flags.** Pool Type, Service Center, Apply Rates to Projects,
  Unallowable, Exclude Burden from Asset Inventory, Basis Type, Debit Account, Credit
  Account.
- **Rate storage.** 8 columns per pool × fiscal year × period: period and YTD for
  actual, target, provisional and cost of money.
- **Funding.** Manage Modifications (value and funding, cost and fee), Manage Total
  Ceilings (R/B/A/N codes), Manage ACRN Bills (FIFO, LIFO, Proration, Earliest
  Expiring Funds).
- **Timekeeping.** Timesheet Class (Revision Explanation), Revision Audit, Daily
  Floor Check, Charge Trees, Resource Groups, project workforce, Interim charges with
  Hard Edit. Deltek recommends "Reverse Timesheet On Correction" for auto-adjusted
  timesheets.
- **Purchasing.** Over Budget Validation on requisitions, released by Compute Over
  Budget Transactions.
- **EVM.** Manage Cobra Charge Templates maps charges to Cobra control accounts and
  work packages.
- Forward pricing and "Standard" or "Transactional" pool rate types are UNVERIFIED.

### Unanet GovCon

- A Cost Pool Group per legal entity holds Target, Provisional and Actual rates.
- The Cost Pool Calculation can post to the GL, push rates to the Cost Structure, or
  do both.
- Dilution (`unatime.cost.dilution.class`) for exempt users when timesheets reach
  COMPLETED. Pay codes: Standard Pay (Diluted), Standard Pay (Undiluted), Additional
  Pay (Undiluted).
- Audit properties: `unatime.audit`, `unatime.approval.required`,
  `unanet.approve.force_view`, `unanet.approve.self` off, timesheet delete off.
- A re-burden or retroactive billing screen name is UNVERIFIED. The Unanet help sites
  did not resolve during this research, so these claims rest on search snippets and a
  documentation mirror.

### SAP S/4HANA

- Costing sheet, overhead key on the WBS element, CJ44 single and CJ45 collective
  overhead runs (CJ45 UNVERIFIED).
- Classic PS availability control (budget profile, tolerance per activity group) and
  S/4HANA AVC (activity group "++" required).
- No native government rate engine or CLIN. Partner add-ons on the SAP Store:
  Cognitus CIS-GovCon (claims all DCAA schedules A–O) and NBS for SAP ByDesign.

### Oracle Fusion Project Costing

- Burden structure (additive or precedence), burden schedule versions (firm or
  provisional), multipliers per organization.
- Project type options:
  - Include Burden Cost on Same Expenditure Item
  - Create Expenditure Items for Burden Cost Components
  - Create Separate Expenditure Item for Burden Cost
  - Create Burden Cost Accounting Journal Entries
- Project budgetary control: Absolute, Advisory, Track, None, with a tolerance %.
- Billing controls with hard and soft limits.

### Microsoft Dynamics 365

- Native indirect cost components are a markup on hours or cost, not a pool ÷ base
  computation.
- Project Operations: not-to-exceed limits at 4 levels, contract lines mapped to
  tasks. Finance and AX 2012: funding sources with an on-hold source.
- Government contracting comes from ISVs: RSM GovCon (Finance) and GovCon365
  (Business Central).

### IFS Cloud and Epicor Kinetic

- IFS has costing overheads (labor, material, general, user-defined, as % or fixed).
  A government pool engine is UNVERIFIED.
- Epicor supports cost-plus project billing. One reviewer calls its DCAA features
  "not as deep". A pool engine or government add-on is UNVERIFIED.
- So the mid-market manufacturing ERPs that Carbon competes with leave this layer to
  Costpoint or Unanet. A defense manufacturer then runs 2 systems.

## Recommended Approach for Carbon

These recommendations extend the Phase 1–4 model of `.ai/specs/2026-10-03-projects.md`.
That model has `projectLedger` with `unallowable`, `timesheetEntry` with a correction
chain, `laborCategoryRate`, and contract lines with `fundedAmount` and `ceilingAmount`.

1. **Order Phase 5 by the SF 1408 ranking, not by the spec outline.** Ship the
   accounting-system items first (ranks 1–7): unallowable accounts, cost by contract
   and CLIN, timekeeping controls, labor distribution and a pool design. Then ship
   provisional burden billing, funding notices and availability control. Ship the ICE
   schedules, EVM and R&D tax last. A defense manufacturer can then win its first
   cost-type award before the later layers exist.

2. **Model pools on Costpoint, with Carbon's `costCenter` as the organization.** Add
   an `indirectPool` with a sequence, a pool type (Fringe, Overhead, Material
   Handling, G&A, Service Center, Intermediate) and a base type (Dollars or Hours).
   Map pool cost accounts and base accounts as account × cost center. Give each pool
   an applied credit account. This follows Costpoint's 4 account roles and CAS 418.

3. **Store rates per pool × fiscal year × period × rate type.** Rate types:
   Provisional, Target, Actual and Final. Hold ceilings per contract, not per pool
   (Costpoint Manage Burden Cost Ceilings). Compute the actual rate as a cumulative
   YTD catch-up that posts only the difference. Then a rate change inside the year
   needs no separate re-burden job.

4. **Post the pool allocation to the GL once per pool per period; keep project
   burden as memo `projectLedger` rows.** Burden rows carry the pool, the rate type
   and the rate, with no journal line. This follows Costpoint and avoids the
   double-count that Oracle warns about.

5. **Resolve the 2 overhead mechanisms before writing the spec.** Carbon already
   absorbs work-center overhead into job WIP (`overheadRate`, the overhead absorption
   account). A pool rate on the same labor would charge overhead twice. Costpoint's
   "Exclude Burden from Asset Inventory" flag shows the problem is real. Carry this
   into the spec's Open Questions.

6. **Re-bill by difference.** When provisional or final rates change, compute billed
   cost × new rate − burden billed before, per contract line. Draft the result as a
   true-up invoice through the recurring-invoicing layer. Never rewrite a posted
   invoice. This follows Costpoint Calculate Retroactive Billings and gives ICE
   Schedule I.

7. **Flag unallowable costs on the account, with a reason code and a type.** Add
   `account.unallowable` and a FAR 31.205 reason code. The type is Expressly
   Unallowable, Mutually Agreed or Directly Associated. Allow an override per journal
   line. Exclude unallowable cost from the claimed pool and from billing, but keep it
   in every base (CAS 405-40(e)). Report it per account for ICE Schedule B.

8. **Harden `timesheetEntry` to the DCAAM 7641.90 list.**
   1. Add a daily entry window as a company setting, with no work hours on future
      dates.
   2. Add a missing-day report (Costpoint Daily Floor Check).
   3. Add certification text per employee class, recorded as a signature event per
      period.
   4. Require re-approval after any change to a submitted entry.
   5. Notify the owner when another person enters or changes the owner's time, and
      require a reason.
   6. Add charge assignments per employee or group (Costpoint charge trees). Block
      inactive, closed and stop-work charge numbers.
   7. Add a read-only auditor export of timesheets as of a date.

9. **Add payroll as a data source before labor distribution.** Carbon has no
   payroll, and 2 controls need it:
   - CAM 5-304 reconciles timesheet hours to payroll dollars per employee.
   - The effective rate needs each exempt employee's salary for the period.

   Design Decision 11 costs labor by category rate. So the spec needs a period
   adjustment from category cost to actual payroll cost. Import the payroll register
   (employee, period, gross wages, hours) from the payroll provider. Carry this
   conflict into the spec's Open Questions.

10. **Support total time accounting with the effective rate as the default.** Record
    all hours of exempt staff. At period close, set each line's cost to salary ÷
    total hours (Unanet Dilution, CAM 6-410.4a). Offer the standard rate with a
    variance to overhead as the second method (6-410.4c). Send leave pay codes to
    fringe, undiluted.

11. **Make each contract line a CLIN, and add ACRNs as a child.** Add a 4-character
    CLIN number and a SLIN type (Informational or Separately Priced) on
    `customerContractLine`. Funding becomes dated modifications with funded cost,
    funded fee, value cost and value fee. Each modification allocates to an ACRN with
    an expiration date. A charge resolves to exactly one CLIN through its billing
    element. This follows Costpoint and DFARS 204.71.

12. **Raise LoC and LoF notices from a forecast, not from a percentage alone.** Per
    contract line, store a notice % (75–85) and a window (30–90 days). Raise the
    notice when incurred cost plus the next window's planned burn crosses the %. Show
    the funding exhaustion date. A stop-work order sets the project's status to a hold
    that blocks new charges (Costpoint hard edit).

13. **Add availability control with 3 actions, and never block a timesheet on
    budget.** Store tolerance rows per project: activity (Purchase Order, Issue,
    Timesheet), usage % and action (Warn, Warn and Notify, Block). A Block applies to
    purchase orders and issues only. On a timesheet, a Block becomes a warning plus a
    notice to the project manager (DCAA CAM 6-404.6(10)). This follows SAP's
    tolerance actions and Oracle's Advisory level.

14. **Route labor transfers through a document with a reason and an approver.** DFARS
    criterion 7 asks for approval of adjusting entries. The DoD IG lists late
    transfers between contracts as a fraud indicator. Phase 1's reclass action must
    therefore record the reason and the approver, and it must appear on a transfer
    report.

15. **Make the ERP the cost source for EVM before it is an EVM engine.**
    1. Ship an actuals export for Cobra. It gives hours and dollars by charge number,
       period and element of cost (labor, material, ODC, subcontract, overhead, G&A).
    2. Add an estimated-actuals log and a material point of measurement (receipt or
       issue).
    3. Add an "EVM-lite" for contracts under $50M. It has control accounts (element ×
       cost center) and work packages with a technique. BCWS comes from element plan
       dates, and BCWP from milestones or % complete.
    4. Add the IPMDAR CPD JSON export last. Leave the schedule dataset to P6 or MS
       Project.

16. **Tag R&D tax data on the charge, and default cost-type contracts to funded.**
    Add a work country on `timesheetEntry` (default from the employee's location)
    and on purchase lines for contract research. Add a business component and a
    software type on the project or element. Add an activity role (research,
    supervision, support) on the timesheet line, and an officer flag on the employee.
    Mark each contract with a funded-research flag, defaulted on for cost-type and
    T&M. Then build a Section F/G report and a §174A domestic/foreign report that
    includes overhead but excludes G&A.

17. **Keep the entitlement split of Design Decision 34.** Pools, burden, re-billing,
    ICE schedules and EVM fit `packages/ee` behind `requireEntitlement`. Unallowable
    flags, CLIN cost, timekeeping controls and labor distribution are adequacy basics.
    A gate on them would stop a small contractor from passing SF 1408 on the
    community edition. This is a product decision for the spec.

## Sources

Deltek Costpoint
- https://help.deltek.com/product/Costpoint/8.0/GA/pjx_Pool_Setup_Tips.html
- https://help.deltek.com/product/Costpoint/8.0/GA/PJMPOOL_Pool_Details_Tab.html
- https://help.deltek.com/product/Costpoint/8.1/GA/PJMPOOL_Pool_Rates_Subtask.html
- https://help.deltek.com/product/Costpoint/8.1/GA/pjx_Indirect_Rate_Computation.html
- https://help.deltek.com/product/Costpoint/8.1/GA/pjx_Calculate_Indirect_Rates.html
- https://help.deltek.com/product/Costpoint/8.0/GA/PJPALCST.html
- https://help.deltek.com/Product/Costpoint/7.1.1/GA/blx_Invoice_Billing_Formulas.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/blx_Calculating_Retroactive_Billings.html
- https://help.deltek.com/Product/Costpoint/7.1.1/GA/BLRRBIL.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/LDMLABOR_Timesheet_Overtime_and_Auto_Adjust_Options_Subtask.html
- https://help.deltek.com/product/Costpoint/6.1%20(SP2)/GA/ClientServer/ldqthf.htm
- https://help.deltek.com/product/costpoint/8.1/ga/LDMEINFO_Salary_Information_Tab.html
- https://help.deltek.com/product/costpoint/8.2/GA/TMMCONFIG.html
- https://help.deltek.com/Product/CostpointSuite/Timesheet%20Revision%20Audit%20Dialog%20Box%20(View%20Revisions).html
- https://help.deltek.com/Product/Costpoint/8.2/GA/PJMWORK.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/aoputlts_Report_Error_Messages.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/TMRFLRCHK.html
- https://help.deltek.com/Product/Costpoint/7.1.1/GA/pjx_Project_Levels_and_Data.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/PJMCLIN.html
- https://help.deltek.com/product/Costpoint/8.0/GA/BLMMAB_Contents_of_the_Manage_ACRN_Bills_Screen.html
- https://help.deltek.com/product/costpoint/8.1/ga/blx_ACRN_Billing.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/PJMMOD_Contents_of_the_Manage_Modifications_Screen.html
- https://help.deltek.com/product/Costpoint/8.1/GA/PJMTCEIL.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/Projects_Over_x_Funding_Dashpart.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/PJMBASIC_Basic_Info_Tab.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/PPMNTRQ1_Other_Information_Tab.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/Timesheet_Validations.html
- https://help.deltek.com/Product/Costpoint/7.1.1/GA/AOMCBCHG_Contents_of_the_Manage_Cobra_Charge_Templates_Screen.html
- https://help.deltek.com/product/cobra/8.4/ga/Import%20Actual%20Costs.html
- https://help.deltek.com/product/PMCompass/8.4/GA/earned_value_techniques.htm
- https://help.deltek.com/product/Analytics/7.1.6/Costpoint/ADMIN_CpA_Projects_Project_User-Defined_Fields.htm

Unanet
- https://knowledgecenter.unanet.com/display/kb/General%20Ledger%20Guide:%20Cost%20Pool%20Calculations
- https://knowledgecenter.unanet.com/display/kb/Quick%20Topic%20-%20Contract%20Management,%20Modifications,%20and%20Contract%20Briefs
- https://help.unanet.com/current/unanet_menu/misc/field_desc/fld_accounting_project_value.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/time/dilution.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/misc/dcaa.htm
- https://time.techsoft.com/unanet/docs/unanet_menu/admin/setup/setup_project_statuses.htm
- https://unanet.com/erp-for-govcon/contract-management
- https://unanet.com/blog/earned-value-management-for-gsa-oasis
- https://info.redstonegci.com/blog/why-indirect-rates-and-indirect-costs-matter-in-unanet

SAP
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-overhead-calculations
- https://community.sap.com/t5/application-development-and-automation-discussions/cj44-actual-overhead-calculation/td-p/1391363
- https://store.sap.com/dcp/en/product/display-2001008708_live_v1/cognitus-government-contracting-compliance-solution/
- https://www.nbs-us.com/sap-for-government-defense-contractors
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/f369b2eff700401494ba6e7c9a573288/a137bf9680c54e70b66ad9d0956e8b77.html
- https://help.sap.com/doc/acd8b65334e6b54ce10000000a174cb4/3.6/en-US/358fd153370e4608e10000000a174cb4.html
- https://sapprojectsystemmaterial.blogspot.com/2014/09/sap-ps-configure-budget-availability_56.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/c56f622a2edf491b9f1b596b55587009/183ab1f86115419da31288fe18dcbbd0.html
- https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/setting-up-budget-availability-control-on-cost-centers
- https://www.testingbrain.com/sap/co-tutorial/cj37-tcode-in-sap.html
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/using-progress-analysis-to-monitor-and-evaluate-the-project-schedule
- https://www.testingbrain.com/sap/ps-tutorial/cne1-tcode-in-sap.html

Oracle
- https://docs.oracle.com/en/cloud/saas/project-management/25d/oapfm/considerations-for-burden-cost-options-for-project-types.html
- https://docs.oracle.com/en/cloud/saas/project-management/24a/oapjc/what-happens-to-the-existing-expenditure-items-if-i-rebuild-a.html
- https://docs.oracle.com/en/cloud/saas/project-management/25b/oapfm/what-s-the-difference-between-a-firm-burden-schedule-and-a.html
- https://docs.oracle.com/cd/E29597_01/fusionapps.1111/e36898/F825898AN62AA4.htm
- https://docs.oracle.com/cd/E26401_01/doc.122/e48918.pdf
- https://docs.oracle.com/en/cloud/saas/sales/faaps/op-contracts-contractsuniqid-child-contractline-lineid-get.html
- https://docs.oracle.com/cd/E15586_01/fusionapps.1111/e20384/F552282AN68911.htm
- https://docs.oracle.com/en/cloud/saas/readiness/erp/24c/fins24c/24C-financials-wn-f33339.htm
- https://docs.oracle.com/cd/E18727_01/doc.121/e13567/T237204T237227.htm
- https://docs.oracle.com/cd/G18302_01/English/p6_eppm/17931.htm

Microsoft Dynamics 365
- https://www.microsoft.com/en-us/dynamics-365/blog/no-audience/2014/07/31/project-indirect-cost-components-in-ax-2012/
- https://learn.microsoft.com/en-us/dynamicsax-2012/appuser-itpro/about-indirect-costs-for-projects
- https://marketplace.microsoft.com/en-us/product/dynamics-365-for-operations/rsmproductsalesllc1604685958273.rsm-govcon?tab=overview
- https://www.xtivia.com/services/govcon365/
- https://learn.microsoft.com/en-us/dynamics365/project-operations/pro/sales/mapping-projects-tasks-contract-line-sales
- https://learn.microsoft.com/en-us/dynamics365/project-operations/pro/proforma-invoicing/manage-nte-status-validations-sales
- https://learn.microsoft.com/en-us/dynamics365/project-operations/sales/project-contract-settings
- https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/appuser-itpro/about-project-contract-funding

IFS and Epicor
- https://docs.ifs.com/ifsclouddocs/25r2/Costing/AboutCostCalculation.htm
- https://www.erpresearch.com/erp-with/erp-for-government-contractors

FAR, DFARS and CAS
- https://www.acquisition.gov/far/subpart-31.2
- https://www.acquisition.gov/far/31.201-6
- https://www.acquisition.gov/far/31.205-6
- https://www.acquisition.gov/far/subpart-42.7
- https://www.acquisition.gov/far/42.708
- https://www.acquisition.gov/far/42.709-2
- https://www.acquisition.gov/far/42.709-7
- https://www.acquisition.gov/far/subpart-42.17
- https://www.acquisition.gov/far/52.216-7
- https://www.acquisition.gov/far/52.232-20
- https://www.acquisition.gov/far/52.232-22
- https://www.law.cornell.edu/cfr/text/48/52.232-22
- https://www.acquisition.gov/far/32.704
- https://www.acquisition.gov/far/52.242-15
- https://www.acquisition.gov/far/37.115
- https://www.acquisition.gov/far/52.237-10
- https://www.acquisition.gov/far/16.301-3
- https://www.acquisition.gov/far-overhaul/far-part-deviation-guide/far-overhaul-part-16
- https://www.acquisition.gov/sites/default/files/page_file_uploads/GSA_RFO_Deviation_Part-37.pdf
- https://www.energy.gov/management/pf-2025-50-class-deviation-adopt-revolutionary-far-overhaul-rfo-part-31-contract-cost
- https://www.energy.gov/management/pf-2026-15-class-deviation-adopt-revolutionary-far-overhaul-rfo-part-42-contract
- https://www.acquisition.gov/dfars/subpart-204.71-uniform-contract-line-item-numbering-system
- https://www.acquisition.gov/node/34626/printable/pdf
- https://login.acquisition.gov/dfarspgi/pgi-204.7104-2-numbering-procedures.
- https://www.acquisition.gov/dfarspgi/pgi-204.7107-contract-accounting-classification-reference-number-acrn-and-agency-accounting-identifier-aai.
- https://www.acquisition.gov/dfarspgi/pgi-204.7108-payment-instructions.
- https://www.acquisition.gov/dfars/252.204-7006-billing-instructions.
- https://www.acquisition.gov/dfars/252.242-7006-accounting-system-administration.
- https://www.acquisition.gov/dfars/subpart-242.70-contractor-business-systems
- https://www.acq.osd.mil/dpap/dars/dfars_far_overhaul_class_deviations.html
- https://www.acq.osd.mil/dpap/dars/classdev/DFARS_RFO/Part-234/2026-O0011_Rev1_TAB_A_Deviation_Memo.pdf
- https://www.acq.osd.mil/dpap/dars/classdev/DFARS_RFO/Part-231/2026-O0032_Rev1_TAB_A_Deviation_Memo_USA002167-26.pdf
- https://www.law.cornell.edu/cfr/text/48/9904.405-40
- https://www.law.cornell.edu/cfr/text/48/9904.410-50
- https://www.law.cornell.edu/cfr/text/48/9904.418-50
- https://www.law.cornell.edu/cfr/text/48/9904.420-40
- https://pieetraining.eb.mil/wbt/wawf/documents/CV.pdf
- https://www.gsa.gov/system/files/2024-08/SF1408-14f.pdf

DCAA and DoD IG
- https://web.archive.org/web/20260517174722/https://www.dcaa.mil/Portals/88/Documents/Guidance/CAM/CAM_Chapter_06_20250225.pdf
- https://web.archive.org/web/20260517185527/https://www.dcaa.mil/Portals/88/Documents/Guidance/CAM/CAM_Chapter_05_20250224.pdf
- https://www.dcaa.mil/Portals/88/Documents/Guidance/CAM/Information%20For%20Contractors%20DCAAM%207641_90.pdf
- https://www.dcaa.mil/Portals/88/OverviewOfIndirectCostAndRates.pdf
- https://www.dcaa.mil/Portals/88/Documents/small%20biz/508%20docs/Incurred_Cost_Submissions%20(508).pdf
- https://www.dcaa.mil/Portals/88/17740%20Preaward%20Survey%20of%20Prospective%20Contractor%20Accounting%20System%20AP%20(508F).pdf
- https://www.dodig.mil/Portals/48/Documents/Components/PO/APO/Fraud-Resources/CAFraudScenarios/DirectandIndirectLabor.pdf

Earned value
- https://blog.humphreys-assoc.com/eia-748-standard-for-evms-revision-e-published/
- https://www.ndia.org/-/media/sites/ndia/divisions/ipmd/division-guides-and-resources/2026/ndia_ipmd_intent_guide_ver_e_rev_05142026.pdf
- https://www.ndia.org/-/media/sites/ndia/divisions/ipmd/division-guides-and-resources/ndia_ipmd_evms_scalabilityguiderev2_jan292020.pdf
- https://www.acq.osd.mil/asda/ae/ada/ipm/docs/DoD_EVMSIG_14MAR2019.pdf
- https://www.acq.osd.mil/asda/ae/ada/ipm/docs/20200312%20Contract%20Performance%20Dataset%20-%20FFS.pdf
- https://www.acq.osd.mil/asda/ae/ada/ipm/docs/IPMDAR%20Implementation%20and%20Tailoring%20Guide_Stamped.pdf
- https://acqnotes.com/Attachments/DAU%20EVM%20Gold%20Card.pdf
- https://www.humphreys-assoc.com/ipmdar-di-mgmt-81861c/
- https://www.humphreys-assoc.com/ipmdar-di-mgmt-81861d/
- https://www.humphreys-assoc.com/dfars-234-201-evms-policy-class-deviation-2026-o0011/
- https://ndia.dtic.mil/wp-content/uploads/2023/ipmdWinter/Berg.pdf
- https://www.elixirvms.com/articles/surviving-the-shift-eia-748-rev-e-decm-ipmdar-and-far-dfars-changes
- https://smawins.com/news/deltek-cobra-oracle-primavera-p6-schedule-data-import-best-practices/
- https://tensix.com/how-to-run-an-ipmdar-from-deltek-cobra/

R&D tax
- https://www.law.cornell.edu/uscode/text/26/174A
- https://www.law.cornell.edu/uscode/text/26/41
- https://www.law.cornell.edu/cfr/text/26/1.41-4A
- https://www.irs.gov/instructions/i6765
- https://www.irs.gov/irb/2025-38_IRB
- https://www.grantthornton.com/insights/alerts/tax/2025/flash/irs-issues-procedural-guidance
- https://www.grantthornton.com/insights/alerts/tax/2023/flash/irs-guidance-clarifies-amortization-under-section
- https://www.bdo.com/insights/tax/irs-issues-procedural-guidance-on-obbba-treatment-of-r-and-e-expenditures
- https://www.cbh.com/insights/alerts/rev-proc-2025-28-new-guidance-on-section-174a/
- https://rsmus.com/insights/tax-alerts/2024/new-guidance-section-174-research-expenditures.html
- https://leyton.com/us/insights/articles/section-g-of-form-6765-is-now-mandatory-for-tax-years-beginning-after-2025/
- https://ricercacredit.com/blog/form-6765-section-g-what-changed
- https://www.swansonreed.com/research-tax-credit/federal/glossary/qualified-services/
- https://gusto.com/product/integrations/neo-tax
- https://www.claimship.com/vs/mainstreet
- https://support.gusto.com/article/197779649100000/Federal-Research-and-Development-R-D-Tax-Credit-Have-Gusto-calculate-and-apply-your-credit
- https://www.cbh.com/insights/articles/rd-tax-credit-guide-for-government-contractors/
- https://www.thetaxadviser.com/issues/2023/mar/the-research-credit-funded-research/
- https://www.taxnotes.com/research/federal/court-documents/court-opinions-and-orders/engineering-company-cant-claim-credits-for-funded-research/1l2vb

Thresholds, NDAA and practitioners
- https://www.lexology.com/library/detail.aspx?g=045ac979-8e70-4b9c-966f-9211a443130d
- https://www.forvismazars.us/forsights/2025/12/ndaa-2026-cost-accounting-standards-cas-oversight
- https://info.redstonegci.com/blog/dod-issues-class-deviation-to-raise-full-cost-accounting-standards-cas-threshold-to-100-million
- https://www.insidegovernmentcontracts.com/2025/12/fy26-ndaa-aims-to-raise-the-dollar-thresholds-for-the-applicability-of-cas-and-tina/
- https://www.morganlewis.com/pubs/2025/12/defense-funding-and-policies-set-for-next-year-as-fy2026-ndaa-becomes-law
- https://info.redstonegci.com/blog/2026-ndaa-expands-the-benefits-of-being-a-non-traditional-defense-contractor
- https://www.wiley.law/DFARS-Overhaul-Class-Deviations
- https://www.hka.com/government-contracts/revolutionary-far-overhaul-update/
- https://www.aprio.com/insights-events/2025-and-estimated-2026-compensation-limits-a-strategic-guide-for-government-contractors-ins-article-gc/
- https://info.redstonegci.com/blog/government-contractor-compensation-cap-for-calendar-year-cy-2026
- https://www.govdash.com/blog/indirect-rates-fringe-overhead-ga-government-contracting
- https://www.reliascent.com/incurred-cost-proposals
- https://www.reliascent.com/ice-preperation-checklist
- https://www.procas.com/completing-incurred-cost-submissions-dcaas-ice-model/
- https://info.redstonegci.com/hubfs/Case_Studies/Floorchecks.pdf
- https://info.redstonegci.com/blog/common-deficiencies-that-dcaa-reports-in-an-accounting-system-audit
- https://info.redstonegci.com/blog/accounting-system-adequacy-q-a
- https://info.redstonegci.com/blog/limitation-of-cost-or-funds-the-burden-falls-on-you
- https://info.redstonegci.com/blog/managing-project-controls-in-deltek-costpoint-through-contract-termination-challenges
- https://www.vsinghcpa.com/blog/starting-fy2027-strong-how-to-review-contract-funding-backlog-burn-govcon-wednesday/
- https://www.leftbrainpro.com/uncompensated-overtime/
- https://eubanksaccounting.com/2023/03/28/what-is-uncompensated-overtime-understanding-dcaa-timekeeping-requirements/
- https://www.cbh.com/insights/articles/dcaa-timekeeping-requirements-for-government-contractors/
- https://www.cbh.com/insights/articles/dcaa-accounting-system-requirements-for-government-contractors/
- https://timerewards.com/sf-1408-accounting-system-review/
- https://bluecloudcpa.com/guides/dcaa-compliant-accounting-system-requirements
- https://www.bakertilly.com/insights/dcaa-revised-procedures-labor-material-audits
