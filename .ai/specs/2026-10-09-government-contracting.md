# Government Contracting: an adequate accounting system, indirect rates, control and R&D tax

> Status: Phase 5a implemented (2026-10-11); Phases 5b, 5c and 5d are planned. Every open question is resolved (Q1–Q3 answered 2026-10-09).
> Author: Brad (with Claude)
> Date: 2026-10-09
> Research: `.ai/research/government-contracting-layer.md` and `.ai/research/projects-wbs-pmmo.md` (patterns 8 and 10, Answer 7). The first covers indirect rates, unallowable costs, DCAA timekeeping, CLIN/ACRN funding, budget control, earned value, R&D tax and the SF 1408 ranking.
> Builds on:
> - `.ai/specs/2026-10-03-projects.md` (the project ledger, timesheets, treatments; Phase 5 outline)
> - `.ai/specs/implemented/2026-10-09-project-billing.md` (Cost Plus billing, funding, revenue by progress)

## TLDR

A US defense manufacturer can win a cost-type contract only if its accounting system passes a pre-award survey (SF 1408). FAR 16.301-3 makes this a condition of award. Carbon now covers the survey's criteria, in the order the research ranks them:

| Phase | What it delivers | SF 1408 / DFARS item |
|---|---|---|
| **5a: Adequate system** | Direct and indirect cost objectives; unallowable accounts and their exclusion; DCAA timekeeping (daily entry, certification, a correction trail, total time); effective-rate dilution for exempt staff; the labor distribution report; CLIN and ACRN funding; preproduction flags | 2a, 2b, 2d–2j, 3a |
| **5b: Indirect rates** | Pools (fringe → overhead → material handling → G&A), rates by type and period, monthly YTD computation, burden in the project ledger, provisional billing with ceilings, re-burden and the true-up invoice, the incurred cost submission schedules | 2c, 3a, DFARS (c)(16) |
| **5c: Control and reporting** | Budget availability control (warn or block), earned value for contracts under $50M with an actuals export above it, stop-work orders | 3a, EIA-748 E14/E15 |
| **5d: R&D tax** | Business components, research roles, work country, funded-research flags; the §174A domestic/foreign split and the Form 6765 Section G report | none (tax) |

## Problem Statement

- **No direct/indirect segregation.** A project has a treatment (Statistical, Expense, Capitalize, Contract), but nothing marks a cost as direct to a contract or indirect. Accounts have no allowability flag (no column in `account`, `types.ts:192-211`).
- **No unallowable exclusion.** `projectLedger.unallowable` exists in the Phase 1a plan, but nothing sets it, and FAR 31.201-6 requires identification and exclusion.
- **Timekeeping fails DCAA.** The Phase 1a timesheet has corrections with a reason. It has no daily entry rule, no certification, no review of edits by others, no total time accounting and no missing-time check. These are the top recurring DCAA deficiencies.
- **No indirect rates.** Cost Plus (project billing spec) bills only the cost the ledger holds. CPFF billing needs provisional rates, and a year-end true-up needs actual rates.
- **No labor distribution.** DFARS criterion 10 needs hours and dollars by employee and cost objective, reconciled to payroll. Carbon has no payroll.
- **Contract lines are not CLINs.** Funding is one number per line (project billing spec). DFARS 204.71 funding comes per ACRN, in modifications.
- **No budget control, no earned value, no R&D tax data.**

## Proposed Solution

### Concepts

| Term | Meaning |
|---|---|
| **Cost objective** | A project's role in government cost accounting: **Direct** (a contract, a final cost objective), **IR&D**, **B&P**, **Indirect** (an overhead or G&A activity), **Commercial**. Set on the project. |
| **Allowability** | An account's FAR 31 status: **Allowable**, **Expressly Unallowable**, **Mutually Agreed Unallowable** or **Directly Associated Unallowable** (a cost caused only by an unallowable cost, FAR 31.201-6). An element can also be marked unallowable. |
| **Element of cost** | An account's IPMDAR class: Labor, Material, Subcontract, Other Direct, Travel. |
| **Timekeeping controls** | A company setting: **Standard** (Phase 1a behavior) or **DCAA**. DCAA turns on the controls in *Timekeeping*. |
| **FLSA status** | Exempt or Non-Exempt, on the employee's job. Dilution applies to Exempt staff. |
| **Dilution** | The effective-rate method for uncompensated overtime: an exempt employee's weekly labor cost is spread over all the hours they recorded (FAR 52.237-10, CAM 6-410). |
| **CLIN / SLIN** | A contract line item number (4 digits) and its sub-line (2 more characters). A contract line carries them. |
| **ACRN funding** | One funding action: a modification number, an ACRN, the funded cost and fee, and an expiry. Funding is the sum of these. |
| **Indirect pool** | A pool of indirect cost (fringe, overhead, material handling, G&A), its base, its place in the cascade, and its rates. |
| **Rate type** | **Provisional** (billing), **Target** (budget), **Actual** (computed), **Final** (negotiated), **Ceiling** (per contract line). |
| **Burden** | A project ledger row of type Burden: a base × a pool's rate. |
| **Work package** | A chargeable element with an earned value technique. Its control account is the nearest ancestor marked as one. |

