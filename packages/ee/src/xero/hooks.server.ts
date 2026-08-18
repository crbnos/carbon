import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { deleteEventSystemSubscriptionsByName } from "@carbon/database/event";
import {
  ensureProviderSubscriptions,
  getProviderIntegration,
  getSyncSubscriptionName,
  ProviderID,
  type ProviderIntegrationMetadata
} from "@carbon/ee/accounting";

export async function xeroHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
) {
  const provider = getProviderIntegration(
    getCarbonServiceRole(),
    companyId,
    ProviderID.XERO,
    metadata as ProviderIntegrationMetadata
  );

  return await provider.validate();
}

/**
 * Install/settings-save hook: converge this company's `xero-sync` event
 * subscriptions onto REQUIRED_SYNC_SUBSCRIPTIONS (the code-derived list —
 * see @carbon/ee/accounting core/subscriptions). Runs on install AND on
 * every settings save (onUpdate), so an existing install self-heals when
 * the required set grows.
 */
export async function xeroOnInstall(companyId: string) {
  const client = getCarbonServiceRole();
  await ensureProviderSubscriptions(client, companyId, ProviderID.XERO);
}

export async function xeroOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  await deleteEventSystemSubscriptionsByName(
    client,
    companyId,
    getSyncSubscriptionName(ProviderID.XERO)
  );
}
