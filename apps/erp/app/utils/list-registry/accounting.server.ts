// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RunType } from "@carbon/database/run-type";
import {
  DEPRECIATION_RUNS_PAGING,
  DIMENSIONS_PAGING,
  FIXED_ASSET_CLASSES_PAGING,
  FIXED_ASSETS_PAGING,
  FLEET_ASSETS_PAGING,
  getDepreciationRuns,
  getDimensions,
  getFixedAssetClasses,
  getFixedAssets,
  getFleetAssets,
  getIntercompanyTransactions,
  getJournalEntries,
  getPaymentTerms,
  getProjects,
  getRevenueRecognitionRuns,
  INTERCOMPANY_TRANSACTIONS_PAGING,
  JOURNAL_ENTRIES_PAGING,
  PAYMENT_TERMS_PAGING,
  PERIOD_RUNS_PAGING,
  PROJECTS_PAGING
} from "~/modules/accounting/accounting.service";
import type { ListDefinition } from "./index.server";
import { resolveCompanyGroupId, searchList } from "./index.server";

const ACCOUNTING_PERMISSION = {
  view: "accounting",
  role: "employee"
} satisfies ListDefinition["permission"];

// Dimensions and intercompany transactions belong to the company group: the
// loader passes its group, and a background job's query reads it.

export const journalEntriesList = searchList({
  key: "journal-entries",
  permission: ACCOUNTING_PERMISSION,
  paging: JOURNAL_ENTRIES_PAGING,
  service: getJournalEntries,
  params: { status: "status" }
});

export const fixedAssetsList = searchList({
  key: "fixed-assets",
  permission: ACCOUNTING_PERMISSION,
  paging: FIXED_ASSETS_PAGING,
  service: getFixedAssets,
  params: { status: "status" }
});

export const assetClassesList = searchList({
  key: "asset-classes",
  permission: ACCOUNTING_PERMISSION,
  paging: FIXED_ASSET_CLASSES_PAGING,
  service: getFixedAssetClasses
});

export const depreciationRunsList = searchList({
  key: "depreciation-runs",
  permission: ACCOUNTING_PERMISSION,
  paging: DEPRECIATION_RUNS_PAGING,
  service: getDepreciationRuns
});

export const fleetAssetsList = searchList({
  key: "fleet-assets",
  permission: ACCOUNTING_PERMISSION,
  paging: FLEET_ASSETS_PAGING,
  service: getFleetAssets,
  params: { fleetStatus: "fleetStatus" }
});

export const dimensionsList = {
  key: "accounting-dimensions",
  permission: ACCOUNTING_PERMISSION,
  ...DIMENSIONS_PAGING,
  query: async (client, companyId, context) => {
    const { companyGroupId, error } = await resolveCompanyGroupId(
      client,
      companyId,
      context
    );
    if (!companyGroupId) return { data: null, error };
    const { params, limit, cursor, exactCount, sorts, filters } = context;
    return getDimensions(client, companyGroupId, {
      search: params.get("search"),
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
  }
} satisfies ListDefinition;

export const intercompanyTransactionsList = {
  key: "intercompany-transactions",
  permission: ACCOUNTING_PERMISSION,
  ...INTERCOMPANY_TRANSACTIONS_PAGING,
  query: async (client, companyId, context) => {
    const { companyGroupId, error } = await resolveCompanyGroupId(
      client,
      companyId,
      context
    );
    if (!companyGroupId) return { data: null, error };
    const { params, limit, cursor, exactCount, sorts, filters } = context;
    return getIntercompanyTransactions(client, companyGroupId, {
      status: params.get("status"),
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
  }
} satisfies ListDefinition;

export const paymentTermsList = searchList({
  key: "payment-terms",
  permission: ACCOUNTING_PERMISSION,
  paging: PAYMENT_TERMS_PAGING,
  service: getPaymentTerms
});

export const projectsList = searchList({
  key: "projects",
  permission: ACCOUNTING_PERMISSION,
  paging: PROJECTS_PAGING,
  service: getProjects
});

// Revenue recognition runs and lease runs share one engine and one list query
// (`period-runs.server.ts`); each run type is its own list.
function periodRunsQuery(type: RunType) {
  return (
    ...[
      client,
      companyId,
      { params, limit, cursor, exactCount, sorts, filters }
    ]: Parameters<ListDefinition["query"]>
  ) =>
    getRevenueRecognitionRuns(client, companyId, type, {
      search: params.get("search"),
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
}

export const revenueRecognitionRunsList = {
  key: "revenue-recognition-runs",
  permission: ACCOUNTING_PERMISSION,
  ...PERIOD_RUNS_PAGING,
  query: periodRunsQuery("Revenue Recognition")
} satisfies ListDefinition;

export const leaseRunsList = {
  key: "lease-runs",
  permission: ACCOUNTING_PERMISSION,
  ...PERIOD_RUNS_PAGING,
  query: periodRunsQuery("Lease")
} satisfies ListDefinition;

export const periodRunsLists = {
  "Revenue Recognition": revenueRecognitionRunsList,
  Lease: leaseRunsList
} satisfies Record<RunType, ListDefinition>;

// The accounting lists. Each entry follows `sales.server.ts`.
export const accountingLists: Record<string, ListDefinition> = {
  [journalEntriesList.key]: journalEntriesList,
  [fixedAssetsList.key]: fixedAssetsList,
  [assetClassesList.key]: assetClassesList,
  [depreciationRunsList.key]: depreciationRunsList,
  [fleetAssetsList.key]: fleetAssetsList,
  [dimensionsList.key]: dimensionsList,
  [intercompanyTransactionsList.key]: intercompanyTransactionsList,
  [paymentTermsList.key]: paymentTermsList,
  [projectsList.key]: projectsList,
  [revenueRecognitionRunsList.key]: revenueRecognitionRunsList,
  [leaseRunsList.key]: leaseRunsList
};
