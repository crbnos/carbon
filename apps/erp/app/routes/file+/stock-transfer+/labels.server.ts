import type { Database } from "@carbon/database";
import type { ProductLabelItem } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getStockTransferLabelItems(
  client: SupabaseClient<Database>,
  companyId: string,
  stockTransferId: string,
  lineId?: string
): Promise<ProductLabelItem[]> {
  let query = client
    .from("stockTransferLine")
    .select("id, trackedEntityId")
    .eq("stockTransferId", stockTransferId)
    .not("trackedEntityId", "is", null);

  if (lineId) {
    query = query.eq("id", lineId);
  }

  const { data: lines } = await query;

  const entityIds = [
    ...new Set(
      (lines ?? [])
        .map((l) => l.trackedEntityId)
        .filter((id): id is string => !!id)
    )
  ];

  if (entityIds.length === 0) return [];

  const { data: trackedEntities } = await client
    .from("trackedEntity")
    .select("*")
    .in("id", entityIds)
    .eq("companyId", companyId);

  const itemIds = [
    ...new Set(
      (trackedEntities ?? [])
        .map((e) => e.sourceDocumentId)
        .filter((id): id is string => !!id)
    )
  ];

  const { data: items } = await client
    .from("item")
    .select("id, itemTrackingType")
    .in("id", itemIds);

  const trackingTypeByItemId = new Map(
    items?.map((i) => [i.id, i.itemTrackingType]) ?? []
  );

  return (trackedEntities ?? [])
    .map((entity) => ({
      itemId: entity.sourceDocumentReadableId ?? "",
      revision: "0",
      number: entity.readableId ?? "",
      trackedEntityId: entity.id,
      quantity: entity.quantity,
      trackingType:
        trackingTypeByItemId.get(entity.sourceDocumentId ?? "") ??
        (entity.quantity > 1 ? "Batch" : "Serial")
    }))
    .sort((a, b) => {
      if (a.itemId === b.itemId) {
        return a.number.localeCompare(b.number);
      }
      return a.itemId.localeCompare(b.itemId);
    });
}
