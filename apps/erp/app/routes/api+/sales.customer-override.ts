// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCustomerItemPriceOverride } from "~/modules/sales";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const itemId = url.searchParams.get("itemId");

  if (!customerId || !itemId) {
    return data({ override: null });
  }

  const { data: override } = await getCustomerItemPriceOverride(
    client,
    customerId,
    itemId,
    companyId
  );

  return data({ override });
}