### Phase 5a: an adequate system

#### Cost objectives and unallowable costs

- `project.costObjective` is required in DCAA mode: Direct, IR&D, B&P, Indirect or Commercial. A Contract-treatment project defaults to Direct. An Expense project must be IR&D, B&P or Indirect.
- **Direct and indirect segregation** (SF 1408 2a, 2b) follows from it. Direct cost is every ledger row of a Direct project. Indirect cost is every row of an Indirect project, plus every GL cost not charged to any project.
- `account.allowability` defaults to Allowable. `account.unallowableReason` holds the FAR 31.205 section (for example `31.205-14 Entertainment`).
- `projectElement.isUnallowable` marks a branch unallowable, for example "Lobbying support".
- **Setting the flag.** A posting function sets `projectLedger.unallowable` when the row's account is not Allowable, or its element (or an ancestor) is unallowable.
- **Excluding the cost.**
  - Billing: unallowable rows create no billable item (project billing spec, rule 3).
  - Pools: unallowable cost leaves the pool numerator (5b) but stays in the allocation bases. CAS 405-40(e) says it absorbs its share of G&A.
  - Reports: every report shows allowable and unallowable cost in separate columns.
- **Preproduction** (SF 1408 2j): `projectElement.isPreproduction` separates preproduction cost in the cost reports.

#### Timekeeping (DCAA mode)

When `companySettings.timekeepingControls = 'DCAA'`:

| Control | Rule | Source |
|---|---|---|
| Daily entry | An entry date must be today or within `timesheetEntryWindowDays` (default 1). A later entry needs a late reason and shows on the late-entry report. | DCAAM 7641.90 §3.c(4) |
| No advance entry | Entry dates after today are refused, except for leave elements. | Redstone floorcheck list |
| Certification | Submitting a week shows the certification text (one text for exempt, one for non-exempt staff). The employee confirms. Carbon stores who, when and the text's hash. | DCAAM §3.c(8) |
| Corrections | Every change to a saved entry writes a `timesheetEntryRevision` row (before and after: hours, charge number, labor category; who; when; reason) in the same transaction. A posted entry still corrects by reversal and replacement (Phase 1a). | DCAAM §3.c(6); Costpoint Revision Audit |
| Edits by others | An entry changed by someone other than its owner goes to **Pending Employee Review**. It cannot post until the owner accepts it. | Unanet `unatime.user.review.required` |
| Supervisor entry | Only for an employee on recorded absence (`peopleAbsence`), with a comment. The employee replaces it on return. | DCAAM §3.c(5) |
| Re-approval | Any change to a Submitted or Approved entry returns it to Draft. | Costpoint |
| Total time | The week's entries must account for every hour of the employee's timecards (`timeCardEntry`). `timesheetTimecardCheck` is Warn or Block. | CAM 6-405.2e |
| Missing time | A daily check lists employees with a scheduled shift and no entry, and notifies them and their manager. Holidays are excluded. | Costpoint Daily Floor Check |
| Charge restrictions | A project with `restrictCharging` accepts time only from its members (`projectMember`). | Costpoint charge trees |
| Funding never blocks time | A funding or budget check may warn on time, never refuse it. | DCAAM §3.c(2): "the nature of the work determines the … distribution of time, not availability of funding" |
| Leave | Leave elements (vacation, sick, holiday) live on an Indirect project and post to fringe. | FAR 31.205-6(m) |
| Auditor snapshot | **Export period** writes a read-only CSV of every entry and revision for a date range, before a floorcheck. | CAM 2025, 6-404.9c |
| Labor transfers | Moving posted labor cost between charge numbers (the Phase 1 reclass) needs a reason and an approver other than the requester. The **Labor transfers** report lists every transfer. | DFARS criterion 7; the DoD IG lists late transfers between contracts as a fraud indicator |

The audit log is not the correction trail: it is optional, asynchronous and kept 30 days before archiving (`.claude/rules/audit-log-system.md`). `timesheetEntryRevision` is written in the posting transaction and kept with the entry.

#### Dilution for exempt staff

- `employeeJob.flsaStatus` (Exempt, Non-Exempt) and `companySettings.standardWeeklyHours` (default 40).
- Carbon costs labor by labor category rate (projects decision 11), not by salary. So dilution scales the category cost. For an exempt employee with H hours in a week, each entry's cost = hours × rate × min(1, standard ÷ H). A 50-hour week at 60.00 costs 40 × 60.00 = 2,400.00, spread over 50 hours at 48.00.
- In DCAA mode, an exempt employee's week posts at certification, so the effective rate is known when it posts. A later correction re-dilutes the week and posts the difference.
- This is the CAM 6-410.4a effective-rate method. The standard-rate method (6-410.4c) is out of scope for v1.

#### Labor distribution

- The **Labor distribution** report: hours and dollars by employee × charge number × period, with direct, indirect and unallowable columns. It reconciles:
  - hours to the employee's timecards;
  - dollars to the payroll totals for the period (Q2), with the difference shown per employee.
- Carbon has no payroll. **Payroll totals** are imported per employee and pay period (CSV: employee, period start and end, gross wages, hours paid). `payrollPeriodTotal` holds them.

#### CLIN and ACRN funding

