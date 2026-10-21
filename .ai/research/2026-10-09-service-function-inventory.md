# Service function inventory

Generated 2026-10-09 from the `refactor/service-functions` branch (`origin/main` at `d24f763d52` plus the `production.server.ts` migration) by a script that reads every service file and every route `loader` and `action`. Function names and call sites are read from the code. The classification and the proposed names are produced by rules, described under **Method and limits**, and need review before anyone builds from them.

## Summary

| | Count |
|---|---|
| Service files scanned | 113 |
| Exported service functions | 2233 (ERP 1915, MES 145, `packages/ee` 173) |
| Routes with a loader or an action | 1615 |
| Route actions | 1062 |
| Actions that already make one service call | 676 |
| Actions that need a new service function | 334 |
| New service functions those actions need | 439 (an action with several intents needs one each) |
| Actions that write nothing (login, session, uploads, options) | 52 |

## 1. Files with the most service functions

| Functions | Lines | File |
|---|---|---|
| 261 | 11305 | `apps/erp/app/modules/production/production.service.ts` |
| 258 | 10227 | `apps/erp/app/modules/sales/sales.service.ts` |
| 206 | 9494 | `apps/erp/app/modules/items/items.service.ts` |
| 159 | 9194 | `apps/erp/app/modules/accounting/accounting.service.ts` |
| 144 | 4721 | `apps/erp/app/modules/inventory/inventory.service.ts` |
| 144 | 5188 | `apps/erp/app/modules/purchasing/purchasing.service.ts` |
| 110 | 1723 | `apps/erp/app/modules/settings/settings.service.ts` |
| 100 | 2283 | `apps/erp/app/modules/resources/resources.service.ts` |
| 91 | 3183 | `apps/erp/app/modules/quality/quality.service.ts` |
| 74 | 4619 | `apps/erp/app/modules/invoicing/invoicing.service.ts` |
| 69 | 2879 | `apps/mes/app/services/operations.service.ts` |
| 49 | 1101 | `apps/erp/app/modules/people/people.service.ts` |
| 30 | 659 | `apps/erp/app/modules/shared/shared.service.ts` |
| 30 | 662 | `apps/erp/app/modules/users/users.service.ts` |
| 23 | 1017 | `packages/ee/src/approvals/service.ts` |
| 22 | 1378 | `apps/erp/app/modules/users/users.server.ts` |
| 19 | 845 | `apps/erp/app/modules/settings/settings.server.ts` |
| 19 | 497 | `apps/erp/app/modules/workflows/workflows.service.ts` |
| 18 | 948 | `apps/erp/app/modules/items/items.server.ts` |
| 18 | 946 | `apps/erp/app/modules/shared/shared.server.ts` |
| 18 | 331 | `apps/mes/app/services/maintenance.service.ts` |
| 18 | 780 | `packages/ee/src/slack/lib/service.ts` |
| 17 | 2351 | `apps/erp/app/modules/accounting/accounting.server.ts` |
| 17 | 452 | `apps/erp/app/modules/documents/documents.service.ts` |
| 17 | 1275 | `apps/erp/app/modules/sales/sales.server.ts` |
| 14 | 318 | `apps/erp/app/modules/account/account.service.ts` |
| 13 | 401 | `apps/erp/app/modules/quality/quality.server.ts` |
| 12 | 533 | `apps/mes/app/services/inventory.service.ts` |
| 12 | 662 | `packages/ee/src/sso/connections.server.ts` |
| 11 | 615 | `packages/ee/src/sso/provisioning.server.ts` |

The other 83 files hold 240 functions between them.

## 2. By module

| Module | Functions defined | Called by a route | Route actions | Already one call | Need a new function | New functions |
|---|---|---|---|---|---|---|
| settings | 150 | 124 | 65 | 19 | 37 | 101 |
| production | 276 | 212 | 112 | 75 | 36 | 51 |
| sales | 277 | 245 | 167 | 124 | 41 | 42 |
| mes | 144 | 126 | 57 | 18 | 24 | 30 |
| resources | 101 | 86 | 61 | 33 | 28 | 29 |
| purchasing | 145 | 126 | 78 | 58 | 20 | 23 |
| items | 224 | 198 | 148 | 126 | 22 | 22 |
| quality | 109 | 99 | 61 | 39 | 22 | 22 |
| accounting | 176 | 137 | 65 | 52 | 13 | 21 |
| inventory | 150 | 130 | 70 | 49 | 20 | 20 |
| api | — | — | 30 | 0 | 18 | 18 |
| invoicing | 84 | 73 | 48 | 30 | 16 | 16 |
| users | 52 | 40 | 20 | 5 | 12 | 12 |
| people | 49 | 43 | 23 | 19 | 4 | 9 |
| shared | 53 | 42 | 19 | 8 | 9 | 9 |
| unassigned | — | — | 2 | 0 | 2 | 4 |
| auth | — | — | 8 | 0 | 4 | 4 |
| workflows | 23 | 23 | 10 | 8 | 2 | 2 |
| account | 15 | 11 | 7 | 4 | 2 | 2 |
| agent | 12 | 10 | 3 | 1 | 2 | 2 |
| documents | 17 | 11 | 8 | 8 | 0 | 0 |

`api`, `auth`, `share` and `unassigned` are routes the rules could not place in a module.

## 3. New service functions, by module

Each row is an action whose logic lives in the route today: it makes two or more writes, or writes through the database client directly. The names are proposed from the route path. An action that switches on a form `intent` gets one name per intent, and **Composes today** is then the whole action, not that intent alone.

**Composes today** lists the write service functions the action calls, then server functions (`fn:`), then the number of direct client writes and whether it sends an event or notification.

### settings (101)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `settings.integrations` | `x+/settings+/integrations.$id.tsx` | `beginOnshapeAuthorization`, `invalidateIntegrationHealthCache`, `onshapeConnectionHasWriteScope`, `patchIntegrationState`, `suggestAccountMatchesWithAI`, `transitionOperation` +3 | 990 |
| `settings.planning.setCompanyDefault`<br>`settings.planning.setLocation`<br>`settings.planning.setItemGroup`<br>`settings.planning.setPlanningPurchaseOrderApproval`<br>`settings.planning.setTolerance`<br>`settings.planning.setPlanningHorizon`<br>`settings.planning.setForecastConsumption`<br>`settings.planning.setMrpSchedule` | `x+/settings+/planning.tsx` | `setDefaultPlanningHorizonDays`, `setDefaultResponsibleEmployee`, `setForecastConsumptionWindow`, `setLocationResponsibleEmployee`, `setRescheduleToleranceDays`, `setSkipApprovalForPlanningPurchaseOrders` +2 | 275 |
| `settings.purchasing.accountsPayableAddressToggle`<br>`settings.purchasing.requireSupplierContactAndLocationToggle`<br>`settings.purchasing.purchasePriceUpdateTiming`<br>`settings.purchasing.updateLeadTimesOnReceipt`<br>`settings.purchasing.showSupplierReadableIdToggle`<br>`settings.purchasing.supplierQuoteNotification`<br>`settings.purchasing.accountsPayableBillingAddress`<br>`settings.purchasing.emails` | `x+/settings+/purchasing.tsx` | `updateAccountsPayableAddressSetting`, `updateAccountsPayableBillingAddress`, `updateDefaultSupplierCc`, `updateLeadTimesOnReceiptSetting`, `updatePurchasePriceUpdateTimingSetting`, `updateRequireSupplierContactSetting` +2 | 220 |
| `settings.backups.export`<br>`settings.backups.restore`<br>`settings.backups.keep`<br>`settings.backups.dismiss`<br>`settings.backups.revert`<br>`settings.backups.dismissExportFailure`<br>`settings.backups.exportSkipCorrupted`<br>`settings.backups.purgeAndRestore`<br>`settings.backups.delete` | `x+/settings+/backups.tsx` | `deleteCompanyBackup`, `dismissCompanyExportFailure`, `exportCompanyBackup`, `finalizeCompanyRestore`, `purgeCorruptedRows`, `revertCompanyRestore` +1 | 256 |
| `settings.invoicing.invoiceAutomation`<br>`settings.invoicing.receivablesEmail`<br>`settings.invoicing.invoiceNotifications`<br>`settings.invoicing.accountsReceivableAddressToggle`<br>`settings.invoicing.accountsReceivableBillingAddress`<br>`settings.invoicing.emails` | `x+/settings+/invoicing.tsx` | `updateAccountsReceivableAddressSetting`, `updateAccountsReceivableBillingAddress`, `updateAccountsReceivableEmail`, `updateDefaultCustomerCc`, `updateInvoiceAutomationSetting`, `updateInvoiceNotificationSetting` | 161 |
| `settings.production.jobCompleted`<br>`settings.production.operationTimer`<br>`settings.production.jobTravelerMaterials`<br>`settings.production.jobTravelerOperations`<br>`settings.production.autoSelectMaterialWithoutPickingListToggle`<br>`settings.production.locationRequiresStaffing` | `x+/settings+/production.tsx` | `updateAutoSelectMaterialWithoutPickingListSetting`, `updateIncludeMaterialsOnTravelerSetting`, `updateIncludeOperationsOnTravelerSetting`; 3 direct writes | 136 |
| `settings.sales.requireCustomerContactAndLocationToggle`<br>`settings.sales.showCustomerReadableIdToggle`<br>`settings.sales.digitalQuote`<br>`settings.sales.rfq`<br>`settings.sales.salesRuleViolations`<br>`settings.sales.categoryMarkups` | `x+/settings+/sales.tsx` | `updateDigitalQuoteSetting`, `updateQuoteLineCategoryMarkups`, `updateRequireCustomerContactSetting`, `updateRfqReadySetting`, `updateSalesRuleNotificationSetting`, `updateShowCustomerReadableIdSetting` | 136 |
| `settings.sso.upsert`<br>`settings.sso.requireSso`<br>`settings.sso.addDomain`<br>`settings.sso.verifyDomain`<br>`settings.sso.removeDomain`<br>`settings.sso.deactivate` | `x+/settings+/sso.tsx` | `addSsoDomain`, `deactivateSsoConnection`, `removeSsoDomain`, `updateSsoRequireSso`, `upsertSsoConnection`, `verifySsoDomain` | 203 |
| `settings.accounting.accountingEnabled`<br>`settings.accounting.showCurrencyTrailingZeros`<br>`settings.accounting.assetTaxDepreciationEnabled`<br>`settings.accounting.leasePolicy`<br>`settings.accounting.assetTaxDepreciation` | `x+/settings+/accounting.tsx` | `updateAccountingEnabledSetting`, `updateAssetTaxDepreciationSettings`, `updateLeasePolicySettings`, `updateShowCurrencyTrailingZerosSetting`; 1 direct write | 96 |
| `settings.companies.create` | `x+/settings+/companies.new.tsx` | `enableAuditLog`, `insertCompany`, `insertEmployeeJob`, `seedCompany`, `upsertLocation` | 140 |
| `settings.company.create` | `x+/settings+/company.new.tsx` | `enableAuditLog`, `insertCompany`, `insertEmployeeJob`, `seedCompany`, `upsertLocation` | 113 |
| `settings.items.materialIds`<br>`settings.items.materialUnits`<br>`settings.items.allowLowercaseItemIds`<br>`settings.items.bomExplorerReadableId`<br>`settings.items.plmReleaseControl` | `x+/settings+/items.tsx` | `updateAllowLowercaseItemIdsSetting`, `updateBomExplorerReadableIdSetting`, `updateMaterialGeneratedIdsSetting`, `updateMetricSettings`, `updatePlmReleaseControlSetting` | 72 |
| `settings.demoData.keep`<br>`settings.demoData.apply`<br>`settings.demoData.dismiss`<br>`settings.demoData.revert`<br>`settings.demoData.purgeAndApply` | `x+/settings+/demo-data.tsx` | `finalizeCompanyTemplate`, `purgeCorruptedRows`, `revertCompanyTemplate`, `startCompanyTemplate` | 153 |
| `settings.inventory.kanbanOutput`<br>`settings.inventory.shelfLife`<br>`settings.inventory.incompletePickingListPolicy`<br>`settings.inventory.returnPickedMaterialTiming` | `x+/settings+/inventory.tsx` | `updateIncompletePickingListPolicySetting`, `updateKanbanOutputSetting`, `updateReturnPickedMaterialTimingSetting`, `updateShelfLifeSettings` | 111 |
| `settings.quality.enforceInspectionFourEyes`<br>`settings.quality.samplingStandard`<br>`settings.quality.dashboard` | `x+/settings+/quality.tsx` | 4 direct writes | 77 |
| `settings.callback` | `_public+/callback.tsx` | `deleteJitSsoUser`, `linkSsoIdentityToUser`, `migrateUserToSso` | 415 |
| `settings.company` | `x+/settings+/company.tsx` | `invalidateCompanyTimeZone`, `updateCompany`, `updateCompanyWithBaseCurrencyChange` | 62 |
| `settings.people.timeCard`<br>`settings.people.console` | `x+/settings+/people.tsx` | `companyHasFeature`, `updateConsoleSetting`, `updateTimeCardSetting` | 61 |
| `settings.webhook.stripeConnect` | `api+/webhook.stripe-connect.ts` | `recordStripeConnectPayment`, `upsertCompanyIntegration`, `voidStripeConnectPayment` | 265 |
| `settings.apiKeys` | `x+/settings+/api-keys.$id.tsx` | `invalidateApiKeyCache`, `upsertApiKey` | 54 |
| `settings.apiKeys.delete` | `x+/settings+/api-keys.delete.$id.tsx` | `deleteApiKey`, `invalidateApiKeyCache` | 41 |
| `settings.auditLogs` | `x+/settings+/audit-logs.tsx` | `disableAuditLog`, `enableAuditLog` | 101 |
| `settings.companies` | `x+/settings+/companies.$id.tsx` | `invalidateCompanyTimeZone`, `updateSubsidiary` | 41 |
| `settings.integrations.deactivate` | `x+/settings+/integrations.deactivate.$id.tsx` | `deactivateIntegration`, `invalidateIntegrationHealthCache` | 55 |
| `settings.printing.jobs.reprint`<br>`settings.printing.jobs.delete`<br>`settings.printing.jobs.viewContent` | `x+/settings+/printing.jobs.tsx` | 1 direct write; event | 132 |
| `settings.resources.suggestions`<br>`settings.resources.maintenanceDispatchNotifications` | `x+/settings+/resources.tsx` | `updateMaintenanceDispatchNotificationSettings`, `updateSuggestionNotificationSetting` | 65 |
| `settings.templates.shared` | `x+/templates+/shared.tsx` | `deleteDocumentSection`, `upsertDocumentSection` | 52 |
| `settings.templates.update` | `x+/templates+/$type.tsx` | `upsertDocumentSection`, `upsertDocumentTemplate` | 79 |
| `settings.webhook.jira` | `api+/webhook.jira.$companyId.ts` | `verifyJiraWebhook`; event | 109 |
| `settings.webhook.linear` | `api+/webhook.linear.$companyId.ts` | `verifyLinearWebhook`; event | 108 |
| `settings.webhook.paperlessParts` | `api+/webhook.paperless-parts.$companyId.ts` | 1 direct write; event | 115 |
| `settings.webhook.rillet` | `api+/webhook.rillet.$companyId.ts` | `verifyRilletWebhookSignature`; event | 122 |
| `settings.billing.billingPortal`<br>`settings.billing.transferOwnership` | `x+/settings+/billing.tsx` | 1 direct write | 73 |
| `settings.customFields` | `x+/settings+/custom-fields.tsx` | 1 direct write | 26 |
| `settings.passkey.authenticate.verify` | `api+/passkey.authenticate.verify.ts` | 1 direct write | 160 |
| `settings.printing.delete` | `x+/settings+/printing.$id.delete.tsx` | 1 direct write | 83 |
| `settings.tags` | `x+/settings+/tags.tsx` | 1 direct write | 26 |

### production (51)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `production.planning.update` | `x+/production+/planning.update.tsx` | `applyProductionPlanningDateActions`, `assignPlanningActions`, `cancelJob`, `dismissPlanningActions`, `insertJob`, `markPlanningActionsActioned` +7; 1 direct write; event | 1230 |
| `production.priority.people.assign`<br>`production.priority.people.unassign`<br>`production.priority.people.absent`<br>`production.priority.people.clearAbsence`<br>`production.priority.people.move`<br>`production.priority.people.dayHours`<br>`production.priority.people.hours`<br>`production.priority.people.overtimeBulk`<br>`production.priority.people.copy`<br>`production.priority.people.assignWeek`<br>`production.priority.people.unassignWeek`<br>`production.priority.people.moveWeek`<br>`production.priority.people.copyWeek`<br>`production.priority.people.absentRange` | `x+/priority+/people.update.tsx` | `assignPeopleWeek`, `clearPeopleAbsence`, `copyPeopleBoard`, `copyPeopleWeek`, `deletePeopleAssignment`, `movePeopleAssignment` +8; event | 497 |
| `production.job.update` ⚠ | `x+/job+/update.tsx` | `recalculateJobRequirements`, `upsertJobMethod`; 8 direct writes; event | 321 |
| `production.job.setStatus` | `x+/job+/$jobId.status.tsx` | `cancelJob`, `recalculateJobRequirements`, `releaseJobs`, `runMRP`, `updateJobStatus`; fn:`close-job`, fn:`create`; 1 direct write | 268 |
| `production.priority.batching.reprioritize`<br>`production.priority.batching.mergeOutputs`<br>`production.priority.batching.create` | `x+/priority+/batching.update.tsx` | `createJobOperationBatch`, `mergeTrackedEntities`, `releaseBatchMemberJobs`, `releaseJobOperationBatch`, `unreleaseJobOperationBatch`, `updateJobOperationBatch`; 1 direct write; event | 283 |
| `production.model.upload` | `api+/model.upload.ts` | 6 direct writes; event | 123 |
| `production.methods.get` | `x+/job+/methods+/get.tsx` | `recalculateJobOperationDependencies`, `recalculateJobRequirements`, `upsertJobMaterialMakeMethod`, `upsertJobMethod` | 122 |
| `production.methods.material` | `x+/job+/methods+/$jobId.material.$id.tsx` | `pullJobMaterialMakeMethod`, `recalculateJobMakeMethodRequirements`, `recalculateJobOperationDependencies`, `upsertJobMaterial` | 201 |
| `production.methods.material.create` | `x+/job+/methods+/$jobId.material.new.tsx` | `pullJobMaterialMakeMethod`, `recalculateJobMakeMethodRequirements`, `recalculateJobOperationDependencies`, `upsertJobMaterial` | 158 |
| `production.assemblies.create` | `x+/production+/assemblies.new.tsx` | `createAssemblyPlanJob`, `upsertAssemblyInstruction`; event | 145 |
| `production.assembly.plan.rerun` | `x+/assembly+/$id.plan.rerun.tsx` | `createAssemblyPlanJob`; 1 direct write; event | 165 |
| `production.assembly.steps.generate` | `x+/assembly+/$id.steps.generate.tsx` | `createAssemblyPlanJob`, `generateAssemblyStepsFromPlan`; event | 112 |
| `production.batches.release` | `x+/production+/batches.release.tsx` | `releaseBatchMemberJobs`, `releaseJobOperationBatch`; event | 98 |
| `production.job.configure` | `x+/job+/$jobId.configure.tsx` | `upsertJobMethod`; 1 direct write; event | 73 |
| `production.methods.operation.create` | `x+/job+/methods+/$jobId.operation.new.tsx` | `recalculateJobMakeMethodRequirements`, `recalculateJobOperationDependencies`, `upsertJobOperation` | 112 |
| `production.priority.operations.update` | `x+/priority+/operations.update.tsx` | `reorderScheduleOperations`; 1 direct write; event | 166 |
| `production.assembly.componentMappings.auto` | `x+/assembly+/$id.component-mappings.auto.tsx` | `autoMatchAssemblyComponents`, `syncAssemblyStepMaterialsFromMappings` | 49 |
| `production.assembly.componentMappings.create` | `x+/assembly+/$id.component-mappings.new.tsx` | `syncAssemblyStepMaterialsFromMappings`, `upsertAssemblyComponentMapping` | 48 |
| `production.assembly.jobs.cancel` | `x+/assembly+/$id.jobs.cancel.tsx` | 2 direct writes | 95 |
| `production.assembly.model.invalidate` | `x+/assembly+/$id.model.invalidate.tsx` | `invalidateAssemblyModelCache`; event | 48 |
| `production.assembly.steps.components.reassign` | `x+/assembly+/$id.steps.components.reassign.tsx` | `reassignAssemblyStepComponents`, `syncAssemblyStepMaterialsFromMappings` | 55 |
| `production.assembly.steps.components.step.update` | `x+/assembly+/$id.steps.components.$stepId.tsx` | `syncAssemblyStepMaterialsFromMappings`, `updateAssemblyStepComponents` | 63 |
| `production.job.complete` | `x+/job+/$jobId.complete.tsx` | `returnPickedRemaindersForJob`; 1 direct write | 92 |
| `production.job.events` | `x+/job+/$jobId.events.$id.tsx` | `upsertProductionEvent`; fn:`post-production-event` | 63 |
| `production.job.events.create` | `x+/job+/$jobId.events.new.tsx` | `upsertProductionEvent`; fn:`post-production-event` | 78 |
| `production.job.release` | `x+/job+/release.tsx` | `jobReleaseProblems`, `releaseJobs` | 156 |
| `production.job.update` ⚠ | `x+/job+/$jobId.details.tsx` | `recalculateJobRequirements`, `updateJob` | 108 |
| `production.methods.material.delete` | `x+/job+/methods+/$jobId.material.delete.$id.tsx` | `deleteJobMaterial`, `recalculateJobOperationDependencies` | 50 |
| `production.methods.operation.delete` | `x+/job+/methods+/$jobId.operation.delete.tsx` | `recalculateJobOperationDependencies`; 1 direct write | 82 |
| `production.methods.operation.dueDate` | `x+/job+/methods+/operation.due-date.tsx` | `updateJobOperationDueDate`; event | 34 |
| `production.methods.operation.order` | `x+/job+/methods+/$jobId.operation.order.tsx` | `recalculateJobOperationDependencies`, `updateJobOperationOrder` | 72 |
| `production.methods.operation.setStatus` | `x+/job+/methods+/operation.status.tsx` | `returnPickedRemaindersForOperation`, `updateJobOperationStatus` | 45 |
| `production.methods.save` | `x+/job+/methods+/save.tsx` | `upsertMakeMethodFromJob`, `upsertMakeMethodFromJobMethod` | 71 |
| `production.priority.dates.update` | `x+/priority+/dates.update.tsx` | 1 direct write; event | 65 |
| `production.procedure.update` | `x+/procedure+/update.tsx` | 2 direct writes | 43 |
| `production.assembly.model.convert` | `x+/assembly+/$id.model.convert.tsx` | event | 73 |

### sales (42)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `sales.quote.finalize` | `x+/quote+/$quoteId.finalize.tsx` | `dedupeViolations`, `evaluateSalesRulesForSalesDocument`, `finalizeQuote`, `recordSalesRuleOutcome`, `upsertDocument`, `upsertExternalLink`; 1 direct write; event | 299 |
| `sales.sales.digitalQuote` | `api+/sales.digital-quote.$id.tsx` | `convertQuoteToOrder`, `dedupeViolations`, `evaluateSalesRulesForSalesDocument`, `generateAndAttachSalesOrderPdf`, `recordSalesRuleOutcome`; 2 direct writes; event | 323 |
| `sales.quote.drag` | `x+/quote+/$quoteId.drag.tsx` | `upsertPart`, `upsertQuoteLine`, `upsertQuoteLineMethod`; 3 direct writes; event | 287 |
| `sales.salesOrder.confirm` | `x+/sales-order+/$orderId.confirm.tsx` | `dedupeViolations`, `evaluateSalesRulesForSalesDocument`, `generateAndAttachSalesOrderPdf`, `recordSalesRuleOutcome`, `runMRP`, `sendSalesOrderEmail`; 1 direct write | 244 |
| `sales.salesReturnOrder.line.issue` | `x+/sales-return-order+/$id.$lineId.issue.tsx` | `deleteIssue`, `insertIssue`, `setSalesReturnOrderLineDisposition`; fn:`create`; 3 direct writes | 358 |
| `sales.contract.invoiceAutomation`<br>`sales.contract.contractType` | `x+/contract+/update.tsx` | `contractCustomerChange`, `contractDurationOf`, `updateContract`, `updateContractInvoiceAutomation`, `updateContractNotes`, `updateContractType` | 272 |
| `sales.quote.convert` | `x+/quote+/$quoteId.convert.tsx` | `convertQuoteToOrder`, `dedupeViolations`, `evaluateSalesRulesForSalesDocument`, `generateAndAttachSalesOrderPdf`, `recordSalesRuleOutcome`, `sendSalesOrderEmail` | 196 |
| `sales.quote.create` | `x+/quote+/$quoteId.new.tsx` | `dedupeViolations`, `evaluateSalesRuleLines`, `recalculateQuoteLinePrices`, `recordSalesRuleOutcome`, `upsertQuoteLine`, `upsertQuoteLineMethod` | 214 |
| `sales.quote.line.update` | `x+/quote+/$quoteId.$lineId.details.tsx` | `dedupeViolations`, `evaluateSalesRuleLines`, `reconcileQuantityBreaks`, `recordSalesRuleOutcome`, `saveQuoteLineWithPrices` | 204 |
| `sales.salesOrder.update` | `x+/sales-order+/update.tsx` | 5 direct writes | 124 |
| `sales.methods.get` | `x+/quote+/methods+/get.tsx` | `copyQuoteLine`, `recalculateQuoteLinePrices`, `upsertQuoteLineMethod`, `upsertQuoteMaterialMakeMethod` | 148 |
| `sales.quote.line.configure` | `x+/quote+/$quoteId.$lineId.configure.tsx` | `upsertQuoteLineMethod`; 3 direct writes | 102 |
| `sales.quote.update` | `x+/quote+/update.tsx` | 4 direct writes | 103 |
| `sales.salesOrder.create` | `x+/sales-order+/$orderId.new.tsx` | `dedupeViolations`, `evaluateSalesRuleLines`, `recordSalesRuleOutcome`, `upsertSalesOrderLine` | 146 |
| `sales.salesOrder.line.update` | `x+/sales-order+/$orderId.$lineId.details.tsx` | `dedupeViolations`, `evaluateSalesRuleLines`, `recordSalesRuleOutcome`, `upsertSalesOrderLine` | 127 |
| `sales.salesReturnOrder.update` | `x+/sales-return-order+/update.tsx` | 4 direct writes | 115 |
| `sales.salesRfq.drag` | `x+/sales-rfq+/$rfqId.drag.tsx` | `upsertSalesRFQLine`; 2 direct writes; event | 153 |
| `sales.methods.line.material.create` | `x+/quote+/methods+/$quoteId.$lineId.material.new.tsx` | `recalculateQuoteLinePrices`, `upsertQuoteMaterial`, `upsertQuoteMaterialMakeMethod` | 130 |
| `sales.salesRfq.convert` | `x+/sales-rfq+/$rfqId.convert.tsx` | `convertSalesRfqToQuote`, `dedupeViolations`, `evaluateSalesRulesForSalesDocument` | 136 |
| `sales.salesRfq.create` | `x+/sales-rfq+/new.tsx` | `insertSalesRFQ`, `upsertDocument`, `upsertSalesRFQLine` | 159 |
| `sales.salesRfq.mapLines` | `api+/sales-rfq.$rfqId.map-lines.ts` | `upsertPart`; 2 direct writes | 200 |
| `sales.contract.confirm` | `x+/contract+/$id.confirm.tsx` | `linkStripeCustomerForBilling`, `runContractAction` | 132 |
| `sales.contract.create` | `x+/contract+/new.tsx` | `contractInvoicingDefaults`, `insertContract` | 105 |
| `sales.contract.setup.update` | `x+/contract+/$id.setup.details.tsx` | `contractCustomerChange`, `updateContract` | 76 |
| `sales.methods.line.material` | `x+/quote+/methods+/$quoteId.$lineId.material.$id.tsx` | `recalculateQuoteLinePrices`, `upsertQuoteMaterial` | 93 |
| `sales.methods.line.material.delete` | `x+/quote+/methods+/$quoteId.$lineId.material.delete.$id.tsx` | `deleteQuoteMaterial`, `recalculateQuoteLinePrices` | 54 |
| `sales.methods.line.operation` | `x+/quote+/methods+/$quoteId.$lineId.operation.$id.tsx` | `recalculateQuoteLinePrices`, `upsertQuoteOperation` | 88 |
| `sales.methods.line.operation.create` | `x+/quote+/methods+/$quoteId.$lineId.operation.new.tsx` | `recalculateQuoteLinePrices`, `upsertQuoteOperation` | 84 |
| `sales.methods.operation.delete` | `x+/quote+/methods+/operation.delete.tsx` | `recalculateQuoteLinePrices`; 1 direct write | 53 |
| `sales.methods.save` | `x+/quote+/methods+/save.tsx` | `upsertMakeMethodFromQuoteLine`, `upsertMakeMethodFromQuoteMethod` | 83 |
| `sales.pricingRules` | `x+/sales+/pricing-rules.$ruleId.tsx` | `duplicatePricingRule`, `updatePricingRule` | 59 |
| `sales.rentalAgreement.create` | `x+/rental-agreement+/new.tsx` | `insertRentalAgreement`, `upsertRentalAgreementLine` | 78 |
| `sales.rentalAgreement.line.classification` | `x+/rental-agreement+/$id.$lineId.classification.tsx` | `insertAuditLogEntries`; 1 direct write | 153 |
| `sales.rentalAgreement.line.sell` | `x+/rental-agreement+/$id.$lineId.sell.tsx` | `generateRentalInvoicesNow`, `insertRentalPurchaseOptionCharge` | 171 |
| `sales.rentalAgreement.update` | `x+/rental-agreement+/update.tsx` | `updateRentalAgreement`, `updateRentalAgreementInvoiceAutomation` | 174 |
| `sales.salesOrder.setStatus` | `x+/sales-order+/$orderId.status.tsx` | `cancelSalesOrder`, `updateSalesOrderStatus` | 72 |
| `sales.salesReturnOrder.confirm` | `x+/sales-return-order+/$id.confirm.tsx` | `confirmSalesReturnOrder`, `generateAndAttachSalesReturnOrderPdf` | 81 |
| `sales.salesReturnOrder.create` | `x+/sales-return-order+/$id.new.tsx` | `upsertSalesReturnOrderLine`; 1 direct write | 90 |
| `sales.salesReturnOrder.setStatus` | `x+/sales-return-order+/$id.status.tsx` | `cancelSalesReturnOrder`, `reopenSalesReturnOrder` | 62 |
| `sales.salesRfq.setStatus` | `x+/sales-rfq+/$rfqId.status.tsx` | `updateSalesRFQStatus`; event | 68 |
| `sales.salesRfq.update` | `x+/sales-rfq+/update.tsx` | 1 direct write | 53 |

### mes (30)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `mes.inspectionLot.disposition` | `x+/inspection-lot.$id.disposition.tsx` | `createInspectionRejectionIssue`, `finishJobOperation`, `insertScrapQuantity`, `postBulkCompletion`, `postSerialCompletions`; fn:`issue`, fn:`recalculate`, fn:`trigger-rework`; 1 direct write | 373 |
| `mes.maintenanceEvent` | `x+/maintenance-event.tsx` | `endMaintenanceEvent`, `postMaintenanceLabor`, `startMaintenanceEvent`, `updateMaintenanceDispatchStatus`; event | 234 |
| `mes.complete` | `x+/complete.tsx` | `finishJobOperation`, `insertProductionQuantity`; fn:`issue`; event | 307 |
| `mes.dispatch.create` | `x+/dispatch.new.tsx` | `endProductionEventsByWorkCenter`; 2 direct writes; event | 220 |
| `mes.timecard.clockIn` ⚠<br>`mes.timecard.clockOut` ⚠<br>`mes.timecard.updateEntry`<br>`mes.timecard.deleteEntry` | `x+/timecard.tsx` | `clockIn`, `clockOut`, `updateTimeCardEntry`; 1 direct write | 48 |
| `mes.event` | `x+/event.tsx` | `endProductionEvent`, `startProductionEvent`; fn:`post-production-event` | 152 |
| `mes.inspectionLot.completePassed` | `x+/inspection-lot.$id.complete-passed.tsx` | `postBulkCompletion`, `postSerialCompletions`, `returnPickedRemainders` | 127 |
| `mes.acknowledge.academy`<br>`mes.acknowledge.itarEntity`<br>`mes.acknowledge.itarUser` | `x+/acknowledge.tsx` | `recordItarCertification`; 1 direct write | 115 |
| `mes.batch.complete` | `x+/batch.$batchId.complete.tsx` | fn:`batch-operations`, fn:`issue` | 172 |
| `mes.batch.record` | `x+/batch.$batchId.record.tsx` | `backflushUntrackedMaterialsOnStepRecord`, `insertBatchStepRecords` | 60 |
| `mes.dispatch.item` | `x+/dispatch.$dispatchId.item.tsx` | `addMaintenanceDispatchItem`; fn:`issue` | 113 |
| `mes.endShift` | `x+/end-shift.tsx` | `endProductionEvents`; 1 direct write | 57 |
| `mes.issue` | `x+/issue.tsx` | `evaluateLinesForSurface`; fn:`issue` | 104 |
| `mes.model.reoptimize` | `api+/model.reoptimize.ts` | 1 direct write; event | 36 |
| `mes.record` | `x+/record.tsx` | `backflushUntrackedMaterialsOnStepRecord`, `insertAttributeRecord` | 54 |
| `mes.suggestion` | `x+/suggestion.tsx` | 1 direct write; event | 92 |
| `mes.timecard.clockIn` ⚠<br>`mes.timecard.clockOut` ⚠ | `api+/timecard.ts` | `clockIn`, `clockOut` | 30 |
| `mes.triggerRework` | `x+/trigger-rework.tsx` | fn:`recalculate`, fn:`trigger-rework` | 41 |
| `mes.unconsume` | `x+/unconsume.tsx` | `evaluateLinesForSurface`; fn:`issue` | 119 |
| `mes.model.optimizeCancel` | `api+/model.optimize-cancel.ts` | 1 direct write | 54 |
| `mes.passkey.authenticate.verify` | `api+/passkey.authenticate.verify.ts` | 1 direct write | 153 |
| `mes.print` | `x+/print.tsx` | event | 37 |
| `mes.steps.inspection` | `x+/steps.inspection.tsx` | 1 direct write | 93 |
| `mes.unlock` | `_public+/unlock.tsx` | 1 direct write | 84 |

