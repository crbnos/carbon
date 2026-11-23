# WBS Interop and Contract Financing Research: Best Practices Survey

## Summary

This survey covers two features that Carbon needs to sell to defense manufacturers.

1. **WBS interop.** A WBS code on each project element, MIL-STD-881 starter templates, CSV import and export of the element tree, and a Microsoft Project XML (MSPDI) export.
2. **Contract financing.** Customary progress payments (FAR 32.5, SF 1443) and performance-based payments (PBP, FAR 32.10), with liquidation on delivery invoices.

Key findings:

- Every cost-of-record system stores the WBS code. None computes it on the fly. A government code belongs to the contract, not to the position in the tree.
- MIL-STD-881F is a US Government work with Distribution A. Carbon can ship its element names.
- MSPDI is enough as the one export format. MS Project, Primavera P6, Deltek Cobra and Deltek Acumen all import it.
- The contract sets the progress payment rate and the liquidation rate. Every product stores both rates on the contract.
- An SF 1443 request is a cumulative snapshot from contract award. Each request recomputes every line, then subtracts the earlier requests.
- DoD wants the GROSS amount on a delivery invoice. The paying office takes the liquidation when it pays. Costpoint and PeopleSoft print the net amount, which conflicts with the DFAS guidance.
- A PBP is a schedule of events, not a cost computation. DoD forbids a cost-based PBP amount.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference: Project System WBS coding masks, down payment requests and clearing.
- **Deltek Costpoint** — the market leader for US government contract accounting; full SF 1443 support.
- **Oracle PeopleSoft Contracts for Government Contracting** — a second complete model of progress payments and liquidation.
- **Infor LN** — a manufacturing ERP with progress payment requests on contracts.
- **Unanet GovCon and JAMIS Prime** — the mid-market government contracting systems. Their public documentation is thin.
- **Primavera P6, Microsoft Project, Deltek Cobra** — the scheduling and EVM tools that consume Carbon's exports.

## Key Consensus Patterns

### 1. The system stores the WBS code, and a move never changes it

- **SAP**: The user enters the WBS element ID (`PRPS-POSID`). A coding mask (transaction OPSJ) formats it. A move renumbers nothing. Customers lock the ID after release with a user status.
- **Costpoint**: The project ID is the WBS code. Each level is one segment, separated by ".", with a maximum of 30 characters.
- **Primavera P6**: Each node stores a short code. P6 builds the full path when it shows the node. An indent changes only the parent.
- **MS Project**: The outline number is always derived and changes on every move. The WBS code stays frozen until the user runs Renumber.
- **Rationale**: A government contract WBS must match the CSDR plan character for character. A change needs a contract modification and traceability to the old code (881F §4.1). So a code that changes by itself breaks the contract.

### 2. A contract WBS restarts at 1.0 and follows the government's numbers

- **MIL-STD-881F**: A contract WBS renumbers from 1.0. Level 1 is "1.0", level 2 is "1.1". The standard allows gaps, alpha suffixes (1.2.3a), and "logically adjusted" numbers when an element drops out.
- **DI-MGMT-81334D**: The CWBS codes "must be identical" to the CSDR plan. Routine reporting is at CWBS level 3.
- **Rationale**: The code is a contract fact. The system must accept the code that the government gives.

### 3. Charge accounts point at leaf WBS elements

- **IPMDAR**: Each control account points at one WBS element that has no children.
- **FlexFile (DI-FNCL-82162)**: The contractor tags actuals at the lowest WBS level in the CSDR plan. A charge code that feeds more than one WBS element needs a WBS allocation record.
- **Rationale**: Many charge numbers to one WBS element is the clean case. Carbon's charge number is already an element, so the element IS the WBS element.

### 4. MSPDI is the common exchange format

- **Primavera P6**: Imports Microsoft Project XML directly. It maps `WBS` to the WBS code and the baseline cost to Budget At Completion.
- **Deltek Cobra**: The Integration Wizard has a Microsoft Project XML source. Cobra links the control account and the work package through text fields, not through the row ID.
- **Deltek Acumen**: Reads MSPDI for the DCMA 14-point schedule checks.
- **Rationale**: One format reaches all three tools. A prime on P6 can import the file and save it as XER.

### 5. Financing terms live on the contract

