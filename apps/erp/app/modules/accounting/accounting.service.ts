// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ForbiddenError,
  InvalidInputError,
  isDataLayerError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import {
  type PermissionRule,
  resolvePermissions
} from "@carbon/api/permissions";
import type {
  CarbonError,
  ErrorCategory,
  ServiceContext
} from "@carbon/api/service-fn.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import {
  fetchAllByIds,
  fetchAllFromTable,
  fetchAllRecords,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import {
  ACCOUNT_TYPES,
  type AccountImportPlan,
  type AccountType,
  FIXED_ASSET_CLASS_COLUMNS,
  incomeBalanceOf,
  isApplicable,
  planAccountImport,
  REFERENCE_POLICY,
  requiredRoles
} from "@carbon/database/account-import";
import { loadAccountImportContext } from "@carbon/database/account-import-reads";
import {
  ACTIVATION_CUTOVER_PARAM,
  buildOpeningJournalLines,
  isMigrationClearingZero,
  MIGRATION_CLEARING_ACCOUNT_CLASS,
  type OpenItem,
  planInventoryReset,
  type RecostEvent,
  recostOutbound
} from "@carbon/database/accounting-cutover";
import {
  ACCOUNTING_ALREADY_SET_UP,
  CUTOVER_MAX_PERIODS_BACK,
  dayBeforeCutover,
  getActivationReadiness,
  getCutoverInventory,
  getMigrationClearing
} from "@carbon/database/accounting-cutover-reads";
import {
  DOCUMENT_JOURNAL_STATUSES,
  OPEN_ITEM_JOURNAL_STATUSES
} from "@carbon/database/accounting-posting";
import type {
  KyselyDatabase as DB,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import {
  addMovement,
  applyContractMovement,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import {
  type CostingMethod,
  isCostLayer,
  isCostRelief,
  type ReliefEvent,
  replayReliefs
} from "@carbon/database/cost-relief";
import { fetchAll } from "@carbon/database/fetch-all";
import {
  type AutomaticJournalStatus,
  assertPostingStatusUnchanged,
  configuredDefaultAccount,
  journalPostingStatus,
  MissingAccountDefaultError,
  missingDefaultMessage,
  OPTIONAL_DEFAULT_ROLES,
  type OptionalDefaultRole,
  readAccountingCutoverDate,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { toJson } from "@carbon/database/json";
import {
  LEGACY_PURCHASE_RETURN_SHIPMENT,
  LEGACY_SALES_RETURN_SHIPMENT,
  LEGACY_SALES_SHIPMENT,
  type LegacyDocumentCounts,
  type LegacyShipmentKind,
  legacyAdjustmentCostRows,
  legacyCharges,
  legacyDepreciationRunLines,
  legacyDisposals,
  legacyJobMovements,
  legacyMemos,
  legacyPayments,
  legacyPurchaseInvoices,
  legacyReceipts,
  legacyRecognitionSchedule,
  legacyReimbursements,
  legacySaleMovements,
  legacySalesInvoices,
  legacyShipments,
  POSTED_INVOICE_EXCLUDED_STATUSES,
  REBUILT_DISPOSAL_METHOD,
  shipmentCostRows
} from "@carbon/database/legacy-documents";
import { readPaymentProcessorFees } from "@carbon/database/payment-processor-fee";
import { inOrder } from "@carbon/database/rows";
import {
  buildDeferredTaxJournals,
  buildDepreciationJournals,
  buildDisposalJournal,
  buildRecognitionJournals,
  type DeferredTaxSettings,
  type DepreciationRunLine,
  type Disposal,
  deferredTaxSettings,
  type RecognitionScheduleRow,
  type RecognitionSources,
  type RunJournal,
  recognitionAccountWithoutClass
} from "@carbon/database/run-journals";
import {
  RUN_SEQUENCE,
  type RunType,
  runLabelSentence,
  runTypeFilter,
  runTypeOfScheduleRow
} from "@carbon/database/run-type";
import {
  getNextSequence as getNextSequenceInTransaction,
  getNextSequences
} from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import type {
  AccountType as LedgerAccountType,
  PeriodPostingSource,
  ReportPeriodBucket
} from "@carbon/utils";
import {
  accountTypeFromClass,
  addDays,
  allocateSalesHeaderShipping,
  assertBalanced,
  assertExchangeRate,
  chunkArray,
  credit,
  datetime,
  daysBetweenInclusive,
  debit,
  EPSILON,
  earnsInterest,
  equals,
  fiscalYearAndPeriodFor,
  formatDate,
  formatIsoDate,
  formatPeriodLabel,
  GL_JOURNAL_STATUSES,
  getDateNYearsAgo,
  isAccountClass,
  isBalanced,
  isUniqueViolation,
  MONTH_NUMBER,
  parseIsoDate,
  REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION,
  round,
  type SalesPostingAccount,
  toBaseAmount,
  toDisplayCredit,
  toDisplayDebit,
  toStoredAmount,
  unchecked
} from "@carbon/utils";
import { endOfMonth, parseDate, startOfMonth } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Transaction as KyselyTransaction, Selectable } from "kysely";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  buildPurchaseReceiptJournalLines,
  buildReturnShipmentJournal,
  buildSalesReturnReceiptJournalLines,
  buildSalesShipmentJournal,
  type PurchaseReceiptLine,
  type PurchaseReceiptLineCost,
  purchaseReceiptLineCosts
} from "~/modules/inventory/inventory.service";
import {
  buildPurchaseInvoicePostingLines,
  buildSalesInvoiceJournal,
  calculatePurchasePostingAmounts,
  isItemLineType,
  loadLeasePostingFacts,
  type PurchaseInvoiceItem,
  type PurchaseInvoicePostingLine,
  planSalesInvoiceAccounts,
  rebuildMemoJournals,
  rebuildPaymentJournals,
  resolveLeasePostingLine,
  resolveSalesInvoiceAccounts,
  type SalesInvoiceLine,
  type SalesLineRevenue,
  salesLineDimensions
} from "~/modules/invoicing/invoicing.service";
import { getOnRentLineForAsset } from "~/modules/sales/sales.service";
import { getNextSequence } from "~/modules/settings/settings.service";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import {
  allocateJournalLineIds,
  assertAccountingCutover,
  assertCompanyRecords,
  bookAdjustment,
  buildAdjustmentJournalLines,
  buildCapitalizationLines,
  buildReturnToInventoryLines,
  CHARGE_VOID_BEFORE_CUTOVER_ERROR,
  calculateCOGS,
  costCenterAndProjectDimensions,
  createAdjustmentJournal,
  getCurrentAccountingPeriod as ensureCurrentAccountingPeriod,
  fromServerFn,
  getAccountingPeriodForDate,
  getDefaultPostingGroup,
  getOffsetAccount,
  insertNegatedJournal,
  invokePosting,
  loadContractPositions,
  lockContractPositions,
  type PostingLine,
  REIMBURSEMENT_VOID_BEFORE_CUTOVER_ERROR,
  refuseVoidBeforeCutover,
  resolveAccountingPeriod,
  resolveInventoryAccount,
  syncDraftRecognitionRuns
} from "../shared/shared.service";
import type {
  AnalyticsAccountScope,
  AnalyticsReportDefinition,
  accountValidator,
  costCenterValidator,
  currencyValidator,
  defaultAccountValidator,
  defaultIncomeAcountValidator,
  depreciationMethods,
  dimensionValidator,
  fiscalYearSettingsValidator,
  intercompanyTransactionValidator,
  journalEntryLineValidator,
  journalEntryValidator,
  macrsConventions,
  macrsPropertyClasses,
  PivotState,
  paymentTermValidator,
  periodCloseStatuses,
  periodCloseTaskDefinitionValidator,
  periodCloseTaskSeverities,
  periodCloseTaskStatuses,
  periodCloseTaskTypes,
  projectValidator,
  taxDepreciationMethods
} from "./accounting.models";
import {
  CONSTRUCTION_IN_PROGRESS_ENABLED,
  JOURNAL_BALANCE_TOLERANCE,
  RUN_JOURNAL_SOURCES
} from "./accounting.models";
import {
  type ActivationCutoverDates,
  acquisitionLines,
  activationCutoverDates,
  buildDepreciationLines,
  type DepreciationLine,
  depreciationFloor,
  depreciationRunLinesMatch,
  diffJournalLines,
  hasAccountingCutover,
  isFutureRunPeriod,
  LOCK_PERIOD_TASK_NAME,
  monthEndOf,
  runPostingTargets,
  usageKey
} from "./accounting.utils";
import {
  type LeaseCostSummary,
  type LeaseLiabilitySummary,
  leaseLiabilityAssets,
  summarizeLeaseCosts,
  summarizeLeaseLiabilities
} from "./lease-liabilities";
import type {
  AccountLedgerLine,
  ChartPeriodSeries,
  PeriodCell,
  Transaction,
  TranslatedBalance
} from "./types";
import { NET_INCOME_ACCOUNT_ID } from "./types";

/**
 * Sign multiplier for root account aggregation.
 * Asset and Revenue have normal debit balances and add to parent.
 * Liability, Equity, and Expense have normal credit balances and subtract.
 */
function rootSignMultiplier(accountClass: string | null): number {
  switch (accountClass) {
    case "Asset":
    case "Revenue":
      return 1;
    case "Liability":
    case "Equity":
    case "Expense":
      return -1;
    default:
      return 1;
  }
}

/**
 * Recalculates balance/balanceAtDate/netChange for system (root) accounts
 * using sign-aware aggregation based on direct children's account class.
 *
 * Standard accounting:
 *   Balance Sheet  = Assets − Liabilities − Equity   (should ≈ 0)
 *   Income Statement = Revenue − Expenses             (= Net Income)
 */
function applyRootSignCorrection<
  T extends {
    id: string;
    parentId: string | null;
    isSystem?: boolean | null;
    class: string | null;
    balance: number;
    balanceAtDate: number;
    netChange: number;
    translatedBalance?: number;
  }
>(accounts: T[]): T[] {
  const roots = accounts.filter((a) => a.isSystem ?? a.parentId === null);
  if (roots.length === 0) return accounts;

  const rootIds = new Set(roots.map((r) => r.id));
  const childrenByRoot = new Map<string, T[]>();

  for (const account of accounts) {
    if (account.parentId && rootIds.has(account.parentId)) {
      const list = childrenByRoot.get(account.parentId) ?? [];
      list.push(account);
      childrenByRoot.set(account.parentId, list);
    }
  }

  return accounts.map((account) => {
    if (!rootIds.has(account.id)) return account;

    const children = childrenByRoot.get(account.id) ?? [];
    let balance = 0;
    let balanceAtDate = 0;
    let netChange = 0;
    let translatedBalance = 0;

    for (const child of children) {
      const sign = rootSignMultiplier(child.class);
      balance += sign * child.balance;
      balanceAtDate += sign * child.balanceAtDate;
      netChange += sign * child.netChange;
      if (
        "translatedBalance" in child &&
        typeof child.translatedBalance === "number"
      ) {
        translatedBalance += sign * child.translatedBalance;
      }
    }

    const result = { ...account, balance, balanceAtDate, netChange };
    if ("translatedBalance" in account) {
      (result as T & { translatedBalance: number }).translatedBalance =
        translatedBalance;
    }
    return result;
  });
}

export async function getTrialBalance(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string | null,
  args: {
    startDate: string | null;
    endDate: string | null;
  }
) {
  return client.rpc("trialBalance", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId ?? undefined,
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });
}

export async function getAccountLedger(
  client: SupabaseClient<Database>,
  args: {
    accountId: string;
    companyId: string | null;
    // Consolidated drill-down: restrict to an explicit set of companies (the
    // group's operating companies + elimination entities) so a service-role read
    // doesn't leak across tenants. Ignored when companyId is set.
    companyIds?: string[];
    startDate: string | null;
    endDate: string | null;
    limit: number;
    offset: number;
  }
) {
  // TODO: remove the cast once cloud-generated DB types include the view.
  let query = client
    .from("journalLines" as any)
    .select("*", { count: "exact" })
    .eq("accountId", args.accountId)
    .gte(
      "postingDate",
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0]
    )
    .lte("postingDate", args.endDate ?? new Date().toISOString().split("T")[0]);

  if (args.companyId) {
    query = query.eq("companyId", args.companyId);
  } else if (args.companyIds && args.companyIds.length > 0) {
    query = query.in("companyId", args.companyIds);
  }

  const result = await query
    .order("postingDate", { ascending: false })
    .order("journalEntryId", { ascending: false })
    .order("id", { ascending: false })
    .range(args.offset, args.offset + args.limit - 1);

  return result as unknown as {
    data: AccountLedgerLine[] | null;
    count: number | null;
    error: PostgrestError | null;
  };
}

export async function getAccountLedgerSummary(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string | null,
  args: {
    accountId: string;
    startDate: string | null;
    endDate: string | null;
  }
) {
  // Same RPC the report pages use, so the drawer ties out by construction
  const balances = await client.rpc("accountTreeBalancesByCompany", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId ?? undefined,
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });

  if (balances.error) {
    return { data: null, error: balances.error };
  }

  const row = balances.data?.find((b) => b.accountId === args.accountId);
  const closing = row?.balanceAtDate ?? 0;
  const netChange = row?.netChange ?? 0;

  return {
    data: {
      opening: closing - netChange,
      netChange,
      closing
    },
    error: null
  };
}

export async function getFinancialStatementBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string | null,
  args: {
    startDate: string | null;
    endDate: string | null;
    // Balance sheet only: append a computed "Net Income" equity line.
    includeCurrentYearEarnings?: boolean;
  }
) {
  let accountsQuery = client
    .from("accounts")
    .select("*")
    .eq("companyGroupId", companyGroupId)
    .order("number", { ascending: true })
    .order("id", { ascending: true });

  const balancesQuery = client.rpc("accountTreeBalancesByCompany", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId ?? undefined,
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });

  const [accountsResponse, balancesResponse] = await Promise.all([
    fetchAll<Database["public"]["Views"]["accounts"]["Row"]>(
      () => accountsQuery
    ),
    fetchAll<
      Database["public"]["Functions"]["accountTreeBalancesByCompany"]["Returns"][number]
    >(() => balancesQuery.order("accountId", { ascending: true }))
  ]);

  if (accountsResponse.error)
    return { data: null, error: accountsResponse.error };
  if (balancesResponse.error)
    return { data: null, error: balancesResponse.error };

  const balancesByAccountId = (
    balancesResponse.data as unknown as (Transaction & { accountId: string })[]
  ).reduce<Record<string, Transaction>>((acc, row) => {
    acc[row.accountId] = {
      number: row.number,
      netChange: row.netChange,
      balance: row.balance,
      balanceAtDate: row.balanceAtDate
    };
    return acc;
  }, {});

  const mapped = (accountsResponse.data ?? [])
    .filter((a): a is typeof a & { id: string } => a.id !== null)
    .map((account) => ({
      ...account,
      netChange: balancesByAccountId[account.id]?.netChange ?? 0,
      balance: balancesByAccountId[account.id]?.balance ?? 0,
      balanceAtDate: balancesByAccountId[account.id]?.balanceAtDate ?? 0
    }));

  // Undistributed net income lives only in income-statement accounts until it is
  // closed. A balance sheet at any date must carry it inside equity, or
  // Assets ≠ Liabilities + Equity. We surface it as a computed "Net Income"
  // equity line — the same pattern NetSuite ("Net Income" line), QuickBooks, and
  // SAP (FSV net-result node) use: a calculated equity row, never a posted close.
  if (args.includeCurrentYearEarnings) {
    const balanceSheetRoot = mapped.find(
      (a) =>
        a.incomeBalance === "Balance Sheet" &&
        (a.isSystem ?? a.parentId === null)
    );
    const equityGroup = mapped.find(
      (a) =>
        a.class === "Equity" && a.isGroup && a.parentId === balanceSheetRoot?.id
    );
    if (balanceSheetRoot && equityGroup) {
      // Net income = Revenue − Expenses over income-statement LEAF accounts,
      // signed exactly like the Income Statement report's bottom line.
      let balance = 0;
      let balanceAtDate = 0;
      let netChange = 0;
      for (const a of mapped) {
        if (a.incomeBalance !== "Income Statement" || a.isGroup) continue;
        const sign = rootSignMultiplier(a.class);
        balance += sign * a.balance;
        balanceAtDate += sign * a.balanceAtDate;
        netChange += sign * a.netChange;
      }
      // Roll into the Equity group subtotal so the section ties out;
      // applyRootSignCorrection recomputes the Balance Sheet root from its
      // direct children, so the root nets to ~0.
      equityGroup.balance += balance;
      equityGroup.balanceAtDate += balanceAtDate;
      equityGroup.netChange += netChange;
      // Clone the Equity group to inherit every account column the report needs,
      // then override identity + balances. Must NOT be isSystem — a system row
      // is treated as a root by applyRootSignCorrection and recomputed to zero.
      mapped.push({
        ...equityGroup,
        id: NET_INCOME_ACCOUNT_ID,
        name: "Net Income",
        isGroup: false,
        isSystem: false,
        parentId: equityGroup.id,
        balance,
        balanceAtDate,
        netChange
      });
    }
  }

  return {
    data: applyRootSignCorrection(mapped),
    error: null
  };
}

export async function getAccountPeriodSeries(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  args: { start: string; periodEnds: string[] }
) {
  return accountPeriodSeriesQuery(client, companyGroupId, companyId, args);
}

// Keep the exported RPC response contract while report readers page the same query.
function accountPeriodSeriesQuery(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  args: { start: string; periodEnds: string[] }
) {
  // Defined in migration 20260809151458_balance-rpc-period-series.sql.
  // The contract on p_period_ends (sorted ascending, distinct, >= p_start) is
  // enforced by computeReportPeriodBuckets — the only producer of this arg.
  return client.rpc("accountTreeBalancePeriodSeries", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId,
    p_start: args.start,
    p_period_ends: args.periodEnds
  });
}

/**
 * Recalculates every period cell for system (root) accounts using the same
 * sign-aware aggregation as applyRootSignCorrection.
 *
 * KEEP IN SYNC with applyRootSignCorrection above — identical root/child walk,
 * applied per period bucket instead of to the single-measure columns.
 */
function applyRootSignCorrectionToSeries<
  T extends {
    id: string;
    parentId: string | null;
    isSystem?: boolean | null;
    class: string | null;
    periods: Record<string, PeriodCell>;
  }
>(accounts: T[], bucketKeys: string[]): T[] {
  const roots = accounts.filter((a) => a.isSystem ?? a.parentId === null);
  if (roots.length === 0) return accounts;

  const rootIds = new Set(roots.map((r) => r.id));
  const childrenByRoot = new Map<string, T[]>();

  for (const account of accounts) {
    if (account.parentId && rootIds.has(account.parentId)) {
      const list = childrenByRoot.get(account.parentId) ?? [];
      list.push(account);
      childrenByRoot.set(account.parentId, list);
    }
  }

  return accounts.map((account) => {
    if (!rootIds.has(account.id)) return account;

    const children = childrenByRoot.get(account.id) ?? [];
    const periods: Record<string, PeriodCell> = {};

    for (const key of bucketKeys) {
      let netChange = 0;
      let balanceAtDate = 0;
      let translatedBalance = 0;
      let translatedNetChange = 0;
      let hasTranslated = false;

      for (const child of children) {
        const sign = rootSignMultiplier(child.class);
        const cell = child.periods[key];
        netChange += sign * (cell?.netChange ?? 0);
        balanceAtDate += sign * (cell?.balanceAtDate ?? 0);
        if (typeof cell?.translatedBalance === "number") {
          hasTranslated = true;
          translatedBalance += sign * cell.translatedBalance;
        }
        if (typeof cell?.translatedNetChange === "number") {
          hasTranslated = true;
          translatedNetChange += sign * cell.translatedNetChange;
        }
      }

      periods[key] = {
        netChange,
        balanceAtDate,
        ...(hasTranslated ? { translatedBalance, translatedNetChange } : {})
      };
    }

    return { ...account, periods };
  });
}

// Roll translated leaf values up onto INTERMEDIATE group rows (subtotals).
// Per-company translation (translateCompanyBalances) stamps translated values on
// LEAVES only — it deliberately skips group accounts so the CTA total isn't
// double-counted — and applyRootSignCorrectionToSeries only recomputes ROOT rows.
// Without this pass every subtotal (Revenue, Receivables, …) renders "-" in any
// translated view (all consolidated reports, plus single-company foreign
// currency), since it carries no translatedBalance/translatedNetChange. Raw
// netChange/balanceAtDate already roll up in the SQL RPC; this is the translated
// counterpart. Intermediate groups sum their children WITHOUT a sign flip — a
// group's children share a class (hence a normal balance), so no correction
// applies until the class boundary at the root, which the root-sign pass owns.
function rollUpTranslatedGroups<
  T extends {
    id: string;
    parentId: string | null;
    isSystem?: boolean | null;
    periods: Record<string, PeriodCell>;
  }
>(accounts: T[], bucketKeys: string[]): T[] {
  const childrenByParent = new Map<string, T[]>();
  for (const account of accounts) {
    if (account.parentId) {
      const list = childrenByParent.get(account.parentId) ?? [];
      list.push(account);
      childrenByParent.set(account.parentId, list);
    }
  }

  // Post-order sum of translated leaf values, memoized (each node visited once).
  const memo = new Map<
    string,
    Record<string, { tb: number; tnc: number; has: boolean }>
  >();
  const compute = (
    node: T
  ): Record<string, { tb: number; tnc: number; has: boolean }> => {
    const cached = memo.get(node.id);
    if (cached) return cached;
    const children = childrenByParent.get(node.id) ?? [];
    const out: Record<string, { tb: number; tnc: number; has: boolean }> = {};
    for (const key of bucketKeys) {
      if (children.length === 0) {
        const cell = node.periods[key];
        out[key] = {
          tb: cell?.translatedBalance ?? 0,
          tnc: cell?.translatedNetChange ?? 0,
          has:
            typeof cell?.translatedBalance === "number" ||
            typeof cell?.translatedNetChange === "number"
        };
      } else {
        let tb = 0;
        let tnc = 0;
        let has = false;
        for (const child of children) {
          const childCell = compute(child)[key]!;
          if (childCell.has) {
            has = true;
            tb += childCell.tb;
            tnc += childCell.tnc;
          }
        }
        out[key] = { tb, tnc, has };
      }
    }
    memo.set(node.id, out);
    return out;
  };

  return accounts.map((account) => {
    const isRoot = account.isSystem ?? account.parentId === null;
    const hasChildren = (childrenByParent.get(account.id) ?? []).length > 0;
    // Leaves already carry their own translated values; roots are recomputed
    // (with sign) by applyRootSignCorrectionToSeries, which runs after this.
    if (isRoot || !hasChildren) return account;
    const rolled = compute(account);
    const periods = { ...account.periods };
    for (const key of bucketKeys) {
      const cell = rolled[key]!;
      if (!cell.has) continue;
      const existing = periods[key] ?? { netChange: 0, balanceAtDate: 0 };
      periods[key] = {
        ...existing,
        translatedBalance: cell.tb,
        translatedNetChange: cell.tnc
      };
    }
    return { ...account, periods };
  });
}

/** Apply report-only CTA to the reporting company's configured Equity account. */
export async function applyCtaToReportPeriodSeries(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  reportingCompanyId: string,
  args: {
    accounts: ChartPeriodSeries[];
    bucketKeys: string[];
    ctaByBucket: Record<string, number>;
  }
): Promise<{
  data: ChartPeriodSeries[] | null;
  error: { message: string } | null;
}> {
  const defaults = await client
    .from("accountDefault")
    .select("currencyTranslationAccount")
    .eq("companyId", reportingCompanyId)
    .single();
  if (defaults.error) return { data: null, error: defaults.error };
  const accountId = defaults.data?.currencyTranslationAccount;
  if (!accountId) {
    return {
      data: null,
      error: {
        message: `Configure a currency translation account for company ${reportingCompanyId}`
      }
    };
  }
  const ctaAccount = args.accounts.find((account) => account.id === accountId);
  if (!ctaAccount) {
    return {
      data: null,
      error: {
        message:
          "The configured currency translation account is missing from the report"
      }
    };
  }

  if (
    ctaAccount.companyGroupId !== companyGroupId ||
    ctaAccount.active !== true ||
    ctaAccount.isGroup !== false ||
    ctaAccount.class !== "Equity" ||
    ctaAccount.incomeBalance !== "Balance Sheet"
  ) {
    return {
      data: null,
      error: {
        message:
          "The currency translation account must be an active Balance Sheet Equity posting account in this company group"
      }
    };
  }

  const accounts = args.accounts.map((account) => ({
    ...account,
    periods: Object.fromEntries(
      Object.entries(account.periods).map(([key, cell]) => [key, { ...cell }])
    )
  }));
  const translatedCta = accounts.find((account) => account.id === accountId)!;
  const netIncome = accounts.find(
    (account) => account.id === NET_INCOME_ACCOUNT_ID
  );

  for (const key of args.bucketKeys) {
    const cell = translatedCta.periods[key];
    const cta = args.ctaByBucket[key];
    if (
      !cell ||
      typeof cell.translatedBalance !== "number" ||
      !Number.isFinite(cell.translatedBalance) ||
      typeof cta !== "number" ||
      !Number.isFinite(cta)
    ) {
      return {
        data: null,
        error: {
          message: `Missing or invalid currency translation values for period ${key}`
        }
      };
    }
    translatedCta.periods[key] = {
      ...cell,
      translatedBalance: round(cell.translatedBalance + cta)
    };

    // Single-company translation deliberately excludes the synthetic income
    // leaf. Derive its translated values from the full income statement before
    // rolling Equity up; the raw current-year earnings remain unchanged.
    const incomeCell = netIncome?.periods[key];
    if (
      netIncome &&
      incomeCell &&
      typeof incomeCell.translatedBalance !== "number"
    ) {
      let translatedBalance = 0;
      let translatedNetChange = 0;
      for (const account of accounts) {
        if (account.incomeBalance !== "Income Statement" || account.isGroup)
          continue;
        const sign = rootSignMultiplier(account.class);
        translatedBalance +=
          sign * (account.periods[key]?.translatedBalance ?? 0);
        translatedNetChange +=
          sign * (account.periods[key]?.translatedNetChange ?? 0);
      }
      netIncome.periods[key] = {
        ...incomeCell,
        translatedBalance: round(translatedBalance),
        translatedNetChange: round(translatedNetChange)
      };
    }
  }

  return {
    data: applyRootSignCorrectionToSeries(
      rollUpTranslatedGroups(accounts, args.bucketKeys),
      args.bucketKeys
    ),
    error: null
  };
}

// Overlay per-bucket translated leaf balances onto the series rows.
function overlayTranslationOnSeries<
  T extends { id: string; periods: Record<string, PeriodCell> }
>(
  rows: T[],
  byBucket: Record<string, { balances: TranslatedBalance[]; cta: number }>
): T[] {
  const maps = new Map<string, Map<string, TranslatedBalance>>();
  for (const [key, bucket] of Object.entries(byBucket)) {
    maps.set(key, new Map(bucket.balances.map((b) => [b.accountId, b])));
  }

  return rows.map((row) => {
    let changed = false;
    const periods = { ...row.periods };
    for (const [key, map] of maps) {
      const translation = map.get(row.id);
      if (!translation) continue;
      changed = true;
      const existing = periods[key] ?? { netChange: 0, balanceAtDate: 0 };
      const exchangeRate = Number(translation.exchangeRate);
      periods[key] = {
        ...existing,
        translatedBalance: Number(translation.translatedBalance),
        // Translated period delta: apply the same per-account rate to netChange
        // so flow reads (income statement / executive P&L) get a translated
        // activity figure rather than the translated cumulative balance.
        translatedNetChange: round(existing.netChange * exchangeRate),
        exchangeRate
      };
    }
    return changed ? { ...row, periods } : row;
  });
}

/**
 * Per-bucket currency translation for a period series. Calls the existing
 * translateCompanyBalances once per bucket (bucket end = closing rate date,
 * bucket start = average-rate window start) on synthetic single-measure rows
 * built from that bucket's balanceAtDate.
 */
export async function translateCompanyPeriodSeries(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  targetCurrency: string,
  buckets: ReportPeriodBucket[],
  series: Array<{
    id: string;
    consolidatedRate: string | null;
    isGroup: boolean | null;
    class: string | null;
    periods: Record<string, PeriodCell>;
  }>
): Promise<{
  byBucket: Record<string, { balances: TranslatedBalance[]; cta: number }>;
  error: string | null;
}> {
  const results = await Promise.all(
    buckets.map(async (bucket) => {
      const synthetic = series.map((row) => ({
        id: row.id,
        balanceAtDate: row.periods[bucket.key]?.balanceAtDate ?? 0,
        consolidatedRate: row.consolidatedRate,
        isGroup: row.isGroup,
        class: row.class
      }));
      const translation = await translateCompanyBalances(
        client,
        companyGroupId,
        companyId,
        targetCurrency,
        bucket.end,
        bucket.start,
        synthetic
      );
      return { key: bucket.key, translation };
    })
  );

  const byBucket: Record<
    string,
    { balances: TranslatedBalance[]; cta: number }
  > = {};
  for (const { key, translation } of results) {
    if (translation.error) {
      return { byBucket: {}, error: translation.error };
    }
    byBucket[key] = { balances: translation.data ?? [], cta: translation.cta };
  }

  return { byBucket, error: null };
}

/**
 * Multi-period financial statement balances: one column per bucket, powered by
 * the accountTreeBalancePeriodSeries RPC (snapshot-based, single journal scan).
 * The multi-period sibling of getFinancialStatementBalances — same accounts
 * view, same Net Income injection (per bucket), same root sign correction.
 */
export async function getFinancialStatementPeriodSeries(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  args: {
    buckets: ReportPeriodBucket[];
    // Balance sheet only: append a computed "Net Income" equity line per bucket.
    includeCurrentYearEarnings?: boolean;
    // When set, per-bucket translated balances are overlaid before the root
    // sign correction so root rows carry translated values too.
    translate?: { targetCurrency: string };
  }
): Promise<{
  data: ChartPeriodSeries[] | null;
  ctaByBucket: Record<string, number>;
  error: { message: string } | null;
}> {
  if (args.buckets.length === 0) {
    return { data: [], ctaByBucket: {}, error: null };
  }

  const bucketKeys = args.buckets.map((b) => b.key);
  const keyByEnd = new Map(args.buckets.map((b) => [b.end, b.key]));

  const accountsQuery = client
    .from("accounts")
    .select("*")
    .eq("companyGroupId", companyGroupId)
    .order("number", { ascending: true })
    .order("id", { ascending: true });

  // The buckets helper may truncate a very wide range, so the series start is
  // the FIRST bucket's start — not whatever the caller had before bucketing.
  const seriesQuery = accountPeriodSeriesQuery(
    client,
    companyGroupId,
    companyId,
    {
      start: args.buckets[0]!.start,
      periodEnds: args.buckets.map((b) => b.end)
    }
  );

  const [accountsResponse, seriesResponse] = await Promise.all([
    fetchAll<Database["public"]["Views"]["accounts"]["Row"]>(
      () => accountsQuery
    ),
    fetchAll<
      Database["public"]["Functions"]["accountTreeBalancePeriodSeries"]["Returns"][number]
    >(() =>
      seriesQuery
        .order("accountId", { ascending: true })
        .order("periodEnd", { ascending: true })
    )
  ]);

  if (accountsResponse.error) {
    return {
      data: null,
      ctaByBucket: {},
      error: accountsResponse.error
    };
  }
  if (seriesResponse.error) {
    return { data: null, ctaByBucket: {}, error: seriesResponse.error };
  }

  const periodsByAccountId = new Map<string, Record<string, PeriodCell>>();
  for (const row of seriesResponse.data ?? []) {
    const key = keyByEnd.get(row.periodEnd);
    if (!key) continue;
    let record = periodsByAccountId.get(row.accountId);
    if (!record) {
      record = {};
      periodsByAccountId.set(row.accountId, record);
    }
    record[key] = {
      netChange: Number(row.netChange ?? 0),
      balanceAtDate: Number(row.balanceAtDate ?? 0)
    };
  }

  const emptyPeriods = (): Record<string, PeriodCell> =>
    Object.fromEntries(
      bucketKeys.map((key) => [key, { netChange: 0, balanceAtDate: 0 }])
    );

  let mapped = (accountsResponse.data ?? [])
    .filter((a): a is typeof a & { id: string } => a.id !== null)
    .map((account) => ({
      ...account,
      periods: {
        ...emptyPeriods(),
        ...(periodsByAccountId.get(account.id) ?? {})
      }
    }));

  // Same Net Income equity line as getFinancialStatementBalances, computed per
  // bucket: cumulative (balanceAtDate) and per-bucket (netChange) sums over
  // income-statement LEAF accounts, rolled into the Equity group subtotal.
  if (args.includeCurrentYearEarnings) {
    const balanceSheetRoot = mapped.find(
      (a) =>
        a.incomeBalance === "Balance Sheet" &&
        (a.isSystem ?? a.parentId === null)
    );
    const equityGroup = mapped.find(
      (a) =>
        a.class === "Equity" && a.isGroup && a.parentId === balanceSheetRoot?.id
    );
    if (balanceSheetRoot && equityGroup) {
      const netIncomePeriods: Record<string, PeriodCell> = {};
      for (const key of bucketKeys) {
        let balanceAtDate = 0;
        let netChange = 0;
        for (const a of mapped) {
          if (a.incomeBalance !== "Income Statement" || a.isGroup) continue;
          const sign = rootSignMultiplier(a.class);
          const cell = a.periods[key];
          balanceAtDate += sign * (cell?.balanceAtDate ?? 0);
          netChange += sign * (cell?.netChange ?? 0);
        }
        const equityCell = equityGroup.periods[key] ?? {
          netChange: 0,
          balanceAtDate: 0
        };
        equityGroup.periods[key] = {
          ...equityCell,
          netChange: equityCell.netChange + netChange,
          balanceAtDate: equityCell.balanceAtDate + balanceAtDate
        };
        netIncomePeriods[key] = { netChange, balanceAtDate };
      }
      // Clone the Equity group to inherit every account column the report
      // needs. Must NOT be isSystem — a system row is treated as a root by
      // applyRootSignCorrectionToSeries and recomputed to zero.
      mapped.push({
        ...equityGroup,
        id: NET_INCOME_ACCOUNT_ID,
        name: "Net Income",
        isGroup: false,
        isSystem: false,
        parentId: equityGroup.id,
        periods: netIncomePeriods
      });
    }
  }

  let ctaByBucket: Record<string, number> = {};

  if (args.translate) {
    const translation = await translateCompanyPeriodSeries(
      client,
      companyGroupId,
      companyId,
      args.translate.targetCurrency,
      args.buckets,
      mapped
    );
    if (translation.error) {
      return {
        data: null,
        ctaByBucket: {},
        error: { message: translation.error }
      };
    }
    mapped = overlayTranslationOnSeries(mapped, translation.byBucket);
    for (const [key, bucket] of Object.entries(translation.byBucket)) {
      ctaByBucket[key] = bucket.cta;
    }
  }

  return {
    data: applyRootSignCorrectionToSeries(
      rollUpTranslatedGroups(mapped, bucketKeys),
      bucketKeys
    ) as unknown as ChartPeriodSeries[],
    ctaByBucket,
    error: null
  };
}

/**
 * Multi-company, multi-period consolidation — the period-series sibling of
 * getConsolidatedBalances: per-company series (including auto-resolved
 * elimination entities) summed per account and bucket, with per-bucket
 * currency translation and CTA.
 */
export async function getConsolidatedPeriodSeries(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  args: {
    buckets: ReportPeriodBucket[];
    // Balance sheet only: append a computed "Net Income" equity line (current
    // year earnings) so consolidated assets tie to liabilities + equity.
    includeCurrentYearEarnings?: boolean;
  },
  // Privileged (service-role) client used ONLY to read elimination entities.
  // Those are synthetic consolidation companies that no user is a member of, so
  // their ledger is invisible to the RLS-scoped `client` and their reversing
  // entries would silently drop out of the consolidation (intercompany balances
  // never eliminate). The route already authorized the user for this group, and
  // reads stay scoped to `companyGroupId`. Operating companies still read via the
  // RLS `client`. Defaults to `client` (no elimination visibility) when omitted.
  eliminationClient: SupabaseClient<Database> = client
): Promise<{
  data: ChartPeriodSeries[] | null;
  ctaByBucket: Record<string, number>;
  error: string | null;
}> {
  const bucketKeys = args.buckets.map((b) => b.key);
  const allIds = await resolveConsolidationCompanyIds(
    eliminationClient,
    companyGroupId,
    companyIds
  );

  // Elimination-entity ids in this group — read privileged, everything else RLS.
  // Fail loudly on a read error: an empty set here silently routes the
  // elimination entity through the RLS client (which can't see it), dropping the
  // reversing entries and reporting un-eliminated intercompany balances as real.
  const { data: elimRows, error: elimError } = await eliminationClient
    .from("company")
    .select("id")
    .eq("companyGroupId", companyGroupId)
    .eq("isEliminationEntity", true);
  if (elimError) {
    throw new Error(
      `Failed to resolve elimination entities for consolidation: ${elimError.message}`
    );
  }
  const elimIds = new Set((elimRows ?? []).map((c) => c.id));

  const results = await Promise.all(
    allIds.map(async (id) => {
      const readClient = elimIds.has(id) ? eliminationClient : client;
      const series = await getFinancialStatementPeriodSeries(
        readClient,
        companyGroupId,
        id,
        { buckets: args.buckets }
      );

      const translation =
        series.error || !series.data
          ? {
              byBucket: {} as Record<
                string,
                { balances: TranslatedBalance[]; cta: number }
              >,
              error: series.error?.message ?? "Failed to load balances"
            }
          : await translateCompanyPeriodSeries(
              readClient,
              companyGroupId,
              id,
              targetCurrency,
              args.buckets,
              series.data
            );

      return { series, translation };
    })
  );

  // Sum raw cells per (account, bucket) across companies
  const summedByAccount = new Map<string, Record<string, PeriodCell>>();
  for (const { series } of results) {
    if (series.error || !series.data) continue;
    for (const row of series.data) {
      let record = summedByAccount.get(row.id);
      if (!record) {
        record = {};
        summedByAccount.set(row.id, record);
      }
      for (const key of bucketKeys) {
        const cell = row.periods[key];
        if (!cell) continue;
        const agg = record[key] ?? { netChange: 0, balanceAtDate: 0 };
        record[key] = {
          netChange: agg.netChange + cell.netChange,
          balanceAtDate: agg.balanceAtDate + cell.balanceAtDate
        };
      }
    }
  }

  // Sum translated leaf balances per (account, bucket) and CTA per bucket.
  // translatedNetChange is summed here too: translateCompanyBalances only
  // returns translatedBalance (derived from balanceAtDate), but the Income
  // Statement and Executive P&L read the translated period FLOW
  // (translatedNetChange). Compute it per company as netChange × that account's
  // rate — the same formula overlayTranslationOnSeries uses on the single-company
  // path — then sum across companies. Without it the consolidated Income
  // Statement renders every cell as "-" (translatedNetChange undefined).
  const translatedByAccount = new Map<
    string,
    Record<
      string,
      {
        translatedBalance: number;
        translatedNetChange: number;
        exchangeRate: number;
      }
    >
  >();
  const ctaByBucket: Record<string, number> = Object.fromEntries(
    bucketKeys.map((key) => [key, 0])
  );

  // A subsidiary whose translation failed must fail the consolidation loudly —
  // silently excluding it produces a wrong consolidated total with no signal.
  const failedSeriesTranslation = results.find((r) => r.translation.error);
  if (failedSeriesTranslation?.translation.error) {
    return {
      data: null,
      ctaByBucket: {},
      error: failedSeriesTranslation.translation.error
    };
  }

  for (const { series, translation } of results) {
    if (translation.error) continue;
    // This company's raw netChange per (account, bucket) — the flow that the
    // per-account rate below translates.
    const netChangeByAccount = new Map<string, Record<string, number>>();
    for (const row of series.data ?? []) {
      const rec: Record<string, number> = {};
      for (const key of bucketKeys) {
        rec[key] = row.periods[key]?.netChange ?? 0;
      }
      netChangeByAccount.set(row.id, rec);
    }
    for (const [key, bucket] of Object.entries(translation.byBucket)) {
      ctaByBucket[key] = (ctaByBucket[key] ?? 0) + bucket.cta;
      for (const row of bucket.balances) {
        let record = translatedByAccount.get(row.accountId);
        if (!record) {
          record = {};
          translatedByAccount.set(row.accountId, record);
        }
        const rate = Number(row.exchangeRate);
        const netChange = netChangeByAccount.get(row.accountId)?.[key] ?? 0;
        const translatedNetChange = round(netChange * rate);
        const existing = record[key];
        record[key] = existing
          ? {
              translatedBalance:
                existing.translatedBalance + Number(row.translatedBalance),
              translatedNetChange:
                existing.translatedNetChange + translatedNetChange,
              exchangeRate: existing.exchangeRate
            }
          : {
              translatedBalance: Number(row.translatedBalance),
              translatedNetChange,
              exchangeRate: rate
            };
      }
    }
  }

  // Use the first company's account structure as the base (shared chart)
  const baseAccounts = results.find((r) => r.series.data)?.series.data ?? [];

  const consolidated = baseAccounts.map((account) => {
    const summed = summedByAccount.get(account.id);
    const translated = translatedByAccount.get(account.id);
    const periods: Record<string, PeriodCell> = {};
    for (const key of bucketKeys) {
      periods[key] = {
        netChange: 0,
        balanceAtDate: 0,
        ...(summed?.[key] ?? {}),
        ...(translated?.[key] ?? {})
      };
    }
    return { ...account, periods };
  });

  // Balance sheet: inject the consolidated "Net Income" (current year earnings)
  // as an equity leaf so the sheet balances. The leaf carries both raw and
  // TRANSLATED period values (translated summed from the already-translated
  // income-statement leaves). Pushed as a leaf child of Equity BEFORE
  // rollUpTranslatedGroups, which propagates only the TRANSLATED values into the
  // Equity subtotal and root — so the TRANSLATED consolidated balance sheet
  // balances, and the multi-company balance sheet always renders translated
  // (showTranslated: true). Unlike the single-company path in
  // getFinancialStatementPeriodSeries, the RAW Equity subtotal is intentionally
  // left unadjusted here (it would double-count against the rolled-up leaf); a
  // consumer that needs the raw Net Income reads it from this leaf, not the
  // subtotal.
  if (args.includeCurrentYearEarnings) {
    const balanceSheetRoot = consolidated.find(
      (a) =>
        a.incomeBalance === "Balance Sheet" &&
        (a.isSystem ?? a.parentId === null)
    );
    const equityGroup = consolidated.find(
      (a) =>
        a.class === "Equity" && a.isGroup && a.parentId === balanceSheetRoot?.id
    );
    if (balanceSheetRoot && equityGroup) {
      const netIncomePeriods: Record<string, PeriodCell> = {};
      for (const key of bucketKeys) {
        let netChange = 0;
        let balanceAtDate = 0;
        let translatedBalance = 0;
        let translatedNetChange = 0;
        for (const a of consolidated) {
          if (a.incomeBalance !== "Income Statement" || a.isGroup) continue;
          const sign = rootSignMultiplier(a.class);
          const cell = a.periods[key];
          netChange += sign * (cell?.netChange ?? 0);
          balanceAtDate += sign * (cell?.balanceAtDate ?? 0);
          translatedBalance += sign * (cell?.translatedBalance ?? 0);
          translatedNetChange += sign * (cell?.translatedNetChange ?? 0);
        }
        netIncomePeriods[key] = {
          netChange,
          balanceAtDate,
          translatedBalance,
          translatedNetChange,
          exchangeRate: 1
        };
      }
      consolidated.push({
        ...equityGroup,
        id: NET_INCOME_ACCOUNT_ID,
        name: "Net Income",
        isGroup: false,
        isSystem: false,
        parentId: equityGroup.id,
        periods: netIncomePeriods
      });
    }
  }

  return {
    data: applyRootSignCorrectionToSeries(
      rollUpTranslatedGroups(consolidated, bucketKeys),
      bucketKeys
    ),
    ctaByBucket,
    error: null
  };
}

// Per-user pin overrides for the reports hub. Absent row = the report's
// default pin state (the core financial statements default to pinned).
export async function getReportPins(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("reportPin")
    .select("reportKey, pinned")
    .eq("userId", userId)
    .eq("companyId", companyId);
}

export async function upsertReportPin(
  client: SupabaseClient<Database>,
  args: {
    reportKey: string;
    pinned: boolean;
    userId: string;
    companyId: string;
  }
) {
  return client.from("reportPin").upsert(
    {
      reportKey: args.reportKey,
      pinned: args.pinned,
      userId: args.userId,
      companyId: args.companyId,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    },
    { onConflict: "reportKey,userId,companyId" }
  );
}

// -- Accounting cutover --

// Manual accounting work — journal entries, period lock and close,
// depreciation and recognition runs, intercompany matching and eliminations —
// runs only after the company's accounting cutover. Before it, journals are
// Provisional and count nowhere, so this work would have no effect
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 1).
export const ACCOUNTING_NOT_STARTED =
  "Set up accounting before you post journals, runs or period closes.";

export async function requireAccountingCutover(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ error: { message: string } | null }> {
  const settings = await client
    .from("companySettings")
    .select("accountingCutoverDate")
    .eq("id", companyId)
    .maybeSingle();
  if (settings.error) return { error: settings.error };
  if (!hasAccountingCutover(settings.data)) {
    return { error: { message: ACCOUNTING_NOT_STARTED } };
  }
  return { error: null };
}

/**
 * The group form: every operating company of the group must have a cutover.
 * The group's elimination entity never sets up accounting, so it is left out.
 * A company with no settings row counts as not set up: the check compares
 * the companies with a cutover against all of them, so it fails closed.
 */
export async function requireGroupAccountingCutover(
  client: SupabaseClient<Database>,
  companyGroupId: string
): Promise<{ error: { message: string } | null }> {
  const companies = await client
    .from("company")
    .select("id")
    .eq("companyGroupId", companyGroupId)
    .eq("isEliminationEntity", false);
  if (companies.error) return { error: companies.error };
  const ids = (companies.data ?? []).map((company) => company.id);
  if (ids.length === 0) return { error: null };
  const withCutover = await client
    .from("companySettings")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .not("accountingCutoverDate", "is", null);
  if (withCutover.error) return { error: withCutover.error };
  if ((withCutover.count ?? 0) !== ids.length) {
    return { error: { message: ACCOUNTING_NOT_STARTED } };
  }
  return { error: null };
}

// -- Dimensional analytics (pivot) reports --
// Spec: .ai/specs/2026-08-09-dimensional-pivot-reporting.md
// RPCs defined in migration 20260809184714_dimensional-pivot-reporting.sql.

// In `columnKeys` the null column (lines with no tag for the column
// dimension — the Unassigned bucket) is represented by this string sentinel.
// Group rows keep their `columnKey` as returned by the RPC (null stays null).
export const UNASSIGNED_COLUMN_KEY = "__unassigned__";

type DimensionPivotGroup = {
  rowValue1Id: string | null;
  rowValue2Id: string | null;
  columnKey: string | null;
  amount: number;
  quantity: number;
  lineCount: number;
};

type DimensionPivotData = {
  groups: DimensionPivotGroup[];
  columnKeys: string[];
  hasMore: boolean;
  valueNames: Record<string, string>;
};

/**
 * Maps an AnalyticsAccountScope onto the pivot RPCs' account-scope params.
 * Exactly one selector is set (the RPCs raise without one); the scrap scope
 * resolves to the accountDefault.scrapAccount ids the loader fetched via
 * getScrapAccountIds.
 */
function pivotAccountScopeParams(
  scope: AnalyticsAccountScope,
  scrapAccountIds: string[] | undefined
):
  | { p_account_classes: string[] }
  | { p_account_types: string[] }
  | { p_account_ids: string[] } {
  if ("classes" in scope) return { p_account_classes: [...scope.classes] };
  if ("types" in scope) return { p_account_types: [...scope.types] };
  return { p_account_ids: scrapAccountIds ?? [] };
}

/**
 * The leaf accounts inside a report's account scope — the universe the
 * per-report account multi-select filters within. Mirrors the scope selectors
 * pivotAccountScopeParams uses: class-scoped and type-scoped reports resolve to
 * the matching active, non-group accounts; the scrap scope resolves to the
 * scrapAccount ids the loader already fetched. Returns the raw supabase
 * response so callers keep the `{ data, error }` convention.
 */
export async function getAccountsInScope(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  scope: AnalyticsAccountScope,
  scrapAccountIds?: string[]
) {
  let query = client
    .from("account")
    .select("id, number, name")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true)
    .eq("isGroup", false);

  if ("classes" in scope) {
    query = query.in("class", scope.classes);
  } else if ("types" in scope) {
    query = query.in("accountType", scope.types);
  } else {
    query = query.in("id", scrapAccountIds ?? []);
  }

  return query.order("number", { ascending: true });
}

export async function getDimensionPivot(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    companyGroupId: string;
    report: AnalyticsReportDefinition;
    // Required when report.accountScope.source === "scrapAccounts"
    scrapAccountIds?: string[];
    startDate: string; // YYYY-MM-DD
    endDate: string;
    // From computeReportPeriodBuckets, when state.columnAxis is period
    periodEnds?: string[];
    // rows are already-resolved dimension ids (the loader resolves et: aliases)
    state: PivotState;
  }
): Promise<{
  data: DimensionPivotData | null;
  error: PostgrestError | null;
}> {
  const { report, state } = args;

  // Scrap report with no configured scrap account: nothing can match, and the
  // RPC raises without an account scope — short-circuit to an empty pivot.
  if (
    "source" in report.accountScope &&
    (args.scrapAccountIds ?? []).length === 0
  ) {
    return {
      data: { groups: [], columnKeys: [], hasMore: false, valueNames: {} },
      error: null
    };
  }

  const columnDimensionId =
    state.columnAxis.type === "dimension"
      ? state.columnAxis.dimensionId
      : undefined;

  const result = await client.rpc("journalDimensionPivot", {
    p_company_group_id: args.companyGroupId,
    p_company_id: args.companyId,
    p_start: args.startDate,
    p_end: args.endDate,
    ...pivotAccountScopeParams(report.accountScope, args.scrapAccountIds),
    ...(state.rows[0] ? { p_row_dimension_1: state.rows[0] } : {}),
    ...(state.rows[1] ? { p_row_dimension_2: state.rows[1] } : {}),
    ...(columnDimensionId ? { p_column_dimension: columnDimensionId } : {}),
    ...(state.columnAxis.type === "period" && args.periodEnds
      ? { p_period_ends: args.periodEnds }
      : {}),
    ...(state.filters.length > 0 ? { p_filters: state.filters } : {}),
    ...(state.accountIds.length > 0
      ? { p_filter_account_ids: state.accountIds }
      : {})
  });

  if (result.error) return { data: null, error: result.error };

  // The generated Returns can't express nullability: NULL rowValue/columnKey
  // is the Unassigned bucket (line carries no tag for that dimension).
  const rows = (result.data ?? []) as Array<{
    rowValue1Id: string | null;
    rowValue2Id: string | null;
    columnKey: string | null;
    amount: number | string;
    quantity: number | string;
    lineCount: number | string;
    hasMore: boolean;
  }>;

  const hasMore = rows.some((r) => r.hasMore);

  // Sorted descending by ABS(amount) in TS — never trust RPC ordering.
  const groups: DimensionPivotGroup[] = rows
    .map((r) => ({
      rowValue1Id: r.rowValue1Id,
      rowValue2Id: r.rowValue2Id,
      columnKey: r.columnKey,
      amount: Number(r.amount),
      quantity: Number(r.quantity),
      lineCount: Number(r.lineCount)
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // Ordered distinct column keys: period axis follows the periodEnds order;
  // dimension axis orders by descending ABS(column total). The Unassigned
  // (null) column always sorts last, as the UNASSIGNED_COLUMN_KEY sentinel.
  const hasUnassignedColumn = groups.some((g) => g.columnKey === null);
  let columnKeys: string[];
  if (state.columnAxis.type === "period") {
    // Every bucket in the selected range renders as a column, including
    // buckets with no journal lines — a 6-month range always shows 6 columns.
    columnKeys = [...(args.periodEnds ?? [])];
    // Defensive: keep any keys the periodEnds contract didn't cover (e.g. the
    // literal 'total' when no period ends were provided).
    for (const g of groups) {
      if (g.columnKey !== null && !columnKeys.includes(g.columnKey)) {
        columnKeys.push(g.columnKey);
      }
    }
  } else {
    const totalsByColumn = new Map<string, number>();
    for (const g of groups) {
      if (g.columnKey === null) continue;
      totalsByColumn.set(
        g.columnKey,
        (totalsByColumn.get(g.columnKey) ?? 0) + g.amount
      );
    }
    columnKeys = [...totalsByColumn.keys()].sort(
      (a, b) =>
        Math.abs(totalsByColumn.get(b) ?? 0) -
        Math.abs(totalsByColumn.get(a) ?? 0)
    );
  }
  if (hasUnassignedColumn) columnKeys.push(UNASSIGNED_COLUMN_KEY);

  // Resolve display names for the value ids actually present, batched by the
  // owning dimension's entityType.
  const valueIdsByDimension = new Map<string, Set<string>>();
  const collect = (dimensionId: string | undefined, valueId: string | null) => {
    if (!dimensionId || !valueId) return;
    const set = valueIdsByDimension.get(dimensionId) ?? new Set<string>();
    set.add(valueId);
    valueIdsByDimension.set(dimensionId, set);
  };
  for (const g of groups) {
    collect(state.rows[0], g.rowValue1Id);
    collect(state.rows[1], g.rowValue2Id);
    collect(columnDimensionId, g.columnKey);
  }

  let valueNames: Record<string, string> = {};
  if (valueIdsByDimension.size > 0) {
    const dimensions = await client
      .from("dimension")
      .select("id, entityType")
      .in("id", [...valueIdsByDimension.keys()]);

    if (dimensions.error) return { data: null, error: dimensions.error };

    valueNames = await resolveDimensionValueNames(
      client,
      (dimensions.data ?? []).map((d) => ({
        entityType: d.entityType,
        valueIds: [...(valueIdsByDimension.get(d.id) ?? [])]
      }))
    );
  }

  return {
    data: { groups, columnKeys, hasMore, valueNames },
    error: null
  };
}

type DimensionPivotLineRow =
  Database["public"]["Functions"]["journalDimensionPivotLines"]["Returns"][number];

/**
 * Drill-through: the journal lines behind one pivot cell.
 *
 * NULL semantics per axis (row 1 / row 2 / column): passing the dimension
 * param with NO value param means Unassigned (the RPC matches lines with no
 * tag for that dimension) — so `rowValue1IsNull` maps to "send
 * p_row_dimension_1, omit p_row_value_1". A period column narrows postingDate
 * via p_column_period_start/end instead of a dimension match.
 */
export async function getDimensionPivotLines(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    companyGroupId: string;
    report: AnalyticsReportDefinition;
    scrapAccountIds?: string[];
    startDate: string;
    endDate: string;
    filters: PivotState["filters"];
    rowDimension1?: string;
    rowValue1?: string;
    rowValue1IsNull?: boolean;
    rowDimension2?: string;
    rowValue2?: string;
    rowValue2IsNull?: boolean;
    columnDimension?: string;
    columnValue?: string;
    columnValueIsNull?: boolean;
    columnPeriodStart?: string;
    columnPeriodEnd?: string;
    accountIds?: string[];
  }
): Promise<{
  data: DimensionPivotLineRow[] | null;
  error: PostgrestError | null;
}> {
  // Same short-circuit as getDimensionPivot: no scrap account, no scope.
  if (
    "source" in args.report.accountScope &&
    (args.scrapAccountIds ?? []).length === 0
  ) {
    return { data: [], error: null };
  }

  const result = await client.rpc("journalDimensionPivotLines", {
    p_company_group_id: args.companyGroupId,
    p_company_id: args.companyId,
    p_start: args.startDate,
    p_end: args.endDate,
    ...pivotAccountScopeParams(args.report.accountScope, args.scrapAccountIds),
    ...(args.filters.length > 0 ? { p_filters: args.filters } : {}),
    ...(args.rowDimension1 ? { p_row_dimension_1: args.rowDimension1 } : {}),
    ...(args.rowValue1 ? { p_row_value_1: args.rowValue1 } : {}),
    ...(args.rowDimension2 ? { p_row_dimension_2: args.rowDimension2 } : {}),
    ...(args.rowValue2 ? { p_row_value_2: args.rowValue2 } : {}),
    ...(args.columnDimension
      ? { p_column_dimension: args.columnDimension }
      : {}),
    ...(args.columnValue ? { p_column_value: args.columnValue } : {}),
    ...(args.columnPeriodStart
      ? { p_column_period_start: args.columnPeriodStart }
      : {}),
    ...(args.columnPeriodEnd
      ? { p_column_period_end: args.columnPeriodEnd }
      : {}),
    ...((args.accountIds ?? []).length > 0
      ? { p_filter_account_ids: args.accountIds }
      : {})
  });

  if (result.error) return { data: null, error: result.error };

  // Re-sort authoritatively in TS — never trust RPC ordering.
  const lines = [...(result.data ?? [])].sort((a, b) => {
    if (a.postingDate !== b.postingDate) {
      return a.postingDate < b.postingDate ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { data: lines, error: null };
}

// -- Purchases analytics (purchase invoice subledger) --
// RPCs in 20260809211324_purchases-pivot-report.sql. Gross invoiced spend
// from purchaseInvoiceLine — NOT the GL journal (AP nets on payment; item
// tags don't live on AP lines). Output matches DimensionPivotData so the
// existing PivotTree renders it unchanged.

// Grouping-field key → the entityType used to resolve value ids to names.
const PURCHASE_FIELD_ENTITY_TYPE: Record<string, string> = {
  supplier: "Supplier",
  supplierType: "SupplierType",
  item: "Item",
  itemPostingGroup: "ItemPostingGroup",
  costCenter: "CostCenter"
};

export async function getPurchaseLinePivot(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    startDate: string;
    endDate: string;
    periodEnds?: string[];
    state: PivotState;
  }
): Promise<{
  data: DimensionPivotData | null;
  error: PostgrestError | null;
}> {
  const { state } = args;
  const columnField =
    state.columnAxis.type === "dimension"
      ? state.columnAxis.dimensionId
      : undefined;

  const result = await client.rpc("purchaseLineDimensionPivot", {
    p_company_id: args.companyId,
    p_start: args.startDate,
    p_end: args.endDate,
    ...(state.rows[0] ? { p_row_field_1: state.rows[0] } : {}),
    ...(state.rows[1] ? { p_row_field_2: state.rows[1] } : {}),
    ...(columnField ? { p_column_field: columnField } : {}),
    ...(state.columnAxis.type === "period" && args.periodEnds
      ? { p_period_ends: args.periodEnds }
      : {})
  });

  if (result.error) return { data: null, error: result.error };

  const rows = (result.data ?? []) as Array<{
    rowValue1Id: string | null;
    rowValue2Id: string | null;
    columnKey: string | null;
    amount: number | string;
    quantity: number | string;
    lineCount: number | string;
    hasMore: boolean;
  }>;

  const hasMore = rows.some((r) => r.hasMore);

  const groups: DimensionPivotGroup[] = rows
    .map((r) => ({
      rowValue1Id: r.rowValue1Id,
      rowValue2Id: r.rowValue2Id,
      columnKey: r.columnKey,
      amount: Number(r.amount),
      quantity: Number(r.quantity),
      lineCount: Number(r.lineCount)
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const hasUnassignedColumn = groups.some((g) => g.columnKey === null);
  let columnKeys: string[];
  if (state.columnAxis.type === "period") {
    columnKeys = [...(args.periodEnds ?? [])];
    for (const g of groups) {
      if (g.columnKey !== null && !columnKeys.includes(g.columnKey)) {
        columnKeys.push(g.columnKey);
      }
    }
  } else {
    const totalsByColumn = new Map<string, number>();
    for (const g of groups) {
      if (g.columnKey === null) continue;
      totalsByColumn.set(
        g.columnKey,
        (totalsByColumn.get(g.columnKey) ?? 0) + g.amount
      );
    }
    columnKeys = [...totalsByColumn.keys()].sort(
      (a, b) =>
        Math.abs(totalsByColumn.get(b) ?? 0) -
        Math.abs(totalsByColumn.get(a) ?? 0)
    );
  }
  if (hasUnassignedColumn) columnKeys.push(UNASSIGNED_COLUMN_KEY);

  // Resolve value ids to names, batched by each grouping field's entityType.
  const valueIdsByField = new Map<string, Set<string>>();
  const collect = (field: string | undefined, valueId: string | null) => {
    if (!field || !valueId) return;
    const set = valueIdsByField.get(field) ?? new Set<string>();
    set.add(valueId);
    valueIdsByField.set(field, set);
  };
  for (const g of groups) {
    collect(state.rows[0], g.rowValue1Id);
    collect(state.rows[1], g.rowValue2Id);
    collect(columnField, g.columnKey);
  }

  let valueNames: Record<string, string> = {};
  if (valueIdsByField.size > 0) {
    valueNames = await resolveDimensionValueNames(
      client,
      [...valueIdsByField.entries()]
        .map(([field, ids]) => ({
          entityType: PURCHASE_FIELD_ENTITY_TYPE[field] ?? "",
          valueIds: [...ids]
        }))
        .filter((request) => request.entityType)
    );
  }

  return {
    data: { groups, columnKeys, hasMore, valueNames },
    error: null
  };
}

type PurchaseLinePivotRow =
  Database["public"]["Functions"]["purchaseLinePivotLines"]["Returns"][number];

export async function getPurchaseLinePivotLines(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    startDate: string;
    endDate: string;
    // A field is passed ONLY when the cell constrains that axis: with a value
    // for a normal cell, or without one for the Unassigned bucket (the RPC
    // then matches rows whose field IS NULL). Omit the field for row totals /
    // parent cells to leave the axis unconstrained.
    rowField1?: string;
    rowValue1?: string;
    rowField2?: string;
    rowValue2?: string;
    columnField?: string;
    columnValue?: string;
    columnPeriodStart?: string;
    columnPeriodEnd?: string;
  }
): Promise<{
  data: PurchaseLinePivotRow[] | null;
  error: PostgrestError | null;
}> {
  const result = await client.rpc("purchaseLinePivotLines", {
    p_company_id: args.companyId,
    p_start: args.startDate,
    p_end: args.endDate,
    ...(args.rowField1 ? { p_row_field_1: args.rowField1 } : {}),
    ...(args.rowValue1 ? { p_row_value_1: args.rowValue1 } : {}),
    ...(args.rowField2 ? { p_row_field_2: args.rowField2 } : {}),
    ...(args.rowValue2 ? { p_row_value_2: args.rowValue2 } : {}),
    ...(args.columnField ? { p_column_field: args.columnField } : {}),
    ...(args.columnValue ? { p_column_value: args.columnValue } : {}),
    ...(args.columnPeriodStart
      ? { p_column_period_start: args.columnPeriodStart }
      : {}),
    ...(args.columnPeriodEnd
      ? { p_column_period_end: args.columnPeriodEnd }
      : {})
  });

  if (result.error) return { data: null, error: result.error };

  // Re-sort authoritatively in TS — never trust RPC ordering.
  const lines = [...(result.data ?? [])].sort((a, b) => {
    if (a.postingDate !== b.postingDate) {
      return a.postingDate < b.postingDate ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { data: lines, error: null };
}

/**
 * Batch-resolves dimension value ids to display names, grouped by the owning
 * dimension's entityType. Entity-backed types resolve through the shared
 * entityType → source-table mapping (getEntityValuesByIds — the same helper
 * getJournalLineDimensions uses); Custom resolves from dimensionValue.
 * Lookup failures degrade to missing entries (callers fall back to the id).
 */
async function resolveDimensionValueNames(
  client: SupabaseClient<Database>,
  requests: { entityType: string; valueIds: string[] }[]
): Promise<Record<string, string>> {
  const batches = await Promise.all(
    requests.map(async ({ entityType, valueIds }) => {
      if (valueIds.length === 0) return [];
      if (entityType === "Custom") {
        const res = await client
          .from("dimensionValue")
          .select("id, name")
          .in("id", valueIds);
        return res.data ?? [];
      }
      const res = await getEntityValuesByIds(client, entityType, valueIds);
      return res.data ?? [];
    })
  );

  const valueNames: Record<string, string> = {};
  for (const batch of batches) {
    for (const item of batch as { id: string; name: string }[]) {
      valueNames[item.id] = item.name;
    }
  }
  return valueNames;
}

// Named, shareable saved pivot views for the analytics reports. RLS handles
// visibility (Company rows are readable by every employee; Private rows only
// by their creator; writes stay owner-only).
export async function getReportViews(
  client: SupabaseClient<Database>,
  args: { companyId: string; reportKey?: string }
) {
  let query = client
    .from("reportView")
    .select("*")
    .eq("companyId", args.companyId);

  if (args.reportKey) {
    query = query.eq("reportKey", args.reportKey);
  }

  return query.order("name", { ascending: true });
}

export async function upsertReportView(
  client: SupabaseClient<Database>,
  view:
    | {
        reportKey: string;
        name: string;
        visibility: Database["public"]["Enums"]["reportViewVisibility"];
        config: Json;
        companyId: string;
        createdBy: string;
      }
    | {
        id: string;
        reportKey: string;
        name: string;
        visibility: Database["public"]["Enums"]["reportViewVisibility"];
        config: Json;
        companyId: string;
        updatedBy: string;
      }
) {
  if ("id" in view) {
    const { id, companyId, ...update } = view;
    return client
      .from("reportView")
      .update({ ...update, updatedAt: datetime.timestamp() })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("*")
      .single();
  }
  return client.from("reportView").insert([view]).select("*").single();
}

export async function deleteReportView(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("reportView")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function getCompaniesInGroup(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("company")
    .select(
      "id, name, baseCurrencyCode, timezone, parentCompanyId, isEliminationEntity"
    )
    .eq("companyGroupId", companyGroupId)
    .eq("active", true)
    .eq("isEliminationEntity", false)
    .order("name", { ascending: true });
}

export async function deleteAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").delete().eq("id", accountId);
}

export async function deletePaymentTerm(
  client: SupabaseClient<Database>,
  paymentTermId: string
) {
  return client
    .from("paymentTerm")
    .update({ active: false })
    .eq("id", paymentTermId);
}

export async function getAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").select("*").eq("id", accountId).single();
}

export async function getAccounts(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("account")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getAccountsList(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args?: {
    isGroup?: boolean | null;
    incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"] | null;
    classes?: Database["public"]["Enums"]["glAccountClass"][];
  }
) {
  let query = client
    .from("account")
    .select("id, number, name, incomeBalance, class")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args?.isGroup !== undefined && args.isGroup !== null) {
    query = query.eq("isGroup", args.isGroup);
  }

  if (args?.incomeBalance) {
    query = query.eq("incomeBalance", args.incomeBalance);
  }

  if (args?.classes && args.classes.length > 0) {
    query = query.in("class", args.classes);
  }

  query = query.order("number", { ascending: true });
  return query;
}

export async function getGroupAccounts(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("account")
    .select("id, number, name, incomeBalance, class, accountType")
    .eq("companyGroupId", companyGroupId)
    .eq("isGroup", true)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getBaseCurrency(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const { data: company, error } = await client
    .from("company")
    .select("baseCurrencyCode, companyGroupId")
    .eq("id", companyId)
    .single();

  if (error) {
    throw new Error(`Failed to get company: ${error.message}`);
  }

  if (!company || !company.baseCurrencyCode) {
    throw new Error("Company or base currency code not found");
  }

  return client
    .from("currency")
    .select("*")
    .eq("code", company.baseCurrencyCode)
    .eq("companyGroupId", company.companyGroupId!)
    .single();
}

export async function getChartOfAccounts(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: {
    incomeBalance: "Income Statement" | "Balance Sheet" | null;
    startDate: string | null;
    endDate: string | null;
  }
) {
  let accountsQuery = client
    .from("accounts")
    .select("*")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true)
    .order("number", { ascending: true });

  if (args.incomeBalance) {
    accountsQuery = accountsQuery.eq("incomeBalance", args.incomeBalance);
  }

  const balancesQuery = client.rpc("accountTreeBalances", {
    p_company_group_id: companyGroupId,
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });

  const [accountsResponse, balancesResponse] = await Promise.all([
    accountsQuery,
    balancesQuery
  ]);

  if (accountsResponse.error) return accountsResponse;
  if (balancesResponse.error) return balancesResponse;

  const balancesByAccountId = (
    balancesResponse.data as unknown as (Transaction & { accountId: string })[]
  ).reduce<Record<string, Transaction>>((acc, row) => {
    acc[row.accountId] = {
      number: row.number,
      netChange: row.netChange,
      balance: row.balance,
      balanceAtDate: row.balanceAtDate
    };
    return acc;
  }, {});

  return {
    data: applyRootSignCorrection(
      (accountsResponse.data ?? [])
        .filter((a): a is typeof a & { id: string } => a.id !== null)
        .map((account) => ({
          ...account,
          netChange: balancesByAccountId[account.id]?.netChange ?? 0,
          balance: balancesByAccountId[account.id]?.balance ?? 0,
          balanceAtDate: balancesByAccountId[account.id]?.balanceAtDate ?? 0
        }))
    ),
    error: null
  };
}

export async function getCurrency(
  client: SupabaseClient<Database>,
  currencyId: string
) {
  return client
    .from("currency")
    .select("*, currencyCode!inner(name)")
    .eq("id", currencyId)
    .single();
}

/**
 * Settlement decimals for the company's base currency. Fixed-asset and GL
 * amounts are booked in base currency, so this is the scale their rounding must
 * use. Falls back to 2 only when the currency row is unreachable.
 */
export async function getBaseCurrencyDecimalPlaces(
  client: SupabaseClient<Database>,
  companyId: string,
  companyGroupId: string
): Promise<number> {
  const company = await client
    .from("company")
    .select("baseCurrencyCode")
    .eq("id", companyId)
    .single();

  if (company.error || !company.data?.baseCurrencyCode) return 2;

  const currency = await client
    .from("currencies")
    .select("decimalPlaces")
    .eq("code", company.data.baseCurrencyCode)
    .eq("companyGroupId", companyGroupId)
    .single();

  return currency.data?.decimalPlaces ?? 2;
}

export async function getCurrencyByCode(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  currencyCode: string
) {
  return client
    .from("currencies")
    .select("*")
    .eq("code", currencyCode)
    .eq("companyGroupId", companyGroupId)
    .single();
}

/**
 * The one sanctioned answer to "how many units of `currencyCode` per 1 unit of
 * THIS company's base currency, right now". Base currency resolves to 1 by
 * definition; a user override wins next; otherwise the ratio of the two
 * USD-anchored market rates. A missing rate is an ERROR — never 1.
 */
export async function getExchangeRate(
  client: SupabaseClient<Database>,
  companyId: string,
  currencyCode: string
) {
  return client.rpc("get_exchange_rate", {
    p_company_id: companyId,
    p_currency_code: currencyCode
  });
}

/**
 * Every active currency of the company's group, resolved for THIS company,
 * with provenance: 'base' | 'override' | 'market' | 'missing'. Backs the
 * exchange-rates settings page.
 */
export async function getExchangeRates(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.rpc("get_exchange_rates", {
    p_company_id: companyId
  });
}

/** Not published: `accounting_overrideExchangeRate` pins a rate, and refuses the base currency this accepts. */
export async function upsertExchangeRateOverride(
  client: SupabaseClient<Database>,
  override: {
    companyId: string;
    currencyCode: string;
    rate: number;
    createdBy: string;
    updatedBy: string;
  }
) {
  // Update-first so re-pinning a rate never rewrites the original creator.
  const update = await client
    .from("exchangeRateOverride")
    .update({
      rate: override.rate,
      updatedBy: override.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", override.companyId)
    .eq("currencyCode", override.currencyCode)
    .select("id");

  if (update.error) return { data: null, error: update.error };
  if (update.data.length > 0) {
    return { data: update.data[0] ?? null, error: null };
  }

  const insert = await client
    .from("exchangeRateOverride")
    .insert({
      companyId: override.companyId,
      currencyCode: override.currencyCode,
      rate: override.rate,
      createdBy: override.createdBy
    })
    .select("id")
    .single();

  // Two concurrent first-time pins can both miss the update and race the
  // insert; the loser hits the (companyId, currencyCode) unique constraint.
  // Retry as an update so the second write wins instead of erroring.
  if (isUniqueViolation(insert.error)) {
    const retry = await client
      .from("exchangeRateOverride")
      .update({
        rate: override.rate,
        updatedBy: override.updatedBy,
        updatedAt: datetime.timestamp()
      })
      .eq("companyId", override.companyId)
      .eq("currencyCode", override.currencyCode)
      .select("id");
    if (retry.error) return { data: null, error: retry.error };
    return { data: retry.data[0] ?? null, error: null };
  }

  return insert;
}

/** Not published: `accounting_resetExchangeRate` runs it. */
export async function deleteExchangeRateOverride(
  client: SupabaseClient<Database>,
  companyId: string,
  currencyCode: string
) {
  return client
    .from("exchangeRateOverride")
    .delete()
    .eq("companyId", companyId)
    .eq("currencyCode", currencyCode);
}

export async function getCurrencies(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("currencies")
    .select("*", {
      count: "exact"
    })
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  return query;
}

/**
 * The full ISO currency list for pickers, carrying the company group's
 * configured `decimalPlaces` where the currency has been set up. Callers that
 * format or round money need the settlement scale alongside the code — the DB
 * column is authoritative over Intl/CLDR, so it has to travel with the option.
 * `decimalPlaces` is null for an ISO currency the group has not configured.
 */
export async function getCurrenciesList(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  const [codes, configured] = await Promise.all([
    client.from("currencyCode").select("code, name").order("name", {
      ascending: true
    }),
    client
      .from("currencies")
      .select("code, decimalPlaces")
      .eq("companyGroupId", companyGroupId)
  ]);

  if (codes.error) return codes;

  const decimalsByCode = new Map(
    (configured.data ?? []).map((c) => [c.code, c.decimalPlaces])
  );

  return {
    ...codes,
    data: codes.data.map((c) => ({
      ...c,
      decimalPlaces: decimalsByCode.get(c.code) ?? null
    }))
  };
}

export async function getCurrentAccountingPeriod(
  client: SupabaseClient<Database>,
  companyId: string,
  date: string
) {
  return client
    .from("accountingPeriod")
    .select("*")
    .eq("companyId", companyId)
    .lte("startDate", date)
    .gte("endDate", date)
    .single();
}

// PeriodPostingSource lives in @carbon/utils alongside the fiscal-year helpers.
// New close-lifecycle columns on accountingPeriod are cloud-generated and not
// yet in the committed DB types, so read them through this cast shape.
type AccountingPeriodCloseColumns = {
  closeStatus?: (typeof periodCloseStatuses)[number];
  fiscalYear?: number | null;
  periodNumber?: number | null;
};

/**
 * Only a posting in the company's current month changes the Active period: a
 * catch-up run or a back-dated document resolves its own period and leaves the
 * Active one alone.
 */
export async function getOrCreateAccountingPeriod(
  client: SupabaseClient<Database>,
  companyId: string,
  date: string,
  source: PeriodPostingSource = "operational"
): Promise<{ data: string | null; error: { message: string } | null }> {
  const existing = await getCurrentAccountingPeriod(client, companyId, date);
  // Read lazily: an Active or refused period never needs the company's today.
  const isCurrentMonth = async () => {
    const today = datetime.today(await getCompanyTimeZone(client, companyId));
    return (
      startOfMonth(parseDate(date.slice(0, 10))).toString() ===
      startOfMonth(today).toString()
    );
  };

  if (existing.data) {
    const closeStatus =
      (existing.data as unknown as AccountingPeriodCloseColumns).closeStatus ??
      (existing.data.closedAt ? "Closed" : "Open");

    if (closeStatus === "Closed") {
      return {
        data: null,
        error: {
          message: "Accounting period is closed. Reopen it before posting."
        }
      };
    }

    if (closeStatus === "Locked" && source === "operational") {
      return {
        data: null,
        error: {
          message:
            "Accounting period is locked. Post as an accounting adjustment or unlock the period first."
        }
      };
    }

    if (existing.data.status === "Inactive" && (await isCurrentMonth())) {
      await client
        .from("accountingPeriod")
        .update({ status: "Inactive" as const })
        .eq("companyId", companyId)
        .eq("status", "Active");

      await client
        .from("accountingPeriod")
        .update({ status: "Active" as const })
        .eq("id", existing.data.id);
    }
    return { data: existing.data.id, error: null };
  }

  // Create a new period for the month of the given date. Pure calendar math on
  // the date string — a JS Date round-trip shifts the month near midnight on
  // non-UTC processes.
  const d = parseDate(date.slice(0, 10));
  const startDate = startOfMonth(d).toString();
  const endDate = endOfMonth(d).toString();

  const settings = await getFiscalYearSettings(client, companyId);
  const startMonth = settings.data?.startMonth
    ? (MONTH_NUMBER[settings.data.startMonth] ?? 1)
    : 1;
  const { fiscalYear, periodNumber } = fiscalYearAndPeriodFor(
    d.year,
    d.month,
    startMonth
  );

  const isCurrent = await isCurrentMonth();
  if (isCurrent) {
    await client
      .from("accountingPeriod")
      .update({ status: "Inactive" as const })
      .eq("companyId", companyId)
      .eq("status", "Active");
  }

  const result = await (client.from("accountingPeriod") as any)
    .insert({
      startDate,
      endDate,
      companyId,
      status: isCurrent ? ("Active" as const) : ("Inactive" as const),
      closeStatus: "Open",
      fiscalYear,
      periodNumber,
      createdBy: "system"
    })
    .select("id")
    .single();

  if (result.error) {
    return {
      data: null,
      error: { message: "Failed to create accounting period" }
    };
  }

  return { data: result.data.id, error: null };
}

type AccountingPeriodRow = {
  id: string;
  startDate: string;
  endDate: string;
  status: "Active" | "Inactive";
  closeStatus: (typeof periodCloseStatuses)[number];
  fiscalYear: number | null;
  periodNumber: number | null;
  lockedAt: string | null;
  lockedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
};

export async function getAccountingPeriods(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return (client.from("accountingPeriod") as any)
    .select(
      "id, startDate, endDate, status, closeStatus, fiscalYear, periodNumber, lockedAt, lockedBy, closedAt, closedBy",
      { count: "exact" }
    )
    .eq("companyId", companyId)
    .order("startDate", { ascending: false }) as Promise<{
    data: AccountingPeriodRow[] | null;
    count: number | null;
    error: { message: string } | null;
  }>;
}

async function getAccountingPeriodById(
  client: SupabaseClient<Database>,
  periodId: string,
  companyId: string
) {
  const result = await (client.from("accountingPeriod") as any)
    .select("id, startDate, endDate, closeStatus, fiscalYear, periodNumber")
    .eq("id", periodId)
    .eq("companyId", companyId)
    .single();
  return result as {
    data: Pick<
      AccountingPeriodRow,
      | "id"
      | "startDate"
      | "endDate"
      | "closeStatus"
      | "fiscalYear"
      | "periodNumber"
    > | null;
    error: { message: string } | null;
  };
}

// Deletability check (industry rule: delete only empty, open periods). A journal
// referencing the period (journal.accountingPeriodId, FK ON DELETE RESTRICT)
// means it has postings; Locked/Closed periods are structurally frozen.
// periodCloseTask rows cascade on delete, so they never block.
export async function getAccountingPeriodDeletability(
  client: SupabaseClient<Database>,
  periodId: string,
  companyId: string
) {
  const period = await getAccountingPeriodById(client, periodId, companyId);
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }

  const journals = await (client.from("journal") as any)
    .select("id", { count: "exact", head: true })
    .eq("companyId", companyId)
    .eq("accountingPeriodId", periodId);
  if (journals.error) return { data: null, error: journals.error };

  const journalCount = (journals.count as number | null) ?? 0;
  const closeStatus = period.data.closeStatus;
  const reason =
    closeStatus !== "Open"
      ? `Only open periods can be deleted — this period is ${closeStatus}.`
      : journalCount > 0
        ? `This period has ${journalCount} journal ${
            journalCount === 1 ? "entry" : "entries"
          } posted to it and cannot be deleted.`
        : null;

  return {
    data: {
      canDelete: reason === null,
      reason,
      closeStatus,
      journalCount,
      startDate: period.data.startDate
    },
    error: null
  };
}

export async function deleteAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string }
) {
  // Re-check server-side — never trust the client's disabled button.
  const check = await getAccountingPeriodDeletability(
    client,
    args.periodId,
    args.companyId
  );
  if (check.error || !check.data) {
    return {
      data: null,
      error: check.error ?? { message: "Period not found" }
    };
  }
  if (!check.data.canDelete) {
    return {
      data: null,
      error: { message: check.data.reason ?? "Period cannot be deleted" }
    };
  }

  return (client.from("accountingPeriod") as any)
    .delete()
    .eq("companyId", args.companyId)
    .eq("id", args.periodId);
}

// The fiscal-year START month is fixed once the calendar is "committed" — any
// Locked/Closed period, or any posting. Re-labeling committed periods would
// retroactively rewrite already-reported fiscal years (and needs a short-year
// bridge, not an edit), so the setting locks. Open, empty periods stay freely
// changeable via delete + regenerate.
export async function getFiscalCalendarCommitted(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const [nonOpen, journals] = await Promise.all([
    (client.from("accountingPeriod") as any)
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .neq("closeStatus", "Open"),
    // A Provisional journal (before the accounting cutover) has no period
    // and must not commit the calendar the cutover will be set up on.
    (client.from("journal") as any)
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .in("status", [...GL_JOURNAL_STATUSES])
  ]);
  if (nonOpen.error) return { data: null, error: nonOpen.error };
  if (journals.error) return { data: null, error: journals.error };

  return {
    data: {
      committed: (nonOpen.count ?? 0) > 0 || (journals.count ?? 0) > 0
    },
    error: null
  };
}

/** Not published: `accounting_lockPeriod` runs it. */
export async function lockAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const cutover = await requireAccountingCutover(client, args.companyId);
  if (cutover.error) return { data: null, error: cutover.error };
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }
  if (period.data.closeStatus !== "Open") {
    return {
      data: null,
      error: { message: "Only open periods can be locked" }
    };
  }
  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Locked",
      lockedAt: new Date().toISOString(),
      lockedBy: args.userId,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/** Not published: `accounting_unlockPeriod` runs it. */
export async function unlockAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }
  if (period.data.closeStatus !== "Locked") {
    return {
      data: null,
      error: { message: "Only locked periods can be unlocked" }
    };
  }
  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Open",
      lockedAt: null,
      lockedBy: null,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function closeAccountingPeriod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    periodId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
  },
  previewRuns: PeriodRunPreviewer = runPreviewer(client, db, args)
) {
  const cutover = await requireAccountingCutover(client, args.companyId);
  if (cutover.error) return { data: null, error: cutover.error };
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }
  if (period.data.closeStatus === "Closed") {
    return { data: null, error: { message: "Period is already closed" } };
  }

  // Enforce the Open -> Locked -> Closed lifecycle: a period must be Locked
  // before it can close. The "Lock the period" checklist step drives the flip;
  // this gate makes locking a hard precondition regardless of that task's state.
  if (period.data.closeStatus !== "Locked") {
    return {
      data: null,
      error: { message: "Period must be locked before closing." }
    };
  }

  // Sequential close: every earlier period must already be Closed.
  const earlierOpen = await (client.from("accountingPeriod") as any)
    .select("id", { count: "exact", head: true })
    .eq("companyId", args.companyId)
    .lt("startDate", period.data.startDate)
    .neq("closeStatus", "Closed");
  if ((earlierOpen.count ?? 0) > 0) {
    return {
      data: null,
      error: {
        message: "Earlier periods must be closed first (sequential close)"
      }
    };
  }

  // Checklist gate: every required task must be Done/Skipped and no Blocker
  // auto-check may be failing (acceptance criteria 7/10). Instantiation is
  // idempotent, so this both materializes and evaluates the checklist.
  const checklist = await loadPeriodCloseChecklist(
    client,
    args.companyId,
    args.periodId,
    previewRuns
  );
  if (checklist.error || !checklist.data) {
    return {
      data: null,
      error: checklist.error ?? { message: "Failed to load close checklist" }
    };
  }
  if (!checklist.data.canClose) {
    return {
      data: null,
      error: {
        message:
          checklist.data.blockingReason ?? "Close checklist is not complete"
      }
    };
  }

  // Persist the final Auto-task states and flip the period atomically. The
  // checklist state and the period status must move together — a partial write
  // would leave the checklist inconsistent with the period. supabase-js has no
  // multi-statement transaction, so the writes go through the Kysely client;
  // the DB close trigger remains the backstop for the invariant.
  const now = new Date().toISOString();
  // periodCloseTask and accountingPeriod.closeStatus are added by the
  // period-close-lifecycle migration; the generated Kysely types don't include
  // them yet, so the write builder is cast until types are regenerated (this
  // mirrors the `as any` casts the read path already uses).
  try {
    await db.transaction().execute(async (trx) => {
      const tx = trx as any;
      for (const state of checklist.data.autoTaskStates) {
        await tx
          .updateTable("periodCloseTask")
          .set({
            status: state.status,
            completedAt: state.status === "Done" ? now : null,
            updatedBy: args.userId,
            updatedAt: now
          })
          .where("id", "=", state.id)
          .where("companyId", "=", args.companyId)
          .execute();
      }

      await tx
        .updateTable("accountingPeriod")
        .set({
          closeStatus: "Closed",
          closedAt: now,
          closedBy: args.userId,
          updatedBy: args.userId,
          updatedAt: now
        })
        .where("id", "=", args.periodId)
        .where("companyId", "=", args.companyId)
        .execute();

      // Write the per-account cumulative GL balance snapshot for this period
      // *inside* the close transaction, after the flip to Closed. The snapshot
      // is what makes accountTreeBalancesByCompany read "latest snapshot +
      // lines after it" instead of scanning all history. It runs here (not as
      // a supabase RPC) so it stays private to the service-role/Kysely path —
      // the function is SECURITY DEFINER and takes companyId as an argument, so
      // exposing it via PostgREST would be a cross-tenant write. The function
      // asserts the period is Closed (true within this tx's view), so it can
      // never snapshot a still-postable period.
      //
      // Race safety: the flip above holds the accountingPeriod row lock until
      // commit, and check_accounting_period_open reads that row FOR SHARE on
      // every posting (migration 20260713235930), so no journal can land in the
      // period between this snapshot and the commit. Keeping the snapshot in the
      // same transaction is deliberate: close ⇔ snapshot is atomic, so a snapshot
      // failure rolls the whole close back cleanly rather than leaving a Closed
      // period with a stale/absent snapshot. Any period without a snapshot is
      // still correct — the read path falls back to the full-history scan.
      await sql`SELECT "snapshotAccountingPeriodBalances"(${args.companyId}, ${args.periodId}, ${args.userId})`.execute(
        trx
      );
    });
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Failed to close period"
      }
    };
  }

  return { data: { id: args.periodId }, error: null };
}

// Public entry point for the close-checklist UI. `closeAccountingPeriod`
// already reloads the checklist, refuses the close when a Blocker auto-check is
// failing or a required task is still Open (surfacing `blockingReason`), and
// flushes the derived final Auto-task states before flipping the period — so a
// checklist-aware close is exactly that call with the argument shape the route
// action passes. Kept as a distinct named export so the route imports intent,
// not the lower-level lifecycle primitive.
/** Not published: `accounting_closePeriod` runs it. */
export async function closePeriodWithChecklist(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    periodId: string;
    userId: string;
  }
) {
  return closeAccountingPeriod(client, db, {
    periodId: args.periodId,
    companyId: args.companyId,
    companyGroupId: args.companyGroupId,
    userId: args.userId
  });
}

export async function reopenAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }
  if (period.data.closeStatus !== "Closed") {
    return { data: null, error: { message: "Period is not closed" } };
  }

  // Reverse-sequential reopen: no later period may still be Closed.
  const laterClosed = await (client.from("accountingPeriod") as any)
    .select("id", { count: "exact", head: true })
    .eq("companyId", args.companyId)
    .gt("startDate", period.data.startDate)
    .eq("closeStatus", "Closed");
  if ((laterClosed.count ?? 0) > 0) {
    return {
      data: null,
      error: {
        message:
          "Later periods must be reopened first (reopen from the most recent close backwards)"
      }
    };
  }

  // Invariant #3 (accountingPeriodBalance migration): snapshots are cumulative
  // through their period's endDate, so reopening this period invalidates its own
  // snapshot and any later one that embeds it. Delete them BEFORE flipping to
  // Open: if the delete fails we abort with the period still Closed (snapshots
  // intact, consistent); if the flip later fails, the period stays Closed with
  // no snapshots, so reads fall back to the full scan (correct, just slower)
  // rather than trusting a stale snapshot once postings resume in the period.
  // accountingPeriodBalance is not in the cloud-generated DB types yet, so the
  // client is cast to reach it (same reason the period reads above use `as any`).
  const deletedSnapshots = await (client as any)
    .from("accountingPeriodBalance")
    .delete()
    .eq("companyId", args.companyId)
    .gte("endingBalanceDate", period.data.endDate);
  if (deletedSnapshots.error) {
    return { data: null, error: deletedSnapshots.error };
  }

  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Open",
      closedAt: null,
      closedBy: null,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function createFiscalYearPeriods(
  client: SupabaseClient<Database>,
  args: { companyId: string; fiscalYear: number; userId: string }
) {
  const settings = await getFiscalYearSettings(client, args.companyId);
  const startMonth = settings.data?.startMonth
    ? (MONTH_NUMBER[settings.data.startMonth] ?? 1)
    : 1;

  // FY is named by its ending calendar year; a non-January start begins in the
  // prior calendar year.
  const firstYear = startMonth === 1 ? args.fiscalYear : args.fiscalYear - 1;

  const existing = await (client.from("accountingPeriod") as any)
    .select("periodNumber")
    .eq("companyId", args.companyId)
    .eq("fiscalYear", args.fiscalYear);
  if (existing.error) return existing;
  const existingNumbers = new Set(
    ((existing.data ?? []) as { periodNumber: number | null }[]).map(
      (p) => p.periodNumber
    )
  );

  const rows = [];
  for (let p = 1; p <= 12; p++) {
    if (existingNumbers.has(p)) continue;
    const monthIndex = (startMonth - 1 + (p - 1)) % 12; // 0-indexed
    const year = firstYear + Math.floor((startMonth - 1 + (p - 1)) / 12);
    const startDate = new Date(Date.UTC(year, monthIndex, 1));
    const endDate = new Date(Date.UTC(year, monthIndex + 1, 0));
    rows.push({
      companyId: args.companyId,
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      status: "Inactive",
      closeStatus: "Open",
      fiscalYear: args.fiscalYear,
      periodNumber: p,
      createdBy: args.userId
    });
  }

  if (rows.length === 0) {
    return { data: [], error: null };
  }

  return (client.from("accountingPeriod") as any).insert(rows).select("id");
}

// A single readiness evaluator, keyed by the autoCheckKey that binds it to an
// Auto checklist task. Every seeded autoCheckKey has an evaluator here; a key
// with no matching evaluator fails closed in evaluateCloseChecklist (the task
// stays Open and blocks the close) rather than silently passing, so a new Auto
// task without its evaluator gates the close instead of quietly resolving Done.
export type PeriodReadinessCheck = {
  autoCheckKey: string;
  severity: (typeof periodCloseTaskSeverities)[number];
  label: string;
  failing: boolean;
  count: number;
  documents?: PeriodCloseUnpostedDocument[];
  /** Run checks only: the base-currency total behind `count`. */
  amount?: number;
  /** Run checks only: what a new run for the period would hold now. */
  due?: RunPreview;
  /** Run checks only: the Draft runs the check is waiting on. */
  draftRuns?: { id: string; readableId: string; periodEnd: string }[];
};

// An operational document (receipt, shipment, invoice) that has not posted to
// the general ledger, surfaced on the close checklist so the user can jump to
// it. `count` on the check stays exact even when the fetched rows are capped.
export type PeriodCloseUnpostedDocument = {
  documentType:
    | "Receipt"
    | "Shipment"
    | "Sales Invoice"
    | "Purchase Invoice"
    | "Payment"
    | "Credit Memo"
    | "Debit Memo"
    | "Journal Entry";
  id: string;
  readableId: string;
  status: string;
};

const UNPOSTED_DOCUMENT_LIMIT = 25;

/**
 * companyIntegration ids that can carry accounting posting sync.
 *
 * This duplicates `getIntegrationIdsByRole("accounting")` from `@carbon/ee`, and
 * deliberately so: `*.service.ts` files are re-exported through the module
 * barrel that client components import, so they are BROWSER-BUNDLED. The
 * `@carbon/ee` barrel reaches `@carbon/auth`, which validates the full server
 * env at import time — importing it here fails the build with "server-only
 * module referenced by client". (This module also already avoids
 * `@carbon/ee/accounting` for the TS2589 reason noted further down.)
 *
 * The clean fix is to have the caller pass the ids in, the way this module
 * already takes `syncFromDate` from its caller — but the only caller is
 * `getPeriodReadiness` in this same file, so that change cascades and is left
 * for the topology work. Until then, a provider added to the registry must be
 * added here too.
 */
const ACCOUNTING_SYNC_INTEGRATION_IDS = ["xero", "quickbooks", "rillet"];

/** Terminal sync dispositions — the journal is accounted for externally. */
const TERMINAL_SYNC_OPERATION_STATUSES = new Set([
  "Completed",
  "Excluded",
  "Skipped"
]);

/**
 * The "External GL sync complete" close auto-check (autoCheckKey
 * "external-gl-sync"): every journal posted into the period must carry a
 * terminal disposition (Completed / Excluded / Skipped) in the
 * accountingSyncOperation ledger for EVERY active accounting integration.
 * Posting sync is ALWAYS-ON when an integration is connected, so the check
 * gates on integration presence alone — it auto-passes (failing false,
 * count 0) only when NO active accounting integration exists. A reversal
 * journal (reversalOfId set) is delivered through the ORIGINAL journal's
 * "<id>:reversal" operation — the reversal row never gets its own ledger
 * entry (see getJournalSyncCompleteness).
 */
export async function getPeriodExternalGlSyncReadiness(
  client: SupabaseClient<Database>,
  companyId: string,
  startDate: string,
  endDate: string
): Promise<{ failing: boolean; count: number; postingSyncEnabled: boolean }> {
  const integrations = await client
    .from("companyIntegration")
    .select("id, metadata")
    .eq("companyId", companyId)
    .eq("active", true)
    .in("id", ACCOUNTING_SYNC_INTEGRATION_IDS);

  // An integration with sync turned off (still being set up) delivers nothing,
  // so it is treated like a disconnected one. Mirrors `isAccountingSyncEnabled`
  // in @carbon/ee/accounting, which this module cannot import (see above):
  // absent means on, only an explicit false is off.
  const enabledIntegrationIds = (integrations.data ?? [])
    .filter(
      (integration) =>
        (
          integration.metadata as {
            settings?: { syncEnabled?: unknown };
          } | null
        )?.settings?.syncEnabled !== false
    )
    .map((integration) => integration.id);

  if (enabledIntegrationIds.length === 0) {
    return { failing: false, count: 0, postingSyncEnabled: false };
  }

  const journals = await fetchAllFromTable<{
    id: string;
    reversalOfId: string | null;
  }>(client, "journal", "id, reversalOfId", (query: any) =>
    query
      .eq("companyId", companyId)
      .in("status", ["Posted", "Reversed"])
      .gte("postingDate", startDate)
      .lte("postingDate", endDate)
      .order("id", { ascending: true })
  );

  const journalRows = journals.data ?? [];
  if (journalRows.length === 0) {
    return { failing: false, count: 0, postingSyncEnabled: true };
  }

  // Distinct journals missing a terminal disposition for at least one
  // enabled integration. Bounded loop: at most three integrations.
  const undelivered = new Set<string>();
  for (const integrationId of enabledIntegrationIds) {
    const operations = await fetchAllFromTable<{
      entityId: string;
      status: string;
    }>(client, "accountingSyncOperation", "entityId, status", (query: any) =>
      query
        .eq("companyId", companyId)
        .eq("integration", integrationId)
        .eq("entityType", "journalEntry")
        .order("createdAt", { ascending: false })
    );
    if (operations.error) {
      // Can't verify — fail closed: a Blocker check must not silently pass
      // because its evidence query failed.
      for (const journal of journalRows) {
        undelivered.add(journal.id);
      }
      continue;
    }

    // Newest-first order means first-seen wins as the latest status.
    const latestStatusByEntityId = new Map<string, string>();
    for (const operation of operations.data ?? []) {
      if (!latestStatusByEntityId.has(operation.entityId)) {
        latestStatusByEntityId.set(operation.entityId, operation.status);
      }
    }

    for (const journal of journalRows) {
      const entityId = journal.reversalOfId
        ? `${journal.reversalOfId}:reversal`
        : journal.id;
      const status = latestStatusByEntityId.get(entityId);
      if (!status || !TERMINAL_SYNC_OPERATION_STATUSES.has(status)) {
        undelivered.add(journal.id);
      }
    }
  }

  return {
    failing: undelivered.size > 0,
    count: undelivered.size,
    postingSyncEnabled: true
  };
}

/** What a new run for the period would hold now, or why it is unknown. */
export type RunPreview = {
  count: number;
  amount: number;
  error: string | null;
};

/**
 * What a revenue recognition run and a depreciation run for `periodEnd`
 * would hold if created now. The close checklist reads this instead of
 * copying the runs' rules.
 */
export type PeriodRunPreview = {
  revenue: RunPreview;
  lease: RunPreview;
  depreciation: RunPreview;
};

export type PeriodRunPreviewer = (
  periodEnd: string
) => Promise<PeriodRunPreview>;

function previewError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

/**
 * Asks both run engines what a new run for `periodEnd` would hold, without
 * creating one. Revenue: the `preview-revenue-recognition-run` server
 * function (the proposal's synthesizers and due rows, rolled back).
 * Depreciation: `buildDepreciationRunLines`, empty when a later period is
 * already posted (per-month posting put those months in their periods).
 * Never throws: a failure is returned as the preview's `error`.
 */
export async function getPeriodRunPreview(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    periodEnd: string;
  }
): Promise<PeriodRunPreview> {
  const { companyId, companyGroupId, userId, periodEnd } = args;
  const previewRun = (type: RunType, fallback: string): Promise<RunPreview> =>
    invokePosting(
      { db, companyId, userId },
      "preview-revenue-recognition-run",
      { periodEnd, type },
      previewRevenueRecognitionRun
    )
      .then(
        (result): RunPreview =>
          result.error
            ? {
                count: 0,
                amount: 0,
                error: previewError(result.error, fallback)
              }
            : { ...result.data, error: null }
      )
      .catch(
        (error): RunPreview => ({
          count: 0,
          amount: 0,
          error: previewError(error, fallback)
        })
      );
  const [revenue, lease, depreciation] = await Promise.all([
    previewRun("Revenue Recognition", "Failed to preview revenue recognition"),
    previewRun("Lease", "Failed to preview the lease run"),
    buildDepreciationRunLines(client, { companyId, companyGroupId, periodEnd })
      .then((result): RunPreview => {
        if (!result.data) {
          return {
            count: 0,
            amount: 0,
            error: previewError(
              result.error,
              "Failed to calculate depreciation"
            )
          };
        }
        if (result.data.laterPostedRunId) {
          return { count: 0, amount: 0, error: null };
        }
        const { lines } = result.data;
        return {
          count: new Set(lines.map((line) => line.fixedAssetId)).size,
          amount: round(lines.reduce((sum, line) => sum + line.amount, 0)),
          error: null
        };
      })
      .catch(
        (error): RunPreview => ({
          count: 0,
          amount: 0,
          error: previewError(error, "Failed to calculate depreciation")
        })
      )
  ]);
  return { revenue, lease, depreciation };
}

/** The previewer the close checklist uses outside tests. */
function runPreviewer(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; companyGroupId: string; userId: string }
): PeriodRunPreviewer {
  return (periodEnd) => getPeriodRunPreview(client, db, { ...args, periodEnd });
}

/**
 * Evaluates every Auto close check for the period. `runPreview` is what new
 * revenue recognition and depreciation runs for `endDate` would hold
 * (`getPeriodRunPreview`).
 */
export async function computePeriodReadiness(
  client: SupabaseClient<Database>,
  companyId: string,
  startDate: string,
  endDate: string,
  runPreview: PeriodRunPreview
): Promise<{
  checks: PeriodReadinessCheck[];
  blockers: { key: string; label: string; count: number }[];
  warnings: { key: string; label: string; count: number }[];
}> {
  // Un-posted operational documents have no postingDate until the post-*
  // functions stamp them with the posting day's date. So a Draft/Pending
  // document with no postingDate can only land in this period if the period is
  // still running (or in the future) when it posts — closing an already-ended
  // period is not blocked by new drafts, which would post into a later period.
  const todayDate = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const unpostedDateFilter =
    endDate >= todayDate
      ? `postingDate.is.null,and(postingDate.gte.${startDate},postingDate.lte.${endDate})`
      : `and(postingDate.gte.${startDate},postingDate.lte.${endDate})`;

  const [
    draftJournals,
    journalsInPeriod,
    draftDepreciationRuns,
    unmatchedIC,
    pendingReceipts,
    pendingShipments,
    pendingSalesInvoices,
    pendingPurchaseInvoices,
    pendingPayments,
    pendingMemos,
    externalGlSync
  ] = await Promise.all([
    client
      .from("journal")
      .select("id, journalEntryId, status", { count: "exact" })
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .gte("postingDate", startDate)
      .lte("postingDate", endDate)
      .order("journalEntryId", { ascending: true })
      .limit(UNPOSTED_DOCUMENT_LIMIT),
    client
      .from("journalEntries")
      .select("id, journalEntryId, totalDebits, totalCredits")
      .eq("companyId", companyId)
      .eq("status", "Posted")
      .gte("postingDate", startDate)
      .lte("postingDate", endDate),
    // Draft depreciation runs ending in the period: they hold depreciation
    // that is not posted yet, so the preview does not count it again.
    client
      .from("depreciationRun")
      .select("id, depreciationRunId, periodEnd, depreciationRunLine(amount)")
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .gte("periodEnd", startDate)
      .lte("periodEnd", endDate)
      .order("depreciationRunId"),
    client
      .from("intercompanyTransaction")
      .select("id", { count: "exact", head: true })
      .eq("status", "Unmatched")
      .or(`sourceCompanyId.eq.${companyId},targetCompanyId.eq.${companyId}`),
    // Un-posted operational documents that threaten this period. Draft/Pending
    // are the pre-posting states for receipts, shipments and invoices; Posted
    // (or Open/Submitted for invoices) and Voided are terminal. Rows are fetched
    // (not just counted) so the checklist can list them; counts stay exact even
    // when rows are capped.
    client
      .from("receipt")
      .select("id, receiptId, status", { count: "exact" })
      .eq("companyId", companyId)
      .in("status", ["Draft", "Pending"])
      .or(unpostedDateFilter)
      .order("receiptId", { ascending: true })
      .limit(UNPOSTED_DOCUMENT_LIMIT),
    client
      .from("shipment")
      .select("id, shipmentId, status", { count: "exact" })
      .eq("companyId", companyId)
      .in("status", ["Draft", "Pending"])
      .or(unpostedDateFilter)
      .order("shipmentId", { ascending: true })
      .limit(UNPOSTED_DOCUMENT_LIMIT),
    client
      .from("salesInvoice")
      .select("id, invoiceId, status", { count: "exact" })
      .eq("companyId", companyId)
      .in("status", ["Draft", "Pending"])
      .or(unpostedDateFilter)
      .order("invoiceId", { ascending: true })
      .limit(UNPOSTED_DOCUMENT_LIMIT),
    client
      .from("purchaseInvoice")
      .select("id, invoiceId, status", { count: "exact" })
      .eq("companyId", companyId)
      .in("status", ["Draft", "Pending"])
      .or(unpostedDateFilter)
      .order("invoiceId", { ascending: true })
      .limit(UNPOSTED_DOCUMENT_LIMIT),
    // Payments and credit/debit memos are payment-shaped operational documents
    // with the same Draft -> Posted -> Voided lifecycle; post-payment/post-memo
    // stamp postingDate the same way the other post-* functions do.
    client
      .from("payment")
      .select("id, paymentId, status", { count: "exact" })
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .or(unpostedDateFilter)
      .order("paymentId", { ascending: true })
      .limit(UNPOSTED_DOCUMENT_LIMIT),
    client
      .from("memo")
      .select("id, memoId, status, direction", { count: "exact" })
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .or(unpostedDateFilter)
      .order("memoId", { ascending: true })
      .limit(UNPOSTED_DOCUMENT_LIMIT),
    getPeriodExternalGlSyncReadiness(client, companyId, startDate, endDate)
  ]);

  // Planned rows due on or before the period end that a Draft run holds.
  // The preview counts only the rows no run holds. Not bounded below: an
  // overdue row from an earlier period is still unrecognized revenue.
  const heldRunRows = await fetchAllFromTable<{
    amount: number;
    run: {
      id: string;
      runId: string;
      periodEnd: string;
      type: RunType;
    };
  }>(
    client,
    "revenueRecognitionRunLine",
    "amount, run:revenueRecognitionRun!revenueRecognitionRunLine_run_fkey!inner(id, runId, periodEnd, status, type), schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey!inner(scheduledDate, status)",
    (query: any) =>
      query
        .eq("companyId", companyId)
        .eq("run.status", "Draft")
        .eq("schedule.status", "Planned")
        .lte("schedule.scheduledDate", endDate)
        .order("id")
  );

  // Each run type: what a new run would claim, plus what its Draft runs hold.
  const heldByType = (type: RunType) => {
    const draftRuns = new Map<
      string,
      { id: string; readableId: string; periodEnd: string }
    >();
    let amount = 0;
    let count = 0;
    for (const line of heldRunRows.data ?? []) {
      if (line.run.type !== type) continue;
      draftRuns.set(line.run.id, {
        id: line.run.id,
        readableId: line.run.runId,
        periodEnd: line.run.periodEnd
      });
      amount += Number(line.amount);
      count += 1;
    }
    // A failed read fails both checks closed.
    return { draftRuns, amount, count: heldRunRows.error ? 1 : count };
  };
  const heldRevenue = heldByType("Revenue Recognition");
  const revenueDraftRuns = heldRevenue.draftRuns;
  const heldRevenueAmount = heldRevenue.amount;
  const revenueCount = runPreview.revenue.count + heldRevenue.count;
  const heldLease = heldByType("Lease");
  const leaseCount = runPreview.lease.count + heldLease.count;

  // Depreciation: the assets a new run would depreciate, plus Draft runs.
  const depreciationDraftRuns = draftDepreciationRuns.data ?? [];
  const draftDepreciationAmount = depreciationDraftRuns.reduce(
    (sum, run) =>
      sum +
      run.depreciationRunLine.reduce(
        (lineSum, line) => lineSum + Number(line.amount),
        0
      ),
    0
  );
  const depreciationCount =
    runPreview.depreciation.count +
    (draftDepreciationRuns.error ? 1 : depreciationDraftRuns.length);

  const unbalanced = (journalsInPeriod.data ?? []).filter(
    (j) =>
      !isBalanced(
        Number(j.totalDebits ?? 0),
        Number(j.totalCredits ?? 0),
        JOURNAL_BALANCE_TOLERANCE
      )
  );

  const pendingPostings =
    (pendingReceipts.count ?? 0) +
    (pendingShipments.count ?? 0) +
    (pendingSalesInvoices.count ?? 0) +
    (pendingPurchaseInvoices.count ?? 0) +
    (pendingPayments.count ?? 0) +
    (pendingMemos.count ?? 0);

  const unpostedDocuments: PeriodCloseUnpostedDocument[] = [
    ...(pendingReceipts.data ?? []).map((d) => ({
      documentType: "Receipt" as const,
      id: d.id,
      readableId: d.receiptId,
      status: d.status as string
    })),
    ...(pendingShipments.data ?? []).map((d) => ({
      documentType: "Shipment" as const,
      id: d.id,
      readableId: d.shipmentId,
      status: d.status as string
    })),
    ...(pendingSalesInvoices.data ?? []).map((d) => ({
      documentType: "Sales Invoice" as const,
      id: d.id,
      readableId: d.invoiceId,
      status: d.status as string
    })),
    ...(pendingPurchaseInvoices.data ?? []).map((d) => ({
      documentType: "Purchase Invoice" as const,
      id: d.id,
      readableId: d.invoiceId,
      status: d.status as string
    })),
    ...(pendingPayments.data ?? []).map((d) => ({
      documentType: "Payment" as const,
      id: d.id,
      readableId: d.paymentId,
      status: d.status as string
    })),
    ...(pendingMemos.data ?? []).map((d) => ({
      documentType:
        d.direction === "Debit"
          ? ("Debit Memo" as const)
          : ("Credit Memo" as const),
      id: d.id,
      readableId: d.memoId,
      status: d.status as string
    }))
  ];

  const draftJournalDocuments: PeriodCloseUnpostedDocument[] = (
    draftJournals.data ?? []
  ).map((d) => ({
    documentType: "Journal Entry" as const,
    id: d.id,
    readableId: d.journalEntryId,
    status: d.status as string
  }));

  const checks: PeriodReadinessCheck[] = [
    {
      autoCheckKey: "pending-postings",
      severity: "Blocker",
      label: "Un-posted operational documents that would post into this period",
      failing: pendingPostings > 0,
      count: pendingPostings,
      documents: unpostedDocuments
    },
    {
      autoCheckKey: "draft-journals",
      severity: "Blocker",
      label: "Draft journal entries dated in this period",
      failing: (draftJournals.count ?? 0) > 0,
      count: draftJournals.count ?? 0,
      documents: draftJournalDocuments
    },
    {
      autoCheckKey: "tb-balanced",
      severity: "Blocker",
      label: "Posted journal entries with unequal debits and credits",
      failing: unbalanced.length > 0,
      count: unbalanced.length
    },
    // Auto-pass only when NO accounting integration is connected:
    // getPeriodExternalGlSyncReadiness returns failing false / count 0 with
    // no active integration (posting sync is always-on when one exists).
    // This evaluator MUST exist for the seeded "External GL sync complete"
    // task (autoCheckKey "external-gl-sync") — an Auto task with no
    // registered evaluator fails closed in evaluateCloseChecklist and would
    // block every close.
    {
      autoCheckKey: "external-gl-sync",
      severity: "Blocker",
      label:
        "Posted journal entries not yet delivered to the external accounting system",
      failing: externalGlSync.failing,
      count: externalGlSync.count
    },
    {
      autoCheckKey: "draft-depreciation",
      severity: "Warning",
      label:
        "Assets a depreciation run would depreciate for this period, and Draft depreciation runs ending in it",
      failing: depreciationCount > 0 || runPreview.depreciation.error !== null,
      count: depreciationCount,
      amount: round(runPreview.depreciation.amount + draftDepreciationAmount),
      due: runPreview.depreciation,
      draftRuns: depreciationDraftRuns.map((run) => ({
        id: run.id,
        readableId: run.depreciationRunId,
        periodEnd: run.periodEnd
      }))
    },
    {
      autoCheckKey: "unposted-revenue-schedules",
      severity: "Warning",
      label:
        "Revenue a recognition run would recognize by this period end, and revenue Draft runs hold",
      failing: revenueCount > 0 || runPreview.revenue.error !== null,
      count: revenueCount,
      amount: round(runPreview.revenue.amount + heldRevenueAmount),
      due: runPreview.revenue,
      draftRuns: [...revenueDraftRuns.values()]
    },
    {
      autoCheckKey: "unposted-lease-schedules",
      severity: "Warning",
      label:
        "Lease and rental entries a lease run would post by this period end, and lease Draft runs hold",
      failing: leaseCount > 0 || runPreview.lease.error !== null,
      count: leaseCount,
      amount: round(runPreview.lease.amount + heldLease.amount),
      due: runPreview.lease,
      draftRuns: [...heldLease.draftRuns.values()]
    },
    {
      autoCheckKey: "unmatched-ic",
      severity: "Warning",
      label: "Unmatched intercompany transactions involving this company",
      failing: (unmatchedIC.count ?? 0) > 0,
      count: unmatchedIC.count ?? 0
    }
  ];

  const blockers = checks
    .filter((c) => c.severity === "Blocker" && c.failing)
    .map((c) => ({ key: c.autoCheckKey, label: c.label, count: c.count }));
  const warnings = checks
    .filter((c) => c.severity === "Warning" && c.failing)
    .map((c) => ({ key: c.autoCheckKey, label: c.label, count: c.count }));

  return { checks, blockers, warnings };
}

export async function getPeriodCloseReadiness(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    periodId: string;
  }
) {
  const { companyId, periodId } = args;
  const period = await getAccountingPeriodById(client, periodId, companyId);
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }
  const { checks, blockers, warnings } = await computePeriodReadiness(
    client,
    companyId,
    period.data.startDate,
    period.data.endDate,
    await getPeriodRunPreview(client, db, {
      ...args,
      periodEnd: period.data.endDate
    })
  );
  return { data: { checks, blockers, warnings }, error: null };
}

// ---------------------------------------------------------------------------
// NetSuite-style close checklist: company-level task definitions template +
// per-period task instances, gating the period close.
// ---------------------------------------------------------------------------

const PERIOD_CLOSE_TASK_COLUMNS =
  "id, companyId, accountingPeriodId, definitionId, name, taskType, autoCheckKey, sortOrder, required, severity, status, assigneeId, completedBy, completedAt, skippedReason, notes";

const PERIOD_CLOSE_DEFINITION_COLUMNS =
  "id, companyId, name, taskType, autoCheckKey, sortOrder, required, severity, active, isSystem, defaultAssigneeId";

export type PeriodCloseTaskRow = {
  id: string;
  companyId: string;
  accountingPeriodId: string;
  definitionId: string | null;
  name: string;
  taskType: (typeof periodCloseTaskTypes)[number];
  autoCheckKey: string | null;
  sortOrder: number;
  required: boolean;
  severity: (typeof periodCloseTaskSeverities)[number] | null;
  status: (typeof periodCloseTaskStatuses)[number];
  assigneeId: string | null;
  completedBy: string | null;
  completedAt: string | null;
  skippedReason: string | null;
  notes: string | null;
};

export type PeriodCloseTaskDefinitionRow = {
  id: string;
  companyId: string;
  name: string;
  taskType: (typeof periodCloseTaskTypes)[number];
  autoCheckKey: string | null;
  sortOrder: number;
  required: boolean;
  severity: (typeof periodCloseTaskSeverities)[number] | null;
  active: boolean;
  isSystem: boolean;
  defaultAssigneeId: string | null;
};

export type PeriodCloseTaskView = PeriodCloseTaskRow & {
  autoCheck: PeriodReadinessCheck | null;
  effectiveStatus: (typeof periodCloseTaskStatuses)[number];
};

// Pure: which active definitions still need a task row for this period. Drives
// idempotent instantiation — re-running with the instances already present
// returns nothing to create (acceptance criterion 6).
export function checklistTasksToCreate<T extends { id: string }>(
  definitions: T[],
  existingTasks: { definitionId: string | null }[]
): T[] {
  const existing = new Set(
    existingTasks
      .map((t) => t.definitionId)
      .filter((d): d is string => Boolean(d))
  );
  return definitions.filter((d) => !existing.has(d.id));
}

// Pure: overlay live readiness onto tasks and decide whether the period can
// close. An Auto task is Done when its evaluator passes (or has none), Open
// when it fails; a manual Skip is preserved. Close is allowed only when every
// required task resolves to Done/Skipped and no Blocker auto-check is failing.
export function evaluateCloseChecklist(
  tasks: PeriodCloseTaskRow[],
  checks: PeriodReadinessCheck[],
  closeStatus: (typeof periodCloseStatuses)[number]
): {
  tasks: PeriodCloseTaskView[];
  canClose: boolean;
  blockingReason: string | null;
  autoTaskStates: {
    id: string;
    status: (typeof periodCloseTaskStatuses)[number];
  }[];
} {
  const checkByKey = new Map(checks.map((c) => [c.autoCheckKey, c]));

  const views: PeriodCloseTaskView[] = tasks.map((task) => {
    if (task.taskType === "Auto" && task.autoCheckKey) {
      // An Auto task whose autoCheckKey has no registered evaluator cannot be
      // verified, so it fails closed instead of silently passing: synthesize a
      // failing check (inheriting the task's declared severity, defaulting to
      // Blocker) so the close is gated and the reason is visible rather than a
      // quiet Done. Every seeded key has an evaluator; this guards future
      // custom Auto tasks added without one.
      const autoCheck: PeriodReadinessCheck = checkByKey.get(
        task.autoCheckKey
      ) ?? {
        autoCheckKey: task.autoCheckKey,
        severity: task.severity ?? "Blocker",
        label: `No automated check is implemented for "${task.autoCheckKey}"`,
        failing: true,
        count: 0
      };
      const effectiveStatus =
        task.status === "Skipped"
          ? "Skipped"
          : autoCheck.failing
            ? "Open"
            : "Done";
      return { ...task, autoCheck, effectiveStatus };
    }
    if (task.taskType === "Action" && task.name === LOCK_PERIOD_TASK_NAME) {
      const effectiveStatus =
        closeStatus === "Locked" || closeStatus === "Closed" ? "Done" : "Open";
      return { ...task, autoCheck: null, effectiveStatus };
    }
    return { ...task, autoCheck: null, effectiveStatus: task.status };
  });

  const failingBlocker = views.find(
    (v) =>
      v.autoCheck?.severity === "Blocker" &&
      v.autoCheck.failing &&
      v.effectiveStatus !== "Skipped"
  );
  const incomplete = views.find(
    (v) => v.required && v.effectiveStatus === "Open"
  );

  const canClose = !failingBlocker && !incomplete;
  const blockingReason = failingBlocker
    ? `"${failingBlocker.name}" has unresolved blocking issues`
    : incomplete
      ? `Task "${incomplete.name}" is not complete`
      : null;

  // Auto tasks whose derived state differs from what is persisted get flushed
  // to the DB at close time (acceptance criterion 10).
  const autoTaskStates = views
    .filter((v) => v.taskType === "Auto" && v.status !== v.effectiveStatus)
    .map((v) => ({ id: v.id, status: v.effectiveStatus }));

  return { tasks: views, canClose, blockingReason, autoTaskStates };
}

/**
 * Idempotently instantiate the checklist for a period from active definitions,
 * then overlay live readiness. Returns the evaluated tasks plus the close gate.
 *
 */
export async function getPeriodCloseChecklist(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    periodId: string;
  }
) {
  return loadPeriodCloseChecklist(
    client,
    args.companyId,
    args.periodId,
    runPreviewer(client, db, args)
  );
}

/** `getPeriodCloseChecklist` with the run previewer passed in. */
export async function loadPeriodCloseChecklist(
  client: SupabaseClient<Database>,
  companyId: string,
  periodId: string,
  previewRuns: PeriodRunPreviewer
) {
  const period = await getAccountingPeriodById(client, periodId, companyId);
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }

  const [defsRes, tasksRes] = await Promise.all([
    (client as any)
      .from("periodCloseTaskDefinition")
      .select(PERIOD_CLOSE_DEFINITION_COLUMNS)
      .eq("companyId", companyId)
      .eq("active", true)
      .order("sortOrder", { ascending: true }),
    (client as any)
      .from("periodCloseTask")
      .select(PERIOD_CLOSE_TASK_COLUMNS)
      .eq("companyId", companyId)
      .eq("accountingPeriodId", periodId)
  ]);
  if (defsRes.error) return { data: null, error: defsRes.error };
  if (tasksRes.error) return { data: null, error: tasksRes.error };

  const definitions = (defsRes.data ?? []) as PeriodCloseTaskDefinitionRow[];
  let tasks = (tasksRes.data ?? []) as PeriodCloseTaskRow[];

  const toCreate = checklistTasksToCreate(definitions, tasks);
  if (toCreate.length > 0) {
    const rows = toCreate.map((d) => ({
      companyId,
      accountingPeriodId: periodId,
      definitionId: d.id,
      name: d.name,
      taskType: d.taskType,
      autoCheckKey: d.autoCheckKey,
      sortOrder: d.sortOrder,
      required: d.required,
      severity: d.severity,
      status: "Open",
      assigneeId: d.defaultAssigneeId ?? null,
      createdBy: "system"
    }));
    // The unique (companyId, accountingPeriodId, definitionId) key makes a
    // concurrent instantiation a no-op rather than a duplicate-row error.
    const inserted = await (client as any)
      .from("periodCloseTask")
      .upsert(rows, {
        onConflict: "companyId, accountingPeriodId, definitionId",
        ignoreDuplicates: true
      })
      .select("id");
    if (inserted.error) return { data: null, error: inserted.error };

    const reload = await (client as any)
      .from("periodCloseTask")
      .select(PERIOD_CLOSE_TASK_COLUMNS)
      .eq("companyId", companyId)
      .eq("accountingPeriodId", periodId);
    if (reload.error) return { data: null, error: reload.error };
    tasks = (reload.data ?? []) as PeriodCloseTaskRow[];
  }

  const readiness = await computePeriodReadiness(
    client,
    companyId,
    period.data.startDate,
    period.data.endDate,
    await previewRuns(period.data.endDate)
  );

  const evaluated = evaluateCloseChecklist(
    tasks,
    readiness.checks,
    period.data.closeStatus
  );
  evaluated.tasks.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    data: {
      ...evaluated,
      readiness: { blockers: readiness.blockers, warnings: readiness.warnings }
    },
    error: null
  };
}

async function getPeriodCloseTaskById(
  client: SupabaseClient<Database>,
  taskId: string,
  companyId: string
) {
  return (client as any)
    .from("periodCloseTask")
    .select("id, taskType, severity, status, required, name")
    .eq("id", taskId)
    .eq("companyId", companyId)
    .single() as Promise<{
    data: Pick<
      PeriodCloseTaskRow,
      "id" | "taskType" | "severity" | "status" | "required" | "name"
    > | null;
    error: { message: string } | null;
  }>;
}

/** Not published: `accounting_closeTaskComplete` runs it. */
export async function completeCloseTask(
  client: SupabaseClient<Database>,
  args: { taskId: string; companyId: string; userId: string; notes?: string }
) {
  const task = await getPeriodCloseTaskById(
    client,
    args.taskId,
    args.companyId
  );
  if (task.error || !task.data) {
    return { data: null, error: task.error ?? { message: "Task not found" } };
  }
  // Auto tasks reflect a live evaluator and are completed by the close, not by
  // hand.
  if (task.data.taskType === "Auto") {
    return {
      data: null,
      error: {
        message:
          "Automated tasks are evaluated by the system and cannot be completed manually"
      }
    };
  }
  return (client as any)
    .from("periodCloseTask")
    .update({
      status: "Done",
      completedBy: args.userId,
      completedAt: new Date().toISOString(),
      notes: args.notes ?? null,
      skippedReason: null,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.taskId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/** Not published: `accounting_closeTaskSkip` runs it. */
export async function skipCloseTask(
  client: SupabaseClient<Database>,
  args: {
    taskId: string;
    companyId: string;
    userId: string;
    skippedReason: string;
  }
) {
  const reason = args.skippedReason?.trim();
  if (!reason) {
    return {
      data: null,
      error: { message: "A reason is required to skip a task" }
    };
  }
  const task = await getPeriodCloseTaskById(
    client,
    args.taskId,
    args.companyId
  );
  if (task.error || !task.data) {
    return { data: null, error: task.error ?? { message: "Task not found" } };
  }
  // Blocker tasks guard hard invariants — they can never be skipped, only
  // resolved (acceptance criterion 9).
  if (task.data.severity === "Blocker") {
    return {
      data: null,
      error: {
        message:
          "Blocker tasks cannot be skipped; resolve the underlying issue first"
      }
    };
  }
  return (client as any)
    .from("periodCloseTask")
    .update({
      status: "Skipped",
      skippedReason: reason,
      completedBy: args.userId,
      completedAt: new Date().toISOString(),
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.taskId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function addCloseTask(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    periodId: string;
    name: string;
    taskType: (typeof periodCloseTaskTypes)[number];
    required: boolean;
    userId: string;
    assigneeId?: string;
  }
) {
  const existing = await (client as any)
    .from("periodCloseTask")
    .select("sortOrder")
    .eq("companyId", args.companyId)
    .eq("accountingPeriodId", args.periodId)
    .order("sortOrder", { ascending: false })
    .limit(1);
  const maxSort =
    ((existing.data?.[0]?.sortOrder as number | undefined) ?? 0) + 1;

  return (client as any)
    .from("periodCloseTask")
    .insert({
      companyId: args.companyId,
      accountingPeriodId: args.periodId,
      definitionId: null,
      name: args.name,
      taskType: args.taskType,
      autoCheckKey: null,
      sortOrder: maxSort,
      required: args.required,
      severity: null,
      status: "Open",
      assigneeId: args.assigneeId ?? null,
      createdBy: args.userId
    })
    .select("id")
    .single();
}

export async function getPeriodCloseTaskDefinitions(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return (client as any)
    .from("periodCloseTaskDefinition")
    .select(PERIOD_CLOSE_DEFINITION_COLUMNS)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true }) as Promise<{
    data: PeriodCloseTaskDefinitionRow[] | null;
    error: { message: string } | null;
  }>;
}

export async function upsertPeriodCloseTaskDefinition(
  client: SupabaseClient<Database>,
  definition:
    | (z.infer<typeof periodCloseTaskDefinitionValidator> & {
        companyId: string;
        createdBy: string;
      })
    | (z.infer<typeof periodCloseTaskDefinitionValidator> & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("updatedBy" in definition) {
    const { id, companyId, updatedBy, ...rest } = definition;
    return (client as any)
      .from("periodCloseTaskDefinition")
      .update({
        ...sanitize(rest),
        updatedBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }
  const { createdBy, ...rest } = definition;
  delete (rest as { id?: string }).id; // let the DB default generate the id
  return (client as any)
    .from("periodCloseTaskDefinition")
    .insert({ ...rest, isSystem: false, createdBy })
    .select("id")
    .single();
}

export async function deletePeriodCloseTaskDefinition(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string }
) {
  const def = await (client as any)
    .from("periodCloseTaskDefinition")
    .select("isSystem")
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .single();
  if (def.error || !def.data) {
    return {
      data: null,
      error: def.error ?? { message: "Task definition not found" }
    };
  }
  // System definitions seed the default close steps — deactivate, never delete.
  if (def.data.isSystem) {
    return {
      data: null,
      error: {
        message:
          "System task definitions cannot be deleted. Deactivate it instead."
      }
    };
  }
  return (client as any)
    .from("periodCloseTaskDefinition")
    .delete()
    .eq("id", args.id)
    .eq("companyId", args.companyId);
}

export async function getDefaultAccounts(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("accountDefault")
    .select("*")
    .eq("companyId", companyId)
    .single();
}

/**
 * The GL account ids scrap postings offset to, for the scrap analytics
 * report's account scope (accountScope.source === "scrapAccounts"). Empty
 * when no scrap account is configured — getDimensionPivot short-circuits to
 * an empty pivot in that case.
 */
export async function getScrapAccountIds(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ data: string[]; error: PostgrestError | null }> {
  const result = await client
    .from("accountDefault")
    .select("scrapAccount")
    .eq("companyId", companyId)
    .maybeSingle();

  if (result.error) return { data: [], error: result.error };

  return {
    data: result.data?.scrapAccount ? [result.data.scrapAccount] : [],
    error: null
  };
}

export async function getFiscalYearSettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fiscalYearSettings")
    .select("*")
    .eq("companyId", companyId)
    .single();
}

export async function getPaymentTerm(
  client: SupabaseClient<Database>,
  paymentTermId: string
) {
  return client
    .from("paymentTerm")
    .select("*")
    .eq("id", paymentTermId)
    .single();
}

export async function getPaymentTerms(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("paymentTerm")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getPaymentTermsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("paymentTerm")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

/**
 * Save both defaults sections atomically after validating the effective mapping.
 */
export async function updateDefaultAccounts(
  client: SupabaseClient<Database>,
  defaultAccounts: z.infer<typeof defaultAccountValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  const validation = await validateDefaultIncomeAccounts(
    client,
    defaultAccounts
  );
  if (validation.error) return { data: null, error: validation.error };
  return client
    .from("accountDefault")
    .update(defaultAccounts)
    .eq("companyId", defaultAccounts.companyId);
}

/** Validate the effective shipping mapping before either defaults section saves. */
export async function validateDefaultIncomeAccounts(
  client: SupabaseClient<Database>,
  defaultAccounts: z.infer<typeof defaultIncomeAcountValidator> & {
    companyId: string;
  }
) {
  const [company, stored] = await Promise.all([
    client
      .from("company")
      .select("companyGroupId")
      .eq("id", defaultAccounts.companyId)
      .single(),
    getDefaultAccounts(client, defaultAccounts.companyId)
  ]);
  if (company.error || stored.error) {
    return { error: company.error ?? stored.error };
  }
  if (!company.data?.companyGroupId || !stored.data) {
    return { error: { message: "Company account defaults not found" } };
  }
  const shippingId =
    defaultAccounts.salesShippingRevenueAccount === undefined
      ? stored.data.salesShippingRevenueAccount
      : defaultAccounts.salesShippingRevenueAccount;
  if (!shippingId || shippingId === defaultAccounts.salesAccount) {
    return {
      error: {
        message: "Select a shipping revenue account distinct from Sales"
      }
    };
  }
  const account = await client
    .from("account")
    .select("id, active, isGroup, class, incomeBalance")
    .eq("id", shippingId)
    .eq("companyGroupId", company.data.companyGroupId)
    .maybeSingle();
  if (account.error) return { error: account.error };
  if (
    !account.data ||
    account.data.active !== true ||
    account.data.isGroup !== false ||
    account.data.class !== "Revenue" ||
    account.data.incomeBalance !== "Income Statement"
  ) {
    return {
      error: {
        message:
          "Shipping revenue must be an active Revenue leaf account in this company group"
      }
    };
  }
  return { error: null };
}

export async function updateFiscalYearSettings(
  client: SupabaseClient<Database>,
  fiscalYearSettings: z.infer<typeof fiscalYearSettingsValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("fiscalYearSettings")
    .update(sanitize(fiscalYearSettings))
    .eq("companyId", fiscalYearSettings.companyId);
}

export async function upsertAccount(
  client: SupabaseClient<Database>,
  account:
    | (Omit<z.infer<typeof accountValidator>, "id"> & {
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof accountValidator>, "id"> & {
        id: string;
        companyGroupId?: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in account) {
    return client.from("account").insert([account]).select("*").single();
  }
  const { companyGroupId: _companyGroupId, ...accountUpdate } = account;
  return client
    .from("account")
    .update(sanitize(accountUpdate))
    .eq("id", account.id)
    .select("id")
    .single();
}

export async function upsertCurrency(
  client: SupabaseClient<Database>,
  currency:
    | (Omit<z.infer<typeof currencyValidator>, "id"> & {
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof currencyValidator>, "id"> & {
        id: string;
        companyGroupId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in currency) {
    return client.from("currency").insert([currency]).select("*").single();
  }
  return client
    .from("currency")
    .update(sanitize(currency))
    .eq("id", currency.id)
    .select("id")
    .single();
}

export async function upsertPaymentTerm(
  client: SupabaseClient<Database>,
  paymentTerm:
    | (Omit<z.infer<typeof paymentTermValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof paymentTermValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in paymentTerm) {
    return client
      .from("paymentTerm")
      .insert([paymentTerm])
      .select("id")
      .single();
  }
  return client
    .from("paymentTerm")
    .update(sanitize(paymentTerm))
    .eq("id", paymentTerm.id)
    .select("id")
    .single();
}

export async function deleteCostCenter(
  client: SupabaseClient<Database>,
  costCenterId: string
) {
  return client.from("costCenter").delete().eq("id", costCenterId);
}

export async function getCostCenter(
  client: SupabaseClient<Database>,
  costCenterId: string
) {
  return client.from("costCenter").select("*").eq("id", costCenterId).single();
}

export async function getCostCenters(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("costCenter")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getCostCentersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("costCenter")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getCostCentersTree(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("costCenter")
    .select(
      "id, name, parentCostCenterId, ownerId, owner:user!costCenter_ownerId_fkey(fullName)"
    )
    .eq("companyId", companyId)
    .order("name");
}

export async function upsertCostCenter(
  client: SupabaseClient<Database>,
  costCenter:
    | (Omit<z.infer<typeof costCenterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof costCenterValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in costCenter) {
    return client.from("costCenter").insert([costCenter]).select("id").single();
  }
  return client
    .from("costCenter")
    .update(sanitize(costCenter))
    .eq("id", costCenter.id)
    .select("id")
    .single();
}

export async function deleteProject(
  client: SupabaseClient<Database>,
  companyId: string,
  projectId: string,
  updatedBy: string
) {
  return client
    .from("project")
    .update({
      active: false,
      updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", projectId)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function getProject(
  client: SupabaseClient<Database>,
  companyId: string,
  projectId: string
) {
  return client
    .from("project")
    .select("*")
    .eq("id", projectId)
    .eq("companyId", companyId)
    .single();
}

export async function getProjects(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("project")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);

  return query;
}

export async function upsertProject(
  client: SupabaseClient<Database>,
  project:
    | (Omit<z.infer<typeof projectValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof projectValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in project) {
    return client
      .from("project")
      .insert([{ ...project, active: true }])
      .select("id")
      .single();
  }

  const { companyId, id, ...update } = project;
  return client
    .from("project")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function getDimensions(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("dimension")
    .select("*, dimensionValue(id, name)", {
      count: LIST_COUNT
    })
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getDimension(
  client: SupabaseClient<Database>,
  dimensionId: string
) {
  return client
    .from("dimension")
    .select("*, dimensionValue(id, name)")
    .eq("id", dimensionId)
    .single();
}

export async function upsertDimension(
  client: SupabaseClient<Database>,
  dimension:
    | (Omit<z.infer<typeof dimensionValidator>, "id" | "dimensionValues"> & {
        companyGroupId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof dimensionValidator>, "id" | "dimensionValues"> & {
        id: string;
        companyGroupId?: string;
        updatedBy: string;
      }),
  dimensionValues?: string[]
) {
  let dimensionResult;

  if ("createdBy" in dimension) {
    dimensionResult = await client
      .from("dimension")
      .insert([dimension])
      .select("id, companyGroupId")
      .single();
  } else {
    const { companyGroupId: _companyGroupId, ...dimensionUpdate } = dimension;
    dimensionResult = await client
      .from("dimension")
      .update(sanitize(dimensionUpdate))
      .eq("id", dimension.id)
      .select("id, companyGroupId")
      .single();
  }

  if (dimensionResult.error) return dimensionResult;

  if (dimension.entityType === "Custom" && dimensionValues !== undefined) {
    const dimensionId = dimensionResult.data.id;
    const companyGroupId = dimensionResult.data.companyGroupId;

    const existing = await client
      .from("dimensionValue")
      .select("id, name")
      .eq("dimensionId", dimensionId);

    if (existing.error) return existing;

    const existingNames = new Set((existing.data ?? []).map((v) => v.name));
    const desiredNames = new Set(dimensionValues);

    const toDelete = (existing.data ?? [])
      .filter((v) => !desiredNames.has(v.name))
      .map((v) => v.id);

    if (toDelete.length > 0) {
      const deleteResult = await client
        .from("dimensionValue")
        .delete()
        .in("id", toDelete);
      if (deleteResult.error) return deleteResult;
    }

    const toInsert = dimensionValues
      .filter((name) => !existingNames.has(name))
      .map((name) => ({
        dimensionId,
        name,
        companyGroupId,
        createdBy:
          "createdBy" in dimension ? dimension.createdBy : dimension.updatedBy
      }));

    if (toInsert.length > 0) {
      const insertResult = await client.from("dimensionValue").insert(toInsert);
      if (insertResult.error) return insertResult;
    }
  }

  return dimensionResult;
}

export async function deleteDimension(
  client: SupabaseClient<Database>,
  dimensionId: string
) {
  return client
    .from("dimension")
    .update({ active: false })
    .eq("id", dimensionId);
}

export async function getActiveDimensionsWithValues(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string
) {
  const dimensionsResult = await client
    .from("dimension")
    .select("id, name, entityType, required")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true)
    .order("name");

  if (dimensionsResult.error) return dimensionsResult;

  const dimensions = dimensionsResult.data ?? [];

  const customDimensionIds = dimensions
    .filter((d) => d.entityType === "Custom")
    .map((d) => d.id);

  const entityTypes = [
    ...new Set(
      dimensions
        .filter((d) => d.entityType !== "Custom")
        .map((d) => d.entityType)
    )
  ];

  const [customValues, ...entityResults] = await Promise.all([
    customDimensionIds.length > 0
      ? client
          .from("dimensionValue")
          .select("id, name, dimensionId")
          .in("dimensionId", customDimensionIds)
      : Promise.resolve({
          data: [] as { id: string; name: string; dimensionId: string }[],
          error: null
        }),
    ...entityTypes.map((et) => getEntityDimensionValues(client, et, companyId))
  ]);

  if (customValues.error) return customValues;

  const entityValuesByType = new Map<string, { id: string; name: string }[]>();
  entityTypes.forEach((et, i) => {
    const result = entityResults[i];
    if (result && !result.error && result.data) {
      entityValuesByType.set(et, result.data as { id: string; name: string }[]);
    }
  });

  const customValuesByDimension = new Map<
    string,
    { id: string; name: string }[]
  >();
  for (const v of customValues.data ?? []) {
    const existing = customValuesByDimension.get(v.dimensionId) ?? [];
    existing.push({ id: v.id, name: v.name });
    customValuesByDimension.set(v.dimensionId, existing);
  }

  return {
    data: dimensions.map((d) => ({
      dimensionId: d.id,
      dimensionName: d.name,
      entityType: d.entityType,
      required: d.required,
      values:
        d.entityType === "Custom"
          ? (customValuesByDimension.get(d.id) ?? [])
          : (entityValuesByType.get(d.entityType) ?? [])
    })),
    error: null
  };
}

function getEntityDimensionValues(
  client: SupabaseClient<Database>,
  entityType: string,
  companyId: string
) {
  switch (entityType) {
    case "Location":
      return client
        .from("location")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "Department":
      return client
        .from("department")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "Employee":
      return client
        .from("employeeSummary")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "CustomerType":
      return client
        .from("customerType")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "SupplierType":
      return client
        .from("supplierType")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "FixedAssetClass":
      return client
        .from("fixedAssetClass")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "ItemPostingGroup":
      return client
        .from("itemPostingGroup")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "CostCenter":
      return client
        .from("costCenter")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "ScrapReason":
      return client
        .from("scrapReason")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name");
    case "Project":
      // Only ACTIVE projects are selectable for new dimension assignments;
      // soft-deleted (active = false) projects stay resolvable for history via
      // getEntityValuesByIds but must not appear as new options.
      return client
        .from("project")
        .select("id, name")
        .eq("companyId", companyId)
        .eq("active", true)
        .order("name");
    // Customer / Supplier / Item are high-cardinality: intentionally NOT
    // eager-loaded here. The DimensionSelector sources their options lazily
    // from the client stores (useCustomers / useSuppliers / useItems).
    case "Customer":
    case "Supplier":
    case "Item":
    default:
      return Promise.resolve({
        data: [] as { id: string; name: string }[],
        error: null
      });
  }
}

export async function getJournalLineDimensions(
  client: SupabaseClient<Database>,
  journalLineIds: string[]
) {
  if (journalLineIds.length === 0) {
    return {
      data: {} as Record<
        string,
        {
          dimensionId: string;
          dimensionName: string;
          valueId: string;
          valueName: string;
        }[]
      >,
      error: null
    };
  }

  const result = await client
    .from("journalLineDimension")
    .select(
      "journalLineId, dimensionId, valueId, dimension:dimensionId(name, entityType)"
    )
    .in("journalLineId", journalLineIds);

  if (result.error) return { data: null, error: result.error };

  const rows = result.data as unknown as Array<{
    journalLineId: string;
    dimensionId: string;
    valueId: string;
    dimension: { name: string; entityType: string };
  }>;

  // Collect all valueIds grouped by entityType for batch resolution
  const valueIdsByType = new Map<string, Set<string>>();
  for (const row of rows) {
    const et = row.dimension.entityType;
    if (!valueIdsByType.has(et)) valueIdsByType.set(et, new Set());
    valueIdsByType.get(et)!.add(row.valueId);
  }

  // Resolve value names in parallel
  const valueNameMap = new Map<string, string>();

  const resolutions = await Promise.all(
    Array.from(valueIdsByType.entries()).map(async ([entityType, valueIds]) => {
      const ids = [...valueIds];
      if (entityType === "Custom") {
        const res = await client
          .from("dimensionValue")
          .select("id, name")
          .in("id", ids);
        return res.data ?? [];
      }
      const res = await getEntityValuesByIds(client, entityType, ids);
      return res.data ?? [];
    })
  );

  for (const batch of resolutions) {
    for (const item of batch as { id: string; name: string }[]) {
      valueNameMap.set(item.id, item.name);
    }
  }

  // Group by journalLineId
  const grouped: Record<
    string,
    {
      dimensionId: string;
      dimensionName: string;
      valueId: string;
      valueName: string;
    }[]
  > = {};
  for (const row of rows) {
    if (!grouped[row.journalLineId]) grouped[row.journalLineId] = [];
    grouped[row.journalLineId].push({
      dimensionId: row.dimensionId,
      dimensionName: row.dimension.name,
      valueId: row.valueId,
      valueName: valueNameMap.get(row.valueId) ?? row.valueId
    });
  }

  return { data: grouped, error: null };
}

function getEntityValuesByIds(
  client: SupabaseClient<Database>,
  entityType: string,
  ids: string[]
) {
  switch (entityType) {
    case "Location":
      return client.from("location").select("id, name").in("id", ids);
    case "Department":
      return client.from("department").select("id, name").in("id", ids);
    case "Employee":
      return client.from("employeeSummary").select("id, name").in("id", ids);
    case "CustomerType":
      return client.from("customerType").select("id, name").in("id", ids);
    case "SupplierType":
      return client.from("supplierType").select("id, name").in("id", ids);
    case "ItemPostingGroup":
      return client.from("itemPostingGroup").select("id, name").in("id", ids);
    case "CostCenter":
      return client.from("costCenter").select("id, name").in("id", ids);
    case "ScrapReason":
      return client.from("scrapReason").select("id, name").in("id", ids);
    case "Project":
      return client.from("project").select("id, name").in("id", ids);
    case "FixedAssetClass":
      return client.from("fixedAssetClass").select("id, name").in("id", ids);
    case "Customer":
      return client.from("customer").select("id, name").in("id", ids);
    case "Supplier":
      return client.from("supplier").select("id, name").in("id", ids);
    case "Item":
      // The human-friendly label for an item is its readableId-with-revision.
      return client
        .from("item")
        .select("id, name:readableIdWithRevision")
        .in("id", ids);
    default:
      return Promise.resolve({
        data: [] as { id: string; name: string }[],
        error: null
      });
  }
}

export async function saveJournalLineDimensions(
  client: SupabaseClient<Database>,
  journalLineId: string,
  companyId: string,
  dimensions: Array<{ dimensionId: string; valueId: string }>
) {
  const deleteResult = await client
    .from("journalLineDimension")
    .delete()
    .eq("journalLineId", journalLineId);

  if (deleteResult.error) return deleteResult;

  if (dimensions.length === 0) return { data: null, error: null };

  return client.from("journalLineDimension").insert(
    dimensions.map((d) => ({
      journalLineId,
      dimensionId: d.dimensionId,
      valueId: d.valueId,
      companyId
    }))
  );
}

export async function translateCompanyBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  targetCurrency: string,
  periodEnd: string,
  periodStart: string | undefined,
  // Rows from getFinancialStatementBalances for the same company/dates —
  // translation only needs balanceAtDate + consolidatedRate, so re-running
  // the full journalLine scan through the translateTrialBalance RPC would
  // double the cost of every translated statement.
  balances: Array<{
    id: string;
    balanceAtDate: number;
    consolidatedRate: string | null;
    isGroup: boolean | null;
    class: string | null;
  }>
): Promise<{
  data: TranslatedBalance[] | null;
  cta: number;
  error: string | null;
}> {
  const { data: ratesData, error: ratesError } = await client.rpc(
    "getConsolidationRates",
    {
      p_company_group_id: companyGroupId,
      p_company_id: companyId,
      p_target_currency: targetCurrency,
      p_period_end: periodEnd,
      p_period_start: periodStart
    }
  );

  if (ratesError) {
    return { data: null, cta: 0, error: ratesError.message };
  }

  const rates = (Array.isArray(ratesData) ? ratesData[0] : ratesData) as
    | {
        sourceCurrency: string | null;
        closingRate: number;
        averageRate: number;
        historicalRate: number;
      }
    | null
    | undefined;

  if (!rates) {
    return {
      data: null,
      cta: 0,
      error: `Missing consolidation rates for company ${companyId}`
    };
  }
  if (
    typeof rates.sourceCurrency !== "string" ||
    !rates.sourceCurrency.trim()
  ) {
    return {
      data: null,
      cta: 0,
      error: `Missing source currency for company ${companyId}`
    };
  }

  const sameCurrency = rates.sourceCurrency === targetCurrency;
  const rateFor = (consolidatedRate: string | null): number => {
    if (sameCurrency) return 1;
    switch (consolidatedRate) {
      case "Average":
        return Number(rates.averageRate);
      case "Historical":
        return Number(rates.historicalRate);
      default:
        // 'Current' (the column default)
        return Number(rates.closingRate);
    }
  };

  const leaves: Array<{
    account: (typeof balances)[number];
    localBalance: number;
    sign: number;
  }> = [];
  let sourceDebitMinusCredit = 0;

  for (const account of balances) {
    // Leaf accounts only, and never the synthetic Net Income line — its
    // income-statement components are already in the rows, so translating it
    // too would double-count net income in the CTA.
    if (account.isGroup || account.id === NET_INCOME_ACCOUNT_ID) continue;

    let sign: number;
    switch (account.class) {
      case "Asset":
      case "Expense":
        sign = 1;
        break;
      case "Liability":
      case "Equity":
      case "Revenue":
        sign = -1;
        break;
      default:
        return {
          data: null,
          cta: 0,
          error: `Invalid account class for account ${account.id}`
        };
    }
    const localBalance = Number(account.balanceAtDate);
    if (!Number.isFinite(localBalance)) {
      return {
        data: null,
        cta: 0,
        error: `Invalid source balance for account ${account.id}`
      };
    }
    sourceDebitMinusCredit += sign * localBalance;
    leaves.push({ account, localBalance, sign });
  }

  if (!isBalanced(sourceDebitMinusCredit, 0, JOURNAL_BALANCE_TOLERANCE)) {
    return {
      data: null,
      cta: 0,
      error: `Source balances for company ${companyId} do not balance (off by ${round(sourceDebitMinusCredit)})`
    };
  }

  const rows: TranslatedBalance[] = [];
  let translatedDebitMinusCredit = 0;
  for (const { account, localBalance, sign } of leaves) {
    const exchangeRate = rateFor(account.consolidatedRate);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return {
        data: null,
        cta: 0,
        error: `Invalid ${account.consolidatedRate ?? "Current"} consolidation rate for account ${account.id}`
      };
    }
    const translatedBalance = round(localBalance * exchangeRate);

    rows.push({
      accountId: account.id,
      localBalance,
      exchangeRate,
      translatedBalance
    });

    translatedDebitMinusCredit += sign * translatedBalance;
  }

  // Natural balances become debit-minus-credit with Asset/Expense positive
  // and Liability/Equity/Revenue negative. The translated residual is the
  // additional Equity balance; report-tree presentation signs do not apply.
  const cta = round(translatedDebitMinusCredit);

  return { data: rows, cta, error: null };
}

// Find elimination entities that should be included automatically in a
// consolidation. An elimination entity is included when its parentCompanyId is
// an ancestor of any selected company (i.e. it sits at or above the selected
// companies in the hierarchy and captures their intercompany eliminations).
// Returns the operating company ids plus those elimination entity ids.
async function resolveConsolidationCompanyIds(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[]
): Promise<string[]> {
  const { data: allGroupCompanies } = await client
    .from("company")
    .select("id, parentCompanyId, isEliminationEntity")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  const groupCompanies = allGroupCompanies ?? [];
  const selectedSet = new Set(companyIds);

  // Collect all ancestors of selected companies
  const ancestors = new Set<string>();
  const companyById = new Map(groupCompanies.map((c) => [c.id, c]));
  for (const id of companyIds) {
    let current = companyById.get(id);
    while (current?.parentCompanyId) {
      ancestors.add(current.parentCompanyId);
      current = companyById.get(current.parentCompanyId);
    }
  }

  // Include elimination entities whose parent is an ancestor of (or is) a
  // selected company — these hold the reversing entries for IC transactions
  const eliminationIds = groupCompanies
    .filter(
      (c) =>
        c.isEliminationEntity &&
        c.parentCompanyId &&
        (ancestors.has(c.parentCompanyId) || selectedSet.has(c.parentCompanyId))
    )
    .map((c) => c.id);

  return [...companyIds, ...eliminationIds];
}

export async function getConsolidatedBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  periodEnd: string,
  periodStart?: string,
  // Privileged (service-role) client used ONLY for elimination entities — see
  // getConsolidatedPeriodSeries. Without it their reversing entries are hidden by
  // RLS and intercompany balances never eliminate. Defaults to `client`.
  eliminationClient: SupabaseClient<Database> = client
) {
  // All companies whose balances we need (operating + elimination entities)
  const allIds = await resolveConsolidationCompanyIds(
    eliminationClient,
    companyGroupId,
    companyIds
  );

  // Fail loudly on a read error (see getConsolidatedPeriodSeries): an empty set
  // silently routes the elimination entity through the RLS client, dropping the
  // reversing entries and over-reporting intercompany balances.
  const { data: elimRows, error: elimError } = await eliminationClient
    .from("company")
    .select("id")
    .eq("companyGroupId", companyGroupId)
    .eq("isEliminationEntity", true);
  if (elimError) {
    throw new Error(
      `Failed to resolve elimination entities for consolidation: ${elimError.message}`
    );
  }
  const elimIds = new Set((elimRows ?? []).map((c) => c.id));

  // Get balances for all companies, then translate the already-computed
  // balances to the target currency (one ledger scan per company, not two).
  const results = await Promise.all(
    allIds.map(async (id) => {
      const readClient = elimIds.has(id) ? eliminationClient : client;
      const balances = await getFinancialStatementBalances(
        readClient,
        companyGroupId,
        id,
        {
          startDate: periodStart ?? null,
          endDate: periodEnd
        }
      );

      const translation =
        balances.error || !balances.data
          ? {
              data: null,
              cta: 0,
              error: balances.error?.message ?? "Failed to load balances"
            }
          : await translateCompanyBalances(
              readClient,
              companyGroupId,
              id,
              targetCurrency,
              periodEnd,
              periodStart,
              balances.data
            );

      return { balances, translation };
    })
  );

  const allBalances = results.map((r) => r.balances);
  const translations = results.map((r) => r.translation);

  // A subsidiary whose translation failed must fail the consolidation loudly —
  // silently excluding it produces a wrong consolidated total with no signal.
  const failedTranslation = translations.find((t) => t.error);
  if (failedTranslation?.error) {
    return { data: null, cta: 0, error: failedTranslation.error };
  }

  // Build a map of translated balances per account, summed across companies
  const translationByAccount = new Map<
    string,
    { translatedBalance: number; exchangeRate: number }
  >();

  for (const translation of translations) {
    if (!translation.data) continue;
    for (const row of translation.data) {
      const existing = translationByAccount.get(row.accountId);
      if (existing) {
        existing.translatedBalance += Number(row.translatedBalance);
      } else {
        translationByAccount.set(row.accountId, {
          translatedBalance: Number(row.translatedBalance),
          exchangeRate: Number(row.exchangeRate)
        });
      }
    }
  }

  // Sum CTA across all companies
  const totalCta = translations.reduce((sum, t) => sum + t.cta, 0);

  // Merge all company balances into one set of accounts, summing balances
  const accountMap = new Map<
    string,
    {
      balance: number;
      balanceAtDate: number;
      netChange: number;
      translatedBalance: number;
      exchangeRate: number;
    }
  >();

  for (const result of allBalances) {
    if (result.error || !result.data) continue;
    for (const account of result.data) {
      const existing = accountMap.get(account.id);
      if (existing) {
        existing.balance += account.balance ?? 0;
        existing.balanceAtDate += account.balanceAtDate ?? 0;
        existing.netChange += account.netChange ?? 0;
      } else {
        accountMap.set(account.id, {
          balance: account.balance ?? 0,
          balanceAtDate: account.balanceAtDate ?? 0,
          netChange: account.netChange ?? 0,
          translatedBalance: 0,
          exchangeRate: 0
        });
      }
    }
  }

  // Overlay translated values
  for (const [accountId, translation] of translationByAccount) {
    const account = accountMap.get(accountId);
    if (account) {
      account.translatedBalance = translation.translatedBalance;
      account.exchangeRate = translation.exchangeRate;
    }
  }

  // Use the first company's account structure as the base (shared chart of accounts)
  const baseAccounts = allBalances.find((r) => r.data)?.data ?? [];

  const consolidated = baseAccounts.map((account) => {
    const summed = accountMap.get(account.id);
    return {
      ...account,
      balance: summed?.balance ?? 0,
      balanceAtDate: summed?.balanceAtDate ?? 0,
      netChange: summed?.netChange ?? 0,
      translatedBalance: summed?.translatedBalance ?? 0,
      exchangeRate: summed?.exchangeRate ?? 0
    };
  });

  return {
    data: applyRootSignCorrection(consolidated),
    cta: totalCta,
    error: null
  };
}

// -- Intercompany --

export async function getIntercompanyTransactions(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & { status: string | null }
) {
  let query = client
    .from("intercompanyTransaction")
    .select(
      "*, sourceCompany:company!intercompanyTransaction_sourceCompanyId_fkey(name), targetCompany:company!intercompanyTransaction_targetCompanyId_fkey(name)",
      { count: LIST_COUNT }
    )
    .eq("companyGroupId", companyGroupId);

  if (args.status) {
    query = query.eq("status", args.status);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function createIntercompanyTransaction(
  client: SupabaseClient<Database>,
  input: z.infer<typeof intercompanyTransactionValidator> & {
    companyGroupId: string;
    userId: string;
  }
) {
  const today = datetime
    .today(await getCompanyTimeZone(client, input.sourceCompanyId))
    .toString();
  const postingDate = input.postingDate || today;

  const nextSequence = await getNextSequence(
    client,
    "journalEntry",
    input.sourceCompanyId
  );
  if (nextSequence.error) return nextSequence;

  // Create the journal entry on the source company
  const journal = await client
    .from("journal")
    .insert({
      journalEntryId: nextSequence.data,
      description: `IC: ${input.description}`,
      companyId: input.sourceCompanyId,
      postingDate
    })
    .select("id")
    .single();

  if (journal.error) return journal;

  const journalId = journal.data.id;
  const journalLineRef = crypto.randomUUID();

  // Insert debit and credit journal lines
  const journalLines = await client
    .from("journalLine")
    .insert([
      {
        journalId,
        accountId: input.debitAccountId,
        description: input.description,
        amount: input.amount,
        journalLineReference: journalLineRef,
        intercompanyPartnerId: input.targetCompanyId,
        companyId: input.sourceCompanyId
      },
      {
        journalId,
        accountId: input.creditAccountId,
        description: input.description,
        amount: -input.amount,
        journalLineReference: journalLineRef,
        intercompanyPartnerId: input.targetCompanyId,
        companyId: input.sourceCompanyId
      }
    ])
    .select("id");

  if (journalLines.error) return journalLines;

  // Create intercompany transaction record
  const intercompanyTransaction = await client
    .from("intercompanyTransaction")
    .insert({
      companyGroupId: input.companyGroupId,
      sourceCompanyId: input.sourceCompanyId,
      targetCompanyId: input.targetCompanyId,
      sourceJournalLineId: journalLines.data[0].id,
      amount: input.amount,
      currencyCode: input.currencyCode,
      description: input.description,
      status: "Unmatched"
    })
    .select("id")
    .single();

  if (intercompanyTransaction.error) return intercompanyTransaction;

  // Capture the control line so generateEliminationEntries reverses it by
  // reference like an invoice-posted trade. The manual entry posts a single
  // balanced Dr/Cr on the source company; its debit line is the control account.
  await client.from("intercompanyEliminationLine").insert({
    companyId: input.sourceCompanyId,
    intercompanyTransactionId: intercompanyTransaction.data.id,
    role: "Control",
    journalLineId: journalLines.data[0].id,
    accountId: input.debitAccountId,
    amount: input.amount,
    createdBy: input.userId
  });

  return intercompanyTransaction;
}

export async function getIntercompanyEliminationLines(
  client: SupabaseClient<Database>,
  transactionIds: string[]
) {
  if (transactionIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("intercompanyEliminationLine")
    .select("*")
    .in("intercompanyTransactionId", transactionIds);
}

export async function runIntercompanyMatching(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  const cutover = await requireGroupAccountingCutover(client, companyGroupId);
  if (cutover.error) return { data: null, error: cutover.error };
  return client.rpc("matchIntercompanyTransactions", {
    p_company_group_id: companyGroupId
  });
}

export async function generateEliminations(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  userId: string,
  regenerate = false
) {
  const cutover = await requireGroupAccountingCutover(client, companyGroupId);
  if (cutover.error) return { data: null, error: cutover.error };
  return client.rpc("generateEliminationEntries", {
    p_company_group_id: companyGroupId,
    p_user_id: userId,
    p_regenerate: regenerate
  });
}

export async function getIntercompanyBalance(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client.rpc("getIntercompanyBalance", {
    p_company_group_id: companyGroupId
  });
}

/**
 * Market-rate history for the chart on the exchange-rates page. Reads the
 * platform-global "exchangeRate" store (USD-anchored), newest ~6 months of
 * daily rows, ascending for the chart.
 */
export async function getExchangeRateHistory(
  client: SupabaseClient<Database>,
  currencyCode: string
) {
  const result = await client
    .from("exchangeRate")
    .select("effectiveDate, rate")
    .eq("currencyCode", currencyCode)
    .order("effectiveDate", { ascending: false })
    .limit(180);

  return {
    data: result.data ? [...result.data].reverse() : result.data,
    error: result.error
  };
}

// -- Journal Entries --
// Uses existing journal/journalLine tables with added status/entryType columns.
// Manual JEs start as Draft and are posted by flipping status to Posted.
// amount > 0 = debit, amount < 0 = credit.

export async function getJournalEntries(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null; status: string | null }
) {
  let query = client
    .from("journalEntries")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `journalEntryId.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as Database["public"]["Enums"]["journalEntryStatus"]
    );
  }

  // A Superseded journal is a Provisional one the opening journal replaced at
  // the cutover. It stays out of the list unless a status filter asks for it.
  const filtersOnStatus =
    Boolean(args.status) ||
    (args.filters ?? []).some(
      (filter) => filter.column === "status" && Boolean(filter.value)
    );
  if (!filtersOnStatus) {
    query = query.neq("status", "Superseded");
  }

  // The enable writes many journals in one transaction, so they share a
  // createdAt; the entry number breaks the tie.
  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false },
    { column: "journalEntryId", ascending: false }
  ]);

  return query;
}

export async function getJournalEntry(
  client: SupabaseClient<Database>,
  id: string
) {
  return (
    client
      .from("journal")
      .select("*, journalLine(*, account!journalLine_accountId_fkey(class))")
      .eq("id", id)
      // Lines read back in the order they were created: edits update in place,
      // so heap order would move an edited line to the end.
      .order("createdAt", { referencedTable: "journalLine" })
      .order("id", { referencedTable: "journalLine" })
      .single()
  );
}

/** A document a journal entry was posted from or is referenced by. */
export type JournalSourceDocument = {
  kind:
    | "receipt"
    | "shipment"
    | "salesInvoice"
    | "purchaseInvoice"
    | "rentalAgreement"
    | "lease"
    | "job"
    | "fixedAsset"
    | "inventoryCount"
    | "maintenanceDispatch"
    | "nonConformance"
    | "inspection"
    | "charge"
    | "reimbursement"
    | "payment"
    | "memo"
    | "depreciationRun"
    | "revenueRecognitionRun"
    | "leaseRun";
  id: string;
  readableId: string;
};

/** More than this and the panel is a list of invoices, not context. */
const MAX_JOURNAL_SOURCE_DOCUMENTS = 25;

/**
 * The documents around a journal entry: the entries it reverses or that
 * reversed it, the period it posts into, and every document it was posted
 * from.
 *
 * Each line names its document by `documentType` + `documentId`; the type
 * says which table the id belongs to (with the journal's `sourceType`
 * settling "Invoice" between sales and purchase, and the ambiguous
 * "Scrap" / "Asset Transfer" ids — a job, or an itemLedger row / an asset
 * transfer — tried against each candidate). Journals whose lines carry no
 * document (disposal, depreciation, revenue recognition runs, asset costs)
 * are found from the other side, by the row that stores this journal's id.
 * "Inventory Adjustment" ids are itemLedger rows with no page of their own,
 * and are not listed.
 */
export async function getJournalEntryRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  journal: {
    id: string;
    sourceType: Database["public"]["Enums"]["journalEntrySourceType"] | null;
    accountingPeriodId: string | null;
    reversalOfId: string | null;
    reversedById: string | null;
    lines: { documentType: string | null; documentId: string | null }[];
  }
) {
  const journalIds = [journal.reversalOfId, journal.reversedById].filter(
    (id): id is string => Boolean(id)
  );

  const idsByType = new Map<string, Set<string>>();
  for (const line of journal.lines) {
    if (!line.documentType || !line.documentId) continue;
    const ids = idsByType.get(line.documentType) ?? new Set<string>();
    ids.add(line.documentId);
    idsByType.set(line.documentType, ids);
  }
  const idsOf = (...types: string[]) => [
    ...new Set(types.flatMap((type) => [...(idsByType.get(type) ?? [])]))
  ];

  const invoiceIds = idsOf("Invoice");
  const isPurchase = journal.sourceType === "Purchase Invoice";
  const jobIds = idsOf(
    "Job Consumption",
    "Job Receipt",
    "Job Close",
    "Production Event",
    "Scrap",
    "Asset Transfer"
  );

  type Row = JournalSourceDocument;
  const none: PromiseLike<Row[]> = Promise.resolve([]);
  // PostgREST builders are thenables, not Promises.
  const lookups: PromiseLike<Row[]>[] = [
    idsOf("Receipt").length > 0
      ? client
          .from("receipt")
          .select("id, receiptId")
          .in("id", idsOf("Receipt"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "receipt" as const,
              id: r.id,
              readableId: r.receiptId
            }))
          )
      : none,
    idsOf("Sales Shipment", "Return Order").length > 0
      ? client
          .from("shipment")
          .select("id, shipmentId")
          .in("id", idsOf("Sales Shipment", "Return Order"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "shipment" as const,
              id: r.id,
              readableId: r.shipmentId
            }))
          )
      : none,
    invoiceIds.length > 0 && !isPurchase
      ? client
          .from("salesInvoice")
          .select("id, invoiceId")
          .in("id", invoiceIds)
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "salesInvoice" as const,
              id: r.id,
              readableId: r.invoiceId
            }))
          )
      : none,
    invoiceIds.length > 0 && isPurchase
      ? client
          .from("purchaseInvoice")
          .select("id, invoiceId")
          .in("id", invoiceIds)
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "purchaseInvoice" as const,
              id: r.id,
              readableId: r.invoiceId
            }))
          )
      : none,
    idsOf("Rental Agreement").length > 0
      ? client
          .from("rentalAgreement")
          .select("id, rentalAgreementId")
          .in("id", idsOf("Rental Agreement"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "rentalAgreement" as const,
              id: r.id,
              readableId: r.rentalAgreementId
            }))
          )
      : none,
    idsOf("Lease").length > 0
      ? client
          .from("lease")
          .select("id, leaseId")
          .in("id", idsOf("Lease"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "lease" as const,
              id: r.id,
              readableId: r.leaseId
            }))
          )
      : none,
    jobIds.length > 0
      ? client
          .from("job")
          .select("id, jobId")
          .in("id", jobIds)
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "job" as const,
              id: r.id,
              readableId: r.jobId
            }))
          )
      : none,
    // An "Asset Transfer" line holds a job id (completed into an asset) or a
    // fixedAssetTransfer id (capitalize / return to stock); list the asset.
    idsOf("Asset Transfer").length > 0
      ? client
          .from("fixedAssetTransfer")
          .select("fixedAsset(id, fixedAssetId)")
          // An "attach job" transfer's line holds the job's id instead.
          .or(
            `id.in.(${idsOf("Asset Transfer").join(",")}),jobId.in.(${idsOf(
              "Asset Transfer"
            ).join(",")})`
          )
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).flatMap((r) =>
              r.fixedAsset
                ? [
                    {
                      kind: "fixedAsset" as const,
                      id: r.fixedAsset.id,
                      readableId: r.fixedAsset.fixedAssetId
                    }
                  ]
                : []
            )
          )
      : none,
    idsOf("Inventory Count").length > 0
      ? client
          .from("inventoryCount")
          .select("id, inventoryCountId")
          .in("id", idsOf("Inventory Count"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "inventoryCount" as const,
              id: r.id,
              readableId: r.inventoryCountId
            }))
          )
      : none,
    idsOf("Maintenance Consumption", "Maintenance Event").length > 0
      ? client
          .from("maintenanceDispatch")
          .select("id, maintenanceDispatchId")
          .in("id", idsOf("Maintenance Consumption", "Maintenance Event"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "maintenanceDispatch" as const,
              id: r.id,
              readableId: r.maintenanceDispatchId
            }))
          )
      : none,
    idsOf("Non-Conformance").length > 0
      ? client
          .from("nonConformance")
          .select("id, nonConformanceId")
          .in("id", idsOf("Non-Conformance"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "nonConformance" as const,
              id: r.id,
              readableId: r.nonConformanceId
            }))
          )
      : none,
    idsOf("Inbound Inspection").length > 0
      ? client
          .from("inspection")
          .select("id, inspectionId")
          .in("id", idsOf("Inbound Inspection"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "inspection" as const,
              id: r.id,
              readableId: r.inspectionId
            }))
          )
      : none,
    idsOf("Charge").length > 0
      ? client
          .from("charge")
          .select("id, chargeId")
          .in("id", idsOf("Charge"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "charge" as const,
              id: r.id,
              readableId: r.chargeId
            }))
          )
      : none,
    idsOf("Reimbursement").length > 0
      ? client
          .from("reimbursement")
          .select("id, reimbursementId")
          .in("id", idsOf("Reimbursement"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "reimbursement" as const,
              id: r.id,
              readableId: r.reimbursementId
            }))
          )
      : none,
    idsOf("Payment").length > 0
      ? client
          .from("payment")
          .select("id, paymentId")
          .in("id", idsOf("Payment"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "payment" as const,
              id: r.id,
              readableId: r.paymentId
            }))
          )
      : none,
    idsOf("Memo").length > 0
      ? client
          .from("memo")
          .select("id, memoId")
          .in("id", idsOf("Memo"))
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).map((r) => ({
              kind: "memo" as const,
              id: r.id,
              readableId: r.memoId
            }))
          )
      : none,
    // Rows that store this journal's id: the lines of these journals carry
    // no document of their own.
    journal.sourceType === "Asset Disposal"
      ? client
          .from("fixedAssetDisposal")
          .select("fixedAsset(id, fixedAssetId)")
          .eq("journalId", journal.id)
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).flatMap((r) =>
              r.fixedAsset
                ? [
                    {
                      kind: "fixedAsset" as const,
                      id: r.fixedAsset.id,
                      readableId: r.fixedAsset.fixedAssetId
                    }
                  ]
                : []
            )
          )
      : none,
    journal.sourceType === "Asset Transfer" || journal.sourceType === "Manual"
      ? client
          .from("fixedAssetCipCost")
          .select("fixedAsset(id, fixedAssetId)")
          .eq("journalId", journal.id)
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).flatMap((r) =>
              r.fixedAsset
                ? [
                    {
                      kind: "fixedAsset" as const,
                      id: r.fixedAsset.id,
                      readableId: r.fixedAsset.fixedAssetId
                    }
                  ]
                : []
            )
          )
      : none,
    journal.sourceType === "Asset Depreciation"
      ? client
          .from("depreciationRunLine")
          .select(
            "depreciationRun(id, depreciationRunId), fixedAsset(id, fixedAssetId)"
          )
          .eq("journalId", journal.id)
          .eq("companyId", companyId)
          .then(({ data }) =>
            (data ?? []).flatMap((r) => [
              ...(r.depreciationRun
                ? [
                    {
                      kind: "depreciationRun" as const,
                      id: r.depreciationRun.id,
                      readableId: r.depreciationRun.depreciationRunId
                    }
                  ]
                : []),
              ...(r.fixedAsset
                ? [
                    {
                      kind: "fixedAsset" as const,
                      id: r.fixedAsset.id,
                      readableId: r.fixedAsset.fixedAssetId
                    }
                  ]
                : [])
            ])
          )
      : none,
    // A run posts one journal per month, so the run is found through the
    // schedule rows the journal posted, not the run's own journalId.
    journal.sourceType === "Revenue Recognition" ||
    journal.sourceType === "Lease Run"
      ? client
          .from("revenueRecognitionSchedule")
          .select(
            "runLine:revenueRecognitionRunLine!revenueRecognitionRunLine_schedule_fkey(run:revenueRecognitionRun!revenueRecognitionRunLine_run_fkey(id, runId))"
          )
          .eq("journalId", journal.id)
          .eq("companyId", companyId)
          .then(({ data }) => {
            const runs = new Map<string, string>();
            for (const row of data ?? []) {
              const lines = Array.isArray(row.runLine)
                ? row.runLine
                : row.runLine
                  ? [row.runLine]
                  : [];
              for (const line of lines) {
                if (line.run) runs.set(line.run.id, line.run.runId);
              }
            }
            return [...runs].map(([id, runId]) => ({
              kind:
                journal.sourceType === "Lease Run"
                  ? ("leaseRun" as const)
                  : ("revenueRecognitionRun" as const),
              id,
              readableId: runId
            }));
          })
      : none
  ];

  const [documentGroups, journals, accountingPeriod] = await Promise.all([
    Promise.all(lookups),
    journalIds.length > 0
      ? client
          .from("journal")
          .select("id, journalEntryId, status")
          .in("id", journalIds)
          .eq("companyId", companyId)
      : null,
    journal.accountingPeriodId
      ? client
          .from("accountingPeriod")
          .select("id, startDate, closeStatus")
          .eq("id", journal.accountingPeriodId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);

  const seen = new Set<string>();
  const documents = documentGroups.flat().filter((doc) => {
    const key = `${doc.kind}:${doc.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byId = new Map((journals?.data ?? []).map((j) => [j.id, j]));

  return {
    documents: documents.slice(0, MAX_JOURNAL_SOURCE_DOCUMENTS),
    reversalOf: journal.reversalOfId
      ? (byId.get(journal.reversalOfId) ?? null)
      : null,
    reversedBy: journal.reversedById
      ? (byId.get(journal.reversedById) ?? null)
      : null,
    accountingPeriod: accountingPeriod?.data ?? null
  };
}

/** Not published: it takes the entry number from the caller. `accounting_createJournalEntry` numbers it from the sequence. */
export async function createJournalEntry(
  client: SupabaseClient<Database>,
  data: z.infer<typeof journalEntryValidator> & {
    journalEntryId: string;
    sourceType: Database["public"]["Enums"]["journalEntrySourceType"];
    companyId: string;
    createdBy: string;
  }
) {
  const { id: _id, ...rest } = data;
  return client
    .from("journal")
    .insert({
      ...rest,
      status: "Draft" as const
    })
    .select("id")
    .single();
}

export async function updateJournalEntry(
  client: SupabaseClient<Database>,
  id: string,
  data: z.infer<typeof journalEntryValidator> & {
    updatedBy: string;
  }
) {
  const { id: _id, ...rest } = data;
  return client
    .from("journal")
    .update(sanitize(rest))
    .eq("id", id)
    .eq("status", "Draft");
}

export async function deleteJournalEntry(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("journal").delete().eq("id", id).eq("status", "Draft");
}

export async function upsertJournalEntryLine(
  client: SupabaseClient<Database>,
  data:
    | (z.infer<typeof journalEntryLineValidator> & {
        journalId: string;
        companyId: string;
        companyGroupId: string;
      })
    | (z.infer<typeof journalEntryLineValidator> & {
        id: string;
        updatedBy: string;
        companyGroupId: string;
      })
) {
  const account = await client
    .from("account")
    .select("class")
    .eq("id", data.accountId)
    .single();

  if (account.error || !account.data?.class) {
    return { data: null, error: { message: "Account not found" } };
  }

  const amount = toStoredAmount(
    data.debit ?? 0,
    data.credit ?? 0,
    account.data.class
  );

  if ("companyId" in data) {
    return client
      .from("journalLine")
      .insert({
        journalId: data.journalId,
        accountId: data.accountId,
        description: data.description,
        amount,
        journalLineReference: crypto.randomUUID(),
        companyId: data.companyId
      })
      .select("id")
      .single();
  } else {
    return client
      .from("journalLine")
      .update(
        sanitize({
          accountId: data.accountId,
          description: data.description,
          amount,
          updatedBy: data.updatedBy
        })
      )
      .eq("id", data.id)
      .select("id")
      .single();
  }
}

export async function deleteJournalEntryLine(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("journalLine").delete().eq("id", id);
}

/** Not published: `accounting_saveJournalEntry` saves, with the one-sided line rule this skips. */
export async function saveJournalEntryWithLines(
  client: SupabaseClient<Database>,
  data: {
    journalEntryId: string;
    postingDate: string;
    description?: string;
    updatedBy: string;
    lines: Array<{
      /**
       * The stored line this one edits. Lines with a matching id are updated
       * in place (only when something changed), lines without one are
       * inserted, and stored lines no longer submitted are deleted — so the
       * audit log records what was actually edited. A caller that sends no
       * ids replaces every line, as before.
       */
      id?: string;
      accountId: string;
      description?: string;
      debit: number;
      credit: number;
      dimensions?: Array<{ dimensionId: string; valueId: string }>;
    }>;
    companyId: string;
    companyGroupId: string;
  }
) {
  // Reads first: the account classes that sign each amount (scoped to the
  // company group — an id from the payload must not reach another group's
  // chart), and the stored lines with their dimensions to diff against.
  const accountIds = [...new Set(data.lines.map((l) => l.accountId))];
  const [accounts, storedLines] = await Promise.all([
    accountIds.length > 0
      ? client
          .from("account")
          .select("id, class")
          .in("id", accountIds)
          .eq("companyGroupId", data.companyGroupId)
      : null,
    client
      .from("journalLine")
      .select("id, accountId, description, amount")
      .eq("journalId", data.journalEntryId)
      .eq("companyId", data.companyId)
  ]);

  if (accounts?.error) return { data: null, error: accounts.error };
  if (storedLines.error) return { data: null, error: storedLines.error };

  const accountClass = new Map(
    (accounts?.data ?? []).map((a) => [a.id, a.class])
  );
  const missing = accountIds.find((id) => !accountClass.has(id));
  if (missing) {
    return { data: null, error: { message: `Account not found: ${missing}` } };
  }

  const storedIds = storedLines.data.map((l) => l.id);
  const storedDimensions =
    storedIds.length > 0
      ? await client
          .from("journalLineDimension")
          .select("journalLineId, dimensionId, valueId")
          .in("journalLineId", storedIds)
      : null;
  if (storedDimensions?.error) {
    return { data: null, error: storedDimensions.error };
  }

  const dimensionsByLine = new Map<
    string,
    { dimensionId: string; valueId: string }[]
  >();
  for (const d of storedDimensions?.data ?? []) {
    const list = dimensionsByLine.get(d.journalLineId) ?? [];
    list.push({ dimensionId: d.dimensionId, valueId: d.valueId });
    dimensionsByLine.set(d.journalLineId, list);
  }

  const { changes, deleteIds } = diffJournalLines(
    storedLines.data.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      description: l.description,
      amount: Number(l.amount),
      dimensions: dimensionsByLine.get(l.id) ?? []
    })),
    data.lines.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      description: l.description,
      amount: toStoredAmount(l.debit, l.credit, accountClass.get(l.accountId)!),
      dimensions: l.dimensions ?? []
    }))
  );

  // One transaction: refuses anything but a Draft journal of this company.
  const saved = await client.rpc("save_journal_entry_lines", {
    p_journal_id: data.journalEntryId,
    p_company_id: data.companyId,
    p_user_id: data.updatedBy,
    p_posting_date: data.postingDate,
    p_description: data.description,
    p_lines: changes as unknown as Json,
    p_delete_ids: deleteIds
  });

  if (saved.error) return { data: null, error: saved.error };
  return { data: (saved.data ?? []).map((id) => ({ id })), error: null };
}

export async function postJournalEntry(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  // 1. Fetch entry + lines
  const entry = await getJournalEntry(client, id);
  if (entry.error) return entry;
  const cutover = await requireAccountingCutover(client, entry.data.companyId);
  if (cutover.error) return { data: null, error: cutover.error };
  if (entry.data.status !== "Draft") {
    return {
      data: null,
      error: { message: "Journal entry is not in Draft status" }
    };
  }

  const lines = entry.data.journalLine ?? [];
  if (lines.length === 0) {
    return { data: null, error: { message: "Journal entry has no lines" } };
  }

  // 2. Validate balance. journalLine.amount is a class-signed *natural balance*
  // (e.g. a liability credit and an expense debit are both positive), so a
  // balanced entry does NOT sum to zero — it has equal total debits and
  // credits once each amount is decoded by its account class.
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lines) {
    const account = l.account as
      | { class?: string }
      | { class?: string }[]
      | null;
    const accountClass = (
      Array.isArray(account) ? account[0]?.class : account?.class
    ) as Parameters<typeof toDisplayDebit>[1] | undefined;
    if (!accountClass) {
      return {
        data: null,
        error: { message: "A journal line is missing its account class" }
      };
    }
    totalDebit += toDisplayDebit(Number(l.amount), accountClass);
    totalCredit += toDisplayCredit(Number(l.amount), accountClass);
  }

  if (!isBalanced(totalDebit, totalCredit, JOURNAL_BALANCE_TOLERANCE)) {
    return {
      data: null,
      error: { message: "Total debits must equal total credits" }
    };
  }

  // 2b. Enforce the period lifecycle. A manual JE posts as an "accounting"
  // source, so a Locked period still accepts it (adjustments are allowed);
  // only a Closed period rejects. Stamp the resolved period on the entry.
  // The fallback date is persisted with the flip below so the posted journal
  // can never carry a period from one day and a postingDate from another.
  const postingDate =
    entry.data.postingDate ??
    datetime
      .today(await getCompanyTimeZone(client, entry.data.companyId))
      .toString();
  const period = await getOrCreateAccountingPeriod(
    client,
    entry.data.companyId,
    postingDate,
    "accounting"
  );
  if (period.error) {
    return { data: null, error: period.error };
  }

  // 3. Flip status — lines are already in journalLine, no copying needed
  return client
    .from("journal")
    .update({
      status: "Posted" as const,
      postedAt: new Date().toISOString(),
      postedBy: userId,
      accountingPeriodId: period.data,
      postingDate,
      updatedBy: userId
    })
    .eq("id", id)
    .select("id")
    .single();
}

export async function reverseJournalEntry(
  client: SupabaseClient<Database>,
  id: string,
  data: {
    journalEntryId?: string;
    companyId: string;
    userId: string;
  }
) {
  const cutover = await requireAccountingCutover(client, data.companyId);
  if (cutover.error) return { data: null, error: cutover.error };

  // 1. Fetch original
  const original = await getJournalEntry(client, id);
  if (original.error) return original;
  if (original.data.status !== "Posted") {
    return {
      data: null,
      error: { message: "Can only reverse posted journal entries" }
    };
  }
  // A run's journal is reversed through its run: reversing the journal alone
  // leaves the revenue schedule rows Posted (that revenue could never be
  // recognized again) or the asset's accumulated depreciation raised.
  const runReversal = RUN_JOURNAL_SOURCES[original.data.sourceType ?? ""];
  if (runReversal) {
    return {
      data: null,
      error: {
        message: `This journal belongs to a ${runReversal} run. Reverse the run instead, so its schedule and assets stay correct.`
      }
    };
  }

  // 2. Generate sequence if not provided
  let journalEntryId: string;
  if (data.journalEntryId) {
    journalEntryId = data.journalEntryId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "journalEntry",
      company_id: data.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error: seq.error ?? {
          message: "Failed to generate journalEntry sequence"
        }
      };
    }
    journalEntryId = seq.data;
  }

  // 2b. The reversing entry is dated today and posts as an "accounting" source,
  // so it lands in the current period (never the original's, which may be
  // Closed). A Closed current period rejects; a Locked one still accepts.
  const postingDate = datetime
    .today(await getCompanyTimeZone(client, data.companyId))
    .toString();
  const period = await getOrCreateAccountingPeriod(
    client,
    data.companyId,
    postingDate,
    "accounting"
  );
  if (period.error) {
    return { data: null, error: period.error };
  }

  // 3. Create reversing entry as Posted
  const reversed = await client
    .from("journal")
    .insert({
      journalEntryId,
      companyId: data.companyId,
      description: `Reversal of ${original.data.journalEntryId}`,
      postingDate,
      accountingPeriodId: period.data,
      sourceType: "Manual" as const,
      reversalOfId: id,
      status: "Posted" as const,
      postedAt: new Date().toISOString(),
      postedBy: data.userId,
      createdBy: data.userId
    })
    .select("id")
    .single();

  if (reversed.error) return reversed;

  // 3. Copy lines with negated amounts
  const lines = (original.data.journalLine ?? []).map((line) => ({
    journalId: reversed.data.id,
    accountId: line.accountId,
    companyId: line.companyId,
    description: line.description,
    amount: -Number(line.amount),
    journalLineReference: crypto.randomUUID()
  }));

  if (lines.length > 0) {
    const linesResult = await client.from("journalLine").insert(lines);
    if (linesResult.error) return linesResult;
  }

  // 4. Mark original as Reversed and store back-reference
  const updateResult = await client
    .from("journal")
    .update({
      status: "Reversed" as const,
      reversedById: reversed.data.id,
      updatedBy: data.userId
    })
    .eq("id", id);

  if (updateResult.error) return updateResult;

  return reversed;
}

// -- Asset Classes --

export async function getFixedAssetClasses(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("fixedAssetClass")
    .select(
      "id, name, description, depreciationMethod, usefulLifeMonths, residualValuePercent, taxDepreciationMethod, taxUsefulLifeMonths, macrsPropertyClass",
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId);

  // A CIP class is hidden while construction in progress is.
  if (!CONSTRUCTION_IN_PROGRESS_ENABLED) {
    query = query.eq("isConstructionInProgress", false);
  }

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getFixedAssetClass(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAssetClass").select("*").eq("id", id).single();
}

export async function getFixedAssetClassesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  let query = client
    .from("fixedAssetClass")
    .select(
      "id, name, depreciationMethod, usefulLifeMonths, residualValuePercent, taxDepreciationMethod, taxUsefulLifeMonths, taxResidualValuePercent, macrsPropertyClass, macrsConvention, bonusDepreciationPercent"
    )
    .eq("companyId", companyId);
  // A CIP class is hidden while construction in progress is.
  if (!CONSTRUCTION_IN_PROGRESS_ENABLED) {
    query = query.eq("isConstructionInProgress", false);
  }
  return query.order("name");
}

export async function upsertFixedAssetClass(
  client: SupabaseClient<Database>,
  data:
    | (Record<string, any> & { companyId: string; createdBy: string })
    | (Record<string, any> & { id: string; updatedBy: string })
) {
  if ("createdBy" in data) {
    return client
      .from("fixedAssetClass")
      .insert([data as any])
      .select("id")
      .single();
  }
  const { id, ...rest } = data;
  return client
    .from("fixedAssetClass")
    .update(unchecked(sanitize(rest)))
    .eq("id", id)
    .select("id")
    .single();
}

export async function deleteFixedAssetClass(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAssetClass").delete().eq("id", id);
}

// -- Fixed Assets --

export async function getFixedAssets(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: Database["public"]["Enums"]["fixedAssetStatus"] | null;
  }
) {
  let query = client
    .from("fixedAsset")
    .select(
      "id, fixedAssetId, fixedAssetClassId, name, serialNumber, status, depreciationMethod, acquisitionCost, accumulatedDepreciation, fixedAssetClass:fixedAssetClassId(id, name), location:locationId(id, name)",
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,fixedAssetId.ilike.%${args.search}%,serialNumber.ilike.%${args.search}%`
    );
  }

  if (args.status) {
    query = query.eq("status", args.status);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "fixedAssetId", ascending: true }
  ]);
  return query;
}

export async function getFixedAsset(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("fixedAsset")
    .select(
      "*, fixedAssetClass:fixedAssetClassId(*), location:locationId(id, name)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getFixedAssetsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fixedAsset")
    .select("id, fixedAssetId, name")
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .order("fixedAssetId");
}

export async function getFixedAssetsListForSale(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fixedAsset")
    .select("id, fixedAssetId, name")
    .eq("companyId", companyId)
    .in("status", ["Active", "Fully Depreciated"])
    .order("fixedAssetId");
}

export async function insertFixedAsset(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    fixedAssetId?: string;
    fixedAssetClassId: string;
    name: string;
    description?: string;
    serialNumber?: string;
    depreciationMethod: string;
    usefulLifeMonths: number;
    residualValuePercent: number;
    assetLifetimeUsage?: number | null;
    locationId?: string;
    workCenterId?: string | null;
    status?: string;
    taxDepreciationMethod?: string | null;
    taxUsefulLifeMonths?: number | null;
    taxResidualValuePercent?: number | null;
    macrsPropertyClass?: string | null;
    macrsConvention?: string | null;
    bonusDepreciationPercent?: number | null;
  }
): Promise<{
  data: { id: string; fixedAssetId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let fixedAssetId: string;
  if (input.fixedAssetId) {
    fixedAssetId = input.fixedAssetId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "fixedAsset",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate fixedAsset sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    fixedAssetId = seq.data;
  }

  const asset = await client
    .from("fixedAsset")
    .insert({
      fixedAssetId,
      fixedAssetClassId: input.fixedAssetClassId,
      name: input.name,
      description: input.description ?? null,
      serialNumber: input.serialNumber ?? null,
      depreciationMethod: input.depreciationMethod as any,
      usefulLifeMonths: input.usefulLifeMonths,
      residualValuePercent: input.residualValuePercent,
      assetLifetimeUsage: input.assetLifetimeUsage ?? null,
      locationId: input.locationId ?? null,
      workCenterId: input.workCenterId ?? null,
      status: (input.status as any) ?? "Draft",
      taxDepreciationMethod: (input.taxDepreciationMethod as any) ?? null,
      taxUsefulLifeMonths: input.taxUsefulLifeMonths ?? null,
      taxResidualValuePercent: input.taxResidualValuePercent ?? null,
      macrsPropertyClass: (input.macrsPropertyClass as any) ?? null,
      macrsConvention: (input.macrsConvention as any) ?? null,
      bonusDepreciationPercent: input.bonusDepreciationPercent ?? null,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, fixedAssetId")
    .single();

  if (asset.error) return { data: null, error: asset.error };

  return {
    data: { id: asset.data.id, fixedAssetId: asset.data.fixedAssetId },
    error: null
  };
}

export async function updateFixedAsset(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    fixedAssetClassId?: string;
    name?: string;
    description?: string | null;
    serialNumber?: string | null;
    depreciationMethod?: (typeof depreciationMethods)[number];
    usefulLifeMonths?: number;
    residualValuePercent?: number;
    assetLifetimeUsage?: number | null;
    locationId?: string | null;
    workCenterId?: string | null;
    taxDepreciationMethod?: (typeof taxDepreciationMethods)[number] | null;
    taxUsefulLifeMonths?: number | null;
    taxResidualValuePercent?: number | null;
    macrsPropertyClass?: (typeof macrsPropertyClasses)[number] | null;
    macrsConvention?: (typeof macrsConventions)[number] | null;
    bonusDepreciationPercent?: number | null;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("fixedAsset")
    .update(sanitize(rest))
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

/** @deprecated Use insertFixedAsset for new assets, updateFixedAsset for existing assets */
export async function upsertFixedAsset(
  client: SupabaseClient<Database>,
  data:
    | (Record<string, any> & {
        fixedAssetId: string;
        companyId: string;
        createdBy: string;
      })
    | (Record<string, any> & { id: string; updatedBy: string })
) {
  if ("createdBy" in data) {
    return client
      .from("fixedAsset")
      .insert([data as any])
      .select("id")
      .single();
  }
  const { id, ...rest } = data;
  return client
    .from("fixedAsset")
    .update(unchecked(sanitize(rest)))
    .eq("id", id)
    .select("id")
    .single();
}

export async function deleteFixedAsset(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAsset").delete().eq("id", id).eq("status", "Draft");
}

/** Not published: it takes the lines from the caller. `accounting_createDepreciationRun` calculates them. */
export async function insertDepreciationRun(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    depreciationRunId?: string;
    periodEnd: string;
    lines: Array<{
      fixedAssetId: string;
      /** The month the line depreciates; defaults to the run's period. */
      periodEnd?: string;
      amount: number;
      taxAmount?: number | null;
    }>;
  }
): Promise<{
  data: { id: string; depreciationRunId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let depreciationRunId: string;
  if (input.depreciationRunId) {
    depreciationRunId = input.depreciationRunId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "depreciationRun",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate depreciationRun sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    depreciationRunId = seq.data;
  }

  const run = await client
    .from("depreciationRun")
    .insert({
      depreciationRunId,
      periodEnd: input.periodEnd,
      status: "Draft" as const,
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id, depreciationRunId")
    .single();

  if (run.error) return { data: null, error: run.error };

  if (input.lines.length > 0) {
    const lineInserts = input.lines.map((line) => ({
      depreciationRunId: run.data.id,
      periodEnd: line.periodEnd ?? input.periodEnd,
      fixedAssetId: line.fixedAssetId,
      amount: line.amount,
      taxAmount: line.taxAmount,
      companyId: input.companyId
    }));

    const lineResult = await client
      .from("depreciationRunLine")
      .insert(lineInserts);

    if (lineResult.error) {
      await client.from("depreciationRun").delete().eq("id", run.data.id);
      return { data: null, error: lineResult.error };
    }
  }

  return {
    data: {
      id: run.data.id,
      depreciationRunId: run.data.depreciationRunId
    },
    error: null
  };
}

/**
 * What a depreciation run for `periodEnd` should hold, from the assets as they
 * are now: every Active asset no OTHER run of the period covers (`runId` is
 * the run being checked or rebuilt, absent for a new one), depreciated from
 * the last run posted before the period, with Units of Production summing the
 * usage logged since then. New, Repeat, Recalculate and the check at Post all
 * read it, so a Draft that still matches is exactly what a fresh run would
 * propose. `laterPostedRunId` is set when a run for a LATER period is already
 * posted: this period's depreciation is then counted in it, and a run here
 * would post those months twice.
 */
export async function buildDepreciationRunLines(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    companyGroupId: string;
    periodEnd: string;
    runId?: string;
  }
): Promise<
  | {
      data: { lines: DepreciationLine[]; laterPostedRunId: string | null };
      error: null;
    }
  | { data: null; error: unknown }
> {
  const { companyId, companyGroupId, periodEnd, runId } = args;

  // The line, asset and usage reads page past PostgREST's 1000-row cap: a
  // run holds one line per asset per month.
  const covered = fetchAllFromTable<{ fixedAssetId: string }>(
    client,
    "depreciationRunLine",
    "id, fixedAssetId, depreciationRun!inner(periodEnd)",
    (query: any) => {
      let q = query
        .eq("companyId", companyId)
        .eq("depreciationRun.periodEnd", periodEnd);
      if (runId) q = q.neq("depreciationRunId", runId);
      return q.order("id", { ascending: true });
    }
  );

  const [
    settings,
    lastPosted,
    laterPosted,
    coveredLines,
    assets,
    decimals,
    costAdjustments
  ] = await Promise.all([
    client
      .from("companySettings")
      .select("assetTaxDepreciationEnabled, accountingCutoverDate")
      .eq("id", companyId)
      .single(),
    client
      .from("depreciationRun")
      .select("periodEnd")
      .eq("companyId", companyId)
      .eq("status", "Posted")
      .lt("periodEnd", periodEnd)
      .order("periodEnd", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("depreciationRun")
      .select("depreciationRunId")
      .eq("companyId", companyId)
      .eq("status", "Posted")
      .gt("periodEnd", periodEnd)
      .order("periodEnd")
      .limit(1)
      .maybeSingle(),
    covered,
    fetchAllFromTable<Database["public"]["Tables"]["fixedAsset"]["Row"]>(
      client,
      "fixedAsset",
      "*",
      (query: any) =>
        query
          .eq("companyId", companyId)
          .eq("status", "Active")
          .order("id", { ascending: true })
    ),
    getBaseCurrencyDecimalPlaces(client, companyId, companyGroupId),
    // Assets whose cost was raised after capitalization: a Straight Line
    // one catches up the months it took at the old cost.
    fetchAllFromTable<{ fixedAssetId: string }>(
      client,
      "fixedAssetTransfer",
      "id, fixedAssetId",
      (query: any) =>
        query
          .eq("companyId", companyId)
          .eq("type", "Cost Adjustment")
          .eq("status", "Posted")
          .order("id", { ascending: true })
    )
  ]);

  if (lastPosted.error) return { data: null, error: lastPosted.error };
  if (costAdjustments.error || !costAdjustments.data) {
    return { data: null, error: costAdjustments.error };
  }
  if (laterPosted.error) return { data: null, error: laterPosted.error };
  if (coveredLines.error || !coveredLines.data) {
    return { data: null, error: coveredLines.error };
  }
  if (assets.error || !assets.data) return { data: null, error: assets.error };

  // Depreciation before the accounting cutover is in the prior system and in
  // each asset's accumulated depreciation at the cutover, never in a Carbon
  // run. So with no run posted after it, a run starts at the cutover month,
  // not at the asset's depreciation start date.
  const lastPostedPeriodEnd = depreciationFloor(
    lastPosted.data?.periodEnd ?? null,
    settings.data?.accountingCutoverDate ?? null
  );

  // A run can cover several months (a picked later period), so units of
  // production sums every usage log since the last posted run.
  const usageLogs = await fetchAllFromTable<{
    fixedAssetId: string;
    unitsProduced: number;
    periodEnd: string;
  }>(
    client,
    "fixedAssetUsageLog",
    "id, fixedAssetId, unitsProduced, periodEnd",
    (query: any) => {
      let q = query.eq("companyId", companyId).lte("periodEnd", periodEnd);
      if (lastPostedPeriodEnd) q = q.gt("periodEnd", lastPostedPeriodEnd);
      return q.order("id", { ascending: true });
    }
  );
  if (usageLogs.error || !usageLogs.data) {
    return { data: null, error: usageLogs.error };
  }

  // Units of Production usage per asset per month: each month's line uses
  // the units logged in that month.
  const usageMap = new Map<string, number>();
  for (const u of usageLogs.data) {
    const key = usageKey(u.fixedAssetId, monthEndOf(u.periodEnd));
    usageMap.set(key, (usageMap.get(key) ?? 0) + Number(u.unitsProduced));
  }

  const coveredAssetIds = new Set(
    coveredLines.data.map((line) => line.fixedAssetId)
  );
  const costAdjustedAssetIds = new Set(
    costAdjustments.data.map((transfer) => transfer.fixedAssetId)
  );

  const lines = buildDepreciationLines(
    assets.data
      .filter((asset) => !coveredAssetIds.has(asset.id))
      .map((asset) => ({
        ...asset,
        accumulatedTaxDepreciation: Number(
          asset.accumulatedTaxDepreciation ?? 0
        ),
        costAdjusted: costAdjustedAssetIds.has(asset.id)
      })),
    periodEnd,
    lastPostedPeriodEnd,
    settings.data?.assetTaxDepreciationEnabled ?? false,
    usageMap,
    decimals
  );

  return {
    data: {
      lines,
      laterPostedRunId: laterPosted.data?.depreciationRunId ?? null
    },
    error: null
  };
}

/**
 * Creates a Draft depreciation run for `periodEnd` holding what
 * `buildDepreciationRunLines` says is due. Never an empty run: with nothing
 * to depreciate it returns an error and writes nothing. New Run and the
 * period close checklist both create through it.
 */
export async function createDepreciationRun(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    companyGroupId: string;
    periodEnd: string;
    userId: string;
  }
): Promise<
  | { data: { id: string; depreciationRunId: string }; error: null }
  | { data: null; error: { message: string } }
> {
  const cutover = await requireAccountingCutover(client, args.companyId);
  if (cutover.error) return { data: null, error: cutover.error };
  const proposal = await buildDepreciationRunLines(client, args);
  if (!proposal.data) {
    return {
      data: null,
      error: { message: "Failed to calculate depreciation" }
    };
  }
  // A later period's posted run already holds these months: a run here
  // would post them twice. Every caller (New Run, Repeat, the close page)
  // gets the refusal.
  if (proposal.data.laterPostedRunId) {
    return {
      data: null,
      error: {
        message: `${proposal.data.laterPostedRunId} is already posted for a later period and includes these months`
      }
    };
  }
  if (proposal.data.lines.length === 0) {
    return {
      data: null,
      error: { message: "Nothing to depreciate for this period" }
    };
  }
  const result = await insertDepreciationRun(client, {
    periodEnd: args.periodEnd,
    lines: proposal.data.lines,
    companyId: args.companyId,
    createdBy: args.userId
  });
  if (result.error || !result.data) {
    return {
      data: null,
      error: { message: "Failed to create depreciation run" }
    };
  }
  return { data: result.data, error: null };
}

export async function deleteDepreciationRun(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("depreciationRun")
    .delete()
    .eq("id", id)
    .eq("status", "Draft");
}

// -- Depreciation --

export async function getDepreciationRuns(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("depreciationRun")
    .select("id, depreciationRunId, periodEnd, status, postedAt", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("depreciationRunId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function getDepreciationRun(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("depreciationRun").select("*").eq("id", id).single();
}

export async function getDepreciationRunLines(
  client: SupabaseClient<Database>,
  depreciationRunId: string
) {
  // One line per asset per month: a catch-up run passes PostgREST's
  // 1000-row cap.
  return fetchAllRecords(() =>
    client
      .from("depreciationRunLine")
      .select(
        "id, fixedAssetId, periodEnd, amount, taxAmount, journalId, deferredTaxJournalId, fixedAsset:fixedAssetId(id, fixedAssetId, name, acquisitionCost, accumulatedDepreciation, accumulatedTaxDepreciation, residualValuePercent)"
      )
      .eq("depreciationRunId", depreciationRunId)
      .order("periodEnd")
      .order("fixedAssetId")
      .order("id")
  );
}

// -- Revenue Recognition --

export async function getRevenueRecognitionRun(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("revenueRecognitionRun")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getRevenueRecognitionRunLines(
  client: SupabaseClient<Database>,
  runId: string,
  companyId: string
) {
  // The run line -> schedule FK is composite (scheduleId, companyId), so the
  // embed must name the target table and constraint; `schedule:scheduleId(...)`
  // only resolves single-column FKs and fails with PGRST200.
  return client
    .from("revenueRecognitionRunLine")
    .select(
      "id, amount, schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey(id, type, periodStart, periodEnd, scheduledDate, amount, debitAccountId, creditAccountId, salesInvoiceLineId, rentalAgreementLineId, leaseId, journalId)"
    )
    .eq("runId", runId)
    .eq("companyId", companyId);
}

/**
 * The documents around a depreciation or revenue recognition run that its own
 * row doesn't name: the accounting period its `periodEnd` falls in (the one
 * posting resolves), and the journal entries it posted.
 */
export async function getPeriodRunRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  periodEnd: string,
  journalIds: string[]
) {
  const [accountingPeriod, journals] = await Promise.all([
    client
      .from("accountingPeriod")
      .select("id, startDate, endDate, closeStatus")
      .eq("companyId", companyId)
      .lte("startDate", periodEnd)
      .gte("endDate", periodEnd)
      .maybeSingle(),
    journalIds.length > 0
      ? client
          .from("journal")
          .select("id, journalEntryId, status")
          .eq("companyId", companyId)
          .in("id", journalIds)
      : null
  ]);

  return {
    accountingPeriod: accountingPeriod.data ?? null,
    journals: journals?.data ?? []
  };
}

export async function getRevenueSchedules(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    status: Database["public"]["Enums"]["revenueScheduleStatus"] | null;
    type: Database["public"]["Enums"]["revenueScheduleType"] | null;
  }
) {
  let query = client
    .from("revenueRecognitionSchedule")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.type) {
    query = query.eq("type", args.type);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "scheduledDate", ascending: true }
  ]);
  return query;
}

export type DeferredRevenueWaterfallRow = {
  /** YYYY-MM of the schedule's `scheduledDate`. */
  bucket: string;
  type: Database["public"]["Enums"]["revenueScheduleType"];
  amount: number;
};

export async function getDeferredRevenueWaterfall(
  client: SupabaseClient<Database>,
  companyId: string,
  { asOf }: { asOf: string }
): Promise<{
  data: DeferredRevenueWaterfallRow[] | null;
  error: PostgrestError | null;
}> {
  const schedules = await fetchAllFromTable<{
    scheduledDate: string;
    type: Database["public"]["Enums"]["revenueScheduleType"];
    amount: number;
  }>(
    client,
    "revenueRecognitionSchedule",
    "scheduledDate, type, amount",
    (query: any) =>
      query
        .eq("companyId", companyId)
        .eq("status", "Planned")
        // Lessee lease rows are expense, not revenue.
        .is("leaseId", null)
        .gte("scheduledDate", asOf)
        .order("id", { ascending: true })
  );
  if (schedules.error) {
    return { data: null, error: schedules.error };
  }

  // Bucket by month and type. `scheduledDate` is a DATE string (YYYY-MM-DD),
  // so its first seven characters are the month; accumulate at full precision
  // and round once per bucket.
  const totals = new Map<string, DeferredRevenueWaterfallRow>();
  for (const schedule of schedules.data ?? []) {
    const bucket = schedule.scheduledDate.slice(0, 7);
    const key = `${bucket}:${schedule.type}`;
    const existing = totals.get(key);
    if (existing) {
      existing.amount += schedule.amount;
    } else {
      totals.set(key, { bucket, type: schedule.type, amount: schedule.amount });
    }
  }

  const data = [...totals.values()]
    .map((row) => ({ ...row, amount: round(row.amount) }))
    .sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return 0;
    });

  return { data, error: null };
}

export type RentalUtilizationRow = {
  /** `fixedAsset.id`. */
  id: string;
  /** The readable `fixedAsset.fixedAssetId`. */
  fixedAssetId: string;
  name: string;
  serialNumber: string | null;
  fixedAssetClassId: string;
  className: string;
  acquisitionCost: number;
  fleetDays: number;
  onRentDays: number;
  /** on-rent days ÷ fleet days, a 0–1 fraction; null with no fleet days. */
  timeUtilization: number | null;
  recognizedIncome: number;
  /** Annualized recognized income ÷ acquisition cost; null with no cost. */
  dollarUtilization: number | null;
};

export type RentalUtilizationTotals = Omit<
  RentalUtilizationRow,
  "id" | "fixedAssetId" | "name" | "serialNumber"
>;

export type RentalUtilization = {
  rangeDays: number;
  assets: RentalUtilizationRow[];
  /** One row per fixed asset class, in class-name order. */
  classTotals: RentalUtilizationTotals[];
};

type DateInterval = { start: string; end: string };

/** `[a] ∩ [b]` on inclusive `YYYY-MM-DD` bounds; null when they miss. */
function intersectDateIntervals(
  a: DateInterval,
  b: DateInterval
): DateInterval | null {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
}

/** Days covered by the union of inclusive intervals — a unit returned and
 *  re-delivered the same day is on rent that day once, not twice. */
function daysCoveredByIntervals(intervals: DateInterval[]): number {
  const sorted = [...intervals].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0
  );
  let days = 0;
  let current: DateInterval | null = null;
  for (const interval of sorted) {
    if (current && interval.start <= addDays(current.end, 1)) {
      if (interval.end > current.end) current.end = interval.end;
      continue;
    }
    if (current) days += daysBetweenInclusive(current.start, current.end);
    current = { ...interval };
  }
  if (current) days += daysBetweenInclusive(current.start, current.end);
  return days;
}

function utilizationRatios(
  totals: {
    fleetDays: number;
    onRentDays: number;
    recognizedIncome: number;
    acquisitionCost: number;
  },
  rangeDays: number
) {
  return {
    timeUtilization:
      totals.fleetDays > 0 ? round(totals.onRentDays / totals.fleetDays) : null,
    dollarUtilization:
      totals.acquisitionCost > 0
        ? round(
            (totals.recognizedIncome * (365 / rangeDays)) /
              totals.acquisitionCost
          )
        : null
  };
}

/**
 * Time and dollar utilization of the rental fleet over `[from, to]`
 * (inclusive `YYYY-MM-DD`). Per fleet asset:
 * - fleet days: `[acquisitionDate, disposalDate ?? to] ∩ [from, to]`;
 * - on-rent days: the union of its agreement lines'
 *   `[deliveredAt, returnedAt ?? to]`, clipped to the fleet window;
 * - recognized income: Posted recognition schedule rows of its lines dated in
 *   the range that credit Rental Income or Lease Interest Income, plus posted
 *   Charge invoice lines (recognized when billed, never scheduled);
 * - dollar utilization: recognized income × (365 ÷ range days) ÷ cost.
 * Every table is read once for the company; the join happens here.
 */
export async function getRentalUtilization(
  client: SupabaseClient<Database>,
  companyId: string,
  {
    from,
    to,
    fixedAssetClassId
  }: { from: string; to: string; fixedAssetClassId?: string | null }
): Promise<{
  data: RentalUtilization | null;
  error: PostgrestError | null;
}> {
  if (to < from) {
    return { data: { rangeDays: 0, assets: [], classTotals: [] }, error: null };
  }
  const range: DateInterval = { start: from, end: to };
  const rangeDays = daysBetweenInclusive(from, to);

  const [assets, lines, defaults, schedules, charges] = await Promise.all([
    fetchAllFromTable<{
      id: string;
      fixedAssetId: string;
      name: string;
      serialNumber: string | null;
      fixedAssetClassId: string;
      className: string;
      acquisitionDate: string | null;
      acquisitionCost: number | null;
      disposalDate: string | null;
    }>(
      client,
      "fleetAssets",
      "id, fixedAssetId, name, serialNumber, fixedAssetClassId, className, acquisitionDate, acquisitionCost, disposalDate",
      (query: any) => {
        let q = query
          .eq("companyId", companyId)
          .neq("status", "Under Construction")
          .not("acquisitionDate", "is", null)
          .lte("acquisitionDate", to)
          .or(`disposalDate.is.null,disposalDate.gte.${from}`);
        if (fixedAssetClassId) q = q.eq("fixedAssetClassId", fixedAssetClassId);
        return q.order("id", { ascending: true });
      }
    ),
    // Every fleet line, not only those on rent in the range: a Charge billed
    // after the unit came back still belongs to the unit.
    fetchAllFromTable<{
      id: string;
      fixedAssetId: string;
      deliveredAt: string | null;
      returnedAt: string | null;
    }>(
      client,
      "rentalAgreementLine",
      "id, fixedAssetId, deliveredAt, returnedAt",
      (query: any) =>
        query
          .eq("companyId", companyId)
          .not("fixedAssetId", "is", null)
          .order("id", { ascending: true })
    ),
    client
      .from("accountDefault")
      .select("rentalIncomeAccount, leaseInterestIncomeAccount")
      .eq("companyId", companyId)
      .maybeSingle(),
    fetchAllFromTable<{
      rentalAgreementLineId: string;
      creditAccountId: string;
      amount: number;
    }>(
      client,
      "revenueRecognitionSchedule",
      "rentalAgreementLineId, creditAccountId, amount",
      (query: any) =>
        query
          .eq("companyId", companyId)
          .eq("status", "Posted")
          .not("rentalAgreementLineId", "is", null)
          .gte("scheduledDate", from)
          .lte("scheduledDate", to)
          .order("id", { ascending: true })
    ),
    fetchAllFromTable<{
      rentalAgreementLineId: string;
      quantity: number;
      unitPrice: number;
      discountPercent: number;
      addOnCost: number;
      nonTaxableAddOnCost: number;
    }>(
      client,
      "salesInvoiceLine",
      "rentalAgreementLineId, quantity, unitPrice, discountPercent, addOnCost, nonTaxableAddOnCost, salesInvoice!inner(status, postingDate)",
      (query: any) =>
        query
          .eq("companyId", companyId)
          .eq("invoiceLineType", "Rental")
          .eq("rentalLineType", "Charge")
          .not("rentalAgreementLineId", "is", null)
          .not("salesInvoice.status", "in", '("Draft","Pending","Voided")')
          .gte("salesInvoice.postingDate", from)
          .lte("salesInvoice.postingDate", to)
          .order("id", { ascending: true })
    )
  ]);
  for (const result of [assets, lines, defaults, schedules, charges]) {
    if (result.error) return { data: null, error: result.error };
  }

  const incomeAccounts = new Set(
    [
      defaults.data?.rentalIncomeAccount,
      defaults.data?.leaseInterestIncomeAccount
    ].filter((id): id is string => !!id)
  );

  const assetIdByLine = new Map<string, string>();
  const linesByAsset = new Map<string, typeof lines.data>();
  for (const line of lines.data ?? []) {
    assetIdByLine.set(line.id, line.fixedAssetId);
    const list = linesByAsset.get(line.fixedAssetId) ?? [];
    list.push(line);
    linesByAsset.set(line.fixedAssetId, list);
  }

  // Accumulate at full precision; round once per asset.
  const incomeByAsset = new Map<string, number>();
  const addIncome = (lineId: string, amount: number) => {
    const assetId = assetIdByLine.get(lineId);
    if (!assetId) return;
    incomeByAsset.set(assetId, (incomeByAsset.get(assetId) ?? 0) + amount);
  };
  for (const row of schedules.data ?? []) {
    if (incomeAccounts.has(row.creditAccountId)) {
      addIncome(row.rentalAgreementLineId, row.amount);
    }
  }
  // The same base the posting's revenue leg uses (sales-posting-amounts.ts):
  // merchandise net of the line discount, add-ons undiscounted.
  for (const line of charges.data ?? []) {
    addIncome(
      line.rentalAgreementLineId,
      line.quantity * line.unitPrice * (1 - (line.discountPercent ?? 0)) +
        (line.addOnCost ?? 0) +
        (line.nonTaxableAddOnCost ?? 0)
    );
  }

  const rows: RentalUtilizationRow[] = [];
  for (const asset of assets.data ?? []) {
    if (!asset.acquisitionDate) continue;
    const fleetWindow = intersectDateIntervals(
      { start: asset.acquisitionDate, end: asset.disposalDate ?? to },
      range
    );
    const fleetDays = fleetWindow
      ? daysBetweenInclusive(fleetWindow.start, fleetWindow.end)
      : 0;

    const onRent: DateInterval[] = [];
    if (fleetWindow) {
      for (const line of linesByAsset.get(asset.id) ?? []) {
        if (!line.deliveredAt) continue;
        const interval = intersectDateIntervals(
          { start: line.deliveredAt, end: line.returnedAt ?? to },
          fleetWindow
        );
        if (interval) onRent.push(interval);
      }
    }
    const onRentDays = daysCoveredByIntervals(onRent);
    const recognizedIncome = round(incomeByAsset.get(asset.id) ?? 0);
    const acquisitionCost = asset.acquisitionCost ?? 0;
    if (fleetDays === 0 && recognizedIncome === 0) continue;

    rows.push({
      id: asset.id,
      fixedAssetId: asset.fixedAssetId,
      name: asset.name,
      serialNumber: asset.serialNumber,
      fixedAssetClassId: asset.fixedAssetClassId,
      className: asset.className,
      acquisitionCost,
      fleetDays,
      onRentDays,
      recognizedIncome,
      ...utilizationRatios(
        { fleetDays, onRentDays, recognizedIncome, acquisitionCost },
        rangeDays
      )
    });
  }

  rows.sort((a, b) => {
    if (a.className !== b.className) return a.className < b.className ? -1 : 1;
    return a.fixedAssetId < b.fixedAssetId ? -1 : 1;
  });

  const totalsByClass = new Map<string, RentalUtilizationTotals>();
  for (const row of rows) {
    const existing = totalsByClass.get(row.fixedAssetClassId);
    if (existing) {
      existing.acquisitionCost += row.acquisitionCost;
      existing.fleetDays += row.fleetDays;
      existing.onRentDays += row.onRentDays;
      existing.recognizedIncome += row.recognizedIncome;
    } else {
      totalsByClass.set(row.fixedAssetClassId, {
        fixedAssetClassId: row.fixedAssetClassId,
        className: row.className,
        acquisitionCost: row.acquisitionCost,
        fleetDays: row.fleetDays,
        onRentDays: row.onRentDays,
        recognizedIncome: row.recognizedIncome,
        timeUtilization: null,
        dollarUtilization: null
      });
    }
  }
  const classTotals = [...totalsByClass.values()].map((total) => {
    const rounded = {
      ...total,
      acquisitionCost: round(total.acquisitionCost),
      recognizedIncome: round(total.recognizedIncome)
    };
    return { ...rounded, ...utilizationRatios(rounded, rangeDays) };
  });

  return { data: { rangeDays, assets: rows, classTotals }, error: null };
}

export type LeaseNetInvestmentRow = {
  /** `rentalAgreementLine.id`. */
  id: string;
  rentalAgreementId: string;
  /** The readable RA number. */
  rentalAgreementReadableId: string | null;
  customerName: string | null;
  fixedAssetId: string | null;
  unit: string;
  serialNumber: string | null;
  status: Database["public"]["Enums"]["rentalAgreementLineStatus"];
  initialNetInvestment: number;
  /** Σ principal of the schedule lines posted and dated on or before asOf. */
  postedPrincipal: number;
  currentNetInvestment: number;
  nextInterestDate: string | null;
  nextInterestAmount: number | null;
  /** Undiscounted payments still to come, by fiscal year. */
  maturityByFiscalYear: Record<number, number>;
  /** What the schedule closes on at term end: purchase option + residuals. */
  closingTarget: number;
};

export type LeaseNetInvestment = {
  asOf: string;
  /** Every fiscal year any row has a payment in, ascending. */
  fiscalYears: number[];
  rows: LeaseNetInvestmentRow[];
};

/**
 * The lessor's net investment in sales-type leases as of `asOf` (spec §4).
 * Per commenced Sale line still live on that date (Pending / On Rent,
 * or returned after it): the net investment at commencement, less the
 * principal of every schedule line the recognition run has posted up to
 * `asOf`, the next interest the run will post, and the undiscounted payments
 * still to come bucketed by fiscal year (the ASC 842 maturity analysis). A
 * Sold line has no net investment left and is omitted. One read per table
 * for the company; the join happens here.
 */
export async function getLeaseNetInvestment(
  client: SupabaseClient<Database>,
  companyId: string,
  { asOf }: { asOf: string }
): Promise<{
  data: LeaseNetInvestment | null;
  error: PostgrestError | null;
}> {
  const [lines, schedule, fiscalYear] = await Promise.all([
    fetchAllFromTable<{
      id: string;
      rentalAgreementId: string;
      status: Database["public"]["Enums"]["rentalAgreementLineStatus"];
      returnedAt: string | null;
      initialNetInvestment: number;
      fixedAssetId: string | null;
      fixedAsset: {
        fixedAssetId: string | null;
        name: string | null;
        serialNumber: string | null;
      } | null;
      item: { readableIdWithRevision: string | null } | null;
    }>(
      client,
      "rentalAgreementLine",
      "id, rentalAgreementId, status, returnedAt, initialNetInvestment, fixedAssetId, fixedAsset(fixedAssetId, name, serialNumber), item(readableIdWithRevision)",
      (query: any) =>
        query
          .eq("companyId", companyId)
          .eq("lessorClassification", "Sale")
          .not("initialNetInvestment", "is", null)
          .neq("status", "Sold")
          .order("id", { ascending: true })
    ),
    fetchAllFromTable<{
      rentalAgreementLineId: string;
      periodDate: string;
      paymentAmount: number;
      interestAmount: number;
      principalAmount: number;
      closingNetInvestment: number;
      postedAt: string | null;
    }>(
      client,
      "rentalLeaseScheduleLine",
      "rentalAgreementLineId, periodDate, paymentAmount, interestAmount, principalAmount, closingNetInvestment, postedAt",
      (query: any) =>
        query.eq("companyId", companyId).order("id", { ascending: true })
    ),
    client
      .from("fiscalYearSettings")
      .select("startMonth")
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  for (const result of [lines, schedule, fiscalYear]) {
    if (result.error) return { data: null, error: result.error };
  }

  // Live on `asOf`: not yet returned, or returned after it.
  const liveLines = (lines.data ?? []).filter(
    (line) =>
      line.status === "Pending" ||
      line.status === "On Rent" ||
      (line.status === "Returned" &&
        (!line.returnedAt || line.returnedAt.slice(0, 10) > asOf))
  );
  if (liveLines.length === 0) {
    return { data: { asOf, fiscalYears: [], rows: [] }, error: null };
  }

  const agreementIds = [
    ...new Set(liveLines.map((line) => line.rentalAgreementId))
  ];
  const agreements = await client
    .from("rentalAgreements")
    .select("id, rentalAgreementId, customerName, startDate")
    .eq("companyId", companyId)
    .in("id", agreementIds);
  if (agreements.error) return { data: null, error: agreements.error };
  const agreementById = new Map(
    (agreements.data ?? []).map((agreement) => [agreement.id, agreement])
  );

  const startMonth = fiscalYear.data?.startMonth
    ? (MONTH_NUMBER[fiscalYear.data.startMonth] ?? 1)
    : 1;

  const scheduleByLine = new Map<string, NonNullable<typeof schedule.data>>();
  for (const row of schedule.data ?? []) {
    const list = scheduleByLine.get(row.rentalAgreementLineId) ?? [];
    list.push(row);
    scheduleByLine.set(row.rentalAgreementLineId, list);
  }

  const fiscalYears = new Set<number>();
  const rows: LeaseNetInvestmentRow[] = [];
  for (const line of liveLines) {
    const agreement = agreementById.get(line.rentalAgreementId);
    // Not commenced yet on `asOf`.
    if (!agreement?.startDate || agreement.startDate > asOf) continue;

    const lineSchedule = [...(scheduleByLine.get(line.id) ?? [])].sort(
      (a, b) => (a.periodDate < b.periodDate ? -1 : 1)
    );

    // Accumulate at full precision; round once per figure.
    let postedPrincipal = 0;
    let next: (typeof lineSchedule)[number] | null = null;
    const maturity: Record<number, number> = {};
    for (const row of lineSchedule) {
      // A line's principal is collected once its Interest row has posted —
      // or, for a line that earns no interest (a 0 % lease, the last line of
      // an Advance lease closing on zero), once its period date passes: it
      // has no Interest row to post, and its rent invoice alone reduces the
      // net investment.
      const collected = row.postedAt || !earnsInterest(row.interestAmount);
      if (collected && row.periodDate <= asOf) {
        postedPrincipal += row.principalAmount;
        continue;
      }
      next ??= row;
      const { fiscalYear: year } = fiscalYearAndPeriodFor(
        Number(row.periodDate.slice(0, 4)),
        Number(row.periodDate.slice(5, 7)),
        startMonth
      );
      fiscalYears.add(year);
      maturity[year] = (maturity[year] ?? 0) + row.paymentAmount;
    }
    for (const year of Object.keys(maturity)) {
      maturity[Number(year)] = round(maturity[Number(year)]);
    }

    const initialNetInvestment = line.initialNetInvestment ?? 0;
    rows.push({
      id: line.id,
      rentalAgreementId: line.rentalAgreementId,
      rentalAgreementReadableId: agreement.rentalAgreementId,
      customerName: agreement.customerName,
      fixedAssetId: line.fixedAssetId,
      unit:
        [line.fixedAsset?.fixedAssetId, line.fixedAsset?.name]
          .filter(Boolean)
          .join(" · ") ||
        line.item?.readableIdWithRevision ||
        "",
      serialNumber: line.fixedAsset?.serialNumber ?? null,
      status: line.status,
      initialNetInvestment,
      postedPrincipal: round(postedPrincipal),
      currentNetInvestment: round(initialNetInvestment - postedPrincipal),
      nextInterestDate: next?.periodDate ?? null,
      nextInterestAmount: next?.interestAmount ?? null,
      maturityByFiscalYear: maturity,
      closingTarget: lineSchedule.at(-1)?.closingNetInvestment ?? 0
    });
  }

  rows.sort((a, b) => {
    const left = a.rentalAgreementReadableId ?? "";
    const right = b.rentalAgreementReadableId ?? "";
    if (left !== right) return left < right ? -1 : 1;
    return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0;
  });

  return {
    data: {
      asOf,
      fiscalYears: [...fiscalYears].sort((a, b) => a - b),
      rows
    },
    error: null
  };
}

export type LeaseLiabilities = LeaseLiabilitySummary & {
  from: string;
  to: string;
  costs: LeaseCostSummary;
  /** The latest lessee month a lease run posted; null before the first. */
  leaseRunPostedThrough: string | null;
  /** The earliest lessee month due by `asOf` that no lease run has posted;
   *  null when every one has. */
  firstUnpostedLeaseMonth: string | null;
};

/**
 * The lessee's Lease Liabilities report (spec §11, ASC 842-20-50): the
 * balances, maturity analysis and weighted averages as of `asOf`
 * (`summarizeLeaseLiabilities`), and the lease cost and cash paid for
 * `[from, to]` (`summarizeLeaseCosts`). `from` defaults to the first day of
 * the fiscal year `asOf` falls in, `to` to `asOf`. Cost reads the lease rows
 * the lease run posted (status Posted, dated in the range) and the Lease
 * lines of posted purchase invoices (posting date in the range). Schedule
 * lines, payments and events are read for the Operating and Finance assets
 * of leases past Draft only, every read paged. Reads the lease tables, whose
 * RLS is `purchasing_view` — a caller without purchasing view gets an empty
 * report, so the report route requires it.
 */
export async function getLeaseLiabilities(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { asOf: string; from?: string; to?: string }
): Promise<{
  data: LeaseLiabilities | null;
  error: PostgrestError | null;
}> {
  const { asOf } = args;
  const fiscalYear = await client
    .from("fiscalYearSettings")
    .select("startMonth")
    .eq("companyId", companyId)
    .maybeSingle();
  if (fiscalYear.error) return { data: null, error: fiscalYear.error };
  const startMonth = fiscalYear.data?.startMonth
    ? (MONTH_NUMBER[fiscalYear.data.startMonth] ?? 1)
    : 1;

  // The fiscal year `asOf` falls in starts in `startMonth` of this calendar
  // year, or of the year before when `asOf` is earlier in the calendar year.
  const asOfDate = parseDate(asOf);
  const fiscalYearStart = asOfDate
    .set({ month: startMonth, day: 1 })
    .subtract({ years: asOfDate.month >= startMonth ? 0 : 1 })
    .toString();
  const from = args.from ?? fiscalYearStart;
  const to = args.to ?? asOf;

  const [
    leases,
    assets,
    scheduleRows,
    invoiceLines,
    postedThrough,
    firstUnposted
  ] = await Promise.all([
    fetchAllRecords(() =>
      client
        .from("lease")
        .select(
          "id, leaseId, name, status, commencementDate, discountRate, supplier(name)"
        )
        .eq("companyId", companyId)
        .not("status", "in", '("Draft","Cancelled")')
        .order("id", { ascending: true })
    ),
    fetchAllRecords(() =>
      client
        .from("leaseLine")
        .select(
          "id, leaseId, description, status, lesseeClassification, initialLiability, initialRouAsset"
        )
        .eq("companyId", companyId)
        .not("lesseeClassification", "is", null)
        .order("id", { ascending: true })
    ),
    fetchAllRecords(() =>
      client
        .from("revenueRecognitionSchedule")
        .select(
          "type, amount, leaseScheduleLine!revenueRecognitionSchedule_leaseScheduleLine_fkey(leaseLineId)"
        )
        .eq("companyId", companyId)
        .not("leaseId", "is", null)
        .eq("status", "Posted")
        .gte("scheduledDate", from)
        .lte("scheduledDate", to)
        .order("id", { ascending: true })
    ),
    // Typed by hand: the inferred type of this embed is too deep for tsc.
    fetchAllFromTable<{
      leasePaymentId: string | null;
      extendedPrice: number | null;
      leasePayment: { leaseLineId: string } | null;
    }>(
      client,
      "purchaseInvoiceLine",
      "leasePaymentId, extendedPrice, purchaseInvoice!inner(status, postingDate), leasePayment!purchaseInvoiceLine_leasePayment_fkey(leaseLineId)",
      (query: any) =>
        query
          .eq("companyId", companyId)
          .eq("invoiceLineType", "Lease")
          .not("leaseId", "is", null)
          .not("purchaseInvoice.status", "in", '("Draft","Pending","Voided")')
          .gte("purchaseInvoice.postingDate", from)
          .lte("purchaseInvoice.postingDate", to)
          .order("id", { ascending: true })
    ),
    // The figures are the schedule's. When a lessee month due by `asOf` is
    // not posted yet, the report says how far the lease run has posted.
    client
      .from("revenueRecognitionSchedule")
      .select("scheduledDate")
      .eq("companyId", companyId)
      .not("leaseId", "is", null)
      .eq("status", "Posted")
      .order("scheduledDate", { ascending: false })
      .limit(1),
    client
      .from("revenueRecognitionSchedule")
      .select("scheduledDate")
      .eq("companyId", companyId)
      .not("leaseId", "is", null)
      .eq("status", "Planned")
      .lte("scheduledDate", asOf)
      .order("scheduledDate", { ascending: true })
      .limit(1)
  ]);
  for (const result of [
    leases,
    assets,
    scheduleRows,
    invoiceLines,
    postedThrough,
    firstUnposted
  ]) {
    if (result.error) return { data: null, error: result.error };
  }

  // Only an Operating or Finance asset of a lease past Draft (and not
  // Cancelled: its assets never were on the books) has a schedule and a
  // liability. Read the schedule lines, payments and events of those alone.
  const leaseRows = (leases.data ?? []).map(({ supplier, ...lease }) => ({
    ...lease,
    name: lease.name ?? "",
    supplierName: supplier?.name ?? null
  }));
  const readLeaseIds = new Set(leaseRows.map((lease) => lease.id));
  const capitalizedIds = (assets.data ?? [])
    .filter(
      (asset) =>
        readLeaseIds.has(asset.leaseId) &&
        (asset.lesseeClassification === "Operating" ||
          asset.lesseeClassification === "Finance")
    )
    .map((asset) => asset.id);
  const [lines, payments, events] = await Promise.all([
    fetchAllByIds(capitalizedIds, (batch) =>
      client
        .from("leaseScheduleLine")
        .select(
          "leaseLineId, periodDate, principalAmount, closingLiability, closingRouAsset"
        )
        .eq("companyId", companyId)
        .in("leaseLineId", batch)
        .order("id", { ascending: true })
    ),
    fetchAllByIds(capitalizedIds, (batch) =>
      client
        .from("leasePayment")
        .select("leaseLineId, dueDate, amount")
        .eq("companyId", companyId)
        .in("leaseLineId", batch)
        .order("id", { ascending: true })
    ),
    fetchAllByIds(capitalizedIds, (batch) =>
      client
        .from("leaseEvent")
        .select("leaseLineId, eventType, effectiveDate")
        .eq("companyId", companyId)
        .in("leaseLineId", batch)
        .in("eventType", ["Termination", "Purchase"])
        .order("id", { ascending: true })
    )
  ]);
  for (const result of [lines, payments, events]) {
    if (result.error) return { data: null, error: result.error };
  }

  // One entry per classified asset, with its lease's terms and its own end.
  const assetRows = leaseLiabilityAssets(
    leaseRows,
    assets.data ?? [],
    events.data ?? []
  );
  const summary = summarizeLeaseLiabilities(
    assetRows,
    lines.data ?? [],
    payments.data ?? [],
    { asOf, startMonth }
  );

  const classificationByAsset = new Map(
    assetRows.flatMap((asset) =>
      asset.classification
        ? [[asset.leaseLineId, asset.classification] as const]
        : []
    )
  );
  const costs = summarizeLeaseCosts(
    classificationByAsset,
    (scheduleRows.data ?? []).flatMap((row) =>
      row.leaseScheduleLine
        ? [
            {
              leaseLineId: row.leaseScheduleLine.leaseLineId,
              type: row.type,
              amount: row.amount
            }
          ]
        : []
    ),
    (invoiceLines.data ?? []).map((line) => ({
      leaseLineId: line.leasePayment?.leaseLineId ?? null,
      leasePaymentId: line.leasePaymentId,
      amount: line.extendedPrice ?? 0
    }))
  );

  return {
    data: {
      ...summary,
      from,
      to,
      costs,
      leaseRunPostedThrough: postedThrough.data?.[0]?.scheduledDate ?? null,
      firstUnpostedLeaseMonth: firstUnposted.data?.[0]?.scheduledDate ?? null
    },
    error: null
  };
}

// -- Depreciation History for a single asset --

export async function getAssetDepreciationHistory(
  client: SupabaseClient<Database>,
  fixedAssetId: string
) {
  return (
    client
      .from("depreciationRunLine")
      .select(
        "id, periodEnd, amount, taxAmount, journalId, depreciationRun:depreciationRunId(id, depreciationRunId, periodEnd, status)"
      )
      .eq("fixedAssetId", fixedAssetId)
      // A run holds one line per month; a line from before per-month lines has
      // no periodEnd (it is the run's), so callers sort by the month they show.
      .order("periodEnd", { ascending: false, nullsFirst: false })
  );
}

// -- Disposals --

export async function getFixedAssetDisposal(
  client: SupabaseClient<Database>,
  fixedAssetId: string
) {
  return client
    .from("fixedAssetDisposal")
    .select("*")
    .eq("fixedAssetId", fixedAssetId)
    .maybeSingle();
}

// -- Usage Logs --

export async function getFixedAssetUsageLogs(
  client: SupabaseClient<Database>,
  fixedAssetId: string
) {
  return client
    .from("fixedAssetUsageLog")
    .select("*")
    .eq("fixedAssetId", fixedAssetId)
    .order("periodEnd", { ascending: false });
}

/**
 * A usage log is a ledger: an "edit" is a new offsetting row, never an in-place
 * change, so `updatedBy` must stay NULL even though the column exists. If this
 * is ever exposed, declare `@mcp audit createdBy` alongside its verb.
 */
export async function upsertFixedAssetUsageLog(
  client: SupabaseClient<Database>,
  data: Record<string, any> & { companyId: string; createdBy: string }
) {
  return client
    .from("fixedAssetUsageLog")
    .insert([data as any])
    .select("id")
    .single();
}

// -- Fleet --

export async function getFleetAssets(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    fleetStatus: string | null;
  }
) {
  let query = client
    .from("fleetAssets")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,fixedAssetId.ilike.%${args.search}%,serialNumber.ilike.%${args.search}%,itemReadableId.ilike.%${args.search}%`
    );
  }

  if (args.fleetStatus) {
    query = query.eq("fleetStatus", args.fleetStatus);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "fixedAssetId", ascending: true }
  ]);
  return query;
}

export async function getUnderConstructionAssets(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fixedAsset")
    .select("id, fixedAssetId, name, acquisitionCost")
    .eq("companyId", companyId)
    .eq("status", "Under Construction")
    .order("fixedAssetId");
}

export async function getFixedAssetTransfers(
  client: SupabaseClient<Database>,
  fixedAssetId: string,
  companyId: string
) {
  return client
    .from("fixedAssetTransfer")
    .select("*")
    .eq("fixedAssetId", fixedAssetId)
    .eq("companyId", companyId)
    .order("transferDate", { ascending: false });
}

export async function getFixedAssetCipCosts(
  client: SupabaseClient<Database>,
  fixedAssetId: string,
  companyId: string
) {
  return client
    .from("fixedAssetCipCost")
    .select("*")
    .eq("fixedAssetId", fixedAssetId)
    .eq("companyId", companyId)
    .order("costDate");
}

function uniqueById<T extends { id: string }>(rows: (T | null | undefined)[]) {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (row && !byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * The documents around one fixed asset: the item and serial it is, the jobs
 * that built it, the purchase and sales documents with a line on it, the
 * rental agreements that rent it, and its disposal journal. One query per
 * table; the receipts and shipments follow from the order lines.
 */
export async function getFixedAssetRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    fixedAssetId: string;
    itemId: string | null;
    trackedEntityId: string | null;
    jobIds: string[];
    disposalJournalId: string | null;
  }
) {
  const { fixedAssetId, itemId, trackedEntityId, disposalJournalId } = args;
  const jobIds = [...new Set(args.jobIds)];

  // Three groups rather than one nine-query Promise.all: a single tuple of
  // nine PostgREST builders exceeds TypeScript's instantiation depth.
  const [
    [purchaseOrderLines, purchaseInvoiceLines, salesOrderLines],
    [salesInvoiceLines, rentalAgreementLines, jobs],
    [item, trackedEntity, disposalJournal]
  ] = await Promise.all([
    Promise.all([
      client
        .from("purchaseOrderLine")
        .select("id, purchaseOrder(id, purchaseOrderId, status, supplierId)")
        .eq("assetId", fixedAssetId)
        .eq("companyId", companyId),
      client
        .from("purchaseInvoiceLine")
        // The invoice is read in the second round: embedding it here sends
        // the type checker past its instantiation depth.
        .select("invoiceId")
        .eq("assetId", fixedAssetId)
        .eq("companyId", companyId),
      client
        .from("salesOrderLine")
        .select("id, salesOrder(id, salesOrderId, status, customerId)")
        .eq("assetId", fixedAssetId)
        .eq("companyId", companyId)
    ]),
    Promise.all([
      client
        .from("salesInvoiceLine")
        .select(
          "salesInvoice!salesInvoiceLine_invoiceId_fkey(id, invoiceId, status, customerId)"
        )
        .eq("assetId", fixedAssetId)
        .eq("companyId", companyId),
      client
        .from("rentalAgreementLine")
        .select("rentalAgreement(id, rentalAgreementId, status, customerId)")
        .eq("fixedAssetId", fixedAssetId)
        .eq("companyId", companyId),
      client
        .from("job")
        .select("id, jobId, status")
        .eq("companyId", companyId)
        .or(
          jobIds.length > 0
            ? `fixedAssetId.eq.${fixedAssetId},id.in.(${jobIds.join(",")})`
            : `fixedAssetId.eq.${fixedAssetId}`
        )
        .order("jobId")
    ]),
    Promise.all([
      itemId
        ? client
            .from("item")
            .select("id, readableIdWithRevision, name, type")
            .eq("id", itemId)
            .eq("companyId", companyId)
            .maybeSingle()
        : null,
      trackedEntityId
        ? client
            .from("trackedEntity")
            .select("id, readableId, status")
            .eq("id", trackedEntityId)
            .eq("companyId", companyId)
            .maybeSingle()
        : null,
      disposalJournalId
        ? client
            .from("journal")
            .select("id, journalEntryId, status")
            .eq("id", disposalJournalId)
            .eq("companyId", companyId)
            .maybeSingle()
        : null
    ])
  ]);

  const purchaseOrderLineIds = (purchaseOrderLines.data ?? []).map(
    (line) => line.id
  );
  const salesOrderLineIds = (salesOrderLines.data ?? []).map((line) => line.id);
  const purchaseInvoiceIds = [
    ...new Set(
      (purchaseInvoiceLines.data ?? [])
        .map((line) => line.invoiceId)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const [receiptLines, shipmentLines, purchaseInvoices] = await Promise.all([
    purchaseOrderLineIds.length > 0
      ? client
          .from("receiptFixedAssetLine")
          .select("receipt(id, receiptId, status)")
          .in("purchaseOrderLineId", purchaseOrderLineIds)
          .eq("companyId", companyId)
      : null,
    salesOrderLineIds.length > 0
      ? client
          .from("shipmentFixedAssetLine")
          .select("shipment(id, shipmentId, status, invoiced)")
          .in("salesOrderLineId", salesOrderLineIds)
          .eq("companyId", companyId)
      : null,
    purchaseInvoiceIds.length > 0
      ? client
          .from("purchaseInvoice")
          .select("id, invoiceId, status, supplierId")
          .in("id", purchaseInvoiceIds)
          .eq("companyId", companyId)
      : null
  ]);

  return {
    item: item?.data ?? null,
    trackedEntity: trackedEntity?.data ?? null,
    jobs: jobs.data ?? [],
    purchaseOrders: uniqueById(
      (purchaseOrderLines.data ?? []).map((line) => line.purchaseOrder)
    ),
    receipts: uniqueById(
      (receiptLines?.data ?? []).map((line) => line.receipt)
    ),
    purchaseInvoices: purchaseInvoices?.data ?? [],
    rentalAgreements: uniqueById(
      (rentalAgreementLines.data ?? []).map((line) => line.rentalAgreement)
    ),
    salesOrders: uniqueById(
      (salesOrderLines.data ?? []).map((line) => line.salesOrder)
    ),
    shipments: uniqueById(
      (shipmentLines?.data ?? []).map((line) => line.shipment)
    ),
    salesInvoices: uniqueById(
      (salesInvoiceLines.data ?? []).map((line) => line.salesInvoice)
    ),
    disposalJournal: disposalJournal?.data ?? null
  };
}

/**
 * The capital tied up in a work center: every non-disposed asset assigned to
 * it, with its net book value and — for straight-line assets — the
 * depreciation it carries each month.
 */
export async function getWorkCenterCapitalCost(
  client: SupabaseClient<Database>,
  workCenterId: string,
  companyId: string
) {
  const assets = await client
    .from("fixedAsset")
    .select(
      "id, fixedAssetId, name, status, acquisitionCost, accumulatedDepreciation, depreciationMethod, usefulLifeMonths, residualValuePercent"
    )
    .eq("workCenterId", workCenterId)
    .eq("companyId", companyId)
    .neq("status", "Disposed");

  if (assets.error) return { data: null, error: assets.error };

  return {
    data: assets.data.map((asset) => ({
      ...asset,
      netBookValue: asset.acquisitionCost - asset.accumulatedDepreciation,
      monthlyDepreciation:
        asset.depreciationMethod === "Straight Line" && asset.usefulLifeMonths
          ? round(
              (asset.acquisitionCost * (1 - asset.residualValuePercent / 100)) /
                asset.usefulLifeMonths
            )
          : null
    })),
    error: null
  };
}

/** Not published: `accounting_takeFixedAssetOutOfService` runs it, with the on-rent and disposed checks this skips. */
export async function setFixedAssetOutOfService(
  client: SupabaseClient<Database>,
  {
    id,
    companyId,
    reason,
    since,
    updatedBy
  }: {
    id: string;
    companyId: string;
    reason: string;
    since: string;
    updatedBy: string;
  }
) {
  return (
    client
      .from("fixedAsset")
      .update({
        outOfServiceSince: since,
        outOfServiceReason: reason,
        updatedBy
      })
      .eq("id", id)
      .eq("companyId", companyId)
      // Never a disposed asset, and never overwrite the date an asset already
      // out of service went out: either matches no row, and `.single()` errors.
      .neq("status", "Disposed")
      .is("outOfServiceSince", null)
      .select("id")
      .single()
  );
}

/** Not published: `accounting_returnFixedAssetToService` runs it. */
export async function returnFixedAssetToService(
  client: SupabaseClient<Database>,
  {
    id,
    companyId,
    updatedBy
  }: { id: string; companyId: string; updatedBy: string }
) {
  return client
    .from("fixedAsset")
    .update({
      outOfServiceSince: null,
      outOfServiceReason: null,
      updatedBy
    })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/** Capitalize a unit, return an asset to inventory, attach a job to a CIP
 *  asset or capitalize a CIP asset (`postAssetTransfer`), run as the caller:
 *  the caller holds the transfer's permission, and `update: accounting` too
 *  when a capitalization enters its own cost.
 */
export async function invokeAssetTransfer(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: z.input<typeof postAssetTransferInput> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, ...transfer } = args;
  return invokePosting(
    { client, db, companyId, userId },
    "post-asset-transfer",
    transfer as z.input<typeof postAssetTransferInput>,
    postAssetTransfer,
    {
      as: (input) => {
        const required = resolvePermissions(postAssetTransferPermission, input);
        return input.type === "capitalize" &&
          input.cost != null &&
          required !== "system"
          ? { ...required, update: "accounting" }
          : required;
      }
    }
  );
}

/** The cost a serialized unit would be capitalized at
 *  (`previewAssetCapitalization`): the same relief as a capitalization, rolled
 *  back. */
export async function getCapitalizationCost(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; trackedEntityId: string }
) {
  const { companyId, userId, trackedEntityId } = args;
  return invokePosting(
    { client, db, companyId, userId },
    "preview-asset-capitalization",
    { trackedEntityId },
    previewAssetCapitalization,
    { as: previewAssetCapitalizationPermission }
  );
}

// /********************************************************\
// *        Posting-sync completeness (spec v3, I1)         *
// \********************************************************/

export type JournalSyncCompleteness = {
  totalJournals: number;
  dispositions: {
    /** Operation Completed — pushed (individually or inside a batch). */
    synced: number;
    /** Operation Pending / In Flight. */
    pending: number;
    /** Operation Failed / Warning (incl. decision-time DOC_SYNC_DISABLED). */
    blocked: number;
    /** Excluded by policy (FAMILY_OFF / SOURCE_TYPE_DISABLED / MANUAL_DISABLED). */
    excluded: number;
    /** Human opt-out. */
    skipped: number;
    /**
     * Excluded/DOC_BACKED — delivered only while the backing document
     * actually synced (external mapping exists); payments and
     * entity-synced inventory adjustments are provider-native and count
     * delivered by definition.
     */
    docBacked: { delivered: number; undelivered: number };
  };
  /** Posted journals with NO operation row — a missed event (backfill repair). */
  unaccountedJournalIds: string[];
  /** DOC_BACKED journals whose backing document has not reached the provider. */
  undeliveredDocBackedJournalIds: string[];
};

/**
 * The I1 completeness check: every Posted journal since the posting-sync
 * start date must carry exactly one recorded disposition in the
 * accountingSyncOperation ledger. The caller resolves posting-sync settings
 * (this module deliberately does not import @carbon/ee/accounting — see the
 * TS2589 notes in the settings Integrations components) and passes
 * syncFromDate explicitly.
 */
export async function getJournalSyncCompleteness(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    /** companyIntegration id, e.g. "xero" | "quickbooks" | "rillet". */
    integrationId: string;
    /** YYYY-MM-DD; journals dated before this are out of scope. */
    syncFromDate: string;
    /** Restrict to one accounting period (the close auto-check). */
    accountingPeriodId?: string;
  }
): Promise<{ data: JournalSyncCompleteness | null; error: string | null }> {
  const journals = await fetchAllFromTable<{
    id: string;
    sourceType: string | null;
  }>(client, "journal", "id, sourceType", (query: any) => {
    let filtered = query
      .eq("companyId", args.companyId)
      .in("status", ["Posted", "Reversed"])
      .is("reversalOfId", null)
      .gte("postingDate", args.syncFromDate);
    if (args.accountingPeriodId) {
      filtered = filtered.eq("accountingPeriodId", args.accountingPeriodId);
    }
    return filtered.order("id", { ascending: true });
  });
  if (journals.error) {
    return { data: null, error: journals.error.message };
  }

  const operations = await fetchAllFromTable<{
    entityId: string;
    status: string;
    errorCode: string | null;
    metadata: Json | null;
  }>(
    client,
    "accountingSyncOperation",
    "entityId, status, errorCode, metadata",
    (query: any) =>
      query
        .eq("companyId", args.companyId)
        .eq("integration", args.integrationId)
        .eq("entityType", "journalEntry")
  );
  if (operations.error) {
    return { data: null, error: operations.error.message };
  }

  // Original-push operations only: reversal ops (":reversal") supplement the
  // original's disposition, and "daily:" markers are batch bookkeeping
  const operationByJournalId = new Map<
    string,
    { status: string; errorCode: string | null; metadata: Json | null }
  >();
  for (const operation of operations.data ?? []) {
    if (operation.entityId.startsWith("daily:")) continue;
    if (operation.entityId.endsWith(":reversal")) continue;
    operationByJournalId.set(operation.entityId, operation);
  }

  const summary: JournalSyncCompleteness = {
    totalJournals: (journals.data ?? []).length,
    dispositions: {
      synced: 0,
      pending: 0,
      blocked: 0,
      excluded: 0,
      skipped: 0,
      docBacked: { delivered: 0, undelivered: 0 }
    },
    unaccountedJournalIds: [],
    undeliveredDocBackedJournalIds: []
  };

  // DOC_BACKED journals whose backing entity is a Carbon-pushed document
  // (invoice/bill) must have that document actually synced to count as
  // delivered — collect them for the mapping check below
  const docBackedByJournalId = new Map<string, "invoice" | "bill">();

  for (const journal of journals.data ?? []) {
    const operation = operationByJournalId.get(journal.id);
    if (!operation) {
      summary.unaccountedJournalIds.push(journal.id);
      continue;
    }

    switch (operation.status) {
      case "Completed":
        summary.dispositions.synced++;
        break;
      case "Pending":
      case "In Flight":
        summary.dispositions.pending++;
        break;
      case "Failed":
      case "Warning":
        summary.dispositions.blocked++;
        break;
      case "Skipped":
        summary.dispositions.skipped++;
        break;
      case "Excluded": {
        if (operation.errorCode === "DOC_BACKED") {
          const backing =
            operation.metadata &&
            typeof operation.metadata === "object" &&
            !Array.isArray(operation.metadata)
              ? (operation.metadata as Record<string, unknown>).backingDocument
              : null;
          const backingEntityType =
            backing && typeof backing === "object" && !Array.isArray(backing)
              ? (backing as Record<string, unknown>).entityType
              : null;
          if (backingEntityType === "invoice" || backingEntityType === "bill") {
            docBackedByJournalId.set(journal.id, backingEntityType);
          } else {
            // payment / inventoryAdjustment: provider-native representation
            summary.dispositions.docBacked.delivered++;
          }
        } else {
          summary.dispositions.excluded++;
        }
        break;
      }
      default:
        summary.dispositions.blocked++;
        break;
    }
  }

  if (docBackedByJournalId.size > 0) {
    const journalIds = [...docBackedByJournalId.keys()];
    const CHUNK = 300;

    // journal → backing document id via the lines' document linkage
    const documentIdByJournalId = new Map<string, string>();
    for (let i = 0; i < journalIds.length; i += CHUNK) {
      const chunk = journalIds.slice(i, i + CHUNK);
      const lines = await client
        .from("journalLine")
        .select("journalId, documentId")
        .eq("companyId", args.companyId)
        .in("journalId", chunk)
        .not("documentId", "is", null);
      if (lines.error) {
        return { data: null, error: lines.error.message };
      }
      for (const line of lines.data ?? []) {
        if (line.journalId && line.documentId) {
          documentIdByJournalId.set(line.journalId, line.documentId);
        }
      }
    }

    const documentIds = [...new Set(documentIdByJournalId.values())];
    const syncedDocumentIds = new Set<string>();
    for (let i = 0; i < documentIds.length; i += CHUNK) {
      const chunk = documentIds.slice(i, i + CHUNK);
      const mappings = await client
        .from("externalIntegrationMapping")
        .select("entityId")
        .eq("companyId", args.companyId)
        .eq("integration", args.integrationId)
        .in("entityType", ["invoice", "bill"])
        .in("entityId", chunk)
        .not("externalId", "is", null);
      if (mappings.error) {
        return { data: null, error: mappings.error.message };
      }
      for (const mapping of mappings.data ?? []) {
        syncedDocumentIds.add(mapping.entityId);
      }
    }

    for (const journalId of journalIds) {
      const documentId = documentIdByJournalId.get(journalId);
      if (documentId && syncedDocumentIds.has(documentId)) {
        summary.dispositions.docBacked.delivered++;
      } else {
        summary.dispositions.docBacked.undelivered++;
        summary.undeliveredDocBackedJournalIds.push(journalId);
      }
    }
  }

  return { data: summary, error: null };
}

// /********************************************************\
// *        Sync tie-out (spec v3 §5, delivered v4 P3)      *
// \********************************************************/

/**
 * One (integration × accounting period × account) tie-out cell, written by
 * the tie-out cron. Amounts are net debit-signed. The invariant per cell:
 * carbonPostedAmount = syncedAmount + docBackedAmount + excludedAmount +
 * pendingAmount + blockedAmount (internalDelta) and syncedAmount =
 * providerAmount (externalDelta, null until the provider side is fetched).
 * The table is not in the generated DB types yet, so the query builder is
 * cast and the row payload typed locally — same pattern as
 * @carbon/ee/accounting core/operations.ts.
 */
export type AccountingSyncTieOutCell = {
  id: string;
  companyId: string;
  integration: string;
  accountingPeriodId: string;
  accountId: string;
  carbonPostedAmount: number;
  syncedAmount: number;
  docBackedAmount: number;
  excludedAmount: number;
  pendingAmount: number;
  blockedAmount: number;
  providerAmount: number | null;
  internalDelta: number;
  externalDelta: number | null;
  computedAt: string;
};

export type AccountingSyncTieOutListItem = AccountingSyncTieOutCell & {
  account: { number: string | null; name: string } | null;
  accountingPeriod: {
    startDate: string;
    endDate: string;
    fiscalYear: number | null;
    periodNumber: number | null;
  } | null;
};

/** Attach account (number/name) + period identity to raw tie-out rows. */
async function joinTieOutCells(
  client: SupabaseClient<Database>,
  companyId: string,
  cells: AccountingSyncTieOutCell[]
): Promise<{
  data: AccountingSyncTieOutListItem[] | null;
  error: PostgrestError | null;
}> {
  if (cells.length === 0) {
    return { data: [], error: null };
  }

  const accountIds = [...new Set(cells.map((cell) => cell.accountId))];
  const periodIds = [...new Set(cells.map((cell) => cell.accountingPeriodId))];

  const [accounts, periods] = await Promise.all([
    client.from("account").select("id, number, name").in("id", accountIds),
    client
      .from("accountingPeriod")
      .select("id, startDate, endDate, fiscalYear, periodNumber")
      .eq("companyId", companyId)
      .in("id", periodIds)
  ]);
  if (accounts.error) return { data: null, error: accounts.error };
  if (periods.error) return { data: null, error: periods.error };

  const accountById = new Map(
    (accounts.data ?? []).map((account) => [account.id, account])
  );
  const periodById = new Map(
    (periods.data ?? []).map((period) => [period.id, period])
  );

  return {
    data: cells.map((cell) => {
      const account = accountById.get(cell.accountId);
      const period = periodById.get(cell.accountingPeriodId);
      return {
        ...cell,
        account: account
          ? { number: account.number, name: account.name }
          : null,
        accountingPeriod: period
          ? {
              startDate: period.startDate,
              endDate: period.endDate,
              fiscalYear: period.fiscalYear,
              periodNumber: period.periodNumber
            }
          : null
      };
    }),
    error: null
  };
}

/**
 * The tie-out grid: every persisted cell for the company, joined with
 * account and period identity, newest period first. Optional filters narrow
 * to one integration and/or one accounting period.
 */
export async function getAccountingSyncTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: {
    integration?: string | string[] | null;
    accountingPeriodId?: string | null;
    accountId?: string | string[] | null;
  }
): Promise<{
  data: AccountingSyncTieOutListItem[] | null;
  error: PostgrestError | null;
}> {
  const rows = await fetchAllFromTable<AccountingSyncTieOutCell>(
    client,
    "accountingSyncTieOut" as any,
    "*",
    (query: any) => {
      let filtered = query.eq("companyId", companyId);
      if (args?.integration) {
        filtered = Array.isArray(args.integration)
          ? filtered.in("integration", args.integration)
          : filtered.eq("integration", args.integration);
      }
      if (args?.accountingPeriodId) {
        filtered = filtered.eq("accountingPeriodId", args.accountingPeriodId);
      }
      if (args?.accountId) {
        filtered = Array.isArray(args.accountId)
          ? filtered.in("accountId", args.accountId)
          : filtered.eq("accountId", args.accountId);
      }
      return filtered.order("id", { ascending: true });
    }
  );
  if (rows.error) return { data: null, error: rows.error };

  const joined = await joinTieOutCells(client, companyId, rows.data ?? []);
  if (joined.error || !joined.data) return joined;

  // Newest period first, then account number, then integration.
  const sorted = [...joined.data].sort((a, b) => {
    const aStart = a.accountingPeriod?.startDate ?? "";
    const bStart = b.accountingPeriod?.startDate ?? "";
    if (aStart !== bStart) return aStart < bStart ? 1 : -1;
    const aAccount = a.account?.number ?? a.account?.name ?? "";
    const bAccount = b.account?.number ?? b.account?.name ?? "";
    if (aAccount !== bAccount) return aAccount < bAccount ? -1 : 1;
    if (a.integration !== b.integration) {
      return a.integration < b.integration ? -1 : 1;
    }
    return 0;
  });

  return { data: sorted, error: null };
}

/** A posted journal behind a tie-out cell, with its sync disposition. */
export type AccountingSyncTieOutJournal = {
  id: string;
  journalEntryId: string;
  postingDate: string;
  sourceType: string | null;
  status: string;
  /** Net debit-signed amount of this journal's lines on the cell's account. */
  accountAmount: number;
  /** Latest sync operation status; null = no operation row recorded. */
  syncStatus: string | null;
};

export type AccountingSyncTieOutCellDetail = {
  cell: AccountingSyncTieOutListItem;
  journals: AccountingSyncTieOutJournal[];
  /** True when more than TIE_OUT_CELL_JOURNAL_LIMIT journals matched. */
  truncated: boolean;
};

const TIE_OUT_CELL_JOURNAL_LIMIT = 200;

/**
 * One tie-out cell plus its drill-down: the posted journals dated inside
 * the cell's period with at least one line on the cell's account, each with
 * the latest accountingSyncOperation disposition for the cell's
 * integration. A reversal journal's disposition lives under the original
 * journal's "<id>:reversal" entity id (see getJournalSyncCompleteness).
 * Bounded to the newest TIE_OUT_CELL_JOURNAL_LIMIT journals.
 */
export async function getAccountingSyncTieOutCell(
  client: SupabaseClient<Database>,
  companyId: string,
  cellId: string
): Promise<{
  data: AccountingSyncTieOutCellDetail | null;
  error: PostgrestError | { message: string } | null;
}> {
  const cellResult = await (client.from("accountingSyncTieOut" as any) as any)
    .select("*")
    .eq("companyId", companyId)
    .eq("id", cellId)
    .single();
  if (cellResult.error || !cellResult.data) {
    return {
      data: null,
      error: cellResult.error ?? { message: "Tie-out cell not found" }
    };
  }

  const joined = await joinTieOutCells(client, companyId, [
    cellResult.data as AccountingSyncTieOutCell
  ]);
  if (joined.error || !joined.data) {
    return { data: null, error: joined.error };
  }
  const cell = joined.data[0];
  if (!cell) {
    return { data: null, error: { message: "Tie-out cell not found" } };
  }
  const period = cell.accountingPeriod;
  if (!period) {
    return {
      data: null,
      error: { message: "Accounting period not found for tie-out cell" }
    };
  }

  const journalsResult = await client
    .from("journal")
    .select(
      "id, journalEntryId, postingDate, sourceType, status, reversalOfId, journalLine!inner(accountId)"
    )
    .eq("companyId", companyId)
    .in("status", ["Posted", "Reversed"])
    .gte("postingDate", period.startDate)
    .lte("postingDate", period.endDate)
    .eq("journalLine.accountId", cell.accountId)
    .order("postingDate", { ascending: false })
    .order("id", { ascending: false })
    .limit(TIE_OUT_CELL_JOURNAL_LIMIT + 1);
  if (journalsResult.error) {
    return { data: null, error: journalsResult.error };
  }

  const allJournals = journalsResult.data ?? [];
  const truncated = allJournals.length > TIE_OUT_CELL_JOURNAL_LIMIT;
  const journalRows = truncated
    ? allJournals.slice(0, TIE_OUT_CELL_JOURNAL_LIMIT)
    : allJournals;

  const journalIds = journalRows.map((journal) => journal.id);
  const CHUNK = 300;

  // Net debit-signed amount per journal on the cell's account.
  const amountByJournalId = new Map<string, number>();
  for (let i = 0; i < journalIds.length; i += CHUNK) {
    const chunk = journalIds.slice(i, i + CHUNK);
    const lines = await client
      .from("journalLine")
      .select("journalId, amount")
      .eq("companyId", companyId)
      .eq("accountId", cell.accountId)
      .in("journalId", chunk);
    if (lines.error) return { data: null, error: lines.error };
    for (const line of lines.data ?? []) {
      amountByJournalId.set(
        line.journalId,
        (amountByJournalId.get(line.journalId) ?? 0) + Number(line.amount ?? 0)
      );
    }
  }

  // Latest disposition per sync entity id (newest-first, first-seen wins).
  const entityIds = journalRows.map((journal) =>
    journal.reversalOfId ? `${journal.reversalOfId}:reversal` : journal.id
  );
  const latestStatusByEntityId = new Map<string, string>();
  for (let i = 0; i < entityIds.length; i += CHUNK) {
    const chunk = entityIds.slice(i, i + CHUNK);
    const operations = await client
      .from("accountingSyncOperation")
      .select("entityId, status, createdAt")
      .eq("companyId", companyId)
      .eq("integration", cell.integration)
      .eq("entityType", "journalEntry")
      .in("entityId", chunk)
      .order("createdAt", { ascending: false });
    if (operations.error) return { data: null, error: operations.error };
    for (const operation of operations.data ?? []) {
      if (!latestStatusByEntityId.has(operation.entityId)) {
        latestStatusByEntityId.set(operation.entityId, operation.status);
      }
    }
  }

  const journals: AccountingSyncTieOutJournal[] = journalRows.map(
    (journal) => ({
      id: journal.id,
      journalEntryId: journal.journalEntryId,
      postingDate: journal.postingDate,
      sourceType: journal.sourceType,
      status: journal.status,
      accountAmount: amountByJournalId.get(journal.id) ?? 0,
      syncStatus:
        latestStatusByEntityId.get(
          journal.reversalOfId ? `${journal.reversalOfId}:reversal` : journal.id
        ) ?? null
    })
  );

  return { data: { cell, journals, truncated }, error: null };
}
/**
 * The cutover date the enable wizard works against, with the earliest and the
 * latest date its date picker allows (`activationCutoverDates`), from the
 * company's current period.
 */
export async function getActivationCutover(
  client: SupabaseClient<Database>,
  companyId: string,
  request: Request
): Promise<ActivationCutoverDates> {
  const timeZone = await getCompanyTimeZone(client, companyId);
  return activationCutoverDates(
    new URL(request.url).searchParams.get(ACTIVATION_CUTOVER_PARAM),
    datetime.today(timeZone),
    CUTOVER_MAX_PERIODS_BACK
  );
}

/**
 * Saves a currency's config and, when given, pins its exchange rate as a
 * company override — in ONE transaction, so a failed pin never leaves the
 * config saved behind a "failed to save" message. The route has already
 * checked `update: accounting`; the writes are scoped to the company group
 * (config) and the company (override). Returns null when the currency is not
 * in the group.
 */
export async function saveCurrencyWithRateOverride(
  db: Kysely<KyselyDatabase>,
  args: {
    currencyId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
    config: {
      decimalPlaces: number;
      historicalExchangeRate: number | null;
      customFields: Json;
    };
    overrideRate: number | null;
  }
): Promise<{ code: string } | null> {
  return db.transaction().execute(async (trx) => {
    const currency = await trx
      .updateTable("currency")
      .set({
        decimalPlaces: args.config.decimalPlaces,
        historicalExchangeRate: args.config.historicalExchangeRate,
        customFields: args.config.customFields,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", args.currencyId)
      .where("companyGroupId", "=", args.companyGroupId)
      .returning("code")
      .executeTakeFirst();

    if (!currency) return null;

    if (args.overrideRate !== null) {
      // Update-in-place on conflict so re-pinning keeps the original creator.
      await trx
        .insertInto("exchangeRateOverride")
        .values({
          companyId: args.companyId,
          currencyCode: currency.code,
          rate: args.overrideRate,
          createdBy: args.userId
        })
        .onConflict((oc) =>
          oc.columns(["companyId", "currencyCode"]).doUpdateSet({
            rate: args.overrideRate as number,
            updatedBy: args.userId,
            updatedAt: datetime.timestamp()
          })
        )
        .execute();
    }

    return { code: currency.code };
  });
}

/** The company's business day, `YYYY-MM-DD`. */
export async function getCompanyToday(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<string> {
  return datetime.today(await getCompanyTimeZone(client, companyId)).toString();
}

/**
 * The refusal for a period run (revenue recognition, depreciation) that ends
 * after the company's current month, or null when the period may run. New,
 * Repeat and Post all ask, so a run for a month that has not started can
 * neither be created nor posted.
 */
export async function futureRunPeriodError(
  client: SupabaseClient<Database>,
  companyId: string,
  periodEnd: string
): Promise<string | null> {
  if (!isFutureRunPeriod(periodEnd, await getCompanyToday(client, companyId))) {
    return null;
  }
  return `${formatDate(periodEnd, { month: "long", year: "numeric" })} has not started yet. A run can cover the current month or an earlier one.`;
}

/** A Draft period run (revenue recognition, depreciation) no longer matches
 * what its period should post. Its message is meant for the user — the post
 * routes show it, where other posting failures get a generic toast. */
export class RunOutOfDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunOutOfDateError";
  }
}

/** Resolve only the authorized group's root CTA configuration for reporting.
 * Operating-company balances continue to use the loader's RLS client.
 */
export async function applyCtaToReportPeriodSeriesForReport(
  request: Request,
  reportingCompanyId: string,
  args: Parameters<typeof applyCtaToReportPeriodSeries>[3]
) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
    bypassRls: true
  });
  const root = await client
    .from("company")
    .select("id")
    .eq("id", reportingCompanyId)
    .eq("companyGroupId", companyGroupId)
    .is("parentCompanyId", null)
    .single();
  if (root.error || !root.data) {
    return {
      data: null,
      error: root.error ?? {
        message:
          "Reporting company must be the root of the authorized company group"
      }
    };
  }
  // Use the authenticated client returned above: API keys never gain service-role
  // privileges, even if their request also supplies the bypassRls option.
  return applyCtaToReportPeriodSeries(
    client,
    companyGroupId,
    root.data.id,
    args
  );
}

// Report loaders consolidate a group the user is authorized for, but the
// synthetic elimination entities are read via service role (no user is a member
// of them — see the consolidation service). These thin wrappers own that
// privileged-client decision in ONE server-only place so the loaders never
// thread a `getCarbonServiceRole()` argument through their call sites. The RLS
// `client` still reads every operating company; only elimination entities are
// read privileged.
export function getConsolidatedPeriodSeriesForReport(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  args: { buckets: ReportPeriodBucket[]; includeCurrentYearEarnings?: boolean }
) {
  return getConsolidatedPeriodSeries(
    client,
    companyGroupId,
    companyIds,
    targetCurrency,
    args,
    getCarbonServiceRole()
  );
}

export function getConsolidatedBalancesForReport(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  periodEnd: string,
  periodStart?: string
) {
  return getConsolidatedBalances(
    client,
    companyGroupId,
    companyIds,
    targetCurrency,
    periodEnd,
    periodStart,
    getCarbonServiceRole()
  );
}

// Consolidated account drill-down ("All Companies"). Reads via service role so
// the synthetic elimination entities' journal lines (invisible to the user's
// RLS session — no user is a member of them) appear in the ledger and the
// summary ties to the consolidated report. Scoped to the group's own companies
// so a service-role read cannot cross tenants.
export async function getConsolidatedAccountLedger(
  companyGroupId: string,
  args: {
    accountId: string;
    startDate: string | null;
    endDate: string | null;
    limit: number;
    offset: number;
  }
) {
  const serviceRole = getCarbonServiceRole();
  const { data: groupCompanies } = await serviceRole
    .from("company")
    .select("id")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);
  const companyIds = (groupCompanies ?? []).map((c) => c.id);

  const [ledger, summary] = await Promise.all([
    getAccountLedger(serviceRole, {
      accountId: args.accountId,
      companyId: null,
      companyIds,
      startDate: args.startDate,
      endDate: args.endDate,
      limit: args.limit,
      offset: args.offset
    }),
    getAccountLedgerSummary(serviceRole, companyGroupId, null, {
      accountId: args.accountId,
      startDate: args.startDate,
      endDate: args.endDate
    })
  ]);

  return { ledger, summary };
}

/**
 * Inserts a Posted run journal (`@carbon/database/run-journals`) with its
 * lines, and a dimension row for each line value whose dimension the company
 * has. A journal with no lines is still inserted, as the run posters always
 * have.
 */
async function insertPostedRunJournal(
  trx: KyselyTx,
  journal: RunJournal,
  posting: {
    accountingPeriodId: string;
    postingDate: string;
    dimensionIds: Partial<Record<DimensionEntityType, string | undefined>>;
    companyId: string;
    userId: string;
    now: string;
  }
): Promise<{ id: string; journalEntryId: string }> {
  const { accountingPeriodId, postingDate, dimensionIds, companyId, userId } =
    posting;
  const journalEntryId = await getNextSequenceInTransaction(
    trx,
    "journalEntry",
    companyId
  );
  const { id } = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId,
      companyId,
      description: journal.description,
      postingDate,
      sourceType: journal.sourceType,
      status: "Posted",
      postedAt: posting.now,
      postedBy: userId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  if (journal.lines.length === 0) return { id, journalEntryId };

  const lines = await trx
    .insertInto("journalLine")
    .values(
      journal.lines.map(({ dimensions: _, ...line }) => ({
        ...line,
        journalId: id,
        journalLineReference: crypto.randomUUID(),
        companyId
      }))
    )
    .returning(["id"])
    .execute();
  const dimensionRows = lines.flatMap((line, index) =>
    Object.entries(journal.lines[index]!.dimensions).flatMap(
      ([entityType, valueId]) => {
        const dimensionId = dimensionIds[entityType as DimensionEntityType];
        return dimensionId && valueId
          ? [{ journalLineId: line.id, dimensionId, valueId, companyId }]
          : [];
      }
    )
  );
  if (dimensionRows.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionRows)
      .execute();
  }
  return { id, journalEntryId };
}

export async function postDisposal(
  db: Kysely<KyselyDatabase>,
  args: {
    fixedAssetId: string;
    fixedAssetReadableId: string;
    disposalDate: string;
    disposalMethod: "Sale" | "Scrapping";
    acquisitionCost: number;
    accumulatedDepreciation: number;
    locationId: string | null;
    fixedAssetClassId: string;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    lossOnDisposalAccountId: string;
    accountingPeriodId: string;
    locationDimensionId: string | undefined;
    assetClassDimensionId: string | undefined;
    companyId: string;
    userId: string;
  }
) {
  const {
    fixedAssetId,
    fixedAssetReadableId,
    disposalDate,
    disposalMethod,
    acquisitionCost,
    accumulatedDepreciation,
    locationId,
    fixedAssetClassId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    lossOnDisposalAccountId,
    accountingPeriodId,
    locationDimensionId,
    assetClassDimensionId,
    companyId,
    userId
  } = args;

  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new Error(ACCOUNTING_NOT_STARTED);
  }

  const journal = buildDisposalJournal({
    assetReadableId: fixedAssetReadableId,
    disposalMethod,
    disposalDate,
    acquisitionCost,
    accumulatedDepreciation,
    locationId,
    fixedAssetClassId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    lossOnDisposalAccountId
  });
  const nbv = journal.netBookValue;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const { id: journalId } = await insertPostedRunJournal(trx, journal, {
      accountingPeriodId,
      postingDate: journal.postingDate,
      dimensionIds: {
        Location: locationDimensionId,
        FixedAssetClass: assetClassDimensionId
      },
      companyId,
      userId,
      now
    });

    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId,
        disposalMethod,
        disposalDate,
        saleProceeds: 0,
        netBookValueAtDisposal: nbv,
        gainLoss: -nbv,
        journalId,
        companyId,
        createdBy: userId
      })
      .execute();

    await trx
      .updateTable("fixedAsset")
      .set({
        status: "Disposed",
        disposalDate,
        disposalMethod,
        saleProceeds: 0,
        updatedBy: userId
      })
      .where("id", "=", fixedAssetId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/**
 * Registers a Draft asset: Active, or Under Construction for a
 * construction-in-progress class. It posts the acquisition journal first:
 * Provisional before the accounting cutover (no period), Posted after it, in
 * the acquisition date's period. The status is read once, in the transaction,
 * under the lock the enable takes, so no registration writes a Provisional
 * journal after the enable commits. One transaction, so no asset is
 * registered without its journal or its CIP cost row.
 */
export async function postAssetRegistration(
  db: Kysely<KyselyDatabase>,
  args: {
    fixedAssetId: string;
    fixedAssetReadableId: string;
    registration: {
      acquisitionCost: number;
      acquisitionDate: string;
      accumulatedDepreciation: number;
      depreciationStartDate: string;
    };
    posting: {
      locationId: string | null;
      fixedAssetClassId: string;
      assetAccountId: string;
      // Contra-asset account credited with any opening accumulated
      // depreciation when the asset is capitalized mid-life (from the class).
      accumulatedDepreciationAccountId: string;
      // Equity offset for a direct (non-purchase) registration — owner equity
      // / retained earnings. Brings the asset onto the books at NBV.
      offsetAccountId: string;
      locationDimensionId: string | undefined;
      assetClassDimensionId: string | undefined;
      /** The period of a Posted journal. Called only after the cutover. */
      resolveAccountingPeriodId: (postingDate: string) => Promise<string>;
    };
    // "Under Construction" for an asset registered into a construction-in-
    // progress class: it accumulates cost and is not depreciated until it is
    // capitalized into its in-service class.
    status?: "Active" | "Under Construction";
    companyId: string;
    userId: string;
  }
) {
  const {
    fixedAssetId,
    fixedAssetReadableId,
    registration,
    posting,
    status = "Active",
    companyId,
    userId
  } = args;
  const {
    locationId,
    fixedAssetClassId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    offsetAccountId,
    locationDimensionId,
    assetClassDimensionId
  } = posting;

  const { acquisitionCost, acquisitionDate, accumulatedDepreciation } =
    registration;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const postingStatus = await journalPostingStatus(trx, companyId);
    let accountingPeriodId: string | null = null;
    if (postingStatus === "Posted") {
      // A Provisional journal counts nowhere, so only a Posted one needs the
      // dimensions.
      if (!locationDimensionId || !assetClassDimensionId) {
        throw new Error("Missing dimensions required for asset registration");
      }
      accountingPeriodId =
        await posting.resolveAccountingPeriodId(acquisitionDate);
    }

    // Post the acquisition journal FIRST, then flip the asset to Active — so a
    // capitalized asset can never exist without its GL entry (if the journal
    // fails the whole transaction rolls back and the asset stays Draft).
    //   Dr  assetAccountId                     acquisitionCost           (capitalize at gross cost)
    //       Cr  accumulatedDepreciationAccountId   accumulatedDepreciation   (opening contra, mid-life only)
    //       Cr  offsetAccountId                    nbv                       (owner equity)
    const journalEntryId = await getNextSequenceInTransaction(
      trx,
      "journalEntry",
      companyId
    );

    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId,
        accountingPeriodId,
        companyId,
        description: `Asset Registration: ${fixedAssetReadableId}`,
        postingDate: acquisitionDate,
        sourceType: "Manual",
        status: postingStatus,
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLineResults = await trx
      .insertInto("journalLine")
      .values(
        acquisitionLines(acquisitionCost, accumulatedDepreciation).map(
          (line) => ({
            journalId: journal.id,
            accountId:
              line.role === "asset"
                ? assetAccountId
                : line.role === "accumulatedDepreciation"
                  ? accumulatedDepreciationAccountId
                  : offsetAccountId,
            description: line.description,
            amount: line.amount,
            journalLineReference: crypto.randomUUID(),
            companyId
          })
        )
      )
      .returning(["id"])
      .execute();

    if (locationDimensionId && locationId) {
      await trx
        .insertInto("journalLineDimension")
        .values(
          journalLineResults.map((jl) => ({
            journalLineId: jl.id,
            dimensionId: locationDimensionId,
            valueId: locationId,
            companyId
          }))
        )
        .execute();
    }

    if (assetClassDimensionId && fixedAssetClassId) {
      await trx
        .insertInto("journalLineDimension")
        .values(
          journalLineResults.map((jl) => ({
            journalLineId: jl.id,
            dimensionId: assetClassDimensionId,
            valueId: fixedAssetClassId,
            companyId
          }))
        )
        .execute();
    }

    const updateResult = await trx
      .updateTable("fixedAsset")
      .set({
        status,
        acquisitionCost: registration.acquisitionCost,
        acquisitionDate: registration.acquisitionDate,
        accumulatedDepreciation: registration.accumulatedDepreciation,
        depreciationStartDate: registration.depreciationStartDate,
        updatedBy: userId
      })
      .where("id", "=", fixedAssetId)
      .where("status", "=", "Draft")
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!updateResult.numUpdatedRows) {
      // Lost the race (already registered/disposed) — roll back the journal.
      throw new Error("Asset is no longer in Draft status");
    }

    // An asset registered straight into a construction-in-progress class keeps
    // its registration cost as a CIP cost row, so capitalizing it into service
    // later sweeps that cost together with everything attached since
    // (post-asset-transfer sums the rows, not the asset's acquisitionCost).
    if (status === "Under Construction" && acquisitionCost > 0) {
      await trx
        .insertInto("fixedAssetCipCost")
        .values({
          fixedAssetId,
          sourceType: "Manual",
          amount: acquisitionCost,
          costDate: acquisitionDate,
          journalId: journal.id,
          companyId,
          createdBy: userId
        })
        .execute();
    }
  });
}

/**
 * Replaces a Draft depreciation run's lines with `lines`, keeping the run's id
 * and number. A run left with nothing to depreciate is deleted. Returns
 * whether the lines changed, so the route can say "already up to date".
 */
export async function replaceDepreciationRunLines(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    lines: DepreciationLine[];
    companyId: string;
    userId: string;
  }
): Promise<{ changed: boolean; deleted: boolean }> {
  const { depreciationRunId, lines, companyId, userId } = args;

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("depreciationRun")
      .select(["depreciationRunId", "status", "periodEnd"])
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `Depreciation run ${run.depreciationRunId} is ${run.status}; only a draft can be recalculated`
      );
    }

    const before = await trx
      .selectFrom("depreciationRunLine")
      .select(["fixedAssetId", "periodEnd", "amount", "taxAmount"])
      .where("depreciationRunId", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();
    // A line from before per-month lines has no periodEnd: it is the run's.
    const changed = !depreciationRunLinesMatch(
      before.map((line) => ({
        ...line,
        periodEnd: line.periodEnd ?? run.periodEnd
      })),
      lines
    );

    if (lines.length === 0) {
      await trx
        .deleteFrom("depreciationRun")
        .where("id", "=", depreciationRunId)
        .where("companyId", "=", companyId)
        .execute();
      return { changed, deleted: true };
    }
    if (!changed) return { changed, deleted: false };

    await trx
      .deleteFrom("depreciationRunLine")
      .where("depreciationRunId", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();
    await trx
      .insertInto("depreciationRunLine")
      .values(
        lines.map((line) => ({
          depreciationRunId,
          periodEnd: line.periodEnd,
          fixedAssetId: line.fixedAssetId,
          amount: line.amount,
          taxAmount: line.taxAmount,
          companyId
        }))
      )
      .execute();
    await trx
      .updateTable("depreciationRun")
      .set({ updatedBy: userId })
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();

    return { changed, deleted: false };
  });
}

/**
 * The period and posting date for each month a run covers: the month's own
 * end, in its own period, so a catch-up run posts each month where it
 * belongs — or the run's `periodEnd` when the month's period is Closed. Runs
 * post as an "accounting" source, so a Locked period still accepts them.
 */
export async function resolveRunPostingPeriods(
  client: SupabaseClient<Database>,
  args: { companyId: string; monthEnds: string[]; runPeriodEnd: string }
): Promise<
  | { data: RunPostingPeriods; error: null }
  | { data: null; error: { message: string } }
> {
  const { companyId, runPeriodEnd } = args;
  const months = [...new Set(args.monthEnds)].sort();
  if (months.length === 0) return { data: new Map(), error: null };

  const existing = await client
    .from("accountingPeriod")
    .select("startDate, endDate, closeStatus, closedAt")
    .eq("companyId", companyId)
    .lte("startDate", runPeriodEnd)
    .gte("endDate", months[0]);
  if (existing.error) return { data: null, error: existing.error };

  const closedMonths = new Set(
    months.filter((month) =>
      existing.data.some(
        (period) =>
          period.startDate <= month &&
          period.endDate >= month &&
          (period.closeStatus === "Closed" || period.closedAt !== null)
      )
    )
  );
  const targets = runPostingTargets({ months, runPeriodEnd, closedMonths });

  // One call per distinct target month (it creates a missing period), never
  // one per line.
  const byTarget = new Map<
    string,
    { accountingPeriodId: string; postingDate: string }
  >();
  for (const target of new Set(targets.values())) {
    const period = await getOrCreateAccountingPeriod(
      client,
      companyId,
      target,
      "accounting"
    );
    if (period.error || !period.data) {
      return {
        data: null,
        error: period.error ?? {
          message: `No accounting period for ${target}`
        }
      };
    }
    byTarget.set(target, {
      accountingPeriodId: period.data,
      postingDate: target
    });
  }

  return {
    data: new Map(
      months.map((month) => [month, byTarget.get(targets.get(month)!)!])
    ),
    error: null
  };
}

/** Each month a run covers → the period and posting date its journals use. */
export type RunPostingPeriods = Map<
  string,
  { accountingPeriodId: string; postingDate: string }
>;

export async function postDepreciationRun(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    depreciationRunReadableId: string;
    periods: RunPostingPeriods;
    /** The lines the route checked against the assets. Posting refuses when
     *  the run holds any other lines by the time it is locked. */
    lineIds: string[];
    locationDimensionId: string | undefined;
    assetClassDimensionId: string | undefined;
    taxEnabled: boolean;
    taxRate: number | null;
    dtlAccountId: string | null;
    dtExpenseAccountId: string | null;
    companyId: string;
    userId: string;
  }
) {
  const {
    depreciationRunId,
    depreciationRunReadableId,
    periods,
    lineIds,
    locationDimensionId,
    assetClassDimensionId,
    taxEnabled,
    taxRate,
    dtlAccountId,
    dtExpenseAccountId,
    companyId,
    userId
  } = args;

  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new Error(ACCOUNTING_NOT_STARTED);
  }
  const now = datetime.timestamp();

  const periodOf = (monthEnd: string) => {
    const period = periods.get(monthEnd);
    if (!period) {
      throw new Error(`No accounting period resolved for ${monthEnd}`);
    }
    return period;
  };

  return db.transaction().execute(async (trx) => {
    // Lock the run first: two posts of one Draft must not both get through.
    const run = await trx
      .selectFrom("depreciationRun")
      .select(["depreciationRunId", "status", "periodEnd"])
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new RunOutOfDateError(
        `Depreciation run ${run.depreciationRunId} is already ${run.status}`
      );
    }

    // The lines and the assets as they are now, not as the route read them.
    const runLines = await trx
      .selectFrom("depreciationRunLine as l")
      .innerJoin("fixedAsset as a", (join) =>
        join
          .onRef("a.id", "=", "l.fixedAssetId")
          .on("a.companyId", "=", companyId)
      )
      .innerJoin("fixedAssetClass as c", (join) =>
        join
          .onRef("c.id", "=", "a.fixedAssetClassId")
          .on("c.companyId", "=", companyId)
      )
      .select([
        "l.id",
        "l.fixedAssetId",
        sql<string | null>`l."periodEnd"::text`.as("periodEnd"),
        "l.amount",
        "l.taxAmount",
        "a.fixedAssetId as assetReadableId",
        "a.locationId",
        "a.fixedAssetClassId",
        "c.depreciationExpenseAccountId",
        "c.accumulatedDepreciationAccountId"
      ])
      .where("l.depreciationRunId", "=", depreciationRunId)
      .where("l.companyId", "=", companyId)
      .execute();

    const expected = new Set(lineIds);
    if (
      runLines.length !== expected.size ||
      runLines.some((line) => !expected.has(line.id))
    ) {
      throw new RunOutOfDateError(
        `Depreciation run ${run.depreciationRunId} changed while it was being posted; review it and post again`
      );
    }

    const assetIds = [...new Set(runLines.map((line) => line.fixedAssetId))];
    const assets =
      assetIds.length === 0
        ? []
        : await trx
            .selectFrom("fixedAsset")
            .select([
              "id",
              "fixedAssetId",
              "status",
              "acquisitionCost",
              "accumulatedDepreciation",
              "residualValuePercent"
            ])
            .where("id", "in", assetIds)
            .where("companyId", "=", companyId)
            .forUpdate()
            .execute();
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const notDepreciable = assets.find(
      (asset) =>
        asset.status !== "Active" && asset.status !== "Fully Depreciated"
    );
    if (notDepreciable) {
      throw new RunOutOfDateError(
        `${notDepreciable.fixedAssetId} is ${notDepreciable.status}; recalculate depreciation run ${run.depreciationRunId} before posting`
      );
    }

    // A line from before per-month lines has no periodEnd: it is the run's.
    const lines = runLines.map((line) => ({
      ...line,
      monthEnd: line.periodEnd ?? run.periodEnd,
      amount: Number(line.amount),
      taxAmount: Number(line.taxAmount ?? 0)
    }));
    const dimensionIds = {
      Location: locationDimensionId,
      FixedAssetClass: assetClassDimensionId
    };

    for (const journal of buildDepreciationJournals(lines)) {
      const { id } = await insertPostedRunJournal(trx, journal, {
        ...periodOf(journal.monthEnd),
        dimensionIds,
        companyId,
        userId,
        now
      });
      await trx
        .updateTable("depreciationRunLine")
        .set({ journalId: id })
        .where("id", "=", journal.lineId)
        .where("companyId", "=", companyId)
        .execute();
    }

    // One update per asset with every month's amount. Each line used to add
    // its own amount to the same starting value, so with several months of
    // one asset only the last month reached accumulatedDepreciation.
    const byAsset = new Map<string, { amount: number; taxAmount: number }>();
    for (const line of lines) {
      const sums = byAsset.get(line.fixedAssetId) ?? {
        amount: 0,
        taxAmount: 0
      };
      sums.amount += line.amount;
      sums.taxAmount += line.taxAmount;
      byAsset.set(line.fixedAssetId, sums);
    }

    for (const [fixedAssetId, sums] of byAsset) {
      const asset = assetById.get(fixedAssetId)!;
      // Round at persist: a catch-up run adds many months, and float sums
      // stored 20187.59999999999 for 30 months of 672.92. The increment is
      // written in SQL against the row locked above.
      const amount = round(sums.amount);
      const taxAmount = round(sums.taxAmount);
      const newAccumulated = round(
        Number(asset.accumulatedDepreciation) + amount
      );
      const cost = Number(asset.acquisitionCost);
      const residualValue = cost * (Number(asset.residualValuePercent) / 100);
      const nbv = cost - newAccumulated;

      await trx
        .updateTable("fixedAsset")
        .set({
          accumulatedDepreciation: sql<number>`"accumulatedDepreciation" + ${amount}`,
          ...(nbv <= residualValue + 0.01
            ? { status: "Fully Depreciated" as const }
            : {}),
          ...(taxEnabled && taxAmount > 0
            ? {
                accumulatedTaxDepreciation: sql<number>`COALESCE("accumulatedTaxDepreciation", 0) + ${taxAmount}`
              }
            : {}),
          updatedBy: userId
        })
        .where("id", "=", fixedAssetId)
        .where("companyId", "=", companyId)
        .execute();
    }

    // Deferred tax journal entry, one per month, linked to that month's
    // lines so Reverse Run can find it.
    const deferredTax = buildDeferredTaxJournals({
      runReadableId: depreciationRunReadableId,
      lines,
      settings: deferredTaxSettings({
        enabled: taxEnabled,
        taxRate,
        dtlAccountId,
        dtExpenseAccountId
      })
    });
    for (const journal of deferredTax) {
      const { id } = await insertPostedRunJournal(trx, journal, {
        ...periodOf(journal.monthEnd),
        dimensionIds,
        companyId,
        userId,
        now
      });
      await trx
        .updateTable("depreciationRunLine")
        .set({ deferredTaxJournalId: id })
        .where("id", "in", journal.lineIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .updateTable("depreciationRun")
      .set({
        status: "Posted",
        postedAt: now,
        postedBy: userId
      })
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

// ── Revenue recognition runs ─────────────────────────────────────────────────
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I §1. Proposals are
// built by the `propose-revenue-recognition-run` server function (shared with the Inngest job);
// posting and deletion are human actions and live here, beside the
// depreciation-run posters they mirror.

export type RevenueRecognitionDimensionIds = {
  customer?: string;
  item?: string;
  location?: string;
  /** Contract rows only: the contract line's project, else the contract's. */
  project?: string;
  /** Lessee lease rows only: the lease's supplier. */
  supplier?: string;
};

type AccountClass = NonNullable<Database["public"]["Enums"]["glAccountClass"]>;

export type DimensionEntityType =
  Database["public"]["Enums"]["dimensionEntityType"];

/**
 * Posts a Draft revenue recognition run as one journal per month its rows
 * fall in (`sourceType` 'Revenue Recognition'), each in that month's period —
 * the run's own when the month is Closed: two lines per schedule row, each
 * row's own debit/credit accounts, signed by account class. Stamps each row
 * with its month's journal, the run with the journal of its own period, and
 * flips both to Posted, all in one transaction. The route resolves the
 * periods (`resolveRunPostingPeriods`, `source: "accounting"`, so a Locked
 * period accepts them) and the dimension ids before calling.
 */
export async function postRevenueRecognitionRun(
  db: Kysely<KyselyDatabase>,
  args: {
    runId: string;
    companyId: string;
    userId: string;
    /** Each month the run's rows fall in → its period and posting date
     *  (`resolveRunPostingPeriods`). */
    periods: RunPostingPeriods;
    dimensionIds: RevenueRecognitionDimensionIds;
  }
) {
  const { runId, companyId, userId, periods, dimensionIds } = args;
  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new Error(ACCOUNTING_NOT_STARTED);
  }
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["id", "runId", "status", "periodEnd", "type"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `${runLabelSentence(run.type)} ${run.runId} is already ${run.status}`
      );
    }

    const rows = await trx
      .selectFrom("revenueRecognitionRunLine as l")
      .innerJoin("revenueRecognitionSchedule as s", (join) =>
        join
          .onRef("s.id", "=", "l.scheduleId")
          .on("s.companyId", "=", companyId)
      )
      .select([
        "l.amount",
        "s.amount as scheduleAmount",
        "s.status as scheduleStatus",
        "s.id as scheduleId",
        sql<string>`s."scheduledDate"::text`.as("scheduledDate"),
        "s.type",
        "s.debitAccountId",
        "s.creditAccountId",
        "s.salesInvoiceLineId",
        "s.rentalAgreementLineId",
        "s.rentalLeaseScheduleLineId",
        "s.customerContractLineId",
        "s.customerContractRevenueId",
        "s.leaseId",
        "s.leaseScheduleLineId"
      ])
      .where("l.runId", "=", runId)
      .where("l.companyId", "=", companyId)
      .execute();
    if (rows.length === 0) {
      throw new Error(
        `${runLabelSentence(run.type)} ${run.runId} has no lines`
      );
    }

    // A Draft is a snapshot of the schedule when it was proposed. Posting it
    // after a row it holds changed, or after another row fell due by its
    // period end, would recognize the wrong amount or leave that revenue to a
    // later period. Recalculating rebuilds it from the schedule as it is now.
    const unclaimed = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select("id")
      .where("companyId", "=", companyId)
      .where(runTypeFilter(run.type))
      .where("status", "=", "Planned")
      .where("runLineId", "is", null)
      .where("scheduledDate", "<=", run.periodEnd)
      .executeTakeFirst();
    // Contract months are synthesized into schedule rows at proposal time, so
    // a month that fell due since (a contract confirmed later) has no row yet;
    // and a held contract row whose plan month an amendment replaced (its
    // `customerContractRevenueId` nulled) would recognize a stale amount.
    const unsynthesizedContractRevenue =
      run.type !== "Revenue Recognition"
        ? undefined
        : await trx
            .selectFrom("customerContractRevenue as r")
            .innerJoin("customerContract as c", (join) =>
              join
                .onRef("c.id", "=", "r.customerContractId")
                .onRef("c.companyId", "=", "r.companyId")
            )
            .select("r.id")
            .where("r.companyId", "=", companyId)
            .where("r.status", "=", "Planned")
            .where("r.periodStart", "<=", run.periodEnd)
            .where("r.amount", "<>", 0)
            .where("c.status", "<>", "Draft")
            .where(({ not, exists, selectFrom }) =>
              not(
                exists(
                  selectFrom("revenueRecognitionSchedule as s")
                    .select("s.id")
                    .whereRef("s.customerContractRevenueId", "=", "r.id")
                    .where("s.companyId", "=", companyId)
                )
              )
            )
            .executeTakeFirst();
    const drifted = rows.some(
      (row) =>
        row.scheduleStatus !== "Planned" ||
        !equals(Number(row.amount), Number(row.scheduleAmount)) ||
        (row.customerContractLineId && !row.customerContractRevenueId)
    );
    if (unclaimed || unsynthesizedContractRevenue || drifted) {
      throw new RunOutOfDateError(
        `${runLabelSentence(run.type)} ${run.runId} is out of date with its schedule; recalculate it before posting`
      );
    }

    // `account` is group-scoped (no companyId); the ids came from rows already
    // scoped to this company.
    const accountIds = [
      ...new Set(
        rows.flatMap((row) => [row.debitAccountId, row.creditAccountId])
      )
    ];
    const accounts = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "in", accountIds)
      .execute();
    const classById = new Map<string, AccountClass>();
    for (const account of accounts) {
      if (account.class) classById.set(account.id, account.class);
    }

    // Deferral rows point at the invoice line that funded them; the journal
    // line references the invoice and carries its customer/item/location.
    const invoiceLineIds = [
      ...new Set(
        rows
          .map((row) => row.salesInvoiceLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const invoiceLines =
      invoiceLineIds.length === 0
        ? []
        : await trx
            .selectFrom("salesInvoiceLine as sil")
            .innerJoin("salesInvoice as si", (join) =>
              join
                .onRef("si.id", "=", "sil.invoiceId")
                .on("si.companyId", "=", companyId)
            )
            .select([
              "sil.id",
              "sil.invoiceId",
              "sil.itemId",
              "sil.locationId",
              "si.customerId"
            ])
            .where("sil.id", "in", invoiceLineIds)
            .where("sil.companyId", "=", companyId)
            .execute();
    const invoiceLineById = new Map(
      invoiceLines.map((line) => [line.id, line])
    );

    // Accrual (and later Interest) rows point at a rental agreement line; the
    // journal line references the agreement and carries its customer, the
    // line's item and the agreement's location.
    const rentalLineIds = [
      ...new Set(
        rows
          .filter((row) => !row.salesInvoiceLineId)
          .map((row) => row.rentalAgreementLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const rentalLines =
      rentalLineIds.length === 0
        ? []
        : await trx
            .selectFrom("rentalAgreementLine as ral")
            .innerJoin("rentalAgreement as ra", (join) =>
              join
                .onRef("ra.id", "=", "ral.rentalAgreementId")
                .on("ra.companyId", "=", companyId)
            )
            .select([
              "ral.id",
              "ral.itemId",
              "ra.id as rentalAgreementId",
              "ra.customerId",
              "ra.locationId"
            ])
            .where("ral.id", "in", rentalLineIds)
            .where("ral.companyId", "=", companyId)
            .execute();
    const rentalLineById = new Map(rentalLines.map((line) => [line.id, line]));

    // Contract rows (synthesized from the contract's revenue plan) point at a
    // contract line; the journal line references the contract and carries its
    // customer, the line's item and the line's (else the contract's) project.
    const contractLineIds = [
      ...new Set(
        rows
          .map((row) => row.customerContractLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const contractLines =
      contractLineIds.length === 0
        ? []
        : await trx
            .selectFrom("customerContractLine as ccl")
            .innerJoin("customerContract as cc", (join) =>
              join
                .onRef("cc.id", "=", "ccl.customerContractId")
                .on("cc.companyId", "=", companyId)
            )
            .select([
              "ccl.id",
              "ccl.itemId",
              "cc.id as customerContractId",
              "cc.customerId",
              sql<string | null>`COALESCE(ccl."projectId", cc."projectId")`.as(
                "projectId"
              )
            ])
            .where("ccl.id", "in", contractLineIds)
            .where("ccl.companyId", "=", companyId)
            .execute();
    const contractLineById = new Map(
      contractLines.map((line) => [line.id, line])
    );

    // One journal per month: a row posts in the period of the month it was
    // scheduled for (the run's own period when that month is Closed), so a
    // catch-up run puts each month's revenue where it was earned.
    const periodOfMonth = (monthEnd: string) => {
      const period = periods.get(monthEnd);
      if (!period) {
        throw new Error(`No accounting period resolved for ${monthEnd}`);
      }
      return period;
    };
    const periodIdByDate = new Map<string, string>();
    const scheduleRows = rows.map((row) => {
      const period = periodOfMonth(monthEndOf(row.scheduledDate));
      periodIdByDate.set(period.postingDate, period.accountingPeriodId);
      return { ...row, postingDate: period.postingDate };
    });
    // Lessee lease rows reference the lease, with its supplier and location.
    const leaseIds = [
      ...new Set(
        rows.map((row) => row.leaseId).filter((id): id is string => Boolean(id))
      )
    ];
    const leases =
      leaseIds.length === 0
        ? []
        : await trx
            .selectFrom("lease")
            .select(["id", "supplierId", "locationId"])
            .where("id", "in", leaseIds)
            .where("companyId", "=", companyId)
            .execute();
    const leaseScheduleLineIds = rows
      .map((row) => row.leaseScheduleLineId)
      .filter((id): id is string => Boolean(id));
    const leaseAssets =
      leaseScheduleLineIds.length === 0
        ? []
        : await trx
            .selectFrom("leaseScheduleLine as sl")
            .innerJoin("leaseLine as l", (join) =>
              join
                .onRef("l.id", "=", "sl.leaseLineId")
                .onRef("l.companyId", "=", "sl.companyId")
            )
            .select(["sl.id", "sl.leaseLineId", "l.locationId"])
            .where("sl.id", "in", leaseScheduleLineIds)
            .where("sl.companyId", "=", companyId)
            .execute();

    const sources: RecognitionSources = {
      invoiceLines: invoiceLineById,
      rentalLines: rentalLineById,
      contractLines: contractLineById,
      leases: new Map(leases.map((lease) => [lease.id, lease])),
      leaseAssets: new Map(leaseAssets.map((asset) => [asset.id, asset]))
    };
    // Throws when an account has no class.
    const { journals, runJournal } = buildRecognitionJournals({
      runType: run.type,
      runReadableId: run.runId,
      runPeriodEnd: run.periodEnd,
      rows: scheduleRows,
      sources,
      classById
    });
    const recognitionDimensionIds = {
      Customer: dimensionIds.customer,
      Item: dimensionIds.item,
      Location: dimensionIds.location,
      Project: dimensionIds.project,
      Supplier: dimensionIds.supplier
    };

    const written = new Map<
      (typeof journals)[number],
      { id: string; journalEntryId: string }
    >();
    for (const journal of journals) {
      const inserted = await insertPostedRunJournal(trx, journal, {
        accountingPeriodId: periodIdByDate.get(journal.postingDate)!,
        postingDate: journal.postingDate,
        dimensionIds: recognitionDimensionIds,
        companyId,
        userId,
        now
      });
      written.set(journal, inserted);

      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ journalId: inserted.id, status: "Posted", updatedBy: userId })
        .where("id", "in", journal.scheduleIds)
        .where("companyId", "=", companyId)
        .execute();
      // Each contract row's Recognition ledger entry records the journal
      // that posted it.
      if (journal.contractScheduleIds.length > 0) {
        await trx
          .updateTable("customerContractLedgerEntry")
          .set({ journalId: inserted.id })
          .where(
            "revenueRecognitionScheduleId",
            "in",
            journal.contractScheduleIds
          )
          .where("companyId", "=", companyId)
          .execute();
      }
      // An Interest row posts one period of a sales-type lease's effective
      // interest schedule; the schedule line records the journal that posted
      // it, which is how the net investment report tells posted principal
      // from future principal.
      if (journal.leaseScheduleLineIds.length > 0) {
        await trx
          .updateTable("rentalLeaseScheduleLine")
          .set({
            journalId: inserted.id,
            postedAt: now,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "in", journal.leaseScheduleLineIds)
          .where("companyId", "=", companyId)
          .execute();
      }
      // A lessee lease's month: its schedule line records the journal that
      // posted it.
      if (journal.lesseeScheduleLineIds.length > 0) {
        await trx
          .updateTable("leaseScheduleLine")
          .set({
            journalId: inserted.id,
            postedAt: now,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "in", journal.lesseeScheduleLineIds)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    // A contract month is recognized once its schedule rows post.
    const recognizedRevenueIds = [
      ...new Set(
        rows
          .map((row) => row.customerContractRevenueId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (recognizedRevenueIds.length > 0) {
      await trx
        .updateTable("customerContractRevenue")
        .set({ status: "Recognized", updatedBy: userId, updatedAt: now })
        .where("id", "in", recognizedRevenueIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    // The run names the journal of its own period, else its latest month's;
    // every journal is reachable from the schedule rows it posted. The run
    // has rows, so it has a journal.
    const runJournalRow = written.get(runJournal!)!;

    await trx
      .updateTable("revenueRecognitionRun")
      .set({
        journalId: runJournalRow.id,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        updatedBy: userId
      })
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .execute();

    return {
      journalId: runJournalRow.id,
      journalEntryId: runJournalRow.journalEntryId
    };
  });
}

/** A Posted period run cannot be reversed; the message is meant for the user
 *  (the reverse routes show it, where other failures get a generic toast). */
export class RunReversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunReversalError";
  }
}

/**
 * Where each journal of a run is reversed: on its own posting date when that
 * period is not Closed, else on the company's today. Keyed by the original
 * posting date.
 */
export async function resolveReversalPeriods(
  client: SupabaseClient<Database>,
  args: { companyId: string; postingDates: string[] }
): Promise<
  | { data: RunPostingPeriods; error: null }
  | { data: null; error: { message: string } }
> {
  const { companyId } = args;
  const dates = [...new Set(args.postingDates)].sort();
  if (dates.length === 0) return { data: new Map(), error: null };

  const [existing, companyToday] = await Promise.all([
    client
      .from("accountingPeriod")
      .select("startDate, endDate, closeStatus, closedAt")
      .eq("companyId", companyId)
      .lte("startDate", dates[dates.length - 1])
      .gte("endDate", dates[0]),
    getCompanyToday(client, companyId)
  ]);
  if (existing.error) return { data: null, error: existing.error };

  const targetOf = new Map(
    dates.map((date) => {
      const closed = existing.data.some(
        (period) =>
          period.startDate <= date &&
          period.endDate >= date &&
          (period.closeStatus === "Closed" || period.closedAt !== null)
      );
      return [date, closed ? companyToday : date] as const;
    })
  );

  // One call per distinct target date, never one per journal line.
  const byTarget = new Map<
    string,
    { accountingPeriodId: string; postingDate: string }
  >();
  for (const target of new Set(targetOf.values())) {
    const period = await getOrCreateAccountingPeriod(
      client,
      companyId,
      target,
      "accounting"
    );
    if (period.error || !period.data) {
      return {
        data: null,
        error: period.error ?? {
          message: `No accounting period for ${target}`
        }
      };
    }
    byTarget.set(target, {
      accountingPeriodId: period.data,
      postingDate: target
    });
  }

  return {
    data: new Map(
      dates.map((date) => [date, byTarget.get(targetOf.get(date)!)!])
    ),
    error: null
  };
}

/**
 * Reverses posted journals the way `reverseJournalEntry` does — a Posted
 * entry with every line negated, the original marked Reversed — but keeps
 * each line's document and dimensions, and dates each reversal by `periods`
 * (keyed by the original's posting date). Shared by Reverse Run for revenue
 * recognition and depreciation, inside the caller's transaction.
 */
export async function reverseRunJournals(
  trx: KyselyTx,
  args: {
    journalIds: string[];
    periods: RunPostingPeriods;
    companyId: string;
    userId: string;
  }
): Promise<void> {
  const { journalIds, periods, companyId, userId } = args;
  if (journalIds.length === 0) return;
  const now = datetime.timestamp();

  const [journals, lines] = await Promise.all([
    trx
      .selectFrom("journal")
      .select([
        "id",
        "journalEntryId",
        "status",
        "sourceType",
        sql<string>`"postingDate"::text`.as("postingDate")
      ])
      .where("id", "in", journalIds)
      .where("companyId", "=", companyId)
      .orderBy("postingDate")
      .orderBy("journalEntryId")
      .forUpdate()
      .execute(),
    trx
      .selectFrom("journalLine")
      .select([
        "id",
        "journalId",
        "accountId",
        "description",
        "amount",
        "documentType",
        "documentId"
      ])
      .where("journalId", "in", journalIds)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .execute()
  ]);
  const notPosted = journals.find((journal) => journal.status !== "Posted");
  if (notPosted) {
    throw new RunReversalError(
      `Journal ${notPosted.journalEntryId} is ${notPosted.status}, so the run cannot be reversed`
    );
  }

  const dimensions =
    lines.length === 0
      ? []
      : await trx
          .selectFrom("journalLineDimension")
          .select(["journalLineId", "dimensionId", "valueId"])
          .where(
            "journalLineId",
            "in",
            lines.map((line) => line.id)
          )
          .where("companyId", "=", companyId)
          .execute();

  const reversedLineId = new Map<string, string>();
  for (const journal of journals) {
    const period = periods.get(journal.postingDate);
    if (!period) {
      throw new Error(`No reversal period resolved for ${journal.postingDate}`);
    }
    const journalEntryId = await getNextSequenceInTransaction(
      trx,
      "journalEntry",
      companyId
    );
    const reversal = await trx
      .insertInto("journal")
      .values({
        journalEntryId,
        accountingPeriodId: period.accountingPeriodId,
        companyId,
        description: `Reversal of ${journal.journalEntryId}`,
        postingDate: period.postingDate,
        sourceType: journal.sourceType,
        reversalOfId: journal.id,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLines = lines.filter((line) => line.journalId === journal.id);
    if (journalLines.length > 0) {
      // RETURNING follows the VALUES order, so each new line pairs with its
      // original.
      const inserted = await trx
        .insertInto("journalLine")
        .values(
          journalLines.map((line) => ({
            journalId: reversal.id,
            accountId: line.accountId,
            description: line.description,
            amount: -Number(line.amount),
            documentType: line.documentType,
            documentId: line.documentId,
            journalLineReference: crypto.randomUUID(),
            companyId
          }))
        )
        .returning(["id"])
        .execute();
      journalLines.forEach((line, index) => {
        reversedLineId.set(line.id, inserted[index]!.id);
      });
    }

    await trx
      .updateTable("journal")
      .set({ status: "Reversed", reversedById: reversal.id, updatedBy: userId })
      .where("id", "=", journal.id)
      .where("companyId", "=", companyId)
      .execute();
  }

  if (dimensions.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(
        dimensions.map((dimension) => ({
          journalLineId: reversedLineId.get(dimension.journalLineId)!,
          dimensionId: dimension.dimensionId,
          valueId: dimension.valueId,
          companyId
        }))
      )
      .execute();
  }
}

/**
 * Reverse Run for revenue recognition (NetSuite ARM's void: the plan lines
 * become recognizable again). Reverses every journal the run posted, puts
 * its schedule rows back to Planned — still held by the run — clears what
 * posting stamped (lease schedule lines, contract ledger entries, contract
 * revenue months) and returns the run to Draft, so it can be recalculated,
 * posted again or deleted.
 */
export async function reverseRevenueRecognitionRun(
  db: Kysely<KyselyDatabase>,
  args: {
    runId: string;
    periods: RunPostingPeriods;
    companyId: string;
    userId: string;
  }
): Promise<{ runId: string; deleted: boolean }> {
  const { runId, periods, companyId, userId } = args;
  const now = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["id", "runId", "status", "periodEnd", "type"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Posted") {
      throw new RunReversalError(
        `${runLabelSentence(run.type)} ${run.runId} is ${run.status}; only a posted run can be reversed`
      );
    }
    // The reversed run becomes the period's Draft, and a period holds one.
    const draft = await trx
      .selectFrom("revenueRecognitionRun")
      .select("runId")
      .where("companyId", "=", companyId)
      .where("type", "=", run.type)
      .where("periodEnd", "=", run.periodEnd)
      .where("status", "=", "Draft")
      .executeTakeFirst();
    if (draft) {
      throw new RunReversalError(
        `${draft.runId} is a draft for this period. Post or delete it before reversing ${run.runId}.`
      );
    }

    const rows = await trx
      .selectFrom("revenueRecognitionRunLine as l")
      .innerJoin("revenueRecognitionSchedule as s", (join) =>
        join
          .onRef("s.id", "=", "l.scheduleId")
          .on("s.companyId", "=", companyId)
      )
      .select([
        "s.id",
        "s.journalId",
        "s.rentalLeaseScheduleLineId",
        "s.customerContractRevenueId",
        "s.leaseScheduleLineId",
        "s.rentalAgreementLineId",
        "s.leaseId",
        "l.id as lineId"
      ])
      .where("l.runId", "=", runId)
      .where("l.companyId", "=", companyId)
      .execute();
    const journalIds = [
      ...new Set(
        rows
          .map((row) => row.journalId)
          .filter((id): id is string => Boolean(id))
      )
    ];

    await reverseRunJournals(trx, { journalIds, periods, companyId, userId });

    const scheduleIds = rows.map((row) => row.id);
    if (scheduleIds.length > 0) {
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ status: "Planned", journalId: null, updatedBy: userId })
        .where("id", "in", scheduleIds)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .updateTable("customerContractLedgerEntry")
        .set({ journalId: null })
        .where("revenueRecognitionScheduleId", "in", scheduleIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    const leaseScheduleLineIds = [
      ...new Set(
        rows
          .map((row) => row.rentalLeaseScheduleLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (leaseScheduleLineIds.length > 0) {
      await trx
        .updateTable("rentalLeaseScheduleLine")
        .set({
          journalId: null,
          postedAt: null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "in", leaseScheduleLineIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    const lesseeScheduleLineIds = [
      ...new Set(
        rows
          .map((row) => row.leaseScheduleLineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (lesseeScheduleLineIds.length > 0) {
      await trx
        .updateTable("leaseScheduleLine")
        .set({
          journalId: null,
          postedAt: null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "in", lesseeScheduleLineIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    const contractRevenueIds = [
      ...new Set(
        rows
          .map((row) => row.customerContractRevenueId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (contractRevenueIds.length > 0) {
      await trx
        .updateTable("customerContractRevenue")
        .set({ status: "Planned", updatedBy: userId, updatedAt: now })
        .where("id", "in", contractRevenueIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    // A run posted before lease runs existed can hold rental rows. Those now
    // belong to the lease run: release them, so the next lease run claims
    // them. A run left holding nothing is deleted rather than kept as an
    // empty Draft.
    const otherFamily = rows.filter(
      (row) => runTypeOfScheduleRow(row) !== run.type
    );
    if (otherFamily.length > 0) {
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ runLineId: null, updatedBy: userId })
        .where(
          "id",
          "in",
          otherFamily.map((row) => row.id)
        )
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .deleteFrom("revenueRecognitionRunLine")
        .where(
          "id",
          "in",
          otherFamily.map((row) => row.lineId)
        )
        .where("companyId", "=", companyId)
        .execute();
    }
    if (otherFamily.length === rows.length) {
      await trx
        .deleteFrom("revenueRecognitionRun")
        .where("id", "=", runId)
        .where("companyId", "=", companyId)
        .execute();
      return { runId: run.runId, deleted: true };
    }

    await trx
      .updateTable("revenueRecognitionRun")
      .set({
        status: "Draft",
        journalId: null,
        postedAt: null,
        postedBy: null,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .execute();

    return { runId: run.runId, deleted: false };
  });
}

/**
 * Reverse Run for depreciation. Reverses every journal the run posted (each
 * month's, and each month's deferred tax), takes the run's amounts back off
 * each asset's accumulated book and tax depreciation, returns a Fully
 * Depreciated asset that is above its residual value to Active, and returns
 * the run to Draft. Only the latest posted run can be reversed: a later run
 * was calculated from the accumulated depreciation this one wrote.
 */
export async function reverseDepreciationRun(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    periods: RunPostingPeriods;
    companyId: string;
    userId: string;
  }
): Promise<{ depreciationRunId: string }> {
  const { depreciationRunId, periods, companyId, userId } = args;

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("depreciationRun")
      .select(["depreciationRunId", "status", "periodEnd"])
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Posted") {
      throw new RunReversalError(
        `Depreciation run ${run.depreciationRunId} is ${run.status}; only a posted run can be reversed`
      );
    }

    const later = await trx
      .selectFrom("depreciationRun")
      .select("depreciationRunId")
      .where("companyId", "=", companyId)
      .where("status", "=", "Posted")
      .where("periodEnd", ">", run.periodEnd)
      .orderBy("periodEnd")
      .executeTakeFirst();
    if (later) {
      throw new RunReversalError(
        `${later.depreciationRunId} is posted for a later period and builds on this run. Reverse it first.`
      );
    }

    const lines = await trx
      .selectFrom("depreciationRunLine as l")
      .innerJoin("fixedAsset as a", (join) =>
        join
          .onRef("a.id", "=", "l.fixedAssetId")
          .on("a.companyId", "=", companyId)
      )
      .select([
        "l.fixedAssetId",
        "l.amount",
        "l.taxAmount",
        "l.journalId",
        "l.deferredTaxJournalId",
        "a.fixedAssetId as assetReadableId",
        "a.status",
        "a.acquisitionCost",
        "a.accumulatedDepreciation",
        "a.accumulatedTaxDepreciation",
        "a.residualValuePercent"
      ])
      .where("l.depreciationRunId", "=", depreciationRunId)
      .where("l.companyId", "=", companyId)
      .execute();

    const disposed = lines.find((line) => line.status === "Disposed");
    if (disposed) {
      throw new RunReversalError(
        `${disposed.assetReadableId} was disposed after this run. Reverse the disposal first.`
      );
    }

    const journalIds = [
      ...new Set(
        lines
          .flatMap((line) => [line.journalId, line.deferredTaxJournalId])
          .filter((id): id is string => Boolean(id))
      )
    ];
    await reverseRunJournals(trx, { journalIds, periods, companyId, userId });

    // One update per asset with every month's amount, as posting wrote it.
    // Tax depreciation is taken back when the run carried it, not when the
    // setting is on today: a line has a taxAmount exactly when tax
    // depreciation was enabled as the run posted (Post refuses a run whose
    // lines no longer match the setting), and posting added it then.
    const byAsset = new Map<
      string,
      {
        line: (typeof lines)[number];
        amount: number;
        taxAmount: number;
        hasTax: boolean;
      }
    >();
    for (const line of lines) {
      const sums = byAsset.get(line.fixedAssetId) ?? {
        line,
        amount: 0,
        taxAmount: 0,
        hasTax: false
      };
      sums.amount += Number(line.amount);
      sums.taxAmount += Number(line.taxAmount ?? 0);
      sums.hasTax ||= line.taxAmount !== null;
      byAsset.set(line.fixedAssetId, sums);
    }
    for (const [fixedAssetId, { line, amount, taxAmount, hasTax }] of byAsset) {
      const accumulated = round(Number(line.accumulatedDepreciation) - amount);
      const cost = Number(line.acquisitionCost);
      const residualValue = cost * (Number(line.residualValuePercent) / 100);
      const assetUpdate: Record<string, unknown> = {
        accumulatedDepreciation: accumulated,
        updatedBy: userId
      };
      if (hasTax && taxAmount > 0) {
        assetUpdate.accumulatedTaxDepreciation = round(
          Number(line.accumulatedTaxDepreciation ?? 0) - taxAmount
        );
      }
      // Posting marks an asset Fully Depreciated at its residual value.
      if (
        line.status === "Fully Depreciated" &&
        cost - accumulated > residualValue + 0.01
      ) {
        assetUpdate.status = "Active";
      }
      await trx
        .updateTable("fixedAsset")
        .set(assetUpdate)
        .where("id", "=", fixedAssetId)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .updateTable("depreciationRunLine")
      .set({ journalId: null, deferredTaxJournalId: null })
      .where("depreciationRunId", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();

    await trx
      .updateTable("depreciationRun")
      .set({
        status: "Draft",
        postedAt: null,
        postedBy: null,
        updatedBy: userId
      })
      .where("id", "=", depreciationRunId)
      .where("companyId", "=", companyId)
      .execute();

    return { depreciationRunId: run.depreciationRunId };
  });
}

/** Deletes a Draft run and releases its claimed schedule rows (`runLineId`
 * back to null) so a later proposal can claim them again. A Posted run is
 * never deleted: Reverse Run (`reverseRevenueRecognitionRun`) returns it to
 * Draft first. */
export async function deleteRevenueRecognitionRun(
  db: Kysely<KyselyDatabase>,
  args: { runId: string; companyId: string; userId: string }
) {
  const { runId, companyId, userId } = args;

  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["runId", "status", "type"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.status !== "Draft") {
      throw new Error(
        `${runLabelSentence(run.type)} ${run.runId} is ${run.status}; reverse the run instead of deleting it`
      );
    }

    const lineIds = (
      await trx
        .selectFrom("revenueRecognitionRunLine")
        .select("id")
        .where("runId", "=", runId)
        .where("companyId", "=", companyId)
        .execute()
    ).map((line) => line.id);

    if (lineIds.length > 0) {
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ runLineId: null, updatedBy: userId })
        .where("runLineId", "in", lineIds)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .deleteFrom("revenueRecognitionRunLine")
        .where("runId", "=", runId)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .deleteFrom("revenueRecognitionRun")
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** A refusal a building block returned or threw ("Only open periods can be
 *  locked"): its own message, unless it came from the data layer. */
export function refusal(
  ctx: ServiceContext,
  err: unknown,
  fallback: string
): CarbonError {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message !== "" && !isDataLayerError(err)
    ? ctx.error("rule", message, err)
    : ctx.error("internal", fallback, err);
}

// ── Depreciation runs ───────────────────────────────────────────────────────

/** A Draft depreciation run for `periodEnd`, from what each asset should
 *  depreciate up to it. Shared by New Run and the period close. */
export async function createDepreciationRunAt(
  ctx: ServiceContext,
  periodEnd: string
) {
  // Never an empty run: with nothing to depreciate this refuses.
  const result = await createDepreciationRun(ctx.asCaller.supabase, {
    companyId: ctx.company.id,
    companyGroupId: ctx.company.groupId,
    periodEnd,
    userId: ctx.auditUserId
  });
  if (result.error) {
    return refusal(ctx, result.error, "Failed to create depreciation run");
  }
  return { id: result.data.id, readableId: result.data.depreciationRunId };
}

// ── Revenue recognition and lease runs ──────────────────────────────────────

/** A Draft run of `type` for `periodEnd`, unless the month has not started or
 *  a Draft of the type already holds the period. Shared by New Run, Repeat
 *  and the period close. */
export async function proposeRunAt(
  ctx: ServiceContext,
  periodEnd: string,
  type: RunType
) {
  const client = ctx.asCaller.supabase;
  const futureError = await futureRunPeriodError(
    client,
    ctx.company.id,
    periodEnd
  );
  if (futureError) return ctx.error("rule", futureError);

  // A period can have more than one run of a type (a second picks up rows
  // that fell due after the first posted), but only one Draft at a time.
  const existingDraft = await client
    .from("revenueRecognitionRun")
    .select("id, runId")
    .eq("periodEnd", periodEnd)
    .eq("companyId", ctx.company.id)
    .eq("type", type)
    .eq("status", "Draft")
    .maybeSingle();
  if (existingDraft.data) {
    return ctx.error(
      "conflict",
      `${existingDraft.data.runId} is already a draft for this period. Recalculate it instead.`,
      { draftRunId: existingDraft.data.id }
    );
  }

  // The proposal creates nothing when nothing is due.
  const proposal = await invokePosting(
    ctx,
    "propose-revenue-recognition-run",
    {
      periodEnd,
      type
    },
    proposeRevenueRecognitionRun
  );
  if (proposal.error) {
    return fromServerFn(ctx, proposal.error, "Failed to create the run");
  }
  if (!proposal.data) {
    return ctx.error("rule", "Nothing to post for this period");
  }
  return { id: proposal.data.id, readableId: proposal.data.runId, type };
}

/** The Draft run an "already a draft for this period" refusal names, for the
 *  page to open instead (`proposeRunAt`, `createRunForPeriod`). */
export function existingDraftRunId(
  error: { category: string; cause?: unknown } | null
): string | null {
  const cause = error?.category === "conflict" ? error.cause : null;
  return cause && typeof cause === "object" && "draftRunId" in cause
    ? String(cause.draftRunId)
    : null;
}

// ── Fixed assets ────────────────────────────────────────────────────────────

/**
 * Why an asset cannot be taken out of service now, or null. The page's loader
 * and the operation both ask: the form can be submitted long after it was
 * opened.
 */
export async function outOfServiceRefusal(
  caller: SupabaseClient<Database>,
  system: SupabaseClient<Database>,
  fixedAssetId: string,
  companyId: string
): Promise<{
  category: ErrorCategory;
  message: string;
  cause?: unknown;
} | null> {
  const asset = await getFixedAsset(caller, fixedAssetId, companyId);
  if (asset.error) {
    return {
      category: "notFound",
      message: "Failed to get fixed asset",
      cause: asset.error
    };
  }
  if (asset.data.outOfServiceSince) {
    return { category: "rule", message: "The asset is already out of service" };
  }
  if (asset.data.status === "Disposed") {
    return {
      category: "rule",
      message: "A disposed asset cannot be taken out of service"
    };
  }

  // A unit on rent goes to maintenance through the agreement's Return (with
  // "Take out of service"), never around it. Read with the service role,
  // scoped to the company and the asset: agreement lines need sales_view,
  // which an accountant may not hold, and under RLS that reads as "not on
  // rent". A failed read refuses rather than passes.
  const onRent = await getOnRentLineForAsset(system, fixedAssetId, companyId);
  if (onRent.error) {
    return {
      category: "internal",
      message: "Failed to check whether the asset is on rent",
      cause: onRent.error
    };
  }
  if (onRent.data) {
    const agreement = onRent.data.rentalAgreement;
    return {
      category: "rule",
      message: `The asset is on rent${agreement ? ` on ${agreement.rentalAgreementId}` : ""}; return it from the agreement and take it out of service there`
    };
  }
  return null;
}

// -- Revenue Recognition --

export async function getRevenueRecognitionRuns(
  client: SupabaseClient<Database>,
  companyId: string,
  type: Database["public"]["Enums"]["runType"],
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("revenueRecognitionRun")
    .select("id, runId, type, periodEnd, status, postedAt, journalId", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .eq("type", type);

  if (args.search) {
    query = query.ilike("runId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}
/**
 * Input contract and pure helpers for `post-asset-transfer`. No I/O and no
 * imports beyond zod, the generated types and `@carbon/utils`, so the server function's own
 * logic can be pinned without a database.
 */

// Calendar dates travel as `YYYY-MM-DD` text end to end: the transfer, the
// journal and the ledger rows all store DATE columns, and a JavaScript Date
// would shift the day by the runtime timezone.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/** Consume an Available serialized unit from stock into a fixed asset. */
export const capitalizeValidator = z.object({
  type: z.literal("capitalize"),
  fixedAssetClassId: z.string().min(1),
  itemId: z.string().min(1),
  trackedEntityId: z.string().min(1),
  locationId: z.string().min(1),
  storageUnitId: z.string().optional().nullable(),
  transferDate: calendarDate,
  name: z.string().optional().nullable(),
  // An existing Draft asset to fill; otherwise the function creates one.
  fixedAssetId: z.string().optional().nullable(),
  // What the unit cost to make, for a unit inventory carries at nothing (a job
  // that recorded no production or material, a no-cost issue). Refused for a
  // unit that carries a cost: that value moves from inventory as it is.
  cost: z.number().positive().optional().nullable(),
  // The other side of an entered cost: where that value was booked when it
  // was spent. Required with `cost`.
  offsetAccountId: z.string().optional().nullable()
});

/** Return an asset to stock at its net book value. */
export const returnValidator = z.object({
  type: z.literal("return"),
  fixedAssetId: z.string().min(1),
  locationId: z.string().min(1),
  storageUnitId: z.string().optional().nullable(),
  transferDate: calendarDate
});

/** Point a job at a Construction in Progress asset and sweep its WIP to it. */
export const attachJobValidator = z.object({
  type: z.literal("attachJob"),
  fixedAssetId: z.string().min(1),
  jobId: z.string().min(1)
});

/** Move a Construction in Progress asset into its in-service class. */
export const capitalizeCipValidator = z.object({
  type: z.literal("capitalizeCip"),
  fixedAssetId: z.string().min(1),
  toClassId: z.string().min(1),
  inServiceDate: calendarDate
});

/**
 * Raise an asset's cost after it was capitalized (post-capitalization): Dr the
 * class asset account / Cr `offsetAccountId`. Raise only — lowering a cost is
 * a write-down.
 */
export const adjustCostValidator = z.object({
  type: z.literal("adjustCost"),
  fixedAssetId: z.string().min(1),
  amount: z.number().positive(),
  offsetAccountId: z.string().optional().nullable(),
  locationId: z.string().min(1),
  transferDate: calendarDate
});

export const postAssetTransferInput = z.discriminatedUnion("type", [
  capitalizeValidator,
  returnValidator,
  attachJobValidator,
  capitalizeCipValidator,
  adjustCostValidator
]);

export type AssetTransferInput = z.output<typeof postAssetTransferInput>;

/** One `itemLedger` net per storage unit for a tracked entity at a location. */
export type StockByBin = {
  storageUnitId: string | null;
  onHand: number | string | null;
};

/**
 * Where a serialized unit's stock is, from its ledger nets per bin. `onHand` is
 * the unit's total at the location; `storageUnitId` is the bin with the
 * highest positive net — a picked or transferred unit has rows in more than
 * one bin, so "the first row's bin" would book the consumption against a bin
 * that no longer holds it (see `.ai/lessons.md`, tracked-entity bin resolution).
 * Falls back to `preferredStorageUnitId` only when no bin nets positive.
 */
export function resolveCapitalizationStock(
  rows: StockByBin[],
  preferredStorageUnitId: string | null = null
): { onHand: number; storageUnitId: string | null } {
  let onHand = 0;
  let bestBin: string | null = null;
  let bestQuantity = 0;
  for (const row of rows) {
    const quantity = Number(row.onHand ?? 0);
    onHand += quantity;
    if (row.storageUnitId && quantity > bestQuantity) {
      bestQuantity = quantity;
      bestBin = row.storageUnitId;
    }
  }
  return { onHand, storageUnitId: bestBin ?? preferredStorageUnitId };
}

/** Job statuses that can no longer take on a Construction in Progress asset. */
export const CLOSED_JOB_STATUSES: ReadonlySet<
  Database["public"]["Enums"]["jobStatus"]
> = new Set(["Completed", "Cancelled", "Closed"] as const);

/** Asset statuses a unit can be returned to inventory from. */
export const RETURNABLE_ASSET_STATUSES: ReadonlySet<
  Database["public"]["Enums"]["fixedAssetStatus"]
> = new Set(["Active", "Fully Depreciated"] as const);

/** Asset statuses whose cost can be adjusted. */
export const ADJUSTABLE_ASSET_STATUSES: ReadonlySet<
  Database["public"]["Enums"]["fixedAssetStatus"]
> = new Set(["Active", "Fully Depreciated"] as const);

/**
 * The cost a unit is capitalized at: what inventory carries it at, or — only
 * when that is nothing — the cost the user entered. Returns the refusal
 * message instead when neither gives the asset a value, or when a cost is
 * entered for a unit that already carries one.
 */
export function resolveCapitalizationCost(args: {
  carried: number;
  entered: number | null | undefined;
  serial: string;
  itemReadableId: string;
}): { cost: number; source: "inventory" | "entered" } | { error: string } {
  const { carried, entered, serial, itemReadableId } = args;
  if (carried > 0) {
    if (entered != null) {
      return {
        error: `${serial} is carried in inventory at a cost, so it is capitalized at that cost; clear the entered cost`
      };
    }
    return { cost: carried, source: "inventory" };
  }
  if (entered != null && entered > 0) {
    return { cost: entered, source: "entered" };
  }
  return {
    error: `${serial} has no cost in inventory, so the asset would be worth nothing. Enter what it cost, or set a unit cost on ${itemReadableId}, then capitalize it.`
  };
}

/**
 * An asset's status once its cost is raised: a Fully Depreciated asset whose
 * net book value is above its residual again has depreciation left to take,
 * so it returns to Active and the depreciation runs pick it up.
 */
export function statusAfterCostAdjustment(args: {
  status: Database["public"]["Enums"]["fixedAssetStatus"];
  acquisitionCost: number;
  accumulatedDepreciation: number;
  residualValuePercent: number;
}): Database["public"]["Enums"]["fixedAssetStatus"] {
  if (args.status !== "Fully Depreciated") return args.status;
  const residual = args.acquisitionCost * (args.residualValuePercent / 100);
  const remaining = args.acquisitionCost - args.accumulatedDepreciation;
  return remaining - residual > EPSILON ? "Active" : args.status;
}
// The single write path for moving value between inventory and the fixed
// asset register (spec §2, "Fleet bridge"). Five actions, each creating and
// posting one `fixedAssetTransfer` document in ONE transaction:
//
//   capitalize     stock → asset at the unit's carrying cost (the serial is
//                  consumed INTO the asset; Dr class asset / Cr inventory);
//                  a unit carried at zero takes the cost the user enters
//                  instead (Dr class asset / Cr the chosen offset account),
//                  and is refused without one
//   return         asset → stock at net book value (Dr inventory N / Dr
//                  accumulated depreciation / Cr class asset at cost)
//   attachJob      point a job at a Construction in Progress asset and sweep
//                  its WIP balance there (Dr CIP / Cr WIP), SAP AuC style
//   capitalizeCip  CIP asset → its in-service class (Dr class / Cr CIP)
//   adjustCost     raise an asset's cost after it was capitalized (Dr class
//                  asset / Cr the chosen offset account), SAP
//                  post-capitalization style
//
// Every action writes its journal: Provisional before the company's
// accounting cutover, Posted after it.
//
// Business-validation failures are 400s (`InvalidInputError`) with the exact
// message the app shows; a referenced record the caller's company does not own
// is a 404 (`NotFoundError`); everything else is a 500 so real outages surface
// in monitoring.

type Db = Kysely<DB>;

type Trx = KyselyTransaction<DB>;

type Scoped<T extends AssetTransferInput["type"]> = Extract<
  AssetTransferInput,
  { type: T }
> & { companyId: string; userId: string };

type AccountingContext = {
  // Provisional before the company's accounting cutover, Posted after it
  postingStatus: AutomaticJournalStatus;
  // null for a Provisional journal: it has no accounting period
  accountingPeriodId: string | null;
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
    workInProgressAccount: string;
  };
  // active dimensions for the company group, entityType → dimension id
  dimensions: Record<string, string>;
};

export type AssetTransferResult = {
  // fixedAssetTransfer row id / readable number; null when nothing was swept
  id: string | null;
  transferId: string | null;
  // fixedAsset row id / readable number
  fixedAssetId: string;
  fixedAssetReadableId: string;
};

// Everything a journal needs that is known before the transaction opens. The
// period resolver opens (and commits) its own transaction when given `db`.
async function loadAccounting(
  db: Db,
  companyId: string,
  postingDate: string
): Promise<AccountingContext> {
  const postingStatus = await journalPostingStatus(db, companyId);

  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

  const company = await db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company) throw new Error("Failed to fetch company");
  // Fail closed: journal lines must not silently lose dimension tags (a
  // failed read throws).
  const dimensionRows = await db
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", ["Item", "Location", "FixedAssetClass"])
    .execute();
  const dimensions: Record<string, string> = {};
  for (const dimension of dimensionRows) {
    dimensions[dimension.entityType] = dimension.id;
  }

  // A Provisional journal has no period, and no posting creates one before
  // the cutover.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getAccountingPeriodForDate(companyId, db, postingDate)
      : null;

  return {
    postingStatus,
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
      workInProgressAccount: accountDefaults.data.workInProgressAccount
    },
    dimensions
  };
}

// One 'Asset Transfer' journal from already-balanced lines (Provisional before
// the accounting cutover, Posted after it), tagged with
// the Location / FixedAssetClass / Item dimensions the company group has
// active (post-receipt precedent for fixed-asset lines).
async function postAssetJournal(
  trx: Trx,
  args: {
    accounting: AccountingContext;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    lines: PostingLine[];
    documentId: string;
    documentLineReference?: string | null;
    tags: {
      locationId: string | null;
      fixedAssetClassId: string | null;
      itemId: string | null;
    };
  }
): Promise<string> {
  const { accounting, companyId, userId } = args;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: accounting.accountingPeriodId,
    status: accounting.postingStatus,
    description: args.description,
    postingDate: args.postingDate,
    userId,
    sourceType: "Asset Transfer"
  });

  const journalLineReference = nanoid();
  const journalLines = await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line) => ({
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Asset Transfer" as const,
        documentId: args.documentId,
        documentLineReference: args.documentLineReference ?? null,
        journalLineReference,
        companyId
      }))
    )
    .returning(["id"])
    .execute();

  const tagValues: Array<[string, string | null]> = [
    ["Location", args.tags.locationId],
    ["FixedAssetClass", args.tags.fixedAssetClassId],
    ["Item", args.tags.itemId]
  ];
  const dimensionInserts = journalLines.flatMap((line) =>
    tagValues
      .filter(
        ([entityType, valueId]) => accounting.dimensions[entityType] && valueId
      )
      .map(([entityType, valueId]) => ({
        journalLineId: line.id,
        dimensionId: accounting.dimensions[entityType] as string,
        valueId: valueId as string,
        companyId
      }))
  );
  if (dimensionInserts.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionInserts)
      .execute();
  }

  return journalId;
}

type AssetRow = {
  id: string;
  fixedAssetId: string;
  fixedAssetClassId: string;
  name: string;
  status: Database["public"]["Enums"]["fixedAssetStatus"];
  itemId: string | null;
  trackedEntityId: string | null;
  locationId: string | null;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  outOfServiceSince: unknown;
};

async function getAsset(
  db: Db,
  companyId: string,
  id: string
): Promise<AssetRow> {
  const asset = await db
    .selectFrom("fixedAsset")
    .select([
      "id",
      "fixedAssetId",
      "fixedAssetClassId",
      "name",
      "status",
      "itemId",
      "trackedEntityId",
      "locationId",
      "acquisitionCost",
      "accumulatedDepreciation",
      "outOfServiceSince"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!asset) throw new NotFoundError("Fixed asset not found");
  return {
    ...asset,
    acquisitionCost: Number(asset.acquisitionCost ?? 0),
    accumulatedDepreciation: Number(asset.accumulatedDepreciation ?? 0)
  };
}

type AssetClassRow = {
  id: string;
  name: string;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  isConstructionInProgress: boolean;
  depreciationMethod: Database["public"]["Enums"]["depreciationMethod"];
  usefulLifeMonths: number;
  residualValuePercent: number;
};

async function getAssetClass(
  db: Db,
  companyId: string,
  id: string
): Promise<AssetClassRow> {
  const assetClass = await db
    .selectFrom("fixedAssetClass")
    .select([
      "id",
      "name",
      "assetAccountId",
      "accumulatedDepreciationAccountId",
      "isConstructionInProgress",
      "depreciationMethod",
      "usefulLifeMonths",
      "residualValuePercent"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!assetClass) throw new NotFoundError("Fixed asset class not found");
  return assetClass;
}

type InventoryItem = {
  id: string;
  name: string;
  readableId: string;
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"] | null;
  replenishmentSystem:
    | Database["public"]["Enums"]["itemReplenishmentSystem"]
    | null;
  itemPostingGroupId: string | null;
  itemCost: {
    costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
    unitCost: number | null;
    standardCost: number | null;
  };
};

async function getInventoryItem(
  db: Db,
  companyId: string,
  itemId: string
): Promise<InventoryItem> {
  const [item, itemCost] = await inOrder([
    () =>
      db
        .selectFrom("item")
        .select([
          "id",
          "name",
          "readableId",
          "itemTrackingType",
          "replenishmentSystem"
        ])
        .where("id", "=", itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
    () =>
      db
        .selectFrom("itemCost")
        .select([
          "costingMethod",
          "unitCost",
          "standardCost",
          "itemPostingGroupId"
        ])
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
  ]);
  if (!item) throw new NotFoundError("Item not found");
  if (!itemCost) throw new NotFoundError("Item cost not found");
  return {
    ...item,
    itemPostingGroupId: itemCost.itemPostingGroupId,
    itemCost: {
      costingMethod: itemCost.costingMethod,
      unitCost: itemCost.unitCost,
      standardCost: itemCost.standardCost
    }
  };
}

type TrackedEntityRow = {
  id: string;
  itemId: string | null;
  readableId: string | null;
  status: Database["public"]["Enums"]["trackedEntityStatus"];
};

async function getTrackedEntity(
  db: Db,
  companyId: string,
  id: string
): Promise<TrackedEntityRow> {
  const entity = await db
    .selectFrom("trackedEntity")
    .select(["id", "itemId", "readableId", "status"])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!entity) throw new NotFoundError("Tracked entity not found");
  return entity;
}

// The traceability graph records the asset as the consumer (capitalize) or
// the producer (return) of the unit, mirroring complete_job_to_inventory's
// 'Capitalize' activity.
async function insertAssetActivity(
  trx: Trx,
  args: {
    type: "Capitalize" | "Return to Inventory";
    direction: "input" | "output";
    asset: { id: string; fixedAssetId: string };
    trackedEntityId: string;
    companyId: string;
    userId: string;
  }
): Promise<void> {
  const activityId = nanoid();
  await trx
    .insertInto("trackedActivity")
    .values({
      id: activityId,
      type: args.type,
      sourceDocument: "Fixed Asset",
      sourceDocumentId: args.asset.id,
      sourceDocumentReadableId: args.asset.fixedAssetId,
      attributes: { "Fixed Asset": args.asset.id },
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
  await trx
    .insertInto(
      args.direction === "input"
        ? "trackedActivityInput"
        : "trackedActivityOutput"
    )
    .values({
      trackedActivityId: activityId,
      trackedEntityId: args.trackedEntityId,
      quantity: 1,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
}

async function postTransfer(
  trx: Trx,
  args: {
    id: string;
    amount: number;
    journalId: string | null;
    companyId: string;
    userId: string;
  }
): Promise<void> {
  await trx
    .updateTable("fixedAssetTransfer")
    .set({
      amount: round(args.amount),
      journalId: args.journalId,
      status: "Posted",
      postedAt: datetime.timestamp(),
      postedBy: args.userId,
      updatedAt: datetime.timestamp(),
      updatedBy: args.userId
    })
    .where("id", "=", args.id)
    .where("companyId", "=", args.companyId)
    .execute();
}

async function capitalize(
  db: Db,
  payload: Scoped<"capitalize">
): Promise<AssetTransferResult> {
  const { companyId, userId, itemId, trackedEntityId, locationId } = payload;

  const [assetClass, item, entity] = await inOrder([
    () => getAssetClass(db, companyId, payload.fixedAssetClassId),
    () => getInventoryItem(db, companyId, itemId),
    () => getTrackedEntity(db, companyId, trackedEntityId),
    () =>
      assertCompanyRecords(db, "location", [locationId], companyId, "Location"),
    () =>
      assertCompanyRecords(
        db,
        "storageUnit",
        [payload.storageUnitId],
        companyId,
        "Storage unit"
      )
  ]);
  const draftAsset = payload.fixedAssetId
    ? await getAsset(db, companyId, payload.fixedAssetId)
    : null;

  if (entity.itemId !== itemId) {
    throw new InvalidInputError("The unit does not belong to this item");
  }
  if (entity.status !== "Available") {
    throw new InvalidInputError(
      `Only an Available unit can be capitalized; ${
        entity.readableId ?? entity.id
      } is ${entity.status}`
    );
  }
  if (draftAsset && draftAsset.status !== "Draft") {
    throw new InvalidInputError(
      `Asset ${draftAsset.fixedAssetId} is ${draftAsset.status}; only a Draft asset can be filled`
    );
  }

  // The partial unique index refuses two live assets on one unit as well; the
  // read gives the caller a reason instead of a constraint name.
  const liveAsset = await db
    .selectFrom("fixedAsset")
    .select("fixedAssetId")
    .where("trackedEntityId", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .where("status", "<>", "Disposed")
    .limit(1)
    .executeTakeFirst();
  if (liveAsset) {
    throw new InvalidInputError(
      `${
        entity.readableId ?? entity.id
      } is already on asset ${liveAsset.fixedAssetId}`
    );
  }

  const accounting = await loadAccounting(db, companyId, payload.transferDate);
  // Only read when a cost was entered; whether one may be is decided once the
  // unit's carrying cost is known, inside the transaction.
  const offsetAccount =
    payload.cost != null
      ? await getOffsetAccount(db, companyId, payload.offsetAccountId)
      : null;
  const serial = entity.readableId ?? entity.id;
  const status = assetClass.isConstructionInProgress
    ? ("Under Construction" as const)
    : ("Active" as const);

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // Net on-hand per bin at the location, read inside the transaction so the
    // consumption below books against the same snapshot.
    const stockRows = await trx
      .selectFrom("itemLedger")
      .select([
        "storageUnitId",
        (eb) => eb.fn.sum<number>("quantity").as("onHand")
      ])
      .where("trackedEntityId", "=", trackedEntityId)
      .where("itemId", "=", itemId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .groupBy("storageUnitId")
      .execute();
    const stock = resolveCapitalizationStock(
      stockRows,
      payload.storageUnitId ?? null
    );
    if (round(stock.onHand) !== 1) {
      throw new InvalidInputError(
        `${serial} must have exactly one unit on hand at this location (found ${round(
          stock.onHand
        )})`
      );
    }

    const transferId = await getNextSequenceInTransaction(
      trx,
      "fixedAssetTransfer",
      companyId
    );

    // The asset first: the transfer references it. Its cost is filled in once
    // the ledger has relieved the unit's carrying value below.
    let asset: { id: string; fixedAssetId: string };
    const assetFields = {
      fixedAssetClassId: assetClass.id,
      itemId,
      trackedEntityId,
      serialNumber: entity.readableId,
      locationId,
      acquisitionDate: payload.transferDate,
      // A CIP asset does not depreciate until it is capitalized.
      depreciationStartDate: assetClass.isConstructionInProgress
        ? null
        : payload.transferDate,
      depreciationMethod: assetClass.depreciationMethod,
      usefulLifeMonths: assetClass.usefulLifeMonths,
      residualValuePercent: assetClass.residualValuePercent,
      status
    };
    if (draftAsset) {
      // Same Draft race guard as registration: a concurrent fill or disposal
      // wins and this transaction rolls back.
      const filled = await trx
        .updateTable("fixedAsset")
        .set({
          ...assetFields,
          ...(payload.name ? { name: payload.name } : {}),
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .where("id", "=", draftAsset.id)
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .executeTakeFirst();
      if (!filled.numUpdatedRows) {
        throw new InvalidInputError("Asset is no longer in Draft status");
      }
      asset = { id: draftAsset.id, fixedAssetId: draftAsset.fixedAssetId };
    } else {
      const fixedAssetId = await getNextSequenceInTransaction(
        trx,
        "fixedAsset",
        companyId
      );
      const inserted = await trx
        .insertInto("fixedAsset")
        .values({
          ...assetFields,
          fixedAssetId,
          name: payload.name?.trim() || `${item.name} ${serial}`,
          quantity: 1,
          acquisitionCost: 0,
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      asset = { id: inserted.id, fixedAssetId };
    }

    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Capitalization",
        sourceType: "Inventory",
        fixedAssetId: asset.id,
        itemId,
        trackedEntityId,
        locationId,
        storageUnitId: stock.storageUnitId,
        quantity: 1,
        transferDate: payload.transferDate,
        amount: 0,
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    // Relieve the unit from stock at its carrying cost — the same layer
    // consumer shipments use, for any costing method. accounting: null keeps
    // the core from posting a variance journal; the asset journal is below.
    const booked = await bookAdjustment(trx, {
      ledger: {
        postingDate: payload.transferDate,
        itemId,
        quantity: -1,
        locationId,
        storageUnitId: stock.storageUnitId,
        trackedEntityId,
        entryType: "Negative Adjmt.",
        documentType: "Asset Transfer",
        documentId: transfer.id,
        companyId,
        createdBy: userId
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: item.itemPostingGroupId
      },
      itemCost: item.itemCost,
      accounting: null
    });
    // The transfer moves the value inventory already holds. A unit carried at
    // nothing (a job that recorded no production or material, a no-cost
    // issue) would become an asset worth nothing with no journal to say so,
    // so it takes the cost the user entered instead — booked from the offset
    // account that value was spent from — and is refused without one.
    const resolved = resolveCapitalizationCost({
      carried: round(booked.cost),
      entered: payload.cost == null ? null : round(payload.cost),
      serial,
      itemReadableId: item.readableId
    });
    if ("error" in resolved) throw new InvalidInputError(resolved.error);
    const cost = resolved.cost;

    const inventoryAccount = resolveInventoryAccount(
      item.replenishmentSystem,
      accounting.accountDefaults
    );
    const credit =
      resolved.source === "entered" && offsetAccount
        ? {
            account: offsetAccount.id,
            description: "Capitalized Cost",
            type: offsetAccount.type
          }
        : { ...inventoryAccount, type: "asset" as const };
    const journalId = await postAssetJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: payload.transferDate,
      description: `Capitalize ${item.readableId} ${serial} → ${asset.fixedAssetId}`,
      lines: buildCapitalizationLines({
        cost,
        assetAccountId: assetClass.assetAccountId,
        creditAccountId: credit.account,
        creditDescription: credit.description,
        creditAccountType: credit.type
      }),
      documentId: transfer.id,
      tags: { locationId, fixedAssetClassId: assetClass.id, itemId }
    });

    await trx
      .updateTable("fixedAsset")
      .set({
        acquisitionCost: cost,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .execute();

    // A CIP-class asset is later capitalized for Σ fixedAssetCipCost, so the
    // value that arrived from stock has to be on that ledger too.
    if (assetClass.isConstructionInProgress) {
      await trx
        .insertInto("fixedAssetCipCost")
        .values({
          fixedAssetId: asset.id,
          sourceType: "Manual",
          sourceDocumentId: transfer.id,
          amount: cost,
          costDate: payload.transferDate,
          journalId,
          companyId,
          createdBy: userId
        })
        .execute();
    }

    // The unit is consumed into the asset: no longer stock, and the asset id
    // on its attributes is how the fleet finds it again.
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Consumed",
        attributes: sql<Json>`COALESCE("attributes", '{}'::jsonb) || jsonb_build_object('Fixed Asset', ${asset.id}::text)`
      })
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .execute();
    await insertAssetActivity(trx, {
      type: "Capitalize",
      direction: "input",
      asset,
      trackedEntityId,
      companyId,
      userId
    });

    await postTransfer(trx, {
      id: transfer.id,
      amount: cost,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function returnToInventory(
  db: Db,
  payload: Scoped<"return">
): Promise<AssetTransferResult> {
  const { companyId, userId, locationId } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  if (!RETURNABLE_ASSET_STATUSES.has(asset.status)) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Active or Fully Depreciated asset can be returned to inventory`
    );
  }
  if (asset.outOfServiceSince) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is out of service; return it to service first`
    );
  }
  if (!asset.itemId || !asset.trackedEntityId) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is not linked to a serialized inventory unit`
    );
  }
  const netBookValue = round(
    asset.acquisitionCost - asset.accumulatedDepreciation
  );
  if (netBookValue < 0) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} has a negative net book value`
    );
  }

  const assetItemId = asset.itemId;
  const assetTrackedEntityId = asset.trackedEntityId;
  const [assetClass, item, entity] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () => getInventoryItem(db, companyId, assetItemId),
    () => getTrackedEntity(db, companyId, assetTrackedEntityId),
    () =>
      assertCompanyRecords(db, "location", [locationId], companyId, "Location"),
    () =>
      assertCompanyRecords(
        db,
        "storageUnit",
        [payload.storageUnitId],
        companyId,
        "Storage unit"
      )
  ]);
  if (entity.status !== "Consumed") {
    throw new InvalidInputError(
      `Unit ${
        entity.readableId ?? entity.id
      } is ${entity.status}, not consumed into the asset`
    );
  }

  const accounting = await loadAccounting(db, companyId, payload.transferDate);
  const serial = entity.readableId ?? entity.id;
  const trackedEntityId = entity.id;
  const itemId = item.id;

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // A unit reserved or on rent belongs to that agreement until it comes
    // back: the live-line statuses are the ones the fleetAssets view and the
    // rentalAgreementLine_asset_live_idx unique index key on.
    const liveLine = await trx
      .selectFrom("rentalAgreementLine as ral")
      .innerJoin("rentalAgreement as ra", (join) =>
        join
          .onRef("ra.id", "=", "ral.rentalAgreementId")
          .onRef("ra.companyId", "=", "ral.companyId")
      )
      .select(["ral.status", "ra.rentalAgreementId"])
      .where("ral.fixedAssetId", "=", asset.id)
      .where("ral.companyId", "=", companyId)
      .where("ral.status", "in", ["Pending", "On Rent"])
      .executeTakeFirst();
    if (liveLine) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is ${
          liveLine.status === "On Rent" ? "on rent" : "reserved"
        } on rental agreement ${liveLine.rentalAgreementId}; return it from the agreement first`
      );
    }

    const transferId = await getNextSequenceInTransaction(
      trx,
      "fixedAssetTransfer",
      companyId
    );
    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Return to Inventory",
        sourceType: "Inventory",
        fixedAssetId: asset.id,
        itemId,
        trackedEntityId,
        locationId,
        storageUnitId: payload.storageUnitId ?? null,
        quantity: 1,
        transferDate: payload.transferDate,
        amount: netBookValue,
        accumulatedDepreciation: round(asset.accumulatedDepreciation),
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    // Back into stock at net book value: a cost layer at N stamped with the
    // serial, so under FIFO / LIFO that unit is later relieved at N (gross
    // revenue + COGS at N), not at the oldest layer (cost-layer-order.ts).
    await bookAdjustment(trx, {
      ledger: {
        postingDate: payload.transferDate,
        itemId,
        quantity: 1,
        locationId,
        storageUnitId: payload.storageUnitId ?? null,
        trackedEntityId,
        entryType: "Positive Adjmt.",
        documentType: "Asset Transfer",
        documentId: transfer.id,
        companyId,
        createdBy: userId
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: item.itemPostingGroupId
      },
      itemCost: item.itemCost,
      accounting: null,
      fixedUnitCost: netBookValue
    });

    // An asset carried at zero cost has nothing on the books to move.
    let journalId: string | null = null;
    if (round(asset.acquisitionCost) > 0) {
      const inventoryAccount = resolveInventoryAccount(
        item.replenishmentSystem,
        accounting.accountDefaults
      );
      journalId = await postAssetJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: payload.transferDate,
        description: `Return to inventory ${asset.fixedAssetId} → ${item.readableId} ${serial}`,
        lines: buildReturnToInventoryLines({
          cost: asset.acquisitionCost,
          accumulatedDepreciation: asset.accumulatedDepreciation,
          inventoryAccountId: inventoryAccount.account,
          inventoryDescription: inventoryAccount.description,
          accounts: {
            assetAccountId: assetClass.assetAccountId,
            accumulatedDepreciationAccountId:
              assetClass.accumulatedDepreciationAccountId
          }
        }),
        documentId: transfer.id,
        tags: { locationId, fixedAssetClassId: assetClass.id, itemId }
      });
    }

    const disposed = await trx
      .updateTable("fixedAsset")
      .set({
        status: "Disposed",
        disposalMethod: "Transfer to Inventory",
        disposalDate: payload.transferDate,
        saleProceeds: 0,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...RETURNABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!disposed.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} changed status while it was being returned`
      );
    }
    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId: asset.id,
        disposalMethod: "Transfer to Inventory",
        disposalDate: payload.transferDate,
        saleProceeds: 0,
        netBookValueAtDisposal: netBookValue,
        gainLoss: 0,
        journalId,
        companyId,
        createdBy: userId
      })
      .execute();

    // The return inspection already happened on the agreement, so the unit
    // comes back Available (an RMA reactivates to On Hold because none has).
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Available",
        attributes: sql<Json>`COALESCE("attributes", '{}'::jsonb) - 'Fixed Asset'`
      })
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .execute();
    await insertAssetActivity(trx, {
      type: "Return to Inventory",
      direction: "output",
      asset,
      trackedEntityId,
      companyId,
      userId
    });

    await postTransfer(trx, {
      id: transfer.id,
      amount: netBookValue,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function attachJob(
  db: Db,
  payload: Scoped<"attachJob">
): Promise<AssetTransferResult> {
  const { companyId, userId, jobId } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  const [assetClass, jobRow] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () =>
      db
        .selectFrom("job")
        .select([
          "id",
          "jobId",
          "itemId",
          "status",
          "locationId",
          "salesOrderLineId",
          "fixedAssetClassId",
          "fixedAssetId"
        ])
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
  ]);
  if (!jobRow) throw new NotFoundError("Job not found");
  const job = jobRow;

  if (!assetClass.isConstructionInProgress) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is not in a Construction in Progress class`
    );
  }
  if (asset.status !== "Draft" && asset.status !== "Under Construction") {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; a job can only be attached while it is Draft or Under Construction`
    );
  }
  if (CLOSED_JOB_STATUSES.has(job.status)) {
    throw new InvalidInputError(
      `Job ${job.jobId} is ${job.status} and can no longer be attached to an asset`
    );
  }
  if (job.salesOrderLineId) {
    throw new InvalidInputError(
      `Job ${job.jobId} is linked to a sales order line and cannot build an asset`
    );
  }
  if (job.fixedAssetClassId || job.fixedAssetId) {
    throw new InvalidInputError(
      `Job ${job.jobId} already completes to a fixed asset`
    );
  }

  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();
  const accounting = await loadAccounting(db, companyId, today);

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // The job's WIP balance so far: cost leaves WIP at attachment (SAP AuC).
    // Before the cutover it sits in Provisional journals and is swept by one.
    const wip = await trx
      .selectFrom("journalLine as jl")
      .innerJoin("journal as j", (join) =>
        join
          .onRef("j.id", "=", "jl.journalId")
          .onRef("j.companyId", "=", "jl.companyId")
      )
      .select((eb) =>
        eb.fn
          .coalesce(eb.fn.sum<number>("jl.amount"), sql<number>`0`)
          .as("balance")
      )
      .where(
        "jl.accountId",
        "=",
        accounting.accountDefaults.workInProgressAccount
      )
      .where("jl.documentId", "=", jobId)
      .where("jl.companyId", "=", companyId)
      .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
      .executeTakeFirst();
    const balance = round(Number(wip?.balance ?? 0));

    let result: Pick<AssetTransferResult, "id" | "transferId"> = {
      id: null,
      transferId: null
    };
    if (balance > 0) {
      const transferId = await getNextSequenceInTransaction(
        trx,
        "fixedAssetTransfer",
        companyId
      );
      const transfer = await trx
        .insertInto("fixedAssetTransfer")
        .values({
          transferId,
          type: "Capitalization",
          sourceType: "Job",
          fixedAssetId: asset.id,
          itemId: job.itemId,
          jobId,
          locationId: job.locationId,
          quantity: 1,
          transferDate: today,
          amount: balance,
          status: "Draft",
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      // Both lines carry the job as documentId so the per-job WIP balance
      // still nets to zero; the transfer rides in documentLineReference.
      const journalId = await postAssetJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description: `Attach job ${job.jobId} → ${asset.fixedAssetId}`,
        lines: buildCapitalizationLines({
          cost: balance,
          assetAccountId: assetClass.assetAccountId,
          creditAccountId: accounting.accountDefaults.workInProgressAccount,
          creditDescription: "WIP Account"
        }),
        documentId: jobId,
        documentLineReference: transferId,
        tags: {
          locationId: job.locationId,
          fixedAssetClassId: assetClass.id,
          itemId: job.itemId
        }
      });

      await trx
        .insertInto("fixedAssetCipCost")
        .values({
          fixedAssetId: asset.id,
          sourceType: "Job",
          jobId,
          amount: balance,
          costDate: today,
          journalId,
          companyId,
          createdBy: userId
        })
        .execute();

      await postTransfer(trx, {
        id: transfer.id,
        amount: balance,
        journalId,
        companyId,
        userId
      });
      result = { id: transfer.id, transferId };
    }

    // The link itself: guarded on the job still having no target, so two
    // concurrent attachments cannot both win.
    const linked = await trx
      .updateTable("job")
      .set({
        fixedAssetId: asset.id,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", jobId)
      .where("companyId", "=", companyId)
      .where("fixedAssetId", "is", null)
      .where("fixedAssetClassId", "is", null)
      .executeTakeFirst();
    if (!linked.numUpdatedRows) {
      throw new InvalidInputError(
        `Job ${job.jobId} already completes to a fixed asset`
      );
    }
    // Guarded on the status read above and written relative to the row as
    // it is now: a concurrent capitalization or another attachment must not
    // be overwritten with a cost read before this transaction began.
    const swept = await trx
      .updateTable("fixedAsset")
      .set({
        status: "Under Construction",
        acquisitionCost: sql<number>`COALESCE("acquisitionCost", 0) + ${balance}`,
        // A self-built asset lives where it is built (post-receipt precedent:
        // the receiving location fills an unset asset location).
        locationId: sql<
          string | null
        >`COALESCE("locationId", ${job.locationId})`,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Under Construction"])
      .executeTakeFirst();
    if (!swept.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is no longer Draft or Under Construction`
      );
    }

    return {
      ...result,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function capitalizeCip(
  db: Db,
  payload: Scoped<"capitalizeCip">
): Promise<AssetTransferResult> {
  const { companyId, userId, inServiceDate } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  const [cipClass, targetClass] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () => getAssetClass(db, companyId, payload.toClassId)
  ]);

  if (asset.status !== "Under Construction") {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Under Construction asset can be capitalized`
    );
  }
  if (!cipClass.isConstructionInProgress) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is not in a Construction in Progress class`
    );
  }
  if (targetClass.isConstructionInProgress) {
    throw new InvalidInputError(
      `${targetClass.name} is a Construction in Progress class; choose the in-service class`
    );
  }

  // The transfer document needs a location: the asset's own, else the site
  // of the job that built it.
  let locationId = asset.locationId;
  if (!locationId) {
    const builder = await db
      .selectFrom("job")
      .select("locationId")
      .where("fixedAssetId", "=", asset.id)
      .where("companyId", "=", companyId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .executeTakeFirst();
    locationId = builder?.locationId ?? null;
  }
  if (!locationId) {
    throw new InvalidInputError(
      `Set a location on asset ${asset.fixedAssetId} before capitalizing it`
    );
  }
  const assetLocationId = locationId;

  const accounting = await loadAccounting(db, companyId, inServiceDate);

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // Lock the asset before summing its cost rows: an attachment or a
    // receipt adding a row after the sum would be left out of the
    // capitalized cost while the asset leaves Under Construction.
    const locked = await trx
      .selectFrom("fixedAsset")
      .select("status")
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (locked?.status !== "Under Construction") {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is no longer Under Construction`
      );
    }

    const cipCost = await trx
      .selectFrom("fixedAssetCipCost")
      .select((eb) =>
        eb.fn.coalesce(eb.fn.sum<number>("amount"), sql<number>`0`).as("total")
      )
      .where("fixedAssetId", "=", asset.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    const total = round(Number(cipCost?.total ?? 0));
    if (total <= 0) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} has no Construction in Progress cost to capitalize`
      );
    }

    const transferId = await getNextSequenceInTransaction(
      trx,
      "fixedAssetTransfer",
      companyId
    );
    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Capitalization",
        sourceType: "Construction in Progress",
        fixedAssetId: asset.id,
        itemId: asset.itemId,
        trackedEntityId: asset.trackedEntityId,
        fromClassId: cipClass.id,
        locationId: assetLocationId,
        quantity: 1,
        transferDate: inServiceDate,
        inServiceDate,
        amount: total,
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalId = await postAssetJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: inServiceDate,
      description: `Capitalize ${asset.fixedAssetId} — ${cipClass.name} → ${targetClass.name}`,
      lines: buildCapitalizationLines({
        cost: total,
        assetAccountId: targetClass.assetAccountId,
        creditAccountId: cipClass.assetAccountId,
        creditDescription: "Construction in Progress"
      }),
      documentId: transfer.id,
      tags: {
        locationId: assetLocationId,
        fixedAssetClassId: targetClass.id,
        itemId: asset.itemId
      }
    });

    // Depreciation starts at the in-service date under the in-service class's
    // policy; the CIP class's method / life / residual were placeholders that
    // never ran.
    const capitalized = await trx
      .updateTable("fixedAsset")
      .set({
        fixedAssetClassId: targetClass.id,
        acquisitionCost: total,
        acquisitionDate: inServiceDate,
        depreciationStartDate: inServiceDate,
        depreciationMethod: targetClass.depreciationMethod,
        usefulLifeMonths: targetClass.usefulLifeMonths,
        residualValuePercent: targetClass.residualValuePercent,
        locationId: assetLocationId,
        status: "Active",
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Under Construction")
      .executeTakeFirst();
    if (!capitalized.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is no longer Under Construction`
      );
    }

    await postTransfer(trx, {
      id: transfer.id,
      amount: total,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function adjustCost(
  db: Db,
  payload: Scoped<"adjustCost">
): Promise<AssetTransferResult> {
  const { companyId, userId, locationId } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  if (!ADJUSTABLE_ASSET_STATUSES.has(asset.status)) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Active or Fully Depreciated asset's cost can be adjusted`
    );
  }
  const [assetClass] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () =>
      assertCompanyRecords(db, "location", [locationId], companyId, "Location")
  ]);

  const amount = round(payload.amount);
  if (amount <= 0) {
    throw new InvalidInputError("The cost adjustment must be more than zero");
  }

  const accounting = await loadAccounting(db, companyId, payload.transferDate);
  const offsetAccount = await getOffsetAccount(
    db,
    companyId,
    payload.offsetAccountId
  );

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // Re-read under a row lock: a concurrent run, disposal or adjustment
    // changes the values the new status is derived from.
    const current = await trx
      .selectFrom("fixedAsset")
      .select([
        "status",
        "acquisitionCost",
        "accumulatedDepreciation",
        "residualValuePercent"
      ])
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (!ADJUSTABLE_ASSET_STATUSES.has(current.status)) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is ${current.status}; only an Active or Fully Depreciated asset's cost can be adjusted`
      );
    }
    const acquisitionCost = round(Number(current.acquisitionCost) + amount);

    const transferId = await getNextSequenceInTransaction(
      trx,
      "fixedAssetTransfer",
      companyId
    );
    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Cost Adjustment",
        sourceType: "Manual",
        fixedAssetId: asset.id,
        itemId: asset.itemId,
        trackedEntityId: asset.trackedEntityId,
        locationId,
        quantity: 1,
        transferDate: payload.transferDate,
        amount: 0,
        accumulatedDepreciation: Number(current.accumulatedDepreciation),
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalId = await postAssetJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: payload.transferDate,
      description: `Cost Adjustment ${asset.fixedAssetId}`,
      lines: buildCapitalizationLines({
        cost: amount,
        assetAccountId: assetClass.assetAccountId,
        creditAccountId: offsetAccount.id,
        creditDescription: "Capitalized Cost",
        creditAccountType: offsetAccount.type
      }),
      documentId: transfer.id,
      tags: {
        locationId,
        fixedAssetClassId: assetClass.id,
        itemId: asset.itemId
      }
    });

    // Depreciation already taken stays; the next run catches a Straight Line
    // asset up on the months it took at the old cost (buildDepreciationLines).
    const adjusted = await trx
      .updateTable("fixedAsset")
      .set({
        acquisitionCost,
        status: statusAfterCostAdjustment({
          status: current.status,
          acquisitionCost,
          accumulatedDepreciation: Number(current.accumulatedDepreciation),
          residualValuePercent: Number(current.residualValuePercent)
        }),
        locationId: asset.locationId ?? locationId,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...ADJUSTABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!adjusted.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} changed status while its cost was being adjusted`
      );
    }

    await postTransfer(trx, {
      id: transfer.id,
      amount,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

export const postAssetTransferPermission = {
  by: "type",
  rules: {
    capitalize: { create: "accounting" },
    return: { create: "accounting" },
    attachJob: { create: "accounting" },
    capitalizeCip: { create: "accounting" },
    adjustCost: { update: "accounting" }
  }
} satisfies PermissionRule<z.output<typeof postAssetTransferInput>>;

/**
 * Creates and posts one `fixedAssetTransfer` document between inventory and
 * the fixed asset register, per `type`. Every record id in the input is
 * re-read under companyId before anything is written.
 */
export async function postAssetTransfer(
  ctx: ServiceContext,
  raw: z.input<typeof postAssetTransferInput>
) {
  const input = postAssetTransferInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  switch (input.type) {
    case "capitalize":
      // An entered cost puts a number of the caller's own on the books.
      if (input.cost != null && !ctx.can({ update: "accounting" })) {
        throw new ForbiddenError();
      }
      return capitalize(db, { ...input, companyId, userId });
    case "return":
      return returnToInventory(db, { ...input, companyId, userId });
    case "attachJob":
      return attachJob(db, { ...input, companyId, userId });
    case "capitalizeCip":
      return capitalizeCip(db, { ...input, companyId, userId });
    case "adjustCost":
      return adjustCost(db, { ...input, companyId, userId });
  }
}
export const previewAssetCapitalizationInput = z.object({
  trackedEntityId: z.string().min(1)
});

export type CapitalizationPreview = { cost: number };

/** Thrown at the end of the preview transaction so it never commits. */
class RollbackPreview extends Error {
  constructor(readonly preview: CapitalizationPreview) {
    super("preview rollback");
  }
}

export const previewAssetCapitalizationPermission = {
  view: "accounting"
} satisfies PermissionRule<z.output<typeof previewAssetCapitalizationInput>>;

export async function previewAssetCapitalization(
  ctx: ServiceContext,
  raw: z.input<typeof previewAssetCapitalizationInput>
) {
  const { trackedEntityId } = previewAssetCapitalizationInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const entity = await db
    .selectFrom("trackedEntity")
    .select("itemId")
    .where("id", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!entity?.itemId) throw new NotFoundError("Tracked entity not found");
  const itemId = entity.itemId;

  try {
    await db.transaction().execute(async (trx) => {
      const cogs = await calculateCOGS(trx, {
        itemId,
        quantity: 1,
        companyId,
        trackedEntityIds: [trackedEntityId]
      });
      throw new RollbackPreview({ cost: round(cogs.totalCost) });
    });
  } catch (error) {
    if (error instanceof RollbackPreview) return error.preview;
    throw error;
  }
  throw new Error("Capitalization preview did not roll back");
}
const logger = getLogger("server-functions", "apply-account-import");

/** A trimmed, non-empty text value. */
const text = () => z.string().trim().min(1);

export const applyAccountImportInput = z.object({
  chart: z
    .array(
      z.object({
        line: z.number().int(),
        number: text(),
        name: text(),
        class: z
          .enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
          .nullable(),
        accountType: z
          .enum(ACCOUNT_TYPES as [AccountType, ...AccountType[]])
          .nullable(),
        group: text()
      })
    )
    .min(1)
    .max(10000),
  defaults: z
    .array(
      z.object({
        line: z.number().int(),
        key: text(),
        number: text().nullable()
      })
    )
    .min(1)
    .max(2000),
  resolutions: z.object({ targets: z.record(z.string(), z.number().int()) })
});

export type ApplyAccountImportResult = {
  counts: { updated: number; created: number; merged: number; deleted: number };
};

type ChartRow = z.infer<typeof applyAccountImportInput>["chart"][number];

const key = (value: string) => value.trim().toLowerCase();

/** Re-point every reference a merge moves, from each source to its target. */
async function repointReferences(
  trx: Trx,
  pairs: { source: string; target: string }[],
  companyIds: string[]
) {
  const m = sql`(VALUES ${sql.join(
    pairs.map((p) => sql`(${p.source}, ${p.target})`)
  )}) AS m(source, target)`;
  const inCompanies = sql`t."companyId" IN (${sql.join(companyIds)})`;
  for (const ref of REFERENCE_POLICY) {
    const t = sql.table(ref.table);
    const col = sql.id(ref.column);
    const matches = sql`t.${col} = m.source AND ${inCompanies}`;
    switch (ref.policy) {
      case "history":
        continue;
      case "repoint":
        await sql`UPDATE ${t} AS t SET ${col} = m.target FROM ${m}
          WHERE ${matches}`.execute(trx);
        continue;
      case "repoint-if-status":
        await sql`UPDATE ${t} AS t SET ${col} = m.target FROM ${m}
          WHERE ${matches}
            AND t."status"::text IN (${sql.join(ref.statuses.map((x) => sql.lit(x)))})`.execute(
          trx
        );
        continue;
      case "repoint-if-parent-status":
        await sql`UPDATE ${t} AS t SET ${col} = m.target
          FROM ${m}, ${sql.table(ref.parentTable)} AS p
          WHERE ${matches}
            AND p."id" = t.${sql.id(ref.parentColumn)} AND p."companyId" = t."companyId"
            AND p."status"::text IN (${sql.join(ref.statuses.map((x) => sql.lit(x)))})`.execute(
          trx
        );
        continue;
    }
  }

  // The references with no foreign key.
  await sql`UPDATE "intercompanyEliminationLine" AS t
    SET "accountId" = m.target
    FROM ${m}, "journalLine" AS jl, "journal" AS j
    WHERE t."accountId" = m.source AND ${inCompanies}
      AND jl."id" = t."journalLineId" AND j."id" = jl."journalId"
      AND j."status" IN ('Draft', 'Provisional')`.execute(trx);
  await sql`UPDATE "companyIntegration" AS t
    SET "metadata" = jsonb_set(t."metadata"::jsonb, '{paymentFeeAccount}', to_jsonb(m.target::text))::json
    FROM ${m}
    WHERE t."metadata"->>'paymentFeeAccount' = m.source AND ${inCompanies}`.execute(
    trx
  );
}

export const applyAccountImportPermission = {
  update: "accounting"
} satisfies PermissionRule<z.output<typeof applyAccountImportInput>>;

export async function applyAccountImport(
  ctx: ServiceContext,
  raw: z.input<typeof applyAccountImportInput>
) {
  const { chart, defaults, resolutions } = applyAccountImportInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  return db.transaction().execute(async (trx) => {
    const company = await trx
      .selectFrom("company")
      .select("companyGroupId")
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company?.companyGroupId) {
      throw new NotFoundError("Company not found");
    }
    const groupId = company.companyGroupId;

    // Nothing may activate accounting, or change the chart, while the plan
    // is applied. Settings first, in the order activation takes them.
    await sql`SELECT cs."id" FROM "companySettings" cs
        JOIN "company" c ON c."id" = cs."id"
        WHERE c."companyGroupId" = ${groupId} FOR SHARE OF cs`.execute(trx);
    await sql`SELECT "id" FROM "account" WHERE "companyGroupId" = ${groupId} FOR UPDATE`.execute(
      trx
    );
    // Lets the charge and reimbursement guards accept the account change
    // of a posted row, for this transaction only (20261013035046).
    await sql`SELECT set_config('app.account_import', 'true', true)`.execute(
      trx
    );

    const ctx = await loadAccountImportContext(trx, groupId, companyId);
    const plan = planAccountImport(chart, defaults, ctx, resolutions);
    if (!isApplicable(plan)) {
      const open = plan.replacements.filter((r) => r.targetLine === null);
      throw new InvalidInputError(
        plan.errors.some((e) => e.code === "accounting-activated")
          ? "Accounting is already set up, so the chart of accounts cannot be imported."
          : `The import has ${plan.errors.length} error(s) and ${open.length} account(s) that need a replacement.`,
        { errors: plan.errors.map((e) => e.code) }
      );
    }

    const companyIds = ctx.companies.map((c) => c.id);
    const now = datetime.timestamp();
    const removed = [...plan.deletes, ...plan.merges.map((m) => m.sourceId)];

    // Groups. A group's name is unique among groups only, so a new group
    // never meets a leaf's name.
    const groupIdByName = new Map(
      ctx.chart.filter((a) => a.isGroup).map((g) => [key(g.name), g.id])
    );
    const rootByBalance = new Map(
      ctx.chart
        .filter((a) => a.isGroup && a.isSystem && a.parentId === null)
        .map((r) => [r.incomeBalance, r.id])
    );
    if (plan.groupCreates.length > 0) {
      const created = await trx
        .insertInto("account")
        .values(
          plan.groupCreates.map((g) => {
            const incomeBalance = incomeBalanceOf(g.class);
            const parentId = rootByBalance.get(incomeBalance);
            if (!parentId) throw new Error(`No ${incomeBalance} root account`);
            return {
              name: g.name,
              number: null,
              isGroup: true,
              class: g.class,
              incomeBalance,
              parentId,
              companyGroupId: groupId,
              createdBy: userId
            };
          })
        )
        .returning(["id", "name"])
        .execute();
      for (const g of created) groupIdByName.set(key(g.name), g.id);
    }
    const groupIdOf = (name: string) => {
      const id = groupIdByName.get(key(name));
      if (!id) throw new Error(`Unknown group "${name}"`);
      return id;
    };

    // Free every leaf number and name that changes or goes: two accounts
    // may swap, and a created account may reuse a removed one's.
    const freed = [...plan.updates.map((u) => u.accountId), ...removed];
    if (freed.length > 0) {
      await trx
        .updateTable("account")
        .set({
          number: sql`'__import_' || "id"`,
          name: sql`'__import_' || "id"`
        })
        .where("id", "in", freed)
        .where("companyGroupId", "=", groupId)
        .execute();
    }

    // Updates: the account keeps its id, so everything that points at it
    // follows.
    if (plan.updates.length > 0) {
      const values = sql.join(
        plan.updates.map(
          (u) =>
            sql`(${u.accountId}, ${u.number}, ${u.name}, ${u.accountType}, ${u.class}, ${incomeBalanceOf(u.class)}, ${groupIdOf(u.group)})`
        )
      );
      await sql`UPDATE "account" AS a SET
            "number" = v.number,
            "name" = v.name,
            "accountType" = v."accountType"::"accountType",
            "class" = v.class::"glAccountClass",
            "incomeBalance" = v."incomeBalance"::"glIncomeBalance",
            "parentId" = v."parentId",
            "active" = true,
            "updatedBy" = ${userId},
            "updatedAt" = ${now}
          FROM (VALUES ${values}) AS v(id, number, name, "accountType", class, "incomeBalance", "parentId")
          WHERE a."id" = v.id AND a."companyGroupId" = ${groupId}`.execute(trx);
    }

    // Creates.
    const accountIdByLine = new Map(
      plan.claims.map((c) => [c.line, c.accountId])
    );
    if (plan.creates.length > 0) {
      const created = await trx
        .insertInto("account")
        .values(
          plan.creates.map((c) => ({
            number: c.number,
            name: c.name,
            class: c.class,
            accountType: c.accountType,
            incomeBalance: incomeBalanceOf(c.class),
            parentId: groupIdOf(c.group),
            isGroup: false,
            companyGroupId: groupId,
            createdBy: userId
          }))
        )
        .returning(["id", "number"])
        .execute();
      const lineByNumber = new Map(plan.creates.map((c) => [c.number, c.line]));
      for (const c of created) {
        const line = c.number === null ? undefined : lineByNumber.get(c.number);
        if (line !== undefined) accountIdByLine.set(line, c.id);
      }
    }
    const accountOfLine = (line: number) => {
      const id = accountIdByLine.get(line);
      if (!id) throw new Error(`Row ${line} has no account`);
      return id;
    };

    await setDefaults(trx, plan, accountOfLine, companyIds, userId);
    await setAssetClasses(trx, plan, accountOfLine, userId, now);

    // Merges: the source's documents and unposted journal lines follow it
    // to its target.
    if (plan.merges.length > 0) {
      await repointReferences(
        trx,
        plan.merges.map((m) => ({
          source: m.sourceId,
          target: accountOfLine(m.targetLine)
        })),
        companyIds
      );
    }

    // Removed accounts: their integration mappings go with them. Journal
    // and document lines refuse the delete (ON DELETE RESTRICT) if anything
    // still points at one.
    if (removed.length > 0) {
      await trx
        .deleteFrom("externalIntegrationMapping")
        .where("entityType", "=", "account")
        .where("entityId", "in", removed)
        .where("companyId", "in", companyIds)
        .execute();
      await trx
        .deleteFrom("account")
        .where("id", "in", removed)
        .where("companyGroupId", "=", groupId)
        .execute();
    }

    // Groups left with no children, deepest first.
    for (;;) {
      const emptied = await sql`DELETE FROM "account" AS g
          WHERE g."companyGroupId" = ${groupId} AND g."isGroup" AND NOT g."isSystem"
            AND NOT EXISTS (SELECT 1 FROM "account" AS c WHERE c."parentId" = g."id")
          RETURNING g."id"`.execute(trx);
      if (emptied.rows.length === 0) break;
    }

    await assertPostcondition(trx, groupId, companyIds, chart);

    return {
      counts: {
        updated: plan.updates.length,
        created: plan.creates.length,
        merged: plan.merges.length,
        deleted: plan.deletes.length
      }
    };
  });
}

/** Every company's defaults, in one statement: the file names the same
 *  account for a role in every company. */
async function setDefaults(
  trx: Trx,
  plan: AccountImportPlan,
  accountOfLine: (line: number) => string,
  companyIds: string[],
  userId: string
) {
  const set = Object.fromEntries(
    plan.roleMoves.map((m) => [
      m.role,
      m.toLine === null ? null : accountOfLine(m.toLine)
    ])
  );
  await trx
    .updateTable("accountDefault")
    .set({ ...set, updatedBy: userId })
    .where("companyId", "in", companyIds)
    .execute();
}

/** Every fixed asset class's accounts, in one statement. */
async function setAssetClasses(
  trx: Trx,
  plan: AccountImportPlan,
  accountOfLine: (line: number) => string,
  userId: string,
  now: string
) {
  if (plan.assetClassMoves.length === 0) return;
  const columns = sql.join(FIXED_ASSET_CLASS_COLUMNS.map((c) => sql.id(c)));
  const values = sql.join(
    plan.assetClassMoves.map(
      (m) =>
        sql`(${m.classId}, ${m.companyId}, ${sql.join(
          FIXED_ASSET_CLASS_COLUMNS.map((c) => accountOfLine(m.toLines[c]))
        )})`
    )
  );
  const assignments = sql.join(
    FIXED_ASSET_CLASS_COLUMNS.map((c) => sql`${sql.id(c)} = v.${sql.id(c)}`)
  );
  await sql`UPDATE "fixedAssetClass" AS t SET ${assignments},
      "updatedBy" = ${userId}, "updatedAt" = ${now}
    FROM (VALUES ${values}) AS v(id, "companyId", ${columns})
    WHERE t."id" = v.id AND t."companyId" = v."companyId"`.execute(trx);
}

/**
 * The chart now equals the file, and every company can still post. A failure
 * means the apply and the plan disagree: a server bug, so a plain Error (500),
 * and the transaction rolls back.
 */
async function assertPostcondition(
  trx: Trx,
  groupId: string,
  companyIds: string[],
  chart: ChartRow[]
) {
  const accounts = await trx
    .selectFrom("account")
    .select([
      "id",
      "number",
      "name",
      "class",
      "accountType",
      "parentId",
      "isGroup",
      "isSystem"
    ])
    .where("companyGroupId", "=", groupId)
    .execute();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const leaves = accounts.filter((a) => !a.isGroup && !a.isSystem);
  const describe = (r: {
    number: string | null;
    name: string;
    class: string | null;
    accountType: string | null;
    group: string;
  }) =>
    [
      r.number ?? "",
      r.name,
      r.class ?? "",
      r.accountType ?? "",
      key(r.group)
    ].join("|");
  const actual = new Set(
    leaves.map((a) =>
      describe({ ...a, group: byId.get(a.parentId ?? "")?.name ?? "" })
    )
  );
  const failures: string[] = [];
  // A row with no class or type takes them from the plan; compare by number,
  // name and group for those.
  const expected = chart.map((r) =>
    r.class && r.accountType ? describe(r) : null
  );
  const loose = new Set(
    leaves.map((a) =>
      [
        a.number ?? "",
        a.name,
        key(byId.get(a.parentId ?? "")?.name ?? "")
      ].join("|")
    )
  );
  chart.forEach((r, i) => {
    const exact = expected[i];
    const found = exact
      ? actual.has(exact)
      : loose.has([r.number, r.name, key(r.group)].join("|"));
    if (!found)
      failures.push(`line ${r.line} was not written as the file says`);
  });
  if (leaves.length !== chart.length) {
    failures.push(`${leaves.length} accounts for ${chart.length} rows`);
  }
  if (
    accounts.some(
      (g) =>
        g.isGroup && !g.isSystem && !accounts.some((c) => c.parentId === g.id)
    )
  ) {
    failures.push("an empty group is left");
  }

  const leafIds = new Set(leaves.map((a) => a.id));
  const defaults = await trx
    .selectFrom("accountDefault")
    .select(["companyId", ...requiredRoles(), "migrationClearingAccount"])
    .where("companyId", "in", companyIds)
    .execute();
  for (const row of defaults) {
    for (const role of requiredRoles()) {
      if (!leafIds.has(row[role] ?? "")) {
        failures.push(`${row.companyId}: the default "${role}" has no account`);
      }
    }
    const clearing = byId.get(row.migrationClearingAccount ?? "");
    if (clearing && clearing.class !== MIGRATION_CLEARING_ACCOUNT_CLASS) {
      failures.push(`${row.companyId}: Migration Clearing is not Equity`);
    }
  }
  const classes = await trx
    .selectFrom("fixedAssetClass")
    .select(["name", ...FIXED_ASSET_CLASS_COLUMNS])
    .where("companyId", "in", companyIds)
    .execute();
  for (const fac of classes) {
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      if (!leafIds.has(fac[column])) {
        failures.push(`fixed asset class "${fac.name}" has no ${column}`);
      }
    }
  }

  if (failures.length > 0) {
    logger.error("The chart of accounts import broke its postcondition", {
      groupId,
      failures
    });
    throw new Error("The chart of accounts import could not be applied.");
  }
}
export type ChargeType =
  | "Charge"
  | "Credit"
  | "Payment"
  | "Cashback"
  | "Repayment";

export interface ChargeLineInput {
  accountId: string;
  amount: number;
  costCenterId?: string | null;
  projectId?: string | null;
  description?: string | null;
}

export interface BuildChargeJournalInput {
  transaction: {
    type: ChargeType;
    amount: number;
    cardAccountId: string;
    offsetAccountId: string | null;
    currencyCode: string;
    exchangeRate: number;
  };
  lines: ChargeLineInput[];
  // Resolved account classes, keyed by accountId. Only the accounts this
  // transaction touches need be present.
  accounts: Record<string, { class: AccountClass }>;
  // Internal charge record id — becomes `documentId` on every line.
  documentId: string;
  // Human-readable id (chargeId) — used only in error messages.
  documentReadableId: string;
}

// A journal line this builder emits. Deliberately self-contained — a pure unit
// shouldn't depend on the generated DB types. The driver adds `journalId`,
// `journalLineReference`, `companyId` and `quantity` before the Kysely insert,
// and consumes `costCenterId` to write the CostCenter journalLineDimension.
export interface ChargeJournalLine {
  accountId: string;
  amount: number;
  description: string;
  documentType: "Charge";
  documentId: string;
  costCenterId?: string | null;
  projectId?: string | null;
}

export interface BuildChargeJournalResult {
  journalLines: ChargeJournalLine[];
}

// Maximum residual (base ccy) tolerated before refusing to post. Above this a
// logic/rounding bug has produced an unbalanced entry. Matches post-payment's
// business threshold (multi-currency journals carry sub-cent cross-rate
// residuals), NOT the float-noise EPSILON.
const BALANCE_TOLERANCE = 0.01;

export function buildChargeJournal(
  input: BuildChargeJournalInput
): BuildChargeJournalResult {
  const { transaction, lines, accounts, documentId, documentReadableId } =
    input;
  const { type, amount, cardAccountId, offsetAccountId, exchangeRate } =
    transaction;

  // Journal lines hit the GL in base currency. `exchangeRate` is the canonical
  // foreign-per-base rate (units of the document currency per 1 unit of base,
  // via get_exchange_rate; base currency → 1), so a document amount converts to
  // base by DIVIDING — the shared `toBaseAmount`, which rounds once per call at
  // internal SCALE. Both sides convert the same way so the entry stays balanced;
  // the offset/card side accumulates the rounded per-line magnitudes so rounding
  // dust can never unbalance a split. The column is NOT NULL default 1 (> 0), so
  // this guard passes for the rate=1 base-currency fallback and only refuses a
  // corrupt (0 / negative / non-finite) rate before it can post.
  assertExchangeRate(exchangeRate);
  const toBase = (value: number) => toBaseAmount(value, exchangeRate);

  const classOf = (accountId: string): LedgerAccountType => {
    const account = accounts[accountId];
    if (!account) {
      throw new Error(
        `Charge ${documentReadableId}: missing account class for ${accountId}`
      );
    }
    return account.class.toLowerCase() as LedgerAccountType;
  };

  const journalLines: ChargeJournalLine[] = [];
  // True debit(+)/credit(−) space. A balanced double entry sums to ~0 here.
  let signedDebitTotal = 0;

  const pushLine = (
    side: "debit" | "credit",
    accountType: LedgerAccountType,
    magnitude: number,
    fields: {
      accountId: string;
      description: string;
      costCenterId?: string | null;
      projectId?: string | null;
    }
  ) => {
    signedDebitTotal += side === "debit" ? magnitude : -magnitude;
    journalLines.push({
      accountId: fields.accountId,
      amount:
        side === "debit"
          ? debit(accountType, magnitude)
          : credit(accountType, magnitude),
      description: fields.description,
      documentType: "Charge",
      documentId,
      costCenterId: fields.costCenterId ?? null,
      projectId: fields.projectId ?? null
    });
  };

  // Line-bearing types must have lines that sum to the header amount, or the
  // subledger and the GL disagree. Throw a typed error naming the mismatch.
  const requireLineSum = () => {
    if (lines.length === 0) {
      throw new Error(
        `Charge ${documentReadableId}: ${type} requires at least one line`
      );
    }
    if (
      lines.some((line) => !Number.isFinite(line.amount) || line.amount <= 0)
    ) {
      throw new Error(
        `Charge ${documentReadableId}: coding line amounts must be finite and greater than zero`
      );
    }
    const lineSum = lines.reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(lineSum - amount) > EPSILON) {
      throw new Error(
        `Charge ${documentReadableId}: line sum ${lineSum} does not equal header amount ${amount}`
      );
    }
  };

  // Header-only transaction types derive their complete journal from the
  // card and offset accounts. Refuse unexpected persisted detail instead of
  // silently dropping it from the GL.
  const requireNoLines = () => {
    if (lines.length > 0) {
      throw new Error(
        `Charge ${documentReadableId}: ${type} cannot have coding lines`
      );
    }
  };

  const requireOffset = (): string => {
    if (!offsetAccountId) {
      throw new Error(
        `Charge ${documentReadableId}: ${type} requires an offset account`
      );
    }
    return offsetAccountId;
  };

  switch (type) {
    // Purchase on the card: expense/asset lines debited, card liability
    // credited for the total.
    case "Charge": {
      requireLineSum();
      let cardMagnitude = 0;
      for (const line of lines) {
        const magnitude = toBase(line.amount);
        cardMagnitude += magnitude;
        pushLine("debit", classOf(line.accountId), magnitude, {
          accountId: line.accountId,
          description: line.description ?? "Card charge",
          costCenterId: line.costCenterId,
          projectId: line.projectId
        });
      }
      pushLine("credit", "liability", cardMagnitude, {
        accountId: cardAccountId,
        description: "Card liability"
      });
      break;
    }

    // Refund/return to the card — mirror image of a Charge.
    case "Credit": {
      requireLineSum();
      let cardMagnitude = 0;
      for (const line of lines) {
        const magnitude = toBase(line.amount);
        cardMagnitude += magnitude;
        pushLine("credit", classOf(line.accountId), magnitude, {
          accountId: line.accountId,
          description: line.description ?? "Card credit",
          costCenterId: line.costCenterId,
          projectId: line.projectId
        });
      }
      pushLine("debit", "liability", cardMagnitude, {
        accountId: cardAccountId,
        description: "Card liability"
      });
      break;
    }

    // Statement payment: pay down the card liability from a bank asset.
    case "Payment": {
      requireNoLines();
      const offset = requireOffset();
      const magnitude = toBase(amount);
      pushLine("debit", "liability", magnitude, {
        accountId: cardAccountId,
        description: "Card liability"
      });
      pushLine("credit", classOf(offset), magnitude, {
        accountId: offset,
        description: "Card payment"
      });
      break;
    }

    // Cashback/rewards: reduce the card liability, book the offset as income.
    case "Cashback": {
      requireNoLines();
      const offset = requireOffset();
      const magnitude = toBase(amount);
      pushLine("debit", "liability", magnitude, {
        accountId: cardAccountId,
        description: "Card liability"
      });
      pushLine("credit", "revenue", magnitude, {
        accountId: offset,
        description: "Card cashback"
      });
      break;
    }

    // Repayment: the offset (bank asset or card liability, per funding) is
    // debited for the total; each line account is credited.
    case "Repayment": {
      requireLineSum();
      const offset = requireOffset();
      const lineMagnitudes = lines.map((l) => toBase(l.amount));
      const offsetMagnitude = lineMagnitudes.reduce((sum, m) => sum + m, 0);
      pushLine("debit", classOf(offset), offsetMagnitude, {
        accountId: offset,
        description: "Card repayment"
      });
      lines.forEach((line, index) => {
        pushLine("credit", classOf(line.accountId), lineMagnitudes[index]!, {
          accountId: line.accountId,
          description: line.description ?? "Card repayment",
          costCenterId: line.costCenterId,
          projectId: line.projectId
        });
      });
      break;
    }

    default: {
      // Exhaustiveness guard — a new chargeType must add a branch here.
      throw new Error(
        `Charge ${documentReadableId}: unsupported type ${type as string}`
      );
    }
  }

  // Defensive backstop: assert the entry balances in true debit/credit space.
  // By construction every branch pushes matched debit/credit legs (`pushLine`
  // adds +m for a debit, −m for a credit), and the card/offset side accumulates
  // the SAME rounded per-line magnitudes as the coding lines — so this holds by
  // construction today and cannot fire. The real integrity guard is
  // `requireLineSum` (the subledger must equal the header). This assert exists so
  // a future edit that breaks the matched-legs invariant fails loudly here rather
  // than writing an unbalanced journal to the GL.
  assertBalanced(signedDebitTotal, 0, BALANCE_TOLERANCE, "Charge journal");

  return { journalLines };
}
export type ChargeContext = {
  trx: KyselyTransaction<KyselyDatabase>;
  charge: Pick<
    Selectable<KyselyDatabase["charge"]>,
    | "id"
    | "chargeId"
    | "type"
    | "status"
    | "amount"
    | "cardAccountId"
    | "offsetAccountId"
    | "currencyCode"
    | "exchangeRate"
    | "transactionDate"
    | "postingDate"
    | "journalId"
  >;
  company: Pick<
    Selectable<KyselyDatabase["company"]>,
    "companyGroupId" | "baseCurrencyCode" | "timezone"
  >;
  postingStatus: AutomaticJournalStatus;
  companyId: string;
  userId: string;
  timestamp: string;
  today: string;
};

export async function postChargeJournal(
  context: ChargeContext
): Promise<{ journalId: string }> {
  const { trx, charge, company, postingStatus, companyId, userId, timestamp } =
    context;
  // The parent lock serializes line writes. Locking line tuples too would
  // deadlock with an UPDATE whose BEFORE trigger is waiting for that parent.
  const lines = await trx
    .selectFrom("chargeLine")
    .selectAll()
    .where("chargeId", "=", charge.id)
    .where("companyId", "=", companyId)
    .orderBy("sequence")
    .orderBy("id")
    .execute();
  const accountIds = [
    ...new Set([
      charge.cardAccountId,
      ...(charge.offsetAccountId ? [charge.offsetAccountId] : []),
      ...lines.map((line) => line.accountId)
    ])
  ];
  const postingAccounts = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", accountIds)
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("isGroup", "=", false)
    .execute();
  if (
    postingAccounts.length !== accountIds.length ||
    postingAccounts.some((account) => !isAccountClass(account.class))
  ) {
    throw new Error(
      "Charge accounts must be active posting accounts in this company group"
    );
  }
  const accounts: Record<string, { class: AccountClass }> = {};
  for (const account of postingAccounts) {
    if (!isAccountClass(account.class)) {
      throw new Error("Charge account class is missing");
    }
    accounts[account.id] = { class: account.class };
  }
  if (accounts[charge.cardAccountId]?.class !== "Liability") {
    throw new Error("Charge card account must be a Liability account");
  }
  if (
    charge.type === "Payment" &&
    charge.offsetAccountId &&
    accounts[charge.offsetAccountId]?.class !== "Asset"
  ) {
    throw new Error("Card payment offset account must be an Asset account");
  }
  if (
    charge.type === "Cashback" &&
    charge.offsetAccountId &&
    accounts[charge.offsetAccountId]?.class !== "Revenue"
  ) {
    throw new Error("Card cashback offset account must be a Revenue account");
  }

  const costCenterIds = [
    ...new Set(
      lines.flatMap((line) => (line.costCenterId ? [line.costCenterId] : []))
    )
  ];
  if (costCenterIds.length) {
    const costCenters = await trx
      .selectFrom("costCenter")
      .select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", costCenterIds)
      .execute();
    if (costCenters.length !== costCenterIds.length) {
      throw new NotFoundError("Charge cost center not found in this company");
    }
  }

  const projectIds = [
    ...new Set(
      lines.flatMap((line) => (line.projectId ? [line.projectId] : []))
    )
  ];
  if (projectIds.length) {
    const projects = await trx
      .selectFrom("project")
      .select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", projectIds)
      .execute();
    if (projects.length !== projectIds.length) {
      throw new NotFoundError("Charge project not found in this company");
    }
  }

  let postingDate = charge.postingDate ?? charge.transactionDate;
  // A Provisional journal has no accounting period, and no posting creates a
  // period before the cutover.
  let accountingPeriodId: string | null = null;
  if (postingStatus === "Posted") {
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      postingDate,
      "historical-with-shift"
    );
    postingDate = period.postingDate;
    accountingPeriodId = period.id;
  }
  const built = buildChargeJournal({
    transaction: {
      type: charge.type,
      amount: Number(charge.amount),
      cardAccountId: charge.cardAccountId,
      offsetAccountId: charge.offsetAccountId,
      currencyCode: charge.currencyCode,
      exchangeRate: Number(charge.exchangeRate)
    },
    lines: lines.map((line) => ({
      accountId: line.accountId,
      amount: Number(line.amount),
      costCenterId: line.costCenterId,
      projectId: line.projectId,
      description: line.description
    })),
    accounts,
    documentId: charge.id,
    documentReadableId: charge.chargeId
  });
  const { costCenter: costCenterDimensionId, project: projectDimensionId } =
    costCenterIds.length || projectIds.length
      ? await costCenterAndProjectDimensions(trx, company.companyGroupId)
      : { costCenter: null, project: null };
  if (costCenterIds.length && !costCenterDimensionId) {
    throw new Error("Company group has no active Cost Center dimension");
  }
  if (projectIds.length && !projectDimensionId) {
    throw new Error("Company group has no active Project dimension");
  }

  const journal = await trx
    .insertInto("journal")
    .values({
      journalEntryId: await getNextSequenceInTransaction(
        trx,
        "journalEntry",
        companyId
      ),
      accountingPeriodId,
      description: `Charge ${charge.chargeId}`,
      postingDate,
      companyId,
      sourceType: "Charge",
      status: postingStatus,
      postedAt: timestamp,
      postedBy: userId,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const journalId = journal.id;
  const journalLineReference = nanoid();
  const journalLineIds = await allocateJournalLineIds(
    trx,
    built.journalLines.length
  );
  await trx
    .insertInto("journalLine")
    .values(
      built.journalLines.map((line, index) => ({
        id: journalLineIds[index],
        journalId,
        accountId: line.accountId,
        amount: line.amount,
        quantity: 1,
        description: line.description,
        documentType: "Charge" as const,
        documentId: line.documentId,
        journalLineReference,
        companyId
      }))
    )
    .execute();
  if (costCenterDimensionId) {
    const dimensionValues = built.journalLines.flatMap((line, index) => {
      const journalLineId = journalLineIds[index];
      if (!line.costCenterId) return [];
      if (!journalLineId) throw new Error("Failed to map card journal line");
      return [
        {
          journalLineId,
          dimensionId: costCenterDimensionId,
          valueId: line.costCenterId,
          companyId
        }
      ];
    });
    if (dimensionValues.length) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionValues)
        .execute();
    }
  }
  if (projectDimensionId) {
    const projectDimensionValues = built.journalLines.flatMap((line, index) => {
      const journalLineId = journalLineIds[index];
      if (!line.projectId) return [];
      if (!journalLineId) throw new Error("Failed to map card journal line");
      return [
        {
          journalLineId,
          dimensionId: projectDimensionId,
          valueId: line.projectId,
          companyId
        }
      ];
    });
    if (projectDimensionValues.length) {
      await trx
        .insertInto("journalLineDimension")
        .values(projectDimensionValues)
        .execute();
    }
  }

  await trx
    .updateTable("charge")
    .set({
      status: "Posted",
      journalId,
      postingDate,
      postedAt: timestamp,
      postedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId
    })
    .where("id", "=", charge.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId };
}
export type PostChargeArgs = {
  type: "post" | "void";
  chargeId: string;
  companyId: string;
  userId: string;
};

export function postChargeTransaction(
  db: Kysely<KyselyDatabase>,
  args: PostChargeArgs
): Promise<{ journalId: string | null }> {
  const { type, chargeId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    // This is deliberately the first database read. The line mutation trigger
    // takes the same parent lock, so every snapshot below is stable.
    const charge = await trx
      .selectFrom("charge")
      .select([
        "id",
        "chargeId",
        "type",
        "status",
        "amount",
        "cardAccountId",
        "offsetAccountId",
        "currencyCode",
        "exchangeRate",
        "journalId",
        sql<string>`"transactionDate"::text`.as("transactionDate"),
        sql<string | null>`"postingDate"::text`.as("postingDate")
      ])
      .where("id", "=", chargeId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!charge) throw new NotFoundError("Charge not found");

    if (type === "post" && charge.status === "Posted") {
      return { journalId: charge.journalId };
    }
    if (type === "void" && charge.status === "Voided") {
      return { journalId: charge.journalId };
    }
    const expectedStatus = type === "post" ? "Draft" : "Posted";
    if (charge.status !== expectedStatus) {
      throw new Error(`Cannot ${type} charge in status ${charge.status}`);
    }

    // Every posting writes a journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the status until
    // commit.
    const postingStatus = await journalPostingStatus(trx, companyId);

    const company = await trx
      .selectFrom("company")
      .select(["companyGroupId", "baseCurrencyCode", "timezone"])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company?.companyGroupId) {
      throw new Error("Charge company configuration not found");
    }

    const timestamp = datetime.timestamp();
    const today = datetime.today(company.timezone).toString();
    const context = {
      trx,
      charge,
      company,
      postingStatus,
      companyId,
      userId,
      timestamp,
      today
    };

    return type === "post"
      ? await postChargeJournal(context)
      : await voidCharge(context);
  });
}
export async function voidCharge(
  context: ChargeContext
): Promise<{ journalId: string | null }> {
  const { trx, charge, postingStatus, companyId, userId, timestamp, today } =
    context;

  // The enable superseded the journal of a charge dated before the cutover
  // and opened its balances in the opening journal, so a reversal of its own
  // lines would undo nothing. The date is the one the posting used.
  await refuseVoidBeforeCutover(
    trx,
    companyId,
    charge.postingDate ?? charge.transactionDate,
    CHARGE_VOID_BEFORE_CUTOVER_ERROR
  );

  if (charge.journalId) {
    const originalJournal = await trx
      .selectFrom("journal")
      .select(["id", "status", "sourceType"])
      .where("id", "=", charge.journalId)
      .where("companyId", "=", companyId)
      .forShare()
      .executeTakeFirst();
    if (
      !originalJournal ||
      !(OPEN_ITEM_JOURNAL_STATUSES as readonly string[]).includes(
        originalJournal.status
      ) ||
      originalJournal.sourceType !== "Charge"
    ) {
      throw new Error("Original charge journal has invalid provenance");
    }
    const originalLines = await trx
      .selectFrom("journalLine")
      .selectAll()
      // The journal's status was checked above, under FOR SHARE.
      .where("journalId", "=", originalJournal.id)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .execute();
    if (
      !originalLines.length ||
      originalLines.some(
        (line) =>
          line.documentType !== "Charge" || line.documentId !== charge.id
      )
    ) {
      throw new Error("Original charge journal has invalid lines");
    }
    await insertNegatedJournal(trx, {
      companyId,
      userId,
      originalLines,
      description: `VOID Charge ${charge.chargeId}`,
      sourceType: "Charge",
      postingStatus,
      date: today,
      periodMode: "current",
      postedAt: timestamp
    });
  }

  await trx
    .updateTable("charge")
    .set({
      status: "Voided",
      voidedAt: timestamp,
      voidedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId
    })
    .where("id", "=", charge.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId: charge.journalId };
}
export const postChargeInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  chargeId: z.string()
});

export const postChargePermission = {
  update: "invoicing"
} satisfies PermissionRule<z.output<typeof postChargeInput>>;

/**
 * Posts or voids a charge and its journal, atomically. The transaction re-reads
 * the record under companyId, so a foreign id fails as "not found".
 */
export async function postCharge(
  ctx: ServiceContext,
  raw: z.input<typeof postChargeInput>
) {
  const { type, chargeId } = postChargeInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const result = await postChargeTransaction(db, {
    type,
    chargeId,
    companyId,
    userId
  });
  return { success: true, ...result };
}
export interface ReimbursementLineInput {
  accountId: string;
  amount: number;
  costCenterId?: string | null;
  projectId?: string | null;
  description?: string | null;
}

export interface BuildReimbursementJournalInput {
  reimbursement: {
    amount: number;
    payableAccountId: string;
    currencyCode: string;
    exchangeRate: number;
  };
  // Resolved account classes, keyed by accountId. Only the accounts this
  // reimbursement touches need be present.
  accounts: Record<string, { class: AccountClass }>;
  lines: ReimbursementLineInput[];
  // Internal reimbursement record id — becomes `documentId` on every line.
  documentId: string;
  // Human-readable id (reimbursementId) — used only in error messages.
  documentReadableId: string;
}

// A journal line this builder emits. Deliberately self-contained — a pure unit
// shouldn't depend on the generated DB types. The driver adds `journalId`,
// `journalLineReference`, `companyId` and `quantity` before the Kysely insert,
// and consumes `costCenterId`/`projectId` to write the journalLineDimension
// rows.
export interface ReimbursementJournalLine {
  accountId: string;
  amount: number;
  description: string;
  documentType: "Reimbursement";
  documentId: string;
  costCenterId?: string | null;
  projectId?: string | null;
}

export interface BuildReimbursementJournalResult {
  journalLines: ReimbursementJournalLine[];
}

// Maximum residual (base ccy) tolerated before refusing to post. Above this a
// logic/rounding bug has produced an unbalanced entry. Matches post-payment's
// business threshold (multi-currency journals carry sub-cent cross-rate
// residuals), NOT the float-noise EPSILON.

export function buildReimbursementJournal(
  input: BuildReimbursementJournalInput
): BuildReimbursementJournalResult {
  const { reimbursement, lines, accounts, documentId, documentReadableId } =
    input;
  const { amount, payableAccountId, exchangeRate } = reimbursement;

  // Journal lines hit the GL in base currency. `exchangeRate` is the canonical
  // foreign-per-base rate (units of the document currency per 1 unit of base,
  // via get_exchange_rate; base currency → 1), so a document amount converts to
  // base by DIVIDING — the shared `toBaseAmount`, which rounds once per call at
  // internal SCALE. The payable side accumulates the SAME rounded per-line
  // magnitudes as the coding lines, so rounding dust can never unbalance a
  // split. The column is NOT NULL default 1 (> 0), so this guard passes for the
  // rate=1 base-currency fallback and only refuses a corrupt (0 / negative /
  // non-finite) rate before it can post.
  assertExchangeRate(exchangeRate);
  const toBase = (value: number) => toBaseAmount(value, exchangeRate);

  const classOf = (accountId: string): LedgerAccountType => {
    const account = accounts[accountId];
    if (!account) {
      throw new Error(
        `Reimbursement ${documentReadableId}: missing account class for ${accountId}`
      );
    }
    return account.class.toLowerCase() as LedgerAccountType;
  };

  const journalLines: ReimbursementJournalLine[] = [];
  // True debit(+)/credit(−) space. A balanced double entry sums to ~0 here.
  let signedDebitTotal = 0;

  const pushLine = (
    side: "debit" | "credit",
    accountType: LedgerAccountType,
    magnitude: number,
    fields: {
      accountId: string;
      description: string;
      costCenterId?: string | null;
      projectId?: string | null;
    }
  ) => {
    signedDebitTotal += side === "debit" ? magnitude : -magnitude;
    journalLines.push({
      accountId: fields.accountId,
      amount:
        side === "debit"
          ? debit(accountType, magnitude)
          : credit(accountType, magnitude),
      description: fields.description,
      documentType: "Reimbursement",
      documentId,
      costCenterId: fields.costCenterId ?? null,
      projectId: fields.projectId ?? null
    });
  };

  // The coding lines must sum to the header amount, or the subledger and the GL
  // disagree. This is the invariant the detail page's totals guard mirrors
  // before it will enable Post — the message text below is what a developer
  // sees if that guard is ever bypassed.
  const requireLineSum = () => {
    if (lines.length === 0) {
      throw new Error(
        `Reimbursement ${documentReadableId}: requires at least one line`
      );
    }
    if (
      lines.some((line) => !Number.isFinite(line.amount) || line.amount <= 0)
    ) {
      throw new Error(
        `Reimbursement ${documentReadableId}: coding line amounts must be finite and greater than zero`
      );
    }
    const lineSum = lines.reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(lineSum - amount) > EPSILON) {
      throw new Error(
        `Reimbursement ${documentReadableId}: line sum ${lineSum} does not equal header amount ${amount}`
      );
    }
  };

  requireLineSum();

  // Each coding line is debited; the employee payable is credited for the sum
  // of the SAME rounded magnitudes.
  let payableMagnitude = 0;
  for (const line of lines) {
    const magnitude = toBase(line.amount);
    payableMagnitude += magnitude;
    pushLine("debit", classOf(line.accountId), magnitude, {
      accountId: line.accountId,
      description: line.description ?? "Employee reimbursement",
      costCenterId: line.costCenterId,
      projectId: line.projectId
    });
  }
  pushLine("credit", classOf(payableAccountId), payableMagnitude, {
    accountId: payableAccountId,
    // The payout reader (`post-payment`) finds this line BY DESCRIPTION to
    // recover the reimbursement's booked carrying value. Editing the literal
    // here would silently stop it matching — so both sides share the constant.
    description: REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION
  });

  // Defensive backstop: assert the entry balances in true debit/credit space.
  // By construction the payable leg accumulates the same rounded per-line
  // magnitudes as the coding legs, so this holds by construction today and
  // cannot fire. The real integrity guard is `requireLineSum` (the subledger
  // must equal the header). This assert exists so a future edit that breaks the
  // matched-legs invariant fails loudly here rather than writing an unbalanced
  // journal to the GL.
  assertBalanced(
    signedDebitTotal,
    0,
    BALANCE_TOLERANCE,
    "Reimbursement journal"
  );

  return { journalLines };
}
export type ReimbursementContext = {
  trx: KyselyTransaction<KyselyDatabase>;
  reimbursement: Pick<
    Selectable<KyselyDatabase["reimbursement"]>,
    | "id"
    | "reimbursementId"
    | "employeeId"
    | "status"
    | "amount"
    | "currencyCode"
    | "exchangeRate"
    | "payableAccountId"
    | "reimbursementDate"
    | "postingDate"
    | "journalId"
  >;
  company: Pick<
    Selectable<KyselyDatabase["company"]>,
    "companyGroupId" | "baseCurrencyCode" | "timezone"
  >;
  postingStatus: AutomaticJournalStatus;
  companyId: string;
  userId: string;
  timestamp: string;
  today: string;
};

export async function postReimbursementJournal(
  context: ReimbursementContext
): Promise<{ journalId: string }> {
  const {
    trx,
    reimbursement,
    company,
    postingStatus,
    companyId,
    userId,
    timestamp
  } = context;
  // The parent lock serializes line writes. Locking line tuples too would
  // deadlock with an UPDATE whose BEFORE trigger is waiting for that parent.
  const lines = await trx
    .selectFrom("reimbursementLine")
    .selectAll()
    .where("reimbursementId", "=", reimbursement.id)
    .where("companyId", "=", companyId)
    .orderBy("sequence")
    .orderBy("id")
    .execute();

  // Resolve the employee-payable control account by ID from `accountDefault` —
  // never by account number or name, which are user-editable at any time
  // (lessons.md: "Never resolve a control account by number/name"). The
  // `employeeReimbursementsPayableAccount` column is nullable by design: an
  // upgrading company that has never configured it must still be able to post,
  // so the AP trade account is the documented fallback.
  const defaults = await trx
    .selectFrom("accountDefault")
    .select(["employeeReimbursementsPayableAccount", "payablesAccount"])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const payableAccountId =
    reimbursement.payableAccountId ??
    defaults?.employeeReimbursementsPayableAccount ??
    defaults?.payablesAccount ??
    null;
  if (!payableAccountId) {
    throw new Error(
      "No employee reimbursements payable account and no payables account is configured"
    );
  }

  const accountIds = [
    ...new Set([payableAccountId, ...lines.map((line) => line.accountId)])
  ];
  const postingAccounts = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", accountIds)
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("isGroup", "=", false)
    .execute();
  if (
    postingAccounts.length !== accountIds.length ||
    postingAccounts.some((account) => !isAccountClass(account.class))
  ) {
    throw new Error(
      "Reimbursement accounts must be active posting accounts in this company group"
    );
  }
  const accounts: Record<string, { class: AccountClass }> = {};
  for (const account of postingAccounts) {
    if (!isAccountClass(account.class)) {
      throw new Error("Reimbursement account class is missing");
    }
    accounts[account.id] = { class: account.class };
  }
  // Take the class from the RESOLVED account, so a mis-classed default (either
  // column) fails loudly instead of crediting the wrong side of the ledger.
  if (accounts[payableAccountId]?.class !== "Liability") {
    throw new Error(
      "Reimbursement payable account must be a Liability account"
    );
  }

  const costCenterIds = [
    ...new Set(
      lines.flatMap((line) => (line.costCenterId ? [line.costCenterId] : []))
    )
  ];
  if (costCenterIds.length) {
    const costCenters = await trx
      .selectFrom("costCenter")
      .select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", costCenterIds)
      .execute();
    if (costCenters.length !== costCenterIds.length) {
      throw new NotFoundError(
        "Reimbursement cost center not found in this company"
      );
    }
  }

  const projectIds = [
    ...new Set(
      lines.flatMap((line) => (line.projectId ? [line.projectId] : []))
    )
  ];
  if (projectIds.length) {
    const projects = await trx
      .selectFrom("project")
      .select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", projectIds)
      .execute();
    if (projects.length !== projectIds.length) {
      throw new NotFoundError(
        "Reimbursement project not found in this company"
      );
    }
  }

  let postingDate =
    reimbursement.postingDate ?? reimbursement.reimbursementDate;
  // A Provisional journal has no accounting period, and no posting creates a
  // period before the cutover.
  let accountingPeriodId: string | null = null;
  if (postingStatus === "Posted") {
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      postingDate,
      "historical-with-shift"
    );
    postingDate = period.postingDate;
    accountingPeriodId = period.id;
  }
  const built = buildReimbursementJournal({
    reimbursement: {
      amount: Number(reimbursement.amount),
      payableAccountId,
      currencyCode: reimbursement.currencyCode,
      exchangeRate: Number(reimbursement.exchangeRate)
    },
    lines: lines.map((line) => ({
      accountId: line.accountId,
      amount: Number(line.amount),
      costCenterId: line.costCenterId,
      projectId: line.projectId,
      description: line.description
    })),
    accounts,
    documentId: reimbursement.id,
    documentReadableId: reimbursement.reimbursementId
  });
  // The builder emits one debit per coding line IN ORDER, then the payable
  // credit. The dimension pass below pairs `built.journalLines[i]` with
  // `lines[i]` on that contract, so assert it rather than trusting it.
  if (
    built.journalLines.length !== lines.length + 1 ||
    lines.some(
      (line, index) => built.journalLines[index]?.accountId !== line.accountId
    )
  ) {
    throw new Error("Reimbursement journal lines do not match coding lines");
  }

  const { costCenter: costCenterDimensionId, project: projectDimensionId } =
    costCenterIds.length || projectIds.length
      ? await costCenterAndProjectDimensions(trx, company.companyGroupId)
      : { costCenter: null, project: null };
  if (costCenterIds.length && !costCenterDimensionId) {
    throw new Error("Company group has no active Cost Center dimension");
  }
  if (projectIds.length && !projectDimensionId) {
    throw new Error("Company group has no active Project dimension");
  }

  // The generic per-line dimension rows — where a human's edit in the line
  // editor lands.
  const lineIds = lines.map((line) => line.id);
  const genericDimensions = lineIds.length
    ? await trx
        .selectFrom("reimbursementLineDimension")
        .select(["reimbursementLineId", "dimensionId", "valueId"])
        .where("companyId", "=", companyId)
        .where("reimbursementLineId", "in", lineIds)
        .orderBy("dimensionId")
        .execute()
    : [];
  const genericDimensionIds = [
    ...new Set(genericDimensions.map((row) => row.dimensionId))
  ];
  if (genericDimensionIds.length) {
    const activeDimensions = await trx
      .selectFrom("dimension")
      .select("id")
      .where("companyGroupId", "=", company.companyGroupId)
      .where("active", "=", true)
      .where("id", "in", genericDimensionIds)
      .execute();
    if (activeDimensions.length !== genericDimensionIds.length) {
      throw new Error(
        "Reimbursement line dimension is not an active dimension in this company group"
      );
    }
  }
  const genericByLineId = new Map<
    string,
    { dimensionId: string; valueId: string }[]
  >();
  for (const row of genericDimensions) {
    const existing = genericByLineId.get(row.reimbursementLineId);
    if (existing) existing.push(row);
    else genericByLineId.set(row.reimbursementLineId, [row]);
  }

  const journal = await trx
    .insertInto("journal")
    .values({
      journalEntryId: await getNextSequenceInTransaction(
        trx,
        "journalEntry",
        companyId
      ),
      accountingPeriodId,
      description: `Reimbursement ${reimbursement.reimbursementId}`,
      postingDate,
      companyId,
      sourceType: "Reimbursement",
      status: postingStatus,
      postedAt: timestamp,
      postedBy: userId,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const journalId = journal.id;
  const journalLineReference = nanoid();
  const journalLineIds = await allocateJournalLineIds(
    trx,
    built.journalLines.length
  );
  await trx
    .insertInto("journalLine")
    .values(
      built.journalLines.map((line, index) => ({
        id: journalLineIds[index],
        journalId,
        accountId: line.accountId,
        amount: line.amount,
        quantity: 1,
        description: line.description,
        documentType: "Reimbursement" as const,
        documentId: line.documentId,
        journalLineReference,
        companyId
      }))
    )
    .execute();

  // Two sources feed one destination. `journalLineDimension` is UNIQUE on
  // (journalLineId, dimensionId) — one value per dimension per line — so the
  // legacy `costCenterId`/`projectId` columns and the generic
  // `reimbursementLineDimension` rows must be MERGED before the insert, not
  // written as two passes.
  //
  // When both name the same dimension, the GENERIC TABLE WINS. The two legacy
  // columns are what the Ramp SYNC wrote at import; the generic table is
  // where a HUMAN's edit in the line editor lands — and human intent beats a
  // machine default. A reader who finds that precedence surprising needs the
  // sentence here, at the call site.
  const dimensionRows: {
    journalLineId: string;
    dimensionId: string;
    valueId: string;
    companyId: string;
  }[] = [];
  built.journalLines.forEach((journalLine, index) => {
    const sourceLine = lines[index];
    // The trailing payable leg is a control account and carries no coding.
    if (!sourceLine) return;
    const journalLineId = journalLineIds[index];
    if (!journalLineId) {
      throw new Error("Failed to map reimbursement journal line");
    }
    const byDimension = new Map<string, string>();
    if (costCenterDimensionId && journalLine.costCenterId) {
      byDimension.set(costCenterDimensionId, journalLine.costCenterId);
    }
    if (projectDimensionId && journalLine.projectId) {
      byDimension.set(projectDimensionId, journalLine.projectId);
    }
    for (const row of genericByLineId.get(sourceLine.id) ?? []) {
      byDimension.set(row.dimensionId, row.valueId);
    }
    for (const [dimensionId, valueId] of byDimension) {
      dimensionRows.push({
        journalLineId,
        dimensionId,
        valueId,
        companyId
      });
    }
  });
  if (dimensionRows.length) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionRows)
      .execute();
  }

  await trx
    .updateTable("reimbursement")
    .set({
      status: "Posted",
      journalId,
      postingDate,
      payableAccountId,
      postedAt: timestamp,
      postedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId
    })
    .where("id", "=", reimbursement.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId };
}
export type PostReimbursementArgs = {
  type: "post" | "void";
  reimbursementId: string;
  companyId: string;
  userId: string;
};

export function postReimbursementTransaction(
  db: Kysely<KyselyDatabase>,
  args: PostReimbursementArgs
): Promise<{ journalId: string | null }> {
  const { type, reimbursementId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    // This is deliberately the first database read, and it is scoped to
    // `companyId` — a reimbursement id from another tenant is simply not found.
    // The line mutation trigger takes the same parent lock, so every snapshot
    // below is stable.
    const reimbursement = await trx
      .selectFrom("reimbursement")
      .select([
        "id",
        "reimbursementId",
        "employeeId",
        "status",
        "amount",
        "currencyCode",
        "exchangeRate",
        "payableAccountId",
        "journalId",
        sql<string>`"reimbursementDate"::text`.as("reimbursementDate"),
        sql<string | null>`"postingDate"::text`.as("postingDate")
      ])
      .where("id", "=", reimbursementId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!reimbursement) throw new NotFoundError("Reimbursement not found");

    // Re-posting a Posted row and re-voiding a Voided row both return the
    // stored journal id without writing a second journal.
    if (type === "post" && reimbursement.status === "Posted") {
      return { journalId: reimbursement.journalId };
    }
    if (type === "void" && reimbursement.status === "Voided") {
      return { journalId: reimbursement.journalId };
    }
    const expectedStatus = type === "post" ? "Draft" : "Posted";
    if (reimbursement.status !== expectedStatus) {
      throw new Error(
        `Cannot ${type} reimbursement in status ${reimbursement.status}`
      );
    }

    // Every posting writes a journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the status until
    // commit.
    const postingStatus = await journalPostingStatus(trx, companyId);

    const company = await trx
      .selectFrom("company")
      .select(["companyGroupId", "baseCurrencyCode", "timezone"])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company?.companyGroupId) {
      throw new Error("Reimbursement company configuration not found");
    }

    const timestamp = datetime.timestamp();
    const today = datetime.today(company.timezone).toString();
    const context = {
      trx,
      reimbursement,
      company,
      postingStatus,
      companyId,
      userId,
      timestamp,
      today
    };

    return type === "post"
      ? await postReimbursementJournal(context)
      : await voidReimbursement(context);
  });
}
export async function voidReimbursement(
  context: ReimbursementContext
): Promise<{ journalId: string | null }> {
  const {
    trx,
    reimbursement,
    postingStatus,
    companyId,
    userId,
    timestamp,
    today
  } = context;

  // The enable superseded the journal of a reimbursement dated before the
  // cutover and opened its balances in the opening journal, so a reversal of
  // its own lines would undo nothing. The date is the one the posting used.
  await refuseVoidBeforeCutover(
    trx,
    companyId,
    reimbursement.postingDate ?? reimbursement.reimbursementDate,
    REIMBURSEMENT_VOID_BEFORE_CUTOVER_ERROR
  );

  // A paid-out reimbursement cannot be voided. Without this the void wrote a
  // second journal crediting the employee payable again, leaving that account
  // negative with nothing that will ever clear it, the cash already gone, and a
  // live `invoiceSettlement` row pointing at a Voided document. `post-memo`
  // refuses the same shape ("Cannot void a consumed memo"); this is its
  // counterpart, and the only reason it was missing is that reimbursements got
  // their payout path after the void path was written.
  const settlement = await trx
    .selectFrom("invoiceSettlement as s")
    .leftJoin("payment as applying", "applying.id", "s.paymentId")
    .select("s.id")
    .where("s.companyId", "=", companyId)
    .where("s.targetReimbursementId", "=", reimbursement.id)
    .where((eb) =>
      eb.or([
        eb("s.paymentId", "is", null),
        eb("applying.status", "=", "Posted")
      ])
    )
    .limit(1)
    .executeTakeFirst();
  if (settlement) {
    throw new Error("Cannot void a paid reimbursement; void its payment first");
  }

  if (reimbursement.journalId) {
    const originalJournal = await trx
      .selectFrom("journal")
      .select(["id", "status", "sourceType"])
      .where("id", "=", reimbursement.journalId)
      .where("companyId", "=", companyId)
      .forShare()
      .executeTakeFirst();
    if (
      !originalJournal ||
      !(OPEN_ITEM_JOURNAL_STATUSES as readonly string[]).includes(
        originalJournal.status
      ) ||
      originalJournal.sourceType !== "Reimbursement"
    ) {
      throw new Error("Original reimbursement journal has invalid provenance");
    }
    const originalLines = await trx
      .selectFrom("journalLine")
      .selectAll()
      // The journal's status was checked above, under FOR SHARE.
      .where("journalId", "=", originalJournal.id)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .execute();
    if (
      !originalLines.length ||
      originalLines.some(
        (line) =>
          line.documentType !== "Reimbursement" ||
          line.documentId !== reimbursement.id
      )
    ) {
      throw new Error("Original reimbursement journal has invalid lines");
    }
    await insertNegatedJournal(trx, {
      companyId,
      userId,
      originalLines,
      description: `VOID Reimbursement ${reimbursement.reimbursementId}`,
      sourceType: "Reimbursement",
      postingStatus,
      date: today,
      periodMode: "current",
      postedAt: timestamp
    });
  }

  await trx
    .updateTable("reimbursement")
    .set({
      status: "Voided",
      voidedAt: timestamp,
      voidedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId
    })
    .where("id", "=", reimbursement.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId: reimbursement.journalId };
}
export const postReimbursementInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  reimbursementId: z.string()
});

export const postReimbursementPermission = {
  update: "invoicing"
} satisfies PermissionRule<z.output<typeof postReimbursementInput>>;

/**
 * Posts or voids a reimbursement and its journal, atomically. The transaction re-reads
 * the record under companyId, so a foreign id fails as "not found".
 */
export async function postReimbursement(
  ctx: ServiceContext,
  raw: z.input<typeof postReimbursementInput>
) {
  const { type, reimbursementId } = postReimbursementInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const result = await postReimbursementTransaction(db, {
    type,
    reimbursementId,
    companyId,
    userId
  });
  return { success: true, ...result };
}
type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

export type LegacyAdjustmentJournals = {
  inventoryAdjustments: LegacyJournal[];
  inventoryCounts: LegacyJournal[];
  nonConformances: LegacyJournal[];
  maintenanceConsumptions: LegacyJournal[];
};

type Offset = {
  accountId: string | null;
  accountDefaultRole: OptionalDefaultRole | null;
  description: string;
};

/** "Label — comment", or the label alone, as the postings describe. */
function withComment(label: string, comment: string | null | undefined) {
  return comment?.trim() ? `${label} — ${comment.trim()}` : label;
}

function sign(quantity: number) {
  return quantity < 0 ? "out" : "in";
}

export async function buildLegacyAdjustmentJournals(
  trx: KyselyTx,
  {
    companyId,
    cutoverDate,
    defaults
  }: { companyId: string; cutoverDate: string; defaults: AccountDefaults }
): Promise<LegacyAdjustmentJournals> {
  const result: LegacyAdjustmentJournals = {
    inventoryAdjustments: [],
    inventoryCounts: [],
    nonConformances: [],
    maintenanceConsumptions: []
  };
  const rows = await legacyAdjustmentCostRows(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (rows.length === 0) return result;

  const ledgerColumns = [
    "id",
    "itemId",
    "quantity",
    "documentType",
    "documentId",
    "comment",
    "createdBy",
    "locationId",
    "scrapReasonId",
    sql<string>`"createdAt"::text`.as("createdAt")
  ] as const;

  // The movement a cost row names itself: an adjustment, a CSV import row, a
  // manual scrap or unscrap. The core sets the cost row's document to the
  // ledger row's id when the movement has no document.
  const ownLedgers = await readByIds(
    rows.map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("itemLedger")
        .select(ledgerColumns)
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .where("documentId", "is", null)
        .execute()
  );
  const ownLedgerById = new Map(ownLedgers.map((row) => [row.id, row]));
  const ownLedger = (row: (typeof rows)[number]) => {
    const ledger = ownLedgerById.get(row.documentId);
    return ledger && ledger.documentType === row.documentType
      ? ledger
      : undefined;
  };

  // The movements of a document, paired with its cost rows in entry order.
  const documentRows = rows.filter(
    (row) =>
      !ownLedger(row) &&
      row.documentType !== null &&
      row.documentType !== "Maintenance Consumption"
  );
  const documentLedgers = await readByIds(
    documentRows.map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("itemLedger")
        .select(ledgerColumns)
        .where("companyId", "=", companyId)
        .where("documentId", "in", ids)
        .where("documentType", "in", [
          "Scrap",
          "Inventory Count",
          "Non-Conformance",
          "Inbound Inspection"
        ])
        .where("correctionOfItemLedgerId", "is", null)
        .orderBy("entryNumber")
        .execute()
  );
  const pairKey = (row: {
    documentType: string | null;
    documentId: string | null;
    itemId: string | null;
    createdAt: string;
    quantity: number;
  }) =>
    `${row.documentType}|${row.documentId}|${row.itemId}|${row.createdAt}|${sign(Number(row.quantity))}`;
  const ledgerQueues = Map.groupBy(documentLedgers, (row) => pairKey(row));
  const pairedLedger = new Map<string, (typeof documentLedgers)[number]>();
  for (const row of documentRows) {
    const next = ledgerQueues.get(pairKey(row))?.shift();
    if (next) pairedLedger.set(row.id, next);
  }

  // How many movements with no document each transaction wrote: more than
  // one is a CSV import file.
  const batchSizes = await readByIds(
    rows
      .filter((row) => row.documentType === null && ownLedger(row))
      .map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("itemLedger as batch")
        .select([
          sql<string>`"batch"."createdAt"::text`.as("createdAt"),
          sql<number>`count(*)`.as("count")
        ])
        .where("batch.companyId", "=", companyId)
        .where("batch.documentType", "is", null)
        .where("batch.documentId", "is", null)
        .where("batch.correctionOfItemLedgerId", "is", null)
        .where("batch.createdAt", "in", (eb) =>
          eb
            .selectFrom("itemLedger")
            .select("createdAt")
            .where("companyId", "=", companyId)
            .where("id", "in", ids)
        )
        .groupBy("batch.createdAt")
        .execute()
  );
  const batchSizeByCreatedAt = new Map(
    batchSizes.map((row) => [row.createdAt, Number(row.count)])
  );

  const documentIds = (documentType: string) =>
    rows
      .filter((row) => row.documentType === documentType)
      .map((row) => row.documentId);
  const counts = await readByIds(documentIds("Inventory Count"), (ids) =>
    trx
      .selectFrom("inventoryCount")
      .select(["id", "inventoryCountId"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const nonConformances = await readByIds(
    documentIds("Non-Conformance"),
    (ids) =>
      trx
        .selectFrom("nonConformance")
        .select(["id", "nonConformanceId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const dispatches = await readByIds(
    documentIds("Maintenance Consumption"),
    (ids) =>
      trx
        .selectFrom("maintenanceDispatch")
        .select(["id", "maintenanceDispatchId", "locationId", "workCenterId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const itemIds = rows.map((row) => row.itemId);
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const countById = new Map(counts.map((row) => [row.id, row]));
  const nonConformanceById = new Map(
    nonConformances.map((row) => [row.id, row])
  );
  const dispatchById = new Map(dispatches.map((row) => [row.id, row]));

  const variance: Offset = {
    accountId: defaults.inventoryAdjustmentVarianceAccount,
    accountDefaultRole: null,
    description: "Inventory Adjustment"
  };
  // Before the cutover an empty scrap account is a stand-in line.
  const scrapAccount = resolveDefaultAccount(
    defaults,
    "scrapAccount",
    "Provisional"
  );

  const groups = new Map<
    string,
    { family: keyof LegacyAdjustmentJournals; journal: LegacyJournal }
  >();
  for (const row of rows) {
    const { itemId, documentId } = row;
    const quantity = Number(row.quantity);
    const own = ownLedger(row);
    const ledger = own ?? pairedLedger.get(row.id);
    let key: string;
    // The family the detection names (legacy-documents.ts), so the wizard's
    // counts and these journals agree.
    const family: keyof LegacyAdjustmentJournals = row.family;
    let description: string;
    let sourceType: LegacyJournal["sourceType"] = "Inventory Adjustment";
    let offset = variance;
    let locationId = ledger?.locationId ?? null;
    let extra: Partial<Record<DimensionEntityType, string | null>> = {};

    switch (row.documentType) {
      case null: {
        // Not a movement of the core (a revaluation names its unit).
        if (!own) continue;
        const isImport = (batchSizeByCreatedAt.get(own.createdAt) ?? 1) > 1;
        key = isImport ? `import:${own.createdAt}` : `adjustment:${own.id}`;
        description = isImport
          ? "Inventory Adjustment — CSV import"
          : withComment("Inventory Adjustment", own.comment);
        break;
      }
      case "Scrap": {
        if (own) {
          key = `scrap:${own.id}`;
          description = withComment(
            quantity < 0 ? "Scrap" : "Unscrap",
            own.comment
          );
        } else {
          key = `job-scrap:${row.id}`;
          description = `Scrap — ${itemById.get(itemId)?.readableIdWithRevision ?? ""}`;
        }
        offset = { ...scrapAccount, description: "Scrap Account" };
        extra = {
          ScrapReason: ledger?.scrapReasonId ?? null,
          Employee: ledger?.createdBy ?? null
        };
        break;
      }
      case "Inventory Count": {
        key = `count:${documentId}:${row.createdAt}`;
        const count = countById.get(documentId);
        description = count
          ? `Inventory Count ${count.inventoryCountId}`
          : (ledger?.comment ?? "Inventory Count");
        break;
      }
      case "Non-Conformance":
      case "Inbound Inspection": {
        key = `${row.documentType}:${documentId}:${row.createdAt}`;
        sourceType = row.documentType;
        description =
          row.documentType === "Non-Conformance"
            ? `NC ${nonConformanceById.get(documentId)?.nonConformanceId ?? documentId} disposition`
            : "Inbound inspection lot rejected";
        offset = { ...scrapAccount, description: "Scrap / Cost of Quality" };
        break;
      }
      case "Maintenance Consumption": {
        key = `maintenance:${documentId}:${row.createdAt}`;
        const dispatch = dispatchById.get(documentId);
        description = `Maintenance Consumption ${dispatch?.maintenanceDispatchId ?? documentId}`;
        // An empty maintenance account falls back to the variance account
        // in the core's pair builder.
        offset = {
          accountId: defaults.maintenanceAccount,
          accountDefaultRole: null,
          description: "Maintenance Expense"
        };
        locationId = dispatch?.locationId ?? null;
        extra = { WorkCenter: dispatch?.workCenterId ?? null };
        break;
      }
      default:
        continue;
    }

    const [inventoryLine, offsetLine] = buildAdjustmentJournalLines({
      journalId: "",
      documentId,
      documentType: row.documentType,
      journalLineReference: nanoid(),
      isGain: quantity > 0,
      cost: Math.abs(Number(row.cost)),
      quantity: Math.abs(quantity),
      replenishmentSystem: itemById.get(itemId)?.replenishmentSystem ?? null,
      accountDefaults: defaults,
      offsetAccount: offset.accountId,
      offsetDescription: offset.description,
      companyId
    });
    const dimensions = {
      Item: itemId,
      ItemPostingGroup: postingGroupByItem.get(itemId) ?? null,
      Location: locationId,
      ...extra
    };
    const lines: LegacyJournalLine[] = [inventoryLine, offsetLine].map(
      ({ journalId: _journalId, companyId: _companyId, ...line }) => ({
        ...line,
        dimensions
      })
    );
    lines[1]!.accountDefaultRole = offset.accountDefaultRole;

    const group = groups.get(key);
    if (group) {
      group.journal.lines.push(...lines);
    } else {
      groups.set(key, {
        family,
        journal: {
          description,
          postingDate: String(row.postingDate),
          sourceType,
          lines
        }
      });
    }
  }

  for (const { family, journal } of groups.values()) {
    result[family].push(journal);
  }
  return result;
}
export async function buildLegacyChargeJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate
  }: { companyId: string; companyGroupId: string; cutoverDate: string }
): Promise<LegacyDocumentJournal[]> {
  const charges = await legacyCharges(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (charges.length === 0) return [];

  const lines = await readByIds(
    charges.map((charge) => charge.id),
    (ids) =>
      trx
        .selectFrom("chargeLine")
        .selectAll()
        .where("companyId", "=", companyId)
        .where("chargeId", "in", ids)
        .orderBy("chargeId")
        .orderBy("sequence")
        .orderBy("id")
        .execute()
  );
  const accounts = await readByIds(
    [
      ...charges.flatMap((charge) => [
        charge.cardAccountId,
        charge.offsetAccountId
      ]),
      ...lines.map((line) => line.accountId)
    ],
    (ids) =>
      trx
        .selectFrom("account")
        .select(["id", "class"])
        .where("companyGroupId", "=", companyGroupId)
        .where("id", "in", ids)
        .execute()
  );
  const accountClasses: Record<string, { class: AccountClass }> = {};
  for (const account of accounts) {
    if (isAccountClass(account.class)) {
      accountClasses[account.id] = { class: account.class };
    }
  }
  const dimensionIds = await costCenterAndProjectDimensions(
    trx,
    companyGroupId
  );

  const linesByCharge = Map.groupBy(lines, (line) => line.chargeId);

  return charges.map((charge) => {
    const built = buildChargeJournal({
      transaction: {
        type: charge.type,
        amount: Number(charge.amount),
        cardAccountId: charge.cardAccountId,
        offsetAccountId: charge.offsetAccountId,
        currencyCode: charge.currencyCode,
        exchangeRate: Number(charge.exchangeRate)
      },
      lines: (linesByCharge.get(charge.id) ?? []).map((line) => ({
        accountId: line.accountId,
        amount: Number(line.amount),
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        description: line.description
      })),
      accounts: accountClasses,
      documentId: charge.id,
      documentReadableId: charge.chargeId
    });
    const journalLineReference = nanoid();
    return {
      documentId: charge.id,
      description: `Charge ${charge.chargeId}`,
      postingDate: String(charge.postingDate ?? charge.transactionDate),
      sourceType: "Charge" as const,
      lines: built.journalLines.map((line) => ({
        accountId: line.accountId,
        amount: line.amount,
        quantity: 1,
        description: line.description,
        documentType: "Charge" as const,
        documentId: line.documentId,
        journalLineReference,
        dimensions: {},
        dimensionValues: [
          ...(dimensionIds.costCenter && line.costCenterId
            ? [
                {
                  dimensionId: dimensionIds.costCenter,
                  valueId: line.costCenterId
                }
              ]
            : []),
          ...(dimensionIds.project && line.projectId
            ? [{ dimensionId: dimensionIds.project, valueId: line.projectId }]
            : [])
        ]
      }))
    };
  });
}
/** The documents the enable wrote a journal for, per family: the families
 *  `getLegacyDocumentCounts` counts before the enable. */
export type LegacyJournalCounts = LegacyDocumentCounts & {
  /** Cost rows written for movements that stored none. */
  movementCostRows: number;
};

export async function journalLegacyDocuments(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<{
  counts: LegacyJournalCounts;
  /** Every journal written, Provisional. */
  journalIds: string[];
}> {
  const args = { companyId, companyGroupId, cutoverDate, defaults };

  // Before the builders that read the sale rows.
  const movementCosts = await writeLegacyMovementCosts(trx, {
    companyId,
    cutoverDate,
    defaults
  });

  const salesInvoices = await buildLegacySalesInvoiceJournals(trx, args);
  const purchaseInvoices = await buildLegacyPurchaseInvoiceJournals(trx, args);
  const memos = await buildLegacyMemoJournals(trx, args);
  const charges = await buildLegacyChargeJournals(trx, args);
  const reimbursements = await buildLegacyReimbursementJournals(trx, args);
  const documentJournals: [JournalDocumentTable, LegacyDocumentJournal[]][] = [
    ["memo", memos],
    ["charge", charges],
    ["reimbursement", reimbursements]
  ];
  const documentJournalIds = await insertProvisionalJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    journals: [
      ...salesInvoices,
      ...purchaseInvoices,
      ...documentJournals.flatMap(([, journals]) => journals)
    ]
  });
  // The memo, charge and reimbursement store the journal, as their postings do.
  let offset = salesInvoices.length + purchaseInvoices.length;
  for (const [table, journals] of documentJournals) {
    await attachJournalIds(trx, {
      table,
      companyId,
      userId,
      rows: journals.map((journal, index) => ({
        id: journal.documentId,
        journalId: documentJournalIds[offset + index] ?? null,
        payableAccountId: journal.payableAccountId
      }))
    });
    offset += journals.length;
  }

  // After every document a payment can settle has its journal. The payment
  // builder stores each journal on its payment.
  const paymentIds = (
    await legacyPayments(trx, { companyId, cutoverDate })
      .clearSelect()
      .select("payment.id")
      .execute()
  ).map((payment) => payment.id);
  const payments = await journalLegacyPayments(trx, {
    companyId,
    companyGroupId,
    userId,
    cutoverDate
  });
  const paymentJournalIds = await readByIds(paymentIds, (ids) =>
    trx
      .selectFrom("payment")
      .select("journalId")
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .where("journalId", "is not", null)
      .execute()
  );

  // The movements last: no document journal reads them, and the re-cost
  // after this step reads their inventory lines.
  const movementArgs = { companyId, cutoverDate, defaults };
  const purchaseReceipts = await buildLegacyPurchaseReceiptJournals(
    trx,
    movementArgs
  );
  const salesReturnReceipts = await buildLegacySalesReturnReceiptJournals(
    trx,
    movementArgs
  );
  const salesShipments = await buildLegacySalesShipmentJournals(
    trx,
    movementArgs
  );
  const returnShipments = await buildLegacyReturnShipmentJournals(
    trx,
    movementArgs
  );
  const adjustments = await buildLegacyAdjustmentJournals(trx, movementArgs);
  const movements = [
    ...purchaseReceipts,
    ...salesReturnReceipts,
    ...salesShipments,
    ...returnShipments,
    ...adjustments.inventoryAdjustments,
    ...adjustments.inventoryCounts,
    ...adjustments.nonConformances,
    ...adjustments.maintenanceConsumptions,
    ...movementCosts.jobConsumptions,
    ...movementCosts.jobOutputs
  ];
  const movementJournalIds = await insertProvisionalJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    journals: movements
  });

  // No other journal reads them, and the re-cost never touches them.
  const runs = await journalLegacyRuns(trx, {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  });

  // A journal with no lines is not written (`insertProvisionalJournals`).
  const written = (journals: { lines: unknown[] }[]) =>
    journals.filter((journal) => journal.lines.length > 0).length;
  return {
    counts: {
      salesInvoices: written(salesInvoices),
      purchaseInvoices: written(purchaseInvoices),
      memos: written(memos),
      charges: written(charges),
      reimbursements: written(reimbursements),
      payments,
      purchaseReceipts: written(purchaseReceipts),
      salesReturnReceipts: written(salesReturnReceipts),
      salesShipments: written(salesShipments),
      returnShipments: written(returnShipments),
      inventoryAdjustments: written(adjustments.inventoryAdjustments),
      inventoryCounts: written(adjustments.inventoryCounts),
      nonConformances: written(adjustments.nonConformances),
      maintenanceConsumptions: written(adjustments.maintenanceConsumptions),
      jobConsumptions: written(movementCosts.jobConsumptions),
      jobOutputs: written(movementCosts.jobOutputs),
      movementCostRows: movementCosts.costRows,
      ...runs.counts
    },
    journalIds: [
      ...documentJournalIds,
      ...paymentJournalIds.map((payment) => payment.journalId),
      ...movementJournalIds,
      ...runs.journalIds
    ].filter((id): id is string => id !== null)
  };
}
export async function buildLegacyMemoJournals(
  trx: KyselyTx,
  { companyId, cutoverDate }: { companyId: string; cutoverDate: string }
): Promise<LegacyDocumentJournal[]> {
  const memos = await legacyMemos(trx, {
    companyId,
    cutoverDate
  }).execute();
  const journals: LegacyDocumentJournal[] = [];
  for (const batch of chunkArray(memos, ROWS_PER_STATEMENT)) {
    const rebuilt = await rebuildMemoJournals(trx, batch, companyId, {
      postingStatus: "Provisional"
    });
    batch.forEach((memo, index) => {
      const { lines, dimensions } = rebuilt[index]!;
      journals.push({
        documentId: memo.id,
        description: `${memo.direction} Memo ${memo.memoId}`,
        postingDate: String(memo.postingDate),
        sourceType: memo.direction === "Credit" ? "Credit Memo" : "Debit Memo",
        lines: lines.map(({ companyId: _, ...line }) => ({
          ...line,
          dimensions: {},
          dimensionValues: dimensions
        }))
      });
    });
  }
  return journals;
}
type CostLedgerInsert = Database["public"]["Tables"]["costLedger"]["Insert"];

export type LegacyMovementCosts = {
  /** Cost rows written: sales, job issues and returns, job output layers. */
  costRows: number;
  jobConsumptions: LegacyJournal[];
  jobOutputs: LegacyJournal[];
};

/** A job movement: one issue or return ledger row, or one completion. */
export type JobMovement = {
  /** The ledger row of an issue or return; the rows of a completion. */
  key: string;
  kind: "Consumption" | "Output";
  jobId: string;
  itemId: string;
  /** Signed, as the ledger stores it. */
  quantity: number;
  postingDate: string;
  /** A fixed-width UTC instant (`utcInstant`), so it sorts as text. */
  createdAt: string;
  documentLineId: string | null;
  locationId: string | null;
  /** The serial unit an issue relieves first. */
  trackedEntityIds: string[];
};

/** A cost row a posting stored for a job movement. Signed. */
export type StoredJobCost = {
  kind: JobMovement["kind"];
  jobId: string;
  itemId: string;
  quantity: number;
  cost: number;
};

/** A movement, and the part of it stored cost rows cover. */
export type CoveredJobMovement = {
  movement: JobMovement;
  coveredQuantity: number;
  coveredCost: number;
  /** The quantity no stored row covers, unsigned. A new row books it. */
  missingQuantity: number;
};

export type PlannedJobMovement = CoveredJobMovement & {
  /** The new row's cost, unsigned. */
  missingCost: number;
  /** The pair to write, unsigned; null when the day kept its journal. */
  journal: { quantity: number; cost: number } | null;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const instantOf = (movement: { postingDate: string; createdAt: string }) =>
  `${movement.postingDate}|${movement.createdAt}`;

/**
 * Splits each movement into what the stored cost rows cover and what is
 * missing, in the order the postings ran: by time, and at one instant the
 * issues before the completions (the posting backflushes the material, then
 * receives the output, in one transaction). Stored rows cover the earliest
 * movements of a job, item and direction.
 */
export function coverJobMovements({
  movements,
  stored
}: {
  movements: JobMovement[];
  stored: StoredJobCost[];
}): CoveredJobMovement[] {
  const coverKey = (row: {
    kind: string;
    jobId: string;
    itemId: string;
    quantity: number;
  }) => `${row.kind}:${row.jobId}:${row.itemId}:${row.quantity < 0}`;
  const budgets = new Map<string, { quantity: number; unitCost: number }[]>();
  for (const row of stored) {
    const quantity = Math.abs(row.quantity);
    if (quantity <= EPSILON) continue;
    const list = budgets.get(coverKey(row)) ?? [];
    list.push({ quantity, unitCost: Math.abs(row.cost) / quantity });
    budgets.set(coverKey(row), list);
  }
  const ordered = [...movements].sort(
    (a, b) =>
      byText(instantOf(a), instantOf(b)) ||
      (a.kind === b.kind ? 0 : a.kind === "Consumption" ? -1 : 1)
  );
  return ordered.map((movement) => {
    let wanted = Math.abs(movement.quantity);
    let coveredQuantity = 0;
    let coveredCost = 0;
    for (const budget of budgets.get(coverKey(movement)) ?? []) {
      if (wanted <= EPSILON) break;
      const take = Math.min(wanted, budget.quantity);
      if (take <= 0) continue;
      budget.quantity -= take;
      wanted -= take;
      coveredQuantity += take;
      coveredCost += take * budget.unitCost;
    }
    return {
      movement,
      coveredQuantity,
      coveredCost: round(coveredCost),
      missingQuantity: wanted > EPSILON ? round(wanted) : 0
    };
  });
}

/**
 * Plans the cost rows and journal pairs of the covered job movements, in
 * their order. An issue's or return's missing quantity costs what
 * `missingCostByKey` gives it; a completion takes the job's material cost
 * not yet received. `journaledDays` holds `<kind>:<jobId>:<postingDate>` for
 * a job and date that kept its journal: only what is missing there gets a
 * pair. Every other movement gets its pair, at zero too.
 */
export function planLegacyJobCosts({
  covered,
  journaledDays,
  missingCostByKey
}: {
  covered: CoveredJobMovement[];
  journaledDays: ReadonlySet<string>;
  missingCostByKey: ReadonlyMap<string, number>;
}): PlannedJobMovement[] {
  // The material cost each job has in WIP and no completion has taken.
  const wipByJob = new Map<string, number>();
  return covered.map((cover) => {
    const { movement, coveredQuantity, coveredCost, missingQuantity } = cover;
    const journaled = journaledDays.has(
      `${movement.kind}:${movement.jobId}:${movement.postingDate}`
    );
    const wip = wipByJob.get(movement.jobId) ?? 0;
    if (movement.kind === "Consumption") {
      const missingCost =
        missingQuantity > 0 ? missingCostByKey.get(movement.key) : 0;
      if (missingCost === undefined) {
        throw new Error(
          `The missing cost of job movement ${movement.key} was not computed`
        );
      }
      const value = coveredCost + missingCost;
      wipByJob.set(
        movement.jobId,
        movement.quantity < 0 ? wip + value : wip - value
      );
      const quantity = journaled
        ? missingQuantity
        : coveredQuantity + missingQuantity;
      return {
        ...cover,
        missingCost,
        journal:
          quantity > EPSILON
            ? {
                quantity: round(quantity),
                cost: journaled ? missingCost : value
              }
            : null
      };
    }
    const afterCovered = wip - coveredCost;
    const missingCost =
      missingQuantity > 0 ? round(Math.max(afterCovered, 0)) : 0;
    wipByJob.set(movement.jobId, afterCovered - missingCost);
    return {
      ...cover,
      missingCost,
      journal:
        !journaled || missingQuantity > 0
          ? {
              quantity: round(
                journaled ? missingQuantity : Math.abs(movement.quantity)
              ),
              cost: (journaled ? 0 : coveredCost) + missingCost
            }
          : null
    };
  });
}

/**
 * Writes the missing cost rows and returns the journals of the job
 * movements. Runs before the invoice and shipment builders read the sale
 * rows, and before the inventory reset.
 */
export async function writeLegacyMovementCosts(
  trx: KyselyTx,
  {
    companyId,
    cutoverDate,
    defaults
  }: { companyId: string; cutoverDate: string; defaults: AccountDefaults }
): Promise<LegacyMovementCosts> {
  const args = { companyId, cutoverDate };
  const sales = await legacySaleMovements(trx, args).execute();
  const ledgerRows = await legacyJobMovements(trx, args).execute();
  if (sales.length === 0 && ledgerRows.length === 0) {
    return {
      costRows: 0,
      jobConsumptions: [],
      jobOutputs: []
    };
  }

  const jobs = await readByIds(
    ledgerRows.map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("job")
        .select(["id", "jobId", "locationId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const storedRows = await readByIds(jobById.keys(), (ids) =>
    trx
      .selectFrom("costLedger")
      .select(["itemLedgerType", "documentId", "itemId", "quantity", "cost"])
      .where("companyId", "=", companyId)
      .where("documentId", "in", ids)
      .where("postingDate", ">=", cutoverDate)
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where((eb) =>
        eb.or([
          eb.and([
            eb("documentType", "=", "Job Consumption"),
            eb("itemLedgerType", "=", "Consumption")
          ]),
          eb.and([
            eb("documentType", "=", "Job Receipt"),
            eb("itemLedgerType", "=", "Output")
          ])
        ])
      )
      .orderBy("postingDate")
      .orderBy("entryNumber")
      .execute()
  );

  const itemIds = [
    ...sales.map((row) => row.itemId),
    ...ledgerRows.map((row) => row.itemId)
  ];
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const itemCosts = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "costingMethod", "standardCost", "unitCost"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  const itemCostById = new Map(itemCosts.map((row) => [row.itemId, row]));
  const itemCostOf = (itemId: string) => {
    const itemCost = itemCostById.get(itemId);
    if (!itemCost) {
      throw new InvalidInputError(
        `Item ${itemById.get(itemId)?.readableIdWithRevision ?? itemId} has no cost record, so its movements after the cutover cannot be costed.`
      );
    }
    return itemCost;
  };
  // Today's unit cost, as calculateCOGS reads it for a Standard or Average
  // item.
  const unitCostOf = (itemId: string) => {
    const itemCost = itemCostOf(itemId);
    return Number(
      (itemCost.costingMethod === "Standard"
        ? itemCost.standardCost
        : itemCost.unitCost) ?? 0
    );
  };
  const layeredMethod = (itemId: string): CostingMethod | null => {
    const method = itemCostOf(itemId).costingMethod;
    return method === "FIFO" || method === "LIFO" ? method : null;
  };

  // One movement per issue or return ledger row, and one per completion: the
  // rows of one completion (a unit each, when serialized) share an instant.
  const consumptionRows = ledgerRows.filter(
    (row) => row.entryType === "Consumption" && jobById.has(row.documentId!)
  );
  const outputRows = ledgerRows.filter(
    (row) => row.entryType === "Assembly Output" && jobById.has(row.documentId!)
  );
  const movements: JobMovement[] = [
    ...consumptionRows.map((row) => ({
      key: row.id,
      kind: "Consumption" as const,
      jobId: row.documentId!,
      itemId: row.itemId,
      quantity: Number(row.quantity),
      postingDate: row.postingDate,
      createdAt: row.createdAt,
      documentLineId: row.documentLineId,
      locationId: row.locationId,
      trackedEntityIds: row.trackedEntityId ? [row.trackedEntityId] : []
    })),
    ...[
      ...Map.groupBy(
        outputRows,
        (row) =>
          `${row.documentId}:${row.itemId}:${row.postingDate}:${row.createdAt}`
      )
    ].map(([key, group]) => ({
      key,
      kind: "Output" as const,
      jobId: group[0]!.documentId!,
      itemId: group[0]!.itemId,
      quantity: group.reduce((sum, row) => sum + Number(row.quantity), 0),
      postingDate: group[0]!.postingDate,
      createdAt: group[0]!.createdAt,
      documentLineId: null,
      locationId: group[0]!.locationId,
      trackedEntityIds: []
    }))
  ];
  const covered = coverJobMovements({
    movements,
    stored: storedRows.map((row) => ({
      kind:
        row.itemLedgerType === "Output"
          ? ("Output" as const)
          : ("Consumption" as const),
      jobId: String(row.documentId),
      itemId: String(row.itemId),
      quantity: Number(row.quantity),
      cost: Number(row.cost)
    }))
  });

  // The outbound quantities with no cost row, in movement order: the sales,
  // and the missing quantity of each issue.
  const saleKey = (row: (typeof sales)[number]) =>
    `sale:${row.documentId}:${row.itemId}`;
  const saleQuantity = (row: (typeof sales)[number]) =>
    round(Number(row.quantity) - Number(row.covered));
  const outbound = [
    ...sales.map((row) => ({
      order: instantOf(row),
      key: saleKey(row),
      itemId: row.itemId,
      quantity: saleQuantity(row),
      trackedEntityIds: row.trackedEntityIds
    })),
    ...covered
      .filter(
        ({ movement, missingQuantity }) =>
          movement.kind === "Consumption" &&
          movement.quantity < 0 &&
          missingQuantity > 0
      )
      .map(({ movement, missingQuantity }) => ({
        order: instantOf(movement),
        key: movement.key,
        itemId: movement.itemId,
        quantity: missingQuantity,
        trackedEntityIds: movement.trackedEntityIds
      }))
  ].sort((a, b) => byText(a.order, b.order));
  const relievedCostByKey = await relieveOpenLayers(trx, {
    companyId,
    reliefs: outbound.filter((relief) => layeredMethod(relief.itemId)),
    methodByItem: new Map(
      outbound.flatMap((relief) => {
        const method = layeredMethod(relief.itemId);
        return method ? [[relief.itemId, method] as const] : [];
      })
    ),
    // calculateCOGS costs a quantity no layer covers at the unit cost.
    fallbackUnitCostByItem: new Map(
      outbound.map((relief) => [
        relief.itemId,
        Number(itemCostOf(relief.itemId).unitCost ?? 0)
      ])
    )
  });
  const outboundCost = (relief: (typeof outbound)[number]) =>
    relievedCostByKey.get(relief.key) ??
    round(relief.quantity * unitCostOf(relief.itemId));
  const costByKey = new Map(
    outbound.map((relief) => [relief.key, outboundCost(relief)])
  );
  // A return costs at today's unit cost.
  for (const { movement, missingQuantity } of covered) {
    if (movement.kind === "Consumption" && movement.quantity > 0) {
      costByKey.set(
        movement.key,
        round(missingQuantity * unitCostOf(movement.itemId))
      );
    }
  }
  const planned = planLegacyJobCosts({
    covered,
    journaledDays: new Set(
      ledgerRows
        .filter((row) => row.journaled)
        .map(
          (row) =>
            `${row.entryType === "Consumption" ? "Consumption" : "Output"}:${row.documentId}:${row.postingDate}`
        )
    ),
    missingCostByKey: costByKey
  });

  // The rows, in the order of their movements, so the re-cost relieves
  // the layers in that order.
  const inserts: (CostLedgerInsert & { order: string })[] = [
    ...sales.map((row) => {
      const cost = costByKey.get(saleKey(row))!;
      return {
        order: instantOf(row),
        itemLedgerType: "Sale" as const,
        costLedgerType: "Direct Cost" as const,
        adjustment: false,
        documentType: "Sales Shipment" as const,
        documentId: row.documentId,
        itemId: row.itemId,
        quantity: -saleQuantity(row),
        cost: -cost,
        remainingQuantity: 0,
        postingDate: row.postingDate,
        createdAt: row.createdAt,
        companyId
      };
    }),
    ...planned
      .filter((plan) => plan.missingQuantity > 0)
      .map(({ movement, missingQuantity, missingCost }) => {
        const sign = movement.quantity < 0 ? -1 : 1;
        const isOutput = movement.kind === "Output";
        return {
          order: instantOf(movement),
          itemLedgerType: movement.kind,
          costLedgerType: "Direct Cost" as const,
          adjustment: false,
          documentType: isOutput
            ? ("Job Receipt" as const)
            : ("Job Consumption" as const),
          documentId: movement.jobId,
          itemId: movement.itemId,
          quantity: sign * missingQuantity,
          cost: sign * missingCost,
          // An output is a layer; an issue or return relieves or holds none.
          remainingQuantity: isOutput ? missingQuantity : 0,
          postingDate: movement.postingDate,
          createdAt: movement.createdAt,
          companyId
        };
      })
  ].sort((a, b) => byText(a.order, b.order));
  for (const rows of chunkArray(inserts, ROWS_PER_STATEMENT)) {
    await trx
      .insertInto("costLedger")
      .values(rows.map(({ order: _order, ...row }) => row))
      .execute();
  }

  // The journals of the job movements.
  const dimensions = (movement: JobMovement) => ({
    Item: movement.itemId,
    ItemPostingGroup: postingGroupByItem.get(movement.itemId) ?? null,
    Location:
      movement.locationId ?? jobById.get(movement.jobId)?.locationId ?? null
  });
  const inventoryOf = (itemId: string) =>
    resolveInventoryAccount(
      itemById.get(itemId)?.replenishmentSystem ?? null,
      defaults
    );
  const jobNumber = (jobId: string) => jobById.get(jobId)!.jobId;
  const withPair = planned.flatMap((plan) =>
    plan.journal ? [{ ...plan, journal: plan.journal }] : []
  );

  const jobConsumptions = [
    ...Map.groupBy(
      withPair.filter((plan) => plan.movement.kind === "Consumption"),
      (plan) => `${plan.movement.jobId}:${plan.movement.postingDate}`
    ).values()
  ].map((group): LegacyJournal => {
    const { jobId, postingDate } = group[0]!.movement;
    const lines = group.flatMap(
      ({ movement, journal }): LegacyJournalLine[] => {
        const inventory = inventoryOf(movement.itemId);
        const keys = {
          quantity: journal.quantity,
          documentType: "Job Consumption" as const,
          documentId: jobId,
          documentLineReference: movement.documentLineId
            ? journalReference.to.materialIssue(movement.documentLineId)
            : journalReference.to.job(jobId),
          journalLineReference: nanoid(),
          dimensions: dimensions(movement)
        };
        const wip = {
          ...keys,
          accountId: defaults.workInProgressAccount,
          description: "WIP Account"
        };
        const stock = {
          ...keys,
          accountId: inventory.account,
          description: inventory.description
        };
        return movement.quantity < 0
          ? [
              { ...wip, amount: round(debit("asset", journal.cost)) },
              { ...stock, amount: round(credit("asset", journal.cost)) }
            ]
          : [
              { ...stock, amount: round(debit("asset", journal.cost)) },
              { ...wip, amount: round(credit("asset", journal.cost)) }
            ];
      }
    );
    return {
      description: `Material Issue to Job ${jobNumber(jobId)}`,
      postingDate,
      sourceType: "Job Consumption",
      lines
    };
  });

  const jobOutputs = withPair
    .filter((plan) => plan.movement.kind === "Output")
    .map(({ movement, journal, coveredQuantity }): LegacyJournal => {
      const inventory = inventoryOf(movement.itemId);
      const keys = {
        quantity: journal.quantity,
        documentType: "Job Receipt" as const,
        documentId: movement.jobId,
        documentLineReference: journalReference.to.job(movement.jobId),
        journalLineReference: nanoid(),
        dimensions: dimensions(movement)
      };
      return {
        description: `Job Completion ${jobNumber(movement.jobId)}`,
        postingDate: movement.postingDate,
        sourceType: "Job Receipt",
        lines: [
          {
            ...keys,
            accountId: inventory.account,
            description: inventory.description,
            amount: round(debit("asset", journal.cost))
          },
          {
            ...keys,
            accountId: defaults.workInProgressAccount,
            description: "WIP Account",
            amount: round(credit("asset", journal.cost))
          }
        ]
      };
    });

  return {
    costRows: inserts.length,
    jobConsumptions,
    jobOutputs
  };
}

/**
 * Relieves the open layers of FIFO and LIFO items for the reliefs, in order,
 * as successive `calculateCOGS` calls would: reads the layers and their open
 * children once, locked as `calculateCOGS` locks them, replays the reliefs
 * (`replayReliefs`) and writes the remaining quantities that changed. A layer
 * this step writes (a job's output) is not open to a relief in the same
 * step; its quantity costs at the fallback, as negative stock does. Returns
 * each relief's cost by key.
 */
async function relieveOpenLayers(
  trx: KyselyTx,
  {
    companyId,
    reliefs,
    methodByItem,
    fallbackUnitCostByItem
  }: {
    companyId: string;
    reliefs: {
      key: string;
      itemId: string;
      quantity: number;
      trackedEntityIds: readonly string[];
    }[];
    methodByItem: ReadonlyMap<string, CostingMethod>;
    fallbackUnitCostByItem: ReadonlyMap<string, number>;
  }
): Promise<Map<string, number>> {
  if (reliefs.length === 0) return new Map();
  const layers = await readByIds(
    reliefs.map((relief) => relief.itemId),
    (ids) =>
      trx
        .selectFrom("costLedger")
        .select([
          "id",
          "itemId",
          "quantity",
          "cost",
          "remainingQuantity",
          "trackedEntityId"
        ])
        .where("companyId", "=", companyId)
        .where("itemId", "in", ids)
        .where("remainingQuantity", ">", 0)
        .where(isCostLayer)
        .orderBy("itemId")
        .orderBy("postingDate")
        .orderBy("createdAt")
        .forUpdate()
        .execute()
  );
  const children = await readByIds(
    layers.map((layer) => layer.id),
    (ids) =>
      trx
        .selectFrom("costLedger")
        .select([
          "id",
          "appliesToCostLedgerId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where("companyId", "=", companyId)
        .where("appliesToCostLedgerId", "in", ids)
        .where("remainingQuantity", ">", 0)
        .orderBy("createdAt")
        .forUpdate()
        .execute()
  );
  const childrenByLayer = Map.groupBy(
    children,
    (child) => child.appliesToCostLedgerId
  );
  const loaded = new Map<string, number>();
  const events: ReliefEvent[] = [
    ...layers.map((layer): ReliefEvent => {
      loaded.set(layer.id, Number(layer.remainingQuantity));
      return {
        kind: "layer",
        itemId: layer.itemId!,
        layer: {
          id: layer.id,
          quantity: Number(layer.quantity),
          cost: Number(layer.cost),
          remainingQuantity: Number(layer.remainingQuantity),
          trackedEntityId: layer.trackedEntityId,
          children: (childrenByLayer.get(layer.id) ?? []).map((child) => {
            loaded.set(child.id, Number(child.remainingQuantity));
            return {
              id: child.id,
              quantity: Number(child.quantity),
              cost: Number(child.cost),
              remainingQuantity: Number(child.remainingQuantity)
            };
          })
        }
      };
    }),
    ...reliefs.map((relief): ReliefEvent => ({ kind: "relief", ...relief }))
  ];
  const { costByKey, remainingById } = replayReliefs({
    events,
    methodByItem,
    fallbackUnitCostByItem
  });
  const changed = [...remainingById].filter(
    ([id, remaining]) => loaded.get(id) !== remaining
  );
  for (const rows of chunkArray(changed, ROWS_PER_STATEMENT)) {
    await sql`
      UPDATE "costLedger" AS c
      SET "remainingQuantity" = v."remaining"
      FROM (VALUES ${sql.join(
        rows.map(([id, remaining]) => sql`(${id}, ${remaining}::numeric)`)
      )}) AS v("id", "remaining")
      WHERE c."id" = v."id" AND c."companyId" = ${companyId}
    `.execute(trx);
  }
  return costByKey;
}
export async function journalLegacyPayments(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    /** Not read: the processor fee reads its own account defaults. */
    defaults?: AccountDefaults;
  }
): Promise<number> {
  const payments = await legacyPayments(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (payments.length === 0) return 0;
  const { fees: feeByPaymentId } = await readPaymentProcessorFees(
    trx,
    companyId,
    payments
  );

  let written = 0;
  for (const batch of chunkArray(payments, ROWS_PER_STATEMENT)) {
    const rebuilt = await rebuildPaymentJournals(trx, batch, companyId, {
      postingStatus: "Provisional",
      feeByPaymentId
    });
    const journals: LegacyJournal[] = batch.map((payment, index) => {
      const { lines, dimensions } = rebuilt[index]!;
      return {
        description: `Payment ${payment.paymentId}`,
        postingDate: String(payment.postingDate),
        sourceType: "Payment" as const,
        lines: lines.map(
          ({ companyId: _, documentLineReference, ...line }) => ({
            ...line,
            documentLineReference: documentLineReference ?? null,
            dimensions: {},
            dimensionValues: dimensions
          })
        )
      };
    });
    const journalIds = await insertProvisionalJournals(trx, {
      companyId,
      companyGroupId,
      userId,
      journals
    });
    await attachJournalIds(trx, {
      table: "payment",
      companyId,
      userId,
      rows: batch.map((payment, index) => ({
        id: payment.id,
        journalId: journalIds[index] ?? null
      }))
    });
    written += journalIds.filter(Boolean).length;
  }
  return written;
}
type ReceiptGroup = { postingDate: string; quantity: number; cost: number };

export async function buildLegacyPurchaseInvoiceJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<LegacyJournal[]> {
  const invoices = await legacyPurchaseInvoices(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (invoices.length === 0) return [];
  const invoiceIds = invoices.map((invoice) => invoice.id);

  const lines = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("purchaseInvoiceLine")
      .selectAll()
      .where("companyId", "=", companyId)
      .where("invoiceId", "in", ids)
      .orderBy("invoiceId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
  const itemIds = lines.map((line) => line.itemId);
  const purchaseOrderLineIds = lines.map((line) => line.purchaseOrderLineId);

  const deliveries = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("purchaseInvoiceDelivery")
      .select(["id", "supplierShippingCost"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const suppliers = await readByIds(
    invoices.map((invoice) => invoice.supplierId),
    (ids) =>
      trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId", "intercompanyCompanyId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const items = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const itemCosts = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "itemPostingGroupId", "costingMethod"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  const purchaseOrderLines = await readByIds(purchaseOrderLineIds, (ids) =>
    trx
      .selectFrom("purchaseOrderLine")
      .select(["id", "jobOperationId", "locationId"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const jobOperations = await readByIds(
    purchaseOrderLines.map((line) => line.jobOperationId),
    (ids) =>
      trx
        .selectFrom("jobOperation")
        .select(["id", "processId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  // Each PO line's receipts, in the order the posting's walk reads them.
  const receiptLines = await readByIds(purchaseOrderLineIds, (ids) =>
    trx
      .selectFrom("receiptLine as line")
      .innerJoin("receipt", (join) =>
        join
          .onRef("receipt.id", "=", "line.receiptId")
          .onRef("receipt.companyId", "=", "line.companyId")
      )
      .select([
        "line.receiptId",
        "line.lineId",
        "line.itemId",
        "line.receivedQuantity",
        "line.unitPrice",
        "receipt.postingDate"
      ])
      .where("line.companyId", "=", companyId)
      .where("receipt.status", "=", "Posted")
      .where("receipt.sourceDocument", "=", "Purchase Order")
      .where("line.lineId", "in", ids)
      .where("line.receivedQuantity", ">", 0)
      .orderBy("receipt.postingDate")
      .orderBy("receipt.createdAt")
      .orderBy("receipt.id")
      .execute()
  );
  const receiptLayers = await readByIds(
    receiptLines.map((line) => line.receiptId),
    (ids) =>
      trx
        .selectFrom("costLedger")
        .select([
          "documentId",
          "itemId",
          sql<number>`sum("cost")`.as("cost"),
          sql<number>`sum("quantity")`.as("quantity")
        ])
        .where("companyId", "=", companyId)
        .where("documentType", "=", "Purchase Receipt")
        .where("documentId", "in", ids)
        .where("adjustment", "=", false)
        .where("appliesToCostLedgerId", "is", null)
        .where("quantity", ">", 0)
        .groupBy(["documentId", "itemId"])
        .execute()
  );
  // Every posted invoice line on these PO lines, in posting order: what was
  // invoiced before each legacy invoice.
  const invoicedLines = await readByIds(purchaseOrderLineIds, (ids) =>
    trx
      .selectFrom("purchaseInvoiceLine as line")
      .innerJoin("purchaseInvoice as invoice", (join) =>
        join
          .onRef("invoice.id", "=", "line.invoiceId")
          .onRef("invoice.companyId", "=", "line.companyId")
      )
      .select([
        "invoice.id as invoiceId",
        "line.purchaseOrderLineId",
        "line.quantity",
        "line.conversionFactor"
      ])
      .where("line.companyId", "=", companyId)
      .where("line.purchaseOrderLineId", "in", ids)
      .where("invoice.status", "not in", [...POSTED_INVOICE_EXCLUDED_STATUSES])
      .orderBy("invoice.postingDate")
      .orderBy("invoice.createdAt")
      .orderBy("invoice.id")
      .execute()
  );
  // The invoice's write-up of receipt layers that survive the reset.
  const writeUps = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("costLedger as child")
      .innerJoin("costLedger as layer", (join) =>
        join
          .onRef("layer.id", "=", "child.appliesToCostLedgerId")
          .onRef("layer.companyId", "=", "child.companyId")
      )
      .select([
        "child.documentId",
        "child.itemId",
        sql<number>`sum("child"."cost")`.as("cost")
      ])
      .where("child.companyId", "=", companyId)
      .where("child.adjustment", "=", true)
      .where("child.documentType", "=", "Purchase Invoice")
      .where("child.documentId", "in", ids)
      .where("layer.postingDate", ">=", cutoverDate)
      .groupBy(["child.documentId", "child.itemId"])
      .execute()
  );
  // A direct stock line whose receipt was posted with the invoice wrote an
  // item ledger row under the invoice; one whose receipt was left Draft
  // (skipReceiptPost) wrote none and booked WIP.
  const receivedWithInvoice = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("itemLedger")
      .select(["documentId", "itemId"])
      .distinct()
      .where("companyId", "=", companyId)
      .where("documentType", "=", "Purchase Receipt")
      .where("documentId", "in", ids)
      .execute()
  );
  const assets = await readByIds(
    lines.map((line) => line.assetId),
    (ids) =>
      trx
        .selectFrom("fixedAsset as asset")
        .innerJoin("fixedAssetClass as class", (join) =>
          join
            .onRef("class.id", "=", "asset.fixedAssetClassId")
            .onRef("class.companyId", "=", "asset.companyId")
        )
        .select([
          "asset.id",
          "asset.locationId",
          "asset.fixedAssetClassId",
          "class.assetAccountId"
        ])
        .where("asset.companyId", "=", companyId)
        .where("asset.id", "in", ids)
        .execute()
  );
  const glAccounts = await readByIds(
    lines.map((line) => line.accountId),
    (ids) =>
      trx
        .selectFrom("account")
        .select(["id", "name", "isGroup"])
        .where("companyGroupId", "=", companyGroupId)
        .where("id", "in", ids)
        .execute()
  );

  const linesByInvoice = Map.groupBy(lines, (line) => line.invoiceId);
  const shippingByInvoice = new Map(
    deliveries.map((row) => [row.id, Number(row.supplierShippingCost ?? 0)])
  );
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const itemById = new Map(items.map((row) => [row.id, row]));
  const itemCostByItem = new Map(itemCosts.map((row) => [row.itemId, row]));
  const purchaseOrderLineById = new Map(
    purchaseOrderLines.map((row) => [row.id, row])
  );
  const processByOperation = new Map(
    jobOperations.map((row) => [row.id, row.processId])
  );
  const assetById = new Map(assets.map((row) => [row.id, row]));
  const glAccountById = new Map(glAccounts.map((row) => [row.id, row]));

  // Lease lines post as at posting (post-purchase-invoice), with its checks.
  const leaseFacts = await loadLeasePostingFacts(trx, {
    companyId,
    companyGroupId,
    defaults,
    lines: lines.filter((line) => line.invoiceLineType === "Lease")
  });
  const receivedWithInvoiceKeys = new Set(
    receivedWithInvoice.map((row) => `${row.documentId}:${row.itemId}`)
  );
  const writeUpByInvoiceItem = new Map(
    writeUps.map((row) => [`${row.documentId}:${row.itemId}`, Number(row.cost)])
  );

  // Receipt groups per PO line, one per receipt, costed from the layers.
  const layerByReceiptItem = new Map(
    receiptLayers.map((row) => [
      `${row.documentId}:${row.itemId}`,
      { cost: Number(row.cost), quantity: Number(row.quantity) }
    ])
  );
  const receiptsByLine = new Map<string, ReceiptGroup[]>();
  const groupByReceiptLine = new Map<string, ReceiptGroup>();
  for (const line of receiptLines) {
    const purchaseOrderLineId = line.lineId as string;
    const quantity = Number(line.receivedQuantity);
    const layer = layerByReceiptItem.get(`${line.receiptId}:${line.itemId}`);
    const cost =
      layer && layer.quantity > EPSILON
        ? (quantity / layer.quantity) * layer.cost
        : quantity * Number(line.unitPrice ?? 0);
    const key = `${line.receiptId}:${purchaseOrderLineId}`;
    const group = groupByReceiptLine.get(key);
    if (group) {
      group.quantity += quantity;
      group.cost += cost;
      continue;
    }
    const created = {
      postingDate: String(line.postingDate),
      quantity,
      cost
    };
    groupByReceiptLine.set(key, created);
    const list = receiptsByLine.get(purchaseOrderLineId);
    if (list) list.push(created);
    else receiptsByLine.set(purchaseOrderLineId, [created]);
  }

  // What the invoices posted before an invoice invoiced on a PO line, in
  // inventory units. A PO line's rows are in posting order.
  const invoicedRowsByLine = Map.groupBy(
    invoicedLines,
    (row) => row.purchaseOrderLineId
  );
  const invoicedBefore = (invoiceId: string, purchaseOrderLineId: string) => {
    let sum = 0;
    for (const row of invoicedRowsByLine.get(purchaseOrderLineId) ?? []) {
      if (row.invoiceId === invoiceId) break;
      sum += Number(row.quantity) * Number(row.conversionFactor ?? 1);
    }
    return sum;
  };

  return invoices.map((invoice) => {
    const supplier = invoice.supplierId
      ? supplierById.get(invoice.supplierId)
      : undefined;
    // An intercompany payable before the cutover: a stand-in when its
    // default is empty, which the enable re-points.
    const payables = supplier?.intercompanyCompanyId
      ? resolveDefaultAccount(
          defaults,
          "intercompanyPayablesAccount",
          "Provisional"
        )
      : { accountId: defaults.payablesAccount, accountDefaultRole: null };
    const invoiceLines = linesByInvoice.get(invoice.id) ?? [];
    const amountsByLine = new Map(
      calculatePurchasePostingAmounts({
        lines: invoiceLines,
        exchangeRate: invoice.exchangeRate ?? 1,
        supplierShippingCost: shippingByInvoice.get(invoice.id) ?? 0
      }).map((amounts) => [amounts.id, amounts])
    );
    const postingDate = String(invoice.postingDate);
    /** The receipts the posting saw: posted on or before the invoice. */
    const receiptsBefore = (purchaseOrderLineId: string) =>
      (receiptsByLine.get(purchaseOrderLineId) ?? []).filter(
        (group) => group.postingDate <= postingDate
      );

    const postingLines: PurchaseInvoicePostingLine[] = [];
    for (const invoiceLine of invoiceLines) {
      if (invoiceLine.invoiceLineType === "Comment") continue;
      const base = {
        id: invoiceLine.id,
        invoiceLineType: invoiceLine.invoiceLineType,
        locationId: invoiceLine.locationId ?? null,
        amounts: amountsByLine.get(invoiceLine.id)!
      };
      const purchaseOrderLineId = invoiceLine.purchaseOrderLineId;
      const purchaseOrderLine = purchaseOrderLineId
        ? purchaseOrderLineById.get(purchaseOrderLineId)
        : undefined;

      if (isItemLineType(invoiceLine.invoiceLineType)) {
        const item = invoiceLine.itemId
          ? itemById.get(invoiceLine.itemId)
          : undefined;
        const itemCost = invoiceLine.itemId
          ? itemCostByItem.get(invoiceLine.itemId)
          : undefined;
        const itemFacts: PurchaseInvoiceItem = {
          itemId: invoiceLine.itemId ?? null,
          itemTrackingType: item?.itemTrackingType ?? null,
          replenishmentSystem: item?.replenishmentSystem ?? null,
          itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
          costingMethod: itemCost?.costingMethod ?? null
        };
        const itemKey = `${invoice.id}:${invoiceLine.itemId}`;
        if (!purchaseOrderLineId) {
          postingLines.push({
            ...base,
            kind: "direct",
            item: itemFacts,
            receivedWithInvoice: receivedWithInvoiceKeys.has(itemKey)
          });
          continue;
        }
        const receipts = receiptsBefore(purchaseOrderLineId);
        postingLines.push({
          ...base,
          kind: "ordered",
          item: itemFacts,
          purchaseOrderLine: {
            purchaseOrderLineId,
            quantityReceived: receipts.reduce(
              (sum, group) => sum + group.quantity,
              0
            ),
            quantityInvoiced: invoicedBefore(invoice.id, purchaseOrderLineId),
            receiptGroups: receipts,
            isOutsideProcessing: Boolean(purchaseOrderLine?.jobOperationId),
            processId: purchaseOrderLine?.jobOperationId
              ? (processByOperation.get(purchaseOrderLine.jobOperationId) ??
                null)
              : null,
            coverage: { storedWriteUp: writeUpByInvoiceItem.get(itemKey) ?? 0 }
          }
        });
        continue;
      }

      switch (invoiceLine.invoiceLineType) {
        case "Fixed Asset": {
          if (!invoiceLine.assetId) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} has a fixed asset line with no asset selected.`
            );
          }
          const asset = assetById.get(invoiceLine.assetId);
          if (!asset) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} names fixed asset ${invoiceLine.assetId}, which no longer exists.`
            );
          }
          const receipts = purchaseOrderLineId
            ? receiptsBefore(purchaseOrderLineId)
            : [];
          postingLines.push({
            ...base,
            kind: "fixedAsset",
            purchaseOrderLineId,
            purchaseOrderLineLocationId: purchaseOrderLine?.locationId ?? null,
            assetLocationId: asset.locationId,
            fixedAssetClassId: asset.fixedAssetClassId,
            acquisition:
              receipts.length > 0
                ? {
                    receiptCost: receipts.reduce(
                      (sum, group) => sum + group.cost,
                      0
                    )
                  }
                : { assetAccountId: asset.assetAccountId }
          });
          break;
        }
        case "G/L Account": {
          const glAccount = invoiceLine.accountId
            ? glAccountById.get(invoiceLine.accountId)
            : undefined;
          if (!glAccount) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} has a G/L line on account ${invoiceLine.accountId ?? "(none)"}, which is not in the chart of accounts.`
            );
          }
          if (glAccount.isGroup) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} has a G/L line on ${glAccount.name}, a group account. Move the line to a posting account.`
            );
          }
          postingLines.push({
            ...base,
            kind: "glAccount",
            purchaseOrderLineId,
            account: glAccount,
            costCenterId: invoiceLine.costCenterId ?? null,
            projectId: invoiceLine.projectId ?? null
          });
          break;
        }
        case "Lease": {
          let lease: ReturnType<typeof resolveLeasePostingLine>;
          try {
            lease = resolveLeasePostingLine(
              invoiceLine,
              base.amounts,
              leaseFacts
            );
          } catch (error) {
            if (!(error instanceof InvalidInputError)) throw error;
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId}: ${error.message}`
            );
          }
          postingLines.push({ ...base, kind: "lease", ...lease });
          break;
        }
        default:
          throw new Error(
            `Unsupported invoice line type: ${invoiceLine.invoiceLineType}`
          );
      }
    }

    const { lines: journalLines } = buildPurchaseInvoicePostingLines({
      invoice: {
        id: invoice.id,
        supplierId: invoice.supplierId,
        supplierReference: invoice.supplierReference
      },
      supplierTypeId: supplier?.supplierTypeId ?? null,
      accounts: defaults,
      payables,
      lines: postingLines
    });
    return {
      description: `Purchase Invoice ${invoice.invoiceId}`,
      postingDate,
      sourceType: "Purchase Invoice" as const,
      lines: journalLines
    };
  });
}
type Args = {
  companyId: string;
  cutoverDate: string;
  defaults: AccountDefaults;
};

/** Shares `total` across the weights; equal weights when they sum to 0. */
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (Math.abs(sum) <= EPSILON) {
    return weights.map(() => total / Math.max(weights.length, 1));
  }
  return weights.map((weight) => (total * weight) / sum);
}

function receiptLines(trx: KyselyTx, companyId: string, receiptIds: string[]) {
  return readByIds(receiptIds, (ids) =>
    trx
      .selectFrom("receiptLine")
      .select([
        "id",
        "receiptId",
        "lineId",
        "itemId",
        "receivedQuantity",
        "unitPrice",
        "locationId"
      ])
      .where("companyId", "=", companyId)
      .where("receiptId", "in", ids)
      .orderBy("receiptId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
}

/** The cost a receipt stored per item and sign, from its own rows only. */
function storedCosts(
  trx: KyselyTx,
  {
    companyId,
    receiptIds,
    documentType,
    itemLedgerType
  }: {
    companyId: string;
    receiptIds: string[];
    documentType: Database["public"]["Enums"]["itemLedgerDocumentType"];
    itemLedgerType: Database["public"]["Enums"]["itemLedgerType"];
  }
) {
  return readByIds(receiptIds, (ids) =>
    trx
      .selectFrom("costLedger")
      .select([
        "documentId",
        "itemId",
        sql<number>`coalesce(sum("cost") filter (where "quantity" > 0), 0)`.as(
          "inbound"
        ),
        sql<number>`coalesce(sum("cost") filter (where "quantity" < 0), 0)`.as(
          "outbound"
        ),
        sql<number>`count(*) filter (where "quantity" < 0)`.as("outboundRows")
      ])
      .where("companyId", "=", companyId)
      .where("documentType", "=", documentType)
      .where("itemLedgerType", "=", itemLedgerType)
      .where("costLedgerType", "=", "Direct Cost")
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where("documentId", "in", ids)
      .groupBy(["documentId", "itemId"])
      .execute()
  ).then(
    (rows) =>
      new Map(
        rows.map((row) => [
          `${row.documentId}:${row.itemId}`,
          {
            inbound: Number(row.inbound),
            outbound: Number(row.outbound),
            hasOutbound: Number(row.outboundRows) > 0
          }
        ])
      )
  );
}

export async function buildLegacyPurchaseReceiptJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const receipts = await legacyReceipts(
    trx,
    { companyId, cutoverDate },
    "Purchase Order"
  ).execute();
  if (receipts.length === 0) return [];
  const receiptIds = receipts.map((receipt) => receipt.id);
  const purchaseOrderIds = receipts.map((receipt) => receipt.sourceDocumentId);

  const lines = await receiptLines(trx, companyId, receiptIds);
  const itemIds = lines.map((line) => line.itemId);
  const purchaseOrders = await readByIds(purchaseOrderIds, (ids) =>
    trx
      .selectFrom("purchaseOrder")
      .select([
        "id",
        "supplierId",
        "supplierReference",
        "exchangeRate",
        "purchaseOrderType"
      ])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const deliveries = await readByIds(purchaseOrderIds, (ids) =>
    trx
      .selectFrom("purchaseOrderDelivery")
      .select(["id", "supplierShippingCost"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const suppliers = await readByIds(
    purchaseOrders.map((order) => order.supplierId),
    (ids) =>
      trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const purchaseOrderLines = await readByIds(
    lines.map((line) => line.lineId),
    (ids) =>
      trx
        .selectFrom("purchaseOrderLine")
        .select(["id", "jobOperationId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const jobOperations = await readByIds(
    purchaseOrderLines.map((line) => line.jobOperationId),
    (ids) =>
      trx
        .selectFrom("jobOperation")
        .select(["id", "processId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const stored = await storedCosts(trx, {
    companyId,
    receiptIds,
    documentType: "Purchase Receipt",
    itemLedgerType: "Purchase"
  });

  const purchaseOrderById = new Map(
    purchaseOrders.map((order) => [order.id, order])
  );
  const shippingByOrder = new Map(
    deliveries.map((row) => [row.id, Number(row.supplierShippingCost ?? 0)])
  );
  const supplierTypeById = new Map(
    suppliers.map((row) => [row.id, row.supplierTypeId])
  );
  const jobOperationByLine = new Map(
    purchaseOrderLines.map((row) => [row.id, row.jobOperationId])
  );
  const processByOperation = new Map(
    jobOperations.map((row) => [row.id, row.processId])
  );
  const linesByReceipt = Map.groupBy(lines, (line) => line.receiptId);

  return receipts.map((receipt) => {
    const order = receipt.sourceDocumentId
      ? purchaseOrderById.get(receipt.sourceDocumentId)
      : undefined;
    const isOutsideProcessing =
      order?.purchaseOrderType === "Outside Processing";
    // Supplier currency to base divides by the order's rate (post-receipt).
    const shippingCost =
      (receipt.sourceDocumentId
        ? (shippingByOrder.get(receipt.sourceDocumentId) ?? 0)
        : 0) / (Number(order?.exchangeRate) || 1);
    const receiptJournalLines: PurchaseReceiptLine[] = (
      linesByReceipt.get(receipt.id) ?? []
    ).map((line) => {
      const item = line.itemId ? itemById.get(line.itemId) : undefined;
      const jobOperationId = line.lineId
        ? jobOperationByLine.get(line.lineId)
        : undefined;
      return {
        purchaseOrderLineId: line.lineId,
        itemId: line.itemId,
        quantity: postedQuantity(line.receivedQuantity),
        unitPrice: Number(line.unitPrice ?? 0),
        itemTrackingType: item?.itemTrackingType,
        replenishmentSystem: item?.replenishmentSystem,
        itemPostingGroupId: line.itemId
          ? (postingGroupByItem.get(line.itemId) ?? null)
          : null,
        locationId: line.locationId,
        processId:
          isOutsideProcessing && jobOperationId
            ? (processByOperation.get(jobOperationId) ?? null)
            : null
      };
    });
    const costs = purchaseReceiptLineCosts(receiptJournalLines, {
      shippingCost,
      isOutsideProcessing
    });
    const storedCost = storedLayerCosts(receiptJournalLines, costs, (itemId) =>
      stored.get(`${receipt.id}:${itemId}`)
    );

    return {
      description: `Purchase Receipt ${receipt.receiptId}`,
      postingDate: String(receipt.postingDate),
      sourceType: "Purchase Receipt" as const,
      lines: buildPurchaseReceiptJournalLines({
        documentId: receipt.id,
        externalDocumentId: order?.supplierReference ?? null,
        isOutsideProcessing,
        supplierId: order?.supplierId ?? null,
        supplierTypeId: order?.supplierId
          ? (supplierTypeById.get(order.supplierId) ?? null)
          : null,
        accounts: defaults,
        lines: receiptJournalLines.map((line, index) => ({
          ...line,
          cost: storedCost.get(index) ?? costs[index]!.cost
        })),
        fixedAssets: []
      })
    };
  });
}

/**
 * The cost each layer line stored, by line index, shared across the lines of
 * its item and sign by PO cost. The posting stores the cost it relieved, its
 * PO cost fallback included; an outbound group with no stored row books its
 * PO cost.
 */
function storedLayerCosts(
  lines: PurchaseReceiptLine[],
  costs: PurchaseReceiptLineCost[],
  storedFor: (
    itemId: string
  ) => { inbound: number; outbound: number; hasOutbound: boolean } | undefined
): Map<number, number> {
  const costByLine = new Map<number, number>();
  const layerGroups = Map.groupBy(
    lines.flatMap((line, index) =>
      costs[index]!.createsLayers ? [{ line, index }] : []
    ),
    ({ line }) => `${line.itemId}:${line.quantity > 0 ? "in" : "out"}`
  );
  for (const group of layerGroups.values()) {
    const { line: first } = group[0]!;
    const rows = storedFor(String(first.itemId));
    const poCosts = group.map(({ index }) => costs[index]!.poCost);
    const total =
      first.quantity > 0
        ? (rows?.inbound ?? 0)
        : rows?.hasOutbound
          ? -rows.outbound
          : poCosts.reduce((sum, cost) => sum + cost, 0);
    const shares = share(total, poCosts);
    for (const [position, { index }] of group.entries()) {
      costByLine.set(index, shares[position]!);
    }
  }
  return costByLine;
}

export async function buildLegacySalesReturnReceiptJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const receipts = await legacyReceipts(
    trx,
    { companyId, cutoverDate },
    "Sales Return Order"
  ).execute();
  if (receipts.length === 0) return [];
  const receiptIds = receipts.map((receipt) => receipt.id);

  const lines = await receiptLines(trx, companyId, receiptIds);
  const itemIds = lines.map((line) => line.itemId);
  const returnOrders = await readByIds(
    receipts.map((receipt) => receipt.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("salesReturnOrder")
        .select(["id", "customerId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const customers = await readByIds(
    returnOrders.map((order) => order.customerId),
    (ids) =>
      trx
        .selectFrom("customer")
        .select(["id", "customerTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const stored = await storedCosts(trx, {
    companyId,
    receiptIds,
    documentType: "Sales Return Receipt",
    itemLedgerType: "Sale"
  });

  const customerByOrder = new Map(
    returnOrders.map((order) => [order.id, order.customerId])
  );
  const customerTypeById = new Map(
    customers.map((row) => [row.id, row.customerTypeId])
  );
  const linesByReceipt = Map.groupBy(lines, (line) => line.receiptId);

  return receipts.map((receipt) => {
    const customerId = receipt.sourceDocumentId
      ? (customerByOrder.get(receipt.sourceDocumentId) ?? null)
      : null;
    // The lines that stored a cost row: positive, with an item that is not
    // Non-Inventory.
    const layerLines = (linesByReceipt.get(receipt.id) ?? []).filter(
      (line) =>
        line.itemId &&
        line.lineId &&
        postedQuantity(line.receivedQuantity) > 0 &&
        (itemById.get(line.itemId)?.itemTrackingType ?? "Inventory") !==
          "Non-Inventory"
    );
    const costByLine = new Map<string, number>();
    for (const group of Map.groupBy(layerLines, (line) =>
      String(line.itemId)
    ).values()) {
      const total =
        stored.get(`${receipt.id}:${group[0]!.itemId}`)?.inbound ?? 0;
      const shares = share(
        total,
        group.map((line) => postedQuantity(line.receivedQuantity))
      );
      for (const [index, line] of group.entries()) {
        costByLine.set(line.id, shares[index]!);
      }
    }

    const journalLines = buildSalesReturnReceiptJournalLines({
      documentId: receipt.id,
      externalDocumentId: receipt.externalDocumentId ?? null,
      customerId,
      customerTypeId: customerId
        ? (customerTypeById.get(customerId) ?? null)
        : null,
      accounts: defaults,
      lines: layerLines.map((line) => {
        const itemId = line.itemId as string;
        return {
          returnLineId: line.lineId as string,
          itemId,
          quantity: postedQuantity(line.receivedQuantity),
          cost: costByLine.get(line.id) ?? 0,
          replenishmentSystem: itemById.get(itemId)?.replenishmentSystem,
          itemPostingGroupId: postingGroupByItem.get(itemId) ?? null,
          locationId: line.locationId
        };
      })
    });

    return {
      description: `Sales Return Receipt ${receipt.receiptId}`,
      postingDate: String(receipt.postingDate),
      sourceType: "Sales Return Receipt" as const,
      lines: journalLines
    };
  });
}
export async function buildLegacyReimbursementJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<LegacyDocumentJournal[]> {
  const reimbursements = await legacyReimbursements(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (reimbursements.length === 0) return [];

  const lines = await readByIds(
    reimbursements.map((reimbursement) => reimbursement.id),
    (ids) =>
      trx
        .selectFrom("reimbursementLine")
        .selectAll()
        .where("companyId", "=", companyId)
        .where("reimbursementId", "in", ids)
        .orderBy("reimbursementId")
        .orderBy("sequence")
        .orderBy("id")
        .execute()
  );
  const payableAccountOf = (payableAccountId: string | null) => {
    const accountId =
      payableAccountId ??
      defaults.employeeReimbursementsPayableAccount ??
      defaults.payablesAccount;
    if (!accountId) {
      throw new InvalidInputError(
        "Set the Employee Reimbursements Payable or the Accounts Payable account in Accounting → Default Accounts."
      );
    }
    return accountId;
  };
  const accounts = await readByIds(
    [
      ...reimbursements.map((reimbursement) =>
        payableAccountOf(reimbursement.payableAccountId)
      ),
      ...lines.map((line) => line.accountId)
    ],
    (ids) =>
      trx
        .selectFrom("account")
        .select(["id", "class"])
        .where("companyGroupId", "=", companyGroupId)
        .where("id", "in", ids)
        .execute()
  );
  const accountClasses: Record<string, { class: AccountClass }> = {};
  for (const account of accounts) {
    if (isAccountClass(account.class)) {
      accountClasses[account.id] = { class: account.class };
    }
  }
  const dimensionIds = await costCenterAndProjectDimensions(
    trx,
    companyGroupId
  );
  const lineDimensions = await readByIds(
    lines.map((line) => line.id),
    (ids) =>
      trx
        .selectFrom("reimbursementLineDimension as lineDimension")
        .innerJoin("dimension", "dimension.id", "lineDimension.dimensionId")
        .select([
          "lineDimension.reimbursementLineId",
          "lineDimension.dimensionId",
          "lineDimension.valueId"
        ])
        .where("lineDimension.companyId", "=", companyId)
        .where("lineDimension.reimbursementLineId", "in", ids)
        .where("dimension.companyGroupId", "=", companyGroupId)
        .where("dimension.active", "=", true)
        .orderBy("lineDimension.dimensionId")
        .execute()
  );

  const linesByReimbursement = Map.groupBy(
    lines,
    (line) => line.reimbursementId
  );
  const dimensionsByLine = Map.groupBy(
    lineDimensions,
    (row) => row.reimbursementLineId
  );

  return reimbursements.map((reimbursement) => {
    const codingLines = linesByReimbursement.get(reimbursement.id) ?? [];
    const payableAccountId = payableAccountOf(reimbursement.payableAccountId);
    const built = buildReimbursementJournal({
      reimbursement: {
        amount: Number(reimbursement.amount),
        payableAccountId,
        currencyCode: reimbursement.currencyCode,
        exchangeRate: Number(reimbursement.exchangeRate)
      },
      lines: codingLines.map((line) => ({
        accountId: line.accountId,
        amount: Number(line.amount),
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        description: line.description
      })),
      accounts: accountClasses,
      documentId: reimbursement.id,
      documentReadableId: reimbursement.reimbursementId
    });
    // One debit per coding line in order, then the payable credit.
    if (
      built.journalLines.length !== codingLines.length + 1 ||
      codingLines.some(
        (line, index) => built.journalLines[index]?.accountId !== line.accountId
      )
    ) {
      throw new Error("Reimbursement journal lines do not match coding lines");
    }
    const journalLineReference = nanoid();
    return {
      documentId: reimbursement.id,
      payableAccountId,
      description: `Reimbursement ${reimbursement.reimbursementId}`,
      postingDate: String(
        reimbursement.postingDate ?? reimbursement.reimbursementDate
      ),
      sourceType: "Reimbursement" as const,
      lines: built.journalLines.map((line, index) => {
        const codingLine = codingLines[index];
        // The trailing payable leg is a control account and carries no
        // coding. A line's own dimension rows win over its columns.
        const byDimension = new Map<string, string>();
        if (codingLine) {
          if (dimensionIds.costCenter && line.costCenterId) {
            byDimension.set(dimensionIds.costCenter, line.costCenterId);
          }
          if (dimensionIds.project && line.projectId) {
            byDimension.set(dimensionIds.project, line.projectId);
          }
          for (const row of dimensionsByLine.get(codingLine.id) ?? []) {
            byDimension.set(row.dimensionId, row.valueId);
          }
        }
        return {
          accountId: line.accountId,
          amount: line.amount,
          quantity: 1,
          description: line.description,
          documentType: "Reimbursement" as const,
          documentId: line.documentId,
          journalLineReference,
          dimensions: {},
          dimensionValues: [...byDimension].map(([dimensionId, valueId]) => ({
            dimensionId,
            valueId
          }))
        };
      })
    };
  });
}
/** The runs and disposals the enable wrote a journal for. */
export type LegacyRunCounts = Pick<
  LegacyDocumentCounts,
  "depreciationRuns" | "assetDisposals" | "revenueRecognitionRuns"
>;

/** A journal and the rows that store its id. */
type Built<T> = { journal: LegacyJournal; attach: T };

/** A built run journal, dated, with a new reference on each line. */
function legacyJournal(
  journal: RunJournal,
  postingDate: string
): LegacyJournal {
  return {
    description: journal.description,
    postingDate,
    sourceType: journal.sourceType,
    lines: journal.lines.map((line) => ({
      ...line,
      journalLineReference: nanoid()
    }))
  };
}

/** The month end of a `YYYY-MM-DD` date. */
// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

export type DepreciationRunLineRow = DepreciationRunLine & {
  depreciationRunId: string;
  runReadableId: string;
  journalId: string | null;
  deferredTaxJournalId: string | null;
};

/**
 * The depreciation journals the legacy lines miss: one per line with a book
 * amount and no journal, and one deferred tax journal per run and month with
 * none, with today's settings. A month whose lines all have no tax amount
 * was built with tax depreciation off, so it had no deferred tax journal.
 */
export function buildLegacyDepreciationJournals(
  rows: DepreciationRunLineRow[],
  settings: DeferredTaxSettings | null
): {
  depreciation: Built<{ runId: string; lineIds: string[] }>[];
  deferredTax: Built<{ runId: string; lineIds: string[] }>[];
} {
  const runByLine = new Map(rows.map((row) => [row.id, row.depreciationRunId]));
  const depreciation = buildDepreciationJournals(
    rows.filter((row) => row.journalId === null)
  ).map((journal) => ({
    journal: legacyJournal(journal, journal.monthEnd),
    attach: { runId: runByLine.get(journal.lineId)!, lineIds: [journal.lineId] }
  }));

  const runs = Map.groupBy(
    rows.filter((row) => row.deferredTaxJournalId === null),
    (row) => row.depreciationRunId
  );
  const deferredTax = [...runs].flatMap(([runId, runLines]) => {
    const taxedMonths = new Set(
      runLines
        .filter((row) => row.taxAmount !== null)
        .map((row) => row.monthEnd)
    );
    return buildDeferredTaxJournals({
      runReadableId: runLines[0]!.runReadableId,
      lines: runLines.filter((row) => taxedMonths.has(row.monthEnd)),
      settings
    }).map((journal) => ({
      journal: legacyJournal(journal, journal.monthEnd),
      attach: { runId, lineIds: journal.lineIds }
    }));
  });
  return { depreciation, deferredTax };
}

async function loadDepreciationRunLines(
  trx: KyselyTx,
  companyId: string,
  cutoverDate: string
): Promise<DepreciationRunLineRow[]> {
  const rows = await legacyDepreciationRunLines(trx, {
    companyId,
    cutoverDate
  }).execute();
  return rows.map((row) => ({
    id: row.id,
    depreciationRunId: row.depreciationRunId,
    runReadableId: row.runReadableId,
    monthEnd: row.monthEnd,
    amount: Number(row.amount),
    taxAmount: row.taxAmount === null ? null : Number(row.taxAmount),
    journalId: row.journalId,
    deferredTaxJournalId: row.deferredTaxJournalId,
    assetReadableId: row.assetReadableId,
    locationId: row.locationId,
    fixedAssetClassId: row.fixedAssetClassId,
    depreciationExpenseAccountId: row.depreciationExpenseAccountId,
    accumulatedDepreciationAccountId: row.accumulatedDepreciationAccountId
  }));
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

/** Scrap disposals on or after the cutover with no journal. The asset's
 *  cost and accumulated depreciation did not change after its disposal. */
async function loadDisposals(
  trx: KyselyTx,
  companyId: string,
  cutoverDate: string
): Promise<(Disposal & { id: string })[]> {
  const rows = await legacyDisposals(trx, { companyId, cutoverDate }).execute();
  return rows.map((row) => ({
    ...row,
    disposalMethod: REBUILT_DISPOSAL_METHOD,
    acquisitionCost: Number(row.acquisitionCost),
    accumulatedDepreciation: Number(row.accumulatedDepreciation)
  }));
}

// ---------------------------------------------------------------------------
// Revenue recognition
// ---------------------------------------------------------------------------

export type RecognitionRow = RecognitionScheduleRow & {
  runId: string;
  runReadableId: string;
  runPeriodEnd: string;
  /** The run's type: a lease run's journals post as 'Lease Run'. */
  runType: RunType;
};

/**
 * The journals of the legacy recognition rows, one per run and month (the
 * row's `postingDate` is its month end). The run's journal is the one of its
 * own period, else its latest month's.
 */
export function buildLegacyRecognitionJournals(
  rows: RecognitionRow[],
  sources: RecognitionSources,
  classById: Map<string, AccountClass>
): Built<{
  runId: string;
  scheduleIds: string[];
  leaseScheduleLineIds: string[];
  lesseeScheduleLineIds: string[];
  isRunJournal: boolean;
}>[] {
  const unclassified = recognitionAccountWithoutClass(rows, classById);
  if (unclassified) {
    throw new InvalidInputError(
      `Account ${unclassified} on the revenue schedule has no class. Set its class in Accounting → Chart of Accounts.`
    );
  }
  return [...Map.groupBy(rows, (row) => row.runId)].flatMap(
    ([runId, runRows]) => {
      const { journals, runJournal } = buildRecognitionJournals({
        runType: runRows[0]!.runType,
        runReadableId: runRows[0]!.runReadableId,
        runPeriodEnd: runRows[0]!.runPeriodEnd,
        rows: runRows,
        sources,
        classById
      });
      return journals.map((journal) => ({
        journal: legacyJournal(journal, journal.postingDate),
        attach: {
          runId,
          scheduleIds: journal.scheduleIds,
          leaseScheduleLineIds: journal.leaseScheduleLineIds,
          lesseeScheduleLineIds: journal.lesseeScheduleLineIds,
          isRunJournal: journal === runJournal
        }
      }));
    }
  );
}

/**
 * Schedule rows a Posted run recognized on or after the cutover, with no
 * journal, the sources their journal lines reference (the invoice, else the
 * rental agreement, else the contract) and the class of their accounts.
 */
async function loadRecognitionRows(
  trx: KyselyTx,
  companyId: string,
  companyGroupId: string,
  cutoverDate: string
): Promise<{
  rows: RecognitionRow[];
  sources: RecognitionSources;
  classById: Map<string, AccountClass>;
}> {
  const scheduled = await legacyRecognitionSchedule(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (scheduled.length === 0) {
    return {
      rows: [],
      sources: {
        invoiceLines: new Map(),
        rentalLines: new Map(),
        contractLines: new Map(),
        leases: new Map(),
        leaseAssets: new Map()
      },
      classById: new Map()
    };
  }

  const invoiceLines = await readByIds(
    scheduled.map((row) => row.salesInvoiceLineId),
    (ids) =>
      trx
        .selectFrom("salesInvoiceLine as invoiceLine")
        .innerJoin("salesInvoice as invoice", (join) =>
          join
            .onRef("invoice.id", "=", "invoiceLine.invoiceId")
            .onRef("invoice.companyId", "=", "invoiceLine.companyId")
        )
        .select([
          "invoiceLine.id",
          "invoiceLine.invoiceId",
          "invoiceLine.itemId",
          "invoiceLine.locationId",
          "invoice.customerId"
        ])
        .where("invoiceLine.companyId", "=", companyId)
        .where("invoiceLine.id", "in", ids)
        .execute()
  );
  const rentalLines = await readByIds(
    scheduled
      .filter((row) => !row.salesInvoiceLineId)
      .map((row) => row.rentalAgreementLineId),
    (ids) =>
      trx
        .selectFrom("rentalAgreementLine as rentalLine")
        .innerJoin("rentalAgreement as agreement", (join) =>
          join
            .onRef("agreement.id", "=", "rentalLine.rentalAgreementId")
            .onRef("agreement.companyId", "=", "rentalLine.companyId")
        )
        .select([
          "rentalLine.id",
          "rentalLine.itemId",
          "agreement.id as rentalAgreementId",
          "agreement.customerId",
          "agreement.locationId"
        ])
        .where("rentalLine.companyId", "=", companyId)
        .where("rentalLine.id", "in", ids)
        .execute()
  );
  const contractLines = await readByIds(
    scheduled.map((row) => row.customerContractLineId),
    (ids) =>
      trx
        .selectFrom("customerContractLine as contractLine")
        .innerJoin("customerContract as contract", (join) =>
          join
            .onRef("contract.id", "=", "contractLine.customerContractId")
            .onRef("contract.companyId", "=", "contractLine.companyId")
        )
        .select([
          "contractLine.id",
          "contractLine.itemId",
          "contract.id as customerContractId",
          "contract.customerId",
          sql<
            string | null
          >`coalesce("contractLine"."projectId", "contract"."projectId")`.as(
            "projectId"
          )
        ])
        .where("contractLine.companyId", "=", companyId)
        .where("contractLine.id", "in", ids)
        .execute()
  );
  const leases = await readByIds(
    scheduled.map((row) => row.leaseId),
    (ids) =>
      trx
        .selectFrom("lease")
        .select(["id", "supplierId", "locationId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const leaseAssets = await readByIds(
    scheduled.map((row) => row.leaseScheduleLineId),
    (ids) =>
      trx
        .selectFrom("leaseScheduleLine as scheduleLine")
        .innerJoin("leaseLine as line", (join) =>
          join
            .onRef("line.id", "=", "scheduleLine.leaseLineId")
            .onRef("line.companyId", "=", "scheduleLine.companyId")
        )
        .select([
          "scheduleLine.id",
          "scheduleLine.leaseLineId",
          "line.locationId"
        ])
        .where("scheduleLine.companyId", "=", companyId)
        .where("scheduleLine.id", "in", ids)
        .execute()
  );
  const accounts = await readByIds(
    scheduled.flatMap((row) => [row.debitAccountId, row.creditAccountId]),
    (ids) =>
      trx
        .selectFrom("account")
        .select(["id", "class"])
        .where("companyGroupId", "=", companyGroupId)
        .where("id", "in", ids)
        .execute()
  );
  const classById = new Map<string, AccountClass>();
  for (const account of accounts) {
    if (isAccountClass(account.class)) classById.set(account.id, account.class);
  }

  const rows = scheduled.map(
    (row): RecognitionRow => ({
      scheduleId: row.scheduleId,
      runId: row.runId,
      runReadableId: row.runReadableId,
      runPeriodEnd: row.runPeriodEnd,
      runType: row.runType,
      // Every journal takes its own month: there is no period yet.
      postingDate: monthEndOf(row.scheduledDate),
      type: row.type,
      amount: Number(row.amount),
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId,
      salesInvoiceLineId: row.salesInvoiceLineId,
      rentalAgreementLineId: row.rentalAgreementLineId,
      customerContractLineId: row.customerContractLineId,
      rentalLeaseScheduleLineId: row.rentalLeaseScheduleLineId,
      leaseId: row.leaseId,
      leaseScheduleLineId: row.leaseScheduleLineId
    })
  );
  return {
    rows,
    sources: {
      invoiceLines: new Map(invoiceLines.map((row) => [row.id, row])),
      rentalLines: new Map(rentalLines.map((row) => [row.id, row])),
      contractLines: new Map(contractLines.map((row) => [row.id, row])),
      leases: new Map(leases.map((row) => [row.id, row])),
      leaseAssets: new Map(leaseAssets.map((row) => [row.id, row]))
    },
    classById
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A table that stores the journal a run or disposal wrote. */
type JournalTable =
  | "depreciationRunLine"
  | "fixedAssetDisposal"
  | "revenueRecognitionSchedule"
  | "revenueRecognitionRun"
  | "customerContractLedgerEntry"
  | "rentalLeaseScheduleLine"
  | "leaseScheduleLine";

/**
 * Sets each row's journal column where it is still empty, one statement per
 * chunk. `key` is the column the ids match.
 */
async function setJournalColumn(
  trx: KyselyTx,
  {
    companyId,
    table,
    column = "journalId",
    key = "id",
    rows
  }: {
    companyId: string;
    table: JournalTable;
    column?: "journalId" | "deferredTaxJournalId";
    key?: "id" | "revenueRecognitionScheduleId";
    rows: { id: string; journalId: string }[];
  }
) {
  for (const chunk of chunkArray(rows, ROWS_PER_STATEMENT)) {
    await sql`UPDATE ${sql.table(table)} AS t
      SET ${sql.ref(column)} = v."journalId"
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
        AS v("id" text, "journalId" text)
      WHERE t.${sql.ref(key)} = v."id"
        AND t."companyId" = ${companyId}
        AND t.${sql.ref(column)} IS NULL`.execute(trx);
  }
}

/**
 * Writes the journals of the legacy runs and scrap disposals dated on or
 * after the cutover, Provisional, sets the rows' journal columns, and keeps
 * the journals out of provider sync.
 */
export async function journalLegacyRuns(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<{ counts: LegacyRunCounts; journalIds: string[] }> {
  const settings = await trx
    .selectFrom("companySettings")
    .select(["assetTaxDepreciationEnabled", "assetTaxRate"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  const taxSettings = deferredTaxSettings({
    enabled: settings?.assetTaxDepreciationEnabled,
    taxRate: Number(settings?.assetTaxRate ?? 0),
    dtlAccountId: defaults.deferredTaxLiabilityAccountId,
    dtExpenseAccountId: defaults.deferredTaxExpenseAccountId
  });

  const runLines = await loadDepreciationRunLines(trx, companyId, cutoverDate);
  const { depreciation, deferredTax } = buildLegacyDepreciationJournals(
    runLines,
    taxSettings
  );
  const disposalRows = await loadDisposals(trx, companyId, cutoverDate);
  const disposals = disposalRows.map((row) => {
    const journal = buildDisposalJournal(row);
    return {
      journal: legacyJournal(journal, journal.postingDate),
      attach: { disposalId: row.id }
    };
  });
  const recognitionFacts = await loadRecognitionRows(
    trx,
    companyId,
    companyGroupId,
    cutoverDate
  );
  const recognition = buildLegacyRecognitionJournals(
    recognitionFacts.rows,
    recognitionFacts.sources,
    recognitionFacts.classById
  );

  const built = [...depreciation, ...deferredTax, ...disposals, ...recognition];
  const ids = await insertProvisionalJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    journals: built.map(({ journal }) => journal)
  });
  let offset = 0;
  const idsOf = <T>(list: T[]) => {
    const slice = ids.slice(offset, offset + list.length);
    offset += list.length;
    return list.map((item, index) => ({ item, journalId: slice[index] }));
  };
  const written = <T>(
    list: { item: T; journalId: string | null | undefined }[]
  ) =>
    list.filter(
      (entry): entry is { item: T; journalId: string } => !!entry.journalId
    );

  const depreciationIds = written(idsOf(depreciation));
  const deferredTaxIds = written(idsOf(deferredTax));
  const disposalIds = written(idsOf(disposals));
  const recognitionIds = written(idsOf(recognition));

  await setJournalColumn(trx, {
    companyId,
    table: "depreciationRunLine",
    rows: depreciationIds.flatMap(({ item, journalId }) =>
      item.attach.lineIds.map((id) => ({ id, journalId }))
    )
  });
  await setJournalColumn(trx, {
    companyId,
    table: "depreciationRunLine",
    column: "deferredTaxJournalId",
    rows: deferredTaxIds.flatMap(({ item, journalId }) =>
      item.attach.lineIds.map((id) => ({ id, journalId }))
    )
  });
  await setJournalColumn(trx, {
    companyId,
    table: "fixedAssetDisposal",
    rows: disposalIds.map(({ item, journalId }) => ({
      id: item.attach.disposalId,
      journalId
    }))
  });

  // Each schedule row, its contract ledger entry and its lease schedule line
  // record the journal of the row's own month.
  const journalBySchedule = new Map<string, string>();
  for (const { item, journalId } of recognitionIds) {
    for (const scheduleId of item.attach.scheduleIds) {
      journalBySchedule.set(scheduleId, journalId);
    }
  }
  const scheduleJournals = [...journalBySchedule].map(([id, journalId]) => ({
    id,
    journalId
  }));
  await setJournalColumn(trx, {
    companyId,
    table: "revenueRecognitionSchedule",
    rows: scheduleJournals
  });
  await setJournalColumn(trx, {
    companyId,
    table: "customerContractLedgerEntry",
    key: "revenueRecognitionScheduleId",
    rows: scheduleJournals
  });
  await setJournalColumn(trx, {
    companyId,
    table: "rentalLeaseScheduleLine",
    rows: recognitionIds.flatMap(({ item, journalId }) =>
      item.attach.leaseScheduleLineIds.map((id) => ({ id, journalId }))
    )
  });
  await setJournalColumn(trx, {
    companyId,
    table: "leaseScheduleLine",
    rows: recognitionIds.flatMap(({ item, journalId }) =>
      item.attach.lesseeScheduleLineIds.map((id) => ({ id, journalId }))
    )
  });
  // The run names the journal of its own period, else its latest month's.
  await setJournalColumn(trx, {
    companyId,
    table: "revenueRecognitionRun",
    rows: recognitionIds
      .filter(({ item }) => item.attach.isRunJournal)
      .map(({ item, journalId }) => ({ id: item.attach.runId, journalId }))
  });

  return {
    counts: {
      depreciationRuns: new Set(
        [...depreciationIds, ...deferredTaxIds].map(
          ({ item }) => item.attach.runId
        )
      ).size,
      assetDisposals: disposalIds.length,
      revenueRecognitionRuns: new Set(
        recognitionIds.map(({ item }) => item.attach.runId)
      ).size
    },
    journalIds: ids.filter((id): id is string => id !== null)
  };
}
export async function buildLegacySalesInvoiceJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<LegacyJournal[]> {
  const invoices = await legacySalesInvoices(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (invoices.length === 0) return [];
  const invoiceIds = invoices.map((invoice) => invoice.id);

  const lines = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("salesInvoiceLine")
      .selectAll()
      .where("companyId", "=", companyId)
      .where("invoiceId", "in", ids)
      .orderBy("invoiceId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
  const lineIds = lines.map((line) => line.id);
  const itemIds = lines.map((line) => line.itemId);

  const shipments = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("salesInvoiceShipment")
      .select(["id", "shippingCost"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const customers = await readByIds(
    invoices.map((invoice) => invoice.customerId),
    (ids) =>
      trx
        .selectFrom("customer")
        .select(["id", "customerTypeId", "intercompanyCompanyId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const items = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const itemCosts = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "itemPostingGroupId"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  const salesOrderLines = await readByIds(
    lines.map((line) => line.salesOrderLineId),
    (ids) =>
      trx
        .selectFrom("salesOrderLine")
        .select(["id", "locationId", "sentComplete"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const assets = await readByIds(
    lines.map((line) => line.assetId),
    (ids) =>
      trx
        .selectFrom("fixedAsset")
        .select(["id", "locationId", "fixedAssetClassId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const agreementLines = await readByIds(
    lines.map((line) => line.rentalAgreementLineId),
    (ids) =>
      trx
        .selectFrom("rentalAgreementLine")
        .select(["id", "rentalAgreementId", "itemId", "lessorClassification"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  // What the posting deferred and a run has still to recognize: each line's
  // Deferral rows dated on or after the cutover, per deferred revenue account.
  const deferrals = await readByIds(lineIds, (ids) =>
    trx
      .selectFrom("revenueRecognitionSchedule")
      .select([
        "salesInvoiceLineId",
        "debitAccountId",
        sql<number>`sum("amount")`.as("amount")
      ])
      .where("companyId", "=", companyId)
      .where("salesInvoiceLineId", "in", ids)
      .where("type", "=", "Deferral")
      .where("scheduledDate", ">=", cutoverDate)
      .groupBy(["salesInvoiceLineId", "debitAccountId"])
      .orderBy("salesInvoiceLineId")
      .orderBy("debitAccountId")
      .execute()
  );
  // The cost a direct line's shipment relieved, where the posting stored it.
  const costRows = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("costLedger")
      .select(["id", "documentId", "itemId", "quantity", "cost"])
      .where("companyId", "=", companyId)
      .where("documentType", "=", "Sales Shipment")
      .where("documentId", "in", ids)
      .where("adjustment", "=", false)
      .where("quantity", "<", 0)
      .orderBy("entryNumber")
      .execute()
  );

  // The posting's accounts, with the stand-in rule of a posting before the
  // cutover: the enable writes these journals Provisional. Plain revenue
  // needs no deferral, rental or contract default; the deferral rows name
  // their own accounts.
  const plan = planSalesInvoiceAccounts(defaults, "Provisional", {
    deferredRevenue: false,
    rental: null,
    contract: false,
    accountIds: deferrals.map((row) => row.debitAccountId)
  });
  const accountRows = await readByIds(plan.accountIds, (ids) =>
    trx
      .selectFrom("account")
      .select(["id", "class", "active", "isGroup"])
      .where("companyGroupId", "=", companyGroupId)
      .where("id", "in", ids)
      .execute()
  );
  const accounts = resolveSalesInvoiceAccounts(
    plan,
    // Read by the company group, so it is the group's.
    accountRows.map((row): SalesPostingAccount => ({ ...row, companyGroupId })),
    companyGroupId
  );

  const linesByInvoice = Map.groupBy(lines, (line) => line.invoiceId);
  const shippingByInvoice = new Map(
    shipments.map((row) => [row.id, Number(row.shippingCost ?? 0)])
  );
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const deferralsByLine = Map.groupBy(
    deferrals,
    (row) => row.salesInvoiceLineId
  );
  const costRowsByInvoice = Map.groupBy(costRows, (row) => row.documentId);
  const facts = {
    companyId,
    companyGroupId,
    items: new Map(items.map((row) => [row.id, row])),
    postingGroups: new Map(
      itemCosts.map((row) => [row.itemId, row.itemPostingGroupId])
    ),
    salesOrderLines: new Map(salesOrderLines.map((row) => [row.id, row])),
    assets: new Map(assets.map((row) => [row.id, row])),
    rentalAgreementLines: new Map(agreementLines.map((row) => [row.id, row])),
    accounts,
    contract: null,
    rental: null,
    disposal: null
  };

  // A line with deferral rows credits them, and the rest to sales; every
  // other line books plain revenue.
  const revenue = (line: SalesInvoiceLine): SalesLineRevenue => {
    const deferred = deferralsByLine.get(line.id) ?? [];
    if (deferred.length === 0) return { book: "sales" };
    return {
      book: "legs",
      legs: [
        ...deferred.map((row) => ({
          account: accounts.account(row.debitAccountId),
          accountClass: "Liability" as const,
          description: "Deferred Revenue",
          amount: Number(row.amount)
        })),
        {
          account: accounts.account(defaults.salesAccount),
          accountClass: "Revenue" as const,
          description: "Sales Account"
        }
      ]
    };
  };

  return invoices.map((invoice) => {
    const customer = invoice.customerId
      ? customerById.get(invoice.customerId)
      : undefined;
    const invoiceLines = linesByInvoice.get(invoice.id) ?? [];
    const unusedCostRows = [...(costRowsByInvoice.get(invoice.id) ?? [])];
    // The cost row of a direct line: the first unused one of its item and
    // quantity, else of its item.
    const directCost = (line: SalesInvoiceLine): number | null => {
      if (!line.itemId) return null;
      const quantity = round(Number(line.quantity));
      const sameItem = unusedCostRows.filter(
        (row) => row.itemId === line.itemId
      );
      const costRow =
        sameItem.find((row) => round(-Number(row.quantity)) === quantity) ??
        sameItem[0];
      if (!costRow) return null;
      unusedCostRows.splice(unusedCostRows.indexOf(costRow), 1);
      return -Number(costRow.cost);
    };
    const journal = buildSalesInvoiceJournal({
      ...facts,
      invoice,
      customerTypeId: customer?.customerTypeId ?? null,
      intercompanyPartnerId: customer?.intercompanyCompanyId ?? null,
      lines: invoiceLines,
      headerShipping: allocateSalesHeaderShipping(
        invoiceLines,
        shippingByInvoice.get(invoice.id) ?? 0
      ),
      revenue,
      directCost
    });

    return {
      description: `Sales Invoice ${invoice.invoiceId}`,
      postingDate: String(invoice.postingDate),
      sourceType: "Sales Invoice" as const,
      lines: journal.lines.map((line, index) => ({
        ...accounts.standIns.storedLine(line),
        dimensions: salesLineDimensions(
          journal.metadata[index]!,
          invoice.customerId
        )
      }))
    };
  });
}
export async function buildLegacySalesShipmentJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const shipments = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    LEGACY_SALES_SHIPMENT
  ).execute();
  if (shipments.length === 0) return [];
  const shipmentIds = shipments.map((shipment) => shipment.id);

  const lines = await readByIds(shipmentIds, (ids) =>
    trx
      .selectFrom("shipmentLine")
      .select(["id", "shipmentId", "itemId", "shippedQuantity", "locationId"])
      .where("companyId", "=", companyId)
      .where("shipmentId", "in", ids)
      .orderBy("shipmentId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
  const itemIds = lines.map((line) => line.itemId);
  const salesOrders = await readByIds(
    shipments.map((shipment) => shipment.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("salesOrder")
        .select(["id", "customerId", "customerReference"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const customers = await readByIds(
    salesOrders.map((order) => order.customerId),
    (ids) =>
      trx
        .selectFrom("customer")
        .select(["id", "customerTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  // The cost the shipment relieved per item, stored negative.
  const sales = await readByIds(shipmentIds, (ids) =>
    shipmentCostRows(trx, companyId, LEGACY_SALES_SHIPMENT)
      .select([
        "cost.documentId",
        "cost.itemId",
        sql<number>`sum("cost"."cost")`.as("cost")
      ])
      .where("cost.documentId", "in", ids)
      .groupBy(["cost.documentId", "cost.itemId"])
      .execute()
  );

  const orderById = new Map(salesOrders.map((order) => [order.id, order]));
  const customerTypeById = new Map(
    customers.map((row) => [row.id, row.customerTypeId])
  );
  const relievedCostByShipment = new Map(
    [...Map.groupBy(sales, (row) => row.documentId)].map(
      ([shipmentId, rows]) => [
        shipmentId,
        new Map(rows.map((row) => [String(row.itemId), -Number(row.cost)]))
      ]
    )
  );
  const linesByShipment = Map.groupBy(lines, (line) => line.shipmentId);

  return shipments.map((shipment) => {
    const order = shipment.sourceDocumentId
      ? orderById.get(shipment.sourceDocumentId)
      : undefined;
    const customerId = order?.customerId ?? null;
    const journal = buildSalesShipmentJournal({
      shipmentId: shipment.id,
      shipmentReadableId: shipment.shipmentId,
      externalDocumentId: order?.customerReference ?? null,
      customerId,
      customerTypeId: customerId
        ? (customerTypeById.get(customerId) ?? null)
        : null,
      defaults,
      lines: (linesByShipment.get(shipment.id) ?? []).map((line) => {
        const item = line.itemId ? itemById.get(line.itemId) : undefined;
        return {
          shipmentLineId: line.id,
          itemId: line.itemId,
          shippedQuantity: postedQuantity(line.shippedQuantity),
          itemTrackingType: item?.itemTrackingType ?? null,
          replenishmentSystem: item?.replenishmentSystem ?? null,
          itemPostingGroupId: line.itemId
            ? (postingGroupByItem.get(line.itemId) ?? null)
            : null,
          locationId: line.locationId ?? shipment.locationId
        };
      }),
      relievedCostByItem: relievedCostByShipment.get(shipment.id) ?? new Map(),
      // Not rebuilt: the asset register carries a fixed asset sale.
      fixedAssetSales: []
    });
    return { ...journal, postingDate: String(shipment.postingDate) };
  });
}

/** Sales and purchase return shipments, in that order. */
export async function buildLegacyReturnShipmentJournals(
  trx: KyselyTx,
  { companyId, cutoverDate, defaults }: Args
): Promise<LegacyJournal[]> {
  const salesReturns = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    LEGACY_SALES_RETURN_SHIPMENT
  ).execute();
  const purchaseReturns = await legacyShipments(
    trx,
    { companyId, cutoverDate },
    LEGACY_PURCHASE_RETURN_SHIPMENT
  ).execute();
  if (salesReturns.length === 0 && purchaseReturns.length === 0) return [];

  // The cost rows, in the order the posting wrote them.
  const costRows = (ids: string[], kind: LegacyShipmentKind) =>
    shipmentCostRows(trx, companyId, kind)
      .select(["cost.documentId", "cost.itemId", "cost.quantity", "cost.cost"])
      .where("cost.documentId", "in", ids)
      .where("cost.itemId", "is not", null)
      .$narrowType<{ documentId: string; itemId: string }>()
      .orderBy("cost.entryNumber")
      .execute();
  const rows = [
    ...(await readByIds(
      salesReturns.map((shipment) => shipment.id),
      (ids) => costRows(ids, LEGACY_SALES_RETURN_SHIPMENT)
    )),
    ...(await readByIds(
      purchaseReturns.map((shipment) => shipment.id),
      (ids) => costRows(ids, LEGACY_PURCHASE_RETURN_SHIPMENT)
    ))
  ];
  const itemIds = rows.map((row) => row.itemId);
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const salesReturnOrders = await readByIds(
    salesReturns.map((shipment) => shipment.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("salesReturnOrder")
        .select(["id", "customerId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const purchaseReturnOrders = await readByIds(
    purchaseReturns.map((shipment) => shipment.sourceDocumentId),
    (ids) =>
      trx
        .selectFrom("purchaseReturnOrder")
        .select(["id", "supplierId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const customers = await readByIds(
    salesReturnOrders.map((order) => order.customerId),
    (ids) =>
      trx
        .selectFrom("customer")
        .select(["id", "customerTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const suppliers = await readByIds(
    purchaseReturnOrders.map((order) => order.supplierId),
    (ids) =>
      trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );

  const customerByOrder = new Map(
    salesReturnOrders.map((order) => [order.id, order.customerId])
  );
  const supplierByOrder = new Map(
    purchaseReturnOrders.map((order) => [order.id, order.supplierId])
  );
  const customerTypeById = new Map(
    customers.map((row) => [row.id, row.customerTypeId])
  );
  const supplierTypeById = new Map(
    suppliers.map((row) => [row.id, row.supplierTypeId])
  );
  const rowsByShipment = Map.groupBy(rows, (row) => row.documentId);

  const build = (
    shipment: (typeof salesReturns)[number],
    sourceDocument: "Sales Return Order" | "Purchase Return Order"
  ): LegacyJournal => {
    const isSalesReturn = sourceDocument === "Sales Return Order";
    const orderParty = isSalesReturn ? customerByOrder : supplierByOrder;
    const partyTypeById = isSalesReturn ? customerTypeById : supplierTypeById;
    const partyId = shipment.sourceDocumentId
      ? (orderParty.get(shipment.sourceDocumentId) ?? null)
      : null;
    const journal = buildReturnShipmentJournal({
      sourceDocument,
      shipmentId: shipment.id,
      shipmentReadableId: shipment.shipmentId,
      locationId: shipment.locationId,
      partyId,
      partyTypeId: partyId ? (partyTypeById.get(partyId) ?? null) : null,
      defaults,
      items: (rowsByShipment.get(shipment.id) ?? []).map((row) => ({
        itemId: row.itemId,
        quantity: -Number(row.quantity),
        cost: -Number(row.cost),
        replenishmentSystem:
          itemById.get(row.itemId)?.replenishmentSystem ?? null,
        itemPostingGroupId: postingGroupByItem.get(row.itemId) ?? null
      }))
    });
    return { ...journal, postingDate: String(shipment.postingDate) };
  };

  return [
    ...salesReturns.map((shipment) => build(shipment, "Sales Return Order")),
    ...purchaseReturns.map((shipment) =>
      build(shipment, "Purchase Return Order")
    )
  ];
}
const legacyJournalsLogger = getLogger("server-functions", "legacy-journals");

type Enums = Database["public"]["Enums"];

type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

/** One line, as the document's posting writes it, and its dimension values. */
export type LegacyJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: Partial<Record<DimensionEntityType, string | null>>;
  /** Values by dimension id, as a posting that resolves its own dimensions
   *  writes them. One wins over a `dimensions` value of the same dimension. */
  dimensionValues?: { dimensionId: string; valueId: string }[];
};

export type LegacyJournal = {
  description: string;
  postingDate: string;
  sourceType: Enums["journalEntrySourceType"];
  lines: LegacyJournalLine[];
};

/** A legacy journal and the document whose `journalId` gets its id. */
export type LegacyDocumentJournal = LegacyJournal & {
  documentId: string;
  /** A reimbursement's payable account, set on a row that has none. */
  payableAccountId?: string;
};

/** Rows per statement, well inside Postgres's 65,535 bind parameters. */
export const ROWS_PER_STATEMENT = 1000;

/** Runs `read` once per chunk of the distinct ids and concatenates the rows. */
export async function readByIds<T>(
  ids: Iterable<string | null | undefined>,
  read: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const unique = [
    ...new Set([...ids].filter((id): id is string => Boolean(id)))
  ];
  const rows: T[] = [];
  for (const chunk of chunkArray(unique, ROWS_PER_STATEMENT)) {
    rows.push(...(await read(chunk)));
  }
  return rows;
}

/** A received or shipped quantity as the posting reads it: null and NaN are
 *  0. */
export function postedQuantity(value: number | null): number {
  const quantity = Number(value ?? 0);
  return Number.isNaN(quantity) ? 0 : quantity;
}

/** Items by id, with what the movement journals read. */
export async function readItems(
  trx: KyselyTx,
  companyId: string,
  itemIds: Iterable<string | null | undefined>
) {
  const rows = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("item")
      .select([
        "id",
        "itemTrackingType",
        "replenishmentSystem",
        "readableIdWithRevision"
      ])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/** Each item's posting group (the ItemPostingGroup dimension), by item id. */
export async function readPostingGroups(
  trx: KyselyTx,
  companyId: string,
  itemIds: Iterable<string | null | undefined>
) {
  const rows = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "itemPostingGroupId"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  return new Map(rows.map((row) => [row.itemId, row.itemPostingGroupId]));
}

/**
 * Refuses journals dated in a Closed or Locked period, naming the period,
 * before any is written: the journal trigger refuses a Closed period with a
 * bare error, and a Locked one fails later, when the journal gets its
 * period. The enable meets none (no period on or after the cutover can be
 * closed before it); a repair after it can.
 */
async function assertPeriodsOpen(
  trx: KyselyTx,
  companyId: string,
  postingDates: string[]
) {
  const dates = [...new Set(postingDates)].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return;
  const periods = await trx
    .selectFrom("accountingPeriod")
    .select([
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string>`"endDate"::text`.as("endDate"),
      "closeStatus",
      "closedAt"
    ])
    .where("companyId", "=", companyId)
    .where("endDate", ">=", first)
    .where("startDate", "<=", last)
    .where((eb) =>
      eb.or([
        eb("closeStatus", "in", ["Closed", "Locked"]),
        eb("closedAt", "is not", null)
      ])
    )
    .orderBy("startDate")
    .execute();
  const blocked = periods.find((period) =>
    dates.some((date) => period.startDate <= date && date <= period.endDate)
  );
  if (!blocked) return;
  const name = formatPeriodLabel(blocked.startDate);
  const locked = blocked.closeStatus === "Locked" && blocked.closedAt === null;
  legacyJournalsLogger.warn("Refused legacy journals in a closed period", {
    companyId,
    period: blocked.startDate,
    closeStatus: blocked.closeStatus
  });
  throw new InvalidInputError(
    locked
      ? `The period ${name} is locked. Unlock it, then write the missing journals.`
      : `The period ${name} is closed. Reopen it, then write the missing journals.`
  );
}

/**
 * Inserts the journals, their lines and the lines' dimensions in a few
 * statements, each kept out of provider sync (`keepOutOfProviderSync`). A journal with no lines is skipped, as a posting skips a
 * zero-value document. Refuses a journal dated in a Closed or Locked period. The journal entry numbers are allocated in order.
 * Returns the id of each journal, in the order given (null when skipped).
 */
export async function insertProvisionalJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    journals
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    journals: LegacyJournal[];
  }
): Promise<(string | null)[]> {
  const writable = journals.filter((journal) => journal.lines.length > 0);
  if (writable.length === 0) return journals.map(() => null);
  await assertPeriodsOpen(
    trx,
    companyId,
    writable.map((journal) => journal.postingDate)
  );

  const entryIds = await getNextSequences(
    trx,
    "journalEntry",
    companyId,
    writable.length
  );
  const postedAt = datetime.timestamp();
  const journalIdByEntry = new Map<string, string>();
  for (const rows of chunkArray(
    writable.map((journal, index) => ({ journal, entryId: entryIds[index]! })),
    ROWS_PER_STATEMENT
  )) {
    const inserted = await trx
      .insertInto("journal")
      .values(
        rows.map(({ journal, entryId }) => ({
          journalEntryId: entryId,
          accountingPeriodId: null,
          description: journal.description,
          postingDate: journal.postingDate,
          sourceType: journal.sourceType,
          status: "Provisional" as const,
          postedAt,
          postedBy: userId,
          companyId,
          createdBy: userId
        }))
      )
      .returning(["id", "journalEntryId"])
      .execute();
    for (const row of inserted)
      journalIdByEntry.set(row.journalEntryId, row.id);
  }

  const dimensions = await trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", companyGroupId)
    .where("active", "=", true)
    .execute();
  const dimensionIdByEntity = new Map(
    dimensions.map((dimension) => [dimension.entityType, dimension.id])
  );

  const lines = writable.flatMap((journal, index) => {
    const journalId = journalIdByEntry.get(entryIds[index]!)!;
    return journal.lines.map(
      ({ dimensions: values, dimensionValues, ...line }) => ({
        insert: { ...line, journalId, companyId, createdBy: userId },
        values,
        dimensionValues: dimensionValues ?? []
      })
    );
  });
  for (const rows of chunkArray(lines, ROWS_PER_STATEMENT)) {
    // Returned in insert order, as every posting reads them back.
    const inserted = await trx
      .insertInto("journalLine")
      .values(rows.map((row) => row.insert))
      .returning("id")
      .execute();
    const dimensionInserts = inserted.flatMap((line, index) => {
      const row = rows[index]!;
      const valueByDimension = new Map<string, string>();
      for (const [entityType, valueId] of Object.entries(row.values)) {
        const dimensionId = dimensionIdByEntity.get(
          entityType as DimensionEntityType
        );
        if (dimensionId && valueId) valueByDimension.set(dimensionId, valueId);
      }
      for (const { dimensionId, valueId } of row.dimensionValues) {
        valueByDimension.set(dimensionId, valueId);
      }
      return [...valueByDimension].map(([dimensionId, valueId]) => ({
        journalLineId: line.id,
        dimensionId,
        valueId,
        companyId
      }));
    });
    for (const dimensionRows of chunkArray(
      dimensionInserts,
      ROWS_PER_STATEMENT
    )) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionRows)
        .execute();
    }
  }
  const idByJournal = new Map(
    writable.map((journal, index) => [
      journal,
      journalIdByEntry.get(entryIds[index]!)!
    ])
  );
  await keepOutOfProviderSync(trx, {
    companyId,
    userId,
    journals: writable.map((journal) => ({
      id: idByJournal.get(journal)!,
      sourceType: journal.sourceType
    }))
  });
  return journals.map((journal) => idByJournal.get(journal) ?? null);
}

/** A document whose posting stores the journal it wrote. */
export type JournalDocumentTable =
  | "payment"
  | "memo"
  | "charge"
  | "reimbursement";

/**
 * Sets each document's `journalId` to the journal the enable wrote for it, as
 * its posting does, so a later void reverses that journal. A reimbursement
 * with no payable account also gets the one its journal credits. One
 * statement per chunk.
 */
export async function attachJournalIds(
  trx: KyselyTx,
  {
    table,
    companyId,
    userId,
    rows
  }: {
    table: JournalDocumentTable;
    companyId: string;
    userId: string;
    rows: { id: string; journalId: string | null; payableAccountId?: string }[];
  }
): Promise<void> {
  const attached = rows.filter((row) => row.journalId !== null);
  const updatedAt = datetime.timestamp();
  for (const chunk of chunkArray(attached, ROWS_PER_STATEMENT)) {
    const values = sql`jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
      AS v("id" text, "journalId" text, "payableAccountId" text)`;
    if (table === "reimbursement") {
      await sql`UPDATE "reimbursement" AS d
        SET "journalId" = v."journalId",
          "payableAccountId" = COALESCE(d."payableAccountId", v."payableAccountId"),
          "updatedAt" = ${updatedAt}, "updatedBy" = ${userId}
        FROM ${values}
        WHERE d."id" = v."id" AND d."companyId" = ${companyId}`.execute(trx);
    } else {
      await sql`UPDATE ${sql.table(table)} AS d
        SET "journalId" = v."journalId",
          "updatedAt" = ${updatedAt}, "updatedBy" = ${userId}
        FROM ${values}
        WHERE d."id" = v."id" AND d."companyId" = ${companyId}`.execute(trx);
    }
  }
}

export const CUTOVER_REBUILT_SYNC_CODE = "CUTOVER_REBUILT";

/**
 * Records an Excluded `journalEntry` sync operation for each journal and
 * each accounting integration of the company, active or not. The reconciler
 * (events and the outbound sweep) and the journal backfill skip a journal
 * that has any operation, so none of them pushes it; the period close counts
 * Excluded as settled. Re-send in Sync Activity still pushes one on purpose.
 *
 * Every journal the legacy backfill or its repair writes gets one. The reset
 * deleted a company's journals and their sync records, not the provider's
 * copies, so a journal written again of a document that had one before may
 * already be in the provider, and pushing it would post it twice there.
 * Which documents had one cannot be told reliably from the rows: a company
 * that had accounting on wrote a journal for every family, and the stored
 * cost rows say only that a posting ran, not that it journaled. So every
 * rebuilt journal is kept out, and a user sends the ones the provider lacks
 * from Sync Activity.
 */
async function keepOutOfProviderSync(
  trx: KyselyTx,
  {
    companyId,
    userId,
    journals
  }: {
    companyId: string;
    userId: string;
    journals: { id: string; sourceType: Enums["journalEntrySourceType"] }[];
  }
) {
  if (journals.length === 0) return;
  // The accounting providers, by the role the integration declares.
  const integrations = await trx
    .selectFrom("companyIntegration")
    .innerJoin("integration", "integration.id", "companyIntegration.id")
    .select("companyIntegration.id")
    .where("companyIntegration.companyId", "=", companyId)
    .where("integration.providerRole", "=", "accounting")
    .execute();
  if (integrations.length === 0) return;
  const completedAt = datetime.timestamp();
  const rows = integrations.flatMap((integration) =>
    journals.map((journal) => ({
      companyId,
      integration: integration.id,
      entityType: "journalEntry",
      entityId: journal.id,
      direction: "push-to-accounting",
      trigger: "posting",
      status: "Excluded" as const,
      idempotencyKey: `journalEntry:${journal.id}:push-to-accounting:cutover-rebuilt`,
      errorCode: CUTOVER_REBUILT_SYNC_CODE,
      errorMessage:
        "Written again when accounting was set up; the original may already be in the accounting system",
      metadata: toJson({ sourceType: journal.sourceType }),
      completedAt,
      createdBy: userId
    }))
  );
  for (const chunk of chunkArray(rows, ROWS_PER_STATEMENT)) {
    await trx.insertInto("accountingSyncOperation").values(chunk).execute();
  }
}
/**
 * The Provisional journals a step takes: those dated on or after the cutover
 * (the enable), or the ones with these ids (a repair after the enable).
 */
export type JournalScope =
  | { cutoverDate: string }
  | { journalIds: readonly string[] };

/** The ids of the Provisional journals in the scope, as a subquery. */
function scopedJournals(trx: KyselyTx, companyId: string, scope: JournalScope) {
  const provisional = trx
    .selectFrom("journal")
    .select("id")
    .where("companyId", "=", companyId)
    .where("status", "=", "Provisional");
  return "cutoverDate" in scope
    ? provisional.where("postingDate", ">=", scope.cutoverDate)
    : // One array parameter, whatever the number of ids.
      provisional.where("id", "=", sql<string>`ANY(${[...scope.journalIds]})`);
}

/**
 * Step 8. Gives every Provisional journal in the scope the period that
 * holds its date, resolving each month once.
 */
export async function assignPeriods(
  trx: KyselyTx,
  companyId: string,
  scope: JournalScope
) {
  const dates = await trx
    .selectFrom("journal")
    .select("postingDate")
    .distinct()
    .where("companyId", "=", companyId)
    .where("id", "in", scopedJournals(trx, companyId, scope))
    .execute();
  const months = new Map<string, { start: string; end: string }>();
  for (const { postingDate } of dates) {
    const date = parseDate(String(postingDate));
    const start = startOfMonth(date).toString();
    months.set(start, { start, end: endOfMonth(date).toString() });
  }
  if (months.size === 0) return;

  const periods: { start: string; end: string; periodId: string }[] = [];
  for (const month of months.values()) {
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      month.start,
      "historical"
    );
    periods.push({ ...month, periodId: period.id });
  }
  await sql`
    UPDATE "journal" AS j
    SET "accountingPeriodId" = v."periodId"
    FROM (VALUES ${sql.join(
      periods.map(
        (period) =>
          sql`(${period.start}::date, ${period.end}::date, ${period.periodId})`
      )
    )}) AS v("start", "end", "periodId")
    WHERE j."companyId" = ${companyId}
      AND j."id" IN (${scopedJournals(trx, companyId, scope)})
      AND j."postingDate" BETWEEN v."start" AND v."end"
  `.execute(trx);
}

const OPTIONAL_DEFAULTS: ReadonlySet<string> = new Set(OPTIONAL_DEFAULT_ROLES);

const isOptionalDefaultRole = (role: string): role is OptionalDefaultRole =>
  OPTIONAL_DEFAULTS.has(role);

/**
 * Step 9. A stand-in line sits on retained earnings and names the default it
 * wanted. Before promotion it moves to that default, one UPDATE per role. An
 * intercompany elimination line copies the account of the journal line it
 * mirrors (post-sales-invoice and post-purchase-invoice copy it when they
 * post), so it moves with its line.
 */
export async function repointStandInLines(
  trx: KyselyTx,
  companyId: string,
  scope: JournalScope,
  defaults: AccountDefaults
) {
  const staying = scopedJournals(trx, companyId, scope);
  const roles = await trx
    .selectFrom("journalLine")
    .select("accountDefaultRole")
    .distinct()
    .where("companyId", "=", companyId)
    .where("accountDefaultRole", "is not", null)
    .where("journalId", "in", staying)
    .execute();
  for (const { accountDefaultRole: role } of roles) {
    if (!role) continue;
    if (!isOptionalDefaultRole(role)) {
      throw new ServerFnError(
        `A journal line names ${role}, which is not an account default a stand-in line can wait for.`
      );
    }
    // A role with a fallback resolves to it, as a posting today would.
    const accountId = configuredDefaultAccount(defaults, role);
    if (!accountId) throw new MissingAccountDefaultError(role);
    const standIns = trx
      .selectFrom("journalLine")
      .select("id")
      .where("companyId", "=", companyId)
      .where("accountDefaultRole", "=", role)
      .where("journalId", "in", staying);
    await trx
      .updateTable("intercompanyEliminationLine")
      .set({ accountId })
      .where("companyId", "=", companyId)
      .where("journalLineId", "in", standIns)
      .where("accountId", "=", defaults.retainedEarningsAccount)
      .execute();
    await trx
      .updateTable("journalLine")
      .set({ accountId, accountDefaultRole: null })
      .where("companyId", "=", companyId)
      .where("accountDefaultRole", "=", role)
      .where("journalId", "in", staying)
      .execute();
  }
}

/** Step 9, continued. Promotes the Provisional journals in the scope to Posted. */
export async function promoteJournals(
  trx: KyselyTx,
  companyId: string,
  userId: string,
  scope: JournalScope
) {
  const now = datetime.timestamp();
  await trx
    .updateTable("journal")
    .set({
      status: "Posted",
      postedAt: now,
      postedBy: userId,
      updatedBy: userId,
      updatedAt: now
    })
    .where("companyId", "=", companyId)
    .where("id", "in", scopedJournals(trx, companyId, scope))
    .execute();
}
const RECOST_DESCRIPTION = "Cutover recost";

/** Sets each row's `column` to its value, one statement per chunk. */
async function setCostLedger(
  trx: KyselyTx,
  companyId: string,
  column: "remainingQuantity" | "cost",
  rows: [id: string, value: number][]
) {
  for (const chunk of chunkArray(rows, ROWS_PER_STATEMENT)) {
    await sql`
      UPDATE "costLedger" AS c
      SET ${sql.ref(column)} = v."value"
      FROM (VALUES ${sql.join(
        chunk.map(([id, value]) => sql`(${id}, ${value}::numeric)`)
      )}) AS v("id", "value")
      WHERE c."id" = v."id" AND c."companyId" = ${companyId}
    `.execute(trx);
  }
}

/**
 * Closes the cost layers dated before the cutover and opens one layer per
 * item at the reviewed unit cost. Then re-costs every outbound movement of a
 * FIFO or LIFO item dated on or after the cutover: the opening layer and
 * every layer and movement after it run again in the order they were posted
 * (`recostOutbound`), each movement relieving the layers open then as
 * `calculateCOGS` does, with its serial units and the layers' invoice
 * write-ups. Each document's difference is booked as a Provisional "Cutover
 * recost" journal between the accounts its own posting used. Standard and
 * Average items cost from `itemCost`, not layers, so their movements keep
 * their cost. A serial recost (`costLedgerType` "Revaluation") keeps its
 * cost: it relieves the layers in the run, but the account its difference
 * was booked against is not stored, so it is not re-costed.
 */
export async function resetAndRecostInventory(
  trx: KyselyTx,
  {
    companyId,
    userId,
    cutoverDate,
    companyGroupId,
    inventory,
    defaults
  }: {
    companyId: string;
    userId: string;
    cutoverDate: string;
    companyGroupId: string;
    inventory: Awaited<ReturnType<typeof getCutoverInventory>>;
    defaults: AccountDefaults;
  }
) {
  // The layers before the cutover close, their invoice write-ups with them.
  const openBefore = trx
    .selectFrom("costLedger")
    .select("id")
    .where("companyId", "=", companyId)
    .where(isCostLayer)
    .where("postingDate", "<", cutoverDate)
    .where("remainingQuantity", ">", 0);
  await trx
    .updateTable("costLedger")
    .set({ remainingQuantity: 0 })
    .where("companyId", "=", companyId)
    .where("remainingQuantity", ">", 0)
    .where((eb) =>
      eb.or([
        eb("id", "in", openBefore),
        eb("appliesToCostLedgerId", "in", openBefore)
      ])
    )
    .execute();
  const openingLayers = planInventoryReset(
    inventory.map((item) => ({ itemId: item.itemId, quantity: item.quantity })),
    new Map(inventory.map((item) => [item.itemId, item.unitCost]))
  );

  // The FIFO and LIFO items' layers and movements after the cutover, in the
  // order they were posted, and the layers' invoice write-ups.
  const layeredItems = trx
    .selectFrom("itemCost")
    .select("itemId")
    .where("companyId", "=", companyId)
    .where("costingMethod", "in", ["FIFO", "LIFO"]);
  const afterCutover = trx
    .selectFrom("costLedger")
    .where("companyId", "=", companyId)
    .where("postingDate", ">=", cutoverDate)
    .where("itemId", "in", layeredItems);
  const [layeredCosts, ledger, children, leaving] = await inOrder([
    () =>
      trx
        .selectFrom("itemCost")
        .select(["itemId", "unitCost", "costingMethod"])
        .where("companyId", "=", companyId)
        .where("costingMethod", "in", ["FIFO", "LIFO"])
        .execute(),
    () =>
      afterCutover
        .select([
          "id",
          "itemId",
          "quantity",
          "cost",
          "remainingQuantity",
          "trackedEntityId",
          "costLedgerType",
          "documentType",
          "documentId",
          "postingDate"
        ])
        .where((eb) => eb.or([isCostLayer(eb), isCostRelief(eb)]))
        .orderBy("postingDate")
        .orderBy("createdAt")
        .orderBy("entryNumber")
        .execute(),
    () =>
      trx
        .selectFrom("costLedger")
        .select([
          "id",
          "appliesToCostLedgerId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where("companyId", "=", companyId)
        .where(
          "appliesToCostLedgerId",
          "in",
          afterCutover.select("id").where(isCostLayer)
        )
        .orderBy("createdAt")
        .execute(),
    // The serial units each document's outbound rows took out.
    () =>
      trx
        .selectFrom("itemLedger")
        .select(["documentId", "itemId", "trackedEntityId"])
        .distinct()
        .where("companyId", "=", companyId)
        .where("postingDate", ">=", cutoverDate)
        .where("itemId", "in", layeredItems)
        .where("quantity", "<", 0)
        .where("trackedEntityId", "is not", null)
        .execute()
  ]);
  const methodByItem = new Map(
    layeredCosts.map((row): [string, CostingMethod] => [
      row.itemId,
      row.costingMethod === "LIFO" ? "LIFO" : "FIFO"
    ])
  );
  const childrenByLayer = Map.groupBy(
    children,
    (child) => child.appliesToCostLedgerId
  );
  const leavingByDocumentItem = Map.groupBy(
    leaving,
    (row) => `${row.documentId}:${row.itemId}`
  );

  const openingKey = (itemId: string) => `opening:${itemId}`;
  // Every layer runs again from its full quantity.
  const events: RecostEvent[] = [
    ...openingLayers
      .filter((layer) => methodByItem.has(layer.itemId))
      .map((layer) => ({
        layer: {
          id: openingKey(layer.itemId),
          itemId: layer.itemId,
          quantity: layer.quantity,
          cost: layer.cost,
          remainingQuantity: layer.quantity,
          trackedEntityId: null,
          children: []
        }
      })),
    ...ledger.map((row): RecostEvent => {
      const itemId = row.itemId!;
      return Number(row.quantity) > 0
        ? {
            layer: {
              id: row.id,
              itemId,
              quantity: Number(row.quantity),
              cost: Number(row.cost),
              remainingQuantity: Number(row.quantity),
              trackedEntityId: row.trackedEntityId,
              children: (childrenByLayer.get(row.id) ?? []).map((child) => ({
                id: child.id,
                quantity: Number(child.quantity),
                cost: Number(child.cost),
                remainingQuantity: Number(child.quantity)
              }))
            }
          }
        : {
            outbound: {
              costLedgerId: row.id,
              itemId,
              quantity: -Number(row.quantity),
              cost: -Number(row.cost),
              trackedEntityIds: row.trackedEntityId
                ? [row.trackedEntityId]
                : (
                    leavingByDocumentItem.get(`${row.documentId}:${itemId}`) ??
                    []
                  ).map((unit) => unit.trackedEntityId!)
            }
          };
    })
  ];
  // A quantity no layer covers costs at the item's unit cost, as
  // calculateCOGS costs negative inventory.
  const recost = recostOutbound(
    events,
    methodByItem,
    new Map(layeredCosts.map((row) => [row.itemId, Number(row.unitCost ?? 0)]))
  );

  // The opening layers, with what the re-cost left of them.
  if (openingLayers.length > 0) {
    const timeZone = await getCompanyTimeZone(trx, companyId);
    const createdAt = sql<string>`(${cutoverDate}::date::timestamp AT TIME ZONE ${timeZone})`;
    await trx
      .insertInto("costLedger")
      .values(
        openingLayers.map((layer) => ({
          itemLedgerType: "Purchase" as const,
          costLedgerType: "Direct Cost" as const,
          documentType: "Purchase Receipt" as const,
          adjustment: false,
          itemId: layer.itemId,
          quantity: layer.quantity,
          cost: layer.cost,
          nominalCost: layer.cost,
          remainingQuantity:
            recost.remainingById.get(openingKey(layer.itemId)) ??
            layer.quantity,
          postingDate: cutoverDate,
          // Before any layer posted on the cutover day, so later relief
          // takes the opening stock first.
          createdAt,
          companyId
        }))
      )
      .execute();
  }

  // The layers and write-ups after the cutover, where the re-cost moved them.
  const stored = new Map<string, number>([
    ...ledger.map((row) => [row.id, Number(row.remainingQuantity)] as const),
    ...children.map(
      (child) => [child.id, Number(child.remainingQuantity)] as const
    )
  ]);
  await setCostLedger(
    trx,
    companyId,
    "remainingQuantity",
    [...recost.remainingById].filter(
      ([id, remaining]) => stored.has(id) && stored.get(id) !== remaining
    )
  );

  const ledgerById = new Map(ledger.map((row) => [row.id, row]));
  const changed = recost.movements.filter(
    (movement) =>
      Math.abs(movement.delta) > EPSILON &&
      ledgerById.get(movement.costLedgerId)!.costLedgerType !== "Revaluation"
  );
  if (changed.length === 0) return;
  await setCostLedger(
    trx,
    companyId,
    "cost",
    changed.map((movement) => [movement.costLedgerId, -movement.newCost])
  );

  // One Provisional journal per document and posting date.
  await postRecostJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults,
    deltas: changed.map((movement) => {
      const row = ledgerById.get(movement.costLedgerId)!;
      return {
        itemId: row.itemId!,
        documentId: row.documentId,
        documentType: row.documentType,
        postingDate: String(row.postingDate),
        quantity: -Number(row.quantity),
        delta: movement.delta
      };
    })
  });
}

type RecostDelta = {
  itemId: string;
  documentId: string | null;
  documentType: string | null;
  postingDate: string;
  quantity: number;
  delta: number;
};

/**
 * Books each re-costed movement's difference between the two accounts its
 * document's own Provisional journal used: the item's inventory line and the
 * line paired with it by `journalLineReference`. Inventory is credited by a
 * positive delta and the paired line moves the other way, signed as the
 * original pair is; the lines copy the original's document keys, so a reader
 * of the document's chain (close-job's WIP sum, a void) sees the new cost. A
 * pair posted at zero (a movement costed at nothing) carries no sign, so the
 * offset takes the debit sign of its own account's class: every re-costed
 * movement is outbound, so its inventory line is a credit and the offset a
 * debit. Refuses rather than guess an account.
 */
async function postRecostJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults,
    deltas
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
    deltas: RecostDelta[];
  }
) {
  const label = (delta: RecostDelta) =>
    `${delta.documentType ?? "document"} ${delta.documentId ?? "(none)"}`;
  const missingDocument = deltas.find((delta) => !delta.documentId);
  if (missingDocument) {
    throw new ServerFnError(
      `The cutover re-cost changed a movement of item ${missingDocument.itemId} that names no document, so its journal cannot be adjusted.`,
      409
    );
  }
  const documentIds = [...new Set(deltas.map((delta) => delta.documentId!))];

  const [items, lines] = await inOrder([
    () =>
      readByIds(
        deltas.map((delta) => delta.itemId),
        (ids) =>
          trx
            .selectFrom("item")
            .select(["id", "replenishmentSystem"])
            .where("companyId", "=", companyId)
            .where("id", "in", ids)
            .execute()
      ),
    () =>
      readByIds(documentIds, (ids) =>
        trx
          .selectFrom("journalLine as line")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "line.journalId")
              .onRef("journal.companyId", "=", "line.companyId")
          )
          .select([
            "line.id",
            "line.journalId",
            "line.journalLineReference",
            "line.accountId",
            "line.accountDefaultRole",
            "line.amount",
            "line.quantity",
            "line.documentId",
            "line.documentType",
            "line.documentLineReference",
            "journal.postingDate",
            "journal.sourceType"
          ])
          .where("line.companyId", "=", companyId)
          .where("line.documentId", "in", ids)
          .where("journal.status", "=", "Provisional")
          .where("journal.postingDate", ">=", cutoverDate)
          .execute()
      )
  ]);
  type Line = (typeof lines)[number];
  const replenishmentByItem = new Map(
    items.map((item) => [item.id, item.replenishmentSystem])
  );
  const linesByPair = Map.groupBy(
    lines,
    (line) => `${line.journalId}:${line.journalLineReference}`
  );
  // A document's credit lines on an account, on one posting date.
  const creditsByDocument = Map.groupBy(
    lines.filter((line) => Number(line.amount) <= EPSILON),
    (line) => `${line.documentId}:${String(line.postingDate)}:${line.accountId}`
  );

  type Pair = { inventory: Line; offset: Line };
  const resolved = deltas.map((delta) => {
    const inventoryAccountId = resolveInventoryAccount(
      replenishmentByItem.get(delta.itemId) ?? null,
      defaults
    ).account;
    const pairs: Pair[] = (
      creditsByDocument.get(
        `${delta.documentId}:${delta.postingDate}:${inventoryAccountId}`
      ) ?? []
    ).flatMap((inventory) => {
      const others = (
        linesByPair.get(
          `${inventory.journalId}:${inventory.journalLineReference}`
        ) ?? []
      ).filter((line) => line.id !== inventory.id);
      return others.length === 1 ? [{ inventory, offset: others[0]! }] : [];
    });
    const offsetKey = (pair: Pair) =>
      `${pair.offset.accountId}:${pair.offset.accountDefaultRole ?? ""}`;
    let candidates = pairs;
    if (new Set(candidates.map(offsetKey)).size > 1) {
      candidates = pairs.filter((pair) =>
        equals(Number(pair.inventory.quantity), delta.quantity)
      );
    }
    if (candidates.length === 0) {
      throw new ServerFnError(
        `The cutover re-cost could not find the inventory line of ${label(delta)} and the line paired with it, so it cannot adjust that journal.`,
        409
      );
    }
    if (new Set(candidates.map(offsetKey)).size > 1) {
      throw new ServerFnError(
        `The inventory lines of ${label(delta)} pair with more than one account, so the cutover re-cost cannot tell which to adjust.`,
        409
      );
    }
    return { delta, pair: candidates[0]! };
  });

  // The class of each offset in a pair posted at zero, which signs it. A
  // stand-in line is signed for the default it stands in for, which no
  // account class records, so it keeps the refusal below.
  const zeroOffsetIds = resolved.flatMap(({ pair }) =>
    Number(pair.inventory.amount) === 0 &&
    Number(pair.offset.amount) === 0 &&
    !pair.offset.accountDefaultRole &&
    pair.offset.accountId
      ? [pair.offset.accountId]
      : []
  );
  const classByAccount = new Map(
    (
      await readByIds(zeroOffsetIds, (ids) =>
        trx
          .selectFrom("account")
          .select(["id", "class"])
          .where("companyGroupId", "=", companyGroupId)
          .where("id", "in", ids)
          .execute()
      )
    ).map((account) => [account.id, account.class])
  );
  const signRelation = (pair: Pair): number => {
    const relation =
      Math.sign(Number(pair.inventory.amount)) *
      Math.sign(Number(pair.offset.amount));
    if (relation !== 0) return relation;
    if (pair.offset.accountDefaultRole) return 0;
    const offsetClass = classByAccount.get(pair.offset.accountId ?? "");
    if (!offsetClass) return 0;
    return (
      Math.sign(credit("asset", 1)) *
      Math.sign(debit(accountTypeFromClass(offsetClass), 1))
    );
  };

  // One journal per document and posting date, numbered in one statement.
  const groups = [
    ...Map.groupBy(
      resolved,
      (entry) => `${entry.delta.documentId}:${entry.delta.postingDate}`
    ).values()
  ];
  const entryIds = await getNextSequences(
    trx,
    "journalEntry",
    companyId,
    groups.length
  );
  const postedAt = datetime.timestamp();
  const journals = await trx
    .insertInto("journal")
    .values(
      groups.map((entries, index) => ({
        journalEntryId: entryIds[index]!,
        description: RECOST_DESCRIPTION,
        postingDate: entries[0]!.delta.postingDate,
        sourceType: entries[0]!.pair.inventory.sourceType,
        status: "Provisional" as const,
        accountingPeriodId: null,
        postedAt,
        postedBy: userId,
        companyId,
        createdBy: userId
      }))
    )
    .returning(["id", "journalEntryId"])
    .execute();
  const journalIdByEntry = new Map(
    journals.map((journal) => [journal.journalEntryId, journal.id])
  );

  const lineInserts: JournalLineInsert[] = groups.flatMap((entries, index) => {
    const journalId = journalIdByEntry.get(entryIds[index]!)!;
    return entries.flatMap(({ delta, pair }) => {
      // The offset mirrors the original pair's sign relation rather than
      // re-deriving it from the offset's account class: a stand-in line sits
      // on retained earnings but is signed for the account it stands in for.
      const relation = signRelation(pair);
      if (relation === 0) {
        throw new ServerFnError(
          `The inventory line of ${label(delta)} or the line paired with it has no amount, so the cutover re-cost cannot sign its adjustment.`,
          409
        );
      }
      const inventoryAmount = round(credit("asset", delta.delta));
      const journalLineReference = nanoid();
      const keys = (line: Line) => ({
        documentType: line.documentType,
        documentId: line.documentId,
        documentLineReference: line.documentLineReference
      });
      return [
        {
          journalId,
          accountId: pair.inventory.accountId,
          description: RECOST_DESCRIPTION,
          amount: inventoryAmount,
          quantity: 0,
          ...keys(pair.inventory),
          journalLineReference,
          companyId,
          createdBy: userId
        },
        {
          journalId,
          accountId: pair.offset.accountId,
          accountDefaultRole: pair.offset.accountDefaultRole,
          description: RECOST_DESCRIPTION,
          amount: round(inventoryAmount * relation),
          quantity: 0,
          ...keys(pair.offset),
          journalLineReference,
          companyId,
          createdBy: userId
        }
      ];
    });
  });
  for (const rows of chunkArray(lineInserts, ROWS_PER_STATEMENT)) {
    await trx.insertInto("journalLine").values(rows).execute();
  }
}
const activateAccountingLogger = getLogger(
  "server-functions",
  "activate-accounting"
);

export const activateAccountingInput = z.object({
  cutoverDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date"),
  confirmation: z.string()
});

export type ActivateAccountingResult = {
  cutoverDate: string;
  /** Null when nothing was open and the trial balance was empty. */
  openingJournalId: string | null;
  /** Legacy documents dated on or after the cutover that got their journal. */
  legacyJournals: LegacyJournalCounts;
};

const OPENING_JOURNAL_DESCRIPTION = "Opening Balance";

export const activateAccountingPermission = {
  update: "accounting"
} satisfies PermissionRule<z.output<typeof activateAccountingInput>>;

export async function activateAccounting(
  ctx: ServiceContext,
  raw: z.input<typeof activateAccountingInput>
) {
  const { cutoverDate, confirmation } = activateAccountingInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  return db
    .transaction()
    .execute(async (trx): Promise<ActivateAccountingResult> => {
      const refuse = (reason: string): never => {
        activateAccountingLogger.warn("Refused the accounting enable", {
          companyId,
          cutoverDate,
          reason
        });
        throw new InvalidInputError(reason);
      };
      const now = datetime.timestamp();

      // Spec section 5, step 1. Lock the cutover stamp. Every posting reads
      // it FOR SHARE.
      const settings = await trx
        .selectFrom("companySettings")
        .select("accountingCutoverDate")
        .where("id", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!settings) throw new NotFoundError("Company settings not found");
      if (settings.accountingCutoverDate) refuse(ACCOUNTING_ALREADY_SET_UP);

      // Step 1, continued. The typed company name.
      const company = await trx
        .selectFrom("company")
        .select(["name", "companyGroupId"])
        .where("id", "=", companyId)
        .executeTakeFirst();
      if (!company?.companyGroupId) {
        throw new NotFoundError("Company not found");
      }
      const companyGroupId = company.companyGroupId;
      if (confirmation.trim() !== company.name.trim()) {
        refuse("Type the company name to confirm.");
      }

      // Step 1, continued. Every readiness check and Migration Clearing,
      // under the lock.
      // These read the Provisional ledger, so they run before any write.
      const args = { companyId, cutoverDate };
      const readiness = await getActivationReadiness(trx, args);
      const failed = readiness.checks.find((check) => !check.passed);
      if (failed) refuse(failed.detail ?? failed.label);
      const clearing = await getMigrationClearing(trx, args);
      if (!isMigrationClearingZero(clearing.total)) {
        refuse(
          `Migration Clearing totals ${clearing.total}. It must be zero to set up accounting.`
        );
      }
      const migrationClearing =
        clearing.migrationClearingAccount ??
        refuse(missingDefaultMessage("migrationClearingAccount"));
      const defaults = await trx
        .selectFrom("accountDefault")
        .selectAll()
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();

      // Step 1a. The journals of legacy documents dated on or
      // after the cutover, Provisional, so the steps below treat them like
      // every other Provisional journal.
      const legacy = await journalLegacyDocuments(trx, {
        companyId,
        companyGroupId,
        userId,
        cutoverDate,
        defaults
      });

      // Steps 2 and 3. Inventory as of the cutover, and the movements after
      // it.
      await resetAndRecostInventory(trx, {
        companyId,
        userId,
        cutoverDate,
        companyGroupId,
        inventory: await getCutoverInventory(trx, args),
        defaults
      });

      // Step 4. Journals before the cutover leave the ledger for good.
      await trx
        .updateTable("journal")
        .set({ status: "Superseded", updatedBy: userId, updatedAt: now })
        .where("companyId", "=", companyId)
        .where("status", "=", "Provisional")
        .where("postingDate", "<", cutoverDate)
        .execute();

      // Step 5. Recognition and lease interest due before the cutover is in
      // the opening balance; no run posts it. Step 6 (fixed assets) writes
      // nothing: the register already holds the values at the cutover.
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({
          status: "Posted",
          journalId: null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("companyId", "=", companyId)
        .where("status", "=", "Planned")
        .where("scheduledDate", "<", cutoverDate)
        .execute();

      // Step 7. The opening journal, the day before the cutover. It replaces
      // the Draft trial balance the wizard kept.
      const openingDate = dayBeforeCutover(cutoverDate);

      // The invoices ignored on Migration Clearing were settled in the
      // system that kept the books before the cutover. They are not in the
      // opening journal, so they close as Paid on the day before it, as the
      // Xero and QuickBooks pulls close them; every receivables and payables
      // reader treats that as settled. A sync write: no workflow, webhook or
      // provider push fires for it.
      await markIgnoredInvoicesPaid(trx, {
        companyId,
        items: clearing.ignoredItems,
        datePaid: openingDate,
        userId,
        now
      });

      const draftTrialBalances = trx
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .where("sourceType", "=", "Opening Balance");
      await trx
        .deleteFrom("journalLine")
        .where("companyId", "=", companyId)
        .where("journalId", "in", draftTrialBalances)
        .execute();
      await trx
        .deleteFrom("journal")
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .where("sourceType", "=", "Opening Balance")
        .execute();

      const openingLines = buildOpeningJournalLines(
        clearing.items,
        clearing.trialBalance,
        clearing.controlAccountIds,
        migrationClearing
      );
      // A company with nothing open and no trial balance opens with no
      // journal at all, rather than an empty one.
      let openingJournalId: string | null = null;
      if (openingLines.length > 0) {
        const openingPeriod = await resolveAccountingPeriod(
          trx,
          companyId,
          openingDate,
          "historical"
        );
        const openingJournal = await trx
          .insertInto("journal")
          .values({
            journalEntryId: await getNextSequenceInTransaction(
              trx,
              "journalEntry",
              companyId
            ),
            accountingPeriodId: openingPeriod.id,
            description: OPENING_JOURNAL_DESCRIPTION,
            postingDate: openingDate,
            sourceType: "Opening Balance",
            status: "Posted",
            postedAt: now,
            postedBy: userId,
            companyId,
            createdBy: userId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        openingJournalId = openingJournal.id;
        for (const rows of chunkArray(openingLines, ROWS_PER_STATEMENT)) {
          await trx
            .insertInto("journalLine")
            .values(
              rows.map((line) => ({
                journalId: openingJournal.id,
                accountId: line.accountId,
                amount: line.amount,
                description: line.description,
                documentType: line.documentType,
                documentId: line.documentId,
                documentLineReference: line.documentLineReference,
                quantity: line.quantity ?? 0,
                accrual: line.accrual ?? false,
                journalLineReference: nanoid(),
                companyId,
                createdBy: userId
              }))
            )
            .execute();
        }
      }

      // Step 8. Periods for the journals that stay. A Superseded journal keeps
      // none.
      const staying = { cutoverDate };
      await assignPeriods(trx, companyId, staying);

      // Step 9. Stand-in lines written while a default was empty.
      await repointStandInLines(trx, companyId, staying, defaults);

      // Step 9, continued. Promote.
      await promoteJournals(trx, companyId, userId, staying);

      // Step 10. Close every period before the cutover, oldest first. Not
      // closeAccountingPeriod: it opens its own transaction.
      const periodsToClose = await trx
        .selectFrom("accountingPeriod")
        .select("id")
        .where("companyId", "=", companyId)
        .where("endDate", "<", cutoverDate)
        .where("closeStatus", "!=", "Closed")
        .orderBy("startDate")
        .execute();
      if (periodsToClose.length > 0) {
        await trx
          .updateTable("accountingPeriod")
          .set({
            closeStatus: "Closed",
            closedAt: now,
            closedBy: userId,
            updatedBy: userId,
            updatedAt: now
          })
          .where("companyId", "=", companyId)
          .where(
            "id",
            "in",
            periodsToClose.map((period) => period.id)
          )
          .execute();
        // The snapshot takes one period; the periods are few (at most
        // three before the current one, plus the opening journal's).
        for (const period of periodsToClose) {
          await sql`SELECT "snapshotAccountingPeriodBalances"(${companyId}, ${period.id}, ${userId})`.execute(
            trx
          );
        }
      }

      // Step 10a. Make the period that holds today Active, as the first
      // posting would. The cutover is never after today, so step 10 never
      // closes it.
      await ensureCurrentAccountingPeriod(companyId, trx);

      // Step 11. The stamp. One-way: a trigger refuses any later change.
      await trx
        .updateTable("companySettings")
        .set({
          accountingCutoverDate: cutoverDate,
          accountingActivatedAt: now,
          accountingActivatedBy: userId
        })
        .where("id", "=", companyId)
        .execute();

      activateAccountingLogger.info("Set up accounting", {
        companyId,
        cutoverDate,
        openingJournalId,
        legacyJournals: legacy.counts
      });
      return { cutoverDate, openingJournalId, legacyJournals: legacy.counts };
    });
}

/** Marks the ignored invoices Paid, with the sync flag on. */
async function markIgnoredInvoicesPaid(
  trx: KyselyTx,
  {
    companyId,
    items,
    datePaid,
    userId,
    now
  }: {
    companyId: string;
    items: OpenItem[];
    datePaid: string;
    userId: string;
    now: string;
  }
) {
  const idsOf = (openItemType: OpenItem["openItemType"]) =>
    items.flatMap((item) =>
      item.openItemType === openItemType && item.documentId
        ? [item.documentId]
        : []
    );
  const salesInvoiceIds = idsOf("Receivable");
  const purchaseInvoiceIds = idsOf("Payable");
  if (salesInvoiceIds.length === 0 && purchaseInvoiceIds.length === 0) return;

  const { rows } = await sql<{ previous: string | null }>`
    SELECT current_setting('app.sync_in_progress', true) AS previous
  `.execute(trx);
  const previous = rows[0]?.previous ?? "";
  await sql`SELECT set_config('app.sync_in_progress', 'true', true)`.execute(
    trx
  );
  const set = {
    status: "Paid" as const,
    datePaid,
    updatedBy: userId,
    updatedAt: now
  };
  for (const ids of chunkArray(salesInvoiceIds, ROWS_PER_STATEMENT)) {
    await trx
      .updateTable("salesInvoice")
      .set(set)
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute();
  }
  for (const ids of chunkArray(purchaseInvoiceIds, ROWS_PER_STATEMENT)) {
    await trx
      .updateTable("purchaseInvoice")
      .set(set)
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute();
  }
  await sql`SELECT set_config('app.sync_in_progress', ${previous}, true)`.execute(
    trx
  );
}

const journalLegacyDocumentsLogger = getLogger(
  "server-functions",
  "journal-legacy-documents"
);

export const journalLegacyDocumentsInput = z.object({});

export type JournalLegacyDocumentsResult = {
  /** The legacy documents that got their journal, per family. */
  legacyJournals: LegacyJournalCounts;
};

export const journalLegacyDocumentsPermission = {
  update: "accounting"
} satisfies PermissionRule<z.output<typeof journalLegacyDocumentsInput>>;

export async function repairLegacyJournals(
  ctx: ServiceContext,
  raw: z.input<typeof journalLegacyDocumentsInput>
) {
  journalLegacyDocumentsInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  return db
    .transaction()
    .execute(async (trx): Promise<JournalLegacyDocumentsResult> => {
      // Every posting reads this row FOR SHARE, so no posting writes a
      // journal while this runs.
      const settings = await trx
        .selectFrom("companySettings")
        .innerJoin("company", "company.id", "companySettings.id")
        .select([
          sql<string | null>`"accountingCutoverDate"::text`.as("cutover"),
          "company.companyGroupId"
        ])
        .where("companySettings.id", "=", companyId)
        .forUpdate("companySettings")
        .executeTakeFirst();
      if (!settings?.companyGroupId) {
        journalLegacyDocumentsLogger.warn("Company not found", { companyId });
        throw new NotFoundError("Company not found");
      }
      const cutoverDate = settings.cutover;
      if (!cutoverDate) {
        journalLegacyDocumentsLogger.warn("Refused: accounting is not set up", {
          companyId
        });
        throw new InvalidInputError(ACCOUNTING_NOT_STARTED);
      }
      const defaults = await trx
        .selectFrom("accountDefault")
        .selectAll()
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();

      const legacy = await journalLegacyDocuments(trx, {
        companyId,
        companyGroupId: settings.companyGroupId,
        userId,
        cutoverDate,
        defaults
      });
      if (legacy.journalIds.length > 0) {
        const scope = { journalIds: legacy.journalIds };
        await assignPeriods(trx, companyId, scope);
        await repointStandInLines(trx, companyId, scope, defaults);
        await promoteJournals(trx, companyId, userId, scope);
        // The period that holds today Active, as the enable leaves it.
        await ensureCurrentAccountingPeriod(companyId, trx);
      }

      journalLegacyDocumentsLogger.info(
        "Wrote the journals of legacy documents",
        {
          companyId,
          journals: legacy.journalIds.length,
          legacyJournals: legacy.counts
        }
      );
      return { legacyJournals: legacy.counts };
    });
}
export type RunProposalContext = {
  companyId: string;
  /** `YYYY-MM-DD`, the last day of the period being recognized. */
  periodEnd: string;
  userId: string;
};

/**
 * A synthesizer inserts the schedule rows that only exist once the period is
 * known — operating-rental accruals are the first. It runs inside the proposal
 * transaction before the due rows are selected, and must be idempotent:
 * proposing the same period twice must not duplicate rows.
 */
export type RunRowSynthesizer = (
  trx: KyselyTx,
  ctx: RunProposalContext
) => Promise<void>;

/**
 * Accrues earned-but-unbilled operating rent for the calendar month ending
 * `periodEnd` (Dr contract asset / Cr rental income), so the month's rental
 * revenue is right whenever the invoice for it posts. Spec §3, Decision 7.
 *
 * What is accrued: every non-adjustment billing period of a Rental-treated line
 * (`On Rent` or `Returned`) that no POSTED invoice covers yet — status
 * `Pending`, or `Invoiced` onto a Draft/Pending invoice. A drafted-but-unposted
 * invoice has written nothing to the ledger: the daily job drafts an Arrears
 * period on its last day, before the month-end run, so "Pending only" would
 * accrue nothing for exactly the Arrears case the accrual exists for. Advance
 * and Arrears are treated alike — an Advance period whose invoice has not
 * posted by month end has earned the same unbilled rent. Invoice posting
 * (post-sales-invoice) credits the contract asset for the accruals of the
 * period it bills, so an accrual is never recognized twice.
 *
 * How much: the part of the billing period's `amount` earned inside the
 * month, by days, with the window clipped to the line's custody
 * `[deliveredAt, returnedAt]` — no rent is earned before the unit is
 * delivered, and after a return the period was re-cut anyway. Each slice is
 * the difference of two cumulative roundings from the period's first day, so
 * a period's slices across months sum to its amount exactly.
 *
 * Row shape: `periodStart`/`periodEnd` are the accrued slice itself (never the
 * whole billing period or the whole month), so a slice lies inside exactly one
 * billing period — which is how invoice posting finds "the accruals of the
 * period it bills" by overlap — and two months of one billing period never
 * share a key. `scheduledDate` is the run's period end, so the proposal that
 * synthesized a row claims it. Any existing Accrual row of the line that
 * overlaps a slice (Planned or Posted) suppresses it, so proposing the same
 * month twice — or after a delete — inserts nothing new.
 *
 * Amounts are in the agreement currency, which activation holds to the base
 * currency in Phase C (post-rental-agreement).
 */
/** The company's proposal lock, taken by `synthesizeRentalAccruals`. A
 *  transaction-scoped advisory lock, so taking it again is a no-op. */
export async function lockRecognitionProposals(
  trx: KyselyTx,
  companyId: string
): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`revenue-recognition-accrual:${companyId}`}))`.execute(
    trx
  );
}

export async function synthesizeRentalAccruals(
  trx: KyselyTx,
  ctx: RunProposalContext
): Promise<void> {
  const { companyId, periodEnd, userId } = ctx;
  const { year, month } = parseIsoDate(periodEnd);
  const monthStart = formatIsoDate(year, month, 1);

  // Serialize concurrent proposals for one company (the monthly job and a
  // human "New run"): the existence check below is read-then-insert.
  await lockRecognitionProposals(trx, companyId);

  const periods = await trx
    .selectFrom("rentalBillingPeriod as p")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.rentalAgreementLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .leftJoin("salesInvoiceLine as sil", (join) =>
      join
        .onRef("sil.id", "=", "p.salesInvoiceLineId")
        .onRef("sil.companyId", "=", "p.companyId")
    )
    .leftJoin("salesInvoice as si", (join) =>
      join
        .onRef("si.id", "=", "sil.invoiceId")
        .onRef("si.companyId", "=", "sil.companyId")
    )
    .select([
      "p.rentalAgreementLineId",
      // DATE decodes to a JS Date through pg; compare and store the text form.
      sql<string>`p."periodStart"::text`.as("periodStart"),
      sql<string>`p."periodEnd"::text`.as("periodEnd"),
      "p.days",
      "p.amount",
      sql<string>`l."deliveredAt"::text`.as("deliveredAt"),
      sql<string | null>`l."returnedAt"::text`.as("returnedAt")
    ])
    .where("p.companyId", "=", companyId)
    .where("p.isAdjustment", "=", false)
    .where("p.periodStart", "<=", periodEnd)
    .where("p.periodEnd", ">=", monthStart)
    .where((eb) =>
      eb.or([
        eb("p.status", "=", "Pending"),
        eb("si.status", "in", ["Draft", "Pending"])
      ])
    )
    .where("l.lessorClassification", "=", "Rental")
    .where("l.status", "in", ["On Rent", "Returned"])
    .where("l.deliveredAt", "is not", null)
    .where("l.deliveredAt", "<=", periodEnd)
    .where((eb) =>
      eb.or([
        eb("l.returnedAt", "is", null),
        eb("l.returnedAt", ">=", monthStart)
      ])
    )
    .orderBy("p.rentalAgreementLineId")
    .orderBy("p.periodStart")
    .execute();
  if (periods.length === 0) return;

  // Every Accrual row touching the month, whatever its status: a slice that
  // overlaps one was already accrued.
  const existing = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select([
      "rentalAgreementLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd")
    ])
    .where("companyId", "=", companyId)
    .where("type", "=", "Accrual")
    .where("rentalAgreementLineId", "is not", null)
    .where("periodStart", "<=", periodEnd)
    .where("periodEnd", ">=", monthStart)
    .execute();
  const accruedByLine = new Map<string, { start: string; end: string }[]>();
  for (const row of existing) {
    const lineId = row.rentalAgreementLineId!;
    const spans = accruedByLine.get(lineId) ?? [];
    spans.push({ start: row.periodStart, end: row.periodEnd });
    accruedByLine.set(lineId, spans);
  }

  const maxDate = (...dates: string[]) =>
    dates.reduce((a, b) => (a > b ? a : b));
  const minDate = (...dates: string[]) =>
    dates.reduce((a, b) => (a < b ? a : b));

  const slices: {
    rentalAgreementLineId: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
  }[] = [];
  for (const period of periods) {
    const start = maxDate(period.periodStart, monthStart, period.deliveredAt);
    const end = period.returnedAt
      ? minDate(period.periodEnd, periodEnd, period.returnedAt)
      : minDate(period.periodEnd, periodEnd);
    if (start > end) continue;

    const alreadyAccrued = (
      accruedByLine.get(period.rentalAgreementLineId) ?? []
    ).some((span) => span.start <= end && span.end >= start);
    if (alreadyAccrued) continue;

    // Cumulative rounding from the period's first day: slice = earned through
    // `end` minus earned before `start`, so every slice of one period sums to
    // its amount exactly across months.
    const amount = Number(period.amount);
    const days = Number(period.days);
    const earnedThrough = (dayCount: number) =>
      round((amount * dayCount) / days);
    const daysBeforeStart = daysBetweenInclusive(period.periodStart, start) - 1;
    const daysThroughEnd = daysBetweenInclusive(period.periodStart, end);
    const accrual = round(
      earnedThrough(daysThroughEnd) - earnedThrough(daysBeforeStart)
    );
    if (accrual === 0) continue;

    slices.push({
      rentalAgreementLineId: period.rentalAgreementLineId,
      periodStart: start,
      periodEnd: end,
      amount: accrual
    });
  }
  if (slices.length === 0) return;

  const defaults = await trx
    .selectFrom("accountDefault")
    .select(["contractAssetAccount", "rentalIncomeAccount"])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults?.contractAssetAccount || !defaults.rentalIncomeAccount) {
    throw new Error(
      "Set the Contract Assets and Rental Income account defaults before recognizing rental revenue"
    );
  }

  await trx
    .insertInto("revenueRecognitionSchedule")
    .values(
      slices.map((slice) => ({
        companyId,
        type: "Accrual" as const,
        status: "Planned" as const,
        rentalAgreementLineId: slice.rentalAgreementLineId,
        periodStart: slice.periodStart,
        periodEnd: slice.periodEnd,
        scheduledDate: periodEnd,
        amount: slice.amount,
        debitAccountId: defaults.contractAssetAccount!,
        creditAccountId: defaults.rentalIncomeAccount!,
        createdBy: userId
      }))
    )
    .execute();
}

/**
 * Recognizes contract revenue (plan D5): every Planned `customerContractRevenue`
 * month starting on or before `periodEnd`, of a confirmed contract (Active, or
 * Ended with months still to recognize — a cancellation's catch-up rows), that
 * no schedule row has synthesized yet. Each month is a movement of −amount on
 * its line's position against revenue, at the period end's rate: the part the
 * deferred pool covers becomes a Deferral row (Dr Deferred Revenue / Cr Sales),
 * the rest an Accrual row (Dr Contract Assets / Cr Sales). A negative month (a
 * catch-up) raises the position instead, so its rows come out negative and post
 * with their sides swapped. One Recognition ledger entry per schedule row, so a
 * row deleted with its entry (the FK cascades) leaves the position consistent.
 *
 * Idempotent: a month with a schedule row is skipped. The plan row is marked
 * Recognized when its run posts, not here. A Planned contract schedule row
 * whose plan month has since been replaced (an amendment reconciles Planned
 * months by delete + insert, which nulls the row's `customerContractRevenueId`)
 * is dropped first, with its ledger entry, so the replacement is recognized
 * once.
 */
export async function synthesizeContractRevenue(
  trx: KyselyTx,
  ctx: RunProposalContext
): Promise<void> {
  const { companyId, periodEnd, userId } = ctx;

  // The position lock, shared with invoice posting and credit memos: the
  // movements below are computed from the positions as read.
  await lockContractPositions(trx, companyId);

  const orphans = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select("id")
    .where("companyId", "=", companyId)
    .where("status", "=", "Planned")
    .where("customerContractLineId", "is not", null)
    .where("customerContractRevenueId", "is", null)
    .execute();
  if (orphans.length > 0) {
    const orphanIds = orphans.map((row) => row.id);
    await syncDraftRecognitionRuns(trx, {
      companyId,
      userId,
      deletedScheduleIds: orphanIds
    });
    await trx
      .deleteFrom("revenueRecognitionSchedule")
      .where("companyId", "=", companyId)
      .where("id", "in", orphanIds)
      .execute();
  }

  const due = await trx
    .selectFrom("customerContractRevenue as r")
    .innerJoin("customerContract as c", (join) =>
      join
        .onRef("c.id", "=", "r.customerContractId")
        .onRef("c.companyId", "=", "r.companyId")
    )
    .innerJoin("company as co", "co.id", "r.companyId")
    .select([
      "r.id",
      "r.customerContractId",
      "r.customerContractLineId",
      sql<string>`r."periodStart"::text`.as("periodStart"),
      sql<string>`r."periodEnd"::text`.as("periodEnd"),
      "r.amount",
      // Base currency → 1; raises when the currency has no rate.
      sql<number>`get_exchange_rate(r."companyId", COALESCE(c."currencyCode", co."baseCurrencyCode"), ${periodEnd}::date)`.as(
        "rate"
      )
    ])
    .where("r.companyId", "=", companyId)
    .where("r.status", "=", "Planned")
    .where("r.periodStart", "<=", periodEnd)
    .where("r.amount", "<>", 0)
    .where("c.status", "<>", "Draft")
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("revenueRecognitionSchedule as s")
            .select("s.id")
            .whereRef("s.customerContractRevenueId", "=", "r.id")
            .where("s.companyId", "=", companyId)
        )
      )
    )
    .orderBy("r.customerContractLineId")
    .orderBy("r.periodStart")
    .orderBy("r.id")
    .execute();
  if (due.length === 0) return;

  const defaults = await trx
    .selectFrom("accountDefault")
    .select(["deferredRevenueAccount", "contractAssetAccount", "salesAccount"])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (
    !defaults?.deferredRevenueAccount ||
    !defaults.contractAssetAccount ||
    !defaults.salesAccount
  ) {
    throw new Error(
      "Set the Deferred Revenue, Contract Assets and Sales account defaults before recognizing contract revenue"
    );
  }

  const positions = await loadContractPositions(
    trx,
    companyId,
    due.map((row) => row.customerContractLineId)
  );

  type Planned = {
    schedule: {
      companyId: string;
      type: "Deferral" | "Accrual";
      status: "Planned";
      customerContractLineId: string;
      customerContractRevenueId: string;
      periodStart: string;
      periodEnd: string;
      scheduledDate: string;
      amount: number;
      contractAmount: number;
      debitAccountId: string;
      creditAccountId: string;
      createdBy: string;
    };
    entry: {
      customerContractId: string;
      customerContractLineId: string;
      customerContractRevenueId: string;
      postingDate: string;
      deferredAmount: number;
      deferredBase: number;
      assetAmount: number;
      assetBase: number;
    };
  };
  const planned: Planned[] = [];
  for (const row of due) {
    const position =
      positions.get(row.customerContractLineId) ?? EMPTY_POSITION;
    const movement = applyContractMovement({
      position,
      amount: -Number(row.amount),
      rate: Number(row.rate),
      counterpart: "revenue"
    });
    positions.set(row.customerContractLineId, addMovement(position, movement));
    // A month ending after the run's period end (a mid-month period end)
    // still belongs to this run.
    const scheduledDate = row.periodEnd < periodEnd ? row.periodEnd : periodEnd;
    const common = {
      companyId,
      status: "Planned" as const,
      customerContractLineId: row.customerContractLineId,
      customerContractRevenueId: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      scheduledDate,
      creditAccountId: defaults.salesAccount,
      createdBy: userId
    };
    const entry = {
      customerContractId: row.customerContractId,
      customerContractLineId: row.customerContractLineId,
      customerContractRevenueId: row.id,
      postingDate: scheduledDate
    };
    if (movement.deferredAmount !== 0 || movement.deferredBase !== 0) {
      planned.push({
        schedule: {
          ...common,
          type: "Deferral",
          amount: round(-movement.deferredBase),
          contractAmount: round(-movement.deferredAmount),
          debitAccountId: defaults.deferredRevenueAccount
        },
        entry: {
          ...entry,
          deferredAmount: movement.deferredAmount,
          deferredBase: movement.deferredBase,
          assetAmount: 0,
          assetBase: 0
        }
      });
    }
    if (movement.assetAmount !== 0 || movement.assetBase !== 0) {
      planned.push({
        schedule: {
          ...common,
          type: "Accrual",
          amount: movement.assetBase,
          contractAmount: movement.assetAmount,
          debitAccountId: defaults.contractAssetAccount
        },
        entry: {
          ...entry,
          deferredAmount: 0,
          deferredBase: 0,
          assetAmount: movement.assetAmount,
          assetBase: movement.assetBase
        }
      });
    }
  }
  if (planned.length === 0) return;

  // RETURNING follows the VALUES order, so each entry pairs with its row.
  const inserted = await trx
    .insertInto("revenueRecognitionSchedule")
    .values(planned.map((p) => p.schedule))
    .returning("id")
    .execute();
  await trx
    .insertInto("customerContractLedgerEntry")
    .values(
      planned.map((p, index) => ({
        ...p.entry,
        entryType: "Recognition" as const,
        revenueRecognitionScheduleId: inserted[index]!.id,
        companyId,
        createdBy: userId
      }))
    )
    .execute();
}

/** The synthesizers a run of `type` runs before it selects its rows. A lease
 *  run synthesizes rental accruals; a revenue recognition run synthesizes
 *  contract revenue. Neither ever runs the other's. */
export function runRowSynthesizers(type: RunType): RunRowSynthesizer[] {
  return type === "Lease"
    ? [synthesizeRentalAccruals]
    : [synthesizeContractRevenue];
}

export type RunProposal = { id: string; runId: string; lineCount: number };

/** Every Planned row of the run type dated on or before `periodEnd` that no
 *  run holds yet. */
export async function selectDueScheduleRows(
  trx: KyselyTx,
  { companyId, periodEnd }: RunProposalContext,
  type: RunType
) {
  return trx
    .selectFrom("revenueRecognitionSchedule")
    .select(["id", "amount"])
    .where("companyId", "=", companyId)
    .where(runTypeFilter(type))
    .where("status", "=", "Planned")
    .where("runLineId", "is", null)
    .where("scheduledDate", "<=", periodEnd)
    .orderBy("scheduledDate")
    .orderBy("id")
    .execute();
}

/** Claims `due` into the run: one line per row, each copying the row's
 *  amount, and the row stamped with its line. */
export async function claimScheduleRows(
  trx: KyselyTx,
  runId: string,
  due: { id: string; amount: number }[],
  { companyId, userId }: RunProposalContext
): Promise<void> {
  if (due.length === 0) return;

  await trx
    .insertInto("revenueRecognitionRunLine")
    .values(
      due.map((row) => ({
        runId,
        scheduleId: row.id,
        amount: row.amount,
        companyId,
        createdBy: userId
      }))
    )
    .execute();

  // Stamp each claimed row with its line in one statement (the line ↔
  // schedule pair is unique per company, so the join is one-to-one).
  await trx
    .updateTable("revenueRecognitionSchedule as s")
    .from("revenueRecognitionRunLine as l")
    .set({ runLineId: sql`l.id`, updatedBy: userId })
    .whereRef("l.scheduleId", "=", "s.id")
    .where("l.runId", "=", runId)
    .where("l.companyId", "=", companyId)
    .where("s.companyId", "=", companyId)
    .execute();
}

/**
 * Claims every Planned schedule row dated on or before `periodEnd` that no run
 * holds yet, into ONE Draft run. Returns null (and writes nothing) when nothing
 * is due, so a second proposal for the same period is a no-op rather than an
 * empty run.
 */
async function createRevenueRecognitionRunProposal(
  db: Kysely<KyselyDatabase>,
  args: RunProposalContext,
  type: RunType
): Promise<RunProposal | null> {
  const { companyId, periodEnd, userId } = args;

  return db.transaction().execute(async (trx) => {
    for (const synthesize of runRowSynthesizers(type)) {
      await synthesize(trx, args);
    }

    const due = await selectDueScheduleRows(trx, args, type);
    if (due.length === 0) return null;

    // One Draft per period and run type (the partial unique index
    // revenueRecognitionRun_one_draft_per_period is the backstop): a period
    // that already has a Draft is recalculated, not proposed again.
    const draft = await trx
      .selectFrom("revenueRecognitionRun")
      .select("runId")
      .where("companyId", "=", companyId)
      .where("type", "=", type)
      .where("periodEnd", "=", periodEnd)
      .where("status", "=", "Draft")
      .executeTakeFirst();
    if (draft) {
      throw new InvalidInputError(
        `${draft.runId} is already a draft for this period. Recalculate it instead.`
      );
    }

    const runId = await getNextSequenceInTransaction(
      trx,
      RUN_SEQUENCE[type],
      companyId
    );
    const run = await trx
      .insertInto("revenueRecognitionRun")
      .values({
        runId,
        type,
        periodEnd,
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await claimScheduleRows(trx, run.id, due, args);

    return { id: run.id, runId, lineCount: due.length };
  });
}

/** Whether `date` is a real `YYYY-MM-DD` that is the last day of its month. */
function isMonthEnd(date: string): boolean {
  try {
    return endOfMonth(parseDate(date)).toString() === date;
  } catch {
    // parseDate throws on a day or month out of range ("2026-02-30").
    return false;
  }
}

export const proposeRevenueRecognitionRunInput = z.object({
  /** `YYYY-MM-DD`, the last day of the period being recognized. A mid-month
   *  date would accrue rent only up to it and leave the rest of the month to
   *  no run. */
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isMonthEnd, {
      message: "periodEnd must be the last day of a month"
    }),
  /** Which run: revenue recognition (service lines, contracts) or lease
   *  (rental agreements, lessee leases). */
  type: z.enum(["Revenue Recognition", "Lease"]).default("Revenue Recognition")
});

export const proposeRevenueRecognitionRunPermission = {
  create: "accounting"
} satisfies PermissionRule<z.output<typeof proposeRevenueRecognitionRunInput>>;

/** Proposes ONE Draft run for the period, or null when nothing is due (see
 *  `createRevenueRecognitionRunProposal`). */
export async function proposeRevenueRecognitionRun(
  ctx: ServiceContext,
  raw: z.input<typeof proposeRevenueRecognitionRunInput>
) {
  const { periodEnd, type } = proposeRevenueRecognitionRunInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  await assertAccountingCutover(db, companyId);
  // A run may cover the current month or an earlier one, never a month that
  // has not started (the ERP's isFutureRunPeriod; this package cannot import
  // it). Guards the monthly job as well as the routes.
  const today = datetime.today(await getCompanyTimeZone(db, companyId));
  if (periodEnd > endOfMonth(today).toString()) {
    throw new InvalidInputError(
      `${formatDate(periodEnd, { month: "long", year: "numeric" })} has not started yet. A run can cover the current month or an earlier one.`
    );
  }
  return createRevenueRecognitionRunProposal(
    db,
    { companyId, periodEnd, userId },
    type
  );
}
export const previewRevenueRecognitionRunInput = z.object({
  /** `YYYY-MM-DD`, the last day of the period. */
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Which run to preview. */
  type: z.enum(["Revenue Recognition", "Lease"]).default("Revenue Recognition")
});

export type RunRowsPreview = { count: number; amount: number };

/** Thrown at the end of the preview transaction so it never commits. */
class PreviewRollback extends Error {
  constructor(readonly preview: RunRowsPreview) {
    super("preview rollback");
  }
}

export const previewRevenueRecognitionRunPermission = {
  view: "accounting"
} satisfies PermissionRule<z.output<typeof previewRevenueRecognitionRunInput>>;

export async function previewRevenueRecognitionRun(
  ctx: ServiceContext,
  raw: z.input<typeof previewRevenueRecognitionRunInput>
) {
  const { periodEnd, type } = previewRevenueRecognitionRunInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  try {
    await db.transaction().execute(async (trx) => {
      const ctx = { companyId, periodEnd, userId };
      for (const synthesize of runRowSynthesizers(type)) {
        await synthesize(trx, ctx);
      }
      const due = await selectDueScheduleRows(trx, ctx, type);
      throw new PreviewRollback({
        count: due.length,
        amount: round(due.reduce((sum, row) => sum + Number(row.amount), 0))
      });
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.preview;
    throw error;
  }
  throw new Error("Revenue recognition preview did not roll back");
}
export const recalculateRevenueRecognitionRunInput = z.object({
  runId: z.string().min(1)
});

export type RunRecalculation = {
  runId: string;
  lineCount: number;
  /** False when the run already held exactly what is due. */
  changed: boolean;
  /** Nothing is due any more, so the run was deleted. */
  deleted: boolean;
};

export const recalculateRevenueRecognitionRunPermission = {
  update: "accounting"
} satisfies PermissionRule<
  z.output<typeof recalculateRevenueRecognitionRunInput>
>;

export async function recalculateRevenueRecognitionRun(
  ctx: ServiceContext,
  raw: z.input<typeof recalculateRevenueRecognitionRunInput>
) {
  const { runId } = recalculateRevenueRecognitionRunInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  await assertAccountingCutover(db, companyId);
  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("revenueRecognitionRun")
      .select(["id", "runId", "status", "periodEnd", "type"])
      .where("id", "=", runId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!run) throw new NotFoundError("Revenue recognition run not found");
    if (run.status !== "Draft") {
      throw new InvalidInputError(
        `Revenue recognition run ${run.runId} is ${run.status}; only a draft can be recalculated`
      );
    }

    const ctx: RunProposalContext = {
      companyId,
      periodEnd: String(run.periodEnd),
      userId
    };

    // The synthesizers' locks, in their order, before anything else: a
    // concurrent proposal cannot claim a row between the release and the
    // claim below, and an invoice void (which takes the position lock and
    // then deletes held run lines) cannot deadlock with the release.
    await lockRecognitionProposals(trx, companyId);
    await lockContractPositions(trx, companyId);

    // Release the run's own rows BEFORE the synthesizers. A synthesizer
    // that drops a held row (a contract month an amendment replaced) keeps
    // Draft runs in step and deletes a run it empties — which, with the run
    // still holding only that row, deleted this run and failed the claim
    // below on its foreign key.
    const before = await trx
      .selectFrom("revenueRecognitionRunLine")
      .select(["id", "scheduleId", "amount"])
      .where("runId", "=", run.id)
      .where("companyId", "=", companyId)
      .execute();
    if (before.length > 0) {
      await trx
        .updateTable("revenueRecognitionSchedule")
        .set({ runLineId: null, updatedBy: userId })
        .where("companyId", "=", companyId)
        .where(
          "runLineId",
          "in",
          before.map((line) => line.id)
        )
        .execute();
      await trx
        .deleteFrom("revenueRecognitionRunLine")
        .where("runId", "=", run.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    for (const synthesize of runRowSynthesizers(run.type)) {
      await synthesize(trx, ctx);
    }

    const due = await selectDueScheduleRows(trx, ctx, run.type);
    const held = new Map(
      before.map((line) => [line.scheduleId, Number(line.amount)])
    );
    const changed =
      due.length !== before.length ||
      due.some(
        (row) =>
          !held.has(row.id) || !equals(held.get(row.id)!, Number(row.amount))
      );

    if (due.length === 0) {
      await trx
        .deleteFrom("revenueRecognitionRun")
        .where("id", "=", run.id)
        .where("companyId", "=", companyId)
        .execute();
      return { runId: run.runId, lineCount: 0, changed, deleted: true };
    }

    await claimScheduleRows(trx, run.id, due, ctx);
    await trx
      .updateTable("revenueRecognitionRun")
      .set({ updatedBy: userId, updatedAt: datetime.timestamp() })
      .where("id", "=", run.id)
      .where("companyId", "=", companyId)
      .execute();

    return {
      runId: run.runId,
      lineCount: due.length,
      changed,
      deleted: false
    };
  });
}
