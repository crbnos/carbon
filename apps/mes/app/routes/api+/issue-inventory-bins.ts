// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";

/** Current positive on-hand bins for an untracked issue at one location. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await authorize(request, {});
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const operationId = url.searchParams.get("operationId");
  if (!itemId || !operationId) return { data: [], error: null };

  const serviceRole = getCarbonServiceRole();
  const operation = await serviceRole
    .from("jobOperation")
    .select("jobId")
    .eq("id", operationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (operation.error || !operation.data?.jobId) {
    throw new Response("Operation not found", { status: 404 });
  }

  const { data, error } = await serviceRole.rpc("get_job_issue_bins", {
    p_company_id: companyId,
    p_job_id: operation.data.jobId,
    p_item_ids: [itemId]
  });
  return {
    data: (data ?? []).map((row) => ({
      storageUnitId: row.storageUnitId,
      storageUnitName: row.storageUnitName,
      quantity: row.quantity
    })),
    error
  };
}