- **Costpoint**: The "1443 Info" tab on the project holds the progress payment rate, the liquidation rate, the initial award date and the contract price basis.
- **PeopleSoft**: Progress payment terms hold the rates, the liability account and the linked contract lines. Statuses are Pending, Ready, Completed and Cancelled.
- **Infor LN**: The contract holds Progress Payment %, Progress Liquidation % and a small-business flag.
- **SAP**: No native SF 1443. A milestone billing plan has down-payment dates. Partners (Dassian) supply government financing.
- **Rationale**: The contract clause sets the rates. A rate change is a contract modification.

### 6. A progress payment request is a stored cumulative snapshot

- **Costpoint**: "Manage Closed Progress Billing Detail" keeps each posted request's line values. The user can edit lines 20a, 21a, 21d, 23 and 26 before posting. The help warns that an override leaves no audit trail.
- **PeopleSoft**: Calculates the costs incurred to date and the cost to complete, writes a worksheet, then bills one request.
- **Rationale**: The SF 1443 is cumulative from award. The ACO reviews each request against the previous one. So the system must reproduce every line of every request.

### 7. Liquidation is a running balance against delivery invoices

- **Costpoint**: Liquidation on a delivery invoice = lesser of (invoice basis × liquidation rate) or (total progress payments − total liquidations).
- **PeopleSoft**: The same rule. It shows the liquidation as a credit line on the invoice.
- **DFAS**: Asks the contractor to bill the GROSS amount. The paying office computes and takes the liquidation when it pays. On a net invoice, the paying office can take the liquidation twice.
- **Rationale**: Clause 52.232-16(b) fixes the formula. The unliquidated balance is SF 1443 line 24.

## Answers to Research Questions

1. **How should Carbon store a WBS code?** — Store it. Derive a default from the tree position (sibling order). Let the user pin the code, and never change a pinned code on a move (SAP, Costpoint, P6, MS Project WBS field).
2. **What does a government contract WBS need?** — A code per element that matches the CSDR plan, a level, a parent, and depth-first order (DI-MGMT-81334D, IPMDAR CPD file specification). The dictionary entry adds a definition with technical, cost and work content. FlexFile Data Group C now carries the dictionary.
3. **Can Carbon ship MIL-STD-881 element names?** — Yes. 881F is a US Government work (17 U.S.C. §105) with Distribution Statement A. Do not copy the IEEE texts it cites. Tensix gives away free 881F CSV files, so the industry treats the names as free. No surveyed product ships 881 templates inside the product.
4. **Which exchange formats matter?** — CSV (round trip) and MSPDI (export). XER matters only for USACE and NAVFAC construction. The IPMDAR Schedule Performance Dataset applies to cost and incentive contracts of $20M or more, and it needs CPM float data that Carbon does not compute.
5. **What are the progress payment rates?** — The contract states them. FAR: 80% large, 85% small business. DFARS 252.232-7004: 80% large, 90% small business. DoD class deviation 2020-O0010 Rev 2 gives 95% for small business. No source settles whether 90% or 95% governs a new DoD small-business award after 2026-02-01. So store the rate per contract.
6. **What does the SF 1443 compute?** — See *SF 1443 lines* below. The amount of the request is the lesser of line 25 (the limit on outstanding payments) and line 19 (the maximum balance eligible).
7. **Which costs are eligible?** — Incurred costs, paid or not (52.232-16(a)(1)). Remove unallowable cost (FAR 31.201-6(a)) and its burden. Remove capital cost (only depreciation counts), unpaid direct purchases older than about 30 days, unpaid pension contributions and disputed amounts. Segregate undefinitized work (80% cap).
8. **How does a PBP work?** — The contract lists events. Each event is severable or cumulative, belongs to the whole contract or to one CLIN, and has a dollar value or a percentage of a price. Total PBPs cannot exceed 90% of the price. Liquidation is a percentage or a fixed amount per delivery. The request has no SF 1443. DoD adds 4 values: 1a earlier events, 1b this request, 1c cumulative, 2 total cost incurred (for information only).
9. **How are requests submitted?** — WAWF on PIEE. Document types "progress payment request" (PPRA/PPRB numbers) and "performance based payment request" (PBPA/PBPB). EDI 810P is possible. The minimum for an ERP is a printable SF 1443 and a PBP request table that a user types into WAWF.
10. **What is the GL treatment?** — Two patterns. Costpoint and PeopleSoft credit a liability, "Unliquidated progress payments". Public A&D companies (RTX, Northrop, General Dynamics) net the payments against contract assets. One ledger account supports both presentations.

