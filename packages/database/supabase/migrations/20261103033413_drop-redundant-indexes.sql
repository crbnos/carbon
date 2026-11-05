-- Drop non-unique btree indexes that another index on the same table covers:
-- the other index starts with the same columns in the same order.
--
-- Found with the catalog query in .ai/plans/2026-11-03-query-performance-sweep.md
-- (Task 3, step 1): 154 indexes, none a constraint's index.
-- Kept: 29 whose covering index is more than 3 times their size in production,
-- because a count or an index-only scan on the leading columns reads the
-- narrow index faster (Task 3, step 3). Dropped: 125.
--
-- Each dropped index costs a write on every insert and update of its table
-- and serves no query its covering index cannot.

SET lock_timeout = '5s';

DROP INDEX IF EXISTS "public"."account_number_idx"; -- covered by account_number_key on account
DROP INDEX IF EXISTS "public"."accountingCutoverIgnoredInvoice_companyId_idx"; -- covered by accountingCutoverIgnoredInvoice_companyId_invoiceId_key on accountingCutoverIgnoredInvoice
DROP INDEX IF EXISTS "public"."accountingPeriodBalance_accountId_idx"; -- covered by accountingPeriodBalance_account_period_key on accountingPeriodBalance
DROP INDEX IF EXISTS "public"."accountingPeriodBalance_companyId_idx"; -- covered by accountingPeriodBalance_companyId_date_idx on accountingPeriodBalance
DROP INDEX IF EXISTS "public"."accountingPeriod_companyId_idx"; -- covered by accountingPeriod_company_fy_period_idx on accountingPeriod
DROP INDEX IF EXISTS "public"."accountingSyncTieOut_companyId_idx"; -- covered by accountingSyncTieOut_cell_uq on accountingSyncTieOut
DROP INDEX IF EXISTS "public"."accountingSyncTieOut_period_idx"; -- covered by accountingSyncTieOut_cell_uq on accountingSyncTieOut
DROP INDEX IF EXISTS "public"."approvalRule_companyId_idx"; -- covered by approvalRule_name_idx on approvalRule
DROP INDEX IF EXISTS "public"."assemblyInstructionStepMaterial_stepId_idx"; -- covered by assemblyInstructionStepMaterial_stepId_itemId_key on assemblyInstructionStepMaterial
DROP INDEX IF EXISTS "public"."assemblyInstructionStepSlide_stepId_idx"; -- covered by assemblyInstructionStepSlide_stepId_sortOrder_idx on assemblyInstructionStepSlide
DROP INDEX IF EXISTS "public"."assemblyInstructionStepTool_stepId_idx"; -- covered by assemblyInstructionStepTool_stepId_itemId_key on assemblyInstructionStepTool
DROP INDEX IF EXISTS "public"."assemblyUnit_modelUploadId_idx"; -- covered by assemblyUnit_modelUploadId_sourceGroupId_key on assemblyUnit
DROP INDEX IF EXISTS "public"."balloon_inspectionDocumentId_idx"; -- covered by balloon_document_page_idx on balloon
DROP INDEX IF EXISTS "public"."buyMethod_itemId_idx"; -- covered by buyMethod_part_supplier_unique on supplierPart
DROP INDEX IF EXISTS "public"."changeOrderAffectedItem_changeOrderId_idx"; -- covered by changeOrderAffectedItem_changeOrderId_itemId_key on changeOrderAffectedItem
DROP INDEX IF EXISTS "public"."charge_companyId_idx"; -- covered by charge_companyId_status_idx on charge
DROP INDEX IF EXISTS "public"."configurationParameter_itemId_idx"; -- covered by configurationParameter_itemId_key_unique on configurationParameter
DROP INDEX IF EXISTS "public"."configurationRule_itemId_idx"; -- covered by configurationRule_pkey on configurationRule
DROP INDEX IF EXISTS "public"."customerContractInvoice_companyId_idx"; -- covered by customerContractInvoice_due_idx on customerContractInvoice
DROP INDEX IF EXISTS "public"."customerContract_companyId_idx"; -- covered by customerContract_companyId_status_idx on customerContract
DROP INDEX IF EXISTS "public"."customerItemPriceOverrideBreak_override_idx"; -- covered by customerItemPriceOverrideBreak_override_qty_uq on customerItemPriceOverrideBreak
DROP INDEX IF EXISTS "public"."customerPayment_customerId_idx"; -- covered by customerPayment_pkey on customerPayment
DROP INDEX IF EXISTS "public"."customerShipping_customerId_idx"; -- covered by customerShipping_pkey on customerShipping
DROP INDEX IF EXISTS "public"."customerTax_customerId_idx"; -- covered by customerTax_pkey on customerTax
DROP INDEX IF EXISTS "public"."demandActual_companyId_idx"; -- covered by demandActual_companyId_locationId_idx on demandActual
DROP INDEX IF EXISTS "public"."demandActual_itemId_locationId_periodId_idx"; -- covered by demandActual_pkey on demandActual
DROP INDEX IF EXISTS "public"."demandForecast_companyId_idx"; -- covered by demandForecast_companyId_locationId_idx on demandForecast
DROP INDEX IF EXISTS "public"."demandForecast_itemId_locationId_periodId_idx"; -- covered by demandForecast_pkey on demandForecast
DROP INDEX IF EXISTS "public"."dimensionValue_dimensionId_idx"; -- covered by dimensionValue_dimensionId_name_key on dimensionValue
DROP INDEX IF EXISTS "public"."documentFavorites_documentId_idx"; -- covered by documentFavorites_pkey on documentFavorite
DROP INDEX IF EXISTS "public"."documentLabels_documentId_idx"; -- covered by documentLabels_pkey on documentLabel
DROP INDEX IF EXISTS "public"."documentTemplate_companyId_idx"; -- covered by documentTemplate_companyId_documentType_key on documentTemplate
DROP INDEX IF EXISTS "public"."enforcementRuleItemAssignment_itemId_idx"; -- covered by enforcementRuleItemAssignment_pkey on enforcementRuleItemAssignment
DROP INDEX IF EXISTS "public"."enforcementRuleWorkCenterAssignment_workCenterId_idx"; -- covered by enforcementRuleWorkCenterAssignment_pkey on enforcementRuleWorkCenterAssignment
DROP INDEX IF EXISTS "public"."exchangeRateOverride_companyId_idx"; -- covered by exchangeRateOverride_company_code_key on exchangeRateOverride
DROP INDEX IF EXISTS "public"."exchangeRate_code_date_idx"; -- covered by exchangeRate_code_date_key on exchangeRate
DROP INDEX IF EXISTS "public"."externalIntegrationMapping_entity_idx"; -- covered by externalIntegrationMapping_entityType_entityId_integration_comp on externalIntegrationMapping
DROP INDEX IF EXISTS "public"."fixedAssetCipCost_companyId_idx"; -- covered by fixedAssetCipCost_asset_idx on fixedAssetCipCost
DROP INDEX IF EXISTS "public"."fixedAssetUsageLog_fixedAssetId_idx"; -- covered by fixedAssetUsageLog_fixedAssetId_periodEnd_key on fixedAssetUsageLog
DROP INDEX IF EXISTS "public"."fixedAsset_companyId_idx"; -- covered by fixedAsset_status_idx on fixedAsset
DROP INDEX IF EXISTS "public"."idx_jobOperationDependency_operationId"; -- covered by jobOperationDependency_pk on jobOperationDependency
DROP INDEX IF EXISTS "public"."idx_job_status"; -- covered by idx_job_status_location on job
DROP INDEX IF EXISTS "public"."idx_makeMethod_itemId"; -- covered by makeMethod_unique_itemId_version on makeMethod
DROP INDEX IF EXISTS "public"."idx_procedure_name_company_id"; -- covered by procedure_version_unique on procedure
DROP INDEX IF EXISTS "public"."idx_purchaseInvoice_invoiceId"; -- covered by purchaseInvoice_invoiceId_key on purchaseInvoice
DROP INDEX IF EXISTS "public"."idx_purchaseOrder_purchaseOrderId"; -- covered by purchaseOrder_purchaseOrderId_key on purchaseOrder
DROP INDEX IF EXISTS "public"."idx_salesInvoice_invoiceId"; -- covered by salesInvoice_invoiceId_key on salesInvoice
DROP INDEX IF EXISTS "public"."idx_salesRfq_salesRfqId"; -- covered by salesRfq_salesRfqId_revisionId_key on salesRfq
DROP INDEX IF EXISTS "public"."idx_supplierQuote_supplierQuoteId"; -- covered by supplierQuote_quoteId_key on supplierQuote
DROP INDEX IF EXISTS "public"."implementationCheckState_companyId_idx"; -- covered by implementationCheckState_companyId_itemKey_key on implementationCheckState
DROP INDEX IF EXISTS "public"."implementationFieldValue_companyId_idx"; -- covered by implementationFieldValue_companyId_fieldKey_key on implementationFieldValue
DROP INDEX IF EXISTS "public"."inboundInspectionFeature_inboundInspectionId_idx"; -- covered by inboundInspectionFeature_unique on inspectionSamplingPlan
DROP INDEX IF EXISTS "public"."inboundInspectionMeasurement_sampleId_idx"; -- covered by inboundInspectionMeasurement_unique on inspectionMeasurement
DROP INDEX IF EXISTS "public"."inboundInspection_inboundInspectionId_idx"; -- covered by inboundInspection_inboundInspectionId_unique on inspection
DROP INDEX IF EXISTS "public"."index_membership_groupid"; -- covered by membership_groupId_memberUserId_key on membership
DROP INDEX IF EXISTS "public"."inspectionFeature_inspectionDocumentId_idx"; -- covered by inspectionFeature_document_page_idx on inspectionFeature
DROP INDEX IF EXISTS "public"."integrationConnection_companyId_idx"; -- covered by integrationConnection_name_unique on integrationConnection
DROP INDEX IF EXISTS "public"."integrationConnection_companyId_pieceName_idx"; -- covered by integrationConnection_name_unique on integrationConnection
DROP INDEX IF EXISTS "public"."itarCertification_companyId_idx"; -- covered by itarCertification_gate_idx on itarCertification
DROP INDEX IF EXISTS "public"."itemPlanning_itemId_locationId_idx"; -- covered by itemPlanning_itemId_locationId_key on itemPlanning
DROP INDEX IF EXISTS "public"."itemPostingGroupResponsibility_companyId_idx"; -- covered by itemPostingGroupResponsibility_unique on itemPostingGroupResponsibility
DROP INDEX IF EXISTS "public"."itemRentalRate_companyId_idx"; -- covered by itemRentalRate_item_currency_key on itemRentalRate
DROP INDEX IF EXISTS "public"."itemReplenishment_itemId_idx"; -- covered by itemReplenishment_pkey on itemReplenishment
DROP INDEX IF EXISTS "public"."itemSerialSequence_itemId_idx"; -- covered by itemSerialSequence_itemId_companyId_key on itemSerialSequence
DROP INDEX IF EXISTS "public"."jobFavorites_jobId_idx"; -- covered by jobFavorites_pkey on jobFavorite
DROP INDEX IF EXISTS "public"."jobOperationAttributeRecord_jobOperationAttributeId_idx"; -- covered by jobOperationStepRecord_jobOperationStepId_index_fkey on jobOperationStepRecord
DROP INDEX IF EXISTS "public"."jobOperationStepRecord_jobOperationStepId_index_idx"; -- covered by jobOperationStepRecord_jobOperationStepId_index_fkey on jobOperationStepRecord
DROP INDEX IF EXISTS "public"."journalLineDimension_journalLineId_idx"; -- covered by journalLineDimension_journalLineId_dimensionId_key on journalLineDimension
DROP INDEX IF EXISTS "public"."journalLineDimension_line_dimension_idx"; -- covered by journalLineDimension_journalLineId_dimensionId_key on journalLineDimension
DROP INDEX IF EXISTS "public"."journal_companyId_idx"; -- covered by journal_companyId_postingDate_idx on journal
DROP INDEX IF EXISTS "public"."kanban_companyId_idx"; -- covered by kanban_kanbanId_companyId_key on kanban
DROP INDEX IF EXISTS "public"."leasePayment_companyId_idx"; -- covered by leasePayment_unique on leasePayment
DROP INDEX IF EXISTS "public"."leaseScheduleLine_companyId_idx"; -- covered by leaseScheduleLine_unique on leaseScheduleLine
DROP INDEX IF EXISTS "public"."lease_companyId_idx"; -- covered by lease_companyId_status_idx on lease
DROP INDEX IF EXISTS "public"."lessonCompletion_userId_courseId_lessonId_idx"; -- covered by unique_lesson_completion on lessonCompletion
DROP INDEX IF EXISTS "public"."location_name_idx"; -- covered by location_name_unique on location
DROP INDEX IF EXISTS "public"."nciTrackedEntity_nonConformanceId_idx"; -- covered by nciTrackedEntity_ncUnique on nonConformanceItemTrackedEntity
DROP INDEX IF EXISTS "public"."nciTrackedEntity_nonConformanceItemId_idx"; -- covered by nciTrackedEntity_rowUnique on nonConformanceItemTrackedEntity
DROP INDEX IF EXISTS "public"."nonConformanceActionProcess_actionTaskId_idx"; -- covered by nonConformanceActionProcess_unique on nonConformanceActionProcess
DROP INDEX IF EXISTS "public"."nonConformanceInboundInspection_nonConformanceId_idx"; -- covered by nonConformanceInboundInspection_unique on nonConformanceInspection
DROP INDEX IF EXISTS "public"."notificationPreference_userId_companyId_idx"; -- covered by notificationPreference_userId_companyId_channel_topic_key on notificationPreference
DROP INDEX IF EXISTS "public"."oauthClient_clientId_idx"; -- covered by oauthClient_clientId_key on oauthClient
DROP INDEX IF EXISTS "public"."oauthCode_code_idx"; -- covered by oauthCode_code_key on oauthCode
DROP INDEX IF EXISTS "public"."oauthToken_accessToken_idx"; -- covered by oauthToken_accessToken_key on oauthToken
DROP INDEX IF EXISTS "public"."oauthToken_refreshToken_idx"; -- covered by oauthToken_refreshToken_key on oauthToken
DROP INDEX IF EXISTS "public"."period_startDate_idx"; -- covered by period_startDate_endDate_idx on period
DROP INDEX IF EXISTS "public"."pickMethod_itemId_locationId_idx"; -- covered by pickMethod_itemId_locationId_key on pickMethod
DROP INDEX IF EXISTS "public"."printJob_companyId_idx"; -- covered by printJob_status_idx on printJob
DROP INDEX IF EXISTS "public"."project_companyId_idx"; -- covered by project_companyId_name_key on project
DROP INDEX IF EXISTS "public"."purchaseOrderFavorites_purchaseOrderId_idx"; -- covered by purchaseOrderFavorites_pkey on purchaseOrderFavorite
DROP INDEX IF EXISTS "public"."purchaseOrder_purchaseOrderId_idx"; -- covered by purchaseOrder_purchaseOrderId_key on purchaseOrder
DROP INDEX IF EXISTS "public"."purchasingRfqFavorites_purchasingRfqId_idx"; -- covered by purchasingRfqFavorites_pkey on purchasingRfqFavorite
DROP INDEX IF EXISTS "public"."purchasingRfqSupplier_purchasingRfqId_idx"; -- covered by purchasingRfqSupplier_unique on purchasingRfqSupplier
DROP INDEX IF EXISTS "public"."purchasingRfq_rfqId_idx"; -- covered by purchasingRfq_rfqId_companyId_key on purchasingRfq
DROP INDEX IF EXISTS "public"."quoteFavorites_quoteId_idx"; -- covered by quoteFavorites_pkey on quoteFavorite
DROP INDEX IF EXISTS "public"."receipt_receiptId_idx"; -- covered by receipt_receiptId_key on receipt
DROP INDEX IF EXISTS "public"."reimbursementLineDimension_reimbursementLineId_idx"; -- covered by reimbursementLineDimension_line_dimension_key on reimbursementLineDimension
DROP INDEX IF EXISTS "public"."reimbursement_companyId_idx"; -- covered by reimbursement_companyId_status_idx on reimbursement
DROP INDEX IF EXISTS "public"."rentalAgreement_companyId_idx"; -- covered by rentalAgreement_companyId_status_idx on rentalAgreement
DROP INDEX IF EXISTS "public"."rentalBillingPeriod_companyId_idx"; -- covered by rentalBillingPeriod_unique on rentalBillingPeriod
DROP INDEX IF EXISTS "public"."rentalLeaseScheduleLine_companyId_idx"; -- covered by rentalLeaseScheduleLine_unique on rentalLeaseScheduleLine
DROP INDEX IF EXISTS "public"."reportView_companyId_idx"; -- covered by reportView_name_unique on reportView
DROP INDEX IF EXISTS "public"."revenueRecognitionRunLine_companyId_idx"; -- covered by revenueRecognitionRunLine_schedule_key on revenueRecognitionRunLine
DROP INDEX IF EXISTS "public"."revenueRecognitionSchedule_companyId_idx"; -- covered by revenueRecognitionSchedule_lease_idx on revenueRecognitionSchedule
DROP INDEX IF EXISTS "public"."salesOrderFavorites_salesOrderId_idx"; -- covered by salesOrderFavorites_pkey on salesOrderFavorite
DROP INDEX IF EXISTS "public"."salesRfqFavorites_salesRfqId_idx"; -- covered by salesRfqFavorites_pkey on salesRfqFavorite
DROP INDEX IF EXISTS "public"."shipmentLine_shipmentId_idx"; -- covered by shipmentLine_shipmentId_lineId_idx on shipmentLine
DROP INDEX IF EXISTS "public"."shipment_shipmentId_idx"; -- covered by shipment_shipmentId_key on shipment
DROP INDEX IF EXISTS "public"."shippingMethod_name_idx"; -- covered by shippingMethod_name_key on shippingMethod
DROP INDEX IF EXISTS "public"."slackDocumentThread_documentType_documentId_idx"; -- covered by slackDocumentThread_unique on slackDocumentThread
DROP INDEX IF EXISTS "public"."ssoDomain_companyId_idx"; -- covered by ssoDomain_companyId_domain_key on ssoDomain
DROP INDEX IF EXISTS "public"."supplierPayment_supplierId_idx"; -- covered by supplierPayment_pkey on supplierPayment
DROP INDEX IF EXISTS "public"."supplierQuoteFavorites_supplierQuoteId_idx"; -- covered by supplierQuoteFavorites_pkey on supplierQuoteFavorite
DROP INDEX IF EXISTS "public"."supplierShipping_supplierId_idx"; -- covered by supplierShipping_pkey on supplierShipping
DROP INDEX IF EXISTS "public"."supplierTax_supplierId_idx"; -- covered by supplierTax_pkey on supplierTax
DROP INDEX IF EXISTS "public"."supplyActual_companyId_idx"; -- covered by supplyActual_companyId_locationId_idx on supplyActual
DROP INDEX IF EXISTS "public"."supplyActual_itemId_locationId_periodId_idx"; -- covered by supplyActual_pkey on supplyActual
DROP INDEX IF EXISTS "public"."supplyForecast_companyId_idx"; -- covered by supplyForecast_companyId_locationId_idx on supplyForecast
DROP INDEX IF EXISTS "public"."supplyForecast_itemId_locationId_periodId_idx"; -- covered by supplyForecast_pkey on supplyForecast
DROP INDEX IF EXISTS "public"."userAttributeValue_userAttributeId_idx"; -- covered by uq_userattributeid_userid on userAttributeValue
DROP INDEX IF EXISTS "public"."userModulePreference_userId_companyId_idx"; -- covered by userModulePreference_userId_companyId_module_key on userModulePreference
DROP INDEX IF EXISTS "public"."workCenterDevice_integration_idx"; -- covered by workCenterDevice_device_key on workCenterDevice
DROP INDEX IF EXISTS "public"."workCenterShift_workCenterId_idx"; -- covered by workCenterShift_wc_shift_key on workCenterShift
DROP INDEX IF EXISTS "public"."workflowTriggerEvent_workflowId_idx"; -- covered by workflowTriggerEvent_workflowId_eventId_key on workflowTriggerEvent
DROP INDEX IF EXISTS "public"."workflowVersion_workflowId_idx"; -- covered by workflowVersion_workflowId_versionNumber_key on workflowVersion

RESET lock_timeout;
