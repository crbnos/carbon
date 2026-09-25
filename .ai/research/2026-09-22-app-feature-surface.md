# Carbon application feature surface — complete map (research, 2026-09-22)

Source: Explore agent over apps/erp + apps/mes on main. Purpose: the "what should demo data cover" side of the gap analysis. Enum values from `packages/database/src/types.ts` (Enums block, ~84773–85400); module registry `apps/erp/app/hooks/useModules.tsx`.

## 1. Sales (`modules/sales`, routes x+/sales+, sales-rfq+, quote+, sales-order+, sales-return-order+, customer+)
- Sales RFQ — `salesRfqStatus`: Draft, Ready for Quote, Closed, Quoted
- Quote — `quoteStatus`: Draft, Sent, Ordered, Partial, Lost, Cancelled, Expired; `quoteLineStatus`: Not Started, In Progress, Complete, No Quote
- Sales Order — `salesOrderStatus`: Draft, Needs Approval, Confirmed, In Progress, Completed, Invoiced, Cancelled, Closed, To Ship and Invoice, To Ship, To Invoice; line status: Ordered, In Progress, Completed; line types: Comment, Part, Material, Tool, Service, Consumable, Fixture, Fixed Asset
- Sales Return Order (RMA) — `salesReturnOrderStatus`: Draft, To Receive, Completed, Cancelled
- Customer tabs: details, contacts, locations, payments, shipping, tax, accounting, bank accounts, documents, risks; customerStatus/customerType are user-defined tables
- Customer Portals (x+/sales+/customer-portals.*), Price Lists / Pricing Rules (`pricingRuleType` Discount/Markup; amountType Percentage/Fixed), Sales Rules, No Quote Reasons, Return Reasons
- `sourcingType`: Specified, Drop Ship, Ship from Inventory; `fulfillmentType`: Inventory, Job
- Dashboard KPIs: quoteCount, rfqCount, salesFunnel, salesOrderCount, salesOrderRevenue

## 2. Purchasing (x+/purchasing+, purchasing-rfq+, supplier-quote+, purchase-order+, purchase-return-order+, supplier+)
- Purchasing RFQ — Draft, Requested, Closed
- Supplier Quote — Active, Expired, Draft, Declined, Cancelled
- Purchase Order — Draft, To Review, Rejected, To Receive, To Receive and Invoice, To Invoice, Completed, Closed, Planned, Needs Approval; `purchaseOrderType`: Purchase, Return, Outside Processing; line types incl. G/L Account, Fixed Asset
- Purchase Return Order — Draft, To Ship, Completed, Cancelled
- Supplier — `supplierStatusType`: Active, Inactive, Pending, Rejected; tabs incl. approval, processes, default-attachments, risks; supplier approval `approvalStatus`: Pending, Approved, Rejected, Cancelled over purchaseOrder/qualityDocument/supplier
- `supplierPartPriceSourceType`: Quote, Purchase Order, Manual Entry; supplier ledger doc types: Payment, Invoice, Credit Memo, Finance Charge Memo, Reminder, Refund
- Material Planning (x+/purchasing+/planning.tsx); KPIs: supplierQuoteCount, purchaseOrderCount, purchaseInvoiceCount, amounts

