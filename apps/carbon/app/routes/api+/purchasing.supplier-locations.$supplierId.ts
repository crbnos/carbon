import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ClientLoaderFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs, SerializeFrom } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSupplierLocations } from "~/modules/purchasing";
import { supplierLocationsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "purchasing",
  });

  const { supplierId } = params;

  if (!supplierId)
    return json({
      data: [],
    });

  const locations = await getSupplierLocations(authorized.client, supplierId);
  if (locations.error) {
    return json(
      locations,
      await flash(
        request,
        error(locations.error, "Failed to get supplier locations")
      )
    );
  }

  return json(locations);
}

export async function clientLoader({
  serverLoader,
  params,
}: ClientLoaderFunctionArgs) {
  const { supplierId } = params;

  if (!supplierId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = supplierLocationsQuery(supplierId).queryKey;
  const data =
    window?.queryClient?.getQueryData<SerializeFrom<typeof loader>>(queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.queryClient?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
