// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const itemId = url.searchParams.get("itemId");

  if (!customerId || !itemId) {
    return data({ override: null });
  }

  const { data: override } = await api.sales.getCustomerItemPriceOverride({
    customerId,
    itemId
  });

  return data({ override });
}
