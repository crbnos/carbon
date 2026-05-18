import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getSupplierLocations } from "~/modules/purchasing";
import SupplierLocations from "~/modules/purchasing/ui/Supplier/SupplierLocations";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const locations = await getSupplierLocations(supplierId);
  if (locations.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(locations.error, "Failed to fetch supplier locations")
      )
    );
  }

  return {
    locations: locations.data ?? []
  };
}

export default function SupplierLocationsRoute() {
  const { locations } = useLoaderData<typeof loader>();

  return <SupplierLocations locations={locations} />;
}
