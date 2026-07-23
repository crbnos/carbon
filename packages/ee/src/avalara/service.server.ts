import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AvalaraSettings, AvalaraSettingsSchema } from "./config";
import { AvataxApi } from "./lib/avatax";
import { AvalaraError } from "./lib/client";
import { EinvoicingApi } from "./lib/einvoicing";
import { buildAvalaraHttp, isAvalaraConfigured } from "./lib/env.server";
import type { Avalara } from "./lib/types";

/**
 * The consumer seam for the Avalara integration. Downstream workstreams (tax
 * determination #1044, e-invoicing #1054) import ONLY these functions — they
 * never read `companyIntegration` directly.
 *
 * Every function takes the caller's `client` first and returns `{ data, error }`
 * (or a plain boolean for the feature check), never throwing.
 */

export type AvalaraClientBundle = {
  avatax: AvataxApi;
  einvoicing: EinvoicingApi;
  config: AvalaraSettings;
};

export { isAvalaraConfigured };

async function readInstalledConfig(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{
  data: (AvalaraSettings & { installed: boolean }) | null;
  error: AvalaraError | null;
}> {
  const row = await client
    .from("companyIntegration")
    .select("metadata, active")
    .eq("companyId", companyId)
    .eq("id", "avalara")
    .maybeSingle();

  if (row.error) {
    return {
      data: null,
      error: new AvalaraError({
        kind: "transient",
        message: "Failed to read Avalara integration"
      })
    };
  }

  const installed = row.data?.active === true;
  const parsed = AvalaraSettingsSchema.safeParse(row.data?.metadata ?? {});
  if (!parsed.success) {
    return {
      data: null,
      error: new AvalaraError({
        kind: "validation",
        message: "Avalara integration settings are invalid"
      })
    };
  }

  return { data: { ...parsed.data, installed }, error: null };
}

/**
 * Read the parsed per-company Avalara settings plus whether the integration is
 * installed (active). Parse failure or a DB error returns a typed error.
 */
export async function getAvalaraConfig(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{
  data: (AvalaraSettings & { installed: boolean }) | null;
  error: AvalaraError | null;
}> {
  return readInstalledConfig(client, companyId);
}

/**
 * Build the typed Avalara client bundle for a company. Returns a typed
 * "not configured" / "not installed" error rather than throwing.
 */
export async function getAvalaraClient(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ data: AvalaraClientBundle | null; error: AvalaraError | null }> {
  if (!isAvalaraConfigured()) {
    return {
      data: null,
      error: new AvalaraError({
        kind: "not_configured",
        message: "Avalara is not configured"
      })
    };
  }

  const { data: config, error } = await readInstalledConfig(client, companyId);
  if (error) return { data: null, error };
  if (!config?.installed) {
    return {
      data: null,
      error: new AvalaraError({
        kind: "not_configured",
        message: "Avalara is not installed for this company"
      })
    };
  }

  const http = buildAvalaraHttp(config.environment);
  return {
    data: {
      avatax: new AvataxApi(http, config.companyCode),
      einvoicing: new EinvoicingApi(http),
      config
    },
    error: null
  };
}

/**
 * List the Avalara companies for the account, independent of install state.
 * Used to populate the `companyCode` dropdown BEFORE the integration is
 * installed (so a code can be chosen). Environment defaults to sandbox, or the
 * value already saved in metadata if present.
 */
export async function listAvalaraCompanies(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{
  data: Avalara.CompanyModel[] | null;
  error: AvalaraError | null;
}> {
  if (!isAvalaraConfigured()) {
    return {
      data: null,
      error: new AvalaraError({
        kind: "not_configured",
        message: "Avalara is not configured"
      })
    };
  }

  const row = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("companyId", companyId)
    .eq("id", "avalara")
    .maybeSingle();

  if (row.error) {
    return {
      data: null,
      error: new AvalaraError({
        kind: "transient",
        message: "Failed to read Avalara integration"
      })
    };
  }

  const metadata = (row.data?.metadata ?? {}) as Record<string, unknown>;
  const environment: Avalara.Environment =
    metadata.environment === "production" ? "production" : "sandbox";

  const http = buildAvalaraHttp(environment);
  // companyCode is irrelevant for listing; pass empty string.
  const avatax = new AvataxApi(http, "");
  return avatax.listCompanies();
}

/**
 * Whether a given Avalara feature toggle is enabled for a company. Returns
 * false on any error path and never throws — safe to call from a dispatcher.
 */
export async function isAvalaraFeatureEnabled(
  client: SupabaseClient<Database>,
  companyId: string,
  feature: "taxDetermination" | "eInvoicing"
): Promise<boolean> {
  if (!isAvalaraConfigured()) return false;
  const { data, error } = await readInstalledConfig(client, companyId);
  if (error || !data?.installed) return false;
  return data[feature] === true;
}
