import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { redis } from "@carbon/kv";
import { AvalaraSettingsSchema } from "./config";
import { AvataxApi } from "./lib/avatax";
import { buildAvalaraHttp, isAvalaraConfigured } from "./lib/env.server";
import type { Avalara } from "./lib/types";

/**
 * Server-only lifecycle hooks for the Avalara integration, registered in
 * `packages/ee/src/hooks.server.ts`. Avalara subscribes to no DB events (both
 * consumers call it at request/job time), so there is no event-system wiring.
 */

function buildAvatax(
  environment: Avalara.Environment,
  companyCode: string
): AvataxApi {
  return new AvataxApi(buildAvalaraHttp(environment), companyCode);
}

/**
 * Healthy only when the credentials authenticate (`ping().authenticated`) AND
 * the configured company code resolves to an Avalara company. The metadata is
 * passed in by `getIntegrationHealth` — the row is not re-read here. Never logs
 * the license key: only the error taxonomy `kind`.
 */
export async function avalaraHealthcheck(
  _companyId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  if (!isAvalaraConfigured()) return false;

  const parsed = AvalaraSettingsSchema.safeParse(metadata ?? {});
  if (!parsed.success) return false;

  const avatax = buildAvatax(parsed.data.environment, parsed.data.companyCode);

  const ping = await avatax.ping();
  if (ping.error) {
    console.error(`Avalara healthcheck ping failed: ${ping.error.kind}`);
    return false;
  }

  const company = await avatax.getCompanyByCode(parsed.data.companyCode);
  if (company.error) {
    console.error(
      `Avalara healthcheck company resolution failed: ${company.error.kind}`
    );
    return false;
  }

  return true;
}

/**
 * Best-effort: resolve the configured company code to its numeric Avalara
 * company id and persist it into metadata (merged, not clobbered) so consumers
 * that need it (e.g. ListNexus) have it available.
 */
export async function avalaraOnInstall(companyId: string): Promise<void> {
  if (!isAvalaraConfigured()) return;

  const client = getCarbonServiceRole();
  const row = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("companyId", companyId)
    .eq("id", "avalara")
    .maybeSingle();

  if (row.error) {
    console.error(
      "Avalara onInstall: failed to read companyIntegration row for",
      companyId
    );
    return;
  }

  const parsed = AvalaraSettingsSchema.safeParse(row.data?.metadata ?? {});
  if (!parsed.success) {
    console.error("Avalara onInstall: settings failed validation");
    return;
  }

  const avatax = buildAvatax(parsed.data.environment, parsed.data.companyCode);
  const company = await avatax.getCompanyByCode(parsed.data.companyCode);
  if (company.error || !company.data) {
    console.error(
      `Avalara onInstall: company resolution failed: ${
        company.error?.kind ?? "no company data"
      }`
    );
    return;
  }

  const existing = (row.data?.metadata ?? {}) as Record<string, unknown>;
  await client
    .from("companyIntegration")
    .update({
      metadata: { ...existing, avalaraCompanyId: company.data.id }
    })
    .eq("companyId", companyId)
    .eq("id", "avalara");
}

/** Clear the cached health status. Consumers own their own teardown. */
export async function avalaraOnUninstall(companyId: string): Promise<void> {
  await redis.del(`integrations:${companyId}:avalara:health`);
}
