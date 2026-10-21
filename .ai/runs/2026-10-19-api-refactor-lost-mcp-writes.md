Context: a customer (Black Cat Labs) could no longer set work instructions or
assignees through MCP after the API refactor (#1937, 2026-10-17). The old
generated tools passed their arguments straight to the table, so any column
was writable whether the tool declared it or not; the new service functions
declare their fields, and a strict input drops the rest. Fixed in the same
change: `shared_assignRecord` (assignee, 33 tables),
`production_setJobOperationWorkInstruction`,
`items_setMethodOperationWorkInstruction`,
`sales_setQuoteOperationWorkInstruction`, and MCP `call_tool` now refuses an
argument a strict input would drop.

This list is for review, not a to-do list. Many columns below are maintained
by the system (posting, quantities, scheduling, conversions) and losing direct
writes to them is correct. Matching is by tool name, so a tool named
differently from its table shows as missing.

# Write ability the API refactor (#1937) may have removed from MCP

Method: for each of the 113 pre-refactor tools that passed their arguments straight to a table (generic upsert), take that table's writable columns (generated Update type, minus id/company/audit columns) and look for a current write tool for the same entity (tool name contains the table or the old tool's entity) whose input declares the column. `assignee` counts as covered when shared_assignRecord accepts the table.

## Definitely lost: 26 tables
Every current tool for the entity has a strict input that drops these columns (or there is no tool). An MCP call naming them is now refused with an error.