## Competitor-Specific Details

### MIL-STD-881F (13 May 2022, active)

Appendixes:

| Letter | System type |
|---|---|
| A | Aircraft Systems (manned and unmanned) |
| B | Electronics/Avionics/Generic Systems — also the generic structure for any other system |
| C | Missile/Ordnance Systems |
| D | Strategic Missile Systems |
| E | Sea Systems |
| F | Space Systems |
| G | Ground Vehicle Systems |
| H | Unmanned Maritime Systems |
| I | Launch Vehicle Systems |
| J | Information Systems/Defense Business Systems |
| K | Common Elements |
| L | Sustainment |
| M | Government System Test and Evaluation |

The 11 common elements (K.3):

1. Integration, Assembly, Test, and Checkout
2. Systems Engineering
3. Program Management
4. System Test and Evaluation
5. Training
6. Data
7. Peculiar Support Equipment
8. Common Support Equipment
9. Operational/Site Activation
10. Industrial Facilities
11. Initial Spares and Repair Parts

Contractor Logistics Support also appears at level 2 in every table read.

A common element has no fixed number. Each appendix numbers the common elements after its prime mission elements. Systems Engineering is 1.6 in A, 1.3 in B, 1.7 in C and 1.1.1 in F. A template must therefore store explicit codes.

Appendix B (the default template), levels 1 and 2:

```
1.0  Electronics/Avionics/Generic Systems
1.1  Prime Mission Product (PMP) 1...n
1.2  Platform Integration, Assembly, Test, and Checkout
1.3  Systems Engineering
1.4  Program Management
1.5  System Test and Evaluation
1.6  Training
1.7  Data
1.8  Peculiar Support Equipment
1.9  Common Support Equipment
1.10 Operational/Site Activation by Site 1...n
1.11 Contractor Logistics Support (CLS)
1.12 Industrial Facilities
1.13 Initial Spares and Repair Parts
```

Appendix B level 3 under 1.1: 1.1.1 PMP Integration, Assembly, Test, and Checkout; 1.1.2 PMP Subsystem 1...n; 1.1.3 PMP Software Release 1...n. The research subagent kept the full level-3 lists of A, B, C and F in its report. The spec copies them from the 881F PDF.

Numbering rules (881F §4.3): "Maintaining the WBS numbering is not an essential requirement of the Standard." An unused element drops out, and the numbers close up. The user must rename an "Other" element before using it. A "1...n (Specify)" element takes one element per instance.

### Deltek Costpoint

- **WBS.** The project ID holds the WBS. The first segment length is global. Lower segment lengths have a company default. No move function was found.
- **Progress payments.**
  1. Update Subcontractor Progress Payments.
  2. Calculate Progress Payment Bills. Line 13 applies the loss ratio automatically.
  3. Manage Progress Payment Bills. The user edits lines 20a, 21a, 21d, 23 and 26, and can hold or write off a line.
  4. Print the SF 1443.
  5. Create the WAWF (iRAPT) file.
  6. Post.
- **Liquidation.** The delivery invoice has a "Liq Amt" and prints "Less Liquidated Amount".
- **GL.** A setting chooses the net or the gross method. Another setting chooses whether a progress bill posts to the GL when billed or only when cash arrives.

### Oracle PeopleSoft Contracts for Government Contracting

- Progress payment terms link rates, a liability account, contract lines, projects and activities.
- A change after activation goes through an amendment.
- Example: a $1,000 progress payment, then a $2,000 delivery at 80%. The liquidation is $1,000 (the remaining balance), not $1,600.

### Infor LN

- A request comes from billable cost lines. The user approves it, then sends it to invoicing.
- The SF 1443 print needs the Operational Reporting add-on.

### SAP S/4HANA

- **WBS.** Project → Derive structure places elements in the hierarchy from their IDs, the opposite of deriving the ID from the hierarchy.
- **Financing.** A down payment request (billing type FAZ) creates a noted item. The customer's payment posts with special G/L indicator A. The final invoice clears it (condition AZWR). No FAR liquidation formula exists.