## 3. Production (x+/production+, job+, scheduling+, priority+, assembly+, procedure+, inspection-document+)
- Job — Draft, Ready, In Progress, Paused, Completed, Cancelled, Overdue, Due Today, Planned, Closed; `deadlineType`: No Deadline, ASAP, Soft Deadline, Hard Deadline
- Job Operation — Canceled, Done, In Progress, Paused, Ready, Todo, Waiting; `operationType`: Process, Assembly, Inspection, Outside Processing
- Operation Batch — `jobOperationBatchStatus`: Planned, Active, Completing, Completed; `batchType`: Sequential, Simultaneous
- Production Event — Setup, Labor, Machine; Production Quantity — Rework, Scrap, Production
- Make Method — Draft, Active, Archived; `methodType`: Purchase to Order, Pull from Inventory, Make to Order; op order After Previous/With Previous
- Assembly Instruction — Draft, Published, Archived; steps Todo/Review/Done
- Procedure — Draft, Active, Archived; step types: Value, Measurement, Checkbox, Timestamp, Person, List, File, Task, Inspection
- Inspection documents (usage: Receipt); Demand Forecasts (`demandForecastSourceType`: Job Material, Sales Order, Demand Projection); Scrap Reasons
- Scheduling: x+/scheduling+/forecast, x+/priority+ (dates, operations, people, batching); `capacityResourceKind`: WorkCenter, OperatorPool, Employee
- Job DAG, BoM explorer, Estimates vs Actuals; KPIs: utilization, estimatesVsActuals, completionTime
- `factor` rate enum: Hours/Piece … Total Minutes (11 values)

## 4. Inventory (x+/inventory+, receipt+, shipment+, stock-transfer+, warehouse-transfer+, picking-list+, inventory-count+, traceability+)
- Receipt — Draft, Pending, Posted, Voided; sources: Sales Order, Sales Invoice, Sales Return Order, Purchase Order, Purchase Invoice, Purchase Return Order, Inbound Transfer, Outbound Transfer, Manufacturing Consumption, Manufacturing Output
- Shipment — Draft, Pending, Posted, Voided; carriers UPS/FedEx/USPS/DHL/Other
- Stock Transfer — Draft, Released, In Progress, Completed
- Warehouse Transfer — Draft, To Ship and Receive, To Ship, To Receive, Completed, Cancelled
- Picking List — Draft, In Progress, Completed, Cancelled, Partial; lines Pending, Picked, Short, Cancelled; pick sort Default/FEFO/FIFO/LIFO
- Inventory Count — Draft, Pending, Posted
- Tracked Entity — Available, Reserved, On Hold, Consumed, Rejected, Scrapped; `trackingSource` Purchased/Manufactured
- Kanban — replenishment Buy/Make/Transfer; output label/qrcode/url
- Item Ledger — types incl. Assembly Consumption/Output; 28 doc types incl. Batch Split/Merge, Scrap, Non-Conformance, Inbound Inspection
- Shelf life modes; Supersession — Consume First, Prefer New, Stock Only, No Stock
- Storage Units/Types/Rules; Traceability graph; Quantities & valuation report

## 5. Items (x+/items+, part+, material+, tool+, consumable+, service+, change-notice+)
- `itemType`: Part, Material, Tool, Service, Consumable, Fixture
- Revision — Design, Prototype, Production, Obsolete; Tracking — Inventory, Non-Inventory, Serial, Batch
- Replenishment — Buy, Make, Buy and Make; reordering — Manual, Demand-Based, Fixed Reorder Quantity, Maximum Quantity
- Costing — Standard, Average, LIFO, FIFO
- Change Notice — `changeOrderStatus`: Draft, Start, Engineering Complete, Implementation, Done, Cancelled; tasks Pending/In Progress/Completed/Skipped; change types Version/Revision/Replacement Part/New Part; CN types Engineering/Manufacturing/Documentation (stage machine items.models.ts:1046-1140)
- Configuration params (text/numeric/boolean/list/date/material); serviceType Internal/External
- Item tabs: details, costing, inventory, planning, purchasing (supplier parts), quality, sales (customer parts), make method, parameters, rules
- Material properties: Dimensions, Finishes, Grades, Shapes, Substances, Types; Item Groups; UoM

