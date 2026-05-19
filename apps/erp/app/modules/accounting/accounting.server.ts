import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient, mcpTool } from "~/services/mcp";
import {
  applyRootSignCorrection,
  getFinancialStatementBalances
} from "./accounting.service";
import type { TranslatedBalance } from "./types";

export function getServiceRoleClient(): SupabaseClient<Database> {
  return getCarbonServiceRole();
}

export const translateCompanyBalances = mcpTool(
  {
    classification: "WRITE"
  },
  async function translateCompanyBalances(
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
    const client = getAuthClient<SupabaseClient<Database>>();

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

    const accountIds = rows.map((r) => r.accountId);
    const { data: accounts } = await getServiceRoleClient()
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
        totalTranslatedLiabilitiesAndEquity += Number(row.translatedBalance);
      }
    }

    const cta = totalTranslatedAssets - totalTranslatedLiabilitiesAndEquity;

    return { data: rows, cta, error: null };
  }
);

export const getConsolidatedBalances = mcpTool(
  {
    classification: "READ"
  },
  async function getConsolidatedBalances(
    companyGroupId: string,
    companyIds: string[],
    targetCurrency: string,
    periodEnd: string,
    periodStart?: string
  ) {
    const _client = getAuthClient<SupabaseClient<Database>>();

    const { data: allGroupCompanies } = await getServiceRoleClient()
      .from("company")
      .select("id, parentCompanyId, isEliminationEntity")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true);

    const groupCompanies = allGroupCompanies ?? [];
    const selectedSet = new Set(companyIds);

    const ancestors = new Set<string>();
    const companyById = new Map(groupCompanies.map((c) => [c.id, c]));
    for (const id of companyIds) {
      let current = companyById.get(id);
      while (current?.parentCompanyId) {
        ancestors.add(current.parentCompanyId);
        current = companyById.get(current.parentCompanyId);
      }
    }

    const eliminationIds = groupCompanies
      .filter(
        (c) =>
          c.isEliminationEntity &&
          c.parentCompanyId &&
          (ancestors.has(c.parentCompanyId) ||
            selectedSet.has(c.parentCompanyId))
      )
      .map((c) => c.id);

    const allIds = [...companyIds, ...eliminationIds];

    const [allBalances, translations] = await Promise.all([
      Promise.all(
        allIds.map((id) =>
          getFinancialStatementBalances(companyGroupId, id, {
            startDate: periodStart ?? null,
            endDate: periodEnd
          })
        )
      ),
      Promise.all(
        allIds.map((id) =>
          translateCompanyBalances(
            companyGroupId,
            id,
            targetCurrency,
            periodEnd,
            periodStart
          )
        )
      )
    ]);

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

    const totalCta = translations.reduce((sum, t) => sum + t.cta, 0);

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

    for (const [accountId, translation] of translationByAccount) {
      const account = accountMap.get(accountId);
      if (account) {
        account.translatedBalance = translation.translatedBalance;
        account.exchangeRate = translation.exchangeRate;
      }
    }

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
);
