// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The database reads of the accounting cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md sections 3 and 4): the
// readiness checks, the open items, the inventory and fixed assets at the
// cutover date, and Migration Clearing. Also the two writes the wizard makes
// before the enable: the Draft opening trial balance and the accumulated
// depreciation of an asset. Server-only. Every function takes a Kysely handle
// or a transaction, so the wizard loaders and the enable transaction run the
// same reads.
//
// This file is the public entry (`@carbon/database/accounting-cutover-reads`);
// the reads live in ./accounting-cutover/, one module per wizard step.

// Moved to the client-safe planner; re-exported so existing imports keep working.
export { dayBeforeCutover } from "./accounting-cutover";
export {
  type CutoverFixedAsset,
  getAssetsLeavingWithoutJournal,
  getCutoverFixedAssets,
  getDepreciationAfterCutover,
  updateCutoverAccumulatedDepreciation
} from "./accounting-cutover/fixed-assets";
export {
  type CutoverInventoryAccountValue,
  type CutoverInventoryItem,
  type CutoverInventoryValuedItem,
  getCutoverInventory,
  getCutoverInventoryValuation
} from "./accounting-cutover/inventory";
export {
  getLegacyDocumentCounts,
  hasLegacyDocuments
} from "./accounting-cutover/legacy-counts";
export { getCutoverOpenItems } from "./accounting-cutover/open-items";
export {
  type ActivationCheck,
  type ActivationCheckItem,
  type ActivationCheckKey,
  type ActivationCheckReason,
  CUTOVER_MAX_PERIODS_BACK,
  type CutoverDateReason,
  cutoverDateReason,
  getActivationReadiness
} from "./accounting-cutover/readiness";
export {
  ACCOUNT_DEFAULT_COLUMNS,
  ACCOUNTING_ALREADY_SET_UP,
  type CutoverDb
} from "./accounting-cutover/shared";
export {
  type CutoverOpeningInputs,
  getCutoverOpeningInputs,
  getMigrationClearing,
  getOpeningTrialBalance,
  saveOpeningTrialBalance
} from "./accounting-cutover/trial-balance";
export {
  type LegacyDocumentCounts,
  type LegacyDocumentFamily,
  REBUILT_DISPOSAL_METHOD
} from "./legacy-documents";
