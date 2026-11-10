// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderPackingSlip } from "~/modules/inventory/packing-slip.pdf";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  return renderPackingSlip({
    client,
    serviceRole: getCarbonServiceRole(),
    companyId,
    shipmentId: id,
    locale: getPreferenceHeaders(request).locale
  });
}
