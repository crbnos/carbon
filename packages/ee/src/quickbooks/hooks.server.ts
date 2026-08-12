import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { deleteEventSystemSubscriptionsByName } from "@carbon/database/event";
import {
  ensureProviderSubscriptions,
  getSyncSubscriptionName,
  ProviderID
} from "@carbon/ee/accounting";

/**
 * Install/settings-save hook: converge this company's `quickbooks-sync`
 * event subscriptions onto REQUIRED_SYNC_SUBSCRIPTIONS (the code-derived
 * list — see @carbon/ee/accounting core/subscriptions). The QBO entity
 * syncers have shipped, so the old no-op here left QBO outbound event sync
 * entirely dead — every subscribed table routes to a registered syncer.
 */
export async function quickbooksOnInstall(companyId: string) {
  const client = getCarbonServiceRole();
  await ensureProviderSubscriptions(client, companyId, ProviderID.QUICKBOOKS);
}

export async function quickbooksOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  await deleteEventSystemSubscriptionsByName(
    client,
    companyId,
    getSyncSubscriptionName(ProviderID.QUICKBOOKS)
  );
}