### resources (29)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `resources.maintenance.events.start`<br>`resources.maintenance.events.stop` | `x+/maintenance+/$dispatchId.events.tsx` | `postMaintenanceLabor`; 3 direct writes | 141 |
| `resources.training` | `share+/training.$id.tsx` | `insertTrainingCompletion`; 2 direct writes; event | 157 |
| `resources.maintenance.update` | `x+/maintenance+/update.tsx` | `postMaintenanceLabor`, `updateMaintenanceDispatch`; event | 127 |
| `resources.processes` | `x+/resources+/processes.$processId.tsx` | `upsertProcess`; 1 direct write; event | 100 |
| `resources.training.update` | `x+/training+/update.tsx` | 3 direct writes | 55 |
| `resources.abilities.create` | `x+/resources+/abilities.new.tsx` | 1 direct write; event | 63 |
| `resources.abilities.delete` | `x+/resources+/abilities.delete.$id.tsx` | `deleteAbility`; event | 40 |
| `resources.ability.employee.create` | `x+/resources+/ability.$id.employee.new.tsx` | `upsertEmployeeAbilityCell`; event | 56 |
| `resources.ability.employee.delete.employeeAbility.update` | `x+/resources+/ability.$id.employee.delete.$employeeAbilityId.tsx` | `deleteEmployeeAbility`; event | 34 |
| `resources.ability.employee.employeeAbility.update` | `x+/resources+/ability.$id.employee.$employeeAbilityId.tsx` | `upsertEmployeeAbilityCell`; event | 56 |
| `resources.assignments.assignment` | `x+/resources+/assignments.assignment.$assignmentId.tsx` | `upsertTrainingAssignment`; event | 67 |
| `resources.assignments.complete` | `x+/resources+/assignments.complete.tsx` | `insertTrainingCompletion`; event | 69 |
| `resources.assignments.create` | `x+/resources+/assignments.new.tsx` | `upsertTrainingAssignment`; event | 79 |
| `resources.locations` | `x+/resources+/locations.$locationId.tsx` | `invalidateLocationTimeZone`, `upsertLocation` | 41 |
| `resources.maintenance.create` | `x+/maintenance+/new.tsx` | `insertMaintenanceDispatch`; event | 63 |
| `resources.maintenance.event.create` | `x+/maintenance+/$dispatchId.event.new.tsx` | `postMaintenanceLabor`, `upsertMaintenanceDispatchEvent` | 70 |
| `resources.maintenance.event.delete` | `x+/maintenance+/$dispatchId.event.$eventId.delete.tsx` | `deleteMaintenanceDispatchEvent`, `postMaintenanceLabor` | 50 |
| `resources.maintenance.event.update` | `x+/maintenance+/$dispatchId.event.$eventId.tsx` | `postMaintenanceLabor`, `upsertMaintenanceDispatchEvent` | 71 |
| `resources.maintenance.setStatus` | `x+/maintenance+/$dispatchId.status.tsx` | `postMaintenanceLabor`; 1 direct write | 66 |
| `resources.person.ability.create` | `x+/resources+/person.$personId.ability.new.tsx` | `upsertEmployeeAbilityCell`; event | 53 |
| `resources.processes.create` | `x+/resources+/processes.new.tsx` | `upsertProcess`; 1 direct write | 71 |
| `resources.scheduledMaintenance` | `x+/resources+/scheduled-maintenance.$scheduleId.tsx` | `upsertMaintenanceSchedule`; event | 43 |
| `resources.scheduledMaintenance.create` | `x+/resources+/scheduled-maintenance.new.tsx` | `upsertMaintenanceSchedule`; event | 55 |
| `resources.suggestions.create` | `x+/resources+/suggestions.new.tsx` | 1 direct write; event | 88 |
| `resources.workCenters` | `x+/resources+/work-centers.$id.tsx` | `upsertWorkCenter`; event | 45 |
| `resources.workCenters.activate` | `x+/resources+/work-centers.activate.$id.tsx` | `activateWorkCenter`; event | 36 |
| `resources.workCenters.create` | `x+/resources+/work-centers.new.tsx` | `upsertWorkCenter`; event | 45 |
| `resources.workCenters.delete` | `x+/resources+/work-centers.delete.$id.tsx` | `deleteWorkCenter`; event | 36 |

### purchasing (23)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `purchasing.planning.update` | `x+/purchasing+/planning.update.tsx` | `applyPurchasingPlanningActions`, `assignPlanningActions`, `dismissPlanningActions`, `insertPurchaseOrder`, `planningPurchaseOrderWeek`, `reopenDismissedPlanningActions` +4; 3 direct writes | 1406 |
| `purchasing.purchaseOrder.update` ⚠ | `x+/purchase-order+/update.tsx` | 8 direct writes | 150 |
| `purchasing.purchasing.digitalQuote.decline`<br>`purchasing.purchasing.digitalQuote.submit`<br>`purchasing.purchasing.digitalQuote.updateNotes` | `api+/purchasing.digital-quote.$id.tsx` | 7 direct writes; event | 372 |
| `purchasing.purchaseOrder.finalize` | `x+/purchase-order+/$orderId.finalize.tsx` | `createApprovalRequest`, `finalizePurchaseOrder`, `updatePurchaseOrderStatus`, `upsertDocument`; fn:`update-purchased-prices`; event | 463 |
| `purchasing.purchaseOrder.setStatus` | `x+/purchase-order+/$orderId.status.tsx` | `reopenPurchaseOrderAsRevision`, `runMRP`, `updatePurchaseOrderStatus`; 3 direct writes | 246 |
| `purchasing.supplier.approval.requestApproval`<br>`purchasing.supplier.approval.makeInactive` | `x+/supplier+/$supplierId.approval.tsx` | `approveRequest`, `createApprovalRequest`, `rejectRequest`; 2 direct writes; event | 224 |
| `purchasing.purchaseOrder.update` ⚠ | `x+/purchase-order+/$orderId.tsx` | `approveRequest`, `rejectRequest`, `upsertDocument`; fn:`update-purchased-prices`; event | 333 |
| `purchasing.supplierQuote.update` | `x+/supplier-quote+/update.tsx` | 5 direct writes | 131 |
| `purchasing.purchaseReturnOrder.update` | `x+/purchase-return-order+/update.tsx` | 4 direct writes | 115 |
| `purchasing.supplierQuote.send` | `x+/supplier-quote+/$id.send.tsx` | `sendSupplierQuote`, `upsertExternalLink`; 1 direct write; event | 189 |
| `purchasing.purchaseReturnOrder.create` | `x+/purchase-return-order+/$id.new.tsx` | `setPurchaseReturnOrderLineTrackedEntities`, `upsertPurchaseReturnOrderLine`; 1 direct write | 138 |
| `purchasing.supplierQuote.finalize` | `x+/supplier-quote+/$id.finalize.tsx` | `finalizeSupplierQuote`, `upsertExternalLink`; 1 direct write | 83 |
| `purchasing.purchaseOrder.delete` | `x+/purchase-order+/$orderId.delete.tsx` | `deletePurchaseOrder`; 1 direct write | 133 |
| `purchasing.purchaseReturnOrder.confirm` | `x+/purchase-return-order+/$id.confirm.tsx` | `confirmPurchaseReturnOrder`, `generateAndAttachPurchaseReturnOrderPdf` | 81 |
| `purchasing.purchaseReturnOrder.line.update` | `x+/purchase-return-order+/$id.$lineId.details.tsx` | `setPurchaseReturnOrderLineTrackedEntities`, `upsertPurchaseReturnOrderLine` | 147 |
| `purchasing.purchaseReturnOrder.setStatus` | `x+/purchase-return-order+/$id.status.tsx` | `cancelPurchaseReturnOrder`, `reopenPurchaseReturnOrder` | 62 |
| `purchasing.purchasingRfq.cancel` | `x+/purchasing-rfq+/$rfqId.cancel.tsx` | `updatePurchasingRFQStatus`, `updateSupplierQuoteStatus` | 42 |
| `purchasing.purchasingRfq.create` | `x+/purchasing-rfq+/new.tsx` | `insertPurchasingRFQ`, `upsertPurchasingRFQSuppliers` | 54 |
| `purchasing.purchasingRfq.finalize` | `x+/purchasing-rfq+/$rfqId.finalize.tsx` | `finalizePurchasingRfq`; event | 205 |
| `purchasing.purchasingRfq.update` | `x+/purchasing-rfq+/update.tsx` | `upsertPurchasingRFQSuppliers`; 1 direct write | 66 |

### items (22)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `items.update` | `x+/items+/update.tsx` | `cascadeItemTrackingType`, `unreleasedChangeOrderItemsMessage`, `updateItemMethodAndSourcing`, `updateMaterialProperties`, `updateServiceName`; 13 direct writes | 511 |
| `items.changeNotice.setStatus` | `x+/items+/change-notice+/$id.status.tsx` | `applyChangeNotice`, `updateChangeNoticeStatus`; event | 77 |
| `items.part.planning` | `x+/part+/$itemId.planning.tsx` | `replanAfterItemChange`, `upsertItemPlanning`, `upsertItemSupersession` | 181 |
| `items.part.update` | `x+/part+/$itemId.details.tsx` | `replanAfterItemChange`, `upsertItemManufacturing`, `upsertPart` | 84 |
| `items.tool.update` | `x+/tool+/$itemId.details.tsx` | `replanAfterItemChange`, `upsertItemManufacturing`, `upsertTool` | 83 |
| `items.changeNotice.create` | `x+/change-notice+/new.tsx` | `addChangeNoticeAffectedItem`, `insertChangeNotice` | 94 |
| `items.changeNotice.newFromItem` | `x+/items+/change-notice+/new-from-item.$itemId.tsx` | `addChangeNoticeAffectedItem`, `insertChangeNotice` | 69 |
| `items.consumable.planning` | `x+/consumable+/$itemId.planning.tsx` | `replanAfterItemChange`, `upsertItemPlanning` | 69 |
| `items.consumable.purchasing.create` | `x+/consumable+/$itemId.purchasing.new.tsx` | `upsertSupplierPart`; 1 direct write | 68 |
| `items.material.planning` | `x+/material+/$itemId.planning.tsx` | `replanAfterItemChange`, `upsertItemPlanning` | 66 |
| `items.material.purchasing.create` | `x+/material+/$itemId.purchasing.new.tsx` | `upsertSupplierPart`; 1 direct write | 68 |
| `items.methods.get` | `x+/items+/methods+/get.tsx` | `copyItem`, `copyMakeMethod` | 54 |
| `items.methods.save` | `x+/items+/methods+/save.tsx` | `copyItem`, `copyMakeMethod` | 54 |
| `items.methods.version.create` | `x+/items+/methods+/version.new.tsx` | `copyMakeMethod`, `upsertMakeMethodVersion` | 73 |
| `items.part.create` | `x+/part+/new.tsx` | `upsertPart`; event | 49 |
| `items.part.purchasing.create` | `x+/part+/$itemId.purchasing.new.tsx` | `upsertSupplierPart`; 1 direct write | 71 |
| `items.part.sales` | `x+/part+/$itemId.sales.tsx` | `upsertItemRentalRate`, `upsertItemUnitSalePrice` | 74 |
| `items.service.purchasing.create` | `x+/service+/$itemId.purchasing.new.tsx` | `upsertSupplierPart`; 1 direct write | 71 |
| `items.tool.planning` | `x+/tool+/$itemId.planning.tsx` | `replanAfterItemChange`, `upsertItemPlanning` | 66 |
| `items.tool.purchasing.create` | `x+/tool+/$itemId.purchasing.new.tsx` | `upsertSupplierPart`; 1 direct write | 71 |
| `items.items.recalculateCost` | `api+/items.$itemId.recalculate-cost.ts` | 1 direct write | 163 |
| `items.methods.operation.delete` | `x+/items+/methods+/operation.delete.tsx` | 1 direct write | 49 |

### quality (22)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `quality.issue.association.create` | `x+/issue+/$id.association.new.tsx` | `linkEntitiesToIssueItemRow`; 13 direct writes | 459 |
| `quality.inspection.reject` | `x+/inspection+/$id.reject.tsx` | `deleteIssue`, `dispositionInspection`, `insertIssue`; fn:`create`, fn:`post-nonconformance`; 2 direct writes; event | 396 |
| `quality.issue.create` | `x+/issue+/new.tsx` | `deleteIssue`, `insertIssue`, `linkEntitiesToIssueItemRow`, `updateChangeNotice`; fn:`create`; 2 direct writes; event | 179 |
| `quality.qualityDocument.update` ⚠ | `x+/quality-document+/update.tsx` | `createApprovalRequest`; 5 direct writes; event | 97 |
| `quality.inspectionDocument.save` | `x+/inspection-document+/$id.save.tsx` | `mergeInspectionBalloonsPayload`, `mergeInspectionFeaturesPayload`, `saveInspectionDocumentAtomic`, `translateLegacyInspectionSavePayload`, `updateInspectionDocumentSampling` | 211 |
| `quality.integrations.slack.interactive` | `api+/integrations.slack.interactive.ts` | `createIssueSlackThread`, `createSlackWebClient`, `insertIssue`; fn:`create`; 1 direct write | 120 |
| `quality.issue.supplierReturn` | `x+/issue+/$id.supplier-return.tsx` | `deletePurchaseReturnOrder`, `insertPurchaseReturnOrder`, `setPurchaseReturnOrderLineTrackedEntities`, `upsertPurchaseReturnOrderLine`; 1 direct write | 442 |
| `quality.issue.update` | `x+/issue+/update.tsx` | fn:`create`; 2 direct writes | 111 |
| `quality.qualityDocument.update` ⚠ | `x+/quality-document+/$id.tsx` | `approveRequest`, `rejectRequest`; event | 119 |
| `quality.issue.close` | `x+/issue+/$id.close.tsx` | `closeIssue`; event | 48 |
| `quality.issue.setStatus` | `x+/issue+/$id.status.tsx` | `updateIssueStatus`; event | 96 |
| `quality.issue.task.setStatus` | `x+/issue+/task.$id.status.tsx` | `updateIssueTaskStatus`; event | 59 |
| `quality.item.update` | `x+/issue+/item+/update.tsx` | `updateIssueItemQuantity`; 1 direct write | 101 |
| `quality.risks` | `x+/quality+/risks.$id.tsx` | `upsertRisk`; event | 63 |
| `quality.risks.create` | `x+/quality+/risks.new.tsx` | `upsertRisk`; event | 56 |
| `quality.scar` | `share+/scar.$id.tsx` | `updateIssueTaskContent`, `updateIssueTaskStatus` | 105 |
| `quality.inspectionDocument.updateName` | `x+/inspection-document+/$id.update-name.tsx` | 1 direct write | 27 |
| `quality.issue.action.dueDate` | `x+/issue+/action.$id.due-date.tsx` | 1 direct write | 24 |
| `quality.issue.actionTasks.order` | `x+/issue+/action-tasks.order.tsx` | 1 direct write | 39 |
| `quality.issue.task.supplier` | `x+/issue+/task.supplier.tsx` | 1 direct write | 60 |
| `quality.issueWorkflow.update` | `x+/issue-workflow+/update.tsx` | 1 direct write | 29 |
| `quality.quality.documents.seed` | `api+/quality.documents.seed.ts` | 1 direct write | 52 |

### accounting (21)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `accounting.periods.close.completeTask`<br>`accounting.periods.close.skipTask`<br>`accounting.periods.close.lock`<br>`accounting.periods.close.unlock`<br>`accounting.periods.close.createRevenueRun`<br>`accounting.periods.close.createDepreciationRun`<br>`accounting.periods.close.close` | `x+/accounting+/periods.$periodId.close.tsx` | `closePeriodWithChecklist`, `completeCloseTask`, `createDepreciationRun`, `futureRunPeriodError`, `lockAccountingPeriod`, `skipCloseTask` +1; fn:`propose-revenue-recognition-run` | 225 |
| `accounting.depreciationRun.post` | `x+/depreciation-run+/$depreciationRunId.post.tsx` | `depreciationRunLinesMatch`, `futureRunPeriodError`, `postDepreciationRun` | 241 |
| `accounting.exchangeRates.override`<br>`accounting.exchangeRates.reset` | `x+/accounting+/exchange-rates.$currencyId.tsx` | `deleteExchangeRateOverride`, `upsertCurrency`, `upsertExchangeRateOverride` | 125 |
| `accounting.revenueRecognitionRun.post` | `x+/revenue-recognition-run+/$runId.post.tsx` | `futureRunPeriodError`, `monthEndOf`, `postRevenueRecognitionRun` | 125 |
| `accounting.depreciationRuns.create` | `x+/accounting+/depreciation-runs.new.tsx` | `createDepreciationRun`, `futureRunPeriodError` | 84 |
| `accounting.fixedAsset.outOfService` | `x+/fixed-asset+/$fixedAssetId.out-of-service.tsx` | `returnFixedAssetToService`, `setFixedAssetOutOfService` | 71 |
| `accounting.fixedAsset.purchase` | `x+/fixed-asset+/$fixedAssetId.purchase.tsx` | `insertPurchaseOrder`, `upsertPurchaseOrderLine` | 79 |
| `accounting.fixedAsset.sell` | `x+/fixed-asset+/$fixedAssetId.sell.tsx` | `insertSalesOrder`; 1 direct write | 74 |
| `accounting.journalEntry.update` | `x+/journal-entry+/$journalEntryId.details.tsx` | `postJournalEntry`, `saveJournalEntryWithLines` | 103 |
| `accounting.reports.analytics.saveView`<br>`accounting.reports.analytics.deleteView` | `x+/reports+/analytics.$reportKey.tsx` | `deleteReportView`, `upsertReportView` | 86 |
| `accounting.revenueRecognitionRun.repeat` | `x+/revenue-recognition-run+/$runId.repeat.tsx` | `futureRunPeriodError`; fn:`propose-revenue-recognition-run` | 96 |
| `accounting.revenueRecognitionRuns.create` | `x+/accounting+/revenue-recognition-runs.new.tsx` | `futureRunPeriodError`; fn:`propose-revenue-recognition-run` | 98 |
| `accounting.charts.move` | `x+/accounting+/charts.move.$accountId.tsx` | 1 direct write | 67 |

### inventory (20)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `inventory.shipment.post` | `x+/shipment+/$shipmentId.post.tsx` | `dedupeViolations`, `evaluateLinesForSurface`, `evaluateSalesRuleLines`, `recordSalesRuleOutcome`, `upsertDocument`; fn:`post-shipment`; 3 direct writes; event | 459 |
| `inventory.receipt.post` | `x+/receipt+/$receiptId.post.tsx` | `dedupeViolations`, `evaluateLinesForSurface`, `reconcileReceiptSerialEntities`; fn:`post-receipt`, fn:`update-purchased-prices`; 3 direct writes; event | 313 |
| `inventory.receipt.lines.tracking` | `x+/receipt+/lines.tracking.tsx` | 5 direct writes | 394 |
| `inventory.inventoryCount.create` | `x+/inventory+/inventory-count.new.tsx` | `deleteInventoryCount`, `generateInventoryCountLines`, `insertInventoryCount` | 83 |
| `inventory.quantities.adjustment` | `x+/inventory+/quantities+/$itemId.adjustment.tsx` | `dedupeViolations`, `evaluateLinesForSurface`, `insertManualInventoryAdjustment` | 118 |
| `inventory.receipt.update` | `x+/receipt+/$receiptId.details.tsx` | `upsertReceipt`; fn:`create` | 151 |
| `inventory.shipment.lines.tracking` | `x+/shipment+/lines.tracking.tsx` | 2 direct writes | 249 |
| `inventory.shipment.update` | `x+/shipment+/$shipmentId.details.tsx` | `upsertShipment`; fn:`create` | 244 |
| `inventory.stockTransfer.create` | `x+/stock-transfer+/new.tsx` | `evaluateLinesForSurface`, `insertStockTransfer` | 66 |
| `inventory.stockTransfer.line.quantity` | `x+/stock-transfer+/$id.line.quantity.tsx` | fn:`post-stock-transfer`; event | 154 |
| `inventory.stockTransfer.scan.line.update` | `x+/stock-transfer+/$id.scan.$lineId.tsx` | fn:`post-stock-transfer`; event | 154 |
| `inventory.stockTransfer.setStatus` | `x+/stock-transfer+/$id.status.tsx` | `evaluateLinesForSurface`, `updateStockTransferStatus` | 98 |
| `inventory.storageUnits.delete` | `x+/inventory+/storage-units.delete.$storageUnitId.tsx` | `deleteStorageUnit`, `deleteStorageUnitCascade` | 42 |
| `inventory.warehouseTransfer.setStatus` | `x+/warehouse-transfer+/$transferId.status.tsx` | `evaluateLinesForSurface`, `updateWarehouseTransferStatus` | 92 |
| `inventory.warehouseTransfer.update` | `x+/warehouse-transfer+/$transferId.details.$id.tsx` | `deleteWarehouseTransferLine`, `upsertWarehouseTransferLine` | 87 |
| `inventory.receipt.fixedAssetLines.update` | `x+/receipt+/fixed-asset-lines.update.tsx` | 1 direct write | 71 |
| `inventory.receipt.lines.update` | `x+/receipt+/lines.update.tsx` | 1 direct write | 37 |
| `inventory.shipment.fixedAssetLines.update` | `x+/shipment+/fixed-asset-lines.update.tsx` | 1 direct write | 51 |
| `inventory.shipment.lines.update` | `x+/shipment+/lines.update.tsx` | 1 direct write | 37 |
| `inventory.stockTransfer.lines.update` | `x+/stock-transfer+/lines.update.tsx` | 1 direct write | 62 |

### api (18)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `api.integrations.onshape.sync` | `api+/integrations.onshape.sync.ts` | fn:`sync`; 2 direct writes | 86 |
| `api.webhook.ramp` | `api+/webhook.ramp.$companyId.ts` | `completeWebhookVerification`, `verifyRampWebhookSignature`; event | 75 |
| `api.model.reoptimize` | `api+/model.reoptimize.ts` | 1 direct write; event | 38 |
| `api.model.thumbnail` | `api+/model.thumbnail.ts` | 1 direct write; event | 44 |
| `api.webhook.quickbooks` | `api+/webhook.quickbooks.$companyId.ts` | 1 direct write; event | 229 |
| `api.webhook.xero` | `api+/webhook.xero.ts` | 1 direct write; event | 294 |
| `api.assembler.callback` | `api+/assembler.callback.ts` | event | 36 |
| `api.csv.createLookup` | `api+/csv+/create-lookup.tsx` | 1 direct write | 56 |
| `api.inngest` | `api+/inngest.ts` | 1 direct write | 19 |
| `api.integrations.journalBackfill` | `api+/integrations.journal-backfill.ts` | event | 45 |
| `api.integrations.masterSync` | `api+/integrations.master-sync.ts` | event | 79 |
| `api.integrations.mount.publish` | `api+/integrations.mount.publish.ts` | event | 39 |
| `api.integrations.onshape.backfill` | `api+/integrations.onshape.backfill.ts` | event | 33 |
| `api.integrations.stripeConnect.connect` | `api+/integrations.stripe-connect.connect.ts` | 1 direct write | 3 |
| `api.messaging.notify` | `api+/messaging.notify.ts` | event | 73 |
| `api.model.optimizeCancel` | `api+/model.optimize-cancel.ts` | 1 direct write | 57 |
| `api.passkey.register.verify` | `api+/passkey.register.verify.ts` | 1 direct write | 49 |
| `api.webhook.onshape` | `api+/webhook.onshape.$companyId.ts` | event | 142 |

### invoicing (16)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `invoicing.salesInvoice.post` | `x+/sales-invoice+/$invoiceId.post.tsx` | `createMappingService`, `dedupeViolations`, `evaluateSalesRulesForSalesDocument`, `recordSalesRuleOutcome`, `upsertDocument`; fn:`post-sales-invoice`; 4 direct writes; event | 577 |
| `invoicing.salesInvoice.update` | `x+/sales-invoice+/update.tsx` | `salesInvoiceCustomerChange`; 7 direct writes | 198 |
| `invoicing.purchaseInvoice.post` | `x+/purchase-invoice+/$invoiceId.post.tsx` | fn:`post-purchase-invoice`, fn:`update-purchased-prices`; 4 direct writes | 166 |
| `invoicing.purchaseInvoice.update` | `x+/purchase-invoice+/update.tsx` | `purchaseInvoiceSupplierChange`; 5 direct writes | 165 |
| `invoicing.reimbursements.update` | `x+/reimbursements+/$reimbursementId.edit.tsx` | `linesBalanceHeader`, `postReimbursement`, `updateReimbursement`, `upsertReimbursementLines` | 135 |
| `invoicing.salesInvoice.create` | `x+/sales-invoice+/$invoiceId.new.tsx` | `dedupeViolations`, `evaluateSalesRuleLines`, `recordSalesRuleOutcome`, `upsertSalesInvoiceLine` | 142 |
| `invoicing.salesInvoice.line.update` | `x+/sales-invoice+/$invoiceId.$lineId.details.tsx` | `dedupeViolations`, `evaluateSalesRuleLines`, `recordSalesRuleOutcome`, `upsertSalesInvoiceLine` | 157 |
| `invoicing.purchaseInvoice.create` | `x+/purchase-invoice+/new.tsx` | `insertPurchaseInvoice`, `upsertDocument`, `upsertPurchaseInvoiceLine` | 155 |
| `invoicing.reimbursements.pay` | `x+/reimbursements+/$reimbursementId.pay.tsx` | `replaceInvoiceSettlements`, `upsertPayment`; fn:`post-payment` | 177 |
| `invoicing.credits.delete` | `x+/credits+/$memoId.delete.tsx` | `deleteMemo`, `deleteRentalCreditMemoReleasingPeriods` | 62 |
| `invoicing.payables.adjust` | `x+/invoicing+/payables.adjust.tsx` | `saveJournalEntryWithLines`; fn:`create` | 94 |
| `invoicing.payments.create` | `x+/payments+/new.tsx` | `replaceInvoiceSettlements`, `upsertPayment` | 163 |
| `invoicing.purchaseInvoice.mapLines` | `api+/purchase-invoice.$invoiceId.map-lines.ts` | `upsertPart`; 1 direct write | 131 |
| `invoicing.receivables.adjust` | `x+/invoicing+/receivables.adjust.tsx` | `saveJournalEntryWithLines`; fn:`create` | 96 |
| `invoicing.reimbursements.post` | `x+/reimbursements+/$reimbursementId.post.tsx` | `linesBalanceHeader`, `postReimbursement` | 68 |
| `invoicing.salesInvoice.send` | `x+/sales-invoice+/$invoiceId.send.tsx` | event | 63 |

### users (12)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `users.invite` | `_public+/invite.$code.tsx` | `acceptInvite`, `insertAuditLogEntries`; 1 direct write; event | 90 |
| `users.employees.create` | `x+/users+/employees.new.tsx` | `companyHasFeature`, `createEmployeeAccount`; event | 134 |
| `users.groups.create` | `x+/users+/groups.new.tsx` | `deleteGroup`, `insertGroup`, `upsertGroupMembers` | 54 |
| `users.operators.create` | `x+/users+/operators.new.tsx` | `createConsoleOperator`, `generateConsolePin`, `setEmployeePin` | 90 |
| `users.customers.create` | `x+/users+/customers.new.tsx` | `createCustomerAccount`; event | 89 |
| `users.employeeTypes` | `x+/users+/employee-types.$employeeTypeId.tsx` | `upsertEmployeeType`, `upsertEmployeeTypePermissions` | 78 |
| `users.employeeTypes.create` | `x+/users+/employee-types.new.tsx` | `insertEmployeeType`, `upsertEmployeeTypePermissions` | 89 |
| `users.groups` | `x+/users+/groups.$groupId.tsx` | `upsertGroup`, `upsertGroupMembers` | 41 |
| `users.operators.resetPin` | `x+/users+/operators.reset-pin.$operatorId.tsx` | `generateConsolePin`, `setEmployeePin` | 32 |
| `users.resendInvite` | `x+/users+/resend-invite.tsx` | 1 direct write; event | 139 |
| `users.revokeInvite` | `x+/users+/revoke-invite.tsx` | `insertAuditLogEntries`; 1 direct write | 119 |
| `users.suppliers.create` | `x+/users+/suppliers.new.tsx` | `createSupplierAccount`; event | 89 |

### people (9)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `people.person.timecard.clockIn`<br>`people.person.timecard.clockOut`<br>`people.person.timecard.updateEntry`<br>`people.person.timecard.deleteEntry`<br>`people.person.timecard.addEntry` | `x+/person+/$personId.timecard.tsx` | `clockIn`, `clockOut`, `deleteTimeCardEntry`, `updateTimeCardEntry`; 1 direct write | 116 |
| `people.people.timecard.clockIn`<br>`people.people.timecard.clockOut` | `api+/people.timecard.ts` | `clockIn`, `clockOut` | 30 |
| `people.person.job` | `x+/person+/$personId.job.tsx` | `updateEmployeeJob`; event | 39 |
| `people.shifts` | `x+/people+/shifts.$shiftId.tsx` | `upsertShift`; event | 37 |

### shared (9)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `shared.integrations.jira.issue.link` | `api+/integrations.jira.issue.link.ts` | `actionTaskParentId`, `actionTaskPermissions`, `linkActionToJiraIssue`, `tiptapToAdf`, `unlinkActionFromJiraIssue` | 171 |
| `shared.integrations.jira.issue.create` | `api+/integrations.jira.issue.create.ts` | `actionTaskParentId`, `actionTaskPermissions`, `linkActionToJiraIssue`, `tiptapToAdf` | 139 |
| `shared.integrations.linear.issue.link` | `api+/integrations.linear.issue.link.ts` | `actionTaskParentId`, `actionTaskPermissions`, `linkActionToLinearIssue`, `unlinkActionFromLinearIssue` | 132 |
| `shared.integrations.linear.issue.create` | `api+/integrations.linear.issue.create.ts` | `actionTaskParentId`, `actionTaskPermissions`, `linkActionToLinearIssue` | 84 |
| `shared.assign` | `api+/assign.ts` | `assign`; event | 76 |
| `shared.import` | `x+/shared+/import.$tableId.tsx` | `importCsv`, `importQuotes` | 104 |
| `shared.integrations.jira.issue.syncNotes` | `api+/integrations.jira.issue.sync-notes.ts` | `actionTaskPermissions`, `tiptapToAdf` | 85 |
| `shared.integrations.linear.issue.syncNotes` | `api+/integrations.linear.issue.sync-notes.ts` | `actionTaskPermissions`, `tiptapToMarkdown` | 86 |
| `shared.getStarted.enroll` | `x+/get-started+/enroll.tsx` | event | 93 |

### unassigned (4)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `unassigned.acknowledge.itarEntity`<br>`unassigned.acknowledge.itarUser`<br>`unassigned.acknowledge.flag` | `x+/acknowledge.tsx` | `insertAuditLogEntries`; 2 direct writes | 147 |
| `unassigned.print` | `x+/print.tsx` | event | 37 |

### auth (4)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `auth.token` | `_oauth+/token.tsx` | 4 direct writes | 239 |
| `auth.authorize` | `_oauth+/authorize.tsx` | 1 direct write | 109 |
| `auth.register` | `_oauth+/register.ts` | 1 direct write | 91 |
| `auth.unlock` | `_public+/unlock.tsx` | 1 direct write | 75 |

### workflows (2)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `workflows.create` | `x+/workflows+/new.tsx` | `createNode`, `insertWorkflow`, `insertWorkflowVersion` | 61 |
| `workflows.delete` | `x+/workflows+/delete.$id.tsx` | `deleteWorkflow`, `syncAfterWorkflowDelete` | 32 |

### account (2)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `account.profile` | `x+/account+/profile.tsx` | `updateAvatar`, `updatePublicAccount` | 91 |
| `account.security` | `x+/account+/security.tsx` | 2 direct writes | 59 |

### agent (2)

| Proposed names | Route | Composes today | Action lines |
|---|---|---|---|
| `agent.chat` | `api+/agent+/chat.ts` | `companyHasFeature`, `saveUserMessage`, `streamChat` | 100 |
| `agent.threads` | `api+/agent+/threads.ts` | `createThread`, `deleteThread` | 27 |

⚠ marks a name the rules produced for more than one action. Those need a hand-picked name.

## 4. Existing functions that routes call, by module

These already exist and a route calls each one directly. Under the pattern they are the functions to expose. **Namespaced** is the existing name rearranged as `module.entity.verb`; it is mechanical. **Tag** is the function's `@mcp` verb today, or blank when it is not published.