### Primavera P6, MS Project, Deltek Cobra

- **MS Project recalculates on open.** It recomputes summary dates. It moves an auto-scheduled leaf to the earliest date that its links allow. A Start No Earlier Than constraint keeps a leaf on its date unless a link pushes it later.
- **MSPDI traps.**
  - The XSD uses `xsd:sequence`, so the child order is fixed.
  - MSPDI writes costs × 100.
  - `LinkLag` is in tenths of a minute.
  - `UID` must be an integer that stays the same from one export to the next.
  - Write one Standard calendar. A calendar that differs from Project's default moves dates on re-import.
- **P6 import mapping.** `WBS` becomes the WBS code. The baseline Start and Finish become Planned dates. The baseline Cost becomes Budget At Completion. Text fields map to user-defined fields only through an import template.
- **Cobra.** Link the control account and the work package through text fields, because "Activity IDs automatically renumber". Cobra takes budget from resource assignments. A schedule with no resources gives Cobra no budget, so Cobra budget needs its own CSV later.

### SF 1443 lines (REV. 10/2023)

All amounts are whole dollars. The contractor numbers requests from 1, with no gaps. Line 6B is 3 digits (80% → "800").

| Line | Content or formula |
|---|---|
| 5 | Contract price (FAR 32.501-3: FFP current price plus not-to-exceed unpriced modifications; FPI target price; letter contract maximum obligated) |
| 6A / 6B | Progress payment rate / liquidation rate |
| 7 | Year and month of the initial award |
| 8A / 8B | Request number / request date |
| 9, 10 | Reserved in REV. 10/2023 |
| 11 | Costs eligible under the clause |
| 12a / 12b / 12c | Costs incurred to date / estimated cost to complete (at most 6 months old) / 12a + 12b |
| 13 | 11 × 6A (with the loss ratio when 12c exceeds line 5) |
| 14a–14e | Subcontractor financing paid, liquidated, net, approved unpaid, total |
| 15 | 13 + 14e |
| 16 | 5 × 6B |
| 17 | Lesser of 15 and 16 |
| 18 | Total of all earlier progress payments requested |
| 19 | 17 − 18 |
| 20a–20e | Costs of delivered items, the remainder × 6A, plus 14e |
| 21a–21e | Price of delivered items, the remainder × 6B, less unliquidated advance payments |
| 22 | Lesser of 20e and 21e |
| 23 | Liquidations taken plus liquidations expected on submitted unpaid invoices |
| 24 | 18 − 23 (unliquidated progress payments) |
| 25 | 22 − 24 |
| 26 | Amount of this request = lesser of 25 and 19 |
| 27 | Amount the contracting officer approves |

Section III (lines 20 to 25) applies only when the government has accepted delivered and invoiced items, or when advance payments exist.

**Loss ratio (FAR 32.503-6(g)).** Loss ratio = revised price ÷ (costs incurred + estimated cost to complete). Recognized costs = eligible costs × loss ratio. FAR example: $3,000,000 ÷ ($2,700,000 + $900,000) = 83.3%.

**Liquidation (52.232-16(b)).** Each delivery payment deducts the lesser of the unliquidated balance and (liquidation rate × amount invoiced). The alternate method (FAR 32.503-9) lets the contracting officer lower the rate. The minimum alternate rate is (estimated cost × progress payment rate) ÷ contract price, rounded UP to a tenth of a percent.

**Title vesting (52.232-16(d)).** Title to inventory and WIP allocable to the contract vests in the Government. A transfer off the contract needs approval and repayment of the allocable unliquidated payments. Carbon's project stock stripes and the documented transfer between projects already give this record.

## Recommended Approach for Carbon

### WBS interop