- **currency** (was accounting_upsertCurrency; now accounting_updateCurrency): active, tags
- **documentSection** (was settings_upsertDocumentSection; now no write tool): config, content, name, placement
- **itemPlanning** (was items_upsertItemPlanning; now items_updateItemPlanning): critical, demandAccumulationIncludesInventory, minimumReserveQuantity, tags
- **itemReplenishment** (was items_upsertPart; now items_createPart, items_updatePart): conversionFactor, itemId, leadTime, manufacturingBlocked, preferredSupplierId, purchasingBlocked, purchasingUnitOfMeasureCode, requiresConfiguration, scrapPercentage, tags
- **jobMaterial** (was production_upsertJobMaterial; now production_createJobMaterial, production_updateJobMaterial): defaultStorageUnit, estimatedQuantity, itemScrapPercentage, quantityIssued, quantityToIssue, scrapQuantity, substitutedFromItemId, substitutionFactor
- **jobOperation** (was production_upsertJobOperation; now production_createJobOperation, production_updateJobOperation): conflictReason, hasConflict, jobOperationBatchId, manuallyScheduled, operationQuantity, priority, projectedCompletionAt, quantityComplete, quantityReworked, quantityScrapped, readyAt, reworkId, startDate, tags, targetQuantity
- **location** (was resources_upsertLocation; now resources_createLocation, resources_updateLocation): requiresStaffing, responsibleEmployee, tags
- **part** (was items_upsertPart; now items_createPart, items_updatePart): approved, approvedBy, fromDate, tags, toDate
- **process** (was resources_upsertProcess; now resources_createProcess, resources_updateProcess): active, batchRules, tags
- **productionEvent** (was production_upsertProductionEvent; now production_createProductionEvent, production_updateProductionEvent): duration, jobOperationBatchId, postedToGL
- **productionQuantity** (was production_upsertProductionQuantity; now production_createProductionQuantity): inspectionId, inspectionSampleId, laborProductionEventId, machineProductionEventId, setupProductionEventId
- **purchaseReturnOrderLine** (was purchasing_upsertPurchaseReturnOrderLine; now no write tool): closedComplete, customFields, itemId, lineNumber, purchaseInvoiceLineId, purchaseOrderLineId, purchaseReturnOrderId, quantity, quantityShipped, receiptLineId, restockFeePercent, returnReasonId, unitOfMeasureCode, unitPrice
- **quoteLine** (was sales_upsertQuoteLine; now sales_createQuoteLine, sales_updateQuoteLine): additionalCharges, locationId, priceTrace, pricingRuleId, quoteRevisionId, sortOrder, tags, unitPricePrecision
- **quoteMaterial** (was sales_upsertQuoteMaterial; now sales_createQuoteMaterial, sales_updateQuoteMaterial): productionQuantity, scrapQuantity, tags
- **quoteOperation** (was sales_upsertQuoteOperation; now sales_createQuoteOperation, sales_updateQuoteOperation): tags
- **receipt** (was inventory_upsertReceipt; now inventory_createReceipt, inventory_updateReceipt): internalNotes, invoiced, postedBy, postingDate, status, supplierInteractionId, tags
- **salesInvoiceLine** (was invoicing_upsertSalesInvoiceLine; now invoicing_createSalesInvoiceLine, invoicing_updateSalesInvoiceLine): convertedAddOnCost, convertedNetUnitPrice, convertedNonTaxableAddOnCost, convertedSetupPrice, convertedShippingCost, convertedUnitPrice, customerContractId, customerContractInvoiceLineId, customerContractLineId, externalNotes, internalNotes, modelUploadId, netUnitPrice, opportunityId, projectId, rentalAgreementChargeId, rentalAgreementId, rentalAgreementLineId, rentalBillingPeriodId, salesOrderId, salesOrderLineId, setupPrice, sortOrder
- **salesOrderLine** (was sales_upsertSalesOrderLine; now sales_createSalesOrderLine, sales_updateSalesOrderLine): convertedAddOnCost, convertedNonTaxableAddOnCost, convertedShippingCost, convertedUnitPrice, externalNotes, internalNotes, invoicedComplete, pricingRuleId, quantityInvoiced, quantitySent, quantityToInvoice, quantityToSend, sentComplete, sentDate, sortOrder, status
- **salesReturnOrderLine** (was sales_upsertSalesReturnOrderLine; now no write tool): closedComplete, customFields, itemId, lineNumber, quantity, quantityReceived, restockFeePercent, returnReasonId, salesInvoiceLineId, salesOrderLineId, salesReturnOrderId, shipmentLineId, unitOfMeasureCode, unitPrice
- **shift** (was people_upsertShift; now people_createShift, people_updateShift): active, tags
- **shipment** (was inventory_upsertShipment; now inventory_createShipment, inventory_updateShipment): externalDocumentId, externalNotes, internalNotes, invoiced, opportunityId, postedBy, postingDate, status, supplierId, supplierInteractionId, tags
- **stockTransferLine** (was inventory_upsertStockTransferLine; now inventory_createStockTransferLine, inventory_updateStockTransferLine): jobId, jobMaterialId, outstandingQuantity, pickedQuantity, trackedEntityId
- **supplierPart** (was items_upsertSupplierPart; now items_createSupplierPart, items_updateSupplierPart): active, tags
- **workCenter** (was resources_upsertWorkCenter; now resources_createWorkCenter, resources_updateWorkCenter): active, requiredAbilityId, tags
- **workCenterProcess** (was resources_upsertProcess, resources_upsertWorkCenter; now resources_createProcess, resources_updateProcess): processId, workCenterId
- **workCenterShift** (was resources_upsertWorkCenter; now resources_createWorkCenter, resources_updateWorkCenter): shiftId, workCenterId

## Needs a code check: 65 tables
A current tool for the entity takes an opaque `data` object or keeps unknown keys, so whether it still writes these columns depends on its code.