### account

11 of 15 functions are called by a route. The other 4 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 11 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `updatePublicAccount` | `account.publicAccount.update` |  | 3 | update | `account.service.ts` |
| `getAccount` | `account.account.get` | 2 |  | read | `account.service.ts` |
| `deleteUserAttributeValue` | `account.userAttributeValue.delete` |  | 1 | delete | `account.service.ts` |
| `getAllAttributeCategories` | `account.allAttributeCategories.get` | 1 |  | read | `account.service.ts` |
| `getAttributeCategoryWithValues` | `account.attributeCategoryWithValues.get` | 1 |  | read | `account.service.ts` |
| `getCachedChangelogPanelEntry` | `account.cachedChangelogPanelEntry.get` | 1 |  |  | `account.server.ts` |
| `getCurrentUser` | `account.currentUser.get` |  | 1 | read | `account.service.ts` |
| `getNotificationPreferences` | `account.notificationPreferences.get` | 1 |  | read | `account.service.ts` |
| `updateAvatar` | `account.avatar.update` |  | 1 | update | `account.service.ts` |
| `upsertNotificationPreference` | `account.notificationPreference.upsert` |  | 1 | upsert | `account.service.ts` |
| `upsertUserAttributeValue` | `account.userAttributeValue.upsert` |  | 1 | upsert | `account.service.ts` |

</details>

### accounting

137 of 176 functions are called by a route. The other 39 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 137 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getExchangeRate` | `accounting.exchangeRate.get` | 2 | 19 | read | `accounting.service.ts` |
| `getFixedAsset` | `accounting.fixedAsset.get` | 12 | 3 | read | `accounting.service.ts` |
| `getCurrencyByCode` | `accounting.currencyByCode.get` | 10 | 3 | read | `accounting.service.ts` |
| `getDefaultAccounts` | `accounting.defaultAccounts.get` | 8 | 3 | read | `accounting.service.ts` |
| `getFiscalYearSettings` | `accounting.fiscalYearSettings.get` | 9 | 1 | read | `accounting.service.ts` |
| `getAccount` | `accounting.account.get` | 7 | 2 | read | `accounting.service.ts` |
| `getCompaniesInGroup` | `accounting.companiesInGroup.get` | 7 |  | read | `accounting.service.ts` |
| `getPaymentTermsList` | `accounting.paymentTermsList.get` | 5 | 2 | read | `accounting.service.ts` |
| `futureRunPeriodError` | `accounting.futureRunPeriodError` |  | 6 |  | `accounting.server.ts` |
| `getAccountsList` | `accounting.accountsList.get` | 5 |  | read | `accounting.service.ts` |
| `invokeAssetTransfer` | `accounting.invokeAssetTransfer` |  | 5 | action | `accounting.service.ts` |
| `getAccountLedger` | `accounting.accountLedger.get` | 4 |  | read | `accounting.service.ts` |
| `getAccountLedgerSummary` | `accounting.accountLedgerSummary.get` | 4 |  | read | `accounting.service.ts` |
| `getActiveDimensionsWithValues` | `accounting.activeDimensionsWithValues.get` | 4 |  | read | `accounting.service.ts` |
| `getGroupAccounts` | `accounting.groupAccounts.get` | 4 |  | read | `accounting.service.ts` |
| `buildDepreciationRunLines` | `accounting.buildDepreciationRunLines` |  | 3 |  | `accounting.service.ts` |
| `getConsolidatedAccountLedger` | `accounting.consolidatedAccountLedger.get` | 3 |  |  | `accounting.server.ts` |
| `getConsolidatedPeriodSeriesForReport` | `accounting.consolidatedPeriodSeriesForReport.get` | 3 |  |  | `accounting.server.ts` |
| `getFinancialStatementPeriodSeries` | `accounting.financialStatementPeriodSeries.get` | 3 |  | read | `accounting.service.ts` |
| `getFixedAssetClassesList` | `accounting.fixedAssetClassesList.get` | 3 |  | read | `accounting.service.ts` |
| `getPaymentTerm` | `accounting.paymentTerm.get` | 3 |  | read | `accounting.service.ts` |
| `saveJournalEntryWithLines` | `accounting.saveJournalEntryWithLines` |  | 3 | action | `accounting.service.ts` |
| `upsertAccount` | `accounting.account.upsert` |  | 3 | upsert | `accounting.service.ts` |
| `createDepreciationRun` | `accounting.depreciationRun.create` |  | 2 |  | `accounting.service.ts` |
| `deleteReportView` | `accounting.reportView.delete` |  | 2 | delete | `accounting.service.ts` |
| `getAccountingPeriods` | `accounting.accountingPeriods.get` | 2 |  | read | `accounting.service.ts` |
| `getCostCenter` | `accounting.costCenter.get` | 2 |  | read | `accounting.service.ts` |
| `getCurrenciesList` | `accounting.currenciesList.get` | 2 |  | read | `accounting.service.ts` |
| `getDepreciationRun` | `accounting.depreciationRun.get` | 2 |  | read | `accounting.service.ts` |
| `getDimension` | `accounting.dimension.get` | 2 |  | read | `accounting.service.ts` |
| `getExchangeRates` | `accounting.exchangeRates.get` | 2 |  | read | `accounting.service.ts` |
| `getFiscalCalendarCommitted` | `accounting.fiscalCalendarCommitted.get` | 1 | 1 | read | `accounting.service.ts` |
| `getFixedAssetCipCosts` | `accounting.fixedAssetCipCosts.get` | 2 |  | read | `accounting.service.ts` |
| `getFixedAssetClass` | `accounting.fixedAssetClass.get` | 2 |  | read | `accounting.service.ts` |
| `getFixedAssets` | `accounting.fixedAssets.get` | 2 |  | read | `accounting.service.ts` |
| `getOrCreateAccountingPeriod` | `accounting.orCreateAccountingPeriod.get` |  | 2 | action | `accounting.service.ts` |
| `getPeriodRunRelatedItems` | `accounting.periodRunRelatedItems.get` | 2 |  | read | `accounting.service.ts` |
| `getProject` | `accounting.project.get` | 2 |  | read | `accounting.service.ts` |
| `getReportViews` | `accounting.reportViews.get` | 2 |  | read | `accounting.service.ts` |
| `getRevenueRecognitionRun` | `accounting.revenueRecognitionRun.get` | 2 |  | read | `accounting.service.ts` |
| `getScrapAccountIds` | `accounting.scrapAccountIds.get` | 2 |  | read | `accounting.service.ts` |
| `postJournalEntry` | `accounting.journalEntry.post` |  | 2 | action | `accounting.service.ts` |
| `resolveReversalPeriods` | `accounting.reversalPeriods.resolve` |  | 2 |  | `accounting.server.ts` |
| `resolveRunPostingPeriods` | `accounting.runPostingPeriods.resolve` |  | 2 |  | `accounting.server.ts` |
| `upsertCostCenter` | `accounting.costCenter.upsert` |  | 2 | upsert | `accounting.service.ts` |
| `upsertDimension` | `accounting.dimension.upsert` |  | 2 | upsert | `accounting.service.ts` |
| `upsertFixedAssetClass` | `accounting.fixedAssetClass.upsert` |  | 2 | upsert | `accounting.service.ts` |
| `upsertPaymentTerm` | `accounting.paymentTerm.upsert` |  | 2 | upsert | `accounting.service.ts` |
| `upsertProject` | `accounting.project.upsert` |  | 2 | upsert | `accounting.service.ts` |
| `applyCtaToReportPeriodSeriesForReport` | `accounting.ctaToReportPeriodSeriesForReport.apply` | 1 |  |  | `accounting.server.ts` |
| `closePeriodWithChecklist` | `accounting.periodWithChecklist.close` |  | 1 | update | `accounting.service.ts` |
| `completeCloseTask` | `accounting.closeTask.complete` |  | 1 | action | `accounting.service.ts` |
| `createFiscalYearPeriods` | `accounting.fiscalYearPeriods.create` |  | 1 | create | `accounting.service.ts` |
| `createIntercompanyTransaction` | `accounting.intercompanyTransaction.create` |  | 1 | create | `accounting.service.ts` |
| `createOpeningBalanceJournal` | `accounting.openingBalanceJournal.create` |  | 1 | create | `accounting.service.ts` |
| `deleteAccount` | `accounting.account.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteAccountingPeriod` | `accounting.accountingPeriod.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteCostCenter` | `accounting.costCenter.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteDepreciationRun` | `accounting.depreciationRun.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteDimension` | `accounting.dimension.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteExchangeRateOverride` | `accounting.exchangeRateOverride.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteFixedAsset` | `accounting.fixedAsset.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteFixedAssetClass` | `accounting.fixedAssetClass.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteJournalEntry` | `accounting.journalEntry.delete` |  | 1 | delete | `accounting.service.ts` |
| `deletePaymentTerm` | `accounting.paymentTerm.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteProject` | `accounting.project.delete` |  | 1 | delete | `accounting.service.ts` |
| `deleteRevenueRecognitionRun` | `accounting.revenueRecognitionRun.delete` |  | 1 |  | `accounting.server.ts` |
| `generateEliminations` | `accounting.eliminations.generate` |  | 1 | create | `accounting.service.ts` |
| `getAccountingPeriodDeletability` | `accounting.accountingPeriodDeletability.get` | 1 |  | read | `accounting.service.ts` |
| `getAccountingSyncTieOut` | `accounting.accountingSyncTieOut.get` | 1 |  | read | `accounting.service.ts` |
| `getAccountingSyncTieOutCell` | `accounting.accountingSyncTieOutCell.get` | 1 |  | read | `accounting.service.ts` |
| `getAccountsInScope` | `accounting.accountsInScope.get` | 1 |  | read | `accounting.service.ts` |
| `getAssetDepreciationHistory` | `accounting.assetDepreciationHistory.get` | 1 |  | read | `accounting.service.ts` |
| `getBaseCurrency` | `accounting.baseCurrency.get` | 1 |  | read | `accounting.service.ts` |
| `getCapitalizationCost` | `accounting.capitalizationCost.get` | 1 |  |  | `accounting.service.ts` |
| `getChartOfAccounts` | `accounting.chartOfAccounts.get` | 1 |  | read | `accounting.service.ts` |
| `getCompanyToday` | `accounting.companyToday.get` | 1 |  |  | `accounting.server.ts` |
| `getConsolidatedBalancesForReport` | `accounting.consolidatedBalancesForReport.get` | 1 |  |  | `accounting.server.ts` |
| `getCostCentersList` | `accounting.costCentersList.get` | 1 |  | read | `accounting.service.ts` |
| `getCostCentersTree` | `accounting.costCentersTree.get` | 1 |  | read | `accounting.service.ts` |
| `getCurrencies` | `accounting.currencies.get` | 1 |  | read | `accounting.service.ts` |
| `getCurrency` | `accounting.currency.get` | 1 |  | read | `accounting.service.ts` |
| `getDeferredRevenueWaterfall` | `accounting.deferredRevenueWaterfall.get` | 1 |  | read | `accounting.service.ts` |
| `getDepreciationRunLines` | `accounting.depreciationRunLines.get` | 1 |  | read | `accounting.service.ts` |
| `getDepreciationRuns` | `accounting.depreciationRuns.get` | 1 |  | read | `accounting.service.ts` |
| `getDimensionPivot` | `accounting.dimensionPivot.get` | 1 |  | read | `accounting.service.ts` |
| `getDimensionPivotLines` | `accounting.dimensionPivotLines.get` | 1 |  | read | `accounting.service.ts` |
| `getDimensions` | `accounting.dimensions.get` | 1 |  | read | `accounting.service.ts` |
| `getExchangeRateHistory` | `accounting.exchangeRateHistory.get` | 1 |  | read | `accounting.service.ts` |
| `getExistingOpeningBalanceEntry` | `accounting.existingOpeningBalanceEntry.get` | 1 |  | read | `accounting.service.ts` |
| `getFinancialStatementBalances` | `accounting.financialStatementBalances.get` | 1 |  | read | `accounting.service.ts` |
| `getFixedAssetClasses` | `accounting.fixedAssetClasses.get` | 1 |  | read | `accounting.service.ts` |
| `getFixedAssetDisposal` | `accounting.fixedAssetDisposal.get` | 1 |  | read | `accounting.service.ts` |
| `getFixedAssetRelatedItems` | `accounting.fixedAssetRelatedItems.get` | 1 |  |  | `accounting.service.ts` |
| `getFixedAssetTransfers` | `accounting.fixedAssetTransfers.get` | 1 |  | read | `accounting.service.ts` |
| `getFleetAssets` | `accounting.fleetAssets.get` | 1 |  | read | `accounting.service.ts` |
| `getIntercompanyTransactions` | `accounting.intercompanyTransactions.get` | 1 |  | read | `accounting.service.ts` |
| `getJournalEntries` | `accounting.journalEntries.get` | 1 |  | read | `accounting.service.ts` |
| `getJournalEntry` | `accounting.journalEntry.get` | 1 |  | read | `accounting.service.ts` |
| `getJournalEntryRelatedItems` | `accounting.journalEntryRelatedItems.get` | 1 |  |  | `accounting.service.ts` |
| `getJournalLineDimensions` | `accounting.journalLineDimensions.get` | 1 |  | read | `accounting.service.ts` |
| `getLeaseNetInvestment` | `accounting.leaseNetInvestment.get` | 1 |  | read | `accounting.service.ts` |
| `getPaymentTerms` | `accounting.paymentTerms.get` | 1 |  | read | `accounting.service.ts` |
| `getPeriodCloseChecklist` | `accounting.periodCloseChecklist.get` | 1 |  | action | `accounting.service.ts` |
| `getProjects` | `accounting.projects.get` | 1 |  | read | `accounting.service.ts` |
| `getPurchaseLinePivot` | `accounting.purchaseLinePivot.get` | 1 |  | read | `accounting.service.ts` |
| `getPurchaseLinePivotLines` | `accounting.purchaseLinePivotLines.get` | 1 |  | read | `accounting.service.ts` |
| `getRentalUtilization` | `accounting.rentalUtilization.get` | 1 |  | read | `accounting.service.ts` |
| `getReportPins` | `accounting.reportPins.get` | 1 |  | read | `accounting.service.ts` |
| `getRevenueRecognitionRunLines` | `accounting.revenueRecognitionRunLines.get` | 1 |  | read | `accounting.service.ts` |
| `getRevenueRecognitionRuns` | `accounting.revenueRecognitionRuns.get` | 1 |  | read | `accounting.service.ts` |
| `getWorkCenterCapitalCost` | `accounting.workCenterCapitalCost.get` | 1 |  | read | `accounting.service.ts` |
| `insertDepreciationRun` | `accounting.depreciationRun.insert` |  | 1 | create | `accounting.service.ts` |
| `insertFixedAsset` | `accounting.fixedAsset.insert` |  | 1 | create | `accounting.service.ts` |
| `lockAccountingPeriod` | `accounting.lockAccountingPeriod` |  | 1 | action | `accounting.service.ts` |
| `postAssetRegistration` | `accounting.assetRegistration.post` |  | 1 |  | `accounting.server.ts` |
| `postDepreciationRun` | `accounting.depreciationRun.post` |  | 1 |  | `accounting.server.ts` |
| `postDisposal` | `accounting.disposal.post` |  | 1 |  | `accounting.server.ts` |
| `postRevenueRecognitionRun` | `accounting.revenueRecognitionRun.post` |  | 1 |  | `accounting.server.ts` |
| `replaceDepreciationRunLines` | `accounting.replaceDepreciationRunLines` |  | 1 |  | `accounting.server.ts` |
| `returnFixedAssetToService` | `accounting.returnFixedAssetToService` |  | 1 | update | `accounting.service.ts` |
| `reverseDepreciationRun` | `accounting.reverseDepreciationRun` |  | 1 |  | `accounting.server.ts` |
| `reverseJournalEntry` | `accounting.reverseJournalEntry` |  | 1 | action | `accounting.service.ts` |
| `reverseRevenueRecognitionRun` | `accounting.reverseRevenueRecognitionRun` |  | 1 |  | `accounting.server.ts` |
| `runIntercompanyMatching` | `accounting.intercompanyMatching.run` |  | 1 | update | `accounting.service.ts` |
| `saveJournalLineDimensions` | `accounting.saveJournalLineDimensions` |  | 1 | action | `accounting.service.ts` |
| `setFixedAssetOutOfService` | `accounting.fixedAssetOutOfService.set` |  | 1 | update | `accounting.service.ts` |
| `skipCloseTask` | `accounting.skipCloseTask` |  | 1 | action | `accounting.service.ts` |
| `translateCompanyBalances` | `accounting.translateCompanyBalances` | 1 |  | action | `accounting.service.ts` |
| `unlockAccountingPeriod` | `accounting.unlockAccountingPeriod` |  | 1 | action | `accounting.service.ts` |
| `updateDefaultAccounts` | `accounting.defaultAccounts.update` |  | 1 | update | `accounting.service.ts` |
| `updateFiscalYearSettings` | `accounting.fiscalYearSettings.update` |  | 1 | update | `accounting.service.ts` |
| `updateFixedAsset` | `accounting.fixedAsset.update` |  | 1 | update | `accounting.service.ts` |
| `upsertCurrency` | `accounting.currency.upsert` |  | 1 | upsert | `accounting.service.ts` |
| `upsertExchangeRateOverride` | `accounting.exchangeRateOverride.upsert` |  | 1 | upsert | `accounting.service.ts` |
| `upsertReportPin` | `accounting.reportPin.upsert` |  | 1 | upsert | `accounting.service.ts` |
| `upsertReportView` | `accounting.reportView.upsert` |  | 1 | upsert | `accounting.service.ts` |

</details>

### agent

10 of 12 functions are called by a route. The other 2 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 10 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getThread` | `agent.thread.get` | 1 | 1 |  | `agent.service.ts` |
| `assertAgentRateLimit` | `agent.assertAgentRateLimit` |  | 1 |  | `agent.server.ts` |
| `createThread` | `agent.thread.create` |  | 1 |  | `agent.service.ts` |
| `deleteThread` | `agent.thread.delete` |  | 1 |  | `agent.service.ts` |
| `getDisplayMessages` | `agent.displayMessages.get` | 1 |  |  | `agent.service.ts` |
| `getModelHistory` | `agent.modelHistory.get` |  | 1 |  | `agent.service.ts` |
| `getThreads` | `agent.threads.get` | 1 |  |  | `agent.service.ts` |
| `saveUserMessage` | `agent.saveUserMessage` |  | 1 |  | `agent.service.ts` |
| `setFeedback` | `agent.feedback.set` |  | 1 |  | `agent.service.ts` |
| `streamChat` | `agent.streamChat` |  | 1 |  | `agent.server.ts` |

</details>

### documents

11 of 17 functions are called by a route. The other 6 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 11 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `upsertDocument` | `documents.document.upsert` |  | 9 | upsert | `documents.service.ts` |
| `getDocument` | `documents.document.get` | 2 |  | read | `documents.service.ts` |
| `deleteDocument` | `documents.document.delete` |  | 1 | delete | `documents.service.ts` |
| `getDocumentExtensions` | `documents.documentExtensions.get` | 1 |  | read | `documents.service.ts` |
| `getDocumentLabels` | `documents.documentLabels.get` | 1 |  | read | `documents.service.ts` |
| `getDocuments` | `documents.documents.get` | 1 |  | read | `documents.service.ts` |
| `insertDocumentExtraction` | `documents.documentExtraction.insert` |  | 1 | create | `documents.service.ts` |
| `moveDocumentToTrash` | `documents.documentToTrash.move` |  | 1 | update | `documents.service.ts` |
| `restoreDocument` | `documents.document.restore` |  | 1 | action | `documents.service.ts` |
| `updateDocumentFavorite` | `documents.documentFavorite.update` |  | 1 | update | `documents.service.ts` |
| `updateDocumentLabels` | `documents.documentLabels.update` |  | 1 | update | `documents.service.ts` |

</details>

### inventory

130 of 150 functions are called by a route. The other 20 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 130 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getStockTransfer` | `inventory.stockTransfer.get` | 2 | 7 | read | `inventory.service.ts` |
| `getBatchProperties` | `inventory.batchProperties.get` | 5 |  | read | `inventory.service.ts` |
| `getInventoryCount` | `inventory.inventoryCount.get` | 1 | 4 | read | `inventory.service.ts` |
| `getKanban` | `inventory.kanban.get` | 5 |  | read | `inventory.service.ts` |
| `getTrackedEntityExpirations` | `inventory.trackedEntityExpirations.get` | 5 |  | read | `inventory.service.ts` |
| `getWarehouseTransfer` | `inventory.warehouseTransfer.get` | 2 | 3 | read | `inventory.service.ts` |
| `getShipment` | `inventory.shipment.get` | 2 | 2 | read | `inventory.service.ts` |
| `getShipmentTracking` | `inventory.shipmentTracking.get` | 4 |  | read | `inventory.service.ts` |
| `getShippingMethodsList` | `inventory.shippingMethodsList.get` | 4 |  | read | `inventory.service.ts` |
| `getStorageTypesList` | `inventory.storageTypesList.get` | 4 |  | read | `inventory.service.ts` |
| `getReceipt` | `inventory.receipt.get` | 1 | 2 | read | `inventory.service.ts` |
| `getReceiptTracking` | `inventory.receiptTracking.get` | 3 |  | read | `inventory.service.ts` |
| `getShippingMethod` | `inventory.shippingMethod.get` | 3 |  | read | `inventory.service.ts` |
| `getStorageUnitsListForLocation` | `inventory.storageUnitsListForLocation.get` | 3 |  | read | `inventory.service.ts` |
| `deleteInventoryCount` | `inventory.inventoryCount.delete` |  | 2 | delete | `inventory.service.ts` |
| `fetchLineageSubgraph` | `inventory.fetchLineageSubgraph` | 2 |  |  | `lineage.server.ts` |
| `getAvailableTrackedEntities` | `inventory.availableTrackedEntities.get` | 2 |  | read | `inventory.service.ts` |
| `getPickingList` | `inventory.pickingList.get` | 1 | 1 | read | `inventory.service.ts` |
| `getRentalShipmentLines` | `inventory.rentalShipmentLines.get` | 2 |  | read | `inventory.service.ts` |
| `getStockTransferLines` | `inventory.stockTransferLines.get` | 2 |  | read | `inventory.service.ts` |
| `getStorageType` | `inventory.storageType.get` | 2 |  | read | `inventory.service.ts` |
| `getStorageTypeUsage` | `inventory.storageTypeUsage.get` | 1 | 1 | read | `inventory.service.ts` |
| `getStorageUnit` | `inventory.storageUnit.get` | 2 |  | read | `inventory.service.ts` |
| `getTrackedEntitiesByMakeMethodId` | `inventory.trackedEntitiesByMakeMethodId.get` | 2 |  | read | `inventory.service.ts` |
| `updateInventoryCountStatus` | `inventory.inventoryCountStatus.update` |  | 2 | update | `inventory.service.ts` |
| `updateWarehouseTransferStatus` | `inventory.warehouseTransferStatus.update` |  | 2 | update | `inventory.service.ts` |
| `upsertKanban` | `inventory.kanban.upsert` |  | 2 | upsert | `inventory.service.ts` |
| `upsertShippingMethod` | `inventory.shippingMethod.upsert` |  | 2 | upsert | `inventory.service.ts` |
| `upsertStockTransferLine` | `inventory.stockTransferLine.upsert` |  | 2 | upsert | `inventory.service.ts` |
| `upsertStorageType` | `inventory.storageType.upsert` |  | 2 | upsert | `inventory.service.ts` |
| `upsertStorageUnit` | `inventory.storageUnit.upsert` |  | 2 | upsert | `inventory.service.ts` |
| `upsertWarehouseTransferLine` | `inventory.warehouseTransferLine.upsert` |  | 2 | upsert | `inventory.service.ts` |
| `correctStockMovement` | `inventory.correctStockMovement` |  | 1 | action | `inventory.service.ts` |
| `createInventoryReconciliationJournal` | `inventory.inventoryReconciliationJournal.create` |  | 1 | create | `inventory.service.ts` |
| `deleteBatchProperty` | `inventory.batchProperty.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteKanban` | `inventory.kanban.delete` |  | 1 | delete | `inventory.service.ts` |
| `deletePickingList` | `inventory.pickingList.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteReceipt` | `inventory.receipt.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteReceiptLine` | `inventory.receiptLine.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteShipment` | `inventory.shipment.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteShipmentLine` | `inventory.shipmentLine.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteShippingMethod` | `inventory.shippingMethod.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteStockTransfer` | `inventory.stockTransfer.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteStockTransferLine` | `inventory.stockTransferLine.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteStorageTypeWithCascade` | `inventory.storageTypeWithCascade.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteStorageUnit` | `inventory.storageUnit.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteStorageUnitCascade` | `inventory.storageUnitCascade.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteWarehouseTransfer` | `inventory.warehouseTransfer.delete` |  | 1 | delete | `inventory.service.ts` |
| `deleteWarehouseTransferLine` | `inventory.warehouseTransferLine.delete` |  | 1 | delete | `inventory.service.ts` |
| `enrichActivityBinNames` | `inventory.enrichActivityBinNames` | 1 |  |  | `lineage.server.ts` |
| `expandStorageUnitIdsWithDescendants` | `inventory.expandStorageUnitIdsWithDescendants` | 1 |  | action | `inventory.service.ts` |
| `fetchContainmentsForEntities` | `inventory.fetchContainmentsForEntities` | 1 |  |  | `lineage.server.ts` |
| `fetchJobScopedLineage` | `inventory.fetchJobScopedLineage` | 1 |  |  | `lineage.server.ts` |
| `fetchJobStepRecords` | `inventory.fetchJobStepRecords` | 1 |  |  | `lineage.server.ts` |
| `generateInventoryCountLines` | `inventory.inventoryCountLines.generate` |  | 1 | create | `inventory.service.ts` |
| `generatePickingList` | `inventory.pickingList.generate` |  | 1 | create | `inventory.service.ts` |
| `getBatchNumbersForItem` | `inventory.batchNumbersForItem.get` | 1 |  | read | `inventory.service.ts` |
| `getDefaultStorageUnitForJob` | `inventory.defaultStorageUnitForJob.get` |  | 1 | read | `inventory.service.ts` |
| `getEffectiveWorkCenterId` | `inventory.effectiveWorkCenterId.get` | 1 |  | read | `inventory.service.ts` |
| `getInventoryCountLineSummary` | `inventory.inventoryCountLineSummary.get` | 1 |  | read | `inventory.service.ts` |
| `getInventoryCountLines` | `inventory.inventoryCountLines.get` | 1 |  | read | `inventory.service.ts` |
| `getInventoryCountMovements` | `inventory.inventoryCountMovements.get` | 1 |  | read | `inventory.service.ts` |
| `getInventoryCounts` | `inventory.inventoryCounts.get` | 1 |  | read | `inventory.service.ts` |
| `getInventoryItems` | `inventory.inventoryItems.get` | 1 |  | read | `inventory.service.ts` |
| `getInventoryValuation` | `inventory.inventoryValuation.get` | 1 |  | read | `inventory.service.ts` |
| `getInventoryValuationTieOut` | `inventory.inventoryValuationTieOut.get` | 1 |  | read | `inventory.service.ts` |
| `getItemLedgerActivity` | `inventory.itemLedgerActivity.get` | 1 |  | read | `inventory.service.ts` |
| `getItemLedgerBalance` | `inventory.itemLedgerBalance.get` | 1 |  | read | `inventory.service.ts` |
| `getKanbans` | `inventory.kanbans.get` | 1 |  | read | `inventory.service.ts` |
| `getPickOrder` | `inventory.pickOrder.get` | 1 |  | read | `inventory.service.ts` |
| `getPickingListAvailability` | `inventory.pickingListAvailability.get` | 1 |  | read | `inventory.service.ts` |
| `getPickingListLine` | `inventory.pickingListLine.get` | 1 |  | read | `inventory.service.ts` |
| `getPickingListLines` | `inventory.pickingListLines.get` | 1 |  | read | `inventory.service.ts` |
| `getPickingListRecommendations` | `inventory.pickingListRecommendations.get` | 1 |  | read | `inventory.service.ts` |
| `getPickingListRelatedItems` | `inventory.pickingListRelatedItems.get` | 1 |  | read | `inventory.service.ts` |
| `getPickingLists` | `inventory.pickingLists.get` | 1 |  | read | `inventory.service.ts` |
| `getPickingSchedule` | `inventory.pickingSchedule.get` | 1 |  | read | `inventory.service.ts` |
| `getPicksByJobMaterial` | `inventory.picksByJobMaterial.get` | 1 |  | read | `inventory.service.ts` |
| `getReceiptFiles` | `inventory.receiptFiles.get` | 1 |  | read | `inventory.service.ts` |
| `getReceiptLines` | `inventory.receiptLines.get` | 1 |  | read | `inventory.service.ts` |
| `getReceiptRelatedItems` | `inventory.receiptRelatedItems.get` | 1 |  | read | `inventory.service.ts` |
| `getReceipts` | `inventory.receipts.get` | 1 |  | read | `inventory.service.ts` |
| `getRentalReceiptLines` | `inventory.rentalReceiptLines.get` | 1 |  | read | `inventory.service.ts` |
| `getSerialNumbersForItem` | `inventory.serialNumbersForItem.get` | 1 |  | read | `inventory.service.ts` |
| `getSerialUnitCosts` | `inventory.serialUnitCosts.get` | 1 |  |  | `inventory.service.ts` |
| `getShelfLifeForItems` | `inventory.shelfLifeForItems.get` | 1 |  | read | `inventory.service.ts` |
| `getShipmentLines` | `inventory.shipmentLines.get` | 1 |  | read | `inventory.service.ts` |
| `getShipmentLinesWithDetails` | `inventory.shipmentLinesWithDetails.get` | 1 |  | read | `inventory.service.ts` |
| `getShipmentRelatedItems` | `inventory.shipmentRelatedItems.get` | 1 |  | read | `inventory.service.ts` |
| `getShipments` | `inventory.shipments.get` | 1 |  | read | `inventory.service.ts` |
| `getShippingMethods` | `inventory.shippingMethods.get` | 1 |  | read | `inventory.service.ts` |
| `getShippingTermsList` | `inventory.shippingTermsList.get` | 1 |  | read | `inventory.service.ts` |
| `getStockMovementEffectiveQuantity` | `inventory.stockMovementEffectiveQuantity.get` | 1 |  | read | `inventory.service.ts` |
| `getStockMovements` | `inventory.stockMovements.get` | 1 |  | read | `inventory.service.ts` |
| `getStockTransfers` | `inventory.stockTransfers.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageTypes` | `inventory.storageTypes.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageUnitChildren` | `inventory.storageUnitChildren.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageUnitDescendants` | `inventory.storageUnitDescendants.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageUnitParentIdsWithChildren` | `inventory.storageUnitParentIdsWithChildren.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageUnitRoots` | `inventory.storageUnitRoots.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageUnitSubtrees` | `inventory.storageUnitSubtrees.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageUnitsList` | `inventory.storageUnitsList.get` | 1 |  | read | `inventory.service.ts` |
| `getStorageUnitsTreeForLocation` | `inventory.storageUnitsTreeForLocation.get` | 1 |  | read | `inventory.service.ts` |
| `getTrackedEntities` | `inventory.trackedEntities.get` | 1 |  | read | `inventory.service.ts` |
| `getTrackedEntity` | `inventory.trackedEntity.get` | 1 |  | read | `inventory.service.ts` |
| `getUnresolvedPickingListLines` | `inventory.unresolvedPickingListLines.get` |  | 1 | read | `inventory.service.ts` |
| `getWarehouseTransferLine` | `inventory.warehouseTransferLine.get` | 1 |  | read | `inventory.service.ts` |
| `getWarehouseTransferLines` | `inventory.warehouseTransferLines.get` | 1 |  | read | `inventory.service.ts` |
| `getWarehouseTransferRelatedItems` | `inventory.warehouseTransferRelatedItems.get` | 1 |  | read | `inventory.service.ts` |
| `getWarehouseTransfers` | `inventory.warehouseTransfers.get` | 1 |  | read | `inventory.service.ts` |
| `insertInventoryCount` | `inventory.inventoryCount.insert` |  | 1 | create | `inventory.service.ts` |
| `insertManualInventoryAdjustment` | `inventory.manualInventoryAdjustment.insert` |  | 1 | create | `inventory.service.ts` |
| `insertStockTransfer` | `inventory.stockTransfer.insert` |  | 1 | create | `inventory.service.ts` |
| `insertWarehouseTransfer` | `inventory.warehouseTransfer.insert` |  | 1 | create | `inventory.service.ts` |
| `mergeTrackedEntities` | `inventory.trackedEntities.merge` |  | 1 | action | `inventory.service.ts` |
| `pickPickingListLine` | `inventory.pickPickingListLine` |  | 1 | action | `inventory.service.ts` |
| `reconcileReceiptSerialEntities` | `inventory.reconcileReceiptSerialEntities` |  | 1 | action | `inventory.service.ts` |
| `recostSerialUnit` | `inventory.recostSerialUnit` |  | 1 |  | `inventory.service.ts` |
| `searchStorageUnitsWithAncestors` | `inventory.searchStorageUnitsWithAncestors` | 1 |  | read | `inventory.service.ts` |
| `setPickingListLineTrackedEntity` | `inventory.pickingListLineTrackedEntity.set` |  | 1 | update | `inventory.service.ts` |
| `updateBatchPropertyOrder` | `inventory.batchPropertyOrder.update` |  | 1 | update | `inventory.service.ts` |
| `updateInventoryCountLine` | `inventory.inventoryCountLine.update` |  | 1 | update | `inventory.service.ts` |
| `updatePickingListStatus` | `inventory.pickingListStatus.update` |  | 1 | update | `inventory.service.ts` |
| `updateStockTransferStatus` | `inventory.stockTransferStatus.update` |  | 1 | update | `inventory.service.ts` |
| `updateTrackedEntityExpiry` | `inventory.trackedEntityExpiry.update` |  | 1 | update | `inventory.service.ts` |
| `updateWarehouseTransfer` | `inventory.warehouseTransfer.update` |  | 1 | update | `inventory.service.ts` |
| `upsertBatchProperty` | `inventory.batchProperty.upsert` |  | 1 | upsert | `inventory.service.ts` |
| `upsertPickingList` | `inventory.pickingList.upsert` |  | 1 | upsert | `inventory.service.ts` |
| `upsertReceipt` | `inventory.receipt.upsert` |  | 1 | upsert | `inventory.service.ts` |
| `upsertShipment` | `inventory.shipment.upsert` |  | 1 | upsert | `inventory.service.ts` |

</details>

### invoicing

73 of 84 functions are called by a route. The other 11 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 73 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getPurchaseInvoice` | `invoicing.purchaseInvoice.get` | 3 | 7 | read | `invoicing.service.ts` |
| `getSalesInvoice` | `invoicing.salesInvoice.get` | 3 | 6 | read | `invoicing.service.ts` |
| `getPaymentCurrencyConfiguration` | `invoicing.paymentCurrencyConfiguration.get` | 2 | 3 | read | `invoicing.service.ts` |
| `getApTieOut` | `invoicing.apTieOut.get` | 3 | 1 | read | `invoicing.service.ts` |
| `getArTieOut` | `invoicing.arTieOut.get` | 3 | 1 | read | `invoicing.service.ts` |
| `getReimbursement` | `invoicing.reimbursement.get` | 1 | 3 | read | `invoicing.service.ts` |
| `getApAging` | `invoicing.apAging.get` | 3 |  | read | `invoicing.service.ts` |
| `getArAging` | `invoicing.arAging.get` | 3 |  | read | `invoicing.service.ts` |
| `getMemo` | `invoicing.memo.get` | 1 | 2 | read | `invoicing.service.ts` |
| `getOpenPurchaseInvoicesForSupplier` | `invoicing.openPurchaseInvoicesForSupplier.get` | 2 | 1 | read | `invoicing.service.ts` |
| `getOpenReimbursementsForEmployee` | `invoicing.openReimbursementsForEmployee.get` | 2 | 1 | read | `invoicing.service.ts` |
| `getOpenSalesInvoicesForCustomer` | `invoicing.openSalesInvoicesForCustomer.get` | 2 | 1 | read | `invoicing.service.ts` |
| `getPayment` | `invoicing.payment.get` | 1 | 2 | read | `invoicing.service.ts` |
| `replaceInvoiceSettlements` | `invoicing.replaceInvoiceSettlements` |  | 3 | action | `invoicing.service.ts` |
| `upsertPayment` | `invoicing.payment.upsert` |  | 3 | upsert | `invoicing.service.ts` |
| `upsertPurchaseInvoiceLine` | `invoicing.purchaseInvoiceLine.upsert` |  | 3 | upsert | `invoicing.service.ts` |
| `checkDepositDocument` | `invoicing.depositDocument.check` |  | 2 |  | `invoicing.server.ts` |
| `computeEarlyPaymentDiscounts` | `invoicing.computeEarlyPaymentDiscounts` | 1 | 1 | read | `invoicing.service.ts` |
| `computeInvoiceDateDue` | `invoicing.computeInvoiceDateDue` |  | 2 | read | `invoicing.service.ts` |
| `getApOpenBySupplier` | `invoicing.apOpenBySupplier.get` | 2 |  | read | `invoicing.service.ts` |
| `getArOpenByCustomer` | `invoicing.arOpenByCustomer.get` | 2 |  | read | `invoicing.service.ts` |
| `getCompanyHasOpenCredits` | `invoicing.companyHasOpenCredits.get` | 2 |  | read | `invoicing.service.ts` |
| `getDepositDocuments` | `invoicing.depositDocuments.get` | 2 |  |  | `invoicing.server.ts` |
| `getInvoiceSettlementsForInvoice` | `invoicing.invoiceSettlementsForInvoice.get` | 2 |  | read | `invoicing.service.ts` |
| `getMemos` | `invoicing.memos.get` | 2 |  | read | `invoicing.service.ts` |
| `getPayments` | `invoicing.payments.get` | 2 |  | read | `invoicing.service.ts` |
| `getPurchaseInvoiceLine` | `invoicing.purchaseInvoiceLine.get` | 2 |  | read | `invoicing.service.ts` |
| `getSalesInvoiceLine` | `invoicing.salesInvoiceLine.get` | 2 |  | read | `invoicing.service.ts` |
| `getSettlementRelatedItems` | `invoicing.settlementRelatedItems.get` | 2 |  |  | `invoicing.service.ts` |
| `linesBalanceHeader` | `invoicing.linesBalanceHeader` |  | 2 |  | `reimbursement.server.ts` |
| `postReimbursement` | `invoicing.reimbursement.post` |  | 2 |  | `reimbursement.server.ts` |
| `upsertMemo` | `invoicing.memo.upsert` |  | 2 | upsert | `invoicing.service.ts` |
| `upsertSalesInvoiceLine` | `invoicing.salesInvoiceLine.upsert` |  | 2 | upsert | `invoicing.service.ts` |
| `applyCreditsToInvoices` | `invoicing.creditsToInvoices.apply` |  | 1 | action | `invoicing.service.ts` |
| `createPurchaseInvoiceFromPurchaseOrder` | `invoicing.purchaseInvoiceFromPurchaseOrder.create` | 1 |  | create | `invoicing.service.ts` |
| `createSalesInvoiceFromSalesOrder` | `invoicing.salesInvoiceFromSalesOrder.create` | 1 |  | create | `invoicing.service.ts` |
| `createSalesInvoiceFromShipment` | `invoicing.salesInvoiceFromShipment.create` | 1 |  | create | `invoicing.service.ts` |
| `deleteMemo` | `invoicing.memo.delete` |  | 1 | delete | `invoicing.service.ts` |
| `deletePayment` | `invoicing.payment.delete` |  | 1 | delete | `invoicing.service.ts` |
| `deletePurchaseInvoice` | `invoicing.purchaseInvoice.delete` |  | 1 | delete | `invoicing.service.ts` |
| `deletePurchaseInvoiceLine` | `invoicing.purchaseInvoiceLine.delete` |  | 1 | delete | `invoicing.service.ts` |
| `getAvailableCreditsForParty` | `invoicing.availableCreditsForParty.get` | 1 |  | read | `invoicing.service.ts` |
| `getAvailableOnAccountCreditSources` | `invoicing.availableOnAccountCreditSources.get` | 1 |  | read | `invoicing.service.ts` |
| `getCharge` | `invoicing.charge.get` | 1 |  | read | `invoicing.service.ts` |
| `getCharges` | `invoicing.charges.get` | 1 |  | read | `invoicing.service.ts` |
| `getInvoiceSettlements` | `invoicing.invoiceSettlements.get` | 1 |  | read | `invoicing.service.ts` |
| `getMemoApplications` | `invoicing.memoApplications.get` | 1 |  | read | `invoicing.service.ts` |
| `getPurchaseInvoiceDelivery` | `invoicing.purchaseInvoiceDelivery.get` | 1 |  | read | `invoicing.service.ts` |
| `getPurchaseInvoiceLines` | `invoicing.purchaseInvoiceLines.get` | 1 |  | read | `invoicing.service.ts` |
| `getPurchaseInvoices` | `invoicing.purchaseInvoices.get` | 1 |  | read | `invoicing.service.ts` |
| `getReimbursementRelatedItems` | `invoicing.reimbursementRelatedItems.get` | 1 |  | read | `invoicing.service.ts` |
| `getReimbursements` | `invoicing.reimbursements.get` | 1 |  | read | `invoicing.service.ts` |
| `getSalesInvoiceLines` | `invoicing.salesInvoiceLines.get` | 1 |  | read | `invoicing.service.ts` |
| `getSalesInvoiceShipment` | `invoicing.salesInvoiceShipment.get` | 1 |  | read | `invoicing.service.ts` |
| `getSalesInvoices` | `invoicing.salesInvoices.get` | 1 |  | read | `invoicing.service.ts` |
| `getStagedCreditsForPayment` | `invoicing.stagedCreditsForPayment.get` | 1 |  | read | `invoicing.service.ts` |
| `insertPurchaseInvoice` | `invoicing.purchaseInvoice.insert` |  | 1 | create | `invoicing.service.ts` |
| `insertSalesInvoice` | `invoicing.salesInvoice.insert` |  | 1 | create | `invoicing.service.ts` |
| `linkStripeCustomerForBilling` | `invoicing.linkStripeCustomerForBilling` |  | 1 |  | `stripe-customer.server.ts` |
| `resolveStripeCustomer` | `invoicing.stripeCustomer.resolve` | 1 |  |  | `stripe-customer.server.ts` |
| `resolveStripeCustomerForBilling` | `invoicing.stripeCustomerForBilling.resolve` | 1 |  |  | `stripe-customer.server.ts` |
| `updatePurchaseInvoice` | `invoicing.purchaseInvoice.update` |  | 1 | update | `invoicing.service.ts` |
| `updatePurchaseInvoiceExchangeRate` | `invoicing.purchaseInvoiceExchangeRate.update` |  | 1 | update | `invoicing.service.ts` |
| `updatePurchaseInvoiceLineOrder` | `invoicing.purchaseInvoiceLineOrder.update` |  | 1 | update | `invoicing.service.ts` |
| `updatePurchaseInvoiceStatus` | `invoicing.purchaseInvoiceStatus.update` |  | 1 | update | `invoicing.service.ts` |
| `updateReimbursement` | `invoicing.reimbursement.update` |  | 1 | update | `invoicing.service.ts` |
| `updateSalesInvoiceExchangeRate` | `invoicing.salesInvoiceExchangeRate.update` |  | 1 | update | `invoicing.service.ts` |
| `updateSalesInvoiceLineOrder` | `invoicing.salesInvoiceLineOrder.update` |  | 1 | update | `invoicing.service.ts` |
| `updateSalesInvoiceStatus` | `invoicing.salesInvoiceStatus.update` |  | 1 | update | `invoicing.service.ts` |
| `upsertPurchaseInvoiceDelivery` | `invoicing.purchaseInvoiceDelivery.upsert` |  | 1 | update | `invoicing.service.ts` |
| `upsertReimbursementLines` | `invoicing.reimbursementLines.upsert` |  | 1 | upsert | `invoicing.service.ts` |
| `upsertSalesInvoiceShipment` | `invoicing.salesInvoiceShipment.upsert` |  | 1 | update | `invoicing.service.ts` |
| `voidReimbursement` | `invoicing.voidReimbursement` |  | 1 |  | `reimbursement.server.ts` |

