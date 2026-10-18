// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "purchasing"
  });

  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplierId");
  const purchaseOrderId = url.searchParams.get("purchaseOrderId");
  const search = url.searchParams.get("search");
  const limitParam = Number(url.searchParams.get("limit"));
  const offsetParam = Number(url.searchParams.get("offset"));

  if (!supplierId) {
    return { lines: [], totalCount: 0 };
  }

  const result = await api.purchasing.getReturnableLinesForSupplier({
    purchaseOrderId: purchaseOrderId ?? undefined,
    search: search ?? undefined,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 5,
    offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0,
    supplierId
  });

  if (result.error) {
    console.error("Failed to load returnable receipt lines:", result.error);
    return { lines: [], totalCount: 0 };
  }

  const lines = result.data ?? [];
  return { lines, totalCount: lines[0]?.totalCount ?? 0 };
}
