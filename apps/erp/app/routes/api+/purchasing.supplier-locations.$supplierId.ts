// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getSupplierLocations } from "~/modules/purchasing";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;

  if (!supplierId)
    return {
      data: []
    };

  const locations = await getSupplierLocations(authorized.client, supplierId);
  if (locations.error) {
    return data(
      locations,
      await flash(
        request,
        error(locations.error, "Failed to get supplier locations")
      )
    );
  }

  return locations;
}

export const clientLoader = cachedClientLoader<typeof loader>();