</details>

### items

198 of 224 functions are called by a route. The other 26 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 198 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `checkRevisionLock` | `items.revisionLock.check` |  | 21 |  | `items.server.ts` |
| `upsertSupplierPart` | `items.supplierPart.upsert` |  | 10 | upsert | `items.service.ts` |
| `assertMethodOperationIsDraft` | `items.assertMethodOperationIsDraft` |  | 9 | action | `items.service.ts` |
| `getItemCostHistory` | `items.itemCostHistory.get` | 9 |  | read | `items.service.ts` |
| `requireEditableChangeNoticeRoute` | `items.requireEditableChangeNoticeRoute` |  | 9 |  | `items.server.ts` |
| `getItem` | `items.item.get` | 6 | 2 | read | `items.service.ts` |
| `getItemFiles` | `items.itemFiles.get` | 8 |  | read | `items.service.ts` |
| `getItemStorageUnitQuantities` | `items.itemStorageUnitQuantities.get` | 7 | 1 | read | `items.service.ts` |
| `getMakeMethods` | `items.makeMethods.get` | 8 |  | read | `items.service.ts` |
| `getUnitOfMeasuresList` | `items.unitOfMeasuresList.get` | 8 |  | read | `items.service.ts` |
| `getItemQuantities` | `items.itemQuantities.get` | 7 |  | read | `items.service.ts` |
| `getMethodMaterialsByMakeMethod` | `items.methodMaterialsByMakeMethod.get` | 7 |  | read | `items.service.ts` |
| `getMethodOperationsByMakeMethodId` | `items.methodOperationsByMakeMethodId.get` | 7 |  | read | `items.service.ts` |
| `getSupplierParts` | `items.supplierParts.get` | 7 |  | read | `items.service.ts` |
| `getItemReplenishment` | `items.itemReplenishment.get` | 6 |  | read | `items.service.ts` |
| `getMethodTree` | `items.methodTree.get` | 5 | 1 | read | `items.service.ts` |
| `getPickMethod` | `items.pickMethod.get` | 6 |  | read | `items.service.ts` |
| `getPickMethods` | `items.pickMethods.get` | 6 |  | read | `items.service.ts` |
| `requireChangeNoticeEditable` | `items.requireChangeNoticeEditable` |  | 6 |  | `items.server.ts` |
| `upsertPickMethod` | `items.pickMethod.upsert` | 6 |  | upsert | `items.service.ts` |
| `deleteSupplierPart` | `items.supplierPart.delete` |  | 5 | delete | `items.service.ts` |
| `getItemCost` | `items.itemCost.get` | 5 |  | read | `items.service.ts` |
| `getItemShelfLife` | `items.itemShelfLife.get` | 5 |  | read | `items.service.ts` |
| `getItemUnitSalePrice` | `items.itemUnitSalePrice.get` | 5 |  | read | `items.service.ts` |
| `getMakeMethodById` | `items.makeMethodById.get` | 5 |  | read | `items.service.ts` |
| `getMakeMethodByIdOnce` | `items.makeMethodByIdOnce.get` | 5 |  |  | `items.server.ts` |
| `getMakeMethodsOnce` | `items.makeMethodsOnce.get` | 5 |  |  | `items.server.ts` |
| `getRevisionLock` | `items.revisionLock.get` | 5 |  |  | `items.server.ts` |
| `requireChangeNoticeChildRoute` | `items.requireChangeNoticeChildRoute` |  | 5 |  | `items.server.ts` |
| `streamItemSupersession` | `items.streamItemSupersession` | 5 |  |  | `items.server.ts` |
| `upsertItemCost` | `items.itemCost.upsert` |  | 5 | upsert | `items.service.ts` |
| `upsertItemPurchasing` | `items.itemPurchasing.upsert` |  | 5 | upsert | `items.service.ts` |
| `upsertItemUnitSalePrice` | `items.itemUnitSalePrice.upsert` |  | 5 | upsert | `items.service.ts` |
| `upsertPart` | `items.part.upsert` |  | 5 | upsert | `items.service.ts` |
| `getBomHasShelfLifeManagedInput` | `items.bomHasShelfLifeManagedInput.get` | 4 |  | read | `items.service.ts` |
| `getConfigurationParameters` | `items.configurationParameters.get` | 4 |  | read | `items.service.ts` |
| `getItemManufacturing` | `items.itemManufacturing.get` | 4 |  | read | `items.service.ts` |
| `getItemPlanning` | `items.itemPlanning.get` | 4 |  | read | `items.service.ts` |
| `getMaterialFormsList` | `items.materialFormsList.get` | 4 |  | read | `items.service.ts` |
| `getMaterialSubstancesList` | `items.materialSubstancesList.get` | 4 |  | read | `items.service.ts` |
| `getPartUsedIn` | `items.partUsedIn.get` | 4 |  | read | `items.service.ts` |
| `resolveItemIdFromExtractedText` | `items.itemIdFromExtractedText.resolve` | 2 | 2 | action | `items.service.ts` |
| `upsertItemPlanning` | `items.itemPlanning.upsert` |  | 4 | upsert | `items.service.ts` |
| `upsertPickMethodWithShelfLife` | `items.pickMethodWithShelfLife.upsert` |  | 4 | upsert | `items.service.ts` |
| `addChangeNoticeAffectedItem` | `items.changeNoticeAffectedItem.add` |  | 3 | create | `items.service.ts` |
| `copyMakeMethod` | `items.makeMethod.copy` |  | 3 | create | `items.service.ts` |
| `getBomItemAttributes` | `items.bomItemAttributes.get` | 3 |  | read | `items.service.ts` |
| `getChangeNoticeTypesList` | `items.changeNoticeTypesList.get` | 3 |  | read | `items.service.ts` |
| `getConfigurationRules` | `items.configurationRules.get` | 3 |  | read | `items.service.ts` |
| `getUnreleasedChangeOrderForItem` | `items.unreleasedChangeOrderForItem.get` | 3 |  |  | `items.server.ts` |
| `getUnreleasedChangeOrderIssue` | `items.unreleasedChangeOrderIssue.get` |  | 3 |  | `items.server.ts` |
| `updateChangeNotice` | `items.changeNotice.update` |  | 3 | update | `items.service.ts` |
| `copyItem` | `items.item.copy` |  | 2 | create | `items.service.ts` |
| `findChangeNoticesForItemOnce` | `items.findChangeNoticesForItemOnce` | 2 |  |  | `items.server.ts` |
| `getChangeNoticeRequiredAction` | `items.changeNoticeRequiredAction.get` | 2 |  | read | `items.service.ts` |
| `getChangeNoticeType` | `items.changeNoticeType.get` | 2 |  | read | `items.service.ts` |
| `getItemChangeNoticeDataOnce` | `items.itemChangeNoticeDataOnce.get` | 2 |  |  | `items.server.ts` |
| `getItemCustomerPart` | `items.itemCustomerPart.get` | 2 |  | read | `items.service.ts` |
| `getItemPostingGroup` | `items.itemPostingGroup.get` | 2 |  | read | `items.service.ts` |
| `getItemSupersession` | `items.itemSupersession.get` | 1 | 1 | read | `items.service.ts` |
| `getMaterialDimension` | `items.materialDimension.get` | 2 |  | read | `items.service.ts` |
| `getMaterialFinish` | `items.materialFinish.get` | 2 |  | read | `items.service.ts` |
| `getMaterialForm` | `items.materialForm.get` | 2 |  | read | `items.service.ts` |
| `getMaterialGrade` | `items.materialGrade.get` | 2 |  | read | `items.service.ts` |
| `getMaterialSubstance` | `items.materialSubstance.get` | 2 |  | read | `items.service.ts` |
| `getMaterialType` | `items.materialType.get` | 2 |  | read | `items.service.ts` |
| `getMaterialUsedIn` | `items.materialUsedIn.get` | 2 |  | read | `items.service.ts` |
| `getPart` | `items.part.get` | 2 |  | read | `items.service.ts` |
| `getSupplierPriceBreaksForItems` | `items.supplierPriceBreaksForItems.get` | 1 | 1 | read | `items.service.ts` |
| `getUnitOfMeasure` | `items.unitOfMeasure.get` | 2 |  | read | `items.service.ts` |
| `getUnitOfMeasureUsage` | `items.unitOfMeasureUsage.get` | 1 | 1 | read | `items.service.ts` |
| `insertChangeNotice` | `items.changeNotice.insert` |  | 2 | create | `items.service.ts` |
| `upsertChangeNoticeRequiredAction` | `items.changeNoticeRequiredAction.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertChangeNoticeType` | `items.changeNoticeType.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertConsumable` | `items.consumable.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertItemCustomerPart` | `items.itemCustomerPart.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertItemManufacturing` | `items.itemManufacturing.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertItemPostingGroup` | `items.itemPostingGroup.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMaterial` | `items.material.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMaterialDimension` | `items.materialDimension.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMaterialFinish` | `items.materialFinish.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMaterialForm` | `items.materialForm.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMaterialGrade` | `items.materialGrade.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMaterialSubstance` | `items.materialSubstance.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMaterialType` | `items.materialType.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMethodMaterial` | `items.methodMaterial.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMethodOperation` | `items.methodOperation.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMethodOperationParameter` | `items.methodOperationParameter.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMethodOperationStep` | `items.methodOperationStep.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertMethodOperationTool` | `items.methodOperationTool.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertService` | `items.service.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertTool` | `items.tool.upsert` |  | 2 | upsert | `items.service.ts` |
| `upsertUnitOfMeasure` | `items.unitOfMeasure.upsert` |  | 2 | upsert | `items.service.ts` |
| `activateMethodVersion` | `items.activateMethodVersion` |  | 1 | action | `items.service.ts` |
| `applyChangeNotice` | `items.changeNotice.apply` |  | 1 |  | `items.server.ts` |
| `cascadeItemTrackingType` | `items.cascadeItemTrackingType` |  | 1 | action | `items.service.ts` |
| `createRevision` | `items.revision.create` |  | 1 | create | `items.service.ts` |
| `deleteChangeNotice` | `items.changeNotice.delete` |  | 1 | delete | `items.service.ts` |
| `deleteChangeNoticeAction` | `items.changeNoticeAction.delete` |  | 1 | delete | `items.service.ts` |
| `deleteChangeNoticeRequiredAction` | `items.changeNoticeRequiredAction.delete` |  | 1 | delete | `items.service.ts` |
| `deleteChangeNoticeType` | `items.changeNoticeType.delete` |  | 1 | delete | `items.service.ts` |
| `deleteConfigurationParameter` | `items.configurationParameter.delete` |  | 1 | delete | `items.service.ts` |
| `deleteConfigurationParameterGroup` | `items.configurationParameterGroup.delete` |  | 1 | delete | `items.service.ts` |
| `deleteConfigurationRule` | `items.configurationRule.delete` |  | 1 | delete | `items.service.ts` |
| `deleteItem` | `items.item.delete` |  | 1 | delete | `items.service.ts` |
| `deleteItemCustomerPart` | `items.itemCustomerPart.delete` |  | 1 | delete | `items.service.ts` |
| `deleteItemPostingGroup` | `items.itemPostingGroup.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMaterialDimension` | `items.materialDimension.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMaterialFinish` | `items.materialFinish.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMaterialForm` | `items.materialForm.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMaterialGrade` | `items.materialGrade.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMaterialSubstance` | `items.materialSubstance.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMaterialType` | `items.materialType.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMethodMaterial` | `items.methodMaterial.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMethodOperationParameter` | `items.methodOperationParameter.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMethodOperationStep` | `items.methodOperationStep.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMethodOperationStepSlide` | `items.methodOperationStepSlide.delete` |  | 1 | delete | `items.service.ts` |
| `deleteMethodOperationTool` | `items.methodOperationTool.delete` |  | 1 | delete | `items.service.ts` |
| `deleteUnitOfMeasure` | `items.unitOfMeasure.delete` |  | 1 | delete | `items.service.ts` |
| `duplicateMethodOperationStep` | `items.methodOperationStep.duplicate` |  | 1 | create | `items.service.ts` |
| `getChangeNotice` | `items.changeNotice.get` | 1 |  | read | `items.service.ts` |
| `getChangeNoticeActions` | `items.changeNoticeActions.get` | 1 |  | read | `items.service.ts` |
| `getChangeNoticeAffectedItems` | `items.changeNoticeAffectedItems.get` | 1 |  | read | `items.service.ts` |
| `getChangeNoticeDiff` | `items.changeNoticeDiff.get` | 1 |  | read | `items.service.ts` |
| `getChangeNoticeRequiredActions` | `items.changeNoticeRequiredActions.get` | 1 |  | read | `items.service.ts` |
| `getChangeNoticeRequiredActionsList` | `items.changeNoticeRequiredActionsList.get` | 1 |  | read | `items.service.ts` |
| `getChangeNoticeTypes` | `items.changeNoticeTypes.get` | 1 |  | read | `items.service.ts` |
| `getChangeNotices` | `items.changeNotices.get` | 1 |  | read | `items.service.ts` |
| `getChangeNoticesForNonConformance` | `items.changeNoticesForNonConformance.get` | 1 |  | read | `items.service.ts` |
| `getConsumable` | `items.consumable.get` | 1 |  | read | `items.service.ts` |
| `getConsumables` | `items.consumables.get` | 1 |  | read | `items.service.ts` |
| `getDemandForecastSources` | `items.demandForecastSources.get` | 1 |  | read | `items.service.ts` |
| `getItemCustomerParts` | `items.itemCustomerParts.get` | 1 |  | read | `items.service.ts` |
| `getItemDemand` | `items.itemDemand.get` | 1 |  | read | `items.service.ts` |
| `getItemMpnsList` | `items.itemMpnsList.get` | 1 |  | read | `items.service.ts` |
| `getItemPostingGroups` | `items.itemPostingGroups.get` | 1 |  | read | `items.service.ts` |
| `getItemPostingGroupsList` | `items.itemPostingGroupsList.get` | 1 |  | read | `items.service.ts` |
| `getItemStockQuantitiesByLocation` | `items.itemStockQuantitiesByLocation.get` | 1 |  | read | `items.service.ts` |
| `getItemSupersessionsForItems` | `items.itemSupersessionsForItems.get` | 1 |  | read | `items.service.ts` |
| `getItemSupply` | `items.itemSupply.get` | 1 |  | read | `items.service.ts` |
| `getMaterial` | `items.material.get` | 1 |  | read | `items.service.ts` |
| `getMaterialDimensionList` | `items.materialDimensionList.get` | 1 |  | read | `items.service.ts` |
| `getMaterialDimensions` | `items.materialDimensions.get` | 1 |  | read | `items.service.ts` |
| `getMaterialFinishList` | `items.materialFinishList.get` | 1 |  | read | `items.service.ts` |
| `getMaterialFinishes` | `items.materialFinishes.get` | 1 |  | read | `items.service.ts` |
| `getMaterialForms` | `items.materialForms.get` | 1 |  | read | `items.service.ts` |
| `getMaterialGradeList` | `items.materialGradeList.get` | 1 |  | read | `items.service.ts` |
| `getMaterialGrades` | `items.materialGrades.get` | 1 |  | read | `items.service.ts` |
| `getMaterialSubstances` | `items.materialSubstances.get` | 1 |  | read | `items.service.ts` |
| `getMaterialTypeList` | `items.materialTypeList.get` | 1 |  | read | `items.service.ts` |
| `getMaterialTypes` | `items.materialTypes.get` | 1 |  | read | `items.service.ts` |
| `getMaterials` | `items.materials.get` | 1 |  | read | `items.service.ts` |
| `getMethodMaterials` | `items.methodMaterials.get` | 1 |  | read | `items.service.ts` |
| `getMethodOperations` | `items.methodOperations.get` | 1 |  | read | `items.service.ts` |
| `getOpenJobMaterials` | `items.openJobMaterials.get` | 1 |  | read | `items.service.ts` |
| `getOpenProductionOrders` | `items.openProductionOrders.get` | 1 |  | read | `items.service.ts` |
| `getOpenPurchaseOrderLines` | `items.openPurchaseOrderLines.get` | 1 |  | read | `items.service.ts` |
| `getOpenSalesOrderLines` | `items.openSalesOrderLines.get` | 1 |  | read | `items.service.ts` |
| `getParts` | `items.parts.get` | 1 |  | read | `items.service.ts` |
| `getPartsList` | `items.partsList.get` | 1 |  | read | `items.service.ts` |
| `getRecipeProcessIdsForItem` | `items.recipeProcessIdsForItem.get` | 1 |  | read | `items.service.ts` |
| `getService` | `items.service.get` | 1 |  | read | `items.service.ts` |
| `getServices` | `items.services.get` | 1 |  | read | `items.service.ts` |
| `getServicesList` | `items.servicesList.get` | 1 |  | read | `items.service.ts` |
| `getSupersessionChain` | `items.supersessionChain.get` | 1 |  | read | `items.service.ts` |
| `getTool` | `items.tool.get` | 1 |  | read | `items.service.ts` |
| `getTools` | `items.tools.get` | 1 |  | read | `items.service.ts` |
| `getUnitOfMeasures` | `items.unitOfMeasures.get` | 1 |  | read | `items.service.ts` |
| `getUnreleasedChangeOrderItems` | `items.unreleasedChangeOrderItems.get` |  | 1 |  | `items.server.ts` |
| `notifyChangeNoticeTransition` | `items.notifyChangeNoticeTransition` |  | 1 |  | `items.server.ts` |
| `removeChangeNoticeAffectedItem` | `items.changeNoticeAffectedItem.remove` |  | 1 | action | `items.service.ts` |
| `requireItemChangeNoticeUnlocked` | `items.requireItemChangeNoticeUnlocked` |  | 1 |  | `items.server.ts` |
| `setChangeNoticeActionTasks` | `items.changeNoticeActionTasks.set` |  | 1 | update | `items.service.ts` |
| `setMethodMaterialStepLink` | `items.methodMaterialStepLink.set` |  | 1 | update | `items.service.ts` |
| `setMethodOperationToolStepLink` | `items.methodOperationToolStepLink.set` |  | 1 | update | `items.service.ts` |
| `unreleasedChangeOrderItemsMessage` | `items.unreleasedChangeOrderItemsMessage` |  | 1 |  | `items.server.ts` |
| `updateChangeNoticeActionOrder` | `items.changeNoticeActionOrder.update` |  | 1 | update | `items.service.ts` |
| `updateChangeNoticeActionStatus` | `items.changeNoticeActionStatus.update` |  | 1 | update | `items.service.ts` |
| `updateChangeNoticeAffectedItemChangeType` | `items.changeNoticeAffectedItemChangeType.update` |  | 1 | update | `items.service.ts` |
| `updateChangeNoticeAffectedItemCutover` | `items.changeNoticeAffectedItemCutover.update` |  | 1 | update | `items.service.ts` |
| `updateChangeNoticeStatus` | `items.changeNoticeStatus.update` |  | 1 | update | `items.service.ts` |
| `updateConfigurationParameterGroupOrder` | `items.configurationParameterGroupOrder.update` |  | 1 | update | `items.service.ts` |
| `updateConfigurationParameterOrder` | `items.configurationParameterOrder.update` |  | 1 | update | `items.service.ts` |
| `updateDefaultRevision` | `items.defaultRevision.update` |  | 1 | update | `items.service.ts` |
| `updateItem` | `items.item.update` |  | 1 | update | `items.service.ts` |
| `updateItemCost` | `items.itemCost.update` |  | 1 | update | `items.service.ts` |
| `updateItemMethodAndSourcing` | `items.itemMethodAndSourcing.update` |  | 1 | update | `items.service.ts` |
| `updateMaterialOrder` | `items.materialOrder.update` |  | 1 | update | `items.service.ts` |
| `updateMaterialProperties` | `items.materialProperties.update` |  | 1 | update | `items.service.ts` |
| `updateOperationOrder` | `items.operationOrder.update` |  | 1 | update | `items.service.ts` |
| `updateRevision` | `items.revision.update` |  | 1 | update | `items.service.ts` |
| `updateServiceName` | `items.serviceName.update` |  | 1 |  | `items.service.ts` |
| `upsertConfigurationParameter` | `items.configurationParameter.upsert` |  | 1 | upsert | `items.service.ts` |
| `upsertConfigurationParameterGroup` | `items.configurationParameterGroup.upsert` |  | 1 | upsert | `items.service.ts` |
| `upsertConfigurationRule` | `items.configurationRule.upsert` |  | 1 | upsert | `items.service.ts` |
| `upsertItemSupersession` | `items.itemSupersession.upsert` |  | 1 | upsert | `items.service.ts` |
| `upsertMakeMethodVersion` | `items.makeMethodVersion.upsert` |  | 1 | upsert | `items.service.ts` |
| `upsertMethodOperationStepSlide` | `items.methodOperationStepSlide.upsert` |  | 1 | upsert | `items.service.ts` |

</details>

### people

