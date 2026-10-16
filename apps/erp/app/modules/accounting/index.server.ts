// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  accountMove,
  chartOfAccountsImport,
  closeTaskComplete,
  closeTaskSkip,
  currencyUpdate,
  cutoverEnable,
  depreciationRunCreate,
  depreciationRunPost,
  depreciationRunRecalculate,
  depreciationRunRepeat,
  depreciationRunReverse,
  exchangeRateOverride,
  exchangeRateReset,
  fixedAssetDispose,
  fixedAssetPurchase,
  fixedAssetRegister,
  fixedAssetReturnToService,
  fixedAssetSell,
  fixedAssetTakeOutOfService,
  journalEntryCreate,
  journalEntrySave,
  periodClose,
  periodCreateRun,
  periodLock,
  periodUnlock,
  revenueRecognitionRunCreate,
  revenueRecognitionRunDelete,
  revenueRecognitionRunPost,
  revenueRecognitionRunRecalculate,
  revenueRecognitionRunRepeat,
  revenueRecognitionRunReverse
} from "./accounting.server";

/** The accounting module's operations, by entity. */
export const accounting = {
  depreciationRun: {
    create: depreciationRunCreate,
    post: depreciationRunPost,
    recalculate: depreciationRunRecalculate,
    repeat: depreciationRunRepeat,
    reverse: depreciationRunReverse
  },
  // Revenue recognition and lease runs: one table, `type` tells them apart.
  revenueRecognitionRun: {
    create: revenueRecognitionRunCreate,
    post: revenueRecognitionRunPost,
    repeat: revenueRecognitionRunRepeat,
    reverse: revenueRecognitionRunReverse,
    recalculate: revenueRecognitionRunRecalculate,
    delete: revenueRecognitionRunDelete
  },
  period: {
    lock: periodLock,
    unlock: periodUnlock,
    close: periodClose,
    createRun: periodCreateRun
  },
  closeTask: {
    complete: closeTaskComplete,
    skip: closeTaskSkip
  },
  journalEntry: {
    create: journalEntryCreate,
    save: journalEntrySave
  },
  fixedAsset: {
    register: fixedAssetRegister,
    dispose: fixedAssetDispose,
    purchase: fixedAssetPurchase,
    sell: fixedAssetSell,
    takeOutOfService: fixedAssetTakeOutOfService,
    returnToService: fixedAssetReturnToService
  },
  exchangeRate: {
    override: exchangeRateOverride,
    reset: exchangeRateReset
  },
  currency: {
    update: currencyUpdate
  },
  account: {
    move: accountMove
  },
  chartOfAccounts: {
    import: chartOfAccountsImport
  },
  cutover: {
    enable: cutoverEnable
  }
};
