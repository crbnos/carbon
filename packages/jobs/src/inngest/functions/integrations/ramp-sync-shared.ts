import type { Database } from "@carbon/database";
import type { createMappingService } from "@carbon/ee/accounting";
import {
  parseVerifiedRampMinorAmount,
  type RampIntegrationMetadata,
  rampMinorAmountToMajor,
  validateRampCurrencyDecimals,
  validateRampExchangeRate
} from "@carbon/ee/ramp.server";
import { getAppUrl } from "@carbon/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { getJobDatabaseClient } from "../../../db";

type CarbonClient = SupabaseClient<Database>;

const CARD_TRANSACTIONS_PATH = "/x/invoicing/card-transactions";
const PURCHASE_INVOICE_PATH = "/x/purchase-invoice";

export type SyncItem = {
  id: string;
  referenceId: string;
  deepLinkUrl?: string;
};
export type FailItem = { id: string; message: string };
export type FamilyResult = {
  created: number;
  reconfirmed: number;
  failed: number;
  error?: string;
  confirmError?: string;
};

export type RampSyncContext = {
  client: CarbonClient;
  db: ReturnType<typeof getJobDatabaseClient>;
  mapping: ReturnType<typeof createMappingService>;
  companyId: string;
  metadata: RampIntegrationMetadata;
  baseCurrency: string;
  companyGroupId: string | null;
  decimalsCache: Map<string, number>;
  exchangeRateCache: Map<string, number>;
};

export async function verifyCostCenters(
  ctx: RampSyncContext,
  lines: ReadonlyArray<{ costCenterId: string | null }>
): Promise<string | null> {
  const ids = [
    ...new Set(
      lines
        .map((line) => line.costCenterId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (ids.length === 0) return null;
  const { data, error } = await ctx.client
    .from("costCenter")
    .select("id")
    .in("id", ids)
    .eq("companyId", ctx.companyId);
  if (error) return `Failed to verify cost centers: ${error.message}`;
  const known = new Set((data ?? []).map((row) => row.id));
  if (ids.some((id) => !known.has(id))) {
    return "Line is coded to a cost center Carbon doesn't recognize — recode it in Ramp";
  }
  return null;
}

export function cardTransactionsDeepLinkUrl(): string {
  return `${getAppUrl()}${CARD_TRANSACTIONS_PATH}`;
}

export function invoiceDeepLinkUrl(invoiceRowId: string): string {
  return `${getAppUrl()}${PURCHASE_INVOICE_PATH}/${invoiceRowId}`;
}

export async function getRampCurrencyDecimals(
  ctx: RampSyncContext,
  currencyCode: string
): Promise<number> {
  const cached = ctx.decimalsCache.get(currencyCode);
  if (cached !== undefined) return cached;
  if (!ctx.companyGroupId) {
    throw new Error(
      `Cannot resolve currency precision for ${currencyCode}: company group is missing`
    );
  }
  const { data, error } = await ctx.client
    .from("currency")
    .select("decimalPlaces")
    .eq("companyGroupId", ctx.companyGroupId)
    .eq("code", currencyCode)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to resolve currency precision for ${currencyCode}: ${error.message}`
    );
  }
  const validated = validateRampCurrencyDecimals(
    data?.decimalPlaces,
    currencyCode
  );
  if (!validated.ok) throw new Error(validated.error);
  ctx.decimalsCache.set(currencyCode, validated.value);
  return validated.value;
}

export async function getRampExchangeRate(
  ctx: RampSyncContext,
  currencyCode: string
): Promise<number> {
  if (currencyCode === ctx.baseCurrency) return 1;
  const cached = ctx.exchangeRateCache.get(currencyCode);
  if (cached !== undefined) return cached;
  const { data, error } = await ctx.client.rpc("get_exchange_rate", {
    p_company_id: ctx.companyId,
    p_currency_code: currencyCode
  });
  if (error) {
    throw new Error(
      `Failed to resolve exchange rate for ${currencyCode}: ${error.message}`
    );
  }
  const validated = validateRampExchangeRate(data, currencyCode);
  if (!validated.ok) throw new Error(validated.error);
  ctx.exchangeRateCache.set(currencyCode, validated.value);
  return validated.value;
}

export async function normalizeVerifiedMinorAmount(
  ctx: RampSyncContext,
  value: unknown,
  expectedCurrencyCode: string,
  label: string,
  options: { allowDifferentCurrency?: boolean } = {}
): Promise<{ ok: true; value: number } | { ok: false; error: string }> {
  const parsed = parseVerifiedRampMinorAmount(value, label);
  if (!parsed.ok) return parsed;
  const sourceCurrencyCode = parsed.value.currencyCode ?? expectedCurrencyCode;
  if (
    !options.allowDifferentCurrency &&
    sourceCurrencyCode !== expectedCurrencyCode
  ) {
    return {
      ok: false,
      error: `${label} currency ${sourceCurrencyCode} does not match ${expectedCurrencyCode}`
    };
  }
  try {
    const decimals = await getRampCurrencyDecimals(ctx, sourceCurrencyCode);
    return {
      ok: true,
      value: rampMinorAmountToMajor(parsed.value, sourceCurrencyCode, decimals)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function documentTypeForFile(
  fileName: string
): Database["public"]["Enums"]["documentType"] {
  const ext = extension(fileName);
  if (ext === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) {
    return "Image";
  }
  return "Other";
}

// Mirror of ~/utils/string stripSpecialCharacters (app-only, not importable).
export function stripSpecialCharacters(input: string): string {
  return input.replace(/[^a-zA-Z0-9/!_\-.*'() &$@=;:+,?]/g, "");
}