43 of 49 functions are called by a route. The other 6 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 43 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getAttribute` | `people.attribute.get` | 1 | 2 | read | `people.service.ts` |
| `getDepartmentsList` | `people.departmentsList.get` | 3 |  | read | `people.service.ts` |
| `clockIn` | `people.clockIn` |  | 2 | action | `people.service.ts` |
| `clockOut` | `people.clockOut` |  | 2 | action | `people.service.ts` |
| `deleteTimeCardEntry` | `people.timeCardEntry.delete` |  | 2 | delete | `people.service.ts` |
| `getAttributeCategories` | `people.attributeCategories.get` | 2 |  | read | `people.service.ts` |
| `getAttributeCategory` | `people.attributeCategory.get` | 2 |  | read | `people.service.ts` |
| `getAttributeDataTypes` | `people.attributeDataTypes.get` | 2 |  | read | `people.service.ts` |
| `getDepartment` | `people.department.get` | 2 |  | read | `people.service.ts` |
| `getHoliday` | `people.holiday.get` | 2 |  | read | `people.service.ts` |
| `getOpenClockEntry` | `people.openClockEntry.get` | 2 |  | read | `people.service.ts` |
| `getShift` | `people.shift.get` | 2 |  | read | `people.service.ts` |
| `getShiftsList` | `people.shiftsList.get` | 2 |  | read | `people.service.ts` |
| `getShiftsWithTimes` | `people.shiftsWithTimes.get` | 2 |  | read | `people.service.ts` |
| `getTimeCardEntry` | `people.timeCardEntry.get` | 2 |  | read | `people.service.ts` |
| `insertEmployeeJob` | `people.employeeJob.insert` |  | 2 | create | `people.service.ts` |
| `updateTimeCardEntry` | `people.timeCardEntry.update` |  | 2 | update | `people.service.ts` |
| `upsertDepartment` | `people.department.upsert` |  | 2 | upsert | `people.service.ts` |
| `upsertHoliday` | `people.holiday.upsert` |  | 2 | upsert | `people.service.ts` |
| `upsertShift` | `people.shift.upsert` |  | 2 | upsert | `people.service.ts` |
| `createTimeCardEntry` | `people.timeCardEntry.create` |  | 1 | create | `people.service.ts` |
| `deleteAttribute` | `people.attribute.delete` |  | 1 | delete | `people.service.ts` |
| `deleteAttributeCategory` | `people.attributeCategory.delete` |  | 1 | delete | `people.service.ts` |
| `deleteDepartment` | `people.department.delete` |  | 1 | delete | `people.service.ts` |
| `deleteHoliday` | `people.holiday.delete` |  | 1 | delete | `people.service.ts` |
| `deleteShift` | `people.shift.delete` |  | 1 | delete | `people.service.ts` |
| `getDepartmentsTree` | `people.departmentsTree.get` | 1 |  | read | `people.service.ts` |
| `getEmployeeDepartments` | `people.employeeDepartments.get` | 1 |  | read | `people.service.ts` |
| `getEmployeeJob` | `people.employeeJob.get` | 1 |  | read | `people.service.ts` |
| `getEmployeeShifts` | `people.employeeShifts.get` | 1 |  | read | `people.service.ts` |
| `getEmployeeSummary` | `people.employeeSummary.get` | 1 |  | read | `people.service.ts` |
| `getHolidayYears` | `people.holidayYears.get` | 1 |  | read | `people.service.ts` |
| `getHolidays` | `people.holidays.get` | 1 |  | read | `people.service.ts` |
| `getPeople` | `people.people.get` | 1 |  | read | `people.service.ts` |
| `getShifts` | `people.shifts.get` | 1 |  | read | `people.service.ts` |
| `getTimeCardEntries` | `people.timeCardEntries.get` | 1 |  | read | `people.service.ts` |
| `getTimecardEntries` | `people.timecardEntries.get` | 1 |  | read | `people.service.ts` |
| `insertAttribute` | `people.attribute.insert` |  | 1 | create | `people.service.ts` |
| `insertAttributeCategory` | `people.attributeCategory.insert` |  | 1 | create | `people.service.ts` |
| `updateAttribute` | `people.attribute.update` |  | 1 | update | `people.service.ts` |
| `updateAttributeCategory` | `people.attributeCategory.update` |  | 1 | update | `people.service.ts` |
| `updateAttributeSortOrder` | `people.attributeSortOrder.update` |  | 1 | update | `people.service.ts` |
| `updateEmployeeJob` | `people.employeeJob.update` |  | 1 | update | `people.service.ts` |

</details>

### production

212 of 276 functions are called by a route. The other 64 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 212 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `notifyScheduleInputsChanged` | `production.notifyScheduleInputsChanged` |  | 24 | action | `production.service.ts` |
| `getJob` | `production.job.get` | 9 | 3 | read | `production.service.ts` |
| `recalculateJobOperationDependencies` | `production.jobOperationDependencies.recalculate` |  | 7 | update | `production.service.ts` |
| `getJobOperations` | `production.jobOperations.get` | 6 |  | read | `production.service.ts` |
| `isAssemblerServiceHealthy` | `production.assemblerServiceHealthy.is` | 1 | 5 |  | `production.server.ts` |
| `recalculateJobRequirements` | `production.jobRequirements.recalculate` |  | 6 | update | `production.service.ts` |
| `replanAfterItemChange` | `production.replanAfterItemChange` |  | 6 |  | `production.server.ts` |
| `getJobMethodTree` | `production.jobMethodTree.get` | 5 |  | read | `production.service.ts` |
| `getJobOperationsByMethodId` | `production.jobOperationsByMethodId.get` | 4 |  | read | `production.service.ts` |
| `getLatestAssemblyPlanJob` | `production.latestAssemblyPlanJob.get` | 1 | 3 | read | `production.service.ts` |
| `insertJob` | `production.job.insert` |  | 4 | create | `production.service.ts` |
| `runMRP` | `production.mRP.run` |  | 4 | update | `production.service.ts` |
| `syncAssemblyStepMaterialsFromMappings` | `production.assemblyStepMaterialsFromMappings.sync` |  | 4 | update | `production.service.ts` |
| `upsertJobMethod` | `production.jobMethod.upsert` |  | 4 | upsert | `production.service.ts` |
| `createAssemblyPlanJob` | `production.assemblyPlanJob.create` |  | 3 | create | `production.service.ts` |
| `getJobMakeMethodById` | `production.jobMakeMethodById.get` | 3 |  | read | `production.service.ts` |
| `getJobReleaseReadiness` | `production.jobReleaseReadiness.get` | 1 | 2 | read | `production.service.ts` |
| `logAssemblyStep` | `production.logAssemblyStep` |  | 3 |  | `assembly-debug.server.ts` |
| `readAndLogFormData` | `production.readAndLogFormData` |  | 3 |  | `assembly-debug.server.ts` |
| `recalculateJobMakeMethodRequirements` | `production.jobMakeMethodRequirements.recalculate` |  | 3 | update | `production.service.ts` |
| `updateJobOperationBatch` | `production.jobOperationBatch.update` |  | 3 | update | `production.service.ts` |
| `assignPlanningActions` | `production.planningActions.assign` |  | 2 |  | `production.service.ts` |
| `cancelJob` | `production.job.cancel` |  | 2 |  | `production.server.ts` |
| `dismissPlanningActions` | `production.dismissPlanningActions` |  | 2 |  | `production.service.ts` |
| `getBatchOutputLots` | `production.batchOutputLots.get` | 1 | 1 | read | `production.service.ts` |
| `getJobMaterialsByMethodId` | `production.jobMaterialsByMethodId.get` | 2 |  | read | `production.service.ts` |
| `getJobMaterialsWithQuantityOnHand` | `production.jobMaterialsWithQuantityOnHand.get` | 2 |  | read | `production.service.ts` |
| `getJobOperationBatchWithMembers` | `production.jobOperationBatchWithMembers.get` | 2 |  | read | `production.service.ts` |
| `getJobOperationsList` | `production.jobOperationsList.get` | 2 |  | read | `production.service.ts` |
| `getJobOrderStatusMap` | `production.jobOrderStatusMap.get` | 2 |  | read | `production.service.ts` |
| `getLocationEmployees` | `production.locationEmployees.get` | 2 |  | read | `production.service.ts` |
| `getPlanningActions` | `production.planningActions.get` | 2 |  |  | `production.service.ts` |
| `getPlanningActionsByIds` | `production.planningActionsByIds.get` |  | 2 |  | `production.service.ts` |
| `getProductionDataByOperations` | `production.productionDataByOperations.get` | 2 |  | read | `production.service.ts` |
| `getScrapReason` | `production.scrapReason.get` | 2 |  | read | `production.service.ts` |
| `getScrapReasons` | `production.scrapReasons.get` | 2 |  | read | `production.service.ts` |
| `getTrackedEntityByJobId` | `production.trackedEntityByJobId.get` | 2 |  | read | `production.service.ts` |
| `pullJobMaterialMakeMethod` | `production.pullJobMaterialMakeMethod` |  | 2 | action | `production.service.ts` |
| `releaseBatchMemberJobs` | `production.batchMemberJobs.release` |  | 2 |  | `production.server.ts` |
| `releaseJobOperationBatch` | `production.jobOperationBatch.release` |  | 2 | update | `production.service.ts` |
| `releaseJobs` | `production.jobs.release` |  | 2 |  | `production.server.ts` |
| `reopenDismissedPlanningActions` | `production.dismissedPlanningActions.reopen` |  | 2 |  | `production.service.ts` |
| `settleNewSupplyPlanningActions` | `production.settleNewSupplyPlanningActions` |  | 2 |  | `production.service.ts` |
| `upsertAssemblyInstruction` | `production.assemblyInstruction.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertAssemblyInstructionStepMaterial` | `production.assemblyInstructionStepMaterial.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertAssemblyUnit` | `production.assemblyUnit.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertJobMaterial` | `production.jobMaterial.upsert` |  | 2 |  | `production.service.ts` |
| `upsertJobOperation` | `production.jobOperation.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertJobOperationParameter` | `production.jobOperationParameter.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertJobOperationStep` | `production.jobOperationStep.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertJobOperationTool` | `production.jobOperationTool.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertProcedureParameter` | `production.procedureParameter.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertProcedureStep` | `production.procedureStep.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertProductionEvent` | `production.productionEvent.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertProductionQuantity` | `production.productionQuantity.upsert` |  | 2 | upsert | `production.service.ts` |
| `upsertScrapReason` | `production.scrapReason.upsert` |  | 2 | upsert | `production.service.ts` |
| `activateAssemblyInstructionVersion` | `production.activateAssemblyInstructionVersion` |  | 1 | action | `production.service.ts` |
| `applyProductionPlanningDateActions` | `production.productionPlanningDateActions.apply` |  | 1 |  | `production.service.ts` |
| `assignPeopleWeek` | `production.peopleWeek.assign` |  | 1 | action | `production.service.ts` |
| `autoMatchAssemblyComponents` | `production.autoMatchAssemblyComponents` |  | 1 | action | `production.service.ts` |
| `buildPeopleCapacityBuckets` | `production.buildPeopleCapacityBuckets` | 1 |  |  | `peopleCapacity.server.ts` |
| `calculateJobPriority` | `production.jobPriority.calculate` |  | 1 | action | `production.service.ts` |
| `clearPeopleAbsence` | `production.clearPeopleAbsence` |  | 1 | action | `production.service.ts` |
| `convertSalesOrderLinesToJobs` | `production.salesOrderLinesToJobs.convert` |  | 1 | update | `production.service.ts` |
| `copyAssemblyInstructionAsVersion` | `production.assemblyInstructionAsVersion.copy` |  | 1 | create | `production.service.ts` |
| `copyPeopleBoard` | `production.peopleBoard.copy` |  | 1 | create | `production.service.ts` |
| `copyPeopleWeek` | `production.peopleWeek.copy` |  | 1 | create | `production.service.ts` |
| `createJobOperationBatch` | `production.jobOperationBatch.create` |  | 1 | create | `production.service.ts` |
| `deleteAssemblyComponentMapping` | `production.assemblyComponentMapping.delete` |  | 1 | delete | `production.service.ts` |
| `deleteAssemblyInstruction` | `production.assemblyInstruction.delete` |  | 1 | delete | `production.service.ts` |
| `deleteAssemblyInstructionStep` | `production.assemblyInstructionStep.delete` |  | 1 | delete | `production.service.ts` |
| `deleteAssemblyInstructionStepMaterial` | `production.assemblyInstructionStepMaterial.delete` |  | 1 | delete | `production.service.ts` |
| `deleteAssemblyInstructionStepSlide` | `production.assemblyInstructionStepSlide.delete` |  | 1 | delete | `production.service.ts` |
| `deleteAssemblyInstructionStepTool` | `production.assemblyInstructionStepTool.delete` |  | 1 | delete | `production.service.ts` |
| `deleteAssemblySubAssembly` | `production.assemblySubAssembly.delete` |  | 1 | delete | `production.service.ts` |
| `deleteAssemblyUnit` | `production.assemblyUnit.delete` |  | 1 | delete | `production.service.ts` |
| `deleteJob` | `production.job.delete` |  | 1 | delete | `production.service.ts` |
| `deleteJobMaterial` | `production.jobMaterial.delete` |  | 1 | delete | `production.service.ts` |
| `deleteJobOperationParameter` | `production.jobOperationParameter.delete` |  | 1 | delete | `production.service.ts` |
| `deleteJobOperationStep` | `production.jobOperationStep.delete` |  | 1 | delete | `production.service.ts` |
| `deleteJobOperationStepSlide` | `production.jobOperationStepSlide.delete` |  | 1 | delete | `production.service.ts` |
| `deleteJobOperationTool` | `production.jobOperationTool.delete` |  | 1 | delete | `production.service.ts` |
| `deletePeopleAssignment` | `production.peopleAssignment.delete` |  | 1 | delete | `production.service.ts` |
| `deleteProcedure` | `production.procedure.delete` |  | 1 | delete | `production.service.ts` |
| `deleteProcedureParameter` | `production.procedureParameter.delete` |  | 1 | delete | `production.service.ts` |
| `deleteProcedureStep` | `production.procedureStep.delete` |  | 1 | delete | `production.service.ts` |
| `deleteProductionEvent` | `production.productionEvent.delete` |  | 1 | delete | `production.service.ts` |
| `deleteProductionQuantity` | `production.productionQuantity.delete` |  | 1 | delete | `production.service.ts` |
| `deleteScrapReason` | `production.scrapReason.delete` |  | 1 | delete | `production.service.ts` |
| `duplicateJobOperationStep` | `production.jobOperationStep.duplicate` |  | 1 | create | `production.service.ts` |
| `generateAssemblyStepsFromPlan` | `production.assemblyStepsFromPlan.generate` |  | 1 | create | `production.service.ts` |
| `getActiveEmployeeAbilities` | `production.activeEmployeeAbilities.get` | 1 |  | read | `production.service.ts` |
| `getActiveJobOperationByJobId` | `production.activeJobOperationByJobId.get` | 1 |  | read | `production.service.ts` |
| `getActiveJobOperationsByLocation` | `production.activeJobOperationsByLocation.get` | 1 |  | read | `production.service.ts` |
| `getActiveProductionEvents` | `production.activeProductionEvents.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyComponentMappings` | `production.assemblyComponentMappings.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstruction` | `production.assemblyInstruction.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstructionStepMaterials` | `production.assemblyInstructionStepMaterials.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstructionStepSlides` | `production.assemblyInstructionStepSlides.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstructionStepTools` | `production.assemblyInstructionStepTools.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstructionSteps` | `production.assemblyInstructionSteps.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstructionVersions` | `production.assemblyInstructionVersions.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstructions` | `production.assemblyInstructions.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyInstructionsForItem` | `production.assemblyInstructionsForItem.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyPlanJson` | `production.assemblyPlanJson.get` | 1 |  | read | `production.service.ts` |
| `getAssemblyUnits` | `production.assemblyUnits.get` | 1 |  | read | `production.service.ts` |
| `getBatchableOperations` | `production.batchableOperations.get` | 1 |  | read | `production.service.ts` |
| `getBatchableProcesses` | `production.batchableProcesses.get` | 1 |  | read | `production.service.ts` |
| `getCapacityReservationsForResources` | `production.capacityReservationsForResources.get` | 1 |  | read | `production.service.ts` |
| `getCompletionJobs` | `production.completionJobs.get` | 1 |  | read | `production.service.ts` |
| `getDemandProjections` | `production.demandProjections.get` | 1 |  | read | `production.service.ts` |
| `getFlattenedBomMaterials` | `production.flattenedBomMaterials.get` | 1 |  | read | `production.service.ts` |
| `getForecastNonWorkingIntervals` | `production.forecastNonWorkingIntervals.get` | 1 |  |  | `forecast.server.ts` |
| `getJobDocuments` | `production.jobDocuments.get` | 1 |  | read | `production.service.ts` |
| `getJobDocumentsWithItemId` | `production.jobDocumentsWithItemId.get` | 1 |  | read | `production.service.ts` |
| `getJobExpediteForecast` | `production.jobExpediteForecast.get` |  | 1 | read | `production.service.ts` |
| `getJobMaterialItemIds` | `production.jobMaterialItemIds.get` | 1 |  | read | `production.service.ts` |
| `getJobOperationAttachments` | `production.jobOperationAttachments.get` | 1 |  | read | `production.service.ts` |
| `getJobOperationBatchEvents` | `production.jobOperationBatchEvents.get` | 1 |  | read | `production.service.ts` |
| `getJobOperationBatchMemberStats` | `production.jobOperationBatchMemberStats.get` | 1 |  | read | `production.service.ts` |
| `getJobOperationBatchMembers` | `production.jobOperationBatchMembers.get` | 1 |  | read | `production.service.ts` |
| `getJobOperationBatches` | `production.jobOperationBatches.get` | 1 |  | read | `production.service.ts` |
| `getJobOperationDependencies` | `production.jobOperationDependencies.get` | 1 |  | read | `production.service.ts` |
| `getJobOperationStepRecords` | `production.jobOperationStepRecords.get` | 1 |  | read | `production.service.ts` |
| `getJobPurchaseOrderLines` | `production.jobPurchaseOrderLines.get` | 1 |  | read | `production.service.ts` |
| `getJobReceiptSnapshot` | `production.jobReceiptSnapshot.get` | 1 |  | read | `production.service.ts` |
| `getJobs` | `production.jobs.get` | 1 |  | read | `production.service.ts` |
| `getJobsByDateRange` | `production.jobsByDateRange.get` | 1 |  | read | `production.service.ts` |
| `getJobsBySalesOrderLine` | `production.jobsBySalesOrderLine.get` | 1 |  | read | `production.service.ts` |
| `getJobsList` | `production.jobsList.get` | 1 |  | read | `production.service.ts` |
| `getMaintenanceDowntimeForResources` | `production.maintenanceDowntimeForResources.get` | 1 |  | read | `production.service.ts` |
| `getModelForItem` | `production.modelForItem.get` |  | 1 | read | `production.service.ts` |
| `getOutsideOperationsByJobId` | `production.outsideOperationsByJobId.get` | 1 |  | read | `production.service.ts` |
| `getPartDocuments` | `production.partDocuments.get` | 1 |  |  | `production.service.ts` |
| `getPeopleAbsences` | `production.peopleAbsences.get` | 1 |  | read | `production.service.ts` |
| `getPeopleAbsencesRange` | `production.peopleAbsencesRange.get` | 1 |  | read | `production.service.ts` |
| `getPeopleAssignments` | `production.peopleAssignments.get` | 1 |  | read | `production.service.ts` |
| `getPeopleAssignmentsRange` | `production.peopleAssignmentsRange.get` | 1 |  | read | `production.service.ts` |
| `getPeopleCapacityOperations` | `production.peopleCapacityOperations.get` | 1 |  | read | `production.service.ts` |
| `getProcedure` | `production.procedure.get` | 1 |  | read | `production.service.ts` |
| `getProcedureVersions` | `production.procedureVersions.get` | 1 |  | read | `production.service.ts` |
| `getProcedures` | `production.procedures.get` | 1 |  | read | `production.service.ts` |
| `getProceduresList` | `production.proceduresList.get` | 1 |  | read | `production.service.ts` |
| `getProductionEvent` | `production.productionEvent.get` | 1 |  | read | `production.service.ts` |
| `getProductionEvents` | `production.productionEvents.get` | 1 |  | read | `production.service.ts` |
| `getProductionPlanning` | `production.productionPlanning.get` | 1 |  | read | `production.service.ts` |
| `getProductionProjections` | `production.productionProjections.get` | 1 |  | read | `production.service.ts` |
| `getProductionQuantities` | `production.productionQuantities.get` | 1 |  | read | `production.service.ts` |
| `getProductionQuantity` | `production.productionQuantity.get` | 1 |  | read | `production.service.ts` |
| `getRootMakeMethod` | `production.rootMakeMethod.get` | 1 |  | read | `production.service.ts` |
| `getScrapReasonsList` | `production.scrapReasonsList.get` | 1 |  | read | `production.service.ts` |
| `getTrackedEntitiesByJobId` | `production.trackedEntitiesByJobId.get` | 1 |  | read | `production.service.ts` |
| `getUnbatchedBatchableOperationCount` | `production.unbatchedBatchableOperationCount.get` | 1 |  | read | `production.service.ts` |
| `getUnscheduledJobs` | `production.unscheduledJobs.get` | 1 |  | read | `production.service.ts` |
| `getWorkCenterCalendarHoursByDay` | `production.workCenterCalendarHoursByDay.get` | 1 |  |  | `peopleCapacity.server.ts` |
| `getWorkCenterRequiredAbilities` | `production.workCenterRequiredAbilities.get` | 1 |  | read | `production.service.ts` |
| `getWorkCenterReservationsRange` | `production.workCenterReservationsRange.get` | 1 |  | read | `production.service.ts` |
| `getWorkCenterShifts` | `production.workCenterShifts.get` | 1 |  | read | `production.service.ts` |
| `insertAssemblyInstructionStep` | `production.assemblyInstructionStep.insert` |  | 1 | create | `production.service.ts` |
| `invalidateAssemblyModelCache` | `production.invalidateAssemblyModelCache` |  | 1 | action | `production.service.ts` |
| `makeAssemblySubAssembly` | `production.makeAssemblySubAssembly` |  | 1 | action | `production.service.ts` |
| `markPlanningActionsActioned` | `production.markPlanningActionsActioned` |  | 1 |  | `production.service.ts` |
| `movePeopleAssignment` | `production.peopleAssignment.move` |  | 1 | update | `production.service.ts` |
| `movePeopleWeek` | `production.peopleWeek.move` |  | 1 | update | `production.service.ts` |
| `planDraftJob` | `production.planDraftJob` |  | 1 |  | `production.server.ts` |
| `reassignAssemblyStepComponents` | `production.reassignAssemblyStepComponents` |  | 1 | action | `production.service.ts` |
| `releasePlanningActionClaim` | `production.planningActionClaim.release` |  | 1 |  | `production.service.ts` |
| `reorderScheduleOperations` | `production.reorderScheduleOperations` |  | 1 |  | `production.server.ts` |
| `returnPickedRemaindersForJob` | `production.returnPickedRemaindersForJob` |  | 1 |  | `production.service.ts` |
| `returnPickedRemaindersForOperation` | `production.returnPickedRemaindersForOperation` |  | 1 |  | `production.service.ts` |
| `setJobMaterialStepLink` | `production.jobMaterialStepLink.set` |  | 1 | update | `production.service.ts` |
| `setJobOperationToolStepLink` | `production.jobOperationToolStepLink.set` |  | 1 | update | `production.service.ts` |
| `setPeopleAbsence` | `production.peopleAbsence.set` |  | 1 | update | `production.service.ts` |
| `setPeopleAbsenceRange` | `production.peopleAbsenceRange.set` |  | 1 | update | `production.service.ts` |
| `setPeopleAssignmentHours` | `production.peopleAssignmentHours.set` |  | 1 | update | `production.service.ts` |
| `setPeopleDay` | `production.peopleDay.set` |  | 1 | update | `production.service.ts` |
| `setPeopleOvertimeBulk` | `production.peopleOvertimeBulk.set` |  | 1 | update | `production.service.ts` |
| `syncAssemblyInstructionToOperation` | `production.assemblyInstructionToOperation.sync` |  | 1 | update | `production.service.ts` |
| `unassignPeopleWeek` | `production.peopleWeek.unassign` |  | 1 | action | `production.service.ts` |
| `ungroupAssemblySubAssembly` | `production.ungroupAssemblySubAssembly` |  | 1 | action | `production.service.ts` |
| `unreleaseJobOperationBatch` | `production.unreleaseJobOperationBatch` |  | 1 | action | `production.service.ts` |
| `updateAssemblyInstructionStatus` | `production.assemblyInstructionStatus.update` |  | 1 | update | `production.service.ts` |
| `updateAssemblyInstructionStepMaterialOrder` | `production.assemblyInstructionStepMaterialOrder.update` |  | 1 | update | `production.service.ts` |
| `updateAssemblyInstructionStepOrder` | `production.assemblyInstructionStepOrder.update` |  | 1 | update | `production.service.ts` |
| `updateAssemblyInstructionStepStatus` | `production.assemblyInstructionStepStatus.update` |  | 1 | update | `production.service.ts` |
| `updateAssemblyStepComponents` | `production.assemblyStepComponents.update` |  | 1 | update | `production.service.ts` |
| `updateAssemblyStepHiddenComponents` | `production.assemblyStepHiddenComponents.update` |  | 1 | update | `production.service.ts` |
| `updateAssemblyStepMotion` | `production.assemblyStepMotion.update` |  | 1 | update | `production.service.ts` |
| `updateAssemblySubAssembly` | `production.assemblySubAssembly.update` |  | 1 | update | `production.service.ts` |
| `updateJob` | `production.job.update` |  | 1 | update | `production.service.ts` |
| `updateJobBatchNumber` | `production.jobBatchNumber.update` |  | 1 | update | `production.service.ts` |
| `updateJobMaterialOrder` | `production.jobMaterialOrder.update` |  | 1 | update | `production.service.ts` |
| `updateJobOperationDueDate` | `production.jobOperationDueDate.update` |  | 1 | update | `production.service.ts` |
| `updateJobOperationOrder` | `production.jobOperationOrder.update` |  | 1 | update | `production.service.ts` |
| `updateJobOperationStatus` | `production.jobOperationStatus.update` |  | 1 | update | `production.service.ts` |
| `updateJobOperationStepOrder` | `production.jobOperationStepOrder.update` |  | 1 | update | `production.service.ts` |
| `updateJobStatus` | `production.jobStatus.update` |  | 1 | update | `production.service.ts` |
| `updateKanbanJob` | `production.kanbanJob.update` |  | 1 | update | `production.service.ts` |
| `updateMethodOperationStepOrder` | `production.methodOperationStepOrder.update` |  | 1 | update | `production.service.ts` |
| `updatePlanningJob` | `production.planningJob.update` |  | 1 |  | `production.service.ts` |
| `updateProcedureStepOrder` | `production.procedureStepOrder.update` |  | 1 | update | `production.service.ts` |
| `updateQuoteOperationStepOrder` | `production.quoteOperationStepOrder.update` |  | 1 | update | `production.service.ts` |
| `upsertAssemblyComponentMapping` | `production.assemblyComponentMapping.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertAssemblyInstructionStep` | `production.assemblyInstructionStep.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertAssemblyInstructionStepSlide` | `production.assemblyInstructionStepSlide.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertAssemblyInstructionStepTool` | `production.assemblyInstructionStepTool.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertJobMaterialMakeMethod` | `production.jobMaterialMakeMethod.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertJobOperationStepSlide` | `production.jobOperationStepSlide.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertMakeMethodFromJob` | `production.makeMethodFromJob.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertMakeMethodFromJobMethod` | `production.makeMethodFromJobMethod.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertPeopleAssignment` | `production.peopleAssignment.upsert` |  | 1 | upsert | `production.service.ts` |
| `upsertProcedure` | `production.procedure.upsert` |  | 1 | upsert | `production.service.ts` |

</details>

### purchasing

126 of 145 functions are called by a route. The other 19 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 126 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getPurchaseOrder` | `purchasing.purchaseOrder.get` | 6 | 11 | read | `purchasing.service.ts` |
| `getSupplierQuote` | `purchasing.supplierQuote.get` | 2 | 8 | read | `purchasing.service.ts` |
| `getPurchaseReturnOrder` | `purchasing.purchaseReturnOrder.get` | 3 | 6 | read | `purchasing.service.ts` |
| `getSupplier` | `purchasing.supplier.get` | 7 | 2 | read | `purchasing.service.ts` |
| `getPurchasingRFQ` | `purchasing.purchasingRFQ.get` | 3 | 5 | read | `purchasing.service.ts` |
| `getSupplierInteractionDocuments` | `purchasing.supplierInteractionDocuments.get` | 4 | 3 | read | `purchasing.service.ts` |
| `getPurchaseOrderLine` | `purchasing.purchaseOrderLine.get` | 2 | 2 | read | `purchasing.service.ts` |
| `getPurchaseOrderLines` | `purchasing.purchaseOrderLines.get` | 2 | 2 | read | `purchasing.service.ts` |
| `getSupplierContact` | `purchasing.supplierContact.get` | 1 | 3 | read | `purchasing.service.ts` |
| `getSupplierInteractionLineDocuments` | `purchasing.supplierInteractionLineDocuments.get` | 4 |  | read | `purchasing.service.ts` |
| `getSupplierLocations` | `purchasing.supplierLocations.get` | 4 |  | read | `purchasing.service.ts` |
| `upsertPurchaseOrderLine` | `purchasing.purchaseOrderLine.upsert` |  | 4 | upsert | `purchasing.service.ts` |
| `getPurchaseOrderLocations` | `purchasing.purchaseOrderLocations.get` | 1 | 2 | read | `purchasing.service.ts` |
| `getPurchaseReturnOrderLine` | `purchasing.purchaseReturnOrderLine.get` | 1 | 2 | read | `purchasing.service.ts` |
| `getPurchaseReturnOrderLines` | `purchasing.purchaseReturnOrderLines.get` | 2 | 1 | read | `purchasing.service.ts` |
| `getPurchasingRFQLines` | `purchasing.purchasingRFQLines.get` | 2 | 1 | read | `purchasing.service.ts` |
| `getSupplierContacts` | `purchasing.supplierContacts.get` | 3 |  | read | `purchasing.service.ts` |
| `getSupplierInteraction` | `purchasing.supplierInteraction.get` | 3 |  | read | `purchasing.service.ts` |
| `getSupplierLocation` | `purchasing.supplierLocation.get` | 3 |  | read | `purchasing.service.ts` |
| `getSupplierQuoteLines` | `purchasing.supplierQuoteLines.get` | 2 | 1 | read | `purchasing.service.ts` |
| `getSupplierTypes` | `purchasing.supplierTypes.get` | 3 |  | read | `purchasing.service.ts` |
| `insertPurchaseOrder` | `purchasing.purchaseOrder.insert` |  | 3 | create | `purchasing.service.ts` |
| `setPurchaseReturnOrderLineTrackedEntities` | `purchasing.purchaseReturnOrderLineTrackedEntities.set` |  | 3 | update | `purchasing.service.ts` |
| `upsertPurchaseReturnOrderLine` | `purchasing.purchaseReturnOrderLine.upsert` |  | 3 | upsert | `purchasing.service.ts` |
| `upsertPurchasingRFQSuppliers` | `purchasing.purchasingRFQSuppliers.upsert` |  | 3 | upsert | `purchasing.service.ts` |
| `deletePurchaseReturnOrder` | `purchasing.purchaseReturnOrder.delete` |  | 2 | delete | `purchasing.service.ts` |
| `getDefaultAttachmentsForPO` | `purchasing.defaultAttachmentsForPO.get` | 1 | 1 | read | `purchasing.service.ts` |
| `getLinkedSupplierQuotes` | `purchasing.linkedSupplierQuotes.get` | 1 | 1 | read | `purchasing.service.ts` |
| `getPurchaseOrderDelivery` | `purchasing.purchaseOrderDelivery.get` | 2 |  | read | `purchasing.service.ts` |
| `getPurchaseReturnOrderLineTrackedEntities` | `purchasing.purchaseReturnOrderLineTrackedEntities.get` | 2 |  | read | `purchasing.service.ts` |
| `getPurchasingTerms` | `purchasing.purchasingTerms.get` | 2 |  | read | `purchasing.service.ts` |
| `getSupplierInteractionLineAttachments` | `purchasing.supplierInteractionLineAttachments.get` |  | 2 |  | `purchasing.service.ts` |
| `getSupplierQuoteByExternalLinkId` | `purchasing.supplierQuoteByExternalLinkId.get` | 1 | 1 | read | `purchasing.service.ts` |
| `getSupplierQuoteLinePricesByQuoteId` | `purchasing.supplierQuoteLinePricesByQuoteId.get` | 2 |  | read | `purchasing.service.ts` |
| `getSupplierTax` | `purchasing.supplierTax.get` | 2 |  | read | `purchasing.service.ts` |
| `getSupplierType` | `purchasing.supplierType.get` | 2 |  | read | `purchasing.service.ts` |
| `insertPurchaseReturnOrder` | `purchasing.purchaseReturnOrder.insert` |  | 2 | create | `purchasing.service.ts` |
| `updatePurchaseOrderStatus` | `purchasing.purchaseOrderStatus.update` |  | 2 | update | `purchasing.service.ts` |
| `updatePurchasingRFQStatus` | `purchasing.purchasingRFQStatus.update` |  | 2 | update | `purchasing.service.ts` |
| `updateSupplierQuoteStatus` | `purchasing.supplierQuoteStatus.update` |  | 2 | update | `purchasing.service.ts` |
| `upsertPurchasingRFQLine` | `purchasing.purchasingRFQLine.upsert` |  | 2 | upsert | `purchasing.service.ts` |
| `upsertSupplier` | `purchasing.supplier.upsert` |  | 2 | upsert | `purchasing.service.ts` |
| `upsertSupplierBankAccount` | `purchasing.supplierBankAccount.upsert` |  | 2 | upsert | `purchasing.service.ts` |
| `upsertSupplierProcess` | `purchasing.supplierProcess.upsert` |  | 2 | upsert | `purchasing.service.ts` |
| `upsertSupplierQuoteLine` | `purchasing.supplierQuoteLine.upsert` |  | 2 | upsert | `purchasing.service.ts` |
| `upsertSupplierType` | `purchasing.supplierType.upsert` |  | 2 | upsert | `purchasing.service.ts` |
| `applyPurchasingPlanningActions` | `purchasing.purchasingPlanningActions.apply` |  | 1 |  | `purchasing.service.ts` |
| `cancelPurchaseReturnOrder` | `purchasing.purchaseReturnOrder.cancel` |  | 1 | action | `purchasing.service.ts` |
| `confirmPurchaseReturnOrder` | `purchasing.confirmPurchaseReturnOrder` |  | 1 | action | `purchasing.service.ts` |
| `convertSupplierQuoteToOrder` | `purchasing.supplierQuoteToOrder.convert` |  | 1 | update | `purchasing.service.ts` |
| `createPurchaseReturnOrderCredit` | `purchasing.purchaseReturnOrderCredit.create` |  | 1 | create | `purchasing.service.ts` |
| `createReplacementPurchaseOrder` | `purchasing.replacementPurchaseOrder.create` |  | 1 | create | `purchasing.service.ts` |
| `deletePurchaseOrder` | `purchasing.purchaseOrder.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deletePurchaseOrderLine` | `purchasing.purchaseOrderLine.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deletePurchaseReturnOrderLine` | `purchasing.purchaseReturnOrderLine.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deletePurchasingRFQ` | `purchasing.purchasingRFQ.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deletePurchasingRFQLine` | `purchasing.purchasingRFQLine.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplier` | `purchasing.supplier.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplierBankAccount` | `purchasing.supplierBankAccount.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplierContact` | `purchasing.supplierContact.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplierLocation` | `purchasing.supplierLocation.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplierProcess` | `purchasing.supplierProcess.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplierQuote` | `purchasing.supplierQuote.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplierQuoteLine` | `purchasing.supplierQuoteLine.delete` |  | 1 | delete | `purchasing.service.ts` |
| `deleteSupplierType` | `purchasing.supplierType.delete` |  | 1 | delete | `purchasing.service.ts` |
| `duplicatePurchaseOrder` | `purchasing.purchaseOrder.duplicate` |  | 1 | create | `purchasing.service.ts` |
| `finalizePurchaseOrder` | `purchasing.purchaseOrder.finalize` |  | 1 | update | `purchasing.service.ts` |
| `finalizePurchasingRfq` | `purchasing.purchasingRfq.finalize` |  | 1 | update | `purchasing.service.ts` |
| `finalizeSupplierQuote` | `purchasing.supplierQuote.finalize` |  | 1 | update | `purchasing.service.ts` |
| `getCreditableQuantitiesForPurchaseReturn` | `purchasing.creditableQuantitiesForPurchaseReturn.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchaseOrderPayment` | `purchasing.purchaseOrderPayment.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchaseOrders` | `purchasing.purchaseOrders.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchaseReturnOrderCredits` | `purchasing.purchaseReturnOrderCredits.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchaseReturnOrderIssues` | `purchasing.purchaseReturnOrderIssues.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchaseReturnOrderShipments` | `purchasing.purchaseReturnOrderShipments.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchaseReturnOrders` | `purchasing.purchaseReturnOrders.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchasingDocumentsAssignedToMe` | `purchasing.purchasingDocumentsAssignedToMe.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchasingPlanning` | `purchasing.purchasingPlanning.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchasingRFQLine` | `purchasing.purchasingRFQLine.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchasingRFQSuppliersWithLinks` | `purchasing.purchasingRFQSuppliersWithLinks.get` | 1 |  | read | `purchasing.service.ts` |
| `getPurchasingRFQs` | `purchasing.purchasingRFQs.get` | 1 |  | read | `purchasing.service.ts` |
| `getReturnableEntitiesForReceiptLine` | `purchasing.returnableEntitiesForReceiptLine.get` |  | 1 | read | `purchasing.service.ts` |
| `getReturnableEntitiesForSupplier` | `purchasing.returnableEntitiesForSupplier.get` | 1 |  | read | `purchasing.service.ts` |
| `getReturnableLinesForSupplier` | `purchasing.returnableLinesForSupplier.get` | 1 |  | read | `purchasing.service.ts` |
| `getSiblingQuotesForQuote` | `purchasing.siblingQuotesForQuote.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierApprovalContext` | `purchasing.supplierApprovalContext.get` | 1 |  |  | `purchasing.server.ts` |
| `getSupplierBankAccounts` | `purchasing.supplierBankAccounts.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierPayment` | `purchasing.supplierPayment.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierProcessesByProcess` | `purchasing.supplierProcessesByProcess.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierProcessesBySupplier` | `purchasing.supplierProcessesBySupplier.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierQuoteLine` | `purchasing.supplierQuoteLine.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierQuoteLinePrices` | `purchasing.supplierQuoteLinePrices.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierQuotes` | `purchasing.supplierQuotes.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierQuotesForComparison` | `purchasing.supplierQuotesForComparison.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierReportContacts` | `purchasing.supplierReportContacts.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierShipping` | `purchasing.supplierShipping.get` | 1 |  | read | `purchasing.service.ts` |
| `getSupplierTypesList` | `purchasing.supplierTypesList.get` | 1 |  | read | `purchasing.service.ts` |
| `getSuppliers` | `purchasing.suppliers.get` | 1 |  | read | `purchasing.service.ts` |
| `getSuppliersList` | `purchasing.suppliersList.get` | 1 |  | read | `purchasing.service.ts` |
| `insertPurchasingRFQ` | `purchasing.purchasingRFQ.insert` |  | 1 | create | `purchasing.service.ts` |
| `insertSupplierContact` | `purchasing.supplierContact.insert` |  | 1 | create | `purchasing.service.ts` |
| `insertSupplierLocation` | `purchasing.supplierLocation.insert` |  | 1 | create | `purchasing.service.ts` |
| `insertSupplierQuote` | `purchasing.supplierQuote.insert` |  | 1 | create | `purchasing.service.ts` |
| `reopenPurchaseOrderAsRevision` | `purchasing.purchaseOrderAsRevision.reopen` |  | 1 | action | `purchasing.service.ts` |
| `reopenPurchaseReturnOrder` | `purchasing.purchaseReturnOrder.reopen` |  | 1 | action | `purchasing.service.ts` |
| `sendSupplierQuote` | `purchasing.supplierQuote.send` |  | 1 | update | `purchasing.service.ts` |
| `shortClosePurchaseOrderLine` | `purchasing.shortClosePurchaseOrderLine` |  | 1 | action | `purchasing.service.ts` |
| `shortClosePurchaseReturnOrderLine` | `purchasing.shortClosePurchaseReturnOrderLine` |  | 1 | action | `purchasing.service.ts` |
| `updatePurchaseOrder` | `purchasing.purchaseOrder.update` |  | 1 | update | `purchasing.service.ts` |
| `updatePurchaseOrderExchangeRate` | `purchasing.purchaseOrderExchangeRate.update` |  | 1 | update | `purchasing.service.ts` |
| `updatePurchaseOrderFavorite` | `purchasing.purchaseOrderFavorite.update` |  | 1 | update | `purchasing.service.ts` |
| `updatePurchaseOrderLineOrder` | `purchasing.purchaseOrderLineOrder.update` |  | 1 | update | `purchasing.service.ts` |
| `updatePurchaseOrderLineSchedule` | `purchasing.purchaseOrderLineSchedule.update` |  | 1 |  | `purchasing.service.ts` |
| `updatePurchasingRFQLineOrder` | `purchasing.purchasingRFQLineOrder.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierContact` | `purchasing.supplierContact.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierLocation` | `purchasing.supplierLocation.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierPayment` | `purchasing.supplierPayment.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierQuote` | `purchasing.supplierQuote.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierQuoteExchangeRate` | `purchasing.supplierQuoteExchangeRate.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierQuoteFavorite` | `purchasing.supplierQuoteFavorite.update` |  | 1 |  | `purchasing.service.ts` |
| `updateSupplierQuoteLineOrder` | `purchasing.supplierQuoteLineOrder.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierShipping` | `purchasing.supplierShipping.update` |  | 1 | update | `purchasing.service.ts` |
| `updateSupplierTax` | `purchasing.supplierTax.update` |  | 1 | update | `purchasing.service.ts` |
| `upsertPurchaseOrderDelivery` | `purchasing.purchaseOrderDelivery.upsert` |  | 1 | upsert | `purchasing.service.ts` |
| `upsertPurchaseOrderPayment` | `purchasing.purchaseOrderPayment.upsert` |  | 1 | upsert | `purchasing.service.ts` |
| `upsertPurchasingRFQ` | `purchasing.purchasingRFQ.upsert` |  | 1 | upsert | `purchasing.service.ts` |

