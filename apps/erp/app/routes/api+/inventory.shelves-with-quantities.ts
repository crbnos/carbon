import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getShelvesListForLocation } from "~/modules/inventory";
import { getItemShelfQuantities } from "~/modules/items/items.service";
import { getCompanyId, shelvesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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

  // If itemId is provided, get shelves with quantities
  if (itemId) {
    const [shelvesResult, quantitiesResult] = await Promise.all([
      getShelvesListForLocation(client, companyId, locationId),
      getItemShelfQuantities(client, itemId, companyId, locationId)
    ]);

    if (shelvesResult.error || quantitiesResult.error) {
      return {
        data: [],
        error: shelvesResult.error || quantitiesResult.error
      };
    }

    // Filter shelves to only include those with quantities > 0
    const quantitiesMap = new Map(
      quantitiesResult.data?.map((q) => [q.shelfId, q.quantity]) ?? []
    );

    const shelvesWithQuantities =
      shelvesResult.data?.filter((shelf) => {
        const quantity = quantitiesMap.get(shelf.id);
        return quantity && quantity > 0;
      }) ?? [];

    // Add quantity information to each shelf
    const shelvesWithQuantityData = shelvesWithQuantities.map((shelf) => ({
      ...shelf,
      quantity: quantitiesMap.get(shelf.id) ?? 0
    }));

    return {
      data: shelvesWithQuantityData,
      error: null
    };
  }

  return await getShelvesListForLocation(client, companyId, locationId);
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

  const queryKey = shelvesQuery(
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
