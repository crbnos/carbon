// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assignPrinter,
  createCompany,
  createSubsidiary,
  deletePrintJob,
  removeDocumentSection,
  removePrinterRoute,
  reprintPrintJob,
  saveDocumentSection,
  saveDocumentTemplate,
  savePrinterRoute,
  testPrinterRoute,
  updateAccountingSettings,
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