1. **Add `projectElement.wbsCode` (text) and `wbsCodePinned` (boolean).** A derived code follows the sibling order from the root ("1", "1.1", "1.2"). A pinned code is free text that the user types. This follows the MS Project WBS field and the P6 short code.
2. **Never renumber a pinned code on a move.** Renumber derived codes on every tree change. Offer a "Renumber" action that unpins and re-derives a subtree, as MS Project does.
3. **Keep the code unique per project.** Refuse a duplicate. Store a dot-separated string, and accept alpha suffixes (881F §4.3.2).
4. **Seed MIL-STD-881F starter templates as ordinary project templates** with pinned codes: Appendix B (generic), A (aircraft and UAV), C (missile) and F (space), levels 1 to 3. Store explicit codes, because a common element has no fixed number. No surveyed product ships these, so the templates are a differentiator.
5. **CSV round trip with an explicit parent.** Columns: Element ID, WBS Code, Parent WBS Code, Level, Type, Name, Start, Target, Budget, Predecessors (`1.2.1FS+2d`, keyed by WBS code), Milestone. A row with an Element ID updates that element. A row without one creates an element. This follows the Jira and MS Project merge-key pattern.
6. **MSPDI export, one file per project.**
   - Integer `UID` that stays the same across exports.
   - One Standard calendar.
   - Leaves get Start No Earlier Than on their start date.
   - Budget only on leaves, as `FixedCost` × 100.
   - Baseline 0 from the latest baseline.
   - `PredecessorLink` from `precedes` links.
   - Text1 = the element readable id; Text2 / Text3 = the control account and work package codes, for Cobra.
7. **Do not build XER or the IPMDAR datasets.** Keep a stable task ID and the control account and work package flags, so the SPD stays possible later.

### Contract financing

1. **Financing terms on the contract** (Costpoint, PeopleSoft, Infor LN). Keep a history of rate changes with the modification number. The terms:
   - the method: Progress Payments or Performance-Based Payments, never both on one contract;
   - the progress payment rate and the liquidation rate;
   - the small-business flag;
   - the contract price basis and the initial award date;
   - the linked fixed-price CLINs.
2. **Progress payment request = a stored snapshot of SF 1443 lines 5 to 27.** Compute every line from the project ledger. Then let the user override lines 20a, 21a, 21d, 23 and 26, with a reason. Keep both the computed value and the override, which fixes the Costpoint audit gap. Statuses: Draft, Submitted, Approved, Paid, Withdrawn.
3. **Eligible cost (line 11) from `projectLedger`.** Use rows of the contract's projects, `unallowable = false`, with the burden on unallowable rows removed. Take cost-reimbursement lines out of the price and the cost base. Carbon already holds every flag this needs.
4. **Cost of delivered items (line 20a) from job costing.** Costpoint has no automatic method. Carbon can sum the actual cost of shipped serials or lots. This is a differentiator.
5. **Liquidation on the delivery invoice.** Compute the expected liquidation = lesser of (rate × invoiced amount) and the unliquidated balance. Print the GROSS amount and show the expected liquidation as information, as DFAS asks. Record the actual liquidation from the remittance.
6. **PBP = an event schedule.** Events with code, description, completion criteria, severable or cumulative, preconditions, CLIN or whole contract, value or percentage, planned date. Record completion with evidence. A request bills the completed events and shows the DoD values 1a, 1b, 1c and 2. Its amount never reads the cost ledger.
7. **GL: one account.** Post requests to "Unliquidated progress payments" and liquidate on delivery invoices. Leave the balance-sheet presentation (liability or contra-asset) to the company's statement layout.
8. **Output: a printable SF 1443 and a PBP request.** Defer the WAWF EDI 810P export.

### Open points for the spec

1. The DoD small-business rate (90% or 95%) is unresolved. The per-contract rate makes this a data question, not a code question.
2. Whether to support the loss ratio in v1. Costpoint applies it automatically; WAWF flags a loss condition when 12a + 12b exceeds line 5.
3. Whether v1 needs subcontractor financing (lines 14a to 14d). Small manufacturers rarely finance their own suppliers.
4. Whether to support advance payments (line 21d). FAR treats them as a separate financing method.

## Sources

