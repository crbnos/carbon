import type { Database, Json } from "@carbon/database";
import {
  getDateNYearsAgo,
  toDisplayCredit,
  toDisplayDebit,
  toStoredAmount
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getNextSequence } from "~/modules/settings";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  accountValidator,
  costCenterValidator,
  currencyValidator,
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
  depreciationMethods,
  dimensionValidator,
  fiscalYearSettingsValidator,
  intercompanyTransactionValidator,
  journalEntryLineValidator,
  journalEntryValidator,
  macrsConventions,
  macrsPropertyClasses,
  paymentTermValidator,
  taxDepreciationMethods
} from "./accounting.models";
import type { Transaction, TranslatedBalance } from "./types";

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

export async function getFinancialStatementBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string | null,
  args: {
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

  const balancesQuery = client.rpc("accountTreeBalancesByCompany", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId ?? undefined,
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

export async function getCompaniesInGroup(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("company")
    .select("id, name, baseCurrencyCode, parentCompanyId, isEliminationEntity")
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
      count: "exact"
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

export async function getCurrenciesList(client: SupabaseClient<Database>) {
  return client
    .from("currencyCode")
    .select("code, name")
    .order("name", { ascending: true });
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

export async function getOrCreateAccountingPeriod(
  client: SupabaseClient<Database>,
  companyId: string,
  date: string
): Promise<{ data: string | null; error: { message: string } | null }> {
  const existing = await getCurrentAccountingPeriod(client, companyId, date);

  if (existing.data) {
    if (existing.data.closedAt) {
      return {
        data: null,
        error: {
          message: "Accounting period is closed. Reopen it before posting."
        }
      };
    }

    if (existing.data.status === "Inactive") {
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

  // Create a new period for the month of the given date
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  const startDate = new Date(year, month, 1).toISOString().split("T")[0];
  const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];

  await client
    .from("accountingPeriod")
    .update({ status: "Inactive" as const })
    .eq("companyId", companyId)
    .eq("status", "Active");

  const result = await client
    .from("accountingPeriod")
    .insert({
      startDate,
      endDate,
      companyId,
      status: "Active" as const,
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
      count: "exact"
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

export async function updateDefaultBalanceSheetAccounts(
  client: SupabaseClient<Database>,
  defaultAccounts: z.infer<typeof defaultBalanceSheetAccountValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("accountDefault")
    .update(defaultAccounts)
    .eq("companyId", defaultAccounts.companyId);
}

export async function updateDefaultIncomeAccounts(
  client: SupabaseClient<Database>,
  defaultAccounts: z.infer<typeof defaultIncomeAcountValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("accountDefault")
    .update(defaultAccounts)
    .eq("companyId", defaultAccounts.companyId);
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
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in account) {
    return client.from("account").insert([account]).select("*").single();
  }
  return client
    .from("account")
    .update(sanitize(account))
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
    .select("*", { count: "exact" })
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
      count: "exact"
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
    dimensionResult = await client
      .from("dimension")
      .update(sanitize(dimension))
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
    case "FixedAssetClass":
      return client.from("fixedAssetClass").select("id, name").in("id", ids);
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
  periodStart?: string
): Promise<{
  data: TranslatedBalance[] | null;
  cta: number;
  error: string | null;
}> {
  const { data, error } = await client.rpc("translateTrialBalance", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId ?? undefined,
    p_target_currency: targetCurrency,
    p_period_end: periodEnd,
    p_period_start: periodStart ?? undefined
  });

  if (error) {
    return { data: null, cta: 0, error: error.message };
  }

  const rows = (data ?? []) as unknown as TranslatedBalance[];

  // Look up each account's class to compute CTA
  const accountIds = rows.map((r) => r.accountId);
  const { data: accounts } = await client
    .from("account")
    .select("id, class")
    .in("id", accountIds);

  const classById = new Map((accounts ?? []).map((a) => [a.id, a.class]));

  let totalTranslatedAssets = 0;
  let totalTranslatedLiabilitiesAndEquity = 0;

  for (const row of rows) {
    const cls = classById.get(row.accountId);
    if (cls === "Asset") {
      totalTranslatedAssets += Number(row.translatedBalance);
    } else {
      // Liability, Equity, Revenue, Expense (but income statement
      // accounts net to retained earnings on balance sheet)
      totalTranslatedLiabilitiesAndEquity += Number(row.translatedBalance);
    }
  }

  // CTA = translated assets - translated (liabilities + equity)
  // A balanced sheet means assets = liabilities + equity + CTA
  const cta = totalTranslatedAssets - totalTranslatedLiabilitiesAndEquity;

  return { data: rows, cta, error: null };
}

export async function getConsolidatedBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  periodEnd: string,
  periodStart?: string
) {
  // Find elimination entities that should be included automatically.
  // An elimination entity is included when its parentCompanyId is an ancestor
  // of any selected company (i.e. it sits at or above the selected companies
  // in the hierarchy and captures their intercompany eliminations).
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

  // All companies whose balances we need (operating + elimination entities)
  const allIds = [...companyIds, ...eliminationIds];

  // Get balances for all companies and translate to target currency
  const [allBalances, translations] = await Promise.all([
    Promise.all(
      allIds.map((id) =>
        getFinancialStatementBalances(client, companyGroupId, id, {
          startDate: periodStart ?? null,
          endDate: periodEnd
        })
      )
    ),
    Promise.all(
      allIds.map((id) =>
        translateCompanyBalances(
          client,
          companyGroupId,
          id,
          targetCurrency,
          periodEnd,
          periodStart
        )
      )
    )
  ]);

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

  return { data: applyRootSignCorrection(consolidated), cta: totalCta };
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
      { count: "exact" }
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
  const today = new Date().toISOString().split("T")[0];
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
        companyId: input.sourceCompanyId,
        companyGroupId: input.companyGroupId
      },
      {
        journalId,
        accountId: input.creditAccountId,
        description: input.description,
        amount: -input.amount,
        journalLineReference: journalLineRef,
        intercompanyPartnerId: input.targetCompanyId,
        companyId: input.sourceCompanyId,
        companyGroupId: input.companyGroupId
      }
    ])
    .select("id");

  if (journalLines.error) return journalLines;

  // Create intercompany transaction record
  return client
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
}

export async function runIntercompanyMatching(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client.rpc("matchIntercompanyTransactions", {
    p_company_group_id: companyGroupId
  });
}

export async function generateEliminations(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  userId: string
) {
  return client.rpc("generateEliminationEntries", {
    p_company_group_id: companyGroupId,
    p_user_id: userId
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

export async function getExchangeRateHistory(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  currencyCode: string
) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  return client
    .from("exchangeRateHistory")
    .select("effectiveDate, rate")
    .eq("companyGroupId", companyGroupId)
    .eq("currencyCode", currencyCode)
    .gte("effectiveDate", sixMonthsAgo.toISOString().split("T")[0])
    .order("effectiveDate", { ascending: true });
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
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `journalEntryId.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args.status) {
    query = query.eq("status", args.status as "Draft" | "Posted" | "Reversed");
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);

  return query;
}

export async function getJournalEntry(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("journal")
    .select("*, journalLine(*, account!journalLine_accountId_fkey(class))")
    .eq("id", id)
    .single();
}

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

export async function saveJournalEntryWithLines(
  client: SupabaseClient<Database>,
  data: {
    journalEntryId: string;
    postingDate: string;
    description?: string;
    updatedBy: string;
    lines: Array<{
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
  // 1. Update journal header
  const headerUpdate = await client
    .from("journal")
    .update(
      sanitize({
        postingDate: data.postingDate,
        description: data.description,
        updatedBy: data.updatedBy
      })
    )
    .eq("id", data.journalEntryId)
    .eq("status", "Draft");

  if (headerUpdate.error) return headerUpdate;

  // 2. Delete existing lines (cascades journalLineDimension via FK)
  const deleteResult = await client
    .from("journalLine")
    .delete()
    .eq("journalId", data.journalEntryId);

  if (deleteResult.error) return deleteResult;

  if (data.lines.length === 0) return { data: null, error: null };

  // 3. Look up account classes for all distinct account IDs
  const accountIds = [...new Set(data.lines.map((l) => l.accountId))];
  const accounts = await client
    .from("account")
    .select("id, class")
    .in("id", accountIds);

  if (accounts.error) return accounts;

  const accountMap = new Map(accounts.data.map((a) => [a.id, a.class]));

  // 4. Build insert payloads
  const inserts = data.lines.map((line) => {
    const accountClass = accountMap.get(line.accountId);
    if (!accountClass) {
      throw new Error(`Account not found: ${line.accountId}`);
    }
    return {
      journalId: data.journalEntryId,
      accountId: line.accountId,
      description: line.description,
      amount: toStoredAmount(line.debit, line.credit, accountClass),
      journalLineReference: crypto.randomUUID(),
      companyId: data.companyId
    };
  });

  // 5. Insert all lines and get new IDs
  const insertResult = await client
    .from("journalLine")
    .insert(inserts)
    .select("id");

  if (insertResult.error) return insertResult;

  // 6. Insert dimensions from client state
  const newLineIds = (insertResult.data ?? []).map((l) => l.id);
  const dimensionInserts: Array<{
    journalLineId: string;
    dimensionId: string;
    valueId: string;
    companyId: string;
  }> = [];

  for (let i = 0; i < newLineIds.length; i++) {
    const lineDims = data.lines[i]?.dimensions;
    if (lineDims) {
      for (const d of lineDims) {
        dimensionInserts.push({
          journalLineId: newLineIds[i],
          dimensionId: d.dimensionId,
          valueId: d.valueId,
          companyId: data.companyId
        });
      }
    }
  }

  if (dimensionInserts.length > 0) {
    const dimInsertResult = await client
      .from("journalLineDimension")
      .insert(dimensionInserts);
    if (dimInsertResult.error) return dimInsertResult;
  }

  return insertResult;
}

export async function postJournalEntry(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  // 1. Fetch entry + lines
  const entry = await getJournalEntry(client, id);
  if (entry.error) return entry;
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

  // 2. Validate balance. Amounts are stored in natural-balance convention
  // (toStoredAmount), so a balanced entry has Σdebits === Σcredits, not
  // Σamount === 0 (that only holds if every account were natural-debit).
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    const accountClass = line.account?.class;
    if (!accountClass) {
      return {
        data: null,
        error: { message: "Journal line is missing an account" }
      };
    }
    const amount = Number(line.amount);
    debits += toDisplayDebit(amount, accountClass);
    credits += toDisplayCredit(amount, accountClass);
  }

  if (Math.abs(debits - credits) > 0.001) {
    return {
      data: null,
      error: { message: "Total debits must equal total credits" }
    };
  }

  // 3. Flip status — lines are already in journalLine, no copying needed
  return client
    .from("journal")
    .update({
      status: "Posted" as const,
      postedAt: new Date().toISOString(),
      postedBy: userId,
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
  // 1. Fetch original
  const original = await getJournalEntry(client, id);
  if (original.error) return original;
  if (original.data.status !== "Posted") {
    return {
      data: null,
      error: { message: "Can only reverse posted journal entries" }
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

  // 3. Create reversing entry as Posted
  const reversed = await client
    .from("journal")
    .insert({
      journalEntryId,
      companyId: data.companyId,
      description: `Reversal of ${original.data.journalEntryId}`,
      postingDate: new Date().toISOString().split("T")[0],
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
      { count: "exact" }
    )
    .eq("companyId", companyId);

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
  return client
    .from("fixedAssetClass")
    .select(
      "id, name, depreciationMethod, usefulLifeMonths, residualValuePercent, taxDepreciationMethod, taxUsefulLifeMonths, taxResidualValuePercent, macrsPropertyClass, macrsConvention, bonusDepreciationPercent"
    )
    .eq("companyId", companyId)
    .order("name");
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
    .update(sanitize(rest))
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
      { count: "exact" }
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
  id: string
) {
  return client
    .from("fixedAsset")
    .select(
      "*, fixedAssetClass:fixedAssetClassId(*), location:locationId(id, name)"
    )
    .eq("id", id)
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
    .update(sanitize(rest))
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

export async function insertDepreciationRun(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    depreciationRunId?: string;
    periodEnd: string;
    lines: Array<{
      fixedAssetId: string;
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
      count: "exact"
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
  return client
    .from("depreciationRunLine")
    .select(
      "id, amount, taxAmount, journalId, fixedAsset:fixedAssetId(id, fixedAssetId, name, acquisitionCost, accumulatedDepreciation, accumulatedTaxDepreciation, residualValuePercent)"
    )
    .eq("depreciationRunId", depreciationRunId);
}

// -- Depreciation History for a single asset --

export async function getAssetDepreciationHistory(
  client: SupabaseClient<Database>,
  fixedAssetId: string
) {
  return client
    .from("depreciationRunLine")
    .select(
      "id, amount, taxAmount, journalId, depreciationRun:depreciationRunId(id, depreciationRunId, periodEnd, status)"
    )
    .eq("fixedAssetId", fixedAssetId)
    .order("depreciationRun(periodEnd)", { ascending: false });
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