- `customerContractLine.lineItemNumber`: a CLIN (`0001`) or a SLIN (`0001AA` separately priced, `000101` informational). `parentLineId` nests a SLIN under its CLIN.
- Each CLIN maps to its billing element (project billing spec). Cost by CLIN is the subtree's cost.
- `customerContractFunding` rows: the line, the modification number, the date, the ACRN, the funded cost, the funded fee and the expiry date.
- In DCAA mode, the line's `fundedCost` and `fundedAmount` (project billing spec) become the sums of its funding rows. The funding notices of that spec use them.
- **Invoice by CLIN.** A Cost Plus invoice shows a separate amount per CLIN (DFARS 252.204-7006). A CLIN may have more than one ACRN. Then the invoice allocates its amount to the ACRNs, oldest funds first, as PGI 204.7108 allows for cost vouchers.

### Phase 5b: indirect rates and burden

#### Pools

- `indirectPool` holds these fields:
  - name and pool type (Fringe, Overhead, Material Handling, G&A, Service Center);
  - `sequence`, the cascade order;
  - base type and the applied (credit) account;
  - whether it applies to projects.
- **Base types:** Total Labor Dollars, Direct Labor Dollars, Direct Labor Hours, Direct Material Dollars, Total Cost Input, Value Added (TCI − material − subcontract).
- `indirectPoolAccount` maps accounts to a pool. A row can narrow the account by one dimension value of the journal line. The company chooses the dimension: a cost center, a department or a location. Each row says whether the account is pool **cost** (the numerator) or **base** (the denominator). This follows Costpoint's account × organization mapping.
- The cascade: a pool's cost includes the burden of the pools before it in the sequence. Fringe on indirect labor goes into overhead; every lower pool goes into the G&A base through TCI.

#### Rates and the monthly computation

- `indirectRate`: the pool, fiscal year, period, rate type, the period rate and the YTD rate.
- `compute-indirect-rates` (monthly, and on demand):
  1. For each pool in sequence order, YTD pool cost (allowable only) ÷ YTD base = the YTD Actual rate.
  2. It writes the Actual rates and a **Statement of Indirect Expenses** snapshot (pool cost by account, unallowable shown separately).
