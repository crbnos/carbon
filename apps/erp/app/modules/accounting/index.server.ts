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
import {
  createFiscalYearPeriodsTool,
  createIntercompanyTransactionTool,
  deleteAccountingPeriodTool,
  deleteAccountTool,
  deleteCostCenterTool,
  deleteDepreciationRunTool,
  deleteDimensionTool,
  deleteFixedAssetClassTool,
  deleteFixedAssetTool,
  deleteJournalEntryTool,
  deletePaymentTermTool,
  deleteProjectTool,
  deleteReportViewTool,
  generateEliminationsTool,
  getAccountingPeriodDeletabilityTool,
  getAccountingPeriodsTool,
  getAccountingSyncTieOutCellTool,
  getAccountingSyncTieOutTool,
  getAccountLedgerSummaryTool,
  getAccountLedgerTool,
  getAccountsInScopeTool,
  getAccountsListTool,
  getAccountTool,
  getActiveDimensionsWithValuesTool,
  getAssetDepreciationHistoryTool,
  getBaseCurrencyTool,
  getChartOfAccountsTool,
  getCompaniesInGroupTool,
  getCostCentersListTool,
  getCostCentersTreeTool,
  getCostCenterTool,
  getCurrenciesListTool,
  getCurrenciesTool,
  getCurrencyByCodeTool,
  getCurrencyTool,
  getDefaultAccountsTool,
  getDeferredRevenueWaterfallTool,
  getDepreciationRunLinesTool,
  getDepreciationRunsTool,
  getDepreciationRunTool,
  getDimensionPivotLinesTool,
  getDimensionPivotTool,
  getDimensionsTool,
  getDimensionTool,
  getExchangeRateHistoryTool,
  getExchangeRatesTool,
  getExchangeRateTool,
  getFinancialStatementBalancesTool,
  getFinancialStatementPeriodSeriesTool,
  getFiscalCalendarCommittedTool,
  getFiscalYearSettingsTool,
  getFixedAssetCipCostsTool,
  getFixedAssetClassesListTool,
  getFixedAssetClassesTool,
  getFixedAssetClassTool,
  getFixedAssetDisposalTool,
  getFixedAssetsTool,
  getFixedAssetTool,
  getFixedAssetTransfersTool,
  getFleetAssetsTool,
  getGroupAccountsTool,
  getIntercompanyTransactionsTool,
  getJournalEntriesTool,
  getJournalEntryTool,
  getJournalLineDimensionsTool,
  getLeaseLiabilitiesTool,
  getLeaseNetInvestmentTool,
  getPaymentTermsListTool,
  getPaymentTermsTool,
  getPaymentTermTool,
  getPeriodCloseChecklistTool,
  getPeriodRunRelatedItemsTool,
  getProjectsTool,
  getProjectTool,
  getPurchaseLinePivotLinesTool,
  getPurchaseLinePivotTool,
  getRentalUtilizationTool,
  getReportPinsTool,
  getReportViewsTool,
  getRevenueRecognitionRunLinesTool,
  getRevenueRecognitionRunTool,
  getScrapAccountIdsTool,
  getWorkCenterCapitalCostTool,
  insertFixedAssetTool,
  invokeAssetTransferTool,
  postJournalEntryTool,
  reverseJournalEntryTool,
  runIntercompanyMatchingTool,
  saveJournalLineDimensionsTool,
  translateCompanyBalancesTool,
  updateDefaultAccountsTool,
  updateFiscalYearSettingsTool,
  updateFixedAssetTool,
  upsertAccountCreateTool,
  upsertAccountUpdateTool,
  upsertCostCenterCreateTool,
  upsertCostCenterUpdateTool,
  upsertDimensionCreateTool,
  upsertDimensionUpdateTool,
  upsertFixedAssetClassCreateTool,
  upsertFixedAssetClassUpdateTool,
  upsertPaymentTermCreateTool,
  upsertPaymentTermUpdateTool,
  upsertProjectCreateTool,
  upsertProjectUpdateTool,
  upsertReportPinTool,
  upsertReportViewCreateTool,
  upsertReportViewUpdateTool
} from "./accounting.tools.server";

