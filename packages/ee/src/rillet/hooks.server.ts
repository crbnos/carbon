import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { deleteEventSystemSubscriptionsByName } from "@carbon/database/event";
import {
  ensureProviderSubscriptions,
  getProviderIntegration,
  getSyncSubscriptionName,
  ProviderID,
  type ProviderIntegrationMetadata
} from "@carbon/ee/accounting";

export async function rilletHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
) {
  const provider = getProviderIntegration(
    getCarbonServiceRole(),
    companyId,
    ProviderID.RILLET,
    metadata as ProviderIntegrationMetadata
  );

  return await provider.validate();
}

/**
 * Install/settings-save hook: converge this company's `rillet-sync` event
 * subscriptions onto REQUIRED_SYNC_SUBSCRIPTIONS (the code-derived list —
 * see @carbon/ee/accounting core/subscriptions). Runs on install AND on
 * every settings save (onUpdate), so an existing install self-heals when
 * the required set grows.
 */
export async function rilletOnInstall(companyId: string) {
  const client = getCarbonServiceRole();
  await ensureProviderSubscriptions(client, companyId, ProviderID.RILLET);
}

export async function rilletOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  await deleteEventSystemSubscriptionsByName(
    client,
    companyId,
    getSyncSubscriptionName(ProviderID.RILLET)
  );
}
