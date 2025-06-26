import type { Database, Json } from "@carbon/database";
import { getDateNYearsAgo } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  accountCategoryValidator,
  accountSubcategoryValidator,
  accountValidator,
  currencyValidator,
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
  fiscalYearSettingsValidator,
  paymentTermValidator,
} from "./accounting.models";
import type { Account, Transaction } from "./types";

type AccountWithTotals = Account & { level: number; totaling: string };

function addLevelsAndTotalsToAccounts(
  accounts: Account[]
): AccountWithTotals[] {
  let result: AccountWithTotals[] = [];
  let beginTotalAccounts: string[] = [];
  let endTotalAccounts: string[] = [];
  let hasHeading = false;

  accounts.forEach((account) => {
    if (["End Total", "Total"].includes(account.type)) {
      endTotalAccounts.push(account.number);
    }

    let level =
      beginTotalAccounts.length -
      endTotalAccounts.length +
      (hasHeading ? 1 : 0);

    if (account.type === "Begin Total") {
      beginTotalAccounts.push(account.number);
    }

    let totaling = "";

    if (["End Total", "Total"].includes(account.type)) {
      let startAccount = beginTotalAccounts.pop();
      let endAccount = endTotalAccounts.pop();

      totaling = `${startAccount}..${endAccount}`;
    }

    result.push({
      ...account,
      level,
      totaling,
    });
  });

  return result;
}

export async function deleteAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").delete().eq("id", accountId);
}

export async function deleteAccountCategory(
  client: SupabaseClient<Database>,
  accountCategoryId: string
) {
  return client.from("accountCategory").delete().eq("id", accountCategoryId);
}

export async function deleteAccountSubcategory(
  client: SupabaseClient<Database>,
  accountSubcategoryId: string
) {
  return client
    .from("accountSubcategory")
    .update({ active: false })
    .eq("id", accountSubcategoryId);
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
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("account")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
  ]);
  return query;
}

export async function getAccountsList(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: {
    type?: string | null;
    incomeBalance?: string | null;
    classes?: string[];
  }
) {
  let query = client
    .from("account")
    .select("number, name, incomeBalance")
    .eq("companyId", companyId)
    .eq("active", true);

  if (args?.type) {
    query = query.eq("type", args.type);
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

export async function getAccountCategories(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("accountCategories")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("category", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "incomeBalance", ascending: true },
    { column: "class", ascending: true },
    { column: "category", ascending: true },
  ]);
  return query;
}

export async function getAccountCategoriesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("accountCategory")
    .select("*")
    .eq("companyId", companyId)
    .order("category", { ascending: true });
}

export async function getAccountCategory(
  client: SupabaseClient<Database>,
  accountCategoryId: string,
  companyId: string
) {
  return client
    .from("accountCategory")
    .select("*")
    .eq("id", accountCategoryId)
    .eq("companyId", companyId)
    .single();
}

export async function getAccountSubcategories(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("accountSubcategory")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
  ]);
  return query;
}

export async function getAccountSubcategoriesByCategory(
  client: SupabaseClient<Database>,
  accountCategoryId: string,
  companyId: string
) {
  return client
    .from("accountSubcategory")
    .select("*")
    .eq("accountCategoryId", accountCategoryId)
    .eq("companyId", companyId)
    .eq("active", true);
}

export async function getAccountSubcategory(
  client: SupabaseClient<Database>,
  accountSubcategoryId: string
) {
  return client
    .from("accountSubcategory")
    .select("*")
    .eq("id", accountSubcategoryId)
    .single();
}

function getAccountTotal(
  accounts: Account[],
  account: AccountWithTotals,
  type: "netChange" | "balance" | "balanceAtDate",
  transactionsByAccount: Record<string, Transaction>
) {
  if (!account.totaling) {
    return transactionsByAccount[account.number]?.[type] ?? 0;
  }

  let total = 0;
  const [start, end] = account.totaling.split("..");
  if (!start || !end) throw new Error("Invalid totaling");

  // for End Total -- we just do a simple sum of all accounts between start and end
  if (account.type === "End Total") {
    accounts.forEach((account) => {
      if (account.number >= start && account.number <= end) {
        total += transactionsByAccount[account.number]?.[type] ?? 0;
      }
    });
  }

  // for Total -- we use accounting equation to calculate the total
  if (account.type === "Total") {
    accounts.forEach((account) => {
      if (account.number >= start && account.number <= end) {
        if (["Asset", "Revenue"].includes(account.class as string)) {
          total += transactionsByAccount[account.number]?.[type] ?? 0;
        }
        if (
          ["Liability", "Equity", "Expense"].includes(account.class as string)
        ) {
          total -= transactionsByAccount[account.number]?.[type] ?? 0;
        }
      }
    });
  }

  return total;
}

export async function getBaseCurrency(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const { data: company, error } = await client
    .from("company")
    .select("baseCurrencyCode")
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
    .single();
}