</details>

### quality

99 of 109 functions are called by a route. The other 10 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 99 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getIssueTypesList` | `quality.issueTypesList.get` | 7 | 3 | read | `quality.service.ts` |
| `getIssue` | `quality.issue.get` | 3 | 4 | read | `quality.service.ts` |
| `getInspectionDocumentsForItem` | `quality.inspectionDocumentsForItem.get` | 6 |  | read | `quality.service.ts` |
| `getRequiredActionsList` | `quality.requiredActionsList.get` | 6 |  | read | `quality.service.ts` |
| `getItemInspectionDocumentAssignments` | `quality.itemInspectionDocumentAssignments.get` | 5 |  | read | `quality.service.ts` |
| `upsertItemInspectionDocumentAssignment` | `quality.itemInspectionDocumentAssignment.upsert` |  | 5 | upsert | `quality.service.ts` |
| `deleteIssue` | `quality.issue.delete` |  | 4 | delete | `quality.service.ts` |
| `getGaugeTypesList` | `quality.gaugeTypesList.get` | 4 |  | read | `quality.service.ts` |
| `getInspectionDocument` | `quality.inspectionDocument.get` | 3 | 1 | read | `quality.service.ts` |
| `getIssueActionTasks` | `quality.issueActionTasks.get` | 3 | 1 | read | `quality.service.ts` |
| `insertIssue` | `quality.issue.insert` |  | 4 | create | `quality.service.ts` |
| `dispositionInspection` | `quality.dispositionInspection` |  | 3 |  | `quality.server.ts` |
| `getBalloons` | `quality.balloons.get` | 2 |  | read | `quality.service.ts` |
| `getGaugeType` | `quality.gaugeType.get` | 2 |  | read | `quality.service.ts` |
| `getInspection` | `quality.inspection.get` | 1 | 1 | read | `quality.service.ts` |
| `getInspectionMeasurements` | `quality.inspectionMeasurements.get` | 1 | 1 | read | `quality.service.ts` |
| `getInspectionSamplingPlans` | `quality.inspectionSamplingPlans.get` | 1 | 1 | read | `quality.service.ts` |
| `getIssueAssociations` | `quality.issueAssociations.get` | 2 |  | read | `quality.service.ts` |
| `getIssueFromExternalLink` | `quality.issueFromExternalLink.get` | 1 | 1 | read | `quality.service.ts` |
| `getIssueReviewers` | `quality.issueReviewers.get` | 2 |  | read | `quality.service.ts` |
| `getIssueType` | `quality.issueType.get` | 2 |  | read | `quality.service.ts` |
| `getIssueTypeByName` | `quality.issueTypeByName.get` |  | 2 | read | `quality.service.ts` |
| `getIssueTypes` | `quality.issueTypes.get` | 2 |  | read | `quality.service.ts` |
| `getIssueWorkflowsList` | `quality.issueWorkflowsList.get` | 1 | 1 | read | `quality.service.ts` |
| `getIssues` | `quality.issues.get` | 2 |  | read | `quality.service.ts` |
| `getQualityFiles` | `quality.qualityFiles.get` | 2 |  | read | `quality.service.ts` |
| `getRisk` | `quality.risk.get` | 1 | 1 | read | `quality.service.ts` |
| `linkEntitiesToIssueItemRow` | `quality.linkEntitiesToIssueItemRow` |  | 2 |  | `quality-disposition.server.ts` |
| `updateIssueTaskStatus` | `quality.issueTaskStatus.update` |  | 2 | update | `quality.service.ts` |
| `upsertGaugeCalibrationRecord` | `quality.gaugeCalibrationRecord.upsert` |  | 2 | upsert | `quality.service.ts` |
| `upsertGaugeType` | `quality.gaugeType.upsert` |  | 2 | upsert | `quality.service.ts` |
| `upsertIssueType` | `quality.issueType.upsert` |  | 2 | upsert | `quality.service.ts` |
| `upsertIssueWorkflow` | `quality.issueWorkflow.upsert` |  | 2 | upsert | `quality.service.ts` |
| `upsertRequiredAction` | `quality.requiredAction.upsert` |  | 2 | upsert | `quality.service.ts` |
| `upsertRisk` | `quality.risk.upsert` |  | 2 | upsert | `quality.service.ts` |
| `activateGauge` | `quality.activateGauge` |  | 1 | action | `quality.service.ts` |
| `assignEntitiesToIssueItem` | `quality.entitiesToIssueItem.assign` |  | 1 |  | `quality-disposition.server.ts` |
| `changeInspectionDocument` | `quality.changeInspectionDocument` |  | 1 |  | `quality.server.ts` |
| `closeIssue` | `quality.issue.close` |  | 1 |  | `quality-disposition.server.ts` |
| `deactivateGauge` | `quality.deactivateGauge` |  | 1 | action | `quality.service.ts` |
| `deleteGauge` | `quality.gauge.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteGaugeCalibrationRecord` | `quality.gaugeCalibrationRecord.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteGaugeType` | `quality.gaugeType.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteInspectionDocument` | `quality.inspectionDocument.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteIssueAssociation` | `quality.issueAssociation.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteIssueType` | `quality.issueType.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteIssueWorkflow` | `quality.issueWorkflow.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteQualityDocument` | `quality.qualityDocument.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteRequiredAction` | `quality.requiredAction.delete` |  | 1 | delete | `quality.service.ts` |
| `deleteRisk` | `quality.risk.delete` |  | 1 | delete | `quality.service.ts` |
| `getGauge` | `quality.gauge.get` | 1 |  | read | `quality.service.ts` |
| `getGaugeCalibrationRecord` | `quality.gaugeCalibrationRecord.get` | 1 |  | read | `quality.service.ts` |
| `getGaugeCalibrationRecords` | `quality.gaugeCalibrationRecords.get` | 1 |  | read | `quality.service.ts` |
| `getGaugeCalibrationRecordsByGaugeId` | `quality.gaugeCalibrationRecordsByGaugeId.get` | 1 |  | read | `quality.service.ts` |
| `getGaugeTypes` | `quality.gaugeTypes.get` | 1 |  | read | `quality.service.ts` |
| `getGauges` | `quality.gauges.get` | 1 |  | read | `quality.service.ts` |
| `getGaugesList` | `quality.gaugesList.get` | 1 |  | read | `quality.service.ts` |
| `getInspectionDocuments` | `quality.inspectionDocuments.get` | 1 |  | read | `quality.service.ts` |
| `getInspectionFeatures` | `quality.inspectionFeatures.get` | 1 |  | read | `quality.service.ts` |
| `getInspectionGauges` | `quality.inspectionGauges.get` | 1 |  | read | `quality.service.ts` |
| `getInspectionPlan` | `quality.inspectionPlan.get` | 1 |  | read | `quality.service.ts` |
| `getInspectionTrackedEntities` | `quality.inspectionTrackedEntities.get` | 1 |  | read | `quality.service.ts` |
| `getInspections` | `quality.inspections.get` | 1 |  | read | `quality.service.ts` |
| `getIssueApprovalTasks` | `quality.issueApprovalTasks.get` | 1 |  | read | `quality.service.ts` |
| `getIssueItems` | `quality.issueItems.get` | 1 |  | read | `quality.service.ts` |
| `getIssueSuppliers` | `quality.issueSuppliers.get` | 1 |  | read | `quality.service.ts` |
| `getIssueWorkflow` | `quality.issueWorkflow.get` | 1 |  | read | `quality.service.ts` |
| `getIssueWorkflows` | `quality.issueWorkflows.get` | 1 |  | read | `quality.service.ts` |
| `getQualityActions` | `quality.qualityActions.get` | 1 |  | read | `quality.service.ts` |
| `getQualityDocument` | `quality.qualityDocument.get` | 1 |  | read | `quality.service.ts` |
| `getQualityDocumentVersions` | `quality.qualityDocumentVersions.get` | 1 |  | read | `quality.service.ts` |
| `getQualityDocuments` | `quality.qualityDocuments.get` | 1 |  | read | `quality.service.ts` |
| `getReceiptInspections` | `quality.receiptInspections.get` | 1 |  | read | `quality.service.ts` |
| `getRecentInspectionGauges` | `quality.recentInspectionGauges.get` | 1 |  |  | `quality.server.ts` |
| `getRequiredAction` | `quality.requiredAction.get` | 1 |  | read | `quality.service.ts` |
| `getRequiredActions` | `quality.requiredActions.get` | 1 |  | read | `quality.service.ts` |
| `getRisks` | `quality.risks.get` | 1 |  | read | `quality.service.ts` |
| `insertGauge` | `quality.gauge.insert` |  | 1 | create | `quality.service.ts` |
| `insertIssueReviewer` | `quality.issueReviewer.insert` |  | 1 | create | `quality.service.ts` |
| `mergeInspectionBalloonsPayload` | `quality.inspectionBalloonsPayload.merge` |  | 1 |  | `quality.server.ts` |
| `mergeInspectionFeaturesPayload` | `quality.inspectionFeaturesPayload.merge` |  | 1 |  | `quality.server.ts` |
| `reconcileInspectionSamplingPlans` | `quality.reconcileInspectionSamplingPlans` | 1 |  |  | `quality.server.ts` |
| `recordInspectionGauge` | `quality.recordInspectionGauge` |  | 1 |  | `quality.server.ts` |
| `resolveInspectionFeaturePayloadIds` | `quality.inspectionFeaturePayloadIds.resolve` |  | 1 |  | `quality.server.ts` |
| `runInspectionBalloonRegionVisionAnalysis` | `quality.inspectionBalloonRegionVisionAnalysis.run` |  | 1 |  | `quality.server.ts` |
| `saveInspectionDocumentAtomic` | `quality.saveInspectionDocumentAtomic` |  | 1 | action | `quality.service.ts` |
| `splitIssueItem` | `quality.issueItem.split` |  | 1 |  | `quality-disposition.server.ts` |
| `translateLegacyInspectionSavePayload` | `quality.translateLegacyInspectionSavePayload` |  | 1 |  | `quality.server.ts` |
| `updateGauge` | `quality.gauge.update` |  | 1 | update | `quality.service.ts` |
| `updateInspectionDocumentSampling` | `quality.inspectionDocumentSampling.update` |  | 1 | update | `quality.service.ts` |
| `updateIssue` | `quality.issue.update` |  | 1 | update | `quality.service.ts` |
| `updateIssueActionProcesses` | `quality.issueActionProcesses.update` |  | 1 | update | `quality.service.ts` |
| `updateIssueItemQuantity` | `quality.issueItemQuantity.update` |  | 1 |  | `quality-disposition.server.ts` |
| `updateIssueStatus` | `quality.issueStatus.update` |  | 1 | update | `quality.service.ts` |
| `updateIssueTaskContent` | `quality.issueTaskContent.update` |  | 1 | update | `quality.service.ts` |
| `upsertInspectionDocument` | `quality.inspectionDocument.upsert` |  | 1 | upsert | `quality.service.ts` |
| `upsertInspectionMeasurement` | `quality.inspectionMeasurement.upsert` |  | 1 |  | `quality.server.ts` |
| `upsertInspectionSample` | `quality.inspectionSample.upsert` |  | 1 |  | `quality.server.ts` |
| `upsertQualityDocument` | `quality.qualityDocument.upsert` |  | 1 | upsert | `quality.service.ts` |

</details>

### resources

86 of 101 functions are called by a route. The other 15 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 86 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getLocationsList` | `resources.locationsList.get` | 31 |  | read | `resources.service.ts` |
| `getMaintenanceDispatch` | `resources.maintenanceDispatch.get` | 2 | 7 | read | `resources.service.ts` |
| `getWorkCentersList` | `resources.workCentersList.get` | 6 |  | read | `resources.service.ts` |
| `postMaintenanceLabor` | `resources.maintenanceLabor.post` |  | 6 |  | `resources.server.ts` |
| `getProcess` | `resources.process.get` | 4 | 1 | read | `resources.service.ts` |
| `getLocation` | `resources.location.get` | 4 |  | read | `resources.service.ts` |
| `upsertLocation` | `resources.location.upsert` |  | 4 | upsert | `resources.service.ts` |
| `ensureProcessAbility` | `resources.ensureProcessAbility` |  | 3 | action | `resources.service.ts` |
| `getAbilitiesList` | `resources.abilitiesList.get` | 3 |  | read | `resources.service.ts` |
| `getFailureModesList` | `resources.failureModesList.get` | 3 |  | read | `resources.service.ts` |
| `getWorkCentersByLocation` | `resources.workCentersByLocation.get` | 3 |  | read | `resources.service.ts` |
| `resolveEmployeeAbilityExpiresAt` | `resources.employeeAbilityExpiresAt.resolve` |  | 3 | action | `resources.service.ts` |
| `upsertEmployeeAbilityCell` | `resources.employeeAbilityCell.upsert` |  | 3 | upsert | `resources.service.ts` |
| `getAbility` | `resources.ability.get` | 2 |  | read | `resources.service.ts` |
| `getContractor` | `resources.contractor.get` | 2 |  | read | `resources.service.ts` |
| `getFailureMode` | `resources.failureMode.get` | 2 |  | read | `resources.service.ts` |
| `getLocations` | `resources.locations.get` | 2 |  | read | `resources.service.ts` |
| `getMaintenanceSchedule` | `resources.maintenanceSchedule.get` | 2 |  | read | `resources.service.ts` |
| `getProcessesList` | `resources.processesList.get` | 2 |  | read | `resources.service.ts` |
| `getSuggestion` | `resources.suggestion.get` | 2 |  | read | `resources.service.ts` |
| `getTraining` | `resources.training.get` | 2 |  | read | `resources.service.ts` |
| `getTrainingAssignmentForCompletion` | `resources.trainingAssignmentForCompletion.get` | 1 | 1 | read | `resources.service.ts` |
| `getTrainingAssignmentStatus` | `resources.trainingAssignmentStatus.get` | 2 |  | read | `resources.service.ts` |
| `getTrainingAssignments` | `resources.trainingAssignments.get` | 1 | 1 | read | `resources.service.ts` |
| `getTrainingGrantedAbilityId` | `resources.trainingGrantedAbilityId.get` |  | 2 | read | `resources.service.ts` |
| `getTrainingsList` | `resources.trainingsList.get` | 2 |  | read | `resources.service.ts` |
| `getWorkCenter` | `resources.workCenter.get` | 2 |  | read | `resources.service.ts` |
| `insertTrainingCompletion` | `resources.trainingCompletion.insert` |  | 2 |  | `resources.service.ts` |
| `upsertContractor` | `resources.contractor.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertFailureMode` | `resources.failureMode.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertMaintenanceDispatchEvent` | `resources.maintenanceDispatchEvent.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertMaintenanceDispatchItem` | `resources.maintenanceDispatchItem.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertMaintenanceSchedule` | `resources.maintenanceSchedule.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertPartner` | `resources.partner.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertProcess` | `resources.process.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertTrainingAssignment` | `resources.trainingAssignment.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertTrainingQuestion` | `resources.trainingQuestion.upsert` |  | 2 | upsert | `resources.service.ts` |
| `upsertWorkCenter` | `resources.workCenter.upsert` |  | 2 | upsert | `resources.service.ts` |
| `activateProcess` | `resources.activateProcess` |  | 1 | action | `resources.service.ts` |
| `activateWorkCenter` | `resources.activateWorkCenter` |  | 1 | action | `resources.service.ts` |
| `deleteAbility` | `resources.ability.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteContractor` | `resources.contractor.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteEmployeeAbility` | `resources.employeeAbility.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteFailureMode` | `resources.failureMode.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteLocation` | `resources.location.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteMaintenanceDispatch` | `resources.maintenanceDispatch.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteMaintenanceDispatchEvent` | `resources.maintenanceDispatchEvent.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteMaintenanceSchedule` | `resources.maintenanceSchedule.delete` |  | 1 | delete | `resources.service.ts` |
| `deletePartner` | `resources.partner.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteProcess` | `resources.process.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteSuggestion` | `resources.suggestion.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteTraining` | `resources.training.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteTrainingAssignment` | `resources.trainingAssignment.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteTrainingQuestion` | `resources.trainingQuestion.delete` |  | 1 | delete | `resources.service.ts` |
| `deleteWorkCenter` | `resources.workCenter.delete` |  | 1 | delete | `resources.service.ts` |
| `getAbilities` | `resources.abilities.get` | 1 |  | read | `resources.service.ts` |
| `getContractors` | `resources.contractors.get` | 1 |  | read | `resources.service.ts` |
| `getEmployeeAbilities` | `resources.employeeAbilities.get` | 1 |  | read | `resources.service.ts` |
| `getEmployeeAbility` | `resources.employeeAbility.get` | 1 |  | read | `resources.service.ts` |
| `getFailureModes` | `resources.failureModes.get` | 1 |  | read | `resources.service.ts` |
| `getMaintenanceDispatchComments` | `resources.maintenanceDispatchComments.get` | 1 |  | read | `resources.service.ts` |
| `getMaintenanceDispatchEvents` | `resources.maintenanceDispatchEvents.get` | 1 |  | read | `resources.service.ts` |
| `getMaintenanceDispatchItems` | `resources.maintenanceDispatchItems.get` | 1 |  | read | `resources.service.ts` |
| `getMaintenanceDispatchesByLocation` | `resources.maintenanceDispatchesByLocation.get` | 1 |  | read | `resources.service.ts` |
| `getMaintenanceSchedulesByLocation` | `resources.maintenanceSchedulesByLocation.get` | 1 |  | read | `resources.service.ts` |
| `getOutstandingTrainingsForUser` | `resources.outstandingTrainingsForUser.get` | 1 |  | read | `resources.service.ts` |
| `getPartner` | `resources.partner.get` | 1 |  | read | `resources.service.ts` |
| `getPartnerBySupplierId` | `resources.partnerBySupplierId.get` | 1 |  | read | `resources.service.ts` |
| `getPartners` | `resources.partners.get` | 1 |  | read | `resources.service.ts` |
| `getProcesses` | `resources.processes.get` | 1 |  | read | `resources.service.ts` |
| `getProcessesWithoutAbility` | `resources.processesWithoutAbility.get` | 1 |  | read | `resources.service.ts` |
| `getSuggestions` | `resources.suggestions.get` | 1 |  | read | `resources.service.ts` |
| `getTrainingAssignment` | `resources.trainingAssignment.get` | 1 |  | read | `resources.service.ts` |
| `getTrainingAssignmentStatusForEmployee` | `resources.trainingAssignmentStatusForEmployee.get` | 1 |  | read | `resources.service.ts` |
| `getTrainingAssignmentSummary` | `resources.trainingAssignmentSummary.get` | 1 |  | read | `resources.service.ts` |
| `getTrainings` | `resources.trainings.get` | 1 |  | read | `resources.service.ts` |
| `getWorkCenters` | `resources.workCenters.get` | 1 |  | read | `resources.service.ts` |
| `getWorkCentersListWithBlockingStatus` | `resources.workCentersListWithBlockingStatus.get` | 1 |  | read | `resources.service.ts` |
| `insertMaintenanceDispatch` | `resources.maintenanceDispatch.insert` |  | 1 | create | `resources.service.ts` |
| `processDeactivate` | `resources.processDeactivate` |  | 1 | action | `resources.service.ts` |
| `updateAbility` | `resources.ability.update` |  | 1 | update | `resources.service.ts` |
| `updateMaintenanceDispatch` | `resources.maintenanceDispatch.update` |  | 1 | update | `resources.service.ts` |
| `updateSuggestionEmoji` | `resources.suggestionEmoji.update` |  | 1 | update | `resources.service.ts` |
| `updateTrainingQuestionOrder` | `resources.trainingQuestionOrder.update` |  | 1 | update | `resources.service.ts` |
| `upsertMaintenanceDispatchComment` | `resources.maintenanceDispatchComment.upsert` |  | 1 | upsert | `resources.service.ts` |
| `upsertTraining` | `resources.training.upsert` |  | 1 | upsert | `resources.service.ts` |

</details>

### sales

