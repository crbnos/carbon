// Re-export the inngest client and helpers
export { inngest } from "./client.ts";

import {
  auditFunction,
  embeddingFunction,
  eventQueueFunction,
  searchFunction,
  syncFunction,
  webhookFunction,
  workflowFunction
} from "./functions/events";
import {
  accountingBackfillFunction,
  jiraSyncFunction,
  linearSyncFunction,
  paperlessPartsFunction,
  slackDocumentAssignmentUpdateFunction,
  slackDocumentCreatedFunction,
  slackDocumentStatusUpdateFunction,
  slackDocumentTaskUpdateFunction,
  syncExternalAccountingFunction,
  timeCardAutoCloseFunction
} from "./functions/integrations";
// Import all functions
import {
  notifyFunction,
  sendEmailFunction,
  sendSlackFunction
} from "./functions/notifications";
import {
  auditArchiveFunction,
  cleanupFunction,
  dispatchFunction,
  mrpFunction,
  notificationDigestFunction,
  notificationPurgeFunction,
  updateExchangeRatesFunction,
  weeklyFunction
} from "./functions/scheduled";
import {
  companyExportFunction,
  companyImportFunction,
  companyRevertFunction,
  modelThumbnailFunction,
  onboardFunction,
  postTransactionFunction,
  printJobDeliverFunction,
  printJobFunction,
  publishDemoFunction,
  recalculateFunction,
  refreshDemoCatalogFunction,
  rescheduleJobFunction,
  updatePermissionsFunction,
  userAdminFunction
} from "./functions/tasks";

// Export all functions for serving via serve() or connect()
export const functions = [
  // Notifications
  notifyFunction,
  sendEmailFunction,
  sendSlackFunction,
  // Event handlers
  auditFunction,
  eventQueueFunction,
  searchFunction,
  syncFunction,
  webhookFunction,
  workflowFunction,
  embeddingFunction,
  // Tasks
  companyExportFunction,
  companyImportFunction,
  companyRevertFunction,
  modelThumbnailFunction,
  updatePermissionsFunction,
  recalculateFunction,
  userAdminFunction,
  postTransactionFunction,
  rescheduleJobFunction,
  onboardFunction,
  printJobFunction,
  printJobDeliverFunction,
  publishDemoFunction,
  refreshDemoCatalogFunction,
  // Scheduled
  cleanupFunction,
  dispatchFunction,
  auditArchiveFunction,
  mrpFunction,
  weeklyFunction,
  updateExchangeRatesFunction,
  notificationDigestFunction,
  notificationPurgeFunction,
  // Integrations
  jiraSyncFunction,
  linearSyncFunction,
  paperlessPartsFunction,
  accountingBackfillFunction,
  syncExternalAccountingFunction,
  slackDocumentCreatedFunction,
  slackDocumentStatusUpdateFunction,
  slackDocumentTaskUpdateFunction,
  slackDocumentAssignmentUpdateFunction,
  timeCardAutoCloseFunction
];
