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

  // Push-only master data + documents. No purchaseOrder/salesOrder — Rillet
  // has no PO endpoint, and orders have no Rillet representation. Payments
  // flow INTO Carbon via the Rillet webhook, not the event system.
  const tables: CreateSubscriptionParams["table"][] = [
    "address",
    "customer",
    "supplier",
    "item",
    "salesInvoice",
    "purchaseInvoice"
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
