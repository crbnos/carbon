// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const ACCOUNTING_PAGES = [
  {
    id: "accounting.reporting",
    label: "Reporting",
    maxLevel: "Full",
    tables: ["costLedger", "supplierLedger"],
    readers: ["journal", "journalLine", "accountingPeriod", "itemLedger"],
    paths: ["/x/accounting/reports", "/x/reports/"]
  },
  {
    id: "accounting.syncTieOut",
    label: "Sync Tie-Out",
    maxLevel: "View",
    tables: ["accountingSyncTieOut"],
    paths: ["/x/accounting/sync-tieout"]
  },
  {
    id: "accounting.journalEntries",
    label: "Journal Entries",
    maxLevel: "Full",
    tables: ["journal", "journalLine", "journalLineDimension"],
    paths: ["/x/accounting/journals", "/x/journal-entry/"]
  },
  {
    id: "accounting.intercompany",
    label: "Intercompany",
    maxLevel: "Full",
    tables: ["intercompanyTransaction", "intercompanyEliminationLine"],
    paths: ["/x/accounting/intercompany"]
  },
  {
    id: "accounting.accountingPeriods",
    label: "Accounting Periods",
    maxLevel: "Full",
    tables: [
      "accountingPeriod",
      "accountingPeriodBalance",
      "periodCloseTask",
      "periodCloseTaskDefinition"
    ],
    paths: ["/x/accounting/periods"]
  },
  {
    id: "accounting.depreciation",
    label: "Depreciation",
    maxLevel: "Full",
    tables: ["depreciationRun", "depreciationRunLine"],
    paths: ["/x/accounting/depreciation-runs", "/x/depreciation-run/"]
  },
  {
    id: "accounting.leases",
    label: "Leases",
    maxLevel: "Full",
    tables: ["revenueRecognitionRun"],
    where: { table: "revenueRecognitionRun", column: "type", value: "Lease" },
    children: [{ table: "revenueRecognitionRunLine", via: "runId" }],
    readers: ["revenueRecognitionSchedule"],
    paths: ["/x/accounting/lease-runs"]
  },
  {
    id: "accounting.revenueRecognition",
    label: "Revenue Recognition",
    maxLevel: "Full",
    tables: ["revenueRecognitionRun", "revenueRecognitionSchedule"],
    where: {
      table: "revenueRecognitionRun",
      column: "type",
      value: "Revenue Recognition"
    },
    children: [{ table: "revenueRecognitionRunLine", via: "runId" }],
    paths: ["/x/accounting/revenue-recognition-runs"]
  },
  {
    id: "accounting.assets",
    label: "Assets",
    maxLevel: "Full",
    tables: [
      "fixedAsset",
      "fixedAssetCipCost",
      "fixedAssetDisposal",
      "fixedAssetTransfer",
      "fixedAssetUsageLog"
    ],
    paths: ["/x/accounting/fixed-assets", "/x/fixed-asset/"]
  },
  {
    id: "accounting.fleet",
    label: "Fleet",
    maxLevel: "View",
    tables: [],
    readers: ["fixedAsset", "fixedAssetUsageLog"],
    paths: ["/x/accounting/fleet"]
  },
  {
    id: "accounting.assetClasses",
    label: "Asset Classes",
    maxLevel: "Full",
    tables: ["fixedAssetClass"],
    paths: ["/x/accounting/asset-classes", "/x/accounting/asset-class/"]
  },
  {
    id: "accounting.chartOfAccounts",
    label: "Chart of Accounts",
    maxLevel: "Full",
    tables: ["account"],
    paths: ["/x/accounting/charts", "/x/accounting/chart-import"]
  },
  {
    id: "accounting.costCenters",
    label: "Cost Centers",
    maxLevel: "Full",
    tables: ["costCenter"],
    paths: ["/x/accounting/cost-centers"]
  },
  {
    id: "accounting.defaultAccounts",
    label: "Default Accounts",
    maxLevel: "Full",
    tables: ["accountDefault"],
    readers: ["itemPostingGroup"],
    paths: ["/x/accounting/defaults"]
  },
  {
    id: "accounting.dimensions",
    label: "Dimensions",
    maxLevel: "Full",
    tables: ["dimension", "dimensionValue"],
    paths: ["/x/accounting/dimensions"]
  },
  {
    id: "accounting.exchangeRates",
    label: "Exchange Rates",
    maxLevel: "Full",
    tables: ["currency", "exchangeRateOverride"],
    paths: ["/x/accounting/exchange-rates"]
  },
  {
    id: "accounting.fiscalYear",
    label: "Fiscal Year",
    maxLevel: "Full",
    tables: ["fiscalYearSettings"],
    paths: ["/x/accounting/years"]
  },
  {
    id: "accounting.paymentTerms",
    label: "Payment Terms",
    maxLevel: "Full",
    tables: ["paymentTerm"],
    paths: ["/x/accounting/payment-terms"]
  },
  {
    id: "accounting.projects",
    label: "Projects",
    maxLevel: "Full",
    tables: ["project"],
    paths: ["/x/accounting/projects"]
  }
] as const satisfies readonly Page[];