/** The accounting module's operations, by entity. */
export const accounting = {
  depreciationRun: {
    create: depreciationRunCreate,
    post: depreciationRunPost,
    recalculate: depreciationRunRecalculate,
    repeat: depreciationRunRepeat,
    reverse: depreciationRunReverse,
    delete: deleteDepreciationRunTool,
    get: getDepreciationRunTool
  },
  // Revenue recognition and lease runs: one table, `type` tells them apart.
  revenueRecognitionRun: {
    create: revenueRecognitionRunCreate,
    post: revenueRecognitionRunPost,
    repeat: revenueRecognitionRunRepeat,
    reverse: revenueRecognitionRunReverse,
    recalculate: revenueRecognitionRunRecalculate,
    delete: revenueRecognitionRunDelete,
    get: getRevenueRecognitionRunTool
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
    save: journalEntrySave,
    get: getJournalEntryTool,
    delete: deleteJournalEntryTool,
    post: postJournalEntryTool,
    reverse: reverseJournalEntryTool
  },
  fixedAsset: {
    register: fixedAssetRegister,
    dispose: fixedAssetDispose,
    purchase: fixedAssetPurchase,
    sell: fixedAssetSell,
    takeOutOfService: fixedAssetTakeOutOfService,
    returnToService: fixedAssetReturnToService,
    get: getFixedAssetTool,
    insert: insertFixedAssetTool,
    update: updateFixedAssetTool,
    delete: deleteFixedAssetTool
  },
  exchangeRate: {
    override: exchangeRateOverride,
    reset: exchangeRateReset,
    get: getExchangeRateTool
  },
  currency: {
    update: currencyUpdate,
    get: getCurrencyTool
  },
  account: {
    move: accountMove,
    delete: deleteAccountTool,
    get: getAccountTool,
    create: upsertAccountCreateTool,
    update: upsertAccountUpdateTool
  },
  chartOfAccounts: {
    import: chartOfAccountsImport,
    get: getChartOfAccountsTool
  },
  cutover: {
    enable: cutoverEnable
  },
  accountLedger: {
    get: getAccountLedgerTool
  },
  accountLedgerSummary: {
    get: getAccountLedgerSummaryTool
  },
  financialStatementBalances: {
    get: getFinancialStatementBalancesTool
  },
  financialStatementPeriodSeries: {
    get: getFinancialStatementPeriodSeriesTool
  },
  reportPins: {
    get: getReportPinsTool
  },
  reportPin: {
    upsert: upsertReportPinTool
  },
  accountsInScope: {
    get: getAccountsInScopeTool
  },
  dimensionPivot: {
    get: getDimensionPivotTool
  },
  dimensionPivotLines: {
    get: getDimensionPivotLinesTool
  },
  purchaseLinePivot: {
    get: getPurchaseLinePivotTool
  },
  purchaseLinePivotLines: {
    get: getPurchaseLinePivotLinesTool
  },
  reportViews: {
    get: getReportViewsTool
  },
  reportView: {
    create: upsertReportViewCreateTool,
    update: upsertReportViewUpdateTool,
    delete: deleteReportViewTool
  },
  companiesInGroup: {
    get: getCompaniesInGroupTool
  },
  paymentTerm: {
    delete: deletePaymentTermTool,
    get: getPaymentTermTool,
    create: upsertPaymentTermCreateTool,
    update: upsertPaymentTermUpdateTool
  },
  accountsList: {
    get: getAccountsListTool
  },
  groupAccounts: {
    get: getGroupAccountsTool
  },
  baseCurrency: {
    get: getBaseCurrencyTool
  },
  currencyByCode: {
    get: getCurrencyByCodeTool
  },
  exchangeRates: {
    get: getExchangeRatesTool
  },
  currencies: {
    get: getCurrenciesTool
  },
  currenciesList: {
    get: getCurrenciesListTool
  },
  accountingPeriods: {
    get: getAccountingPeriodsTool
  },
  accountingPeriodDeletability: {
    get: getAccountingPeriodDeletabilityTool
  },
  accountingPeriod: {
    delete: deleteAccountingPeriodTool
  },
  fiscalCalendarCommitted: {
    get: getFiscalCalendarCommittedTool
  },
  fiscalYearPeriods: {
    create: createFiscalYearPeriodsTool
  },
  periodCloseChecklist: {
    get: getPeriodCloseChecklistTool
  },
  defaultAccounts: {
    get: getDefaultAccountsTool,
    update: updateDefaultAccountsTool
  },
  scrapAccountIds: {
    get: getScrapAccountIdsTool
  },
  fiscalYearSettings: {
    get: getFiscalYearSettingsTool,
    update: updateFiscalYearSettingsTool
  },
  paymentTerms: {
    get: getPaymentTermsTool
  },
  paymentTermsList: {
    get: getPaymentTermsListTool
  },
  costCenter: {
    delete: deleteCostCenterTool,
    get: getCostCenterTool,
    create: upsertCostCenterCreateTool,
    update: upsertCostCenterUpdateTool
  },
  costCentersList: {
    get: getCostCentersListTool
  },
  costCentersTree: {
    get: getCostCentersTreeTool
  },
  project: {
    delete: deleteProjectTool,
    get: getProjectTool,
    create: upsertProjectCreateTool,
    update: upsertProjectUpdateTool
  },
  projects: {
    get: getProjectsTool
  },
  dimensions: {
    get: getDimensionsTool
  },
  dimension: {
    get: getDimensionTool,
    create: upsertDimensionCreateTool,
    update: upsertDimensionUpdateTool,
    delete: deleteDimensionTool
  },
  activeDimensionsWithValues: {
    get: getActiveDimensionsWithValuesTool
  },
  journalLineDimensions: {
    get: getJournalLineDimensionsTool,
    save: saveJournalLineDimensionsTool
  },
  companyBalances: {
    translate: translateCompanyBalancesTool
  },
  intercompanyTransactions: {
    get: getIntercompanyTransactionsTool
  },
  intercompanyTransaction: {
    create: createIntercompanyTransactionTool
  },
  intercompanyMatching: {
    run: runIntercompanyMatchingTool
  },
  eliminations: {
    generate: generateEliminationsTool
  },
  exchangeRateHistory: {
    get: getExchangeRateHistoryTool
  },
  journalEntries: {
    get: getJournalEntriesTool
  },
  fixedAssetClasses: {
    get: getFixedAssetClassesTool
  },
  fixedAssetClass: {
    get: getFixedAssetClassTool,
    create: upsertFixedAssetClassCreateTool,
    update: upsertFixedAssetClassUpdateTool,
    delete: deleteFixedAssetClassTool
  },
  fixedAssetClassesList: {
    get: getFixedAssetClassesListTool
  },
  fixedAssets: {
    get: getFixedAssetsTool
  },
  depreciationRuns: {
    get: getDepreciationRunsTool
  },
  depreciationRunLines: {
    get: getDepreciationRunLinesTool
  },
  revenueRecognitionRunLines: {
    get: getRevenueRecognitionRunLinesTool
  },
  periodRunRelatedItems: {
    get: getPeriodRunRelatedItemsTool
  },
  deferredRevenueWaterfall: {
    get: getDeferredRevenueWaterfallTool
  },
  rentalUtilization: {
    get: getRentalUtilizationTool
  },
  leaseNetInvestment: {
    get: getLeaseNetInvestmentTool
  },
  leaseLiabilities: {
    get: getLeaseLiabilitiesTool
  },
  assetDepreciationHistory: {
    get: getAssetDepreciationHistoryTool
  },
  fixedAssetDisposal: {
    get: getFixedAssetDisposalTool
  },
  fleetAssets: {
    get: getFleetAssetsTool
  },
  fixedAssetTransfers: {
    get: getFixedAssetTransfersTool
  },
  fixedAssetCipCosts: {
    get: getFixedAssetCipCostsTool
  },
  workCenterCapitalCost: {
    get: getWorkCenterCapitalCostTool
  },
  assetTransfer: {
    invoke: invokeAssetTransferTool
  },
  accountingSyncTieOut: {
    get: getAccountingSyncTieOutTool
  },
  accountingSyncTieOutCell: {
    get: getAccountingSyncTieOutCellTool
  }
};