**MIL-STD-881F and WBS**
- MIL-STD-881F PDF: https://www.humphreys-assoc.com/evms/evms-documents/dod/DoD_MILSTD-881F_May2022.pdf
- ASSIST record, MIL-STD-881: https://quicksearch.dla.mil/qsdocdetails.aspx?ident_number=36026
- ASSIST record, DI-MGMT-81334: https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=205360
- DI-MGMT-81334D text: https://www.humphreys-assoc.com/evms/evms-documents/dids/CWBS-DI-MGMT-81334D.pdf
- DI-FNCL-82162 FlexFile DID: https://quicksearch.dla.mil/WMX/Default.aspx?token=5749099
- FlexFile Implementation Guide: https://www.midnitedynamics.com/assets/docs/March2021FlexFileImplementationGuide.pdf
- IPMDAR Implementation Guide: https://www.acq.osd.mil/asda/ae/ada/ipm/docs/IPMDAR%20Implementation%20Guide%20-%20Oct2020%20-%20For%20Public%20Release%20-%20Signature%20Edition.pdf
- CPD File Format Specification: https://www.acq.osd.mil/asda/dpc/api/ipm/docs/20200312%20Contract%20Performance%20Dataset%20-%20FFS.pdf
- SPD File Format Specification: https://www.acq.osd.mil/asda/ae/ada/ipm/docs/20200312%20Schedule%20Performance%20Dataset%20-%20FFS.pdf
- 17 U.S.C. §105: https://www.law.cornell.edu/uscode/text/17/105
- Tensix free 881F CSV files: https://tensix.com/consulting-services/earned-value-services/wbs-guidelines-for-government-acquisition-programs/
- Costpoint project segment lengths: https://help.deltek.com/Product/Costpoint/8.2/GA/PJMSETNG_Project_Segment_Lengths_Tab.html
- Costpoint mass add and replicate: https://help.deltek.com/product/costpoint/8.1/ga/pjx_Mass_Add-Replicate_Capabilites.html
- SAP, WBS elements in the project hierarchy: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/4dd8cb7b1c484b4b93af84d00f60fdb8/2a73bb53707db44ce10000000a174cb4.html
- SAP KBA 2162222: https://userapps.support.sap.com/sap/support/knowledge/en/2162222
- Oracle P6, add a WBS element: https://docs.oracle.com/cd/F88968_01/client_help/en_US/add_a_wbs_element.htm
- Microsoft, WBS codes in Project: https://support.microsoft.com/en-us/office/create-wbs-codes-in-project-desktop-bb6a61aa-debd-4e38-8c04-8e2c1ae3cbda
- Unanet project tasks: https://unanet.quantum-intl.com/unanet/docs/unanet_menu/project/project_tasks.htm
- Jama Connect for MIL-STD-881: https://www.jamasoftware.com/media/2025/04/jama-connect-for-MIL-STD-881-ds-1.pdf

**MSPDI, P6, Cobra, CSV**
- MSPDI Task element: https://learn.microsoft.com/en-us/office-project/xml-data-interchange/task-element?view=project-client-2016
- MSPDI PredecessorLink: https://learn.microsoft.com/en-us/office-project/xml-data-interchange/predecessorlink-element?view=project-client-2016
- MSPDI LinkLag: https://learn.microsoft.com/en-us/office-project/xml-data-interchange/linklag-element?view=project-client-2016
- MSPDI Project element: https://learn.microsoft.com/en-us/office-project/xml-data-interchange/project-element?view=project-client-2016
- MSPDI XSD 2007: https://schemas.microsoft.com/project/2007/mspdi_pj12.xsd
- How Project schedules tasks: https://support.microsoft.com/en-us/office/how-project-schedules-tasks-behind-the-scenes-df3431ab-8d8a-4047-afc6-a87b547dbac0
- Dates change on XML re-import: https://learn.microsoft.com/en-us/answers/questions/c0ae28a2-02be-4f73-8ab6-05f0b01e653d/dates-changing-just-after-saving-as-new-xml-and
- MPXJ MSPDI writer: https://github.com/joniles/mpxj/blob/master/src/main/java/org/mpxj/mspdi/MSPDIWriter.java
- MPXJ DatatypeConverter: https://github.com/joniles/mpxj/blob/master/src/main/java/org/mpxj/mspdi/DatatypeConverter.java
- P6 import of a Microsoft Project file: https://docs.oracle.com/cd/F88968_01/English/admin/p6_pro_importing_exporting/import_a_microsoft_project_file.htm
- P6 MSP data map: https://docs.oracle.com/cd/G18294_01/English/Mapping_and_Schema/ms_project_import_export_data_map_xml/ms_project_import_export_data_map_xml.pdf
- Cobra, importing from Microsoft Project: https://help.deltek.com/product/cobra/8.4/ga/Options%20for%20Importing%20from%20Microsoft%20Project.html
- Cobra, identifying the link: https://help.deltek.com/product/cobra/8.5/ga/Identifying%20the%20Link.html
- Acumen and Microsoft Project: https://help.deltek.com/product/Acumen/7.0/GA/Microsoft%20Project.html
- Jira CSV import: https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/
- Costpoint input files: https://help.deltek.com/product/Costpoint/8.1/GA/PJPPREP_Input_File_Information.html
- Unanet task import: https://unanet.quantum-intl.com/unanet/docs/unanet_menu/admin/import/import_tasks.htm
- UFGS 01 32 01.00 10: https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com/FFC/DOD/UFGS/UFGS%2001%2032%2001.00%2010.pdf

