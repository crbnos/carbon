/**
 * Stable public facade for the server-only Ramp integration service.
 *
 * Keep public exports here so @carbon/ee/ramp.server consumers retain the same
 * contract while implementation domains remain independently maintainable.
 */

export type { RampAccountMapping, RampGlAccount } from "./chart-of-accounts";
export {
  chunk,
  diffChartOfAccounts,
  pushChartOfAccounts,
  RAMP_ACCOUNTS_BATCH_SIZE,
  rampClassificationForClass,
  toRampGlAccountPayload
} from "./chart-of-accounts";
export {
  advanceRampCursor,
  clearRampConnectionMetadata,
  ensureRampConnection,
  exchangeRampOAuthCode,
  getRampIntegration
} from "./connection";
export type {
  RampCostCenterMapping,
  RampCostCenterOption,
  RampRemoteFieldOption
} from "./cost-centers";
export {
  buildCostCenterFieldBody,
  buildCostCenterOptionsBody,
  costCenterFingerprint,
  diffCostCenterOptions,
  ensureCostCenterDimension,
  pushCostCenters
} from "./cost-centers";
export type { RampProjectMapping, RampProjectOption } from "./projects";
export {
  buildProjectFieldBody,
  buildProjectOptionsBody,
  diffProjectOptions,
  ensureProjectDimension,
  projectFingerprint,
  pushProjects
} from "./projects";
export type {
  RampInvoicePush,
  RampPurchaseOrderBatch,
  RampPurchaseOrderPush,
  RampPurchaseOrderPushLine,
  RampVendorSupplier
} from "./spend";
export {
  prepareRampPurchaseOrderBatch,
  pushInvoiceDraftBill,
  pushPurchaseOrder,
  resolveOrCreateRampSpendVendor
} from "./spend";
export {
  CARD_MERCHANT_SUPPLIER_TYPE,
  resolveEmployeeSupplier,
  resolveMerchantSupplier,
  resolveRampSupplier
} from "./suppliers";
export { buildSyncConfirmBody, confirmSyncs } from "./sync-confirmation";
export {
  completeWebhookVerification,
  ensureRampWebhook,
  RAMP_WEBHOOK_EVENT_TYPES
} from "./webhooks";
