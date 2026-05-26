// Client-safe inventory queries. Mirrors `main` — accept the Supabase
// client as an argument so callers (UI components) can pass the user's
// session client. Server callers should use inventory.service.server.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getItemStorageUnitQuantities } from "~/modules/items/items.client";

export async function getDefaultStorageUnitForJob(
  client: SupabaseClient<Database>,
  itemId: string,
  locationId: string,
  companyId: string
): Promise<string | null> {
  const pickMethod = await client
    .from("pickMethod")
    .select("defaultStorageUnitId")
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (pickMethod.data?.defaultStorageUnitId) {
    return pickMethod.data.defaultStorageUnitId;
  }

  const itemStorageUnitQuantities = await getItemStorageUnitQuantities(
    client,
    itemId,
    companyId,
    locationId
  );

  if (itemStorageUnitQuantities.data?.length) {
    const storageUnitWithHighestQuantity =
      itemStorageUnitQuantities.data.reduce((max, current) => {
        return (current.quantity ?? 0) > (max.quantity ?? 0) ? current : max;
      });

    return storageUnitWithHighestQuantity.storageUnitId;
  }

  return null;
}
