# Projects, Work Breakdown Structures and Project Manufacturing (GPD/PMMO) Research: Best Practices Survey

> Research date: 2026-10-03. Builds on `.ai/research/accounting-projects.md` (flat
> accounting Project dimension — shipped), and is the input to
> `.ai/specs/2026-10-03-projects.md`. Related: `.ai/specs/2026-10-02-contracts.md`
> (branch `revenue-recognition-rentals-spec`), `.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md`
> (PR #1601), `.ai/specs/2026-07-04-revenue-recognition.md`.

## Summary

We surveyed how SAP Project System (PS) structures projects as a work breakdown
structure (WBS) and captures costs, plans, budgets, settles, and bills against it. We
also surveyed how SAP's **Project Manufacturing Management and Optimization (PMMO)**,
the S/4HANA successor to **Grouping, Pegging and Distribution (GPD)**, lets aerospace
and defense (A&D) primes plan shared supply once while charging cost to each contract.
The same questions were put to Oracle Project-Driven Supply Chain, IFS Cloud, Deltek
Costpoint, Epicor Kinetic, Infor LN, Dynamics 365 and NetSuite. The accounting and
regulatory frame covers ASC 730, IAS 38, §174A/§41, FAR 31, CAS, the DFARS business
systems (DFARS 252.242-7006 accounting system, DFARS 252.242-7004 MMAS — the
government's material management and accounting system rules), ASC 606 and EIA-748
earned value.

Findings:

1. **Structure.** Every serious system models a project as a **header plus a tree**.
   Cost and time are charged only at **account-assignable leaves**. A billing node ties
   the tree to a customer contract. Lifecycle statuses gate which transactions are
   allowed.
2. **Settlement treatment.** The money side (WBS) is separate from execution: jobs, POs
   and timesheets *carry* a WBS reference rather than live inside it. Each project's
   **settlement treatment** decides where its cost lands: expensed R&D,
   construction-in-progress (CIP), contract WIP/COGS, or an indirect pool.
3. **GPD.** Grouping exists because A&D must *buy and build in common across contracts*
   for economies of scale, yet *recognise cost per contract* for CAS/DCAA. SAP gets
   there with three disconnected batch passes:
   - MRP plans at the grouping-WBS level,
   - a pegging run assigns supply back to demand afterwards,
   - a period-end distribution run moves cost from the grouping WBS to each contract.

   Practitioners (Lockheed Martin, ASUG 2019) report pegging runs of 37–720 minutes,
   distribution runs of up to 30 hours, cost "shifting" between contracts on every
   reschedule (they wrote custom freeze logic), and gaps closed "mostly with
   customization". **PP/DS ignores grouping entirely.** No SAP planning engine consumes
   pegging assignments as input, and Borrow/Loan/Payback was dropped from PMMO.
4. **Oracle and IFS netting.** These two show the better shape: project attributes
   ("stripes") on ordinary stock and documents, plus an **explicit netting
   scope/sequence** inside the planning run:
   - own project/task, then
   - excess of other members of a planning group, then
   - common stock.

   Planned orders inherit the stripe, and borrow/payback are firm planning objects.
5. **Billing.** Time & Materials (T&M) and cost-plus billing are a **billable-item
   engine** over project actuals: labor category bill rates, materials at cost plus
   handling, cost plus fee, and burden at provisional rates. Funding limits stop billing
   at the funded value.

## Competitors Surveyed

- **SAP S/4HANA PS + PMMO (formerly GPD)**: the enterprise reference. WBS, network,
  settlement, Resource-Related Billing (RRB), results analysis, and project stock with
  grouping/pegging/distribution. PMMO is the stated reason A&D primes run SAP. GPD was
  co-designed with Lockheed Martin and Northrop Grumman.
- **Oracle Fusion Project-Driven Supply Chain / EBS Project Manufacturing**: the
  closest analogue to PMMO and, on planning, better than it. Covers project striping,
  reservation and hard-pegging levels, netting sequences, and borrow/payback as firm
  supply and demand.
- **IFS Cloud**: strong in A&D and defense. Project Connectivity, project inventory,
  Project MRP with netting groups, and Borrow/Payback transfer requisitions.
- **Deltek Costpoint**: the GovCon/DCAA reference. Charge numbers, project and general
  labor categories (PLC/GLC), tiered indirect pools with provisional and actual rates,
  CPFF/T&M billing formulas, and project MRP via inventory abbreviations.
- **Epicor Kinetic**: the mid-market manufacturing analogue. Project → WBS phases →
  linked production jobs, project billing, and a revenue recognition workbench. It has
  no project inventory.
- **Infor LN, Dynamics 365 F&O / Project Operations, NetSuite**: covered for specific
  patterns: peg distribution (LN), funding rules and limits (D365), and charge-based
  billing (NetSuite).

## Key Consensus Patterns

### 1. A project is a header plus a WBS tree; cost lands only on leaves

- **SAP**: The project definition holds the profiles and defaults. WBS elements form
  the tree, and each carries three operative flags:
  - *planning element*: planned costs may be entered on it,
  - *account assignment element*: actual costs may post to it,
  - *billing element*: revenue may post to it.

  A coding mask derives the level from the key (e.g. `P-1000-01-02`). Projects are
  created by copying standard WBS templates.
- **Costpoint**: one segmented project ID, up to 15 levels. Charging is best practice
  at the lowest level only. Project account groups whitelist the chargeable GL accounts.
- **IFS**: Project → sub-project → activity. The activity is the charging leaf, with a
  separate cost/revenue element structure.
- **Oracle / NetSuite**: Project → task tree. Charges go to chargeable tasks.
- **Epicor**: Project → multi-level WBS phases.
- **Rationale**: managers plan and roll up at the upper levels, the shop and buyers
  charge at the leaves, and finance reports at any level. A tree whose leaves are
  "charge numbers" is universal. The terms vary: *WBS element* (SAP), *task*
  (Oracle/NetSuite), *activity* (IFS), *phase* (Epicor), *project level* (Costpoint).

### 2. Execution documents carry the WBS; they are not part of it

- **SAP**: production orders, purchase requisitions/POs (account assignment P/Q), goods
  issues (221/221Q) and timesheet confirmations (CATS) are assigned to a WBS element.
  Costs roll up the hierarchy. Networks add activities and components when the project
  itself is scheduled.
- **Oracle**: a Cost Collection flexfield (project, task, expenditure type and org,
  contract, funding source) on requisitions, POs, work orders and transfer orders.
- **IFS**: Project Connectivity attaches PO lines, shop orders, material requisitions
  and time to an activity, with cost buckets:
  Planned Committed → Committed → Used → Actual.
- **Epicor**: practitioners insist you do **not** run production on phase jobs. You
  link ordinary production jobs to project + phase, and Project Analysis rolls them up.
- **Rationale**: the shop floor, purchasing and inventory stay unchanged; the WBS is an
  account assignment. That is the key to "seamless" logging.

### 3. Status gates transactions

- **SAP**: Created (planning only) → Released (actuals allowed) → Technically
  Completed (no new planning or procurement, but late invoices and settlement still
  post) → Closed (frozen). Release cascades down the tree; Created is the only
  deletable state. Optional user statuses can allow, warn on or forbid individual
  business transactions.
- **S/4 Cloud Enterprise Projects**: Created → Released → Locked → Completed → Closed.
- **Rationale**: "you can't charge before it's released, and late invoices still
  land" is the minimum control auditors expect.

### 4. Cost treatment / settlement decides where project cost ends up

- **SAP**: settlement rules send WBS cost to a cost center, G/L account, asset under
  construction (AuC, via investment profile, which creates the AuC on release),
  profitability segment, or sales order. Customer projects use results analysis, or
  event-based revenue recognition (EBRR) in S/4, which needs no settlement.
- **Oracle**: cost accounting rules route by task type, e.g. to CIP or expense.
- **D365**: project type is immutable and decides accounting: T&M, Fixed price,
  Investment (to WIP, then capitalized), Cost, Internal, Time.
- **Accounting frame**:
  - ASC 730 expenses R&D as incurred, except items with an alternative future use.
  - IAS 38 capitalizes development once the six criteria are met, which needs a stage
    switch date.
  - Customer-funded R&D is an ASC 606 contract.
  - Government IR&D/B&P is a CAS 420 indirect project rolled into the G&A base.
- **Rationale**: one project tree, many accounting destinies. The destiny belongs on
  the project (or WBS branch) and drives postings.

### 5. Project stock is a segment of ordinary inventory

- **SAP**: special stock Q per WBS, either *valuated* (held at a separate value, cost
  charged to the WBS at issue) or *non-valuated* (cost charged to the WBS at goods
  receipt). PMMO supports **only non-valuated grouped stock**: cost-plus friendly and
  off the balance sheet, but transfers between projects need prices computed by hand.
- **Oracle**: project and task are attributes on on-hand stock ("striping"). Common
  stock carries no stripe. Striping, de-striping and re-striping are costed
  transactions, and costing can be kept per project/task as valuation-unit attributes.
- **IFS**: "A project owns its project inventory". Project supply is received only
  into project stock, while project demand may draw on standard stock.
- **Costpoint**: an inventory abbreviation per project; a "Common Inventory" flag marks
  company-owned stock.
- **Rationale**: a nullable project key on stock (null = common) is the consensus.
  Oracle, IFS and Costpoint are all valuated. The DFARS MMAS standards require transfer
  and loan/payback logic to be consistent, and the cost of transferred parts to move
  in the same billing period.

### 6. Grouping + netting scope: plan shared supply, keep cost per contract

- **SAP**: a grouping WBS (indicator 1 = all materials, 2 = selected MRP groups) pools
  the requirements of many operative WBS elements into one MRP segment. MRP plans
  **only at the grouping-WBS level**. A post-hoc pegging run assigns supply back to
  demand; a distribution run moves cost, commitments and down payments pro rata.
- **Oracle**: *reservation level* sets the sharing boundary (none / planning group /
  project / task). *Hard pegging level* sets which stripe planned orders inherit
  ("can never be greater than the reservation level"). Item-level soft/hard pegging
  and "allow common supply" add per-item control. **Netting sequences run inside the
  plan**: own project-task supply → excess project supply in the group → common supply.
- **IFS**: Project MRP nets per activity / per project / per planned netting group, and
  can transfer true surplus from standard stock. It proposes Transfer/Borrow/Payback
  material transfer requisitions.
- **Costpoint**: MRP nets by project / top-level project / netting group, and plans
  each requirement on its own abbreviation.
- **Rationale**: the A&D requirement is *commingle requirements in MRP from many
  contracts* and *recognise cost against the requiring contract* (Lockheed). Oracle and
  IFS do the allocation **in** the plan; SAP does it **after**.

### 7. Borrow/loan/payback is a first-class, planned transaction

- **Oracle EBS**:
  - A borrow requires a scheduled payback date and is costed at the lender's cost.
  - A payback is costed at the borrower's current cost; the difference goes to the
    borrower's payback variance account.
  - Matching is FIFO.
  - MRP sees a firm payback demand on the borrower and a firm payback supply on the
    lender, and never reschedules them.
- **IFS / Costpoint**: borrow transfers create an offsetting payback reservation.
- **SAP**: classic TBLP (Transfer/Borrow/Loan/Payback) was a restricted transaction in
  ERP. It used a dummy reservation on the borrower plus a non-convertible planned order
  on the lender, and covered no loans between grouping WBS elements. It is **absent
  from PMMO**, where only a 415Q group-to-group ownership transfer exists. Lockheed
  rebuilt borrow/loan/payback (BLP) as custom code.
- **DFARS MMAS**: under loan/payback the part moves while its cost stays on the
  originating contract. Payback must be prompt, the borrowing contract and borrow date
  identified monthly, and the replacement part's cost charged to the borrowing
  contract. Loans need approval from the government administrative contracting officer
  (ACO). Government-furnished material may never be used on commercial work.

### 8. Time is captured against charge numbers with DCAA controls

- **SAP**: CATS → internal activity allocation at the activity-type cost rate, from the
  sender cost center to the WBS.
- **Costpoint**: charge number = project leaf + project labor category (PLC). PLC is
  the contract labor title and the only thing that carries bill rates; the general
  labor category (GLC) is the HR class. Charge trees limit what each employee may pick.
  Timesheets enforce daily entry, a revision explanation per change, certification and
  approval.
- **DCAA**: contemporaneous daily entry, total time accounting, an immutable
  correction trail with reason and approver, and labor distribution.
- **Rationale**: one timesheet line = (employee, date, WBS leaf, labor category,
  hours). Cost comes from a cost rate; billing price from a separate bill rate.

### 9. T&M / cost-plus billing is a billable-item engine over project actuals

- **SAP RRB (DP91)**: actual cost line items are grouped by the Dynamic Item Processor
  (DIP) profile into dynamic items, mapped to service materials, and priced through
  normal SD pricing (the markup). Each item can be billed, postponed or rejected, and
  is tracked so nothing bills twice.
- **Costpoint**: billing formulas (cost + fee on cost, T&M loaded rates, rate × multiplier,
  progress payments, etc.). The fee sequence is allowable cost after ceilings → fee% with
  account overrides (the lower wins) → fee ceilings → revenue ceilings. Rate lookup is
  most-specific-wins: company PLC → project PLC → project PLC by employee.
- **Oracle**: bill rate schedules plus burden schedules (provisional or firm, re-burden
  when actuals are set), and a billing-control hard limit.
- **D365**: funding sources with rules by %, priority and date, funding limits,
  fall-through to the next source, and on-hold funding.
- **Epicor**: role codes give charge rates; invoice ceilings apply per role, resource
  or supplier.
- **Rationale**: billing draws on the same cost postings the project already has. A
  billable item is the unit of review (bill / hold / write off), and a funded limit
  caps it.

### 10. Indirect rates: provisional for billing, actual at year end

- **Costpoint**: tiered pools (fringe → overhead → G&A), each pool = cost ÷ base. Each
  pool holds provisional, target and actual rates. Burden is billed at provisional
  rates and trued up after the incurred-cost submission.
- **FAR 52.216-7**: provisional billing rates, a final indirect-rate proposal within 6
  months of year end, and an adjustment voucher.
- **Oracle**: burden schedule versions, with provisional and actual schedules active
  for the same dates.
- **Rationale**: CPFF/CPIF billing is impossible without pools and rate versions. It
  is a distinct, later layer from basic project costing.

## Answers to Research Questions

1. **What entities and lifecycle does a project use?** A header (type, customer,
   manager, dates, location, profile defaults) plus a self-referencing WBS tree. Each
   node has a code derived from its path or a mask, and flags: chargeable (account
   assignment), billing, and optionally planning/statistical. The status set is
   Created → Released → Technically Complete → Closed, with an optional hold or lock.
   Release cascades down; delete only while Created. Sources: SAP, Costpoint, IFS.
2. **How do parts and time get charged without friction?** Through an account
   assignment on documents the user already works with:
   - a job header carries WBS; its issues, labor and outside processing post to the
     job, and the job rolls up to the WBS (Epicor, SAP orders assigned to WBS),
   - a PO line carries WBS (SAP P/Q, Oracle stripe),
   - a direct issue of stock to a WBS (SAP 221),
   - a timesheet line against a WBS leaf (SAP CATS, Costpoint charge numbers).

   A project-type default decides the posting treatment.
3. **How is project cost accounted for?** Per project or branch treatment:
   - *Expense (R&D)*: ASC 730, debit R&D expense as incurred.
   - *Capitalize*: CIP/AuC, then the final asset; IAS 38 development after the stage
     date; ASC 350-40 internal-use software.
   - *Customer contract*: WIP/contract cost, recognised over time by cost-to-cost under
     ASC 606.
   - *Indirect project*: IR&D/B&P roll into G&A under CAS 420.

   Carbon's balance-sheet WIP-first style matches Deltek/Oracle rather than SAP's
   P&L-by-nature plus settlement.
4. **What is GPD, why does A&D need it, and where does SAP fall short?** It is grouping
   (pool many contract WBS into one planning segment), pegging (assign each supply back
   to the demanding contract WBS by quantity), and distribution (move actual cost,
   commitments and down payments from the grouping WBS to those contracts in
   proportion to the pegs). A&D needs common buys plus contract-level cost for CAS and
   DCAA.

   SAP's shortcomings:
   - (a) MRP plans one segment per grouping WBS and never decides contract ownership.
   - (b) Pegging is a separate batch run; reschedules re-peg and **shift cost between
     contracts**.
   - (c) Distribution is a period-end batch that cannot be re-run for earlier periods.
   - (d) PP/DS drops all grouping semantics.
   - (e) There is no BLP in PMMO, and sharing free stock across groups is manual (415Q).
   - (f) Long runtimes and heavy customization (Lockheed).

   The user's claim that "SAP's PP can't plan orders from PMMO project stock" is
   **directionally right**: no planning engine uses pegging as input, and PP/DS ignores
   grouping. MRP does plan the grouping segment itself.
5. **Valuated or non-valuated project stock?** SAP PMMO only does non-valuated: cost
   charged at receipt, off the balance sheet, billable at receipt, but transfers need
   computed prices. Oracle, IFS and Costpoint use valuated striping with costed
   transfers, which gives the cleaner MMAS audit trail. **Carbon should choose valuated
   striping**: it reuses `costLedger` FIFO layers and makes transfers and loans exact
   revaluations. The "bill material at receipt" need of cost-plus contracts is met by
   **distributing a grouped receipt to member projects at the receipt event** (see
   recommendation 6) and treating the project-striped receipt as incurred cost.
6. **How should T&M / cost-plus billing work?** Billable items are generated from
   project cost postings (time × bill rate by labor category; materials at cost +
   handling %; other direct costs; cost + fee %). They go through a review state
   (Unbilled / On Hold / Billed / Written Off), are capped by the contract line's funded
   amount, and are invoiced through the contracts branch's invoicing layer. T&M revenue
   is recognised as billed (the right-to-invoice expedient); cost-plus revenue by
   cost-to-cost.
7. **What do regulations require of the ERP?**
   - DFARS 252.242-7006 (18 criteria): direct vs indirect segregation, cost by contract
     and CLIN, timekeeping by cost objective, monthly interim cost, unallowable
     exclusion, billings reconcilable to the books, funding-limit information.
   - MMAS: consistent transfer and loan logic, cost moved in the same billing period,
     no government-furnished material on commercial work, an override log.
   - EVM ≥ $50M (DoD deviation 2026-O0011): actual cost by control account and period.
   - §174A: domestic vs foreign R&E tagging.
   - §41 / Form 6765 Section G (mandatory for tax years beginning after 2025): QRE
     categories per business component.

## Competitor-Specific Details

### SAP S/4HANA PS

- **Network.** Activities (internal, external, cost, service) under WBS, with
  durations, relationships and material components (stock item L vs non-stock N via
  the BOM–PS interface). Milestones on WBS or activities can release billing-plan lines.
- **Cost planning.** Overall (CJ40), detailed by cost element (CJR2), unit costing,
  Easy Cost Planning, and automatic network costing. In S/4 planning moves to ACDOCP /
  SAP Analytics Cloud.
- **Budget.** Original, supplement, return and transfer are separate documents.
  Availability control sets per-activity-group tolerances
  (1 = warn, 2 = warn + mail, 3 = error) on (actuals + commitments) / budget, checked
  at PR, PO and posting time.
- **Period end.** Overhead via costing sheet (CJ45) → results analysis (KKA2) →
  settlement (CJ88). Investment profile on release creates the AuC; full settlement
  moves it to the final asset.
- **Progress analysis.** Measurement methods (0/100, milestone, estimate,
  time-proportional, degree of processing, cost-proportional) produce POC, BCWS, BCWP
  and ACWP.
- **S/4 changes.** The Project Planning Board/Gantt and hierarchy graphics are in the
  compatibility scope. Project Builder was removed in S/4 Cloud 2202, replaced by
  Project Control – Enterprise Projects (F3215) and Project Planning (F3822). Project
  cost reports read the Universal Journal and **exclude commitments**.

### SAP PMMO / GPD

- **Grouping.** GRM3/GRM4/GRM5/GRM8 (API `MAINTAIN_GROUPING_WBS_PARAMS`). Grouping
  works for operative WBS only. Topologies: per plant, multiple per plant, hierarchical.
  Lockheed ran 500–14,000 groups per business area, and warns that a proliferation of
  groups lets programs hoard inventory.
- **Pegging.** `PMMO_PEGGING` writes `PMMO_ASSIGNMENT`. Each assignment records the
  next-higher order and the top-level requirement, with a status: In Procurement, In
  Stock, In Transit, Consumed. Logics are MRP order (stock first, chronological,
  inherited top-down through the BOM) or a fixing rule that copies prior assignments to
  cut cost-transfer postings.
  - Exceptions: excess, scrap and loss go either to history-proportional assignment or
    to a fixed exception WBS. Underpegs go to the exception WBS.
  - Breakpoints redirect cost to a WBS or cost center below a material.
  - Later additions: manual re-peg with a reason (2023), history by interval,
    serial-number awareness, and pegging of stock transport orders.
- **Distribution.** `RPMMO_DISTRIBUTION` moves actual costs, commitments and vendor down
  payments from the grouping WBS to requirement WBS elements in proportion to the
  assignments, keeping the original cost element. It supports simulation, undistribute
  all, and undistribute unpegged; `PMMO_DISTR_BALCHK` checks the result. Under
  non-valuated stock, production orders have no settlement and no WIP; overhead is
  applied directly to the requirement WBS.
- **Status.** GPD is deprecated (note 2933435). PMMO is generally available from
  S/4HANA 2020; GPD and PMMO are mutually exclusive.

### Oracle Fusion PDSC / EBS PJM

- Project netting rules / reservation level, hard pegging level clamped to the
  reservation level, item pegging (Soft / Hard / None), "Allow Use of Common Supplies",
  and user-sequenced netting sequences per bucket.
- Released planned orders carry the project-task stripe into execution.
- EBS project exception messages: excess in a project, shortage in a project, items
  allocated across projects.
- Known gaps: no forecast consumption by project; cannot ship from another project's
  stock inside a group without a transfer.
- Borrow/payback: lender cost vs borrower current cost, variance to the borrower, FIFO
  match, firm payback demand and supply. (Fusion Cloud's native support is unconfirmed.)

### IFS Cloud

- Commitment buckets (Planned Committed / Committed / Used / Actual) give live
  "estimate to complete" inputs.
- Activity-to-activity transfers inside one project exist because issuing a part bought
  for activity 1 against activity 2 mis-charges cost.
- Project MRP is a separate run that can trigger standard MRP afterwards.
- Material withdrawals are billed through a separate Material Withdrawal Margin (company
  or per project), not sales price lists.

### Deltek Costpoint

- Project account groups (PAG, chargeable account whitelist, permanent).
- Owning org decides revenue and profit roll-up.
- CLIN/SLIN mapped to level-2/3 nodes.
- Compute Pool Costs → Compute Burden Cost → Compute Revenue.
- Rate types: Actual, Billing, Ceiling, Standard, Transactional.
- Load Labor Rates stamps the bill rate onto labor history.
- Costpoint Manufacturing: inventory abbreviation keyed by part × abbreviation ×
  warehouse; issues outside the project allowed at four levels (none / top-level /
  netting group / unrestricted); transfer reservations are demand on the source and
  supply on the target; a borrow transfer creates a payback reservation.

### Epicor Kinetic

- Project billing contracts mix billing types per project or phase.
- Role codes control who may book time and at what rate.
- Cost plus = labor + burden at cost × markup %, plus an optional fixed charge or
  management fee.
- Revenue Recognition Workbench methods include POC, units and milestone deferral.
- Pain points: recognition is tied to project invoice posting; weak project cost
  reporting; no project inventory.

### Infor LN / D365 / NetSuite

- **Infor LN**: customized items carry a project segment (PCS). Peg distribution splits
  one order's cost across several WBS pegs with no physical split; cost-peg transfer
  rules cover borrow and payback.
- **D365**: project contract with funding sources, funding rules (%, priority, date),
  limits and on-hold funding. Billing rules: fee, T&M, milestone, progress, with
  retention.
- **NetSuite**: charge rules (fixed fee, time-based, expense-based, purchase) produce
  charges that are invoiced.

## Recommended Approach for Carbon

1. **Grow the existing flat `project` into the project header; add a WBS tree.** Main
   already has `project` (`id('prj')`, a Project `dimension`, journal-line tagging,
   Ramp sync). A second "project" concept would split reporting. Add header fields
   (readable id, type/treatment, status, customer, manager, dates, location) and a
   `projectElement` tree with chargeable/billing flags and a path-derived code. This
   follows SAP's project definition + WBS and Costpoint's leaf-charging rule.
2. **Account-assign, don't re-host.** Put `projectElementId` on `job`,
   `purchaseOrderLine` (and through to the receipt and invoice), and a new
   direct-to-project stock issue. Add a new timesheet line. Charging must be one picker
   on screens the user already uses (Epicor's linked jobs, SAP's account assignment,
   Oracle's stripe). Journal lines gain the Project dimension plus a new WBS dimension.
3. **Cost treatment at source, not period-end settlement.** Each project (optionally
   overridden per WBS branch, effective-dated for the IAS 38 stage switch) carries a
   treatment that decides the posting target at transaction time:
   - Expense → R&D (or chosen) expense account,
   - Capitalize → CIP (via the contracts branch's `fixedAssetCipCost`),
   - Contract → Project WIP, relieved by billing or revenue recognition,
   - Indirect → its pool account.

   This avoids SAP's settlement run and fits Carbon's posting style (the maintenance
   labor journal is the template). A reclass tool covers corrections.
4. **Status gates.** Draft → Released → Technically Complete → Closed (+ On Hold). Only
   Released elements accept new charges. Technically Complete still accepts late
   invoices and receipts against existing commitments. Closed is frozen. This follows
   SAP's status set.
5. **Project stock = valuated striping.** A nullable `projectId` on `itemLedger`,
   `costLedger` layers and `itemStockQuantities`, where null = common stock (Oracle,
   IFS, Costpoint). Explicit transactions: Transfer (cost moves), Borrow (part moves,
   cost stays, payback due date), Payback (FIFO-matched, variance to the borrower), all
   approval-gated with a reason (MMAS).
6. **Grouping, pegging and distribution done live, which is the differentiator:**
   - **Planning groups** pool projects for netting. Netting scope is Project, Group or
     Common, with item-level "allow common supply".
   - **MRP nets per segment in sequence**: own project → group excess → common. It
     plans new supply stamped with the group, and **pegs that supply to member-project
     demand inside the same run**. The result is a persisted, append-only pegging
     ledger, not a later batch.
   - **Distribution happens at the physical event.** A grouped receipt or job output
     is split into member-project-striped stock by the current pegs. Excess goes to the
     group's exception project, or to common stock. Cost moves with the stock, so there
     is no period-end distribution run and no cost shift after receipt: pegs are soft
     before receipt and hard after.
   - **Borrow/payback become firm MRP demand and supply.** MRP proposes borrows as
     planning actions (Oracle's and IFS's planning objects, which SAP lacks in PMMO).
7. **Billing through contracts.** Add T&M and cost-plus line kinds to `customerContract`
   (branch), linked to a billing WBS element. A billable-item engine draws on project
   cost postings: time × labor-category bill rate (most-specific-wins rate lookup,
   Costpoint), materials at cost + handling %, cost + fee %. A review state, a funded
   limit per line (Oracle hard limit / D365 funding limit), and invoicing through the
   shared recurring-invoicing layer. T&M revenue is recognised as billed; cost-plus by
   cost-to-cost via the revenue recognition run.
8. **Later layers, explicitly phased:**
   - indirect rate pools with provisional/actual versions and re-burden (Costpoint),
   - DCAA timesheet hardening (daily entry, correction reasons, certification),
   - budget availability control (SAP AVC warn/error),
   - EVM BCWS/BCWP/ACWP by control account,
   - R&D tax tags (domestic/foreign, QRE category, business component).

## Sources

SAP PS
- https://blog.sap-press.com/what-is-sap-project-system-for-sap-s4hana
- https://blog.sap-press.com/billing-with-sap-project-system-in-sap-s4hana
- https://santoshvemuri.blogspot.com/2020/08/s4hana-project-systems-operative.html
- https://www.tutorialkart.com/sap-ps/define-project-coding-mask/
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/executing-a-project
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-the-purchasing-process
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/executing-projects-using-activity-confirmation-and-the-cross-application-time-sheet-cats
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-overhead-calculations
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-budgeting-functions
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-results-analysis
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/generating-settlement-rules
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/describing-billing-methods-and-controls
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-direct-cost-planning-using-wbs-elements
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/assigning-material-components-to-a-project
- https://sapinsider.org/business-transaction-control-through-status-management/
- https://sapinsider.org/auc-with-investment-measure-using-work-breakdown-structure/
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/sap-ps-configure-budget-availability-control/ba-p/13269950
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/an-introduction-to-event-based-revenue-recognition-with-customer-projects/ba-p/13410880
- https://cspmarchive.wordpress.com/wp-content/uploads/2012/02/dip-profiles-documentation.pdf
- https://help.sap.com/doc/c34b5ef72430484cb4d8895d5edd12af/2023/en-US/SIMPL_OP2023.pdf
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/f369b2eff700401494ba6e7c9a573288/a70d0302aa0b4a79b772aeb6dd50f6de.html
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/removal-of-project-builder-with-sap-s-4hana-cloud-2202/ba-p/13512679

SAP PMMO / GPD
- https://help.sap.com/docs/SAP_ERP/00a552d4cb404d128ae92669b115e3a5/b4ceb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_ERP/00a552d4cb404d128ae92669b115e3a5/c0ceb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/674ad2784d654e45ae9e4cea9b5dedcc.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/e3a8ba538c95b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/88cfb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/2c9696b9471d4ae289b239c6fc4c4bb1.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/11e369047f0f40d09278690df6150b1e.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/2b586af82f80462aa8b2d55ed5c2f184.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/17a431564fce46f3a1e13c2f7bffb625.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/cc8f759e1b0e4f3b8048c3cf808d4068/52f781b74b374d7ba83c5b57d2c53f32.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f899ce30af9044299d573ea30b533f1c/a444c95360267614e10000000a174cb4.html
- https://help.sap.com/docs/SAP_ERP/cfff13ea14f3430488af41bbc02dbb69/51f5c353b677b44ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_ERP/cfff13ea14f3430488af41bbc02dbb69/12f5c353b677b44ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_ERP/cfff13ea14f3430488af41bbc02dbb69/63f5c353b677b44ce10000000a174cb4.html
- https://web.archive.org/web/2023/https://blogs.sap.com/2020/12/07/pmmo-solution-overview-and-pmmo-grouping/
- https://web.archive.org/web/2023/https://blogs.sap.com/2021/01/04/pmmo-pegging-and-distribution/
- https://web.archive.org/web/2023/https://blogs.sap.com/2021/09/27/non-valuated-grouped-stock-in-project-manufacturing-management-and-optimization/
- https://web.archive.org/web/2023/https://blogs.sap.com/2021/10/15/sap-s-4hana-2021-release-project-manufacturing-management-and-optimization-whats-new/
- https://web.archive.org/web/2023/https://blogs.sap.com/2021/05/17/production-planning-optimizer-in-s-4-hana-ppds-and-its-limitations/
- Lockheed Martin, ASUG 2019 "Lockheed Martin and GPD": https://blog.asug.com/hubfs/2019%20AC%20Slide%20Decks%20Thursday/ASUG83005%20-%20Lockheed%20Martin%20and%20GPD%20A%20Long,%20Strange,%20But%20Mainly%20Good%20Trip.pdf

Oracle / IFS / Costpoint / Epicor / LN / D365 / NetSuite
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24c/fausp/overview-of-project-specific-supply-planning.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25b/fausp/examples-of-project-netting.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fausp/item-attributes-for-project-specific-supply-planning.html
- https://docs.oracle.com/cd/E18727_01/doc.121/e13685/T635081T635191.htm
- https://docs.oracle.com/cd/E18727_01/doc.121/e13680/T634873T635599.htm
- https://docs.oracle.com/en/cloud/saas/project-management/21d/oapjb/project-contract-revenue.html
- https://docs.ifs.com/ifsclouddocs/25r2/lang/en/ProjectManagement/AboutReportCostHrsAndRevToActivity.htm
- https://docs.ifs.com/ifsclouddocs/25r2/lang/en/MaintainInventory/AboutProjectInventory.htm
- https://docs.ifs.com/ifsclouddocs/25r2/lang/en/Planning/AboutPmrp.htm
- https://help.deltek.com/Product/Costpoint/7.1.1/GA/pjx_Project_Levels_and_Data.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/pjx_Labor_Categories-Billing_Rates.html
- https://help.deltek.com/PRODUCT/COSTPOINT/7.1.1/GA/blx_Invoice_Billing_Formulas.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/pjx_Cost_Plus_Fee_on_Cost.html
- https://help.deltek.com/Product/Costpoint/6.1%20(SP2)/GA/Web/csba_docs/pjmpool.htm
- https://help.deltek.com/product/costpoint/8.0/ga/INMPROJ_Inventory_Material_Planning.htm
- https://www.epiusers.help/t/project-job-questions/98356
- https://www.epiusers.help/t/project-revenue-recognition/108477
- https://docs.infor.com/ln/10.7/en-us/lnolh/help/tc/onlinemanual/000600.html
- https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-pma/project-contracts
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3752830510.html

Accounting / regulatory
- https://www.acquisition.gov/far/31.205-18
- https://www.acquisition.gov/dfars/252.242-7006-accounting-system-administration.
- https://www.acquisition.gov/dfars/252.242-7004-material-management-and-accounting-system.
- https://www.acquisition.gov/far/52.232-7
- https://www.acquisition.gov/far/52.216-8
- https://www.cbh.com/insights/articles/dcaa-timekeeping-requirements-for-government-contractors/
- https://casrai.org/guides/limitation-of-cost-and-funds-notices
- https://www.grantthornton.com/insights/alerts/tax/2025/insights/full-expensing-of-domestic-research
- https://leyton.com/us/insights/articles/section-g-of-form-6765-is-now-mandatory-for-tax-years-beginning-after-2025/
- https://natlawreview.com/article/cas-threshold-jumps-25-million-35-million
- https://www.humphreys-assoc.com/dfars-234-201-evms-policy-class-deviation-2026-o0011/
- https://www.bpm.com/insights/asc-606-revenue-recognition-government-contractors/
- https://www.bakertilly.com/insights/revenue-recognition-uninstalled-materials
