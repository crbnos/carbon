# Demo-data datasets — current coverage inventory (research, 2026-09-22)

Source: Explore agent over `packages/database/src/datasets/` (types + 12 tiers + 4 data packs) on main.

## Architecture recap
`Dataset` (`types.ts:786-802`) = 11 pure-data slices + key/label/industryId. Engine = `tiers/01…12`, one transaction via `applyDataset` (`index.ts:80-92`) with `app.sync_in_progress` set — async event dispatch suppressed but **sync DB interceptors still run** (that's where itemCost, itemPlanning, jobMakeMethod, reserved trackedEntity, posting groups come from). Keys: satellite | robotics | precision | motor.

## Tables written per tier (complete)
- **01 foundation**: department, shift (HQ loc), process (+UPDATE requiresAbility), ability, itemPostingGroup, location (Plant), employeeJob UPDATE (moves employees to Plant), warehouse, storageType, storageUnit (shelves + per-WC floor units), workCenter, workCenterProcess, customerType, supplierType, shippingMethod (carrier from name prefix), shippingTerm, customer (currency hardcoded USD), customerPayment/customerShipping UPDATE (Net-30 via ILIKE), contact, address, customerLocation ("Billing"), customerContact, supplier (+contractor agency), supplierPayment/supplierShipping UPDATE, supplierLocation, supplierContact, supplierProcess (leadTime hardcoded 5), contractor (40h hardcoded), contractorAbility, printerRoute, procedure, procedureStep, costCenter, noQuoteReason.
- **02 items** (helpers/items.ts): item (createItem), itemCost (assert+UPDATE), itemUnitSalePrice UPDATE, itemReplenishment UPDATE (leadTime), part/material/tool/consumable/service/fixture (approved:true), methodMaterial (addBomLine), methodOperation (addBopOperation), supplierPart (MOQ 1), supplierPartPrice (single break, Manual Entry). makeMethod left **Draft** deliberately (helpers/items.ts:110-112). Interceptors create itemCost/itemReplenishment/itemUnitSalePrice/itemPlanning/makeMethod.
- **03 inventory**: itemLedger (Positive Adjmt. "Opening balance" — the ONLY ledger writes), trackedEntity (Available), kanban (Buy + autoRelease only), inventoryCount (Draft), inventoryCountLine (first 6 opening-stock rows only).
- **04 sales**: companySettings upsert (digitalQuote on), opportunity, salesRfq(+lines, uom "EA"), quote (+quotePayment/quoteShipment), quoteLine (always Part + Make to Order), quoteLinePrice, externalLink (Quote) + quote UPDATE, salesOrder(+payment/shipment), salesOrderLine (Part, Make to Order), shipment (Draft only — posting needs edge fn, :234), shipmentLine, salesInvoice (+salesInvoiceShipment required by view INNER JOIN), salesInvoiceLine. Order: opportunities → statusOrders → releasedOrders (readable-id sequence).
- **05 purchasing**: supplierInteraction, purchaseOrder (direct + winningQuote), purchaseOrderDelivery/Payment, purchaseOrderLine, receipt (Draft, 0 received), receiptLine (requiresBatchTracking), purchaseInvoice(+delivery, lines, Draft), purchasingRfq(+lines, suppliers), supplierQuote (status hardcoded **Active**, :183) + externalLink, supplierQuoteLine(+prices per break), purchasingRfqToSupplierQuote / ToPurchaseOrder. Quote date offsets hardcoded (−16/+140).
- **06 production**: modelUpload (Success, bundled glb), assemblyInstruction (**Draft** hardcoded), assemblyInstructionStep, item UPDATE (modelUploadId), job (deadlineType always Hard Deadline, scrapQuantity 0), jobOperation/jobOperationStep/jobMaterial/jobMakeMethod-adopt (helpers/job-method.ts — "no configuration rules, no supersession redirect, no tool or parameter copy"), trackedEntity rename, productionEvent (first 2 root ops of eventsJobKey only, postedToGL:false), productionQuantity (Production, qty 1), genealogy trackedEntity/trackedActivity/Input/Output. `operationStatusFor` (:63-78): Draft/Planned→Todo, Completed/Closed→Done, Cancelled→Canceled, Paused→Paused, else→Ready — **In Progress / Waiting op statuses unreachable**.
- **07 quality**: nonConformance (type = FIRST nonConformanceType found — not authorable), nonConformanceJobOperation, nonConformanceItem. Nothing else.
- **08 change-orders**: changeOrder, makeMethod (Version clone via cloneMethodRows), methodOperation/methodMaterial clones, item (Revision path new revision, New Part path), item/makeMethod UPDATEs, methodMaterial DELETE/UPDATE/insert (bomEdits), methodOperation UPDATE (description/laborTime only), changeOrderAffectedItem (supersessionMode lands HERE — no live itemSupersession row). Operation children (steps/params/tools) not copied (:52-53).
- **09 accounting**: journal + journalLine (skipped entirely on re-seed — journal is in wipe PRESERVED_TABLES; account by class Asset/Revenue via companyGroupId), fixedAsset (class by name, fallback first), depreciationRun (Draft, previousMonthEnd), depreciationRunLine. taxAmount deliberately NULL.
- **10 ops**: **EMPTY placeholder** (:5-7) — intended future scope per comment: maintenance, table views, custom fields, approvals. No `ops` slice exists in Dataset.
- **11 workflows**: workflow, workflowVersion (always v1), workflow UPDATE publishedVersionId (published only), workflowTriggerEvent, eventSystemSubscription (delete+insert). **No workflowRun/workflowStepRun** — Runs page empty.
- **12 planning**: itemPlanning UPDATEs (Buy 5/10, Make 3/5, policy forced Fixed Reorder Quantity; silent skip on missing ref), opportunity+salesOrder(+payment/shipment/lines — methodType authorable here), period (48 weekly, global table, advisory lock 4820260813), demandProjection (insertMaybe).

## Slice expressiveness limits (engine ceilings)
- customer/supplier currency hardcoded USD; one Net-30 payment term for all; supplierProcess.leadTime=5; contractor 40h; shifts at HQ not Plant.
- Procedure step types authorable: Task/Checkbox/Measurement/Value/List/Person (of 9 in app — no File/Inspection).
- Shipment/receipt/invoice/count: **Draft only reachable** (posting = edge functions; seed is one SQL transaction — architectural boundary, tiers/04-sales.ts:234, 03-inventory.ts:66).
- supplierQuote status + NCR type not authorable (hardcoded/first-row).
- inventoryCount lines not authorable (first 6 opening-stock rows).
- Quality slice = NCR header + 2 association types only. No CAPA/tasks/inspections.
- Fixed asset status union Draft|Active|Fully Depreciated (no Disposed); journal lines only Asset|Revenue classes; journal Draft|Posted.
- planning: exactly one demandOrder; kanban always Buy.

## Robotics actual states used (representative; 4 datasets near-identical by volume contract)
- Row counts (baseline): location 2, process 9, workCenter 7, customer 4, supplier 8, item 34, makeMethod 27, methodMaterial 51, itemLedger 19, opportunity 11, salesRfq 2, quote 3, salesOrder 10, shipment 1, salesInvoice 1, supplierInteraction 6, purchasingRfq 1, supplierQuote 3, purchaseOrder 4, receipt 1, purchaseInvoice 1, job 8, jobOperation 81, nonConformance 2, changeOrder 3, fixedAsset 4, workflow 7.
- salesRfq: Quoted, Ready for Quote (no Draft/Closed). Quotes: Ordered×2, Sent×1 (**no Draft/Expired/Lost/Partial/Cancelled**); all quote lines Complete. SO: In Progress, Confirmed×2, Draft, Completed, Closed, Cancelled, To Ship and Invoice, To Ship (**no Needs Approval/Invoiced/To Invoice**). 1 shipment Draft 0-shipped; 1 sales invoice Draft.
- PO: To Receive, To Invoice, Draft, To Receive and Invoice (**no Planned/Closed/Rejected/Needs Approval/Completed/To Review**); 1 receipt Draft 0-received; 1 purchase invoice Draft; supplier quotes all Active.
- Jobs: all 8 seedable statuses ✓ (Draft, Ready, In Progress, Paused, Planned, Completed, Closed, Cancelled). Op statuses: Todo/Ready/Paused/Done/Canceled (no In Progress/Waiting). Events: 6 rows on 2 ops of one job; quantities: 2×Production. **No scrap/rework, no batches.**
- Genealogy: 1 serial + 6 consumed inputs; tracked entities all Available (or Consumed via genealogy).
- Inventory: 19 opening rows, 3 kanbans, 1 Draft count. **No transfers, no picking, no posted count.**
- Quality: 2 NCRs (In Progress, Registered). No Closed; no inspections; no gauges; no risks; no quality documents.
- Change orders: Draft/Version, Implementation/Revision (Consume First supersession on affected item), Done/New Part ✓ (no Start/Engineering Complete/Cancelled).
- Accounting: FA Active×2/Draft/Fully Depreciated; 1 Draft depreciation run; 1 Draft journal. **No posted anything, no periods, no dimensions, no exchange rates, no payments/memos.**
- Workflows: 1 published + 6 drafts; zero runs.
- Planning: 11 items policied, 3 demand projections, 1 To Ship order.

## Never-touched tables (by module)
- **Returns/RMA**: salesReturnOrder(+line/credit/tracked), purchaseReturnOrder(+…), returnReason.
- **Inspection/quality execution**: inboundInspection(+Feature/History/Measurement/Sample), inspectionDocument, inspectionFeature, itemInspectionDocumentAssignment, itemSamplingPlan, balloon, qualityDocument(+Step).
- **NCR depth**: nonConformanceActionTask/ActionProcess/ApprovalTask/InvestigationTask/InvestigationType/Reviewer/Workflow/Customer/Supplier/TrackedEntity/ItemTrackedEntity/ReceiptLine/ShipmentLine/SalesOrderLine/PurchaseOrderLine/SalesReturnOrderLine/PurchaseReturnOrderLine/InboundInspection.
- **Picking/fulfillment**: pickingList(+line/lineTrackedEntity), pickMethod, fulfillment, deliveryTracking.
- **Quote methods**: quoteMakeMethod (bare interceptor row only), quoteMaterial(+Step), quoteOperation(+Attribute/Parameter/Tool/ToolStep/StepSlide/WorkInstruction) — quote lines have no costed method.
- **Job op depth**: jobOperationTool/ToolStep/Parameter/Attribute/AttributeRecord/Dependency/Note/Batch/StepSlide, jobMaterialStep, jobMaterialTracking, jobProductionTracking.
- **Method depth**: methodOperationTool/ToolStep/Parameter/Attribute/StepSlide/WorkInstruction, methodMaterialStep, buyMethod, procedureParameter.
- **Accounting**: accountingPeriod(+Balance), periodCloseTask, costLedger, supplierLedger, journalLineDimension, dimension(+Value), memo, accountingSyncOperation/TieOut, intercompany*, cardTransaction(+Line), exchangeRate(+History/Override), documentTransaction, purchaseOrderTransaction, salesOrderTransaction. (postingGroup* interceptor-created only.)
- **Traceability**: batchNumber, batchProperty, serialNumber, itemSerialSequence, itemTracking, itemShelfLife, itemInventory, itemStockQuantities.
- **Item config/rules/supersession**: configurationParameter(+Group), configurationRule, itemRule(+Assignment), **itemSupersession**, changeOrderSupersession, customerPartToItem, customerItemPriceOverride(+Break), pricingRule.
- **Material taxonomy**: materialType/Form/Grade/Finish/Substance/Dimension — seeded materials are unclassified.
- **People/HR**: employeeAbility, employeeShift, crew(+Ability), peopleAssignment, peopleAbsence, holiday, timeCardEntry, training(+Assignment/Completion/Question), lessonCompletion. (Shifts/abilities/contractors exist but NO employee linked to any.)
- **Equipment**: equipment(+Type), workCell(+Type), workCenterShift, workCenterReplacementPart, capacityReservation.
- **Maintenance**: maintenanceSchedule(+Item), maintenanceDispatch(+5 children). maintenanceFailureMode bootstrap-only.
- **Gauges**: gauge, gaugeCalibrationRecord (gaugeType bootstrap-preserved).
- **Risk**: riskRegister.
- **Docs/collab**: document*, note, task, project, tag, suggestion, feedback, notification*, reportView/Pin, every *Favorite (job/quote/salesOrder/purchaseOrder/salesRfq/purchasingRfq/supplierQuote).
- **Status history**: salesOrderStatusHistory, purchaseOrderStatusHistory, purchaseInvoiceStatusHistory.
- **Rules/approvals/enterprise**: approvalRule, approvalRequest, enforcementRule(+assignments/ack), itarCertification, sso*, passkeyCredential, userAttribute*, partner.
- **Integrations/infra** (mostly developer-owned, wipe-preserved): webhook(+Table), apiKey, oauth*, integration, companyIntegration, externalIntegrationMapping, slackDocumentThread, printJob, agent*, implementation*.
- **Workflow observability**: workflowRun, workflowStepRun.
- **Assembly depth**: assemblyComponentMapping, assemblyInstructionStepMaterial/Requirement/Slide/Tool, assemblyPlanJob, assemblyStandardNote, assemblyUnit.
- **Forecast**: demandForecast(+Source), demandActual, supplyForecast, supplyActual (last four wiped as transient by wipe.ts:66-71 — MRP recomputes).
- **FA depth**: fixedAssetDisposal, fixedAssetUsageLog, receiptFixedAssetLine, shipmentFixedAssetLine.

## Structural observations
1. Tier 10 is a no-op placeholder; no `ops` slice exists.
2. **No posted document anywhere** — architectural (edge functions can't run inside the seed transaction). Largest coverage boundary.
3. **No partial states** (partial receipt/shipment/payment/issue) — everything 0-or-all.
4. journal/journalLine PRESERVED by dataset wipe → tier 9 skips on every re-seed.
5. Volume contract: all four industries must roughly match (rule doc "Adding an industry"); baselines in .ai/runs/2026-08-13-*-baseline.txt; structural sums file for satellite (methodMaterial|51|258.375; methodOperation|33|263.75|0|0; salesOrderLine|13|112; quoteLinePrice|8).