245 of 277 functions are called by a route. The other 32 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 245 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getRentalAgreement` | `sales.rentalAgreement.get` | 3 | 13 | read | `sales.service.ts` |
| `getSalesOrder` | `sales.salesOrder.get` | 4 | 11 | read | `sales.service.ts` |
| `getQuote` | `sales.quote.get` | 4 | 9 | read | `sales.service.ts` |
| `recordSalesRuleOutcome` | `sales.recordSalesRuleOutcome` |  | 12 |  | `sales.server.ts` |
| `getContract` | `sales.contract.get` | 1 | 9 | read | `sales.service.ts` |
| `getSalesReturnOrder` | `sales.salesReturnOrder.get` | 2 | 7 | read | `sales.service.ts` |
| `recalculateQuoteLinePrices` | `sales.quoteLinePrices.recalculate` |  | 8 | update | `sales.service.ts` |
| `getSalesRFQ` | `sales.salesRFQ.get` | 2 | 5 | read | `sales.service.ts` |
| `getCustomer` | `sales.customer.get` | 5 | 1 | read | `sales.service.ts` |
| `getRentalAgreementLine` | `sales.rentalAgreementLine.get` | 1 | 5 | read | `sales.service.ts` |
| `getOpportunity` | `sales.opportunity.get` | 5 |  | read | `sales.service.ts` |
| `getSalesOrderLines` | `sales.salesOrderLines.get` | 4 | 1 | read | `sales.service.ts` |
| `getSalesTerms` | `sales.salesTerms.get` | 5 |  | read | `sales.service.ts` |
| `getCustomerItemRentalRate` | `sales.customerItemRentalRate.get` | 2 | 2 | read | `sales.service.ts` |
| `getCustomerLocations` | `sales.customerLocations.get` | 4 |  | read | `sales.service.ts` |
| `getOpportunityDocuments` | `sales.opportunityDocuments.get` | 4 |  | read | `sales.service.ts` |
| `getOpportunityLineDocuments` | `sales.opportunityLineDocuments.get` | 4 |  | read | `sales.service.ts` |
| `getSalesReturnOrderLine` | `sales.salesReturnOrderLine.get` | 1 | 3 | read | `sales.service.ts` |
| `upsertQuoteLineMethod` | `sales.quoteLineMethod.upsert` |  | 4 | upsert | `sales.service.ts` |
| `upsertRentalAgreementLine` | `sales.rentalAgreementLine.upsert` |  | 4 | upsert | `sales.service.ts` |
| `upsertSalesRFQLine` | `sales.salesRFQLine.upsert` |  | 4 | upsert | `sales.service.ts` |
| `getContractLine` | `sales.contractLine.get` | 1 | 2 | read | `sales.service.ts` |
| `getCustomerContact` | `sales.customerContact.get` | 1 | 2 | read | `sales.service.ts` |
| `getCustomerContacts` | `sales.customerContacts.get` | 3 |  | read | `sales.service.ts` |
| `getCustomerLocation` | `sales.customerLocation.get` | 3 |  | read | `sales.service.ts` |
| `getCustomerStatuses` | `sales.customerStatuses.get` | 3 |  | read | `sales.service.ts` |
| `getCustomerTypes` | `sales.customerTypes.get` | 3 |  | read | `sales.service.ts` |
| `getQuoteLinePricesByQuoteId` | `sales.quoteLinePricesByQuoteId.get` | 3 |  | read | `sales.service.ts` |
| `getQuoteLines` | `sales.quoteLines.get` | 3 |  | read | `sales.service.ts` |
| `getQuoteMethodTrees` | `sales.quoteMethodTrees.get` | 3 |  | read | `sales.service.ts` |
| `getQuotePayment` | `sales.quotePayment.get` | 3 |  | read | `sales.service.ts` |
| `getQuoteShipment` | `sales.quoteShipment.get` | 3 |  | read | `sales.service.ts` |
| `getSalesOrderLine` | `sales.salesOrderLine.get` | 2 | 1 | read | `sales.service.ts` |
| `getSalesReturnOrderLines` | `sales.salesReturnOrderLines.get` | 2 | 1 | read | `sales.service.ts` |
| `runContractAction` | `sales.contractAction.run` |  | 3 |  | `sales.server.ts` |
| `upsertContractLine` | `sales.contractLine.upsert` |  | 3 | upsert | `sales.service.ts` |
| `contractCustomerChange` | `sales.contractCustomerChange` |  | 2 |  | `sales.server.ts` |
| `convertQuoteToOrder` | `sales.quoteToOrder.convert` |  | 2 | update | `sales.service.ts` |
| `draftContractSetupPath` | `sales.draftContractSetupPath` | 2 |  |  | `sales.server.ts` |
| `draftRentalAgreementSetupPath` | `sales.draftRentalAgreementSetupPath` | 2 |  |  | `sales.server.ts` |
| `generateRentalInvoicesNow` | `sales.rentalInvoicesNow.generate` |  | 2 |  | `sales.server.ts` |
| `getCustomerContractStatuses` | `sales.customerContractStatuses.get` | 1 | 1 | read | `sales.service.ts` |
| `getCustomerItemPriceOverrideById` | `sales.customerItemPriceOverrideById.get` | 2 |  | read | `sales.service.ts` |
| `getCustomerStatus` | `sales.customerStatus.get` | 2 |  | read | `sales.service.ts` |
| `getCustomerTax` | `sales.customerTax.get` | 2 |  | read | `sales.service.ts` |
| `getCustomerType` | `sales.customerType.get` | 2 |  | read | `sales.service.ts` |
| `getDefaultRentalRates` | `sales.defaultRentalRates.get` | 1 | 1 | read | `sales.service.ts` |
| `getNoQuoteReason` | `sales.noQuoteReason.get` | 2 |  | read | `sales.service.ts` |
| `getOnRentLineForAsset` | `sales.onRentLineForAsset.get` | 1 | 1 | read | `sales.service.ts` |
| `getPricingRule` | `sales.pricingRule.get` | 2 |  | read | `sales.service.ts` |
| `getQuoteByExternalId` | `sales.quoteByExternalId.get` | 1 | 1 | read | `sales.service.ts` |
| `getQuoteCustomerDetails` | `sales.quoteCustomerDetails.get` | 2 |  | read | `sales.service.ts` |
| `getQuoteMaterialsByMethodId` | `sales.quoteMaterialsByMethodId.get` | 2 |  | read | `sales.service.ts` |
| `getQuoteOperationsByMethodId` | `sales.quoteOperationsByMethodId.get` | 2 |  | read | `sales.service.ts` |
| `getReturnReason` | `sales.returnReason.get` | 2 |  | read | `sales.service.ts` |
| `getReturnReasonsList` | `sales.returnReasonsList.get` | 2 |  | read | `sales.service.ts` |
| `getSalesOrderShipment` | `sales.salesOrderShipment.get` | 2 |  | read | `sales.service.ts` |
| `insertSalesOrder` | `sales.salesOrder.insert` |  | 2 | create | `sales.service.ts` |
| `resolvePurchaseToOrderPrices` | `sales.purchaseToOrderPrices.resolve` |  | 2 | action | `sales.service.ts` |
| `resolveQuoteLinePrices` | `sales.quoteLinePrices.resolve` |  | 2 | action | `sales.service.ts` |
| `setSalesReturnOrderLineDisposition` | `sales.salesReturnOrderLineDisposition.set` |  | 2 | update | `sales.service.ts` |
| `updateContract` | `sales.contract.update` |  | 2 | update | `sales.service.ts` |
| `updateRentalAgreement` | `sales.rentalAgreement.update` |  | 2 | update | `sales.service.ts` |
| `upsertCustomer` | `sales.customer.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertCustomerBankAccount` | `sales.customerBankAccount.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertCustomerItemPriceOverride` | `sales.customerItemPriceOverride.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertCustomerItemRentalRate` | `sales.customerItemRentalRate.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertCustomerStatus` | `sales.customerStatus.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertCustomerType` | `sales.customerType.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertNoQuoteReason` | `sales.noQuoteReason.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteLine` | `sales.quoteLine.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteLineAdditionalCharges` | `sales.quoteLineAdditionalCharges.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteMaterial` | `sales.quoteMaterial.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteMaterialMakeMethod` | `sales.quoteMaterialMakeMethod.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteOperation` | `sales.quoteOperation.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteOperationParameter` | `sales.quoteOperationParameter.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteOperationStep` | `sales.quoteOperationStep.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertQuoteOperationTool` | `sales.quoteOperationTool.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertReturnReason` | `sales.returnReason.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertSalesOrderLine` | `sales.salesOrderLine.upsert` |  | 2 | upsert | `sales.service.ts` |
| `upsertSalesReturnOrderLine` | `sales.salesReturnOrderLine.upsert` |  | 2 | upsert | `sales.service.ts` |
| `buildMakeToOrderPriceRows` | `sales.buildMakeToOrderPriceRows` |  | 1 | action | `sales.service.ts` |
| `buildPullFromInventoryPriceRows` | `sales.buildPullFromInventoryPriceRows` |  | 1 | action | `sales.service.ts` |
| `buildPurchaseToOrderPriceRows` | `sales.buildPurchaseToOrderPriceRows` |  | 1 | action | `sales.service.ts` |
| `calculatePricesForQuantities` | `sales.pricesForQuantities.calculate` |  | 1 | action | `sales.service.ts` |
| `cancelSalesOrder` | `sales.salesOrder.cancel` |  | 1 | action | `sales.service.ts` |
| `cancelSalesReturnOrder` | `sales.salesReturnOrder.cancel` |  | 1 | action | `sales.service.ts` |
| `confirmSalesReturnOrder` | `sales.confirmSalesReturnOrder` |  | 1 | action | `sales.service.ts` |
| `contractInvoicingDefaults` | `sales.contractInvoicingDefaults` |  | 1 |  | `sales.server.ts` |
| `convertSalesRfqToQuote` | `sales.salesRfqToQuote.convert` |  | 1 | update | `sales.service.ts` |
| `copyQuote` | `sales.quote.copy` |  | 1 | create | `sales.service.ts` |
| `copyQuoteLine` | `sales.quoteLine.copy` |  | 1 | create | `sales.service.ts` |
| `createContractFromSalesOrder` | `sales.contractFromSalesOrder.create` |  | 1 |  | `sales.server.ts` |
| `createPricingRule` | `sales.pricingRule.create` |  | 1 | create | `sales.service.ts` |
| `createReplacementSalesOrder` | `sales.replacementSalesOrder.create` |  | 1 | create | `sales.service.ts` |
| `createSalesReturnOrderCredit` | `sales.salesReturnOrderCredit.create` |  | 1 | create | `sales.service.ts` |
| `deleteContractLineReleasingSalesOrderLine` | `sales.contractLineReleasingSalesOrderLine.delete` |  | 1 |  | `sales.server.ts` |
| `deleteContractReleasingSalesOrderLines` | `sales.contractReleasingSalesOrderLines.delete` |  | 1 |  | `sales.server.ts` |
| `deleteCustomer` | `sales.customer.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteCustomerBankAccount` | `sales.customerBankAccount.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteCustomerContact` | `sales.customerContact.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteCustomerItemPriceOverride` | `sales.customerItemPriceOverride.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteCustomerItemRentalRate` | `sales.customerItemRentalRate.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteCustomerLocation` | `sales.customerLocation.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteCustomerStatus` | `sales.customerStatus.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteCustomerType` | `sales.customerType.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteNoQuoteReason` | `sales.noQuoteReason.delete` |  | 1 | delete | `sales.service.ts` |
| `deletePricingRule` | `sales.pricingRule.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteQuote` | `sales.quote.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteQuoteLine` | `sales.quoteLine.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteQuoteMaterial` | `sales.quoteMaterial.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteQuoteOperationParameter` | `sales.quoteOperationParameter.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteQuoteOperationStep` | `sales.quoteOperationStep.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteQuoteOperationTool` | `sales.quoteOperationTool.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteRentalAgreement` | `sales.rentalAgreement.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteRentalAgreementCharge` | `sales.rentalAgreementCharge.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteRentalAgreementLine` | `sales.rentalAgreementLine.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteRentalCreditMemoReleasingPeriods` | `sales.rentalCreditMemoReleasingPeriods.delete` |  | 1 |  | `sales.server.ts` |
| `deleteReturnReason` | `sales.returnReason.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteSalesInvoiceLineReleasingRentals` | `sales.salesInvoiceLineReleasingRentals.delete` |  | 1 |  | `sales.server.ts` |
| `deleteSalesInvoiceReleasingRentals` | `sales.salesInvoiceReleasingRentals.delete` |  | 1 |  | `sales.server.ts` |
| `deleteSalesOrder` | `sales.salesOrder.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteSalesOrderLine` | `sales.salesOrderLine.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteSalesRFQ` | `sales.salesRFQ.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteSalesRFQLine` | `sales.salesRFQLine.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteSalesReturnOrder` | `sales.salesReturnOrder.delete` |  | 1 | delete | `sales.service.ts` |
| `deleteSalesReturnOrderLine` | `sales.salesReturnOrderLine.delete` |  | 1 | delete | `sales.service.ts` |
| `duplicatePriceOverrides` | `sales.priceOverrides.duplicate` |  | 1 |  | `sales.server.ts` |
| `duplicatePricingRule` | `sales.pricingRule.duplicate` |  | 1 | create | `sales.service.ts` |
| `finalizeQuote` | `sales.quote.finalize` |  | 1 | update | `sales.service.ts` |
| `generateContractInvoicesNow` | `sales.contractInvoicesNow.generate` |  | 1 |  | `sales.server.ts` |
| `getBaseCatalog` | `sales.baseCatalog.get` | 1 |  | read | `sales.service.ts` |
| `getConfigurationParametersByQuoteLineId` | `sales.configurationParametersByQuoteLineId.get` | 1 |  | read | `sales.service.ts` |
| `getContractAmendments` | `sales.contractAmendments.get` | 1 |  | read | `sales.service.ts` |
| `getContractInvoiceSchedule` | `sales.contractInvoiceSchedule.get` | 1 |  | read | `sales.service.ts` |
| `getContractLines` | `sales.contractLines.get` | 1 |  | read | `sales.service.ts` |
| `getContracts` | `sales.contracts.get` | 1 |  | read | `sales.service.ts` |
| `getCreditableQuantities` | `sales.creditableQuantities.get` | 1 |  | read | `sales.service.ts` |
| `getCustomerBankAccounts` | `sales.customerBankAccounts.get` | 1 |  | read | `sales.service.ts` |
| `getCustomerItemPriceOverride` | `sales.customerItemPriceOverride.get` | 1 |  | read | `sales.service.ts` |
| `getCustomerItemRentalRates` | `sales.customerItemRentalRates.get` | 1 |  | read | `sales.service.ts` |
| `getCustomerPayment` | `sales.customerPayment.get` | 1 |  | read | `sales.service.ts` |
| `getCustomerShipping` | `sales.customerShipping.get` | 1 |  | read | `sales.service.ts` |
| `getCustomerStatusesList` | `sales.customerStatusesList.get` | 1 |  | read | `sales.service.ts` |
| `getCustomerTypesList` | `sales.customerTypesList.get` | 1 |  | read | `sales.service.ts` |
| `getCustomers` | `sales.customers.get` | 1 |  | read | `sales.service.ts` |
| `getCustomersList` | `sales.customersList.get` | 1 |  | read | `sales.service.ts` |
| `getExternalSalesOrderLines` | `sales.externalSalesOrderLines.get` | 1 |  | read | `sales.service.ts` |
| `getItemRentalRate` | `sales.itemRentalRate.get` | 1 |  | read | `sales.service.ts` |
| `getModelByQuoteLineId` | `sales.modelByQuoteLineId.get` | 1 |  | read | `sales.service.ts` |
| `getNoQuoteReasons` | `sales.noQuoteReasons.get` | 1 |  | read | `sales.service.ts` |
| `getOpenSalesOrderLinesForItem` | `sales.openSalesOrderLinesForItem.get` | 1 |  | read | `sales.service.ts` |
| `getPricingRules` | `sales.pricingRules.get` | 1 |  | read | `sales.service.ts` |
| `getQuoteLine` | `sales.quoteLine.get` | 1 |  | read | `sales.service.ts` |
| `getQuoteLinePriceTraces` | `sales.quoteLinePriceTraces.get` | 1 |  | read | `sales.service.ts` |
| `getQuoteLinePrices` | `sales.quoteLinePrices.get` | 1 |  | read | `sales.service.ts` |
| `getQuoteLinesList` | `sales.quoteLinesList.get` | 1 |  | read | `sales.service.ts` |
| `getQuoteMakeMethod` | `sales.quoteMakeMethod.get` | 1 |  | read | `sales.service.ts` |
| `getQuoteOperationsByLine` | `sales.quoteOperationsByLine.get` | 1 |  | read | `sales.service.ts` |
| `getQuotes` | `sales.quotes.get` | 1 |  | read | `sales.service.ts` |
| `getQuotesList` | `sales.quotesList.get` | 1 |  | read | `sales.service.ts` |
| `getRelatedPricesForQuoteLine` | `sales.relatedPricesForQuoteLine.get` | 1 |  | read | `sales.service.ts` |
| `getRentableFleetAssets` | `sales.rentableFleetAssets.get` | 1 |  | read | `sales.service.ts` |
| `getRentalAgreementCharges` | `sales.rentalAgreementCharges.get` | 1 |  | read | `sales.service.ts` |
| `getRentalAgreementDeposits` | `sales.rentalAgreementDeposits.get` | 1 |  | read | `sales.service.ts` |
| `getRentalAgreementLines` | `sales.rentalAgreementLines.get` | 1 |  | read | `sales.service.ts` |
| `getRentalAgreementRelatedDocuments` | `sales.rentalAgreementRelatedDocuments.get` | 1 |  | read | `sales.service.ts` |
| `getRentalAgreements` | `sales.rentalAgreements.get` | 1 |  | read | `sales.service.ts` |
| `getRentalBillingPeriods` | `sales.rentalBillingPeriods.get` | 1 |  | read | `sales.service.ts` |
| `getReturnReasons` | `sales.returnReasons.get` | 1 |  | read | `sales.service.ts` |
| `getReturnableLinesForCustomer` | `sales.returnableLinesForCustomer.get` | 1 |  | read | `sales.service.ts` |
| `getRootQuoteMakeMethod` | `sales.rootQuoteMakeMethod.get` | 1 |  | read | `sales.service.ts` |
| `getSalesDocumentsAssignedToMe` | `sales.salesDocumentsAssignedToMe.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrderCustomerDetails` | `sales.salesOrderCustomerDetails.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrderInvoiceLines` | `sales.salesOrderInvoiceLines.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrderInvoicePaymentsByIds` | `sales.salesOrderInvoicePaymentsByIds.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrderInvoicesByIds` | `sales.salesOrderInvoicesByIds.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrderLineShipments` | `sales.salesOrderLineShipments.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrderPayment` | `sales.salesOrderPayment.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrderRelatedItems` | `sales.salesOrderRelatedItems.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrders` | `sales.salesOrders.get` | 1 |  | read | `sales.service.ts` |
| `getSalesOrdersList` | `sales.salesOrdersList.get` | 1 |  | read | `sales.service.ts` |
| `getSalesRFQLine` | `sales.salesRFQLine.get` | 1 |  | read | `sales.service.ts` |
| `getSalesRFQLines` | `sales.salesRFQLines.get` | 1 |  | read | `sales.service.ts` |
| `getSalesRFQs` | `sales.salesRFQs.get` | 1 |  | read | `sales.service.ts` |
| `getSalesReturnOrderCredits` | `sales.salesReturnOrderCredits.get` | 1 |  | read | `sales.service.ts` |
| `getSalesReturnOrderIssues` | `sales.salesReturnOrderIssues.get` | 1 |  | read | `sales.service.ts` |
| `getSalesReturnOrderLineTrackedEntities` | `sales.salesReturnOrderLineTrackedEntities.get` |  | 1 | read | `sales.service.ts` |
| `getSalesReturnOrderReceipts` | `sales.salesReturnOrderReceipts.get` | 1 |  | read | `sales.service.ts` |
| `getSalesReturnOrders` | `sales.salesReturnOrders.get` | 1 |  | read | `sales.service.ts` |
| `getShippedTrackedEntitiesForCustomer` | `sales.shippedTrackedEntitiesForCustomer.get` | 1 |  | read | `sales.service.ts` |
| `importQuotes` | `sales.importQuotes` |  | 1 |  | `sales.import.server.ts` |
| `insertContract` | `sales.contract.insert` |  | 1 | create | `sales.service.ts` |
| `insertContractLines` | `sales.contractLines.insert` |  | 1 |  | `sales.service.ts` |
| `insertCustomerContact` | `sales.customerContact.insert` |  | 1 | create | `sales.service.ts` |
| `insertCustomerLocation` | `sales.customerLocation.insert` |  | 1 | create | `sales.service.ts` |
| `insertQuote` | `sales.quote.insert` |  | 1 | create | `sales.service.ts` |
| `insertRentalAgreement` | `sales.rentalAgreement.insert` |  | 1 | create | `sales.service.ts` |
| `insertRentalAgreementLines` | `sales.rentalAgreementLines.insert` |  | 1 |  | `sales.service.ts` |
| `insertRentalPurchaseOptionCharge` | `sales.rentalPurchaseOptionCharge.insert` |  | 1 |  | `sales.server.ts` |
| `insertSalesRFQ` | `sales.salesRFQ.insert` |  | 1 | create | `sales.service.ts` |
| `insertSalesReturnOrder` | `sales.salesReturnOrder.insert` |  | 1 | create | `sales.service.ts` |
| `isQuoteImportTable` | `sales.quoteImportTable.is` |  | 1 |  | `sales.import.server.ts` |
| `reopenSalesReturnOrder` | `sales.salesReturnOrder.reopen` |  | 1 | action | `sales.service.ts` |
| `repriceQuoteLineFromRules` | `sales.repriceQuoteLineFromRules` |  | 1 | action | `sales.service.ts` |
| `resolvePrice` | `sales.price.resolve` |  | 1 | action | `sales.service.ts` |
| `resolvePriceList` | `sales.priceList.resolve` | 1 |  | action | `sales.service.ts` |
| `saveQuoteLineWithPrices` | `sales.saveQuoteLineWithPrices` |  | 1 |  | `sales.server.ts` |
| `shortCloseSalesReturnOrderLine` | `sales.shortCloseSalesReturnOrderLine` |  | 1 | action | `sales.service.ts` |
| `updateContractInvoiceAutomation` | `sales.contractInvoiceAutomation.update` |  | 1 |  | `sales.service.ts` |
| `updateContractNotes` | `sales.contractNotes.update` |  | 1 | update | `sales.service.ts` |
| `updateContractType` | `sales.contractType.update` |  | 1 | update | `sales.service.ts` |
| `updateCustomerContact` | `sales.customerContact.update` |  | 1 | update | `sales.service.ts` |
| `updateCustomerLocation` | `sales.customerLocation.update` |  | 1 | update | `sales.service.ts` |
| `updateCustomerPayment` | `sales.customerPayment.update` |  | 1 | update | `sales.service.ts` |
| `updateCustomerShipping` | `sales.customerShipping.update` |  | 1 | update | `sales.service.ts` |
| `updateCustomerTax` | `sales.customerTax.update` |  | 1 | update | `sales.service.ts` |
| `updatePricingRule` | `sales.pricingRule.update` |  | 1 | update | `sales.service.ts` |
| `updateQuote` | `sales.quote.update` |  | 1 | update | `sales.service.ts` |
| `updateQuoteExchangeRate` | `sales.quoteExchangeRate.update` |  | 1 | update | `sales.service.ts` |
| `updateQuoteFavorite` | `sales.quoteFavorite.update` |  | 1 |  | `sales.service.ts` |
| `updateQuoteLineOrder` | `sales.quoteLineOrder.update` |  | 1 | update | `sales.service.ts` |
| `updateQuoteLinePrecision` | `sales.quoteLinePrecision.update` |  | 1 | update | `sales.service.ts` |
| `updateQuoteMaterialOrder` | `sales.quoteMaterialOrder.update` |  | 1 | update | `sales.service.ts` |
| `updateQuoteOperationOrder` | `sales.quoteOperationOrder.update` |  | 1 | update | `sales.service.ts` |
| `updateQuoteStatus` | `sales.quoteStatus.update` |  | 1 | update | `sales.service.ts` |
| `updateRentalAgreementInvoiceAutomation` | `sales.rentalAgreementInvoiceAutomation.update` |  | 1 | update | `sales.service.ts` |
| `updateSalesOrder` | `sales.salesOrder.update` |  | 1 | update | `sales.service.ts` |
| `updateSalesOrderExchangeRate` | `sales.salesOrderExchangeRate.update` |  | 1 | update | `sales.service.ts` |
| `updateSalesOrderFavorite` | `sales.salesOrderFavorite.update` |  | 1 |  | `sales.service.ts` |
| `updateSalesOrderLineOrder` | `sales.salesOrderLineOrder.update` |  | 1 | update | `sales.service.ts` |
| `updateSalesOrderStatus` | `sales.salesOrderStatus.update` |  | 1 | update | `sales.service.ts` |
| `updateSalesRFQFavorite` | `sales.salesRFQFavorite.update` |  | 1 |  | `sales.service.ts` |
| `updateSalesRFQLineOrder` | `sales.salesRFQLineOrder.update` |  | 1 | update | `sales.service.ts` |
| `updateSalesRFQStatus` | `sales.salesRFQStatus.update` |  | 1 | update | `sales.service.ts` |
| `upsertItemRentalRate` | `sales.itemRentalRate.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertMakeMethodFromQuoteLine` | `sales.makeMethodFromQuoteLine.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertMakeMethodFromQuoteMethod` | `sales.makeMethodFromQuoteMethod.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertQuoteLinePrices` | `sales.quoteLinePrices.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertQuotePayment` | `sales.quotePayment.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertQuoteShipment` | `sales.quoteShipment.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertRentalAgreementCharge` | `sales.rentalAgreementCharge.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertSalesOrderPayment` | `sales.salesOrderPayment.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertSalesOrderShipment` | `sales.salesOrderShipment.upsert` |  | 1 | upsert | `sales.service.ts` |
| `upsertSalesRFQ` | `sales.salesRFQ.upsert` |  | 1 | upsert | `sales.service.ts` |

</details>

### settings

124 of 150 functions are called by a route. The other 26 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 124 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getCompanySettings` | `settings.companySettings.get` | 63 | 15 | read | `settings.service.ts` |
| `getCompany` | `settings.company.get` | 30 | 9 | read | `settings.service.ts` |
| `resolveSections` | `settings.sections.resolve` | 9 | 2 | action | `settings.service.ts` |
| `getCompanyLogoForLabel` | `settings.companyLogoForLabel.get` | 10 |  |  | `labelLogo.server.ts` |
| `getDocumentTemplate` | `settings.documentTemplate.get` | 10 |  | read | `settings.service.ts` |
| `getDocumentTemplateConfig` | `settings.documentTemplateConfig.get` | 10 |  | read | `settings.service.ts` |
| `getIntegration` | `settings.integration.get` | 3 | 5 | read | `settings.service.ts` |
| `canManageBackups` | `settings.manageBackups.can` | 5 | 2 |  | `backups.server.ts` |
| `getNextSequence` | `settings.nextSequence.get` | 1 | 6 | action | `settings.service.ts` |
| `upsertCompanyIntegration` | `settings.companyIntegration.upsert` | 5 | 2 |  | `settings.server.ts` |
| `getCompanyIntegrations` | `settings.companyIntegrations.get` |  | 5 | read | `settings.service.ts` |
| `getEmployeeCompanies` | `settings.employeeCompanies.get` | 2 | 3 | read | `settings.service.ts` |
| `getAccountsReceivableBillingAddress` | `settings.accountsReceivableBillingAddress.get` | 3 |  | read | `settings.service.ts` |
| `getCompanies` | `settings.companies.get` | 1 | 2 | read | `settings.service.ts` |
| `getCompanyExportRun` | `settings.companyExportRun.get` | 2 | 1 |  | `backups.service.ts` |
| `getCompanyRestoreRuns` | `settings.companyRestoreRuns.get` | 2 | 1 |  | `backups.service.ts` |
| `completeOnshapeAuthorization` | `settings.onshapeAuthorization.complete` | 2 |  |  | `onshape-oauth.server.ts` |
| `getAccountsPayableBillingAddress` | `settings.accountsPayableBillingAddress.get` | 2 |  | read | `settings.service.ts` |
| `getCompanyTemplateRun` | `settings.companyTemplateRun.get` | 1 | 1 |  | `backups.service.ts` |
| `getDocumentSections` | `settings.documentSections.get` | 2 |  | read | `settings.service.ts` |
| `getItemSerialSequence` | `settings.itemSerialSequence.get` | 2 |  | read | `settings.service.ts` |
| `getItemSerialSequences` | `settings.itemSerialSequences.get` | 2 |  | read | `settings.service.ts` |
| `getSubsidiary` | `settings.subsidiary.get` | 2 |  | read | `settings.service.ts` |
| `getSyncOperationReadableIds` | `settings.syncOperationReadableIds.get` | 2 |  |  | `settings.server.ts` |
| `getWebhook` | `settings.webhook.get` | 2 |  | read | `settings.service.ts` |
| `insertCompany` | `settings.company.insert` |  | 2 |  | `settings.service.ts` |
| `invalidateApiKeyCache` | `settings.invalidateApiKeyCache` |  | 2 |  | `settings.server.ts` |
| `invalidateIntegrationHealthCache` | `settings.invalidateIntegrationHealthCache` |  | 2 |  | `settings.server.ts` |
| `purgeCorruptedRows` | `settings.purgeCorruptedRows` |  | 2 |  | `backups.server.ts` |
| `seedCompany` | `settings.seedCompany` |  | 2 |  | `settings.service.ts` |
| `upsertCustomField` | `settings.customField.upsert` |  | 2 |  | `settings.server.ts` |
| `upsertDocumentSection` | `settings.documentSection.upsert` |  | 2 | upsert | `settings.service.ts` |
| `upsertItemSerialSequence` | `settings.itemSerialSequence.upsert` |  | 2 | upsert | `settings.service.ts` |
| `buildPreviewProps` | `settings.buildPreviewProps` |  | 1 |  | `documentPreview.server.ts` |
| `deactivateIntegration` | `settings.deactivateIntegration` |  | 1 |  | `settings.server.ts` |
| `deleteCompanyBackup` | `settings.companyBackup.delete` |  | 1 |  | `backups.service.ts` |
| `deleteCustomField` | `settings.customField.delete` |  | 1 |  | `settings.server.ts` |
| `deleteDocumentSection` | `settings.documentSection.delete` |  | 1 | delete | `settings.service.ts` |
| `deleteItemSerialSequence` | `settings.itemSerialSequence.delete` |  | 1 | delete | `settings.service.ts` |
| `deleteSubsidiary` | `settings.subsidiary.delete` |  | 1 |  | `settings.service.ts` |
| `dismissCompanyExportFailure` | `settings.dismissCompanyExportFailure` |  | 1 |  | `backups.server.ts` |
| `employeeCompaniesOf` | `settings.employeeCompaniesOf` | 1 |  |  | `settings.service.ts` |
| `exportCompanyBackup` | `settings.exportCompanyBackup` |  | 1 |  | `backups.server.ts` |
| `finalizeCompanyRestore` | `settings.companyRestore.finalize` |  | 1 |  | `backups.server.ts` |
| `finalizeCompanyTemplate` | `settings.companyTemplate.finalize` |  | 1 |  | `demoData.server.ts` |
| `getApiKeys` | `settings.apiKeys.get` | 1 |  | read | `settings.service.ts` |
| `getCompanyBackups` | `settings.companyBackups.get` | 1 |  |  | `backups.server.ts` |
| `getCompanyIntegration` | `settings.companyIntegration.get` | 1 |  |  | `settings.server.ts` |
| `getConfig` | `settings.config.get` | 1 |  | read | `settings.service.ts` |
| `getCurrentSequence` | `settings.currentSequence.get` |  | 1 | read | `settings.service.ts` |
| `getCustomField` | `settings.customField.get` | 1 |  | read | `settings.service.ts` |
| `getCustomFields` | `settings.customFields.get` | 1 |  | read | `settings.service.ts` |
| `getCustomFieldsTables` | `settings.customFieldsTables.get` | 1 |  | read | `settings.service.ts` |
| `getIndustries` | `settings.industries.get` | 1 |  | read | `settings.service.ts` |
| `getIntegrationsWithHealth` | `settings.integrationsWithHealth.get` | 1 |  |  | `settings.server.ts` |
| `getItemPostingGroupResponsibilities` | `settings.itemPostingGroupResponsibilities.get` | 1 |  |  | `settings.service.ts` |
| `getKanbanOutputSetting` | `settings.kanbanOutputSetting.get` | 1 |  | read | `settings.service.ts` |
| `getPlans` | `settings.plans.get` | 1 |  | read | `settings.service.ts` |
| `getSequence` | `settings.sequence.get` | 1 |  | read | `settings.service.ts` |
| `getSequences` | `settings.sequences.get` | 1 |  | read | `settings.service.ts` |
| `getSequencesList` | `settings.sequencesList.get` | 1 |  | read | `settings.service.ts` |
| `getSubsidiaries` | `settings.subsidiaries.get` | 1 |  | read | `settings.service.ts` |
| `getTerms` | `settings.terms.get` | 1 |  | read | `settings.service.ts` |
| `getWebhookTables` | `settings.webhookTables.get` | 1 |  | read | `settings.service.ts` |
| `getWebhooks` | `settings.webhooks.get` | 1 |  | read | `settings.service.ts` |
| `listPreviewEntities` | `settings.previewEntities.list` | 1 |  |  | `documentPreview.server.ts` |
| `revertCompanyRestore` | `settings.revertCompanyRestore` |  | 1 |  | `backups.server.ts` |
| `revertCompanyTemplate` | `settings.revertCompanyTemplate` |  | 1 |  | `demoData.server.ts` |
| `setDefaultPlanningHorizonDays` | `settings.defaultPlanningHorizonDays.set` |  | 1 |  | `settings.service.ts` |
| `setDefaultResponsibleEmployee` | `settings.defaultResponsibleEmployee.set` |  | 1 |  | `settings.service.ts` |
| `setForecastConsumptionWindow` | `settings.forecastConsumptionWindow.set` |  | 1 |  | `settings.service.ts` |
| `setLocationResponsibleEmployee` | `settings.locationResponsibleEmployee.set` |  | 1 |  | `settings.service.ts` |
| `setRescheduleToleranceDays` | `settings.rescheduleToleranceDays.set` |  | 1 |  | `settings.service.ts` |
| `setSkipApprovalForPlanningPurchaseOrders` | `settings.skipApprovalForPlanningPurchaseOrders.set` |  | 1 |  | `settings.service.ts` |
| `startCompanyRestore` | `settings.startCompanyRestore` |  | 1 |  | `backups.server.ts` |
| `startCompanyTemplate` | `settings.startCompanyTemplate` |  | 1 |  | `demoData.server.ts` |
| `unpackBackupArchive` | `settings.unpackBackupArchive` |  | 1 |  | `backups-archive.server.ts` |
| `updateAccountingEnabledSetting` | `settings.accountingEnabledSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateAccountsPayableAddressSetting` | `settings.accountsPayableAddressSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateAccountsPayableBillingAddress` | `settings.accountsPayableBillingAddress.update` |  | 1 | update | `settings.service.ts` |
| `updateAccountsReceivableAddressSetting` | `settings.accountsReceivableAddressSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateAccountsReceivableBillingAddress` | `settings.accountsReceivableBillingAddress.update` |  | 1 | update | `settings.service.ts` |
| `updateAccountsReceivableEmail` | `settings.accountsReceivableEmail.update` |  | 1 |  | `settings.service.ts` |
| `updateAllowLowercaseItemIdsSetting` | `settings.allowLowercaseItemIdsSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateAssetTaxDepreciationSettings` | `settings.assetTaxDepreciationSettings.update` |  | 1 | update | `settings.service.ts` |
| `updateAutoSelectMaterialWithoutPickingListSetting` | `settings.autoSelectMaterialWithoutPickingListSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateBomExplorerReadableIdSetting` | `settings.bomExplorerReadableIdSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateCompany` | `settings.company.update` |  | 1 | update | `settings.service.ts` |
| `updateCompanyWithBaseCurrencyChange` | `settings.companyWithBaseCurrencyChange.update` |  | 1 | update | `settings.service.ts` |
| `updateCustomFieldsSortOrder` | `settings.customFieldsSortOrder.update` |  | 1 |  | `settings.server.ts` |
| `updateDefaultCustomerCc` | `settings.defaultCustomerCc.update` |  | 1 | update | `settings.service.ts` |
| `updateDefaultSupplierCc` | `settings.defaultSupplierCc.update` |  | 1 | update | `settings.service.ts` |
| `updateDigitalQuoteSetting` | `settings.digitalQuoteSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateIncludeMaterialsOnTravelerSetting` | `settings.includeMaterialsOnTravelerSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateIncludeOperationsOnTravelerSetting` | `settings.includeOperationsOnTravelerSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateIncompletePickingListPolicySetting` | `settings.incompletePickingListPolicySetting.update` |  | 1 | update | `settings.service.ts` |
| `updateInvoiceAutomationSetting` | `settings.invoiceAutomationSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateInvoiceNotificationSetting` | `settings.invoiceNotificationSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateKanbanOutputSetting` | `settings.kanbanOutputSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateLeadTimesOnReceiptSetting` | `settings.leadTimesOnReceiptSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateLeasePolicySettings` | `settings.leasePolicySettings.update` |  | 1 | update | `settings.service.ts` |
| `updateMaintenanceDispatchNotificationSettings` | `settings.maintenanceDispatchNotificationSettings.update` |  | 1 | update | `settings.service.ts` |
| `updateMaterialGeneratedIdsSetting` | `settings.materialGeneratedIdsSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateMetricSettings` | `settings.metricSettings.update` |  | 1 | update | `settings.service.ts` |
| `updateMrpRunTimeSetting` | `settings.mrpRunTimeSetting.update` |  | 1 | update | `settings.service.ts` |
| `updatePlmReleaseControlSetting` | `settings.plmReleaseControlSetting.update` |  | 1 | update | `settings.service.ts` |
| `updatePurchasePriceUpdateTimingSetting` | `settings.purchasePriceUpdateTimingSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateQuoteLineCategoryMarkups` | `settings.quoteLineCategoryMarkups.update` |  | 1 | update | `settings.service.ts` |
| `updateRequireCustomerContactSetting` | `settings.requireCustomerContactSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateRequireSupplierContactSetting` | `settings.requireSupplierContactSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateReturnPickedMaterialTimingSetting` | `settings.returnPickedMaterialTimingSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateRfqReadySetting` | `settings.rfqReadySetting.update` |  | 1 | update | `settings.service.ts` |
| `updateSalesRuleNotificationSetting` | `settings.salesRuleNotificationSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateSequence` | `settings.sequence.update` |  | 1 | update | `settings.service.ts` |
| `updateShelfLifeSettings` | `settings.shelfLifeSettings.update` |  | 1 | update | `settings.service.ts` |
| `updateShowCurrencyTrailingZerosSetting` | `settings.showCurrencyTrailingZerosSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateShowCustomerReadableIdSetting` | `settings.showCustomerReadableIdSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateShowSupplierReadableIdSetting` | `settings.showSupplierReadableIdSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateSubsidiary` | `settings.subsidiary.update` |  | 1 | update | `settings.service.ts` |
| `updateSuggestionNotificationSetting` | `settings.suggestionNotificationSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateSupplierQuoteNotificationSetting` | `settings.supplierQuoteNotificationSetting.update` |  | 1 | update | `settings.service.ts` |
| `updateTimeCardSetting` | `settings.timeCardSetting.update` |  | 1 | update | `settings.service.ts` |
| `upsertDocumentTemplate` | `settings.documentTemplate.upsert` |  | 1 | upsert | `settings.service.ts` |
| `upsertItemPostingGroupResponsibility` | `settings.itemPostingGroupResponsibility.upsert` |  | 1 |  | `settings.service.ts` |

