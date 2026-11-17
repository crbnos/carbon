// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type { PrinterContext } from "./assignments";
export {
  defaultAutoPrint,
  emptyLocationAssignment,
  getPrinterContextForSource,
  locationPrinterContexts,
  printerContexts,
  resolveContextAssignment,
  setContextAssignment
} from "./assignments";
export {
  labelTemplateValidator,
  manualPrintValidator,
  printerRouteValidator,
  reprintValidator,
  updateAssignmentValidator
} from "./models";
export type {
  DocumentTypeDefinition,
  DocumentTypeId,
  LabelTemplateType,
  SourceDocument
} from "./registry";
export {
  documentTypeRegistry,
  getDocumentType,
  getDocumentTypeOptions,
  getDocumentTypesForSource,
  getLabelTemplateType,
  getPrintPermissions,
  labelTemplateTypes
} from "./registry";

export {
  createPrintJob,
  deleteLabelTemplate,
  deletePrinterRoute,
  getLabelTemplates,
  getLabelTemplatesForMediaSize,
  getPrinterApiKey,
  getPrinterRoute,
  getPrinterRoutes,
  getPrintingSettings,
  getPrintJob,
  getPrintJobContent,
  getPrintJobs,
  setPrinterApiKey,
  updatePrintingSettings,
  updatePrintJobContent,
  updatePrintJobStatus,
  upsertLabelTemplate,
  upsertPrinterRoute
} from "./service";
export type {
  ContextAssignment,
  LocationAssignment,
  PrinterRoute,
  PrintingSettings,
  PrintJob,
  PrintJobContentType,
  PrintJobOrigin,
  PrintJobStatus
} from "./types";