- `compute-project-burden`:
  1. For each project, apply the chosen rate type (company setting: Provisional for billing and costing, or Actual) to the project's YTD base for each pool.
  2. Subtract the burden already posted YTD. Post the difference as Burden rows in `projectLedger`, one per pool. This YTD catch-up also handles a rate change during the year (Costpoint's method).
  3. Burden rows are memo rows by default (no journal), because the GL already holds the pool cost. A setting posts them as applied burden for Contract projects: Dr Project WIP / Cr the pool's applied account.

#### Billing at provisional rates, and the true-up

- Cost Plus billable items include Burden rows (project billing spec). They bill at the lower of the Provisional rate and the line's **ceiling rate** (`customerContractRateCeiling`: line, pool, ceiling rate).
- **Re-burden:** when a user changes a Provisional rate, the next burden run posts the difference.
- **Retroactive billing:** `compute-retroactive-billing` takes billed cost × the new rate − the burden billed before. It creates adjustment billable items, which the next invoice bills.
- **Year end:** a user enters the **Final** rates. The true-up runs the same way against the Final rates.

#### The incurred cost submission

An export of the ICE schedules for one fiscal year, as CSV:

| Schedule | Contents |
|---|---|
| A | Claimed indirect rates: pool, base, rate |
| B | G&A pool by account, unallowable shown |
| C | Overhead pools by account |
| E | Allocation bases by element of cost |
| G | Books reconciled to claimed direct cost |
| H | Direct cost by contract, with indirect cost at claimed rates |
| I | Cumulative cost claimed and billed, by contract |
| K | Hours and amounts on T&M contracts |
| L | Payroll (imported totals) reconciled to labor distribution |

Schedules D, F, J, M, N and O need data outside Carbon or narrative text; the export leaves them out.

### Phase 5c: control and reporting

#### Budget availability control

- `project.budgetControl`: None, Warn or Block, with `budgetTolerancePercent`.
- The check compares an element's budget with its committed + actual cost, plus the new amount, rolled up to the element's nearest budgeted ancestor.
- It fires at PO line save, PO finalize (`$orderId.finalize.tsx`, before `finalizePurchaseOrder`), Issue to Project and a job charged to the project.
- **Timesheets only warn.** On a timesheet, a Block becomes a warning plus a notice to the project manager. DCAA: funding and budget never decide where time goes (CAM 6-404.6(10)).

#### Earned value

- **Under $50M** (or by choice): a native earned value engine.
  - `projectElement.isControlAccount`, with an owner (the control account manager). A chargeable element below it is a work package.
  - `projectElement.earnedValueTechnique`: 0/100, 50/50, Percent Complete, Milestone, Level of Effort, or Apportioned (with a base element and a factor).
  - **BCWS** spreads each work package's budget over its start and target dates, by fiscal period, from the baseline (Phase 1c).
  - **BCWP** comes from the technique and the element's status at period end.
  - **ACWP** is the ledger cost (direct + burden) by element of cost, in hours and dollars.
  - `earnedValuePeriod` snapshots BCWS, BCWP and ACWP per work package at period close. The snapshot never changes after close (EIA-748 E24 freeze).
  - The Costs tab shows CV, SV, CPI, SPI, EAC and VAC per control account.
- **$50M and above** (EIA-748 compliance, DFARS 234.201-70): Carbon exports period-closed ACWP by charge number and element of cost (hours and dollars, direct and burdened). Cobra or another EVM tool imports it. The scheduler (P6, MS Project) and the EVM tool produce the IPMDAR deliverables.
- **Material earned value** (EIA-748 E14): a material ledger row counts as actual cost in the period of its point of measurement. The project chooses the point: receipt, stock or issue.

#### Stop-work orders

A **Stop work** action on a Direct project records the order date and the 90-day end date (FAR 52.242-15). It sets the project On Hold, so it refuses new charges. **Resume** returns it to Released. The project shows the days left.

### Phase 5d: R&D tax

- **Business component:** `projectElement.isBusinessComponent`, with `rdComponentType` (Product, Process, All Others) and `rdSoftwareType` (Internal Use, Dual Function, Non-Internal Use, Excepted).
- **Research role** on time: `timesheetEntry.rdActivityRole` (Direct Research, Direct Supervision, Direct Support, Not Qualified). It defaults from the labor category's `rdActivityRole`.
- **Work country:** `timesheetEntry.workLocationId`, default the employee's job location. Its `countryCode` decides domestic or foreign R&E (§174A; Notice 2023-63: where the work is performed).
- **Funded research:** `customerContract.researchFunded` (default true for a contract with a Cost Plus or T&M line), with `paymentContingentOnSuccess` and `contractorRetainsRights`. Cost of a Direct project under a funded contract is not a QRE (§41(d)(4)(H); *Dynetics*).
- **Officer flag:** `employeeJob.isOfficer` (Form 6765 Section E, line 38).
- **Reports:**
  - **§174A R&E:** domestic and foreign research expenditure by tax year, from ledger rows of business components, split by work country.
  - **Form 6765 Section G:** one row per business component, in descending QRE order. The rows cover at least 80 % of total QREs, with at most 50 rows, then one aggregate row. Columns 49(a)–(e) and 50–56. Wages use the "substantially all" rule (80 % or more of an employee's time qualified → all of it counts).

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Order of delivery | 5a, 5b, 5c, 5d, ranked by SF 1408 need | The research ranks job cost by contract, segregation, timekeeping, labor distribution and unallowables as the items that must work on survey day. EVM and R&D tax are post-award or threshold-bound. |
| 2 | Direct vs indirect | A project attribute (`costObjective`), not an account attribute | SF 1408 2a is about cost objectives. The same account carries direct and indirect cost depending on the charge. |
| 3 | Unallowable | An account flag and an element flag; the ledger row stores the result | FAR 31.201-6 and CAS 405. The ledger keeps the flag at posting, so later account edits never change history. |
| 4 | Correction trail | `timesheetEntryRevision`, written in the transaction | The audit log is optional, asynchronous and has 30-day retention. DCAA needs before, after, who, when and why for every change. |
| 5 | DCAA mode | A company setting, off by default | Commercial customers must keep today's light timesheet (projects decision 12f). |
| 6 | Dilution | Effective rate on category cost, at weekly certification | CAM 6-410.4a. Carbon costs by labor category, not salary (projects decision 11), so the factor scales the category rate. |
| 7 | Payroll | Imported period totals | Carbon has no payroll. DFARS criterion 10 needs the reconciliation, not the payroll itself. |
| 8 | Funding and time | Never block time on funding or budget | DCAAM 7641.90 §3.c(2). Blocking time on funding is a known mischarging pressure (CAM 6-404.6(10)). |
| 9 | Burden | Project ledger memo rows by default, YTD catch-up, optional applied GL posting | Costpoint keeps burden in project tables; Oracle's two GL options show the double-count risk. The catch-up handles rate changes in year. |
| 10 | Rate types | Provisional, Target, Actual, Final, plus per-line ceilings | FAR 42.7, 52.216-7; Costpoint Pool Rates and burden ceilings. |
| 11 | CLIN | Contract line numbering plus ACRN funding rows | DFARS 204.71. Costpoint ACRN bills; D365 maps lines to tasks. |
| 12 | Earned value | Native below $50M, an actuals export above | DoD thresholds (Class Deviation 2026-O0011 Rev 1). Mid-size contractors use Cobra or similar above the threshold; Unanet integrates rather than embeds. |
| 13 | R&D tax | Tags on elements, time and contracts; two reports | §174A and Form 6765 Section G (mandatory for tax years after 2025, with small-filer exceptions). Funded contracts default to non-QRE. |
| 14 | Nontraditional contractors | No special mode | FY2026 NDAA §1826 exempts them from FAR 31 and the business systems clause, but FAR 16.301-3 still needs an adequate system for cost-type awards. |
| 15 | Multi-tenancy (H1) | Every new table has `companyId`, `PRIMARY KEY ("id","companyId")` and `id('prefix')`. Pools and rates are per company (legal entity). | conventions-database. |
| 16 | RLS (H3) | Pools and rates: `company("accounting")`. Revisions: owner read, `projects_view` read. Funding rows: `company("sales")`. | The module that owns each record. |
| 18 | Commercial gating | 5a and 5d community; 5b and 5c commercial (`GOVERNMENT_CONTRACTING`). | Brad 2026-10-09 (Q1). |
| 19 | Work-center overhead | `offsetAbsorbedOverhead` on a pool subtracts overhead already absorbed by work centers. | Brad 2026-10-09 (Q3). Avoids charging overhead twice. |
| 17 | Backward compatibility (H7) | Every control is off until DCAA mode or a pool exists. New columns default to today's behavior. | No FROZEN surface. |
| P1 | Leave element (5a plan) | A column `projectElement.isLeave`. A leave element must be on a project with cost objective Indirect. | Time on leave is charged ahead of the day, so a leave element is the one exception to "no advance entry". |
| P2 | Late reason (5a plan) | A column `timesheetEntry.lateReason`. The late-entry report lists the entries that have one. | The reason belongs to the entry it explains. |
| P3 | Labor transfer link (5a plan) | A column `timesheetEntry.correctionOfId` on the replacement entry. A transfer is a correction whose charge number changes. | Reuses the Phase 1 correction; the report finds a transfer by comparing the two charge numbers. |
| P4 | Re-dilution (5a plan) | A column `timesheetEntry.dilutionFactor`. Null means 1. | A later correction must know the factor the entry posted with. |
| P5 | Revision of a deleted entry (5a plan) | `timesheetEntryRevision.timesheetEntryId` has no foreign key. The table also stores `employeeId` for the owner read policy. | The trail outlives a deleted Draft entry. |
| P6 | Certification history (5a plan) | `timesheetCertification` has no unique key. A re-certified week keeps every row; the latest row is current. | Every certification is evidence. |
| P7 | ACRN allocation (5a plan) | A table `salesInvoiceFundingAllocation` (invoice, contract line, ACRN, amount). | An invoice of one CLIN can draw on more than one ACRN. |
| P8 | Payroll import path (5a plan) | The existing CSV import wizard, with a table `payrollPeriodTotal`, in place of an `import-payroll-totals` server function. | The wizard already does upload, column mapping and employee mapping. |
| P9 | Shared timesheet writes (5a plan) | Two server functions, `save-timesheet-entry` and `submit-timesheet-week`. The ERP and the MES call them. | The DCAA rules live in one place. |
| P10 | Lines with funding actions (5a plan) | Billing lines only (Time & Materials and Cost Plus). | A billing line keeps its id for its whole life (project billing P9), so a funding row never moves to another line. |

## Data Model Changes

```sql
-- enums (own migration)
CREATE TYPE "projectCostObjective" AS ENUM ('Direct', 'IR&D', 'B&P', 'Indirect', 'Commercial');
CREATE TYPE "accountAllowability" AS ENUM ('Allowable', 'Expressly Unallowable', 'Mutually Agreed Unallowable', 'Directly Associated Unallowable');
CREATE TYPE "elementOfCost" AS ENUM ('Labor', 'Material', 'Subcontract', 'Other Direct', 'Travel');
CREATE TYPE "timekeepingControls" AS ENUM ('Standard', 'DCAA');
CREATE TYPE "flsaStatus" AS ENUM ('Exempt', 'Non-Exempt');
CREATE TYPE "indirectPoolType" AS ENUM ('Fringe', 'Overhead', 'Material Handling', 'G&A', 'Service Center');
CREATE TYPE "indirectBaseType" AS ENUM ('Total Labor Dollars', 'Direct Labor Dollars', 'Direct Labor Hours',
  'Direct Material Dollars', 'Total Cost Input', 'Value Added');
CREATE TYPE "indirectRateType" AS ENUM ('Provisional', 'Target', 'Actual', 'Final');
CREATE TYPE "budgetControl" AS ENUM ('None', 'Warn', 'Block');
CREATE TYPE "earnedValueTechnique" AS ENUM ('0/100', '50/50', 'Percent Complete', 'Milestone', 'Level of Effort', 'Apportioned');
CREATE TYPE "rdActivityRole" AS ENUM ('Direct Research', 'Direct Supervision', 'Direct Support', 'Not Qualified');
ALTER TYPE "timesheetEntryStatus" ADD VALUE 'Pending Employee Review';

-- 5a
ALTER TABLE "account" ADD COLUMN "allowability" "accountAllowability" NOT NULL DEFAULT 'Allowable',
                      ADD COLUMN "unallowableReason" TEXT,
                      ADD COLUMN "elementOfCost" "elementOfCost";
ALTER TABLE "project" ADD COLUMN "costObjective" "projectCostObjective",
                      ADD COLUMN "restrictCharging" BOOLEAN NOT NULL DEFAULT FALSE,
                      ADD COLUMN "budgetControl" "budgetControl" NOT NULL DEFAULT 'None',   -- 5c
                      ADD COLUMN "budgetTolerancePercent" NUMERIC,                         -- 5c
                      ADD COLUMN "stopWorkDate" DATE;                                      -- 5c
ALTER TABLE "projectElement" ADD COLUMN "isUnallowable" BOOLEAN NOT NULL DEFAULT FALSE,
                             ADD COLUMN "isPreproduction" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "companySettings" ADD COLUMN "timekeepingControls" "timekeepingControls" NOT NULL DEFAULT 'Standard',
                              ADD COLUMN "timesheetEntryWindowDays" INTEGER NOT NULL DEFAULT 1,
                              ADD COLUMN "timesheetTimecardCheck" TEXT NOT NULL DEFAULT 'Warn',  -- 'Off' | 'Warn' | 'Block'
                              ADD COLUMN "certificationTextExempt" TEXT,
                              ADD COLUMN "certificationTextNonExempt" TEXT,
                              ADD COLUMN "standardWeeklyHours" NUMERIC NOT NULL DEFAULT 40;
ALTER TABLE "employeeJob" ADD COLUMN "flsaStatus" "flsaStatus",
                          ADD COLUMN "isOfficer" BOOLEAN NOT NULL DEFAULT FALSE;           -- 5d

CREATE TABLE "projectMember" (          -- projectId, userId; PK (projectId, userId, companyId)
);
CREATE TABLE "timesheetEntryRevision" ( -- id('tsr'): timesheetEntryId, revisedBy, revisedAt, reason,
                                        -- before JSONB, after JSONB (hours, projectElementId, laborCategoryId, entryDate)
);
CREATE TABLE "timesheetCertification" ( -- id('tsc'): employeeId, weekStart, certifiedAt, textHash; UNIQUE (employeeId, weekStart, companyId)
);
CREATE TABLE "payrollPeriodTotal" (     -- id('ppt'): employeeId, periodStart, periodEnd, grossWages, hoursPaid, importedBy
);
ALTER TABLE "customerContractLine" ADD COLUMN "lineItemNumber" TEXT,   -- '0001', '0001AA', '000101'
                                   ADD COLUMN "parentLineId" TEXT;
CREATE TABLE "customerContractFunding" ( -- id('conf'): customerContractLineId, modificationNumber, fundedDate,
                                         -- acrn TEXT (2 chars), fundedCost, fundedFee, expiresOn
);

-- 5b
CREATE TABLE "indirectPool" (            -- id('ipl'): name, poolType, sequence, baseType, appliedAccountId,
                                         -- appliesToProjects BOOLEAN, offsetAbsorbedOverhead BOOLEAN (Q3), active
);
CREATE TABLE "indirectPoolAccount" (     -- id('ipa'): indirectPoolId, accountId, dimensionId?, dimensionValueId?, role ('Cost' | 'Base')
);
CREATE TABLE "indirectRate" (            -- id('irt'): indirectPoolId, fiscalYear, periodNumber, rateType, periodRate, ytdRate;
                                         -- UNIQUE (indirectPoolId, fiscalYear, periodNumber, rateType, companyId)
);
CREATE TABLE "indirectExpenseStatement" ( -- id('ies'): indirectPoolId, fiscalYear, periodNumber, accountId, amount, unallowableAmount
);
CREATE TABLE "customerContractRateCeiling" ( -- id('crc'): customerContractLineId, indirectPoolId, ceilingRate
);
ALTER TABLE "projectLedger" ADD COLUMN "indirectPoolId" TEXT,       -- Burden rows
                            ADD COLUMN "indirectRateType" "indirectRateType";

-- 5c
ALTER TABLE "projectElement" ADD COLUMN "isControlAccount" BOOLEAN NOT NULL DEFAULT FALSE,
                             ADD COLUMN "controlAccountManagerId" TEXT REFERENCES "user"("id"),
                             ADD COLUMN "earnedValueTechnique" "earnedValueTechnique",
                             ADD COLUMN "apportionedToElementId" TEXT,
                             ADD COLUMN "apportionedFactor" NUMERIC;
ALTER TABLE "project" ADD COLUMN "materialMeasurementPoint" TEXT;   -- 'Receipt' | 'Stock' | 'Issue'
CREATE TABLE "earnedValuePeriod" (       -- id('evp'): projectElementId, fiscalYear, periodNumber,
                                         -- bcws, bcwp, acwp, acwpHours, by element of cost (JSONB); frozen at period close
);

-- 5d
ALTER TABLE "projectElement" ADD COLUMN "isBusinessComponent" BOOLEAN NOT NULL DEFAULT FALSE,
                             ADD COLUMN "rdComponentType" TEXT,    -- 'Product' | 'Process' | 'All Others'
                             ADD COLUMN "rdSoftwareType" TEXT;     -- 'Internal Use' | 'Dual Function' | 'Non-Internal Use' | 'Excepted'
ALTER TABLE "timesheetEntry" ADD COLUMN "rdActivityRole" "rdActivityRole",
                             ADD COLUMN "workLocationId" TEXT;
ALTER TABLE "laborCategory" ADD COLUMN "rdActivityRole" "rdActivityRole";
ALTER TABLE "customerContract" ADD COLUMN "researchFunded" BOOLEAN,
                               ADD COLUMN "paymentContingentOnSuccess" BOOLEAN NOT NULL DEFAULT FALSE,
                               ADD COLUMN "contractorRetainsRights" BOOLEAN NOT NULL DEFAULT FALSE;
```

## API / Service Changes

- **Pure helpers** (`@carbon/utils`, unit-tested): `isEntryDateAllowed`, `dilutionFactor`, `computePoolRates(pools, costs, bases)`, `burdenCatchUp(ytdBase, ytdRate, postedYtd)`, `retroactiveBillingAdjustment`, `budgetAvailability`, `earnedValue(technique, budget, status, schedule)`, `section6765Rows(components, qres)`.
- **Posting:** `project-posting.ts` sets `unallowable`; `post-timesheet` applies dilution and the DCAA rules; `assertChargeable` checks `restrictCharging`.
- **Server functions:** `compute-indirect-rates`, `compute-project-burden`, `compute-retroactive-billing`, `close-earned-value-period`, `import-payroll-totals`.
- **Jobs:**
  - the daily missing-time check;
  - the monthly rate and burden run after period lock;
  - the period close checklist gains "Timesheets complete", "Burden computed" and "Earned value closed".
- **Reports** (CSV, server-side as `analytics.$reportKey.tsx` does):
  - late entries, missing time, labor distribution;
  - Statement of Indirect Expenses, ICE schedules, cost by CLIN;
  - earned value by control account;
  - §174A R&E, Form 6765 Section G;
  - the auditor timesheet export.

## UI Changes

Build with the `carbon-design` skill.

- **Settings → Timekeeping:** controls (Standard or DCAA), the entry window, the timecard check, the two certification texts, standard weekly hours.
- **Chart of accounts:** allowability, the unallowable reason and the element of cost in the account drawer.
- **Project settings:** cost objective, restrict charging with a member list, budget control and tolerance, material measurement point, **Stop work** / **Resume**.
- **Element:** unallowable, preproduction, control account (with its manager), earned value technique, business component fields.
- **My Timesheet (DCAA mode):**
  - the late reason field and the certification dialog on submit;
  - the review banner for entries others changed;
  - the revision history per cell.
- **People → Payroll totals:** CSV import and the list.
- **Accounting → Indirect rates:** pools (with accounts and bases), rates by period and type, the computation run, and the Statement of Indirect Expenses.
- **Contract line:** the CLIN/SLIN number, the funding actions table, and the rate ceilings.
- **Project → Costs:** allowable and unallowable columns, burden by pool, earned value metrics per control account.
- **Reports:** the reports listed above.

## Acceptance Criteria

Phase 5a

- [ ] **Unallowable.** An account set to Expressly Unallowable makes a charge's ledger row unallowable. It creates no billable item. The cost report shows it in the unallowable column.
- [ ] **Daily entry.** DCAA mode is on, with a window of 1 day. An entry dated 3 days ago needs a late reason and shows on the late-entry report. An entry for tomorrow is refused.
- [ ] **Certification.** Submitting a week shows the exempt text to an exempt employee. The certification row stores who, when and the text hash.
- [ ] **Correction trail.** A user changes a saved entry from 6 h to 4 h with a reason. Carbon writes a revision with before, after, who, when and why.
- [ ] **Edit by a manager.** A manager changes an employee's entry. It goes to Pending Employee Review and cannot post until the employee accepts.
- [ ] **Total time.** With the timecard check on Block, a week of 38 h of entries against 40 h of timecards cannot be submitted.
- [ ] **Dilution.** An exempt employee records 50 h in a week at 60.00. The week posts 2,400.00, at 48.00 an hour across the entries.
- [ ] **Labor distribution.** The period's report shows hours and dollars by employee and charge number. It shows the difference to the imported payroll totals.
- [ ] **Funding by ACRN.** Two funding actions of 50,000.00 and 30,000.00 make the line's funded cost 80,000.00. A Cost Plus invoice shows a separate amount per CLIN.

Phase 5b

- [ ] **Rates.** Fringe (base: total labor dollars) has a YTD cost of 30,000.00 on a base of 100,000.00, which gives 30 %. Overhead includes the fringe on its indirect labor in its cost.
- [ ] **Burden catch-up.** In month 2, a user raises a Provisional rate. The run posts months 1 and 2 at the new rate, minus the burden already posted.
- [ ] **Unallowable in the base.** An unallowable cost leaves the G&A numerator and stays in the TCI base.
- [ ] **Ceiling.** A line ceiling of 25 % on overhead bills overhead at 25 % when the Provisional rate is 28 %.
- [ ] **True-up.** Final rates lower than Provisional create negative adjustment billable items for the difference.
- [ ] **ICE export.** Schedule H lists each contract's direct cost and indirect cost at the claimed rates. Schedule I lists cumulative claimed and billed.

Phase 5c

- [ ] **Budget control.** With Block and 0 % tolerance, a PO line that takes an element over budget is refused at save. A timesheet entry that does the same only warns.
- [ ] **Earned value.** A 50/50 work package with a budget of 10,000.00 that started this period shows BCWP 5,000.00. Its CPI and SPI show on the Costs tab, and the period snapshot does not change after close.
- [ ] **Stop work.** **Stop work** sets the project On Hold with the order date and the 90-day end date. New charges are refused.

Phase 5d

- [ ] **Work country.** Time entered at a location in Germany counts as foreign R&E in the §174A report.
- [ ] **Funded research.** Time on a Direct project under a contract marked research funded gives no QRE.
- [ ] **Section G.** The company has 60 business components. The report lists those that make up 80 % of QREs, at most 50, in descending order. One aggregate row follows.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **A rate engine error misstates every Cost Plus invoice** | High | Pure, tested computation; the Statement of Indirect Expenses for review before burden posts; burden runs only on a locked period. |
| **Timekeeping controls frustrate users** | Med | Off by default; DCAA mode only for companies that turn it on. Each refusal says why and what to do. |
| **Dilution changes posted labor cost** after a correction | Med | Re-dilution posts a difference, never edits a posted row. |
| **Payroll totals come from outside** and may be late | Low | The labor distribution report shows "no payroll imported" per period; the period close checklist warns. |
| **Regulation changes** (RFO, FY2026 NDAA thresholds) | Med | Thresholds and texts are settings or documentation, not code paths. |
| **Scope.** This is the largest spec of the projects family. | High | Four phases, each shippable; 5a alone passes most of an SF 1408 survey. |

## Delivery phases

1. **Phase 5a: adequate system.** Cost objectives, unallowable, DCAA timekeeping, dilution, labor distribution with payroll import, CLIN/ACRN funding, preproduction. **Done** (2026-10-11): `.ai/plans/2026-10-09-government-contracting-phase-5a.md`, Tasks 1–34; the browser verification (Task 35) is deferred.
2. **Phase 5b: indirect rates.** Pools, rates, computation, burden, provisional billing and ceilings, re-burden, retroactive billing, the ICE export.
3. **Phase 5c: control and reporting.** Budget availability control, earned value (native and the export), stop-work.
4. **Phase 5d: R&D tax.** Tags and the two reports.

## Out of scope

- A payroll engine. Carbon imports payroll totals only.
- The IPMDAR Contract Performance Dataset, the schedule dataset and the narrative. An EVM tool produces them from Carbon's actuals export.
- Forward pricing rate agreements and proposal pricing.
- Facilities capital cost of money (ICE Schedule F, CASB-CMF).
- CAS Disclosure Statements.
- Progress payments (SF 1443) and performance-based payments.
- The standard-rate dilution method (CAM 6-410.4c).
- Earned value baselines over target (OTB/OTS) and single point adjustments.
- State R&D credits.

## Open Questions

> Autonomous run (2026-10-09), then resolved with Brad.

Resolved with Brad (2026-10-09), each with the recommendation:

- [x] **Q1: commercial gating** — **Answer:**
  - 5a and 5d are community: cost objectives, unallowable flags, DCAA timekeeping, dilution, labor distribution, CLIN/ACRN funding and R&D tax. An SF 1408 survey checks 5a.
  - 5b (pools, burden, re-billing, the ICE export) and 5c (earned value) go to `packages/ee` behind a `GOVERNMENT_CONTRACTING` feature. `requireEntitlement` guards their authoring functions.
- [x] **Q2: payroll source** — **Answer:** a CSV import of period totals per employee (gross wages, hours paid) into `payrollPeriodTotal`. A payroll-provider connector gets its own spec later. No true-up from category cost to payroll cost in v1.
- [x] **Q3: overhead absorbed by work centers** — **Answer:** a pool option `offsetAbsorbedOverhead`. With it on, the pool's burden on a project = rate × base − the project's absorbed work-center overhead in the period. The absorption account maps to the pool as a credit.

Resolved autonomously (2026-10-09), open to veto:

- [x] **Correction trail in the audit log?** — **Autonomous:** no, a revision table. Rationale: optional, asynchronous, 30-day retention.
- [x] **Dilution method?** — **Autonomous:** effective rate on category cost. Rationale: CAM 6-410.4a; no salaries in Carbon.
- [x] **Burden in the GL?** — **Autonomous:** memo rows by default, applied posting optional. Rationale: Costpoint practice; avoids double counting.
- [x] **Native EVM above $50M?** — **Autonomous:** no, an actuals export. Rationale: validated EVM tools are the norm; the ERP owns actuals.
- [x] **Block time on funding?** — **Autonomous:** never. Rationale: DCAAM 7641.90.

## Changelog

- 2026-10-09: Updated from the research file's recommendations:
  - Q3 (work-center overhead);
  - the Directly Associated unallowable category;
  - labor transfers with an approver;
  - pool scoping by any dimension value;
  - a narrower gating recommendation.
- 2026-10-09: Created autonomously from five research surveys, merged in `.ai/research/government-contracting-layer.md`:
  - indirect rates and unallowable costs;
  - DCAA timekeeping;
  - CLIN, funding and budget control;
  - earned value and IPMDAR;
  - R&D tax and the SF 1408 ranking.

  Also from a map of Carbon's accounts, dimensions, periods, employees, timecards, audit log and reports. Q1 (gating) and Q2 (payroll source) are open.
- 2026-10-09: Q1–Q3 resolved (Brad), each with the recommendation. Status: ready for /plan.
- 2026-10-11: Phase 5a implemented (`.ai/plans/2026-10-09-government-contracting-phase-5a.md`, Tasks 1–34). Decisions P1–P10 of the plan are recorded in *Design Decisions*. Rule: `.claude/rules/government-contracting.md`. The browser verification (Task 35) is deferred.