</details>

### shared

42 of 53 functions are called by a route. The other 11 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 42 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getCompanyTimeZone` | `shared.companyTimeZone.get` | 27 | 29 |  | `timezone.server.ts` |
| `requireCompanyRecord` | `shared.requireCompanyRecord` | 6 | 44 |  | `shared.server.ts` |
| `getTagsList` | `shared.tagsList.get` | 43 |  | read | `shared.service.ts` |
| `getLocationTimeZone` | `shared.locationTimeZone.get` | 11 | 5 |  | `timezone.server.ts` |
| `getBase64ImageFromSupabase` | `shared.base64ImageFromSupabase.get` | 13 |  | read | `shared.service.ts` |
| `resolveLocationId` | `shared.locationId.resolve` | 9 |  |  | `location.server.ts` |
| `getOrCreatePeriods` | `shared.orCreatePeriods.get` | 6 | 1 |  | `shared.server.ts` |
| `isActiveCompanyEmployee` | `shared.activeCompanyEmployee.is` |  | 7 |  | `shared.server.ts` |
| `getActionTaskWithParent` | `shared.actionTaskWithParent.get` |  | 6 |  | `shared.server.ts` |
| `getModelByItemId` | `shared.modelByItemId.get` | 5 |  | read | `shared.service.ts` |
| `getEnforcementRule` | `shared.enforcementRule.get` | 4 |  | read | `shared.service.ts` |
| `generateAndAttachSalesOrderPdf` | `shared.andAttachSalesOrderPdf.generate` |  | 3 |  | `shared.server.ts` |
| `getCustomerPortal` | `shared.customerPortal.get` | 3 |  | read | `shared.service.ts` |
| `getOnboardingDraft` | `shared.onboardingDraft.get` | 2 | 1 |  | `shared.server.ts` |
| `keptForADay` | `shared.keptForADay` | 3 |  |  | `shared.server.ts` |
| `upsertExternalLink` | `shared.externalLink.upsert` |  | 3 | upsert | `shared.service.ts` |
| `getCustomFieldsSchemas` | `shared.customFieldsSchemas.get` | 2 |  |  | `shared.server.ts` |
| `getEnforcementRuleAssignmentCounts` | `shared.enforcementRuleAssignmentCounts.get` | 2 |  | read | `shared.service.ts` |
| `getEnforcementRules` | `shared.enforcementRules.get` | 2 |  | read | `shared.service.ts` |
| `getExternalLink` | `shared.externalLink.get` | 1 | 1 | read | `shared.service.ts` |
| `getImplementationSignals` | `shared.implementationSignals.get` | 2 |  |  | `shared.server.ts` |
| `invalidateCompanyTimeZone` | `shared.invalidateCompanyTimeZone` |  | 2 |  | `timezone.server.ts` |
| `sendSalesOrderEmail` | `shared.salesOrderEmail.send` |  | 2 |  | `shared.server.ts` |
| `assign` | `shared.assign` |  | 1 |  | `shared.server.ts` |
| `clearOnboardingDraft` | `shared.clearOnboardingDraft` |  | 1 |  | `shared.server.ts` |
| `deleteNote` | `shared.note.delete` |  | 1 |  | `shared.service.ts` |
| `deleteSavedView` | `shared.savedView.delete` |  | 1 | delete | `shared.service.ts` |
| `generateAndAttachPurchaseReturnOrderPdf` | `shared.andAttachPurchaseReturnOrderPdf.generate` |  | 1 |  | `shared.server.ts` |
| `generateAndAttachSalesReturnOrderPdf` | `shared.andAttachSalesReturnOrderPdf.generate` |  | 1 |  | `shared.server.ts` |
| `getAppShell` | `shared.appShell.get` | 1 |  |  | `shared.server.ts` |
| `getCachedTimezoneNames` | `shared.cachedTimezoneNames.get` | 1 |  |  | `shared.server.ts` |
| `getCountries` | `shared.countries.get` | 1 |  | read | `shared.service.ts` |
| `getCustomerPortals` | `shared.customerPortals.get` | 1 |  | read | `shared.service.ts` |
| `getNotes` | `shared.notes.get` | 1 |  | read | `shared.service.ts` |
| `importCsv` | `shared.importCsv` |  | 1 | action | `shared.service.ts` |
| `insertNote` | `shared.note.insert` |  | 1 | create | `shared.service.ts` |
| `insertTag` | `shared.tag.insert` |  | 1 | create | `shared.service.ts` |
| `invalidateLocationTimeZone` | `shared.invalidateLocationTimeZone` |  | 1 |  | `timezone.server.ts` |
| `resolveBuyUnitCost` | `shared.buyUnitCost.resolve` |  | 1 | action | `shared.service.ts` |
| `setOnboardingDraft` | `shared.onboardingDraft.set` |  | 1 |  | `shared.server.ts` |
| `updateSavedViewOrder` | `shared.savedViewOrder.update` |  | 1 | update | `shared.service.ts` |
| `upsertSavedView` | `shared.savedView.upsert` |  | 1 | upsert | `shared.service.ts` |

</details>

### users

40 of 52 functions are called by a route. The other 12 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 40 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getUserDefaults` | `users.userDefaults.get` | 19 | 7 |  | `users.server.ts` |
| `getUser` | `users.user.get` | 1 | 6 |  | `users.server.ts` |
| `getEmployeeTypes` | `users.employeeTypes.get` | 6 |  | read | `users.service.ts` |
| `getUnrevokedInviteEmails` | `users.unrevokedInviteEmails.get` | 3 |  | read | `users.service.ts` |
| `deleteGroup` | `users.group.delete` |  | 2 | delete | `users.service.ts` |
| `getEmployeeType` | `users.employeeType.get` | 2 |  | read | `users.service.ts` |
| `getModules` | `users.modules.get` | 2 |  | read | `users.service.ts` |
| `getPermissionsByEmployeeType` | `users.permissionsByEmployeeType.get` | 2 |  | read | `users.service.ts` |
| `getUserSelectGroups` | `users.userSelectGroups.get` | 2 |  | read | `users.service.ts` |
| `upsertGroupMembers` | `users.groupMembers.upsert` |  | 2 | upsert | `users.service.ts` |
| `acceptInvite` | `users.acceptInvite` |  | 1 |  | `users.server.ts` |
| `convertConsoleOperatorToUser` | `users.consoleOperatorToUser.convert` |  | 1 |  | `users.server.ts` |
| `createConsoleOperator` | `users.consoleOperator.create` |  | 1 |  | `users.server.ts` |
| `createCustomerAccount` | `users.customerAccount.create` |  | 1 |  | `users.server.ts` |
| `createEmployeeAccount` | `users.employeeAccount.create` |  | 1 |  | `users.server.ts` |
| `createSupplierAccount` | `users.supplierAccount.create` |  | 1 |  | `users.server.ts` |
| `getClaims` | `users.claims.get` | 1 |  |  | `users.server.ts` |
| `getConsoleOperators` | `users.consoleOperators.get` | 1 |  | read | `users.service.ts` |
| `getCustomers` | `users.customers.get` | 1 |  | read | `users.service.ts` |
| `getEmployee` | `users.employee.get` | 1 |  | read | `users.service.ts` |
| `getEmployees` | `users.employees.get` | 1 |  | read | `users.service.ts` |
| `getGroup` | `users.group.get` | 1 |  | read | `users.service.ts` |
| `getGroupEmails` | `users.groupEmails.get` | 1 |  | read | `users.service.ts` |
| `getGroupMembers` | `users.groupMembers.get` | 1 |  | read | `users.service.ts` |
| `getGroups` | `users.groups.get` | 1 |  | read | `users.service.ts` |
| `getInvitable` | `users.invitable.get` | 1 |  | read | `users.service.ts` |
| `getItarCertificationReport` | `users.itarCertificationReport.get` | 1 |  | read | `users.service.ts` |
| `getItarCertificationStatus` | `users.itarCertificationStatus.get` | 1 |  | read | `users.service.ts` |
| `getItarEntityCertification` | `users.itarEntityCertification.get` | 1 |  | read | `users.service.ts` |
| `getPermissionCacheKey` | `users.permissionCacheKey.get` |  | 1 |  | `users.server.ts` |
| `getSsoInviteDomainError` | `users.ssoInviteDomainError.get` |  | 1 |  | `users.server.ts` |
| `getSuppliers` | `users.suppliers.get` | 1 |  | read | `users.service.ts` |
| `getUserSelectGroupMembers` | `users.userSelectGroupMembers.get` | 1 |  | read | `users.service.ts` |
| `getUsersWithVerifiedMfa` | `users.usersWithVerifiedMfa.get` | 1 |  | read | `users.service.ts` |
| `insertGroup` | `users.group.insert` |  | 1 | create | `users.service.ts` |
| `isControlledInviteExpired` | `users.controlledInviteExpired.is` | 1 |  |  | `users.server.ts` |
| `resolveUserSelectIds` | `users.userSelectIds.resolve` | 1 |  | action | `users.service.ts` |
| `searchUsersForSelect` | `users.searchUsersForSelect` | 1 |  | read | `users.service.ts` |
| `upsertGroup` | `users.group.upsert` |  | 1 | upsert | `users.service.ts` |
| `upsertModulePreferences` | `users.modulePreferences.upsert` |  | 1 |  | `users.server.ts` |

</details>

### workflows

23 of 23 functions are called by a route. The other 0 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 23 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getWorkflow` | `workflows.workflow.get` | 2 | 1 |  | `workflows.service.ts` |
| `getWorkflowRunRecordNames` | `workflows.workflowRunRecordNames.get` | 2 |  |  | `workflows.service.ts` |
| `getWorkflowRunSteps` | `workflows.workflowRunSteps.get` | 1 | 1 |  | `workflows.service.ts` |
| `getWorkflowVersion` | `workflows.workflowVersion.get` | 1 | 1 |  | `workflows.service.ts` |
| `getWorkflowVersions` | `workflows.workflowVersions.get` | 1 | 1 |  | `workflows.service.ts` |
| `insertWorkflowVersion` | `workflows.workflowVersion.insert` |  | 2 |  | `workflows.service.ts` |
| `checkWorkflowVersionLock` | `workflows.workflowVersionLock.check` |  | 1 |  | `workflows.server.ts` |
| `deleteWorkflow` | `workflows.workflow.delete` |  | 1 |  | `workflows.service.ts` |
| `getWorkflowLastRuns` | `workflows.workflowLastRuns.get` | 1 |  |  | `workflows.service.ts` |
| `getWorkflowRun` | `workflows.workflowRun.get` | 1 |  |  | `workflows.service.ts` |
| `getWorkflowRunChain` | `workflows.workflowRunChain.get` | 1 |  |  | `workflows.service.ts` |
| `getWorkflowRuns` | `workflows.workflowRuns.get` | 1 |  |  | `workflows.service.ts` |
| `getWorkflowVersionNumbers` | `workflows.workflowVersionNumbers.get` | 1 |  |  | `workflows.service.ts` |
| `getWorkflowVersionOwnership` | `workflows.workflowVersionOwnership.get` |  | 1 |  | `workflows.service.ts` |
| `getWorkflows` | `workflows.workflows.get` | 1 |  |  | `workflows.service.ts` |
| `insertWorkflow` | `workflows.workflow.insert` |  | 1 |  | `workflows.service.ts` |
| `publishWorkflowVersion` | `workflows.publishWorkflowVersion` |  | 1 |  | `workflows.server.ts` |
| `syncAfterWorkflowDelete` | `workflows.afterWorkflowDelete.sync` |  | 1 |  | `workflows.server.ts` |
| `unpublishWorkflow` | `workflows.unpublishWorkflow` |  | 1 |  | `workflows.server.ts` |
| `updateWorkflow` | `workflows.workflow.update` |  | 1 |  | `workflows.service.ts` |
| `updateWorkflowCanvasState` | `workflows.workflowCanvasState.update` |  | 1 |  | `workflows.service.ts` |
| `updateWorkflowDefinition` | `workflows.workflowDefinition.update` |  | 1 |  | `workflows.service.ts` |
| `updateWorkflowNodePositions` | `workflows.workflowNodePositions.update` |  | 1 |  | `workflows.service.ts` |

</details>

### mes

126 of 144 functions are called by a route. The other 18 are called only by other functions, components or jobs, or by nothing.

<details>
<summary>The 126 functions</summary>

| Function | Namespaced | Loaders | Actions | Tag | File |
|---|---|---|---|---|---|
| `getDatabaseClient` | `mes.databaseClient.get` | 2 | 26 |  | `database.server.ts` |
| `getCompanySettings` | `mes.companySettings.get` | 7 | 1 |  | `location.server.ts` |
| `getTrackedEntitiesByMakeMethodId` | `mes.trackedEntitiesByMakeMethodId.get` | 5 |  |  | `operations.service.ts` |
| `finishJobOperation` | `mes.finishJobOperation` | 1 | 3 |  | `operations.service.ts` |
| `getCompanyLogoForLabel` | `mes.companyLogoForLabel.get` | 4 |  |  | `labelLogo.server.ts` |
| `getDocumentTemplateConfig` | `mes.documentTemplateConfig.get` | 4 |  |  | `inventory.service.ts` |
| `getJobByOperationId` | `mes.jobByOperationId.get` | 3 |  |  | `operations.service.ts` |
| `getJobMakeMethod` | `mes.jobMakeMethod.get` | 3 |  |  | `operations.service.ts` |
| `getJobOperationBatch` | `mes.jobOperationBatch.get` | 2 | 1 |  | `operations.service.ts` |
| `getJobOperationById` | `mes.jobOperationById.get` | 3 |  |  | `operations.service.ts` |
| `getNextIncompleteSerialEntity` | `mes.nextIncompleteSerialEntity.get` | 3 |  |  | `operations.service.ts` |
| `getProductionEventsForJobOperation` | `mes.productionEventsForJobOperation.get` | 3 |  |  | `operations.service.ts` |
| `getProductionQuantitiesForJobOperation` | `mes.productionQuantitiesForJobOperation.get` | 3 |  |  | `operations.service.ts` |
| `getTrackedEntity` | `mes.trackedEntity.get` | 2 | 1 |  | `operations.service.ts` |
| `backflushUntrackedMaterialsOnStepRecord` | `mes.backflushUntrackedMaterialsOnStepRecord` |  | 2 |  | `operations.service.ts` |
| `clockIn` | `mes.clockIn` |  | 2 |  | `people.service.ts` |
| `clockOut` | `mes.clockOut` |  | 2 |  | `people.service.ts` |
| `getActiveMaintenanceEventByEmployee` | `mes.activeMaintenanceEventByEmployee.get` | 1 | 1 |  | `maintenance.service.ts` |
| `getCompany` | `mes.company.get` | 2 |  |  | `inventory.service.ts` |
| `getDisplayWorkCenter` | `mes.displayWorkCenter.get` | 2 |  |  | `display.service.ts` |
| `getInspectionOutcomeState` | `mes.inspectionOutcomeState.get` |  | 2 |  | `quality.server.ts` |
| `getJobMaterialsByOperationId` | `mes.jobMaterialsByOperationId.get` | 2 |  |  | `operations.service.ts` |
| `getJobOperationForCompany` | `mes.jobOperationForCompany.get` | 2 |  |  | `operations.service.ts` |
| `getJobOperationProcedure` | `mes.jobOperationProcedure.get` | 2 |  |  | `operations.service.ts` |
| `getKanbanByJobId` | `mes.kanbanByJobId.get` | 2 |  |  | `operations.service.ts` |
| `getLocationsByCompany` | `mes.locationsByCompany.get` | 2 |  |  | `operations.service.ts` |
| `getNonConformanceActions` | `mes.nonConformanceActions.get` | 2 |  |  | `operations.service.ts` |
| `getOpenClockEntry` | `mes.openClockEntry.get` | 2 |  |  | `people.service.ts` |
| `getOperationEligibility` | `mes.operationEligibility.get` | 1 | 1 |  | `operations.service.ts` |
| `getSerialCompletionCandidates` | `mes.serialCompletionCandidates.get` |  | 2 |  | `quality.server.ts` |
| `getThumbnailPathByItemId` | `mes.thumbnailPathByItemId.get` | 2 |  |  | `operations.service.ts` |
| `getTrackedEntitiesByOperationId` | `mes.trackedEntitiesByOperationId.get` | 2 |  |  | `operations.service.ts` |
| `getWorkCenter` | `mes.workCenter.get` | 2 |  |  | `operations.service.ts` |
| `getWorkCentersByLocation` | `mes.workCentersByLocation.get` | 2 |  |  | `operations.service.ts` |
| `insertProductionQuantity` | `mes.productionQuantity.insert` | 1 | 1 |  | `operations.service.ts` |
| `isSerialEntityIncompleteForOperation` | `mes.serialEntityIncompleteForOperation.is` | 2 |  |  | `operations.service.ts` |
| `postBulkCompletion` | `mes.bulkCompletion.post` |  | 2 |  | `quality.server.ts` |
| `postSerialCompletions` | `mes.serialCompletions.post` |  | 2 |  | `quality.server.ts` |
| `setLocation` | `mes.location.set` |  | 2 |  | `location.server.ts` |
| `startProductionEvent` | `mes.startProductionEvent` | 1 | 1 |  | `operations.service.ts` |
| `addMaintenanceDispatchItem` | `mes.maintenanceDispatchItem.add` |  | 1 |  | `maintenance.service.ts` |
| `completeAllStepsForUnit` | `mes.allStepsForUnit.complete` |  | 1 |  | `operations.service.ts` |
| `createInspectionRejectionIssue` | `mes.inspectionRejectionIssue.create` |  | 1 |  | `quality.server.ts` |
| `createQualityIssue` | `mes.qualityIssue.create` |  | 1 |  | `quality.server.ts` |
| `deleteAttributeRecord` | `mes.attributeRecord.delete` |  | 1 |  | `operations.service.ts` |
| `endMaintenanceEvent` | `mes.endMaintenanceEvent` |  | 1 |  | `maintenance.service.ts` |
| `endProductionEvent` | `mes.endProductionEvent` |  | 1 |  | `operations.service.ts` |
| `endProductionEvents` | `mes.endProductionEvents` |  | 1 |  | `operations.service.ts` |
| `endProductionEventsByWorkCenter` | `mes.endProductionEventsByWorkCenter` |  | 1 |  | `operations.service.ts` |
| `getActiveJobCount` | `mes.activeJobCount.get` | 1 |  |  | `operations.service.ts` |
| `getActiveJobOperationsByEmployee` | `mes.activeJobOperationsByEmployee.get` | 1 |  |  | `operations.service.ts` |
| `getActiveJobOperationsByLocation` | `mes.activeJobOperationsByLocation.get` | 1 |  |  | `operations.service.ts` |
| `getActiveMaintenanceDispatchesByLocation` | `mes.activeMaintenanceDispatchesByLocation.get` | 1 |  |  | `maintenance.service.ts` |
| `getActiveMaintenanceEventsCount` | `mes.activeMaintenanceEventsCount.get` | 1 |  |  | `maintenance.service.ts` |
| `getAssemblyPlaybackByOperationId` | `mes.assemblyPlaybackByOperationId.get` | 1 |  |  | `operations.service.ts` |
| `getAssignedPickingLists` | `mes.assignedPickingLists.get` | 1 |  |  | `picking.service.ts` |
| `getAvailableTrackedEntities` | `mes.availableTrackedEntities.get` | 1 |  |  | `inventory.service.ts` |
| `getBatchMaterialTotals` | `mes.batchMaterialTotals.get` | 1 |  |  | `operations.service.ts` |
| `getBatchNumbersForItem` | `mes.batchNumbersForItem.get` | 1 |  |  | `inventory.service.ts` |
| `getBatchWorkInstructions` | `mes.batchWorkInstructions.get` | 1 |  |  | `operations.service.ts` |
| `getCustomers` | `mes.customers.get` | 1 |  |  | `operations.service.ts` |
| `getFailureModesList` | `mes.failureModesList.get` | 1 |  |  | `operations.service.ts` |
| `getFilters` | `mes.filters.get` | 1 |  |  | `operation.server.ts` |
| `getInspection` | `mes.inspection.get` | 1 |  |  | `quality.service.ts` |
| `getInspectionDocumentWithBalloons` | `mes.inspectionDocumentWithBalloons.get` | 1 |  |  | `quality.service.ts` |
| `getInspectionGauges` | `mes.inspectionGauges.get` | 1 |  |  | `quality.service.ts` |
| `getInspectionMeasurements` | `mes.inspectionMeasurements.get` | 1 |  |  | `quality.service.ts` |
| `getInspectionSamplingPlans` | `mes.inspectionSamplingPlans.get` | 1 |  |  | `quality.service.ts` |
| `getIssueTypesList` | `mes.issueTypesList.get` | 1 |  |  | `quality.service.ts` |
| `getItarCertificationStatus` | `mes.itarCertificationStatus.get` | 1 |  |  | `itar.service.ts` |
| `getJobFiles` | `mes.jobFiles.get` | 1 |  |  | `operations.service.ts` |
| `getJobMethodBomIdMap` | `mes.jobMethodBomIdMap.get` | 1 |  |  | `operations.service.ts` |
| `getJobOperationBatchMembers` | `mes.jobOperationBatchMembers.get` | 1 |  |  | `operations.service.ts` |
| `getJobOperationDependencies` | `mes.jobOperationDependencies.get` | 1 |  |  | `operations.service.ts` |
| `getJobOperations` | `mes.jobOperations.get` | 1 |  |  | `operations.service.ts` |
| `getJobOperationsAssignedToEmployee` | `mes.jobOperationsAssignedToEmployee.get` | 1 |  |  | `operations.service.ts` |
| `getLocation` | `mes.location.get` |  | 1 |  | `location.server.ts` |
| `getMaintenanceDispatch` | `mes.maintenanceDispatch.get` | 1 |  |  | `maintenance.service.ts` |
| `getMaintenanceDispatchEvents` | `mes.maintenanceDispatchEvents.get` | 1 |  |  | `maintenance.service.ts` |
| `getMaintenanceDispatchItemTrackedEntities` | `mes.maintenanceDispatchItemTrackedEntities.get` | 1 |  |  | `maintenance.service.ts` |
| `getMaintenanceDispatchItems` | `mes.maintenanceDispatchItems.get` | 1 |  |  | `maintenance.service.ts` |
| `getMaintenanceDispatchesAssignedTo` | `mes.maintenanceDispatchesAssignedTo.get` | 1 |  |  | `maintenance.service.ts` |
| `getMaintenanceDisplayData` | `mes.maintenanceDisplayData.get` | 1 |  |  | `display.service.ts` |
| `getModelUploadsByIds` | `mes.modelUploadsByIds.get` | 1 |  |  | `operations.service.ts` |
| `getMyPeopleAssignment` | `mes.myPeopleAssignment.get` | 1 |  |  | `operations.service.ts` |
| `getNcrsByJobOperationId` | `mes.ncrsByJobOperationId.get` | 1 |  |  | `operations.service.ts` |
| `getOpenJobs` | `mes.openJobs.get` | 1 |  |  | `operations.service.ts` |
| `getPeopleOverride` | `mes.peopleOverride.get` | 1 |  |  | `people.server.ts` |
| `getPickOrder` | `mes.pickOrder.get` | 1 |  |  | `inventory.service.ts` |
| `getPickedTrackedEntitiesForMaterial` | `mes.pickedTrackedEntitiesForMaterial.get` | 1 |  |  | `inventory.service.ts` |
| `getPickingListForExecution` | `mes.pickingListForExecution.get` | 1 |  |  | `picking.service.ts` |
| `getPickingListRecommendations` | `mes.pickingListRecommendations.get` | 1 |  |  | `inventory.service.ts` |
| `getProcessesList` | `mes.processesList.get` | 1 |  |  | `operations.service.ts` |
| `getProductionEventsForBatch` | `mes.productionEventsForBatch.get` | 1 |  |  | `operations.service.ts` |
| `getQualityIssueTypesList` | `mes.qualityIssueTypesList.get` | 1 |  |  | `operations.service.ts` |
| `getRecentJobOperationsByEmployee` | `mes.recentJobOperationsByEmployee.get` | 1 |  |  | `operations.service.ts` |
| `getRequestMeta` | `mes.requestMeta.get` |  | 1 |  | `itar.service.ts` |
| `getScrapReasonsList` | `mes.scrapReasonsList.get` | 1 |  |  | `operations.service.ts` |
| `getSerialNumbersForItem` | `mes.serialNumbersForItem.get` | 1 |  |  | `inventory.service.ts` |
| `getSuggestedAllocationForMaterial` | `mes.suggestedAllocationForMaterial.get` | 1 |  |  | `inventory.service.ts` |
| `getToolsByOperationId` | `mes.toolsByOperationId.get` | 1 |  |  | `operations.service.ts` |
| `getTrackedEntitiesByJobMakeMethodIds` | `mes.trackedEntitiesByJobMakeMethodIds.get` | 1 |  |  | `operations.service.ts` |
| `getUnresolvedPickingListLines` | `mes.unresolvedPickingListLines.get` |  | 1 |  | `picking.service.ts` |
| `getUpstreamOperations` | `mes.upstreamOperations.get` | 1 |  |  | `operations.service.ts` |
| `getWorkCenterReplacementParts` | `mes.workCenterReplacementParts.get` | 1 |  |  | `maintenance.service.ts` |
| `getWorkCenterWithBlockingStatus` | `mes.workCenterWithBlockingStatus.get` | 1 |  |  | `maintenance.service.ts` |
| `getWorkCentersByCompany` | `mes.workCentersByCompany.get` | 1 |  |  | `operations.service.ts` |
| `getWorkCentersForDisplayPicker` | `mes.workCentersForDisplayPicker.get` | 1 |  |  | `display.service.ts` |
| `getWorkDisplayData` | `mes.workDisplayData.get` | 1 |  |  | `display.service.ts` |
| `insertAttributeRecord` | `mes.attributeRecord.insert` |  | 1 |  | `operations.service.ts` |
| `insertBatchStepRecords` | `mes.batchStepRecords.insert` |  | 1 |  | `operations.service.ts` |
| `insertManualInventoryAdjustment` | `mes.manualInventoryAdjustment.insert` |  | 1 |  | `inventory.service.ts` |
| `insertReworkQuantity` | `mes.reworkQuantity.insert` |  | 1 |  | `operations.service.ts` |
| `insertScrapQuantity` | `mes.scrapQuantity.insert` |  | 1 |  | `operations.service.ts` |
| `notifyScheduleInputsChanged` | `mes.notifyScheduleInputsChanged` |  | 1 |  | `operations.service.ts` |
| `postMaintenanceLabor` | `mes.maintenanceLabor.post` |  | 1 |  | `maintenance.service.ts` |
| `recordItarCertification` | `mes.recordItarCertification` |  | 1 |  | `itar.service.ts` |
| `returnPickedRemainders` | `mes.returnPickedRemainders` |  | 1 |  | `operations.service.ts` |
| `setFilters` | `mes.filters.set` | 1 |  |  | `operation.server.ts` |
| `setPeopleOverride` | `mes.peopleOverride.set` |  | 1 |  | `people.server.ts` |
| `setPickingListLineQuantity` | `mes.pickingListLineQuantity.set` |  | 1 |  | `picking.service.ts` |
| `setPickingListLineTrackedEntity` | `mes.pickingListLineTrackedEntity.set` |  | 1 |  | `picking.service.ts` |
| `startMaintenanceEvent` | `mes.startMaintenanceEvent` |  | 1 |  | `maintenance.service.ts` |
| `updateMaintenanceDispatchStatus` | `mes.maintenanceDispatchStatus.update` |  | 1 |  | `maintenance.service.ts` |
| `updatePickingListStatus` | `mes.pickingListStatus.update` |  | 1 |  | `picking.service.ts` |
| `updateTimeCardEntry` | `mes.timeCardEntry.update` |  | 1 |  | `people.service.ts` |

</details>

## 5. Actions that write nothing

These are not candidates: authentication, session and locale changes, signed upload URLs, read-only lookups posted as forms.

<details>
<summary>The 52 routes</summary>

- `apps/erp/app/routes/_public+/login.tsx`
- `apps/erp/app/routes/_public+/logout.tsx`
- `apps/erp/app/routes/_public+/mfa.tsx`
- `apps/erp/app/routes/_public+/refresh-session.tsx`
- `apps/erp/app/routes/_public+/verify.tsx`
- `apps/erp/app/routes/api+/ai+/csv+/$table.columns.tsx`
- `apps/erp/app/routes/api+/csp-report.ts`
- `apps/erp/app/routes/api+/integrations.stripe-connect.dashboard.ts`
- `apps/erp/app/routes/api+/locale.tsx`
- `apps/erp/app/routes/api+/mfa.enroll.ts`
- `apps/erp/app/routes/api+/mfa.unenroll.ts`
- `apps/erp/app/routes/api+/mfa.verify.ts`
- `apps/erp/app/routes/api+/passkey.authenticate.options.ts`
- `apps/erp/app/routes/api+/passkey.register.options.ts`
- `apps/erp/app/routes/api+/sales.resolve-price.ts`
- `apps/erp/app/routes/api+/schedule.ts`
- `apps/erp/app/routes/api+/session.heartbeat.ts`
- `apps/erp/app/routes/api+/settings.sequence.rollback.ts`
- `apps/erp/app/routes/api+/sso.check.ts`
- `apps/erp/app/routes/api+/v1+/$.ts`
- `apps/erp/app/routes/api+/webhook.stripe.ts`
- `apps/erp/app/routes/onboarding+/plan.tsx`
- `apps/erp/app/routes/onboarding+/theme.tsx`
- `apps/erp/app/routes/x+/account+/theme.tsx`
- `apps/erp/app/routes/x+/get-started+/state.tsx`
- `apps/erp/app/routes/x+/job+/$jobId.expedite.tsx`
- `apps/erp/app/routes/x+/picking-list+/$pickingListId.line.quantity.tsx`
- `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.tsx`
- `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.lead-time.tsx`
- `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.tsx`
- `apps/erp/app/routes/x+/settings+/company.switch.$companyId.tsx`
- `apps/erp/app/routes/x+/settings+/logos.tsx`
- `apps/erp/app/routes/x+/settings+/printing.tsx`
- `apps/erp/app/routes/x+/templates+/$type.preview.tsx`
- `apps/erp/app/routes/x+/users+/bulk-edit-permissions.tsx`
- `apps/erp/app/routes/x+/users+/deactivate.tsx`
- `apps/erp/app/routes/x+/users+/employees.reset-mfa.$employeeId.tsx`
- `apps/mes/app/routes/_public+/callback.tsx`
- `apps/mes/app/routes/_public+/login.tsx`
- `apps/mes/app/routes/_public+/logout.tsx`
- `apps/mes/app/routes/_public+/mfa.tsx`
- `apps/mes/app/routes/_public+/refresh-session.tsx`
- `apps/mes/app/routes/api+/csp-report.ts`
- `apps/mes/app/routes/api+/passkey.authenticate.options.ts`
- `apps/mes/app/routes/api+/session.heartbeat.ts`
- `apps/mes/app/routes/api+/sso.check.ts`
- `apps/mes/app/routes/x+/console.pin-out.tsx`
- `apps/mes/app/routes/x+/console.toggle.tsx`
- `apps/mes/app/routes/x+/inspection-lot.$id.gauge.tsx`
- `apps/mes/app/routes/x+/inspection-lot.$id.measurement.tsx`
- `apps/mes/app/routes/x+/inspection-lot.$id.sample.tsx`
- `apps/mes/app/routes/x+/proxy.$.tsx`

</details>

## Method and limits

- **Service functions** are the exported functions in `apps/erp/app/modules/*/*.service.ts` and `*.server.ts`, `apps/mes/app/services/*.ts`, and the `*.server.ts` and `service.ts` files under `packages/ee/src`.
- **A call** is a name the route imports from a module and invokes inside its `loader` or `action`, or inside a helper function in the same file that the loader or action calls.
- **Read or write** comes from the function's `@mcp` tag when it has one. A name that starts with `get`, `list`, `is`, `has`, `check`, `validate`, `calculate`, `require`, `log`, `notify` and similar is a read whatever its tag says, and anything else is a write.
- **An action needs a new function** when the sum of these is two or more: distinct write functions called, server functions invoked, direct client writes (`.insert`, `.update`, `.upsert`, `.delete`, `.rpc`), and one for any event or notification sent. An action whose only write is a direct client write also needs one.
- **Module** is the route folder's module: the folder itself when it is a module name, else the module whose functions the folder's routes call most.
- **Proposed names** are `module.entity.verb`: the entity is the route folder and file segments, and the verb is the last file segment (`new` becomes `create`, `details` becomes `update`, `status` becomes `setStatus`). For an action that switches on a form `intent`, each intent gets a name.

What this cannot see:

- Writes made inside a function the route calls from another package, other than `serverFns.invoke`.
- Whether two calls are really one operation or two independent ones on the same page.
- Intents that are not compared with `intent === "…"` or a `case "…"` label.
- A direct write on a variable that is not a database client. `Map`, `Set`, headers and form data are excluded by name, and others may be counted.
- Functions that reach a route only through a re-export are matched by name within the module.
