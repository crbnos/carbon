import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTrackedEntity } from "~/modules/inventory";
import { getCompanySettings } from "~/modules/settings/settings.service";

export async function getEntityLabelData(
  client: SupabaseClient<Database>,
  companyId: string,
  trackedEntityId: string
) {
  const [companySettings, trackedEntity] = await Promise.all([
    getCompanySettings(client, companyId),
    getTrackedEntity(client, trackedEntityId)
  ]);

  if (!trackedEntity.data) {
    return { error: "Tracked entity not found" };
  }

  // sourceDocumentId is polymorphic (Receipt, Shipment, Job Material, etc.);
  // it only equals item.id when sourceDocument === "Item". Prefer the dedicated
  // itemId FK and fall back to sourceDocumentId only for Item-sourced entities.
  const itemId =
    trackedEntity.data.itemId ??
    (trackedEntity.data.sourceDocument === "Item"
      ? trackedEntity.data.sourceDocumentId
      : null);

  if (!itemId) {
    return { error: "Item not found" };
  }

  const item = await client
    .from("item")
    .select("readableId, revision")
    .eq("id", itemId)
    .single();

  if (!item.data) {
    return { error: "Item not found" };
  }

  const labelItem = {
    itemId: item.data.readableId,
    revision: item.data.revision ?? "0",
    number: trackedEntity.data.readableId ?? "",
    trackedEntityId: trackedEntityId,
    quantity: trackedEntity.data.quantity ?? 1,
    trackingType: trackedEntity.data.quantity > 1 ? "Batch" : "Serial"
  };

  return {
    companySettings,
    labelItem,
    error: null
  };
}
