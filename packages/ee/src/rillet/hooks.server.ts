import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { CreateSubscriptionParams } from "@carbon/database/event";
import {
  createEventSystemSubscription,
  deleteEventSystemSubscriptionsByName
} from "@carbon/database/event";
import {
  getProviderIntegration,
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

export async function rilletOnInstall(companyId: string) {
  const client = getCarbonServiceRole();

  // Push master data + documents. No purchaseOrder/salesOrder — Rillet has no
  // PO endpoint, and orders have no Rillet representation. `payment` is here for
  // the OUTBOUND half (Phase G): a Carbon-born Posted payment (e.g. a bill paid
  // through Ramp) pushes to Rillet as a payment document. Provider-recorded
  // payments still flow INTO Carbon via the Rillet webhook + pull sweep; the
  // push syncer skips those (their mapping marks them provider-owned).
  const tables: CreateSubscriptionParams["table"][] = [
    "address",
    "customer",
    "supplier",
    "item",
    "salesInvoice",
    "purchaseInvoice",
    "payment"
  ];

  for (const table of tables) {
    await createEventSystemSubscription(client, {
      table,
      companyId,
      name: "rillet-sync",
      operations: ["INSERT", "UPDATE", "DELETE"],
      type: "SYNC",
      config: {
        provider: ProviderID.RILLET
      }
    });
  }
}

export async function rilletOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  await deleteEventSystemSubscriptionsByName(client, companyId, "rillet-sync");
}
