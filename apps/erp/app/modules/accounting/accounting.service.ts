// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import {
  fetchAllFromTable,
  fetchAllRecords,
  getCompanyTimeZone
} from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { type ServerFnInput, serverFns } from "@carbon/server-functions";
import type { PeriodPostingSource, ReportPeriodBucket } from "@carbon/utils";
import {
  addDays,
  datetime,
  daysBetweenInclusive,
  earnsInterest,
  fiscalYearAndPeriodFor,
  GL_JOURNAL_STATUSES,
  getDateNYearsAgo,
  isBalanced,
  isUniqueViolation,
  MONTH_NUMBER,
  round,
  toDisplayCredit,
  toDisplayDebit,
  toStoredAmount,
  unchecked
} from "@carbon/utils";
import { endOfMonth, parseDate, startOfMonth } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { getNextSequence } from "~/modules/settings";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
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
  buildDepreciationLines,
  type DepreciationLine,
  depreciationFloor,
  diffJournalLines,
  monthEndOf,
  usageKey
} from "./accounting.utils";
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

/** @mcp read */
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

/** @mcp read */
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
  // Draft journals are excluded so the lines shown always sum to the balances
  // from accountTreeBalancesByCompany, which excludes them too — unposted
  // entries belong in the Journal Entries list, not the account ledger.
  // TODO: remove the cast once cloud-generated DB types include the view.
  let query = client
    .from("journalLines" as any)
    .select("*", { count: "exact" })
    .eq("accountId", args.accountId)
    .neq("status", "Draft")
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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
 * @mcp read
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
 * @mcp read
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
/** @mcp read */
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

/** @mcp upsert */
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

// -- Dimensional analytics (pivot) reports --
// Spec: .ai/specs/2026-08-09-dimensional-pivot-reporting.md
// RPCs defined in migration 20260809184714_dimensional-pivot-reporting.sql.

// In `columnKeys` the null column (lines with no tag for the column
// dimension — the Unassigned bucket) is represented by this string sentinel.
// Group rows keep their `columnKey` as returned by the RPC (null stays null).
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
  if (!settings.data?.accountingCutoverDate) {
    return { error: { message: ACCOUNTING_NOT_STARTED } };
  }
  return { error: null };
}

/** The group form: every company of the group must have a cutover. */
export async function requireGroupAccountingCutover(
  client: SupabaseClient<Database>,
  companyGroupId: string
): Promise<{ error: { message: string } | null }> {
  const companies = await client
    .from("company")
    .select("id")
    .eq("companyGroupId", companyGroupId);
  if (companies.error) return { error: companies.error };
  const ids = (companies.data ?? []).map((company) => company.id);
  if (ids.length === 0) return { error: null };
  const withoutCutover = await client
    .from("companySettings")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .is("accountingCutoverDate", null);
  if (withoutCutover.error) return { error: withoutCutover.error };
  if ((withoutCutover.count ?? 0) > 0) {
    return { error: { message: ACCOUNTING_NOT_STARTED } };
  }
  return { error: null };
}

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
 * @mcp read
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

/** @mcp read */
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
 * @mcp read
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

/** @mcp read */
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

/** @mcp read */
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
/** @mcp read */
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

/** @mcp upsert */
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

/** @mcp delete */
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

/** @mcp read */
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

/** @mcp delete */
export async function deleteAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").delete().eq("id", accountId);
}

/** @mcp delete */
export async function deletePaymentTerm(
  client: SupabaseClient<Database>,
  paymentTermId: string
) {
  return client
    .from("paymentTerm")
    .update({ active: false })
    .eq("id", paymentTermId);
}

/** @mcp read */
export async function getAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").select("*").eq("id", accountId).single();
}

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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
 * @mcp read
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

/** @mcp read */
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
 * @mcp read
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
 * @mcp read
 */
export async function getExchangeRates(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.rpc("get_exchange_rates", {
    p_company_id: companyId
  });
}

/** @mcp upsert */
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

/** @mcp delete */
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

/** @mcp read */
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
 * @mcp read
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

/** @mcp read */
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
 * @mcp action
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

/** @mcp read */
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
/** @mcp read */
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

/** @mcp delete */
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
/** @mcp read */
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

/** @mcp action */
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

/** @mcp action */
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
/** @mcp update */
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