## 6. Quality (x+/quality+, issue+, issue-workflow+, quality-document+, inspection+)
- Issue/NCR — Registered, In Progress, Closed; priority Low/Medium/High/Critical; source Internal/External; approval MRB; tasks Pending/In Progress/Completed/Skipped; action types Containment, Corrective, Preventive, Verification, Communication
- NCR associations: items, customers, suppliers, jobOperations, purchaseOrderLines, salesOrderLines, shipmentLines, receiptLines, salesReturnOrderLines, purchaseReturnOrderLines, trackedEntities, inspections
- Disposition (12 values incl. Quarantine, Rework, Use As Is, Return to Supplier/Customer)
- Inspection — Pending, In Progress, Passed, Failed, Partial; samples Pending/Passed/Failed; source Receipt / Job Operation
- Sampling — All/First/Percentage/AQL; ANSI_Z1_4 / ISO_2859_1; levels I–III, S1–S4; severity Normal/Tightened/Reduced
- Gauges — Active/Inactive, role Master/Standard; calibration Pending, In-Calibration, Out-of-Calibration
- Quality Document — Draft, Active, Archived
- Risk Register — Open, In Review, Mitigating, Closed, Accepted; type Risk/Opportunity; sources Customer, General, Item, Job, Quote Line, Supplier, Work Center
- Issue Workflows; configure: Action Types, Gauge Types, Issue Types
- KPIs: weeklyTracking, statusDistribution, paretoByType, ncrsByType, sourceAnalysis, supplierQuality, weeksOpen

## 7. Resources (x+/resources+, maintenance+, training+)
- Maintenance Dispatch — Open, Assigned, In Progress, Completed, Cancelled; priority L/M/H/Critical; severity Preventive, Operator Performed, Support Required, OEM Required; source Scheduled, Reactive, Non-Conformance; frequency Daily…Annual; failure modes Maintenance/Quality/Operations/Other; OEE impact Down/Planned/Impact/No Impact
- Work Centers (+ rules), Processes (activate/deactivate), Locations, Abilities (curve/shadow/recertify)
- Training — Draft, Active, Archived; Mandatory/Optional; Once/Quarterly/Annual; question types MultipleChoice, TrueFalse, MultipleAnswers, MatchingPairs, Numerical; assignments Completed, Pending, Overdue, Not Required
- Contractors, Partners, Suggestions
- Maintenance KPIs: mttr, mtbf, sparePartCost, worstPerformingMachines, sparePartConsumption

## 8. People (x+/people+, person+)
Employees, Person detail (details, job, abilities, attributes, notes, timecard), Timecards (periodType Week/Day/Month), Attributes + categories, Departments, Holidays, Shifts.

## 9. Invoicing (x+/invoicing+, sales-invoice+, purchase-invoice+, payments+, credits+)
- Sales Invoice — Draft, Pending, Submitted, Return, Credit Note Issued, Paid, Partially Paid, Overdue, Voided
- Purchase Invoice — Draft, Pending, Open, Return, Debit Note Issued, Paid, Partially Paid, Overdue, Voided
- Payment — Draft, Posted, Voided; type Receipt/Disbursement
- Credit/Debit Memo — Draft, Posted, Voided; direction Credit/Debit
- Card Transaction — Draft, Posted, Voided; Charge, Credit, Payment, Cashback, Repayment
- Payables/Receivables workbenches; invoicing dashboard

## 10. Accounting (x+/accounting+, journal-entry+, fixed-asset+, depreciation-run+, reports+)
- Journal Entry — Draft, Posted, Reversed; 26 source types; 24 line doc types
- Accounting Period — Inactive/Active; period close Open/Locked/Closed; close tasks Open/Done/Skipped (Auto/Action/Manual)
- Fixed Asset — Draft, Active, Fully Depreciated, Disposed; depreciation Straight Line/Declining Balance/Units of Production (+MACRS tax, conventions, property classes); disposal Sale/Scrapping
- CoA (`accountType` 22 values, classes, income/balance), cost ledger types, intercompany (Unmatched/Matched/Eliminated), dimensions (16 entity types), payment terms (Net/EOM/Day of Month), tax exemptions, incoterms
- Cost Centers, Default Accounts, Exchange Rates, Fiscal Years, Projects, Asset Classes, Sync Tie-Out
- Reports: Balance Sheet, Income Statement, Trial Balance, AP Aging, AR Aging, Executive P&L, Inventory Valuation (+reconcile), Purchases, saved views

