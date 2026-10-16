// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assignPrinter,
  auditArchiveDownloadUrl,
  billingPortalUrl,
  createApiKey,
  createCompany,
  createSubsidiary,
  deactivateCompanyIntegration,
  deletePrintJob,
  disableCompanyAuditLog,
  enableCompanyAuditLog,
  removeDocumentSection,
  removePrinterRoute,
  reprintPrintJob,
  revokeApiKey,
  saveDocumentSection,
  saveDocumentTemplate,
  savePrinterRoute,
  setRecordCustomFields,
  setRecordTags,
  testPrinterRoute,
  transferCompanyOwnership,
  updateAccountingSettings,
  updateApiKey,
  updateCompanyDetails,
  updateInventorySettings,
  updateInvoicingSettings,
  updateItemsSettings,
  updatePeopleSettings,
  updatePlanningSettings,
  updateProductionSettings,
  updatePurchasingSettings,
  updateQualitySettings,
  updateResourcesSettings,
  updateSalesSettings,
  updateSecuritySettings,
  updateSubsidiaryDetails,
  viewPrintJobContent,
  writeMissingJournals
} from "./settings.server";

/** The settings module's operations, by entity. */
export const settings = {
  company: { create: createCompany, update: updateCompanyDetails },
  subsidiary: { create: createSubsidiary, update: updateSubsidiaryDetails },
  printerRoute: {
    save: savePrinterRoute,
    test: testPrinterRoute,
    delete: removePrinterRoute
  },
  printing: { assign: assignPrinter },
  documentTemplate: { save: saveDocumentTemplate },
  documentSection: {
    save: saveDocumentSection,
    delete: removeDocumentSection
  },
  apiKey: { create: createApiKey, update: updateApiKey, delete: revokeApiKey },
  integration: { deactivate: deactivateCompanyIntegration },
  auditLog: {
    enable: enableCompanyAuditLog,
    disable: disableCompanyAuditLog,
    archiveUrl: auditArchiveDownloadUrl
  },
  billing: {
    portalUrl: billingPortalUrl,
    transferOwnership: transferCompanyOwnership
  },
  tags: { set: setRecordTags },
  customFields: { set: setRecordCustomFields },
  printJob: {
    reprint: reprintPrintJob,
    delete: deletePrintJob,
    viewContent: viewPrintJobContent
  },
  // One update per settings page: it writes the fields sent.
  accounting: {
    update: updateAccountingSettings,
    writeMissingJournals
  },
  inventory: { update: updateInventorySettings },
  invoicing: { update: updateInvoicingSettings },
  items: { update: updateItemsSettings },
  people: { update: updatePeopleSettings },
  planning: { update: updatePlanningSettings },
  production: { update: updateProductionSettings },
  purchasing: { update: updatePurchasingSettings },
  quality: { update: updateQualitySettings },
  resources: { update: updateResourcesSettings },
  sales: { update: updateSalesSettings },
  security: { update: updateSecuritySettings }
};
