// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Registering a company's Sense webhook. Its own module, kept light, so that
 * `scripts/one-off/register-sense-webhooks.ts` can run it under plain `tsx`:
 * `getAppUrl` comes from `@carbon/env`, not the `@carbon/auth` barrel, which
 * pulls `@carbon/react` and its Lingui macros.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getAppUrl } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import {
  patchIntegrationState,
  resolveIntegrationSecrets,
  WEBHOOK_SIGNING_SECRET_KEY
} from "../integrations/secrets";
import { createSenseProvider } from "./provider";
import { senseWebhookUrl } from "./webhook";

const SENSE = "sense";

const logger = getLogger("ee", "sense");

export function senseFromMetadata(metadata: Record<string, unknown>) {
  const apiKey = typeof metadata.apiKey === "string" ? metadata.apiKey : "";
  if (!apiKey) throw new Error("No API key");
  return createSenseProvider({
    apiKey,
    environment: String(metadata.environment ?? "production")
  });
}

/**
 * Sense only delivers to HTTPS, so a local origin gets no webhook and runs on
 * the sweep alone.
 */
export function webhookOrigin(): string | null {
  const origin = getAppUrl();
  return origin.startsWith("https://") ? origin : null;
}

/**
 * Points the company's Sense webhook (it has at most one) at Carbon, with no
 * filters, and enables it. The signing secret is rotated and vaulted unless
 * the webhook already pointed here, was enabled and Carbon holds its secret:
 * a webhook created elsewhere has a secret only its creator knows. Runs on
 * install and on every settings save, so a save repairs a webhook Sense
 * disabled. An uninstalled company answers 410 to deliveries, which disables
 * the webhook at Sense until the next install enables it again.
 */
export async function ensureSenseWebhook(companyId: string) {
  const origin = webhookOrigin();
  if (!origin) {
    logger.warn("Sense webhook not registered: the app URL is not HTTPS", {
      companyId,
      appUrl: getAppUrl()
    });
    return;
  }

  const serviceRole = getCarbonServiceRole();
  const row = await serviceRole
    .from("companyIntegration")
    .select("metadata, secretRef, active")
    .eq("companyId", companyId)
    .eq("id", SENSE)
    .maybeSingle();
  if (row.error) throw row.error;
  if (!row.data?.active) return;

  const metadata = (await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    SENSE,
    row.data.metadata,
    row.data.secretRef
  )) as Record<string, unknown>;
  const provider = senseFromMetadata(metadata);
  const url = senseWebhookUrl(origin, companyId);

  const existing = await provider.getWebhook();
  let secret: string | null = null;
  if (!existing) {
    ({ secret } = await provider.createWebhook(url));
  } else {
    const keepSecret =
      existing.url === url &&
      existing.enabled &&
      Boolean(metadata[WEBHOOK_SIGNING_SECRET_KEY]);
    await provider.updateWebhook(existing.id, url);
    if (!keepSecret) {
      ({ secret } = await provider.rotateWebhookSecret(existing.id));
    }
  }

  // Stored before the webhook is enabled, so the first delivery verifies.
  if (secret) {
    await patchIntegrationState(serviceRole, companyId, SENSE, {
      secrets: { [WEBHOOK_SIGNING_SECRET_KEY]: secret }
    });
  }
  if (existing && !existing.enabled) {
    await provider.enableWebhook(existing.id);
  }
}
