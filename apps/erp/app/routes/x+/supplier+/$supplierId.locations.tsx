// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { useLoaderData } from "react-router";
import { getSupplierLocations } from "~/modules/purchasing";
import SupplierLocations from "~/modules/purchasing/ui/Supplier/SupplierLocations";
import { path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["supplierId"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const locations = await getSupplierLocations(client, supplierId);
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
