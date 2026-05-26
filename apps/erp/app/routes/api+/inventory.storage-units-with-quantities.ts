import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getStorageUnitsListForLocation } from "~/modules/inventory/inventory.service.server";
import { getItemStorageUnitQuantities } from "~/modules/items/items.service.server";
import { getCompanyId, storageUnitsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const itemId = url.searchParams.get("itemId");

  if (!locationId) {
    return {
      data: [],
      error: null
    };
  }

  // If itemId is provided, get storageUnits with quantities
  if (itemId) {
    const [shelvesResult, quantitiesResult] = await Promise.all([
      getStorageUnitsListForLocation(locationId),
      getItemStorageUnitQuantities(itemId, locationId)
    ]);

    if (shelvesResult.error || quantitiesResult.error) {
      return {
        data: [],
        error: shelvesResult.error || quantitiesResult.error
      };
    }

    // Filter storageUnits to only include those with quantities > 0
    const quantitiesMap = new Map(
      quantitiesResult.data?.map((q) => [q.storageUnitId, q.quantity]) ?? []
    );

    const shelvesWithQuantities =
      shelvesResult.data?.filter((storageUnit) => {
        const quantity = quantitiesMap.get(storageUnit.id);
        return quantity && quantity > 0;
      }) ?? [];

    // Add quantity information to each storageUnit
    const shelvesWithQuantityData = shelvesWithQuantities.map(
      (storageUnit) => ({
        ...storageUnit,
        quantity: quantitiesMap.get(storageUnit.id) ?? 0
      })
    );

    return {
      data: shelvesWithQuantityData,
      error: null
    };
  }

  return await getStorageUnitsListForLocation(locationId);
}

export async function clientLoader({
  request,
  serverLoader
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const itemId = url.searchParams.get("itemId");

  const queryKey = storageUnitsQuery(
    companyId,
    locationId ?? null,
    itemId ?? null
  ).queryKey;
  const data =
    window?.clientCache?.getQueryData<Awaited<ReturnType<typeof loader>>>(
      queryKey
    );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