## 11. Documents (x+/documents+)
All/My/Recent/Pinned/Trash; `documentType` 11 values; `documentSourceType` 23 values; comment threads (`documentthreadtype`): nonConformance, quote, salesOrder, job, purchaseOrder, invoice, receipt, shipment; AI extraction (purchaseInvoice/salesRfq).

## 12. Workflows (x+/workflows+, x+/workflow+)
List, canvas builder, publish/versions, test-run, runs + run detail.

## 13. Users (x+/users+)
Employees, Operators (PIN), Groups, Employee Types, permissions (17 modules), customer/supplier accounts (routes exist, nav commented); roles customer/employee/supplier; system types Admin, Console Operator.

## 14. Settings (x+/settings+, x+/templates+)
Billing, Company(-ies), Document Templates, Logos, Printing (+jobs); per-module settings; API Keys, Approval Rules, Audit Logs, Backups, Custom Fields, Demo Data, Integrations, ITAR, Security, Sequences, Serial Numbers, SSO, Tags, Webhooks.
- Enforcement rules family storage/sales; 13 surfaces
- Sync ops status enum; integrations: QuickBooks, Xero, Rillet, Ramp, Stripe, Slack, Jira, Linear, Onshape, Radan, Paperless Parts

## 15. Onboarding / Get Started
onboarding+ (company, industry, plan, theme, user); x+/get-started+ implementation hub (15 screens); implementationStatus/Tier/StateKind enums.

## 16. Account
Profile, Notifications, Security (MFA/passkeys), Theme.

## MES (apps/mes)
Nav: Schedule, Assigned, Active, Recent, Jobs, Maintenance, Picking (+ Displays, console pin).
Surfaces: operations queue; operation work screen (start/end/finish/pause); job detail; procedure steps (complete-all, inspection); timecard/end-shift; material issue/unconsume/adjustment; scrap & rework (+trigger-rework); batches; assembly work instructions; inspection lot (sample, measurement, disposition, complete-passed); quality-issue.new (NCR from floor); maintenance dispatches (+add-and-issue); picking (+tracked lines, suggested allocation); tracked entity convert; record production; label printing (PDF+ZPL); shop-floor TV displays (Scoreboard/QueueTable/ActiveWorkPanel per work center, work + maintenance); console PIN mode; suggestions; kanban board; 3D viewer (`modelProcessingStatus` Idle/Queued/Processing/Success/Failed).

## Cross-cutting a demo should exercise
- Dashboards & charts on every module landing (api+/*.kpi.$key.ts)
- Global search, document search, traceability search
- PDFs/previews/printing, document templates preview
- Notifications (topbar; SalesRuleViolation, ChangeNotice* events)
- Audit log (settings + api, packages/database/src/audit.ts)
- Approvals (approval rules; PO/qualityDocument/supplier)
- MRP & planning (api+/mrp.ts, production/purchasing planning, demand forecasts, scheduling forecast, priorities)
- Traceability lot/serial (graph, containment, expiry, unscrap, lineage.server)
- Fixed assets (register, purchase, sell, dispose, depreciation runs, asset classes; FA lines on receipts/shipments)
- Risk register (quality + customer/supplier/job tabs)
- Workflows (canvas, publish, runs)
- Portals/shares: share+/quote.$id (accept/reject), supplier-quote, purchasing-rfq, customer portal, scar.$id (supplier corrective action), training.$id, download.$token
- AI agent + KB; API keys/webhooks (not demo-data relevant)
- Imports, custom fields, saved views, tags, notes
- Multi-company/location, exchange rates, i18n

## End-to-end chains worth demoing
- Sales RFQ → Quote → SO → Job(s) → MES ops → Shipment → Sales Invoice → Payment
- Purchasing RFQ → Supplier Quote → PO → Receipt → Inbound Inspection → Purchase Invoice → Payment