- **account** (was accounting_upsertAccount; loose: accounting_createAccount, accounting_updateAccount): active, isSystem, tags
- **consumable** (was items_upsertConsumable; loose: items_createConsumable, items_updateConsumable): approved, approvedBy, tags
- **contractor** (was resources_upsertContractor; loose: resources_createContractor, resources_updateContractor): active, tags
- **contractorAbility** (was resources_upsertContractor; loose: resources_createContractor, resources_updateContractor): abilityId, contractorId
- **customer** (was sales_upsertCustomer; loose: sales_createCustomer, sales_updateCustomer): defaultCc, embedding, fax, intercompanyCompanyId, logo, phone, tags
- **customerContractLine** (was sales_upsertContractLine; loose: sales_createContractLine, sales_updateContractLine): amendmentId, amendsLineId, customFields, salesOrderLineId, sortOrder
- **customerStatus** (was sales_upsertCustomerStatus; loose: sales_createCustomerStatus, sales_updateCustomerStatus): tags
- **customerType** (was sales_upsertCustomerType; loose: sales_createCustomerType, sales_updateCustomerType): protected, tags
- **department** (was people_upsertDepartment; loose: people_createDepartment, people_updateDepartment): tags
- **dimensionValue** (was accounting_upsertDimension; loose: accounting_createDimension, accounting_updateDimension): dimensionId
- **document** (was documents_upsertDocument; loose: documents_createDocument, documents_updateDocument): active, type
- **fixedAssetClass** (was accounting_upsertFixedAssetClass; loose: accounting_createFixedAssetClass, accounting_updateFixedAssetClass): accumulatedDepreciationAccountId, assetAccountId, bonusDepreciationPercent, customFields, depreciationExpenseAccountId, depreciationMethod, description, gainOnDisposalAccountId, isConstructionInProgress, lossOnDisposalAccountId, name, residualValuePercent, taxResidualValuePercent, taxUsefulLifeMonths, usefulLifeMonths, writeDownAccountId, writeOffAccountId
- **gauge** (was quality_upsertGaugeCalibrationRecord; loose: quality_insertGauge, quality_updateGauge, quality_createGaugeCalibrationRecord, quality_updateGaugeCalibrationRecord): gaugeStatus, lastCalibrationStatus
- **holiday** (was people_upsertHoliday; loose: people_createHoliday, people_updateHoliday): tags, year
- **item** (was items_upsertConsumable, items_upsertMaterial, items_upsertPart, items_upsertService, items_upsertTool; loose: items_createConsumable, items_updateConsumable, items_updateItem): changeOrderId, embedding, modelUploadId, notes, readableIdWithRevision, revision, revisionStatus, sourcingType, thumbnailPath, trackingMethod
- **itemCost** (was items_upsertConsumable, items_upsertMaterial, items_upsertPart, items_upsertService, items_upsertTool; loose: items_updateItemCost, items_createConsumable, items_updateConsumable, items_upsertItemCost): costIsAdjusted, standardCost, tags
- **itemPostingGroup** (was items_upsertItemPostingGroup; loose: items_createItemPostingGroup, items_updateItemPostingGroup): active, tags
- **job** (was production_upsertJob; loose: production_insertJob): actualTime, completedDate, estimatedTime, productionQuantity, projectedCompletionAt, quantityComplete, quantityReceivedToInventory, quantityShipped, releasedDate, scheduleOutdatedAt, scheduleOutdatedReason, secondsToComplete, tags
- **jobOperationStep** (was production_upsertJobOperationStep; loose: production_createJobOperationStep, production_updateJobOperationStep): assemblyInstructionStepId, fileTypes, nonConformanceActionId, nonConformanceInvestigationId, required
- **kanban** (was inventory_upsertKanban; loose: inventory_createKanban, inventory_updateKanban): jobId
- **maintenanceDispatchEvent** (was production_upsertMaintenanceDispatchEvent, resources_upsertMaintenanceDispatchEvent; loose: production_createMaintenanceDispatchEvent, production_updateMaintenanceDispatchEvent): duration
- **maintenanceDispatchItem** (was production_upsertMaintenanceDispatchItem, resources_upsertMaintenanceDispatchItem; loose: production_createMaintenanceDispatchItem, production_updateMaintenanceDispatchItem, resources_updateMaintenanceDispatchItem): totalCost
- **maintenanceSchedule** (was production_upsertMaintenanceSchedule, resources_upsertMaintenanceSchedule; loose: production_createMaintenanceSchedule, production_updateMaintenanceSchedule): lastGeneratedAt
- **material** (was items_upsertMaterial; loose: items_createMaterial, items_updateMaterial): approved, approvedBy, tags
- **materialForm** (was items_upsertMaterialForm; loose: items_createMaterialForm, items_updateMaterialForm): tags
- **materialSubstance** (was items_upsertMaterialSubstance; loose: items_createMaterialSubstance, items_updateMaterialSubstance): tags
- **memo** (was invoicing_upsertMemo; loose: invoicing_createMemo, invoicing_updateMemo): customerContractId, journalId, postedAt, postedBy, postingDate, purchaseReturnOrderId, reasonAccount, rentalAgreementId, salesReturnOrderId, status, voidedAt, voidedBy
- **methodMaterial** (was items_upsertMethodMaterial; loose: items_createMethodMaterial, items_updateMethodMaterial): materialMakeMethodId, productionQuantity, scrapQuantity, tags
- **methodOperation** (was items_upsertMethodOperation; loose: items_createMethodOperation, items_updateMethodOperation): tags
- **methodOperationStep** (was items_upsertMethodOperationStep; loose: items_createMethodOperationStep, items_updateMethodOperationStep): assemblyInstructionStepId, fileTypes, required
- **nonConformanceWorkflow** (was quality_upsertIssueWorkflow; loose: quality_createIssueWorkflow, quality_updateIssueWorkflow): active, description, tags
- **opportunity** (was sales_upsertQuote, sales_upsertSalesOrder, sales_upsertSalesRFQ; loose: sales_insertQuote): purchaseOrderDocumentPath, requestForQuoteDocumentPath
- **partner** (was resources_upsertPartner; loose: resources_createPartner, resources_updatePartner): abilityId, active, tags
- **payment** (was invoicing_upsertPayment; loose: invoicing_updatePayment): journalId, postedAt, postedBy, postingDate, status, voidedAt, voidedBy
- **paymentTerm** (was accounting_upsertPaymentTerm; loose: accounting_createPaymentTerm, accounting_updatePaymentTerm): active, tags
- **procedure** (was production_upsertProcedure; loose: production_createProcedure, production_updateProcedure): description, status, tags
- **procedureStep** (was production_upsertProcedure, production_upsertProcedureStep; loose: production_createProcedure, production_updateProcedure, production_createProcedureStep, production_updateProcedureStep): fileTypes, required
- **project** (was accounting_upsertProject; loose: accounting_createProject, accounting_updateProject): active
- **purchaseInvoiceLine** (was invoicing_upsertPurchaseInvoiceLine; loose: invoicing_createPurchaseInvoiceLine, invoicing_updatePurchaseInvoiceLine): extendedPrice, internalNotes, jobOperationId, modelUploadId, ownerId, projectId, serviceId, shippingCost, sortOrder, supplierExtendedPrice, tags, taxAmount, totalAmount, unitPrice
- **purchaseOrder** (was purchasing_upsertPurchaseOrder; loose: purchasing_insertPurchaseOrder): closedAt, closedBy, createdFromPlanning, exchangeRate, exchangeRateUpdatedAt, internalNotes, jobId, jobReadableId, revisionId, supplierInteractionId, tags
- **purchaseOrderDelivery** (was purchasing_upsertPurchaseOrder; loose: purchasing_insertPurchaseOrder, purchasing_upsertPurchaseOrderDelivery): shippingTermId, tags
- **purchaseOrderLine** (was purchasing_upsertPurchaseOrderLine; loose: purchasing_createPurchaseOrderLine, purchasing_updatePurchaseOrderLine): extendedPrice, externalNotes, internalNotes, invoicedComplete, modelUploadId, ownerId, quantityInvoiced, quantityReceived, quantityShipped, quantityToInvoice, quantityToReceive, receivedComplete, receivedDate, setupPrice, shippingCost, sortOrder, supplierExtendedPrice, tags, taxAmount, unitPrice
- **purchaseOrderPayment** (was purchasing_upsertPurchaseOrder; loose: purchasing_insertPurchaseOrder, purchasing_upsertPurchaseOrderPayment): paymentComplete, tags
- **purchasingRfqLine** (was purchasing_upsertPurchasingRFQLine; loose: purchasing_createPurchasingRFQLine, purchasing_updatePurchasingRFQLine): externalNotes, internalNotes
- **qualityDocument** (was quality_upsertQualityDocument; loose: quality_createQualityDocument, quality_updateQualityDocument): description, status, tags
- **qualityDocumentStep** (was quality_upsertQualityDocument; loose: quality_createQualityDocument, quality_updateQualityDocument): description, fileTypes, listValues, maxValue, minValue, qualityDocumentId, required, sortOrder, type, unitOfMeasureCode
- **quote** (was sales_upsertQuote; loose: sales_insertQuote): completedDate, digitalQuoteRejectedBy, digitalQuoteRejectedByEmail, externalLinkId, externalNotes, internalNotes, revisionId, tags
- **quoteOperationStep** (was sales_upsertQuoteOperationStep; loose: sales_createQuoteOperationStep, sales_updateQuoteOperationStep): fileTypes, required
- **quoteShipment** (was sales_upsertQuote; loose: sales_insertQuote, sales_upsertQuoteShipment): shippingTermId
- **rentalAgreementCharge** (was sales_upsertRentalAgreementCharge; loose: sales_createRentalAgreementCharge, sales_updateRentalAgreementCharge): chargeType, salesInvoiceLineId, voidedSalesInvoiceId
- **rentalAgreementLine** (was sales_upsertRentalAgreementLine; loose: sales_createRentalAgreementLine, sales_updateRentalAgreementLine): classificationInputs, classificationOverride, classificationOverrideReason, commencementJournalId, deliveredAt, initialNetInvestment, itemId, meterIn, meterOut, quantity, returnNotes, returnedAt, sellingProfit, status, trackedEntityId
- **salesOrder** (was sales_upsertSalesOrder; loose: sales_insertSalesOrder): closedAt, closedBy, completedDate, externalNotes, internalNotes, revisionId, sentCompleteDate
- **salesOrderShipment** (was sales_upsertSalesOrder; loose: sales_insertSalesOrder, sales_upsertSalesOrderShipment): shippingTermId
- **salesRfq** (was sales_upsertSalesRFQ; loose: sales_createSalesRFQ, sales_updateSalesRFQ): completedDate, employeeId, noQuoteReasonId, opportunityId, revisionId, tags
- **salesRfqLine** (was sales_upsertSalesRFQLine; loose: sales_createSalesRFQLine, sales_updateSalesRFQLine): externalNotes, internalNotes, tags
- **service** (was items_upsertService; loose: items_createService, items_updateService): approved, approvedBy, fromDate, serviceType, tags, toDate
- **shippingMethod** (was inventory_upsertShippingMethod; loose: inventory_createShippingMethod, inventory_updateShippingMethod): active, tags
- **storageUnit** (was inventory_upsertStorageUnit; loose: inventory_createStorageUnit, inventory_updateStorageUnit): active, isWorkCenterDefault, tags
- **supplier** (was purchasing_upsertSupplier; loose: purchasing_createSupplier, purchasing_updateSupplier): defaultCc, embedding, fax, intercompanyCompanyId, logo, phone, tags, taxPercent
- **supplierProcess** (was purchasing_upsertSupplierProcess; loose: purchasing_createSupplierProcess, purchasing_updateSupplierProcess): tags
- **supplierQuoteLine** (was purchasing_upsertSupplierQuoteLine; loose: purchasing_createSupplierQuoteLine, purchasing_updateSupplierQuoteLine): externalNotes, internalNotes, ownerId, sortOrder, supplierPartRevision, supplierQuoteRevisionId, tags
- **supplierType** (was purchasing_upsertSupplierType; loose: purchasing_createSupplierType, purchasing_updateSupplierType): protected, tags
- **tool** (was items_upsertTool; loose: items_createTool): approved, approvedBy, tags
- **training** (was resources_upsertTraining; loose: resources_createTraining, resources_updateTraining): description, estimatedDuration, frequency, guidePath, processId, status, tags, type, version
- **unitOfMeasure** (was items_upsertUnitOfMeasure; loose: items_createUnitOfMeasure, items_updateUnitOfMeasure): active, tags
