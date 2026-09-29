import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { deleteEventSystemSubscriptionsByName } from "@carbon/database/event";
import {
  ensureProviderSubscriptions,
  getProviderIntegration,
  getSyncSubscriptionName,
  ProviderID,
  type ProviderIntegrationMetadata
} from "@carbon/ee/accounting";

export async function netsuiteHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
) {
  const provider = getProviderIntegration(
    getCarbonServiceRole(),
    companyId,
    ProviderID.NETSUITE,
    metadata as ProviderIntegrationMetadata
  );

  return await provider.validate();
}

export async function netsuiteOnInstall(companyId: string) {
  const client = getCarbonServiceRole();
  await ensureProviderSubscriptions(client, companyId, ProviderID.NETSUITE);
}

export async function netsuiteOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  await deleteEventSystemSubscriptionsByName(
    client,
    companyId,
    getSyncSubscriptionName(ProviderID.NETSUITE)
  );
}
