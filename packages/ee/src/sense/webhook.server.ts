// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/** Registering a company's Sense webhook. */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { CarbonEdition, ERP_URL, getAppUrl, getEnv } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { Edition } from "@carbon/utils";
import { requireEntitlement } from "../entitlements.server";
import {
  patchIntegrationState,
  resolveIntegrationSecrets,
  WEBHOOK_SIGNING_SECRET_KEY
} from "../integrations/secrets";
import { oeeProviderSettings } from "../oee/registry";
import { createSenseProvider } from "./provider";
import { reconcileSenseWebhook, senseWebhookUrl } from "./webhook";

const SENSE = "sense";

const logger = getLogger("ee", "sense");

export function senseFromMetadata(metadata: Record<string, unknown>) {
  return createSenseProvider(oeeProviderSettings(metadata));
}

/**
 * Where Sense can reach this deployment, or null when it cannot: the deployment
 * then runs on the sweep alone. Sense only delivers to HTTPS, which rules out
 * local dev. `ERP_URL` defaults to Carbon Cloud's URL, so a self-hosted install
 * that never set it would send its deliveries to Carbon Cloud.
 */
export function webhookOrigin(): string | null {
  const origin = getAppUrl();
  if (!origin.startsWith("https://")) return null;
  const isCloudDefault =
    CarbonEdition !== Edition.Cloud && !getEnv("ERP_URL") && origin === ERP_URL;
  return isCloudDefault ? null : origin;
}

/**
 * Registers or repairs the company's Sense webhook (`reconcileSenseWebhook`).
 * Runs on install and on every settings save, which may take over a webhook
 * pointing elsewhere, and from the sweep with `repairOnly`, which never does.
 * An uninstalled company answers 410 to deliveries, which disables the webhook
 * at Sense until the next install enables it again. Throws `EntitlementError`
 * for a company without `INTEGRATIONS`. Returns whether it changed anything.
 */
export async function ensureSenseWebhook(
  companyId: string,
  { repairOnly = false }: { repairOnly?: boolean } = {}
): Promise<boolean> {
  const origin = webhookOrigin();
  if (!origin) {
    if (!repairOnly) {
      logger.warn("Sense webhook not registered: Sense cannot reach the app", {
        companyId,
        appUrl: getAppUrl()
      });
    }
    return false;
  }

  const serviceRole = getCarbonServiceRole();
  await requireEntitlement(serviceRole, companyId, "INTEGRATIONS");

  const row = await serviceRole
    .from("companyIntegration")
    .select("metadata, secretRef, active")
    .eq("companyId", companyId)
    .eq("id", SENSE)
    .maybeSingle();
  if (row.error) throw row.error;
  if (!row.data?.active) return false;

  const metadata = (await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    SENSE,
    row.data.metadata,
    row.data.secretRef
  )) as Record<string, unknown>;

  return reconcileSenseWebhook({
    sense: senseFromMetadata(metadata),
    url: senseWebhookUrl(origin, companyId),
    hasSecret: Boolean(metadata[WEBHOOK_SIGNING_SECRET_KEY]),
    repairOnly,
    storeSecret: async (secret) => {
      await patchIntegrationState(serviceRole, companyId, SENSE, {
        secrets: { [WEBHOOK_SIGNING_SECRET_KEY]: secret }
      });
    }
  });
}