**Progress payments and PBP**
- FAR 32.501-1: https://www.acquisition.gov/far/32.501-1
- FAR Subpart 32.5: https://www.acquisition.gov/far/subpart-32.5
- FAR 52.232-16: https://www.acquisition.gov/far/52.232-16
- FAR Subpart 32.10: https://www.acquisition.gov/far/subpart-32.10
- FAR 52.232-32: https://www.acquisition.gov/far/52.232-32
- FAR 31.201-6: https://www.acquisition.gov/far/31.201-6
- DFARS 232.501-1: https://www.acquisition.gov/dfars/232.501-1-customary-progress-payment-rates.
- DFARS 252.232-7004: https://www.acquisition.gov/dfars/252.232-7004-dod-progress-payment-rates.
- PGI 204.7108: https://www.acquisition.gov/dfarspgi/pgi-204.7108-payment-instructions.
- Class deviation 2020-O0010 Rev 2: https://www.acquisition.gov/sites/default/files/caac/deviation/USA000983-23-DPC.pdf
- 2026-O0022 memo: https://www.acq.osd.mil/dpap/dars/classdev/DFARS_RFO/Part-232/2026-O0022_TAB_A_Deviation_Memo_DFARS_232.pdf
- DoD PBP Guide: https://www.acq.osd.mil/asda/dpc/pcf/docs/resources-training/Performance_Based_Payment_(PBP)_Guide.pdf
- SF 1443 (REV. 10/2023): https://www.gsa.gov/system/files/2024-08/SF1443-23b.pdf
- WAWF PPR guide: https://pieetraining.eb.mil/wbt/wawf/documents/PPR.pdf
- WAWF PBP guide: https://pieetraining.eb.mil/wbt/wawf/documents/PBP.pdf
- EDI 810P Appendix E: https://piee.eb.mil/cms/docs/EDI/EDIGuide-AppendixE(810P_ProgressPay_4010).pdf
- DFAS Contractor and Vendor Payment Information Guidebook: https://www.acqnotes.com/Attachments/Contractor%20and%20Vendor%20Payment%20Information%20Guidebook.pdf
- Costpoint billing setup and GL entries: https://help.deltek.com/Product/Costpoint/7.1.1/GA/blx_Costpoint_Billing.html
- Costpoint Calculate Progress Payment Bills: https://help.deltek.com/Product/Costpoint/8.2/GA/BLPPROGP.html
- Costpoint Manage Progress Payment Bills: https://help.deltek.com/Product/Costpoint/8.2/GA/BLMPROGP.html
- Costpoint 1443 Info tab: https://help.deltek.com/Product/Costpoint/8.2/GA/BLMINFO_1443_Info_Tab.html
- Costpoint delivery invoices: https://help.deltek.com/product/costpoint/8.1/ga/blx_Delivery_Invoices.html
- Costpoint liquidation: https://help.deltek.com/product/costpoint/8.1/ga/blx_Liquidation.html
- PeopleSoft progress payment amounts: https://docs.oracle.com/en/applications/peoplesoft/financials-and-supply-chain-management/9.2.056/peoplesoft-contracts-for-government-contracting/understanding-progress-payment-amounts.html
- Infor LN progress payment requests: https://docs.infor.com/ln/10.4/en-us/lnolh/help/tp/onlinemanual/000415.html
- SAP down payment requests: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/3cb1182b4a184bdd93f8d62e3f1f0741/0627d253913e4608e10000000a174cb4.html
- RTX 2021 10-K: https://www.sec.gov/Archives/edgar/data/101829/000010182922000005/rtx-20211231.htm
- Northrop 2021 10-K note: https://www.sec.gov/Archives/edgar/data/1133421/000113342122000004/R13.htm