/** @mcp create */
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
 * @mcp read
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
  const [revenue, depreciation] = await Promise.all([
    serverFns
      .system({ db, companyId, userId })
      .invoke("preview-revenue-recognition-run", { periodEnd })
      .then(
        (result): RunPreview =>
          result.error
            ? {
                count: 0,
                amount: 0,
                error: previewError(
                  result.error,
                  "Failed to preview revenue recognition"
                )
              }
            : { ...result.data, error: null }
      )
      .catch(
        (error): RunPreview => ({
          count: 0,
          amount: 0,
          error: previewError(error, "Failed to preview revenue recognition")
        })
      ),
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
  return { revenue, depreciation };
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
  const heldRevenueRows = await fetchAllFromTable<{
    amount: number;
    run: { id: string; runId: string; periodEnd: string };
  }>(
    client,
    "revenueRecognitionRunLine",
    "amount, run:revenueRecognitionRun!revenueRecognitionRunLine_run_fkey!inner(id, runId, periodEnd, status), schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey!inner(scheduledDate, status)",
    (query: any) =>
      query
        .eq("companyId", companyId)
        .eq("run.status", "Draft")
        .eq("schedule.status", "Planned")
        .lte("schedule.scheduledDate", endDate)
        .order("id")
  );

  // Revenue: what a new run would claim, plus what Draft runs hold.
  const revenueDraftRuns = new Map<
    string,
    { id: string; readableId: string; periodEnd: string }
  >();
  let heldRevenueAmount = 0;
  for (const line of heldRevenueRows.data ?? []) {
    revenueDraftRuns.set(line.run.id, {
      id: line.run.id,
      readableId: line.run.runId,
      periodEnd: line.run.periodEnd
    });
    heldRevenueAmount += Number(line.amount);
  }
  const heldRevenueCount = heldRevenueRows.error
    ? 1
    : (heldRevenueRows.data ?? []).length;
  const revenueCount = runPreview.revenue.count + heldRevenueCount;

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

/** @mcp read */
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
// The "Lock the period" checklist step is an Action task whose completion IS the
// Open -> Locked transition. Its status is derived from the period's closeStatus
// (Locked/Closed => Done) rather than a stored task status, and its button drives
// lock/unlock instead of a generic "Mark Done". Identified by name (a stable,
// non-deletable system definition).
export const LOCK_PERIOD_TASK_NAME = "Lock the period";

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
 * @mcp action
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

/** @mcp action */
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

/** @mcp action */
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

/** @mcp read */
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

/** @mcp read */
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
 * @mcp read
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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
 * @mcp update
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

/** @mcp update */
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

/** @mcp upsert */
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

/** @mcp upsert */
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

/** @mcp upsert */
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

/** @mcp delete */
export async function deleteCostCenter(
  client: SupabaseClient<Database>,
  costCenterId: string
) {
  return client.from("costCenter").delete().eq("id", costCenterId);
}

/** @mcp read */
export async function getCostCenter(
  client: SupabaseClient<Database>,
  costCenterId: string
) {
  return client.from("costCenter").select("*").eq("id", costCenterId).single();
}

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp upsert */
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

/** @mcp delete */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp upsert */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp upsert destructive */
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

/** @mcp delete */
export async function deleteDimension(
  client: SupabaseClient<Database>,
  dimensionId: string
) {
  return client
    .from("dimension")
    .update({ active: false })
    .eq("id", dimensionId);
}

/** @mcp read */
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

/** @mcp read */
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

/** @mcp action destructive */
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

/** @mcp action */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp create */
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

/** @mcp read */
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

/** @mcp update */
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

/** @mcp create */
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

/** @mcp read */
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
 * @mcp read
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

/** @mcp read */
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

/** @mcp read */
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
    | "revenueRecognitionRun";
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
    journal.sourceType === "Revenue Recognition"
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
              kind: "revenueRecognitionRun" as const,
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

/** @mcp create */
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

/** @mcp delete */
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

/** @mcp action destructive */
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

/** @mcp action */
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

/** @mcp action */
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

/** @mcp read */
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

/** @mcp read */
export async function getFixedAssetClass(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAssetClass").select("*").eq("id", id).single();
}

/** @mcp read */
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

/** @mcp upsert */
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

/** @mcp delete */
export async function deleteFixedAssetClass(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAssetClass").delete().eq("id", id);
}

// -- Fixed Assets --

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp create */
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

/** @mcp update */
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

/** @mcp delete */
export async function deleteFixedAsset(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAsset").delete().eq("id", id).eq("status", "Draft");
}

/** @mcp create destructive */
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

/** @mcp delete */
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

/** @mcp read */
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

/** @mcp read */
export async function getDepreciationRun(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("depreciationRun").select("*").eq("id", id).single();
}

/** @mcp read */
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

/** @mcp read */
export async function getRevenueRecognitionRuns(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("revenueRecognitionRun")
    .select("id, runId, periodEnd, status, postedAt, journalId", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("runId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

/** @mcp read */
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

/** @mcp read */
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
      "id, amount, schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey(id, type, periodStart, periodEnd, scheduledDate, amount, debitAccountId, creditAccountId, salesInvoiceLineId, rentalAgreementLineId, journalId)"
    )
    .eq("runId", runId)
    .eq("companyId", companyId);
}

/**
 * The documents around a depreciation or revenue recognition run that its own
 * row doesn't name: the accounting period its `periodEnd` falls in (the one
 * posting resolves), and the journal entries it posted.
 * @mcp read
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

/** @mcp read */
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

/** @mcp read */
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
 * @mcp read
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
 * @mcp read
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

// -- Depreciation History for a single asset --

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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

/** @mcp read */
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
 * @mcp read
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

/** @mcp update */
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

/** @mcp update */
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
 *  asset or capitalize a CIP asset — the `post-asset-transfer` server function,
 *  run as the caller.
 *  @mcp action */
export async function invokeAssetTransfer(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: ServerFnInput<"post-asset-transfer"> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, ...transfer } = args;
  return serverFns
    .as({ client, db, companyId, userId })
    .invoke(
      "post-asset-transfer",
      transfer as ServerFnInput<"post-asset-transfer">
    );
}

/** The cost a serialized unit would be capitalized at — the
 *  `preview-asset-capitalization` server function, which runs the same
 *  relief as `post-asset-transfer` `capitalize` and rolls it back. */
export async function getCapitalizationCost(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; trackedEntityId: string }
) {
  const { companyId, userId, trackedEntityId } = args;
  return serverFns
    .as({ client, db, companyId, userId })
    .invoke("preview-asset-capitalization", { trackedEntityId });
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
 * @mcp read
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
 * @mcp read
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
 * @mcp read
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