export async function getChartOfAccounts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: Omit<GenericQueryFilters, "limit" | "offset"> & {
    name: string | null;
    incomeBalance: "Income Statement" | "Balance Sheet" | null;
    startDate: string | null;
    endDate: string | null;
  }
) {
  let accountsQuery = client
    .from("accounts")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.incomeBalance) {
    accountsQuery = accountsQuery.eq("incomeBalance", args.incomeBalance);
  }

  accountsQuery = setGenericQueryFilters(accountsQuery, args, [
    { column: "number", ascending: true },
  ]);

  let transactionsQuery = client.rpc("journalLinesByAccountNumber", {
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0],
  });

  const [accountsResponse, transactionsResponse] = await Promise.all([
    accountsQuery,
    transactionsQuery,
  ]);

  if (transactionsResponse.error) return transactionsResponse;
  if (accountsResponse.error) return accountsResponse;

  const transactionsByAccount = (
    transactionsResponse.data as unknown as Transaction[]
  ).reduce<Record<string, Transaction>>((acc, transaction: Transaction) => {
    acc[transaction.number] = transaction;
    return acc;
  }, {});

  // @ts-ignore
  const accounts: Account[] = accountsResponse.data as Account[];

  return {
    data: addLevelsAndTotalsToAccounts(accounts).map((account) => ({
      ...account,
      netChange: getAccountTotal(
        accounts,
        account,
        "netChange",
        transactionsByAccount
      ),

      balance: getAccountTotal(
        accounts,
        account,
        "balance",
        transactionsByAccount
      ),

      balanceAtDate: getAccountTotal(
        accounts,
        account,
        "balanceAtDate",
        transactionsByAccount
      ),
    })),
    error: null,
  };
}

export async function getCurrency(
  client: SupabaseClient<Database>,
  currencyId: string
) {
  return client.from("currencies").select("*").eq("id", currencyId).single();
}

export async function getCurrencyByCode(
  client: SupabaseClient<Database>,
  companyId: string,
  currencyCode: string
) {
  return client
    .from("currencies")
    .select("*")
    .eq("code", currencyCode)
    .eq("companyId", companyId)
    .single();
}

export async function getCurrencies(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("currencies")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId)
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

export async function getInventoryPostingGroup(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    itemPostingGroupId: string | null;
    locationId: string | null;
  }
) {
  let query = client
    .from("postingGroupInventory")
    .select("*")
    .eq("companyId", companyId);

  if (args.itemPostingGroupId === null) {
    query = query.is("itemPostingGroupId", null);
  } else {
    query = query.eq("itemPostingGroupId", args.itemPostingGroupId);
  }

  if (args.locationId === null) {
    query = query.is("locationId", null);
  } else {
    query = query.eq("locationId", args.locationId);
  }

  return query.single();
}

export async function getInventoryPostingGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters
) {
  let query = client
    .from("postingGroupInventory")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  query = setGenericQueryFilters(query, args, [
    { column: "itemPostingGroupId", ascending: false },
  ]);
  return query;
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
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
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

export async function getPurchasingPostingGroup(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    itemPostingGroupId: string | null;
    supplierTypeId: string | null;
  }
) {
  let query = client
    .from("postingGroupInventory")
    .select("*")
    .eq("companyId", companyId);

  if (args.itemPostingGroupId === null) {
    query = query.is("itemPostingGroupId", null);
  } else {
    query = query.eq("itemPostingGroupId", args.itemPostingGroupId);
  }

  if (args.supplierTypeId === null) {
    query = query.is("supplierTypeId", null);
  } else {
    query = query.eq("supplierTypeId", args.supplierTypeId);
  }

  return query.single();
}

export async function getPurchasingPostingGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters
) {
  let query = client
    .from("postingGroupPurchasing")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  query = setGenericQueryFilters(query, args, [
    { column: "itemPostingGroupId", ascending: false },
  ]);
  return query;
}

export async function getPurchasingSalesGroup(
  client: SupabaseClient<Database>,
  args: {
    itemPostingGroupId: string | null;
    customerTypeId: string | null;
  }
) {
  let query = client.from("postingGroupInventory").select("*");

  if (args.itemPostingGroupId === null) {
    query = query.is("itemPostingGroupId", null);
  } else {
    query = query.eq("itemPostingGroupId", args.itemPostingGroupId);
  }

  if (args.customerTypeId === null) {
    query = query.is("customerTypeId", null);
  } else {
    query = query.eq("customerTypeId", args.customerTypeId);
  }

  return query.single();
}

export async function getSalesPostingGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters
) {
  let query = client
    .from("postingGroupSales")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  query = setGenericQueryFilters(query, args, [
    { column: "itemPostingGroupId", ascending: false },
  ]);
  return query;
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
        companyId: string;
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

export async function upsertAccountCategory(
  client: SupabaseClient<Database>,
  accountCategory:
    | (Omit<z.infer<typeof accountCategoryValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof accountCategoryValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in accountCategory) {
    return client
      .from("accountCategory")
      .insert([accountCategory])
      .select("id")
      .single();
  }
  return client
    .from("accountCategory")
    .update(sanitize(accountCategory))
    .eq("id", accountCategory.id)
    .select("id")
    .single();
}

export async function upsertAccountSubcategory(
  client: SupabaseClient<Database>,
  accountSubcategory:
    | (Omit<z.infer<typeof accountSubcategoryValidator>, "id"> & {
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof accountSubcategoryValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in accountSubcategory) {
    return client
      .from("accountSubcategory")
      .insert([accountSubcategory])
      .select("id")
      .single();
  }
  return client
    .from("accountSubcategory")
    .update(sanitize(accountSubcategory))
    .eq("id", accountSubcategory.id)
    .select("id")
    .single();
}

export async function upsertCurrency(
  client: SupabaseClient<Database>,
  currency:
    | (Omit<z.infer<typeof currencyValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof currencyValidator>, "id"> & {
        id: string;
        companyId: string;
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
