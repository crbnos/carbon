// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  getJobOperationStockStripes,
  getSerialNumbersForItem
} from "~/services/inventory.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const operationId = url.searchParams.get("operationId");
  if (!itemId) {
    return {
      data: [],
      error: null
    };
  }

  // A job issues only the lots of its stock stripes: its project's stock,
  // then common stock (`issue` refuses any other lot).
  const stripes = operationId
    ? await getJobOperationStockStripes(client, {
        jobOperationId: operationId,
        companyId
      })
    : undefined;

  const result = await getSerialNumbersForItem(client, {
    itemId,
    companyId,
    stripes
  });

  return result;
}
