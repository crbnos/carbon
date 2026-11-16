// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  getJobOperationIssueScope,
  getSuggestedAllocationForMaterial
} from "~/services/inventory.service";

/**
 * On-the-fly batch/lot suggestion for issuing a tracked material with no picking
 * list linked — the same allocation the picking list would compute, per material.
 * `companyId` is derived from the session, never trusted from the client.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const quantity = Number(url.searchParams.get("quantity") ?? "0");
  const operationId = url.searchParams.get("operationId");

  if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
    return { data: [], error: null };
  }

  // Suggest only what the job can draw: stock at its own location (read here,
  // never taken from the browser), in its project's stripe, then common stock.
  const scope = operationId
    ? await getJobOperationIssueScope(client, {
        jobOperationId: operationId,
        companyId
      })
    : undefined;
  const locationId = scope
    ? scope.locationId
    : url.searchParams.get("locationId");
  if (!locationId) return { data: [], error: null };

  const data = await getSuggestedAllocationForMaterial(client, {
    itemId,
    companyId,
    locationId,
    quantity,
    projectIds: scope?.stripes
  });

  return { data, error: null };
}
